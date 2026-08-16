import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendTemplateMessage } from '@/lib/whatsapp/api'

// Test-send an invoice-link template to a single phone, using a TEST token in the
// URL button and sample body values — so you can see exactly how the real message
// (copy + dynamic "View invoice" button) lands in WhatsApp before broadcasting.
//
// No real invoice, no Firestore publish, no ledger: it's a preview. The button
// points at …/i/<TEST_TOKEN>, which is a deliberately fake link (it won't open a
// real bill). Opt-out is not consulted — you're testing your own number.
//   POST { phone, templateId }

const TEST_TOKEN = 'test-preview'   // fake token → …/i/test-preview

function tenDigit(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '')
  const ten = d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
  return ten
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { phone, templateId } = (await req.json()) as { phone?: string; templateId?: string }
  if (!templateId) return Response.json({ error: 'templateId required' }, { status: 400 })
  const p = tenDigit(phone ?? '')
  if (p.length !== 10) return Response.json({ error: 'Enter a valid 10-digit phone number.' }, { status: 400 })

  const { data: template } = await supabaseAdmin
    .from('wa_message_templates').select('*').eq('id', templateId).single()
  if (!template) return Response.json({ error: 'Template not found' }, { status: 404 })
  if (!template.meta_template_name) {
    return Response.json({ error: 'This template has no Meta-approved template linked.' }, { status: 400 })
  }

  // Sample body values so the placeholders render like a real send.
  const vars = (template.meta_variables as string[] | null) ?? []
  const bodyParams = vars.map(v => {
    const k = v.toLowerCase()
    if (k === 'name') return { type: 'text', parameter_name: 'customer_name', text: 'there' }
    if (k === 'bill_no' || k === 'bill') return { type: 'text', text: 'RSL/TEST/000' }
    if (k === 'payable' || k === 'amount') return { type: 'text', text: '9999' }
    return { type: 'text', text: '' }
  })

  const comps: object[] = []
  if (template.header_type === 'image' && template.header_image_url) {
    comps.push({ type: 'header', parameters: [{ type: 'image', image: { link: template.header_image_url } }] })
  }
  if (bodyParams.length) comps.push({ type: 'body', parameters: bodyParams })
  comps.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: TEST_TOKEN }] })

  try {
    const wamid = await sendTemplateMessage(p, template.meta_template_name, template.meta_template_lang ?? 'en', comps)
    return Response.json({ ok: true, wamid })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 })
  }
}
