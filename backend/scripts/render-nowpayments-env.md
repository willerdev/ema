# Render: NOWPayments env (copy from coinpayment.txt)

In [Render Dashboard](https://dashboard.render.com/) → service **ema-0gp3** → **Environment** → add or update:

| Key | Value source in coinpayment.txt |
|-----|----------------------------------|
| `APP_BASE_URL` | `https://ema-0gp3.onrender.com` (fixed) |
| `NOWPAYMENTS_API_KEY` | line under "API key" |
| `NOWPAYMENTS_IPN_SECRET` | line after "ipn secret :" |
| `NOWPAYMENTS_API_BASE` | `https://api.nowpayments.io/v1` |
| `NOWPAYMENTS_EMAIL` | Your NOWPayments account login email (required for **withdrawals**) |
| `NOWPAYMENTS_PASSWORD` | Your NOWPayments account password (required for **withdrawals**) |
| `NOWPAYMENTS_2FA_SECRET` | Base32 2FA secret from NOWPayments Account Settings (required for **automatic payout verify** after withdraw) |

Withdrawals use a separate payout login on the payment provider. Without email/password the app may show a generic withdrawal error.

After each `POST /payout`, NOWPayments requires `POST /payout/{withdrawal-id}/verify` with a 6-digit code. The backend generates that code from `NOWPAYMENTS_2FA_SECRET` (same secret as your Google Authenticator for the NOWPayments account). Optional test override: `NOWPAYMENTS_PAYOUT_VERIFY_CODE` (single code, not recommended in production).

Run migration `backend/sql/migrations/20260520_nowpayments_payout_verify.sql` in Supabase if not already applied.

**IPN URLs in NOWPayments dashboard:**

- `https://ema-0gp3.onrender.com/webhooks/nowpayments/payment`
- `https://ema-0gp3.onrender.com/webhooks/nowpayments/payout`

The JWT `token` in coinpayment.txt is a short-lived dashboard session, not used by the backend.

After saving env vars, click **Save, rebuild, and deploy**.
