-- wa_071 — close the customer_features RLS-bypass leak
--
-- FINDING (audit 2026-09-27): `customer_features` is a VIEW (wa_046/051/054) over
-- `contacts` + marker tables. A Postgres view runs with the view OWNER's rights by
-- default (security-definer semantics), which BYPASSES row-level security on the
-- underlying tables. PostgREST exposes the view to the `anon` role, so a logged-out
-- browser using the public anon key could read ALL ~10,900 customer rows through the
-- view — even though `contacts` itself correctly denies anon. (Confirmed live: anon
-- SELECT on customer_features returned every row.)
--
-- FIX (two layers, both zero-impact):
--   1. security_invoker = on  → the view now runs with the CALLING role's rights, so
--      the underlying RLS applies to whoever queries it. anon → 0 rows; the server
--      resolvers use service_role (which bypasses RLS) and keep full access.
--   2. REVOKE the view from anon  → the browser role can't touch it at all.
--
-- IMPACT: none. The ONLY readers are the server-side audience/reach resolvers
-- (lib/reach/resolve.ts, lib/audiences/resolve-rules.ts) via supabaseAdmin =
-- service_role, which is unaffected by RLS and by the anon revoke. No client/anon
-- code reads this view.
--
-- NOTE for future migrations: any later `CREATE [OR REPLACE] VIEW customer_features`
-- MUST re-declare `WITH (security_invoker = on)` — CREATE OR REPLACE resets view
-- options to their defaults. The wa_059 inventory views already follow this pattern.

ALTER VIEW customer_features SET (security_invoker = on);

REVOKE ALL ON customer_features FROM anon;
GRANT SELECT ON customer_features TO authenticated, service_role;
