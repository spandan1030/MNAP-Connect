'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import type { InterestTopic } from '@/lib/types'

export default function NewCustomerPage() {
  const supabase = createClient()
  const router = useRouter()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
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
    setSelectedTopics(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const parents = topics.filter(t => !t.parent_id)
  const children = (parentId: string) => topics.filter(t => t.parent_id === parentId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (selectedTopics.size === 0) { setError('Select at least one interest.'); return }
    const cleaned = phone.replace(/\D/g, '')
    if (cleaned.length !== 10) { setError('Enter a valid 10-digit phone number.'); return }

    setSaving(true); setError('')

    const { data: { user } } = await supabase.auth.getUser()

    // Check duplicate phone
    const { data: existing } = await supabase
      .from('wa_customers')
      .select('id')
      .eq('phone', cleaned)
      .maybeSingle()

    if (existing) { setError('A customer with this phone number already exists.'); setSaving(false); return }

    const { data: customer, error: insertErr } = await supabase
      .from('wa_customers')
      .insert({ name: name.trim(), phone: cleaned, enrolled_via: 'salesman', enrolled_by: user!.id, notes: notes.trim() || null })
      .select()
      .single()

    if (insertErr || !customer) { setError(insertErr?.message ?? 'Failed to save.'); setSaving(false); return }

    await supabase.from('wa_customer_interests').insert(
      [...selectedTopics].map(tid => ({ customer_id: customer.id, topic_id: tid }))
    )

    router.push(`/customers/${customer.id}`)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
          <h1 className="text-lg font-bold text-gray-900">Add Customer</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="card p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Customer name" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <div className="flex gap-2 items-center">
                <span className="text-sm text-gray-500 font-medium bg-gray-100 px-3 py-2.5 rounded-lg border border-gray-300">+91</span>
                <input
                  type="tel" value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="input flex-1" placeholder="10-digit number"
                  maxLength={10} required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} className="input" placeholder="Private note about this customer" />
            </div>
          </div>

          <div className="card p-4">
            <p className="text-sm font-semibold text-gray-800 mb-3">Interests <span className="text-red-500">*</span></p>
            <div className="space-y-3">
              {parents.map(parent => {
                const subs = children(parent.id)
                return (
                  <div key={parent.id}>
                    <button
                      type="button"
                      onClick={() => toggleTopic(parent.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                        selectedTopics.has(parent.id)
                          ? 'bg-green-600 text-white border-green-600'
                          : 'bg-white text-gray-700 border-gray-300'
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
                              selectedTopics.has(sub.id)
                                ? 'bg-green-100 text-green-800 border-green-400'
                                : 'bg-white text-gray-600 border-gray-300'
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
            {saving ? 'Saving…' : 'Save Customer'}
          </button>
        </form>
      </main>
    </div>
  )
}
