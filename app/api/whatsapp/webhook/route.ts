import { NextRequest } from 'next/server'
import { verifySignature, sendTextMessage, sendImageMessage, sendTemplateMessage, sendInteractiveList, sendInteractiveButtons, getMediaDownloadUrl, downloadMediaBuffer } from '@/lib/whatsapp/api'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { applyPlaceholders } from '@/lib/utils'
import { setOptOut } from '@/lib/optout'
import { markAppProductInterest } from '@/lib/app-features'

// Module-level cache for the rate template — avoids 2 DB round trips on warm instances.
// Expires after 1 hour so template edits eventually take effect.
let cachedRateTemplate: {
  id: string
  name: string
  body_text: string
  meta_template_name: string | null
  meta_template_lang: string | null
  meta_variables: string[] | null
  header_type: string | null
  header_image_url: string | null
} | null = null
let cacheExpiresAt = 0

// ---------------------------------------------------------------------------
// GET — Meta webhook verification (one-time, when you register the URL)
// Meta sends: hub.mode=subscribe, hub.verify_token, hub.challenge
// We check the token and echo back the challenge.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[webhook] Verified successfully')
    return new Response(challenge, { status: 200 })
  }

  console.error('[webhook] Verification failed — token mismatch')
  return new Response('Forbidden', { status: 403 })
}

// ---------------------------------------------------------------------------
// POST — Receive events from Meta
// We await all processing before returning 200.
// Our total work (~500ms) is well within Meta's 20-second delivery timeout,
// and awaiting ensures Vercel doesn't freeze the Lambda before the auto-reply
// finishes (fire-and-forget gets cut off on serverless after the response).
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const rawBody  = await req.text()
  const sigHeader = req.headers.get('x-hub-signature-256') ?? ''

  if (!verifySignature(rawBody, sigHeader)) {
    console.error('[webhook] Invalid signature — request rejected')
    return Response.json({ status: 'ok' })
  }

  let payload: WhatsAppWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return Response.json({ status: 'ok' })
  }

  try {
    await handlePayload(payload)
  } catch (err) {
    console.error('[webhook] Processing error:', err)
  }

  return Response.json({ status: 'ok' })
}

// ---------------------------------------------------------------------------
// Event processing
// ---------------------------------------------------------------------------
async function handlePayload(payload: WhatsAppWebhookPayload) {
  if (payload.object !== 'whatsapp_business_account') return

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value

      // --- Inbound messages from customers ---
      for (const msg of value.messages ?? []) {
        await handleInboundMessage(msg, value.contacts ?? [])
      }

      // --- Delivery / read status updates for our outbound messages ---
      for (const status of value.statuses ?? []) {
        await handleStatusUpdate(status)
      }
    }
  }
}

async function handleInboundMessage(
  msg: WaInboundMessage,
  contacts: WaContact[]
) {
  const rawPhone: string = msg.from
  const phone = rawPhone.startsWith('91') ? rawPhone.slice(2) : rawPhone

  // A tap on an interactive menu/button comes back as an interactive reply.
  const interactiveReply =
    msg.type === 'interactive'
      ? (msg.interactive?.list_reply ?? msg.interactive?.button_reply ?? null)
      : null

  const body =
    msg.type === 'text'        ? msg.text?.body ?? ''
    : msg.type === 'image'       ? (msg.image?.caption ?? null)
    : msg.type === 'video'       ? (msg.video?.caption ?? null)
    : msg.type === 'document'    ? (msg.document?.caption ?? msg.document?.filename ?? null)
    : msg.type === 'audio'       ? null
    : interactiveReply           ? interactiveReply.title
    : `[${msg.type} message]`

  const messageType =
    msg.type === 'text'        ? 'text'
    : msg.type === 'image'       ? 'image'
    : msg.type === 'video'       ? 'video'
    : msg.type === 'document'    ? 'document'
    : msg.type === 'audio'       ? 'audio'
    : msg.type === 'interactive' ? 'text'
    : 'other'

  const contactName =
    contacts.find(c => c.wa_id === rawPhone)?.profile?.name ?? null

  // A quick-reply BUTTON tap on an audience-STEP message carries context.id = the
  // wamid of the step send. Record it as an exactly-attributable 'replied' event
  // so a later step can carry "who tapped" forward. Additive: if the tapped
  // message wasn't a step send, this no-ops and the bot flow is untouched.
  const replyContextId = msg.context?.id ?? null
  if (interactiveReply && replyContextId) {
    await recordStepReply(replyContextId, interactiveReply.id)
  }

  // Customer lookup and thread lookup are independent — run in parallel
  const [{ data: existingCustomer }, { data: existingThread }] = await Promise.all([
    supabaseAdmin.from('wa_customers').select('id, name, dnd').eq('phone', phone).maybeSingle(),
    supabaseAdmin.from('wa_threads').select('id, customer_id, bot_state').eq('phone', phone).maybeSingle(),
  ])

  // --- Auto-enroll: every inbound contact lands in the customer book ---
  let customer = existingCustomer as { id: string; name: string; dnd?: boolean } | null
  if (!customer) {
    const { data: created, error: createErr } = await supabaseAdmin
      .from('wa_customers')
      .insert({
        name:         contactName ?? `WhatsApp ${phone.slice(-4)}`,
        phone,
        enrolled_via: 'whatsapp',
      })
      .select('id, name, dnd')
      .single()
    if (createErr) console.error('[webhook] Failed to auto-enroll customer:', createErr)
    customer = created ?? null
  } else if (contactName && customer.name?.startsWith('WhatsApp ')) {
    // We learned the real WhatsApp profile name — upgrade the placeholder
    await supabaseAdmin.from('wa_customers').update({ name: contactName }).eq('id', customer.id)
    customer = { ...customer, name: contactName }
  }

  const displayName = customer?.name ?? contactName ?? 'there'

  // --- Ad-lead capture: a Click-to-WhatsApp lead's first inbound carries a
  // `referral` (ad id / ctwa_clid). Record it so an AD1 follow-up audience can
  // target them. Defensive: no-op if the ad tables aren't there yet (pre-wa_042)
  // or ads aren't running. ---
  const referral = (msg as { referral?: { source_id?: string; headline?: string; ctwa_clid?: string } }).referral
  if (referral && (referral.source_id || referral.ctwa_clid)) {
    try {
      await supabaseAdmin.from('wa_ad_leads').upsert({
        phone, ad_campaign: referral.source_id ?? null, source_id: referral.source_id ?? null,
        ctwa_clid: referral.ctwa_clid ?? null, headline: referral.headline ?? null,
      }, { onConflict: 'phone,ad_campaign', ignoreDuplicates: true })
    } catch { /* ad tables not present / ads not live — ignore */ }
  }

  let threadId: string
  const now = new Date().toISOString()

  // For inbound media (image / video / document / voice), download from Meta and
  // store in Supabase Storage. Each of these payload shapes carries { id, mime_type }.
  const inboundMedia =
    msg.type === 'image'    ? msg.image
    : msg.type === 'video'    ? msg.video
    : msg.type === 'document' ? msg.document
    : msg.type === 'audio'    ? msg.audio
    : null
  let mediaUrl: string | null = null
  if (inboundMedia?.id) {
    mediaUrl = await fetchAndStoreInboundMedia(inboundMedia.id, inboundMedia.mime_type ?? 'application/octet-stream')
      .catch(err => { console.error('[webhook] Media store error:', err); return null })
  }

  const preview =
    messageType === 'image'    ? ('📷 Photo' + (body ? `: ${body.slice(0, 40)}` : ''))
    : messageType === 'video'    ? ('🎥 Video' + (body ? `: ${body.slice(0, 40)}` : ''))
    : messageType === 'document' ? ('📄 ' + (body ? body.slice(0, 44) : 'Document'))
    : messageType === 'audio'    ? '🎤 Voice message'
    : (body ?? '').slice(0, 60)

  if (existingThread) {
    threadId = existingThread.id
    const threadUpdate: Record<string, unknown> = { last_message_at: now, last_message_preview: preview }
    // Backfill the customer link on older threads created before auto-enroll
    if (!existingThread.customer_id && customer) {
      threadUpdate.customer_id   = customer.id
      threadUpdate.customer_name = customer.name
    }
    await Promise.all([
      supabaseAdmin.from('wa_threads').update(threadUpdate).eq('id', threadId),
      supabaseAdmin.from('wa_messages').insert({
        thread_id: threadId, direction: 'inbound',
        wa_message_id: msg.id, body, message_type: messageType,
        media_url: mediaUrl, status: 'received',
      }),
    ])
  } else {
    const { data: newThread, error } = await supabaseAdmin
      .from('wa_threads')
      .insert({
        phone,
        customer_name:        customer?.name ?? contactName,
        customer_id:          customer?.id ?? null,
        last_message_at:      now,
        last_message_preview: preview,
      })
      .select('id')
      .single()

    if (error || !newThread) {
      console.error('[webhook] Failed to create thread:', error)
      return
    }
    threadId = newThread.id

    await supabaseAdmin.from('wa_messages').insert({
      thread_id: threadId, direction: 'inbound',
      wa_message_id: msg.id, body, message_type: messageType,
      media_url: mediaUrl, status: 'received',
    })
  }

  // ----- Automated, rules-based response -----
  const text     = msg.type === 'text' ? (body ?? '') : ''
  const botState = existingThread?.bot_state ?? 'active'

  try {
    if (isStopKeyword(text)) {
      // Opt out — flag DnD and never message this number again
      await handleStop(phone, threadId, customer)
    } else if (customer?.dnd) {
      // Opted out: only "START" can bring them back; otherwise total silence
      if (isStartKeyword(text)) await handleResume(phone, threadId, customer)
    } else if (botState === 'with_agent') {
      // A human has taken over. Stay completely silent — even for "hi"/"hello" —
      // until staff resumes the bot from the chat. Don't talk over the salesman.
    } else if (hasProductRef(text)) {
      // A product enquiry: the app's "Enquire on WhatsApp" / Share button sent the
      // piece's /product/<id> link (or the customer typed a design code). Answer
      // with the live itemised price; human follow-up fires in the background.
      // Checked before isAppProductInterest so the enquiry gets a price, not the
      // generic "we'll contact you" (the prefill also contains "interested").
      await handleProductEnquiry(phone, threadId, customer, text)
    } else if (isAppProductInterest(text)) {
      // They tapped "interested" / shared a gold.mnalankarpalace.com product link
      // from the app. Note the choice, hand to a human, and acknowledge. Checked
      // ahead of the menu so a "…interested…" message never falls through to the
      // generic welcome. (interactive taps carry no `text`, so this can't eat one.)
      await handleAppProductInterest(phone, threadId, customer)
    } else if (interactiveReply) {
      // An explicit button/menu tap — always honour it
      await handleFlowReply(phone, threadId, interactiveReply.id, customer, displayName)
    } else if (botState === 'awaiting_care') {
      // We asked them to type their question — this message is it. Hand to a human.
      await handleCareQuestion(phone, threadId)
    } else if (isPinReset(text)) {
      // Arrived from the app's "Forgot PIN" flow — acknowledge + hand to a human
      // (only the store can reset a PIN). Checked before greeting: the prefill
      // opens with "Hi …" but carries the real intent.
      await handlePinReset(phone, threadId, customer)
    } else if (isPurchaseQuery(text)) {
      // Arrived from the Bill Summary "Contact us" ("…question about my purchase").
      await handlePurchaseQuery(phone, threadId, customer)
    } else if (isGreeting(text)) {
      await sendWelcomeMenu(phone, threadId)
    } else if (isRateKeyword(text)) {
      await ensureRateInterest(customer?.id)
      await sendRate(phone, threadId, displayName)
    } else if (isPriceQuery(text)) {
      await handlePriceQuery(phone, threadId, displayName, customer)
    } else if (isOffersKeyword(text)) {
      await sendOffersMenu(phone, threadId)
    } else if (isSchemeKeyword(text)) {
      await handleScheme(phone, threadId, customer)
    } else if (isMoreDesigns(text)) {
      // "Send me more/other designs" — show real pieces matched to any category +
      // metal named in the message, instead of routing back through the funnel.
      await suggestProducts(phone, threadId, { categoryName: guessCategory(text), metal: guessMetal(text) })
    } else if (isDesignKeyword(text)) {
      await sendMetalStep(phone, threadId, 'designs')
    } else {
      // Anything else (random/unwanted text, an emoji, a photo): if it reads like a
      // real question, hand it to a human so it isn't lost; otherwise show the menu.
      // Either way, nudge towards the self-serve app.
      await handleFallback(phone, threadId, text)
    }
  } catch (err) {
    console.error('[webhook] Automated response error:', err)
  }
}

// ---------------------------------------------------------------------------
// Conversation flow helpers (rules-based — keyword + menu driven)
// ---------------------------------------------------------------------------
const GREETING_WORDS = new Set([
  'hi', 'hii', 'hiii', 'hey', 'heyy', 'hello', 'helo', 'hellow',
  'namaste', 'namaskar', 'hello there', 'start', 'menu', 'hi there',
  'gm', 'good morning', 'good afternoon', 'good evening', 'good night',
])

function isGreeting(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/[!.।,]+$/, '')
  if (!t) return false
  if (GREETING_WORDS.has(t)) return true
  // Short opener that starts with a greeting word (e.g. "hi sir", "hello bhai")
  return t.length <= 20 && /^(hi+|hey+|hello+|namaste|namaskar)\b/.test(t)
}

function isRateKeyword(raw: string): boolean {
  const t = raw.trim().toLowerCase()
  return /\b(rate|rates|bhav|bhaav|gold rate|todays? rate)\b/.test(t) || fuzzyHas(raw, ['rates'])
}

function isOffersKeyword(raw: string): boolean {
  return /\b(offer|offers|sale|discount|deal|deals)\b/.test(raw.trim().toLowerCase())
    || fuzzyHas(raw, ['offer', 'offers', 'discount'])
}

function isSchemeKeyword(raw: string): boolean {
  return /\b(scheme|schemes|saving|savings|sip|gold scheme|gold savings)\b/.test(raw.trim().toLowerCase())
    || fuzzyHas(raw, ['scheme', 'schemes', 'savings'])
}

function isStopKeyword(raw: string): boolean {
  return /^(stop|unsubscribe|stop messages?)\b/.test(raw.trim().toLowerCase())
}

function isStartKeyword(raw: string): boolean {
  return /^(start|resume|subscribe)\b/.test(raw.trim().toLowerCase())
}

function isDesignKeyword(raw: string): boolean {
  const t = raw.trim().toLowerCase()
  if (/\b(design|designs|new design|collection|jewell?ery)\b/.test(t)) return true
  // Any category the customer names — in English, Hindi/Odia, or a near-typo
  // (har, churi, kada, jhumka, tops, bali, mangalsutra…).
  return canonicalCategory(raw) != null
}

// A product-interest message from the customer app: the app's "Share on WhatsApp"
// pre-fills a gold.mnalankarpalace.com product link (and/or the word "interested").
// Either one means "note my choice, someone reach out".
function isAppProductInterest(raw: string): boolean {
  const t = (raw ?? '').toLowerCase()
  if (!t) return false
  return t.includes('gold.mnalankarpalace.com') || /\binterested\b/.test(t)
}

// ---------------------------------------------------------------------------
// Customer-app deep links — power chat replies with self-serve app pages so a
// message rarely dead-ends at "our team will get back". Same host the invoice
// links use (overridable via CUSTOMER_APP_PUBLISH_URL); every path below is
// PUBLIC (no login) so the link never lands on a sign-in wall.
// ---------------------------------------------------------------------------
function appBase(): string {
  const pub = process.env.CUSTOMER_APP_PUBLISH_URL || ''
  const stripped = pub.replace(/\/api\/.*$/, '').replace(/\/+$/, '')
  return stripped || 'https://gold.mnalankarpalace.com'
}
function appUrl(path: string): string {
  return appBase() + (path.startsWith('/') ? path : `/${path}`)
}
const APP_LINKS = {
  shop:       () => appUrl('/shop'),
  rate:       () => appUrl('/gold-rate-in-rourkela'),
  calculator: () => appUrl('/calculator'),
  scheme:     () => appUrl('/home?schemeIntro=1'),
  product:    (id: string) => appUrl(`/product/${id}`),
}

// ---------------------------------------------------------------------------
// Typo tolerance — Levenshtein ≤1 on a single token. Restricted to tokens of
// length ≥5 so short, collision-prone words (rate/sale/deal) match only exactly
// and we never re-route a greeting like "dear sir" into the offers menu.
// ---------------------------------------------------------------------------
function within1(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.length, lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (la > lb) i++
    else if (lb > la) j++
    else { i++; j++ }
  }
  if (i < la || j < lb) edits++
  return edits <= 1
}
function fuzzyHas(raw: string, words: string[]): boolean {
  const toks = raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  for (const t of toks) {
    for (const w of words) {
      if (t === w) return true
      if (w.length >= 5 && t.length >= 5 && within1(t, w)) return true
    }
  }
  return false
}

// The app's "Forgot PIN" flow pre-fills a WhatsApp message ("…I forgot my PIN…").
// Only the store can reset a PIN (security), so this stays a human handoff — but
// with a warm, informative acknowledgement instead of a bare "team will reply".
function isPinReset(raw: string): boolean {
  const t = raw.toLowerCase()
  if (/\bpin\b/.test(t) && /\b(reset|forgot|forget|change|new|lost|unlock|recover|block)\b/.test(t)) return true
  return /forgot my pin|reset my pin|pin reset|reset pin|change my pin/.test(t)
}
// The Bill Summary page's "Contact us" pre-fills "…a question about my purchase."
function isPurchaseQuery(raw: string): boolean {
  const t = raw.toLowerCase()
  return /question about my purchase|\bmy (purchase|bill|order|invoice)\b|about my (purchase|order|bill|jewell?ery)/.test(t)
}
// A price/cost enquiry — distinct from the daily gold RATE (checked first). Gives
// today's rate + the calculator/shop as self-serve, then invites a photo to quote.
function isPriceQuery(raw: string): boolean {
  const t = raw.toLowerCase()
  if (/\b(price|cost|prise|coast|pricing)\b/.test(t)) return true
  if (/\bhow much\b|\bkitn[ae]\b|\bdaam\b|\bkimat\b|\bkeemat\b/.test(t)) return true
  return fuzzyHas(raw, ['price', 'pricing'])
}
// "Send me more / other / latest designs" — a request to see more of the catalogue.
function isMoreDesigns(raw: string): boolean {
  const t = raw.toLowerCase()
  return /\b(more|other|another|new|latest|show|send|aur|dusr[ae])\b/.test(t)
    && (/design|collection|jewell?ery|piece|photos?|pics?|catalog/.test(t) || canonicalCategory(t) != null)
}

// ---------------------------------------------------------------------------
// Category synonyms — the many ways a customer (or the store's own item_name)
// names a piece: English + Hindi/Odia + common misspellings. Canonical keys are
// grounded in the ACTUAL inventory item names (SHORT/LONG HAR, CHURI, KADA, BALA,
// CHAIN, FOX CHAIN, EARRING, JHUMKA, TOPS, BALI, LADIES/GENTS RING, MANGALSUTRA,
// MS LOCKET, GENTS BRACELET). Extend a list to teach the bot a new word.
// ---------------------------------------------------------------------------
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  necklace:    ['necklace', 'neckless', 'har', 'haar', 'rani haar', 'ranihaar', 'sita haar', 'sitahaar', 'mala', 'chik', 'guluband', 'short har', 'long har', 'set'],
  bangle:      ['bangle', 'bangles', 'bangdi', 'churi', 'chudi', 'choodi', 'chudiyan', 'kada', 'kara', 'kadha', 'polla', 'pola', 'bala', 'kangan', 'gajra', 'sankha', 'noa'],
  chain:       ['chain', 'chein', 'fox chain', 'rope chain', 'sikri', 'zanjeer'],
  earring:     ['earring', 'earrings', 'ear ring', 'ear rings', 'tops', 'stud', 'studs', 'jhumka', 'jhumki', 'jhumke', 'jumka', 'bali', 'baali', 'kanphool', 'jhalar', 'latkan', 'dangler'],
  ring:        ['ring', 'rings', 'anguthi', 'angoothi', 'angthi', 'mundi', 'mundri', 'finger ring', 'ladies ring', 'gents ring'],
  mangalsutra: ['mangalsutra', 'mangal sutra', 'mangalsutr', 'mangalsutram', 'mangalya', 'black beads', 'kala moti'],
  locket:      ['locket', 'loket', 'lockit', 'pendant', 'pendent', 'ms locket'],
  bracelet:    ['bracelet', 'braclet', 'braslet', 'brasslet', 'brace let', 'hath phool', 'lotan'],
}
// The canonical category a free word or item_name belongs to (or null). Direct
// word/phrase match first, then a typo-tolerant pass on synonyms of length ≥5
// (so "ring" is exact-only — "bring" never becomes a ring — while "necklace",
// "jhumka", "bracelet" etc. tolerate a one-character slip).
function canonicalCategory(raw: string | null | undefined): string | null {
  if (!raw) return null
  const t = raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return null
  const toks = t.split(' ')
  for (const [canon, syns] of Object.entries(CATEGORY_SYNONYMS)) {
    for (const s of syns) {
      if (s.includes(' ')) { if (t.includes(s)) return canon }
      else if (toks.includes(s)) return canon
    }
  }
  for (const tok of toks) {
    if (tok.length < 5) continue
    for (const [canon, syns] of Object.entries(CATEGORY_SYNONYMS)) {
      for (const s of syns) {
        if (!s.includes(' ') && s.length >= 5 && within1(tok, s)) return canon
      }
    }
  }
  return null
}
// Free-text → canonical category (for targeting a suggestion).
function guessCategory(raw: string): string | null {
  return canonicalCategory(raw)
}
type Metal = 'gold' | 'silver' | 'diamond'
function guessMetal(raw: string): Metal | null {
  const t = raw.toLowerCase()
  if (/diamond|heera/.test(t)) return 'diamond'
  if (/silver|chandi/.test(t)) return 'silver'
  if (/\bgold\b|sona|22k|24k|18k|916/.test(t)) return 'gold'
  return null
}

// ---------------------------------------------------------------------------
// Product matching + live price (mirrors the customer app: lib/catalogue-sync
// resolveKarat + lib/price priceForProduct — kept inline so this hot webhook path
// doesn't pull the Firebase admin module). The price is INDICATIVE, computed from
// today's daily_rates exactly like the app's calculator + product page, so chat
// and app never disagree.
// ---------------------------------------------------------------------------
function karatOf(purity: string | null | undefined): number | null {
  if (!purity) return null
  const p = purity.toLowerCase()
  if (/(^|\D)(24|995|999)(\D|$)/.test(p) || p.includes('24k')) return 24
  if (/(^|\D)(22|916)(\D|$)/.test(p) || p.includes('22k')) return 22
  if (/(^|\D)(18|750)(\D|$)/.test(p) || p.includes('18k')) return 18
  if (/(^|\D)(14|585)(\D|$)/.test(p) || p.includes('14k')) return 14
  if (/(^|\D)(9|375)(\D|$)/.test(p) || p.includes('9k')) return 9
  return null
}
// A piece's metal, for matching a "gold/silver/diamond" design request. Diamond
// wins over its gold mount (a diamond ring is asked for as "diamond").
function productMetal(p: { item_name: string | null; description?: string | null; purity: string | null }): Metal | null {
  const hay = `${p.item_name ?? ''} ${p.description ?? ''} ${p.purity ?? ''}`.toLowerCase()
  if (/diamond/.test(hay)) return 'diamond'
  if (/silver|chandi/.test(hay)) return 'silver'
  if (karatOf(p.purity) != null || /gold|sona/.test(hay)) return 'gold'
  return null
}
// Does a product's item_name belong to the requested category? Both sides are
// mapped to a canonical category, so "har"/"short har"/"NECKLACE" all match a
// customer's "necklace", and "churi"/"kada"/"bala" all match "bangle".
function categoryMatches(itemName: string | null, categoryName: string): boolean {
  const want = canonicalCategory(categoryName)
  const got = canonicalCategory(itemName)
  return want != null && got === want
}

const HUID_CHARGE = 50 // flat ₹ per piece (mirrors lib/price.ts)
const GST_RATE = 0.03  // 3%
// Default making charge when a piece has none set — mirrors catalogue-sync so the
// chat quote matches the app's product page / calculator. Keep the two in sync.
const DEFAULT_MAKING_PERCENT = 9
type DailyRates = { rate_24kt: number | null; rate_22kt: number | null; rate_18kt: number | null }
function ratePerGram(rates: DailyRates | null, karat: number | null): number | null {
  if (!rates || karat == null) return null
  if (karat === 24) return rates.rate_24kt || null
  if (karat === 22) return rates.rate_22kt || null
  if (karat === 18) return rates.rate_18kt || null
  return null // 14K/9K → no live per-gram rate → price on request
}
interface Breakup { hidden: boolean; metal: number; making: number; huid: number; gst: number; total: number }
function computeBreakup(
  p: { weight: number | null; purity: string | null; making_percent?: number | null },
  rates: DailyRates | null,
): Breakup {
  const perGram = ratePerGram(rates, karatOf(p.purity))
  const w = p.weight ?? 0
  if (!w || !perGram) return { hidden: true, metal: 0, making: 0, huid: 0, gst: 0, total: 0 }
  const metal = w * perGram
  const making = ((p.making_percent ?? DEFAULT_MAKING_PERCENT) / 100) * metal
  const huid = HUID_CHARGE
  const taxable = metal + making + huid
  const gst = taxable * GST_RATE
  return { hidden: false, metal, making, huid, gst, total: taxable + gst }
}
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')

// Pull product references out of an inbound message: the app's "Enquire on
// WhatsApp" / Share button pre-fills the piece's /product/<id> link, and some
// customers type the app-facing design code (MN000123). Both let us answer with
// the exact piece's price. De-duped, capped so a pasted wall of links can't fan out.
function extractProductRefs(raw: string): { ids: string[]; codes: string[] } {
  const ids = new Set<string>()
  const codes = new Set<string>()
  for (const m of raw.matchAll(/\/product\/([A-Za-z0-9_-]{6,})/g)) ids.add(m[1])
  for (const m of raw.matchAll(/\bMN\d{4,}\b/gi)) codes.add(m[0].toUpperCase())
  return { ids: [...ids].slice(0, 5), codes: [...codes].slice(0, 5) }
}
function hasProductRef(raw: string): boolean {
  const { ids, codes } = extractProductRefs(raw)
  return ids.length > 0 || codes.length > 0
}

// ---------------------------------------------------------------------------
// Small data helpers
// ---------------------------------------------------------------------------
async function addInterest(customerId: string, topicId: string) {
  await supabaseAdmin
    .from('wa_customer_interests')
    .upsert({ customer_id: customerId, topic_id: topicId }, { onConflict: 'customer_id,topic_id', ignoreDuplicates: true })
  // Mirror into the unified interest layer (wa_signals), phone-keyed. The chat
  // node still points at its topic; we read that topic's canonical `key`
  // (wa_033) — no label guessing. Best-effort: never let this break the reply.
  try {
    const [{ data: cust }, { data: topic }] = await Promise.all([
      supabaseAdmin.from('wa_customers').select('phone').eq('id', customerId).maybeSingle(),
      supabaseAdmin.from('wa_interest_topics').select('name, key').eq('id', topicId).maybeSingle(),
    ])
    const phone = (cust?.phone ?? '').replace(/\D/g, '').slice(-10)
    const interest = topic?.key ?? null
    if (phone.length === 10 && interest) {
      await supabaseAdmin.from('wa_signals').upsert(
        { phone, interest, source: 'whatsapp', weight: 1, evidence: topic?.name ?? 'chat', last_seen: new Date().toISOString() },
        { onConflict: 'phone,interest,source' })
    }
  } catch (err) {
    console.error('addInterest signal mirror failed (non-fatal):', err)
  }
}

async function findTopicId(namePattern: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('wa_interest_topics')
    .select('id')
    .ilike('name', namePattern)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

async function ensureRateInterest(customerId?: string) {
  if (!customerId) return
  const id = await findTopicId('%rate%')
  if (id) await addInterest(customerId, id)
}

// Product list for the design funnel = sub-topics under "New Designs" (capped to
// leave room for a "Talk to our team" row within WhatsApp's 10-row list limit).
async function getDesignSubtopics(): Promise<Array<{ id: string; name: string }>> {
  const parentId = await findTopicId('%new design%') ?? await findTopicId('%design%')
  if (!parentId) return []
  const { data } = await supabaseAdmin
    .from('wa_interest_topics')
    .select('id, name')
    .eq('parent_id', parentId)
    .eq('is_active', true)
    .order('sort_order')
    .limit(9)
  return data ?? []
}

async function setBotState(threadId: string, state: 'active' | 'awaiting_care' | 'with_agent') {
  await supabaseAdmin.from('wa_threads').update({ bot_state: state }).eq('id', threadId)
}

async function flagAgent(threadId: string) {
  await supabaseAdmin.from('wa_threads').update({ needs_agent: true }).eq('id', threadId)
}

async function recordLead(
  threadId: string,
  customerId: string | undefined,
  fields: { intent: string; metal?: string; product_topic_id?: string; wants_designs?: boolean }
) {
  await supabaseAdmin.from('wa_lead_captures').insert({
    thread_id: threadId, customer_id: customerId ?? null, ...fields,
  })
}

// Record a quick-reply button tap on an audience-step send as a 'replied' event.
// Attribution is exact: context.id (`wamid`) → the ledger row's campaign → a step
// that owns that campaign. No-op when the tapped message isn't a step send.
async function recordStepReply(wamid: string, buttonId: string) {
  const { data: ledger } = await supabaseAdmin.from('wa_send_ledger')
    .select('campaign_id').eq('wa_message_id', wamid).not('campaign_id', 'is', null).maybeSingle()
  if (!ledger?.campaign_id) return
  const { data: step } = await supabaseAdmin.from('audience_steps')
    .select('id').eq('campaign_id', ledger.campaign_id).maybeSingle()
  if (!step) return
  const { data: msgRow } = await supabaseAdmin.from('wa_messages')
    .select('id').eq('wa_message_id', wamid).maybeSingle()
  await supabaseAdmin.from('wa_message_events').insert({
    message_id: msgRow?.id ?? null, wa_message_id: wamid, status: 'replied',
    event_at: new Date().toISOString(), raw: { button: buttonId, source: 'step' },
  })
}

// Log an outbound message we sent ourselves (auto-reply / flow) and bump the thread
async function logOutbound(threadId: string, wamid: string, body: string) {
  const now = new Date().toISOString()
  await Promise.all([
    supabaseAdmin.from('wa_messages').insert({
      thread_id: threadId, direction: 'outbound', wa_message_id: wamid,
      body, status: 'sent', sent_at: new Date().toISOString(),
    }),
    supabaseAdmin
      .from('wa_threads')
      .update({ last_message_at: now, last_message_preview: body.slice(0, 60) })
      .eq('id', threadId),
  ])
}

// ---------------------------------------------------------------------------
// Editable bot copy (admin-managed via wa_bot_messages; falls back to defaults)
// ---------------------------------------------------------------------------
const BOT_DEFAULTS: Record<string, string> = {
  welcome:     '🙏 Welcome to M N Alankar Palace!\nHow can we help you today?',
  stop_notice: 'Message STOP any time to stop receiving messages.',
  stop_ack:    'You have been unsubscribed. 🙏 You will not receive any more messages from us. Message START anytime to resume.',
  more_options:'Here are all the options. 🙏 Please choose one:',
  offers_menu: 'What would you like to know? 🙏',
  offer:       '✨ Our latest offers are running now! Please visit us to know more.',
  exchange_menu: 'Please choose one: 🙏',
  exchange_info: 'You can exchange your old gold for new jewellery at the best value. 🙏 Our team will share the details with you shortly.',
  cash_info:   'We offer instant cash for your gold. 🙏 Our team will contact you with the details shortly.',
  scheme_info: 'Our Gold Savings Scheme helps you save every month towards your jewellery. 🙏 Our representative will contact you shortly with all the details.',
  app_interest_ack: 'Thank you! 🙏 We have noted your choice and will contact you with more details. Meanwhile, please continue browsing.',
  rate_outro:  'Would you like to see anything else?',
  ask_metal:   'Which are you interested in?',
  ask_product: 'Which item would you like to see?',
  ask_designs: 'Shall we send you a few designs?',
  designs_ack: 'Here are a few designs you may love 💛 Our team will also share more shortly.',
  care_prompt: 'Please type your question below. 🙏 Our team will reply to you shortly.',
  care_ack:    'Thank you! 🙏 Our team will reply to you shortly.',
  closing:     'Okay! 🙏 If you need anything, just message us anytime.',
  pin_reset_ack: 'For your security, only our store can reset your PIN. 🙏 We will set a new one for you shortly — after that you can change it anytime from your Profile in the app.',
  purchase_query_ack: 'Thank you for shopping with us! 🙏 Please share your question about your purchase and our team will help you right away.',
}

async function getBotMessage(key: string): Promise<{ content: string; image_url: string | null }> {
  const { data } = await supabaseAdmin
    .from('wa_bot_messages')
    .select('content, image_url')
    .eq('key', key)
    .maybeSingle()
  return {
    content: (data?.content?.trim() ? data.content : BOT_DEFAULTS[key]) ?? '',
    image_url: data?.image_url ?? null,
  }
}

// Send a plain (or image+caption) bot message and log it
async function sendBot(phone: string, threadId: string, key: string) {
  const { content, image_url } = await getBotMessage(key)
  if (image_url) {
    const wamid = await sendImageMessage(phone, image_url, content || undefined)
    await logOutbound(threadId, wamid, content || '📷 Image')
  } else {
    const wamid = await sendTextMessage(phone, content)
    await logOutbound(threadId, wamid, content)
  }
}

// Same as sendBot, but appends a contextual call-to-action line (an app deep link).
// Keeps the human copy owner-editable in wa_bot_messages while the code always
// supplies the correct, env-derived link — so the two never drift apart.
async function sendBotWithCta(phone: string, threadId: string, key: string, cta: string) {
  const { content, image_url } = await getBotMessage(key)
  const body = content ? `${content}\n\n${cta}` : cta
  if (image_url) {
    const wamid = await sendImageMessage(phone, image_url, body)
    await logOutbound(threadId, wamid, body)
  } else {
    const wamid = await sendTextMessage(phone, body)
    await logOutbound(threadId, wamid, body)
  }
}

// Suggest up to 2 real published products as cards (photo + /product link), then a
// closing browse line. Matched to the customer's demand: when a category and/or
// metal is known we only send pieces that actually match — never an off-category
// "random" piece. Runs right after an inbound message, so we're inside WhatsApp's
// 24h service window (free-form text + images need no template). Best-effort: a DB
// hiccup still ends with a browse link. Returns how many cards were sent.
type ProdRow = {
  id: string; item_name: string | null; app_title: string | null
  weight: number | null; purity: string | null; description: string | null
  stock_status: string | null; is_catalogue_only: boolean | null
}
async function suggestProducts(
  phone: string,
  threadId: string,
  opts: { categoryName?: string | null; metal?: Metal | null; excludeIds?: string[]; intro?: string } = {},
): Promise<number> {
  const { categoryName, metal, excludeIds, intro } = opts
  const wantCat = categoryName ? canonicalCategory(categoryName) : null
  const exclude = new Set(excludeIds ?? [])
  let sent = 0
  try {
    // Fetch the published set (newest first) and match in JS on the CANONICAL
    // category, because item names are local (HAR, CHURI, JHUMKA…) and won't
    // contain the English stem. Catalogue is small, so this is cheap.
    const cols = 'id, item_name, app_title, weight, purity, description, stock_status, is_catalogue_only'
    const { data } = await supabaseAdmin.from('wa_products')
      .select(cols).eq('show_in_app', true).eq('is_active', true)
      .order('app_synced_at', { ascending: false, nullsFirst: false }).limit(200)
    let list = ((data ?? []) as ProdRow[]).filter(p => !exclude.has(p.id))

    if (categoryName) {
      list = wantCat
        ? list.filter(p => canonicalCategory(p.item_name) === wantCat)
        : list.filter(p => categoryMatches(p.item_name, categoryName)) // unknown word → best effort
    }
    if (metal) list = list.filter(p => productMetal(p) === metal)
    // Prefer in-stock pieces over catalogue-only showcases (both are valid designs).
    list.sort((a, b) => {
      const ai = a.stock_status === 'in_stock' && !a.is_catalogue_only ? 0 : 1
      const bi = b.stock_status === 'in_stock' && !b.is_catalogue_only ? 0 : 1
      return ai - bi
    })
    const shortlist = list.slice(0, 8)

    if (shortlist.length) {
      // Primary/in-app image per candidate, in one query (no N+1).
      const ids = shortlist.map(p => p.id)
      const { data: imgs } = await supabaseAdmin.from('wa_product_images')
        .select('product_id, image_url, display_url, is_primary, in_app')
        .in('product_id', ids)
      const byProduct = new Map<string, string>()
      for (const im of (imgs ?? []) as Array<{ product_id: string; image_url: string | null; display_url: string | null; is_primary: boolean; in_app: boolean }>) {
        if (!(im.is_primary || im.in_app)) continue
        const url = im.display_url ?? im.image_url
        if (!url) continue
        if (!byProduct.has(im.product_id) || im.is_primary) byProduct.set(im.product_id, url)
      }
      for (const p of shortlist) {
        if (sent >= 2) break
        const url = byProduct.get(p.id)
        if (!url) continue
        if (sent === 0 && intro) { // lead-in, only once we know a card will follow
          const iw = await sendTextMessage(phone, intro)
          await logOutbound(threadId, iw, intro)
        }
        const title = (p.app_title?.trim() || p.item_name || 'Jewellery')
        const specs = [p.weight != null ? `${p.weight} g` : null, p.purity || null].filter(Boolean).join(' · ')
        const caption = `✨ *${title}*${specs ? `\n${specs}` : ''}\n👉 View & enquire: ${APP_LINKS.product(p.id)}`
        const wamid = await sendImageMessage(phone, url, caption)
        await logOutbound(threadId, wamid, `📷 ${title}`)
        sent++
      }
    }
  } catch (err) {
    console.error('[webhook] suggestProducts failed (non-fatal):', err)
  }
  // Close honestly: cards → browse the full collection on the shop page; a specific
  // ask we couldn't match → say the team will share those designs (never a random piece).
  const label = wantCat ? `${wantCat} ` : ''
  const line = sent > 0
    ? `Browse our complete collection on the app 👉 ${APP_LINKS.shop()}`
    : `Our team will share ${label}designs with you shortly 🙏 Browse our complete collection 👉 ${APP_LINKS.shop()}`
  const wamid = await sendTextMessage(phone, line)
  await logOutbound(threadId, wamid, line)
  return sent
}

// Answer a product enquiry with the live, itemised price. The app's "Enquire on
// WhatsApp" / Share button already sends the piece's /product/<id> link; customers
// may also type a design code (MN000123). We look each up in OUR catalogue (source
// of truth — never trust weights pasted in the message), compute the breakup from
// today's rate, and reply instantly. The human handoff still fires in the
// background so staff can confirm/close. Bot stays active (no with_agent) so the
// customer can keep asking.
async function handleProductEnquiry(
  phone: string,
  threadId: string,
  customer: { id: string } | null,
  text: string,
) {
  const { ids, codes } = extractProductRefs(text)
  // Background capture — same bookkeeping as an app product-interest tap.
  await markAppProductInterest(phone).catch(() => {})
  await tagTopic(customer?.id, '%app product interest%')
  await recordLead(threadId, customer?.id, { intent: 'price_enquiry' })
  await flagAgent(threadId) // human follow-up stays in the background

  type Row = { id: string; item_name: string | null; app_title: string | null; weight: number | null; purity: string | null; making_percent: number | null; design_code: string | null }
  const cols = 'id, item_name, app_title, weight, purity, making_percent, design_code'
  const found = new Map<string, Row>()
  try {
    const [byId, byCode, rateRow] = await Promise.all([
      ids.length
        ? supabaseAdmin.from('wa_products').select(cols).eq('show_in_app', true).in('id', ids)
        : Promise.resolve({ data: [] as Row[] }),
      codes.length
        ? supabaseAdmin.from('wa_products').select(cols).eq('show_in_app', true).in('design_code', codes)
        : Promise.resolve({ data: [] as Row[] }),
      supabaseAdmin.from('daily_rates')
        .select('rate_24kt, rate_22kt, rate_18kt').eq('date', new Date().toLocaleDateString('en-CA')).maybeSingle(),
    ])
    for (const r of ((byId.data ?? []) as Row[])) found.set(r.id, r)
    for (const r of ((byCode.data ?? []) as Row[])) found.set(r.id, r)
    const rates = (rateRow.data as DailyRates | null) ?? null
    const rows = [...found.values()]

    if (rows.length === 0) {
      // We recognised a link/code but don't have that (published) piece — hand off.
      const line = `Thank you! 🙏 Let me get our team to share the price for this piece right away. Meanwhile, explore more 👉 ${APP_LINKS.shop()}`
      const wamid = await sendTextMessage(phone, line)
      await logOutbound(threadId, wamid, line)
      return
    }

    if (rows.length === 1) {
      const p = rows[0]
      const b = computeBreakup(p, rates)
      const title = (p.app_title?.trim() || p.item_name || 'This piece')
      const specs = [p.weight != null ? `${p.weight} g` : null, p.purity || null].filter(Boolean).join(' · ')
      let body: string
      if (b.hidden) {
        body =
          `✨ *${title}*${specs ? `\n${specs}` : ''}\n\n` +
          `This piece is *price on request* 🙏 Our team will share the exact price with you shortly.`
      } else {
        body =
          `✨ *${title}*${specs ? `\n${specs}` : ''}\n\n` +
          `Metal: ${inr(b.metal)}\n` +
          `Making: ${inr(b.making)}\n` +
          `HUID: ${inr(b.huid)}\n` +
          `GST (3%): ${inr(b.gst)}\n` +
          `*Total (indicative): ${inr(b.total)}*\n\n` +
          `👉 View & save: ${APP_LINKS.product(p.id)}\n\n` +
          `_Indicative price at today's rate; final price is confirmed in-store._`
      }
      const wamid = await sendTextMessage(phone, body)
      await logOutbound(threadId, wamid, body)
    } else {
      // Multiple pieces — a line each + grand total of the priceable ones.
      const lines: string[] = ['Here is the indicative pricing 🙏']
      let grand = 0
      let anyPriced = false
      rows.forEach((p, i) => {
        const b = computeBreakup(p, rates)
        const title = (p.app_title?.trim() || p.item_name || 'Piece')
        if (b.hidden) {
          lines.push(`${i + 1}) ${title} — price on request`)
        } else {
          anyPriced = true
          grand += b.total
          lines.push(`${i + 1}) ${title} — *${inr(b.total)}*`)
        }
      })
      if (anyPriced) lines.push(`\n*Grand total (indicative): ${inr(grand)}*`)
      lines.push(`\n_Indicative at today's rate; final price confirmed in-store._`)
      const body = lines.join('\n')
      const wamid = await sendTextMessage(phone, body)
      await logOutbound(threadId, wamid, body)
    }

    // After pricing, suggest more designs of the SAME item type + metal (excluding
    // the piece[s] they enquired about) — "customer showed interest → show similar".
    const primary = rows[0]
    await suggestProducts(phone, threadId, {
      categoryName: primary.item_name,
      metal: productMetal(primary),
      excludeIds: rows.map(r => r.id),
      intro: 'You may also like these designs 👇',
    })
  } catch (err) {
    console.error('[webhook] handleProductEnquiry failed:', err)
    const line = `Thank you! 🙏 Our team will share the price for this piece shortly.`
    const wamid = await sendTextMessage(phone, line)
    await logOutbound(threadId, wamid, line)
  }
}

// ---------------------------------------------------------------------------
// The engagement flow (built around 4 real customer needs)
// ---------------------------------------------------------------------------

// Welcome screen — 2 big buttons + "More options". Tapping "More options"
// reveals the full list (rate, offers, new designs, gold savings scheme,
// talk to our team).
async function sendWelcomeMenu(phone: string, threadId: string) {
  const [{ content }, notice] = await Promise.all([getBotMessage('welcome'), getBotMessage('stop_notice')])
  // Append the opt-out line in italics (WhatsApp's lightest styling)
  const body = notice.content ? `${content}\n\n_${notice.content}_` : content
  const wamid = await sendInteractiveButtons(phone, body, [
    { id: 'i:rate',   title: "Today's Rate" },
    { id: 'i:offers', title: 'Offers & Sale' },
    { id: 'i:more',   title: 'More options' },
  ])
  await logOutbound(threadId, wamid, body)
}

// STOP → flag Do-Not-Disturb, opt out of broadcasts, confirm once
async function handleStop(phone: string, threadId: string, customer: { id: string; dnd?: boolean } | null) {
  if (customer?.dnd) return // already opted out — stay silent
  // wa_049: write the ONE flag. It mirrors down to wa_customers, so this also
  // works for a STOP from someone we have no customer row for yet — the old
  // code only recorded the opt-out if `customer.id` existed, and silently
  // dropped it otherwise.
  await setOptOut(phone, true, 'chat_stop')
  await sendBot(phone, threadId, 'stop_ack')
}

// START → clear the opt-out and re-engage
async function handleResume(phone: string, threadId: string, customer: { id: string } | null) {
  await setOptOut(phone, false, 'chat_stop')
  await setBotState(threadId, 'active')
  await sendWelcomeMenu(phone, threadId)
}

// The full option list, shown when the customer taps "More options"
async function sendMoreOptions(phone: string, threadId: string) {
  const { content } = await getBotMessage('more_options')
  const wamid = await sendInteractiveList(phone, content, 'View Options', [
    { id: 'i:rate',    title: "Today's Gold Rate" },
    { id: 'i:offers',  title: 'Offers & Sale' },
    { id: 'i:designs', title: 'New Designs' },
    { id: 'i:scheme',  title: 'Gold Savings Scheme' },
    { id: 'care',      title: 'Talk to our team' },
    { id: 'stop',      title: 'Stop receiving msgs' },
  ])
  await logOutbound(threadId, wamid, content)
}

// App product interest — customer tapped "interested" / shared a product link.
// Raise the one feature flag (contacts.app_product_interest, wa_053 → the feature
// view → every rule/chip audience), log it as a lead, hand to a human so someone
// follows up with details, and acknowledge. The phone is already in the customer
// book — every inbound auto-enrols above.
async function handleAppProductInterest(
  phone: string,
  threadId: string,
  customer: { id: string } | null,
) {
  await markAppProductInterest(phone)
  // Tag the "App Product Interest" topic (wa_056) — same path as offers/designs:
  // writes wa_customer_interests + mirrors into wa_signals (key 'app_interest'),
  // so these customers show in the chat "Interested in" banner and are targetable
  // in Reach. No-ops safely until the wa_056 topic exists.
  await tagTopic(customer?.id, '%app product interest%')
  await recordLead(threadId, customer?.id, { intent: 'app_product' })
  await flagAgent(threadId)                       // "we will contact you with more details"
  await sendBotWithCta(phone, threadId, 'app_interest_ack', `See more like it 👉 ${APP_LINKS.shop()}`)
}

// PIN reset — only the store can reset a PIN (security), so a human handles it.
// Warmly acknowledge and explain what happens next, then hand over (with_agent
// silences the bot so staff can take it from here without being talked over).
async function handlePinReset(phone: string, threadId: string, customer: { id: string } | null) {
  await recordLead(threadId, customer?.id, { intent: 'pin_reset' })
  await flagAgent(threadId)
  await setBotState(threadId, 'with_agent')
  await sendBot(phone, threadId, 'pin_reset_ack')
}

// A question about an existing purchase (e.g. from the Bill Summary "Contact us").
// Ack and hand to a human so they can answer the specific question.
async function handlePurchaseQuery(phone: string, threadId: string, customer: { id: string } | null) {
  await recordLead(threadId, customer?.id, { intent: 'purchase_query' })
  await flagAgent(threadId)
  await setBotState(threadId, 'with_agent')
  await sendBot(phone, threadId, 'purchase_query_ack')
}

// A price/cost enquiry: send today's rate as an anchor, then the self-serve tools
// (calculator + shop) and an invite to share a photo so staff can quote a piece.
async function handlePriceQuery(
  phone: string,
  threadId: string,
  displayName: string,
  customer: { id: string } | null,
) {
  await handleAutoReply(phone, threadId, displayName) // today's rate (template or text)
  await recordLead(threadId, customer?.id, { intent: 'price_query' })
  const line =
    `A piece's final price depends on its weight & making. 🙏\n` +
    `• Estimate any piece 👉 ${APP_LINKS.calculator()}\n` +
    `• Browse pieces with live prices 👉 ${APP_LINKS.shop()}\n\n` +
    `Or reply with a photo of the design you like and our team will share the exact price.`
  const wamid = await sendTextMessage(phone, line)
  await logOutbound(threadId, wamid, line)
  await flagAgent(threadId)
}

// Anything we didn't recognise. A message that reads like a real question is
// handed to a human (so it isn't lost) with a self-serve nudge; a short/stray
// message just gets the menu. Replaces the old "always re-show the menu".
async function handleFallback(phone: string, threadId: string, text: string) {
  const looksLikeQuestion = text.includes('?') || text.trim().split(/\s+/).filter(Boolean).length >= 6
  if (looksLikeQuestion) {
    await flagAgent(threadId)
    await sendBotWithCta(phone, threadId, 'care_ack', `Meanwhile, explore our collection 👉 ${APP_LINKS.shop()}`)
  } else {
    await sendWelcomeMenu(phone, threadId)
  }
}

// Gold Savings Scheme — note the interest and hand to a representative
async function handleScheme(phone: string, threadId: string, customer: { id: string } | null) {
  if (customer?.id) {
    const schemeTopic = await findTopicId('%scheme%')
    if (schemeTopic) await addInterest(customer.id, schemeTopic)
  }
  await recordLead(threadId, customer?.id, { intent: 'scheme' })
  await flagAgent(threadId)                  // representative will reach out
  await sendBotWithCta(phone, threadId, 'scheme_info', `Learn more & get started 👉 ${APP_LINKS.scheme()}`)
}

// Today's rate, then one gentle follow-up with the next options
async function sendRate(phone: string, threadId: string, displayName: string) {
  await handleAutoReply(phone, threadId, displayName) // sends today's rate (template or text)
  const { content } = await getBotMessage('rate_outro')
  const body = `${content}\n\nSee live rates anytime 👉 ${APP_LINKS.rate()}`
  const wamid = await sendInteractiveButtons(phone, body, [
    { id: 'i:offers',  title: 'Offers & Sale' },
    { id: 'i:designs', title: 'New Designs' },
    { id: 'care',      title: 'Talk to our team' },
  ])
  await logOutbound(threadId, wamid, body)
}

// "Offers & Sale" → two choices: Offers, or Gold Exchange / Cash
async function sendOffersMenu(phone: string, threadId: string) {
  const { content } = await getBotMessage('offers_menu')
  const wamid = await sendInteractiveButtons(phone, content, [
    { id: 'o:offers', title: 'Offers' },
    { id: 'o:exmenu', title: 'Gold Exchange/Cash' },
    { id: 'care',     title: 'Talk to our team' },
  ])
  await logOutbound(threadId, wamid, content)
}

// "Gold Exchange/Cash" → two choices: Gold Exchange, or Instant Cash
async function sendExchangeMenu(phone: string, threadId: string) {
  const { content } = await getBotMessage('exchange_menu')
  const wamid = await sendInteractiveButtons(phone, content, [
    { id: 'o:exchange', title: 'Gold Exchange' },
    { id: 'o:cash',     title: 'Instant Cash' },
    { id: 'care',       title: 'Talk to our team' },
  ])
  await logOutbound(threadId, wamid, content)
}

// Tag the most specific topic for a choice (keeps the Send module in sync)
async function tagTopic(customerId: string | undefined, namePattern: string) {
  if (!customerId) return
  const id = await findTopicId(namePattern)
  if (id) await addInterest(customerId, id)
}

async function sendOffer(phone: string, threadId: string, customer: { id: string } | null) {
  await tagTopic(customer?.id, '%discount%')   // "Sale & Discounts"
  await recordLead(threadId, customer?.id, { intent: 'offer' })
  await sendBotWithCta(phone, threadId, 'offer', `See our latest collection 👉 ${APP_LINKS.shop()}`)
}

async function sendExchangeInfo(phone: string, threadId: string, customer: { id: string } | null) {
  await tagTopic(customer?.id, '%exchange%')   // "Gold Exchange"
  await recordLead(threadId, customer?.id, { intent: 'exchange' })
  await flagAgent(threadId)
  await sendBotWithCta(phone, threadId, 'exchange_info', `Estimate your gold's value 👉 ${APP_LINKS.calculator()}`)
}

async function sendCashInfo(phone: string, threadId: string, customer: { id: string } | null) {
  await tagTopic(customer?.id, '%cash%')       // "Instant Cash"
  await recordLead(threadId, customer?.id, { intent: 'cash' })
  await flagAgent(threadId)
  await sendBotWithCta(phone, threadId, 'cash_info', `Estimate your gold's value 👉 ${APP_LINKS.calculator()}`)
}

// Ask metal (gold / silver / diamond) — 3 buttons, carries the intent forward
async function sendMetalStep(phone: string, threadId: string, intent: 'offers' | 'designs') {
  const { content } = await getBotMessage('ask_metal')
  const wamid = await sendInteractiveButtons(phone, content, [
    { id: `mt:${intent}:gold`,    title: 'Gold' },
    { id: `mt:${intent}:silver`,  title: 'Silver' },
    { id: `mt:${intent}:diamond`, title: 'Diamond' },
  ])
  await logOutbound(threadId, wamid, content)
}

// Ask which product — list of jewellery items + a "Talk to our team" row
async function sendProductStep(phone: string, threadId: string, intent: string, metal: string) {
  const subs = await getDesignSubtopics()
  const rows = subs.map(s => ({ id: `pr:${intent}:${metal}:${s.id}`, title: s.name }))
  rows.push({ id: 'care', title: 'Talk to our team' })
  const { content } = await getBotMessage('ask_product')
  const wamid = await sendInteractiveList(phone, content, 'View Items', rows)
  await logOutbound(threadId, wamid, content)
}

// They picked an item type — send matching designs straight away (no "shall we
// send designs?" step). Tags interests, records the lead, flags a rep for curated
// follow-up, then sends pieces matched to that category + metal.
async function sendDesignsNow(phone: string, threadId: string, customer: { id: string } | null, intent: string, metal: string, topicId: string) {
  let categoryName: string | null = null
  if (topicId) {
    const { data: t } = await supabaseAdmin.from('wa_interest_topics').select('name').eq('id', topicId).maybeSingle()
    categoryName = (t?.name as string | undefined) ?? null
  }
  // Tag interests so the customer flows into the right broadcasts.
  if (customer?.id) {
    const newDesigns = await findTopicId('%new design%')
    if (newDesigns) await addInterest(customer.id, newDesigns)
    if (topicId)    await addInterest(customer.id, topicId)
  }
  await recordLead(threadId, customer?.id, { intent, metal, product_topic_id: topicId, wants_designs: true })
  await flagAgent(threadId) // salesman still follows up with curated pictures
  const m = (metal === 'gold' || metal === 'silver' || metal === 'diamond') ? metal : null
  await suggestProducts(phone, threadId, { categoryName, metal: m, intro: 'Here are a few designs you may love 💛' })
}

async function sendCarePrompt(phone: string, threadId: string) {
  await sendBot(phone, threadId, 'care_prompt')
  await setBotState(threadId, 'awaiting_care')
  await flagAgent(threadId)
}

async function handleCareQuestion(phone: string, threadId: string) {
  // The customer just typed their question (already stored). Ack once, hand to human.
  await setBotState(threadId, 'with_agent')
  await flagAgent(threadId)
  await sendBot(phone, threadId, 'care_ack')
}

// Route a button/menu tap through the flow
async function handleFlowReply(
  phone: string,
  threadId: string,
  replyId: string,
  customer: { id: string; name: string } | null,
  displayName: string
) {
  if (replyId === 'care') {
    await sendCarePrompt(phone, threadId)
    return
  }
  if (replyId === 'stop') {
    await handleStop(phone, threadId, customer)
    return
  }
  if (replyId === 'i:more') {
    await sendMoreOptions(phone, threadId)
    return
  }
  if (replyId === 'i:scheme') {
    await handleScheme(phone, threadId, customer)
    return
  }
  if (replyId === 'i:rate') {
    await ensureRateInterest(customer?.id)
    await sendRate(phone, threadId, displayName)
    return
  }
  if (replyId === 'i:offers') {
    await sendOffersMenu(phone, threadId)
    return
  }
  if (replyId === 'o:offers') {
    await sendOffer(phone, threadId, customer)
    return
  }
  if (replyId === 'o:exmenu') {
    await sendExchangeMenu(phone, threadId)
    return
  }
  if (replyId === 'o:exchange') {
    await sendExchangeInfo(phone, threadId, customer)
    return
  }
  if (replyId === 'o:cash') {
    await sendCashInfo(phone, threadId, customer)
    return
  }
  if (replyId === 'i:designs') {
    await sendMetalStep(phone, threadId, 'designs')
    return
  }
  if (replyId.startsWith('mt:')) {
    const [, intent, metal] = replyId.split(':')
    await sendProductStep(phone, threadId, intent, metal)
    return
  }
  if (replyId.startsWith('pr:')) {
    const [, intent, metal, topicId] = replyId.split(':')
    await sendDesignsNow(phone, threadId, customer, intent, metal, topicId)
    return
  }
}

async function fetchAndStoreInboundMedia(mediaId: string, mimeType: string): Promise<string> {
  const { url } = await getMediaDownloadUrl(mediaId)
  const { buffer, contentType } = await downloadMediaBuffer(url)

  const ext      = mimeType.split('/')[1]?.split(';')[0] || 'jpg'
  const filename = `inbound/${Date.now()}-${mediaId}.${ext}`

  const { data, error } = await supabaseAdmin.storage
    .from('wa-media')
    .upload(filename, buffer, { contentType, upsert: false })

  if (error || !data) throw new Error(error?.message ?? 'Storage upload failed')

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('wa-media')
    .getPublicUrl(data.path)

  return publicUrl
}

async function getRateTemplate() {
  if (cachedRateTemplate && Date.now() < cacheExpiresAt) return cachedRateTemplate

  const TEMPLATE_COLS = 'id, name, body_text, meta_template_name, meta_template_lang, meta_variables, header_type, header_image_url'

  // Topic lookup and a broad name-based fallback query run in parallel
  const [{ data: topic }, { data: nameMatch }] = await Promise.all([
    supabaseAdmin
      .from('wa_interest_topics')
      .select('id')
      .ilike('name', '%rate%')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('wa_message_templates')
      .select(TEMPLATE_COLS)
      .ilike('name', '%rate%')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
  ])

  let template = null
  if (topic) {
    const { data } = await supabaseAdmin
      .from('wa_message_templates')
      .select(TEMPLATE_COLS)
      .eq('topic_id', topic.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    template = data
  }
  template = template ?? nameMatch

  if (template) {
    console.log('[webhook] Rate template resolved:', template.name)
    cachedRateTemplate = template
    cacheExpiresAt = Date.now() + 60 * 60 * 1000 // 1 hour
  } else {
    console.warn('[webhook] No rate template found — check Templates tab')
  }

  return template
}

async function handleAutoReply(phone: string, threadId: string, customerName: string) {
  // Template (cached) and today's rates fetched in parallel
  const todayStr = new Date().toLocaleDateString('en-CA')
  const [template, { data: rates }] = await Promise.all([
    getRateTemplate(),
    supabaseAdmin
      .from('daily_rates')
      .select('rate_24kt, rate_22kt, rate_18kt')
      .eq('date', todayStr)
      .maybeSingle(),
  ])

  if (!template) {
    console.warn('[webhook] Auto-reply: no rate template found')
    return
  }

  const messageBody = applyPlaceholders(template.body_text, customerName, rates)

  let wamid: string

  if (template.meta_template_name) {
    // Use Meta-approved template — works outside the 24h window
    const variables = (template.meta_variables as string[] | null) ?? []
    const parameters = variables.map(varName => {
      const v = varName.toLowerCase()
      if (v === 'name') return { type: 'text', parameter_name: 'customer_name', text: customerName }
      if (v === 'rate_24kt') return { type: 'text', text: rates?.rate_24kt != null ? String(rates.rate_24kt) : '—' }
      if (v === 'rate_22kt') return { type: 'text', text: rates?.rate_22kt != null ? String(rates.rate_22kt) : '—' }
      if (v === 'rate_18kt') return { type: 'text', text: rates?.rate_18kt != null ? String(rates.rate_18kt) : '—' }
      return { type: 'text', text: '' }
    })

    const components: object[] = []
    if (template.header_type === 'image' && template.header_image_url) {
      components.push({
        type: 'header',
        parameters: [{ type: 'image', image: { link: template.header_image_url } }],
      })
    }
    if (parameters.length) components.push({ type: 'body', parameters })

    wamid = await sendTemplateMessage(
      phone,
      template.meta_template_name,
      template.meta_template_lang ?? 'en',
      components
    )
  } else {
    // Fallback: free-form text (only works within 24h customer reply window)
    wamid = await sendTextMessage(phone, messageBody)
  }

  const now = new Date().toISOString()

  // Log outbound message and update thread in parallel
  await Promise.all([
    supabaseAdmin.from('wa_messages').insert({
      thread_id:     threadId,
      direction:     'outbound',
      wa_message_id: wamid,
      body:          messageBody,
      template_name: template.name,
      status:        'sent',
      sent_at:       new Date().toISOString(),
    }),
    supabaseAdmin
      .from('wa_threads')
      .update({ last_message_at: now, last_message_preview: messageBody.slice(0, 60) })
      .eq('id', threadId),
  ])
}

// Status rank — used so a late 'delivered' callback can't overwrite a 'read'.
const STATUS_RANK: Record<string, number> = {
  queued: 0, sent: 1, delivered: 2, read: 3, failed: 3, received: 3,
}

async function handleStatusUpdate(status: WaStatusUpdate) {
  const ts = new Date(parseInt(status.timestamp) * 1000).toISOString()

  // Pull the Meta error (failed statuses only). The numeric code is the reliable
  // signal; title/details give the salesman more context.
  const err = status.errors?.[0]
  const errorCode    = err?.code ?? null
  const errorTitle   = err?.title ?? null
  const errorDetails = err?.error_data?.details ?? err?.message ?? null

  // Find the message this status belongs to (and its current status, to avoid
  // downgrading read → delivered when callbacks arrive out of order).
  const { data: msg } = await supabaseAdmin
    .from('wa_messages')
    .select('id, status')
    .eq('wa_message_id', status.id)
    .maybeSingle()

  // 1. Always append to the full event log.
  await supabaseAdmin.from('wa_message_events').insert({
    message_id:    msg?.id ?? null,
    wa_message_id: status.id,
    status:        status.status,
    error_code:    errorCode,
    error_title:   errorTitle,
    error_details: errorDetails,
    event_at:      ts,
    raw:           status,
  })

  if (!msg) {
    console.warn('[webhook] Status for unknown message', status.id)
    return
  }

  // 2. Update the message row's latest state.
  const updates: Record<string, unknown> = {}
  const newRank = STATUS_RANK[status.status] ?? 0
  const curRank = STATUS_RANK[msg.status] ?? 0
  if (newRank >= curRank) updates.status = status.status

  if (status.status === 'sent')      updates.sent_at      = ts
  if (status.status === 'delivered') updates.delivered_at = ts
  if (status.status === 'read')      updates.read_at      = ts
  if (status.status === 'failed') {
    updates.failed_reason = err?.message ?? 'Unknown error'
    updates.error_code    = errorCode
    updates.error_title   = errorTitle
    updates.error_details = errorDetails
  }

  if (Object.keys(updates).length === 0) return

  const { error } = await supabaseAdmin
    .from('wa_messages')
    .update(updates)
    .eq('id', msg.id)

  if (error) console.error('[webhook] Failed to update status:', error)
}

// ---------------------------------------------------------------------------
// Types (webhook payload shapes)
// ---------------------------------------------------------------------------
interface WhatsAppWebhookPayload {
  object: string
  entry: Array<{
    id: string
    changes: Array<{
      field: string
      value: WaChangeValue
    }>
  }>
}

interface WaChangeValue {
  messaging_product: string
  metadata: { display_phone_number: string; phone_number_id: string }
  contacts?: WaContact[]
  messages?: WaInboundMessage[]
  statuses?: WaStatusUpdate[]
}

interface WaContact {
  profile: { name: string }
  wa_id: string
}

interface WaInteractiveReply {
  id: string
  title: string
  description?: string
}

interface WaInboundMessage {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type?: string; caption?: string; sha256?: string }
  video?: { id: string; mime_type?: string; caption?: string; sha256?: string }
  document?: { id: string; mime_type?: string; caption?: string; filename?: string; sha256?: string }
  audio?: { id: string; mime_type?: string; voice?: boolean; sha256?: string }
  interactive?: {
    type: string
    list_reply?: WaInteractiveReply
    button_reply?: WaInteractiveReply
  }
  // On a quoted reply or a quick-reply button tap, WhatsApp echoes the wamid of
  // the message being replied to — the exact-attribution key for audience steps.
  context?: { id?: string }
}

interface WaStatusUpdate {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string
  recipient_id: string
  errors?: Array<{
    code: number
    title?: string
    message: string
    error_data?: { details?: string }
    href?: string
  }>
}
