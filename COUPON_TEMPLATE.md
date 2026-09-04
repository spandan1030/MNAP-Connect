# Coupon Template — setup

The Coupon module sends each customer a **unique code** on WhatsApp. Like every
business-initiated message, it must be a **Meta-approved template**. Create it
once, link it in `/admin/templates` with category **"Coupon"**, and the module
auto-uses the active one. Per-recipient values (name, code, offer, expiry) are
filled at send time.

One neutral template works for birthdays, anniversaries and festival coupons.
(You can make occasion-specific ones later; a per-send template picker can be
added if you want that.)

---

## 1) Create the template in Meta (WhatsApp Manager → Message templates)

- **Category:** Marketing
- **Name:** `coupon_gift`
- **Language:** English

### Body (paste exactly — {{1}}..{{4}} are the variables, IN THIS ORDER)

```
Namaste {{1}} 🙏
A little gift from *M N Alankar Palace*, just for you! 🎁

🎟️ Offer: *{{3}}*
Your code: *{{2}}*
Valid till *{{4}}*

Just show this code at our store to redeem — we'd love to see you! 💛
```

**Sample values for Meta review:**
{{1}} = `Priya`  ·  {{2}} = `MNAP-7F4K2`  ·  {{3}} = `20% off making charges`  ·  {{4}} = `4 Oct 2026`

---

## 2) Link it in Connect (`/admin/templates` → New template)

- **Message body** (inbox preview — the app's `{...}` placeholders):
  ```
  Namaste {name} 🙏 A little gift from M N Alankar Palace, just for you! 🎁 Show your code at our store to redeem. 💛
  ```
- **Message type (category):** `Coupon (used by the coupon / birthday module)`
- **Meta template section:**
  - **Meta template name:** `coupon_gift`
  - **Language:** `en`
  - **Variables (comma-separated, in the {{1}}→{{4}} order):** `name, coupon_code, offer, expiry`
- **Active:** ON

The variable **keys are what matters**, not their order in your head — the send
route recognises `name`, `coupon_code` (or `code`), `offer` (or `offer_text`),
and `expiry` (or `valid_until`). Just keep them in the same order as {{1}}..{{4}}
in the Meta body.

---

## 3) Use it

- **Offers** tab → create an offer (e.g. "Birthday 2026", 20% off making charges).
- **This month** tab → pick the offer → **Send to all** (or per person). Each gets
  a unique code, valid **30 days**. Opted-out people and anyone still holding a
  usable coupon for that offer are skipped automatically.
- **Coupons** tab → look up a code at the counter, see whose it is + validity,
  then **Mark redeemed** (optionally with the bill no), or **Void**.
