import crypto from 'crypto'

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v22.0'
const API_BASE    = `https://graph.facebook.com/${API_VERSION}`
const PHONE_ID    = process.env.WHATSAPP_PHONE_NUMBER_ID!

// ---------------------------------------------------------------------------
// Signature verification
// Meta signs every webhook POST with HMAC-SHA256 using the App Secret.
// Always verify before processing any event.
// ---------------------------------------------------------------------------
export function verifySignature(rawBody: string, signatureHeader: string): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret || !signatureHeader) return false

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signatureHeader, 'utf8')
    )
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Send a free-text message
// Only works if the customer messaged you first within the last 24 hours.
// Returns Meta's wamid (message ID) on success.
// ---------------------------------------------------------------------------
export async function sendTextMessage(phone: string, body: string): Promise<string> {
  if (!process.env.WHATSAPP_ACCESS_TOKEN) {
    throw new Error('WHATSAPP_ACCESS_TOKEN is not configured')
  }

  // Normalise to international format (India: prepend 91)
  const digits = phone.replace(/\D/g, '')
  const to = digits.startsWith('91') ? digits : `91${digits}`

  const res = await fetch(`${API_BASE}/${PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body, preview_url: false },
    }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(
      data.error?.message ?? `Meta API error ${res.status}: ${JSON.stringify(data)}`
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any).messages[0].id as string
}

// ---------------------------------------------------------------------------
// Send a template message
// Required for all outbound messages outside the 24-hour customer reply window.
// ---------------------------------------------------------------------------
export async function sendTemplateMessage(
  phone: string,
  templateName: string,
  languageCode: string = 'en',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: any[] = []
): Promise<string> {
  if (!process.env.WHATSAPP_ACCESS_TOKEN) {
    throw new Error('WHATSAPP_ACCESS_TOKEN is not configured')
  }

  const digits = phone.replace(/\D/g, '')
  const to = digits.startsWith('91') ? digits : `91${digits}`

  const res = await fetch(`${API_BASE}/${PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: languageCode }, components },
    }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(
      data.error?.message ?? `Meta API error ${res.status}: ${JSON.stringify(data)}`
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any).messages[0].id as string
}
