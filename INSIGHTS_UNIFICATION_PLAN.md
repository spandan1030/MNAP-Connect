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

## Progress log
- 2026-07-31 — plan created; starting Phase 1.
- 2026-07-31 — **Phase 1 complete + build clean.** New Insights live: per-template funnel + drill-down
  (reused `/api/campaigns/detail`), carry-by-narrow and carry-by-engagement both save a new audience via
  `POST /api/audiences/save-slice`. StepFunnel unmounted from the Insights sheet (component/routes still
  exist on disk — removed in Phase 2). Awaiting user validation before Phase 2 (retire steps + dedup).
