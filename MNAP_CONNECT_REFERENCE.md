# MNAP Connect — WhatsApp Customer Engagement App
## Complete Project Reference Document

> ⚠️ **PARTIALLY OUTDATED (as of 17 June 2026).** Sections describing `wa.me` deep links and
> "No API" (Tech Stack, WhatsApp Link Format) are superseded — the app now uses the **real
> WhatsApp Business Cloud API** with a two-way inbox, rules-based inbound auto-engagement, and
> topic-synced signal capture. It also now has full **Catalogue, Inventory, and Purchase-plan**
> operations modules. For the current engagement layer, those operations modules,
> infrastructure, and roadmap (Flow Builder, Topic↔Node linking), see **`ENGAGEMENT_SYSTEM.md`**
> (operations modules are in its section 6). The Type A / Type B data model and segmentation
> sections below remain accurate.

---

## Table of Contents

1. [Project Identity](#1-project-identity)
2. [Tech Stack](#2-tech-stack)
3. [Two-Module Architecture](#3-two-module-architecture)
4. [Database Schema — Type A (Broadcasting)](#4-database-schema--type-a-broadcasting)
5. [Database Schema — Type B (Intervention CRM)](#5-database-schema--type-b-intervention-crm)
6. [Type A — Business Rules & Logic](#6-type-a--business-rules--logic)
7. [Type A — Send Module](#7-type-a--send-module)
8. [Type A — Template System](#8-type-a--template-system)
9. [Type A — Opt-Out Rules](#9-type-a--opt-out-rules)
10. [Type B — Segmentation Engine](#10-type-b--segmentation-engine)
11. [Type B — Profiling Form](#11-type-b--profiling-form)
12. [Type B — Segment Definitions](#12-type-b--segment-definitions)
13. [Page Structure](#13-page-structure)
14. [Data Flows](#14-data-flows)
15. [WhatsApp Link Format](#15-whatsapp-link-format)
16. [Key Source Files](#16-key-source-files)
17. [Build Phases](#17-build-phases)
18. [Future Roadmap](#18-future-roadmap)
19. [Known Constraints](#19-known-constraints)

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| App Name | MNAP Connect |
| Purpose | WhatsApp customer engagement — Type A (daily rate broadcasts) + Type B (behavioral CRM with segmentation and interventions) |
| Store | M N Alankar Palace |
| Repo | `https://github.com/spandan1030/MNAP-Connect.git` |
| Local Folder | `C:\Users\spand\Desktop\Management Software\mnap-connect` |
| Live URL | `https://mnapconnect.vercel.app` |
| Supabase Project | **Same as MNAP** — `https://tqnirshwiqpwbqdcrgbr.supabase.co` |
| Database Namespace | All tables prefixed `wa_` — zero conflict with MNAP tables |
| Primary Users | Salesmen (internal, authenticated) |
| Secondary Users | Customers (public self-enroll page — Type A only) |
| Platform | **Mobile-first** — salesmen use this on their phones |

---

## 2. Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 15 (App Router, TypeScript) | Same as MNAP |
| Styling | Tailwind CSS 4 | Mobile-first, large tap targets |
| Database | Supabase (same project as MNAP) | `wa_` prefixed tables |
| Auth | Supabase Auth (same project) | Salesmen log in with existing credentials |
| WhatsApp | `wa.me` deep links | No API — opens WhatsApp Business app |
| Hosting | Vercel (separate project) | Auto-deploys from its own GitHub repo |
| Segmentation | Client-side pure function (`lib/segmentation.ts`) | No server required — rules evaluated in browser on profile save |
| Customer-app link | Firebase Admin SDK (`firebase-admin`) | Mirrors published catalogue products into the **mnap-customer** app's Firestore |

### Customer-app catalogue publishing (link to mnap-customer)
A product can be **published to the customer app** (a separate Firebase project,
`mnap-customer`) from its product page. Toggle **"Show in customer app"** + set a
**making charge %**; connect then writes a **sanitized** doc (title, description,
category, weight, purity→karat, makingPercent, **published photo gallery (4:5 crops)**, active)
into the customer app's `catalogue/{id}` Firestore collection via the Firebase Admin SDK.
The doc carries `image`/`thumb` (the cover) **and** `images: string[]` (the full gallery,
cover first) — the customer app's `PhotoViewer` swipes through `images`.
Never sends party/cost/notes. **The raw `barcode` is NOT sent** (sensitive) — instead the doc
carries **`designCode`** (`MN000001…`, per-piece, wa_058); the app displays that. Price is
**not** sent — the customer app computes it live from its own daily rate. Unmapped purity →
still published, `priceHidden:true` (app shows "Enquire"). The doc also carries a richer
**`status: 'in_stock'|'sold'|'deleted'|'catalogue'`**, plus **`inStock` (= status==='in_stock')**
and **`catalogueOnly`**. Inactive/unpublished → doc updated/removed automatically; **sold or
deleted pieces stay published** (visible) carrying their status so the app can show a
"Sold"/updated treatment. Recommended app branching order: **catalogueOnly → status → normal**.

- Files: `lib/firebase/admin.ts` (Admin init), `lib/catalogue-sync.ts` (`resolveKarat`,
  `syncProductToApp`, `removeProductFromApp`, `resyncAllPublished`), `app/api/catalogue/publish/route.ts`
  (staff-authed POST `{id}` or `{resyncAll:true}`). Publish/re-sync fire automatically
  on save, sold-toggle, and primary-photo change; catalogue list has a manual
  **"↻ Re-sync customer app"** button.
- **Migration:** `supabase/migrations/wa_025_app_publish.sql` adds `show_in_app`,
  `making_percent`, `app_title`, `app_description`, `app_synced_at` to `wa_products`.

### Product images — upload + fixed 4:5 crop
Photos are added on `/catalogue/new` and `/catalogue/[id]` via 📷 camera, 🖼 gallery,
**drag-and-drop**, or **paste (Ctrl/⌘+V)** — the last two are laptop conveniences
(document-level paste listener + a drop target on the Photos card).

Every product photo is presented at **4:5 (portrait)**. The **original upload is kept
untouched** (`wa_product_images.image_url` / `thumb_url`); a derived **4:5 crop** is
stored alongside it (`display_url` / `display_thumb_url`) plus the normalized crop rect
(`crop` JSONB, `{x,y,w,h}` in 0..1, **optional `rotate` 0/90/180/270**, and **optional
`logo` watermark placement**). On upload a **centred** 4:5 crop is generated automatically,
so every photo has a valid display image even if never manually cropped. The **Crop** button
opens `components/catalogue/ImageCropper.tsx` — a fixed 4:5 frame the user pans/zooms **and
can rotate 90° at a time** (Instagram-style). Rotation is baked into the exported 4:5 image by
`renderCrop` (`crop.rotate` → `rotateImageToCanvas` before cropping); the crop rect is
normalized to the **rotated** image, and the cropper hands back the **original** image so
both the new-upload and re-crop paths apply rotation uniformly. Re-cropping regenerates only
the display files (original is never touched) and re-syncs if the photo is primary + published.

**Logo watermark (baked in):** the cropper has a **Logo** option — a transparent PNG at
`public/watermark.png` (drop the file to enable; the option is disabled + labelled if absent,
and rendering silently skips it). The user drags it in the 4:5 frame and sets **size + opacity**;
placement is stored as `crop.logo = {cx, cy, scale, opacity}` (all normalized to the 4:5 frame,
cx/cy = centre) and **remembered in `localStorage` (`mnap_crop_logo`) as the default for the next
photo**. `renderCrop` loads the watermark (`loadWatermark`, `WATERMARK_SRC`) and `drawImage`s it
onto both the full + thumb canvases before export, so the **customer app receives the already-
combined photo — no app-side change**. Only photos taken through the cropper get the logo (an
auto-centred crop with no `logo` field is un-watermarked).
- The **customer app is fed the crop**: `catalogue-sync.buildDoc` sends
  `display_url ?? image_url` (and `display_thumb_url ?? thumb_url ?? image_url`).
- **Latest upload = primary by default:** on both `/catalogue/new` (save loop) and
  `/catalogue/[id]` (`addPhotos`), the **most-recently-uploaded** photo is set primary +
  `in_app`, overriding any previous primary (staff can re-pick with ★). Old rule was
  "only the first-ever photo becomes primary".

### Stock status — per-piece Sold / In stock (+ bulk update)
Each catalogue product **is one barcoded piece**, with `wa_products.is_sold` (wa_017).
- **Per-product:** the `/catalogue/[id]` page has a Sold ⇄ In stock toggle that persists
  immediately and re-syncs the app if the piece is published.
- **Bulk:** `/catalogue/stock` — paste barcodes (comma / space / newline separated) and
  mark them all **Sold** or **In stock** in one action. `POST /api/catalogue/stock`
  `{ barcodes, sold }` matches **case-insensitively** (index is `lower(barcode)`), flips
  `is_sold` only on rows that differ, re-syncs matched pieces that are published, and
  returns `{ updated, unchanged, matched, notFound[] }`. Linked from the catalogue list
  ("Stock" chip). No migration — reuses `is_sold`.
- **Published to the app:** sold pieces **no longer vanish**. `catalogue-sync` sets
  `active = show_in_app && is_active` and adds **`status`** + **`inStock = status==='in_stock'
  && !is_catalogue_only`** to the doc (status comes from `stock_status`, wa_058; see Catalogue
  products below — this **replaced** the earlier "no barcode → out-of-stock" rule). The app
  keeps the piece visible and shows a "Sold" treatment on `inStock:false`.
  ⚠ Until the customer app branches on `inStock`, an `inStock:false` published piece shows
  like a normal in-stock one. Existing published products only pick up the new flag on their
  next sync — hit **↻ Re-sync customer app** on the catalogue list to backfill.

### Catalogue products — design-only (not physical stock)
`wa_products.is_catalogue_only` (**wa_057**, default false) marks a **design we show but do
not physically stock** as a barcoded piece.
- **Set it:** the `/catalogue/[id]` Status card toggle, the "Catalogue product" checkbox on
  `/catalogue/new`, or the bulk **Type → Catalogue / Stock piece** action.
- **Backfill (wa_057):** every existing product **without a barcode** was flagged
  catalogue-only (they're designs, not pieces). Reversible per-product.
- **Inventory** (`/catalogue/inventory`) counts **`is_active && stock_status='in_stock' && !is_catalogue_only`**
  — sold/deleted and catalogue products are excluded. The list's **"In stock"** chip matches; a **"Catalogue"**
  status chip filters `is_catalogue_only=true`. Cards show an indigo **CATALOGUE** badge.
- **Published to the app:** catalogue products still publish as a **normal product with a live
  price**, carrying **`catalogueOnly:true`** and **`inStock:false`** (they're not physical stock).
  The customer app should branch **catalogueOnly first** (its own "design / made to order"
  treatment), then `inStock` (sold), then normal — app-side rendering is a later change.

### Catalogue list filters (`/catalogue`)
Status pills (single-choice): **All · In stock · Sold · Deleted · Catalogue · Review**.
- **In stock** = `is_sold=false AND is_catalogue_only=false AND stock_status<>'deleted'` — the
  `stock_status<>'deleted'` clause fixes a leak where software-deleted pieces (`stock_status='deleted'`
  but `is_sold=false`) previously showed as In stock. **Deleted** = `stock_status='deleted'`; those
  cards get a grey **DELETED** badge + a non-interactive **Deleted** chip (no sold/in-stock toggle).
  Manual sold/in-stock toggling still writes `is_sold` only — `stock_status` just adds the deleted axis.
- Filter panel (saved to `localStorage`): Item name / Design / Description / Purity / Party (multi),
  Weight range, and single-choice **Barcode** (Any/Has/None), **Photo** (Any/Has/None, backed by
  `wa_products.has_photo` — wa_060), **Catalogue-only** (Any/Only/Exclude — combinable, unlike the
  exclusive Catalogue pill), **Customer app** (Any/Published/Not published). Catalogue-only pieces
  carry an internal XMNAP barcode, so they read as **Has barcode**; the Catalogue-only filter separates them.

### Bulk actions on selected products
The catalogue list (`/catalogue`) has a **Select** mode (toggle next to the item count): tap
cards to tick them, **Select all** ticks every loaded card, and the sticky bottom bar opens an
**Actions** sheet. All actions run against the ticked ids via `POST /api/catalogue/bulk`
`{ ids, action, ...args }`; afterwards the list **refetches page 0** so status/filter changes are
reflected (e.g. a piece marked Sold drops out of the "In stock" view). Actions (v1):
- **Stock** — `sold {sold}` flips `is_sold`; re-syncs published pieces (stock status).
- **Type** — `catalogue {catalogue}` flips `is_catalogue_only`; re-syncs published pieces
  (flips `inStock`/`catalogueOnly`).
- **Review** — `review {review}` flips `needs_review`; not sent to the app.
- **Customer app** — `publish {publish, makingPercent?}` flips `show_in_app` and syncs each
  (publish upserts, unpublish removes the Firestore doc). Making % is only overwritten when
  supplied on the Publish sub-sheet; otherwise each row keeps its own.
- **Set party** — `set_party {party}` (chosen from existing Values); party is never published → no sync.
- **Set making %** — `set_making {makingPercent}`; re-syncs published pieces (feeds the app's live price).
- **Delete** — removes published pieces from the app (`removeProductFromApp`), deletes their
  `wa_product_images` + storage objects, then the rows. **The single `/catalogue/[id]` delete
  now routes through this same endpoint** (`{ ids:[id], action:'delete' }`), so it also cleans
  up the Firestore doc + storage (previously it dropped only the row).
Reuses existing columns (the `catalogue` action needs wa_057).

### Inventory import — software item-status export (wa_058)
Simplifies data entry by ingesting the store software's full item-status **xlsx export** into a
master reference table. **It does NOT create product cards** — cards are still made only via Add+.

- **`wa_inventory`** (one row per software barcode) — the master. Columns mirror the export:
  `barcode` (PK), `itm_id`, `item_name_raw`, `party_id`, `dsgn_id`, `design_raw`, `purt_id`,
  `purity_raw`, `grd_id`, `grade_raw`, `net_weight`, `bcm_creation_date`, `bcm_status`,
  `sold_date`, `deleted_date`, `source_file`, `imported_at`, `updated_at`. Prefix index on
  `lower(barcode)` for Add+ autocomplete. Sample export: **32,899 rows**, all barcodes unique.
- **Parser** `lib/inventory-import.ts` (`parseInventoryWorkbook`, `mapStatus`, `STATUS_MAP`):
  reads the first sheet, matches columns by header name (case-insensitive), de-dupes by barcode
  (last wins), drops rows with no barcode. The software exports empties as the literal text
  **`"NULL"`** (in the date columns) — `blank()` treats that + blanks as empty everywhere.
- **Status mapping** (`BCM_STATUS` → `wa_products.stock_status`): **New→`in_stock`, Sale→`sold`,
  Deleted→`deleted`**. Other raw statuses (Estm/Approval/Remove) are stored on the master for
  lookup but **never change a product card**.
- **Upload UI** `/catalogue/import` (linked from `/catalogue/inventory` header): pick file →
  **Preview** (parse + report row counts, status breakdown, and the exact product-card status
  changes, with a sample) → **Apply**. `POST /api/inventory/import` multipart `{ file, mode }`:
  - `preview` — no writes; returns the summary + impact.
  - `apply` — upserts `wa_inventory` (chunked, onConflict `barcode`), updates matched cards'
    `stock_status` (+ `is_sold` in lockstep) for the three mapped statuses, then re-syncs the
    **published** changed ones so their app doc carries the new status.
- **Publishing is never touched** — the import only writes `stock_status`; `show_in_app`/`is_active`
  are left exactly as-is (a deleted/sold published piece stays published, carrying its new status).

### Design code & stock status (wa_058)
- **`design_code`** — app-facing per-piece code `MN######`, auto-assigned by a BEFORE INSERT
  trigger (`wa_assign_design_code` off `wa_design_code_seq`) and backfilled oldest-first. It is
  **the only code sent to the customer app** (raw `barcode` is withheld as sensitive); in Connect
  it **shows alongside the barcode** on the catalogue grid, product page, and inventory leaves, and
  is **searchable** (catalogue list `.or(design_code.ilike…)`; inventory client filter).
- **`stock_status`** (`in_stock|sold|deleted`, default `in_stock`) — richer than the old `is_sold`
  boolean, fed by the import. `is_sold` is kept in lockstep (`is_sold = stock_status==='sold'`).
  **Informational only** — it does not gate app visibility.
- **`party_id`** (int) — numeric supplier id from the software; party name mapping is a later phase.
- **XMNAP backfill** — catalogue-only pieces with no barcode get an internal `XMNAP#####` barcode
  (`wa_xmnap_seq`) so every piece is keyed. Never leaks to the app (design code is sent instead).

### Name & purity mapping (wa_059)
The software's item names are messy (aliases/shortforms/`[DELETED]`/`(22CT)` junk). We map the
**stable `ITM_ID` → one clean Connect item name**, and only the clean name is shown/fed to the app.
- **`wa_item_name_map`** (`itm_id` PK → `clean_name`, `source` seed/learned/manual, `sample_raw`, `hits`).
  Seeded by **majority vote**: `POST /api/inventory/rebuild-name-map` joins barcoded products →
  `wa_inventory` (by barcode) to get their `itm_id`, and for each `itm_id` the most-frequent curated
  `item_name` wins (ties → longer name). **Owner-set (`manual`) rows are never overwritten** by a rebuild.
- **`wa_purity_map`** (`raw_key` = lower(raw) → `clean`). Seeded with 4 confident mappings
  (`22K (91.6)`→22K, `18K (750)`→18K, `24 Carat`→24K, `0.925`→925); ambiguous silver grades / %
  ranges / bare decimals are left for the owner to set (guessing wrong is worse than blank).
- **Fuzzy fallback** (`lib/inventory-maps.ts` `similarity`/`suggestName`): for an unmapped item it
  suggests a clean name by **token containment** (item-type word dominates: `LC RING`→RING,
  `CB PAYAL`→PAYAL, `MS LOCKET`→LOCKET) with a down-weighted char edit ratio; min score 0.34.
- **Review UI** `/catalogue/mappings` (linked from `/catalogue/inventory`): two tabs (Item names /
  Purity) listing what's in the master (via security-invoker views `wa_inventory_items` /
  `wa_inventory_purities`) with its current mapping, count, and source badge. Edit any row (upserts
  `source='manual'`); "↻ Rebuild from barcoded products" runs the majority vote. Unmapped item rows
  show a fuzzy **Suggest:** chip. **Learning also happens on Add+/attach** (see below).

### Add+ barcode autocomplete & prefill (wa_058/wa_059)
- **`GET /api/inventory/lookup?q=<prefix>`** — case-insensitive prefix search of `wa_inventory`
  returning each match with the **resolved clean name** (via `wa_item_name_map`), **clean purity**
  (via `wa_purity_map`, falls back to raw), weight, `party_id`, mapped `stockStatus`, and whether the
  barcode is **already a product card** (`existsAsProduct`/`productId`).
- **`components/catalogue/BarcodeLookup.tsx`** — barcode field with a live dropdown (debounced 200 ms).
  **Auto-prefills the moment the typed/scanned value is a full barcode** (unique exact match — no click
  needed; fires once per barcode via a ref guard, so it never loops or re-fires an edit page's initial
  barcode). Clicking a row or Enter also picks. Hands the resolved row to the parent.
- **Add+ (`/catalogue/new`)** — picking a barcode prefills weight, purity, item name, stores `party_id`
  and (from the piece's status) `stock_status`/`is_sold`. Warns if the barcode is already a card.
- **Attach on edit (`/catalogue/[id]`)** — same field; **overwrites** weight & purity from the scanned
  piece (the point of attaching a real barcode to a dummy/placeholder product), and overwrites the name
  only when the item type is mapped (else keeps it and learns on save). Records `party_id`. Warns if
  another product owns the barcode.
- **Learn-on-save** — on both pages, if the picked `itm_id` had no clean name (or the salesman changed
  it), the chosen name is upserted into `wa_item_name_map` as `source='manual'`, so it prefills next time.

### Multi-photo publishing (gallery)
A product can publish **several photos** to the customer app, not just the primary.
Each photo has an **`in_app`** flag (migration `wa_027`); the product page shows a
per-photo **+ Publish / ✓ In app** toggle. The published gallery = photos where
`in_app OR is_primary`, **primary first** then `sort_order` (so the primary is always
included — a published product can never have an empty gallery). `catalogue-sync`
builds `images: string[]` (each `display_url ?? image_url`) plus the cover
`image`/`thumb`. The customer app (`mnap-customer`) reads `images` and opens
`components/PhotoViewer.tsx` (full-screen swipeable gallery) when the product photo is
tapped; old docs without `images` fall back to `[image]`.
- Image helpers live in `lib/image.ts`: `centerCrop()`, `renderCrop()`, `CROP_RATIO` (4/5).
- **Migration:** `supabase/migrations/wa_026_image_crop.sql` adds `display_url`,
  `display_thumb_url`, `crop` to `wa_product_images` (all nullable; legacy rows fall
  back to `image_url`, shown inside a 4:5 CSS box).
- **Env (Vercel + `.env.local`):** `FIREBASE_SERVICE_ACCOUNT_KEY` = full JSON of a
  `mnap-customer` service-account key (Firebase console → Project settings → Service
  accounts → Generate new private key). Server-only; never exposed to the browser.

### Two-way inbox — inbound media & message rendering
The chat view (`app/messages/[phone]/page.tsx`) and the inbound webhook
(`app/api/whatsapp/webhook/route.ts`) share the `wa_messages` row.
- **Day dividers:** messages are grouped by day with WhatsApp-style chips
  (**Today / Yesterday / "24 Jul 2026"**); each bubble itself shows the time only.
- **Clickable links:** `http(s)://…` URLs in a message body are auto-linkified
  (`linkify()`), trailing sentence punctuation kept out of the href.
- **Inbound media:** the webhook downloads from Meta → stores in Supabase Storage
  `wa-media` (`inbound/…`) → `wa_messages.media_url`, for **image, video, document,
  and voice/audio** (was image-only before). `message_type` (wa_006) already allows all
  of these — no migration. Bubbles render `<img>` (tap = open), `<video controls>`,
  `<audio controls>`, or a document download link; a missing `media_url` shows a
  placeholder. Thread previews use 📷/🎥/📄/🎤 prefixes.
- **Not yet built:** quoted-reply display (inbound `context.id` is captured only for
  audience-step attribution, `recordStepReply`) and staff outbound reply-to a specific
  message.

---

## 3. Two-Module Architecture

MNAP Connect serves two behaviorally distinct customer types. They are separate modules and must not be conflated.

| | Type A | Type B |
|---|---|---|
| **Model** | Broadcasting | Behavioral CRM |
| **Customer DB** | `wa_customers` | `wa_b_customers` |
| **Module** | Send (existing, `/send`) | Prospects + Interventions (`/prospects`) |
| **Communication** | Daily commodity update | Contextual, segment-driven |
| **Targeting** | Same message, all customers | Personalized by segment |
| **Salesman role** | Tap send, done | Profile, follow up, nudge |
| **Enrollment** | `/customers/new` or `/enroll` | `/prospects/new` |
| **Admin** | `/admin/topics`, `/admin/templates` | `/admin/segments` |

**Phone uniqueness:** Each table enforces phone uniqueness within itself. The app warns if a phone being enrolled in Type B already exists in Type A. Full merge of the two tables is a future consideration.

**Merging is a future decision.** Do not conflate the two modules.

---

## 4. Database Schema — Type A (Broadcasting)

All tables prefixed `wa_`. All have Row Level Security enabled. Migration: `wa_001_initial_schema.sql`.

---

### `wa_interest_topics`
Master list of interest categories and sub-topics. Two levels only.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Auto-generated |
| `name` | TEXT NOT NULL | e.g. "Daily Rates", "Necklaces" |
| `parent_id` | UUID → wa_interest_topics, nullable | NULL = top-level; set = sub-topic |
| `sort_order` | INT DEFAULT 0 | Display order |
| `is_active` | BOOLEAN DEFAULT TRUE | Inactive = hidden from filters and enrollment |
| `created_at` | TIMESTAMPTZ | — |

---

### `wa_customers`
One record per Type A customer.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | — |
| `name` | TEXT NOT NULL | — |
| `phone` | TEXT NOT NULL UNIQUE | 10-digit, no country code |
| `enrolled_via` | TEXT | 'salesman' or 'self' |
| `enrolled_by` | UUID → profiles, nullable | Null if self-enrolled |
| `is_active` | BOOLEAN DEFAULT TRUE | Soft-delete |
| `is_opted_out` | BOOLEAN DEFAULT FALSE | Opt-out flag |
| `opted_out_at` | TIMESTAMPTZ, nullable | — |
| `opted_out_by` | UUID → profiles, nullable | — |
| `notes` | TEXT, nullable | Salesman's private note |
| `created_at` | TIMESTAMPTZ | — |

---

### `wa_customer_interests`
Junction table — which topics each Type A customer is interested in.

| Column | Type | Notes |
|--------|------|-------|
| `customer_id` | UUID → wa_customers CASCADE | — |
| `topic_id` | UUID → wa_interest_topics CASCADE | — |
| `created_at` | TIMESTAMPTZ | — |

**PK:** `(customer_id, topic_id)`

---

### `wa_message_templates`
Pre-written message templates for the send module.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | — |
| `topic_id` | UUID → wa_interest_topics, nullable | NULL = general template |
| `name` | TEXT NOT NULL | Internal label |
| `body_text` | TEXT NOT NULL | Supports `{name}`, `{rate_24kt}`, `{rate_22kt}`, `{rate_18kt}` |
| `is_active` | BOOLEAN DEFAULT TRUE | — |
| `created_at` | TIMESTAMPTZ | — |
| `created_by` | UUID → profiles | — |

**Supported placeholders (all live):**
- `{name}` → customer's name
- `{rate_24kt}` → today's 24KT rate from `daily_rates` (auto-fetched at send time)
- `{rate_22kt}` → today's 22KT rate
- `{rate_18kt}` → today's 18KT rate

---

### `wa_communication_log`
Immutable record of every message sent via the Type A send module.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | — |
| `customer_id` | UUID → wa_customers | — |
| `template_id` | UUID → wa_message_templates, nullable | — |
| `topic_id` | UUID → wa_interest_topics, nullable | Filter active at send time |
| `message_sent` | TEXT NOT NULL | Verbatim final message after all substitution and edits |
| `sent_by` | UUID → profiles | — |
| `sent_at` | TIMESTAMPTZ DEFAULT NOW() | — |

**Log is created on "Open WhatsApp" tap — optimistic. Cannot confirm the salesman pressed Send in WhatsApp.**

---

## 5. Database Schema — Type B (Intervention CRM)

Five tables. All prefixed `wa_b_`. All have Row Level Security enabled. Migration: `wa_003_intervention_schema.sql`.

---

### `wa_b_customers`
Basic customer record for Type B. Separate from `wa_customers`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | — |
| `name` | TEXT NOT NULL | — |
| `phone` | TEXT NOT NULL UNIQUE | Unique within this table |
| `enrolled_by` | UUID NOT NULL → profiles | Salesman who enrolled |
| `is_active` | BOOLEAN DEFAULT TRUE | — |
| `notes` | TEXT, nullable | Salesman's private note |
| `created_at` | TIMESTAMPTZ | — |

---

### `wa_b_profiles`
All profiling answers. One row per customer (1:1). Fields are nullable — progressive form, not everything filled at enrollment.

**Required core fields:**
`buying_occasion`, `purchase_stage`, `budget_range`, `purchase_behavior`, `contact_source`, `competitor_association`

**Section A — Product affinity:**
`product_interests` (TEXT[]), `style_preference`

**Section B — Timeline & triggers:**
`purchase_timing`, `notification_interests` (TEXT[])

**Section C — Scheme (signal only — no financial detail):**
`has_scheme` (BOOLEAN), `scheme_with`, `scheme_type`

**Section D — Competitor detail:**
`competitor_type`, `competitor_draw` (TEXT[])

**Section E — Relationship temperature (observed, not self-reported):**
`engagement_signals` (TEXT[]), `purchase_history`

**Section F — Occasion detail:**
`occasion_detail` (TEXT — free text), `purchase_for`

**VIP (manual assignment):**
`is_vip` (BOOLEAN), `vip_sub_type`, `vip_assigned_by`, `vip_assigned_at`

**Meta:**
`last_updated_at`, `updated_by`

---

### `wa_b_segment_assignments`
One row per segment assignment, current and historical. Full audit trail.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | — |
| `customer_id` | UUID → wa_b_customers CASCADE | — |
| `primary_segment` | TEXT NOT NULL | Segment name |
| `reason` | TEXT NOT NULL | Plain English: why this segment was assigned |
| `assigned_by` | TEXT NOT NULL | 'system' or salesman UUID |
| `assigned_at` | TIMESTAMPTZ | — |
| `is_current` | BOOLEAN DEFAULT TRUE | Only one current row per customer (enforced by unique index) |

**When segment changes:** old row set `is_current = false`, new row inserted. History preserved.

---

### `wa_b_segment_tags`
Secondary tags per customer. One row per active tag.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | — |
| `customer_id` | UUID → wa_b_customers CASCADE | — |
| `tag` | TEXT NOT NULL | Tag name |
| `applied_by` | TEXT NOT NULL | 'system' or salesman UUID |
| `applied_at` | TIMESTAMPTZ | — |
| `is_active` | BOOLEAN DEFAULT TRUE | No duplicate active tags per customer (unique index) |

---

### `wa_b_interactions`
Salesman logs every touchpoint with a Type B customer. Feeds dormant detection and journey triggers.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | — |
| `customer_id` | UUID → wa_b_customers CASCADE | — |
| `interaction_type` | TEXT NOT NULL | 'whatsapp' / 'call' / 'store_visit' / 'note' |
| `notes` | TEXT, nullable | — |
| `logged_by` | UUID NOT NULL → profiles | — |
| `interaction_date` | DATE NOT NULL | When it actually happened (salesman may log retroactively) |
| `logged_at` | TIMESTAMPTZ | When it was recorded in the app |

---

## 6. Type A — Business Rules & Logic

### Customer Enrollment
- Phone number is the unique identifier
- Salesman enrollment: requires login; captures `enrolled_by`
- Self-enrollment: public `/enroll` page, no login; `enrolled_by = null`
- Interests selected at enrollment; editable from customer profile
- At least one interest required to enroll

### Who Appears in the Send Module
- Only `is_opted_out = false` AND `is_active = true`
- Topic filter active: only customers with that `topic_id` in `wa_customer_interests`
- "All" filter: all non-opted-out, active customers

### Default Filter
Send module defaults to "Daily Rates" filter on first load (finds the topic named "Daily Rates" from loaded topics, falls back to "All" if not found).

---

## 7. Type A — Send Module

**Default filter:** Daily Rates.

**Send flow:**
1. Salesman picks a topic filter
2. Taps Send on a customer
3. If already sent today for this filter → confirmation dialog to resend
4. 1 template for topic → auto-loads; multiple → picker sheet
5. Preview screen → optional inline edit → Open WhatsApp → log created

**Grey-out logic:** Send button greys out only after "Open WhatsApp" is tapped (log entry created). Optimistic state update — no reload needed.

**Preview screen:**
- Full substituted message shown in green bubble
- Edit button toggles bubble to editable textarea — salesman can tweak before sending
- Edited text is what gets URL-encoded and logged
- "← Change Message" goes back to template picker

**Rate status pill:** Green if today's rates loaded; amber warning if not yet synced from `daily_rates` table.

---

## 8. Type A — Template System

- One topic → many templates; one template → one topic (or general)
- Admin page: `/admin/templates`
- Placeholder chips insert `{name}`, `{rate_24kt}`, `{rate_22kt}`, `{rate_18kt}` at cursor position
- Preview shows sample rates (9850/9025/7380) with disclaimer
- Actual rates fetched from `daily_rates` at send time

**`applyPlaceholders(template, customerName, todayRates)`** — in `lib/utils.ts`. Formats rates `en-IN` with 2 decimal places; `—` if rate unavailable.

---

## 9. Type A — Opt-Out Rules

| Scenario | Behaviour |
|----------|-----------|
| Salesman marks opt-out | `is_opted_out = true`, `opted_out_at`, `opted_out_by` set |
| Send module | Opted-out customers excluded |
| Customer list `/customers` | Visible with "Opted Out" badge |
| Communication history | Preserved |
| Re-enable | Admin toggles from customer profile |
| Self-enroll while opted out | Re-subscribe option shown |

---

## 10. Type B — Segmentation Engine

**File:** `lib/segmentation.ts`

**Function:** `computeSegment(profile: WaBProfile): SegmentResult`

Returns: `{ primarySegment, reason, tags }`

- Pure function — no DB calls, no side effects
- Runs client-side in the browser on profile save
- Result saved to `wa_b_segment_assignments` and `wa_b_segment_tags`
- Re-runs whenever profile is updated — segment auto-updates

### Priority Order (first matching rule wins)

| Priority | Segment | Rule summary |
|---|---|---|
| 0 | VIP / Relationship Customer | `is_vip = true` — manual override, highest priority |
| 1 | Competitor Acquisition | Competitor association ≠ no AND stage ≠ exploring |
| 2 | Hot Buyer | Stage = planning/ready + near timeline + engagement signals |
| 3 | Bridal Journey | Occasion = wedding + bridal interest or buying for self/partner |
| 4 | Scheme Customer | Behavior = scheme/SIP or has active scheme |
| 5 | Social Media Lead | Source = social media + exploring/comparing + no hot signals |
| 6 | Rate Sensitive | Behavior = waiting for rates/exchange + no scheme + no competitor |
| 7 | Festival & Occasion Buyer | Occasion = festival/gift/family + not just browsing |
| 8 | Daily Wear Explorer | Lightweight interest + exploring stage + lower budget |
| 9 | Unqualified Prospect | Default — insufficient data |

### Key Conflict Rules
- **Festival beats Rate Sensitive** — occasion has a deadline and an emotion
- **Scheme Customer beats Rate Sensitive** — the scheme already manages rate exposure
- **Competitor Acquisition overrides all except VIP** — requires different intervention tone
- **Hot Social Media Lead** — if source = social media but hot signals present, re-evaluate without Rule 5 → promotes to natural segment immediately

### Secondary Tags (additive, any combination)

| Tag | Condition |
|---|---|
| Discount Seeker | Engagement signal = discount_focused |
| Rate Sensitive | Behavior = waiting_rates OR notification includes rate_alerts |
| Exchange Candidate | Behavior = exchange |
| Scheme Candidate | Behavior = scheme but not primary Scheme Customer segment; also: Bridal + no scheme |
| Diamond Interest | Product interests include diamond |
| High Value | Budget = above_2l |
| Competitor Flag | Any competitor association |
| Social Origin | Source = social_media |
| New Arrival Subscriber | Product affinity selected + notification includes new_arrivals |
| Bridal Adjacent | Gift/family occasion + purchase for partner/child |
| Dormant | Days since last contact ≥ threshold (time-applied, not enrollment-applied) |

### Dormant Thresholds

| Segments | Dormant after |
|---|---|
| Hot Buyer | 30 days |
| Bridal Journey, Rate Sensitive, Scheme Customer, Festival & Occasion, VIP | 60 days |
| Daily Wear Explorer, Social Media Lead, Competitor Acquisition, Unqualified Prospect | 90 days |

### Rate Alert Threshold
₹300/gram drop from monthly average = major drop → triggers Rate Sensitive + Exchange Candidate alerts.

---

## 11. Type B — Profiling Form

**Page:** `/prospects/new`

**Philosophy:** Signal capture, not staged forms. The form adapts to the conversation. Any section can be opened at any time.

### Required Core (always visible, must complete to enroll)
1. Name, phone, notes
2. Buying occasion — 6 options
3. Purchase stage — 4 options
4. Budget range — 4 options
5. Purchase behavior — 4 options
6. First contact source — 5 options
7. Competitor association — 4 options (collected at core — overrides all segment logic)

### Expandable Sections

| Section | Auto-opens when | Can manually open |
|---|---|---|
| Product Interest | Stage = planning or ready | Always |
| Timeline & Communication | Stage = planning/ready OR budget = above_2l | Always |
| Scheme Details | Purchase behavior = scheme | Always |
| Competitor Details | Competitor association ≠ no | Always |
| Engagement Signals | Never auto | Always |
| Occasion Details | Occasion = wedding/festival/gift/family | Always |
| VIP Assignment | Never auto | Always |

**Auto-open sections** show an "auto" label. Incomplete profiles are allowed — system flags them for completion on next interaction.

### VIP Assignment
- Manual only — salesman explicitly marks VIP
- Two sub-types: **Long-time Loyalist** (years of exclusive trust) or **New Exclusive Customer** (recently committed)
- Overrides all automated segment rules
- Logged with salesman ID and timestamp

---

## 12. Type B — Segment Definitions

### VIP / Relationship Customer
Manual assignment. Two sub-types:
- **Long-time Loyalist** — years of exclusive trust; concierge-feel interventions; make them feel remembered
- **New Exclusive Customer** — recently committed exclusively; reinforce their choice; build toward long-term loyalty

### Competitor Acquisition
Competitor association any loyalty level + purchase stage beyond exploring. Goal: build trust, never sell directly. Rate intelligence as neutral touchpoint. Long game.

### Hot Buyer
Stage = planning/ready + near timeline + engagement signals. Highest dashboard priority. Personal follow-up, appointment nudges.

### Bridal Journey
Wedding occasion. Budget does NOT define this segment — a ₹40k lightweight bridal customer is as valid as a ₹2L+ one. All messaging leads with lightweight as an elegant choice, not a compromise.
- With scheme → Bridal Journey, scheme noted
- Without scheme → Bridal Journey + Scheme Candidate tag; early intervention promotes scheme as a funding tool

### Scheme Customer
Behavior = scheme/SIP or has active scheme. Scheme is a signal only — no financial detail tracked. Three fields: has_scheme, scheme_with, scheme_type.

### Social Media Lead
Transitional segment. Source = social media + exploring/comparing + no strong signals.
- Cold track: Day 1 trust intro → Day 3–5 design showcase → Day 10 soft follow-up → graduate on signals
- Hot track: shows buying signals immediately → promote to natural segment at once; keep Social Origin tag

### Rate Sensitive
Behavior = waiting for rates or exchange + no scheme + no competitor. Rate drop ≥ ₹300/gram from monthly average triggers alert.

### Festival & Occasion Buyer
Festival/gift/family occasion + not just browsing. Beats Rate Sensitive when both signals present.

### Daily Wear Explorer
Lightweight/daily wear interest + exploring/comparing stage + lower budget. Soft brand presence, no pressure.

### Unqualified Prospect
Default. Insufficient profile data. Flagged for completion within 7 days.

---

## 13. Page Structure

### Type A (Broadcasting)
| Page | Auth | Who |
|------|------|-----|
| `/send` | Yes | Salesman — daily rate send module (default landing) |
| `/customers` | Yes | Salesman — Type A customer list |
| `/customers/new` | Yes | Salesman — enroll Type A customer |
| `/customers/[id]` | Yes | Salesman — profile, interests, history, opt-out |
| `/enroll` | No | Customers — public self-enroll |
| `/enroll/success` | No | Customers — confirmation |
| `/admin/topics` | Yes | Admin — interest topic CRUD |
| `/admin/templates` | Yes | Admin — message template CRUD |

### Type B (Intervention CRM)
| Page | Auth | Who |
|------|------|-----|
| `/prospects` | Yes | Salesman — Type B customer list, filterable by segment |
| `/prospects/new` | Yes | Salesman — flexible profiling enrollment form |
| `/prospects/[id]` | Yes | Salesman — profile, segment reason, tags, interaction log, segment history; has Edit button |
| `/prospects/[id]/edit` | Yes | Salesman — update profiling answers; segment auto-reassigns on save |
| `/admin/segments` | Yes | Admin — segment overview, completeness audit, customer drill-down, rules reference |

### Navigation (Bottom Tab Bar) — current
Messages · Send · Customers · Catalogue · Templates · **More**
(More popup: Purchase · Prospects · Topics · Segments). See `ENGAGEMENT_SYSTEM.md` §6.5.

---

## 14. Data Flows

### Type A — Salesman Sends a Message
```
1. Open app → /send, default filter = Daily Rates
2. Tap a topic filter chip
3. Tap [Send →] on a customer
4. If already sent today → resend confirmation
5. Template resolution:
   - 1 template → auto-load
   - Multiple → picker sheet
6. Preview screen → optional inline edit
7. Tap "Open WhatsApp" → wa.me link opens
8. Log entry created in wa_communication_log
9. Send button greys out (optimistic update)
10. Salesman presses Send in WhatsApp → returns to app
```

### Type A — Customer Self-Enrolls
```
1. Customer opens /enroll
2. Enters name, phone, selects interests
3. Submit:
   - New phone → INSERT wa_customers + wa_customer_interests
   - Existing + not opted out → UPDATE interests
   - Existing + opted out → re-subscribe prompt
4. Redirect to /enroll/success
```

### Type B — Salesman Enrolls a Prospect
```
1. Open /prospects/new
2. Fill required core (6 questions minimum)
3. Additional sections open automatically based on signals
4. Any section can be manually opened to capture real-time signals
5. Tap "Enroll & Assign Segment"
6. Client-side: computeSegment(profile) runs → returns primarySegment + reason + tags
7. INSERT wa_b_customers
8. INSERT wa_b_profiles
9. INSERT wa_b_segment_assignments (is_current = true)
10. INSERT wa_b_segment_tags (one row per tag)
11. Redirect to /prospects/[id]
```

### Type B — Admin Reviews Segment Quality
```
1. Open /admin/segments
2. See all segments with customer counts and avg profile completeness
3. Tap a segment → see all customers in it
4. Per customer: name, segment reason, tags, completeness %, enrolled date
5. Tap customer → open full profile with audit trail
6. Review segment reason ("Placed in Bridal Journey because: …")
7. Check segment history — every past assignment with reason and timestamp
```

### Type B — Profile Update Triggers Segment Reassignment
```
1. Salesman opens /prospects/[id] → taps Edit button
2. /prospects/[id]/edit loads with all existing profiling answers pre-filled
3. Sections that already had data auto-open so salesman sees what's filled
4. Salesman updates any field (name, notes, or any profiling answer)
5. Tap "Save & Reassign Segment":
   a. UPDATE wa_b_customers (name, notes)
   b. UPSERT wa_b_profiles (all profiling fields)
   c. computeSegment(updatedProfile) runs client-side
   d. Compare result to current segment:
      - Changed: UPDATE old row is_current=false → INSERT new assignment row
      - Same: UPDATE reason on existing row (signals may have shifted)
   e. DELETE all wa_b_segment_tags for customer → INSERT fresh tag set
6. Redirect to /prospects/[id]
7. Segment history on profile page shows the change with timestamp
```
**Tag refresh note:** Tags are delete-then-insert (not deactivate/upsert) because the partial unique index on `wa_b_segment_tags (customer_id, tag) WHERE is_active = TRUE` doesn't support upsert after deactivation.

---

## 15. WhatsApp Link Format

```
https://wa.me/91{phone}?text={url_encoded_message}
```

| Part | Detail |
|------|--------|
| `91` | India country code — always prepended |
| `{phone}` | 10-digit number from `wa_customers.phone` |
| `{url_encoded_message}` | `encodeURIComponent(final_message)` |
| Opens in | WhatsApp Business app (if installed) |
| Message status | Prefilled in chat compose box — salesman still presses Send |

---

## 16. Key Source Files

| File | Purpose |
|------|---------|
| `lib/types/index.ts` | All TypeScript interfaces — Type A and Type B |
| `lib/utils.ts` | `applyPlaceholders`, `buildWhatsAppUrl`, `formatDate`, `formatDateTime` |
| `lib/segmentation.ts` | `computeSegment()` — pure segmentation engine; `SEGMENTS`, `SEGMENT_COLORS`, `SEGMENT_DORMANT_DAYS` |
| `lib/supabase/client.ts` | Browser Supabase client |
| `lib/supabase/server.ts` | Server Supabase client (used in middleware) |
| `middleware.ts` | Auth guard — redirects unauthenticated users; excludes `/enroll` |
| `app/globals.css` | Global styles — `.input`, `.btn-primary`, `.btn-secondary`, `.card`, `.no-scrollbar`, `.pb-safe` |
| `components/ui/Navbar.tsx` | Top bar + bottom tab bar navigation |
| `supabase/migrations/wa_001_initial_schema.sql` | Type A tables + RLS |
| `supabase/migrations/wa_002_seed_topics.sql` | Default interest topics seed |
| `supabase/migrations/wa_003_intervention_schema.sql` | Type B tables + RLS |
| `supabase/migrations/wa_026_image_crop.sql` | 4:5 crop cols on `wa_product_images` (`display_url`, `display_thumb_url`, `crop`) |
| `supabase/migrations/wa_027_image_in_app.sql` | `in_app` flag on `wa_product_images` for multi-photo publishing (backfills `is_primary`→`in_app`) |
| `supabase/migrations/wa_056_app_interest_topic.sql` | Seeds the **App Product Interest** topic (key `app_interest`) so piece-interest chats are tagged like offers/designs |
| `supabase/migrations/wa_057_catalogue_only.sql` | Adds `wa_products.is_catalogue_only` (design-only products, excluded from inventory); backfills all no-barcode products to catalogue |
| `supabase/migrations/wa_058_inventory_import.sql` | `wa_inventory` master table; `wa_products.stock_status`/`party_id`/`design_code` (+ auto-assign trigger, backfill); XMNAP barcodes for catalogue-only pieces |
| `supabase/migrations/wa_059_inventory_maps.sql` | `wa_item_name_map` (ITM_ID→clean name, majority-vote/manual) + `wa_purity_map` (raw→clean, 4 seeds); review views `wa_inventory_items`/`wa_inventory_purities` |
| `INTERVENTION_STRATEGY.md` | Full business rules, segment definitions, profiling architecture |
| `INTERVENTION_MODULE_DISCUSSION.md` | Session-by-session decision log |

---

## 17. Build Phases

### Phase 1 — Type A Core ✅ Complete
- [x] Next.js project setup
- [x] Type A DB schema + RLS (`wa_001`)
- [x] Default topic seed (`wa_002`)
- [x] Auth — login, middleware
- [x] Interest Topic Master (`/admin/topics`)
- [x] Template Master (`/admin/templates`) — placeholder chips, preview
- [x] Customer enrollment (`/customers/new`)
- [x] Customer list (`/customers`)
- [x] Customer profile (`/customers/[id]`) — interests, history, opt-out
- [x] Send Module (`/send`) — filter chips, grey-out, preview, inline edit, wa.me link, log
- [x] Self-enroll (`/enroll`) — duplicate phone handling
- [x] Opt-out flow

### Phase 2 — Rate Integration ✅ Complete
- [x] Auto-fetch today's rates from `daily_rates` (shared Supabase)
- [x] `{rate_24kt}`, `{rate_22kt}`, `{rate_18kt}` placeholder support
- [x] Rate status pill on Send module
- [x] Default filter = Daily Rates
- [ ] Rate template quick-action (one-tap from customer card)

### Phase 3 — Type B Intervention Module ✅ Complete (data layer)
- [x] Type B DB schema (`wa_003`) — 5 tables
- [x] TypeScript types for all Type B entities
- [x] Segmentation engine (`lib/segmentation.ts`) — 9 segments + rules
- [x] Prospect enrollment form (`/prospects/new`) — flexible, signal-responsive
- [x] Prospects list (`/prospects`) — filterable by segment
- [x] Prospect profile (`/prospects/[id]`) — profile, tags, interaction log, segment history
- [x] Admin segment visibility (`/admin/segments`) — counts, completeness, drill-down, rules reference
- [x] Navbar updated — Prospects + Segments tabs
- [x] Profile edit page (`/prospects/[id]/edit`) — update profiling answers, segment auto-reassigns on save, tag set refreshed
- [ ] Communication planning — journey-based + strategized campaign modules

### Phase 4 — Type B Communication (Planned)
Two communication types to build:
- **Journey communication** — individual trigger-based (scheme maturity, dormant, occasion approaching)
- **Strategized communication** — segment-level planned campaigns (admin selects segment, writes message, schedules send)

### Phase 5 — Broadcast (Requires WhatsApp Business API)
- [ ] Bulk send to segment
- [ ] API provider integration (AiSensy / WATI / Interakt)
- [ ] Delivery status tracking

---

## 18. Future Roadmap

| Feature | Notes |
|---------|-------|
| Journey communication triggers | Time-based, behavior-based, market-based, occasion-based |
| Strategized campaign builder | Admin selects segment, writes or picks template, schedules |
| Salesman daily dashboard | "Today's Recommended Actions" — surfaces who to contact, why, what to say |
| Rate drop alert engine | Monitor `daily_rates`; alert Rate Sensitive + Exchange Candidate when drop ≥ ₹300/gram |
| Photo sharing | ✅ **Done** — real WhatsApp API; inbox image send + product Share (`ENGAGEMENT_SYSTEM.md` §6.1) |
| Broadcast | ✅ **Done** — topic-segment broadcast + thank-you-for-purchase (`ENGAGEMENT_SYSTEM.md` §1, §4.1) |
| Product catalog integration | ✅ **Done** — full Catalogue / Inventory / Purchase plan (`ENGAGEMENT_SYSTEM.md` §6) |
| QR code generator | Auto-generate QR for `/enroll` URL — print on receipts |
| Merge Type A + Type B | Unified customer view — future, once both modules are stable |

---

## 18A. Cold-Call Marker-Validation Module (`wa_028`, live 2026-07-14)

Salesmen cold-call sales-derived "lost leads" and log structured feedback. Feeds three loops: tune pipeline thresholds, ad-audience hygiene, reactivation playbook.

**Data path (CSV bridge):** `customer-signals` pipeline → `leads_import.csv` → **Call Control import** → `wa_b_customers` (+`source='sales_import'`) + `wa_b_markers` → calling deck → outcomes logged → **feedback CSV export** → pipeline `apply_call_feedback()` → call-level markers.

**Tables:** `wa_b_markers` (imported marker snapshot: recency/value/rfm/frequency tiers, audience_labels[], lifetime_value, total_bills, days_since_last_purchase, is_high_value, is_likely_wedding, primary_metal, outreach_bucket, **last_purchase_date** (`wa_029`), markers JSONB) · `wa_b_call_campaigns` (name, filter_json) · `wa_b_call_tasks` (queue: pending/done/hidden, attempts) · `wa_b_call_logs` (success, topics[], intent, notes). Triggers auto-bump attempts and flip task status (done / hidden+DNC) on outcome. `wa_b_customers` gained `source`, `is_do_not_call`, `dnc_at`.

**Screens:** `/admin/calls` (Call Control — import, full marker + **interest** filter campaign builder, live DB count, signals sync/export) · `/calls` (salesman deck — one card at a time, tap-to-call, markers + converged interests + last-purchase date, Success→topics→intent, per-card three-dot **"Don't call"**, **editable history of last 100 calls**, search, hidden list) · `/admin/calls/report` (range summary, drill-down, feedback CSV). Routes under `/api/calls/*`.

**Outcome model:** Success/Fail → topics[] (rate/designs/offers/booking) → intent (will_come/not_sure/wont_come/dont_call). dont_call → DNC + hidden (**calling-only exclusion — never suppresses seeding or other modules**).

**Call suppression rules (`wa_044`, live) — one source of truth in `lib/calls.ts`:**
- **R1 the wait — outcome-dependent (revised `wa_048`, 2026-07-19).** How long a card stays away depends on what happened on the **most recent** call: **didn't connect → 4 days** (`CALL_COOLDOWN_DAYS`); **connected and they said `will_come` → 4 days** (hot lead, deliberately stays reachable); **connected, any other outcome → 30 days** (`CONNECTED_COOLDOWN_DAYS`) — we already had the conversation. A **pending** log (Call tapped, outcome never saved) counts as an attempt and takes the short wait, so an unfinished card can't re-serve immediately.
  - **Stored, not re-derived.** The date lands on `wa_b_customers.call_snooze_until`, computed by trigger from the latest call log; every deck asks only `call_snooze_until IS NULL OR <= today`. Three decks encoding the same branching is how they drift apart. Recomputed (never incremented) so correcting an outcome from Fail to Success re-derives the wait on the spot.
  - The numbers live in `lib/calls.ts` **and** `wa_b_call_snooze_days()` in `wa_048` — twins that must be changed together. `callSnoozeDays()` is the TypeScript copy, so the app can explain a wait without a round trip.
  - Backfilled over all history, so the **live winback campaign obeys the new waits immediately**.
  - Superseded: the flat 2-day cooldown from `wa_044`. The task-level `last_attempt_date < callCooldownCutoff()` check remains as a safety net and agrees by construction.
- **R2 unreachable — `MAX_FAILED_CALL_ATTEMPTS = 4`.** A customer with **≥ 4 disconnects** drops out of every calling deck. **Disconnects only** = `wa_b_call_logs.success = FALSE`; a **pending** log (`success IS NULL` — Call tapped, outcome not yet submitted) never counts, so an unfinished card can't suppress anyone.
- **Mechanism:** `wa_b_customers.failed_call_attempts`, recomputed from the logs by trigger on every insert/update/delete (self-healing — editing Fail→Success decrements) and backfilled from all history, so the **live winback campaign obeys it immediately**.
- **Applied at both ends:** the deck query (`/calls`), audience **call activation**, and Call Control's builder (preview count = what the salesman sees). **Non-destructive** — no rows deleted, no task status rewritten; raise the threshold and they come back. They stay reachable on chat/ads via audience **A5 `callUnresponsive`**.

## 18B. Unified Interest Signals (`wa_030`, applied 2026-07-15)

One phone-keyed layer converging interest signals from **all sources** onto one canonical taxonomy — crossing the Type A / Type B split (which are separate tables joined only by phone).

**Table:** `wa_signals(phone, interest, source, weight, evidence, last_seen)`, UNIQUE(phone, interest, source). **Taxonomy** (`lib/signals.ts`): engagement (rate/designs/offers/scheme/exchange/cash/repair/**app_interest**) · product (necklace/ring/bangles/earrings/chain/mangalsutra/pendant/bracelet/anklet/investment) · metal (gold/silver/diamond).

**App Product Interest tag (`wa_056`, 2026-07-31):** the chatbot detects a piece-interest message — the customer shared a `gold.mnalankarpalace.com` product link or said "interested" (`isAppProductInterest`) — and now tags the **App Product Interest** topic (canonical key `app_interest`, engagement group) in `handleAppProductInterest`, exactly like offers/designs/rate do. So besides raising the `contacts.app_product_interest` flag (wa_053) and logging a lead, it writes `wa_customer_interests` and mirrors into `wa_signals` (source `whatsapp`) — surfacing the customer in the chat "Interested in" banner + Assign-interests sheet and making them targetable in Reach as the "App Enquiry" interest chip. `tagTopic('%app product interest%')` no-ops until the wa_056 topic row exists.

**Sources → signals:** `sales` ← `wa_b_markers.markers` (bought_*/buys_*/primary_metal) · `whatsapp` ← `wa_customer_interests` + `wa_lead_captures` (webhook `addInterest()` mirrors live) · `call` ← `wa_b_call_logs.topics` · `billing` ← reserved (Step 4 POS tags).

**Canonical topic taxonomy (`wa_033`, 2026-07-16):** `wa_interest_topics` is now the single source of truth. Each row carries `key` (canonical interest slug), `topic_group` ('engagement'|'product'|'metal'|'system'), `is_callable` (the four the call screen offers: rate/designs/offers/scheme). Chat enrollment, chatbot nodes, and lead captures now derive their interest from **`topic.key`** — the name-regex `topicNameToInterest`/`TOPIC_RULES` is **deleted**. Metals added as topic rows so every `wa_signals.interest` key has a canonical row. System topics (Purchased/Consent/Thank you) have `key=NULL` and are excluded from signals. The explicit `CALL_TOPIC_TO_INTEREST` alias (booking→scheme) is kept (controlled, not regex). Webhook `addInterest` reads `topic.key` inside try/catch (never breaks a reply). **After applying wa_033, run Signals → Sync once** to rebuild deterministically (parity with the old regex, so no data churn).

**Ingestion:** import route writes sales signals; `/calls` success writes call signals; webhook writes whatsapp signals. `POST /api/signals/sync` = idempotent backfill from all sources.

## 18D. Contact Spine + Customer Book (`wa_034`, 2026-07-16)

**One profile per phone**, unifying Type A (chat/`wa_customers`) and Type B (sales+calls/`wa_b_customers`). Table `contacts(phone UNIQUE, chat_name, billing_name, name, name_override, wa_customer_id, wa_b_customer_id, from_chat, from_sales, chat_opted_out, call_opted_out, manual_opted_out (`wa_037`), is_opted_out GENERATED (chat_opted_out OR call_opted_out OR manual_opted_out), …)`.

- **Kept in sync by triggers** (`sync_contact_from_wa_customers` / `_wa_b_customers`), `AFTER INSERT OR UPDATE OF name/phone/dnd|is_do_not_call`. So enroll, **inbound-chat auto-add**, STOP, sales import, and DNC all reflect into `contacts` with **no app changes**. Functions are `SECURITY DEFINER` (client-side enroll can write) and swallow errors (a contacts hiccup can never roll back a chat reply/enroll). One-time bulk backfill included in the migration.
- **Unified consent:** `is_opted_out` = chat STOP (`wa_customers.dnd`) OR call DNC (`wa_b_customers.is_do_not_call`) OR **manual** (`contacts.manual_opted_out`, `wa_037` — set by the Customer Book 3-dot "Opt out of all comms" and mirrored by the calling-card "Don't call" via `call_opted_out`). One flag; every send path (`reach/send`, `campaigns/*`, thank-you, `lib/reach/dispatch`) gates on it, and the `call_feedback.csv` export mirrors it (`is_do_not_call` column, 2026-07-17). It's a **messaging** opt-out (WhatsApp + call) — not an ad-suppression flag. The **legacy enroll opt-in/opt-out (`wa_customers.is_opted_out`) is intentionally ignored** — not yet physically cleared (deferred to the consent phase, since the old broadcast still reads it until it's retired).
- **Display name:** billing preferred, else chat, never "Unknown" if a real name exists on the other side; `name_override` wins in UI (editable later).
- **Customer Book UI** `/contacts` (the "Customers" primary tab now points here): searchable by name/number, filter All/Active/Opted-out, rows show value tier + last purchase + source dots; tap → `CustomerPeek` (full biography). API `GET /api/contacts?q=&filter=&limit=&offset=`. Old `/customers` pages remain reachable (enroll/detail) but the tab is the unified book.

**Consumers:** `/calls` card "Interested in" chips (per-source colour dots) · `CustomerPeek` interests split by source (chat/call/walk-in/sales/billing) · interest-based campaign filter · `GET /api/signals/export` → `signals_export.csv` for the pipeline → **interest-based Meta/Google audiences** (retargeting + value-based lookalike seeds). Sources now include **`walkin`** (in-store captures) and the taxonomy includes the **occasion** group (`wedding`/`gift`/`festival`); occasion is exported but not yet built into ad audiences ("audience rules v2"). The pipeline documents these as `sig_*` markers in `customer-signals/MARKER_REFERENCE_v2.docx` §13–14. See also `customer-signals/MARKETING_V1_TRACKER.md` §5b/5c and root `MNAP_ECOSYSTEM_OVERVIEW.md`.

---

## 18C. Reach — Unified Cohort Messaging (`wa_032`, Phase 1 — 2026-07-15)

Message **any cohort** assembled from call signals, chat signals, markers, or a pasted number list — with a phone-keyed **send ledger** that prevents paying to send the same template twice.

**Migration `wa_032_reach.sql`:**
- `wa_send_ledger(phone, template_id, meta_template_name, suppression_key, category, status, wa_message_id, campaign_ref, cohort_label, error, sent_by, sent_at)` — one row per send **attempt**, keyed by **phone** (cross-universe: works for the whole call-imported DB, not just Type A). `status ∈ sent|failed|skipped_suppressed|skipped_dnc`. This is the money-guard **and** the funnel/reply-context spine. Indexes: `(phone, suppression_key, sent_at) WHERE status='sent'` (suppression) + `(phone, sent_at)` (history).
- `wa_message_templates` gains `suppression_days` (default 14; **0 = never suppress**, daily rate), `suppression_bucket` (optional shared window across templates), `category` ('daily_rate'|'rate'|'offer'|'thankyou'|'custom').
- `wa_b_markers.first_purchase_date` (pipeline already computes it; exported via `LEAD_HOT_COLUMNS`, stored on import — for the Phase 2 customer peek).

**Suppression rule:** "same message" = same `suppression_key` (= `suppression_bucket` else `template.id`). A phone is skipped (Meta is **never called** → no spend) if it has a `status='sent'` ledger row with that key inside `suppression_days`. Daily-rate templates (0 days) never suppress; `/send` keeps handling those.

**Routes:**
- `POST /api/reach/resolve { filter, templateId }` → resolves the cohort to phones (active filter families **intersected** — marker ⋈ `wa_b_markers`, call-campaign ⋈ `wa_b_call_tasks`, call-log intent/topics/date ⋈ `wa_b_call_logs`, `hotLead`, interests ⋈ `wa_signals`, or a manual `phones` list). Decorates up to 1000 with markers, opt-out flags, prior sends (90d), and `suppressedUntil` for the chosen template.
- `POST /api/reach/send { recipients, templateId, cohortLabel, campaignRef }` → **server re-verifies** DNC (`wa_b_customers.is_do_not_call`) + DND (`wa_customers.dnd`) + suppression, sends the approved template, threads the message (replies land in the inbox), and writes the ledger.

**UI `/reach`** (nav → More → Reach): pick template → build cohort (call/chat/marker chips or paste) → Find recipients → review list (each row shows markers + "Sent before: …" history; suppressed/opted-out rows pre-unchecked) → send to selected. `ReachFilter`/`ReachRecipient` in `lib/types`.

**Scope split (feature audit):** `/send` = fast **daily-rate** tool (no suppression, correct). `/reach` = everything else, 14-day guarded. Respects all opt-outs; first-party only.

**Phase 5 — Campaign funnel (2026-07-16, `wa_036`):**
- **`wa_campaigns`** = one row per Reach/thank-you send run (`cohort_label`, template snapshot, `filter` JSON, and `total`/`sent`/`failed`/`skipped_*` counts). `wa_send_ledger` gains `campaign_id`. `reach/send` creates the run, stamps every ledger row, finalises counts — all **defensive** (if the table isn't there, `campaign_id` is simply omitted, so it deploys before the migration).
- **Funnel** `GET /api/campaigns/detail?id=&source=reach|broadcast`: **sent → delivered → read → replied → converted**. delivered/read from `wa_message_events` (by `wa_message_id`); replied = inbound `wa_messages` after the send; converted = `wa_b_markers.last_purchase_date` within **90 days** after the send. Works for legacy `wa_broadcasts` too (via `broadcast_id`).
- **`GET /api/campaigns`** unifies new runs + legacy broadcasts, newest first. **`/campaigns` page** (Navbar → More): list with sent/failed/suppressed, tap to expand the funnel bars. This folds the old broadcast report into one place.

**Phase 10 — Audience Library foundation (2026-07-17, `wa_040`) — Lead-Gen Phase 1, ✅ COMPLETE:**
- Modular lead-gen engine per `LEADGEN_PHASE1_PLAN.md`. An **audience = a saved, named filter** (`ReachFilter`) over the feature set, materialised into members and reusable across chat/call/ad + one funnel. **This is the foundation only** (data + service + CRUD APIs); UI, calling unification, reports, features, ad-lead loop, and the 21 seeded audiences follow.
- **`wa_040`:** `wa_audiences` (name, description, `filter` JSONB, `is_dynamic` fixed-vs-auto, `is_active`, `is_seeded`, `member_count`, `last_refreshed_at`) + `audience_members` (materialised, UNIQUE(audience_id,phone)) + `audience_id` FK on `wa_campaigns` and `wa_b_call_campaigns` (attribution, `ON DELETE SET NULL` — history never lost).
- **`lib/audiences/service.ts` → `refreshAudienceMembers(id, force?)`:** reuses `resolveCohortPhones`; **fixed** audiences freeze at first materialise, **dynamic** full-sync (add new matches, drop stale); `force` re-snapshots after a filter edit. Suppression is NOT applied at membership — only at send/call.
- **APIs (flat, body/query — no dynamic segments):** `GET/POST /api/audiences` (list/create+materialise), `GET /api/audiences/detail?id=`, `POST /api/audiences/update` (edit → re-snapshot on filter change), `POST /api/audiences/refresh`, `POST /api/audiences/delete`.
- **UI:** `/audiences` (Navbar → More) — list (member count, FIXED/AUTO-UPDATE badge, last-refreshed) + create/edit sheet + refresh + delete + **Seed presets**. **Filter builder extracted to `components/reach/FilterBuilder.tsx`** (Call/Chat/Subscribed/Walk-in/Sales/Signal/Behaviour bands) and **shared by Reach and Audiences** — one filter UI, no drift.
- **Activation** `POST /api/audiences/activate { audienceId, channel:'chat'|'call', templateId?, subFilter?, limit? }`: chat = one campaign per (audience,template), sync members, dispatch next N (ledger suppression); call = replace active calling cohort with callable members. Send-time `subFilter` narrows without changing the saved audience. Activate sheet on the page.
- **Profile attribution:** CustomerPeek shows **In audiences** + marks each send campaign-vs-**outside campaign** (`peek` returns `audiences` + `sends[].inCampaign`).
- **New feature-filters (`wa_041` + resolver):** `walkedIn`, `walkinNoPurchase`, `walkinTiming` (`wa_b_customers.walkin_timing` within_7d/within_1m/1_3m, set on the walk-in form), `callUnresponsive` (≥3 no-connect calls), `multiSource` (signals from ≥2 sources), `chatNonBuyer` (chat signal, no markers), `adLead`/`adCampaign` (guarded — `wa_ad_leads` not built yet). All in `ReachFilter` + `resolveCohortPhones` + FilterBuilder Behaviour/Walk-in bands.
- **Preset catalogue:** `lib/audiences/catalogue.ts` (21 audiences A1–E3+AD1) → `POST /api/audiences/seed` (idempotent, materialises each). AD1 empty until ads are wired.
- **Decisions locked** (see plan §2): sending MANUAL for now (auto/scheduled later), audiences editable + fixed/dynamic, **sub-filters at send time**, **one calling cohort at a time (replace)**, everything attributes on the profile, reports show message + call insights, live lapsed-winback migrates non-destructively.
- **Call suppression governance is now enforced, not just filterable (`wa_044`, waits revised in `wa_048`)** — an outcome-dependent wait (4 days after a miss or a "will come", 30 days after any other connected call) + ≥4-disconnect retirement, shared by the deck, audience call activation and Call Control. See §18A "Call suppression rules".

**Phase 11 — one row per customer (2026-07-18, `wa_045`) — the feature view:**
- **Unified do-not-contact (no migration).** `resolveCohortPhones` applied the call-only `is_do_not_call` inside two families; it now applies the unified `contacts.is_opted_out` (chat STOP ∪ call DNC ∪ manual) **once, at the end**. Before, a cohort's member count and what actually got sent disagreed — call-DNC people were missing from the count while chat-STOP people were counted but never sent to. **Policy:** opted out = no chat, no call; **ads are still allowed**, so ad/export callers pass `resolveCohortPhones(f, { includeOptedOut: true })`.
- **`customer_features` view (`wa_045`, rebuilt through `wa_054`)** — one row per person, one column per feature, over the `contacts` spine: `sales_*` (14) · `call_*` (10) · `chat_*` (4) · `walkin_*` (4, incl. the precomputed `walkin_no_purchase`) · `app_*` (4: `app_is_user`, `app_has_scheme`, `app_product_interest`, `app_product_interest_at`) · `ad_*` (3) · `sources`/`source_count` · **`int_<interest>_src[]` + `int_<interest>_at` × 23**. A VIEW, not a table: always live, nothing to refresh; can become materialised later with no caller change.
- **Interests carry their sources** rather than being a bare flag — `int_rate_src = {whatsapp}` answers both "has rate interest" (non-empty) and "from chat" (contains whatsapp). 23 columns instead of 115 + 23 roll-ups. **Source decides consent:** `rate` from whatsapp = the person asked us (a subscription); `rate` from a call = a salesman noted it.
- **GENERATED** — `node scripts/gen-feature-view.mjs` reads `INTERESTS` from `lib/signals.ts` and writes the migration. Re-run after adding an interest; never hand-edit `wa_045`. The script fails loudly if it parses <20 keys.
- **`sources` counts a walk-in visit and an ad lead as touches in their own right**, not just tagged interests — so multi-source intent (B3/D3) is no longer blind to visits and ads.
- **Dropped `walkin_count`:** there is no visit-history table (only the latest `walkin_at`), so it would always be 0 or 1.
- **Resolver moved onto the view (`wa_046`) — PARITY VERIFIED.** `resolveCohortPhones` asks `customer_features` one indexed question instead of deriving each family from raw tables and intersecting in app memory. **What deliberately stays on the event tables** (a person-level column cannot answer "was there an EVENT in this window"): called/messaged/signal-seen date ranges · intent **and** topic together (must hold on the same call) · `subscribedTopics` (filter stores topic UUIDs, view stores canonical keys, and several topics share a key — mapping would silently widen the cohort). Interest+source stays row-accurate *without* the event table: `int_wedding_src ov {walkin}` **is** "a wedding signal that came from a walk-in".
- **The gate (historical):** `scripts/parity-check.mjs` ran all 21 presets + 8 hand-written cases through the legacy **and** view resolvers against the real DB and compared phone sets member-by-member. **Result: 29/29 identical, 0 mismatches.** The script was removed in Phase 13 along with the legacy resolver it compared against — a one-time gate that has passed. `scripts/rules-check.mjs` remains as the live regression test.
- **Gate lesson (kept in the script):** the production fallback (view missing → legacy path) makes both sides run the SAME code, so a parity run once reported CLEAN while 4 cases were silently on legacy. The script now preflights the required columns and treats any fallback as a **failure**, never a match.
- **Speed (measured):** the pathological scans collapsed — multi-source **5908ms → 748ms**, hot-intent seed 5416 → 724, chat non-buyers 4391 → 929. Broad marker-only filters are roughly neutral (primary_metal 4319 → 4337) because the view joins ~11 CTEs regardless of which columns you ask for. **If that ever matters, materialise the view with a scheduled rebuild — no caller changes.**
- `resolveCohortPhonesLegacy` was retained as the parity oracle + runtime fallback, and **removed in Phase 13** once `wa_046` was applied everywhere.

**Phase 12 — the rule builder (2026-07-18, `wa_047`):**
- **An audience is now a rule tree** over `customer_features`. Grammar, deliberately ONE level deep so it stays readable on a phone: **groups are OR'd · rules inside a group are AND'd · any rule can be negated**. That's all of it.
- **`lib/audiences/rules.ts`** — the **field registry** (`FIELDS`) is the single place a feature is declared: one entry makes it appear in the dropdown, gives it the right operators for its type, and makes it filterable. Adding a feature used to be a type change + a resolver branch + a UI band; it is now one row. `opsFor(type)` derives the operators, so the builder is self-describing.
- **The whole tree compiles to ONE PostgREST query** (`treeToFilterString` → `or=(and(…),and(…))`), so a five-rule audience is one round trip, not five set operations in app memory.
- **Safety:** field names come from the registry, never from the client, and every value is validated against that field's declared options before reaching a filter string. Nothing is interpolated unchecked.
- **The `interest` field is one entry, not 23** — pick interests + optionally the channels they came from. It emits its own `or(…)` across the per-interest columns; `int_wedding_src ov {walkin}` **is** "a wedding signal that came from a walk-in", so it stays row-accurate.
- **`wa_047`:** `wa_audiences.rules JSONB`. **Non-destructive** — `filter` is untouched and still works; an audience uses `rules` when present, else `filter`. Nothing is auto-migrated. New audiences are authored as rules; an audience saved in the old format opens in the old builder with a note.
- **Live counts** — `POST /api/audiences/count` returns the audience total, each group's total, and **each rule's count on its own**, so a rule matching nobody is visible while you build instead of after you save.
- **VERIFIED** (`scripts/rules-check.mjs`, against the real DB): 11 preset audiences expressed as rule trees return the **identical people** as their legacy filters (A1 1094, E1 2309, C1 137, E3 62 …). OR and NOT have no legacy oracle, so they're checked against laws that must hold on any data — `A OR B = A + B − (A AND B)` and `(A AND B) + (A AND NOT B) = A`. Both exact.
- **What the grammar deliberately cannot express** (unchanged, still Reach's band UI for one-off sends): event-window questions — called/messaged/signal-seen *between* dates, and intent+topic on the *same* call. A person-level column cannot answer "was there an event in this window".

**Phase 16 — Call Control folded into the one engine (2026-07-19, no migration):**
- **The third grammar is gone.** Call Control resolved its deck from `wa_b_markers` directly with a bespoke 12-field `CallFilter`; the audience engine resolves 40 fields from `customer_features`. `/api/calls/campaign` now converts its `CallFilter` (a subset of `ReachFilter`, identical keys) through the proven `chipsToTree` and resolves via `resolveRuleTree`, and also accepts a `rules` tree directly. One resolver, whatever the caller.
- **One "calling deck" implementation (`lib/calls/deck.ts`).** `callableTypeB()` is the single definition of *callable* (do-not-call ∪ unreachable ∪ snoozed all excluded); `mintCallDeck()` deactivates the previous list, reuses an audience's existing campaign so already-called cards survive, and upserts the tasks. Both `/api/audiences/activate` (call channel) and `/api/calls/campaign` call these — the duplicated minting/gating logic is deleted.
- **Verified the live call path is unchanged (`scripts/callcohort-check.mjs`, live DB):** for 8 real filters the OLD resolution (markers inner-join + interest intersect + gates) and the NEW (feature view + `callableTypeB`) return the **identical callable customers** — 923, 742, 1905, … including "lapsed + rate interest" (37=37), the case where markers-vs-view could have diverged. So the winback/cold-call deck is untouched; only the plumbing changed.
- ~~Still open: the Call Control UI still shows its 12 bespoke chips.~~ **Done in Phase 17.**

**Phase 18 — customer-app features (2026-07-22, `wa_053`–`wa_054`):**
- **Three new person-level features, added once and live everywhere.** `app_user` (has an app account), `has_scheme` (holds a gold-savings scheme), and `app_product_interest` (tapped "interested" / shared a `gold.mnalankarpalace.com` product link into chat). They live on the **`contacts` spine** (`wa_053`), so a brand-new app user or a chat-only prospect is targetable without a sales row — the app population never pollutes the sales universe. The feature view is rebuilt by the generator (`wa_054`, `VERSION` bumped) exposing `app_is_user` / `app_has_scheme` / `app_product_interest` (+ `app_product_interest_at`). One entry each in `lib/audiences/rules.ts` (group **App**) makes them filterable in the Rules builder; `ReachFilter.{appUser,hasScheme,appProductInterest}` + `chips-to-tree` + `FilterBuilder` (a **Customer app** chip band) + `resolve.ts` (`viewActive`/`viewPhones`) give them the Chips face and the legacy resolver — both map to the same view columns, so `chipsToTree` parity holds by construction. Catalogue presets **APP1/APP2/APP3** ship them in the library.
- **The chat node that captures it.** `POST /api/whatsapp/webhook` gained `isAppProductInterest(text)` (matches the domain or the word "interested"), checked right after the STOP/DND/with-agent guards so a "…interested…" message never falls through to the welcome menu (interactive taps carry no `text`, so it can't eat a button). `handleAppProductInterest` raises the flag via `lib/app-features.ts markAppProductInterest()` (upsert on the spine, stamps first-seen only), records a `wa_lead_captures` lead (`intent: 'app_product'`), **flags the thread for an agent** (the reply promises "we will contact you"), and sends the editable `app_interest_ack` bot copy — "we have noted your choice … meanwhile continue browsing." The phone is already in the customer book (every inbound auto-enrols).
- **The app-export feed.** `app_user` / `has_scheme` come from the customer-app admin export. `POST /api/app-users/import` (+ admin page `/admin/app-users`, in the More menu) upserts the list onto the spine — **flags only, uniform column set**, so it never nulls or clobbers a chat/billing name (`is_app_user` defaults **true**; a row is the app-users list). Mirrors the sales-import CSV pattern (SheetJS client parse → chunked POST).
- **Surfaced on the profile.** `CustomerPeek` shows **App user / Scheme / App interest** badges; the peek API reads the three flags off `contacts`.
- `next build` compiles clean including `/admin/app-users`, `/api/app-users/import`, `/api/whatsapp/webhook`, `/reach`, `/audiences`.

**Invoice links — private per-bill "view invoice" pages (`wa_061`, 2026-08-16, IN PROGRESS):**
- **Goal.** Replace the plain thank-you (message + review link) with a personalised **Utility** WhatsApp message carrying a **dynamic "View invoice" button** → a private, no-index, 7-day web page showing that customer's actual bill (items, weights, purity, amounts) with engagement UI (rate-us / open-app) to follow.
- **Data reality that shaped it.** The Call Control import (`leads_import.csv`) is **per-customer aggregates** — no bill number or line items reach the DB. The real invoice source is the raw billing-ERP export (`Sales_*.csv`, `JSP_RTL_INVC` + `_ORN`), **Bill×Barcode grained** (one row per item). So invoices are sourced from that export, not the Call Control feed.
- **Built so far (mnap-connect ingest).** `wa_061_invoices.sql` → `wa_invoices` (one row per bill; `token` = 128-bit unguessable capability, generated once; `line_items` JSONB; lifecycle `sent_at`/`published_at`/`expires_at`; **insert-new-only by `bill_no`** so re-import never re-sends). `POST /api/invoices/import` **groups raw item rows by `RI_VRNO`** (header from first row, items accumulate), computes `payable = RI_NET_AMT − OA_AMT − AR_AMT`, parks bills with no valid phone. Column map: `RI_VRNO/RI_DATE/RI_CST_NAME/RI_PHN_NO/RI_AMT/RI_TAX_AMT/RI_NET_AMT/OA_AMT/AR_AMT` (header) + `ITM_NAME/PURT_NAME/RIO_NET_WT/BCM_BRCD/RIO_TOTAL_AMT` (items; `RIO_TOTAL_AMT` is **tax-inclusive**, so items foot to `RI_NET_AMT`). Admin page `/admin/invoices/import` (SheetJS parse → **chunks on whole bills** so a request never splits a bill).
- **Send side — built into the existing thank-you module (mnap-connect).** A third **Invoices** tab on `/admin/thankyou` (Recent buyers + Send/test untouched). Templates gained an **`invoice`** category (free-text `category`, no migration) = a Utility template with a dynamic URL button `…/i/{{1}}`. Dedicated send path (NOT `dispatchTemplate`, which dedupes by phone + suppresses by template window — both wrong for invoices): `GET /api/invoices/pending` (unsent bills, opt-out decorated) → `POST /api/invoices/send` sends **per invoice** (a customer's two bills = two links). Per bill, in order: skip if opted out → **`publishInvoice()` to the customer app FIRST** (fail ⇒ skip the send, so no dead link) → `sendTemplateMessage` with body params + `{type:button,sub_type:url,index:'0',parameters:[token]}` → thread + ledger (`category:'invoice'`, `suppression_key:'invoice:<bill_no>'`) → stamp `sent_at/published_at/expires_at = now+7d`. Suppression is `sent_at IS NULL`, not the resend window. Two server-only envs: `CUSTOMER_APP_PUBLISH_URL`, `CUSTOMER_APP_PUBLISH_SECRET`.
- **Still to build.** mnap-customer: `POST /api/invoices/publish` (shared-secret, writes Firestore `invoices/{token}` + `expiresAt` TTL) and server route `/i/[token]` (Admin SDK read, `noindex`, expiry 410, PDF download) — **until these exist the send fails-safe at the publish step (no dead links go out).** Meta: create the Utility template. Pipeline: emit `invoices_import.csv` (new bills only). Docs: DPDP + Play data-safety check.

**Phase 18 — multi-step funnels on an audience (`wa_055`, 2026-07-22):**
- **The problem being closed:** activation was **stateless** — `POST /api/audiences/activate` always re-sliced the *full* audience membership (`memberPhones()` then a one-shot `subFilter`). You could not "call everyone, then WhatsApp only those who connected, then narrow to those who read, then send again." Repeat chat sends with the same template also *merged* into one campaign, so there was no notion of sequential stages, and the report showed chat- and call-activations side by side as independent slices — never a real funnel with drop-off between stages.
- **Steps model (`wa_055`).** An audience gains an ordered list of **steps**. Each step: (1) **carries** a cohort from the *previous* step's outcome — `all` · `delivered` · `read` · `replied` · `connected`; (2) optionally **narrows** it by markers (the same `RuleTree` engine, `resolveRuleTree`); (3) **acts** — WhatsApp a template, or call. Step N's input is the *survivors* of step N-1, not the whole audience. Add as many steps as you like → an N-stage funnel; the step list read top-to-bottom **is** the report.
  - `audience_steps` is thin orchestration (carry_signal, carry_button, narrow_rules, action, template_id, + the `campaign_id`/`call_campaign_id` it spawned). `audience_step_members` **freezes who entered** each step (a historical fact) with the per-person **wamid** — the join key to `wa_message_events`. Everything else is REUSED: a chat step spawns a `wa_campaigns` + ledger via `dispatchTemplate` (its own campaign, so its funnel is isolated); a call step mints a deck via `mintCallDeck`.
- **Exact attribution, no heuristics (the design constraint).** Advance signals are limited to what WhatsApp attributes to a *specific* message: **delivered / read** (already in `wa_message_events`, keyed by wamid) and **replied = a quick-reply BUTTON tap**. On a tap, WhatsApp echoes `context.id` = our step send's wamid; the webhook (`recordStepReply`) records a `wa_message_events` row `status='replied'` with the button in `raw`. Because the wamid ties the receipt/tap to that one send to that one person, "who read / tapped step 3" is a pure join — **no time-window guessing**. Free-text replies are deliberately NOT counted. Calls carry by `connected` (`wa_b_call_logs.success=true`). A step only has a `replied` signal if its template carries quick-reply buttons.
  - The webhook change is **additive**: `recordStepReply` no-ops unless the tapped message is a step send, so the existing bot-flow (`handleFlowReply`) behaviour is untouched.
- **Engine + API + UI.** `lib/audiences/steps.ts` (server-only): `resolveStepInput` (carry ∩ narrow, with guards that reject a chat-carry off a call step and vice-versa), `runStep`, `engagementCohort`, `stepFunnel`. Routes: `GET`/`POST /api/audiences/steps`, `POST /api/audiences/steps/run`, `.../delete` (drafts only, last-first). UI: `components/audiences/StepFunnel.tsx` mounted in the Insights sheet — a vertical stepper with per-stage counts (entered → sent → delivered → read → replied, or entered → called → connected), an **Add step** form (carry chips gated by the previous channel, optional `RuleBuilder` narrow, template picker), and per-draft **Run**. A step is added as a **draft**, then Run actually sends/calls — review before firing.
- **Transitional:** step chat runs still carry `audience_id`, so they also appear under the legacy Insights chat/call lists (now labelled "Legacy activations"). Reach + Call Control ad-hoc sends are conceptually "an audience with one step" and can be retired into this later.
- **Retired the legacy Reports surface (same pass).** `app/reports/page.tsx` (a reader of `wa_broadcasts` only) and `app/api/whatsapp/broadcast/route.ts` (deprecated since Phase 4.3, **no caller** — verified by grep) are deleted, and the `/reports` nav entry removed. No data loss: `/campaigns` already surfaces historical `wa_broadcasts` as "Broadcast (legacy)". The `wa_broadcasts` table + `WaBroadcast` type are left in place (historical rows stay queryable via `/campaigns`); nothing writes them anymore.
- **Reach + Call Control fold into the spine (`lib/audiences/adhoc.ts`, no new migration).** Both kept their fast entry points (Reach's paste-list/cohort + cap/review/dynamic; Call Control's CSV import + one-live-deck) — but now every ad-hoc run becomes a continuable funnel:
  - **Funnels are campaign-ledger-based, not the wamid snapshot.** `engagementCohort`/`stepFunnel` for chat now derive delivered/read/replied from the step's `campaign_id` ledger ⋈ `wa_message_events`. This makes a Reach blast adopted as a step — and any later "send N more" on that same campaign — reflect correctly. `audience_step_members` now only freezes who ENTERED (for the count + `all`-carry); its `wa_message_id` column is unused (left in place). The webhook's `recordStepReply` correspondingly detects a step send via `wa_send_ledger.campaign_id → audience_steps.campaign_id` (not the member snapshot).
  - **Reach** (`/api/campaigns/create`, its only caller): after the usual campaign-create + reviewed blast, `createAudienceFromCohort` materialises the cohort into a `wa_audiences` and `adoptChatCampaignAsStep` records the blast as step 1 (status=run, links `wa_campaigns.audience_id`) — **no re-send**. Best-effort (a failure never fails the send). Returns `audienceId`; the Reach success card gains a "Continue as a funnel" link.
  - **Call Control** (`/api/calls/campaign`, create branch): `createAudienceFromCohort` + `createAndRunCallStep` (a draft call step → `runStep` → `callableTypeB` → `mintCallDeck`). Deck-minting + the three call gates are byte-for-byte the same path; the only change is it now hangs off an audience. Returns `audienceId`. CSV import + preview branch untouched.
  - **Result:** the Audiences list is now the single home for every send/call — authored, Reach, or Call Control — each a funnel you can extend. Each ad-hoc run creates one audience (named after the campaign); they're `is_seeded=false`, deletable.
- `next build` compiles clean including `/audiences`, `/api/audiences/steps`, `/api/audiences/steps/run`, `/api/audiences/steps/delete`, `/api/whatsapp/webhook`.

**Phase 17 — the two faces reach every surface (2026-07-21, no migration):**
- **Call Control UI swapped onto the shared builder.** `app/admin/calls/page.tsx` dropped its 12 bespoke chips + `currentFilter()` for the same **Rules / Chips** toggle the Audiences editor uses (`RuleBuilder` + `FilterBuilder`). Preview and Create send a `rules` tree (chips convert via `chipsToTree`); the API already resolved through the one engine (Phase 16), so this is UI-only — no resolver change, no re-verification needed. Import / salesmen / campaigns / signal-sync sections are untouched.
- **Send-time narrowing got the two faces too.** The activation sheet's "Narrow further" was chip-only and could not express time windows. It now offers **Rules / Chips**, both producing a rule tree. `/api/audiences/activate` accepts **`subRules`** (resolved via `resolveRuleTree`, so intervals work in a send-time slice); the legacy `subFilter` path stays for older callers. Neither changes the saved audience.
- **Store-visit history in the profile.** `CustomerPeek` now shows a **Store visits (N)** section — the full per-visit log from `wa_walkin_visits` (date · salesman · timing · interests), newest first, with reconstructed backfill rows flagged. `GET /api/customer/peek` returns `visits[]`. Before this the log was written (Phase 14) but never surfaced; the customer row's cache still drives the one-line "enrolled by" summary.
- **Vocabulary:** enforcement was already unified (`resolveCohortPhones`/`dispatch` apply the single `contacts.is_opted_out` once) — the audit confirmed the *terms* that looked like drift are principled distinctions (call-channel `is_do_not_call` vs unified `is_opted_out`; prospect **segment** vs **audience** vs run-**cohort**). Reach's stale "Opted out (STOP)" label → "Opted out". `GLOSSARY.md` gained **Interval** and **Two faces (Rules / Chips)** as canon.
- **One opt-out flag in the app code (follow-through on wa_049).** Every *app read* that still consulted a per-channel column now reads THE one flag: `ReachRecipient.{is_do_not_call,dnd}` collapsed to `optedOut` (route reads `contacts.is_opted_out` only); the thank-you recent-buyers route dropped its `is_do_not_call` join **and** its separate `wa_customers.dnd` set for one `is_opted_out` set; `CustomerPeek` shows one **Opted out** badge (was Don't-call + Opted-out); `broadcast` dropped the redundant `.eq('dnd',false)`; `ShareSheet` picker filters `is_opted_out`; the peek API stopped selecting the now-unused legacy columns.
  - **Closed a real hole:** `POST /api/whatsapp/send-media` blocked only chat-STOP (`wa_customers.dnd`), so a **call-DNC or manual opt-out could still be sent an image**. Now uses `isOptedOut()` — the same guard as `/send` and `/share-product`. This is the exact bug class wa_049 was written to kill; send-media had been missed.
  - **Deliberately left reading a per-channel column** (documented, not drift): the calls screen + `lib/calls/deck.ts` read/write `wa_b_customers.is_do_not_call` (the calling table's own column, kept in lockstep, and its direct write is the sanctioned "legacy write flows up" path whose undo correctly preserves a separate chat/manual opt-out); the webhook reads `dnd` for chat-STOP-specific *reply* suppression; `calls/export` unions `is_do_not_call` for the pipeline CSV. None of these decide outbound contactability on their own.
- `next build` compiles clean including `/admin/calls`, `/audiences`, `/api/audiences/activate`, `/api/customer/peek`.

**Phase 15 — one cohort engine: intervals + chips-as-rules (2026-07-19, `wa_052`):**
- **The problem being closed:** three ways to build a cohort — Reach's chips (`ReachFilter`), the rule builder (`RuleTree`), and Call Control's own `CallFilter` — each its own grammar. Chips could only AND across sections, so anything needing OR/NOT was hardcoded, and date-range chips silently meant "most recent", not "ever in this window".
- **Intervals (`lib/audiences/intervals.ts` + `intervals-query.ts`).** A tree is now `(rule groups OR'd) AND (every interval)`. Rules ask about a **person** (the feature view); an interval asks whether an **event** happened in a window (the log itself), which a person-row cannot answer. **NOT on an interval subtracts**, so "in this audience AND NOT contacted in 30 days" is finally expressible. Datasets: calls · messages · walk-ins · signals. Relative ("last N days", moves on refresh) or absolute. Each carries an honest caveat inline where the data can't fully answer (signals keep only the latest sighting per channel; walk-in history starts 2026-07-19).
  - **SPLIT for the client boundary:** types/dates/`DATASETS` live in `intervals.ts` (safe for the client builder); the service-role queries live in `intervals-query.ts` (server only). `lib/supabase/admin.ts` now throws a named error if imported client-side, so this trap self-reports instead of a blank page.
- **Chips became a second FACE of the rule engine (`lib/audiences/chips-to-tree.ts`).** `chipsToTree()` converts a `ReachFilter` to a `RuleTree`, mirroring `resolveCohortPhones` decision-for-decision. The audiences editor has a **Rules / Chips toggle**; both save a rule tree, so there is one definition of a cohort regardless of which face built it. **Proven identical on the live DB** — `scripts/chips-check.mjs`, 23/23 cases including intent+topic-same-call and interest-seen-since-a-date. Known gap: `subscribedTopics` (UUID-vs-key) is not convertible and `chipsConvertible()` reports false; no preset uses it, and the "subscription" concept is retired (daily-rate = rate interest **from chat**).
- **Registry additions:** `signal_source_count` ("Interest channels", the chips' "Multi-source" = ≥2) — distinct from `source_count` ("Number of channels", which also counts a bare visit/ad lead). The audit's same-word-two-meanings issue, now two explicit fields.
- **Verified against the live DB (`wa_052` applied):** interval check 6/6 (after the spine fix), chips check 23/23, rule check still clean. `next build` compiles `/audiences`.
- **Spine bug found by the interval check (`wa_052`):** "messaged us" returned 40 from the chat logs but 35 from the feature view — **5 people who messaged us were absent from the contact spine entirely**, because the spine was built from customer records and a WhatsApp thread can exist without one. They were invisible to every rule-based audience. Fixed: a thread now earns a spine row (trigger + backfill).

**Phase 14 — one opt-out flag, walk-in history, reporting truth (2026-07-19, `wa_049`–`wa_051`):**
- **ONE opt-out flag (`wa_049`).** There were **seven** columns for one idea: `wa_customers.dnd`, `wa_customers.is_opted_out`, `wa_b_customers.is_do_not_call`, and on `contacts` `chat_opted_out` / `call_opted_out` / `manual_opted_out` rolled into a GENERATED `is_opted_out`. Because the roll-up was *generated* it could not be written to, so each screen reached past it to whichever column it knew. **Live consequence: the 1:1 inbox send and the catalogue share checked only the chat half**, so a customer who told a salesman "don't contact me" could still be messaged and sent products — 26 people were in exactly that state.
  - `contacts.is_opted_out` is now a real, writable column and the only truth. The other six are **provenance** and decide nothing. `set_opt_out()` writes; `lib/optout.ts` reads and **fails closed** (a failed lookup counts as opted out). Legacy columns stay in lockstep by trigger both ways, guarded with `IS DISTINCT FROM` so they cannot ping-pong — the pipeline round-trip reads `is_do_not_call` and Type A screens read `dnd`.
  - **Migration gotcha worth remembering:** `customer_features` selects this column, so it could not be dropped, and renaming it just renames it *inside the view too*. The migration captures every dependent view — definition, **GRANTs and COMMENT** — drops, swaps, rebuilds. Dropping a view silently drops its permissions; without the re-GRANT every audience screen would return nothing. It deliberately does **not** CASCADE: it stops and names an uncaptured dependent rather than deleting a view it cannot rebuild.
  - Also fixed: a STOP from a number with no customer row was **silently dropped** (the write was conditional on `customer.id`). Dead `/api/whatsapp/thankyou` deleted.
- **Walk-in visit log (`wa_050`).** Visits were three columns on the customer row, so **every visit erased the previous one**. `wa_walkin_visits` is one row per visit; the customer columns remain a "latest visit" cache kept true by trigger (recomputed, so back-dating or deleting a visit corrects it). Backfilled rows are marked `is_backfill` — **visit counts start at 1 for anyone who visited before 19 Jul 2026, because the earlier visits are genuinely gone, not merely unmigrated.**
- **Feature view v2 (`wa_051`)** adds `walkin_count`, `walkin_first_at`, `walkin_is_repeat`. The generator now carries a `VERSION` constant: **bump it when the view's shape changes** rather than regenerating over an applied migration, which would leave that file describing something the database never ran. `walkin_salesman` is now filterable too (the gap flagged in atlas §12).
- **Reporting fixed.** The audience report **hardcoded replies to 0** — a real-looking zero on every audience, worse than showing nothing; it now computes replies the same way `/campaigns detail` does, so the two agree. Call metrics returned only attempts + connected, leaving pending cards in an unexplained gap; it now returns `connected`/`notConnected`/`pending` which **reconcile**: `attempts = connected + notConnected + pending`.
- **Retired concept: "subscription".** Verified against live data — 139 people subscribed to the Daily Rates topic, 139 have rate-interest-from-chat, **0 would be lost**. The chatbot writes both records for the same event, so the subscription pool was a second name for an interest with a source. Daily-rate audience = rate interest **from chat** (193 have it from any source; the extra 54 are call/walk-in mentions that must stay out).

**Phase 13 — cleanup (2026-07-19, no migration):**
- **Legacy resolver deleted.** `resolveCohortPhonesLegacy` (one hand-written query per filter family against the raw event tables, intersected in app memory) and its private `markerPhones` helper are gone, along with the runtime fallback that used it when the view was unavailable. Both existed only until `wa_046` was applied everywhere; carrying a second full implementation of cohort resolution is its own risk, because the two can silently drift.
- `scripts/parity-check.mjs` removed with it — it had no oracle left to compare against. It was a **one-time gate and it passed** (29/29 identical). `scripts/rules-check.mjs` stays as the live regression test and still passes after the deletion.
- **`GLOSSARY.md` added** — plain-English definitions of markers vs signals, features, audiences, rules/groups, materialise, activation, opt-out vs suppression, sources-and-consent, Type A/B, and what is named but not built.
- **Feature & filter review guide — `MNAP_DATA_ATLAS.html` §12 (2026-07-19):** the docs described features by *column name*; the app shows *labels*, and nothing mapped one to the other — so "I tapped this tag, what is it filtering?" had no answer outside `lib/audiences/rules.ts`. §12 closes that: the builder in tap order (field → operator → value; +Rule = AND, +Group = OR, NOT per rule), operators per type incl. what each means negated, then **every registry field as label → column → how it's computed → which module writes it → what to ask of it → which audience uses it**. Plus the 23 interest tags with their keys (**Daily Rate = `rate`, Coins/Bars = `investment`** — the two that differ), the six sources and what each implies about consent, a worked C1 build, and **"in the view but not filterable"** with the reason per column. Values were verified against `lib/calls.ts` and `lib/signals.ts`, derivations against `wa_046`.
- **Found while writing it: `walkin_salesman` is in the view and on the profile but has no registry entry**, so you cannot build an audience by who enrolled someone. Documented as a gap (one `FIELDS` row to fix), not a decision.
- **Doc sweep (2026-07-19):** `MNAP_DATA_ATLAS.html` §11 reframed from *planned* to live (+ generator, verification and "what rules can't ask" callouts; §09 resolve step and §10 don't-call row corrected); `README.md` doc map rewritten (this file is the system of record; adds GLOSSARY/atlas/lead-gen plan); `ENGAGEMENT_SYSTEM.md` scope note corrected (it no longer supersedes this file); `LEADGEN_PHASE1_PLAN.md` marked BUILT with a header note that its L1/L3 design was superseded; `../MNAP_ECOSYSTEM_OVERVIEW.md` §4.2 updated through `wa_047`.

**Phase 9 — salesman mode (2026-07-16, `wa_039`):**
- **Roster:** `salesmen` (name + short `alias`), managed in **Call Control** (its own `SalesmenRoster` component so typing doesn't re-render the heavy page — a full-page re-render per keystroke was reversing typed text on mobile). Rows can be set **Inactive** (leaves, keeps history) or **Deleted** (`ON DELETE SET NULL` → past calls/walk-ins fall back to "-"). Distinct from app-login accounts (`wa_b_call_logs.called_by` stays the device user). `wa_b_call_logs.salesman_id` + `wa_b_customers.walkin_salesman_id`/`walkin_at` added.
- **Call Reporting** joins `salesman:salesmen(alias)`; a **By salesman** card shows connected/attempts + rate per person and, tapped, scopes the whole report (tiles, topics, intents, drill, hot leads, log) to that salesman ('—' = unattributed/past calls). Each log line shows the alias.
- **Calling screen:** a "Calling as …" selector in bold at the top (tap to switch; remembered per device in `localStorage['mc_salesman']`). Every new call is tagged with the active salesman; call history + edit box + per-customer log show the **alias** (past calls with no salesman show "-"). Tapping the summary opens that customer's full call log; the edit-box name/number opens the profile (peek).
- **Walk-in** carries an "Enrolled by" salesman (defaults to the same device salesman); `/api/walkin` stores `walkin_salesman_id` + `walkin_at`.
- **Profile:** the walk-in section shows *Enrolled by ALIAS · date* and **Converted ✓** when a purchase (`last_purchase_date`) lands on/after the walk-in date (else "not yet converted").

**Phase 8 — campaign dynamism + opt-out + filter bands (2026-07-16, `wa_037`/`wa_038`):**
- **Manual opt-out (`wa_037`):** `contacts.manual_opted_out` folded into the generated `is_opted_out` (chat STOP ∪ call DNC ∪ manual). 3-dot in Customer Book toggles it. One source; Reach send/resolve + peek already read `is_opted_out`.
- **Campaigns are now persistent cohorts (`wa_038`):** `wa_campaigns` gains `name`/`is_dynamic`/`status`; new **`wa_campaign_members`** holds the full eligible cohort. **Reach "Create campaign"** resolves ALL eligible into members and blasts the reviewed selection (or a cap); the rest are finished **in-place from the Campaigns page** via *Send N more* (dispatches to pending members, funnel updates each batch). **Dynamic** campaigns re-resolve on each send and pull in new live matches (`added` reported); **fixed** = snapshot. Thank-you stays a fixed run (no members). Members with no send show as **Pending** in the drill-down.
- **Modularity:** cohort→phones resolution extracted to **`lib/reach/resolve.ts`**; the single send loop (opt-out + suppression + cap + thread + ledger) to **`lib/reach/dispatch.ts`**. Used by `/api/reach/send` (thank-you quick-send), `/api/campaigns/create`, `/api/campaigns/send`. Old `wa_reach_segments` UI retired — "save a cohort" **is** creating a campaign now.
- **Reach filter bands + date ranges:** filters grouped Call / WhatsApp chat / Subscribed to / Walk-in / Sales history / Signal source & date. New families: sales last-purchase range, chat messaged-us range, signal captured-between range (signals family now activatable by source or date alone) → "walked in this week", "chatted about rate last month".
- **Naming cleanup:** old `/admin/segments` renamed **"Prospect segments"** (the prospect-questionnaire segmentation engine) to stop colliding with Reach cohorts / Campaigns.

**Phase 6 — batch cap + IA + profile (2026-07-16, no migration):**
- **Daily/batch send cap (Reach + Thank-you):** both send flows take an optional "Send at most (per batch)" number. When set to N, only the **first N eligible** (not suppressed, not opted-out) are selected/sent this run; the rest stay in the cohort. Because the ledger suppression already skips anyone messaged inside the template window, running the same segment again later naturally sends the *next* N — so a 20/30-per-day WhatsApp limit is respected without double-sending. Reach: client-side selection (`selectWithCap`), review stats show "sending X of Y eligible". Thank-you Recent buyers: `eligible.slice(0, cap)`. Segments can still be built + saved **without** sending (Save current needs only a filter, no template/send).
- **Navbar IA:** bottom bar (PRIMARY) is now **Messages · Reach · Customers · Calls · Catalogue**; **Send (1:1)** and **Templates** moved into **More** (Send is now a minor 1:1 tool — Reach covers cohort sends). More = Campaigns · Send(1:1) · Templates · Call Control · Purchase · Reports · Prospects · Topics · Segments.
- **Profile (`CustomerPeek`) restructured:** "Interested in" is split by provenance — **from WhatsApp chat** (green), **from calls** (blue) are interest signals; **Bought before — from sales** (amber) is purchases, not interest; **Tagged at billing** (purple) if present. **Call log** is now a collapsed "View/Hide" section (outcome ✓/✗ + intent + topics per call). **Messages sent** now shows the message-type chip (Daily rate/One-off/Thank-you/Custom) + template + campaign/cohort. Reachable from any number: also wired into the **chat thread header** (`/messages/[phone]` — tap the name → full profile) on top of the existing /reach, /contacts, /calls, /admin/calls/report, /messages inbox, /admin/thankyou surfaces.

**Phase 7 — Walk-in module + campaign drill-down + occasion signals (2026-07-16, no migration):**
- **Walk-in as a signal source:** new `SignalSource` value **`walkin`** (label "Walk-in", pink dot). A walk-in is treated exactly like chat/call — **not** a new marker. Purchase markers (`wa_b_markers`) only ever come from real sales; a walk-in earns them if/when they buy. `POST /api/walkin` upserts a **Type B contact** (`wa_b_customers`, `source='walkin'`, hot-lead if VIP, visit note) so the contact-spine trigger makes them searchable/reachable/peekable, then writes each ticked interest to **`wa_signals` (source='walkin')**, idempotent on `(phone,interest,source)`. Only canonical `INTEREST_KEYS` are accepted (no free text into the spine).
- **`/walkin` page** (Navbar → More): lean counter-speed form — name, phone, interest chips grouped Engagement/Occasion/Metal/Product, "planning to buy" timing, hot-lead toggle, note. Success → View profile (peek) / Register another. Deeper prospect-style profiling (the existing `/prospects/new` 12-section questionnaire, which writes `wa_b_profiles` + runs segmentation but does **not** feed `wa_signals`) comes later once staff are trained.
- **Occasion is now a first-class signal:** added an **`occasion`** interest group to the canonical taxonomy (`INTERESTS`) — `wedding` / `gift` / `festival`. Targetable in Reach ("Occasion (walk-in)" chip group) like any interest, with the source facet (e.g. wedding **from Walk-in**). CustomerPeek shows an "Interested in — from walk-in" section.
- **Campaign drill-down (rebuilt `/api/campaigns/detail`):** now returns, besides the funnel, a **per-recipient list** — for every number: furthest stage reached (sent/delivered/read/replied/converted or failed), sent/delivered/read **timestamps**, and for failures the **Meta error code + reason** (pulled from `wa_message_events` incl. `failed` events, so codes appear for Reach sends too). Plus a **failure breakdown grouped by error code** (`shortError`) and **CSV export**. `/campaigns` page renders the funnel + breakdown + a filterable recipient list (jump to failed/replied/converted), each row tap-to-open the full profile. This fully replaces the old `/reports` broadcast detail (which it now supersedes) and adds replied/converted on top.

**Phase 4 increment 1 (2026-07-16, no migration):**
- **Interest source facet (chat-only cohorts):** `ReachFilter.interestSources?: ('whatsapp'|'call'|'sales')[]` (empty = any). Resolve applies `.in('source', …)` to the `wa_signals` interests family. UI: source chips (Chat/Call/Sales) appear under the interests once any interest is picked. e.g. "interested in offers **from Chat**" = 4 vs 13 from Call.
- **Unified consent via the contact spine:** `/api/reach/resolve` + `/api/reach/send` now read opt-out from `contacts` (STOP ∪ DNC) instead of separate `wa_customers.dnd` / `wa_b_customers.is_do_not_call` lookups, and fall back to the contact's display name — so chat-only leads (no Type B row) are first-class in Reach and correctly gated.
- **"Subscribed to" condition (broadcast-as-a-segment):** `ReachFilter.subscribedTopics?: string[]` (topic ids) — resolve family = customers opted in via `wa_customer_interests`. Reproduces the old topic broadcast inside Reach (e.g. Daily Rates = 133 subscribers). UI: "Subscribed to (opted in)" chips (active parent topics, system excluded).
- **Saved segments (increment 4, `wa_035`):** `wa_reach_segments(name, filter jsonb, …)`. Reach build mode shows a "Saved" chip row — click to load a filter, × to delete, "+ Save current" to name & store the active cohort (e.g. "Daily rate chat cohort"). Load is defensive (missing table = no segments, no crash).
- **Broadcast retired + `template.topic_id` removed (increment 3):** `/send` no longer has a broadcast flow — it's a 1:1 quick-send tool (template picker offers all active templates; a "Send to a cohort → Reach" link points cohort sends to Reach). Daily-rate blast is now Reach: *interest=rate + source=Chat* (chat subscribers who actually want updates; call-source rate ≠ wanting daily updates) or *Subscribed to Daily Rates*, with a `daily_rate` template. `/api/whatsapp/broadcast` is **deprecated** (no UI caller; kept until confirmed no external caller). Templates are classified only by **Message type** (`category`) — the topic selector/filter is gone; the templates list filters by Message type; `topic_id` is written `null`. `wa_interest_topics` remains the taxonomy for subscriptions + interests, not for templates.

**Phase 2 (2026-07-15, no migration — uses wa_032 columns):**
- **Universal customer peek** — `GET /api/customer/peek?phone=` gathers one phone's full story across universes (Type B customer + markers incl. first/last purchase, Type A chat + opt-out, `wa_signals` interests by source, `wa_b_call_logs` history, `wa_send_ledger` message history). Reusable drawer `components/ui/CustomerPeek.tsx` (`<CustomerPeek phone onClose/>`). Wired to tappable names/phones on **/reach, /admin/calls/report, /messages inbox (ⓘ), /calls deck, /send** — "click a number → who is this, new or known, tags, first+last purchase, calls, messages."
- **`/admin/thankyou` (rebuilt 2026-07-16)** — two tabs, ONE source of truth: templates in the **Templates module** whose **Message type = Thank-you** (`category='thankyou'`, active, Meta-linked). No separate template store.
  - **Message type is the single control (not topics):** `category` (`custom|daily_rate|rate|offer|thankyou`) is now a first-class always-visible field in `/admin/templates` (labelled "Message type", with the resend-guard days beside it) — no longer buried in the Meta section, no topic-name matching. `topic_id` stays purely a customer-interest tag. Selecting `thankyou` is what surfaces a template in the thank-you broadcast. (The old wa_014 "Purchased" pseudo-topic is legacy and no longer referenced.)
  - **Recent buyers tab:** `GET /api/thankyou/recent-buyers?days=14&templateId=` pulls buyers with `wa_b_markers.last_purchase_date` in the window (no upload), shows per-phone suppression, one-click sends via `/api/reach/send`.
  - **Send / test tab:** pick a thank-you template + one number / pasted list / uploaded file → `/api/reach/send` immediately (no buyer data needed). A **Test send** checkbox sets `ignoreSuppression:true` (new optional flag on `/api/reach/send`) so the same template can be fired repeatedly for previewing; DNC/opt-out always still enforced.
  - Legacy `wa_thankyou_products` table + `/api/whatsapp/thankyou` route left in place but no longer wired to any UI (the old "Messages" per-product tab was removed — it was the duplicate template store).
- **Import date-parse fix (2026-07-16, `/admin/calls`):** the XLSX/CSV importer now reads with `XLSX.read(buf,{cellDates:true,dateNF:'yyyy-mm-dd'})`. Previously `sheet_to_json({raw:false})` locale-reformatted ISO dates (`2022-06-04`→`6/4/22`), which the server's `YYYY-MM-DD` `dateOnly()` guard rejected, silently nulling `first_purchase_date`/`last_purchase_date` for the whole import (this is why Recent buyers showed 0). Existing 10,600 markers were backfilled from `leads_import.csv`.
- **Inbox funnel context:** `wa_send_ledger.cohort_label` shows in the peek's message history (e.g. "Thank-you (bought ≤14d)", "Thank-you (test)", "Lapsed VIP Winback"). Full funnel UI still parked.

---

## 19. Known Constraints

| Constraint | Detail |
|-----------|--------|
| No auto-send | wa.me links open WhatsApp with prefilled text — salesman must press Send |
| No broadcast | One customer at a time — each requires a separate tap |
| Text only | wa.me cannot attach images or media |
| Delivery tracking | No read receipts — log is optimistic |
| Phone cross-table | Type A and Type B have separate phone uniqueness — app warns but does not block cross-enrollment |
| Scheme tracking | Scheme is a signal only (yes/no/type) — no financial detail, no maturity computation |
| VIP is manual | Segmentation cannot detect loyalty — salesman must explicitly assign |
| Segment rules in code | Rules live in `lib/segmentation.ts` — adjustments require a code change (rule editor is v2) |

---

*Document created: 12 May 2026 — last updated: 15 July 2026 (added §18A Cold-Call module `wa_028`/`wa_029`, §18B Unified Interest Signals `wa_030`; see root `MNAP_ECOSYSTEM_OVERVIEW.md` for the cross-app picture)*
*Project folder: `C:\Users\spand\Desktop\Management Software\mnap-connect`*
*Supabase project: shared with MNAP — `tqnirshwiqpwbqdcrgbr`*
*Migrations: `wa_001`…`wa_027` (see `supabase/migrations/`), `wa_028_calling.sql`, `wa_029_last_purchase_date.sql`, `wa_030_signals.sql`*
*Strategy: `INTERVENTION_STRATEGY.md` — `INTERVENTION_MODULE_DISCUSSION.md`*
