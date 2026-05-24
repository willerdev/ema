# EMA Backend Deployment on Render

This guide deploys the Express backend from the `backend` folder to Render.

## 1) Push code to GitHub

Make sure this project is pushed to:

- `https://github.com/willerdev/ema.git`

Render will deploy directly from that repository.

## 2) Create a new Web Service on Render

1. Open [Render Dashboard](https://dashboard.render.com/)
2. Click **New** -> **Web Service**
3. Connect your GitHub account (if not connected)
4. Select repository: `willerdev/ema`
5. Configure:
   - **Name**: `ema-backend` (or any name you want)
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

Alternative (recommended):
- Use **Blueprint** deploy from `render.yaml` in repo root. Render will prefill service settings automatically.

## 3) Set Environment Variables in Render

In Render service settings, add:

- `NODE_ENV=production`
- `PORT=4000` (Render usually injects this, but keeping explicit is okay)
- `JWT_SECRET=<strong-random-secret>`
- `SUPABASE_URL=<your-supabase-url>`
- `SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>`
- `ALPACA_BASE_URL=https://paper-api.alpaca.markets`
- `ALPACA_LIVE_URL=https://api.alpaca.markets`
- `DEV_RESET_TOKEN=<set-random-token-or-remove-route-for-prod>`
- `ADMIN_USERNAME=admin` (change in production)
- `ADMIN_PASSWORD=<strong-password>` (required in production; defaults to `admin` only for local dev)
- `MT5_METAAPI_TOKEN=<MetaApi token>` (for MT5 balance, positions, server-side orders)
- `MT5_EA_WEBHOOK_SECRET=<optional>` (HMAC on `POST /webhooks/mt5-ea/telemetry` when EA does not use Bearer token; body must include `login` and `server`)

Important:
- Use the **service role key** only on backend.
- Never expose these values in the mobile app.

## 4) Deploy

Click **Create Web Service**.

After deploy completes, test:

- `GET /health`
- `GET /health/db`

Example:

- `https://your-render-service.onrender.com/health`
- `https://your-render-service.onrender.com/health/db`

## Admin dashboard (Airfarming drops)

After deploy, open:

- `https://your-render-service.onrender.com/admin/`

Sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`. You can view all **scheduled** airfarming drops across users and edit percent, min/max balance, and due time. Edited percent is **locked** so automatic band sync does not overwrite your change.

### AI daily earnings planner (Deepseek)

In Render env vars (or local `.env`):

- `AI_PROVIDER=deepseek` (default if omitted)
- `DEEPSEEK_API_KEY=<from https://platform.deepseek.com/>`
- `AI_MODEL=deepseek-chat` (optional; default `deepseek-chat`)
- `INTERNAL_CRON_SECRET=<random>` — optional cron: `POST /internal/ai/daily-plan` with header `x-internal-cron-secret`

Admin tab **AI earnings**: set daily budget, run planner. Without `DEEPSEEK_API_KEY`, the planner uses a built-in deterministic allocator.

## 5) Point mobile app to production backend

Set the mobile environment variable to your Render URL:

- `EXPO_PUBLIC_API_URL=https://your-render-service.onrender.com`

Then rebuild your app for production.

## 6) Crypto (ETH / USDT on Ethereum mainnet)

Custodial **HD wallets** are derived on the server from `TATUM_ETH_MASTER_MNEMONIC` (BIP44 path `m/44'/60'/0'/0/{index}`). Balances and sends use **on-chain** data via `ETHEREUM_RPC_URL` (Alchemy, Infura, QuickNode, etc.). Tatum is used for **API key** (v4 incoming tx subscriptions) and optional tooling—not Virtual Accounts.

Set on Render (and local `.env`):

- `TATUM_API_KEY` — required for webhook subscriptions
- `TATUM_ETH_MASTER_MNEMONIC` — required to derive addresses and sign sends (keep server-only; never in mobile builds)
- `ETHEREUM_RPC_URL` — HTTPS JSON-RPC with `eth_sendRawTransaction` allowed from your server (some providers restrict by IP or app)
- `APP_BASE_URL` — public base URL of this backend (no trailing slash issues are normalized); used to build `…/crypto/webhooks/tatum` for Tatum v4 subscriptions
- `TATUM_WEBHOOK_HMAC_SECRET` — optional; if set, Tatum webhook requests must include a valid `x-payload-hash`
- `GAS_TOPUP_ENABLED` — optional; default `true`. Auto-fund user wallet ETH when gas is insufficient before on-chain sends.
- `TREASURY_PRIVATE_KEY` — required when `GAS_TOPUP_ENABLED=true`; server-side hot wallet used only for gas top-ups.
- `GAS_TOPUP_MIN_WEI` — optional; minimum ETH top-up amount in wei (default `1000000000000000`, i.e. `0.001 ETH`).
- `GAS_TOPUP_BUFFER_BPS` — optional safety buffer over estimated gas in basis points (default `3000` = `30%`).
- `DEFAULT_DEPOSIT_ETH_ADDRESS` — optional; Ethereum (EVM) address shown to every user as the default **receive** address for ETH in `/crypto/onboard` and `/crypto/summary`. Defaults to the project custodial address if unset.
- `DEFAULT_DEPOSIT_USDT_TRC20_ADDRESS` — optional; Tron (TRC20) address shown to every user for **USDT (TRC20)** in the same API responses. Defaults to the project TRC20 address if unset.

The app reads `depositAddress` and `wallets` from those endpoints only; **per-user HD Ethereum wallets** in `crypto_ethereum_wallets` are still used for balance sync and on-chain sends (ETH / USDT ERC-20). Deposits to the shared TRC20 address are not wired into this backend unless you add Tron monitoring separately.

Database: run `backend/sql/schema.sql` so `crypto_ethereum_wallets` and `tatum_onchain_txs` exist. If you previously used Tatum Virtual Accounts, run `backend/sql/migrate_va_to_onchain.sql` once, then verify before dropping legacy `tatum_*` VA tables.

Optional: `TATUM_ETH_MASTER_XPUB` is no longer required for the app runtime (xpub was only used for ledger VA creation).

Smoke test after deploy: `npm run check:tatum` from `backend` with `CHECK_BASE_URL`, `CHECK_EMAIL`, and `CHECK_PASSWORD` set.

## 7) Airfarming, contracts, VIP Farmers, and daily accrual cron

Run `backend/sql/schema.sql` (or `backend/sql/migrate_airfarming_contracts.sql` on an existing DB) so these tables exist: `airfarming_state`, `airfarming_events`, `contract_wallets`, `contract_accruals`.

Run `backend/sql/migrations/20260605_vip_farmers.sql` in Supabase for `vip_investments` and `vip_accruals` (Journal aggregates VIP + airfarming + contracts).

Run `backend/sql/migrations/20260606_user_drop_schedules.sql` for per-user AI drop plans in admin (custom drop count, target profit, percents, intervals).

- **`INTERNAL_CRON_SECRET`** — shared secret for internal cron routes. Send header `x-internal-cron-secret: <value>` or JSON body `{ "secret": "<value>" }`.
- **`POST /internal/contracts/daily-accrue`** — once per day UTC; contract balances accrue **2%** per day (idempotent per user per UTC date).
- **`POST /internal/vip-farmers/daily-accrue`** — once per day UTC (~00:15 UTC, after contracts); credits **9% of principal** to cash per active VIP investment for up to 30 days (idempotent per investment per UTC date).

## 8) NOWPayments (crypto wallet)

Set on Render for service **ema-0gp3**:

- `APP_BASE_URL=https://ema-0gp3.onrender.com`
- `NOWPAYMENTS_API_KEY` — from NOWPayments dashboard
- `NOWPAYMENTS_IPN_SECRET` — Payment Settings → IPN secret (must match dashboard)
- `NOWPAYMENTS_API_BASE=https://api.nowpayments.io/v1` (or sandbox URL for testing)

**IPN webhook URLs** (paste into NOWPayments Payment Settings / IPN callback):

| Use | URL |
|-----|-----|
| Deposits | `https://ema-0gp3.onrender.com/webhooks/nowpayments/payment` |
| Withdrawals | `https://ema-0gp3.onrender.com/webhooks/nowpayments/payout` |

Run `backend/sql/migrations/20260515_nowpayments_wallet.sql` in Supabase. See `backend/docs/NOWPAYMENTS.md`.

Withdrawals need **Custody** enabled and funded in the NOWPayments dashboard.

## 9) Production hardening checklist

- Disable or strictly guard dev-only endpoints (`/wallet/reset`)
- Rotate secrets if they were ever shared in plain text
- Enable Render auto-deploy on push to `main`
- Monitor logs and failed requests in Render dashboard
- Plan KMS/HSM for the custodial mnemonic in serious production use
