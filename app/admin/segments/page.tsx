'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import { SEGMENTS, SEGMENT_COLORS } from '@/lib/segmentation'
import { formatDate } from '@/lib/utils'
import type { WaBCustomer, WaBSegmentAssignment, WaBSegmentTag } from '@/lib/types'

interface Row extends WaBCustomer {
  segment: string
  reason: string
  tags: string[]
  completeness: number
}

const PROFILE_FIELDS = [
  'buying_occasion','purchase_stage','budget_range','purchase_behavior',
  'contact_source','competitor_association','product_interests','purchase_timing','purchase_history',
]

export default function SegmentsAdminPage() {
  const supabase = createClient()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSegment, setActiveSegment] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [custRes, profRes, segRes, tagRes] = await Promise.all([
      supabase.from('wa_b_customers').select('*').eq('is_active', true),
      supabase.from('wa_b_profiles').select('*'),
      supabase.from('wa_b_segment_assignments').select('*').eq('is_current', true),
      supabase.from('wa_b_segment_tags').select('*').eq('is_active', true),
    ])

    const customers: WaBCustomer[] = custRes.data ?? []
    const profiles: Record<string, Record<string, unknown>> = Object.fromEntries((profRes.data ?? []).map((p: Record<string, unknown>) => [p.customer_id, p]))
    const segMap = Object.fromEntries((segRes.data ?? []).map((a: WaBSegmentAssignment) => [a.customer_id, a]))
    const tagMap: Record<string, string[]> = {}
    for (const t of (tagRes.data ?? []) as WaBSegmentTag[]) {
      if (!tagMap[t.customer_id]) tagMap[t.customer_id] = []
      tagMap[t.customer_id].push(t.tag)
    }

    setRows(customers.map(c => {
      const p = profiles[c.id] ?? {}
      const filled = PROFILE_FIELDS.filter(f => {
        const v = p[f]
        return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
      }).length
      return {
        ...c,
        segment: segMap[c.id]?.primary_segment ?? 'Unqualified Prospect',
        reason:  segMap[c.id]?.reason ?? '',
        tags:    tagMap[c.id] ?? [],
        completeness: Math.round((filled / PROFILE_FIELDS.length) * 100),
      }
    }))
    setLoading(false)
  }

  const segmentCounts = SEGMENTS.reduce((acc, s) => {
    acc[s] = rows.filter(r => r.segment === s).length
    return acc
  }, {} as Record<string, number>)

  const totalIncomplete = rows.filter(r => r.completeness < 60).length
  const viewRows = activeSegment ? rows.filter(r => r.segment === activeSegment) : []

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3">
        <h1 className="text-lg font-bold text-gray-900">Segment Overview</h1>

        {totalIncomplete > 0 && (
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
            {totalIncomplete} prospect{totalIncomplete !== 1 ? 's have' : ' has'} incomplete profiles (&lt;60% complete)
          </div>
        )}

        {/* Segment cards */}
        <div className="space-y-2">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
          ) : (
            SEGMENTS.map(seg => {
              const count = segmentCounts[seg] ?? 0
              const inSeg = rows.filter(r => r.segment === seg)
              const avgComp = count > 0 ? Math.round(inSeg.reduce((a, r) => a + r.completeness, 0) / count) : 0
              const isActive = activeSegment === seg
              return (
                <div key={seg}>
                  <button
                    className={`w-full card p-4 text-left transition-colors ${isActive ? 'border-green-300 bg-green-50' : 'hover:border-gray-300'} ${count === 0 ? 'opacity-40' : ''}`}
                    onClick={() => setActiveSegment(isActive ? null : seg)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${SEGMENT_COLORS[seg]}`}>
                          {count}
                        </span>
                        <span className="font-medium text-sm text-gray-900 truncate">{seg}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {count > 0 && (
                          <div className="text-right">
                            <p className="text-[10px] text-gray-400">avg profile</p>
                            <p className={`text-xs font-semibold ${avgComp >= 70 ? 'text-green-600' : avgComp >= 40 ? 'text-amber-600' : 'text-red-500'}`}>
                              {avgComp}%
                            </p>
                          </div>
                        )}
                        <span className="text-gray-400">{isActive ? '▲' : '▼'}</span>
                      </div>
                    </div>
                  </button>

                  {isActive && count > 0 && (
                    <div className="border border-t-0 border-gray-200 rounded-b-xl bg-white divide-y divide-gray-100">
                      {viewRows.map(r => (
                        <Link key={r.id} href={`/prospects/${r.id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900">{r.name}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">{r.reason}</p>
                            {r.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {r.tags.map(t => (
                                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">{t}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-xs font-semibold ${r.completeness >= 70 ? 'text-green-600' : r.completeness >= 40 ? 'text-amber-600' : 'text-red-500'}`}>
                              {r.completeness}%
                            </p>
                            <p className="text-[10px] text-gray-400">{formatDate(r.created_at)}</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Rules reference */}
        <div className="card p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-700">Segment Rules (Priority Order)</p>
          <p className="text-xs text-gray-400">Customers are assigned the first rule that matches their profile.</p>
          <ol className="space-y-1.5">
            {[
              ['VIP / Relationship Customer', 'Manually assigned by salesman — overrides all rules'],
              ['Competitor Acquisition', 'Competitor = any loyalty + stage ≠ exploring'],
              ['Hot Buyer', 'Stage = planning/ready + near timeline + engagement signals'],
              ['Bridal Journey', 'Occasion = Wedding + bridal interest or buying for self/partner'],
              ['Scheme Customer', 'Purchase behavior = Scheme/SIP or has active scheme'],
              ['Social Media Lead', 'Source = Social media + stage = exploring/comparing + no hot signals'],
              ['Rate Sensitive', 'Behavior = waiting for rates or exchange + no scheme + no competitor'],
              ['Festival & Occasion Buyer', 'Occasion = Festival/Gift/Family + not just browsing'],
              ['Daily Wear Explorer', 'Lightweight/daily wear interest + exploring stage + lower budget'],
              ['Unqualified Prospect', 'Default — insufficient data to assign a segment'],
            ].map(([seg, rule], i) => (
              <li key={seg} className="flex items-start gap-2 text-xs">
                <span className="text-gray-400 flex-shrink-0 font-mono">{i + 1}.</span>
                <div>
                  <span className="font-medium text-gray-800">{seg}</span>
                  <span className="text-gray-400"> — {rule}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </main>
    </div>
  )
}
