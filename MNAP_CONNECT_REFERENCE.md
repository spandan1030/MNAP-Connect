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
category, barcode, weight, purity→karat, makingPercent, **published photo gallery (4:5 crops)**, active)
into the customer app's `catalogue/{id}` Firestore collection via the Firebase Admin SDK.
The doc carries `image`/`thumb` (the cover) **and** `images: string[]` (the full gallery,
cover first) — the customer app's `PhotoViewer` swipes through `images`.
Never sends party/cost/notes (barcode IS sent — note `catalogue` is public-read). Price is **not** sent — the customer app computes
it live from its own daily rate. Unmapped purity → still published, `priceHidden:true`
(app shows "Enquire"). Sold/inactive/unpublished → doc updated/removed automatically.

- Files: `lib/firebase/admin.ts` (Admin init), `lib/catalogue-sync.ts` (`resolveKarat`,
  `syncProductToApp`, `resyncAllPublished`), `app/api/catalogue/publish/route.ts`
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
(`crop` JSONB, `{x,y,w,h}` in 0..1). On upload a **centred** 4:5 crop is generated
automatically, so every photo has a valid display image even if never manually cropped.
The **Crop** button opens `components/catalogue/ImageCropper.tsx` — a fixed 4:5 frame the
user pans/zooms (Instagram-style); re-cropping regenerates only the display files
(original is never touched) and re-syncs if the photo is primary + published.
- The **customer app is fed the crop**: `catalogue-sync.buildDoc` sends
  `display_url ?? image_url` (and `display_thumb_url ?? thumb_url ?? image_url`).

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
- **R1 cooldown — `CALL_COOLDOWN_DAYS = 2`.** A failed card returns after **2 days**, not the next day (was daily-retry). Enforced at read time: `last_attempt_date < callCooldownCutoff()`.
- **R2 unreachable — `MAX_FAILED_CALL_ATTEMPTS = 4`.** A customer with **≥ 4 disconnects** drops out of every calling deck. **Disconnects only** = `wa_b_call_logs.success = FALSE`; a **pending** log (`success IS NULL` — Call tapped, outcome not yet submitted) never counts, so an unfinished card can't suppress anyone.
- **Mechanism:** `wa_b_customers.failed_call_attempts`, recomputed from the logs by trigger on every insert/update/delete (self-healing — editing Fail→Success decrements) and backfilled from all history, so the **live winback campaign obeys it immediately**.
- **Applied at both ends:** the deck query (`/calls`), audience **call activation**, and Call Control's builder (preview count = what the salesman sees). **Non-destructive** — no rows deleted, no task status rewritten; raise the threshold and they come back. They stay reachable on chat/ads via audience **A5 `callUnresponsive`**.

## 18B. Unified Interest Signals (`wa_030`, applied 2026-07-15)

One phone-keyed layer converging interest signals from **all sources** onto one canonical taxonomy — crossing the Type A / Type B split (which are separate tables joined only by phone).

**Table:** `wa_signals(phone, interest, source, weight, evidence, last_seen)`, UNIQUE(phone, interest, source). **Taxonomy** (`lib/signals.ts`): engagement (rate/designs/offers/scheme/exchange/cash/repair) · product (necklace/ring/bangles/earrings/chain/mangalsutra/pendant/bracelet/anklet/investment) · metal (gold/silver/diamond).

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

**Phase 10 — Audience Library foundation (2026-07-17, `wa_040`) — Lead-Gen Phase 1, IN PROGRESS:**
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
- **Call suppression governance is now enforced, not just filterable (`wa_044`)** — 2-day cooldown + ≥4-disconnect retirement, shared by the deck, audience call activation and Call Control. See §18A "Call suppression rules".

**Phase 11 — one row per customer (2026-07-18, `wa_045`) — the feature view:**
- **Unified do-not-contact (no migration).** `resolveCohortPhones` applied the call-only `is_do_not_call` inside two families; it now applies the unified `contacts.is_opted_out` (chat STOP ∪ call DNC ∪ manual) **once, at the end**. Before, a cohort's member count and what actually got sent disagreed — call-DNC people were missing from the count while chat-STOP people were counted but never sent to. **Policy:** opted out = no chat, no call; **ads are still allowed**, so ad/export callers pass `resolveCohortPhones(f, { includeOptedOut: true })`.
- **`customer_features` view (`wa_045`)** — one row per person, one column per feature, over the `contacts` spine: `sales_*` (14) · `call_*` (10) · `chat_*` (4) · `walkin_*` (4, incl. the precomputed `walkin_no_purchase`) · `ad_*` (3) · `sources`/`source_count` · **`int_<interest>_src[]` + `int_<interest>_at` × 23**. A VIEW, not a table: always live, nothing to refresh; can become materialised later with no caller change.
- **Interests carry their sources** rather than being a bare flag — `int_rate_src = {whatsapp}` answers both "has rate interest" (non-empty) and "from chat" (contains whatsapp). 23 columns instead of 115 + 23 roll-ups. **Source decides consent:** `rate` from whatsapp = the person asked us (a subscription); `rate` from a call = a salesman noted it.
- **GENERATED** — `node scripts/gen-feature-view.mjs` reads `INTERESTS` from `lib/signals.ts` and writes the migration. Re-run after adding an interest; never hand-edit `wa_045`. The script fails loudly if it parses <20 keys.
- **`sources` counts a walk-in visit and an ad lead as touches in their own right**, not just tagged interests — so multi-source intent (B3/D3) is no longer blind to visits and ads.
- **Dropped `walkin_count`:** there is no visit-history table (only the latest `walkin_at`), so it would always be 0 or 1.
- **Resolver moved onto the view (`wa_046`) — PARITY VERIFIED.** `resolveCohortPhones` asks `customer_features` one indexed question instead of deriving each family from raw tables and intersecting in app memory. **What deliberately stays on the event tables** (a person-level column cannot answer "was there an EVENT in this window"): called/messaged/signal-seen date ranges · intent **and** topic together (must hold on the same call) · `subscribedTopics` (filter stores topic UUIDs, view stores canonical keys, and several topics share a key — mapping would silently widen the cohort). Interest+source stays row-accurate *without* the event table: `int_wedding_src ov {walkin}` **is** "a wedding signal that came from a walk-in".
- **The gate:** `scripts/parity-check.mjs` runs all 21 presets + 8 hand-written cases through the legacy **and** view resolvers against the real DB and compares phone sets member-by-member (compiled via `tsconfig.parity.json` so it tests the *actual exported functions*, not a re-implementation). **Result: 29/29 identical, 0 mismatches.** Re-run it after any resolver or view change.
- **Gate lesson (kept in the script):** the production fallback (view missing → legacy path) makes both sides run the SAME code, so a parity run once reported CLEAN while 4 cases were silently on legacy. The script now preflights the required columns and treats any fallback as a **failure**, never a match.
- **Speed (measured):** the pathological scans collapsed — multi-source **5908ms → 748ms**, hot-intent seed 5416 → 724, chat non-buyers 4391 → 929. Broad marker-only filters are roughly neutral (primary_metal 4319 → 4337) because the view joins ~11 CTEs regardless of which columns you ask for. **If that ever matters, materialise the view with a scheduled rebuild — no caller changes.**
- `resolveCohortPhonesLegacy` is retained ONLY as the parity oracle + runtime fallback; delete both once `wa_046` is everywhere.
- Next: the field/operator/value rule builder with AND/OR/NOT over these columns.

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
