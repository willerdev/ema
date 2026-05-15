# NOWPayments integration

Crypto deposits and withdrawals use [NOWPayments](https://nowpayments.io/) (separate from the internal **cash** `wallets` ledger).

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `NOWPAYMENTS_API_KEY` | Yes | Dashboard → API key |
| `NOWPAYMENTS_IPN_SECRET` | Yes (production) | Dashboard → Payment Settings → IPN secret |
| `NOWPAYMENTS_API_BASE` | No | Default `https://api.nowpayments.io/v1`; use sandbox URL for testing |
| `APP_BASE_URL` | Yes (for IPN) | Public backend URL, e.g. `https://ema-0gp3.onrender.com` |
| `NOWPAYMENTS_EMAIL` | Yes (withdrawals) | NOWPayments account login for payout JWT (`POST /auth`) |
| `NOWPAYMENTS_PASSWORD` | Yes (withdrawals) | Same account password |
| `NOWPAYMENTS_2FA_SECRET` | Yes (auto-verify) | Base32 secret from NOWPayments Account Settings → 2FA (same as Google Authenticator setup) |
| `NOWPAYMENTS_PAYOUT_VERIFY_CODE` | No | One-off 6-digit code instead of generating from `NOWPAYMENTS_2FA_SECRET` (testing only) |

IPN callbacks (production Render service `ema-0gp3`):

- **Payment (deposits):** `https://ema-0gp3.onrender.com/webhooks/nowpayments/payment`
- **Payout (withdrawals):** `https://ema-0gp3.onrender.com/webhooks/nowpayments/payout`

Set `APP_BASE_URL=https://ema-0gp3.onrender.com` on Render so create-payment / create-payout requests include these URLs automatically.

## Database

Run in Supabase SQL editor (in order):

1. `backend/sql/migrations/20260515_nowpayments_wallet.sql`
2. `backend/sql/migrations/20260520_nowpayments_payout_verify.sql`

## Deposits

1. App calls `POST /nowpayments/deposits` with `priceAmount`, `priceCurrency`, `payCurrency`.
2. User sends crypto to the returned `pay_address`.
3. NOWPayments POSTs IPN on status changes; when status is **`finished`**, the server credits `crypto_ledger_entries` in **`pay_currency`** using **`actually_paid`** (not `outcome_currency`, which is your merchant outcome wallet).
4. The app also syncs status on `GET /nowpayments/deposits/:id` and `GET /nowpayments/summary` so balances update even if IPN was missed.

### Deposits not showing in the wallet?

| Check | Action |
|-------|--------|
| `APP_BASE_URL` on Render | Must be `https://ema-0gp3.onrender.com` so create-payment includes IPN URL |
| NOWPayments dashboard IPN | Set callback URL to `https://ema-0gp3.onrender.com/webhooks/nowpayments/payment` and match `NOWPAYMENTS_IPN_SECRET` |
| Payment status | Only **`finished`** credits the ledger; `confirming` / `waiting` do not |
| Wrong network or amount | Use the exact `pay_address` and `pay_amount` from the app |
| Tables | Run migration `20260515_nowpayments_wallet.sql` in Supabase |

Pull to refresh on Wallet or reopen the deposit — the server polls NOWPayments for uncredited payments.

## Withdrawals

1. User must have sufficient **available** balance (ledger in − out − pending payouts).
2. App calls `POST /nowpayments/withdrawals` with `currency`, `address`, `amount`, and optional **`totpCode`** (your app’s 2FA in Settings — not NOWPayments).
3. Server calls NOWPayments `POST /payout`, then **`POST /payout/{withdrawal-id}/verify`** with a custody 2FA code when `NOWPAYMENTS_2FA_SECRET` (or `NOWPAYMENTS_PAYOUT_VERIFY_CODE`) is set.

**IDs stored:**

- `payout_id` — per-withdrawal id from `withdrawals[0].id` (used for verify).
- `batch_payout_id` — batch id from the create response (used for IPN lookup).

**Custody required:** Enable Custody in the NOWPayments dashboard, fund the custody balance, whitelist your server egress IP for payouts, and enable 2FA on the NOWPayments account.

There is no API to *fetch* the custody verification code. The backend generates it with `NOWPAYMENTS_2FA_SECRET` (TOTP, same as Google Authenticator) or you pass a one-time code via `NOWPAYMENTS_PAYOUT_VERIFY_CODE`.

The mobile app asks the user for the email verification code, then calls `POST /nowpayments/withdrawals/:id/verify` with `{ "verificationCode": "123456" }`. Optional server auto-verify: set `NOWPAYMENTS_AUTO_VERIFY_PAYOUT=1` and `NOWPAYMENTS_2FA_SECRET` (not used when the user enters the code in the app).

If verify fails, the payout stays `awaiting_verify` (max 10 attempts per payout at NOWPayments).

## Security

- Verify `x-nowpayments-sig` (HMAC-SHA512 of sorted JSON body) when `NOWPAYMENTS_IPN_SECRET` is set.
- Whitelist NOWPayments IPs on your firewall/host.
- Never commit API keys or `NOWPAYMENTS_2FA_SECRET`.

## API reference

[Postman collection](https://documenter.getpostman.com/view/7907941/2s93JusNJt)
