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

## 5) Point mobile app to production backend

Set the mobile environment variable to your Render URL:

- `EXPO_PUBLIC_API_URL=https://your-render-service.onrender.com`

Then rebuild your app for production.

## 6) Production hardening checklist

- Disable or strictly guard dev-only endpoints (`/wallet/reset`)
- Rotate secrets if they were ever shared in plain text
- Enable Render auto-deploy on push to `main`
- Monitor logs and failed requests in Render dashboard
