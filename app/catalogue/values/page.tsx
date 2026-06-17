'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { addCatalogueValue, renameCatalogueValue, deleteCatalogueValue, type OptionField } from '@/lib/catalogue'
import Navbar from '@/components/ui/Navbar'
import type { WaProduct } from '@/lib/types'

const FIELDS: { key: OptionField; label: string }[] = [
  { key: 'item_name',   label: 'Item name' },
  { key: 'design',      label: 'Design' },
  { key: 'description', label: 'Description' },
  { key: 'purity',      label: 'Purity' },
  { key: 'party',       label: 'Party' },
]

export default function ValuesPage() {
  const supabase = createClient()
  const router = useRouter()

  const [field, setField]       = useState<OptionField>('item_name')
  const [options, setOptions]   = useState<Record<OptionField, string[]>>({ item_name: [], design: [], description: [], purity: [], party: [] })
  const [products, setProducts] = useState<WaProduct[]>([])
  const [loading, setLoading]   = useState(true)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing]   = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [newValue, setNewValue] = useState('')
  const [busy, setBusy]         = useState(false)

  async function reload() {
    const [optRes, prodRes] = await Promise.all([
      supabase.from('wa_catalogue_options').select('field, value').order('value'),
      supabase.from('wa_products').select('*').order('created_at', { ascending: false }),
    ])
    const grouped: Record<OptionField, string[]> = { item_name: [], design: [], description: [], purity: [], party: [] }
    for (const r of (optRes.data ?? [])) {
      const f = r.field as OptionField
      if (grouped[f]) grouped[f].push(r.value)
    }
    setOptions(grouped)
    setProducts((prodRes.data ?? []) as WaProduct[])
    setLoading(false)
  }

  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  // value -> products carrying it (for the current field)
  const byValue = useMemo(() => {
    const m: Record<string, WaProduct[]> = {}
    for (const p of products) {
      const v = (p[field] as string | null) ?? ''
      if (!v) continue
      ;(m[v] ??= []).push(p)
    }
    return m
  }, [products, field])

  // All values = managed options ∪ any value used by a product (so orphans show too)
  const values = useMemo(() => {
    const set = new Set<string>(options[field])
    for (const k of Object.keys(byValue)) set.add(k)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [options, byValue, field])

  function startEdit(v: string) { setEditing(v); setEditValue(v); setExpanded(v) }

  async function saveRename(oldVal: string) {
    const next = editValue.trim()
    if (!next || next === oldVal) { setEditing(null); return }
    const willMerge = values.includes(next)
    if (willMerge && !confirm(`"${next}" already exists. Merge all "${oldVal}" products into "${next}"?`)) return
    setBusy(true)
    await renameCatalogueValue(field, oldVal, next)
    setEditing(null); setExpanded(null)
    await reload()
    setBusy(false)
  }

  async function removeValue(v: string) {
    const inUse = (byValue[v]?.length ?? 0)
    if (inUse > 0) { alert(`"${v}" is used by ${inUse} product(s). Rename/merge it instead of deleting.`); return }
    if (!confirm(`Remove "${v}" from the dropdown list?`)) return
    setBusy(true)
    await deleteCatalogueValue(field, v)
    await reload()
    setBusy(false)
  }

  async function addValue() {
    const v = newValue.trim()
    if (!v) return
    setBusy(true)
    await addCatalogueValue(field, v)
    setNewValue('')
    await reload()
    setBusy(false)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3 pb-24">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
          <h1 className="text-lg font-bold text-gray-900">Manage values</h1>
        </div>
        <p className="text-xs text-gray-400">
          Rename a value to re-classify every product using it. Renaming to an existing value merges them.
        </p>

        {/* Field tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {FIELDS.map(f => (
            <button key={f.key} onClick={() => { setField(f.key); setExpanded(null); setEditing(null) }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                field === f.key ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Add a new value */}
        <div className="flex gap-2">
          <input value={newValue} onChange={e => setNewValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addValue() }}
            placeholder={`Add a new ${FIELDS.find(f => f.key === field)!.label.toLowerCase()}…`} className="input flex-1" />
          <button onClick={addValue} disabled={busy || !newValue.trim()} className="btn-primary px-4 disabled:opacity-50">Add</button>
        </div>

        {loading ? (
          <div className="flex justify-center pt-10"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : values.length === 0 ? (
          <div className="card p-8 text-center text-gray-400 text-sm">No values yet.</div>
        ) : (
          <div className="space-y-1.5">
            {values.map(v => {
              const items = byValue[v] ?? []
              const isOpen = expanded === v
              const isEditing = editing === v
              return (
                <div key={v} className="card overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    {isEditing ? (
                      <input value={editValue} autoFocus onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveRename(v) }} className="input flex-1 !py-1.5" />
                    ) : (
                      <button onClick={() => setExpanded(isOpen ? null : v)} className="flex-1 flex items-center gap-2 min-w-0 text-left">
                        <span className="font-medium text-gray-900 text-sm truncate">{v}</span>
                        <span className="text-[11px] text-gray-400 flex-shrink-0">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                      </button>
                    )}
                    {isEditing ? (
                      <>
                        <button onClick={() => saveRename(v)} disabled={busy} className="text-xs font-semibold text-green-600 px-2 disabled:opacity-50">Save</button>
                        <button onClick={() => setEditing(null)} className="text-xs text-gray-400 px-1">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(v)} className="text-xs font-semibold text-green-600 px-2">Rename</button>
                        <button onClick={() => removeValue(v)} title="Remove from list" className="text-gray-300 hover:text-red-500 px-1">×</button>
                      </>
                    )}
                  </div>

                  {isOpen && !isEditing && (
                    <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 space-y-1">
                      {items.length === 0 ? (
                        <p className="text-xs text-gray-400 py-1">Not used by any product yet.</p>
                      ) : items.map(p => (
                        <Link key={p.id} href={`/catalogue/${p.id}`} className="flex items-center justify-between text-sm text-gray-700 py-1 active:text-green-700">
                          <span className="truncate">{p.item_name || 'Untitled'} {p.barcode ? `· ${p.barcode}` : ''}</span>
                          <span className="text-gray-300">›</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
