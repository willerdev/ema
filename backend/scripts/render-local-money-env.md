# Render: local mobile money + SMS (from `backend/sms_mobilemoney.txt`)

Add these in [Render Dashboard](https://dashboard.render.com/) → **ema-0gp3** → **Environment**:

| Key | Purpose |
|-----|---------|
| `FLUTTERWAVE_CLIENT_ID` | Flutterwave v4 OAuth client id |
| `FLUTTERWAVE_CLIENT_SECRET` | Flutterwave v4 OAuth client secret |
| `FLUTTERWAVE_SANDBOX` | `1` for sandbox, `0` for production |
| `FLUTTERWAVE_V4_BASE_URL` | Optional; default sandbox `https://developersandbox-api.flutterwave.com` |
| `FLUTTERWAVE_MM_NETWORK_RW` | Internal provider network code for Rwanda (not shown in app) |
| `FLUTTERWAVE_MM_NETWORK_UG` | Internal provider network code for Uganda |
| `LOCAL_MONEY_USDT_RATE_RW` | USDT→RWF display rate (e.g. `1450`) |
| `LOCAL_MONEY_USDT_RATE_UG` | USDT→UGX display rate (e.g. `3800`) |
| `TWILIO_ACCOUNT_SID` | Twilio SMS |
| `TWILIO_AUTH_TOKEN` | Twilio SMS |
| `TWILIO_FROM_NUMBER` | Sender number (E.164) |
| `TWILIO_SMS_ENABLED` | `1` to send SMS, `0` to disable |
| `FLUTTERWAVE_WEBHOOK_SECRET` | Optional; set `verif-hash` from Flutterwave dashboard |
| `APP_BASE_URL` | `https://ema-0gp3.onrender.com` |

**Flutterwave webhook URL:** `https://ema-0gp3.onrender.com/webhooks/flutterwave`

Run migration `backend/sql/migrations/20260519_local_mobile_money.sql` in Supabase before using deposit/withdraw.

Do not commit `sms_mobilemoney.txt` to git.
