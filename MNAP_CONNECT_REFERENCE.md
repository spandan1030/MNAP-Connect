# MNAP Connect — WhatsApp Customer Engagement App
## Complete Project Reference Document

---

## Table of Contents

1. [Project Identity](#1-project-identity)
2. [Tech Stack](#2-tech-stack)
3. [Architecture Overview](#3-architecture-overview)
4. [Database Schema](#4-database-schema)
5. [Business Rules & Logic](#5-business-rules--logic)
6. [Send Module — Core Logic](#6-send-module--core-logic)
7. [Template System](#7-template-system)
8. [Opt-Out Rules](#8-opt-out-rules)
9. [Page Structure](#9-page-structure)
10. [Data Flow — End to End](#10-data-flow--end-to-end)
11. [WhatsApp Link Format](#11-whatsapp-link-format)
12. [Build Phases](#12-build-phases)
13. [Future Roadmap](#13-future-roadmap)
14. [Known Constraints](#14-known-constraints)

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| App Name | MNAP Connect |
| Purpose | WhatsApp customer engagement — enrollment, interest tracking, message sending, communication history |
| Store | M N Alankar Palace |
| Repo | `https://github.com/spandan1030/MNAP-Connect.git` |
| Local Folder | `C:\Users\spand\Desktop\Management Software\mnap-connect` |
| Live URL | `https://mnapconnect.vercel.app` |
| Supabase Project | **Same as MNAP** — `https://tqnirshwiqpwbqdcrgbr.supabase.co` |
| Database Namespace | All tables prefixed `wa_` — zero conflict with MNAP tables |
| Primary Users | Salesmen (internal, authenticated) |
| Secondary Users | Customers (public self-enroll page only — no login) |
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

---

## 3. Architecture Overview

```
Salesman's Phone (Browser)
    │
    ├── Next.js Middleware
    │       └── Auth check → redirect to /login if unauthenticated
    │       └── /enroll excluded from auth (public page)
    │
    ├── Client Components (send module, customer list, admin panels)
    │       └── Direct Supabase calls via browser client
    │
    └── Supabase (shared with MNAP, wa_ tables only)
            ├── Auth (same users as MNAP)
            ├── wa_ tables with RLS
            └── Service role not needed — all access via authenticated user

External (no auth):
    └── /enroll page — customer self-enroll (public, no login)
```

**Key design decisions:**
- No API routes — all DB access via Supabase client with RLS
- Shared Supabase project: zero extra cost, zero performance impact at ≤500 customers
- WhatsApp integration is entirely client-side via `wa.me` links — no server-side messaging
- Mobile-first UI: large cards, large buttons, minimal typing

---

## 4. Database Schema

All tables prefixed `wa_`. All have Row Level Security enabled.

---

### `wa_interest_topics`
Master list of interest categories and sub-topics. Two levels only.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | Auto-generated |
| `name` | TEXT | NOT NULL | Display name (e.g. "Daily Rates", "Necklaces") |
| `parent_id` | UUID | FK → wa_interest_topics, nullable | NULL = top-level category. Set = sub-topic under that category |
| `sort_order` | INT | DEFAULT 0 | Controls display order within its level |
| `is_active` | BOOLEAN | DEFAULT TRUE | Inactive topics hidden from enrollment forms and filters |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | — |

**Depth rule:** Maximum 2 levels. `parent_id` must point to a row where `parent_id IS NULL` (i.e. no third level allowed — enforced in app logic, not DB constraint).

**Suggested seed data:**
```
Daily Rates                    (parent_id: null)
New Designs                    (parent_id: null)
  └── Necklaces                (parent_id: New Designs)
  └── Rings                    (parent_id: New Designs)
  └── Bangles                  (parent_id: New Designs)
  └── Earrings                 (parent_id: New Designs)
  └── Chains                   (parent_id: New Designs)
  └── Bracelets                (parent_id: New Designs)
  └── Pendants                 (parent_id: New Designs)
  └── Anklets                  (parent_id: New Designs)
  └── Mangalsutra              (parent_id: New Designs)
  └── Coins                    (parent_id: New Designs)
Schemes & Offers               (parent_id: null)
Festive Offers                 (parent_id: null)
Repair & Service               (parent_id: null)
```

---

### `wa_customers`
One record per customer.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | Auto-generated |
| `name` | TEXT | NOT NULL | Customer display name |
| `phone` | TEXT | NOT NULL, UNIQUE | 10-digit Indian mobile number (stored without country code) |
| `enrolled_via` | TEXT | CHECK IN ('salesman', 'self') | How the customer was enrolled |
| `enrolled_by` | UUID | FK → profiles, nullable | Salesman who enrolled (null if self-enrolled) |
| `is_active` | BOOLEAN | DEFAULT TRUE | Soft-delete flag |
| `is_opted_out` | BOOLEAN | DEFAULT FALSE | TRUE = customer has opted out of communications |
| `opted_out_at` | TIMESTAMPTZ | nullable | When opt-out was requested |
| `opted_out_by` | UUID | FK → profiles, nullable | Salesman who marked opt-out (null if self-opted-out via future flow) |
| `notes` | TEXT | nullable | Salesman's private note about the customer |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | — |

**Phone uniqueness:** Prevents duplicate enrollment. On self-enroll, if phone already exists → update interests rather than create duplicate. Shown as "You're already enrolled — updating your preferences."

---

### `wa_customer_interests`
Junction table — which topics each customer is interested in.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `customer_id` | UUID | FK → wa_customers (CASCADE DELETE) | — |
| `topic_id` | UUID | FK → wa_interest_topics (CASCADE DELETE) | — |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | When interest was added |

**Primary Key:** `(customer_id, topic_id)` — no duplicate interests per customer.

**Note:** Interests can be at any level — a customer can be interested in the "New Designs" category (receives all design updates) OR specifically in "Necklaces" (more targeted). Both are valid. The send module uses whichever level the salesman filters by.

---

### `wa_message_templates`
Pre-written message templates, linked to a topic.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | — |
| `topic_id` | UUID | FK → wa_interest_topics, nullable | NULL = general template (not interest-specific) |
| `name` | TEXT | NOT NULL | Internal label e.g. "Morning Rate Update", "Festival Wishes" |
| `body_text` | TEXT | NOT NULL | Message text. Supports `{name}` placeholder — replaced with customer name at send time |
| `is_active` | BOOLEAN | DEFAULT TRUE | Inactive templates hidden from send flow |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | — |
| `created_by` | UUID | FK → profiles | Admin who created this template |

**Supported placeholders (all live):**
- `{name}` → customer's name
- `{rate_24kt}` → today's 24KT rate from `daily_rates` (auto-fetched at send time)
- `{rate_22kt}` → today's 22KT rate
- `{rate_18kt}` → today's 18KT rate

---

### `wa_communication_log`
Immutable record of every message sent (or attempted via wa.me link).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | — |
| `customer_id` | UUID | FK → wa_customers | — |
| `template_id` | UUID | FK → wa_message_templates, nullable | Which template was used (null if future free-text) |
| `topic_id` | UUID | FK → wa_interest_topics, nullable | Which interest filter was active when sent |
| `message_sent` | TEXT | NOT NULL | Actual message text after `{name}` substitution — stored verbatim |
| `sent_by` | UUID | FK → profiles | Salesman who tapped Send |
| `sent_at` | TIMESTAMPTZ | DEFAULT NOW() | — |

**Why store `message_sent` verbatim:** Template body may be edited later. The log must preserve exactly what was sent, not what the template currently says.

**Logging behaviour:** The log entry is created the moment the salesman taps "Open WhatsApp" — optimistic logging. The app cannot confirm whether the salesman actually pressed Send inside WhatsApp (wa.me limitation). This is acceptable.

---

## 5. Business Rules & Logic

### Customer Enrollment
- Phone number is the unique identifier — no two customers share a phone
- Salesman enrollment: requires login; captures `enrolled_by`
- Self-enrollment: public page, no login; `enrolled_by = null`, `enrolled_via = 'self'`
- Interests selected at enrollment time; editable later from customer profile
- A customer must have at least one interest selected to enroll (validation)

### Interest Selection
- A customer can hold interests at any mix of levels:
  - Category level: "New Designs" → receives any design-related message
  - Sub-topic level: "Necklaces" → receives only necklace-specific messages
- There is no auto-inheritance: selecting "New Designs" does NOT automatically add all its sub-topics to `wa_customer_interests`. They are independent entries.
- The salesman selects whichever level makes sense for the customer

### Active vs. Inactive Topics
- Inactive topics (`is_active = false`) are hidden from:
  - Enrollment form interest checkboxes
  - Send module filter bar
  - Template master (cannot assign template to inactive topic)
- Existing customer interests pointing to an inactive topic are preserved in DB but the customer won't appear under that filter

### Who Appears in the Send Module
- Only customers with `is_opted_out = false` AND `is_active = true`
- When a topic filter is active: only customers who have that exact `topic_id` in `wa_customer_interests`
- "All" filter: all non-opted-out, active customers

---

## 6. Send Module — Core Logic

This is the primary daily-use screen. Designed for speed — minimal taps.

### Screen Layout
```
┌─────────────────────────────────────┐
│  [All] [Rates] [Necklaces] [Schemes]│  ← Filter chips (horizontal scroll)
├─────────────────────────────────────┤
│  🔍 Search by name or phone         │
├─────────────────────────────────────┤
│  Priya Sharma    +91 98765 43210    │
│  Rates · Necklaces         [Send →] │
├─────────────────────────────────────┤
│  Ravi Kumar      +91 91234 56789    │
│  Schemes                   [Send →] │
└─────────────────────────────────────┘
```

### Send Button Behaviour — Decision Tree

```
Salesman taps [Send →] on a customer row
│
├── Filter = specific topic (e.g. "Daily Rates")
│       │
│       ├── Exactly 1 active template for this topic
│       │       → Auto-load template, substitute {name}
│       │       → Show preview screen
│       │       → Salesman taps "Open WhatsApp"
│       │       → wa.me link opens WhatsApp with prefilled text
│       │       → Log entry created in wa_communication_log
│       │
│       └── Multiple active templates for this topic
│               → Show bottom sheet: list of template names for this topic
│               → Salesman picks one
│               → Show preview screen → "Open WhatsApp" → Log
│
└── Filter = "All"
        → Show bottom sheet: templates grouped by customer's own interests
          (only topics this customer is enrolled in, plus general templates)
        → Salesman picks template
        → Show preview screen → "Open WhatsApp" → Log
```

### Preview Screen
- Shows the full substituted message text (e.g. `{name}` replaced with "Priya", rates filled in)
- Customer name and phone shown at top
- **"Edit" button** in the header — toggles the green message bubble into an editable textarea so the salesman can tweak wording before sending; edited text is what gets sent and logged
- "Open WhatsApp" button (WhatsApp green, full-width, prominent)
- "← Change Message" to go back to template picker

### Template Auto-Load Rule
The **filter** determines the template, not the customer's other interests.

> **Example:** Priya is interested in both Rates and Necklaces. Filter is set to "Rates". Tap Send on Priya → rate update template loads. Her necklace interest is irrelevant here. The salesman chose to send a rates message to rates-interested customers.

This means the salesman workflow is:
1. Pick the topic they want to communicate about (set filter)
2. Work through the list, tapping Send on each relevant customer

---

## 7. Template System

### Template–Topic Relationship
- One topic can have many templates
- One template belongs to one topic (or no topic = general)
- General templates appear in the "All" filter send flow for any customer

### Template Admin (`/admin/templates`)
- List all templates, filterable by topic
- Add / edit / toggle active
- **Placeholder chips** above the textarea — tap any chip to insert at cursor position:
  - `{name}` — Customer name
  - `{rate_24kt}` — 24KT rate per gram
  - `{rate_22kt}` — 22KT rate per gram
  - `{rate_18kt}` — 18KT rate per gram
- Preview button shows example with all placeholders substituted (sample rates used; disclaimer shown)

### Placeholder Substitution Rule
At send time (when wa.me link is constructed):
```
final_message = applyPlaceholders(template.body_text, customer.name, todayRates)
```
Where `applyPlaceholders` replaces `{name}` with the customer's name and all `{rate_*}` tags with today's rates from the `daily_rates` table (formatted `en-IN` with 2 decimal places; `—` if rate not available).

`final_message` (after any inline edits by the salesman) is URL-encoded and appended to the wa.me link. It is also stored verbatim in `wa_communication_log.message_sent`.

### Template Deactivation
- Inactive templates do not appear in the send flow
- Existing log entries referencing an inactive template are unaffected (historical record)

---

## 8. Opt-Out Rules

| Scenario | Behaviour |
|----------|-----------|
| Salesman marks customer opted out | Sets `is_opted_out = true`, `opted_out_at = now()`, `opted_out_by = salesman.id` |
| Customer appears in send list | No — opted-out customers are excluded from all send module lists |
| Customer appears in customer list (`/customers`) | Yes — visible but with "Opted Out" badge and disabled Send button |
| Customer appears in communication history | Yes — full history preserved |
| Re-enrollment after opt-out | Admin can re-enable via customer profile toggle (requires confirmation) |
| Self-enroll while opted out | Page detects phone match + `is_opted_out = true` → shows "Re-subscribe?" option |
| Opt-out confirmation | UI shows a confirmation dialog before setting opt-out — irreversible by salesman, only admin can undo |

---

## 9. Page Structure

```
/                           → Send Module (main screen — default landing)
/customers                  → Customer list (search, view all)
/customers/new              → Add customer (salesman enrollment)
/customers/[id]             → Customer profile + history + opt-out
/admin/topics               → Interest topic master (CRUD)
/admin/templates            → Message template master (CRUD)
/login                      → Salesman login
/enroll                     → Public self-enroll (no auth)
/enroll/success             → Self-enroll confirmation
```

### Page Roles & Auth

| Page | Auth Required | Who |
|------|--------------|-----|
| `/` (Send Module) | Yes | Salesman |
| `/customers` | Yes | Salesman |
| `/customers/new` | Yes | Salesman |
| `/customers/[id]` | Yes | Salesman |
| `/admin/topics` | Yes (admin role) | Admin only |
| `/admin/templates` | Yes (admin role) | Admin only |
| `/login` | No | Anyone |
| `/enroll` | No | Customers |
| `/enroll/success` | No | Customers |

---

## 10. Data Flow — End to End

### Salesman Sends a Message (Specific Interest Filter)

```
1. Salesman opens app → lands on Send Module (/)
2. Taps a topic filter chip (e.g. "Daily Rates")
3. List updates → shows only customers interested in "Daily Rates"
4. Salesman taps [Send →] on a customer
5. App checks: how many active templates for "Daily Rates"?
   → 1 template → auto-loads it
   → Multiple → shows bottom sheet picker
6. Template loaded → {name} substituted with customer.name
7. Preview screen shown
8. Salesman taps "Open WhatsApp"
   → wa.me link constructed: https://wa.me/91{phone}?text={url_encoded_message}
   → WhatsApp Business app opens with prefilled message
   → Customer chat opens (existing thread if contact exists)
9. App immediately creates wa_communication_log entry
   (customer_id, template_id, topic_id, message_sent, sent_by, sent_at)
10. Salesman presses Send inside WhatsApp
11. Salesman returns to app → next customer in list
```

### Salesman Sends a Message (All Filter)

```
1. Filter = "All" → full customer list shown
2. Salesman taps [Send →] on a customer
3. Bottom sheet shows templates grouped by that customer's interests
   + any general templates (topic_id = null)
4. Salesman picks template → preview → "Open WhatsApp" → log
```

### Customer Self-Enrolls

```
1. Customer scans QR code / opens link to /enroll
2. Form: name, phone, interest checkboxes (active topics only)
3. Submit:
   a. Check if phone already exists in wa_customers
      → New phone: INSERT wa_customers + wa_customer_interests
      → Existing phone + is_opted_out = false: UPDATE interests
      → Existing phone + is_opted_out = true: show re-subscribe prompt
4. Redirect to /enroll/success with confirmation message
```

### Admin Adds a Template

```
1. Admin opens /admin/templates
2. Taps "Add Template"
3. Selects topic (or General), enters name, writes body_text
4. Taps placeholder chips to insert {name}, {rate_24kt}, {rate_22kt}, {rate_18kt} at cursor
5. Taps "Preview message" to verify — sample rates used in preview; actual rates filled at send time
6. Saves → INSERT wa_message_templates
7. Template immediately available in send flow
```

### Customer Opts Out

```
1. Salesman opens customer profile (/customers/[id])
2. Taps "Opt Out" → confirmation dialog: "Remove {name} from all communications?"
3. Confirms → UPDATE wa_customers SET is_opted_out=true, opted_out_at=now(), opted_out_by=salesman.id
4. Customer immediately disappears from Send Module lists
5. Customer profile shows "Opted Out" badge + opt-out date
6. All historical logs preserved
```

---

## 11. WhatsApp Link Format

```
https://wa.me/91{phone}?text={url_encoded_message}
```

| Part | Detail |
|------|--------|
| `91` | India country code — always prepended |
| `{phone}` | 10-digit number from `wa_customers.phone` |
| `{url_encoded_message}` | `encodeURIComponent(final_message)` |
| Opens in | WhatsApp Business app (if installed) |
| Message status | Prefilled in the chat compose box — salesman still presses Send |
| Threading | If customer's number is saved as a contact, opens existing thread |
| Photo sharing | Not supported via wa.me links — text only (Phase 1) |

**Example:**
```
Customer: Priya Sharma, phone: 9876543210
Template: "Hello {name}! Today's gold rates at M N Alankar Palace:\n24KT: ₹9,850/gram | 22KT: ₹9,025/gram\nFor more: 91234 56789"

Final message: "Hello Priya Sharma! Today's gold rates at M N Alankar Palace:\n24KT: ₹9,850/gram | 22KT: ₹9,025/gram\nFor more: 91234 56789"

wa.me link: https://wa.me/919876543210?text=Hello%20Priya%20Sharma!%20Today's%20gold%20rates...
```

---

## 12. Build Phases

### Phase 1 — Core ✅ Complete
- [x] New Next.js project setup (`mnap-connect`)
- [x] Supabase: create all `wa_` tables + RLS policies
- [x] Auth: login page, middleware (reuse MNAP Supabase project)
- [x] Interest Topic Master (`/admin/topics`) — CRUD, 2-level tree
- [x] Template Master (`/admin/templates`) — CRUD, topic association, placeholder chips, preview
- [x] Customer Enrollment by salesman (`/customers/new`)
- [x] Customer List (`/customers`) — search, filter by status
- [x] Customer Profile (`/customers/[id]`) — interests, history, opt-out
- [x] **Send Module (`/`)** — filter chips, customer list, send button, template resolution, preview, inline edit, wa.me link, log
- [x] Self-Enroll page (`/enroll`) — public, duplicate phone handling
- [x] Opt-out flow

### Phase 2 — Rate Integration ✅ Complete
- [x] Pull today's rates from `daily_rates` table (shared Supabase) — auto-fetched on Send page load
- [x] Support `{rate_24kt}`, `{rate_22kt}`, `{rate_18kt}` placeholders in templates — substituted at send time
- [x] Rate status pill on Send module — green if rates loaded, amber warning if not yet synced
- [ ] Rate template quick-action: one-tap send from customer card when filter = "Daily Rates"

### Phase 3 — Broadcast (Requires WhatsApp Business API)
- [ ] Select all / filtered customers → bulk send
- [ ] API provider integration (AiSensy / WATI / Interakt)
- [ ] Delivery status tracking
- [ ] Template approval flow (WhatsApp requires pre-approved templates for broadcasts)

### Phase 4 — Product Catalog Integration
- [ ] Product catalog app exposes shared Supabase tables or API
- [ ] On send screen: "Attach Product" → browse products matching customer's interests
- [ ] Product link or image appended to message
- [ ] Smart suggestion: customer interested in "Necklaces" → necklace products surfaced first

---

## 13. Future Roadmap

| Feature | Notes |
|---------|-------|
| `{rate_24kt}` in templates | ✅ Live — pulled from `daily_rates` table at send time |
| Photo sharing | Requires WhatsApp Business API — wa.me cannot attach files |
| Broadcast to interest groups | Requires API — plan budget ~₹2,500–5,000/month (AiSensy/WATI/Interakt) |
| Product catalog app | Separate build — jewellery items tagged by design/weight/type/metal |
| Smart product recommendations | Customer interest in "Necklaces" → app surfaces necklace products on send screen |
| Customer self opt-out | Add phone-based opt-out page (customer texts a keyword or visits a link) |
| Communication analytics | Which templates sent most, which customers most engaged, last contacted report |
| QR code generator | Auto-generate QR for `/enroll` URL — print on receipts/cards |

---

## 14. Known Constraints

| Constraint | Detail |
|-----------|--------|
| No auto-send | wa.me links open WhatsApp with prefilled text — salesman must press Send inside WhatsApp |
| No broadcast | One customer at a time — each requires a separate tap and WhatsApp open |
| Text only | wa.me cannot attach images, PDFs, or any media |
| Delivery tracking | No read receipts or delivery confirmation — log is optimistic |
| No API | WhatsApp Business API not in scope for Phase 1 |
| Phone format | Store 10-digit only; always prepend `91` in wa.me links |
| Thread continuity | If customer is not in the salesman's contacts, WhatsApp opens a new chat. If saved as contact, it threads into the existing chat. |
| Log accuracy | Log entry created on "Open WhatsApp" tap. Salesman may choose not to press Send after — no way to detect this. |

---

*Document created: 12 May 2026 — last updated: 13 May 2026*
*Project folder: `C:\Users\spand\Desktop\Management Software\mnap-connect`*
*Supabase project: shared with MNAP — `tqnirshwiqpwbqdcrgbr`*
*Migrations: see `MNAP_CONNECT_MIGRATIONS.md`*
