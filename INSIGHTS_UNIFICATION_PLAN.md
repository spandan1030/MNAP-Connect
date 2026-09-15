# Insights Unification — plan & progress

**Goal (user):** collapse the two overlapping funnel surfaces into one. An audience should show
**detailed per-template chat insights** (the same drill-down as campaign reports) right inside
Insights, and let you **carry a slice forward by saving it as a new audience** — both for a marker
*narrow* (e.g. "the 30 who said will-come") and for *chat engagement* (e.g. "who read T1 → send T2").
Retire the separate multi-step `StepFunnel`.

## Model (what we're converging on)

```
Audience ── narrow → save slice ─────────────► sub-audience (reusable, capped sends)
   │                                                │
   └── send template (Activate, cap N) ─► per-template funnel ─► drill-down (who / stage / errors / CSV)
                                                    │
                                                    └── "save readers / repliers as audience" ─► next audience → send T2
```

Everything is an **audience with per-template funnels + drill-down**. Narrowing saves a slice;
engagement saves a slice. Both produce audiences you send templates to. No parallel "step" construct.

- **Detailed chat insights** = reuse `/api/campaigns/detail` (funnel + per-recipient furthest stage,
  timestamps, Meta error codes, failure breakdown, CSV) — already built.
- **Chat-engagement carry (T1→T2)** = a "Save as audience" action on a template's report, filtered by
  stage (read / replied / delivered-not-read / not-delivered). The engagement is already computed
  per-recipient, so carry = materialise that filtered phone list as a new audience.

## Decisions
- **Same-template-twice:** a template send is one campaign keyed to (audience, template); repeat sends
  of the *same* template merge into one funnel. Accepted for now (follow-ups use a different template).
  _Revisit if the user wants per-activation separation._
- **Steps retirement:** the per-audience report reads `wa_campaigns.audience_id` (chat) and
  `wa_b_call_campaigns.audience_id` (call) — **not** `audience_steps`. So retiring the StepFunnel UI is
  safe; the Reach/Call-Control fold already sets those links. `audience_steps` becomes vestigial →
  cleaned up in Phase 2.

## Phases

### Phase 1 — build the unified Insights (non-destructive)  ✅ DONE (2026-07-31)
- [x] `lib/campaigns/engagement.ts` — per-campaign engagement map + `phonesAtStage(campaignId, stage)`.
- [x] `POST /api/audiences/save-slice` — `{mode:'narrow', audienceId, subRules|subFilter, name}` or
      `{mode:'engagement', campaignId, stage, name}` → materialise a new audience (reuses `createAudienceFromCohort`).
- [x] `components/campaigns/CampaignDetail.tsx` — reusable drill-down (funnel bars + recipient list + CSV).
- [x] `components/audiences/AudienceInsights.tsx` — new Insights: per-template chat cards → Details
      drill-down + "Carry a slice → audience" (engagement stage); call section + call summary; a
      "Narrow this audience → save a slice" builder (rules-only) at top.
- [x] Wired into `app/audiences/page.tsx`: replaced `<StepFunnel>` + legacy report block + the page-level
      report state/fetch/`Metric` with `<AudienceInsights>` (fetches its own report; `onSaved` reloads list).
- [x] `npx next build` clean.

**Not yet applied to the live "lapsed winback":** if it's a pre-fold bare call campaign it must first be
attached via the "Adopt the current live calling cohort" button (Activate sheet) before its Insights populate.

### Phase 2 — retire steps + dedup (after Phase 1 validated)
- [ ] Remove `StepFunnel.tsx`, `/api/audiences/steps{,/run,/delete}`, `lib/audiences/steps.ts`.
- [ ] Simplify the fold (`lib/audiences/adhoc.ts`): stop writing `audience_steps`; keep the
      `wa_campaigns.audience_id` / `wa_b_call_campaigns.audience_id` links (which the report needs).
- [ ] Optionally drop `audience_steps` / `audience_step_members` tables (migration).
- [ ] Dedup: have `/api/campaigns/detail` and `lib/campaigns/engagement.ts` share one recipient builder.

## Open questions for the user
- (none blocking — same-template-twice defaulted to "merge"; say the word to change it.)

## QC pass (2026-09-15) — four live bugs found + fixed

A comprehensive QC of the audience/engagement logic surfaced four bugs; all fixed
(no migration). Root causes, not symptoms:

1. **Stale dynamic membership (the "hot starred → narrow → only 2" bug).** Dynamic
   audiences materialise members ONCE at creation and only re-sync on an explicit
   refresh (no daily job existed). Narrow/activate read that frozen `audience_members`
   snapshot, so everyone starred/called *after* creation was invisible → the narrow
   collapsed to a handful. **Fix:** `refreshAudienceMembers` is now called before the
   member set is read — on Insights open (`report`), on `activate`, and on `save-slice`
   narrow. New `POST /api/audiences/refresh-all` (CRON_SECRET- or user-guarded) lets a
   scheduler keep every active dynamic audience's card count honest.
2. **Individual messages missing from the customer profile.** `CustomerPeek` read only
   `wa_send_ledger`; one-off inbox messages (`/api/whatsapp/send`) only write
   `wa_messages`. **Fix:** peek now UNIONs outbound `wa_messages` (complete record) with
   the ledger (adds category/campaign), matched on `wa_message_id`.
3. **Activated chat campaign always showed "0 sent".** `audiences/activate` called
   `dispatchTemplate` but never wrote `wa_campaigns.{sent,failed,total}` back (unlike
   every sibling send path); the report read the stored 0. **Fix:** activate now
   accumulates the counters, AND the report derives sent/failed from the ledger so
   already-broken campaigns self-heal.
4. **Rule-builder count showed whole-DB totals, not within-audience.** `/api/audiences/count`
   had no audience scope, so narrowing previewed a big number then saved a tiny slice
   (this hid bug #1). **Fix:** `count` accepts `audienceId`; the headline total is now
   `members ∩ tree`, and RuleBuilder shows "N in this audience match".

Files touched: `app/api/audiences/{activate,save-slice,report,count}/route.ts`,
`app/api/audiences/refresh-all/route.ts` (new), `app/api/customer/peek/route.ts`,
`components/audiences/{RuleBuilder,AudienceInsights}.tsx`. Build clean.

**Follow-ups (done 2026-09-15):**
- `vercel.json` cron hits `GET /api/audiences/refresh-all` daily at 02:00 UTC
  (route now serves GET+POST, `maxDuration=60`). **Owner TODO: set `CRON_SECRET`
  in Vercel** — Vercel adds `Authorization: Bearer <CRON_SECRET>` to the cron
  request; without it set, the scheduled call 401s (only a signed-in user passes).
- The report is now FULLY derived — `total` from `wa_campaign_members`, `sent`/
  `failed` from the ledger, `delivered`/`read` from events, `replied` from inbound.
  Nothing trusts the stored `wa_campaigns` counters. The Insights card also shows
  "N in cohort · M still to send" for a partially-sent template.

## Progress log
- 2026-07-31 — plan created; starting Phase 1.
- 2026-07-31 — **Phase 1 complete + build clean.** New Insights live: per-template funnel + drill-down
  (reused `/api/campaigns/detail`), carry-by-narrow and carry-by-engagement both save a new audience via
  `POST /api/audiences/save-slice`. StepFunnel unmounted from the Insights sheet (component/routes still
  exist on disk — removed in Phase 2). Awaiting user validation before Phase 2 (retire steps + dedup).
