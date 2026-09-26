// ---------------------------------------------------------------------------
// Meta Conversions API (CAPI) — Click-to-WhatsApp (CTWA) conversion events.
//
// When an ad lead does something meaningful in the WhatsApp conversation (sends a
// 2nd message = a real, engaged human; later: actually buys), we report it to Meta
// so the algorithm optimises for people who *convert*, not just people who *open a
// chat*. Attribution is anchored on the `ctwa_clid` Meta stamps on the lead's first
// inbound message — NOT on their phone number — so it's reliable even when someone
// messages from one number and bills from another.
//
// Docs: action_source must be "business_messaging", messaging_channel "whatsapp",
// and user_data must carry { whatsapp_business_account_id, ctwa_clid }. Purchase
// events additionally need custom_data { currency, value }; Lead events do not.
//
// Everything here is best-effort and INERT until the env below is set — a missing
// dataset/WABA/token makes every call a silent no-op, so shipping this before the
// owner provisions credentials changes nothing.
//
//   META_CAPI_DATASET_ID     — the WABA's conversions dataset id (Events Manager)
//   META_WABA_ID             — numeric WhatsApp Business Account id (Business Settings)
//   META_CAPI_ACCESS_TOKEN   — system-user token with access to the dataset
//                              (falls back to WHATSAPP_ACCESS_TOKEN if unset)
//   META_CAPI_TEST_EVENT_CODE — optional; routes events to the Events Manager
//                               "Test events" tab for verification
//   META_CAPI_LEAD_EVENT_NAME — optional; the event name to send (default
//                               "LeadSubmitted"). business_messaging rejects web
//                               names like "Lead"; match the ad's optimisation event.
// ---------------------------------------------------------------------------

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v22.0'

function capiConfig() {
  const datasetId = process.env.META_CAPI_DATASET_ID
  const wabaId    = process.env.META_WABA_ID
  const token     = process.env.META_CAPI_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN
  const testCode  = process.env.META_CAPI_TEST_EVENT_CODE || undefined
  return { datasetId, wabaId, token, testCode }
}

export type CtwaEvent = {
  eventName: string
  ctwaClid: string
  eventTimeMs?: number
  // Purchase only:
  value?: number
  currency?: string
}

// Send one CTWA conversion event to Meta. Returns true only on a confirmed 200 —
// callers use that to mark the event as sent (so it's fired exactly once). Never
// throws: a config gap or a Meta error is logged and returns false.
export async function sendCtwaConversionEvent(ev: CtwaEvent): Promise<boolean> {
  const { datasetId, wabaId, token, testCode } = capiConfig()

  if (!ev.ctwaClid) return false
  if (!datasetId || !wabaId || !token) {
    // Configured-but-incomplete is worth one line — a real lead just went un-reported.
    console.warn('[capi] CTWA event skipped — META_CAPI_DATASET_ID / META_WABA_ID / token not set')
    return false
  }

  const event: Record<string, unknown> = {
    event_name: ev.eventName,
    event_time: Math.floor((ev.eventTimeMs ?? Date.now()) / 1000),
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      whatsapp_business_account_id: wabaId,
      ctwa_clid: ev.ctwaClid,
    },
  }
  if (ev.value != null) {
    event.custom_data = { currency: ev.currency ?? 'INR', value: ev.value }
  }

  const body: Record<string, unknown> = { data: [event] }
  if (testCode) body.test_event_code = testCode

  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${datasetId}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      // "Invalid parameter" alone is useless — Meta puts the real reason in the
      // user_msg / subcode fields. Log the full error and the exact event we sent
      // so the offending field is unambiguous.
      const e = (data as { error?: Record<string, unknown> })?.error ?? {}
      console.error(`[capi] Meta rejected CTWA ${ev.eventName} event:`, JSON.stringify({
        message: e.message, code: e.code, subcode: e.error_subcode,
        user_title: e.error_user_title, user_msg: e.error_user_msg, details: e.error_data,
      }), '| sent:', JSON.stringify(event))
      return false
    }
    return true
  } catch (err) {
    console.error('[capi] CTWA event request failed:', err)
    return false
  }
}

// Convenience: the "engaged lead" signal (2nd message). Event name is overridable
// so it can be aligned with whatever the ad set optimises for.
export function sendCtwaLeadEvent(ctwaClid: string): Promise<boolean> {
  return sendCtwaConversionEvent({
    // business_messaging rejects the web event name "Lead" (error subcode 2804066)
    // — messaging events use their own vocabulary. "LeadSubmitted" is the engaged-
    // lead equivalent Meta accepts for this action source.
    eventName: process.env.META_CAPI_LEAD_EVENT_NAME || 'LeadSubmitted',
    ctwaClid,
  })
}
