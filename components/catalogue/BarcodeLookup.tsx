'use client'

import { useEffect, useRef, useState } from 'react'

export interface LookupResult {
  barcode: string
  itmId: number | null
  itemNameRaw: string | null
  cleanName: string | null
  purityRaw: string | null
  cleanPurity: string | null
  partyId: number | null
  designRaw: string | null
  weight: number | null
  bcmStatus: string | null
  stockStatus: 'in_stock' | 'sold' | 'deleted' | null
  existsAsProduct: boolean
  productId: string | null
}

const STATUS_CHIP: Record<string, string> = {
  in_stock: 'text-green-700 bg-green-50',
  sold: 'text-amber-700 bg-amber-50',
  deleted: 'text-red-600 bg-red-50',
}

// Barcode field with a live dropdown from the inventory master. As the user types (or a
// scanner types + Enter), it queries /api/inventory/lookup and offers matching pieces;
// picking one hands the resolved row (clean name/purity, weight, party, status) back to
// the parent to prefill the form.
export default function BarcodeLookup({
  value, onChange, onPick, placeholder, autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  onPick: (row: LookupResult) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [results, setResults] = useState<LookupResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const reqId = useRef(0)
  const boxRef = useRef<HTMLDivElement>(null)
  // Barcode we've already auto-prefilled (or that arrived as the initial value), so an
  // exact match auto-fills exactly once and never re-fires or loops.
  const pickedRef = useRef(value.trim().toLowerCase())
  // Latest onPick without making it an effect dependency (parent passes a fresh fn each render).
  const onPickRef = useRef(onPick)
  useEffect(() => { onPickRef.current = onPick })

  // Debounced fetch on value change. All state updates happen inside the async timer
  // callback (never synchronously in the effect body).
  useEffect(() => {
    const q = value.trim()
    const id = ++reqId.current
    const t = setTimeout(async () => {
      if (q.length < 2) {
        if (id === reqId.current) { setResults([]); setLoading(false); setOpen(false) }
        return
      }
      if (id === reqId.current) setLoading(true)
      try {
        const res = await fetch(`/api/inventory/lookup?q=${encodeURIComponent(q)}`)
        const json = await res.json()
        if (id !== reqId.current) return // a newer keystroke superseded this
        const rows = (json.results ?? []) as LookupResult[]
        // Auto-prefill when the typed/scanned value IS a full barcode (unique match) —
        // users (and scanners) don't click the row. Fire once per barcode.
        const exact = rows.find(r => r.barcode.toLowerCase() === q.toLowerCase())
        if (exact && pickedRef.current !== exact.barcode.toLowerCase()) {
          pickedRef.current = exact.barcode.toLowerCase()
          onPickRef.current(exact)
          setResults([]); setOpen(false); setLoading(false)
          return
        }
        setResults(rows)
        setActive(0)
        setOpen(true)
      } catch { if (id === reqId.current) setResults([]) }
      finally { if (id === reqId.current) setLoading(false) }
    }, 200)
    return () => clearTimeout(t)
  }, [value])

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function pick(row: LookupResult) {
    pickedRef.current = row.barcode.toLowerCase()
    onPick(row)
    setOpen(false)
    setResults([])
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) {
      // A scanner sends the full code then Enter before results load — let it be.
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const exact = results.find(r => r.barcode.toLowerCase() === value.trim().toLowerCase())
      pick(exact ?? results[active] ?? results[0])
    } else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true) }}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        autoComplete="off"
        className="input"
        placeholder={placeholder ?? 'Type or scan a barcode'}
      />
      {loading && <div className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />}
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-auto">
          {results.map((r, i) => (
            <button
              key={r.barcode}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 ${i === active ? 'bg-green-50' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-gray-900">{r.barcode}</span>
                  {r.stockStatus && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_CHIP[r.stockStatus] ?? 'text-gray-500 bg-gray-100'}`}>{r.stockStatus.replace('_', ' ')}</span>}
                  {r.existsAsProduct && <span className="text-[10px] px-1.5 py-0.5 rounded-full text-indigo-600 bg-indigo-50">in catalogue</span>}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {(r.cleanName || r.itemNameRaw || '—')}
                  {r.weight != null && ` · ${r.weight} g`}
                  {r.cleanPurity && ` · ${r.cleanPurity}`}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
