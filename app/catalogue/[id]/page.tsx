'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { compressWithThumb } from '@/lib/image'
import { fetchCatalogueOptions, addCatalogueOptions, type Options } from '@/lib/catalogue'
import Navbar from '@/components/ui/Navbar'
import ShareSheet from '@/components/catalogue/ShareSheet'
import AddToPlanSheet from '@/components/catalogue/AddToPlanSheet'
import type { WaProduct, WaProductImage } from '@/lib/types'

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const supabase = createClient()
  const router = useRouter()

  const [form, setForm]   = useState({ item_name: '', barcode: '', weight: '', purity: '', design: '', description: '', party: '', notes: '', is_active: true })
  const [options, setOptions] = useState<Options>({ item_name: [], design: [], description: [], purity: [], party: [] })
  const [isSold, setIsSold] = useState(false)
  const [needsReview, setNeedsReview] = useState(false)
  const [product, setProduct] = useState<WaProduct | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
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
        supabase.from('wa_product_images').select('*').eq('product_id', id).order('is_primary', { ascending: false }).order('sort_order'),
      ])
      const p = pRes.data as WaProduct | null
      setProduct(p)
      if (p) {
        setForm({
          item_name: p.item_name ?? '', barcode: p.barcode ?? '', weight: p.weight != null ? String(p.weight) : '',
          purity: p.purity ?? '', design: p.design ?? '', description: p.description ?? '', party: p.party ?? '', notes: p.notes ?? '', is_active: p.is_active,
        })
        setIsSold(p.is_sold)
        setNeedsReview(p.needs_review)
      }
      setImages((iRes.data ?? []) as WaProductImage[])
      setLoading(false)
    }
    load()
    fetchCatalogueOptions().then(setOptions)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function set(k: keyof typeof form, v: string | boolean) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    setSaving(true); setError(null)
    const { error: e } = await supabase.from('wa_products').update({
      item_name:   form.item_name.trim() || null,
      barcode:     form.barcode.trim() || null,
      weight:      form.weight ? Number(form.weight) : null,
      purity:      form.purity.trim() || null,
      design:      form.design.trim() || null,
      description: form.description.trim() || null,
      party:       form.party.trim() || null,
      notes:       form.notes.trim() || null,
      is_active:   form.is_active,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setSaving(false)
    if (e) { setError(e.code === '23505' ? 'A product with this barcode already exists.' : e.message); return }
    await addCatalogueOptions([
      { field: 'item_name', value: form.item_name }, { field: 'design', value: form.design },
      { field: 'description', value: form.description }, { field: 'purity', value: form.purity }, { field: 'party', value: form.party },
    ])
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
      const { full, thumb } = await compressWithThumb(raw)
      const base = `products/${id}/${Date.now()}-${order}`
      const { data: up, error: upErr } = await supabase.storage.from('wa-media').upload(`${base}.jpg`, full, { upsert: false, contentType: 'image/jpeg' })
      if (upErr || !up) { console.error('[catalogue] upload failed:', upErr); setError(`Photo upload failed: ${upErr?.message ?? 'unknown error'}`); continue }
      const { data: { publicUrl } } = supabase.storage.from('wa-media').getPublicUrl(up.path)
      let thumbUrl: string | null = null
      if (thumb) {
        const { data: tup } = await supabase.storage.from('wa-media').upload(`${base}-thumb.jpg`, thumb, { upsert: false, contentType: 'image/jpeg' })
        if (tup) thumbUrl = supabase.storage.from('wa-media').getPublicUrl(tup.path).data.publicUrl
      }
      // first ever photo becomes the primary automatically
      const makePrimary = images.length === 0 && order === 0
      const { data: row } = await supabase.from('wa_product_images').insert({ product_id: id, image_url: publicUrl, thumb_url: thumbUrl, sort_order: order, is_primary: makePrimary }).select('*').single()
      if (row) setImages(prev => [...prev, row as WaProductImage])
      order++
    }
    setUploading(false)
  }

  async function setPrimary(img: WaProductImage) {
    await supabase.from('wa_product_images').update({ is_primary: false }).eq('product_id', id)
    await supabase.from('wa_product_images').update({ is_primary: true }).eq('id', img.id)
    setImages(prev => prev.map(i => ({ ...i, is_primary: i.id === img.id }))
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order))
  }

  async function deleteImage(img: WaProductImage) {
    await supabase.from('wa_product_images').delete().eq('id', img.id)
    const paths = [img.image_url, img.thumb_url]
      .map(u => u?.split('/wa-media/')[1]).filter(Boolean) as string[]
    if (paths.length) await supabase.storage.from('wa-media').remove(paths)
    const rest = images.filter(i => i.id !== img.id)
    // if we removed the primary, promote the next photo so a thumbnail still exists
    if (img.is_primary && rest.length > 0) {
      await supabase.from('wa_product_images').update({ is_primary: true }).eq('id', rest[0].id)
      rest[0] = { ...rest[0], is_primary: true }
    }
    setImages(rest)
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
          <h1 className="text-lg font-bold text-gray-900 truncate flex-1">{form.item_name || 'Product'}</h1>
          <button onClick={() => setPlanOpen(true)}
            className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold text-gray-700 border border-gray-300 px-3 py-1.5 rounded-lg active:bg-gray-50">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Plan
          </button>
          <button onClick={() => setShareOpen(true)}
            className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Share
          </button>
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
            <>
              <div className="flex flex-wrap gap-3">
                {images.map(img => (
                  <div key={img.id} className="relative">
                    <a href={img.image_url} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.image_url} alt="" className={`w-20 h-20 object-cover rounded-lg border-2 ${img.is_primary ? 'border-green-500' : 'border-gray-200'}`} />
                    </a>
                    <button onClick={() => deleteImage(img)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700 text-white rounded-full text-xs flex items-center justify-center">×</button>
                    {img.is_primary ? (
                      <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-white bg-green-600 px-1.5 py-0.5 rounded-full whitespace-nowrap">★ Primary</span>
                    ) : (
                      <button onClick={() => setPrimary(img)}
                        className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-medium text-gray-600 bg-white border border-gray-300 px-1.5 py-0.5 rounded-full whitespace-nowrap active:bg-gray-50">
                        Set primary
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400">The ★ primary photo is the thumbnail and the default image when sharing.</p>
            </>
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
          <Field label="Item name"><input list="opt-item_name" value={form.item_name} onChange={e => set('item_name', e.target.value)} className="input" /></Field>
          <Field label="Barcode"><input value={form.barcode} onChange={e => set('barcode', e.target.value)} className="input" /></Field>
          <div className="flex gap-3">
            <Field label="Weight (g)" className="flex-1"><input type="number" inputMode="decimal" step="0.001" value={form.weight} onChange={e => set('weight', e.target.value)} className="input" /></Field>
            <Field label="Purity" className="flex-1"><input list="opt-purity" value={form.purity} onChange={e => set('purity', e.target.value)} className="input" /></Field>
          </div>
          <Field label="Design"><input list="opt-design" value={form.design} onChange={e => set('design', e.target.value)} className="input" /></Field>
          <Field label="Description"><input list="opt-description" value={form.description} onChange={e => set('description', e.target.value)} className="input" /></Field>
          <Field label="Party (supplier)"><input list="opt-party" value={form.party} onChange={e => set('party', e.target.value)} className="input" /></Field>
          <Field label="Notes"><textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="input resize-none" /></Field>

          <datalist id="opt-item_name">{options.item_name.map(o => <option key={o} value={o} />)}</datalist>
          <datalist id="opt-design">{options.design.map(o => <option key={o} value={o} />)}</datalist>
          <datalist id="opt-description">{options.description.map(o => <option key={o} value={o} />)}</datalist>
          <datalist id="opt-purity">{options.purity.map(o => <option key={o} value={o} />)}</datalist>
          <datalist id="opt-party">{options.party.map(o => <option key={o} value={o} />)}</datalist>

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

      {shareOpen && product && (
        <ShareSheet
          product={{ ...product, item_name: form.item_name, design: form.design, purity: form.purity, weight: form.weight ? Number(form.weight) : null }}
          images={images}
          onClose={() => setShareOpen(false)}
        />
      )}

      {planOpen && product && (
        <AddToPlanSheet
          product={{ ...product, item_name: form.item_name, design: form.design, description: form.description, purity: form.purity, weight: form.weight ? Number(form.weight) : null }}
          onClose={() => setPlanOpen(false)}
        />
      )}
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
