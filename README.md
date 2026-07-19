# MNAP Connect

Mobile-first WhatsApp customer-engagement + store-operations app for **M N Alankar Palace**
(jewellery retailer). Salesmen run it on their phones.

| | |
|---|---|
| **Live** | https://mnapconnect.vercel.app |
| **Repo** | https://github.com/spandan1030/MNAP-Connect |
| **Stack** | Next.js (App Router, TS) · Tailwind CSS 4 · Supabase (Postgres + Auth + Storage) · WhatsApp Business Cloud API (Meta Graph v22.0) · Vercel |
| **Database** | Shared Supabase project `tqnirshwiqpwbqdcrgbr`; all tables prefixed `wa_`, RLS on |

---

## What it does (current capabilities)

1. **Two-way WhatsApp engagement** — real Business API: inbox with realtime threads, status
   ticks, image send/receive; a **rules-based auto-reply bot** (no AI) built around 4 customer
   needs (rate, offers, new designs, customer care); STOP/DnD opt-out; editable bot copy.
2. **Type A broadcasting** — daily-rate sends + topic-segment broadcasts; thank-you-for-purchase
   broadcast (Meta-approved templates).
3. **Catalogue / Inventory / Purchase (operations)** — product catalogue with photos
   (primary image + auto thumbnails), managed attribute values with rename/merge, share-to-customer,
   a live in-stock inventory report, and a reusable catalogue-driven purchase plan with
   party tracking. Built to scale to 5,000+ products (server-side pagination, DB-side filtering,
   indexes, lazy thumbnails).
4. **Type B intervention CRM** — flexible prospect profiling + a 9-segment client-side
   segmentation engine, plus the **cold-call module** (calling deck, outcomes, call history)
   and the **walk-in module**.
5. **Audiences & lead-gen** — a `customer_features` view holding **one row per person, one
   column per feature**, and a **rule builder** over it (AND / OR / NOT). An audience is a
   saved set of rules and a set of people — *not* a channel; you choose chat, call or ad when
   you **activate** it, and one funnel reports all three. 21 audiences seeded.

---

## Documentation map

Start here, then open the doc that matches what you need. Each doc states its own scope/status
at the top.

| Doc | Scope | Status |
|---|---|---|
| **README.md** (this file) | Entry point: overview, setup, migrations, doc index | Current |
| **`MNAP_CONNECT_REFERENCE.md`** | ⭐ **System of record** — every table, module and migration; build phases 1–13 | Current |
| **`GLOSSARY.md`** | Plain-English definitions: marker vs signal, feature, view, audience, rule, opt-out vs suppression | Current |
| **`../MNAP_DATA_ATLAS.html`** | Visual tour — the marker/signal loop, the audience engine, the feature dictionary, and **§12 the feature & filter review guide** (every filter: label → column → how it's computed → what to ask of it) | Current to `wa_047` |
| **`ENGAGEMENT_SYSTEM.md`** | WhatsApp engagement layer **and** Catalogue/Inventory/Purchase operations (§6) | Current for its scope; predates the audience engine |
| **`LEADGEN_PHASE1_PLAN.md`** | Lead-gen decisions log — *why* the design is what it is | Built; L1/L3 re-architected — see its header note |
| **`INTERVENTION_STRATEGY.md`** | Type B business rules, segment definitions, profiling architecture | Current (strategy) |
| **`INTERVENTION_MODULE_DISCUSSION.md`** | Decision log for the Type B module | Historical |
| **`WHATSAPP_CONFIG.md`** | WhatsApp API config (non-sensitive) + required env vars | Current |
| **`AGENTS.md` / `CLAUDE.md`** | Agent/AI working rules for this repo | Current |

**Rule of thumb:** for "how does it work today," read `MNAP_CONNECT_REFERENCE.md` — it is kept
current after every code or schema change. If a term is unfamiliar, `GLOSSARY.md`. If you'd
rather see it than read it, `MNAP_DATA_ATLAS.html`. The planning docs explain *why*, not *what*.

---

## Local setup

```bash
npm install
npm run dev          # http://localhost:3000
```

### Environment (`.env.local`)
See `WHATSAPP_CONFIG.md` for the full list. The build **requires**
`SUPABASE_SERVICE_ROLE_KEY` (the webhook uses the service-role client to bypass RLS); an empty
value makes `next build` fail with *"supabaseKey is required."* Set it locally and in Vercel.

```bash
# verify a production build compiles even without a real key:
SUPABASE_SERVICE_ROLE_KEY="x" npx next build
```

---

## Database migrations

SQL files live in `supabase/migrations/`. **They are run manually** in the Supabase SQL editor
(the app has no migration runner). All are idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`).

| Range | Area |
|---|---|
| `wa_001`–`wa_003` | Type A schema + seed topics · Type B intervention schema |
| `wa_004`–`wa_008` | Messaging, realtime, media, Meta template fields |
| `wa_009`–`wa_013` | Inbound auto-enroll, engagement flows, bot copy, topic sync |
| `wa_014`–`wa_015` | Thank-you broadcast · DnD opt-out |
| `wa_016`–`wa_018` | Catalogue, product status, managed values + description |
| `wa_019`–`wa_020` | Purchase requirements · weight buckets + purchase lines |
| `wa_021`–`wa_023` | Primary image · catalogue indexes (pg_trgm) · image thumbnails |

---

## Working conventions

- **Flow:** build → user runs the new migration in Supabase → user says "commit" → push to
  `master` (auto-deploys to Vercel).
- **This is not stock Next.js** — see `AGENTS.md`; consult `node_modules/next/dist/docs/` before
  writing framework code.
- Mobile-first: large tap targets, bottom tab bar (**Messages · Send · Customers · Catalogue ·
  Templates · More**; More → Purchase · Prospects · Topics · Segments).
