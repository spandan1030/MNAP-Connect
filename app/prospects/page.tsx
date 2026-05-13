'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import { SEGMENTS, SEGMENT_COLORS } from '@/lib/segmentation'
import { formatDate } from '@/lib/utils'
import type { WaBCustomer, WaBSegmentAssignment, WaBSegmentTag } from '@/lib/types'

interface ProspectRow extends WaBCustomer {
  segment: string
  tags: string[]
  enrolled_by_name: string
}

export default function ProspectsPage() {
  const supabase = createClient()
  const [prospects, setProspects] = useState<ProspectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterSegment, setFilterSegment] = useState('all')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [custRes, segRes, tagRes] = await Promise.all([
      supabase.from('wa_b_customers').select('*').eq('is_active', true).order('created_at', { ascending: false }),
      supabase.from('wa_b_segment_assignments').select('*').eq('is_current', true),
      supabase.from('wa_b_segment_tags').select('*').eq('is_active', true),
    ])

    const customers: WaBCustomer[] = custRes.data ?? []
    const assignments: WaBSegmentAssignment[] = segRes.data ?? []
    const tags: WaBSegmentTag[] = tagRes.data ?? []

    const segMap = Object.fromEntries(assignments.map(a => [a.customer_id, a.primary_segment]))
    const tagMap: Record<string, string[]> = {}
    for (const t of tags) {
      if (!tagMap[t.customer_id]) tagMap[t.customer_id] = []
      tagMap[t.customer_id].push(t.tag)
    }

    setProspects(customers.map(c => ({
      ...c,
      segment: segMap[c.id] ?? 'Unqualified Prospect',
      tags: tagMap[c.id] ?? [],
      enrolled_by_name: '',
    })))
    setLoading(false)
  }

  const filtered = prospects.filter(p => {
    const matchSeg = filterSegment === 'all' || p.segment === filterSegment
    const matchSearch = search === '' ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.phone.includes(search)
    return matchSeg && matchSearch
  })

  const segmentCounts = SEGMENTS.reduce((acc, s) => {
    acc[s] = prospects.filter(p => p.segment === s).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Prospects</h1>
          <Link href="/prospects/new" className="btn-primary px-4 py-2 text-xs">+ Enroll</Link>
        </div>

        {/* Segment filter */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button
            onClick={() => setFilterSegment('all')}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filterSegment === 'all' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
            }`}
          >
            All ({prospects.length})
          </button>
          {SEGMENTS.filter(s => segmentCounts[s] > 0).map(s => (
            <button
              key={s}
              onClick={() => setFilterSegment(s)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filterSegment === s ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
              }`}
            >
              {s.split(' ')[0]} ({segmentCounts[s]})
            </button>
          ))}
        </div>

        <input
          type="search"
          placeholder="Search by name or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input"
        />

        <p className="text-xs text-gray-400">
          {loading ? 'Loading…' : `${filtered.length} prospect${filtered.length !== 1 ? 's' : ''}`}
        </p>

        {!loading && filtered.length === 0 && (
          <div className="card p-8 text-center text-gray-400 text-sm">
            {prospects.length === 0 ? 'No prospects yet. Tap + Enroll to add one.' : 'No matches.'}
          </div>
        )}

        <div className="space-y-2">
          {filtered.map(p => (
            <Link key={p.id} href={`/prospects/${p.id}`} className="card p-4 flex items-start justify-between gap-3 hover:border-gray-300 transition-colors block">
              <div className="min-w-0">
                <p className="font-semibold text-sm text-gray-900">{p.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">+91 {p.phone}</p>
                <span className={`inline-block mt-1.5 text-xs px-2 py-0.5 rounded-full border font-medium ${SEGMENT_COLORS[p.segment]}`}>
                  {p.segment}
                </span>
                {p.tags.slice(0, 2).map(t => (
                  <span key={t} className="ml-1 inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">{t}</span>
                ))}
              </div>
              <div className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{formatDate(p.created_at)}</div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
