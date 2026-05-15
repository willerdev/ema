# Render: NOWPayments env (copy from coinpayment.txt)

In [Render Dashboard](https://dashboard.render.com/) → service **ema-0gp3** → **Environment** → add or update:

| Key | Value source in coinpayment.txt |
|-----|----------------------------------|
| `APP_BASE_URL` | `https://ema-0gp3.onrender.com` (fixed) |
| `NOWPAYMENTS_API_KEY` | line under "API key" |
| `NOWPAYMENTS_IPN_SECRET` | line after "ipn secret :" |
| `NOWPAYMENTS_API_BASE` | `https://api.nowpayments.io/v1` |

**IPN URLs in NOWPayments dashboard:**

- `https://ema-0gp3.onrender.com/webhooks/nowpayments/payment`
- `https://ema-0gp3.onrender.com/webhooks/nowpayments/payout`

The JWT `token` in coinpayment.txt is a short-lived dashboard session, not used by the backend.

After saving env vars, click **Save, rebuild, and deploy**.
