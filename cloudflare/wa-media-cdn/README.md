# wa-media-cdn — Cloudflare edge in front of Supabase Storage

Serves product/category image bytes from Cloudflare's **free, unmetered** edge
instead of billing Supabase's cached-egress meter. This is the *structural* fix
that follows the `card` rendition (see root `SUPABASE_EGRESS_PLAN.md`): the card
shrinks each image ~4×; the CDN takes the repeat downloads off Supabase entirely.

## How it fits together

```
customer app (read time)                 Cloudflare Worker              Supabase origin
CatalogueProduct.image/card/thumb   →    <cdn-host>                →    <ref>.supabase.co
  host-swapped by src/lib/cdn.ts         (worker.js, edge-cached)       (only on cache miss)
  gated by NEXT_PUBLIC_IMAGE_CDN_HOST
```

- **Path + query are preserved 1:1** (`/storage/v1/object/public/wa-media/…`), so
  moving a URL to the CDN is a pure **hostname swap** — no stored URL changes, no
  backfill.
- The Worker (not a plain proxied CNAME) is required because Supabase Storage
  routes by Host/SNI; the Worker re-issues `fetch()` at the real `*.supabase.co`
  origin so Host + SNI are correct.

## The domain is NOT on Cloudflare — so we use `*.workers.dev`

`mnalankarpalace.com` runs on **Google Cloud DNS** (nameservers `ns-cloud-*.
googledomains.com`), because the app is on Firebase/GCP. We therefore deploy the
Worker to a free **`*.workers.dev`** hostname — **no DNS change, deployable today,
nothing about the live site/DNS/email is touched.** Moving to a branded
`cdn.mnalankarpalace.com` is an optional later upgrade (see "Upgrade" below), NOT a
prerequisite.

## Deploy (workers.dev — the path for today)

```bash
cd mnap-connect/cloudflare/wa-media-cdn
npm i -g wrangler        # if not installed
wrangler login           # your Cloudflare account (create a free one if needed)
wrangler deploy          # publishes to https://wa-media-cdn.<account>.workers.dev
```

`wrangler deploy` prints the exact `*.workers.dev` URL. That hostname is your CDN.

### Smoke test (before touching the app)

Take any current product image URL, swap its host to the workers.dev host, keep the
`/storage/v1/object/public/wa-media/...` path, and confirm bytes + headers:

```bash
# expect: 200, image/jpeg, X-Cache: MISS on the first call, HIT on the second
curl -sI "https://wa-media-cdn.<account>.workers.dev/storage/v1/object/public/wa-media/<some/path>.jpg"
```

## Turn it on in the customer app

Only after the smoke test passes:

1. Set `NEXT_PUBLIC_IMAGE_CDN_HOST=wa-media-cdn.<account>.workers.dev` in the
   customer app's App Hosting env (`apphosting.yaml` / console) **and** local
   `.env.local` for dev. (Bare host — no `https://`, no trailing slash; the app
   sanitises it anyway.)
2. Redeploy the customer app (App Hosting).
3. Verify in the browser Network tab: image requests go to the workers.dev host and
   return `X-Cache: HIT` on repeat.
4. Watch Supabase → Usage → cached egress flatten over the next day.

**No APK rebuild / no Play submission.** The Android app is a thin WebView that
loads the live site (`server.url = gold.mnalankarpalace.com`); images are
cross-origin `<img>` subresources, which Capacitor's `allowNavigation` does **not**
gate (it only gates top-level navigation). Https images from the CDN load in the
WebView exactly as today's supabase.co images do.

**Rollback = clear `NEXT_PUBLIC_IMAGE_CDN_HOST` and redeploy.** Every URL falls
back to Supabase immediately; nothing in the database changed.

## Edge cases handled in the Worker

- **wa-media only** — any path outside `/storage/v1/object/public/wa-media/` (or
  containing `..`) → 404. Not an open proxy.
- **Query strings preserved** — path + query are both forwarded and keyed, so an
  image-transform variant can never be served the wrong bytes.
- **Range requests** (video seeking / partial reads from the shared bucket) stream
  through uncached, so byte-range semantics stay correct.
- **HEAD** returns headers with no body; **OPTIONS** returns CORS preflight.
- **CORS** `*` on every response (needed by the connect backfill's `fetch`→canvas).
- **Origin failures** → `502` with `no-store`; **upstream 4xx/5xx** cached only 30s,
  so a deleted object or a blip self-heals instead of sticking for a year.

## Limits (workers.dev free tier)

Free Workers allow **100,000 requests/day** (~3M/month), and on `*.workers.dev`
every image request runs the Worker **even on a cache hit** (the edge cache can't
bypass the Worker without a zone route). Each image view = 1 request. Comfortable
for current traffic; if you approach it, do the branded-domain upgrade below, where
edge cache hits bypass the Worker and the ceiling effectively disappears.

## Rate limiting

Cloudflare's WAF rate-limiting rules require a zone (the branded-domain upgrade).
On workers.dev the wa-media-only allowlist + long edge cache already blunt abuse
(a scraper mostly pulls cheap cache hits). Add the rate-limit rule when/if you move
to the custom domain.

## Photo changes never linger (cache-busting by filename)

There is **no stale-image problem** to work around: connect writes every image to a
**timestamped filename**, so a photo change is a *new URL*, which neither Cloudflare
nor any browser has ever cached → customers see it immediately.

- New photo → `products/<id>/<timestamp>-<n>.jpg`
- Re-crop → `products/<id>/<timestamp>-crop-4x5.jpg` (+ card/thumb), and the OLD
  files are deleted. The DB row + the customer-app doc are updated to the new URL.
- Replace = delete + add = a new row with a new URL.

The long edge TTL is therefore safe: it caches *immutable* URLs. An orphaned old URL
just expires unused. (The one-time card **backfill** writes a fixed
`products/<pid>/card-<rowid>.jpg` with `upsert`, which is idempotent — same bytes,
same path — and is superseded by a timestamped file the first time that photo is
re-cropped.)

Because every change already busts the cache, **no Cloudflare purge is ever needed**
for the catalogue. (Purge remains available in the dashboard for the rare manual
case, but the flow above makes it unnecessary.)

## Upgrade (optional, later): branded `cdn.mnalankarpalace.com`

Only worth it for the brand URL, WAF rate limiting, and removing the request
ceiling. It requires **moving the `mnalankarpalace.com` zone onto Cloudflare**
(change registrar nameservers) — a deliberate, planned step, because the zone
carries the live app, the prod invoice links (`gold.…/i/…`), and email. Replicate
ALL existing DNS records in Cloudflare first, then switch nameservers. After the
zone is Active: set `workers_dev = false`, uncomment the `[[routes]]` block in
`wrangler.toml`, `wrangler deploy`, and change `NEXT_PUBLIC_IMAGE_CDN_HOST` to
`cdn.mnalankarpalace.com`. Do not do this casually.

## Endgame: Cloudflare R2 (zero-egress origin)

Once stable, migrate the bucket to **Cloudflare R2** (10 GB free, $0 egress) and
point the Worker's origin at R2. At that cutover you'll want stored URLs to become
canonical — run `migrate-urls.mjs` (dry-run first, then `--apply`; `--revert`
undoes). Not needed to move traffic today.
