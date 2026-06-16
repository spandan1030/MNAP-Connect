'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/image'
import Navbar from '@/components/ui/Navbar'
import type { WaProduct, WaProductImage } from '@/lib/types'

const PURITY_OPTIONS = ['24KT', '22KT', '18KT', '14KT', '916', '750', '999', '925']

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const supabase = createClient()
  const router = useRouter()

  const [form, setForm]   = useState({ item_name: '', barcode: '', weight: '', purity: '', design: '', party: '', notes: '', is_active: true })
  const [isSold, setIsSold] = useState(false)
  const [needsReview, setNeedsReview] = useState(false)
  const [images, setImages] = useState<WaProductImage[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    async function load() {
      const [pRes, iRes] = await Promise.all([
        supabase.from('wa_products').select('*').eq('id', id).single(),
        supabase.from('wa_product_images').select('*').eq('product_id', id).order('sort_order'),
      ])
      const p = pRes.data as WaProduct | null
      if (p) {
        setForm({
          item_name: p.item_name ?? '', barcode: p.barcode ?? '', weight: p.weight != null ? String(p.weight) : '',
          purity: p.purity ?? '', design: p.design ?? '', party: p.party ?? '', notes: p.notes ?? '', is_active: p.is_active,
        })
        setIsSold(p.is_sold)
        setNeedsReview(p.needs_review)
      }
      setImages((iRes.data ?? []) as WaProductImage[])
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function set(k: keyof typeof form, v: string | boolean) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    setSaving(true); setError(null)
    const { error: e } = await supabase.from('wa_products').update({
      item_name: form.item_name.trim() || null,
      barcode:   form.barcode.trim() || null,
      weight:    form.weight ? Number(form.weight) : null,
      purity:    form.purity.trim() || null,
      design:    form.design.trim() || null,
      party:     form.party.trim() || null,
      notes:     form.notes.trim() || null,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setSaving(false)
    if (e) { setError(e.code === '23505' ? 'A product with this barcode already exists.' : e.message); return }
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  // Status flags update immediately (no Save needed) — quick during a sale / QC
  async function toggleSold() {
    const v = !isSold; setIsSold(v)
    await supabase.from('wa_products').update({ is_sold: v, updated_at: new Date().toISOString() }).eq('id', id)
  }
  async function toggleReview() {
    const v = !needsReview; setNeedsReview(v)
    await supabase.from('wa_products').update({ needs_review: v }).eq('id', id)
  }

  async function addPhotos(list: FileList) {
    setUploading(true); setError(null)
    const imgs = Array.from(list).filter(f => f.type.startsWith('image/') && f.size <= 30 * 1024 * 1024)
    let order = images.length
    for (const raw of imgs) {
      const f = await compressImage(raw)
      const { data: up, error: upErr } = await supabase.storage.from('wa-media').upload(`products/${id}/${Date.now()}-${order}.jpg`, f, { upsert: false, contentType: 'image/jpeg' })
      if (upErr || !up) { console.error('[catalogue] upload failed:', upErr); setError(`Photo upload failed: ${upErr?.message ?? 'unknown error'}`); continue }
      const { data: { publicUrl } } = supabase.storage.from('wa-media').getPublicUrl(up.path)
      const { data: row } = await supabase.from('wa_product_images').insert({ product_id: id, image_url: publicUrl, sort_order: order }).select('*').single()
      if (row) setImages(prev => [...prev, row as WaProductImage])
      order++
    }
    setUploading(false)
  }

  async function deleteImage(img: WaProductImage) {
    await supabase.from('wa_product_images').delete().eq('id', img.id)
    const path = img.image_url.split('/wa-media/')[1]
    if (path) await supabase.storage.from('wa-media').remove([path])
    setImages(prev => prev.filter(i => i.id !== img.id))
  }

  async function deleteProduct() {
    await supabase.from('wa_products').delete().eq('id', id)
    router.push('/catalogue')
  }

  if (loading) return <div className="min-h-screen flex flex-col"><Navbar /><div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading…</div></div>

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
          <h1 className="text-lg font-bold text-gray-900 truncate">{form.item_name || 'Product'}</h1>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        {/* Status — quick toggles (save instantly) */}
        <div className="card p-3 flex gap-2">
          <button onClick={toggleSold}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              isSold ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'
            }`}>
            {isSold ? '● Sold' : '● In stock'}
          </button>
          <button onClick={toggleReview}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              needsReview ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-300'
            }`}>
            {needsReview ? '⚑ Marked for review' : '⚐ Mark for review'}
          </button>
        </div>

        {/* Photos */}
        <div className="card p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-800">Photos</p>
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map(img => (
                <div key={img.id} className="relative">
                  <a href={img.image_url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.image_url} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
                  </a>
                  <button onClick={() => deleteImage(img)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700 text-white rounded-full text-xs flex items-center justify-center">×</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <label className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 cursor-pointer active:bg-gray-50 ${uploading ? 'opacity-50' : ''}`}>
              {uploading ? 'Uploading…' : '📷 Take photo'}
              <input type="file" accept="image/*" capture="environment" className="hidden" disabled={uploading}
                onChange={e => { if (e.target.files) addPhotos(e.target.files); e.target.value = '' }} />
            </label>
            <label className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 cursor-pointer active:bg-gray-50 ${uploading ? 'opacity-50' : ''}`}>
              🖼 Gallery
              <input type="file" accept="image/*" multiple className="hidden" disabled={uploading}
                onChange={e => { if (e.target.files) addPhotos(e.target.files); e.target.value = '' }} />
            </label>
          </div>
        </div>

        {/* Details */}
        <div className="card p-4 space-y-3">
          <Field label="Item name"><input value={form.item_name} onChange={e => set('item_name', e.target.value)} className="input" /></Field>
          <Field label="Barcode"><input value={form.barcode} onChange={e => set('barcode', e.target.value)} className="input" /></Field>
          <div className="flex gap-3">
            <Field label="Weight (g)" className="flex-1"><input type="number" inputMode="decimal" step="0.001" value={form.weight} onChange={e => set('weight', e.target.value)} className="input" /></Field>
            <Field label="Purity" className="flex-1">
              <input list="purity-list" value={form.purity} onChange={e => set('purity', e.target.value)} className="input" />
              <datalist id="purity-list">{PURITY_OPTIONS.map(o => <option key={o} value={o} />)}</datalist>
            </Field>
          </div>
          <Field label="Design"><input value={form.design} onChange={e => set('design', e.target.value)} className="input" /></Field>
          <Field label="Party (supplier)"><input value={form.party} onChange={e => set('party', e.target.value)} className="input" /></Field>
          <Field label="Notes"><textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="input resize-none" /></Field>
          <label className="flex items-center gap-2 text-sm text-gray-700 pt-1">
            <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
            Active (uncheck to hide from the catalogue)
          </label>
        </div>

        <button onClick={save} disabled={saving} className="btn-primary w-full disabled:opacity-60">
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
        </button>

        {confirmDelete ? (
          <div className="card p-4 border-red-200">
            <p className="text-sm text-gray-800 mb-3">Delete this product and its photos? This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={deleteProduct} className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-semibold text-sm">Yes, delete</button>
              <button onClick={() => setConfirmDelete(false)} className="btn-secondary flex-1">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="w-full py-2.5 rounded-xl border-2 border-red-200 text-red-600 font-semibold text-sm">Delete product</button>
        )}
      </main>
    </div>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  )
}
