'use client'

// One-off backfill: generate the mid-size 4:5 "card" rendition (~640px) for photos
// uploaded BEFORE the card rendition existed. New uploads make their own card; this
// fills the gap for the existing catalogue so grid tiles stop loading the full 4:5
// display image (the dominant Supabase cached-egress driver).
//
// Runs entirely in the browser, reusing the same canvas pipeline the rest of the app
// uses to resize images — no server dependency, no serverless timeout. It downscales
// each stored display image to the card size, uploads it, and stamps card_url on the
// row. Idempotent + resumable: it only ever processes rows still missing card_url, so
// it's safe to stop and re-run. When every card is written it re-syncs the published
// catalogue so the customer app's Firestore docs pick up the new `card` field.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { renderCardFromDisplay, IMG_CACHE_CONTROL as IMG_CACHE } from '@/lib/image'
import Navbar from '@/components/ui/Navbar'

type Row = { id: string; product_id: string; display_url: string }

// Fetch an image URL into a same-origin object URL and decode it. Going through a
// blob (rather than a cross-origin <img>) keeps the canvas untainted so toBlob works.
// Requires the storage response to allow CORS (Supabase public objects send `*`).
async function loadFromUrl(url: string): Promise<HTMLImageElement> {
  const res = await fetch(url, { mode: 'cors', cache: 'no-store' })
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  const blob = await res.blob()
  const obj = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('decode failed'))
      im.src = obj
    })
  } finally {
    // Revoke on the next tick so the decoded image keeps its pixels.
    setTimeout(() => URL.revokeObjectURL(obj), 0)
  }
}

export default function BackfillCardsPage() {
  const supabase = createClient()
  const [pending, setPending] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState(0)
  const [total, setTotal] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const [finished, setFinished] = useState(false)
  const stop = useRef(false)

  const addLog = (s: string) => setLog(l => [s, ...l].slice(0, 12))

  // How many rows still need a card (display image present, card_url missing).
  const countPending = useCallback(async () => {
    const { count } = await supabase
      .from('wa_product_images')
      .select('id', { count: 'exact', head: true })
      .is('card_url', null)
      .not('display_url', 'is', null)
    setPending(count ?? 0)
    return count ?? 0
  }, [supabase])

  useEffect(() => { countPending() }, [countPending])

  async function processOne(row: Row): Promise<boolean> {
    const img = await loadFromUrl(row.display_url)
    const card = await renderCardFromDisplay(img, row.id)
    if (!card) throw new Error('encode failed (canvas tainted?)')
    // Unique, collision-proof path keyed by the image row id.
    const path = `products/${row.product_id}/card-${row.id}.jpg`
    const { data: up, error: upErr } = await supabase.storage
      .from('wa-media')
      .upload(path, card, { upsert: true, contentType: 'image/jpeg', cacheControl: IMG_CACHE })
    if (upErr || !up) throw new Error(upErr?.message ?? 'upload failed')
    const cardUrl = supabase.storage.from('wa-media').getPublicUrl(up.path).data.publicUrl
    const { error: updErr } = await supabase
      .from('wa_product_images')
      .update({ card_url: cardUrl })
      .eq('id', row.id)
    if (updErr) throw new Error(updErr.message)
    return true
  }

  async function run() {
    setRunning(true); setFinished(false); stop.current = false
    setDone(0); setFailed(0); setLog([])

    // Pull the whole worklist up front (id + product_id + url is tiny even for
    // thousands of rows). We re-query at the end to catch anything that failed.
    const { data, error } = await supabase
      .from('wa_product_images')
      .select('id, product_id, display_url')
      .is('card_url', null)
      .not('display_url', 'is', null)
    if (error) { addLog(`Could not load worklist: ${error.message}`); setRunning(false); return }
    const rows = (data ?? []) as Row[]
    setTotal(rows.length)
    if (!rows.length) { addLog('Nothing to backfill — all photos already have a card.'); setRunning(false); setFinished(true); return }

    let ok = 0, bad = 0
    for (const row of rows) {
      if (stop.current) { addLog('Stopped.'); break }
      try {
        await processOne(row)
        ok++; setDone(ok)
      } catch (e) {
        bad++; setFailed(bad)
        addLog(`Skipped ${row.id.slice(0, 8)}: ${e instanceof Error ? e.message : 'error'}`)
      }
    }

    await countPending()
    // Push the new `card` field into the customer app's Firestore docs.
    if (ok > 0 && !stop.current) {
      addLog('Re-syncing published products to the customer app…')
      try {
        const r = await fetch('/api/catalogue/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resyncAll: true }),
        })
        const j = await r.json().catch(() => ({}))
        addLog(r.ok ? `Re-synced ${j.count ?? '?'} published products.` : `Re-sync failed: ${j.error ?? r.status}`)
      } catch (e) {
        addLog(`Re-sync request failed: ${e instanceof Error ? e.message : 'error'}`)
      }
    }
    setRunning(false); setFinished(true)
  }

  const pct = total > 0 ? Math.round(((done + failed) / total) * 100) : 0

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-6 space-y-4">
        <h1 className="text-lg font-bold text-gray-900">Backfill card images</h1>
        <p className="text-sm text-gray-600">
          Generates the smaller grid-card image for products photographed before this
          feature existed. This is what stops the customer app from loading full-size
          photos in every grid tile. Safe to stop and re-run — it only processes photos
          that still need a card.
        </p>

        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Photos still needing a card</span>
            <span className="font-semibold text-gray-900">{pending === null ? '…' : pending}</span>
          </div>

          {(running || finished) && total > 0 && (
            <div className="space-y-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>{done} done{failed ? ` · ${failed} skipped` : ''}</span>
                <span>{done + failed} / {total}</span>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {!running ? (
              <button
                onClick={run}
                disabled={pending === 0}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {finished ? 'Run again' : 'Start backfill'}
              </button>
            ) : (
              <button
                onClick={() => { stop.current = true }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700"
              >
                Stop
              </button>
            )}
            <button
              onClick={() => countPending()}
              disabled={running}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 disabled:opacity-40"
            >
              Refresh count
            </button>
          </div>

          {finished && !running && (
            <p className="text-sm text-emerald-700">
              Finished. {failed > 0 && 'Some photos were skipped (see log) — re-run to retry them. '}
              The customer app now serves smaller grid images.
            </p>
          )}
        </div>

        {log.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
            {log.map((l, i) => <div key={i} className="font-mono">{l}</div>)}
          </div>
        )}
      </main>
    </div>
  )
}
