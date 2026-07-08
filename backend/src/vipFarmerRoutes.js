const { isMissingTableError } = require('./db');
const {
  getVipSummary,
  listVipAccrualHistory,
  investVip,
  addCapitalVip,
  reinvestVip,
  withdrawVipAtMaturity,
  earlyWithdrawVip,
  runVipDailyAccrual,
} = require('./vipFarmerService');
const { previewVipExit, requestVipExit, listUserVipExitRequests } = require('./vipExitService');
const { getVipLoanStatus, requestVipLoan, repayVipLoan } = require('./vipLoanService');

function requireCronSecret(req) {
  const expected = process.env.INTERNAL_CRON_SECRET;
  if (!expected) return false;
  const got = req.headers['x-internal-cron-secret'] || req.body?.secret;
  return String(got || '') === String(expected);
}

function registerVipFarmerRoutes(app, { authMiddleware }) {
  const schemaMsg =
    'VIP Farmers schema missing. Run backend/sql/migrations/20260605_vip_farmers.sql and 20260708_vip_farmers_v2.sql in Supabase.';

  app.get('/vip-farmers/summary', authMiddleware, async (req, res) => {
    try {
      return res.json(await getVipSummary(req.userId));
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'VIP summary failed' });
    }
  });

  app.get('/vip-farmers/accruals', authMiddleware, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
      return res.json(await listVipAccrualHistory(req.userId, limit));
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'VIP accrual history failed' });
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

  app.post('/vip-farmers/reinvest', authMiddleware, async (req, res) => {
    try {
      const result = await reinvestVip(req.userId, req.body?.amount);
      return res.json(result);
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Reinvest failed' });
    }
  });

  app.post('/vip-farmers/exit/preview', authMiddleware, async (req, res) => {
    try {
      return res.json(await previewVipExit(req.userId, req.body || {}));
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Exit preview failed' });
    }
  });

  app.post('/vip-farmers/exit/request', authMiddleware, async (req, res) => {
    try {
      const result = await requestVipExit(req.userId, req.body || {});
      return res.status(201).json(result);
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Exit request failed' });
    }
  });

  app.get('/vip-farmers/exit/requests', authMiddleware, async (req, res) => {
    try {
      return res.json(await listUserVipExitRequests(req.userId));
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to load exit requests' });
    }
  });

  app.get('/vip-farmers/loans/status', authMiddleware, async (req, res) => {
    try {
      return res.json(await getVipLoanStatus(req.userId));
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Loan status failed' });
    }
  });

  app.post('/vip-farmers/loans/request', authMiddleware, async (req, res) => {
    try {
      const result = await requestVipLoan(req.userId, req.body?.amount);
      return res.status(201).json(result);
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Loan request failed' });
    }
  });

  app.post('/vip-farmers/loans/repay', authMiddleware, async (req, res) => {
    try {
      const result = await repayVipLoan(req.userId, req.body?.amount);
      return res.json(result);
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Loan repay failed' });
    }
  });

  app.post('/vip-farmers/withdraw', authMiddleware, async (req, res) => {
    try {
      await withdrawVipAtMaturity(req.userId);
      return res.json({ ok: true });
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Withdraw failed' });
    }
  });

  app.post('/vip-farmers/early-withdraw', authMiddleware, async (req, res) => {
    try {
      await earlyWithdrawVip(req.userId);
      return res.json({ ok: true });
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
