// Route wa-media image URLs through the Cloudflare CDN (see cloudflare/wa-media-cdn)
// so image bytes are served from Cloudflare's free edge instead of Supabase's egress
// meter. Staff browse the catalogue heavily every day, so their repeat image loads
// are a real chunk of egress too — this offloads them.
//
// Same mechanism as the customer app's src/lib/cdn.ts: the Worker preserves the full
// `/storage/v1/object/public/wa-media/...` path, so this is a pure HOSTNAME swap done
// at render time. Nothing stored changes.
//
// GATED BY ENV so it is a no-op until the CDN is live (set on Vercel + local .env):
//   NEXT_PUBLIC_IMAGE_CDN_HOST=wa-media-cdn.<account>.workers.dev  → route via CDN
//   (unset / empty)                                                → URLs unchanged
// Instant rollback: clear the var and redeploy.

// Accept a bare host; defensively strip a scheme, any path, and trailing slash.
const CDN_HOST = (process.env.NEXT_PUBLIC_IMAGE_CDN_HOST ?? "")
  .trim()
  .replace(/^https?:\/\//i, "")
  .replace(/\/.*$/, "")

const SUPABASE_PUBLIC_RE =
  /^https:\/\/[a-z0-9-]+\.supabase\.co(\/storage\/v1\/object\/public\/wa-media\/.*)$/i

/**
 * Swap a Supabase wa-media public URL onto the image CDN. Returns the input
 * unchanged when the CDN is unset, the value is falsy, or it isn't a Supabase
 * wa-media URL — so it is always safe to wrap any image URL.
 */
export function cdnImage<T extends string | null | undefined>(url: T): T {
  if (!CDN_HOST || !url) return url
  const m = SUPABASE_PUBLIC_RE.exec(url)
  if (!m) return url
  return (`https://${CDN_HOST}${m[1]}`) as T
}
