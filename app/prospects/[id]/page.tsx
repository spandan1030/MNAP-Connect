'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import { SEGMENT_COLORS } from '@/lib/segmentation'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { WaBCustomer, WaBProfile, WaBSegmentAssignment, WaBSegmentTag, WaBInteraction } from '@/lib/types'

const INTERACTION_TYPES = [
  { value: 'whatsapp',    label: 'WhatsApp' },
  { value: 'call',        label: 'Call' },
  { value: 'store_visit', label: 'Store visit' },
  { value: 'note',        label: 'Note' },
]

const READABLE: Record<string, Record<string, string>> = {
  buying_occasion:        { self:'Self', wedding:'Wedding', gift:'Gift', investment:'Investment', festival:'Festival', family_occasion:'Family occasion' },
  purchase_stage:         { exploring:'Just exploring', comparing:'Comparing options', planning:'Planning purchase', ready:'Ready soon' },
  budget_range:           { under_25k:'Under ₹25k', '25k_75k':'₹25k–₹75k', '75k_2l':'₹75k–₹2L', above_2l:'₹2L+' },
  purchase_behavior:      { one_time:'One-time purchase', scheme:'Scheme / SIP', exchange:'Exchange old gold', waiting_rates:'Waiting for rates' },
  contact_source:         { walk_in:'Walk-in', whatsapp:'WhatsApp', social_media:'Instagram / Social', referral:'Referral', existing_customer:'Existing customer' },
  competitor_association: { no:'No', just_comparing:'Just comparing', somewhat_loyal:'Somewhat loyal', very_loyal:'Very loyal' },
  purchase_timing:        { within_7_days:'Within 7 days', within_1_month:'Within 1 month', '1_3_months':'1–3 months', browsing:'Just browsing' },
  purchase_history:       { first_time:'First time', inquired_no_purchase:'Inquired, didn\'t buy', purchased_before:'Already purchased' },
  style_preference:       { traditional:'Traditional', modern:'Modern', minimal:'Minimal', statement:'Statement', trend:'Trend-focused' },
  vip_sub_type:           { long_time_loyalist:'Long-time Loyalist', new_exclusive:'New Exclusive Customer' },
}

function readable(field: string, value: string | null) {
  if (!value) return '—'
  return READABLE[field]?.[value] ?? value
}

export default function ProspectProfilePage() {
  const { id } = useParams<{ id: string }>()
  const supabase = createClient()

  const [customer, setCustomer] = useState<WaBCustomer | null>(null)
  const [profile, setProfile] = useState<WaBProfile | null>(null)
  const [segment, setSegment] = useState<WaBSegmentAssignment | null>(null)
  const [tags, setTags] = useState<WaBSegmentTag[]>([])
  const [interactions, setInteractions] = useState<WaBInteraction[]>([])
  const [segmentHistory, setSegmentHistory] = useState<WaBSegmentAssignment[]>([])
  const [loading, setLoading] = useState(true)

  // Log interaction form
  const [logType, setLogType] = useState('whatsapp')
  const [logNotes, setLogNotes] = useState('')
  const [logDate, setLogDate] = useState(new Date().toLocaleDateString('en-CA'))
  const [logging, setLogging] = useState(false)
  const [showLog, setShowLog] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const [custRes, profRes, segRes, segHistRes, tagRes, intRes] = await Promise.all([
      supabase.from('wa_b_customers').select('*').eq('id', id).single(),
      supabase.from('wa_b_profiles').select('*').eq('customer_id', id).maybeSingle(),
      supabase.from('wa_b_segment_assignments').select('*').eq('customer_id', id).eq('is_current', true).maybeSingle(),
      supabase.from('wa_b_segment_assignments').select('*').eq('customer_id', id).order('assigned_at', { ascending: false }),
      supabase.from('wa_b_segment_tags').select('*').eq('customer_id', id).eq('is_active', true),
      supabase.from('wa_b_interactions').select('*').eq('customer_id', id).order('interaction_date', { ascending: false }),
    ])
    setCustomer(custRes.data)
    setProfile(profRes.data)
    setSegment(segRes.data)
    setSegmentHistory(segHistRes.data ?? [])
    setTags(tagRes.data ?? [])
    setInteractions(intRes.data ?? [])
    setLoading(false)
  }

  async function handleLogInteraction(e: React.FormEvent) {
    e.preventDefault()
    setLogging(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('wa_b_interactions').insert({
      customer_id: id, interaction_type: logType,
      notes: logNotes.trim() || null, logged_by: user!.id, interaction_date: logDate,
    })
    setLogNotes(''); setShowLog(false)
    await load()
    setLogging(false)
  }

  if (loading) return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading…</main>
    </div>
  )

  if (!customer) return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center text-gray-400 text-sm">Prospect not found.</main>
    </div>
  )

  const segColor = SEGMENT_COLORS[segment?.primary_segment ?? 'Unqualified Prospect']

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3">

        {/* Header */}
        <div className="card p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-base font-bold text-gray-900">{customer.name}</h1>
              <p className="text-xs text-gray-500">+91 {customer.phone}</p>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full border font-medium flex-shrink-0 ${segColor}`}>
              {segment?.primary_segment ?? 'Unqualified Prospect'}
            </span>
          </div>
          {customer.notes && <p className="text-xs text-gray-500 border-t border-gray-100 pt-2">{customer.notes}</p>}
          {profile?.is_vip && (
            <div className="flex items-center gap-1.5 text-amber-700 text-xs font-medium">
              <span>★</span>
              <span>VIP — {readable('vip_sub_type', profile.vip_sub_type)}</span>
            </div>
          )}
          {/* Secondary tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {tags.map(t => (
                <span key={t.id} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">{t.tag}</span>
              ))}
            </div>
          )}
        </div>

        {/* Segment reason */}
        {segment && (
          <div className="card p-3">
            <p className="text-xs text-gray-400 font-medium mb-1">Why this segment</p>
            <p className="text-xs text-gray-700">{segment.reason}</p>
          </div>
        )}

        {/* Profile summary */}
        {profile && (
          <div className="card p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Profile</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {[
                ['Occasion',       readable('buying_occasion',        profile.buying_occasion)],
                ['Stage',          readable('purchase_stage',         profile.purchase_stage)],
                ['Budget',         readable('budget_range',           profile.budget_range)],
                ['Buying plan',    readable('purchase_behavior',      profile.purchase_behavior)],
                ['Source',         readable('contact_source',         profile.contact_source)],
                ['Competitor',     readable('competitor_association',  profile.competitor_association)],
                ['Timeline',       readable('purchase_timing',        profile.purchase_timing)],
                ['History',        readable('purchase_history',       profile.purchase_history)],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] text-gray-400 font-medium">{label}</p>
                  <p className="text-xs text-gray-800 font-medium">{value}</p>
                </div>
              ))}
            </div>

            {profile.product_interests?.length ? (
              <div>
                <p className="text-[10px] text-gray-400 font-medium mb-1">Interests</p>
                <div className="flex flex-wrap gap-1">
                  {profile.product_interests.map(i => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">{i.replace('_',' ')}</span>
                  ))}
                </div>
              </div>
            ) : null}

            {profile.engagement_signals?.length ? (
              <div>
                <p className="text-[10px] text-gray-400 font-medium mb-1">Engagement signals</p>
                <div className="flex flex-wrap gap-1">
                  {profile.engagement_signals.map(s => (
                    <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{s.replace(/_/g,' ')}</span>
                  ))}
                </div>
              </div>
            ) : null}

            {profile.occasion_detail && (
              <div>
                <p className="text-[10px] text-gray-400 font-medium">Occasion</p>
                <p className="text-xs text-gray-800">{profile.occasion_detail}</p>
              </div>
            )}
          </div>
        )}

        {/* Log interaction */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Interactions</p>
            <button onClick={() => setShowLog(p => !p)} className="text-xs text-green-700 font-medium border border-green-200 px-3 py-1 rounded-lg bg-green-50">
              + Log
            </button>
          </div>

          {showLog && (
            <form onSubmit={handleLogInteraction} className="space-y-2 border-t border-gray-100 pt-3">
              <div className="flex flex-wrap gap-2">
                {INTERACTION_TYPES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLogType(value)}
                    className={`px-3 py-1.5 rounded-xl text-xs border font-medium transition-colors ${
                      logType === value ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input type="date" className="input" value={logDate} onChange={e => setLogDate(e.target.value)} />
              <textarea className="input resize-none" rows={2} placeholder="Notes (optional)" value={logNotes} onChange={e => setLogNotes(e.target.value)} />
              <button type="submit" disabled={logging} className="btn-primary w-full py-2">{logging ? 'Saving…' : 'Save interaction'}</button>
            </form>
          )}

          {interactions.length === 0 && !showLog && (
            <p className="text-xs text-gray-400">No interactions logged yet.</p>
          )}

          <div className="space-y-2">
            {interactions.map(i => (
              <div key={i.id} className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-700 capitalize">{i.interaction_type.replace('_',' ')}</span>
                    <span className="text-[10px] text-gray-400">{formatDate(i.interaction_date)}</span>
                  </div>
                  {i.notes && <p className="text-xs text-gray-500 mt-0.5">{i.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Segment history */}
        {segmentHistory.length > 1 && (
          <div className="card p-4 space-y-2">
            <p className="text-sm font-semibold text-gray-700">Segment History</p>
            {segmentHistory.map(s => (
              <div key={s.id} className={`text-xs ${s.is_current ? 'text-gray-800' : 'text-gray-400'}`}>
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${s.is_current ? '' : 'line-through'}`}>{s.primary_segment}</span>
                  <span className="text-[10px]">{formatDateTime(s.assigned_at)}</span>
                  {s.is_current && <span className="text-[10px] text-green-600 font-medium">current</span>}
                </div>
                <p className="text-[10px] mt-0.5 text-gray-400">{s.reason}</p>
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-gray-400 text-center pb-2">Enrolled {formatDate(customer.created_at)}</p>
      </main>
    </div>
  )
}
