'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/ui/Navbar'

type Impact = {
  matched: number
  statusChanges: number
  publishedAffected: number
  sample: Array<{ designCode: string | null; barcode: string; itemName: string | null; from: string; to: string; published: boolean }>
}
type Summary = {
  fileName: string
  totalRows: number
  valid: number
  skipped: number
  duplicates: number
  statusCounts: Record<string, number>
  mapped: { in_stock: number; sold: number; deleted: number; unmapped: number }
  productImpact: Impact
}
type Applied = { inventoryUpserted: number; productsUpdated: number; resynced: number }

const TO_LABEL: Record<string, string> = { in_stock: 'In stock', sold: 'Sold', deleted: 'Deleted' }

export default function InventoryImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [applied, setApplied] = useState<Applied | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)

  function pick(f: File | null) {
    setFile(f); setSummary(null); setApplied(null); setError(null)
  }

  async function send(mode: 'preview' | 'apply') {
    if (!file) return
    setBusy(mode); setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mode', mode)
      const res = await fetch('/api/inventory/import', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Import failed')
      setSummary(json.summary as Summary)
      if (mode === 'apply') setApplied(json.applied as Applied)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(null)
    }
  }

  const imp = summary?.productImpact

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3 pb-24">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
          <h1 className="text-lg font-bold text-gray-900">Import inventory</h1>
        </div>
        <p className="text-xs text-gray-400">
          Upload the item-status export from your software (<strong>.xlsx or .csv</strong>, same
          columns). This fills the inventory reference used for fast barcode prefill and refreshes
          the status of matching product cards. It never creates cards and never changes what&apos;s
          published to the app.
        </p>

        {/* File picker */}
        <div className="card p-4 space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={e => pick(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
          />
          {file && <p className="text-xs text-gray-500 truncate">{file.name}</p>}
          <button
            onClick={() => send('preview')}
            disabled={!file || busy !== null}
            className="w-full py-2.5 rounded-lg bg-gray-900 text-white text-sm font-medium disabled:opacity-40"
          >
            {busy === 'preview' ? 'Reading…' : 'Preview'}
          </button>
        </div>

        {error && <div className="card p-3 text-sm text-red-600 bg-red-50">{error}</div>}

        {/* Preview summary */}
        {summary && (
          <div className="card p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">{summary.fileName}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {summary.valid.toLocaleString()} rows with a barcode
                {summary.skipped > 0 && ` · ${summary.skipped} skipped (no barcode)`}
                {summary.duplicates > 0 && ` · ${summary.duplicates} duplicate barcodes collapsed`}
              </p>
            </div>

            {/* Raw status breakdown */}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">Status in file</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(summary.statusCounts).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                  <span key={s} className="text-[11px] font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                    {s} · {n.toLocaleString()}
                  </span>
                ))}
              </div>
              {summary.mapped.unmapped > 0 && (
                <p className="text-[11px] text-gray-400 mt-1.5">
                  {summary.mapped.unmapped.toLocaleString()} rows have a status we don&apos;t map
                  (Estm / Approval / Remove …) — stored for lookup, but they won&apos;t change any card.
                </p>
              )}
            </div>

            {/* Product impact */}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">Effect on your product cards</p>
              {imp && imp.matched === 0 ? (
                <p className="text-sm text-gray-500">No existing cards match a barcode in this file.</p>
              ) : imp && (
                <div className="space-y-1 text-sm text-gray-700">
                  <div className="flex justify-between"><span>Cards matched by barcode</span><span className="font-semibold">{imp.matched}</span></div>
                  <div className="flex justify-between"><span>Status changes</span><span className="font-semibold text-amber-700">{imp.statusChanges}</span></div>
                  <div className="flex justify-between"><span>…of those, published (will re-sync)</span><span className="font-semibold">{imp.publishedAffected}</span></div>
                </div>
              )}
              {imp && imp.sample.length > 0 && (
                <div className="mt-2 border-t border-gray-100 pt-2 space-y-1">
                  {imp.sample.map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 truncate mr-2">
                        <span className="font-mono text-gray-400">{c.designCode ?? '—'}</span>{' '}
                        {c.itemName ?? c.barcode}
                      </span>
                      <span className="shrink-0 text-gray-500">
                        {TO_LABEL[c.from] ?? c.from} → <span className="font-semibold text-gray-800">{TO_LABEL[c.to] ?? c.to}</span>
                        {c.published && <span className="ml-1 text-green-600">•live</span>}
                      </span>
                    </div>
                  ))}
                  {imp.statusChanges > imp.sample.length && (
                    <p className="text-[11px] text-gray-400">+{imp.statusChanges - imp.sample.length} more…</p>
                  )}
                </div>
              )}
            </div>

            {/* Apply */}
            {applied ? (
              <div className="rounded-lg bg-green-50 p-3 text-sm text-green-800 space-y-0.5">
                <p className="font-semibold">Import applied ✓</p>
                <p className="text-xs">{applied.inventoryUpserted.toLocaleString()} inventory rows saved · {applied.productsUpdated} cards updated · {applied.resynced} re-synced to app</p>
              </div>
            ) : (
              <button
                onClick={() => send('apply')}
                disabled={busy !== null}
                className="w-full py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-40"
              >
                {busy === 'apply' ? 'Applying…' : 'Apply import'}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
