import { NextRequest } from 'next/server'
import { verifySignature, sendTextMessage, sendImageMessage, sendTemplateMessage, sendInteractiveList, sendInteractiveButtons, getMediaDownloadUrl, downloadMediaBuffer } from '@/lib/whatsapp/api'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { applyPlaceholders } from '@/lib/utils'

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
    : interactiveReply           ? interactiveReply.title
    : `[${msg.type} message]`

  const messageType =
    msg.type === 'text'        ? 'text'
    : msg.type === 'image'       ? 'image'
    : msg.type === 'interactive' ? 'text'
    : 'other'

  const contactName =
    contacts.find(c => c.wa_id === rawPhone)?.profile?.name ?? null

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

  // For inbound images, download from Meta and store in Supabase Storage
  let mediaUrl: string | null = null
  if (msg.type === 'image' && msg.image?.id) {
    mediaUrl = await fetchAndStoreInboundMedia(msg.image.id, msg.image.mime_type ?? 'image/jpeg')
      .catch(err => { console.error('[webhook] Media store error:', err); return null })
  }

  const preview = messageType === 'image'
    ? ('📷 Photo' + (body ? `: ${body.slice(0, 40)}` : ''))
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
    } else if (interactiveReply) {
      // An explicit button/menu tap — always honour it
      await handleFlowReply(phone, threadId, interactiveReply.id, customer, displayName)
    } else if (botState === 'awaiting_care') {
      // We asked them to type their question — this message is it. Hand to a human.
      await handleCareQuestion(phone, threadId)
    } else if (isGreeting(text)) {
      await sendWelcomeMenu(phone, threadId)
    } else if (isRateKeyword(text)) {
      await ensureRateInterest(customer?.id)
      await sendRate(phone, threadId, displayName)
    } else if (isOffersKeyword(text)) {
      await sendOffersMenu(phone, threadId)
    } else if (isSchemeKeyword(text)) {
      await handleScheme(phone, threadId, customer)
    } else if (isDesignKeyword(text)) {
      await sendMetalStep(phone, threadId, 'designs')
    } else {
      // Anything else (random text, an emoji, a photo) — always respond by
      // showing the menu so the customer is never left without a reply.
      await sendWelcomeMenu(phone, threadId)
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
  return /\b(rate|rates|bhav|bhaav|gold rate|todays? rate)\b/.test(t)
}

function isOffersKeyword(raw: string): boolean {
  return /\b(offer|offers|sale|discount|deal|deals)\b/.test(raw.trim().toLowerCase())
}

function isSchemeKeyword(raw: string): boolean {
  return /\b(scheme|schemes|saving|savings|sip|gold scheme|gold savings)\b/.test(raw.trim().toLowerCase())
}

function isStopKeyword(raw: string): boolean {
  return /^(stop|unsubscribe|stop messages?)\b/.test(raw.trim().toLowerCase())
}

function isStartKeyword(raw: string): boolean {
  return /^(start|resume|subscribe)\b/.test(raw.trim().toLowerCase())
}

function isDesignKeyword(raw: string): boolean {
  return /\b(design|designs|new design|necklace|ring|bangle|earring|chain|mangalsutra|pendant)\b/.test(raw.trim().toLowerCase())
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
  rate_outro:  'Would you like to see anything else?',
  ask_metal:   'Which are you interested in?',
  ask_product: 'Which item would you like to see?',
  ask_designs: 'Shall we send you a few designs?',
  designs_ack: 'Thank you! 🙏 Our team will send you a few designs shortly.',
  care_prompt: 'Please type your question below. 🙏 Our team will reply to you shortly.',
  care_ack:    'Thank you! 🙏 Our team will reply to you shortly.',
  closing:     'Okay! 🙏 If you need anything, just message us anytime.',
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
  if (customer?.id) {
    await supabaseAdmin.from('wa_customers')
      .update({ dnd: true, is_opted_out: true, opted_out_at: new Date().toISOString() })
      .eq('id', customer.id)
  }
  await sendBot(phone, threadId, 'stop_ack')
}

// START → clear DnD and re-engage
async function handleResume(phone: string, threadId: string, customer: { id: string } | null) {
  if (customer?.id) {
    await supabaseAdmin.from('wa_customers')
      .update({ dnd: false, is_opted_out: false, opted_out_at: null })
      .eq('id', customer.id)
  }
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

// Gold Savings Scheme — note the interest and hand to a representative
async function handleScheme(phone: string, threadId: string, customer: { id: string } | null) {
  if (customer?.id) {
    const schemeTopic = await findTopicId('%scheme%')
    if (schemeTopic) await addInterest(customer.id, schemeTopic)
  }
  await recordLead(threadId, customer?.id, { intent: 'scheme' })
  await flagAgent(threadId)                  // representative will reach out
  await sendBot(phone, threadId, 'scheme_info') // editable text + optional image
}

// Today's rate, then one gentle follow-up with the next options
async function sendRate(phone: string, threadId: string, displayName: string) {
  await handleAutoReply(phone, threadId, displayName) // sends today's rate (template or text)
  const { content } = await getBotMessage('rate_outro')
  const wamid = await sendInteractiveButtons(phone, content, [
    { id: 'i:offers',  title: 'Offers & Sale' },
    { id: 'i:designs', title: 'New Designs' },
    { id: 'care',      title: 'Talk to our team' },
  ])
  await logOutbound(threadId, wamid, content)
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
  await sendBot(phone, threadId, 'offer') // owner's offer message (text and/or image)
}

async function sendExchangeInfo(phone: string, threadId: string, customer: { id: string } | null) {
  await tagTopic(customer?.id, '%exchange%')   // "Gold Exchange"
  await recordLead(threadId, customer?.id, { intent: 'exchange' })
  await flagAgent(threadId)
  await sendBot(phone, threadId, 'exchange_info')
}

async function sendCashInfo(phone: string, threadId: string, customer: { id: string } | null) {
  await tagTopic(customer?.id, '%cash%')       // "Instant Cash"
  await recordLead(threadId, customer?.id, { intent: 'cash' })
  await flagAgent(threadId)
  await sendBot(phone, threadId, 'cash_info')
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

// Ask if they want designs sent — yes / no / talk to team
async function sendDesignsStep(phone: string, threadId: string, intent: string, metal: string, topicId: string) {
  const { content } = await getBotMessage('ask_designs')
  const wamid = await sendInteractiveButtons(phone, content, [
    { id: `dz:${intent}:${metal}:${topicId}:yes`, title: 'Yes, please' },
    { id: `dz:${intent}:${metal}:${topicId}:no`,  title: 'No, thank you' },
    { id: 'care',                                  title: 'Talk to our team' },
  ])
  await logOutbound(threadId, wamid, content)
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
    await sendDesignsStep(phone, threadId, intent, metal, topicId)
    return
  }
  if (replyId.startsWith('dz:')) {
    const [, intent, metal, topicId, ans] = replyId.split(':')
    await handleDesignsAnswer(phone, threadId, customer, intent, metal, topicId, ans === 'yes')
    return
  }
}

async function handleDesignsAnswer(
  phone: string,
  threadId: string,
  customer: { id: string } | null,
  intent: string,
  metal: string,
  topicId: string,
  wantsDesigns: boolean
) {
  // Tag interests so the customer flows into the right broadcasts
  if (customer?.id) {
    const newDesigns = await findTopicId('%new design%')
    if (newDesigns) await addInterest(customer.id, newDesigns)
    if (topicId)    await addInterest(customer.id, topicId)
  }

  await recordLead(threadId, customer?.id, { intent, metal, product_topic_id: topicId, wants_designs: wantsDesigns })

  if (wantsDesigns) {
    await flagAgent(threadId) // salesman will send the actual design pictures
    await sendBot(phone, threadId, 'designs_ack')
  } else {
    await sendBot(phone, threadId, 'closing')
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
  interactive?: {
    type: string
    list_reply?: WaInteractiveReply
    button_reply?: WaInteractiveReply
  }
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
