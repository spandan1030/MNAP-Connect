export interface InterestTopic {
  id: string
  name: string
  parent_id: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  // Canonical taxonomy (wa_033): stable interest slug shared across chat,
  // calls, sales and segments; group + whether the call screen offers it.
  key?: string | null
  topic_group?: 'engagement' | 'product' | 'metal' | 'system' | null
  is_callable?: boolean
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
  // Reach suppression (wa_032): don't pay to send the same message twice.
  suppression_days: number          // 14 default; 0 = never suppress (daily rate)
  suppression_bucket: string | null // optional shared window key across templates
  category: string | null           // 'daily_rate'|'rate'|'offer'|'thankyou'|'custom'
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

// ── Cold-Call Module (wa_028) ─────────────────────────────────────────────────

export interface WaBMarker {
  customer_id: string
  recency_tier: string | null
  value_tier: string | null
  rfm_segment: string | null
  frequency_tier: string | null
  audience_labels: string[] | null
  lifetime_value: number | null
  total_bills: number | null
  days_since_last_purchase: number | null
  first_purchase_date: string | null
  last_purchase_date: string | null
  is_high_value: boolean | null
  is_likely_wedding: boolean | null
  primary_metal: string | null
  outreach_bucket: string | null
  markers: Record<string, unknown> | null
  import_batch: string | null
  imported_at: string
}

export interface WaBCallCampaign {
  id: string
  name: string
  filter_json: CallFilter | null
  created_by: string | null
  created_at: string
  is_active: boolean
}

export type CallTaskStatus = 'pending' | 'done' | 'hidden'

export interface WaBCallTask {
  id: string
  campaign_id: string
  customer_id: string
  status: CallTaskStatus
  attempts: number
  last_attempt_date: string | null
  created_at: string
  updated_at: string
}

export type CallIntent = 'will_come' | 'not_sure' | 'wont_come' | 'dont_call'

export interface WaBCallLog {
  id: string
  task_id: string
  customer_id: string
  called_by: string
  called_at: string
  success: boolean | null
  topics: string[] | null
  intent: CallIntent | null
  outcome_at: string | null
  notes: string | null
}

// Filter admins apply to build a campaign (stored in campaign.filter_json).
export interface CallFilter {
  recency_tier?: string[]
  value_tier?: string[]
  rfm_segment?: string[]
  frequency_tier?: string[]
  primary_metal?: string[]
  is_high_value?: boolean
  is_likely_wedding?: boolean
  is_lookalike_seed?: boolean          // audience_labels contains "Lookalike Seed"
  interests?: string[]                 // wa_signals interest keys (any-match), joined by phone
  min_lifetime_value?: number
  min_total_bills?: number
  max_days_since_last_purchase?: number
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

// Physical stock status of a piece, fed from the software inventory import (wa_058).
// Informational only — it never gates app publishing (that's show_in_app alone).
export type StockStatus = 'in_stock' | 'sold' | 'deleted'

export interface WaProduct {
  id: string
  item_name: string | null
  barcode: string | null
  weight: number | null
  purity: string | null
  design: string | null
  description: string | null
  party: string | null
  party_id?: number | null    // numeric supplier id from the software (name mapped later) (wa_058)
  notes: string | null
  is_active: boolean
  is_sold: boolean
  needs_review: boolean
  is_catalogue_only?: boolean // design-only product, not physical stock (wa_057)
  stock_status?: StockStatus  // in_stock | sold | deleted, from the inventory import (wa_058)
  design_code?: string | null // app-facing per-piece code (MN000001…); raw barcode is never sent (wa_058)
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
  in_app: boolean                  // published to the customer-app photo gallery
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

// ── Reach — unified cohort messaging (wa_032) ─────────────────────────────────

export type SendLedgerStatus = 'sent' | 'failed' | 'skipped_suppressed' | 'skipped_dnc'

// One row per WhatsApp send attempt, keyed by phone (cross-universe).
export interface WaSendLedger {
  id: string
  phone: string
  template_id: string | null
  meta_template_name: string | null
  suppression_key: string
  category: string | null
  status: SendLedgerStatus
  wa_message_id: string | null
  campaign_ref: string | null
  cohort_label: string | null
  error: string | null
  sent_by: string | null
  sent_at: string
}

// Cohort selector for the Reach console. Marker fields mirror CallFilter;
// call/interest/manual fields let any universe feed one list.
export interface ReachFilter {
  // marker filters (wa_b_markers)
  recency_tier?: string[]
  value_tier?: string[]
  rfm_segment?: string[]
  frequency_tier?: string[]
  primary_metal?: string[]
  is_high_value?: boolean
  is_likely_wedding?: boolean
  is_lookalike_seed?: boolean
  min_lifetime_value?: number
  min_total_bills?: number
  max_days_since_last_purchase?: number
  purchaseFrom?: string         // YYYY-MM-DD (last_purchase_date lower bound)
  purchaseTo?: string           // YYYY-MM-DD (last_purchase_date upper bound, inclusive)
  // interest signals (wa_signals, any-match, joined by phone)
  interests?: string[]
  interestSources?: string[]    // wa_signals.source facet: 'whatsapp'|'call'|'walkin'|'sales' (empty = any source)
  interestFrom?: string         // YYYY-MM-DD — signal last_seen lower bound (e.g. "walked in / chatted since")
  interestTo?: string           // YYYY-MM-DD — signal last_seen upper bound, inclusive
  subscribedTopics?: string[]   // opt-in consent: wa_customer_interests.topic_id (reproduces topic broadcast)
  // call signals
  campaignIds?: string[]        // membership via wa_b_call_tasks
  intents?: string[]            // any call log intent (will_come|not_sure|wont_come)
  callTopics?: string[]         // any successful-call topic (rate|designs|offers|booking)
  hotLead?: boolean             // wa_b_customers.is_hot_lead
  calledFrom?: string           // YYYY-MM-DD (call date lower bound)
  calledTo?: string             // YYYY-MM-DD (call date upper bound, inclusive)
  // chat activity (wa_messages inbound)
  messagedFrom?: string         // YYYY-MM-DD — customer messaged us on/after this date
  messagedTo?: string           // YYYY-MM-DD — customer messaged us on/before this date (inclusive)
  // walk-in visit (wa_b_customers.walkin_at / walkin_timing)
  walkedIn?: boolean            // has an in-store walk-in on record
  walkinNoPurchase?: boolean    // walked in AND no purchase since the visit
  walkinTiming?: string[]       // planning-to-buy button: within_7d|within_1m|1_3m
  // behavioural / cross-source features (computed at resolve time)
  callUnresponsive?: boolean    // >=3 call attempts, never connected (route off calls)
  multiSource?: boolean         // interest signals from >=2 distinct sources
  chatNonBuyer?: boolean        // has a chat interest signal but no sales markers on this number
  // customer app (contacts.app_user / has_scheme / app_product_interest — wa_053)
  appUser?: boolean             // has an account on the customer app (app-admin export)
  hasScheme?: boolean           // holds a gold-savings scheme in the app
  appProductInterest?: boolean  // tapped "interested" / shared a product link into chat
  // ad leads (wa_ad_leads — inert until ads are wired)
  adLead?: boolean              // arrived via a click-to-WhatsApp / tracked ad
  adCampaign?: string[]         // specific ad campaign code(s)
  // manual list — used alone (paste numbers)
  phones?: string[]
}

// A resolved recipient shown in the Reach list (with prior-send context).
export interface ReachRecipient {
  phone: string
  name: string | null
  customerId: string | null
  recency_tier: string | null
  value_tier: string | null
  rfm_segment: string | null
  primary_metal: string | null
  lifetime_value: number | null
  is_hot_lead: boolean
  optedOut: boolean             // THE one flag (contacts.is_opted_out) — chat STOP ∪ call DNC ∪ manual
  pastSends: Array<{ label: string; category: string | null; sentAt: string }>
  suppressedUntil: string | null // set when the CURRENT template is within its window
}
