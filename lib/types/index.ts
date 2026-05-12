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
