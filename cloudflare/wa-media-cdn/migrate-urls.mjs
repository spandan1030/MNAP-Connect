#!/usr/bin/env node
// migrate-urls.mjs — OPTIONAL, and NOT required to move image traffic to the CDN.
//
// The customer app already re-homes image URLs onto the CDN at READ TIME
// (src/lib/cdn.ts, gated by NEXT_PUBLIC_IMAGE_CDN_HOST). That covers all traffic
// with zero DB writes and instant rollback. Use THIS script only when you want the
// stored URLs themselves to become canonical CDN URLs — i.e. at the eventual
// Cloudflare R2 cutover, or if you decide to retire the render-time swap.
//
// What it rewrites (host-swap only; paths preserved):
//   Firestore `catalogue/{id}` : image, card, thumb, images[]
//   Firestore `categories/{id}`: thumb
//   Supabase  wa_product_images: image_url, thumb_url, display_url,
//                                display_thumb_url, card_url
//
// SAFETY: dry-run by default (prints what WOULD change). Pass --apply to write.
//         Pass --revert to swap CDN URLs back to Supabase (undo).
//
// ENV required:
//   SUPABASE_URL                     e.g. https://tqnirshwiqpwbqdcrgbr.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY        (service role — server only, never ship)
//   IMAGE_CDN_HOST                   e.g. cdn.mnalankarpalace.com
//   FIREBASE_ADMIN_CREDENTIALS       JSON of the customer-app service account
//   (or GOOGLE_APPLICATION_CREDENTIALS pointing at that JSON file)
//   FIREBASE_PROJECT_ID              customer app project id
//
// Run from this folder with connect's node_modules on the path, e.g.:
//   cd mnap-connect && node cloudflare/wa-media-cdn/migrate-urls.mjs           # dry run
//   cd mnap-connect && node cloudflare/wa-media-cdn/migrate-urls.mjs --apply   # write

import { createClient } from '@supabase/supabase-js';
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

const SUPABASE_URL = required('SUPABASE_URL');
const SERVICE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const CDN_HOST = required('IMAGE_CDN_HOST').replace(/^https?:\/\//, '').replace(/\/$/, '');

function required(k) {
  const v = (process.env[k] ?? '').trim();
  if (!v) { console.error(`Missing env ${k}`); process.exit(1); }
  return v;
}

// Supabase wa-media public URL -> CDN, and the reverse.
const SUPA_RE = /^https:\/\/([a-z0-9-]+)\.supabase\.co(\/storage\/v1\/object\/public\/wa-media\/.*)$/i;
const CDN_RE = new RegExp(`^https://${CDN_HOST.replace(/[.]/g, '\\.')}(/storage/v1/object/public/wa-media/.*)$`, 'i');
const SUPA_HOST = new URL(SUPABASE_URL).host; // <ref>.supabase.co

function toCdn(url) {
  if (typeof url !== 'string') return url;
  const m = SUPA_RE.exec(url);
  return m ? `https://${CDN_HOST}${m[2]}` : url;
}
function toSupa(url) {
  if (typeof url !== 'string') return url;
  const m = CDN_RE.exec(url);
  return m ? `https://${SUPA_HOST}${m[1]}` : url;
}
const swap = REVERT ? toSupa : toCdn;

let changed = 0, scanned = 0;
function mark(before, after) { if (before !== after) changed++; return after; }

async function firestore() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_ADMIN_CREDENTIALS;
    initializeApp({
      credential: raw ? cert(JSON.parse(raw)) : applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
  const db = getFirestore();

  // catalogue
  const cat = await db.collection('catalogue').get();
  for (const d of cat.docs) {
    scanned++;
    const x = d.data();
    const next = {
      image: mark(x.image, swap(x.image)),
      card: mark(x.card, swap(x.card)),
      thumb: mark(x.thumb, swap(x.thumb)),
      images: Array.isArray(x.images) ? x.images.map((u) => { const n = swap(u); if (n !== u) changed++; return n; }) : x.images,
    };
    if (APPLY && (next.image !== x.image || next.card !== x.card || next.thumb !== x.thumb ||
        JSON.stringify(next.images) !== JSON.stringify(x.images))) {
      await d.ref.set(next, { merge: true });
    }
  }

  // categories
  const cats = await db.collection('categories').get();
  for (const d of cats.docs) {
    scanned++;
    const x = d.data();
    const thumb = mark(x.thumb, swap(x.thumb));
    if (APPLY && thumb !== x.thumb) await d.ref.set({ thumb }, { merge: true });
  }
}

async function supabase() {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const cols = ['image_url', 'thumb_url', 'display_url', 'display_thumb_url', 'card_url'];
  const { data, error } = await sb.from('wa_product_images').select(`id,${cols.join(',')}`);
  if (error) { console.error('Supabase read failed:', error.message); process.exit(1); }
  for (const row of data ?? []) {
    scanned++;
    const patch = {};
    for (const c of cols) {
      const n = swap(row[c]);
      if (n !== row[c]) { patch[c] = n; changed++; }
    }
    if (APPLY && Object.keys(patch).length) {
      const { error: uErr } = await sb.from('wa_product_images').update(patch).eq('id', row.id);
      if (uErr) console.error('update failed', row.id, uErr.message);
    }
  }
}

console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN'}  Direction: ${REVERT ? 'CDN→Supabase (revert)' : 'Supabase→CDN'}  CDN: ${CDN_HOST}`);
await firestore();
await supabase();
console.log(`Scanned ${scanned} docs/rows. URL fields ${APPLY ? 'rewritten' : 'that WOULD change'}: ${changed}.`);
if (!APPLY) console.log('Re-run with --apply to write. (Add --revert to go the other way.)');
