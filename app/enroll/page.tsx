'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { InterestTopic } from '@/lib/types'

export default function EnrollPage() {
  const supabase = createClient()
  const router = useRouter()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [topics, setTopics] = useState<InterestTopic[]>([])
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadTopics() }, [])

  async function loadTopics() {
    const { data } = await supabase
      .from('wa_interest_topics')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
    setTopics(data ?? [])
  }

  function toggleTopic(id: string) {
    setSelectedTopics(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  const parents = topics.filter(t => !t.parent_id)
  const childTopics = (parentId: string) => topics.filter(t => t.parent_id === parentId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (selectedTopics.size === 0) { setError('Please select at least one interest.'); return }
    const cleaned = phone.replace(/\D/g, '')
    if (cleaned.length !== 10) { setError('Please enter a valid 10-digit phone number.'); return }

    setSaving(true); setError('')

    const { data: existing } = await supabase
      .from('wa_customers')
      .select('id, is_opted_out')
      .eq('phone', cleaned)
      .maybeSingle()

    if (existing) {
      if (existing.is_opted_out) {
        // Re-subscribe
        await supabase.from('wa_customers').update({ is_opted_out: false, opted_out_at: null, opted_out_by: null }).eq('id', existing.id)
      }
      // Update interests
      await supabase.from('wa_customer_interests').delete().eq('customer_id', existing.id)
      await supabase.from('wa_customer_interests').insert(
        [...selectedTopics].map(tid => ({ customer_id: existing.id, topic_id: tid }))
      )
      router.push('/enroll/success')
      return
    }

    const { data: customer, error: err } = await supabase
      .from('wa_customers')
      .insert({ name: name.trim(), phone: cleaned, enrolled_via: 'self', enrolled_by: null })
      .select()
      .single()

    if (err || !customer) { setError(err?.message ?? 'Something went wrong. Please try again.'); setSaving(false); return }

    await supabase.from('wa_customer_interests').insert(
      [...selectedTopics].map(tid => ({ customer_id: customer.id, topic_id: tid }))
    )

    router.push('/enroll/success')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-4 text-center">
        <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center mx-auto mb-2">
          <span className="text-white text-sm font-bold">MC</span>
        </div>
        <h1 className="text-lg font-bold text-gray-900">M N Alankar Palace</h1>
        <p className="text-xs text-gray-500">Stay updated on gold rates, new designs &amp; offers</p>
      </div>

      <main className="flex-1 max-w-sm mx-auto w-full px-4 py-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="card p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Full name" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number</label>
              <div className="flex gap-2 items-center">
                <span className="text-sm text-gray-500 font-medium bg-gray-100 px-3 py-2.5 rounded-lg border border-gray-300">+91</span>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="input flex-1" placeholder="10-digit number" maxLength={10} required />
              </div>
            </div>
          </div>

          <div className="card p-4">
            <p className="text-sm font-semibold text-gray-800 mb-1">What would you like to receive?</p>
            <p className="text-xs text-gray-500 mb-3">Select all that interest you</p>
            <div className="space-y-3">
              {parents.map(parent => {
                const subs = childTopics(parent.id)
                return (
                  <div key={parent.id}>
                    <button
                      type="button"
                      onClick={() => toggleTopic(parent.id)}
                      className={`w-full text-left px-3 py-3 rounded-xl border text-sm font-medium transition-colors ${
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
                            className={`px-3 py-2 rounded-full border text-xs font-medium transition-colors ${
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

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <button type="submit" disabled={saving} className="btn-primary w-full">
            {saving ? 'Enrolling…' : 'Subscribe'}
          </button>

          <p className="text-xs text-gray-400 text-center">
            We'll send you WhatsApp messages on topics you selected. You can opt out anytime.
          </p>
        </form>
      </main>
    </div>
  )
}
