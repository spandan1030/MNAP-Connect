'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import { computeSegment } from '@/lib/segmentation'
import type { WaBProfile } from '@/lib/types'

// ── Option helpers ─────────────────────────────────────────

function Opt({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-xl text-sm border font-medium transition-colors ${
        active ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
      }`}
    >
      {label}
    </button>
  )
}

function Section({
  title, open, onToggle, children, auto,
}: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode; auto?: boolean
}) {
  return (
    <div className="card p-4 space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-sm font-semibold text-gray-800"
      >
        <span>{title}</span>
        <span className="flex items-center gap-1.5">
          {auto && <span className="text-[10px] text-green-600 font-medium bg-green-50 px-1.5 py-0.5 rounded">auto</span>}
          <span className="text-gray-400 text-base">{open ? '−' : '+'}</span>
        </span>
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  )
}

function Q({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

// ── Initial form state ─────────────────────────────────────

const INIT = {
  name: '', phone: '', notes: '',
  buying_occasion: '', purchase_stage: '', budget_range: '',
  purchase_behavior: '', contact_source: '', competitor_association: '',
  product_interests: [] as string[], style_preference: '',
  purchase_timing: '', notification_interests: [] as string[],
  has_scheme: false, scheme_with: '', scheme_type: '',
  competitor_type: '', competitor_draw: [] as string[],
  engagement_signals: [] as string[], purchase_history: '',
  occasion_detail: '', purchase_for: '',
  is_vip: false, vip_sub_type: '',
}

export default function NewProspectPage() {
  const router = useRouter()
  const supabase = createClient()

  const [form, setForm] = useState(INIT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Manual section toggles (salesman can open any section at any time)
  const [open, setOpen] = useState({
    product: false, timeline: false, scheme: false,
    competitor: false, signals: false, occasion: false, vip: false,
  })

  function setF<K extends keyof typeof INIT>(key: K, value: typeof INIT[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function toggle(key: 'product_interests' | 'notification_interests' | 'competitor_draw' | 'engagement_signals', val: string) {
    setForm(prev => {
      const arr = prev[key]
      return { ...prev, [key]: arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val] }
    })
  }

  function toggleSection(key: keyof typeof open) {
    setOpen(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // Auto-open sections based on signals already captured
  const autoProduct   = ['planning', 'ready'].includes(form.purchase_stage)
  const autoTimeline  = ['planning', 'ready'].includes(form.purchase_stage) || form.budget_range === 'above_2l'
  const autoScheme    = form.purchase_behavior === 'scheme'
  const autoCompetitor = form.competitor_association !== '' && form.competitor_association !== 'no'
  const autoOccasion  = ['wedding', 'festival', 'gift', 'family_occasion'].includes(form.buying_occasion)

  const showProduct    = open.product   || autoProduct
  const showTimeline   = open.timeline  || autoTimeline
  const showScheme     = open.scheme    || autoScheme
  const showCompetitor = open.competitor || autoCompetitor
  const showOccasion   = open.occasion  || autoOccasion

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.phone.trim()) { setError('Name and phone are required.'); return }
    if (!form.buying_occasion || !form.purchase_stage || !form.budget_range ||
        !form.purchase_behavior || !form.contact_source || !form.competitor_association) {
      setError('Please complete all required questions.'); return
    }
    setSaving(true); setError('')

    // Check phone uniqueness across both tables
    const { data: existingB } = await supabase.from('wa_b_customers').select('id').eq('phone', form.phone.trim()).maybeSingle()
    if (existingB) { setError('This phone number is already enrolled as a prospect.'); setSaving(false); return }

    const { data: { user } } = await supabase.auth.getUser()

    // Insert customer
    const { data: customer, error: custErr } = await supabase
      .from('wa_b_customers')
      .insert({ name: form.name.trim(), phone: form.phone.trim(), enrolled_by: user!.id, notes: form.notes.trim() || null })
      .select('id').single()

    if (custErr || !customer) { setError('Failed to save. Try again.'); setSaving(false); return }

    // Build profile
    const profile: Omit<WaBProfile, 'last_updated_at' | 'updated_by'> = {
      customer_id:            customer.id,
      buying_occasion:        form.buying_occasion   || null,
      purchase_stage:         form.purchase_stage    || null,
      budget_range:           form.budget_range      || null,
      purchase_behavior:      form.purchase_behavior || null,
      contact_source:         form.contact_source    || null,
      competitor_association: form.competitor_association || null,
      product_interests:      form.product_interests.length ? form.product_interests : null,
      style_preference:       form.style_preference  || null,
      purchase_timing:        form.purchase_timing   || null,
      notification_interests: form.notification_interests.length ? form.notification_interests : null,
      has_scheme:             form.has_scheme,
      scheme_with:            form.scheme_with       || null,
      scheme_type:            form.scheme_type       || null,
      competitor_type:        form.competitor_type   || null,
      competitor_draw:        form.competitor_draw.length ? form.competitor_draw : null,
      engagement_signals:     form.engagement_signals.length ? form.engagement_signals : null,
      purchase_history:       form.purchase_history  || null,
      occasion_detail:        form.occasion_detail   || null,
      purchase_for:           form.purchase_for      || null,
      is_vip:                 form.is_vip,
      vip_sub_type:           form.vip_sub_type      || null,
      vip_assigned_by:        form.is_vip ? user!.id : null,
      vip_assigned_at:        form.is_vip ? new Date().toISOString() : null,
    }

    await supabase.from('wa_b_profiles').insert({ ...profile, updated_by: user!.id })

    // Run segmentation engine
    const result = computeSegment(profile as WaBProfile)

    // Save primary segment assignment
    await supabase.from('wa_b_segment_assignments').insert({
      customer_id:     customer.id,
      primary_segment: result.primarySegment,
      reason:          result.reason,
      assigned_by:     'system',
      is_current:      true,
    })

    // Save secondary tags
    if (result.tags.length) {
      await supabase.from('wa_b_segment_tags').insert(
        result.tags.map(tag => ({ customer_id: customer.id, tag, applied_by: 'system', is_active: true }))
      )
    }

    router.push(`/prospects/${customer.id}`)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3">
        <h1 className="text-lg font-bold text-gray-900">Enroll Prospect</h1>

        <form onSubmit={handleSave} className="space-y-3">

          {/* Basic Info */}
          <div className="card p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Basic Info</p>
            <input className="input" placeholder="Full name" value={form.name} onChange={e => setF('name', e.target.value)} required />
            <input className="input" placeholder="Phone number (10 digits)" value={form.phone} inputMode="numeric" onChange={e => setF('phone', e.target.value)} required />
            <textarea className="input resize-none" rows={2} placeholder="Notes (optional)" value={form.notes} onChange={e => setF('notes', e.target.value)} />
          </div>

          {/* Required Core */}
          <div className="card p-4 space-y-4">
            <p className="text-sm font-semibold text-gray-700">Required Details</p>

            <Q label="Buying occasion">
              {[['self','Self'],['wedding','Wedding'],['gift','Gift'],['investment','Investment'],['festival','Festival'],['family_occasion','Family occasion']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.buying_occasion === v} onClick={() => setF('buying_occasion', v)} />
              ))}
            </Q>

            <Q label="Purchase stage">
              {[['exploring','Just exploring'],['comparing','Comparing'],['planning','Planning purchase'],['ready','Ready soon']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.purchase_stage === v} onClick={() => setF('purchase_stage', v)} />
              ))}
            </Q>

            <Q label="Comfortable budget">
              {[['under_25k','Under ₹25k'],['25k_75k','₹25k–₹75k'],['75k_2l','₹75k–₹2L'],['above_2l','₹2L+']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.budget_range === v} onClick={() => setF('budget_range', v)} />
              ))}
            </Q>

            <Q label="How they plan to buy">
              {[['one_time','One-time'],['scheme','Scheme / SIP'],['exchange','Exchange old gold'],['waiting_rates','Waiting for rates']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.purchase_behavior === v} onClick={() => setF('purchase_behavior', v)} />
              ))}
            </Q>

            <Q label="How did they find us?">
              {[['walk_in','Walk-in'],['whatsapp','WhatsApp'],['social_media','Instagram / Social'],['referral','Referral'],['existing_customer','Existing customer']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.contact_source === v} onClick={() => setF('contact_source', v)} />
              ))}
            </Q>

            <Q label="Buying from another jeweller?">
              {[['no','No'],['just_comparing','Just comparing'],['somewhat_loyal','Somewhat loyal'],['very_loyal','Very loyal']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.competitor_association === v} onClick={() => setF('competitor_association', v)} />
              ))}
            </Q>
          </div>

          {/* Product Affinity */}
          <Section title="Product Interest" open={showProduct} onToggle={() => toggleSection('product')} auto={autoProduct}>
            <Q label="Interested in (select all that apply)">
              {[['daily_wear','Daily wear'],['bridal','Bridal'],['lightweight','Lightweight'],['mens','Men\'s'],['silver','Silver'],['kids','Kids'],['diamond','Diamond'],['temple','Temple / traditional'],['custom','Custom order']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.product_interests.includes(v)} onClick={() => toggle('product_interests', v)} />
              ))}
            </Q>
            <Q label="Style preference">
              {[['traditional','Traditional'],['modern','Modern'],['minimal','Minimal'],['statement','Statement'],['trend','Trend-focused']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.style_preference === v} onClick={() => setF('style_preference', v)} />
              ))}
            </Q>
          </Section>

          {/* Timeline & Triggers */}
          <Section title="Timeline & Communication" open={showTimeline} onToggle={() => toggleSection('timeline')} auto={autoTimeline}>
            <Q label="Expected purchase timing">
              {[['within_7_days','Within 7 days'],['within_1_month','Within 1 month'],['1_3_months','1–3 months'],['browsing','Just browsing']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.purchase_timing === v} onClick={() => setF('purchase_timing', v)} />
              ))}
            </Q>
            <Q label="Wants to be notified about (select all)">
              {[['rate_alerts','Rate drop alerts'],['new_arrivals','New designs'],['festival','Festival collections'],['bridal_launches','Bridal launches'],['scheme_updates','Scheme updates'],['making_charge_offers','Making charge offers']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.notification_interests.includes(v)} onClick={() => toggle('notification_interests', v)} />
              ))}
            </Q>
          </Section>

          {/* Scheme */}
          <Section title="Scheme Details" open={showScheme} onToggle={() => toggleSection('scheme')} auto={autoScheme}>
            <Q label="Has an active scheme?">
              {[['yes','Yes'],['no','No']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.has_scheme === (v === 'yes')} onClick={() => setF('has_scheme', v === 'yes')} />
              ))}
            </Q>
            {form.has_scheme && (
              <>
                <Q label="Scheme with">
                  {[['mnap','MNAP'],['other','Another jeweller']].map(([v,l]) => (
                    <Opt key={v} label={l} active={form.scheme_with === v} onClick={() => setF('scheme_with', v)} />
                  ))}
                </Q>
                <Q label="Scheme type">
                  {[['sip','Monthly SIP'],['gold_deposit','Gold deposit'],['other','Other']].map(([v,l]) => (
                    <Opt key={v} label={l} active={form.scheme_type === v} onClick={() => setF('scheme_type', v)} />
                  ))}
                </Q>
              </>
            )}
          </Section>

          {/* Competitor Detail */}
          <Section title="Competitor Details" open={showCompetitor} onToggle={() => toggleSection('competitor')} auto={autoCompetitor}>
            <Q label="Type of jeweller they use">
              {[['local_family','Local family jeweller'],['chain_brand','Chain brand'],['online','Online'],['multiple','Multiple']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.competitor_type === v} onClick={() => setF('competitor_type', v)} />
              ))}
            </Q>
            <Q label="What draws them there (select all)">
              {[['price','Price'],['designs','Designs'],['trust','Trust / relationship'],['location','Location'],['family_relationship','Family connection'],['schemes','Schemes']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.competitor_draw.includes(v)} onClick={() => toggle('competitor_draw', v)} />
              ))}
            </Q>
          </Section>

          {/* Engagement Signals */}
          <Section title="Engagement Signals Observed" open={open.signals} onToggle={() => toggleSection('signals')}>
            <p className="text-xs text-gray-400">Record what you observe from the conversation — do not ask the customer directly.</p>
            <Q label="Signals (select all that apply)">
              {[['asked_specific_designs','Asked about specific designs'],['asked_photos','Asked for photos'],['visited_store','Visited store'],['asked_pricing','Asked for pricing'],['compared_elsewhere','Comparing elsewhere'],['discount_focused','Hard bargainer / discount-focused']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.engagement_signals.includes(v)} onClick={() => toggle('engagement_signals', v)} />
              ))}
            </Q>
            <Q label="Purchase history with MNAP">
              {[['first_time','First time'],['inquired_no_purchase','Inquired before, didn\'t buy'],['purchased_before','Already purchased']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.purchase_history === v} onClick={() => setF('purchase_history', v)} />
              ))}
            </Q>
          </Section>

          {/* Occasion Detail */}
          <Section title="Occasion Details" open={showOccasion} onToggle={() => toggleSection('occasion')} auto={autoOccasion}>
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500">Occasion or timing</p>
              <input className="input" placeholder="e.g. Wedding – March 2026, Diwali" value={form.occasion_detail} onChange={e => setF('occasion_detail', e.target.value)} />
            </div>
            <Q label="Purchase is for">
              {[['self','Self'],['partner','Partner'],['parent','Parent'],['child','Child'],['friend','Friend'],['family','Extended family']].map(([v,l]) => (
                <Opt key={v} label={l} active={form.purchase_for === v} onClick={() => setF('purchase_for', v)} />
              ))}
            </Q>
          </Section>

          {/* VIP */}
          <Section title="VIP Assignment (Optional)" open={open.vip} onToggle={() => toggleSection('vip')}>
            <p className="text-xs text-gray-400">Only mark VIP if you personally know this is a loyal customer. This overrides automatic segmentation.</p>
            <Q label="Mark as VIP?">
              <Opt label="Yes — this is a VIP customer" active={form.is_vip} onClick={() => setF('is_vip', !form.is_vip)} />
            </Q>
            {form.is_vip && (
              <Q label="VIP type">
                {[['long_time_loyalist','Long-time Loyalist (years of trust)'],['new_exclusive','New Exclusive (recently committed to us only)']].map(([v,l]) => (
                  <Opt key={v} label={l} active={form.vip_sub_type === v} onClick={() => setF('vip_sub_type', v)} />
                ))}
              </Q>
            )}
          </Section>

          {error && <p className="text-xs text-red-600 px-1">{error}</p>}

          <button type="submit" disabled={saving} className="btn-primary w-full">
            {saving ? 'Saving…' : 'Enroll & Assign Segment'}
          </button>
        </form>
      </main>
    </div>
  )
}
