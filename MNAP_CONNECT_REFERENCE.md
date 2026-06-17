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

*Document created: 12 May 2026 — last updated: 17 June 2026 (engagement API, Catalogue/Inventory/Purchase modules — see `ENGAGEMENT_SYSTEM.md`)*
*Project folder: `C:\Users\spand\Desktop\Management Software\mnap-connect`*
*Supabase project: shared with MNAP — `tqnirshwiqpwbqdcrgbr`*
*Migrations: `supabase/migrations/wa_001_initial_schema.sql`, `wa_002_seed_topics.sql`, `wa_003_intervention_schema.sql`*
*Strategy: `INTERVENTION_STRATEGY.md` — `INTERVENTION_MODULE_DISCUSSION.md`*
