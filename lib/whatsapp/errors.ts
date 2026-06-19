// WhatsApp Cloud API error-code dictionary.
//
// Meta sends a numeric `code` on every failed/undeliverable message. The code is
// the reliable signal; the accompanying `message` text varies and is often vague
// (e.g. "not delivered to maintain a healthy ecosystem"). We translate the code
// into plain English for salesmen, plus a hint on what — if anything — to do.
//
// Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes

export interface WaErrorInfo {
  /** Short human title, e.g. "Marketing limit reached". */
  title: string
  /** One-line plain-English explanation for a non-technical salesman. */
  hint: string
  /** Whether retrying later could plausibly succeed (transient vs. permanent). */
  retryable: boolean
}

const DICTIONARY: Record<number, WaErrorInfo> = {
  131049: {
    title: 'Marketing limit reached',
    hint: 'Meta capped marketing messages to this person for now. Try again later or send a utility/service message.',
    retryable: true,
  },
  131026: {
    title: 'Not on WhatsApp',
    hint: "This number can't receive the message — not on WhatsApp, or it blocks business messages.",
    retryable: false,
  },
  131047: {
    title: 'Needs re-engagement',
    hint: 'Outside the 24-hour window. Reach this customer with an approved template, not free text.',
    retryable: true,
  },
  131048: {
    title: 'Spam rate limit',
    hint: "Meta is limiting sends to this user to prevent spam. Pause and retry later.",
    retryable: true,
  },
  131051: {
    title: 'Template paused',
    hint: 'This template was paused by Meta (low quality). Use a different template.',
    retryable: false,
  },
  131053: {
    title: 'Media upload failed',
    hint: "Meta couldn't process the attached media. Check the image and resend.",
    retryable: true,
  },
  470: {
    title: 'Re-engagement message',
    hint: 'The 24-hour customer service window has closed. Send an approved template.',
    retryable: true,
  },
  131000: {
    title: 'Temporary error',
    hint: 'A general Meta-side error occurred. Safe to retry.',
    retryable: true,
  },
  131008: {
    title: 'Missing parameter',
    hint: 'A required field was missing from the request. This is a setup issue, not the customer.',
    retryable: false,
  },
  131031: {
    title: 'Account restricted',
    hint: 'Your WhatsApp Business account is locked or restricted. Check Meta Business Manager.',
    retryable: false,
  },
  133010: {
    title: 'Number not registered',
    hint: 'Your sending number is not registered on the Cloud API. Setup issue.',
    retryable: false,
  },
  132000: {
    title: 'Template mismatch',
    hint: 'The number of variables sent does not match the template. Setup issue.',
    retryable: false,
  },
  132001: {
    title: 'Template not found',
    hint: 'The template does not exist or is not approved in this language.',
    retryable: false,
  },
  132005: {
    title: 'Template text too long',
    hint: 'The filled-in template exceeds WhatsApp limits. Shorten the content.',
    retryable: false,
  },
  100: {
    title: 'Invalid request',
    hint: 'Meta rejected the request as malformed. Setup issue, not the customer.',
    retryable: false,
  },
  368: {
    title: 'Temporarily blocked',
    hint: 'Sending is temporarily blocked for policy violations. Review your messaging.',
    retryable: false,
  },
}

const UNKNOWN: WaErrorInfo = {
  title: 'Delivery failed',
  hint: 'WhatsApp could not deliver this message. See the code for details.',
  retryable: false,
}

/** Look up a WhatsApp error code. Always returns something usable. */
export function describeError(code: number | null | undefined): WaErrorInfo {
  if (code == null) return UNKNOWN
  return DICTIONARY[code] ?? UNKNOWN
}

/** Compact one-liner for inline display, e.g. "131049 — Marketing limit reached". */
export function shortError(code: number | null | undefined, fallbackMessage?: string | null): string {
  if (code == null) return fallbackMessage || UNKNOWN.title
  const info = DICTIONARY[code]
  return info ? `${code} — ${info.title}` : `${code} — ${fallbackMessage || UNKNOWN.title}`
}
