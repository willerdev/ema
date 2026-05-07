# EMA - Trading + Wallet App

EMA is a fintech-style mobile app built with Expo React Native and a secure Node.js backend.

## Architecture

- `ema-mobile/`: Expo mobile app with 4 main screens (Home, Trades, Wallet, Settings)
- `backend/`: Express API for auth, wallet operations, and Alpaca proxy integration

## Security model

- Alpaca keys are saved on backend per user and never exposed publicly in frontend code.
- JWT auth protects trading and wallet endpoints.
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
- `POST /auth/login`
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
- `GET /health/db`

## Notes / limitations

- Backend is now wired to Supabase Postgres tables for persistence.
- Light mode toggle is placeholder UI; dark mode is default.
- Add HTTPS, encrypted secrets at rest, and rate limiting before production.


## Supabase schema setup

1. Open Supabase SQL Editor.
2. Run `backend/sql/schema.sql`.
3. Confirm `users`, `wallets`, and `transactions` tables exist.

The backend reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `backend/.env`.

Use `GET /health/db` to verify table connectivity and basic counts from Supabase.
