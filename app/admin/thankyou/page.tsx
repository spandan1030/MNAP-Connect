'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import type { WaThankYouProduct } from '@/lib/types'

interface SendResult {
  sent: number; failed: number; total: number
  results: Array<{ phone: string; status: 'sent' | 'failed'; error?: string }>
}
interface Recipient { phone: string; product?: string | null }

const EMPTY_FORM = {
  id: null as string | null,
  product_label: '',
  meta_template_name: '',
  meta_template_lang: 'en',
  body_preview: '',
  header_image_url: null as string | null,
  is_default: false,
  is_active: true,
}

export default function ThankYouPage() {
  const supabase = createClient()
  const router = useRouter()

  const [tab, setTab]           = useState<'send' | 'messages'>('send')
  const [products, setProducts] = useState<WaThankYouProduct[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('wa_thankyou_products').select('*')
        .order('is_default', { ascending: false }).order('product_label')
      setProducts((data ?? []) as WaThankYouProduct[])
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function reload() {
    const { data } = await supabase.from('wa_thankyou_products').select('*')
      .order('is_default', { ascending: false }).order('product_label')
    setProducts((data ?? []) as WaThankYouProduct[])
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Thank-you broadcast</h1>
            <p className="text-xs text-gray-500">Send purchase thank-you messages to buyers.</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {(['send', 'messages'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setError(null) }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                tab === t ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
              }`}>
              {t === 'send' ? 'Send' : 'Messages'}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        {loading ? (
          <div className="flex justify-center pt-10"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : tab === 'send' ? (
          <SendTab products={products} setError={setError} />
        ) : (
          <MessagesTab products={products} reload={reload} setError={setError} />
        )}
      </main>
    </div>
  )
}

// ===========================================================================
// SEND TAB — three input methods
// ===========================================================================
function SendTab({ products, setError }: { products: WaThankYouProduct[]; setError: (s: string | null) => void }) {
  const [method, setMethod]   = useState<'excel' | 'phones' | 'single'>('excel')
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [phonesText, setPhonesText] = useState('')
  const [singlePhone, setSinglePhone] = useState('')
  const [singleProduct, setSingleProduct] = useState('')
  const [parsing, setParsing] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult]   = useState<SendResult | null>(null)

  const hasDefault = products.some(p => p.is_default)

  async function handleExcel(file: File) {
    setParsing(true); setError(null); setResult(null)
    try {
      const buf = await file.arrayBuffer()
      const XLSX = await import('xlsx')
      const wb = XLSX.read(buf)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
      if (rows.length === 0) { setError('That file has no rows.'); setParsing(false); return }

      const keys = Object.keys(rows[0])
      const phoneKey   = keys.find(k => /phone|mobile|number|contact/i.test(k))
      const productKey = keys.find(k => /product|item/i.test(k))
      if (!phoneKey) { setError('No phone column found. Add a column named "phone".'); setParsing(false); return }

      const recs: Recipient[] = rows.map(r => ({
        phone: String(r[phoneKey] ?? '').replace(/\D/g, '').replace(/^91/, ''),
        product: productKey ? String(r[productKey] ?? '').trim() || null : null,
      })).filter(r => r.phone.length === 10)

      if (recs.length === 0) { setError('No valid 10-digit phone numbers found.'); setParsing(false); return }
      setRecipients(recs)
    } catch {
      setError('Could not read that file. Use an .xlsx or .csv with a "phone" column.')
    } finally {
      setParsing(false)
    }
  }

  function parsePhones(): Recipient[] {
    return [...new Set(phonesText.split(/[\s,;]+/).map(p => p.replace(/\D/g, '').replace(/^91/, '')).filter(p => p.length === 10))]
      .map(phone => ({ phone, product: null }))
  }

  async function send(recs: Recipient[]) {
    if (recs.length === 0) { setError('No recipients to send to.'); return }
    setSending(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/whatsapp/thankyou', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: recs }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Send failed')
      else { setResult(data); setRecipients([]); setPhonesText(''); setSinglePhone('') }
    } catch { setError('Network error — please try again') }
    finally { setSending(false) }
  }

  return (
    <div className="space-y-3">
      {!hasDefault && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠ No default message set yet. Add one in the <b>Messages</b> tab — used when a buyer has no product.
        </p>
      )}

      {/* Method picker */}
      <div className="flex gap-1.5 text-xs">
        {([['excel', 'Excel file'], ['phones', 'Phone list'], ['single', 'One buyer']] as const).map(([m, label]) => (
          <button key={m} onClick={() => { setMethod(m); setResult(null); setError(null) }}
            className={`flex-1 py-1.5 rounded-lg border font-medium ${method === m ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {method === 'excel' && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-gray-500">Upload an Excel/CSV with columns <b>phone</b> and <b>product</b>. The product picks the message; blank uses the default.</p>
          <a href="/thankyou-template.xlsx" download className="text-xs font-medium text-green-700 underline">↓ Download sample template</a>
          <label className="block">
            <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full cursor-pointer inline-block">
              {parsing ? 'Reading…' : 'Choose file'}
            </span>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleExcel(f) }} />
          </label>
          {recipients.length > 0 && (
            <>
              <p className="text-sm text-gray-700">{recipients.length} buyer{recipients.length !== 1 ? 's' : ''} ready · {recipients.filter(r => r.product).length} with a product</p>
              <button onClick={() => send(recipients)} disabled={sending} className="btn-primary w-full disabled:opacity-60">
                {sending ? 'Sending…' : `Send to ${recipients.length}`}
              </button>
            </>
          )}
        </div>
      )}

      {method === 'phones' && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-gray-500">Paste phone numbers (comma or space separated). Everyone gets the <b>default</b> thank-you.</p>
          <textarea value={phonesText} onChange={e => setPhonesText(e.target.value)} rows={4}
            className="input resize-none text-sm" placeholder="9876543210, 9123456780, …" />
          <button onClick={() => send(parsePhones())} disabled={sending || !phonesText.trim()} className="btn-primary w-full disabled:opacity-60">
            {sending ? 'Sending…' : `Send default to ${parsePhones().length}`}
          </button>
        </div>
      )}

      {method === 'single' && (
        <div className="card p-4 space-y-3">
          <input value={singlePhone} onChange={e => setSinglePhone(e.target.value)} className="input" placeholder="Phone number (10 digits)" inputMode="numeric" />
          <select value={singleProduct} onChange={e => setSingleProduct(e.target.value)} className="input">
            <option value="">Default message</option>
            {products.filter(p => !p.is_default).map(p => <option key={p.id} value={p.product_label}>{p.product_label}</option>)}
          </select>
          <button
            onClick={() => send([{ phone: singlePhone.replace(/\D/g, '').replace(/^91/, ''), product: singleProduct || null }])}
            disabled={sending || singlePhone.replace(/\D/g, '').replace(/^91/, '').length !== 10}
            className="btn-primary w-full disabled:opacity-60">
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      )}

      {result && (
        <div className="card p-4">
          <div className="flex gap-3">
            <div className="flex-1 bg-green-50 border border-green-100 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{result.sent}</p><p className="text-xs text-green-600">Sent</p>
            </div>
            {result.failed > 0 && (
              <div className="flex-1 bg-red-50 border border-red-100 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-red-600">{result.failed}</p><p className="text-xs text-red-500">Failed</p>
              </div>
            )}
          </div>
          {result.failed > 0 && (
            <div className="mt-3 space-y-1.5">
              {result.results.filter(r => r.status === 'failed').map((r, i) => (
                <div key={i} className="bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <p className="text-xs font-medium text-gray-800">+91 {r.phone}</p>
                  {r.error && <p className="text-xs text-red-500 mt-0.5">{r.error}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// MESSAGES TAB — per-product thank-you config (CRUD)
// ===========================================================================
function MessagesTab({ products, reload, setError }: { products: WaThankYouProduct[]; reload: () => Promise<void>; setError: (s: string | null) => void }) {
  const supabase = createClient()
  const [form, setForm]       = useState({ ...EMPTY_FORM })
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [uploading, setUploading] = useState(false)

  function startAdd()  { setForm({ ...EMPTY_FORM }); setEditing(true); setError(null) }
  function startEdit(p: WaThankYouProduct) {
    setForm({ id: p.id, product_label: p.product_label, meta_template_name: p.meta_template_name ?? '',
      meta_template_lang: p.meta_template_lang, body_preview: p.body_preview, header_image_url: p.header_image_url,
      is_default: p.is_default, is_active: p.is_active })
    setEditing(true); setError(null)
  }

  async function uploadImage(file: File) {
    if (!file.type.startsWith('image/')) { setError('Please choose an image'); return }
    setUploading(true)
    const ext = file.name.split('.').pop() || 'jpg'
    const { data, error: e } = await supabase.storage.from('wa-media').upload(`thankyou/${Date.now()}.${ext}`, file, { upsert: false })
    if (e || !data) { setError(e?.message ?? 'Upload failed'); setUploading(false); return }
    const { data: { publicUrl } } = supabase.storage.from('wa-media').getPublicUrl(data.path)
    setForm(f => ({ ...f, header_image_url: publicUrl }))
    setUploading(false)
  }

  async function save() {
    if (!form.product_label.trim() && !form.is_default) { setError('Enter a product name (or mark it as the default).'); return }
    setSaving(true); setError(null)
    const { data: { user } } = await supabase.auth.getUser()

    // Only one default allowed — clear others first
    if (form.is_default) await supabase.from('wa_thankyou_products').update({ is_default: false }).eq('is_default', true)

    const row = {
      product_label: form.product_label.trim() || (form.is_default ? 'Default' : ''),
      meta_template_name: form.meta_template_name.trim() || null,
      meta_template_lang: form.meta_template_lang.trim() || 'en',
      body_preview: form.body_preview,
      header_image_url: form.header_image_url,
      is_default: form.is_default,
      is_active: form.is_active,
      updated_by: user?.id ?? null,
    }
    const { error: e } = form.id
      ? await supabase.from('wa_thankyou_products').update(row).eq('id', form.id)
      : await supabase.from('wa_thankyou_products').insert(row)

    setSaving(false)
    if (e) { setError(e.message); return }
    setEditing(false)
    await reload()
  }

  async function remove(id: string) {
    await supabase.from('wa_thankyou_products').delete().eq('id', id)
    await reload()
  }

  if (editing) {
    return (
      <div className="card p-4 space-y-3">
        <p className="font-semibold text-gray-900 text-sm">{form.id ? 'Edit message' : 'New thank-you message'}</p>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.is_default} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} />
          Use as the <b>default</b> message (when a buyer has no product)
        </label>

        {!form.is_default && (
          <div>
            <label className="text-xs font-medium text-gray-600">Product name (must match your upload exactly)</label>
            <input value={form.product_label} onChange={e => setForm(f => ({ ...f, product_label: e.target.value }))} className="input mt-1" placeholder="e.g. Gold Chain" />
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-gray-600">Meta-approved template name</label>
          <input value={form.meta_template_name} onChange={e => setForm(f => ({ ...f, meta_template_name: e.target.value }))} className="input mt-1" placeholder="exactly as approved in Meta" />
          <p className="text-[11px] text-gray-400 mt-1">Required to deliver. Register the template in Meta first, then enter its exact name.</p>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-600">Language</label>
            <input value={form.meta_template_lang} onChange={e => setForm(f => ({ ...f, meta_template_lang: e.target.value }))} className="input mt-1" placeholder="en" />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600">Preview text (for your reference in the app)</label>
          <textarea value={form.body_preview} onChange={e => setForm(f => ({ ...f, body_preview: e.target.value }))} rows={2} className="input mt-1 resize-none" placeholder="Thank you for your purchase…" />
        </div>

        <div className="flex items-center gap-3">
          {form.header_image_url ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.header_image_url} alt="" className="w-12 h-12 object-cover rounded-lg border border-gray-200" />
              <button onClick={() => setForm(f => ({ ...f, header_image_url: null }))} className="text-xs text-red-600 font-medium">Remove image</button>
            </>
          ) : (
            <label className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full cursor-pointer">
              {uploading ? 'Uploading…' : '+ Add image (optional)'}
              <input type="file" accept="image/*" className="hidden" disabled={uploading}
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadImage(f) }} />
            </label>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={save} disabled={saving} className="btn-primary flex-1 disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={() => setEditing(false)} className="btn-secondary flex-1">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button onClick={startAdd} className="btn-primary w-full">+ Add thank-you message</button>
      {products.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No messages yet. Add a default and one per product.</p>}
      {products.map(p => (
        <div key={p.id} className="card p-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-gray-900 text-sm truncate">{p.is_default ? 'Default' : p.product_label}</p>
              {p.is_default && <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">DEFAULT</span>}
              {p.meta_template_name
                ? <span className="text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full">Template set</span>
                : <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">No template</span>}
            </div>
            {p.body_preview && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{p.body_preview}</p>}
          </div>
          <div className="flex flex-col gap-1 flex-shrink-0">
            <button onClick={() => startEdit(p)} className="text-xs font-medium text-green-700">Edit</button>
            <button onClick={() => remove(p.id)} className="text-xs font-medium text-red-600">Delete</button>
          </div>
        </div>
      ))}
    </div>
  )
}
