import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendTextMessage } from '@/lib/whatsapp/api'

export async function POST(req: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Parse body
  const { phone, body } = await req.json() as { phone?: string; body?: string }
  if (!phone?.trim() || !body?.trim()) {
    return Response.json({ error: 'phone and body are required' }, { status: 400 })
  }

  const cleanPhone = phone.replace(/\D/g, '')

  // Get or create thread
  let threadId: string

  const { data: existing } = await supabase
    .from('wa_threads')
    .select('id')
    .eq('phone', cleanPhone)
    .single()

  if (existing) {
    threadId = existing.id
  } else {
    // Look up customer name if enrolled
    const { data: customer } = await supabase
      .from('wa_customers')
      .select('id, name')
      .eq('phone', cleanPhone)
      .single()

    const { data: newThread, error } = await supabase
      .from('wa_threads')
      .insert({
        phone:         cleanPhone,
        customer_name: customer?.name ?? null,
        customer_id:   customer?.id  ?? null,
      })
      .select('id')
      .single()

    if (error || !newThread) {
      return Response.json({ error: 'Failed to create thread' }, { status: 500 })
    }
    threadId = newThread.id
  }

  // Insert message row as 'queued' — gives UI something to show immediately
  const { data: message, error: insertError } = await supabase
    .from('wa_messages')
    .insert({
      thread_id: threadId,
      direction: 'outbound',
      body:      body.trim(),
      status:    'queued',
      sent_by:   user.id,
    })
    .select('id')
    .single()

  if (insertError || !message) {
    return Response.json({ error: 'Failed to save message' }, { status: 500 })
  }

  // Send via Meta Graph API
  try {
    const waMessageId = await sendTextMessage(cleanPhone, body.trim())

    // Update to 'sent' with Meta's message ID
    await supabase
      .from('wa_messages')
      .update({ wa_message_id: waMessageId, status: 'sent' })
      .eq('id', message.id)

    // Update thread last-message preview
    await supabase
      .from('wa_threads')
      .update({
        last_message_at:      new Date().toISOString(),
        last_message_preview: body.trim().slice(0, 60),
      })
      .eq('id', threadId)

    return Response.json({ ok: true, messageId: waMessageId })

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[send] Meta API error:', errMsg)

    // Mark message as failed
    await supabase
      .from('wa_messages')
      .update({ status: 'failed', failed_reason: errMsg })
      .eq('id', message.id)

    return Response.json({ error: errMsg }, { status: 500 })
  }
}
