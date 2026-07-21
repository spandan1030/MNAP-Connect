'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import Navbar from '@/components/ui/Navbar'

const BATCH = 500

// Import the customer-app user list (exported from the app-admin side) onto the
// contact spine. Raises contacts.app_user / has_scheme (wa_053) so every audience
// can target app users / scheme holders. Writes ONLY to the spine — no sales rows.

export default function AppUsersImportPage() {
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name); setResult(''); setError('')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const parsed = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '', raw: false })
    setRows(parsed)
  }

  async function handleImport() {
    if (rows.length === 0) return
    setImporting(true); setProgress(0); setResult(''); setError('')
    let imported = 0, skipped = 0
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH)
        const res = await fetch('/api/app-users/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Import failed')
        imported += json.imported ?? 0
        skipped += json.skipped ?? 0
        setProgress(Math.min(i + BATCH, rows.length))
      }
      setResult(`Imported ${imported} app user${imported === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped (bad phone)` : ''}.`)
      setRows([]); setFileName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <Navbar />
      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Customer app users</h1>
          <p className="text-sm text-gray-500">
            Import the list exported from the app admin. Each row flags the phone as an app user
            (and, where set, a scheme holder) on the contact spine — targetable in Audiences, Reach and Call Control.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1">CSV / Excel columns</p>
            <ul className="text-[11px] text-gray-500 list-disc pl-4 space-y-0.5">
              <li><code>phone</code> — required (10-digit or +91…)</li>
              <li><code>is_app_user</code> — optional, defaults <b>true</b> (this is the app-users list)</li>
              <li><code>has_scheme</code> — optional, <code>true</code>/<code>1</code>/<code>yes</code> if they hold a gold scheme</li>
            </ul>
            <p className="text-[11px] text-gray-400 mt-1">Names are not imported — the spine keeps chat / billing names.</p>
          </div>

          <label className="block">
            <span className="sr-only">Choose file</span>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile}
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-green-600 file:text-white file:text-sm file:font-medium" />
          </label>

          {fileName && (
            <p className="text-xs text-gray-500">{fileName} — {rows.length} row{rows.length === 1 ? '' : 's'}</p>
          )}

          {rows.length > 0 && (
            <button onClick={handleImport} disabled={importing}
              className="btn-primary w-full disabled:opacity-60">
              {importing ? `Importing… ${progress}/${rows.length}` : `Import ${rows.length} row${rows.length === 1 ? '' : 's'}`}
            </button>
          )}

          {result && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{result}</p>}
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>
      </div>
    </div>
  )
}
