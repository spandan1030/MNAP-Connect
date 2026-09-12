'use client'

// Catalogue taxonomy control (from connect). Two tabs:
//  · Categories  — "Shop by category" sections, matched to products by Item Name.
//  · Filter tags — curated (assigned per product, from the Catalogue grid's bulk
//                  "Tag" action) or computed (a live amount / weight rule).
// Everything here writes the customer app's Firestore via /api/catalogue/tags.
// Per-product curated assignment lives on the Catalogue page (bulk-select → Tag).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Navbar from '@/components/ui/Navbar'
import { DEFAULT_TAG_TOLERANCE_PCT, type AppCategory, type AppCatalogueTag, type TagKind, type TagMetric } from '@/lib/catalogue-tag-types'

const BLANK_CAT = { label: '', thumb: '', matchText: '', order: 0, active: true }
const BLANK_TAG = {
  label: '', kind: 'curated' as TagKind, order: 0, active: true,
  scope: '', metric: 'amountMax' as TagMetric, amountMax: 0, weightMin: 0, weightMax: 0,
  tolerancePct: DEFAULT_TAG_TOLERANCE_PCT,
}

export default function CatalogueTagsPage() {
  const [tab, setTab] = useState<'categories' | 'tags'>('categories')
  const [cats, setCats] = useState<AppCategory[]>([])
  const [tags, setTags] = useState<AppCatalogueTag[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/catalogue/tags')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setCats(data.categories ?? [])
      setTags(data.tags ?? [])
      // count how many products carry each curated tag
      const c: Record<string, number> = {}
      for (const ids of Object.values((data.productTags ?? {}) as Record<string, string[]>))
        for (const t of ids) c[t] = (c[t] ?? 0) + 1
      setCounts(c)
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function post(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/catalogue/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')
      await load()
      return true
    } catch (e) { setError((e as Error).message); return false }
    finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-28">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Catalogue tags</h1>
            <p className="text-xs text-gray-500">Categories &amp; filter chips for the customer app. To tag many products at once, use the <Link href="/catalogue" className="text-green-700 underline">Catalogue</Link> grid → select → Tag.</p>
          </div>
          <Link href="/catalogue" className="btn-secondary shrink-0 text-sm">← Catalogue</Link>
        </div>

        <div className="flex gap-1.5">
          {(['categories', 'tags'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-sm border font-medium ${tab === t ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'}`}>
              {t === 'categories' ? 'Categories' : 'Filter tags'}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        {loading ? <p className="text-sm text-gray-500">Loading…</p>
          : tab === 'categories'
            ? <Categories cats={cats} busy={busy} post={post} />
            : <Tags tags={tags} cats={cats} counts={counts} busy={busy} post={post} />}
      </main>
    </div>
  )
}

// ── Categories ────────────────────────────────────────────────────────────────

function Categories({ cats, busy, post }: {
  cats: AppCategory[]; busy: boolean; post: (p: Record<string, unknown>) => Promise<boolean>
}) {
  const [editing, setEditing] = useState<AppCategory | null>(null)
  const [form, setForm] = useState({ ...BLANK_CAT })
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }))

  function startNew() { setEditing(null); setForm({ ...BLANK_CAT, order: cats.length }) }
  function startEdit(c: AppCategory) {
    setEditing(c)
    setForm({ label: c.label, thumb: c.thumb, matchText: c.matchStrings.join(', '), order: c.order, active: c.active })
  }
  async function save() {
    if (!form.label.trim()) return
    const matchStrings = form.matchText.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
    const ok = await post({ action: 'saveCategory', category: {
      id: editing?.id, label: form.label, thumb: form.thumb, matchStrings,
      order: Number(form.order) || 0, active: form.active, featured: editing?.featured ?? false,
    } })
    if (ok) { setForm({ ...BLANK_CAT }); setEditing(null) }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">Sections in the customer &ldquo;Shop by category&rdquo; rail. Products join a category automatically when their <b>Item Name</b> contains any match string.</p>

      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-800">{editing ? `Edit “${editing.label}”` : 'New category'}</p>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Name (shown on the rail)</label>
          <input className="input" placeholder="e.g. Necklaces" value={form.label} onChange={e => set('label', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Match strings (comma-separated)</label>
          <input className="input" placeholder="Har, Necklace, Rani Haar" value={form.matchText} onChange={e => set('matchText', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Thumbnail URL (optional)</label>
          <input className="input" placeholder="https://…  (or set the image from the customer admin)" value={form.thumb} onChange={e => set('thumb', e.target.value)} />
        </div>
        <div className="flex items-center gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Order</label>
            <input type="number" className="input w-24" value={form.order} onChange={e => set('order', Number(e.target.value))} />
          </div>
          <label className="mt-5 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} /> Active
          </label>
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className="btn-primary disabled:opacity-60">{editing ? 'Save changes' : 'Add category'}</button>
          <button onClick={startNew} className="btn-secondary">Clear</button>
        </div>
      </div>

      <div className="space-y-2">
        {cats.map(c => (
          <div key={c.id} className="card flex items-center gap-3 p-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f6efdd]">
              {c.thumb
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={c.thumb} alt="" className="h-full w-full object-cover" />
                : <span className="text-brand font-semibold">{c.label.charAt(0).toUpperCase()}</span>}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-900">{c.label}</span>
                {c.featured && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Featured</span>}
                {!c.active && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">Hidden</span>}
              </div>
              <div className="truncate text-[11px] text-gray-500">
                {c.matchStrings.length ? c.matchStrings.join(' · ') : <span className="text-red-500">no match strings</span>} · order {c.order}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
              <button disabled={busy} onClick={() => post({ action: 'featureCategory', featuredId: c.featured ? '' : c.id })}
                className={c.featured ? 'text-amber-600' : 'text-gray-400'}>
                {c.featured ? '★ Featured' : '☆ Feature'}
              </button>
              <div className="flex gap-2">
                <button onClick={() => startEdit(c)} className="text-green-700">Edit</button>
                <button disabled={busy} onClick={() => { if (confirm(`Delete category “${c.label}”?`)) post({ action: 'deleteCategory', id: c.id }) }} className="text-red-600">Delete</button>
              </div>
            </div>
          </div>
        ))}
        {cats.length === 0 && <p className="text-sm text-gray-500">No categories yet.</p>}
      </div>
    </div>
  )
}

// ── Filter tags ───────────────────────────────────────────────────────────────

function Tags({ tags, cats, counts, busy, post }: {
  tags: AppCatalogueTag[]; cats: AppCategory[]; counts: Record<string, number>
  busy: boolean; post: (p: Record<string, unknown>) => Promise<boolean>
}) {
  const [editing, setEditing] = useState<AppCatalogueTag | null>(null)
  const [form, setForm] = useState({ ...BLANK_TAG })
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }))

  function startNew() { setEditing(null); setForm({ ...BLANK_TAG, order: tags.length }) }
  function startEdit(t: AppCatalogueTag) {
    setEditing(t)
    setForm({
      label: t.label, kind: t.kind, order: t.order, active: t.active,
      scope: t.scope ?? '', metric: t.metric ?? 'amountMax',
      amountMax: t.amountMax ?? 0, weightMin: t.weightMin ?? 0, weightMax: t.weightMax ?? 0,
      tolerancePct: t.tolerancePct ?? DEFAULT_TAG_TOLERANCE_PCT,
    })
  }
  async function save() {
    if (!form.label.trim()) return
    const ok = await post({ action: 'saveTag', tag: {
      id: editing?.id, label: form.label, kind: form.kind, order: Number(form.order) || 0, active: form.active,
      scope: form.scope, metric: form.metric,
      amountMax: Number(form.amountMax) || 0, weightMin: Number(form.weightMin) || 0, weightMax: Number(form.weightMax) || 0,
      tolerancePct: Number(form.tolerancePct) || DEFAULT_TAG_TOLERANCE_PCT,
    } })
    if (ok) { setForm({ ...BLANK_TAG }); setEditing(null) }
  }

  const scopeLabel = (id?: string) => (id && id !== 'all' ? cats.find(c => c.id === id)?.label ?? '?' : 'All products')
  const ruleText = (t: AppCatalogueTag) => {
    if (t.kind === 'curated') return 'Curated · assign from the Catalogue grid'
    const scope = scopeLabel(t.scope)
    if (t.metric === 'amountMax') return `${scope} · under ₹${(t.amountMax ?? 0).toLocaleString('en-IN')} (±${t.tolerancePct ?? DEFAULT_TAG_TOLERANCE_PCT}%)`
    return `${scope} · ${t.weightMin ?? 0}–${t.weightMax ?? 0} g (±${t.tolerancePct ?? DEFAULT_TAG_TOLERANCE_PCT}%)`
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">Filter chips on Home &amp; Collection. <b>Curated</b> chips are assigned to products (Catalogue grid → select → Tag); <b>computed</b> chips match live by amount or weight.</p>

      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-800">{editing ? `Edit “${editing.label}”` : 'New filter chip'}</p>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Chip label</label>
          <input className="input" placeholder="e.g. Bridal · Rings under ₹20k" value={form.label} onChange={e => set('label', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
          <select className="input" value={form.kind} onChange={e => set('kind', e.target.value as TagKind)}>
            <option value="curated">Curated — assigned per product (e.g. Bridal)</option>
            <option value="computed">Computed — live amount / weight rule</option>
          </select>
        </div>

        {form.kind === 'computed' && (
          <div className="space-y-3 rounded-lg bg-[#faf6ee] p-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Applies to</label>
              <select className="input" value={form.scope} onChange={e => set('scope', e.target.value)}>
                <option value="">All products</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Rule</label>
              <select className="input" value={form.metric} onChange={e => set('metric', e.target.value as TagMetric)}>
                <option value="amountMax">Under an amount (₹)</option>
                <option value="weightRange">Within a weight range (g)</option>
              </select>
            </div>
            {form.metric === 'amountMax' ? (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount ceiling (₹)</label>
                <input type="number" className="input" placeholder="20000" value={form.amountMax} onChange={e => set('amountMax', Number(e.target.value))} />
              </div>
            ) : (
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Min weight (g)</label>
                  <input type="number" className="input" placeholder="7" value={form.weightMin} onChange={e => set('weightMin', Number(e.target.value))} />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Max weight (g)</label>
                  <input type="number" className="input" placeholder="13" value={form.weightMax} onChange={e => set('weightMax', Number(e.target.value))} />
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Tolerance ± (%)</label>
              <input type="number" className="input w-28" value={form.tolerancePct} onChange={e => set('tolerancePct', Number(e.target.value))} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Order</label>
            <input type="number" className="input w-24" value={form.order} onChange={e => set('order', Number(e.target.value))} />
          </div>
          <label className="mt-5 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} /> Active
          </label>
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className="btn-primary disabled:opacity-60">{editing ? 'Save changes' : 'Add chip'}</button>
          <button onClick={startNew} className="btn-secondary">Clear</button>
        </div>
      </div>

      <div className="space-y-2">
        {tags.map(t => (
          <div key={t.id} className="card flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-900">{t.label}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${t.kind === 'computed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{t.kind}</span>
                {t.kind === 'curated' && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{counts[t.id] ?? 0} product{(counts[t.id] ?? 0) === 1 ? '' : 's'}</span>}
                {!t.active && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">Hidden</span>}
              </div>
              <div className="truncate text-[11px] text-gray-500">{ruleText(t)} · order {t.order}</div>
            </div>
            <div className="flex shrink-0 gap-2 text-xs">
              <button onClick={() => startEdit(t)} className="text-green-700">Edit</button>
              <button disabled={busy} onClick={() => { if (confirm(`Delete tag “${t.label}”?`)) post({ action: 'deleteTag', id: t.id }) }} className="text-red-600">Delete</button>
            </div>
          </div>
        ))}
        {tags.length === 0 && <p className="text-sm text-gray-500">No filter chips yet.</p>}
      </div>
    </div>
  )
}
