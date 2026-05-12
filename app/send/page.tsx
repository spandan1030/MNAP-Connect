'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import { buildWhatsAppUrl, applyPlaceholders } from '@/lib/utils'
import type { InterestTopic, Customer, MessageTemplate } from '@/lib/types'

interface CustomerWithInterests extends Customer {
  interests: string[] // topic ids
}

type Step = 'list' | 'pick-template' | 'preview'

export default function SendPage() {
  const supabase = createClient()

  const [topics, setTopics] = useState<InterestTopic[]>([])
  const [allTopics, setAllTopics] = useState<InterestTopic[]>([])
  const [customers, setCustomers] = useState<CustomerWithInterests[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  // Send flow state
  const [step, setStep] = useState<Step>('list')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithInterests | null>(null)
  const [candidateTemplates, setCandidateTemplates] = useState<MessageTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null)
  const [previewMessage, setPreviewMessage] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [topicsRes, customersRes, interestsRes, templatesRes] = await Promise.all([
      supabase.from('wa_interest_topics').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('wa_customers').select('*').eq('is_active', true).eq('is_opted_out', false).order('name'),
      supabase.from('wa_customer_interests').select('customer_id, topic_id'),
      supabase.from('wa_message_templates').select('*').eq('is_active', true),
    ])

    const topicList: InterestTopic[] = topicsRes.data ?? []
    setAllTopics(topicList)
    setTopics(topicList.filter(t => !t.parent_id)) // top-level only for filter chips

    setTemplates(templatesRes.data ?? [])

    const interestMap: Record<string, string[]> = {}
    for (const row of (interestsRes.data ?? [])) {
      if (!interestMap[row.customer_id]) interestMap[row.customer_id] = []
      interestMap[row.customer_id].push(row.topic_id)
    }

    const enriched: CustomerWithInterests[] = (customersRes.data ?? []).map((c: Customer) => ({
      ...c,
      interests: interestMap[c.id] ?? [],
    }))
    setCustomers(enriched)
    setLoading(false)
  }

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

  function handleSend(customer: CustomerWithInterests) {
    setSelectedCustomer(customer)

    let candidates: MessageTemplate[] = []

    if (activeFilter === 'all') {
      // Show templates for this customer's interests + general templates
      const customerTopicIds = customer.interests
      candidates = templates.filter(t =>
        t.topic_id === null || customerTopicIds.includes(t.topic_id)
      )
    } else {
      // Show templates for the active filter topic only
      candidates = templates.filter(t => t.topic_id === activeFilter)
    }

    if (candidates.length === 0) {
      alert('No templates available for this selection. Add templates in Admin → Templates.')
      return
    }

    if (candidates.length === 1) {
      // Auto-load single template → go straight to preview
      const msg = applyPlaceholders(candidates[0].body_text, customer.name)
      setSelectedTemplate(candidates[0])
      setPreviewMessage(msg)
      setStep('preview')
    } else {
      setCandidateTemplates(candidates)
      setStep('pick-template')
    }
  }

  function handlePickTemplate(template: MessageTemplate) {
    const msg = applyPlaceholders(template.body_text, selectedCustomer!.name)
    setSelectedTemplate(template)
    setPreviewMessage(msg)
    setStep('preview')
  }

  async function handleOpenWhatsApp() {
    if (!selectedCustomer || !selectedTemplate) return

    const url = buildWhatsAppUrl(selectedCustomer.phone, previewMessage)
    window.open(url, '_blank')

    // Log the communication
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('wa_communication_log').insert({
      customer_id: selectedCustomer.id,
      template_id: selectedTemplate.id,
      topic_id: activeFilter !== 'all' ? activeFilter : selectedTemplate.topic_id,
      message_sent: previewMessage,
      sent_by: user!.id,
    })

    resetFlow()
  }

  function resetFlow() {
    setStep('list')
    setSelectedCustomer(null)
    setSelectedTemplate(null)
    setCandidateTemplates([])
    setPreviewMessage('')
  }

  function topicName(id: string) {
    return allTopics.find(t => t.id === id)?.name ?? id
  }

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
                : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
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
                  : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="search"
          placeholder="Search by name or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input"
        />

        {/* Customer count */}
        <p className="text-xs text-gray-400">
          {loading ? 'Loading…' : `${filteredCustomers.length} customer${filteredCustomers.length !== 1 ? 's' : ''}`}
        </p>

        {/* Customer list */}
        {!loading && filteredCustomers.length === 0 && (
          <div className="card p-8 text-center text-gray-400 text-sm">
            No customers found.
          </div>
        )}

        <div className="space-y-2">
          {filteredCustomers.map(customer => (
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
                onClick={() => handleSend(customer)}
                className="flex-shrink-0 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.096.544 4.066 1.497 5.777L0 24l6.385-1.473A11.955 11.955 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.848 0-3.58-.497-5.071-1.366l-.361-.214-3.742.862.934-3.628-.235-.374A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                </svg>
                Send
              </button>
            </div>
          ))}
        </div>
      </main>

      {/* Template picker bottom sheet */}
      {step === 'pick-template' && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={resetFlow}>
          <div
            className="bg-white rounded-t-2xl flex flex-col max-h-[80vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* Fixed header */}
            <div className="flex-shrink-0 px-5 pt-5 pb-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <p className="font-semibold text-gray-900">Choose a message</p>
              <p className="text-xs text-gray-500 mt-0.5">Sending to {selectedCustomer.name}</p>
            </div>
            {/* Scrollable template list */}
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
                    {applyPlaceholders(t.body_text, selectedCustomer.name)}
                  </p>
                </button>
              ))}
            </div>
            {/* Fixed footer */}
            <div className="flex-shrink-0 px-5 pt-3 pb-8">
              <button onClick={resetFlow} className="btn-secondary w-full">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Preview bottom sheet */}
      {step === 'preview' && selectedCustomer && selectedTemplate && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={resetFlow}>
          <div
            className="bg-white rounded-t-2xl flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* Fixed header */}
            <div className="flex-shrink-0 px-5 pt-5 pb-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{selectedCustomer.name}</p>
                  <p className="text-xs text-gray-500">+91 {selectedCustomer.phone}</p>
                </div>
                <span className="flex-shrink-0 text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full border border-green-100 font-medium">
                  {selectedTemplate.name}
                </span>
              </div>
            </div>
            {/* Scrollable message preview */}
            <div className="flex-1 overflow-y-auto px-5 pb-2">
              <div className="bg-[#dcf8c6] rounded-2xl rounded-tl-sm p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {previewMessage}
              </div>
            </div>
            {/* Fixed footer buttons — always visible */}
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
              <button onClick={() => setStep('pick-template')} className="btn-secondary w-full">
                ← Change Message
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
