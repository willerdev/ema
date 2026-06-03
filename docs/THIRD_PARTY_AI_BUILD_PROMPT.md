# Third-Party AI Build Prompt — Airfarms (Ema) Fintech Mobile App

Use this document as the **single source of truth** to rebuild the application described below. Treat every business rule, API shape, and UX behavior as a requirement unless marked optional. The product is branded **Airfarms** in user-facing copy (legacy internal name: **Ema**).

---

## 1. Mission

Build a **production-grade fintech mobile app** (Expo React Native) with a **Node.js Express API** backed by **Supabase (PostgreSQL)**. Users register, fund an internal **cash wallet (USD)**, participate in yield/trading products, manage **crypto (USDT)** via NOWPayments, optionally link **Alpaca** and **MT5**, and interact with support/compliance flows. Operators use a **static admin web console** served from the backend.

**Deliverables:**
- `backend/` — Express API, admin HTML, SQL migrations
- `ema-mobile/` — Expo SDK 54, TypeScript, React Navigation 7

---

## 2. Tech stack (exact versions / libraries)

### Backend
- **Runtime:** Node.js, CommonJS (`"type": "commonjs"`)
- **Framework:** Express 5
- **DB:** Supabase JS client (`@supabase/supabase-js`) — service role only on server
- **Auth:** JWT (`jsonwebtoken`), bcrypt passwords
- **2FA:** `otplib` (TOTP), encrypted secrets at rest (`TOTP_ENCRYPTION_KEY`)
- **Crypto on-chain:** `ethers` + Tatum v4 webhooks (Ethereum USDT ERC-20)
- **Payments:** NOWPayments (deposits + payouts), Flutterwave (mobile money webhooks)
- **Trading:** Alpaca API (per-user keys), MetaApi (MT5)
- **AI (admin):** Deepseek OpenAI-compatible API for daily earnings planner

### Mobile (`ema-mobile/`, package name `AirFarmerPro`)
- **Expo ~54**, React 19, React Native 0.81
- **Navigation:** `@react-navigation/native`, bottom tabs + native stack
- **State:** React Context (`AuthContext`), Zustand for trading store
- **Storage:** `@react-native-async-storage/async-storage`, `expo-secure-store`
- **UI:** Custom dark theme, `@expo/vector-icons`, `react-native-reanimated`
- **Charts:** `victory-native`, `@shopify/react-native-skia` (where used)
- **Build:** EAS (`eas.json`) — preview APK with `EXPO_PUBLIC_API_URL`

### Infrastructure
- **Backend host:** Render (root dir `backend`, `npm start`)
- **Database:** Supabase Postgres — apply `backend/sql/schema.sql` then all files in `backend/sql/migrations/` in filename order
- **Admin UI:** `backend/public/admin/index.html` (single-page, vanilla JS)

---

## 3. Repository layout

```
Ema/
├── backend/
│   ├── src/
│   │   ├── server.js              # Express bootstrap, route registration
│   │   ├── db.js                  # Supabase data access (large central module)
│   │   ├── adminRoutes.js         # /admin/api/*
│   │   ├── adminAiRoutes.js
│   │   ├── adminWithdrawals.js
│   │   ├── airfarmingRoutes.js
│   │   ├── airfarmingDrops.js     # Drop scheduling, settlement, auto-fund
│   │   ├── airfarmingDropUtils.js
│   │   ├── airfarmingPause.js
│   │   ├── vipFarmerRoutes.js
│   │   ├── vipFarmerService.js
│   │   ├── contractRoutes.js
│   │   ├── expertRoutes.js
│   │   ├── cryptoRoutes.js
│   │   ├── nowpaymentsRoutes.js
│   │   ├── localMoneyRoutes.js
│   │   ├── journalService.js
│   │   ├── userDropScheduleService.js
│   │   ├── complianceRoutes.js
│   │   ├── notificationRoutes.js
│   │   ├── supportRoutes.js
│   │   ├── whitelistWalletRoutes.js
│   │   ├── mt5EaWebhookRoutes.js
│   │   ├── middleware/            # auth, adminAuth, requireComplianceProfile
│   │   └── services/              # alpaca, mt5, nowpayments, tatum, trust score, email
│   ├── public/admin/index.html
│   └── sql/migrations/*.sql
├── ema-mobile/
│   ├── App.tsx
│   ├── src/screens/               # One screen per major flow
│   ├── src/services/              # API clients (api.ts base + domain services)
│   ├── src/navigation/
│   ├── src/components/
│   ├── src/theme/colors.ts
│   └── eas.json
└── docs/
```

---

## 4. Core data model (PostgreSQL / Supabase)

Apply migrations in chronological order. Key tables:

| Table | Purpose |
|-------|---------|
| `users` | email, password_hash, alpaca keys, totp, `transfer_code` (P2P) |
| `wallets` | Internal USD cash balance (1:1 user) |
| `transactions` | deposit, withdraw, peer_send, peer_receive |
| `airfarming_wallets` | Separate USD balance for Airfarming product |
| `airfarming_transfers` | cash ↔ airfarming movements |
| `airfarming_state` | per-user week, auto_fund_enabled, drop pause fields |
| `airfarming_drops` | scheduled/paid/missed drops with percent, min/max balance |
| `airfarming_drop_bands` | tier config (4 bands, admin-editable) |
| `airfarming_platform_settings` | max percent, max profit per drop |
| `airfarming_global_drop_pauses` | platform-wide scheduled pauses |
| `vip_investments` | locked principal, 30-day lock, status |
| `vip_accruals` | daily payout log |
| `contract_wallets` / `contract_accruals` | Contracts product |
| `expert_trading_wallets` | Expert / managed trading balance |
| `crypto_ethereum_wallets` | per-user HD wallet metadata |
| `crypto_ledger_entries` | USDT ledger in/out (asset, direction, source, source_id) |
| `nowpayments_payments` / `nowpayments_payouts` | crypto deposit/withdraw |
| `local_mobile_money_orders` | Rwanda/Uganda momo |
| `user_compliance_profiles` | KYC-style fields, required before withdraw |
| `user_whitelisted_wallets` | up to 3 withdrawal addresses |
| `support_tickets` | user support requests |
| `app_notifications` | in-app notifications |
| `app_announcements` | home banner |
| `mt5_accounts`, `mt5_ea_telemetry`, `mt5_ea_commands` | MT5 + EA webhook |
| `ai_daily_plans`, `ai_user_allocations` | AI earnings planner |
| `user_drop_schedules` | admin per-user drop plans |

**Crypto ledger `source` check constraint** must include at minimum:
`payment`, `payout`, `reserve`, `reserve_release`, `local_withdraw`, `local_deposit`, `local_withdraw_refund`, `cash_wallet`, `cash_wallet_refund`, `admin_adjustment`, `airfarming_auto_fund`

---

## 5. Authentication & security

### User auth
- `POST /auth/register` — email + password → JWT
- `POST /auth/login` — if TOTP enabled: `{ requiresTotp: true, preAuthToken }` else JWT
- `POST /auth/totp/verify` — Bearer pre-auth token + 6-digit code → JWT
- `GET /auth/me` — current user
- TOTP setup: `/auth/totp/setup/start`, `confirm`, `cancel`, `disable`, `GET /auth/totp/status`
- Password reset routes (email token flow)

### JWT
- Header: `Authorization: Bearer <token>`
- Secret: `JWT_SECRET` env
- Protected routes use `authMiddleware`

### Admin auth
- Separate: `POST /admin/api/login` → admin JWT (`ADMIN_PURPOSE` claim)
- Credentials: `ADMIN_USERNAME`, `ADMIN_PASSWORD` env
- All `/admin/api/*` except login require `adminAuthMiddleware`
- Admin static UI at `/admin` (or path configured in server)

### Compliance gate
- Withdrawals and some sensitive flows require `user_compliance_profiles` complete (`requireComplianceProfile` middleware)
- Mobile shows banner directing to Settings if incomplete

### Withdrawal protections
- **5% gas reserve** on crypto wallet — max withdrawable = 95% of balance; UI warns user
- **TOTP required** on withdraw when enabled
- **Whitelisted addresses** for crypto payouts (max 3)
- **Withdrawal trust score** affects Airfarming drop profit multiplier (see §7)

---

## 6. Wallet architecture (critical)

Users have **multiple balances**, not one:

1. **Cash wallet (`wallets`)** — internal USD; funds VIP, Contracts, Expert, Airfarming activation, peer transfers
2. **Airfarming wallet (`airfarming_wallets`)** — USD locked in Airfarming product; must return to cash before cash withdraw in some flows
3. **Crypto ledger (`crypto_ledger_entries`)** — USDT (primarily `usdttrc20`); NOWPayments deposits/payouts
4. **Contract wallet** — separate product balance
5. **Expert trading wallet** — separate, with `market_group` (`derived` | `metals`)

**Rule:** Alpaca/MT5 trading funds are separate from internal wallets.

### Admin wallet adjustments
`POST /admin/api/users/:id/wallets/adjust`
- Body: `{ wallet: 'cash'|'airfarming'|'usdt', mode: 'set'|'adjust', direction: 'add'|'remove', amount, reason }`
- `reason` required; writes ledger/transaction audit trails
- For `adjust` + `remove`, amount is positive in UI but stored as negative adjustment
- USDT uses `crypto_ledger_entries` with `source: 'admin_adjustment'`

---

## 7. Product: Airfarming (Airfarmers)

### Concept
Users move cash into **Airfarming balance**. The platform schedules **drops** every **2–5 hours** (UTC week). Each drop has:
- `percent` (capped by platform settings, default max **57.9%**)
- `min_balance` / `max_balance` eligibility window
- `due_at` timestamp

If balance is **within range at settlement**, user earns `profit = balance × percent × trustMultiplier` (capped by daily AI budget if active).

### Anti-gaming: 24h snapshot
- **24 hours before `due_at`**, capture `eligibility_snapshot_balance` on the drop row
- Eligibility for paid/missed uses **snapshot**, not live balance at drop second
- UI copy must explain this clearly

### Auto-fund
- User toggle: `POST /airfarming/auto-fund` `{ enabled }`
- **T−5 minutes** before `due_at`: if enabled and drop `scheduled`, run `autoAdjustToRange`:
  - Below min → top up from cash, then USDT crypto
  - Above max → trim excess back to cash
- Set `auto_fund_prepared_at` on drop (idempotent)
- At settlement: skip auto-adjust if already prepared; else adjust if out of range

### Drop lifecycle (API fields on `GET /airfarming/status`)
- `dropPhase`: `waiting` | `preparing` | `processing` | `rewarding` | `idle`
  - `waiting`: >5 min to drop
  - `preparing`: ≤5 min to drop
  - `processing`: past due, still scheduled
  - `rewarding`: just settled (expose `lastSettledDrop` ~45s)
- `pollIntervalSec`: **5** during preparing/processing/rewarding, else **45**
- Settlement is **lazy** on status poll (`processDueDrops` → `settleDrop`)

### Drop bands (default balance windows)
| band_index | min | max |
|------------|-----|-----|
| 0 | 100 | 145 |
| 1 | 100 | 112 |
| 2 | 1000 | 2400 |
| 3 | 10000 | 16000 |

### Withdrawal trust score
Computed from withdrawals (cash, crypto, momo) over 7d/30d/90d, illegal/failed counts, deposit ratio.
- Score 0–100, bands: excellent/good/fair/low/poor
- `dropPotentialMultiplier` scales projected/paid drop profit
- Exposed on `GET /airfarming/status` as `withdrawalTrustScore`

### Mobile: `AirfarmingTradeScreen`
**Always visible:**
- Title + subtitle
- 2-stat row: Cash | Airfarming balance
- Hero: countdown, required range one line, info icon
- **3-step progress rail** (`AirfarmingDropProgress`): Waiting → Processing → Rewarding (spinners during prep/settlement)
- Upcoming drops list (max 2 visible + “N more”)
- FAB: Activate / Return to cash

**Collapsed “Details” section:**
- Auto-fund toggle
- Platform highlight
- Trust score (dismissible via `CollapsibleNotice` + AsyncStorage)
- Eligibility notice (dismissible)
- Legal disclaimer (dismissible)
- Week summary, drop history, optional opportunity circle

**Polling:** use `pollIntervalSec` from API; local 1s countdown tick

### API routes
- `GET /airfarming/status`
- `POST /airfarming/activate` `{ amount }`
- `POST /airfarming/return-to-cash` `{ amount }`
- `POST /airfarming/auto-fund` `{ enabled }`

---

## 8. Product: VIP Farmers (Live VIP Farmers)

### Rules
- **Min invest:** $100 (`VIP_MIN_INVEST_USD`)
- **Lock:** 30 UTC days
- **Daily rate:** 9% of **principal** paid to **cash wallet** each UTC day
- **One active investment** per user at a time
- **Add capital** (while active): debit cash, increase principal, **reset lock** from today (`started_at`, `matures_at`, `days_accrued = 0`); keep `total_accrued_usd` history
- **Withdraw at maturity:** return principal to cash
- **Early exit:** 30% penalty on principal; accrued payouts stay in cash
- Daily accrual cron: `POST /internal/vip-farmers/daily-accrue` (protected by `INTERNAL_CRON_SECRET` or `x-internal-cron-secret`)

### API
- `GET /vip-farmers/summary`
- `POST /vip-farmers/invest` `{ amount }`
- `POST /vip-farmers/add-capital` `{ amount }`
- `POST /vip-farmers/withdraw`
- `POST /vip-farmers/early-withdraw`

### Mobile: `VipFarmersTradeScreen`
- Show cash, active investment stats (principal, earned, days left, matures date)
- If no investment: invest form
- If active & not matured: Add capital + Early exit
- If matured: Withdraw principal

### Admin
- Users list: **VIP** column (active pill + principal)
- User detail: VIP principal + status stats

---

## 9. Product: Contracts

- Separate `contract_wallets` balance
- Deposit from cash, withdraw to cash
- **2% daily accrual** cron on positive balances (`/internal/contracts/daily-accrue`)
- Mobile: `ContractsTradeScreen`

---

## 10. Product: Expert Account Manager

- Fund from cash into `expert_trading_wallets`
- Choose `market_group`: `derived` or `metals` (cannot switch with positive balance)
- Return to cash
- Mobile: `ExpertAutoTradingScreen` — connect MT5, risk settings

---

## 11. Product: Alpaca (Forex market)

- User stores Alpaca API key/secret in Settings (server-side only)
- Mobile: `AlpacaTradeScreen` — quotes, orders, positions
- Hidden by default on Trades hub (user can unhide)

---

## 12. MT5

- Users add MT5 accounts (login, password, server) → MetaApi provisioning
- Balance/positions refresh, place orders via MetaApi
- **EA webhook flow:** bearer token per account, telemetry POST, command poll/ack
- Mobile: `MT5Screen` under **Extra** tab (not main Trades hub)
- MQ5 EA source in `backend/docs/EmaWebhookEa.mq5`

---

## 13. Crypto wallet (NOWPayments + Tatum)

### Deposits
- Create NOWPayments invoice → user pays → IPN `finished` credits `crypto_ledger_entries` (`source: payment`)

### Withdrawals
- User requests payout → may fund from cash wallet 1:1 (`cash_wallet` ledger entries) → admin approves → NOWPayments payout
- Whitelist enforcement, TOTP, compliance

### On-chain
- Tatum webhook for Ethereum activity
- Default deposit addresses for ETH / USDT TRC20 (env-configurable shared custodial addresses)
- Per-user `crypto_ethereum_wallets` for HD/sync

### Mobile
- Wallet screen: balances, deposit, withdraw modals, gas banner (dismissible)
- `CryptoDepositPaymentScreen`, transaction history

---

## 14. Local mobile money (Rwanda / Uganda)

- Deposit USDT → receive local currency via Flutterwave
- Withdraw USDT → mobile money payout
- Min **2 USDT**, regions with `usdtToFiatRate`
- `LocalMoneyScreen` under Extra

---

## 15. P2P & peer transfers

- Each user has `transfer_code` (e.g. `AIRFARMS-XXXXXXXX`)
- Send cash to another user by code
- `P2PScreen`, `SendByIdScreen`

---

## 16. Journal

- Calendar month view of earnings by source: airfarming drops, VIP, contracts
- `GET /journal/month`, `GET /journal/day`
- Mobile: `JournalScreen` tab

---

## 17. Support, notifications, announcements

- Support tickets with categories; `SupportScreen`
- In-app notifications list; bell on Home header
- Admin can broadcast or target user notifications
- Home **announcement banner** (dismissible); admin publishes via admin Notify tab

---

## 18. Mobile app structure

### Theme (`palette`)
```ts
background: '#0B1220'
surface: '#111827'
surfaceElevated: '#1A2435'
border: '#243047'
primary: '#F4C542'      // gold accent
textPrimary: '#FFFFFF'
textSecondary: '#94A3B8'
success: '#00C805'
danger: '#FF4D4F'
```

### Navigation
**Root stack** (authenticated):
- `MainTabs` (bottom tabs)
- Modal stacks: AlpacaTrade, AirfarmingTrade, VipFarmersTrade, ContractsTrade, ExpertAutoTrading
- Notifications, TransactionHistory, TransactionDetail, CryptoDepositPayment, Support

**Main tabs:**
| Tab | Screen | Notes |
|-----|--------|-------|
| Home | HomeScreen | Dashboard, announcement, quick stats |
| Journal | JournalScreen | Earnings calendar |
| Trades | TradesHubScreen | Product cards + airfarming eligibility dot |
| Wallet | WalletScreen | Cash + crypto, withdraw/deposit |
| Extra | ExtraStackNavigator | P2P, Send, Momo, MT5, Settings |

### Trades hub products (`tradeHubItems.ts`)
Default **hidden** (user can show): forex, contracts, expert  
Default **visible**: airfarming, vip

Each card: title, meta, ROI line → navigates to product screen.

**Airfarming eligibility indicator** on Trades hub: poll `GET /airfarming/status` every 45s + on focus; green/red dot if any upcoming drop `eligibleNow`.

### Auth flow
- `AuthScreen` — login/register
- `AuthContext` stores JWT, user profile
- Optional app lock (biometrics) via `AppLockContext`

### Shared components
- `Card`, `PrimaryButton`, `FormModal`, `CollapsibleNotice` (collapsed default, dismiss X → AsyncStorage)
- `AirfarmingDropProgress` — 3-step drop rail
- `WithdrawalProgressSteps` — 5-step withdraw UX
- `UpcomingDropsList`, `WalletActivityList`, `AnnouncementBanner`

### API client (`services/api.ts`)
- Base URL from `EXPO_PUBLIC_API_URL`
- Attaches JWT; handles errors

---

## 19. Admin console (`backend/public/admin/index.html`)

Single-page vanilla JS app. Sidebar tabs:

| Tab | Capabilities |
|-----|----------------|
| **Users** | Search, list (cash, airfarming, **VIP**, drop pause), view user detail |
| **Support** | Tickets filter, status update |
| **Withdrawals** | Pending queue, approve/reject (cash, crypto, momo sources) |
| **AI earnings** | Daily plan budget, market fetch, run planner, approve |
| **Drop tiers** | Edit 4 bands (percent, min/max, label) |
| **Drops** | All scheduled drops, edit percent/range/due |
| **Notify** | Push notification to user or broadcast; announcements |

**User detail page includes:**
- Stats grid (cash, airfarming, USDT, VIP principal/status, deposits/profits 90d charts)
- Pause/resume drops, scheduled drops table
- Per-user **drop schedule** planner (AI suggest + apply)
- Wallet adjust (add/remove direction), move cash → airfarming
- Password reset
- Journal calendar (read-only admin view)

---

## 20. Internal / cron endpoints

Protect with `INTERNAL_CRON_SECRET` header or body `secret`:
- `POST /internal/vip-farmers/daily-accrue`
- `POST /internal/contracts/daily-accrue`
- `POST /internal/ai/daily-plan` (AI planner)
- Airfarming drop settlement is **not** cron — driven by user/admin traffic + status polls

---

## 21. Webhooks (raw body signature verification)

| Path | Provider |
|------|----------|
| `POST /crypto/webhooks/tatum` | Tatum |
| `POST /webhooks/nowpayments/payment` | NOWPayments deposit IPN |
| `POST /webhooks/nowpayments/payout` | NOWPayments payout IPN |
| `POST /webhooks/flutterwave` | Mobile money |
| `POST /webhooks/mt5-ea/telemetry` | MT5 EA (Bearer or HMAC) |
| `GET /webhooks/mt5-ea/commands` | EA poll |
| `POST /webhooks/mt5-ea/commands/:id/ack` | EA ack |

---

## 22. Environment variables (backend)

Required:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `APP_BASE_URL` (public URL for webhooks)

Production:
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- `TOTP_ENCRYPTION_KEY` (32 bytes hex)
- `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`
- `MT5_METAAPI_TOKEN`
- `INTERNAL_CRON_SECRET`
- `DEEPSEEK_API_KEY` (AI planner)
- Optional: `MT5_EA_WEBHOOK_SECRET`, Tatum keys, Flutterwave, email SMTP

Mobile:
- `EXPO_PUBLIC_API_URL` → backend URL

---

## 23. Implementation conventions

### Backend
- Centralize Supabase in `db.js`; domain logic in route modules + `*Service.js` files
- Use `crypto.randomUUID()` for IDs
- Money: round to 2 decimals for USD; crypto ledger uses `numeric(24,8)`
- Return `{ message }` errors with appropriate HTTP status
- `isMissingTableError` → 503 with migration hint for schema-not-ready

### Mobile
- TypeScript strict; domain types in `services/*Service.ts` and `types/index.ts`
- Poll with `useEffect` + `setInterval`; refresh on `AppState` active + pull-to-refresh
- User-facing brand: **Airfarms** / **Airfarmers** (not EMA in UI copy)
- Format USD: `$` + locale string, 2 decimals where appropriate

### Admin
- No framework; `fetch` with admin JWT in `localStorage`
- Confirm dialogs on destructive wallet adjustments

---

## 24. Acceptance criteria (MVP parity checklist)

- [ ] User can register, login, enable TOTP, complete compliance profile
- [ ] Cash deposit/withdraw; crypto deposit via NOWPayments; withdraw with whitelist + TOTP + gas reserve
- [ ] Airfarming: activate, auto-fund toggle, see drops, 3-step progress, paid/missed settlement
- [ ] VIP: invest, add capital (lock reset), early exit, mature withdraw; daily accrual cron works
- [ ] Contracts + Expert fund/return flows
- [ ] Trades hub with hide/show products; airfarming eligibility indicator
- [ ] P2P send by transfer code; local money screens
- [ ] Journal month/day views
- [ ] Admin: users, VIP column, wallet adjust add/remove USDT, withdrawals approve, drops edit, tiers, notifications
- [ ] All SQL migrations apply cleanly on fresh Supabase project
- [ ] EAS preview APK builds against deployed Render API

---

## 25. Explicit non-goals (unless asked)

- iOS App Store / Play Store submission assets
- Multi-language i18n
- Light theme (dark only)
- Real-time WebSockets (polling is intentional)
- On-chain Tron deposit auto-credit (TRC20 address shown; monitoring optional/future)

---

## 26. Suggested build order for the AI agent

1. Supabase schema + migrations + seed platform settings/bands  
2. Express auth, wallets, transactions, health check  
3. Mobile auth + tabs shell + theme  
4. Wallet + crypto (NOWPayments) + compliance + TOTP  
5. Airfarming backend + mobile screen (drops, auto-fund, trust score)  
6. VIP Farmers backend + mobile  
7. Contracts, Expert, Alpaca, MT5  
8. P2P, local money, journal, notifications  
9. Admin HTML console (all tabs)  
10. Internal crons + webhooks hardening  
11. EAS build + Render deploy docs  

---

## 27. Reference deployment

- GitHub: `willerdev/ema` (monorepo)
- Backend: Render web service, root `backend`, port from `PORT`
- Mobile preview: `eas build --profile preview --platform android` with `EXPO_PUBLIC_API_URL` pointing to Render URL
- Run pending migrations in Supabase SQL editor before testing admin crypto remove or airfarming auto-fund prep columns

---

*End of build prompt. Reproduce behavior and data flows above; match API shapes and UX patterns even if internal file names differ slightly.*
