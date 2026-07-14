-- wa_029: store the actual last purchase date on the marker snapshot
-- so the call card can show when the customer last bought (not just a
-- days-since number). Populated by customer-signals leads_import.csv
-- (LEAD_HOT_COLUMNS -> last_purchase_date, formatted YYYY-MM-DD).

ALTER TABLE wa_b_markers
  ADD COLUMN IF NOT EXISTS last_purchase_date DATE;
