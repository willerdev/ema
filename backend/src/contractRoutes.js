const crypto = require('crypto');
const {
  ensureWalletForUser,
  setWalletBalance,
  getContractWalletByUserId,
  upsertContractWalletRow,
  getContractAccrualForUserDay,
  insertContractAccrual,
  listContractWalletsWithPositiveBalance,
  isMissingTableError,
} = require('./db');

function newId() {
  return crypto.randomUUID();
}

function utcTodayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function requireCronSecret(req) {
  const expected = process.env.INTERNAL_CRON_SECRET;
  if (!expected) return false;
  const got = req.headers['x-internal-cron-secret'] || req.body?.secret;
  return String(got || '') === String(expected);
}

function registerContractRoutes(app, { authMiddleware }) {
  const schemaMsg =
    'Contracts schema missing. Run backend/sql/schema.sql in Supabase (contract_wallets, contract_accruals).';

  app.get('/contracts/summary', authMiddleware, async (req, res) => {
    try {
      const wallet = await ensureWalletForUser(req.userId);
      const cw = await getContractWalletByUserId(req.userId);
      return res.json({
        cashWallet: Number.parseFloat(String(wallet.balance ?? 0)) || 0,
        contractBalance: Number(cw?.balance || 0),
        updatedAt: cw?.updated_at || null,
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e?.message || 'Contracts summary failed' });
    }
  });

  app.post('/contracts/deposit', authMiddleware, async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

      const wallet = await ensureWalletForUser(req.userId);
      const cash = Number.parseFloat(String(wallet.balance ?? 0)) || 0;
      if (cash < amount) return res.status(400).json({ message: 'Insufficient cash wallet balance' });

      const cw = await getContractWalletByUserId(req.userId);
      const nextContract = Number(cw?.balance || 0) + amount;

      await setWalletBalance(req.userId, cash - amount);
      await upsertContractWalletRow({
        user_id: req.userId,
        balance: nextContract,
        updated_at: new Date().toISOString(),
      });

      return res.json({ cashWallet: cash - amount, contractBalance: nextContract });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e?.message || 'Deposit failed' });
    }
  });

  app.post('/contracts/withdraw', authMiddleware, async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

      const wallet = await ensureWalletForUser(req.userId);
      const cw = await getContractWalletByUserId(req.userId);
      const cBal = Number(cw?.balance || 0);
      if (cBal < amount) return res.status(400).json({ message: 'Insufficient contract balance' });

      const cash = Number.parseFloat(String(wallet.balance ?? 0)) || 0;
      const nextContract = cBal - amount;

      await setWalletBalance(req.userId, cash + amount);
      await upsertContractWalletRow({
        user_id: req.userId,
        balance: nextContract,
        updated_at: new Date().toISOString(),
      });

      return res.json({ cashWallet: cash + amount, contractBalance: nextContract });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e?.message || 'Withdraw failed' });
    }
  });

  app.post('/internal/contracts/daily-accrue', async (req, res) => {
    try {
      if (!requireCronSecret(req)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const today = utcTodayYmd();
      const rows = await listContractWalletsWithPositiveBalance();
      let applied = 0;
      for (const row of rows) {
        const existing = await getContractAccrualForUserDay(row.user_id, today);
        if (existing) continue;
        const b = Number(row.balance);
        if (!(b > 0)) continue;
        const rate = 0.02;
        const amount = b * rate;
        const newBal = b + amount;
        await insertContractAccrual({
          id: newId(),
          user_id: row.user_id,
          accrual_date: today,
          rate,
          amount,
          balance_after: newBal,
        });
        await upsertContractWalletRow({
          user_id: row.user_id,
          balance: newBal,
          updated_at: new Date().toISOString(),
        });
        applied += 1;
      }
      return res.json({ ok: true, date: today, walletsProcessed: rows.length, accrualsApplied: applied });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e?.message || 'Accrue failed' });
    }
  });
}

module.exports = { registerContractRoutes };
