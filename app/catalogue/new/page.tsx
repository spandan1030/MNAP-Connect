'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { compressWithThumb, renderCrop, type CropRect } from '@/lib/image'
import { fetchCatalogueOptions, addCatalogueOptions, type Options } from '@/lib/catalogue'
import Navbar from '@/components/ui/Navbar'
import ImageCropper from '@/components/catalogue/ImageCropper'
import Link from 'next/link'
import BarcodeLookup, { type LookupResult } from '@/components/catalogue/BarcodeLookup'

export default function NewProductPage() {
  const supabase = createClient()
  const router = useRouter()

  const [form, setForm] = useState({ item_name: '', barcode: '', weight: '', purity: '22K', design: '', description: '', party: '', notes: '' })
  const [catalogueOnly, setCatalogueOnly] = useState(false)
  const [options, setOptions] = useState<Options>({ item_name: [], design: [], description: [], purity: [], party: [] })
  // Set when a barcode was picked from the inventory master — drives party_id / stock_status
  // on save and lets us learn the item name if the salesman names an unmapped item.
  const [inv, setInv] = useState<{ itmId: number | null; partyId: number | null; stockStatus: LookupResult['stockStatus']; cleanNameAtPick: string | null; itemNameRaw: string | null } | null>(null)
  const [existing, setExisting] = useState<string | null>(null) // productId if the picked barcode is already a card

  function onPickBarcode(r: LookupResult) {
    setForm(f => ({
      ...f,
      barcode: r.barcode,
      weight: r.weight != null ? String(r.weight) : f.weight,
      purity: r.cleanPurity || f.purity,
      item_name: r.cleanName || f.item_name, // unmapped → leave whatever they typed; they'll name it (and we learn)
    }))
    setInv({ itmId: r.itmId, partyId: r.partyId, stockStatus: r.stockStatus, cleanNameAtPick: r.cleanName, itemNameRaw: r.itemNameRaw })
    setExisting(r.existsAsProduct ? r.productId : null)
  }

  useEffect(() => { fetchCatalogueOptions().then(setOptions) }, [])
  const [files, setFiles]     = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [crops, setCrops]     = useState<(CropRect | null)[]>([]) // 4:5 crop per file (null = auto-centre)
  const [cropIdx, setCropIdx] = useState<number | null>(null)     // photo currently being cropped
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  function set(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })) }

  function addFiles(list: FileList | File[]) {
    const imgs = Array.from(list).filter(f => f.type.startsWith('image/') && f.size <= 30 * 1024 * 1024)
    if (imgs.length === 0) { setError('That file is not a supported image (or is over 30 MB).'); return }
    setFiles(prev => [...prev, ...imgs])
    setPreviews(prev => [...prev, ...imgs.map(f => URL.createObjectURL(f))])
    setCrops(prev => [...prev, ...imgs.map(() => null)])
  }
  function removeFile(i: number) {
    URL.revokeObjectURL(previews[i])
    setFiles(prev => prev.filter((_, idx) => idx !== i))
    setPreviews(prev => prev.filter((_, idx) => idx !== i))
    setCrops(prev => prev.filter((_, idx) => idx !== i))
  }

  // Drag-drop onto the Photos card, and paste (Ctrl/⌘+V) anywhere on the page —
  // handy on a laptop where camera/gallery pickers are awkward.
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const imgs = Array.from(e.clipboardData?.items ?? [])
        .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
        .map(it => it.getAsFile())
        .filter((f): f is File => !!f)
      if (imgs.length) { e.preventDefault(); addFiles(imgs) }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    if (!form.item_name.trim() && !form.barcode.trim() && files.length === 0) {
      setError('Add at least an item name, a barcode, or a photo.')
      return
    }
    setSaving(true); setError(null)
    const { data: { user } } = await supabase.auth.getUser()

    const { data: product, error: insErr } = await supabase
      .from('wa_products')
      .insert({
        item_name:   form.item_name.trim() || null,
        barcode:     form.barcode.trim() || null,
        weight:      form.weight ? Number(form.weight) : null,
        purity:      form.purity.trim() || null,
        design:      form.design.trim() || null,
        description: form.description.trim() || null,
        party:       form.party.trim() || null,
        party_id:    inv?.partyId ?? null,
        notes:       form.notes.trim() || null,
        is_catalogue_only: catalogueOnly,
        // Reflect the piece's inventory status when it was added from a barcode.
        ...(inv?.stockStatus ? { stock_status: inv.stockStatus, is_sold: inv.stockStatus === 'sold' } : {}),
        created_by: user?.id ?? null,
      })
      .select('id').single()

    if (insErr || !product) {
      setError(insErr?.code === '23505' ? 'A product with this barcode already exists.' : (insErr?.message ?? 'Could not save'))
      setSaving(false); return
    }

    // Make any newly-typed values available in future dropdowns
    await addCatalogueOptions([
      { field: 'item_name',   value: form.item_name },
      { field: 'design',      value: form.design },
      { field: 'description', value: form.description },
      { field: 'purity',      value: form.purity },
      { field: 'party',       value: form.party },
    ])

    // Learn the item name: if this barcode's ITM_ID had no clean name (or the salesman
    // changed it), remember their choice so it prefills next time (source='manual').
    const chosen = form.item_name.trim()
    if (inv?.itmId != null && chosen && chosen !== inv.cleanNameAtPick) {
      await supabase.from('wa_item_name_map').upsert({
        itm_id: inv.itmId, clean_name: chosen, source: 'manual',
        sample_raw: inv.itemNameRaw, updated_by: user?.id ?? null, updated_at: new Date().toISOString(),
      }, { onConflict: 'itm_id' }).then(({ error }) => { if (error) console.error('[catalogue] learn name failed', error) })
    }

    // Upload photos under this product. We keep the original (full + thumb) AND a
    // 4:5-cropped display image (full + thumb) that the customer app is fed.
    let uploadFailed = false
    const insertedImageIds: string[] = []
    for (let i = 0; i < files.length; i++) {
      const { full, thumb } = await compressWithThumb(files[i])
      const base = `products/${product.id}/${Date.now()}-${i}`
      const { data: up, error: upErr } = await supabase.storage.from('wa-media').upload(`${base}.jpg`, full, { upsert: false, contentType: 'image/jpeg' })
      if (upErr || !up) { uploadFailed = true; console.error('[catalogue] upload failed:', upErr); continue }
      const { data: { publicUrl } } = supabase.storage.from('wa-media').getPublicUrl(up.path)
      let thumbUrl: string | null = null
      if (thumb) {
        const { data: tup } = await supabase.storage.from('wa-media').upload(`${base}-thumb.jpg`, thumb, { upsert: false, contentType: 'image/jpeg' })
        if (tup) thumbUrl = supabase.storage.from('wa-media').getPublicUrl(tup.path).data.publicUrl
      }
      // 4:5 crop (uses the chosen frame, or a centred default) for the customer app
      let displayUrl: string | null = null, displayThumbUrl: string | null = null
      const cropped = await renderCrop(files[i], crops[i])
      if (cropped) {
        const { data: cup } = await supabase.storage.from('wa-media').upload(`${base}-4x5.jpg`, cropped.display, { upsert: false, contentType: 'image/jpeg' })
        if (cup) displayUrl = supabase.storage.from('wa-media').getPublicUrl(cup.path).data.publicUrl
        const { data: ctup } = await supabase.storage.from('wa-media').upload(`${base}-4x5-thumb.jpg`, cropped.thumb, { upsert: false, contentType: 'image/jpeg' })
        if (ctup) displayThumbUrl = supabase.storage.from('wa-media').getPublicUrl(ctup.path).data.publicUrl
      }
      const { data: row } = await supabase.from('wa_product_images').insert({
        product_id: product.id, image_url: publicUrl, thumb_url: thumbUrl,
        display_url: displayUrl, display_thumb_url: displayThumbUrl, crop: crops[i], sort_order: i,
      }).select('id').single()
      if (row) insertedImageIds.push(row.id as string)
    }

    // The latest uploaded photo becomes the primary/cover by default (and is
    // publish-ready), so the newest shot leads instead of the first one.
    const primaryId = insertedImageIds[insertedImageIds.length - 1]
    if (primaryId) {
      await supabase.from('wa_product_images').update({ is_primary: true, in_app: true }).eq('id', primaryId)
    }

    if (uploadFailed) {
      // Product saved, but photos didn't upload — send them to the edit page to retry
      setError('Saved, but a photo failed to upload. Opening the product so you can re-add photos.')
      setTimeout(() => router.push(`/catalogue/${product.id}`), 1200)
      return
    }
    router.push(`/catalogue/${product.id}`)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
          <h1 className="text-lg font-bold text-gray-900">Add product</h1>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        {/* Photos */}
        <div className="card p-4 space-y-3"
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}>
          <p className="text-sm font-semibold text-gray-800">Photos</p>
          {previews.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {previews.map((src, i) => (
                <div key={i} className="relative w-16">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="w-16 aspect-[4/5] object-cover rounded-lg border border-gray-200" />
                  <button onClick={() => removeFile(i)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700 text-white rounded-full text-xs flex items-center justify-center">×</button>
                  <button onClick={() => setCropIdx(i)}
                    className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-semibold text-gray-700 bg-white/90 border border-gray-300 px-1.5 py-0.5 rounded-full whitespace-nowrap active:bg-white">
                    {crops[i] ? '✓ Cropped' : 'Crop'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className={`flex gap-2 rounded-xl ${dragOver ? 'ring-2 ring-green-500 ring-offset-2' : ''}`}>
            <label className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 cursor-pointer active:bg-gray-50">
              📷 Take photo
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
            </label>
            <label className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 cursor-pointer active:bg-gray-50">
              🖼 Gallery
              <input type="file" accept="image/*" multiple className="hidden"
                onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
            </label>
          </div>
          <p className="text-xs text-gray-400">Drag &amp; drop a file or paste (Ctrl/⌘+V) an image here. Photos show at 4:5 — tap Crop to reposition. You can add more later too.</p>
        </div>

        {/* Details */}
        <div className="card p-4 space-y-3">
          <Field label="Item name">
            <input list="opt-item_name" value={form.item_name} onChange={e => set('item_name', e.target.value)} className="input" placeholder="Pick or type a new one" />
          </Field>
          <Field label="Barcode">
            <BarcodeLookup
              value={form.barcode}
              onChange={v => { set('barcode', v); setInv(null); setExisting(null) }}
              onPick={onPickBarcode}
              placeholder="Type or scan — prefills from inventory"
            />
            {inv && !existing && (
              <p className="text-[11px] text-green-700 mt-1">
                ✓ Prefilled from inventory{inv.stockStatus ? ` · ${inv.stockStatus.replace('_', ' ')}` : ''}
                {inv.itmId != null && !inv.cleanNameAtPick && <span className="text-amber-700"> · name unmapped — the name you enter will be learned</span>}
              </p>
            )}
            {existing && (
              <p className="text-[11px] text-red-600 mt-1">
                This barcode is already a product. <Link href={`/catalogue/${existing}`} className="underline font-medium">Open it</Link> instead of adding a duplicate.
              </p>
            )}
          </Field>
          <div className="flex gap-3">
            <Field label="Weight (g)" className="flex-1"><input type="number" inputMode="decimal" step="0.001" value={form.weight} onChange={e => set('weight', e.target.value)} className="input" placeholder="0.000" /></Field>
            <Field label="Purity" className="flex-1">
              <input list="opt-purity" value={form.purity} onChange={e => set('purity', e.target.value)} className="input" placeholder="22K" />
            </Field>
          </div>
          <Field label="Design"><input list="opt-design" value={form.design} onChange={e => set('design', e.target.value)} className="input" placeholder="Pick or type a new one" /></Field>
          <Field label="Description"><input list="opt-description" value={form.description} onChange={e => set('description', e.target.value)} className="input" placeholder="Pick or type a new one" /></Field>
          <Field label="Party (supplier)"><input list="opt-party" value={form.party} onChange={e => set('party', e.target.value)} className="input" placeholder="Pick or type a new one" /></Field>
          {inv?.partyId != null && (
            <p className="text-[11px] text-gray-400 -mt-1.5">From inventory · supplier id <span className="font-mono text-gray-600">#{inv.partyId}</span> — saved with the piece (name mapping later).</p>
          )}
          <Field label="Notes"><textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="input resize-none" placeholder="Anything else…" /></Field>

          {/* Dropdown value sources (typeable — new values are added on save) */}
          <datalist id="opt-item_name">{options.item_name.map(o => <option key={o} value={o} />)}</datalist>
          <datalist id="opt-design">{options.design.map(o => <option key={o} value={o} />)}</datalist>
          <datalist id="opt-description">{options.description.map(o => <option key={o} value={o} />)}</datalist>
          <datalist id="opt-purity">{options.purity.map(o => <option key={o} value={o} />)}</datalist>
          <datalist id="opt-party">{options.party.map(o => <option key={o} value={o} />)}</datalist>

          <label className="flex items-start gap-2 text-sm text-gray-700 pt-1">
            <input type="checkbox" checked={catalogueOnly} onChange={e => setCatalogueOnly(e.target.checked)} className="mt-0.5" />
            <span>Catalogue product <span className="text-gray-400">(design only — not a physical in-stock piece; kept out of inventory)</span></span>
          </label>
        </div>

        <button onClick={save} disabled={saving} className="btn-primary w-full disabled:opacity-60">
          {saving ? 'Saving…' : 'Save product'}
        </button>
      </main>

      {cropIdx !== null && files[cropIdx] && (
        <ImageCropper
          source={files[cropIdx]}
          initial={crops[cropIdx]}
          onCancel={() => setCropIdx(null)}
          onConfirm={crop => { setCrops(prev => prev.map((c, idx) => idx === cropIdx ? crop : c)); setCropIdx(null) }}
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
