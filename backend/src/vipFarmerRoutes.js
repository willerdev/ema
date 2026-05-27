const { isMissingTableError } = require('./db');
const {
  getVipSummary,
  investVip,
  addCapitalVip,
  withdrawVipAtMaturity,
  earlyWithdrawVip,
  runVipDailyAccrual,
} = require('./vipFarmerService');

function requireCronSecret(req) {
  const expected = process.env.INTERNAL_CRON_SECRET;
  if (!expected) return false;
  const got = req.headers['x-internal-cron-secret'] || req.body?.secret;
  return String(got || '') === String(expected);
}

function registerVipFarmerRoutes(app, { authMiddleware }) {
  const schemaMsg =
    'VIP Farmers schema missing. Run backend/sql/migrations/20260605_vip_farmers.sql in Supabase.';

  app.get('/vip-farmers/summary', authMiddleware, async (req, res) => {
    try {
      return res.json(await getVipSummary(req.userId));
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'VIP summary failed' });
    }
  });

  app.post('/vip-farmers/invest', authMiddleware, async (req, res) => {
    try {
      const result = await investVip(req.userId, req.body?.amount);
      return res.status(201).json(result);
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Invest failed' });
    }
  });

  app.post('/vip-farmers/add-capital', authMiddleware, async (req, res) => {
    try {
      const result = await addCapitalVip(req.userId, req.body?.amount);
      return res.json(result);
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Add capital failed' });
    }
  });

  app.post('/vip-farmers/withdraw', authMiddleware, async (req, res) => {
    try {
      const result = await withdrawVipAtMaturity(req.userId);
      return res.json(result);
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Withdraw failed' });
    }
  });

  app.post('/vip-farmers/early-withdraw', authMiddleware, async (req, res) => {
    try {
      const result = await earlyWithdrawVip(req.userId);
      return res.json(result);
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Early withdraw failed' });
    }
  });

  app.post('/internal/vip-farmers/daily-accrue', async (req, res) => {
    try {
      if (!requireCronSecret(req)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const planDate = String(req.body?.planDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const result = await runVipDailyAccrual(planDate);
      return res.json(result);
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      console.error('[internal/vip-farmers/daily-accrue]', e);
      return res.status(500).json({ message: e.message || 'VIP accrue failed' });
    }
  });
}

module.exports = { registerVipFarmerRoutes };
