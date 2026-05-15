# NOWPayments integration

Crypto deposits and withdrawals use [NOWPayments](https://nowpayments.io/) (separate from the internal **cash** `wallets` ledger).

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `NOWPAYMENTS_API_KEY` | Yes | Dashboard → API key |
| `NOWPAYMENTS_IPN_SECRET` | Yes (production) | Dashboard → Payment Settings → IPN secret |
| `NOWPAYMENTS_API_BASE` | No | Default `https://api.nowpayments.io/v1`; use sandbox URL for testing |
| `APP_BASE_URL` | Yes (for IPN) | Public backend URL, e.g. `https://ema-0gp3.onrender.com` |

IPN callbacks (production Render service `ema-0gp3`):

- **Payment (deposits):** `https://ema-0gp3.onrender.com/webhooks/nowpayments/payment`
- **Payout (withdrawals):** `https://ema-0gp3.onrender.com/webhooks/nowpayments/payout`

Set `APP_BASE_URL=https://ema-0gp3.onrender.com` on Render so create-payment / create-payout requests include these URLs automatically.

## Database

Run in Supabase SQL editor:

`backend/sql/migrations/20260515_nowpayments_wallet.sql`

## Deposits

1. App calls `POST /nowpayments/deposits` with `priceAmount`, `priceCurrency`, `payCurrency`.
2. User sends crypto to the returned `pay_address`.
3. NOWPayments POSTs IPN on status changes; when status is **`finished`**, the server credits `crypto_ledger_entries`.

## Withdrawals

1. User must have sufficient **available** balance (ledger in − out − pending payouts).
2. App calls `POST /nowpayments/withdrawals` with `currency`, `address`, `amount`.
3. Server calls NOWPayments `POST /payout`.

**Custody required:** Enable Custody in the NOWPayments dashboard, fund the custody balance, and configure 2FA/whitelisting as required. Payouts fail if custody is empty.

## Security

- Verify `x-nowpayments-sig` (HMAC-SHA512 of sorted JSON body) when `NOWPAYMENTS_IPN_SECRET` is set.
- Whitelist NOWPayments IPs on your firewall/host.
- Never commit API keys (see `.env.example`).

## API reference

[Postman collection](https://documenter.getpostman.com/view/7907941/2s93JusNJt)
