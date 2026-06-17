# MNAP Connect — Intervention Module Discussion
*Started: 13 May 2026*

> **Scope:** historical decision log for the Type B module — kept for rationale/context. For
> current rules see `INTERVENTION_STRATEGY.md`; for the doc index see `README.md`.

---

## What We Are Building Toward

MNAP Connect will serve two behaviorally distinct customer types. They must never be conflated.

---

## The Two Customer Types

### Type A — Daily Rates Customers
- Only want to know today's gold rate
- No interest in personalized outreach, new designs, offers, or follow-ups
- Communication is one-directional and predictable: rate goes out, nothing else
- **Module:** The current send module — keep it exactly as is

### Type B — Intervention Customers
- Active prospects or buyers on a journey toward a purchase
- Open to personalized communication — new designs, schemes, occasion reminders, rate alerts
- Require a salesman to understand their situation and profile them
- **Module:** A new intervention module, built separately

---

## Agreed Decisions

- Keep the two modules completely separate for now
- The daily rates send module stays exactly as built
- Type B has a separate enrollment form from Type A
- The profiling form is flexible and signal-responsive — not a rigid staged form
- Segmentation is business-rules based — fully auditable, no black boxes
- Admin has a visibility module to audit how customers are being segmented
- Merging Type A and Type B is a future consideration, not now

---

## Session 2 — Ground Intelligence: Who Are the Customers?

*13 May 2026*

The following is direct operational intelligence from the business owner. This shapes the segment definitions, profiling questions, and intervention playbooks.

---

### 1. Lightweight Jewellery Is the Market Reality

Lightweight is not a sub-category — it is the dominant preference across all customer types. Even bridal customers prefer lightweight ornaments. The recent gold rate spike has reinforced this: customers are getting less weight for the same money, and are choosing lighter pieces to stay within budget.

**Implication for segmentation:** The Bridal Journey segment cannot be defined by high budget or heavy jewellery expectations. A ₹40k–₹75k lightweight bridal customer is a real and common profile. Budget range alone does not determine bridal intent.

**Implication for templates:** All communication, including bridal messaging, should lead with lightweight and design quality — not weight or grandeur.

---

### 2. Gold Rate Spike Has Compressed Budgets

The recent sharp rise in gold rates has made most customers budget-conscious. Customers who would have bought in one visit are now waiting, comparing, or splitting purchases. This has pushed more customers toward schemes as a way to manage the cost.

**Implication for interventions:** Rate-sensitive communication is now relevant across almost every segment, not just the Rate Sensitive segment. Even bridal and occasion customers need rate-aware messaging.

**Implication for the Rate Sensitive segment:** This is likely the largest single segment right now. Scheme adoption is growing. These customers need the most active and timely interventions.

---

### 3. Schemes Are a Customer Type, Not Just a Payment Behavior

Customers are actively moving to SIP, gold deposit schemes, and similar products as their primary mode of buying. This is not just a payment preference — it changes the entire relationship structure:
- They visit the store regularly (scheme installments)
- They are relationship-deep over time
- The intervention at scheme maturity is the highest-conversion moment
- Scheme customers are also excellent candidates for upgrade and referral

**Decision:** Scheme Customer is a standalone primary segment, not just a secondary tag on Rate Sensitive.

---

### 4. Two Distinct Loyalty Types Exist

**Frequent comparers:** These customers continuously benchmark against competitors. They ask for prices, compare making charges, and bargain. They are not disloyal — they are simply price-driven. The right intervention is value framing, not matching competitor prices.

**Long-time loyalists:** These customers have a relationship with the store built over years. They trust the owner and salesman. They are resistant to competitor switching but respond strongly to feeling recognized and valued. They are the most powerful referral source.

**Implication:** Competitor association needs to be tracked with nuance — a frequent comparer is different from someone who is genuinely considering switching. Both need different approaches.

---

### 5. Social Media Leads Are a New and Growing Channel

A small but growing number of leads come from Instagram and other social platforms. These customers:
- Have no prior relationship or trust with the store
- Are often drawn by a specific design or post
- Need trust-building before product conversation
- Have higher drop-off risk if not followed up quickly

**Implication for enrollment:** First contact source = Social media should trigger a different early-stage intervention sequence. First communication should establish credibility, not push product.

**Implication for profiling:** Social media leads may need a lighter enrollment form initially — collecting too much information too early from a cold lead increases drop-off.

---

### 6. Discount and Bargaining Behavior Is Widespread

Many customers are hard bargainers. They continuously ask for discounts on making charges and price. This is a market-wide behavior, not a niche segment — but the degree varies.

**The right response is not discounting.** Giving discounts trains customers to expect them and erodes margin. The correct intervention is value framing: craftsmanship, purity certification, making charge transparency, long-term trust, after-sales service.

**Implication for templates:** All communication for bargain-driven customers should position the store on value, not price. Messaging around BIS hallmarking, quality, and relationship should be developed as a specific template set.

**Implication for the intervention dashboard:** When a salesman marks a customer as discount-driven, the system should surface value-framing templates — not discount offers.

---

### 7. New Design Interest Is a High-Engagement Trigger

Customers continuously ask for new designs. This is one of the strongest behavioral signals of active buying intent. A customer who is regularly asking "do you have anything new?" is not just browsing — they are in a pre-purchase mindset waiting for the right piece.

**Implication for interventions:** New arrival alerts are a high-conversion communication type. Customers who have expressed design interest should be the first notified when new stock arrives in their category.

**Implication for profiling:** "Asks about new designs regularly" should be a trackable engagement signal in Section D (Relationship Temperature).

---

### 8. Trust and Relationship Are the Core Purchase Driver

Jewellery buying is fundamentally a trust and relationship business. Customers who feel well-treated, remembered, and respected will return — regardless of minor price differences. Customers who feel ignored or transactionally handled will leave regardless of competitive prices.

**Implication for the intervention engine:** No communication should ever feel automated or impersonal. Every message should feel like it came from someone who knows the customer and is thinking of them specifically.

**Implication for salesman behavior:** The daily dashboard should always give the salesman enough context about the customer (last interaction, what they talked about, what they're looking for) that the communication feels personal, not scripted.

---

## Revised Segment Thinking (Based on Ground Intelligence)

The original 7 segments are revised as follows:

| Original | Status | Reason |
|---|---|---|
| Competitor Acquisition | ✅ Retained | Still critical — two sub-types now noted (price comparer vs. relationship-elsewhere) |
| Hot Buyer | ✅ Retained | Unchanged |
| Bridal Journey | ⚠️ Redefined | Cannot be defined by high budget. Lightweight bridal is the norm. |
| Rate Sensitive | ✅ Retained | Likely the largest segment right now |
| Festival & Occasion Buyer | ✅ Retained | Unchanged |
| Daily Wear Explorer | ✅ Retained | Likely the highest volume category |
| VIP / Relationship Customer | ✅ Retained — elevated priority | Long-time loyalists are the most valuable and underutilized asset |
| **Scheme Customer** | 🆕 Added | SIP/gold deposit customers are a distinct relationship type |
| **Social Media Lead** | 🆕 Added | Cold leads from Instagram need trust-first interventions |
| **Discount Seeker** | 🆕 Noted | Not a primary segment — but a secondary tag that changes intervention tone |

---

## Session 3 — Threshold & Conflict Decisions

*13 May 2026*

### Rate Drop Threshold — Decided
₹300 per gram drop from the monthly average = major drop. This triggers alerts for Rate Sensitive and Exchange Candidate customers. Minor daily fluctuations do not trigger alerts. The monthly average is the baseline, not the previous day's rate.

### Dormant Timing — Decided (Per Segment)
Dormant thresholds are tied to purchase urgency, not a single number:

| Segment type | Segments | Dormant after |
|---|---|---|
| Immediate buyers | Hot Buyer | 30 days |
| Planned purchasers | Bridal Journey, Rate Sensitive, Scheme Customer, Festival & Occasion, VIP | 60 days |
| Cold leads | Daily Wear Explorer, Social Media Lead, Competitor Acquisition, Unqualified Prospect | 90 days |

Cold leads still get a quarterly reconnect — they are not abandoned, just on a longer cycle.

### Bridal + Scheme Conflict — Decided
- Bridal customer WITH active scheme → stays Bridal Journey. The scheme is the funding vehicle for the purchase. Interventions include scheme progress + bridal collections.
- Bridal customer WITHOUT scheme → stays Bridal Journey + Scheme Candidate tag. An early intervention promotes starting a scheme as a financial planning tool specifically for the wedding purchase. Framing: "Most families planning a wedding find a monthly scheme helps them reach their jewellery budget without the pressure of one big payment."

### Design Seeker Overlap — Decided
"New Design Seeker" removed as a broad tag — everyone wants new designs, it means nothing as a differentiator. Replaced with:
- **New Arrival Subscriber**: product affinity selected + explicit opt-in to new arrival notifications in Section B → receives new arrival alerts for their specific categories only
- **Repeated specific design inquiry**: captured in Section E as an engagement signal (must be specific and repeated, not a casual "anything new?" question) → moves customer toward Hot Buyer territory

## Session 4 — Remaining Decisions

*13 May 2026*

### Festival Buyer vs. Rate Sensitive — Decided
If a customer has an occasion (festival, gift, family) AND is also rate-sensitive, Festival & Occasion Buyer is the primary segment. The occasion is the emotional driver and creates a deadline — that takes precedence. Rate Sensitive becomes a secondary tag, and rate intelligence is woven into the festival messaging contextually: "With the festival approaching and rates at X, this may be a good time."

### Social Media Hot Leads — Decided
Social Media Lead has two tracks:
- **Cold lead**: Day 1 / Day 3–5 / Day 10 trust-building sequence. No product push until engagement signal appears.
- **Hot lead**: If a social media lead shows strong buying signals at first contact (planning stage, asked pricing, stated occasion), skip the trust sequence entirely. Immediately re-evaluate segment rules and promote to Hot Buyer or Bridal Journey. Dashboard flags for follow-up within 24 hours. Tone stays warm but interventions are accelerated to close the opportunity before it cools.

The Social Origin tag stays on the customer permanently so the salesman always knows context.

### Scheme Tracking — Decided
Schemes are tracked manually within MNAP Connect. No external system integration. Salesman marks the customer as a scheme customer and enters three fields: start month/year, tenure in months, monthly installment amount. The system computes maturity date and fires alerts at 30/14/7 days before maturity. Accuracy depends on the salesman entering correct details and updating if the customer modifies their scheme.

### VIP Segment — Decided (Major Change)
VIP is not algorithm-determined. Loyalty is a relationship quality the salesman recognizes from experience — no rule can reliably detect it from form answers. **VIP is manually assigned by the salesman** at enrollment or from the customer profile at any time.

Two sub-types — salesman selects one:
- **Long-time Loyalist**: Customers who have been choosing MNAP exclusively for years. Deep trust. Don't compare. Come back without prompting. Salesman knows them by name.
- **New Exclusive Customer**: Customers who have recently started choosing MNAP exclusively. Not years of history yet, but clearly committed. Goal is to reinforce the choice and accelerate them into Long-time Loyalist territory.

Assignment is logged (who assigned it, when, which sub-type). Admin can view, override, or reclassify.

### Remaining Questions — Closed

**Rate Sensitive + active scheme → Scheme Customer is primary.** The scheme is already managing the customer's rate exposure month by month. Rate Sensitive becomes a secondary tag — rate alerts are still relevant but the scheme relationship dominates.

**VIP dashboard distinction → Yes.** Long-time Loyalist and New Exclusive Customer show different labels and tone guidance on the salesman's action cards. Long-time Loyalist: concierge tone, make them feel remembered. New Exclusive Customer: affirming tone, reinforce their choice.

---

## Strategy Status: Complete

All segment definitions, conflict resolutions, thresholds, and rules are locked.

---

## Session 5 — Communication Architecture & Data Setup Pause

*13 May 2026*

### Decision: Build Data Infrastructure Before Messaging

Before any intervention playbook is written or any messaging is planned, the data capture layer must be built and operational. Messaging designed before the data exists will target wrong customers, fire at wrong times, and produce no signal on what is working.

**Build order confirmed:**
1. Type B customer profile and enrollment (data capture)
2. Segmentation engine (assign customers to segments based on rules)
3. Admin segment visibility module (quality control)
4. Then: communication planning

### Two Types of Communication (Planned for Later)

Two architecturally distinct communication systems will be built. These are documented now so the data layer is designed to support both from the start.

**Type 1 — Journey Communication**
Individual and trigger-based. Fires based on where a specific customer is in their personal timeline. Each customer receives this at a different time depending on their own data.

Examples:
- Scheme maturity approaching (30/14/7 days before that customer's maturity date)
- Wedding in 30 days for a specific bridal customer
- 14 days since last contact for a hot buyer
- Customer moved from comparing to planning stage

Infrastructure needed: trigger rules linked to individual customer data points. Evaluated continuously as customer data updates.

**Type 2 — Strategized Communication**
Segment-level and planned. A campaign designed for a segment, sent at a deliberate moment decided by the owner. All customers in the segment receive it at the same time.

Examples:
- Diwali collection message → Festival & Occasion Buyer segment
- Rate correction alert → Rate Sensitive segment + Exchange Candidate tag
- New bridal launch preview → Bridal Journey segment
- Scheme enrollment push → Scheme Candidate tag holders

Infrastructure needed: a campaign builder — select segment/tag, write or pick a template, schedule the send date. Separate from individual trigger rules.

**Why keeping these separate matters:**
Journey communication is personal — it feels like the store is paying attention to the customer's specific situation. Strategized communication is deliberate — it feels like the store is sharing something relevant to their interest. Both must feel human, not automated. Mixing the two architectures into one system makes both worse.

### Schema Design — Decided

Five tables. Migration file: `supabase/migrations/wa_003_intervention_schema.sql`

| Table | Purpose |
|---|---|
| `wa_b_customers` | Basic record: name, phone, enrolled by, active flag, notes |
| `wa_b_profiles` | All profiling answers (1:1 with customer). Nullable — progressive form means not everything filled at enrollment |
| `wa_b_segment_assignments` | One row per assignment, current and historical. When segment changes: old row marked not current, new row inserted with plain-English reason. Full audit trail. |
| `wa_b_segment_tags` | Secondary tags per customer. One row per active tag. Applied by system or salesman. |
| `wa_b_interactions` | Salesman logs every touchpoint (WhatsApp, call, store visit, note). Feeds dormant detection and journey triggers later. |

**Key design decisions:**
- Segment assignments are versioned rows, not updated in place — admin can see the full history of how a customer moved through segments and why
- Unique index on segment_assignments where is_current = true — enforces one active segment per customer at DB level
- Unique index on segment_tags where is_active = true — prevents duplicate active tags
- Scheme is three fields on the profile (has_scheme, scheme_with, scheme_type) — no separate table, no maturity tracking
- VIP is fields on the profile (is_vip, vip_sub_type, vip_assigned_by, vip_assigned_at) — manual, logged
- Engagement signals are a TEXT[] array on the profile, updated by salesman over time — not locked at enrollment
- Segmentation rules live in code for v1. Admin visibility module reads them and displays in plain English. Rule editor is v2.
- wa_b_customers and wa_customers are separate tables. App warns if phone already exists in wa_customers (Type A). Merging is a future decision.

---

*This document is a living discussion record. Update as decisions are made.*
*Strategy decisions are formalised in INTERVENTION_STRATEGY.md*
