# Glossary

Plain-English definitions for the terms that come up constantly in MNAP Connect.
Written to be read start-to-finish once, then dipped into.

Deeper references: [`MNAP_CONNECT_REFERENCE.md`](MNAP_CONNECT_REFERENCE.md) is the
system of record (every table, module and migration); `MNAP_DATA_ATLAS.html` is
the visual tour of the data; `LEADGEN_PHASE1_PLAN.md` holds the lead-gen
decisions log.

---

## The two halves of the system

**Pipeline** (`customer-signals`, Python, runs on the desktop) — reads the
billing SQL Server and works out **what kind of buyer** someone is. It is the
only thing with billing access.

**App** (`mnap-connect`, Next.js) — chats, calls, walk-ins, campaigns. It knows
**what people are interested in and how they've engaged**.

They exchange three CSVs: the app exports interest signals and call outcomes to
the pipeline; the pipeline sends back `leads_import.csv`.

---

## Markers vs signals — the distinction to hold onto

| | **Marker** | **Signal** |
|---|---|---|
| Answers | Who they are as a *buyer* | What they're *interested in* |
| Examples | Lapsed · VIP · At-Risk · likely wedding | rate · designs · wedding · necklace |
| Built by | The pipeline, from purchase history | The app, from chats, calls and walk-ins |
| Lives in | `wa_b_markers` | `wa_signals` |

Someone can have rich markers and no signals (an old customer who never chats),
or signals and no markers (a chat lead who has never bought).

---

## Core terms

**Feature** — one fact about a person that you can filter on. "Recency tier",
"has walked in", "wedding interest". Markers and signals both become features.

**`customer_features`** — the view holding **one row per person, one column per
feature**. Everything the system knows about someone, in one place. Building an
audience is asking this one table a question.

**View** — a saved query with a name. It behaves like a table but stores
nothing; it recalculates whenever you read it, so it is never out of date. (A
*materialised* view caches the answer for speed and must be refreshed.)

**Audience** — a saved, named set of rules, plus the people who currently
satisfy them. An audience is a **set of people, not a channel**: the same
audience can be called this week and messaged next.

**Rule** — one line of an audience: *field · operator · value*, e.g.
`Recency is any of Lapsed`. Any rule can be negated with **NOT**.

**Group** — a box of rules that must **all** be true (AND). Separate groups are
alternatives (OR). One level deep, deliberately — enough for anything we build,
still readable on a phone.

**Materialise / refresh** — running an audience's rules and writing the matching
people into `audience_members`. Membership is a **snapshot with a timestamp**,
not a live query. Refreshing is manual today.

**Fixed vs auto-update** — a *fixed* audience freezes its members at first
materialisation; an *auto-update* one re-resolves on refresh, adding new matches
and dropping people who no longer qualify.

**Activation** — putting an audience to work on a channel: chat (send a
template), call (become the live calling deck), or ad (export). Choosing the
channel happens here, not when the audience is defined.

**Sub-filter** — a narrowing applied at send time only, without changing the
saved audience.

---

## Contact rules

**Opted out** (`is_opted_out`) — **do not contact**: no WhatsApp, no calls. It's
the union of a chat STOP, a "don't call" on the phone, and a manual toggle.
**Ads are deliberately unaffected** — an opt-out is about us contacting them, not
about being shown an ad.

**Suppression is not membership.** Someone can legitimately be *in* an audience
and still correctly receive nothing — opt-out, the send ledger and the call rules
all apply at send time, not when the audience is built.

**Ledger** (`wa_send_ledger`) — one row per message sent. It's what stops the
same person getting the same template twice inside its window, so re-running a
send picks up where it left off.

**Cooldown / the wait** — how long before a person's call card can come back. It
depends on what happened last time:

| Last call | Wait |
|---|---|
| Didn't connect | **4 days** |
| Connected, said *will come* | **4 days** — hot, stays reachable |
| Connected, anything else | **30 days** — we already spoke |

Worked out once per person and stored, so every deck reads the same date rather
than re-deriving the rule. Correcting a wrong outcome re-derives the wait
immediately. Distinct from **retirement** below: a wait is *not yet*, retirement
is *never again*.

**Disconnect / retirement** — a call recorded as *failed*. **4 disconnects** and
the person leaves every calling deck for good (they stay reachable on chat and
ads). A **pending** call — Call tapped, outcome never submitted — never counts.

---

## Sources — and why source decides consent

A signal always records **where it came from**: `whatsapp` · `call` · `walkin` ·
`sales` · `ad` · `billing` *(reserved, nothing writes it yet)*.

This is not bookkeeping. The same interest means opposite things depending on
source:

> A person texts **rate** on WhatsApp → the chatbot tags them Daily Rate → that
> **is** the subscription. They asked us, on the channel we'd reply on.
>
> **rate** noted on a call → a salesman wrote down what came up. A record of a
> conversation, not permission to broadcast.

Hence each interest carries its **list of sources** rather than a bare yes/no:
`int_wedding_src = {walkin, chat}` answers both *"has wedding interest"* (is it
non-empty) and *"from a walk-in"* (does it contain `walkin`).

---

## Type A / Type B

Two customer tables that predate the unified layers, joined only by phone:

- **Type A** (`wa_customers`) — anyone who has chatted on WhatsApp.
- **Type B** (`wa_b_customers`) — the sales/call/walk-in base.
- **`contacts`** — the **spine**: one row per phone, stitching both together and
  holding the single true opt-out flag.

---

## Funnel terms

**Sent → delivered → read → replied → converted.** Conversion is a **purchase
within 90 days** of the touch, measured from the sales data.

**Cohort** — the set of people a particular campaign run went to.

**Attribution** — every send and call is tagged with its audience and campaign,
which is what lets a customer's profile show what they were part of.

---

## Things that are named but not built

- **`billing` source** — counter-side tagging of what a customer *asked* about.
  Reserved in the taxonomy; nothing writes it.
- **Ad signals** — the schema and capture code exist and are inert until the
  Meta/WhatsApp ads connection is wired.
- **Walk-in history** — only the *latest* visit is stored, so there is no visit
  count. Repeat-visit questions need a walk-in log built first.
