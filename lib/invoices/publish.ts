// Publish an invoice snapshot to the customer app (Firestore) so its private
// /i/<token> page can render. Called at SEND time, right BEFORE the WhatsApp
// message goes out — if publishing fails, the caller skips the send, so a
// customer never receives a link to a page that doesn't exist yet.
//
// The customer app owns the Firebase credentials; we just POST the snapshot to
// its shared-secret endpoint. Two env vars (server-only, never committed):
//   CUSTOMER_APP_PUBLISH_URL     e.g. https://gold.mnalankarpalace.com/api/invoices/publish
//   CUSTOMER_APP_PUBLISH_SECRET  the matching shared secret
//
// We deliberately DON'T send the phone number — the page renders name + bill +
// items + amounts only, so there's no reason to copy the phone into Firestore.

export interface InvoiceSnapshot {
  bill_no: string
  invoice_date: string | null
  customer_name: string | null
  amount_before_tax: number | null
  tax_amount: number | null
  net_amount: number | null
  old_metal_amount: number | null
  advance_amount: number | null
  payable: number | null
  line_items: unknown
}

// Publishes {token, invoice, expiresAt} to the customer app. Throws on any
// failure (missing config, non-2xx, network) so the caller can fail the send.
export async function publishInvoice(
  token: string,
  invoice: InvoiceSnapshot,
  expiresAt: string,
): Promise<void> {
  const url = process.env.CUSTOMER_APP_PUBLISH_URL
  const secret = process.env.CUSTOMER_APP_PUBLISH_SECRET
  if (!url || !secret) {
    throw new Error('Invoice publishing is not configured (CUSTOMER_APP_PUBLISH_URL / _SECRET).')
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publish-secret': secret },
    body: JSON.stringify({ token, invoice, expiresAt }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Publish failed (${res.status})${text ? `: ${text.slice(0, 120)}` : ''}`)
  }
}
