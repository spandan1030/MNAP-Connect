'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import { formatDateTime, formatDate } from '@/lib/utils'
import type { Customer, InterestTopic, CommunicationLog } from '@/lib/types'

interface CustomerFull extends Customer {
  interests: InterestTopic[]
}

export default function CustomerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [customer, setCustomer] = useState<CustomerFull | null>(null)
  const [allTopics, setAllTopics] = useState<InterestTopic[]>([])
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set())
  const [logs, setLogs] = useState<CommunicationLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [optingOut, setOptingOut] = useState(false)
  const [confirmOptOut, setConfirmOptOut] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { loadData() }, [id])

  async function loadData() {
    setLoading(true)
    const [customerRes, topicsRes, interestsRes, logsRes] = await Promise.all([
      supabase.from('wa_customers').select('*').eq('id', id).single(),
      supabase.from('wa_interest_topics').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('wa_customer_interests').select('topic_id').eq('customer_id', id),
      supabase
        .from('wa_communication_log')
        .select('*, template:wa_message_templates(name), topic:wa_interest_topics(name), sender:profiles(name)')
        .eq('customer_id', id)
        .order('sent_at', { ascending: false })
        .limit(50),
    ])

    const topicIds = new Set<string>((interestsRes.data ?? []).map((r: any) => r.topic_id))
    setCustomer({ ...(customerRes.data as Customer), interests: (topicsRes.data ?? []).filter((t: InterestTopic) => topicIds.has(t.id)) })
    setAllTopics(topicsRes.data ?? [])
    setSelectedTopics(topicIds)
    setLogs(logsRes.data ?? [])
    setLoading(false)
  }

  function toggleTopic(id: string) {
    setSelectedTopics(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  async function saveInterests() {
    if (!customer) return
    setSaving(true)
    await supabase.from('wa_customer_interests').delete().eq('customer_id', customer.id)
    if (selectedTopics.size > 0) {
      await supabase.from('wa_customer_interests').insert(
        [...selectedTopics].map(tid => ({ customer_id: customer.id, topic_id: tid }))
      )
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    setSaving(false)
  }

  async function handleOptOut() {
    if (!customer) return
    setOptingOut(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('wa_customers').update({
      is_opted_out: true,
      opted_out_at: new Date().toISOString(),
      opted_out_by: user!.id,
    }).eq('id', customer.id)
    setConfirmOptOut(false)
    setOptingOut(false)
    router.push('/customers')
  }

  async function handleReactivate() {
    if (!customer) return
    await supabase.from('wa_customers').update({ is_opted_out: false, opted_out_at: null, opted_out_by: null }).eq('id', customer.id)
    loadData()
  }

  const parents = allTopics.filter(t => !t.parent_id)
  const childTopics = (parentId: string) => allTopics.filter(t => t.parent_id === parentId)

  if (loading) return <div className="min-h-screen flex flex-col"><Navbar /><div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading…</div></div>
  if (!customer) return null

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
          <h1 className="text-lg font-bold text-gray-900 truncate">{customer.name}</h1>
          {customer.is_opted_out && (
            <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full font-medium flex-shrink-0">Opted Out</span>
          )}
        </div>

        {/* Details card */}
        <div className="card p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Phone</span>
            <a href={`tel:+91${customer.phone}`} className="font-medium text-green-600">+91 {customer.phone}</a>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Enrolled</span>
            <span className="text-gray-800">{formatDate(customer.created_at)} via {customer.enrolled_via}</span>
          </div>
          {customer.notes && (
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500">Note</p>
              <p className="text-sm text-gray-800 mt-0.5">{customer.notes}</p>
            </div>
          )}
        </div>

        {/* Interests */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-800">Interests</p>
            <button
              onClick={saveInterests}
              disabled={saving}
              className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-full disabled:opacity-50"
            >
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
            </button>
          </div>
          <div className="space-y-3">
            {parents.map(parent => {
              const subs = childTopics(parent.id)
              return (
                <div key={parent.id}>
                  <button
                    type="button"
                    onClick={() => toggleTopic(parent.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      selectedTopics.has(parent.id) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300'
                    }`}
                  >
                    {parent.name}
                  </button>
                  {subs.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2 pl-2">
                      {subs.map(sub => (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => toggleTopic(sub.id)}
                          className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                            selectedTopics.has(sub.id) ? 'bg-green-100 text-green-800 border-green-400' : 'bg-white text-gray-600 border-gray-300'
                          }`}
                        >
                          {sub.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Opt out / reactivate */}
        {customer.is_opted_out ? (
          <button onClick={handleReactivate} className="w-full py-3 rounded-xl border-2 border-green-500 text-green-700 font-semibold text-sm">
            Re-subscribe Customer
          </button>
        ) : (
          <button onClick={() => setConfirmOptOut(true)} className="w-full py-3 rounded-xl border-2 border-red-200 text-red-600 font-semibold text-sm">
            Opt Out Customer
          </button>
        )}

        {/* Communication history */}
        <div className="card overflow-hidden">
          <div className="bg-green-600 px-4 py-2.5">
            <p className="text-white font-semibold text-sm">Message History</p>
          </div>
          {logs.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No messages sent yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {logs.map(log => (
                <div key={log.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-700">{(log as any).template?.name ?? 'Custom'}</p>
                      {(log as any).topic && <p className="text-xs text-green-600">{(log as any).topic.name}</p>}
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{log.message_sent}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-gray-400">{formatDateTime(log.sent_at)}</p>
                      {(log as any).sender && <p className="text-xs text-gray-400">{(log as any).sender.name}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Opt out confirm dialog */}
      {confirmOptOut && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setConfirmOptOut(false)}>
          <div className="bg-white rounded-t-2xl p-5 w-full" onClick={e => e.stopPropagation()}>
            <p className="font-semibold text-gray-900 mb-1">Opt out {customer.name}?</p>
            <p className="text-sm text-gray-500 mb-5">They will be removed from all future messages. You can re-enable this later.</p>
            <button onClick={handleOptOut} disabled={optingOut} className="w-full py-3 rounded-xl bg-red-600 text-white font-semibold text-sm mb-2 disabled:opacity-50">
              {optingOut ? 'Processing…' : 'Yes, Opt Out'}
            </button>
            <button onClick={() => setConfirmOptOut(false)} className="btn-secondary w-full">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
