const crypto = require('crypto');
const {
  ensureWalletForUser,
  setWalletBalance,
  getExpertTradingWalletByUserId,
  upsertExpertTradingWalletRow,
  insertExpertTradingTransfer,
  isMissingTableError,
} = require('./db');

function newId() {
  return crypto.randomUUID();
}

const VALID_MARKET_GROUPS = new Set(['derived', 'metals']);

function registerExpertRoutes(app, { authMiddleware }) {
  const schemaMsg =
    'Expert trading schema missing. Run backend/sql/migrations/20260527_expert_trading_wallet.sql in Supabase.';

  app.get('/expert/summary', authMiddleware, async (req, res) => {
    try {
      const wallet = await ensureWalletForUser(req.userId);
      const expert = await getExpertTradingWalletByUserId(req.userId);
      return res.json({
        cashWallet: Number.parseFloat(String(wallet.balance ?? 0)) || 0,
        expertBalance: Number(expert?.balance || 0),
        marketGroup: expert?.market_group || null,
        updatedAt: expert?.updated_at || null,
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e?.message || 'Expert summary failed' });
    }
  });

  app.post('/expert/fund', authMiddleware, async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      const marketGroup = String(req.body?.marketGroup || '').toLowerCase();
      if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
      if (!VALID_MARKET_GROUPS.has(marketGroup)) {
        return res.status(400).json({ message: 'Choose derived or metals to trade.' });
      }

      const wallet = await ensureWalletForUser(req.userId);
      const cash = Number.parseFloat(String(wallet.balance ?? 0)) || 0;
      if (cash < amount) return res.status(400).json({ message: 'Insufficient cash wallet balance' });

      const expert = await getExpertTradingWalletByUserId(req.userId);
      const expertBal = Number(expert?.balance || 0);
      if (expert && expert.market_group && expert.market_group !== marketGroup && expertBal > 0) {
        return res.status(400).json({
          message: 'Return your expert balance to cash before switching market type.',
        });
      }

      const nextExpert = expertBal + amount;
      await setWalletBalance(req.userId, cash - amount);
      const row = await upsertExpertTradingWalletRow({
        user_id: req.userId,
        market_group: marketGroup,
        balance: nextExpert,
        updated_at: new Date().toISOString(),
      });
      await insertExpertTradingTransfer({
        id: newId(),
        user_id: req.userId,
        direction: 'to_expert',
        amount,
      });

      return res.json({
        cashWallet: cash - amount,
        expertBalance: Number(row.balance || 0),
        marketGroup: row.market_group,
        updatedAt: row.updated_at,
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e?.message || 'Funding expert trading failed' });
    }
  });

  app.post('/expert/return-to-cash', authMiddleware, async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

      const wallet = await ensureWalletForUser(req.userId);
      const expert = await getExpertTradingWalletByUserId(req.userId);
      if (!expert) return res.status(400).json({ message: 'No expert trading balance' });
      const expertBal = Number(expert?.balance || 0);
      if (expertBal < amount) return res.status(400).json({ message: 'Insufficient expert trading balance' });

      const cash = Number.parseFloat(String(wallet.balance ?? 0)) || 0;
      const nextExpert = expertBal - amount;

      await setWalletBalance(req.userId, cash + amount);
      const row = await upsertExpertTradingWalletRow({
        user_id: req.userId,
        market_group: expert.market_group,
        balance: nextExpert,
        updated_at: new Date().toISOString(),
      });
      await insertExpertTradingTransfer({
        id: newId(),
        user_id: req.userId,
        direction: 'to_cash',
        amount,
      });

      return res.json({
        cashWallet: cash + amount,
        expertBalance: Number(row.balance || 0),
        marketGroup: row.market_group,
        updatedAt: row.updated_at,
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e?.message || 'Return to cash failed' });
    }
  });
}

module.exports = { registerExpertRoutes };
