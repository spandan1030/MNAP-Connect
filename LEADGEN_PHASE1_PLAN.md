# Lead-Gen Phase 1 — Features → Audiences → Campaigns

_Planning doc. Created 2026-07-17. Status: **design, not yet built.** Nothing here is built until the build checklist (§9) is approved._

Goal: turn everything we know about a customer (sales + calls + chat + walk-in) into a **modular lead-gen engine** — define audiences once, activate them on any channel (chat / call / ad), report one funnel. Drive **in-store footfall + lifetime value** (hyper-local, never online sales).

---

## 1. Architecture — one setup for ALL audiences (the modularity mandate)

Four layers. A new audience is a **row of data**, never new code.

```
L1 FEATURE STORE  (per phone)
   sales markers (wa_b_markers) · interest signals (wa_signals) ·
   call features (wa_b_call_logs) · walk-in features · journey/cross features ·
   ad-lead features                → one per-phone feature view
        │
L2 AUDIENCE DEFINITIONS  — ONE table `wa_audiences`
   { name, filter(JSON over features), channels[], creative_ref, active }
        │
L3 RESOLVER + MEMBERSHIP  — ONE daily job
   resolveAudience(filter) → phones  (extends lib/reach/resolve.ts)
   → materialise `audience_members`  → apply suppression
        │
L4 ACTIVATION  — ONE shared machine per channel, same resolved audience
   💬 chat  = dispatch loop (exists)      📞 call = calling queue (exists)
   📣 ad    = export upload CSV
   → ONE shared funnel report (sent→delivered→read→replied→converted, 90d)
```

**Consequences**
- **Features never pick a channel; audiences do.** "Ad" = export the audience's resolved phones as an upload list. Same audience runs on chat/call/ad.
- Add audience = insert into `wa_audiences`. UI (Reach pick-list), resolver, suppression, funnel are all generic.
- **Audience library is app-owned** (the app has every feature live). The pipeline keeps computing the sales/call markers it owns and feeds them into the feature store; ad-upload lists are emitted by the app per audience. _(decision D-1, §2 — confirm.)_

---

## 2. Decisions log (answers + rules agreed)

| # | Decision |
|---|---|
| D-conv | **Conversion = a purchase within 90 days** of the touch (matches the existing funnel window). Measured from the sales DB import. |
| D-timing | **Walk-in "planning to buy" is a button** on the walk-in form (customer-stated): `within_7d` / `within_1m` / `1_3m`. Stored as a real field, not a note. |
| D-gov | **Frequency governance:** one channel per person per week; priority **call > walk-in follow-up > chat > ad**; calls have a hard cooldown (below). |
| D-callsupp | **Call suppression:** (a) one no-connect → next attempt **≥ 2 days** later; (b) **3 no-response attempts → stop calling**, set `call_unresponsive` feature, route to chat/ad. |
| D-1 *(open)* | Ad-upload lists **app-owned** (app exports each audience's phones) vs pipeline-owned. Proposed: app-owned for modularity. |

---

## 3. Feature dictionary

Status: ✅ exists · 🔶 derivable now · 🆕 to build. "Feeds" = audience IDs from §5.

### 3A. Sales features (from `wa_b_markers`) — ✅
| Feature | Logic | Feeds |
|---|---|---|
| `recency_tier` | Recent <365d · Active <1095d · Lapsed ≥1095d | A1, A3, A4 |
| `value_tier` / `is_high_value` | percentile (VIP≥90/High≥70/Mid≥40) · gold≥15g OR diamond OR cheque≥₹50k | A1, B2, D1 |
| `frequency_tier` / `is_repeat` | 1/2/3-5/6+ bills · ≥3 | E1, E2 |
| `rfm_segment` | Champion/Loyal/At-Risk/Promising/Dormant/Lost/One-Time-Big | A4, E1, E2 |
| `is_likely_wedding` | mangalsutra OR (necklace+bangles) OR heavy single bill OR clustered gold | C2, D2 |
| `favored_festival` / `is_festival_buyer` | mode festival within ±15d of bills | C3 |
| `likely_investment` | bought coins/bars | C5 |
| `primary_metal` / `bought_<cat>` | mode metal · category keyword hit | C4 (creative), product cuts |
| `is_lookalike_seed` | high-value OR wedding | D1, D2 |
| `lifetime_value` | Σ bill net | D1–D3 (value column) |
| `newly_lapsed` / `reactivated` / `made_new_purchase` | change vs last snapshot | A3, reporting, conversion |

### 3B. Call features (from `wa_b_call_logs` + call_feedback) 
| Feature | Logic | Status | Feeds |
|---|---|---|---|
| `call_reachable` / `call_unreachable` | connected vs tried-never-reached | ✅ | routing |
| `call_will_come` | last intent = will_come | ✅ | A2 |
| `will_come_aging` | days since a will-come, still no purchase | 🆕 | A2 (chat/ads) |
| `call_is_hot` | staff ★ on a call | ✅ | B2, D3 |
| `reactivation_candidate` | call_will_come AND is_high_value | ✅ | A2 |
| `call_recency` / `last_call_at` | days since last call | 🔶 | suppression, aging |
| `no_connect_attempts` / `last_no_connect_at` | count of no-response tries · when | 🆕 | call cooldown (D-callsupp) |
| **`call_unresponsive`** | 3 no-response attempts → true | 🆕 | A5 (route off calls) |
| `call_interest_{rate,designs,offers,booking}` | topic on a connected call | ✅ | interest cuts |

### 3C. Chat features (from `wa_signals` chat, `wa_customer_interests`, `wa_messages`)
| Feature | Logic | Status | Feeds |
|---|---|---|---|
| `sig_<interest>` (chat) | interest declared in chat | ✅ | C1, C4 |
| `sig_high_intent` | any chat/call intent signal | ✅ | B-group |
| `subscribed_<topic>` (e.g. `daily_rate_subscriber`) | row in `wa_customer_interests` | 🔶 | C1 |
| `chat_engaged` / `chat_recency` | has inbound / last inbound date | 🔶 | E3, routing |
| `chat_non_buyer` | chat_engaged AND ≥1 interest signal AND no sales markers **on this number** (soft — may have bought elsewhere; never used to suppress) | 🆕 | E3 |
| `campaign_replied` | inbound reply after a campaign send | 🆕 | journey, follow-ups |

### 3D. Walk-in features (from `wa_b_customers` walkin fields + `wa_signals` walkin)
| Feature | Logic | Status | Feeds |
|---|---|---|---|
| `walked_in` / `walkin_recency` | has `walkin_at` / days since | 🔶 | B1 |
| **`walkin_no_purchase`** | walked in AND no purchase within window | 🆕 | B1 |
| `walkin_timing` | button: within_7d / within_1m / 1_3m | 🆕 (field) | B4 |
| `walkin_occasion` | sig wedding/gift/festival, source=walkin | ✅ | C2, C3 |
| `walkin_vip` | VIP tick (`is_hot_lead`) | ✅ | B2, D3 |
| `walkin_converted` | purchase within 90d of `walkin_at` | 🔶 | reporting/conversion |

### 3E. Journey / cross-source features (derived) — 🆕
| Feature | Logic | Feeds |
|---|---|---|
| `touched_by_{call,chat,ad,walkin}` | any touch on that channel | routing, governance |
| `called_and_replied` | has a call AND a chat reply | journey |
| `call_then_campaign_sent` | campaign sent after a call | sequencing |
| `replied_after_campaign` / `no_reply_after_campaign` | inbound after send / silence | follow-ups |
| `multi_source_intent` | engaged in ≥2 of chat/call/walk-in | B3 |
| **`journey_stage`** | cold → contacted → engaged → intent → visited → purchased (rolled-up) | routing + funnel |

### 3F. Ad-lead features (from WhatsApp webhook capture) — 🆕
| Feature | Logic | Feeds |
|---|---|---|
| `ad_lead` | first inbound carried a Click-to-WhatsApp referral (or tracked link code) | AD1 |
| `ad_campaign` | which ad/campaign (referral `source_id` / link code) — attribution | AD1 (per-campaign) |
| `ad_lead_replied` / `ad_lead_followed_up` / `ad_lead_converted` | funnel of the ad lead | reporting |

---

## 4. Hypotheses (why each audience should convert)

- **H-react:** a lapsed high-value buyer who once spent big will return for a *personal* call, not an ad. → A1 (call).
- **H-willcome:** someone who verbally said "I'll come" but hasn't, needs a *reminder nudge, not another call* (calls irritate). → A2 (chat/ad).
- **H-unresp:** after 3 no-answers, phone is a dead channel — *switch to ad/chat*, stop wasting calls. → A5.
- **H-walkin:** a walk-in who didn't buy is the hottest lead we have — *fast* follow-up (call once, then chat) beats any cold list. → B1.
- **H-timing:** a customer who said "buying within 7 days" is time-boxed — reach within that window. → B4.
- **H-occasion:** wedding/festival intent has a deadline + emotion — beats generic rate messaging; *pre-target 2–3 weeks ahead*. → C2, C3.
- **H-seed:** our hottest/highest-value people are the best *lookalike seeds* to find NEW similar buyers. → D1–D3.
- **H-nurture:** champions/promising respond to low-cost chat (loyalty, 2nd-purchase push) — no ad spend needed. → E1, E2.
- **H-adloop:** an ad lead who DMs us is warm but *unqualified* — a follow-up chat (then call if engaged) converts the ad spend into footfall. → AD1.

---

## 5. Audience catalog

Every row is one `wa_audiences` record. **Ch:** 📞 call · 💬 chat · 📣 ad. All built in the app library; ad = export.

| ID | Audience | Feature logic | Ch | Creative needed |
|---|---|---|---|---|
| A1 | Lapsed high-value winback | `recency=Lapsed ∩ value_tier∈{VIP,High}` | 📞 | call script |
| A2 | Will-come follow-up | `call_will_come ∩ no purchase` (+ `will_come_aging`) | 💬 (📣) | WA template + banner |
| A3 | Newly-lapsed rescue | `newly_lapsed` | 💬 | WA template |
| A4 | At-risk | `rfm=At-Risk` | 📞/💬 | script + template |
| A5 | Unresponsive reactivation | `call_unresponsive ∩ Lapsed` | 📣/💬 | ad creative |
| B1 | Walk-in, no purchase | `walked_in ∩ walkin_no_purchase ∩ recency<window` | 📞→💬 | script + template |
| B2 | Hot-starred leads | `call_is_hot OR walkin_vip` | 💬 (📣 seed) | WA template |
| B3 | Multi-source intent | `multi_source_intent` | 📞 | script |
| B4 | Buying-soon walk-in | `walkin_timing ≤ 30d` | 📞+💬 | script + template |
| C1 | Daily-rate subscribers | `daily_rate_subscriber` | 💬 | (existing daily template) |
| C2 | Wedding / bridal | `is_likely_wedding OR walkin_occasion=wedding OR sig_wedding` | 📣+💬 | bridal banner + template |
| C3 | Festival pre-target | `favored_festival OR sig_festival`, fire T-21d | 📣+💬 | festival banner + template |
| C4 | Design / offer retargeting | `sig_designs / sig_offers` | 📣 | design/offer banners |
| C5 | Scheme / investment | `likely_investment OR sig_scheme` | 💬/📞 | scheme template |
| D1 | High-value lookalike seed | `is_high_value` + value | 📣 | (seed list, no creative) |
| D2 | Bridal lookalike seed | `is_likely_wedding` | 📣 | seed list |
| D3 | Hot-intent lookalike seed | `call_is_hot OR walkin_vip OR multi_source_intent` | 📣 | seed list |
| E1 | Champions / Loyal | `rfm∈{Champion,Loyal}` | 💬 | loyalty/referral template |
| E2 | Promising | `rfm=Promising` | 💬 | 2nd-purchase template |
| E3 | Chat non-buyers | `chat_non_buyer` | 💬 | nurture template |
| AD1 | Ad-lead follow-up (per campaign) | `ad_lead ∩ ad_campaign=<x> ∩ not converted` | 💬→📞 | per-ad follow-up template |

---

## 6. Campaign engine (how ANY audience runs)

1. **Pick** an audience from the library + a channel + a creative.
2. **Daily run** resolves the audience → `audience_members` (fresh matches pulled in for dynamic ones).
3. **Suppression** applied: chat/ad = message ledger (no re-send within the template's window); call = D-callsupp (2-day cooldown, 3-strike `call_unresponsive`); governance = one channel/person/week by priority.
4. **Send** via the channel's shared machine.
5. **Funnel report** — the same sent→delivered→read→replied→converted(90d) + per-recipient drill-down we already have on `/campaigns`, now per audience.
6. **Follow-up chaining** — an ad campaign's leads (AD1) feed a chat follow-up; a call's `will_come` feeds A2. Journey features record the sequence.

**Call button in inbox:** `messages/[phone]` gets a call button; tapping logs a simple call (active salesman, `called_at`, `success=null`) so inbox calls join the journey. _(Chat-only contact → upsert a minimal Type-B row so the log always registers.)_

---

## 7. Ad-lead capture spec

- **Meta Click-to-WhatsApp:** inbound webhook message carries a `referral` object (`source_id` = ad id, `headline`, `ctwa_clid`). Capture in `app/api/whatsapp/webhook` → stamp contact with `ad_lead`, `ad_campaign`, captured_at.
- **Other platforms:** use a per-campaign tracked entry `wa.me/<num>?text=<campaign-code>`; parse the code on first inbound.
- **Registry:** `ad_campaigns` (name ↔ code/ad-id ↔ product/creative) + `wa_ad_leads` (phone, ad_campaign, first_seen, replied, followed_up, converted).
- **Loop:** ad → lead DMs (auto-tagged) → AD1 audience → follow-up chat campaign → funnel → hand hot ones to call. **No lead lost.**

---

## 8. Creatives tracker (skeleton — fill as audiences go live)

| Audience | Channel | Asset (WA template / banner / ad copy) | Status (to-create / in-review / approved) | Notes |
|---|---|---|---|---|
| A2 | chat | template + banner | to-create | WA template needs Meta approval |
| B1 | call+chat | script + template | to-create | |
| C2 | ad+chat | bridal banner + template | to-create | |
| C3 | ad+chat | festival banner + template | to-create | seasonal |
| AD1 | chat | per-ad follow-up template | to-create | one per ad campaign |
| … | | | | |

⚠️ Every chat audience needs an **approved WhatsApp template** before its campaign can run — tracker surfaces this dependency early.

---

## 9. Build checklist (phased — approve before starting)

**P1 — Feature store completion**
- [ ] Compute 🆕 features: `call_unresponsive` + `no_connect_attempts`, `will_come_aging`, `walkin_no_purchase`, `walkin_timing` field, `chat_non_buyer`, journey features + `journey_stage`.
- [ ] One per-phone feature view.

**P2 — Audience library (the modular core)**
- [ ] `wa_audiences` table + generalized `resolveAudience` + `audience_members`.
- [ ] Reach pick-list of saved audiences (pick → run, no re-filtering).
- [ ] Daily resolve job + suppression + governance.

**P3 — Activation + reporting**
- [ ] Chat/call/ad activation off a shared audience; call suppression rules (D-callsupp).
- [ ] Shared funnel report per audience.
- [ ] Ad-upload export per audience (if app-owned, D-1).

**P4 — Ad-lead loop**
- [ ] Webhook referral capture + `ad_campaigns`/`wa_ad_leads` + AD1 follow-up.

**P5 — Inbox call button + simple call log.**

**P6 — Seed the audience catalog (§5) as data + creatives tracker.**

---

## 10. Open questions
1. **Ad lists app-owned?** (D-1) — app exports each audience's phones as an upload CSV, pipeline stops owning audience-building (keeps computing markers). Confirm.
2. **Follow-up cadence vs the 90-day conversion window** — 90d measures *conversion*, but a *follow-up* should fire sooner. Propose: walk-in no-purchase nudge at **day 3–7**; will-come reminder at **day 5–7**; ad-lead follow-up **within 24–48h**. Confirm the timings.
3. **Daily run trigger** — who fires it (cron / manual button) and does the **call** queue also rebuild from the same daily resolve?
4. Any audience in §5 to drop, merge, or reprioritise for the first build?
