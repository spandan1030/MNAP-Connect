import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendImageMessage } from '@/lib/whatsapp/api'

export async function POST(req: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Parse multipart form data
  const formData = await req.formData()
  const phone   = (formData.get('phone')   as string | null)?.replace(/\D/g, '')
  const file    = formData.get('file')    as File | null
  const caption = (formData.get('caption') as string | null)?.trim() || null

  if (!phone || !file) {
    return Response.json({ error: 'phone and file are required' }, { status: 400 })
  }

  // Validate file type
  if (!file.type.startsWith('image/')) {
    return Response.json({ error: 'Only image files are supported' }, { status: 400 })
  }

  // Max 5 MB
  if (file.size > 5 * 1024 * 1024) {
    return Response.json({ error: 'Image must be under 5 MB' }, { status: 400 })
  }

  // Respect Do-Not-Disturb (customer sent STOP)
  const { data: dndCustomer } = await supabaseAdmin
    .from('wa_customers').select('dnd').eq('phone', phone).maybeSingle()
  if (dndCustomer?.dnd) {
    return Response.json({ error: 'This number opted out (sent STOP) and cannot be messaged.' }, { status: 403 })
  }

  // Upload to Supabase Storage
  const ext      = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const filename = `outbound/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const buffer   = Buffer.from(await file.arrayBuffer())

  const { data: upload, error: uploadError } = await supabaseAdmin.storage
    .from('wa-media')
    .upload(filename, buffer, { contentType: file.type, upsert: false })

  if (uploadError || !upload) {
    console.error('[send-media] Storage upload failed:', uploadError)
    return Response.json({ error: 'Image upload failed' }, { status: 500 })
  }

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('wa-media')
    .getPublicUrl(upload.path)

  // Get or create thread
  const now = new Date().toISOString()

  const { data: existingThread } = await supabase
    .from('wa_threads')
    .select('id')
    .eq('phone', phone)
    .maybeSingle()

  let threadId: string

  if (existingThread) {
    threadId = existingThread.id
  } else {
    const { data: customer } = await supabase
      .from('wa_customers')
      .select('id, name')
      .eq('phone', phone)
      .maybeSingle()

    const { data: newThread, error: threadError } = await supabase
      .from('wa_threads')
      .insert({
        phone,
        customer_name: customer?.name ?? null,
        customer_id:   customer?.id  ?? null,
      })
      .select('id')
      .single()

    if (threadError || !newThread) {
      return Response.json({ error: 'Failed to create thread' }, { status: 500 })
    }
    threadId = newThread.id
  }

  // Insert message row as queued
  const { data: message, error: msgError } = await supabase
    .from('wa_messages')
    .insert({
      thread_id:    threadId,
      direction:    'outbound',
      body:         caption,
      message_type: 'image',
      media_url:    publicUrl,
      status:       'queued',
      sent_by:      user.id,
    })
    .select('id')
    .single()

  if (msgError || !message) {
    return Response.json({ error: 'Failed to save message' }, { status: 500 })
  }

  // Send via Meta API
  try {
    const wamid = await sendImageMessage(phone, publicUrl, caption ?? undefined)

    await Promise.all([
      supabase
        .from('wa_messages')
        .update({ wa_message_id: wamid, status: 'sent' })
        .eq('id', message.id),
      supabase
        .from('wa_threads')
        .update({ last_message_at: now, last_message_preview: '📷 Photo' + (caption ? `: ${caption.slice(0, 40)}` : '') })
        .eq('id', threadId),
    ])

    return Response.json({ ok: true, mediaUrl: publicUrl })

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[send-media] Meta API error:', errMsg)

    await supabase
      .from('wa_messages')
      .update({ status: 'failed', failed_reason: errMsg })
      .eq('id', message.id)

    return Response.json({ error: errMsg }, { status: 500 })
  }
}
