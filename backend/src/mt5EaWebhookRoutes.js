const crypto = require('crypto');
const express = require('express');
const {
  getMt5AccountByEaWebhookToken,
  getMt5AccountByLoginAndServer,
  insertMt5EaTelemetry,
  listPendingMt5EaCommands,
  ackMt5EaCommand,
  updateMt5EaPositionsSnapshot,
  upsertMarketPriceRow,
  isMissingTableError,
} = require('./db');
const { priceRowFromPayload } = require('./services/priceFeedNormalize');

function parseBearer(req) {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function hmacSha256HexValid(secret, rawBuf, sigHeader) {
  if (!secret || !rawBuf || !sigHeader) return false;
  const mac = crypto.createHmac('sha256', secret).update(rawBuf).digest('hex');
  const provided = String(sigHeader)
    .replace(/^sha256=/i, '')
    .trim()
    .toLowerCase();
  if (provided.length !== mac.length || provided.length !== 64) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(mac, 'hex'));
  } catch {
    return false;
  }
}

async function resolveEaAccountForPost(req) {
  const bearer = parseBearer(req);
  if (bearer) {
    const row = await getMt5AccountByEaWebhookToken(bearer);
    if (row) return row;
  }
  const secret = process.env.MT5_EA_WEBHOOK_SECRET;
  const sig = req.headers['x-mt5-ea-signature'];
  if (!secret || !sig || !req.rawMt5EaBody) return null;
  if (!hmacSha256HexValid(secret, req.rawMt5EaBody, sig)) return null;
  const login = req.body?.login;
  const server = req.body?.server;
  if (!login || !server) return null;
  return getMt5AccountByLoginAndServer(login, server);
}

function registerMt5EaWebhookRoutes(app) {
  const router = express.Router();

  router.post(
    '/telemetry',
    express.json({
      limit: '512kb',
      verify: (req, res, buf) => {
        req.rawMt5EaBody = buf;
      },
    }),
    async (req, res) => {
      try {
        const account = await resolveEaAccountForPost(req);
        if (!account) return res.status(401).json({ message: 'Unauthorized' });
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        await insertMt5EaTelemetry({ mt5AccountId: account.id, payload });
        if (Array.isArray(payload.positions) || payload.balance != null || payload.equity != null) {
          await updateMt5EaPositionsSnapshot(account.id, {
            positions: payload.positions,
            balance: payload.balance,
            equity: payload.equity,
          });
        }
        return res.json({ ok: true });
      } catch (e) {
        if (isMissingTableError(e)) {
          return res.status(503).json({
            message: 'MT5 EA tables missing. Run backend/sql/migrations/20260513_mt5_ea_webhook.sql in Supabase.',
          });
        }
        console.error('mt5-ea telemetry', e);
        return res.status(500).json({ message: e?.message || 'telemetry failed' });
      }
    }
  );

  router.get('/commands', async (req, res) => {
    try {
      const bearer = parseBearer(req);
      if (!bearer) return res.status(401).json({ message: 'Authorization Bearer token required' });
      const account = await getMt5AccountByEaWebhookToken(bearer);
      if (!account) return res.status(401).json({ message: 'Invalid or unset EA token. POST /mt5/accounts/:id/ea-webhook-token from the app.' });
      const rows = await listPendingMt5EaCommands(account.id, 50);
      return res.json({
        commands: rows.map((r) => ({
          id: r.id,
          clientId: r.client_id,
          commandType: r.command_type || 'place_order',
          side: r.side,
          symbol: r.symbol,
          volume: Number(r.volume),
          stopLoss: r.stop_loss != null ? Number(r.stop_loss) : null,
          takeProfit: r.take_profit != null ? Number(r.take_profit) : null,
          positionTicket: r.position_ticket != null ? Number(r.position_ticket) : null,
          closeSide: r.close_side || null,
          magic: r.magic,
          createdAt: r.created_at,
        })),
      });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'MT5 EA tables missing. Run migrations/20260513_mt5_ea_webhook.sql' });
      }
      console.error('mt5-ea commands list', e);
      return res.status(500).json({ message: e?.message || 'list failed' });
    }
  });

  router.post('/commands/:commandId/ack', express.json({ limit: '128kb' }), async (req, res) => {
    try {
      const bearer = parseBearer(req);
      if (!bearer) return res.status(401).json({ message: 'Authorization Bearer token required' });
      const account = await getMt5AccountByEaWebhookToken(bearer);
      if (!account) return res.status(401).json({ message: 'Invalid token' });
      const commandId = req.params.commandId;
      const status = String(req.body?.status || '').toLowerCase();
      if (status !== 'acked' && status !== 'failed') {
        return res.status(400).json({ message: 'body.status must be "acked" or "failed"' });
      }
      const updated = await ackMt5EaCommand(account.id, commandId, {
        status,
        ackTicket: req.body?.ticket != null ? Number(req.body.ticket) : null,
        ackError: req.body?.error != null ? String(req.body.error) : null,
        ackMeta: req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : null,
      });
      if (!updated) return res.status(404).json({ message: 'Command not found or not pending' });
      return res.json({ ok: true });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'MT5 EA tables missing. Run migrations/20260513_mt5_ea_webhook.sql' });
      }
      console.error('mt5-ea ack', e);
      return res.status(500).json({ message: e?.message || 'ack failed' });
    }
  });

  router.post(
    '/prices',
    express.json({ limit: '1mb' }),
    async (req, res) => {
      try {
        const secret = process.env.MT5_PRICE_FEED_SECRET;
        const got = req.headers['x-price-feed-secret'] || req.body?.secret;
        if (!secret || String(got || '') !== String(secret)) {
          return res.status(401).json({ message: 'Unauthorized' });
        }
        const items = Array.isArray(req.body?.prices) ? req.body.prices : Array.isArray(req.body) ? req.body : [];
        const now = new Date().toISOString();
        const today = now.slice(0, 10);
        let updated = 0;
        for (const item of items) {
          const row = priceRowFromPayload(item);
          if (!row) continue;
          await upsertMarketPriceRow({
            symbol: row.symbol,
            bid: row.bid,
            ask: row.ask,
            updated_at: now,
            day_open: row.dayOpen,
            day_high: row.dayHigh,
            day_low: row.dayLow,
            day_stats_date: today,
          });
          updated += 1;
        }
        return res.json({ ok: true, updated });
      } catch (e) {
        if (isMissingTableError(e)) {
          return res.status(503).json({ message: 'Market prices schema missing.' });
        }
        console.error('mt5-ea prices', e);
        return res.status(500).json({ message: e?.message || 'prices failed' });
      }
    }
  );

  app.use('/webhooks/mt5-ea', router);
}

module.exports = { registerMt5EaWebhookRoutes };
