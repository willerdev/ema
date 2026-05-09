# EMA - Trading + Wallet App

EMA is a fintech-style mobile app built with Expo React Native and a secure Node.js backend.

## Architecture

- `ema-mobile/`: Expo mobile app with 4 main screens (Home, Trades, Wallet, Settings)
- `backend/`: Express API for auth, wallet operations, and Alpaca proxy integration

## Security model

- Alpaca keys are saved on backend per user and never exposed publicly in frontend code.
- JWT auth protects trading and wallet endpoints.
- Optional TOTP (Google Authenticator–compatible) second factor: run [`backend/sql/migrations/20260509_totp.sql`](backend/sql/migrations/20260509_totp.sql) on your database, then set **`TOTP_ENCRYPTION_KEY`** to a 32-byte value (64 hex characters or standard base64) in the backend environment. In production this key is required so stored TOTP secrets can be encrypted at rest. Generate one locally with `openssl rand -hex 32`. Without the migration or this env var, authenticator setup returns a clear error instead of a generic failure.
- Wallet funds are fully separate from Alpaca trading funds.

## Features delivered

### Mobile (Expo)
- Dark Alpaca-inspired UI (`#0D1117` + green accent)
- Auth flow (register/login)
- Home dashboard with account overview + quick stats
- Trades screen with buy/sell + market/limit order support
- Wallet screen with deposit/withdraw and transaction history
- Settings screen with Alpaca key management and logout

### Backend (Express)
- Email/password authentication (bcrypt)
- JWT session handling
- Alpaca endpoints:
  - account details
  - positions
  - orders history
  - quote by symbol
  - place order
- Internal wallet endpoints:
  - balance + transactions
  - deposit
  - withdraw

## Quick start

### 1) Start backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Backend runs on `http://localhost:4000`.

### 2) Start mobile app

```bash
cd ema-mobile
cp .env.example .env
npm install
npm start
```

Use Expo QR scan, Android emulator, or iOS simulator.

## Required setup for real trading

1. Register in EMA app.
2. Open **Settings** screen.
3. Save your Alpaca Paper API key + secret key.
4. Go to **Trades/Home** to fetch live account and market data.

If Alpaca keys are missing, relevant trading endpoints return safe validation errors.

## API endpoints overview

- `POST /auth/register`
- `POST /auth/login` (returns `requiresTotp` + `preAuthToken` when 2FA is enabled)
- `POST /auth/totp/verify` (Bearer pre-auth token + code)
- `GET /auth/totp/status`, `POST /auth/totp/setup/start|confirm|cancel`, `POST /auth/totp/disable`
- `GET /auth/me`
- `POST /alpaca/keys`
- `GET /alpaca/account`
- `GET /alpaca/assets/search?q=AAPL`
- `GET /alpaca/quote/:symbol`
- `GET /alpaca/positions`
- `GET /alpaca/orders`
- `POST /alpaca/orders`
- `GET /wallet`
- `POST /wallet/deposit`
- `POST /wallet/withdraw`
- `GET /mt5/accounts`
- `POST /mt5/accounts`
- `GET /mt5/accounts/:id/balance`
- `GET /mt5/accounts/:id/positions`
- `GET /health/db`
- `GET /airfarming/status` (includes `cashWallet`, `airfarmingBalance`, weekly event fields)
- `POST /airfarming/activate` — move amount from internal cash wallet into airfarming
- `POST /airfarming/return-to-cash` — move amount from airfarming back to cash (required before wallet withdraw)

## Notes / limitations

- Backend is now wired to Supabase Postgres tables for persistence.
- Light mode toggle is placeholder UI; dark mode is default.
- Add HTTPS, encrypted secrets at rest, and rate limiting before production.


## Supabase schema setup

1. Open Supabase SQL Editor.
2. Run `backend/sql/schema.sql` (or apply incremental files under `backend/sql/migrations/`, e.g. `20260510_airfarming_wallet.sql` for `airfarming_wallets` + `airfarming_transfers`).
3. Confirm `users`, `wallets`, `transactions`, and `mt5_accounts` tables exist.
4. If migrating from old single-MT5 schema, remove unique constraint on `mt5_accounts.user_id`.

The backend reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `backend/.env`.
For MT5 integration via MetaApi, set `MT5_METAAPI_TOKEN` and keep the default MetaApi URLs (or override them in env).

Use `GET /health/db` to verify table connectivity and basic counts from Supabase.
