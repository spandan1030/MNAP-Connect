export interface InterestTopic {
  id: string
  name: string
  parent_id: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  children?: InterestTopic[]
}

export interface Customer {
  id: string
  name: string
  phone: string
  enrolled_via: 'salesman' | 'self'
  enrolled_by: string | null
  is_active: boolean
  is_opted_out: boolean
  opted_out_at: string | null
  opted_out_by: string | null
  notes: string | null
  created_at: string
}

export interface CustomerInterest {
  customer_id: string
  topic_id: string
  created_at: string
  topic?: InterestTopic
}

export interface MessageTemplate {
  id: string
  topic_id: string | null
  name: string
  body_text: string
  is_active: boolean
  created_by: string | null
  created_at: string
}

export interface CommunicationLog {
  id: string
  customer_id: string
  template_id: string | null
  topic_id: string | null
  message_sent: string
  sent_by: string
  sent_at: string
  customer?: Customer
  template?: MessageTemplate
  topic?: InterestTopic
  sender?: { name: string }
}

// ── Type B (Intervention / CRM) ──────────────────────────

export interface WaBCustomer {
  id: string
  name: string
  phone: string
  enrolled_by: string
  is_active: boolean
  notes: string | null
  created_at: string
}

export interface WaBProfile {
  customer_id: string
  buying_occasion: string | null
  purchase_stage: string | null
  budget_range: string | null
  purchase_behavior: string | null
  contact_source: string | null
  competitor_association: string | null
  product_interests: string[] | null
  style_preference: string | null
  purchase_timing: string | null
  notification_interests: string[] | null
  has_scheme: boolean
  scheme_with: string | null
  scheme_type: string | null
  competitor_type: string | null
  competitor_draw: string[] | null
  engagement_signals: string[] | null
  purchase_history: string | null
  occasion_detail: string | null
  purchase_for: string | null
  is_vip: boolean
  vip_sub_type: string | null
  vip_assigned_by: string | null
  vip_assigned_at: string | null
  last_updated_at: string
  updated_by: string | null
}

export interface WaBSegmentAssignment {
  id: string
  customer_id: string
  primary_segment: string
  reason: string
  assigned_by: string
  assigned_at: string
  is_current: boolean
}

export interface WaBSegmentTag {
  id: string
  customer_id: string
  tag: string
  applied_by: string
  applied_at: string
  is_active: boolean
}

export interface WaBInteraction {
  id: string
  customer_id: string
  interaction_type: string
  notes: string | null
  logged_by: string
  interaction_date: string
  logged_at: string
}
