'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import CustomerPeek from '@/components/ui/CustomerPeek'
import NewThreadButton from './NewThreadButton'
import { THREAD_COLORS, threadColorMeta, type ThreadColor } from '@/lib/threadColors'
import type { WaThread } from '@/lib/types'

// Last 10 digits — the join key shared by threads and follow-ups.
const last10 = (p: string) => p.replace(/\D/g, '').slice(-10)

type Stream = 'chats' | 'broadcasts'

interface FollowupClue { dueOn: string; overdue: boolean; today: boolean; days: number }

export default function MessagesPage() {
  const supabase = createClient()
  const router   = useRouter()
  const [threads, setThreads] = useState<WaThread[]>([])
  const [followups, setFollowups] = useState<Record<string, FollowupClue>>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Stream>('chats')
  const [peekPhone, setPeekPhone] = useState<string | null>(null)
  const [colorSheet, setColorSheet] = useState<WaThread | null>(null)

  // One press at a time — track the long-press timer + whether it fired so the
  // subsequent click doesn't also navigate.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressFired = useRef(false)
  const pressStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    async function load() {
      const todayStr = new Date().toLocaleDateString('en-CA')
      const [thRes, fuRes] = await Promise.all([
        supabase.from('wa_threads').select('*').order('last_message_at', { ascending: false }),
        supabase.from('wa_followups').select('phone, due_on').eq('status', 'pending'),
      ])
      setThreads((thRes.data ?? []) as WaThread[])

      // Keep the earliest (most urgent) pending follow-up per phone.
      const map: Record<string, FollowupClue> = {}
      for (const r of (fuRes.data ?? []) as { phone: string; due_on: string }[]) {
        const key = last10(r.phone)
        const days = Math.round(
          (new Date(r.due_on + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86_400_000
        )
        const clue: FollowupClue = { dueOn: r.due_on, overdue: days < 0, today: days === 0, days }
        const existing = map[key]
        if (!existing || new Date(r.due_on) < new Date(existing.dueOn)) map[key] = clue
      }
      setFollowups(map)
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Realtime: merge inserts/updates in place (no force-to-top — the two streams
  // re-derive their own order, so a campaign send never jumps a chat).
  useEffect(() => {
    const channel = supabase
      .channel('wa-threads-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_threads' }, payload => {
        const row = payload.new as WaThread
        setThreads(prev => (prev.find(t => t.id === row.id) ? prev : [row, ...prev]))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wa_threads' }, payload => {
        const row = payload.new as WaThread
        setThreads(prev => prev.map(t => (t.id === row.id ? row : t)))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Split: Chats = anything with real human activity; Broadcasts = numbers only
  // ever blasted (last_human_at null). Each sorts by its own clock.
  const { chats, broadcasts } = useMemo(() => {
    const chats: WaThread[] = []
    const broadcasts: WaThread[] = []
    for (const t of threads) (t.last_human_at ? chats : broadcasts).push(t)
    chats.sort((a, b) => (b.last_human_at ?? '').localeCompare(a.last_human_at ?? ''))
    broadcasts.sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
    return { chats, broadcasts }
  }, [threads])

  const list = tab === 'chats' ? chats : broadcasts

  // ── Long-press → colour picker ──────────────────────────────────────────
  function beginPress(thread: WaThread, e: React.PointerEvent) {
    pressFired.current = false
    pressStart.current = { x: e.clientX, y: e.clientY }
    pressTimer.current = setTimeout(() => {
      pressFired.current = true
      if (navigator.vibrate) { try { navigator.vibrate(15) } catch { /* ignore */ } }
      setColorSheet(thread)
    }, 450)
  }
  function movePress(e: React.PointerEvent) {
    if (!pressStart.current || !pressTimer.current) return
    const dx = Math.abs(e.clientX - pressStart.current.x)
    const dy = Math.abs(e.clientY - pressStart.current.y)
    if (dx > 10 || dy > 10) { clearTimeout(pressTimer.current); pressTimer.current = null } // it's a scroll
  }
  function endPress() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }
  function openThread(thread: WaThread) {
    if (pressFired.current) { pressFired.current = false; return } // long-press consumed the tap
    router.push(`/messages/${thread.phone}`)
  }

  async function setColor(thread: WaThread, color: ThreadColor | null) {
    setColorSheet(null)
    setThreads(prev => prev.map(t => (t.id === thread.id ? { ...t, color } : t)))
    await supabase.from('wa_threads').update({ color }).eq('id', thread.id)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-lg mx-auto w-full px-4 pt-4 pb-24">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold text-gray-900">Messages</h1>
          <NewThreadButton />
        </div>

        {/* Stream tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1">
          <TabButton active={tab === 'chats'}      onClick={() => setTab('chats')}      label="Chats"      count={chats.length} />
          <TabButton active={tab === 'broadcasts'} onClick={() => setTab('broadcasts')} label="Broadcasts" count={broadcasts.length} />
        </div>

        {loading && (
          <div className="flex justify-center pt-12">
            <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && list.length === 0 && (
          <div className="card p-8 text-center mt-6">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <p className="text-gray-600 font-medium text-sm">
              {tab === 'chats' ? 'No conversations yet' : 'No broadcast-only numbers'}
            </p>
            <p className="text-gray-400 text-xs mt-1">
              {tab === 'chats'
                ? 'Customer messages and your replies appear here.'
                : 'Numbers you’ve only reached via campaigns show up here — until they reply.'}
            </p>
          </div>
        )}

        {!loading && list.length > 0 && (
          <div className="card overflow-hidden">
            {list.map((thread, i) => {
              const cm  = threadColorMeta(thread.color)
              const clue = followups[last10(thread.phone)]
              return (
                <div
                  key={thread.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openThread(thread)}
                  onPointerDown={e => beginPress(thread, e)}
                  onPointerMove={movePress}
                  onPointerUp={endPress}
                  onPointerLeave={endPress}
                  onContextMenu={e => { e.preventDefault(); pressFired.current = true; setColorSheet(thread) }}
                  className={`relative flex items-center gap-3 pl-4 pr-3 py-3.5 cursor-pointer select-none active:bg-gray-100 transition-colors ${
                    i > 0 ? 'border-t border-gray-100' : ''
                  } ${cm ? cm.tint : ''}`}
                >
                  {/* Colour accent bar */}
                  {cm && <span className={`absolute left-0 top-0 bottom-0 w-1 ${cm.bar}`} />}

                  <div className="relative w-11 h-11 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-green-700 font-bold text-sm">
                      {(thread.customer_name || thread.phone).charAt(0).toUpperCase()}
                    </span>
                    {cm && <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${cm.dot}`} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-semibold text-gray-900 text-sm truncate">
                        {thread.customer_name || formatPhone(thread.phone)}
                      </p>
                      {(thread.last_human_at || thread.last_message_at) && (
                        <span className="text-[11px] text-gray-400 flex-shrink-0">
                          {relativeTime((tab === 'chats' ? thread.last_human_at : thread.last_message_at) || thread.last_message_at!)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {thread.needs_agent && (
                        <span className="flex-shrink-0 text-[10px] font-semibold text-white bg-green-600 px-1.5 py-0.5 rounded-full">Reply</span>
                      )}
                      <p className="text-xs text-gray-500 truncate">
                        {thread.last_message_preview ?? 'No messages yet'}
                      </p>
                    </div>
                    {/* Follow-up clue */}
                    {clue && (
                      <div className="mt-1">
                        <FollowupChip clue={clue} />
                      </div>
                    )}
                  </div>

                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); setPeekPhone(thread.phone) }}
                    aria-label="Who is this?"
                    className="flex-shrink-0 w-6 h-6 rounded-full border border-gray-200 text-gray-400 text-[11px] font-bold flex items-center justify-center active:bg-gray-100"
                  >i</button>
                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              )
            })}
          </div>
        )}

        {!loading && list.length > 0 && (
          <p className="text-center text-[11px] text-gray-400 mt-3">Long-press a chat to colour-code it</p>
        )}
      </main>

      {/* ── Colour picker sheet ─────────────────────────────────────────── */}
      {colorSheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setColorSheet(null)}>
          <div className="bg-white rounded-t-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <p className="font-semibold text-gray-900">Colour-code chat</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                {colorSheet.customer_name || formatPhone(colorSheet.phone)}
              </p>
            </div>
            <div className="px-5 pb-2 space-y-1.5">
              {THREAD_COLORS.map(c => {
                const selected = colorSheet.color === c.key
                return (
                  <button
                    key={c.key}
                    onClick={() => setColor(colorSheet, c.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                      selected ? `${c.tint} border-transparent ring-2 ${c.ring}` : 'bg-white border-gray-200 active:bg-gray-50'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded-full flex-shrink-0 ${c.dot}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-900">{c.label}</span>
                      <span className="block text-[11px] text-gray-500 truncate">{c.desc}</span>
                    </span>
                    {selected && (
                      <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
            <div className="px-5 pt-2 pb-8 space-y-2">
              {colorSheet.color && (
                <button onClick={() => setColor(colorSheet, null)} className="btn-secondary w-full">Remove colour</button>
              )}
              <button onClick={() => setColorSheet(null)} className="w-full text-sm text-gray-400 py-1">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
    </div>
  )
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
        active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
      }`}
    >
      {label}
      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
        {count}
      </span>
    </button>
  )
}

function FollowupChip({ clue }: { clue: FollowupClue }) {
  const [cls, text] = clue.overdue
    ? ['bg-red-50 text-red-600 border-red-200', 'Follow-up overdue']
    : clue.today
      ? ['bg-amber-50 text-amber-700 border-amber-200', 'Follow-up today']
      : ['bg-gray-50 text-gray-500 border-gray-200', `Follow-up in ${clue.days}d`]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${cls}`}>
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {text}
    </span>
  )
}

function formatPhone(phone: string): string {
  if (phone.length === 10) return `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
  return phone
}

function relativeTime(iso: string): string {
  const date = new Date(iso)
  const now  = new Date()
  const diffMs   = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const diffHrs  = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHrs / 24)

  if (diffMins < 1)  return 'just now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHrs  < 24) return `${diffHrs}h`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays  < 7) return `${diffDays}d`
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
