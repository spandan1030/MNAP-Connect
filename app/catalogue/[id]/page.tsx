'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { compressWithThumb, renderCrop, type CropRect } from '@/lib/image'
import { fetchCatalogueOptions, addCatalogueOptions, type Options } from '@/lib/catalogue'
import Navbar from '@/components/ui/Navbar'
import ShareSheet from '@/components/catalogue/ShareSheet'
import AddToPlanSheet from '@/components/catalogue/AddToPlanSheet'
import ImageCropper from '@/components/catalogue/ImageCropper'
import type { WaProduct, WaProductImage } from '@/lib/types'

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const supabase = createClient()
  const router = useRouter()

  const [form, setForm]   = useState({ item_name: '', barcode: '', weight: '', purity: '', design: '', description: '', party: '', notes: '', is_active: true })
  const [options, setOptions] = useState<Options>({ item_name: [], design: [], description: [], purity: [], party: [] })
  const [isSold, setIsSold] = useState(false)
  const [catalogueOnly, setCatalogueOnly] = useState(false)
  const [needsReview, setNeedsReview] = useState(false)
  const [showInApp, setShowInApp] = useState(false)
  const [makingPercent, setMakingPercent] = useState('9') // % of metal; prefilled
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
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
  const [dragOver, setDragOver] = useState(false)
  const [cropImg, setCropImg] = useState<WaProductImage | null>(null) // existing photo being re-cropped

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
        setCatalogueOnly(Boolean(p.is_catalogue_only))
        setNeedsReview(p.needs_review)
        setShowInApp(Boolean(p.show_in_app))
        if (p.making_percent != null) setMakingPercent(String(p.making_percent))
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
      is_catalogue_only: catalogueOnly,
      making_percent: makingPercent.trim() ? Number(makingPercent) : null,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setSaving(false)
    if (e) { setError(e.code === '23505' ? 'A product with this barcode already exists.' : e.message); return }
    await addCatalogueOptions([
      { field: 'item_name', value: form.item_name }, { field: 'design', value: form.design },
      { field: 'description', value: form.description }, { field: 'purity', value: form.purity }, { field: 'party', value: form.party },
    ])
    setSaved(true); setTimeout(() => setSaved(false), 2000)
    // Keep the customer app in sync with the just-saved details (price/making/etc.)
    if (showInApp) syncToApp()
  }

  // Push this product's current state to the customer app. `override` lets the
  // caller force a sync even before React state has updated (e.g. on toggle).
  async function syncToApp(override?: { show_in_app?: boolean }) {
    setSyncing(true); setSyncMsg(null)
    try {
      const res = await fetch('/api/catalogue/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      const on = override?.show_in_app ?? showInApp
      if (!on) setSyncMsg('Removed from customer app.')
      else if (data.priceHidden) setSyncMsg('Published — but purity isn’t a known karat, so the app will show “Enquire” instead of a price.')
      else setSyncMsg('Published to customer app ✓')
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  // Toggle "show in customer app" — persists immediately, then syncs.
  async function toggleShowInApp() {
    const v = !showInApp; setShowInApp(v)
    await supabase.from('wa_products').update({
      show_in_app: v,
      making_percent: makingPercent.trim() ? Number(makingPercent) : null,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    await syncToApp({ show_in_app: v })
  }

  // Status flags update immediately (no Save needed) — quick during a sale / QC
  async function toggleSold() {
    const v = !isSold; setIsSold(v)
    await supabase.from('wa_products').update({ is_sold: v, updated_at: new Date().toISOString() }).eq('id', id)
    if (showInApp) syncToApp() // sold ⇄ in-stock changes visibility in the app
  }
  async function toggleReview() {
    const v = !needsReview; setNeedsReview(v)
    await supabase.from('wa_products').update({ needs_review: v }).eq('id', id)
  }
  // Catalogue (design-only) ⇄ stock piece. Persists immediately; re-syncs the app
  // (the flag flips inStock + catalogueOnly on the published doc).
  async function toggleCatalogueOnly() {
    const v = !catalogueOnly; setCatalogueOnly(v)
    await supabase.from('wa_products').update({ is_catalogue_only: v, updated_at: new Date().toISOString() }).eq('id', id)
    if (showInApp) syncToApp()
  }

  async function addPhotos(list: FileList | File[]) {
    setUploading(true); setError(null)
    const imgs = Array.from(list).filter(f => f.type.startsWith('image/') && f.size <= 30 * 1024 * 1024)
    let order = images.length
    const addedImages: WaProductImage[] = []
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
      // 4:5 crop (centred by default) for the customer app
      let displayUrl: string | null = null, displayThumbUrl: string | null = null
      const cropped = await renderCrop(raw)
      if (cropped) {
        const { data: cup } = await supabase.storage.from('wa-media').upload(`${base}-4x5.jpg`, cropped.display, { upsert: false, contentType: 'image/jpeg' })
        if (cup) displayUrl = supabase.storage.from('wa-media').getPublicUrl(cup.path).data.publicUrl
        const { data: ctup } = await supabase.storage.from('wa-media').upload(`${base}-4x5-thumb.jpg`, cropped.thumb, { upsert: false, contentType: 'image/jpeg' })
        if (ctup) displayThumbUrl = supabase.storage.from('wa-media').getPublicUrl(ctup.path).data.publicUrl
      }
      // Insert not-primary for now; the newest of this batch is promoted below.
      const { data: row } = await supabase.from('wa_product_images').insert({
        product_id: id, image_url: publicUrl, thumb_url: thumbUrl,
        display_url: displayUrl, display_thumb_url: displayThumbUrl, crop: null,
        sort_order: order, is_primary: false, in_app: false,
      }).select('*').single()
      if (row) { addedImages.push(row as WaProductImage); setImages(prev => [...prev, row as WaProductImage]) }
      order++
    }

    // The latest uploaded photo becomes the primary/cover by default (and is
    // publish-ready), overriding any previous primary. Staff can re-pick manually.
    const newPrimary = addedImages[addedImages.length - 1]
    if (newPrimary) {
      await supabase.from('wa_product_images').update({ is_primary: false }).eq('product_id', id)
      await supabase.from('wa_product_images').update({ is_primary: true, in_app: true }).eq('id', newPrimary.id)
      setImages(prev => prev
        .map(i => i.id === newPrimary.id
          ? { ...i, is_primary: true, in_app: true }
          : { ...i, is_primary: false })
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order))
    }

    setUploading(false)
    if (showInApp) syncToApp() // the newest photo became primary
  }

  // Drag-drop onto the Photos card + paste (Ctrl/⌘+V) — laptop convenience.
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files?.length) addPhotos(e.dataTransfer.files)
  }
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const imgs = Array.from(e.clipboardData?.items ?? [])
        .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
        .map(it => it.getAsFile())
        .filter((f): f is File => !!f)
      if (imgs.length) { e.preventDefault(); addPhotos(imgs) }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length])

  // Re-crop an existing photo: regenerate the 4:5 display from the original, swap
  // in the new files (deleting the old display files), and re-sync if it's live.
  async function applyCrop(img: WaProductImage, crop: CropRect, decoded: HTMLImageElement) {
    setError(null)
    const cropped = await renderCrop(decoded, crop)
    if (!cropped) { setError('Could not crop this image.'); return }
    const base = `products/${id}/${Date.now()}-crop`
    const { data: cup, error: cErr } = await supabase.storage.from('wa-media').upload(`${base}-4x5.jpg`, cropped.display, { upsert: false, contentType: 'image/jpeg' })
    if (cErr || !cup) { setError(`Crop upload failed: ${cErr?.message ?? 'unknown error'}`); return }
    const displayUrl = supabase.storage.from('wa-media').getPublicUrl(cup.path).data.publicUrl
    let displayThumbUrl: string | null = null
    const { data: ctup } = await supabase.storage.from('wa-media').upload(`${base}-4x5-thumb.jpg`, cropped.thumb, { upsert: false, contentType: 'image/jpeg' })
    if (ctup) displayThumbUrl = supabase.storage.from('wa-media').getPublicUrl(ctup.path).data.publicUrl

    await supabase.from('wa_product_images').update({ display_url: displayUrl, display_thumb_url: displayThumbUrl, crop }).eq('id', img.id)
    // remove the superseded display files (keep the original intact)
    const stale = [img.display_url, img.display_thumb_url]
      .map(u => u?.split('/wa-media/')[1]).filter(Boolean) as string[]
    if (stale.length) await supabase.storage.from('wa-media').remove(stale)

    setImages(prev => prev.map(i => i.id === img.id ? { ...i, display_url: displayUrl, display_thumb_url: displayThumbUrl, crop } : i))
    if (showInApp && img.is_primary) syncToApp() // the app is fed the crop
  }

  // Publish / unpublish a single photo to the customer-app gallery. The primary is
  // always sent regardless, so this only adds/removes the extra angles.
  async function toggleInApp(img: WaProductImage) {
    const v = !img.in_app
    setImages(prev => prev.map(i => i.id === img.id ? { ...i, in_app: v } : i))
    await supabase.from('wa_product_images').update({ in_app: v }).eq('id', img.id)
    if (showInApp) syncToApp()
  }

  async function setPrimary(img: WaProductImage) {
    await supabase.from('wa_product_images').update({ is_primary: false }).eq('product_id', id)
    await supabase.from('wa_product_images').update({ is_primary: true }).eq('id', img.id)
    setImages(prev => prev.map(i => ({ ...i, is_primary: i.id === img.id }))
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order))
    if (showInApp) syncToApp() // the app publishes only the primary photo
  }

  async function deleteImage(img: WaProductImage) {
    await supabase.from('wa_product_images').delete().eq('id', img.id)
    const paths = [img.image_url, img.thumb_url, img.display_url, img.display_thumb_url]
      .map(u => u?.split('/wa-media/')[1]).filter(Boolean) as string[]
    if (paths.length) await supabase.storage.from('wa-media').remove(paths)
    const rest = images.filter(i => i.id !== img.id)
    // if we removed the primary, promote the next photo so a thumbnail still exists
    if (img.is_primary && rest.length > 0) {
      await supabase.from('wa_product_images').update({ is_primary: true }).eq('id', rest[0].id)
      rest[0] = { ...rest[0], is_primary: true }
    }
    setImages(rest)
    if (showInApp && img.is_primary) syncToApp() // primary photo changed
  }

  async function deleteProduct() {
    // Route through the bulk API so it also removes the customer-app doc and the
    // photo storage objects — not just the row.
    try {
      const res = await fetch('/api/catalogue/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id], action: 'delete' }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Delete failed') }
      router.push('/catalogue')
    } catch (e) {
      setConfirmDelete(false)
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
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
        <div className="card p-3 space-y-2">
          <div className="flex gap-2">
            <button onClick={toggleSold} disabled={catalogueOnly}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-40 ${
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
          <button onClick={toggleCatalogueOnly}
            className={`w-full py-2 rounded-xl text-sm font-semibold border transition-colors ${
              catalogueOnly ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-gray-600 border-gray-300'
            }`}>
            {catalogueOnly ? '◆ Catalogue product (design only)' : '◇ Mark as catalogue product'}
          </button>
          {catalogueOnly && (
            <p className="text-[11px] text-gray-400">Design-only — kept out of inventory. Still publishes to the app as a normal product with a live price, tagged as catalogue.</p>
          )}
        </div>

        {/* Photos */}
        <div className="card p-4 space-y-3"
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}>
          <p className="text-sm font-semibold text-gray-800">Photos</p>
          {images.length > 0 && (
            <>
              <div className="flex flex-wrap gap-3">
                {images.map(img => (
                  <div key={img.id} className="w-20">
                    <div className="relative">
                      <a href={img.image_url} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.display_url ?? img.image_url} alt="" className={`w-20 aspect-[4/5] object-cover rounded-lg border-2 ${img.is_primary ? 'border-green-500' : 'border-gray-200'}`} />
                      </a>
                      <button onClick={() => deleteImage(img)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700 text-white rounded-full text-xs flex items-center justify-center">×</button>
                      <button onClick={() => setCropImg(img)}
                        className="absolute top-1 left-1 text-[9px] font-semibold text-gray-700 bg-white/90 border border-gray-300 px-1.5 py-0.5 rounded-full active:bg-white">
                        Crop
                      </button>
                      {img.is_primary ? (
                        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-white bg-green-600 px-1.5 py-0.5 rounded-full whitespace-nowrap">★ Primary</span>
                      ) : (
                        <button onClick={() => setPrimary(img)}
                          className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-medium text-gray-600 bg-white border border-gray-300 px-1.5 py-0.5 rounded-full whitespace-nowrap active:bg-gray-50">
                          Set primary
                        </button>
                      )}
                    </div>
                    <button onClick={() => toggleInApp(img)} disabled={img.is_primary}
                      className={`mt-2.5 w-full text-[9px] font-semibold px-1 py-1 rounded-lg border whitespace-nowrap disabled:opacity-100 ${
                        img.in_app ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-gray-500 border-gray-300 active:bg-gray-50'
                      }`}>
                      {img.in_app ? '✓ In app' : '+ Publish'}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400">Shown at 4:5 (what customers see) — tap Crop to reposition. ★ Primary is the cover (thumbnail + first photo, always in the app). Tap <b>+ Publish</b> to add more photos to the customer app gallery; tap a photo to view the original.</p>
            </>
          )}
          <div className={`flex gap-2 rounded-xl ${dragOver ? 'ring-2 ring-green-500 ring-offset-2' : ''}`}>
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
          <p className="text-xs text-gray-400">Drag &amp; drop a file or paste (Ctrl/⌘+V) an image here.</p>
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

        {/* Customer app — publish this product to the customer-facing catalogue */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-800">Customer app</p>
              <p className="text-[11px] text-gray-400">Show this product to customers. The gallery uses the ★ primary plus any photos marked <b>In app</b> ({images.filter(i => i.in_app || i.is_primary).length} photo{images.filter(i => i.in_app || i.is_primary).length === 1 ? '' : 's'}); price is computed live from the daily rate.</p>
            </div>
            <button onClick={toggleShowInApp} disabled={syncing}
              className={`ml-3 flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:opacity-50 ${showInApp ? 'justify-end bg-green-500' : 'justify-start bg-gray-300'}`}>
              <span className="h-5 w-5 rounded-full bg-white shadow" />
            </button>
          </div>
          <Field label="Making charge (% of metal)">
            <input type="number" inputMode="decimal" step="0.1" value={makingPercent}
              onChange={e => setMakingPercent(e.target.value)} className="input" placeholder="9" />
          </Field>
          {images.every(i => !i.is_primary) && images.length > 0 && (
            <p className="text-[11px] text-amber-600">No primary photo set — pick one above so the app has an image.</p>
          )}
          {showInApp && images.length === 0 && (
            <p className="text-[11px] text-amber-600">This product has no photo — add one so it looks good in the app.</p>
          )}
          {syncMsg && <p className={`text-[11px] ${syncMsg.includes('✓') || syncMsg.includes('Removed') ? 'text-green-700' : 'text-amber-600'}`}>{syncMsg}</p>}
          <p className="text-[11px] text-gray-400">Making %, name, weight, purity and photo re-sync automatically when you save or change stock status.</p>
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

      {cropImg && (
        <ImageCropper
          source={cropImg.image_url}
          initial={cropImg.crop}
          onCancel={() => setCropImg(null)}
          onConfirm={(crop, decoded) => { const target = cropImg; setCropImg(null); applyCrop(target, crop, decoded) }}
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
