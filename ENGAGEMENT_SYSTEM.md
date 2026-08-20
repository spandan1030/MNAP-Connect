# MNAP Connect — WhatsApp Engagement System

*Current-state reference + roadmap for the live two-way WhatsApp engagement layer,
plus the Catalogue / Inventory / Purchase operations modules (section 6).*
*Last updated: 17 June 2026.*

> **Scope note (updated 2026-07-19).** This doc covers the **WhatsApp engagement layer and the
> Catalogue / Inventory / Purchase modules**, and is current for those. It predates the
> audience engine — for **audiences, features, rules, calling and lead-gen**, and for the
> migration log generally, `MNAP_CONNECT_REFERENCE.md` is now the system of record and is kept
> current after every change. (The older claim that this file supersedes that one no longer
> holds; the `wa.me`/"no API" sections it referred to have since been corrected there.)

---

## 1. Infrastructure

| Piece | Where | Purpose |
|---|---|---|
| WhatsApp API client | `lib/whatsapp/api.ts` | `sendTextMessage`, `sendImageMessage`, `sendTemplateMessage`, `sendInteractiveButtons`, `sendInteractiveList`, `getMediaDownloadUrl`, `downloadMediaBuffer`, `verifySignature` |
| Inbound webhook | `app/api/whatsapp/webhook/route.ts` | Verifies Meta signatures; ingests inbound messages + delivery/read statuses; **runs the conversation engine** |
| Outbound send | `app/api/whatsapp/send/route.ts` | 1:1 send (text or approved template); clears `needs_agent` |
| Media send | `app/api/whatsapp/send-media/route.ts` | Image reply from the inbox |
| Broadcast | `app/api/whatsapp/broadcast/route.ts` | Topic-segment broadcast (Type A) |
| Inbox UI | `app/messages/`, `app/messages/[phone]/` | WhatsApp-style threads, realtime, status ticks, image send/receive, in-chat tools |
| Engagement admin | `app/admin/engagement/` | Edit all bot copy (gear icon, top-right) |
| Config | `WHATSAPP_CONFIG.md` + `.env.local` / Vercel env | verify token, phone number id, app secret, access token, `SUPABASE_SERVICE_ROLE_KEY` |

**Key env requirement:** `SUPABASE_SERVICE_ROLE_KEY` must be set in Vercel — the webhook uses
the service-role client to bypass RLS for auto-enroll/auto-reply.

### Database (migrations `wa_004` … `wa_013`)
| Table / column | Migration | Purpose |
|---|---|---|
| `wa_threads` | `wa_004` | One row per phone; `customer_id`, `last_message_*`, `unread_count` |
| `wa_messages` | `wa_004` (+`wa_006` media) | All messages, `direction`, `wa_message_id`, `status`, `message_type`, `media_url` |
| `wa-media` storage bucket | `wa_006` | Inbound/outbound images, bot/offer images |
| Meta template fields on `wa_message_templates` | `wa_007`, `wa_008` | `meta_template_name/lang/variables`, `header_type/header_image_url` |
| `enrolled_via` allows `whatsapp`, `import` | `wa_009`, `wa_010` | Auto-enrolled inbound contacts; imported buyers |
| `wa_bot_messages` | `wa_010` | **Editable bot copy** (key → content + optional image) |
| `wa_threads.bot_state`, `wa_threads.needs_agent` | `wa_010` | Bot state machine + "needs a human" inbox flag |
| `wa_lead_captures` | `wa_010` | Captured conversation signals (intent, metal, product, wants_designs) — analytics |
| Bot copy seeds + scheme/offers/exchange | `wa_011`, `wa_012` | Default editable messages |
| **Topic taxonomy sync** | `wa_013` | Renames + child topics so the bot tags real topics |

---

## 2. The conversation engine (rules-based, no AI)

All in `webhook/route.ts`. **Stateless taps** (each button id encodes its path) + a small
**`bot_state`** on the thread for the cases that need memory.

### Dispatch order (what an inbound message becomes)
1. `bot_state = with_agent` → **stay silent** (a human owns the chat; even "hi" is ignored)
2. **flood guard** (`maybeThrottle`) → over `FLOOD_PER_MIN` (15) inbound in 60s: one "please hold" as they cross, then silent. Placed after stop/dnd so opting out always works.
3. **product enquiry** (`hasProductRef`: a `/product/<id>` link — from the app's Enquire/Share button — or a typed `MN…` design code) → **live itemised price** (`handleProductEnquiry`); human follow-up flagged in the background. Before #4 because the Enquire prefill also contains "interested".
4. app product-interest (shared link / "interested", no resolvable piece) → note + hand to a human + shop link
5. interactive tap → `handleFlowReply`
6. `bot_state = awaiting_care` → the typed message is their question → hand to a human
7. **PIN reset** (`isPinReset`, from the app's Forgot-PIN prefill) → warm ack + human handover (only the store can reset a PIN)
8. **purchase query** (`isPurchaseQuery`, from the Bill Summary "Contact us" prefill "…about my purchase") → ack + human handover
9. greeting (`hi/hello/namaste/…`) → welcome menu
10. `rate`/`bhav` → today's rate (+ live-rate page link)
11. **price/cost** (`isPriceQuery`, incl. `kitna`/`daam`, *no* specific piece) → today's rate + calculator + shop links + "send a photo to quote"
12. `offer`/`sale` → offers menu
13. `scheme`/`savings` → Gold Savings Scheme (+ scheme page link)
14. **"more"/"send more"/"aur"/"next"** (`isMoreDesigns`) → more designs, **shuffled** so a repeat varies; keeps any category named ("more rings")
15. **a specific item name typed** (`guessCategory` → any synonym/language/typo) → **recommend that category directly** (no metal re-ask); matched → cards, unmatched → "team will share" + shop
16. **generic** `design`/`collection`/`jewellery` with no item named (`isGenericDesignRequest`) → metal → item funnel
17. **anything else → `handleFallback`**: real-looking question (`?` or ≥6 words) → human + shop; else browse-ish (`isBrowseIsh`) → latest designs + shop; else welcome menu

**Dedup:** `alreadyHandled(msg.id)` drops Meta webhook redeliveries (no double enrol / double reply).

**Typo tolerance:** rate/offer/scheme/price matchers add a Levenshtein-≤1 fuzzy pass (`fuzzyHas`, tokens length ≥5 only, so "dear sir" never becomes an offers hit); category matching has its own typo pass in `canonicalCategory`.

**Live price responder (`handleProductEnquiry`):** resolves each `/product/<id>` link and `MN…` design code to OUR `wa_products` row (`show_in_app` only; message-pasted weights are never trusted), computes the breakup inline — `metal = weight × ₹/g(today's daily_rates); making = metal × (making_percent ?? 9%); + ₹50 HUID; + 3% GST` (mirrors customer-app `lib/price.ts` so chat and app never disagree) — and replies with an itemised total. **Multiple** pieces → a line each + grand total. **14K/9K/silver/diamond** (no live per-gram rate) → "price on request" + handoff. Indicative-price disclaimer always appended. **After pricing, suggests similar designs** (same item type + metal, excluding the enquired piece[s]).

**Default making = 9%** (`DEFAULT_MAKING_PERCENT`, in both `webhook/route.ts` and `lib/catalogue-sync.ts`): a piece with no `making_percent` is priced at 9% making — in the chat quote AND, via the sync default, on the app's product page/calculator (existing published rows need a **catalogue "Resync app"** to pick it up; new/edited ones auto-sync).

**Matched suggestions (`suggestProducts({categoryName, metal, excludeIds, intro})`):** because item names are LOCAL (`SHORT HAR`, `CHURI`, `JHUMKA`, `TOPS`, `BALI`, `KADA`, `BALA`, `MS LOCKET`…), matching is by **canonical category**, not string stem. `CATEGORY_SYNONYMS` maps every category to its English + Hindi/Odia + misspelling variants; `canonicalCategory()` (exact word/phrase match, then a typo-tolerant pass on synonyms ≥5 chars — so "ring" is exact-only and "bring" never matches) resolves both the request and each product's `item_name` to the same canonical; `categoryMatches` compares them. `productMetal` filters gold/silver/diamond (diamond wins its gold mount). In-stock ranked over catalogue-only (`shuffle` randomises for "more"); up to 2 cards; **never an off-category piece** — an unmatched ask closes with "our team will share those designs" + complete-collection link, so **an item request is always routed to the app** even with no stock. Canonical keys include categories with no stock yet (anklet/`payal`, nosepin/`nath`) so those requests are still recognised and routed. **To teach a new word, add it to a `CATEGORY_SYNONYMS` list.** Used by: a typed item name (recommend directly), the designs funnel pick, the "more designs" intent, and the post-enquiry "similar" suggestion.

**Abuse guards:** `alreadyHandled` (redelivery dedup) + `maybeThrottle` (≤15 automated replies/min per number; one "please hold" + shop link as they cross, then silent — staff still receives everything). Stronger, cross-instance limiting (Upstash) remains in `SECURITY_HARDENING_BACKLOG.md` F1.

**App deep links (all PUBLIC, no login):** `APP_LINKS` builds `/shop`, `/product/<wa_products.id>`, `/gold-rate-in-rourkela`, `/calculator`, `/home?schemeIntro=1` off `CUSTOMER_APP_PUBLISH_URL` (fallback `gold.mnalankarpalace.com`). `sendBotWithCta()` appends the link line to editable copy so copy stays owner-editable while the link is always code-correct. Free-form/image sends are fine because every reply is inside WhatsApp's 24h service window.

### The flow (built around 4 real customer needs)
```
Welcome: [Today's Rate] [Offers & Sale] [More options]
  More options (list): Today's Gold Rate · Offers & Sale · New Designs ·
                       Gold Savings Scheme · Talk to our team

Today's Rate → sends rate → [Offers & Sale] [New Designs] [Talk to our team]

Offers & Sale → [Offers] [Gold Exchange/Cash] [Talk to our team]
   Offers           → offer message
   Gold Exchange/Cash → [Gold Exchange] [Instant Cash] [Talk to our team]
        Gold Exchange → exchange message  (flags a rep)
        Instant Cash  → cash message      (flags a rep)

New Designs → metal [Gold/Silver/Diamond] → item type (list) →
              (tap) → sends up to 2 pieces MATCHED to that category+metal
              STRAIGHT AWAY (no "shall we send designs?" step), flags a rep;
              no match → "team will share those designs" + complete-collection link

Gold Savings Scheme → scheme message (flags a rep) + scheme page link

Product enquiry (Enquire button link / MN-code, any time) →
              live itemised price breakup (+ grand total for several), rep flagged,
              then "you may also like" → similar designs (same item type + metal)

Talk to our team (on every step) → "type your question" → handed to a human, bot goes silent
```

### Principles enforced
- **Tapping, not typing** — every choice is a button (low-tech friendly).
- **One message per step** — calm, not spammy.
- **Self-serve first, not "team will get back"** — terminal replies carry an app deep link (and, where it fits, real product cards) so the customer can act now; the human handoff still fires in the background where a person adds value (scheme/exchange/cash/PIN/purchase).
- **Always reply** — unrecognised text is triaged (`handleFallback`): a real question goes to a human, otherwise the menu.
- **Human handover is sticky** — once `with_agent`, the bot stays out; greetings don't restart it.
- **Staff control** — a `BOT ON/OFF` toggle in the chat header pauses/resumes auto-replies.
- **Editable copy** — every message lives in `wa_bot_messages`, edited from the Engagement admin page (text + optional image where WhatsApp allows it).

---

## 3. Topics are the single source of truth

This is the backbone that keeps the conversation and the **Send module** in sync.

- Every interest the bot captures is tagged as a **topic** (`wa_interest_topics` →
  `wa_customer_interests`), using the **most specific** topic:
  | Choice | Topic tagged |
  |---|---|
  | Today's Rate | Daily Rates |
  | Offers | Sale & Discounts |
  | Gold Exchange | Gold Exchange |
  | Instant Cash | Instant Cash |
  | Gold Savings Scheme | Gold Savings Scheme |
  | New Designs → product | New Designs + the product child (Necklaces, Rings, …) |
- **Taxonomy (after `wa_013`):** `Daily Rates` · `New Designs → [products]` ·
  `Offers → [Sale & Discounts, Gold Exchange, Instant Cash]` · `Gold Savings Scheme` ·
  `Repair & Service`.
- **Banner:** the "Interested in:" line in each chat reads the tagged topics (+ the metal
  attribute), so it shows the *specific* interest, not just the master header.
- **Send module:** because everything is a topic, any captured interest is immediately
  broadcastable. A child-tagged customer is also caught under the parent filter.
- **Metal** (Gold/Silver/Diamond) is a captured *attribute* (on `wa_lead_captures`), shown in
  the banner but intentionally **not** a topic (avoids topic bloat).

**Rule going forward:** never invent a parallel "interest" store. If the bot should capture a
new signal, it should map to a topic.

---

## 4. Roadmap

### 4.1 Thank-you-for-purchase broadcast (in progress)
Send a thank-you to buyers uploaded from the daily sales report.
- **Per-product** thank-you messages (not one-size-fits-all); default message when no product.
- **Three input methods:** Excel (phone, product) · comma-separated phones (default message) ·
  single phone + product.
- **Hard constraint:** business-initiated messages to people who haven't messaged in 24h
  **must use Meta-approved templates** — owner registers the template in Meta and mirrors it
  in the app. Image optional.
- A **thank-you product list** managed in settings, **separate** from the design topics.
- Imported buyers are auto-added to the customer book (`enrolled_via = 'import'`).

### 4.2 Visual Flow Builder (planned — biggest single feature)
Move the conversation **structure** out of code into the database + an in-app builder, so the
owner can create/edit flows, branches, and messages without code. Phased:
1. Engine reads the flow from DB (behaves identically).
2. Read-only flow map in the app.
3. Edit messages/labels on existing nodes.
4. Add/remove options & branches.
5. Action toolbox (`send message`, `go to step`, `send today's rate`, `tag interest`,
   `note choice`, `hand to representative`) + validation + a Preview/Test mode.

Data model (design): `flow_nodes` (message, render type buttons/list) + `flow_options`
(label, `next_node_id`, action). **WhatsApp guardrails** the UI must enforce: buttons ≤ 3,
list rows ≤ 10, labels ≤ 20 chars, no dead-ends, no blank messages.

### 4.3 ⭐ Topic ↔ Flow-node linking (design locked, build with the builder)
**Goal:** the owner creates a topic in the app (e.g. "Instant Cash") and **links it to a chat
option** so that tapping the option captures the signal — *without any code change or asking
Claude.*

**Design (the linchpin):**
- `flow_options` carries a **`topic_id`** foreign key to `wa_interest_topics`.
- The node editor shows a **"Tags interest → [dropdown of existing topics]"** on each option.
- The engine auto-tags `option.topic_id` whenever that option is tapped — one rule, every option.
- Renaming a topic updates everywhere (same row by id); deleting safely clears the link.

**Why it stays clean & in sync:** one taxonomy (topics), referenced by id everywhere —
conversation, banner, Send module, segments. No second copy of the truth → nothing can drift.
Adding "an option that captures a new signal" becomes: *create topic → add button → pick topic
in dropdown* (three taps, all in-app).

**Build note:** design `flow_options` with `topic_id` from day one so this "just works" when the
builder lands — no rework. Today's topic re-anchoring (`wa_013`) is the foundation for this.

### 4.4 Reduce prompt-dependence
The flow builder + topic-linking + the existing editable bot copy together remove the need to
ask Claude for routine structure/copy/topic changes. Target end-state: the owner runs the whole
engagement system from the app UI; Claude is for new capabilities, not edits.

### 4.5 Type B (Intervention CRM) activation — later
The segmentation/profiling layer exists but is inert. Highest-value unbuilt piece: the
**Salesman Daily Dashboard** ("today's 10 actions"), journey triggers (dormant, scheme maturity,
occasion), and segment campaigns. See `INTERVENTION_STRATEGY.md`.

---

## 5. Key source files
| File | Purpose |
|---|---|
| `app/api/whatsapp/webhook/route.ts` | Inbound webhook + the conversation engine |
| `lib/whatsapp/api.ts` | All Meta Graph API calls |
| `app/messages/[phone]/page.tsx` | Conversation view + in-chat tools (templates, interests, BOT toggle, "Interested in" banner) |
| `app/admin/engagement/page.tsx` | Editable bot copy |
| `app/send/page.tsx`, `broadcast/route.ts` | Type A send + topic broadcast |
| `supabase/migrations/wa_004 … wa_013` | Messaging, media, templates, bot copy, state, leads, topic sync |

---

## 6. Catalogue, Inventory & Purchase (operations modules)

Internal stock + buying tools for salesmen. All `wa_`-prefixed, RLS on, mobile-first.
This is separate from the customer-engagement layer above; it shares the same Supabase
project, `wa-media` bucket, and navigation.

### 6.1 Catalogue (`/catalogue`, `/catalogue/new`, `/catalogue/[id]`)
- **One product = one physical piece** (`wa_products`): `item_name`, `barcode`, `weight`,
  `purity`, `design`, `description`, `party`, `notes`, `is_active`, **`is_sold`**,
  **`needs_review`** (QC), timestamps.
- **Photos** (`wa_product_images`): many per product; `sort_order`, **`is_primary`**,
  **`thumb_url`**. Stored under `products/{id}/` in `wa-media`.
- Capture: camera + gallery, **two-phase** (details first or photos first). Client-side
  compression to ~1600px JPEG **plus an auto-generated ~320px thumbnail**
  (`lib/image.ts: compressWithThumb`); 30 MB raw cap.
- **Primary image** = grid thumbnail **and** the default Share image. First photo becomes
  primary automatically; deleting the primary promotes the next.
- **Managed values** (`wa_catalogue_options`): allowed values per field
  (item_name/design/description/purity/party) power typeable dropdowns; newly-typed values
  auto-register. **Values manager** (`/catalogue/values`) lists unique values, drills to their
  products, and **renames/merges** — a rename re-tags *every* product carrying that value
  ("live" → "leaf" reclassifies all). Common purity values seeded (22K/18K/24K/…).
- **Quick preview** (`PreviewModal`): an eye button on each card opens photos + key details
  without entering edit mode.
- **Share to customer** (`ShareSheet` → `app/api/whatsapp/share-product/route.ts`): pick a
  contact (top-recent / search by name·phone / interest filter) → primary photo + caption →
  send. DnD/opt-out guard; only delivers inside the 24-hour window.
- **Add to purchase plan** (`AddToPlanSheet`): from a product, add it to the plan with one or
  more weight buckets + qty (tops up if the plan already has that bucket).

### 6.2 Scaling the catalogue (built for 5,000+ products)
- **Server-side pagination** — 48/page via `.range()` + **infinite scroll**
  (IntersectionObserver). Never loads all rows into the browser.
- **DB-side filtering & search** — status, item/design/description/purity/party, weight
  range, and the search box all run as Supabase queries; exact `count` for the item total.
- **Debounced** search + weight slider (300 ms) so one query fires after input settles.
- **Thumbnails only** for the visible page (primary photo, small `thumb_url`),
  `loading="lazy"` + `decoding="async"`. Older photos with no `thumb_url` fall back to the
  full image.
- **Indexes** (`wa_022`): btree on filter/sort columns, a partial index for primary photos,
  and **pg_trgm GIN** indexes so `ILIKE %text%` search stays fast.
- Saved filter persists in `localStorage`; weight slider is non-linear (finer over 0–50 g).

### 6.3 Inventory report (`/catalogue/inventory`)
Live, read-only "what's on the shelf." **In-stock pieces only** (active, not sold), grouped
**Item → Design → Description + Purity** (nested drill-down) with **piece counts + total
weight**, down to individual pieces. Derived entirely from `wa_products` — no separate stock
numbers to reconcile; mark a piece Sold anywhere and it drops out automatically.

### 6.4 Purchase plan (`/purchase`) — strategy
**A reusable plan layered on the catalogue, not a hand-typed list.**
- Rows **auto-seed** from existing catalogue combos (item·design·description·purity) — no
  manual entry. Columns = **weight buckets** (whole grams, pieces rounded to nearest g). Each
  cell shows **live Stock**, a **Need** you set (= how many to buy), and **Bought**.
- **Three modes** + a searchable **item-name funnel filter**:
  - **Plan** — set the reusable Need per bucket; `+ wt` adds a bucket, `+ Add line` adds
    not-yet-stocked items (stock 0).
  - **Buy** — pick the **party** you're visiting, then `+/-` records pieces bought **from that
    party**; cells are **colour-coded** by Bought vs Need (grey none / amber under / green met
    / red excess) — nothing hides when complete.
  - **By party** — pieces + **approx weight** bought per party (= Σ pieces × bucket). A rough
    buying helper; the catalogue stays the real in-stock source of truth.
- **New round** clears all Bought counts but keeps the plan (Need values) — reuse every cycle.
- Tables: `wa_purchase_requirements` = the plan cells (one per item·design·description·purity·
  bucket, with `qty_needed`); `wa_purchase_lines` = pieces bought per `(requirement, party)`.

### 6.5 Navigation
Bottom bar: **Messages · Send · Customers · Catalogue · Templates · More**. The **More**
popup holds **Purchase · Prospects · Topics · Segments**. Top bar: thank-you broadcast +
engagement-settings icons.

### 6.6 Operations migrations & key files
| Migration | Adds |
|---|---|
| `wa_014` | thank-you products + Purchased topic |
| `wa_015` | `wa_customers.dnd` (STOP opt-out) |
| `wa_016` | `wa_products`, `wa_product_images` |
| `wa_017` | `is_sold`, `needs_review` |
| `wa_018` | `description` (notes→description) + `wa_catalogue_options` |
| `wa_019` | `wa_purchase_requirements` |
| `wa_020` | `weight_bucket` + `wa_purchase_lines` |
| `wa_021` | `is_primary` on images |
| `wa_022` | catalogue indexes (+ enables `pg_trgm`) |
| `wa_023` | `thumb_url` on images |

| File | Purpose |
|---|---|
| `app/catalogue/page.tsx` | Paginated, server-filtered grid + preview/share entry points |
| `app/catalogue/new`, `app/catalogue/[id]` | Add / edit product, photos, primary, status |
| `app/catalogue/values/page.tsx` | Managed-values viewer + rename/merge |
| `app/catalogue/inventory/page.tsx` | In-stock nested drill-down report |
| `app/purchase/page.tsx` | Plan / Buy / By-party grid |
| `lib/catalogue.ts` | Options fetch/add + `renameCatalogueValue` |
| `lib/image.ts` | `compressImage`, `compressWithThumb` (full + thumbnail) |
| `components/catalogue/ShareSheet.tsx`, `AddToPlanSheet.tsx`, `PreviewModal.tsx` | Catalogue sheets/modals |
| `app/api/whatsapp/share-product/route.ts` | Send a product photo + caption to a customer |
