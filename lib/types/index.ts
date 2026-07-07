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
  // Meta-approved WhatsApp Business Template fields
  meta_template_name: string | null
  meta_template_lang: string
  meta_variables: string[] | null   // ["name","rate_24kt",...] — maps to {{1}},{{2}}...
  header_type: 'none' | 'image'     // 'image' = fixed image header sent with every use
  header_image_url: string | null   // publicly accessible URL for the header image
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

// ── WhatsApp Messaging (wa_004) ───────────────────────────────────────────────

export interface WaThread {
  id: string
  phone: string
  customer_name: string | null
  customer_id: string | null
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
  bot_state: 'active' | 'awaiting_care' | 'with_agent'
  needs_agent: boolean
  created_at: string
}

export interface WaBotMessage {
  key: string
  content: string
  image_url: string | null
  updated_by: string | null
  updated_at: string
}

export interface WaProduct {
  id: string
  item_name: string | null
  barcode: string | null
  weight: number | null
  purity: string | null
  design: string | null
  description: string | null
  party: string | null
  notes: string | null
  is_active: boolean
  is_sold: boolean
  needs_review: boolean
  // Customer-app publishing (see wa_025_app_publish.sql)
  show_in_app?: boolean
  making_percent?: number | null
  app_title?: string | null
  app_description?: string | null
  app_synced_at?: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// Normalized crop rectangle (0..1) of the 4:5 region taken from the original image.
export interface CropRect { x: number; y: number; w: number; h: number }

export interface WaProductImage {
  id: string
  product_id: string
  image_url: string          // original upload (any aspect ratio) — never altered
  thumb_url: string | null   // thumbnail of the original
  display_url: string | null       // 4:5-cropped full image fed to the customer app
  display_thumb_url: string | null // 4:5-cropped grid thumbnail
  crop: CropRect | null            // where the 4:5 frame sits on the original
  sort_order: number
  is_primary: boolean
  created_at: string
}

export interface WaPurchaseRequirement {
  id: string
  item_name: string | null
  design: string | null
  description: string | null
  purity: string | null
  weight_bucket: number | null
  qty_needed: number
  qty_purchased: number
  notes: string | null
  is_done: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface WaPurchaseLine {
  id: string
  requirement_id: string
  party: string
  qty: number
  created_at: string
  updated_at: string
}

export interface WaThankYouProduct {
  id: string
  product_label: string
  is_default: boolean
  meta_template_name: string | null
  meta_template_lang: string
  header_image_url: string | null
  body_preview: string
  is_active: boolean
  updated_by: string | null
  created_at: string
}

export interface WaLeadCapture {
  id: string
  customer_id: string | null
  thread_id: string | null
  intent: string | null
  metal: string | null
  product_topic_id: string | null
  wants_designs: boolean | null
  created_at: string
}

export type WaMessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received'
export type WaMessageDirection = 'outbound' | 'inbound'
export type WaMessageType = 'text' | 'image' | 'document' | 'audio' | 'video' | 'other'

export interface WaMessage {
  id: string
  thread_id: string
  direction: WaMessageDirection
  wa_message_id: string | null
  body: string | null
  template_name: string | null
  message_type: WaMessageType
  media_url: string | null
  status: WaMessageStatus
  sent_by: string | null
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  failed_reason: string | null
  error_code: number | null
  error_title: string | null
  error_details: string | null
  broadcast_id: string | null
  created_at: string
}

export interface WaBroadcast {
  id: string
  template_id: string | null
  template_name: string | null
  topic_id: string | null
  topic_name: string | null
  total: number
  sent: number
  failed: number
  sent_by: string | null
  created_at: string
}
