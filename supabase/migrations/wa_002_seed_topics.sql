-- wa_002_seed_topics.sql
-- Seeds default interest topics and sub-topics
-- Run after wa_001_initial_schema.sql

INSERT INTO wa_interest_topics (name, sort_order) VALUES
  ('Daily Rates',      1),
  ('New Designs',      2),
  ('Schemes & Offers', 3),
  ('Festive Offers',   4),
  ('Repair & Service', 5);

INSERT INTO wa_interest_topics (name, parent_id, sort_order)
SELECT sub.name, t.id, sub.sort_order
FROM (VALUES
  ('Necklaces',    1),
  ('Rings',        2),
  ('Bangles',      3),
  ('Earrings',     4),
  ('Chains',       5),
  ('Bracelets',    6),
  ('Pendants',     7),
  ('Anklets',      8),
  ('Mangalsutra',  9),
  ('Coins',       10)
) AS sub(name, sort_order)
CROSS JOIN (SELECT id FROM wa_interest_topics WHERE name = 'New Designs') AS t;
