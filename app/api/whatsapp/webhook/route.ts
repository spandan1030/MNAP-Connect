import { NextRequest } from 'next/server'
import { verifySignature, sendTextMessage } from '@/lib/whatsapp/api'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { applyPlaceholders } from '@/lib/utils'

// Module-level cache for the rate template — avoids 2 DB round trips on warm instances.
// Expires after 1 hour so template edits eventually take effect.
let cachedRateTemplate: { body_text: string; name: string; id: string } | null = null
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
// Always return 200 immediately. Meta retries if it doesn't get 200 within 20s.
// Process events asynchronously after responding.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const rawBody  = await req.text()
  const sigHeader = req.headers.get('x-hub-signature-256') ?? ''

  // Verify signature — reject spoofed requests
  if (!verifySignature(rawBody, sigHeader)) {
    console.error('[webhook] Invalid signature — request rejected')
    // Still return 200 so Meta doesn't flood retries for a misconfigured secret
    return Response.json({ status: 'ok' })
  }

  let payload: WhatsAppWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return Response.json({ status: 'ok' })
  }

  // Process async — do NOT await (return 200 first)
  handlePayload(payload).catch(err =>
    console.error('[webhook] Processing error:', err)
  )

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

  const body =
    msg.type === 'text'
      ? msg.text?.body ?? ''
      : `[${msg.type} message]`

  const contactName =
    contacts.find(c => c.wa_id === rawPhone)?.profile?.name ?? null

  // Customer lookup and thread lookup are independent — run in parallel
  const [{ data: customer }, { data: existingThread }] = await Promise.all([
    supabaseAdmin.from('wa_customers').select('id, name').eq('phone', phone).maybeSingle(),
    supabaseAdmin.from('wa_threads').select('id').eq('phone', phone).maybeSingle(),
  ])

  let threadId: string
  const now = new Date().toISOString()

  if (existingThread) {
    threadId = existingThread.id
    // Update thread and insert inbound message in parallel
    await Promise.all([
      supabaseAdmin
        .from('wa_threads')
        .update({ last_message_at: now, last_message_preview: body.slice(0, 60) })
        .eq('id', threadId),
      supabaseAdmin.from('wa_messages').insert({
        thread_id: threadId, direction: 'inbound',
        wa_message_id: msg.id, body, status: 'received',
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
        last_message_preview: body.slice(0, 60),
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
      wa_message_id: msg.id, body, status: 'received',
    })
  }

  // Auto-reply if message contains "rate"
  if (msg.type === 'text' && body.toLowerCase().includes('rate')) {
    const customerName = customer?.name ?? contactName ?? 'there'
    await handleAutoReply(phone, threadId, customerName).catch(err =>
      console.error('[webhook] Auto-reply error:', err)
    )
  }
}

async function getRateTemplate() {
  if (cachedRateTemplate && Date.now() < cacheExpiresAt) return cachedRateTemplate

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
      .select('id, name, body_text')
      .ilike('name', '%rate%')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
  ])

  let template = null
  if (topic) {
    const { data } = await supabaseAdmin
      .from('wa_message_templates')
      .select('id, name, body_text')
      .eq('topic_id', topic.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    template = data
  }
  template = template ?? nameMatch

  if (template) {
    cachedRateTemplate = template
    cacheExpiresAt = Date.now() + 60 * 60 * 1000 // 1 hour
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
  const wamid = await sendTextMessage(phone, messageBody)

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

interface WaInboundMessage {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
}

interface WaStatusUpdate {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string
  recipient_id: string
  errors?: Array<{ message: string; code: number }>
}
