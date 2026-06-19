import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendImageMessage, sendTextMessage } from '@/lib/whatsapp/api'

// Share a catalogue product with a customer: sends the chosen product photo
// (an already-public Supabase URL) with an optional caption. Only valid inside
// the 24-hour window; outside it Meta rejects the send and we surface the error.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { phone: rawPhone, imageUrl, caption } = await req.json()
  const phone = (rawPhone as string | undefined)?.replace(/\D/g, '')
  const text  = (caption as string | undefined)?.trim() || null

  if (!phone) return Response.json({ error: 'phone is required' }, { status: 400 })
  if (!imageUrl && !text) return Response.json({ error: 'Nothing to send' }, { status: 400 })

  // Respect Do-Not-Disturb (customer sent STOP)
  const { data: dndCustomer } = await supabaseAdmin
    .from('wa_customers').select('dnd').eq('phone', phone).maybeSingle()
  if (dndCustomer?.dnd) {
    return Response.json({ error: 'This number opted out (sent STOP) and cannot be messaged.' }, { status: 403 })
  }

  const now = new Date().toISOString()

  // Get or create thread
  const { data: existingThread } = await supabase
    .from('wa_threads').select('id').eq('phone', phone).maybeSingle()

  let threadId: string
  if (existingThread) {
    threadId = existingThread.id
  } else {
    const { data: customer } = await supabase
      .from('wa_customers').select('id, name').eq('phone', phone).maybeSingle()
    const { data: newThread, error: threadError } = await supabase
      .from('wa_threads')
      .insert({ phone, customer_name: customer?.name ?? null, customer_id: customer?.id ?? null })
      .select('id').single()
    if (threadError || !newThread) return Response.json({ error: 'Failed to create thread' }, { status: 500 })
    threadId = newThread.id
  }

  // Log the outbound message
  const { data: message, error: msgError } = await supabase
    .from('wa_messages')
    .insert({
      thread_id:    threadId,
      direction:    'outbound',
      body:         text,
      message_type: imageUrl ? 'image' : 'text',
      media_url:    imageUrl ?? null,
      status:       'queued',
      sent_by:      user.id,
    })
    .select('id').single()
  if (msgError || !message) return Response.json({ error: 'Failed to save message' }, { status: 500 })

  try {
    const wamid = imageUrl
      ? await sendImageMessage(phone, imageUrl, text ?? undefined)
      : await sendTextMessage(phone, text!)

    const preview = imageUrl ? '📷 Photo' + (text ? `: ${text.slice(0, 40)}` : '') : (text ?? '')
    await Promise.all([
      supabase.from('wa_messages').update({ wa_message_id: wamid, status: 'sent', sent_at: now }).eq('id', message.id),
      supabase.from('wa_threads').update({ last_message_at: now, last_message_preview: preview }).eq('id', threadId),
    ])
    return Response.json({ ok: true })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[share-product] Meta API error:', errMsg)
    await supabase.from('wa_messages').update({ status: 'failed', failed_reason: errMsg }).eq('id', message.id)
    return Response.json({ error: errMsg }, { status: 500 })
  }
}
