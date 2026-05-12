'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import { formatDate } from '@/lib/utils'
import type { Customer, InterestTopic } from '@/lib/types'

interface CustomerWithInterests extends Customer {
  interests: InterestTopic[]
}

export default function CustomersPage() {
  const supabase = createClient()
  const [customers, setCustomers] = useState<CustomerWithInterests[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'active' | 'opted_out'>('active')
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadCustomers() }, [])

  async function loadCustomers() {
    setLoading(true)
    const { data: customerData } = await supabase
      .from('wa_customers')
      .select('*')
      .eq('is_active', true)
      .order('name')

    const { data: interestData } = await supabase
      .from('wa_customer_interests')
      .select('customer_id, topic_id, topic:wa_interest_topics(id, name)')

    const map: Record<string, InterestTopic[]> = {}
    for (const row of (interestData ?? [])) {
      if (!map[row.customer_id]) map[row.customer_id] = []
      if (row.topic) map[row.customer_id].push(row.topic as unknown as InterestTopic)
    }

    setCustomers((customerData ?? []).map((c: Customer) => ({
      ...c,
      interests: map[c.id] ?? [],
    })))
    setLoading(false)
  }

  const filtered = customers.filter(c => {
    const matchesFilter = filter === 'active' ? !c.is_opted_out : c.is_opted_out
    const matchesSearch =
      search === '' ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
    return matchesFilter && matchesSearch
  })

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Customers</h1>
          <Link href="/customers/new" className="btn-primary py-2 px-4 text-xs">+ Add</Link>
        </div>

        <input
          type="search"
          placeholder="Search by name or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input"
        />

        <div className="flex gap-2">
          {(['active', 'opted_out'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                filter === f
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-600 border-gray-300'
              }`}
            >
              {f === 'active' ? 'Active' : 'Opted Out'}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-400">{loading ? 'Loading…' : `${filtered.length} customer${filtered.length !== 1 ? 's' : ''}`}</p>

        {!loading && filtered.length === 0 && (
          <div className="card p-8 text-center text-gray-400 text-sm">No customers found.</div>
        )}

        <div className="space-y-2">
          {filtered.map(c => (
            <Link key={c.id} href={`/customers/${c.id}`} className="card p-4 block hover:border-green-300 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{c.name}</p>
                  <p className="text-xs text-gray-500">+91 {c.phone}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Enrolled {formatDate(c.created_at)} via {c.enrolled_via}
                  </p>
                </div>
                {c.is_opted_out && (
                  <span className="flex-shrink-0 text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full font-medium">
                    Opted Out
                  </span>
                )}
              </div>
              {c.interests.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {c.interests.slice(0, 4).map(t => (
                    <span key={t.id} className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-100">
                      {t.name}
                    </span>
                  ))}
                  {c.interests.length > 4 && (
                    <span className="text-xs text-gray-400">+{c.interests.length - 4}</span>
                  )}
                </div>
              )}
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
