import { NextRequest } from 'next/server'
import { verifySignature, sendTextMessage, sendTemplateMessage, sendInteractiveList, getMediaDownloadUrl, downloadMediaBuffer } from '@/lib/whatsapp/api'
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
    supabaseAdmin.from('wa_customers').select('id, name').eq('phone', phone).maybeSingle(),
    supabaseAdmin.from('wa_threads').select('id, customer_id').eq('phone', phone).maybeSingle(),
  ])

  // --- Auto-enroll: every inbound contact lands in the customer book ---
  let customer = existingCustomer as { id: string; name: string } | null
  if (!customer) {
    const { data: created, error: createErr } = await supabaseAdmin
      .from('wa_customers')
      .insert({
        name:         contactName ?? `WhatsApp ${phone.slice(-4)}`,
        phone,
        enrolled_via: 'whatsapp',
      })
      .select('id, name')
      .single()
    if (createErr) console.error('[webhook] Failed to auto-enroll customer:', createErr)
    customer = created ?? null
  } else if (contactName && customer.name?.startsWith('WhatsApp ')) {
    // We learned the real WhatsApp profile name — upgrade the placeholder
    await supabaseAdmin.from('wa_customers').update({ name: contactName }).eq('id', customer.id)
    customer = { ...customer, name: contactName }
  }

  const displayName = customer?.name ?? contactName ?? 'there'

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
  const text = msg.type === 'text' ? (body ?? '') : ''

  try {
    if (interactiveReply) {
      // Customer tapped a menu option
      await handleMenuSelection(phone, threadId, interactiveReply.id, customer, displayName)
    } else if (isRateKeyword(text)) {
      // "rate" / "bhav" → ensure Daily Rates interest, then send today's rate
      await ensureRateInterest(customer?.id)
      await handleAutoReply(phone, threadId, displayName)
    } else if (isGreeting(text) || !existingThread) {
      // A greeting, or a brand-new contact's first message → start the conversation
      await sendInterestMenu(phone, threadId, displayName)
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

async function getTopLevelTopics(): Promise<Array<{ id: string; name: string }>> {
  const { data } = await supabaseAdmin
    .from('wa_interest_topics')
    .select('id, name')
    .is('parent_id', null)
    .eq('is_active', true)
    .order('sort_order')
  return data ?? []
}

async function addInterest(customerId: string, topicId: string) {
  await supabaseAdmin
    .from('wa_customer_interests')
    .upsert({ customer_id: customerId, topic_id: topicId }, { onConflict: 'customer_id,topic_id', ignoreDuplicates: true })
}

async function ensureRateInterest(customerId?: string) {
  if (!customerId) return
  const { data: topic } = await supabaseAdmin
    .from('wa_interest_topics')
    .select('id')
    .ilike('name', '%rate%')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (topic) await addInterest(customerId, topic.id)
}

// Log an outbound message we sent ourselves (auto-reply / menu) and bump the thread
async function logOutbound(threadId: string, wamid: string, body: string) {
  const now = new Date().toISOString()
  await Promise.all([
    supabaseAdmin.from('wa_messages').insert({
      thread_id: threadId, direction: 'outbound', wa_message_id: wamid,
      body, status: 'sent',
    }),
    supabaseAdmin
      .from('wa_threads')
      .update({ last_message_at: now, last_message_preview: body.slice(0, 60) })
      .eq('id', threadId),
  ])
}

// Send the interactive "what are you interested in?" menu, built from real topics
async function sendInterestMenu(phone: string, threadId: string, name: string) {
  const topics = await getTopLevelTopics()
  const rows = topics.map(t => ({ id: `topic:${t.id}`, title: t.name }))
  rows.push({ id: 'more:salesman', title: 'Something else' })

  const bodyText =
    `Hello ${name}! 🙏 Welcome to M N Alankar Palace.\n\n` +
    `What are you looking for today? Tap "Choose" below to pick.`

  const wamid = await sendInteractiveList(phone, bodyText, 'Choose', rows, 'M N Alankar Palace')
  await logOutbound(threadId, wamid, bodyText)
}

// Handle a tap on the interest menu
async function handleMenuSelection(
  phone: string,
  threadId: string,
  replyId: string,
  customer: { id: string; name: string } | null,
  displayName: string
) {
  if (replyId === 'more:salesman') {
    const text = 'Thank you! 🙏 Our team will get back to you shortly to help you better.'
    const wamid = await sendTextMessage(phone, text)
    await logOutbound(threadId, wamid, text)
    return
  }

  if (!replyId.startsWith('topic:')) return
  const topicId = replyId.slice('topic:'.length)

  const { data: topic } = await supabaseAdmin
    .from('wa_interest_topics')
    .select('id, name')
    .eq('id', topicId)
    .maybeSingle()
  if (!topic) return

  if (customer?.id) await addInterest(customer.id, topic.id)

  if (/rate/i.test(topic.name)) {
    // Rate topic → educate on the shortcut, then send today's rate
    const tip = `Sure! 📈 You can get today's gold rate anytime — just send *rate*. Here is today's rate:`
    const wamid = await sendTextMessage(phone, tip)
    await logOutbound(threadId, wamid, tip)
    await handleAutoReply(phone, threadId, displayName)
  } else {
    const text =
      `Great choice! ✨ We've noted your interest in *${topic.name}*. ` +
      `Our team will share the latest ${topic.name} updates with you shortly. 😊`
    const wamid = await sendTextMessage(phone, text)
    await logOutbound(threadId, wamid, text)
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
    }),
    supabaseAdmin
      .from('wa_threads')
      .update({ last_message_at: now, last_message_preview: messageBody.slice(0, 60) })
      .eq('id', threadId),
  ])
}

async function handleStatusUpdate(status: WaStatusUpdate) {
  const updates: Record<string, string> = { status: status.status }

  const ts = new Date(parseInt(status.timestamp) * 1000).toISOString()
  if (status.status === 'delivered') updates.delivered_at = ts
  if (status.status === 'read')      updates.read_at      = ts
  if (status.status === 'failed')
    updates.failed_reason = status.errors?.[0]?.message ?? 'Unknown error'

  const { error } = await supabaseAdmin
    .from('wa_messages')
    .update(updates)
    .eq('wa_message_id', status.id)

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
  errors?: Array<{ message: string; code: number }>
}
