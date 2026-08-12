'use client'

// Bulk stock update — paste barcodes (comma / space / newline separated) and mark
// them all Sold or In stock in one go. Each catalogue product is a single barcoded
// piece, so this flips wa_products.is_sold on every match and re-syncs any that are
// published to the customer app.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/ui/Navbar'

interface StockResult {
  sold: boolean
  updated: number
  unchanged: number
  matched: number
  notFound: string[]
}

export default function StockUpdatePage() {
  const router = useRouter()
  const [text, setText]       = useState('')
  const [busy, setBusy]       = useState<null | 'sold' | 'instock'>(null)
  const [error, setError]     = useState<string | null>(null)
  const [result, setResult]   = useState<StockResult | null>(null)

  // Live parse so staff can see how many barcodes they've pasted.
  const codes = useMemo(
    () => [...new Set(text.split(/[\s,]+/).map(s => s.trim()).filter(Boolean))],
    [text],
  )

  async function apply(sold: boolean) {
    if (codes.length === 0 || busy) return
    setBusy(sold ? 'sold' : 'instock')
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/catalogue/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcodes: codes, sold }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Update failed')
      setResult(data as StockResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4 pb-24">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
          <h1 className="text-lg font-bold text-gray-900">Stock update</h1>
        </div>
        <p className="text-xs text-gray-400">
          Paste barcodes separated by commas, spaces or new lines, then mark them all
          <b> Sold</b> or <b> In stock</b>. Published pieces update on the app automatically.
        </p>

        <div className="card p-4 space-y-3">
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setResult(null); setError(null) }}
            rows={6}
            placeholder="e.g.  AB1234, AB1235&#10;CD9001  CD9002"
            className="input font-mono text-sm resize-y"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {codes.length} barcode{codes.length === 1 ? '' : 's'} ready
            </span>
            {text.trim() && (
              <button onClick={() => { setText(''); setResult(null); setError(null) }}
                className="text-[11px] text-gray-400 active:text-gray-600">Clear</button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => apply(false)}
              disabled={codes.length === 0 || busy !== null}
              className="flex items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white active:bg-green-700 disabled:bg-gray-300"
            >
              {busy === 'instock'
                ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : 'Mark In stock'}
            </button>
            <button
              onClick={() => apply(true)}
              disabled={codes.length === 0 || busy !== null}
              className="flex items-center justify-center gap-2 rounded-xl bg-amber-600 py-3 text-sm font-semibold text-white active:bg-amber-700 disabled:bg-gray-300"
            >
              {busy === 'sold'
                ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : 'Mark Sold'}
            </button>
          </div>
        </div>

        {error && (
          <div className="card border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {result && (
          <div className="card p-4 space-y-2">
            <p className="text-sm font-semibold text-gray-900">
              Marked <span className={result.sold ? 'text-amber-700' : 'text-green-700'}>
                {result.sold ? 'Sold' : 'In stock'}
              </span>
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Updated"  value={result.updated}  tone="text-green-700" />
              <Stat label="No change" value={result.unchanged} tone="text-gray-500" />
              <Stat label="Not found" value={result.notFound.length} tone={result.notFound.length ? 'text-red-600' : 'text-gray-400'} />
            </div>
            {result.notFound.length > 0 && (
              <div className="pt-1">
                <p className="text-[11px] font-medium text-gray-500 mb-1">Barcodes not in the catalogue:</p>
                <p className="text-xs font-mono text-red-600 break-all bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {result.notFound.join(', ')}
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-2 py-2.5">
      <p className={`text-xl font-bold ${tone}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
    </div>
  )
}
