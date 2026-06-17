'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { WaProduct } from '@/lib/types'

const norm = (s: string | null | undefined) => (s ?? '').trim()

interface Entry { bucket: string; need: string }

export default function AddToPlanSheet({ product, onClose }: { product: WaProduct; onClose: () => void }) {
  const supabase = createClient()
  const defaultBucket = product.weight != null ? String(Math.max(1, Math.round(product.weight))) : ''
  const [entries, setEntries] = useState<Entry[]>([{ bucket: defaultBucket, need: '1' }])
  const [saving, setSaving]   = useState(false)
  const [done, setDone]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const title = [product.item_name, product.design, product.description].filter(Boolean).join(' · ') || 'Untitled'

  function setEntry(i: number, k: keyof Entry, v: string) {
    setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [k]: v } : e))
  }
  const addRow    = () => setEntries(prev => [...prev, { bucket: '', need: '1' }])
  const removeRow = (i: number) => setEntries(prev => prev.filter((_, idx) => idx !== i))

  async function save() {
    const valid = entries
      .map(e => ({ bucket: Math.max(1, parseInt(e.bucket, 10) || 0), need: Math.max(0, parseInt(e.need, 10) || 0) }))
      .filter(e => e.bucket > 0 && e.need > 0)
    if (valid.length === 0) { setError('Enter at least one weight and quantity.'); return }

    setSaving(true); setError(null)
    // Existing requirements for this exact product line — so we top up instead of duplicating
    const { data: existing } = await supabase
      .from('wa_purchase_requirements')
      .select('id, weight_bucket, qty_needed, item_name, design, description, purity')
    const match = (r: { item_name: string | null; design: string | null; description: string | null; purity: string | null; weight_bucket: number | null }, bucket: number) =>
      norm(r.item_name) === norm(product.item_name) &&
      norm(r.design) === norm(product.design) &&
      norm(r.description) === norm(product.description) &&
      norm(r.purity) === norm(product.purity) &&
      (r.weight_bucket ?? 0) === bucket

    const { data: { user } } = await supabase.auth.getUser()
    for (const e of valid) {
      const ex = (existing ?? []).find(r => match(r, e.bucket))
      if (ex) {
        await supabase.from('wa_purchase_requirements')
          .update({ qty_needed: ex.qty_needed + e.need, updated_at: new Date().toISOString() }).eq('id', ex.id)
      } else {
        await supabase.from('wa_purchase_requirements').insert({
          item_name: product.item_name, design: product.design, description: product.description, purity: product.purity,
          weight_bucket: e.bucket, qty_needed: e.need, created_by: user?.id ?? null,
        })
      }
    }
    setSaving(false); setDone(true)
    setTimeout(onClose, 1100)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm">Add to purchase plan</h2>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {done ? (
            <p className="text-center text-green-700 font-semibold py-6">✓ Added to plan</p>
          ) : (
            <>
              <div>
                <p className="font-semibold text-gray-900 text-sm">{title}</p>
                <p className="text-[11px] text-amber-700">{product.purity || 'Any purity'}</p>
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[11px] font-medium text-gray-500">
                  <span className="flex-1">Weight bucket (g)</span>
                  <span className="w-20 text-center">Need</span>
                  <span className="w-5" />
                </div>
                {entries.map((e, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="number" min={1} value={e.bucket} onChange={ev => setEntry(i, 'bucket', ev.target.value)}
                      className="input flex-1 !py-2 text-sm" placeholder="e.g. 5" />
                    <input type="number" min={1} value={e.need} onChange={ev => setEntry(i, 'need', ev.target.value)}
                      className="input !w-20 !py-2 text-sm text-center" />
                    <button onClick={() => removeRow(i)} disabled={entries.length === 1}
                      className="w-5 text-gray-300 hover:text-red-500 disabled:opacity-0">×</button>
                  </div>
                ))}
                <button onClick={addRow} className="text-xs font-medium text-green-600">+ Another weight</button>
              </div>

              <p className="text-[11px] text-gray-400">
                Adds to your Purchase plan under this item/design/description/purity. If a weight already exists in the plan, the quantity is topped up.
              </p>

              <div className="flex gap-2 pt-1">
                <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
                <button onClick={save} disabled={saving} className="btn-primary flex-1 disabled:opacity-60">
                  {saving ? 'Adding…' : 'Add to plan'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
