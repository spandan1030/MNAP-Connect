import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/api'
import { applyPlaceholders } from '@/lib/utils'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { topicId, templateId } = await req.json()
  if (!topicId || !templateId) {
    return Response.json({ error: 'topicId and templateId required' }, { status: 400 })
  }

  const { data: template } = await supabaseAdmin
    .from('wa_message_templates')
    .select('*')
    .eq('id', templateId)
    .single()
  if (!template) return Response.json({ error: 'Template not found' }, { status: 404 })

  const todayStr = new Date().toLocaleDateString('en-CA')
  const { data: rates } = await supabaseAdmin
    .from('daily_rates')
    .select('rate_24kt, rate_22kt, rate_18kt')
    .eq('date', todayStr)
    .maybeSingle()

  const { data: interests } = await supabaseAdmin
    .from('wa_customer_interests')
    .select('customer_id')
    .eq('topic_id', topicId)

  const customerIds = (interests ?? []).map((i: { customer_id: string }) => i.customer_id)
  if (customerIds.length === 0) {
    return Response.json({ sent: 0, failed: 0, total: 0, results: [] })
  }

  const { data: customers } = await supabaseAdmin
    .from('wa_customers')
    .select('id, name, phone')
    .in('id', customerIds)
    .eq('is_active', true)
    .eq('is_opted_out', false)

  const total = (customers ?? []).length
  let sent = 0
  let failed = 0
  const results: Array<{ name: string; status: 'sent' | 'failed'; error?: string }> = []

  const now = new Date().toISOString()

  // Helper: resolve a variable name to its current value
  function resolveVar(varName: string, customerName: string) {
    if (varName === 'name')       return customerName
    if (varName === 'rate_24kt')  return rates?.rate_24kt != null ? String(rates.rate_24kt) : '—'
    if (varName === 'rate_22kt')  return rates?.rate_22kt != null ? String(rates.rate_22kt) : '—'
    if (varName === 'rate_18kt')  return rates?.rate_18kt != null ? String(rates.rate_18kt) : '—'
    return ''
  }

  for (const customer of (customers ?? [])) {
    const messageBody = applyPlaceholders(template.body_text, customer.name, rates)

    try {
      let wamid: string

      if (template.meta_template_name && template.meta_variables?.length) {
        // Use Meta-approved template — works outside the 24h window
        const parameters = (template.meta_variables as string[]).map(v => ({
          type: 'text',
          text: resolveVar(v, customer.name),
        }))
        wamid = await sendTemplateMessage(
          customer.phone,
          template.meta_template_name,
          template.meta_template_lang ?? 'en',
          [{ type: 'body', parameters }]
        )
      } else {
        // Fallback to free-form text (only works within 24h window)
        wamid = await sendTextMessage(customer.phone, messageBody)
      }

      // Upsert thread and insert message record
      const { data: thread } = await supabaseAdmin
        .from('wa_threads')
        .upsert(
          {
            phone: customer.phone,
            customer_name: customer.name,
            customer_id: customer.id,
            last_message_at: now,
            last_message_preview: messageBody.slice(0, 100),
          },
          { onConflict: 'phone' }
        )
        .select('id')
        .single()

      if (thread) {
        await supabaseAdmin.from('wa_messages').insert({
          thread_id: thread.id,
          direction: 'outbound',
          wa_message_id: wamid,
          body: messageBody,
          template_name: template.name,
          status: 'sent',
          sent_by: user.id,
        })
      }

      await supabaseAdmin.from('wa_communication_log').insert({
        customer_id: customer.id,
        template_id: template.id,
        topic_id: topicId,
        message_sent: messageBody,
        sent_by: user.id,
      })

      sent++
      results.push({ name: customer.name, status: 'sent' })
    } catch (err) {
      failed++
      results.push({ name: customer.name, status: 'failed', error: (err as Error).message })
    }
  }

  return Response.json({ sent, failed, total, results })
}
