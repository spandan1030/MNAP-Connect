-- wa_012_offers_exchange.sql
-- "Offers & Sale" now branches into Offers vs Gold Exchange/Cash, each with
-- its own editable message.

INSERT INTO wa_bot_messages (key, content) VALUES
  ('offers_menu',   E'What would you like to know? \xF0\x9F\x99\x8F'),
  ('exchange_menu', E'Please choose one: \xF0\x9F\x99\x8F'),
  ('exchange_info', E'You can exchange your old gold for new jewellery at the best value. \xF0\x9F\x99\x8F Our team will share the details with you shortly.'),
  ('cash_info',     E'We offer instant cash for your gold. \xF0\x9F\x99\x8F Our team will contact you with the details shortly.')
ON CONFLICT (key) DO NOTHING;
