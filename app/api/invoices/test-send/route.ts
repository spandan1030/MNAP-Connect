import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendTemplateMessage } from '@/lib/whatsapp/api'
import { publishInvoice, type InvoiceSnapshot } from '@/lib/invoices/publish'

// Test-send an invoice-link template to a single phone, using a TEST token in the
// URL button and sample body values — so you can see exactly how the real message
// (copy + dynamic "View invoice" button) lands in WhatsApp before broadcasting.
//
// It publishes a SAMPLE bill (fake data — no real PII) under a fixed test token
// first, so tapping the button opens a real rendered Bill Summary instead of
// "not found". No ledger, no wa_invoices row; opt-out is not consulted (you're
// testing your own number).
//   POST { phone, templateId }

const TEST_TOKEN = 'test-preview'   // fixed token → …/i/test-preview (sample bill)

// A fake bill shown when the test button is tapped. Republished on every test so
// its 7-day clock refreshes.
const DEMO_INVOICE: InvoiceSnapshot = {
  bill_no: 'RSL/TEST/PREVIEW',
  invoice_date: new Date().toISOString().slice(0, 10),
  customer_name: 'Valued Customer',
  amount_before_tax: 48500, tax_amount: 1500, net_amount: 50000,
  old_metal_amount: 0, advance_amount: 0, payable: 50000,
  line_items: [
    { item: 'Gold Ring', purity: '22CT (91.66%)', net_wt: 4.0, barcode: 'TEST-01', amount: 30000 },
    { item: 'Gold Earrings', purity: '22CT (91.66%)', net_wt: 3.2, barcode: 'TEST-02', amount: 20000 },
  ],
}

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
    if (k === 'name') return { type: 'text', text: 'there' }
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

  // Publish the sample bill so the test button opens a real Bill Summary. Best-
  // effort: if publishing isn't configured we still send (message preview works),
  // the link just shows "not found".
  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString()
  let published = true
  try {
    await publishInvoice(TEST_TOKEN, DEMO_INVOICE, expiresAt)
  } catch (err) {
    published = false
    console.error('test-send demo publish failed (non-fatal):', err)
  }

  try {
    const wamid = await sendTemplateMessage(p, template.meta_template_name, template.meta_template_lang ?? 'en', comps)
    return Response.json({ ok: true, wamid, published })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 })
  }
}
