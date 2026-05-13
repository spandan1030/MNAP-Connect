import type { WaBProfile } from './types'

export interface SegmentResult {
  primarySegment: string
  reason: string
  tags: string[]
}

export const SEGMENTS = [
  'VIP / Relationship Customer',
  'Competitor Acquisition',
  'Hot Buyer',
  'Bridal Journey',
  'Scheme Customer',
  'Social Media Lead',
  'Rate Sensitive',
  'Festival & Occasion Buyer',
  'Daily Wear Explorer',
  'Unqualified Prospect',
] as const

export const SEGMENT_DORMANT_DAYS: Record<string, number> = {
  'Hot Buyer': 30,
  'Bridal Journey': 60,
  'Rate Sensitive': 60,
  'Scheme Customer': 60,
  'Festival & Occasion Buyer': 60,
  'VIP / Relationship Customer': 60,
  'Daily Wear Explorer': 90,
  'Social Media Lead': 90,
  'Competitor Acquisition': 90,
  'Unqualified Prospect': 90,
}

function computeTags(p: WaBProfile, primarySegment: string): string[] {
  const tags: string[] = []

  if (p.engagement_signals?.includes('discount_focused'))
    tags.push('Discount Seeker')

  if (p.purchase_behavior === 'waiting_rates' || p.notification_interests?.includes('rate_alerts'))
    tags.push('Rate Sensitive')

  if (p.purchase_behavior === 'exchange')
    tags.push('Exchange Candidate')

  if (p.purchase_behavior === 'scheme' && primarySegment !== 'Scheme Customer')
    tags.push('Scheme Candidate')

  // Bridal with no scheme → push scheme as funding tool
  if (primarySegment === 'Bridal Journey' && !p.has_scheme)
    tags.push('Scheme Candidate')

  if (p.product_interests?.includes('diamond'))
    tags.push('Diamond Interest')

  if (p.budget_range === 'above_2l')
    tags.push('High Value')

  if (p.competitor_association && p.competitor_association !== 'no')
    tags.push('Competitor Flag')

  if (p.contact_source === 'social_media')
    tags.push('Social Origin')

  if (p.product_interests?.length && p.notification_interests?.includes('new_arrivals'))
    tags.push('New Arrival Subscriber')

  if (['gift', 'family_occasion'].includes(p.buying_occasion ?? '') &&
      ['partner', 'child'].includes(p.purchase_for ?? ''))
    tags.push('Bridal Adjacent')

  return [...new Set(tags)]
}

export function computeSegment(p: WaBProfile): SegmentResult {
  // VIP — manual override always wins
  if (p.is_vip) {
    return {
      primarySegment: 'VIP / Relationship Customer',
      reason: `Manually assigned as VIP — sub-type: ${p.vip_sub_type === 'long_time_loyalist' ? 'Long-time Loyalist' : 'New Exclusive Customer'}`,
      tags: computeTags(p, 'VIP / Relationship Customer'),
    }
  }

  const isCompetitor = ['just_comparing', 'somewhat_loyal', 'very_loyal'].includes(p.competitor_association ?? '')

  // Rule 1 — Competitor Acquisition
  if (isCompetitor && p.purchase_stage !== 'exploring') {
    const seg = 'Competitor Acquisition'
    return {
      primarySegment: seg,
      reason: `Competitor association = ${p.competitor_association} and purchase stage = ${p.purchase_stage}`,
      tags: computeTags(p, seg),
    }
  }

  // Rule 2 — Hot Buyer
  const hotEngagementSignals = ['asked_specific_designs', 'asked_photos', 'asked_pricing', 'visited_store']
  const hasHotEngagement = p.engagement_signals?.some(s => hotEngagementSignals.includes(s))
  const nearTimeline = ['within_7_days', 'within_1_month'].includes(p.purchase_timing ?? '')
  if (
    ['planning', 'ready'].includes(p.purchase_stage ?? '') &&
    nearTimeline &&
    (hasHotEngagement || p.purchase_stage === 'ready') &&
    !isCompetitor
  ) {
    const seg = 'Hot Buyer'
    return {
      primarySegment: seg,
      reason: `Stage = ${p.purchase_stage}, Timeline = ${p.purchase_timing}, engagement signals present`,
      tags: computeTags(p, seg),
    }
  }

  // Rule 3 — Bridal Journey
  if (
    p.buying_occasion === 'wedding' &&
    (p.product_interests?.includes('bridal') || ['self', 'partner'].includes(p.purchase_for ?? '')) &&
    !isCompetitor
  ) {
    const seg = 'Bridal Journey'
    return {
      primarySegment: seg,
      reason: `Occasion = Wedding and ${p.product_interests?.includes('bridal') ? 'product interests include Bridal' : 'purchase is for self/partner'}`,
      tags: computeTags(p, seg),
    }
  }

  // Rule 4 — Scheme Customer
  if (p.purchase_behavior === 'scheme' || p.has_scheme) {
    const seg = 'Scheme Customer'
    return {
      primarySegment: seg,
      reason: p.has_scheme ? `Has active scheme (${p.scheme_with ?? ''})` : 'Purchase behavior = Scheme/SIP',
      tags: computeTags(p, seg),
    }
  }

  // Rule 5 — Social Media Lead (cold — no strong signals)
  if (
    p.contact_source === 'social_media' &&
    ['exploring', 'comparing'].includes(p.purchase_stage ?? '') &&
    !hasHotEngagement
  ) {
    const seg = 'Social Media Lead'
    return {
      primarySegment: seg,
      reason: `First contact = Social media and stage = ${p.purchase_stage} with no strong engagement signals`,
      tags: computeTags(p, seg),
    }
  }

  // Rule 6 — Rate Sensitive
  if (
    ['waiting_rates', 'exchange'].includes(p.purchase_behavior ?? '') &&
    !p.has_scheme &&
    !isCompetitor
  ) {
    const seg = 'Rate Sensitive'
    return {
      primarySegment: seg,
      reason: `Purchase behavior = ${p.purchase_behavior}`,
      tags: computeTags(p, seg),
    }
  }

  // Rule 7 — Festival & Occasion Buyer
  // Festival beats Rate Sensitive — occasion creates a deadline and an emotion
  if (
    ['festival', 'family_occasion', 'gift'].includes(p.buying_occasion ?? '') &&
    p.purchase_timing !== 'browsing' &&
    !isCompetitor
  ) {
    const seg = 'Festival & Occasion Buyer'
    return {
      primarySegment: seg,
      reason: `Occasion = ${p.buying_occasion} and purchase timing = ${p.purchase_timing}`,
      tags: computeTags(p, seg),
    }
  }

  // Rule 8 — Daily Wear Explorer
  const lightweightCategories = ['daily_wear', 'lightweight', 'minimal']
  const hasLightweight = p.product_interests?.some(i => lightweightCategories.includes(i))
  if (
    hasLightweight &&
    ['exploring', 'comparing'].includes(p.purchase_stage ?? '') &&
    ['under_25k', '25k_75k'].includes(p.budget_range ?? '')
  ) {
    const seg = 'Daily Wear Explorer'
    return {
      primarySegment: seg,
      reason: `Product interests include lightweight/daily wear, stage = exploring/comparing, budget = ${p.budget_range}`,
      tags: computeTags(p, seg),
    }
  }

  // Default
  return {
    primarySegment: 'Unqualified Prospect',
    reason: 'Insufficient profile data to assign a segment — complete the profile to enable segmentation',
    tags: computeTags(p, 'Unqualified Prospect'),
  }
}

export const SEGMENT_COLORS: Record<string, string> = {
  'VIP / Relationship Customer':  'bg-amber-50 text-amber-800 border-amber-200',
  'Competitor Acquisition':       'bg-red-50 text-red-700 border-red-200',
  'Hot Buyer':                    'bg-green-50 text-green-700 border-green-200',
  'Bridal Journey':               'bg-pink-50 text-pink-700 border-pink-200',
  'Scheme Customer':              'bg-blue-50 text-blue-700 border-blue-200',
  'Social Media Lead':            'bg-purple-50 text-purple-700 border-purple-200',
  'Rate Sensitive':               'bg-orange-50 text-orange-700 border-orange-200',
  'Festival & Occasion Buyer':    'bg-yellow-50 text-yellow-700 border-yellow-200',
  'Daily Wear Explorer':          'bg-teal-50 text-teal-700 border-teal-200',
  'Unqualified Prospect':         'bg-gray-50 text-gray-600 border-gray-200',
}
