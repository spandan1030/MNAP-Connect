'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { WaProduct, WaProductImage, InterestTopic } from '@/lib/types'

interface Contact { id: string | null; name: string | null; phone: string; recent?: boolean }

export default function ShareSheet({
  product, images, onClose,
}: {
  product: WaProduct
  images: WaProductImage[]
  onClose: () => void
}) {
  const supabase = createClient()

  const [customers, setCustomers] = useState<Contact[]>([])
  const [recent, setRecent]       = useState<Contact[]>([])
  const [topics, setTopics]       = useState<InterestTopic[]>([])
  const [interests, setInterests] = useState<Record<string, Set<string>>>({}) // customer_id -> topic_ids
  const [loading, setLoading]     = useState(true)

  const [search, setSearch]       = useState('')
  const [topicFilter, setTopicFilter] = useState('')
  const [picked, setPicked]       = useState<Contact | null>(null)

  // Step 2 state
  const defaultCaption = useMemo(() => {
    const bits = [product.item_name, product.design, product.purity, product.weight != null ? `${product.weight} g` : null]
      .filter(Boolean)
    return bits.join(' · ')
  }, [product])
  const [imageUrl, setImageUrl] = useState<string>(images[0]?.image_url ?? '')
  const [caption, setCaption]   = useState('')
  const [sending, setSending]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [sent, setSent]         = useState(false)

  useEffect(() => { setCaption(defaultCaption) }, [defaultCaption])

  useEffect(() => {
    async function load() {
      const [custRes, threadRes, topicRes, intRes] = await Promise.all([
        supabase.from('wa_customers').select('id, name, phone').eq('is_active', true).eq('dnd', false).order('name'),
        supabase.from('wa_threads').select('phone, customer_name, customer_id, last_message_at').order('last_message_at', { ascending: false, nullsFirst: false }).limit(3),
        supabase.from('wa_interest_topics').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('wa_customer_interests').select('customer_id, topic_id'),
      ])
      setCustomers((custRes.data ?? []).map(c => ({ id: c.id, name: c.name, phone: c.phone })))
      setRecent((threadRes.data ?? []).map(t => ({ id: t.customer_id, name: t.customer_name, phone: t.phone, recent: true })))
      setTopics(topicRes.data ?? [])
      const map: Record<string, Set<string>> = {}
      for (const r of (intRes.data ?? [])) {
        (map[r.customer_id] ??= new Set()).add(r.topic_id)
      }
      setInterests(map)
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const q = search.trim().toLowerCase()
  const list = useMemo(() => {
    let xs = customers
    if (topicFilter) xs = xs.filter(c => c.id && interests[c.id]?.has(topicFilter))
    if (q) xs = xs.filter(c => (c.name ?? '').toLowerCase().includes(q) || c.phone.includes(q))
    return xs
  }, [customers, interests, topicFilter, q])

  async function send() {
    if (!picked) return
    setSending(true); setError(null)
    try {
      const res = await fetch('/api/whatsapp/share-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: picked.phone, imageUrl: imageUrl || null, caption: caption || null }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not send'); setSending(false); return }
      setSent(true)
      setTimeout(onClose, 1200)
    } catch {
      setError('Network error'); setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm">
            {picked ? 'Send to ' + (picked.name || picked.phone) : 'Share with a customer'}
          </h2>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>

        {/* STEP 1 — pick a contact */}
        {!picked && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <input type="search" placeholder="Search name or phone…" value={search}
              onChange={e => setSearch(e.target.value)} className="input" />

            <select value={topicFilter} onChange={e => setTopicFilter(e.target.value)} className="input">
              <option value="">All interests</option>
              {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>

            {loading ? (
              <div className="flex justify-center pt-6"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : (
              <>
                {!q && !topicFilter && recent.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Recent</p>
                    <div className="space-y-1">
                      {recent.map(c => <ContactRow key={'r' + c.phone} c={c} onPick={setPicked} />)}
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    {q || topicFilter ? 'Results' : 'All customers'}
                  </p>
                  <div className="space-y-1">
                    {list.length === 0
                      ? <p className="text-sm text-gray-400 py-4 text-center">No matching customers.</p>
                      : list.map(c => <ContactRow key={c.id ?? c.phone} c={c} onPick={setPicked} />)}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* STEP 2 — pick photo + caption, send */}
        {picked && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            {sent ? (
              <p className="text-center text-green-700 font-semibold py-6">✓ Sent</p>
            ) : (
              <>
                {images.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1.5">Photo</p>
                    <div className="flex flex-wrap gap-2">
                      {images.map(img => (
                        <button key={img.id} onClick={() => setImageUrl(img.image_url)}
                          className={`w-16 h-16 rounded-lg overflow-hidden border-2 ${imageUrl === img.image_url ? 'border-green-600' : 'border-transparent'}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.image_url} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                      <button onClick={() => setImageUrl('')}
                        className={`w-16 h-16 rounded-lg border-2 text-[10px] font-medium ${imageUrl === '' ? 'border-green-600 text-green-700' : 'border-gray-300 text-gray-500'}`}>
                        No photo
                      </button>
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1">Message</p>
                  <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3} className="input resize-none" placeholder="Add a note…" />
                </div>
                <p className="text-[11px] text-gray-400">
                  Only delivers if this customer messaged you in the last 24 hours. Otherwise WhatsApp will reject it.
                </p>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setPicked(null)} className="btn-secondary flex-1">Back</button>
                  <button onClick={send} disabled={sending || (!imageUrl && !caption.trim())}
                    className="btn-primary flex-1 disabled:opacity-60">
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ContactRow({ c, onPick }: { c: Contact; onPick: (c: Contact) => void }) {
  return (
    <button onClick={() => onPick(c)} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl active:bg-gray-50 text-left">
      <div className="w-9 h-9 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
        {(c.name || c.phone || '?').charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{c.name || c.phone}</p>
        {c.name && <p className="text-xs text-gray-400 truncate">{c.phone}</p>}
      </div>
    </button>
  )
}
