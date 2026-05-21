# MNAP Connect — WhatsApp API Configuration

## Non-Sensitive Config (safe to store here)

| Key | Value |
|-----|-------|
| `WHATSAPP_VERIFY_TOKEN` | `mnap_connect_2603` |
| `WHATSAPP_PHONE_NUMBER_ID` | `1127121583816269` |
| `WHATSAPP_API_VERSION` | `v22.0` |
| `WHATSAPP_API_BASE` | `https://graph.facebook.com/v22.0` |

## Sensitive Credentials (store in `.env.local` only — never commit)

| Key | Where to get it | Notes |
|-----|-----------------|-------|
| `WHATSAPP_APP_SECRET` | Meta App → Settings → Basic → App Secret | Used to verify webhook signatures |
| `WHATSAPP_ACCESS_TOKEN` | Meta Business Settings → System Users → Generate Token | Use permanent System User token, not temporary |

## `.env.local` Template

```
WHATSAPP_VERIFY_TOKEN=mnap_connect_2603
WHATSAPP_PHONE_NUMBER_ID=1127121583816269
WHATSAPP_API_VERSION=v22.0
WHATSAPP_APP_SECRET=33af718d1afa37072448fce4a24d7ce1
WHATSAPP_ACCESS_TOKEN=EAAqD6Pw5MRQBRsMgDP2JalARgxoLJVdXHaIZBwa3Ho0HWmLAMpP2CxEukgQBerd4h54Qu5ibz0XQ0RMls87Jctqp5TQn2hPrj93VFinz08OelNUB5xZC5w2I7IyIpyVeezSnSzFIZAyduKbxlh45oFvpeEkWsQUbcTDoZBZB2xVFmcnOUjoegTqokd3wShivWAgZDZD
```

## Webhook Registration (do this after deploying)

1. Meta App Dashboard → WhatsApp → Configuration → Webhooks
2. Callback URL: `https://mnapconnect.vercel.app/api/whatsapp/webhook`
3. Verify Token: `mnap_connect_2603`
4. Click **Verify & Save**
5. Under Webhook Fields → subscribe to: **`messages`**

## Permanent Access Token — How to Generate

See instructions in WHATSAPP_CONFIG.md under "Generating a Permanent Token".

---

## Generating a Permanent (Non-Expiring) Token

The temporary token from "Getting Started" expires in 24 hours. Follow these steps for a permanent System User token:

1. Go to **business.facebook.com → Business Settings**
2. Left sidebar → **Users → System Users**
3. Click **Add** → Name: `mnap-connect-bot` → Role: **Employee** → Create
4. Click **Add Assets**
   - Asset type: **Apps** → select your app → toggle **Full Control** → Save
   - Asset type: **WhatsApp Accounts** → select your WABA → toggle **Full Control** → Save
5. Click **Generate New Token**
6. Select your App from the dropdown
7. Check these permissions:
   - ✅ `whatsapp_business_messaging`
   - ✅ `whatsapp_business_management`
8. Click **Generate Token** — copy it immediately (shown only once)
9. Paste into `.env.local` as `WHATSAPP_ACCESS_TOKEN`

**This token never expires** as long as the System User exists.

---

## Message Send Endpoint (for reference when building)

```
POST https://graph.facebook.com/v22.0/1127121583816269/messages
Authorization: Bearer <WHATSAPP_ACCESS_TOKEN>
Content-Type: application/json
```

## Phone Number Format

- Database stores: `9876543210` (10-digit, no country code)
- WhatsApp API expects: `919876543210` (prepend `91` for India)
- Conversion: `'91' + phone`

---

*Last updated: 21 May 2026*
