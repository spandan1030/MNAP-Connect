// wa-media-cdn — Cloudflare Worker that fronts the Supabase public Storage bucket
// `wa-media` so product-image bytes are served from Cloudflare's edge (free,
// unmetered) instead of billing against Supabase's cached-egress meter.
//
// WHY A WORKER (and not a plain proxied CNAME):
//   Supabase Storage routes requests by Host/SNI. A CNAME
//   `cdn.mnalankarpalace.com -> <ref>.supabase.co` (orange-cloud) would arrive at
//   origin with the wrong Host and 404. This Worker re-issues fetch() against the
//   literal *.supabase.co origin, so Host + SNI are correct, then edge-caches it.
//
// DEPLOYS WITHOUT MOVING DNS: the zone is on Google Cloud DNS, not Cloudflare, so
//   this runs on a `*.workers.dev` hostname (see wrangler.toml + README). Moving to
//   a branded `cdn.mnalankarpalace.com` later is a config change, not a code change.
//
// URL SHAPE (host-swap only — path AND query are preserved 1:1):
//   stored:            https://<ref>.supabase.co/storage/v1/object/public/wa-media/<path>
//   rewritten (app):   https://<cdn-host>/storage/v1/object/public/wa-media/<path>
//   this Worker fetches the stored (supabase) form.
//   A short form `/wa-media/<path>` is also accepted and expanded.

const DEFAULT_ORIGIN = 'https://tqnirshwiqpwbqdcrgbr.supabase.co';
const STORAGE_PREFIX = '/storage/v1/object/public/wa-media/';
const SHORT_PREFIX = '/wa-media/';

// Edge cache lifetime (seconds). Long, because one Supabase fetch then serves all
// visitors from the edge — this is what actually cuts egress. See README
// "Re-crop / replace caveat" before changing.
const EDGE_TTL = 31536000; // 1 year
// Browser cache lifetime — deliberately shorter than the edge so a re-cropped
// image reaches returning users within a week even if the edge copy is stale.
const BROWSER_TTL = 604800; // 7 days

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
};

export default {
  async fetch(request, env, ctx) {
    // Preflight (harmless — <img> never triggers it, but fetch(mode:cors) can).
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS', ...CORS } });
    }

    const origin = (env && env.SUPABASE_ORIGIN) || DEFAULT_ORIGIN;
    const url = new URL(request.url);

    // Normalise to the full Supabase storage path, then HARD-restrict to the
    // wa-media bucket so this Worker can never be used as an open proxy.
    let path = url.pathname;
    if (path.startsWith(SHORT_PREFIX)) path = '/storage/v1/object/public' + path;
    if (!path.startsWith(STORAGE_PREFIX) || path.includes('..')) {
      return new Response('Not Found', { status: 404, headers: CORS });
    }

    // Preserve query too (e.g. Supabase image-transform params), so the CDN can
    // never serve the wrong variant of an object.
    const originUrl = origin + path + url.search;

    // Range requests (video seeking / partial fetches from the shared bucket):
    // stream straight through, uncached, so byte-range semantics stay correct.
    const range = request.headers.get('Range');
    if (range) {
      try {
        const r = await fetch(originUrl, { method: request.method, headers: { Range: range } });
        const h = new Headers(r.headers);
        for (const [k, v] of Object.entries(CORS)) h.set(k, v);
        h.delete('set-cookie');
        return new Response(r.body, { status: r.status, headers: h });
      } catch {
        return new Response('Upstream error', { status: 502, headers: CORS });
      }
    }

    // Cache key is method+path+query only (public objects; no auth/cookies), so
    // every visitor shares one cache entry. HEAD and GET are keyed separately.
    const cache = caches.default;
    const cacheKey = new Request(url.origin + path + url.search, { method: 'GET' });

    if (request.method === 'GET') {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const h = new Response(hit.body, hit);
        h.headers.set('X-Cache', 'HIT');
        return h;
      }
    }

    let originResp;
    try {
      originResp = await fetch(originUrl, {
        method: request.method,
        cf: { cacheEverything: true, cacheTtl: EDGE_TTL },
      });
    } catch {
      return new Response('Upstream error', { status: 502, headers: { 'Cache-Control': 'no-store', ...CORS } });
    }

    // Pass failures through with only a short TTL so a mistake (404 on a deleted
    // object, transient 5xx) self-heals instead of sticking for a year.
    if (!originResp.ok) {
      const h = new Headers(CORS);
      h.set('Cache-Control', 'public, max-age=30');
      h.set('X-Cache', 'MISS');
      const ct = originResp.headers.get('Content-Type');
      if (ct) h.set('Content-Type', ct);
      return new Response(request.method === 'HEAD' ? null : originResp.body, { status: originResp.status, headers: h });
    }

    const resp = new Response(request.method === 'HEAD' ? null : originResp.body, originResp);
    resp.headers.set('Cache-Control', `public, max-age=${BROWSER_TTL}, stale-while-revalidate=86400`);
    for (const [k, v] of Object.entries(CORS)) resp.headers.set(k, v);
    resp.headers.set('X-Cache', 'MISS');
    resp.headers.delete('set-cookie');

    // Store a clone with the long edge TTL for subsequent visitors (GET only).
    if (request.method === 'GET') {
      const edgeCopy = new Response(resp.clone().body, resp.clone());
      edgeCopy.headers.set('Cache-Control', `public, max-age=${EDGE_TTL}`);
      ctx.waitUntil(cache.put(cacheKey, edgeCopy));
    }

    return resp;
  },
};
