-- wa_001_initial_schema.sql
-- Creates all 5 core tables for MNAP Connect with RLS policies

CREATE TABLE IF NOT EXISTS wa_interest_topics (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  parent_id   UUID        REFERENCES wa_interest_topics(id) ON DELETE SET NULL,
  sort_order  INT         NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wa_interest_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read topics"
  ON wa_interest_topics FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admin manage topics"
  ON wa_interest_topics FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));


CREATE TABLE IF NOT EXISTS wa_customers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  phone         TEXT        NOT NULL UNIQUE,
  enrolled_via  TEXT        NOT NULL CHECK (enrolled_via IN ('salesman', 'self')),
  enrolled_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  is_opted_out  BOOLEAN     NOT NULL DEFAULT FALSE,
  opted_out_at  TIMESTAMPTZ,
  opted_out_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wa_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read customers"
  ON wa_customers FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated insert customers"
  ON wa_customers FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated update customers"
  ON wa_customers FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL);


CREATE TABLE IF NOT EXISTS wa_customer_interests (
  customer_id UUID        NOT NULL REFERENCES wa_customers(id) ON DELETE CASCADE,
  topic_id    UUID        NOT NULL REFERENCES wa_interest_topics(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, topic_id)
);

ALTER TABLE wa_customer_interests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read interests"
  ON wa_customer_interests FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated manage interests"
  ON wa_customer_interests FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


CREATE TABLE IF NOT EXISTS wa_message_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id    UUID        REFERENCES wa_interest_topics(id) ON DELETE SET NULL,
  name        TEXT        NOT NULL,
  body_text   TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wa_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read templates"
  ON wa_message_templates FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admin manage templates"
  ON wa_message_templates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));


CREATE TABLE IF NOT EXISTS wa_communication_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID        NOT NULL REFERENCES wa_customers(id) ON DELETE CASCADE,
  template_id  UUID        REFERENCES wa_message_templates(id) ON DELETE SET NULL,
  topic_id     UUID        REFERENCES wa_interest_topics(id) ON DELETE SET NULL,
  message_sent TEXT        NOT NULL,
  sent_by      UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wa_communication_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read log"
  ON wa_communication_log FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated insert log"
  ON wa_communication_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
