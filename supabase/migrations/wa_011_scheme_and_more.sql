-- wa_011_scheme_and_more.sql
-- New editable copy for the "More options" list and the Gold Savings Scheme reply.
-- (Gold Savings Scheme reuses the existing "Schemes & Offers" interest topic.)

INSERT INTO wa_bot_messages (key, content) VALUES
  ('more_options', E'Here are all the options. \xF0\x9F\x99\x8F Please choose one:'),
  ('scheme_info',  E'Our Gold Savings Scheme helps you save every month towards your jewellery. \xF0\x9F\x99\x8F Our representative will contact you shortly with all the details.')
ON CONFLICT (key) DO NOTHING;
