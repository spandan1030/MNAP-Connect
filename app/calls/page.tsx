'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Navbar from '@/components/ui/Navbar'
import CustomerPeek from '@/components/ui/CustomerPeek'
import { createClient } from '@/lib/supabase/client'
import {
  CALL_TOPICS, CALL_INTENTS, TOPIC_LABEL, INTENT_LABEL,
  RECENCY_COLORS, VALUE_COLORS, telUrl,
} from '@/lib/calls'
import { INTEREST_LABEL, SIGNAL_SOURCE_LABEL, CALL_TOPIC_TO_INTEREST, type SignalSource } from '@/lib/signals'
import { cn } from '@/lib/utils'
import type { WaBCallCampaign } from '@/lib/types'

interface MarkerLite {
  recency_tier: string | null
  value_tier: string | null
  rfm_segment: string | null
  frequency_tier: string | null
  audience_labels: string[] | null
  lifetime_value: number | null
  total_bills: number | null
  last_purchase_date: string | null
  days_since_last_purchase: number | null
}
interface Card {
  taskId: string
  customerId: string
  name: string
  phone: string
  dnc: boolean
  hot: boolean
}
interface Summary { attempts: number; successes: number; topics: string[] }
interface HistoryEntry {
  logId: string
  customerId: string
  name: string
  phone: string
  calledAt: string
  success: boolean | null
  topics: string[]
  intent: string | null
  hot: boolean
  salesmanAlias: string | null
}
interface Salesman { id: string; name: string; alias: string }

type Phase = 'idle' | 'outcome' | 'success'

const today = () => new Date().toLocaleDateString('en-CA')

function agoText(days: number): string {
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.round(days / 30.44)}mo ago`
  return `${(days / 365.25).toFixed(1)}y ago`
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function CallsPage() {
  const supabase = createClient()

  const [campaign, setCampaign] = useState<WaBCallCampaign | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [idx, setIdx] = useState(0)
  const [override, setOverride] = useState<Card | null>(null)   // from search
  const [loading, setLoading] = useState(true)

  // Markers are loaded lazily, per visible card (never in bulk up front) so the
  // deck paints after 1 request instead of ~1 per 100 cards. `undefined` = not
  // yet fetched, `null` = fetched, no marker row. markersRef mirrors state so the
  // loader can dedup without re-subscribing.
  const [markers, setMarkers] = useState<Record<string, MarkerLite | null>>({})
  const markersRef = useRef(markers)
  markersRef.current = markers

  const [summary, setSummary] = useState<Summary | null>(null)
  const [signals, setSignals] = useState<{ interest: string; source: SignalSource }[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [logId, setLogId] = useState<string | null>(null)
  const [topics, setTopics] = useState<string[]>([])
  const [intent, setIntent] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [search, setSearch] = useState('')
  const [searchMsg, setSearchMsg] = useState('')
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const [hidden, setHidden] = useState<Card[]>([])

  // ── salesman (who's calling) — a roster picked on the device ──
  const [salesmen, setSalesmen] = useState<Salesman[]>([])
  const [salesmanId, setSalesmanId] = useState<string | null>(null)
  const [salesmanPicker, setSalesmanPicker] = useState(false)
  const activeSalesman = salesmen.find(s => s.id === salesmanId) ?? null

  // ── per-customer call log (tap the summary) ──
  const [custLogs, setCustLogs] = useState<HistoryEntry[] | null>(null)
  const [custLogsName, setCustLogsName] = useState('')
  const [cardMenu, setCardMenu] = useState(false)

  // ── history (recent calls, editable) ──
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [editEntry, setEditEntry] = useState<HistoryEntry | null>(null)
  const [editSuccess, setEditSuccess] = useState<boolean | null>(null)
  const [editTopics, setEditTopics] = useState<string[]>([])
  const [editIntent, setEditIntent] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  const current = override ?? cards[idx] ?? null
  const marker = current ? markers[current.customerId] ?? null : null
  const [peekPhone, setPeekPhone] = useState<string | null>(null)

  // ── initial load ──
  useEffect(() => { loadDeck() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Load the salesman roster; restore the last-used one for this device.
  useEffect(() => {
    supabase.from('salesmen').select('id, name, alias').eq('is_active', true).order('created_at')
      .then(({ data }) => {
        const list = (data ?? []) as Salesman[]
        setSalesmen(list)
        const saved = typeof window !== 'undefined' ? localStorage.getItem('mc_salesman') : null
        setSalesmanId(list.find(s => s.id === saved)?.id ?? list[0]?.id ?? null)
      })
  }, [supabase])

  function pickSalesman(id: string) {
    setSalesmanId(id); setSalesmanPicker(false)
    if (typeof window !== 'undefined') localStorage.setItem('mc_salesman', id)
  }

  async function loadDeck() {
    setLoading(true)
    const { data: camp } = await supabase
      .from('wa_b_call_campaigns').select('*').eq('is_active', true)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!camp) { setCampaign(null); setCards([]); setLoading(false); return }
    setCampaign(camp as WaBCallCampaign)

    // live tasks: pending, not attempted today
    const t = today()
    const tasks: { id: string; customer: { id: string; name: string; phone: string; is_do_not_call: boolean; is_hot_lead: boolean } }[] = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase
        .from('wa_b_call_tasks')
        .select('id, customer:wa_b_customers!inner(id,name,phone,is_do_not_call,is_hot_lead)')
        .eq('campaign_id', (camp as WaBCallCampaign).id)
        .eq('status', 'pending')
        .or(`last_attempt_date.is.null,last_attempt_date.lt.${t}`)
        .range(from, from + PAGE - 1)
      const rows = (data ?? []) as unknown as typeof tasks
      tasks.push(...rows)
      if (rows.length < PAGE) break
    }

    setCards(tasks.map(t => ({
      taskId: t.id,
      customerId: t.customer.id,
      name: t.customer.name,
      phone: t.customer.phone,
      dnc: t.customer.is_do_not_call,
      hot: t.customer.is_hot_lead,
    })))
    setIdx(0)
    setLoading(false)
  }

  // Fetch ONE card's marker on demand and cache it. Called for the visible card
  // (and a one-ahead prefetch) — never in bulk, so a slow network only ever waits
  // on a single small request instead of a chain of them.
  const loadMarker = useCallback(async (customerId: string) => {
    if (!customerId || markersRef.current[customerId] !== undefined) return
    const { data, error } = await supabase
      .from('wa_b_markers')
      .select('recency_tier,value_tier,rfm_segment,frequency_tier,audience_labels,lifetime_value,total_bills,last_purchase_date,days_since_last_purchase')
      .eq('customer_id', customerId)
      .maybeSingle()
    if (error) { console.error('loadMarker failed:', error.message); return }
    setMarkers(prev => ({ ...prev, [customerId]: (data as MarkerLite) ?? null }))
  }, [supabase])

  // ── per-card summary ──
  const loadSummary = useCallback(async (customerId: string) => {
    setSummary(null)
    const { data } = await supabase
      .from('wa_b_call_logs').select('success,topics').eq('customer_id', customerId)
    const logs = (data ?? []) as { success: boolean | null; topics: string[] | null }[]
    const topicSet = new Set<string>()
    let successes = 0
    for (const l of logs) {
      if (l.success) { successes++; (l.topics ?? []).forEach(t => topicSet.add(t)) }
    }
    setSummary({ attempts: logs.length, successes, topics: [...topicSet] })
  }, [supabase])

  // ── converged interest signals (all sources, joined by phone) ──
  const loadSignals = useCallback(async (phone: string) => {
    setSignals([])
    const { data } = await supabase
      .from('wa_signals').select('interest,source').eq('phone', phone)
    setSignals((data ?? []) as { interest: string; source: SignalSource }[])
  }, [supabase])

  useEffect(() => {
    if (!current) return
    loadSummary(current.customerId)
    loadSignals(current.phone)
    loadMarker(current.customerId)          // visible card
    if (!override) loadMarker(cards[idx + 1]?.customerId ?? '')   // prefetch next
    resetCallState()
  }, [current?.customerId])   // eslint-disable-line react-hooks/exhaustive-deps

  function resetCallState() {
    setPhase('idle'); setLogId(null); setTopics([]); setIntent(null); setCardMenu(false)
  }

  // ── star / un-star a hot lead (meaningful convo) — one tap ──
  // A per-customer flag (like DNC). Exported to call_feedback.csv and used by the
  // pipeline as a call marker + lookalike seed. Optimistic; patches every local
  // collection the customer can appear in (deck, search, hidden, history, edit).
  async function setHotLead(customerId: string, next: boolean) {
    setCards(prev => prev.map(c => c.customerId === customerId ? { ...c, hot: next } : c))
    setOverride(prev => prev && prev.customerId === customerId ? { ...prev, hot: next } : prev)
    setHidden(prev => prev.map(c => c.customerId === customerId ? { ...c, hot: next } : c))
    setHistory(prev => prev.map(h => h.customerId === customerId ? { ...h, hot: next } : h))
    setEditEntry(prev => prev && prev.customerId === customerId ? { ...prev, hot: next } : prev)
    await supabase.from('wa_b_customers')
      .update({ is_hot_lead: next, hot_lead_at: next ? new Date().toISOString() : null })
      .eq('id', customerId)
  }
  function toggleHotLead() { if (current) setHotLead(current.customerId, !current.hot) }

  // ── mark "don't call" directly from the card (no call needed) ──
  // Sets is_do_not_call + hides the task. Excludes from calling ONLY —
  // seeding/ad audiences and every other module ignore this flag.
  async function markDontCall() {
    if (!current) return
    setSaving(true)
    await supabase.from('wa_b_customers')
      .update({ is_do_not_call: true, dnc_at: new Date().toISOString() })
      .eq('id', current.customerId)
    await supabase.from('wa_b_call_tasks').update({ status: 'hidden' }).eq('id', current.taskId)
    setSaving(false)
    setCardMenu(false)
    advance()
  }

  // ── undo: allow calling again (from the hidden list) ──
  async function restoreCard(card: Card) {
    await supabase.from('wa_b_customers')
      .update({ is_do_not_call: false, dnc_at: null })
      .eq('id', card.customerId)
    await supabase.from('wa_b_call_tasks').update({ status: 'pending' }).eq('id', card.taskId)
    setHidden(prev => prev.filter(h => h.taskId !== card.taskId))
    setCards(prev => [{ ...card, dnc: false }, ...prev])
  }

  // ── call flow ──
  async function startCall() {
    if (!current) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('wa_b_call_logs')
      .insert({ task_id: current.taskId, customer_id: current.customerId, called_by: user.id, salesman_id: salesmanId, success: null })
      .select('id').single()
    if (data) setLogId(data.id)
    setPhase('outcome')
    window.location.href = telUrl(current.phone)   // open dialer
  }

  // Write an outcome to a call log (used by the live flow and history edits).
  // The DB trigger flips task status (done / hidden+DNC) off success + intent.
  async function commitOutcome(theLogId: string, phone: string, success: boolean, theTopics: string[], theIntent: string | null) {
    const patch = success
      ? { success: true, topics: theTopics, intent: theIntent, outcome_at: new Date().toISOString() }
      : { success: false, outcome_at: new Date().toISOString() }
    await supabase.from('wa_b_call_logs').update(patch).eq('id', theLogId)
    if (success && theTopics.length) {
      const now = new Date().toISOString()
      const rows = theTopics
        .map(tp => ({ phone, interest: CALL_TOPIC_TO_INTEREST[tp], source: 'call', weight: 1, evidence: `call: ${tp}`, last_seen: now }))
        .filter(r => r.interest)
      if (rows.length) await supabase.from('wa_signals').upsert(rows, { onConflict: 'phone,interest,source' })
    }
  }

  async function submitFail() {
    if (!logId) return
    setSaving(true)
    await commitOutcome(logId, current?.phone ?? '', false, [], null)
    setSaving(false)
    advance()
  }

  async function submitSuccess() {
    if (!logId || !intent || !current) return
    setSaving(true)
    await commitOutcome(logId, current.phone, true, topics, intent)
    setSaving(false)
    advance()
  }

  // ── history ──
  async function loadHistory() {
    setHistoryLoading(true)
    const { data } = await supabase
      .from('wa_b_call_logs')
      .select('id, customer_id, called_at, success, topics, intent, customer:wa_b_customers!inner(name,phone,is_hot_lead), salesman:salesmen(alias)')
      .order('called_at', { ascending: false })
      .limit(100)
    const rows = (data ?? []) as unknown as Array<{
      id: string; customer_id: string; called_at: string; success: boolean | null
      topics: string[] | null; intent: string | null; customer: { name: string; phone: string; is_hot_lead: boolean }
      salesman: { alias: string } | { alias: string }[] | null
    }>
    setHistory(rows.map(r => ({
      logId: r.id, customerId: r.customer_id, name: r.customer.name, phone: r.customer.phone,
      calledAt: r.called_at, success: r.success, topics: r.topics ?? [], intent: r.intent,
      hot: r.customer.is_hot_lead,
      salesmanAlias: (Array.isArray(r.salesman) ? r.salesman[0]?.alias : r.salesman?.alias) ?? null,
    })))
    setHistoryLoading(false)
  }

  function toggleHistory() {
    const next = !historyOpen
    setHistoryOpen(next)
    if (next) loadHistory()
  }

  // Tap the summary → this customer's own call log (date, outcome, signals, salesman).
  async function openCustLogs(customerId: string, name: string) {
    setCustLogsName(name); setCustLogs([])
    const { data } = await supabase
      .from('wa_b_call_logs')
      .select('id, customer_id, called_at, success, topics, intent, salesman:salesmen(alias)')
      .eq('customer_id', customerId).order('called_at', { ascending: false })
    const rows = (data ?? []) as unknown as Array<{ id: string; customer_id: string; called_at: string; success: boolean | null; topics: string[] | null; intent: string | null; salesman: { alias: string } | { alias: string }[] | null }>
    setCustLogs(rows.map(r => ({
      logId: r.id, customerId: r.customer_id, name, phone: '', calledAt: r.called_at,
      success: r.success, topics: r.topics ?? [], intent: r.intent, hot: false,
      salesmanAlias: (Array.isArray(r.salesman) ? r.salesman[0]?.alias : r.salesman?.alias) ?? null,
    })))
  }

  function openEdit(e: HistoryEntry) {
    setEditEntry(e)
    setEditSuccess(e.success)
    setEditTopics(e.topics)
    setEditIntent(e.intent)
  }

  async function submitEdit() {
    if (!editEntry || editSuccess === null) return
    if (editSuccess && !editIntent) return
    setEditSaving(true)
    await commitOutcome(editEntry.logId, editEntry.phone, editSuccess, editSuccess ? editTopics : [], editSuccess ? editIntent : null)
    setEditSaving(false)
    setEditEntry(null)
    loadHistory()
    if (editEntry.customerId === current?.customerId) loadSummary(current.customerId)
  }

  // remove current card from the deck and move on
  function advance() {
    if (override) { setOverride(null); resetCallState(); return }
    setCards(prev => {
      const next = prev.filter((_, i) => i !== idx)
      setIdx(i => Math.min(i, Math.max(0, next.length - 1)))
      return next
    })
    resetCallState()
  }

  function go(delta: number) {
    if (override) { setOverride(null); return }
    setIdx(i => Math.max(0, Math.min(cards.length - 1, i + delta)))
  }

  // ── search ──
  async function doSearch() {
    setSearchMsg('')
    const digits = search.replace(/\D/g, '').slice(-10)
    if (digits.length !== 10) { setSearchMsg('Enter a 10-digit number'); return }
    if (!campaign) return
    const { data } = await supabase
      .from('wa_b_call_tasks')
      .select('id, customer:wa_b_customers!inner(id,name,phone,is_do_not_call,is_hot_lead)')
      .eq('campaign_id', campaign.id)
      .eq('customer.phone', digits)
      .maybeSingle()
    if (!data) { setSearchMsg('No card for that number in this campaign'); return }
    const row = data as unknown as { id: string; customer: { id: string; name: string; phone: string; is_do_not_call: boolean; is_hot_lead: boolean } }
    setOverride({
      taskId: row.id, customerId: row.customer.id, name: row.customer.name,
      phone: row.customer.phone, dnc: row.customer.is_do_not_call, hot: row.customer.is_hot_lead,
    })   // marker loads lazily via the per-card effect
    setSearch('')
  }

  // ── hidden (don't-call) cards ──
  async function openHidden() {
    if (!campaign) return
    const { data } = await supabase
      .from('wa_b_call_tasks')
      .select('id, customer:wa_b_customers!inner(id,name,phone,is_do_not_call,is_hot_lead)')
      .eq('campaign_id', campaign.id).eq('status', 'hidden')
    const rows = (data ?? []) as unknown as { id: string; customer: { id: string; name: string; phone: string; is_do_not_call: boolean; is_hot_lead: boolean } }[]
    setHidden(rows.map(r => ({
      taskId: r.id, customerId: r.customer.id, name: r.customer.name,
      phone: r.customer.phone, dnc: r.customer.is_do_not_call, hot: r.customer.is_hot_lead,
    })))
    setHiddenOpen(true)
  }

  // ── swipe ──
  const touchX = useRef<number | null>(null)
  function onTouchStart(e: React.TouchEvent) { touchX.current = e.touches[0].clientX }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current == null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1)
    touchX.current = null
  }

  // ── render ──
  if (loading) return <Shell><Center>Loading…</Center></Shell>
  if (!campaign) return <Shell><Center>No active call campaign. Ask admin to create one in Call Control.</Center></Shell>

  return (
    <Shell>
      <div className="max-w-lg mx-auto w-full px-4 py-3 space-y-3">
        {/* who's calling — the active salesman (tap to switch) */}
        <div className="relative">
          <button onClick={() => setSalesmanPicker(o => !o)}
            className="w-full flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
            <span className="text-xs text-gray-500">Calling as</span>
            <span className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-gray-900">{activeSalesman ? `${activeSalesman.alias} · ${activeSalesman.name}` : (salesmen.length ? 'Pick salesman' : 'No salesmen — add in Call Control')}</span>
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </span>
          </button>
          {salesmanPicker && salesmen.length > 0 && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSalesmanPicker(false)} />
              <div className="absolute right-0 left-0 top-11 z-40 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
                {salesmen.map(s => (
                  <button key={s.id} onClick={() => pickSalesman(s.id)}
                    className={cn('w-full text-left px-4 py-2.5 text-sm border-b border-gray-50 last:border-0',
                      s.id === salesmanId ? 'bg-green-50 text-green-700 font-semibold' : 'text-gray-700')}>
                    <b>{s.alias}</b> · {s.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* header: campaign + search + hidden menu */}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">{campaign.name}</p>
            <p className="text-[11px] text-gray-400">{override ? 'Searched card' : `${cards.length} to call`}</p>
          </div>
          <button onClick={openHidden} aria-label="Hidden cards" className="text-gray-400 hover:text-gray-700 p-1.5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
            </svg>
          </button>
        </div>

        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Search phone…" value={search}
            onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} inputMode="numeric" />
          <button onClick={doSearch} className="text-xs font-medium text-gray-700 border border-gray-200 px-3 rounded-lg">Find</button>
        </div>
        {searchMsg && <p className="text-[11px] text-red-600">{searchMsg}</p>}

        {!current && <Center>All done for today 🎉</Center>}

        {current && (
          <div className="card p-4 space-y-3" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {/* name + number */}
            <div className="flex items-start justify-between">
              <button onClick={() => setPeekPhone(current.phone)} className="text-left">
                <h1 className="text-base font-bold text-gray-900 underline decoration-dotted underline-offset-2">{current.name}</h1>
                <p className="text-xs text-gray-500">+91 {current.phone}</p>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                {override && <button onClick={() => setOverride(null)} className="text-[11px] text-gray-500 border border-gray-200 rounded-lg px-2 py-1">Back to list</button>}
                {/* hot-lead star — appears only once the call is marked connected
                    (success phase now, or a prior connected call on this customer) */}
                {(phase === 'success' || (summary?.successes ?? 0) > 0) && (
                  <button onClick={toggleHotLead} title="Hot lead"
                    aria-label={current.hot ? 'Remove hot-lead star' : 'Mark as hot lead'} className="p-1">
                    <svg className={cn('w-6 h-6', current.hot ? 'text-amber-400' : 'text-gray-300')}
                      fill={current.hot ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M11.48 3.5a.56.56 0 011.04 0l2.12 4.66 5.1.53c.49.05.69.66.32 1l-3.8 3.44 1.06 5.02c.1.48-.42.85-.85.6L12 16.9l-4.47 2.4c-.43.24-.95-.13-.85-.6l1.06-5.03-3.8-3.43a.56.56 0 01.32-1l5.1-.53 2.12-4.66z" />
                    </svg>
                  </button>
                )}
                {/* per-card three-dot menu */}
                <div className="relative">
                  <button onClick={() => setCardMenu(o => !o)} aria-label="Card menu"
                    className="text-gray-400 hover:text-gray-700 p-1.5 -mr-1.5">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
                    </svg>
                  </button>
                  {cardMenu && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setCardMenu(false)} />
                      <div className="absolute right-0 top-8 z-20 w-40 bg-white rounded-lg border border-gray-200 shadow-lg py-1">
                        {current.dnc ? (
                          <button onClick={() => { setCardMenu(false); restoreCard(current) }}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-green-700 hover:bg-green-50">
                            Allow calling again
                          </button>
                        ) : (
                          <button onClick={markDontCall} disabled={saving}
                            className="w-full text-left px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">
                            Don’t call
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* markers */}
            {marker && (
              <div className="flex flex-wrap gap-1.5">
                {marker.recency_tier && <Chip className={RECENCY_COLORS[marker.recency_tier]}>{marker.recency_tier}</Chip>}
                {marker.value_tier && <Chip className={VALUE_COLORS[marker.value_tier]}>{marker.value_tier}</Chip>}
                {marker.rfm_segment && <Chip className="bg-gray-50 text-gray-600 border-gray-200">{marker.rfm_segment}</Chip>}
                {marker.frequency_tier && <Chip className="bg-gray-50 text-gray-600 border-gray-200">{marker.frequency_tier}</Chip>}
              </div>
            )}
            {marker?.audience_labels?.length ? (
              <div className="flex flex-wrap gap-1">
                {marker.audience_labels.map(a => (
                  <span key={a} className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">{a}</span>
                ))}
              </div>
            ) : null}

            {/* converged interests (sales + whatsapp + call + billing) */}
            {signals.length > 0 && (() => {
              const byInterest = new Map<string, Set<SignalSource>>()
              for (const s of signals) {
                if (!byInterest.has(s.interest)) byInterest.set(s.interest, new Set())
                byInterest.get(s.interest)!.add(s.source)
              }
              const SRC_DOT: Record<SignalSource, string> = {
                sales: 'bg-amber-500', whatsapp: 'bg-green-500', call: 'bg-blue-500', billing: 'bg-purple-500', walkin: 'bg-pink-500',
              }
              const usedSources = [...new Set(signals.map(s => s.source))]
              return (
                <div className="border-t border-gray-100 pt-2 space-y-1">
                  <p className="text-[10px] text-gray-400 font-medium">Interested in</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[...byInterest.entries()].map(([interest, sources]) => (
                      <span key={interest}
                        title={[...sources].map(s => SIGNAL_SOURCE_LABEL[s]).join(', ')}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                        {INTEREST_LABEL[interest] ?? interest}
                        <span className="flex gap-0.5">
                          {[...sources].map(s => <span key={s} className={cn('w-1.5 h-1.5 rounded-full', SRC_DOT[s])} />)}
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {usedSources.map(s => (
                      <span key={s} className="inline-flex items-center gap-1 text-[9px] text-gray-400">
                        <span className={cn('w-1.5 h-1.5 rounded-full', SRC_DOT[s])} />{SIGNAL_SOURCE_LABEL[s]}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* last purchase */}
            {marker && (() => {
              const m = marker
              if (m.last_purchase_date) {
                const d = new Date(m.last_purchase_date + 'T00:00:00')
                const days = Math.round((Date.now() - d.getTime()) / 86400000)
                return (
                  <p className="text-[11px] text-gray-500">
                    Last purchase: <b className="text-gray-700">{d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b> · {agoText(days)}
                  </p>
                )
              }
              if (m.days_since_last_purchase != null) {
                return <p className="text-[11px] text-gray-500">Last purchase: {agoText(m.days_since_last_purchase)} <span className="text-gray-400">(approx)</span></p>
              }
              return null
            })()}

            {/* summary — tap to see this customer's full call log */}
            {summary && (
              <button
                onClick={() => summary.attempts > 0 && openCustLogs(current.customerId, current.name)}
                disabled={summary.attempts === 0}
                className="w-full text-left text-[11px] text-gray-500 border-t border-gray-100 pt-2 disabled:cursor-default">
                {summary.attempts === 0
                  ? 'No calls yet.'
                  : <>Calls: <b className="text-gray-700">{summary.attempts}</b> · Connected: <b className="text-gray-700">{summary.successes}</b>
                     {summary.topics.length > 0 && <> · Interested in: {summary.topics.map(t => TOPIC_LABEL[t] ?? t).join(', ')}</>}
                     <span className="text-green-700 font-medium"> · view log ›</span></>}
              </button>
            )}

            {/* action zone */}
            {current.dnc ? (
              <p className="text-xs font-bold text-red-600 border-t border-gray-100 pt-3">Marked “Don’t call”.</p>
            ) : phase === 'idle' ? (
              <button onClick={startCall} className="btn-primary w-full py-3 text-sm">📞 Call</button>
            ) : phase === 'outcome' ? (
              <div className="space-y-2 border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-600 text-center">Did the call connect?</p>
                <div className="flex gap-2">
                  <button onClick={() => setPhase('success')} disabled={saving}
                    className="flex-1 py-3 rounded-xl border-2 border-green-500 text-green-700 font-bold text-lg">✓</button>
                  <button onClick={submitFail} disabled={saving}
                    className="flex-1 py-3 rounded-xl border-2 border-red-400 text-red-600 font-bold text-lg">✗</button>
                </div>
              </div>
            ) : (
              /* success → topics + intent */
              <div className="space-y-3 border-t border-gray-100 pt-3">
                <div>
                  <p className="text-[11px] text-gray-400 font-medium mb-1">What are they interested in?</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CALL_TOPICS.map(t => (
                      <button key={t.value} type="button"
                        onClick={() => setTopics(p => p.includes(t.value) ? p.filter(x => x !== t.value) : [...p, t.value])}
                        className={cn('px-3 py-1.5 rounded-lg text-xs border font-medium',
                          topics.includes(t.value) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-200')}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 font-medium mb-1">Will they come?</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CALL_INTENTS.map(i => (
                      <button key={i.value} type="button" onClick={() => setIntent(i.value)}
                        className={cn('px-3 py-1.5 rounded-lg text-xs border', intent === i.value ? i.color : i.idle)}>
                        {i.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={submitSuccess} disabled={saving || !intent} className="btn-primary w-full py-2.5">
                  {saving ? 'Saving…' : 'Submit'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* deck nav */}
        {!override && cards.length > 0 && (
          <div className="flex items-center justify-between">
            <button onClick={() => go(-1)} disabled={idx === 0} className="text-xs text-gray-500 border border-gray-200 rounded-lg px-4 py-2 disabled:opacity-40">← Prev</button>
            <span className="text-[11px] text-gray-400">{idx + 1} / {cards.length}</span>
            <button onClick={() => go(1)} disabled={idx >= cards.length - 1} className="text-xs text-gray-500 border border-gray-200 rounded-lg px-4 py-2 disabled:opacity-40">Next →</button>
          </div>
        )}

        {/* history — recent calls, tap to edit details later */}
        <div className="pt-1">
          <button onClick={toggleHistory}
            className="w-full text-xs font-medium text-gray-600 border border-gray-200 rounded-lg py-2">
            {historyOpen ? 'Hide history ▲' : 'History — recent calls ▼'}
          </button>
          {historyOpen && (
            <div className="mt-2 border border-gray-100 rounded-xl overflow-hidden">
              {historyLoading && <p className="text-xs text-gray-400 p-3">Loading…</p>}
              {!historyLoading && history.length === 0 && <p className="text-xs text-gray-400 p-3">No calls logged yet.</p>}
              <div className="max-h-[50vh] overflow-y-auto divide-y divide-gray-50">
                {history.map(h => (
                  <button key={h.logId} onClick={() => openEdit(h)} className="w-full text-left px-3 py-2 hover:bg-gray-50">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">
                          {h.hot && <span className="text-amber-400" title="Hot lead">★ </span>}
                          {h.name} <span className="text-gray-400 font-normal">+91 {h.phone}</span>
                        </p>
                        <p className="text-[10px] text-gray-400">{fmtDateTime(h.calledAt)} · {h.salesmanAlias ?? '-'}</p>
                      </div>
                      <OutcomeBadge success={h.success} intent={h.intent} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* hidden cards modal */}
      {hiddenOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setHiddenOpen(false)} />
          <div className="fixed inset-x-4 top-16 z-50 bg-white rounded-xl border border-gray-200 shadow-lg max-w-lg mx-auto max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white">
              <p className="text-sm font-semibold text-gray-700">Hidden — Don’t call ({hidden.length})</p>
              <button onClick={() => setHiddenOpen(false)} className="text-gray-400 text-lg leading-none">×</button>
            </div>
            {hidden.length === 0 && <p className="text-xs text-gray-400 p-4">None.</p>}
            {hidden.map(h => (
              <div key={h.taskId} className="px-4 py-2 border-b border-gray-50 last:border-0 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{h.name}</p>
                  <p className="text-[11px] text-gray-400">+91 {h.phone}</p>
                </div>
                <button onClick={() => restoreCard(h)}
                  className="shrink-0 text-[11px] font-medium text-green-700 border border-green-200 rounded-lg px-2.5 py-1 hover:bg-green-50">
                  Allow
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* edit-a-past-call modal (from history) */}
      {editEntry && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setEditEntry(null)} />
          <div className="fixed inset-x-4 top-14 z-50 bg-white rounded-xl border border-gray-200 shadow-lg max-w-lg mx-auto p-4 space-y-3 max-h-[80vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <button onClick={() => { const ph = editEntry.phone; setEditEntry(null); setPeekPhone(ph) }} className="text-left">
                <p className="text-sm font-bold text-gray-900 underline decoration-dotted underline-offset-2">{editEntry.name}</p>
                <p className="text-xs text-gray-500">+91 {editEntry.phone} · {fmtDateTime(editEntry.calledAt)}{editEntry.salesmanAlias ? ` · ${editEntry.salesmanAlias}` : ''}</p>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                {/* star — only for connected calls */}
                {editSuccess === true && (
                  <button onClick={() => setHotLead(editEntry.customerId, !editEntry.hot)} title="Hot lead"
                    aria-label={editEntry.hot ? 'Remove hot-lead star' : 'Mark as hot lead'} className="p-1">
                    <svg className={cn('w-6 h-6', editEntry.hot ? 'text-amber-400' : 'text-gray-300')}
                      fill={editEntry.hot ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M11.48 3.5a.56.56 0 011.04 0l2.12 4.66 5.1.53c.49.05.69.66.32 1l-3.8 3.44 1.06 5.02c.1.48-.42.85-.85.6L12 16.9l-4.47 2.4c-.43.24-.95-.13-.85-.6l1.06-5.03-3.8-3.43a.56.56 0 01.32-1l5.1-.53 2.12-4.66z" />
                    </svg>
                  </button>
                )}
                <button onClick={() => setEditEntry(null)} className="text-gray-400 text-lg leading-none">×</button>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setEditSuccess(true)}
                className={cn('flex-1 py-2.5 rounded-xl border-2 font-bold text-sm', editSuccess === true ? 'border-green-500 text-green-700 bg-green-50' : 'border-gray-200 text-gray-400')}>✓ Connected</button>
              <button onClick={() => { setEditSuccess(false); setEditTopics([]); setEditIntent(null) }}
                className={cn('flex-1 py-2.5 rounded-xl border-2 font-bold text-sm', editSuccess === false ? 'border-red-400 text-red-600 bg-red-50' : 'border-gray-200 text-gray-400')}>✗ No answer</button>
            </div>

            {editSuccess && (
              <>
                <div>
                  <p className="text-[11px] text-gray-400 font-medium mb-1">What are they interested in?</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CALL_TOPICS.map(t => (
                      <button key={t.value} type="button"
                        onClick={() => setEditTopics(p => p.includes(t.value) ? p.filter(x => x !== t.value) : [...p, t.value])}
                        className={cn('px-3 py-1.5 rounded-lg text-xs border font-medium', editTopics.includes(t.value) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-200')}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 font-medium mb-1">Will they come?</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CALL_INTENTS.map(i => (
                      <button key={i.value} type="button" onClick={() => setEditIntent(i.value)}
                        className={cn('px-3 py-1.5 rounded-lg text-xs border', editIntent === i.value ? i.color : i.idle)}>
                        {i.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <button onClick={submitEdit} disabled={editSaving || editSuccess === null || (!!editSuccess && !editIntent)}
              className="btn-primary w-full py-2.5">
              {editSaving ? 'Saving…' : 'Save details'}
            </button>
          </div>
        </>
      )}

      {/* per-customer call log (from tapping the summary) */}
      {custLogs && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setCustLogs(null)} />
          <div className="fixed inset-x-4 top-16 z-50 bg-white rounded-xl border border-gray-200 shadow-lg max-w-lg mx-auto max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white">
              <p className="text-sm font-semibold text-gray-700 truncate">Call log — {custLogsName}</p>
              <button onClick={() => setCustLogs(null)} className="text-gray-400 text-lg leading-none">×</button>
            </div>
            {custLogs.length === 0 && <p className="text-xs text-gray-400 p-4">No calls logged.</p>}
            {custLogs.map(l => (
              <div key={l.logId} className="px-4 py-2.5 border-b border-gray-50 last:border-0 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-gray-700">{fmtDateTime(l.calledAt)} <span className="text-gray-400">· {l.salesmanAlias ?? '-'}</span></p>
                  {l.success && l.topics.length > 0 && <p className="text-[10px] text-gray-400 truncate">{l.topics.map(t => TOPIC_LABEL[t] ?? t).join(', ')}</p>}
                </div>
                <OutcomeBadge success={l.success} intent={l.intent} />
              </div>
            ))}
          </div>
        </>
      )}

      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex flex-col"><Navbar />{children}</div>
}
function Center({ children }: { children: React.ReactNode }) {
  return <main className="flex-1 flex items-center justify-center text-gray-400 text-sm px-6 text-center py-20">{children}</main>
}
function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('text-xs px-2.5 py-1 rounded-full border font-medium', className)}>{children}</span>
}
function OutcomeBadge({ success, intent }: { success: boolean | null; intent: string | null }) {
  const base = 'text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0'
  if (success === null) return <span className={cn(base, 'text-amber-700 bg-amber-50 border-amber-200')}>Pending</span>
  if (!success) return <span className={cn(base, 'text-gray-500 bg-gray-50 border-gray-200')}>No answer</span>
  return <span className={cn(base, 'text-green-700 bg-green-50 border-green-200')}>{intent ? INTENT_LABEL[intent] ?? 'Connected' : 'Connected'}</span>
}
