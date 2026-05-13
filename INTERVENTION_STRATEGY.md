# MNAP Connect — Intervention Module Strategy
## Final Rules, Setup & Strategy

*Finalised: 13 May 2026 — updated with ground intelligence*

---

## Core Architectural Decision

MNAP Connect serves two behaviorally distinct customer types. They must never be conflated.

| | Type A | Type B |
|---|---|---|
| **Model** | Broadcasting | Behavioral CRM |
| **Module** | Daily Rates Send (existing) | Intervention Engine (to build) |
| **Communication** | Daily commodity update | Contextual decision guidance |
| **Targeting** | Same message, all customers | Personalized by segment |
| **Salesman role** | Tap send, done | Profile, follow up, nudge |
| **Customer posture** | Passive consumption | Active purchase journey |
| **Intervention logic** | None | Business rules, segment-driven |

These are separate modules. Merging is a future decision. Do not conflate.

---

## Market Reality (Ground Intelligence)

These facts about the actual customer base must inform every segment definition, profiling question, and intervention template.

**Lightweight is the baseline, not a sub-category.** The dominant preference across all customer types — including bridal — is lightweight jewellery. The gold rate spike has reinforced this. Customers are buying less weight for the same money and actively prefer lighter pieces. No segment definition, product recommendation, or template should assume heavy jewellery as the default.

**Budget compression is market-wide.** The recent gold rate spike has made most customers budget-conscious. Even customers with high intent are stretching timelines, splitting purchases, or moving to schemes. Rate sensitivity is no longer confined to one segment — it is a background condition for almost everyone.

**Schemes are a customer type, not a payment method.** SIP and gold deposit customers have a structurally different relationship with the store: regular visits, deepening trust over time, and a high-conversion moment at scheme maturity. This is a standalone segment.

**Two loyalty types coexist.** Frequent price comparers (benchmark against competitors, bargain hard, discount-driven) and long-time loyalists (relationship-based, trust-deep, resistant to switching) both exist in significant numbers. They need fundamentally different intervention tones.

**Social media is a new entry channel.** Instagram and social leads are growing. These are cold leads — no prior trust, drawn by a design or post, high drop-off risk if not followed up immediately. They need trust-building before product conversation.

**Discount and bargaining behavior is widespread.** Hard bargaining is common market behavior. The correct response is never a discount — it is value framing. Discounting trains customers to expect it and erodes margin. All communication for price-sensitive customers should position on trust, purity, craftsmanship, and relationship — not price.

**New design requests are a buying signal.** Customers who regularly ask "do you have anything new?" are in a pre-purchase mindset. This is one of the strongest behavioral signals of active intent. New arrival communication is a high-conversion content type.

**Trust and relationship are the core purchase driver.** In jewellery, customers who feel remembered and well-treated return — regardless of minor price differences. Customers who feel transactionally handled leave regardless of competitive pricing. No communication should ever feel automated or impersonal.

---

## Guiding Principles

**On data collection:** Every profiling question must enable segmentation, timing, product recommendation, or intervention behavior. If it enables none of these, it does not exist.

**On interventions:** Interventions are behavioral nudges, not campaigns. Every intervention needs a trigger, a context, and an emotionally intelligent action. No intervention should feel like marketing.

**On salesman friction:** Salesmen should not decide who to contact, when to contact, or what to say. The system surfaces the action. The salesman executes it with their personal relationship knowledge.

**On discounting:** The system never recommends discounts as an intervention. When a customer is tagged as discount-driven, the system surfaces value-framing templates — not discount offers.

**On brand voice:** Trust beats urgency. Elegance beats offers. Timing beats frequency. Lightweight and design quality lead all product communication.

**On segmentation:** Business rules, not black boxes. Every segment has a human-readable rule set. Admin can trace exactly why any customer landed in any segment. Rules can be adjusted without touching code.

**On the profiling form:** The form adapts to the conversation. A small required core captures every customer. Additional sections unlock based on signals the salesman is already observing — not based on a rigid stage schedule.

---

## The Profiling Architecture

### Philosophy: Signal Capture, Not Staged Forms

The form has a required core (6–7 questions) and additional sections that unlock based on answers or are manually opened by the salesman. Any section can be opened at any time. Incomplete profiles are allowed — the system flags them for completion on the next interaction. The salesman captures what the customer is telling them right now.

---

### Required Core (Always Collected at Enrollment)

These questions are the minimum needed to assign a primary segment. Cannot be skipped.

| Question | Options |
|---|---|
| Buying occasion | Self · Wedding · Gift · Investment · Festival · Family occasion |
| Purchase stage | Just exploring · Comparing options · Planning purchase · Ready soon |
| Comfortable budget range | Under ₹25k · ₹25k–₹75k · ₹75k–₹2L · ₹2L+ |
| Purchase behavior | One-time purchase · Scheme/SIP · Exchange old gold · Waiting for rates |
| First contact source | Walk-in · WhatsApp · Instagram/Social media · Referral · Existing customer |
| Currently buying from another jeweller? | No · Yes, just comparing · Yes, somewhat loyal · Yes, very loyal |

Competitor association is collected at core level because it overrides the intervention approach regardless of every other signal.

---

### Section A — Product Affinity
*Unlocks if: Purchase stage = Planning or Ready, OR salesman opens manually*

**Interested in:**
- Daily wear · Bridal · Lightweight · Men's · Silver · Kids · Diamond · Temple/traditional · Custom order

**Style preference:**
- Traditional · Modern · Minimal · Statement · Trend-focused

*Note: Lightweight should be pre-selected as a default suggestion given market reality. Salesman deselects if not applicable.*

---

### Section B — Timeline & Trigger Sensitivity
*Unlocks if: Purchase stage = Planning or Ready, OR budget ₹75k+, OR salesman opens manually*

**Expected purchase timing:**
- Within 7 days · Within 1 month · 1–3 months · Just browsing

**Interested in being notified about:**
- Rate drop alerts · New design arrivals · Festival collections · Bridal launches · Scheme updates · Making charge offers

---

### Section C — Scheme & Financial Detail
*Unlocks if: Purchase behavior = Scheme/SIP, OR salesman opens manually*

**Scheme type of interest:**
- Monthly SIP · Gold deposit · Lump sum at maturity · Not sure yet

**Current scheme status:**
- Interested but not started · Active scheme elsewhere · Active scheme with MNAP · Completed scheme, considering purchase

**If has a scheme — salesman records three fields only:**
- Scheme with: MNAP / Another jeweller
- Scheme type: Monthly SIP / Gold deposit / Other

*This is a customer profile signal, not a financial record. No maturity tracking, no alerts, no amounts. The scheme flag is what qualifies the customer for the Scheme Customer segment — nothing more is needed.*

---

### Section D — Competitor Detail
*Unlocks if: Competitor association = Yes (any loyalty level)*

**Which type of jeweller:**
- Local family jeweller · Chain brand (Tanishq, Malabar, etc.) · Online · Multiple

**What draws them there:**
- Price · Designs · Trust built over years · Location · Family relationship · Schemes

---

### Section E — Relationship Temperature
*Unlocks after first interaction, OR salesman opens manually if customer is showing engagement*

**Engagement signals observed (select all that apply):**
- Repeatedly asked about a specific design type · Asked for photos of specific pieces · Visited store · Asked for pricing · Compared elsewhere · Hard bargainer / discount-focused

*Note: Casual "any new designs?" questions are not a signal — everyone asks this. Only mark this when a customer has shown repeated, specific interest in a particular design category (e.g. consistently asking about lightweight chains, or always asking about a specific style of earring). This level of specificity indicates pre-purchase intent and moves the customer toward Hot Buyer territory.*

**Purchase history with MNAP:**
- First-time prospect · Previously inquired, did not purchase · Already purchased before

*These are observed signals, not self-reported. Do not ask the customer directly — the salesman records what they observe.*

---

### Section F — Occasion & Life Event
*Unlocks if: Buying occasion = Wedding, Festival, or Gift*

**Specific occasion or timing:**
- (Short text — one of the few cases where typing is appropriate: wedding month, festival name, anniversary)

**Who is the purchase for:**
- Self · Partner · Parent · Child · Friend · Extended family

---

## Competitor Association — Strategic Treatment

Collected at the required core level. Overrides intervention approach for every segment.

| Answer | Meaning | Intervention posture |
|---|---|---|
| No | Not buying elsewhere | Standard segment interventions apply |
| Yes, just comparing | Price-shopping, no loyalty | Value framing, not price matching |
| Yes, somewhat loyal | Open relationship, some openness | Trust-building first, then product |
| Yes, very loyal | Deep relationship with competitor | Long game — stay visible, never push |

**On discount seekers who are also comparing:** These customers want price. The response is never to match or offer discounts. Surface the reasons to choose MNAP that are not price — purity, craftsmanship, service, relationship, after-sales. Train the salesman to have this conversation; the system provides the opening.

---

## The 9 Starting Segments

All system-defined. Admin cannot create custom segments in v1. Each customer has one primary segment.

---

### 1. Competitor Acquisition (Priority Override)
**Signals:** Competitor association = any loyalty level AND purchase stage ≠ just exploring

**Intervention goal:** Build trust. Never sell directly. Stay present and credible.

**Interventions:**
- Rate intelligence (neutral, advisory — positions MNAP as a knowledgeable source)
- New design previews ("thought you'd like to see this" — not a sales pitch)
- Value-framing content: hallmarking, craftsmanship, after-sales service
- Occasion-based soft reach ("Hope you find something beautiful this season")
- Never: discount offers, urgency language, or acknowledgment that they buy elsewhere

**Graduation rule:** When purchase stage updates to Planning or Ready, re-qualify for natural primary segment. Competitor flag remains as secondary tag.

---

### 2. Hot Buyer
**Signals:** Stage = Planning or Ready + timeline = within 7 days or 1 month + engagement signals (asked pricing / visited store / asked for photos)

**Intervention goal:** Accelerate to purchase. Remove friction. Create gentle urgency.

**Interventions:**
- Personal salesman follow-up (highest priority task)
- New arrivals in their product category
- Appointment nudge ("Would you like to come in and see these in person?")
- Rate window alert if exchange or rate-waiting is also a factor

---

### 3. Bridal Journey
**Signals:** Buying occasion = Wedding AND (product interest includes Bridal OR purchase for = Partner/Self with wedding occasion)

**Note on budget:** Budget range does NOT define this segment. A ₹40k lightweight bridal customer is as valid as a ₹2L+ customer. Bridal intent is defined by occasion, not spend.

**Scheme rule for Bridal customers:**
- If the bridal customer already has an active scheme → primary segment = Bridal Journey. The scheme is serving the purchase. Interventions include scheme progress and bridal collection updates.
- If the bridal customer has no scheme → primary segment = Bridal Journey + secondary tag = Scheme Candidate. An early intervention promotes starting a scheme specifically as a way to fund their bridal purchase. Frame it as financial planning, not a product pitch: "Most families planning a wedding find a monthly scheme helps them reach their jewellery budget without the pressure of one big payment."

**Intervention goal:** Establish trust early. Guide the full journey. Acknowledge that lightweight bridal is beautiful and intentional — not a compromise.

**Interventions:**
- Lightweight bridal collections and styling
- Wedding timeline planning ("With your wedding in X months, here's when most families prefer to finalize…")
- Family purchase planning options
- Early preview of new bridal arrivals
- Messaging that frames lightweight as elegant choice, not budget limitation
- For no-scheme bridal: scheme introduction as a financial planning tool for the wedding purchase

---

### 4. Scheme Customer
**Signals:** Purchase behavior = Scheme/SIP OR current scheme status = Active scheme with MNAP OR Active scheme elsewhere OR Completed scheme considering purchase

**Intervention goal:** Maintain relationship through the scheme period. Convert at maturity. Upgrade where appropriate.

**Interventions:**
- Monthly scheme update (personalized — not the daily rate broadcast)
- At scheme maturity: purchase planning conversation
- Upgrade nudge: "Your scheme is maturing — here's what you could add to get the piece you had in mind"
- Rate movement alerts framed around scheme value: "Your accumulated gold is worth X today"
- Referral ask post-purchase: "If you know anyone looking to start a scheme…"

---

### 5. Rate Sensitive
**Signals:** Purchase behavior = Waiting for rates OR Exchange old gold AND scheme status is not active

**Intervention goal:** Be their rate intelligence source. Alert at the right market moment. Never push.

**Interventions:**
- Rate drop alerts (contextual, threshold-based — not daily)
- Exchange campaign nudges ("With rates at X, exchanging old gold now gets you more")
- Scheme as an alternative: "Instead of waiting, lock in today's rate monthly"
- Investment framing during meaningful rate corrections

---

### 6. Festival & Occasion Buyer
**Signals:** Buying occasion = Festival or Family occasion or Gift AND purchase timing ≠ just browsing

**Intervention goal:** Activate at the right emotional moment. Lead with occasion, not product.

**Interventions:**
- Akshaya Tritiya, Diwali, Dhanteras campaigns
- Anniversary and birthday gifting nudges
- Rakhi, Navratri collections
- Festival-specific lightweight gift suggestions (given market reality)

---

### 7. Daily Wear Explorer
**Signals:** Product interest includes daily wear or lightweight or minimal AND stage = exploring or comparing AND budget ≤ ₹75k

**Intervention goal:** Soft brand presence. Low pressure. Keep MNAP front of mind when they are ready.

**Interventions:**
- New arrivals in lightweight and everyday category
- Styling content ("Easy to wear every day")
- Soft seasonal nudges
- New design alerts (high-engagement for this segment)

---

### 8. Social Media Lead
**Signals:** First contact source = Instagram/Social media AND purchase stage = exploring or comparing

**Two tracks — the salesman must assess immediately on enrollment:**

**Track A — Cold lead (no strong signals yet):**
Intervention goal: Build trust before building interest. Do not push product.
- Day 1: Store introduction — who we are, what makes us different (not a product push)
- Day 3–5: One design showcase relevant to what drew them in (the post they saw)
- Day 10: Soft engagement: "Any questions? Happy to share more"
- After any engagement signal: graduate immediately to appropriate primary segment

**Track B — Hot social lead (showing strong buying signals at first contact):**
Intervention goal: Accelerate fast. Do not delay with trust-building sequence — they are already interested. Close the opportunity before it goes cold.
- Signals that trigger Track B: purchase stage = Planning or Ready, asked for pricing, asked for photos of specific pieces, or explicitly stated an occasion/timeline
- Immediately re-evaluate segment rules → if Hot Buyer or Bridal Journey rules match, promote directly
- Keep 'Social Origin' tag so salesman knows context and maintains a warm (not transactional) tone
- Dashboard flags this customer as high-priority: follow up within 24 hours
- The trust sequence is skipped — but tone must still be warm and personal, not pushy

**Note:** Social Media Lead is always a transitional segment. The moment meaningful signals appear (Track B conditions), re-evaluate and assign the natural primary segment immediately.

---

### 9. VIP / Relationship Customer
**Assignment: Manual by salesman — not algorithm-determined.**

Loyalty is a relationship quality that a salesman recognizes from lived experience, not something a rule can reliably detect from form answers. The salesman who has the relationship knows who their loyal customers are. This segment is manually assigned at enrollment or updated from the customer profile at any time.

**Two sub-types (salesman selects one):**

**Long-time Loyalist** — customers who have been choosing MNAP exclusively for years. Deep trust, do not compare, come back without prompting. The salesman knows these customers by name.
- Intervention goal: Make them feel remembered and exclusively valued. Never let this relationship feel routine.
- Interventions: Early collection previews, personal occasion recognition (birthday, anniversary, children's milestones), concierge feel ("We kept this aside for you"), referral cultivation, salesman relationship continuity

**New Exclusive Customer** — customers who have recently started choosing MNAP exclusively, though not for years yet. They are in the process of shifting their loyalty fully to MNAP.
- Intervention goal: Reinforce the choice. Make every interaction confirm they made the right decision. Accelerate the relationship into Long-time Loyalist territory.
- Interventions: Warm personal follow-ups after each purchase, design alerts tailored to their demonstrated taste, "thank you for your trust" messaging, early access to new arrivals before general announcement

**Admin visibility:** Admin can see the full VIP list, the sub-type, which salesman assigned it, and when. Admin can override or re-classify.

---

### Unqualified Prospect (Default)
**Signals:** No segment rule matches — typically due to incomplete profile

**Action:** Flag for profile completion on next interaction. Assign to salesman for follow-up within 7 days.

---

## Secondary Tags

Any customer can hold any combination of secondary tags regardless of primary segment. Tags modify intervention tone and template selection.

| Tag | Condition | Effect on interventions |
|---|---|---|
| Discount Seeker | Engagement signal = hard bargainer / discount-focused | Suppresses price-led templates. Surfaces value-framing templates. |
| Rate Sensitive | Behavior = waiting for rates OR rate alert interest | Rate movement alerts added to intervention schedule |
| Exchange Candidate | Behavior = exchange old gold | Exchange-framing templates surfaced during rate corrections |
| Scheme Candidate | Behavior = scheme/SIP | Scheme introduction templates if not already in Scheme Customer segment |
| Diamond Interest | Product interest includes Diamond | Diamond-specific new arrivals |
| Bridal Adjacent | Occasion = Gift AND purchase for = Partner or Child near wedding context | Soft bridal content without full Bridal Journey treatment |
| High Value | Budget = ₹2L+ | Early access, exclusive previews |
| Dormant | Last contact ≥ 45 days | Escalated in salesman dashboard, soft reconnect templates |
| Competitor Flag | Any competitor association level | Modifies intervention tone per Competitor Acquisition rules |
| New Arrival Subscriber | Product affinity selected (Section A) AND notification opt-in includes 'new design arrivals' (Section B) | Receives new arrival notifications for their specific product categories only — not a general broadcast |
| Social Origin | First contact = social media | Trust-building templates prioritized in early interactions |

---

## Business Rules — Segmentation Engine

All segmentation is rule-based and fully auditable. Rules are evaluated in priority order. The first matching primary segment rule fires. Secondary tags are additive across all rules.

### Segment Assignment Rules (Priority Order)

```
RULE 1 — COMPETITOR ACQUISITION (overrides all others)
IF competitor_association IN ['just comparing', 'somewhat loyal', 'very loyal']
AND purchase_stage NOT IN ['just exploring']
THEN primary_segment = 'Competitor Acquisition'

RULE 2 — HOT BUYER
IF purchase_stage IN ['planning purchase', 'ready soon']
AND purchase_timing IN ['within 7 days', 'within 1 month']
AND engagement_signals INCLUDES ANY ['asked pricing', 'visited store', 'asked for photos']
AND competitor_association = 'no'
THEN primary_segment = 'Hot Buyer'

RULE 3 — BRIDAL JOURNEY
IF buying_occasion = 'Wedding'
AND (product_interest INCLUDES 'Bridal' OR purchase_for IN ['self', 'partner'] WITH occasion=wedding)
AND competitor_association = 'no'
THEN primary_segment = 'Bridal Journey'

RULE 4 — SCHEME CUSTOMER
IF purchase_behavior = 'scheme/SIP'
OR scheme_status IN ['active with MNAP', 'active elsewhere', 'completed considering purchase']
THEN primary_segment = 'Scheme Customer'
-- If customer is also Rate Sensitive (waiting for rates / exchange), Rate Sensitive becomes a secondary tag.
-- The scheme is already managing their rate exposure — Scheme Customer is the dominant relationship.

RULE 5 — SOCIAL MEDIA LEAD
IF first_contact_source = 'Instagram/Social media'
AND purchase_stage IN ['just exploring', 'comparing options']
THEN primary_segment = 'Social Media Lead'

RULE 6 — RATE SENSITIVE
IF purchase_behavior IN ['waiting for rates', 'exchange old gold']
AND scheme_status NOT IN ['active with MNAP', 'active elsewhere']
AND competitor_association = 'no'
THEN primary_segment = 'Rate Sensitive'

RULE 7 — FESTIVAL & OCCASION BUYER
IF buying_occasion IN ['Festival', 'Family occasion', 'Gift']
AND purchase_timing NOT = 'just browsing'
AND competitor_association = 'no'
THEN primary_segment = 'Festival & Occasion Buyer'

RULE 8 — DAILY WEAR EXPLORER
IF product_interest INCLUDES ANY ['daily wear', 'lightweight', 'minimal']
AND purchase_stage IN ['just exploring', 'comparing options']
AND budget_range IN ['under ₹25k', '₹25k–₹75k']
THEN primary_segment = 'Daily Wear Explorer'

RULE 9 — VIP / RELATIONSHIP CUSTOMER (Manual Assignment Only)
-- VIP is not algorithm-determined. Salesman assigns this manually at enrollment or from profile.
-- Sub-type must be selected: 'Long-time Loyalist' OR 'New Exclusive Customer'
-- Assignment is logged with: salesman ID, timestamp, sub-type
-- Admin can view, override, or reclassify at any time
IF vip_manually_assigned = true
THEN primary_segment = 'VIP / Relationship Customer'
    vip_sub_type = [salesman selected: 'Long-time Loyalist' OR 'New Exclusive Customer']

DEFAULT — UNQUALIFIED PROSPECT
IF no rule above matches
THEN primary_segment = 'Unqualified Prospect'
    flag_for_completion = true
```

### Secondary Tag Rules (Applied After Primary Assignment)

```
IF engagement_signals INCLUDES 'hard bargainer / discount-focused'
THEN add_tag = 'Discount Seeker'

IF purchase_behavior IN ['waiting for rates', 'exchange old gold']
OR notification_interest INCLUDES 'rate drop alerts'
THEN add_tag = 'Rate Sensitive'

IF purchase_behavior = 'exchange old gold'
THEN add_tag = 'Exchange Candidate'

IF purchase_behavior = 'scheme/SIP' AND primary_segment ≠ 'Scheme Customer'
THEN add_tag = 'Scheme Candidate'

IF product_interest INCLUDES 'Diamond'
THEN add_tag = 'Diamond Interest'

IF budget_range = '₹2L+'
THEN add_tag = 'High Value'

IF competitor_association ≠ 'no'
THEN add_tag = 'Competitor Flag'

IF product_affinity IS NOT EMPTY
AND notification_interest INCLUDES 'new design arrivals'
THEN add_tag = 'New Arrival Subscriber'
-- New arrival notifications sent only for the customer's selected product categories
-- General "wants new designs" curiosity is NOT a tag — it applies to everyone and means nothing

IF first_contact_source = 'Instagram/Social media'
THEN add_tag = 'Social Origin'

-- Dormant thresholds vary by segment (purchase urgency determines patience)

-- Immediate buyers — go cold fast
IF primary_segment = 'Hot Buyer'
AND days_since_last_contact >= 30
THEN add_tag = 'Dormant', escalate_in_dashboard = true

-- Planned purchasers and relationship segments — longer patience
IF primary_segment IN ['Bridal Journey', 'Rate Sensitive', 'Scheme Customer',
                        'Festival & Occasion Buyer', 'VIP / Relationship Customer']
AND days_since_last_contact >= 60
THEN add_tag = 'Dormant', escalate_in_dashboard = true

-- Cold leads — longest patience, still worth a quarterly reconnect
IF primary_segment IN ['Daily Wear Explorer', 'Social Media Lead',
                        'Competitor Acquisition', 'Unqualified Prospect']
AND days_since_last_contact >= 90
THEN add_tag = 'Dormant', escalate_in_dashboard = true
```

### Segment Conflict Resolutions

```
-- Bridal customer + Scheme
IF primary_segment = 'Bridal Journey'
AND scheme_status IN ['active with MNAP', 'active elsewhere']
THEN stay in 'Bridal Journey'
    -- scheme is funding the bridal purchase, no conflict

IF primary_segment = 'Bridal Journey'
AND scheme_status NOT IN ['active with MNAP', 'active elsewhere', 'completed considering purchase']
THEN stay in 'Bridal Journey'
    add_tag = 'Scheme Candidate'
    -- trigger scheme-promotion intervention early in the bridal journey

-- Rate Sensitive customer buying for a festival
-- Festival occasion is always the primary emotional driver — the customer has a deadline and an emotion.
-- Rate sensitivity informs the message tone but does not change the segment.
-- Rule: if there is an occasion, Festival & Occasion Buyer wins over Rate Sensitive.
IF buying_occasion IN ['Festival', 'Family occasion', 'Gift']
AND purchase_behavior IN ['waiting for rates', 'exchange old gold']
THEN primary_segment = 'Festival & Occasion Buyer'
    add_tag = 'Rate Sensitive'
    -- festival calendar interventions run as primary
    -- rate alerts added contextually: "With the festival approaching and rates at X, this may be a good time"

-- Social Media Lead showing Hot Buyer signals on Day 1
-- Trust-first always wins for cold leads; move fast but do not skip trust step
IF primary_segment = 'Social Media Lead'
AND engagement_signals INCLUDES ANY ['asked for pricing', 'asked for photos', 'visited store']
THEN re-evaluate: remove Social Media Lead rule, apply all other rules
    keep 'Social Origin' tag
    -- if Hot Buyer rule now matches, promote to Hot Buyer immediately
    -- the trust-building sequence is replaced by direct follow-up, but tone remains warm
```

### Segment Update Rules

```
IF any profile answer changes
THEN re-evaluate all segment rules and reassign if needed
    log segment change with: previous segment, new segment, which answer changed, timestamp

IF Competitor Acquisition customer's purchase_stage changes to 'planning purchase' OR 'ready soon'
THEN re-evaluate without Rule 1 to find natural primary segment
    keep 'Competitor Flag' as secondary tag

IF Social Media Lead customer shows engagement_signals OR visits store
THEN re-evaluate all rules to find natural primary segment
    keep 'Social Origin' as secondary tag
```

---

## Admin Segment Visibility Module

The quality control and calibration layer for the entire intervention engine.

### Segment Overview Dashboard
- Total customers per segment (count + % of Type B total)
- Average profile completeness % per segment
- Customers with incomplete profiles (Unqualified Prospect count + flagged incomplete)
- Salesman activity: enrollments per salesman, average completeness, segment distribution

### Segment Drill-Down
- Full customer list per segment
- Per customer: name, primary segment, secondary tags, profile completeness %, last contact, enrolling salesman
- Sortable by completeness, last contact, enrollment date

### Customer Profile Audit View
- Every profiling answer recorded for any customer
- Which business rule triggered primary segment — displayed in plain English
  - *Example: "Placed in Bridal Journey because: Occasion = Wedding AND Product interest includes Bridal"*
- Full segment history: if segment changed, show when, why, and which answer triggered the change
- Manual override: admin can reassign primary segment with a reason note (logged permanently)

### Rule Transparency Panel
- All segment rules displayed in human-readable format
- Per rule: how many customers currently match it
- Rule change requests logged (actual code changes in v1; visual rule editor in v2)

### Salesman Quality Flags
- High rate of Unqualified Prospect assignments → salesman skipping form
- High rate of incomplete profiles → salesman rushing enrollment
- These flags surface in the admin view, not pushed to the salesman directly

---

## The Intervention Model

Every intervention requires three components. Without all three, it is not an intervention — it is spam.

| Component | Purpose | Example |
|---|---|---|
| **Trigger** | What causes this to fire | Rate dropped 2% |
| **Context** | Why this customer is relevant | Tagged as Exchange Candidate |
| **Emotional action** | What the message does | "This may be a good window for your exchange" |

### Trigger Categories

**Time-based:** After elapsed time since enrollment, last contact, or a life event date (see Dormant Thresholds below)

**Behavior-based:** After salesman logs an action (store visit, design inquiry, pricing ask)

**Market-based:** Gold rate drops ₹300 or more per gram from the monthly average — this is the threshold for a major drop alert to Rate Sensitive and Exchange Candidate customers. Minor daily fluctuations do not trigger alerts.

**Relationship-based:** Birthday, anniversary, first purchase anniversary

**Scheme-based:** Monthly scheme update, scheme maturity approaching (30/14/7 days before)

---

## Salesman Daily Dashboard

Maximum 10 actions per day. Priority order:

1. Hot Buyers
2. Scheme maturity approaching (within 30 days)
3. Occasion alerts (wedding/festival within 30 days)
4. Competitor Acquisition — stage = planning/ready
5. Follow-ups due (time-based triggers)
6. Social Media Lead — new (within 3 days, follow up fast)
7. Scheme reminders (monthly)
8. Dormant warm leads (45+ days, soft reconnect)
9. Rate alerts for Rate Sensitive + Exchange segments

**Each action card shows:** customer name, primary segment, secondary tags, reason for today's action (plain English), last interaction, recommended template, one-tap to open send flow.

**VIP cards show sub-type explicitly with tone guidance:**
- Long-time Loyalist → card label: "Long-time Loyalist · Make them feel remembered" — concierge tone, personal touch
- New Exclusive Customer → card label: "New Exclusive · Reinforce their choice" — warm, affirming tone, build the relationship

---

## Type B Rate Communication

Type B customers receive selective rate intelligence. Never included in the Type A daily broadcast.

| Segment / Tag | Rate communication |
|---|---|
| Rate Sensitive (primary) | Alert when rate drops beyond threshold |
| Exchange Candidate (tag) | Alert on correction windows — exchange framing |
| Scheme Customer | Monthly value update ("your accumulated gold is worth X today") |
| Bridal Journey | Budget planning alerts — "Gold is X% off recent peak" |
| High Value (tag) | Investment framing on meaningful movements |
| Competitor Acquisition | Rate intelligence as trust-building touchpoint |
| All others | Rate mentioned only when contextually relevant in a specific template |

---

## Build Order

### Session 1 — Strategy lock ✅ Done
- [x] Two-module architecture
- [x] Guiding principles
- [x] Profiling architecture (flexible, signal-responsive)
- [x] Competitor association treatment
- [x] 9 starting segments with intervention goals
- [x] Business rules segmentation engine
- [x] Secondary tag system
- [x] Admin segment visibility module design
- [x] Salesman daily dashboard logic

### Session 2 — Ground intelligence ✅ Done
- [x] Market reality: lightweight dominant, budget compression, schemes growing
- [x] Customer behavior: discount seekers, loyalists, comparers, social leads
- [x] Segment revisions: Scheme Customer added, Social Media Lead added, Bridal Journey redefined
- [x] Secondary tags: Discount Seeker, New Design Seeker, Social Origin added

### Session 3 — Segment signal mapping (next)
- [ ] Finalize edge cases in rule evaluation (overlapping signals)
- [ ] Define rate drop thresholds for rate-triggered interventions
- [ ] Define Dormant tag re-engagement sequence precisely
- [ ] Define Social Media Lead graduation criteria

### Session 4 — Intervention playbook
- [ ] For each segment × trigger: write the intervention template and tone guidance
- [ ] Value-framing template set for Discount Seeker tag
- [ ] Social Media Lead trust-building sequence (Day 1 / Day 3 / Day 10)

### Session 5 — Schema design
- [ ] wa_profiles (extended customer data — all profiling answers)
- [ ] wa_segment_rules (rule definitions, configurable)
- [ ] wa_segment_assignments (customer → segment, with reason trace and history)
- [ ] wa_intervention_triggers (trigger definitions per segment)
- [ ] wa_intervention_log (what was sent, when, which trigger fired)

### Session 6 — Build
- [ ] Type B enrollment form (flexible, signal-responsive)
- [ ] Segmentation engine (evaluates rules on profile save/update)
- [ ] Admin segment visibility module
- [ ] Intervention trigger system
- [ ] Salesman daily dashboard

---

## What Is Not Changing

- The Daily Rates send module (Type A) is complete. No changes.
- Type A enrollment (/enroll, /customers/new) is unchanged.
- Existing wa_ database tables are untouched.
- New tables for Type B are separate, wa_ prefixed.

---

*Strategy finalised: 13 May 2026*
*Next step: Session 3 — segment edge cases, threshold definitions, graduation criteria*
