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
// Send an image message
// Pass a publicly accessible URL — Meta fetches the image from it.
// Optional caption appears below the image in WhatsApp.
// ---------------------------------------------------------------------------
export async function sendImageMessage(
  phone: string,
  imageUrl: string,
  caption?: string
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
      type: 'image',
      image: { link: imageUrl, ...(caption ? { caption } : {}) },
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
// Fetch a Meta media object's temporary download URL
// Used when an inbound image arrives — Meta gives us a media_id, not the file.
// ---------------------------------------------------------------------------
export async function getMediaDownloadUrl(
  mediaId: string
): Promise<{ url: string; mimeType: string }> {
  const res = await fetch(`${API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(
      data.error?.message ?? `Meta media API error ${res.status}`
    )
  }

  return { url: data.url as string, mimeType: data.mime_type as string }
}

// ---------------------------------------------------------------------------
// Download a Meta media file as a Buffer
// The URL comes from getMediaDownloadUrl and requires Bearer auth.
// ---------------------------------------------------------------------------
export async function downloadMediaBuffer(
  url: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  })

  if (!res.ok) throw new Error(`Media download failed: ${res.status}`)

  const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
  const arrayBuffer = await res.arrayBuffer()
  return { buffer: Buffer.from(arrayBuffer), contentType }
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
