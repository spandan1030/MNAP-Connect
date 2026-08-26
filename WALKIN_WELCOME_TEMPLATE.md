# Walk-in Welcome Template — setup

The Touch-0 auto-message sent the moment a walk-in is registered. It must be a
**Meta-approved WhatsApp template** (business-initiated rule). Once approved and
linked with **category = "Walk-in welcome"** in `/admin/templates`, every new
walk-in auto-receives it (opt-out + 14-day repeat guard handled automatically).

---

## 1) Create the template in Meta (WhatsApp Manager → Message templates)

- **Category:** Marketing
- **Name:** `walkin_welcome` (lowercase + underscores)
- **Language:** English

### Body (paste exactly — {{1}}/{{2}}/{{3}} are the variables)

```
Namaste {{1}} 🙏

Thank you for visiting *M N Alankar Palace* today — it was a pleasure having you!

✨ *Today's gold rate:* ₹{{2}}/g (22KT) · ₹{{3}}/g (24KT)
💍 We've just added *fresh designs* in necklaces, rings, bangles & bridal sets — do come see what's new.
🎁 This festive & wedding season, ask us about our *Gold Savings Scheme* and *exchange offers* — a lovely way to plan your next piece.

Reply here anytime and we'll be glad to help you find something perfect. 💛
```

**Sample values for Meta review:** {{1}} = `Priya`, {{2}} = `6820`, {{3}} = `7440`

> Meta approves the wording once; the rate is filled fresh at send time, so the
> "today's rate" line is always current. The festive/scheme line is evergreen —
> if you want a season-specific variant later, make a second walkin template and
> switch which one is active (only the most-recent active one is used).

### Optional button (recommended)
Add a **Quick reply** button labelled `See new designs`. A tap opens the 24-hour
window and routes to the bot, so they can browse without you lifting a finger.

---

## 2) Link it in Connect (`/admin/templates` → New template)

- **Message body** (for the inbox preview — uses the app's `{...}` placeholders):
  ```
  Namaste {name} 🙏 Thank you for visiting M N Alankar Palace today! Today's gold rate: ₹{rate_22kt}/g (22KT) · ₹{rate_24kt}/g (24KT). We've just added fresh designs — do come see what's new. Ask us about our Gold Savings Scheme & exchange offers. Reply here anytime. 💛
  ```
- **Message type (category):** `Walk-in welcome (auto-sent on new walk-in)`
- **Meta template section:**
  - **Meta template name:** `walkin_welcome`
  - **Language:** `en`
  - **Variables (comma-separated, IN ORDER of {{1}},{{2}},{{3}}):** `name, rate_22kt, rate_24kt`
- **Active:** ON

That's it. Register a test walk-in with your own number to confirm delivery.
Set today's rate first, or the welcome is held (never sends a "rate is —" line).
