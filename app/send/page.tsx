'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import { buildWhatsAppUrl, applyPlaceholders } from '@/lib/utils'
import type { InterestTopic, Customer, MessageTemplate } from '@/lib/types'

interface CustomerWithInterests extends Customer {
  interests: string[]
}

interface TodayLog {
  customer_id: string
  topic_id: string | null
}

interface TodayRates {
  rate_24kt: number | null
  rate_22kt: number | null
  rate_18kt: number | null
}

type Step =
  | 'list'
  | 'pick-template'
  | 'preview'
  | 'confirm-resend'
  | 'broadcast-pick-template'
  | 'broadcast-preview'
  | 'broadcast-sending'
  | 'broadcast-result'

interface BroadcastResult {
  sent: number
  failed: number
  total: number
  results: Array<{ name: string; status: 'sent' | 'failed'; error?: string }>
}

export default function SendPage() {
  const supabase = createClient()

  const [topics, setTopics] = useState<InterestTopic[]>([])
  const [allTopics, setAllTopics] = useState<InterestTopic[]>([])
  const [customers, setCustomers] = useState<CustomerWithInterests[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [todayLogs, setTodayLogs] = useState<TodayLog[]>([])
  const [todayRates, setTodayRates] = useState<TodayRates | null>(null)

  // Per-customer send flow state
  const [step, setStep] = useState<Step>('list')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithInterests | null>(null)
  const [candidateTemplates, setCandidateTemplates] = useState<MessageTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null)
  const [previewMessage, setPreviewMessage] = useState('')
  const [editMode, setEditMode] = useState(false)

  // Broadcast state
  const [broadcastTemplate, setBroadcastTemplate] = useState<MessageTemplate | null>(null)
  const [broadcastResult, setBroadcastResult] = useState<BroadcastResult | null>(null)

  useEffect(() => { loadData() }, [])

  const todayStr = new Date().toLocaleDateString('en-CA')

  async function loadData() {
    setLoading(true)
    const [topicsRes, customersRes, interestsRes, templatesRes, logsRes, ratesRes] = await Promise.all([
      supabase.from('wa_interest_topics').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('wa_customers').select('*').eq('is_active', true).eq('is_opted_out', false).order('name'),
      supabase.from('wa_customer_interests').select('customer_id, topic_id'),
      supabase.from('wa_message_templates').select('*').eq('is_active', true),
      supabase
        .from('wa_communication_log')
        .select('customer_id, topic_id')
        .gte('sent_at', `${todayStr}T00:00:00`)
        .lt('sent_at', `${todayStr}T23:59:59`),
      supabase
        .from('daily_rates')
        .select('rate_24kt, rate_22kt, rate_18kt')
        .eq('date', todayStr)
        .maybeSingle(),
    ])

    const topicList: InterestTopic[] = topicsRes.data ?? []
    setAllTopics(topicList)
    const parentTopics = topicList.filter(t => !t.parent_id)
    setTopics(parentTopics)
    setTemplates(templatesRes.data ?? [])

    setActiveFilter(prev => {
      if (prev !== 'all') return prev
      const dailyRates = parentTopics.find(t => t.name === 'Daily Rates')
      return dailyRates ? dailyRates.id : 'all'
    })
    setTodayLogs(logsRes.data ?? [])
    setTodayRates(ratesRes.data ?? null)

    const interestMap: Record<string, string[]> = {}
    for (const row of (interestsRes.data ?? [])) {
      if (!interestMap[row.customer_id]) interestMap[row.customer_id] = []
      interestMap[row.customer_id].push(row.topic_id)
    }

    setCustomers((customersRes.data ?? []).map((c: Customer) => ({
      ...c,
      interests: interestMap[c.id] ?? [],
    })))
    setLoading(false)
  }

  const alreadySentToday = useMemo<Set<string>>(() => {
    if (activeFilter === 'all') return new Set()
    return new Set(
      todayLogs
        .filter(l => l.topic_id === activeFilter)
        .map(l => l.customer_id)
    )
  }, [activeFilter, todayLogs])

  const filteredCustomers = customers.filter(c => {
    const matchesFilter =
      activeFilter === 'all' ||
      c.interests.includes(activeFilter) ||
      c.interests.some(tid => {
        const t = allTopics.find(x => x.id === tid)
        return t?.parent_id === activeFilter
      })
    const matchesSearch =
      search === '' ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
    return matchesFilter && matchesSearch
  })

  // ── Per-customer send flow ──────────────────────────────────────────────────

  function handleSendClick(customer: CustomerWithInterests) {
    setSelectedCustomer(customer)
    if (alreadySentToday.has(customer.id)) {
      setStep('confirm-resend')
    } else {
      openSendFlow(customer)
    }
  }

  function openSendFlow(customer: CustomerWithInterests) {
    let candidates: MessageTemplate[] = []
    if (activeFilter === 'all') {
      candidates = templates.filter(t => t.topic_id === null || customer.interests.includes(t.topic_id))
    } else {
      candidates = templates.filter(t => t.topic_id === activeFilter)
    }

    if (candidates.length === 0) {
      alert('No templates available for this selection. Add templates in Templates tab.')
      resetFlow()
      return
    }

    if (candidates.length === 1) {
      const msg = applyPlaceholders(candidates[0].body_text, customer.name, todayRates)
      setSelectedTemplate(candidates[0])
      setPreviewMessage(msg)
      setStep('preview')
    } else {
      setCandidateTemplates(candidates)
      setStep('pick-template')
    }
  }

  function handlePickTemplate(template: MessageTemplate) {
    const msg = applyPlaceholders(template.body_text, selectedCustomer!.name, todayRates)
    setSelectedTemplate(template)
    setPreviewMessage(msg)
    setStep('preview')
  }

  async function handleOpenWhatsApp() {
    if (!selectedCustomer || !selectedTemplate) return

    const url = buildWhatsAppUrl(selectedCustomer.phone, previewMessage)
    window.open(url, '_blank')

    const loggedTopicId = activeFilter !== 'all' ? activeFilter : selectedTemplate.topic_id

    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('wa_communication_log').insert({
      customer_id: selectedCustomer.id,
      template_id: selectedTemplate.id,
      topic_id: loggedTopicId,
      message_sent: previewMessage,
      sent_by: user!.id,
    })

    setTodayLogs(prev => [...prev, { customer_id: selectedCustomer.id, topic_id: loggedTopicId }])
    resetFlow()
  }

  function resetFlow() {
    setStep('list')
    setSelectedCustomer(null)
    setSelectedTemplate(null)
    setCandidateTemplates([])
    setPreviewMessage('')
    setEditMode(false)
    setBroadcastTemplate(null)
    setBroadcastResult(null)
  }

  // ── Broadcast flow ──────────────────────────────────────────────────────────

  function handleBroadcastClick() {
    const candidates = templates.filter(t => t.topic_id === activeFilter)
    if (candidates.length === 0) {
      alert('No templates for this topic. Add templates in the Templates tab.')
      return
    }
    if (candidates.length === 1) {
      setBroadcastTemplate(candidates[0])
      setStep('broadcast-preview')
    } else {
      setCandidateTemplates(candidates)
      setStep('broadcast-pick-template')
    }
  }

  function handleBroadcastPickTemplate(template: MessageTemplate) {
    setBroadcastTemplate(template)
    setStep('broadcast-preview')
  }

  async function handleBroadcastSend() {
    if (!broadcastTemplate) return
    setStep('broadcast-sending')

    try {
      const res = await fetch('/api/whatsapp/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId: activeFilter, templateId: broadcastTemplate.id }),
      })
      const data: BroadcastResult = await res.json()
      setBroadcastResult(data)

      // Update today's logs so sent customers grey out in the list
      if (data.results) {
        const sentCustomerPhones = new Set(
          data.results.filter(r => r.status === 'sent').map(r => r.name)
        )
        const newLogs = customers
          .filter(c => sentCustomerPhones.has(c.name))
          .map(c => ({ customer_id: c.id, topic_id: activeFilter }))
        setTodayLogs(prev => [...prev, ...newLogs])
      }

      setStep('broadcast-result')
    } catch {
      setBroadcastResult({ sent: 0, failed: 0, total: 0, results: [] })
      setStep('broadcast-result')
    }
  }

  function topicName(id: string) {
    return allTopics.find(t => t.id === id)?.name ?? id
  }

  // Recipient count for broadcast (customers in filter not yet sent today)
  const broadcastRecipients = filteredCustomers.filter(c => !alreadySentToday.has(c.id))

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3">
        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button
            onClick={() => setActiveFilter('all')}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              activeFilter === 'all'
                ? 'bg-green-600 text-white border-green-600'
                : 'bg-white text-gray-600 border-gray-300'
            }`}
          >
            All
          </button>
          {topics.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveFilter(t.id)}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                activeFilter === t.id
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-600 border-gray-300'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>

        {/* Today's rates status */}
        {!loading && (
          todayRates ? (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0" />
              <span>
                Today's rates loaded — 24KT ₹{todayRates.rate_24kt?.toLocaleString('en-IN') ?? '—'} &nbsp;·&nbsp;
                22KT ₹{todayRates.rate_22kt?.toLocaleString('en-IN') ?? '—'} &nbsp;·&nbsp;
                18KT ₹{todayRates.rate_18kt?.toLocaleString('en-IN') ?? '—'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full flex-shrink-0" />
              <span>Today's rates not yet synced — rate placeholders will show —</span>
            </div>
          )
        )}

        {/* Search */}
        <input
          type="search"
          placeholder="Search by name or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input"
        />

        {/* Count row + Broadcast button */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400">
            {loading ? 'Loading…' : `${filteredCustomers.length} customer${filteredCustomers.length !== 1 ? 's' : ''}`}
          </p>
          {!loading && activeFilter !== 'all' && broadcastRecipients.length > 0 && (
            <button
              onClick={handleBroadcastClick}
              className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 active:bg-green-800 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
              Broadcast to {broadcastRecipients.length}
            </button>
          )}
        </div>

        {!loading && filteredCustomers.length === 0 && (
          <div className="card p-8 text-center text-gray-400 text-sm">No customers found.</div>
        )}

        <div className="space-y-2">
          {filteredCustomers.map(customer => {
            const sentToday = alreadySentToday.has(customer.id)
            return (
              <div key={customer.id} className="card p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{customer.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">+91 {customer.phone}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {customer.interests.slice(0, 3).map(tid => (
                      <span key={tid} className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-100">
                        {topicName(tid)}
                      </span>
                    ))}
                    {customer.interests.length > 3 && (
                      <span className="text-xs text-gray-400">+{customer.interests.length - 3} more</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleSendClick(customer)}
                  className={`flex-shrink-0 text-xs font-bold px-4 py-2.5 rounded-xl transition-colors flex items-center gap-1.5 ${
                    sentToday
                      ? 'bg-gray-200 text-gray-400 cursor-pointer'
                      : 'bg-green-600 hover:bg-green-700 active:bg-green-800 text-white'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.096.544 4.066 1.497 5.777L0 24l6.385-1.473A11.955 11.955 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.848 0-3.58-.497-5.071-1.366l-.361-.214-3.742.862.934-3.628-.235-.374A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                  </svg>
                  {sentToday ? 'Sent' : 'Send'}
                </button>
              </div>
            )
          })}
        </div>
      </main>

      {/* ── Per-customer sheets ────────────────────────────────────────────── */}

      {/* Resend confirmation */}
      {step === 'confirm-resend' && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={resetFlow}>
          <div className="bg-white rounded-t-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 px-5 pt-5 pb-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <p className="font-semibold text-gray-900">Already sent today</p>
              <p className="text-sm text-gray-500 mt-1">
                You already sent a <span className="font-medium text-gray-700">{topicName(activeFilter)}</span> message to{' '}
                <span className="font-medium text-gray-700">{selectedCustomer.name}</span> today. Send again?
              </p>
            </div>
            <div className="flex-shrink-0 px-5 pt-2 pb-8 space-y-2">
              <button onClick={() => openSendFlow(selectedCustomer)} className="btn-primary w-full">
                Yes, Send Again
              </button>
              <button onClick={resetFlow} className="btn-secondary w-full">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Template picker */}
      {step === 'pick-template' && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={resetFlow}>
          <div className="bg-white rounded-t-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 px-5 pt-5 pb-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <p className="font-semibold text-gray-900">Choose a message</p>
              <p className="text-xs text-gray-500 mt-0.5">Sending to {selectedCustomer.name}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 space-y-2 pb-2">
              {candidateTemplates.map(t => (
                <button
                  key={t.id}
                  onClick={() => handlePickTemplate(t)}
                  className="w-full text-left card p-4 hover:border-green-300 hover:bg-green-50 transition-colors"
                >
                  <p className="font-medium text-sm text-gray-900">{t.name}</p>
                  {t.topic_id && (
                    <p className="text-xs text-green-600 mt-0.5">{topicName(t.topic_id)}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                    {applyPlaceholders(t.body_text, selectedCustomer.name, todayRates)}
                  </p>
                </button>
              ))}
            </div>
            <div className="flex-shrink-0 px-5 pt-3 pb-8">
              <button onClick={resetFlow} className="btn-secondary w-full">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Per-customer preview */}
      {step === 'preview' && selectedCustomer && selectedTemplate && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={resetFlow}>
          <div className="bg-white rounded-t-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 px-5 pt-5 pb-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{selectedCustomer.name}</p>
                  <p className="text-xs text-gray-500">+91 {selectedCustomer.phone}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setEditMode(m => !m)}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                      editMode
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {editMode ? 'Done' : 'Edit'}
                  </button>
                  <span className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full border border-green-100 font-medium">
                    {selectedTemplate.name}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-2">
              {editMode ? (
                <textarea
                  value={previewMessage}
                  onChange={e => setPreviewMessage(e.target.value)}
                  className="input resize-none text-sm leading-relaxed"
                  rows={8}
                  autoFocus
                />
              ) : (
                <div className="bg-[#dcf8c6] rounded-2xl rounded-tl-sm p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {previewMessage}
                </div>
              )}
            </div>
            <div className="flex-shrink-0 px-5 pt-3 pb-8 space-y-2">
              <button
                onClick={handleOpenWhatsApp}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.096.544 4.066 1.497 5.777L0 24l6.385-1.473A11.955 11.955 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.848 0-3.58-.497-5.071-1.366l-.361-.214-3.742.862.934-3.628-.235-.374A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                </svg>
                Open WhatsApp
              </button>
              <button onClick={() => { setStep('pick-template'); setEditMode(false) }} className="btn-secondary w-full">
                ← Change Message
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Broadcast sheets ───────────────────────────────────────────────── */}

      {/* Broadcast template picker */}
      {step === 'broadcast-pick-template' && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={resetFlow}>
          <div className="bg-white rounded-t-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 px-5 pt-5 pb-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <p className="font-semibold text-gray-900">Choose broadcast message</p>
              <p className="text-xs text-gray-500 mt-0.5">Sending to {broadcastRecipients.length} recipients</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 space-y-2 pb-2">
              {candidateTemplates.map(t => (
                <button
                  key={t.id}
                  onClick={() => handleBroadcastPickTemplate(t)}
                  className="w-full text-left card p-4 hover:border-green-300 hover:bg-green-50 transition-colors"
                >
                  <p className="font-medium text-sm text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                    {applyPlaceholders(t.body_text, 'Customer Name', todayRates)}
                  </p>
                </button>
              ))}
            </div>
            <div className="flex-shrink-0 px-5 pt-3 pb-8">
              <button onClick={resetFlow} className="btn-secondary w-full">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Broadcast preview + confirm */}
      {step === 'broadcast-preview' && broadcastTemplate && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={resetFlow}>
          <div className="bg-white rounded-t-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 px-5 pt-5 pb-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-gray-900">Broadcast preview</p>
                <span className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full border border-green-100 font-medium">
                  {broadcastTemplate.name}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Will be sent to <span className="font-medium text-gray-700">{broadcastRecipients.length} recipient{broadcastRecipients.length !== 1 ? 's' : ''}</span> · name filled in per customer
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-2">
              <div className="bg-[#dcf8c6] rounded-2xl rounded-tl-sm p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {applyPlaceholders(broadcastTemplate.body_text, 'Customer Name', todayRates)}
              </div>
            </div>
            <div className="flex-shrink-0 px-5 pt-3 pb-8 space-y-2">
              <button
                onClick={handleBroadcastSend}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                Send to {broadcastRecipients.length}
              </button>
              <button onClick={resetFlow} className="btn-secondary w-full">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Broadcast sending — spinner, no close */}
      {step === 'broadcast-sending' && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
          <div className="bg-white rounded-t-2xl px-5 pt-5 pb-10 flex flex-col items-center gap-4">
            <div className="w-10 h-1 bg-gray-300 rounded-full" />
            <div className="w-10 h-10 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
            <p className="font-semibold text-gray-900">Sending broadcast…</p>
            <p className="text-xs text-gray-500 text-center">Please wait while messages are being sent.</p>
          </div>
        </div>
      )}

      {/* Broadcast result */}
      {step === 'broadcast-result' && broadcastResult && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={resetFlow}>
          <div className="bg-white rounded-t-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 px-5 pt-5 pb-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <p className="font-semibold text-gray-900">Broadcast complete</p>
              <div className="flex gap-3 mt-3">
                <div className="flex-1 bg-green-50 border border-green-100 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-green-700">{broadcastResult.sent}</p>
                  <p className="text-xs text-green-600 mt-0.5">Sent</p>
                </div>
                {broadcastResult.failed > 0 && (
                  <div className="flex-1 bg-red-50 border border-red-100 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-red-600">{broadcastResult.failed}</p>
                    <p className="text-xs text-red-500 mt-0.5">Failed</p>
                  </div>
                )}
              </div>
            </div>
            {broadcastResult.failed > 0 && (
              <div className="flex-1 overflow-y-auto px-5 pb-2">
                <p className="text-xs font-medium text-gray-500 mb-2">Failed deliveries</p>
                <div className="space-y-1.5">
                  {broadcastResult.results
                    .filter(r => r.status === 'failed')
                    .map((r, i) => (
                      <div key={i} className="bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                        <p className="text-xs font-medium text-gray-800">{r.name}</p>
                        {r.error && <p className="text-xs text-red-500 mt-0.5 truncate">{r.error}</p>}
                      </div>
                    ))}
                </div>
              </div>
            )}
            <div className="flex-shrink-0 px-5 pt-3 pb-8">
              <button onClick={resetFlow} className="btn-primary w-full">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
