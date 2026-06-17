'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { compressWithThumb } from '@/lib/image'
import { fetchCatalogueOptions, addCatalogueOptions, type Options } from '@/lib/catalogue'
import Navbar from '@/components/ui/Navbar'

export default function NewProductPage() {
  const supabase = createClient()
  const router = useRouter()

  const [form, setForm] = useState({ item_name: '', barcode: '', weight: '', purity: '22K', design: '', description: '', party: '', notes: '' })
  const [options, setOptions] = useState<Options>({ item_name: [], design: [], description: [], purity: [], party: [] })

  useEffect(() => { fetchCatalogueOptions().then(setOptions) }, [])
  const [files, setFiles]     = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  function set(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })) }

  function addFiles(list: FileList) {
    const imgs = Array.from(list).filter(f => f.type.startsWith('image/') && f.size <= 30 * 1024 * 1024)
    if (imgs.length === 0) { setError('That file is not a supported image (or is over 30 MB).'); return }
    setFiles(prev => [...prev, ...imgs])
    setPreviews(prev => [...prev, ...imgs.map(f => URL.createObjectURL(f))])
  }
  function removeFile(i: number) {
    URL.revokeObjectURL(previews[i])
    setFiles(prev => prev.filter((_, idx) => idx !== i))
    setPreviews(prev => prev.filter((_, idx) => idx !== i))
  }

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
        notes:       form.notes.trim() || null,
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

    // Upload photos under this product (full + small thumbnail, compressed client-side)
    let uploadFailed = false
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
      await supabase.from('wa_product_images').insert({ product_id: product.id, image_url: publicUrl, thumb_url: thumbUrl, sort_order: i })
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
        <div className="card p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-800">Photos</p>
          {previews.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {previews.map((src, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                  <button onClick={() => removeFile(i)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700 text-white rounded-full text-xs flex items-center justify-center">×</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
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
          <p className="text-xs text-gray-400">You can add more photos later too.</p>
        </div>

        {/* Details */}
        <div className="card p-4 space-y-3">
          <Field label="Item name">
            <input list="opt-item_name" value={form.item_name} onChange={e => set('item_name', e.target.value)} className="input" placeholder="Pick or type a new one" />
          </Field>
          <Field label="Barcode"><input value={form.barcode} onChange={e => set('barcode', e.target.value)} className="input" placeholder="Type or scan into this field" /></Field>
          <div className="flex gap-3">
            <Field label="Weight (g)" className="flex-1"><input type="number" inputMode="decimal" step="0.001" value={form.weight} onChange={e => set('weight', e.target.value)} className="input" placeholder="0.000" /></Field>
            <Field label="Purity" className="flex-1">
              <input list="opt-purity" value={form.purity} onChange={e => set('purity', e.target.value)} className="input" placeholder="22K" />
            </Field>
          </div>
          <Field label="Design"><input list="opt-design" value={form.design} onChange={e => set('design', e.target.value)} className="input" placeholder="Pick or type a new one" /></Field>
          <Field label="Description"><input list="opt-description" value={form.description} onChange={e => set('description', e.target.value)} className="input" placeholder="Pick or type a new one" /></Field>
          <Field label="Party (supplier)"><input list="opt-party" value={form.party} onChange={e => set('party', e.target.value)} className="input" placeholder="Pick or type a new one" /></Field>
          <Field label="Notes"><textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="input resize-none" placeholder="Anything else…" /></Field>

          {/* Dropdown value sources (typeable — new values are added on save) */}
          <datalist id="opt-item_name">{options.item_name.map(o => <option key={o} value={o} />)}</datalist>
          <datalist id="opt-design">{options.design.map(o => <option key={o} value={o} />)}</datalist>
          <datalist id="opt-description">{options.description.map(o => <option key={o} value={o} />)}</datalist>
          <datalist id="opt-purity">{options.purity.map(o => <option key={o} value={o} />)}</datalist>
          <datalist id="opt-party">{options.party.map(o => <option key={o} value={o} />)}</datalist>
        </div>

        <button onClick={save} disabled={saving} className="btn-primary w-full disabled:opacity-60">
          {saving ? 'Saving…' : 'Save product'}
        </button>
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
