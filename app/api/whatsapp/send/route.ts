import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/api'
import { applyPlaceholders } from '@/lib/utils'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    phone,
    body,
    templateId,
    customerId,
    topicId,
  } = await req.json() as {
    phone?: string
    body?: string
    templateId?: string
    customerId?: string
    topicId?: string
  }

  if (!phone?.trim()) return Response.json({ error: 'phone is required' }, { status: 400 })

  const cleanPhone = phone.replace(/\D/g, '')
  const now = new Date().toISOString()
  const todayStr = new Date().toLocaleDateString('en-CA')

  // Fetch template + today's rates in parallel if a templateId was provided
  const [templateRes, ratesRes] = await Promise.all([
    templateId
      ? supabaseAdmin.from('wa_message_templates').select('*').eq('id', templateId).single()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from('daily_rates').select('rate_24kt, rate_22kt, rate_18kt').eq('date', todayStr).maybeSingle(),
  ])

  const template = templateRes.data
  const rates    = ratesRes.data

  // Resolve message body — use pre-rendered body from client (works for text + edited messages)
  const messageBody = body?.trim()
  if (!messageBody) return Response.json({ error: 'body is required' }, { status: 400 })

  // Get or create thread
  const { data: existing } = await supabase
    .from('wa_threads')
    .select('id')
    .eq('phone', cleanPhone)
    .maybeSingle()

  let threadId: string

  if (existing) {
    threadId = existing.id
  } else {
    const { data: customer } = await supabase
      .from('wa_customers').select('id, name').eq('phone', cleanPhone).maybeSingle()

    const { data: newThread, error } = await supabase
      .from('wa_threads')
      .insert({ phone: cleanPhone, customer_name: customer?.name ?? null, customer_id: customer?.id ?? null })
      .select('id').single()

    if (error || !newThread) return Response.json({ error: 'Failed to create thread' }, { status: 500 })
    threadId = newThread.id
  }

  // Insert as queued
  const { data: message, error: insertError } = await supabase
    .from('wa_messages')
    .insert({
      thread_id:    threadId,
      direction:    'outbound',
      body:         messageBody,
      template_name: template?.name ?? null,
      status:       'queued',
      sent_by:      user.id,
    })
    .select('id').single()

  if (insertError || !message) return Response.json({ error: 'Failed to save message' }, { status: 500 })

  try {
    let wamid: string

    if (template?.meta_template_name) {
      // Approved template — works outside the 24h window
      // Resolve customer name for variable substitution
      let customerName = 'there'
      if (customerId) {
        const { data: c } = await supabaseAdmin
          .from('wa_customers').select('name').eq('id', customerId).single()
        if (c?.name) customerName = c.name
      }

      const variables = (template.meta_variables as string[] | null) ?? []
      const parameters = variables.map(varName => {
        if (varName === 'name')      return { type: 'text', text: customerName }
        if (varName === 'rate_24kt') return { type: 'text', text: rates?.rate_24kt != null ? String(rates.rate_24kt) : '—' }
        if (varName === 'rate_22kt') return { type: 'text', text: rates?.rate_22kt != null ? String(rates.rate_22kt) : '—' }
        if (varName === 'rate_18kt') return { type: 'text', text: rates?.rate_18kt != null ? String(rates.rate_18kt) : '—' }
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

      console.log('[send] template components:', JSON.stringify(components, null, 2))

      wamid = await sendTemplateMessage(
        cleanPhone,
        template.meta_template_name,
        template.meta_template_lang ?? 'en',
        components
      )
    } else {
      // Free-form text — only works within 24h customer reply window
      wamid = await sendTextMessage(cleanPhone, messageBody)
    }

    await Promise.all([
      supabase.from('wa_messages')
        .update({ wa_message_id: wamid, status: 'sent' })
        .eq('id', message.id),
      supabase.from('wa_threads')
        .update({ last_message_at: now, last_message_preview: messageBody.slice(0, 60) })
        .eq('id', threadId),
    ])

    // Log to communication log if this came from the send page
    if (customerId && templateId) {
      await supabase.from('wa_communication_log').insert({
        customer_id: customerId,
        template_id: templateId,
        topic_id:    topicId ?? null,
        message_sent: messageBody,
        sent_by:     user.id,
      })
    }

    return Response.json({ ok: true })

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[send] Meta API error:', errMsg)
    await supabase.from('wa_messages')
      .update({ status: 'failed', failed_reason: errMsg })
      .eq('id', message.id)
    return Response.json({ error: errMsg }, { status: 500 })
  }
}
