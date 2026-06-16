import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendTemplateMessage } from '@/lib/whatsapp/api'

// ---------------------------------------------------------------------------
// Thank-you broadcast
// Sends a per-product (or default) Meta-approved template to each buyer.
// Buyers haven't messaged us first, so only approved templates deliver.
// Each recipient is also auto-enrolled in the customer book and tagged
// "Purchased" so they become a re-engageable segment.
// ---------------------------------------------------------------------------

interface Recipient { phone: string; product?: string | null }

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { recipients } = await req.json() as { recipients?: Recipient[] }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return Response.json({ error: 'No recipients provided' }, { status: 400 })
  }

  // Load all thank-you product configs once
  const { data: products } = await supabaseAdmin
    .from('wa_thankyou_products')
    .select('*')
    .eq('is_active', true)
  const configs = products ?? []
  const byLabel = new Map(configs.map(c => [c.product_label.trim().toLowerCase(), c]))
  const defaultConfig = configs.find(c => c.is_default) ?? null

  // "Purchased" topic (best-effort)
  const { data: purchasedTopic } = await supabaseAdmin
    .from('wa_interest_topics').select('id').eq('name', 'Purchased').is('parent_id', null).maybeSingle()

  // De-dupe recipients by phone (keep the first product seen)
  const seen = new Set<string>()
  const clean: Recipient[] = []
  for (const r of recipients) {
    const phone = (r.phone ?? '').replace(/\D/g, '').replace(/^91/, '')
    if (phone.length !== 10 || seen.has(phone)) continue
    seen.add(phone)
    clean.push({ phone, product: r.product?.trim() || null })
  }

  const now = new Date().toISOString()
  let sent = 0, failed = 0
  const results: Array<{ phone: string; status: 'sent' | 'failed'; error?: string }> = []

  for (const r of clean) {
    const config = (r.product && byLabel.get(r.product.toLowerCase())) || defaultConfig

    if (!config) {
      failed++
      results.push({ phone: r.phone, status: 'failed', error: r.product ? `No message set for "${r.product}" and no default` : 'No default message set' })
      continue
    }
    if (!config.meta_template_name) {
      failed++
      results.push({ phone: r.phone, status: 'failed', error: `"${config.product_label}" has no Meta template linked` })
      continue
    }

    try {
      const components: object[] = []
      if (config.header_image_url) {
        components.push({ type: 'header', parameters: [{ type: 'image', image: { link: config.header_image_url } }] })
      }

      const wamid = await sendTemplateMessage(
        r.phone,
        config.meta_template_name,
        config.meta_template_lang ?? 'en',
        components
      )

      // Auto-enroll buyer (don't overwrite an existing record)
      const { data: existing } = await supabaseAdmin
        .from('wa_customers').select('id, name').eq('phone', r.phone).maybeSingle()
      let customerId = existing?.id ?? null
      if (!customerId) {
        const { data: created } = await supabaseAdmin
          .from('wa_customers')
          .insert({ name: `Customer ${r.phone.slice(-4)}`, phone: r.phone, enrolled_via: 'import' })
          .select('id').single()
        customerId = created?.id ?? null
      }

      // Tag "Purchased"
      if (customerId && purchasedTopic) {
        await supabaseAdmin.from('wa_customer_interests')
          .upsert({ customer_id: customerId, topic_id: purchasedTopic.id }, { onConflict: 'customer_id,topic_id', ignoreDuplicates: true })
      }

      // Thread + message log so it shows in the inbox history
      const { data: thread } = await supabaseAdmin
        .from('wa_threads')
        .upsert(
          { phone: r.phone, customer_id: customerId, customer_name: existing?.name ?? null, last_message_at: now, last_message_preview: (config.body_preview || 'Thank you message').slice(0, 60) },
          { onConflict: 'phone' }
        )
        .select('id').single()

      if (thread) {
        await supabaseAdmin.from('wa_messages').insert({
          thread_id: thread.id, direction: 'outbound', wa_message_id: wamid,
          body: config.body_preview || null, template_name: `Thank you — ${config.product_label}`,
          status: 'sent', sent_by: user.id,
        })
      }

      if (customerId) {
        await supabaseAdmin.from('wa_communication_log').insert({
          customer_id: customerId,
          message_sent: config.body_preview || `Thank you (${config.product_label})`,
          sent_by: user.id,
        })
      }

      sent++
      results.push({ phone: r.phone, status: 'sent' })
    } catch (err) {
      failed++
      results.push({ phone: r.phone, status: 'failed', error: (err as Error).message })
    }
  }

  return Response.json({ sent, failed, total: clean.length, results })
}
