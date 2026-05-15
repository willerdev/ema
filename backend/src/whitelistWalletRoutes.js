const crypto = require('crypto');
const {
  listWhitelistedWalletsByUserId,
  insertWhitelistedWallet,
  deleteWhitelistedWalletForUser,
  getWhitelistedWalletForUser,
  MAX_WHITELISTED_WALLETS_PER_USER,
  isMissingTableError,
} = require('./db');
const { normalizeCurrency } = require('./currencyNormalize');

function newId() {
  return crypto.randomUUID();
}

function toPublic(row) {
  return {
    id: row.id,
    label: row.label || '',
    currency: row.currency,
    address: row.address,
    createdAt: row.created_at,
  };
}

function registerWhitelistWalletRoutes(app, { authMiddleware }) {
  const schemaErrorMessage =
    'Whitelist wallet schema missing. Run backend/sql/migrations/20260517_user_whitelisted_wallets.sql in Supabase.';

  app.get('/whitelist-wallets', authMiddleware, async (req, res) => {
    try {
      const rows = await listWhitelistedWalletsByUserId(req.userId);
      return res.json({
        wallets: rows.map(toPublic),
        maxWallets: MAX_WHITELISTED_WALLETS_PER_USER,
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaErrorMessage });
      return res.status(500).json({ message: e.message || 'Failed to list whitelisted wallets' });
    }
  });

  app.post('/whitelist-wallets', authMiddleware, async (req, res) => {
    try {
      const currency = normalizeCurrency(req.body.currency);
      const address = String(req.body.address || '').trim();
      const label = req.body.label != null ? String(req.body.label).trim() : '';
      if (!currency) return res.status(400).json({ message: 'currency is required' });
      if (!address) return res.status(400).json({ message: 'address is required' });

      const row = await insertWhitelistedWallet({
        id: newId(),
        user_id: req.userId,
        label: label || null,
        currency,
        address,
      });
      const rows = await listWhitelistedWalletsByUserId(req.userId);
      return res.json({ wallet: toPublic(row), wallets: rows.map(toPublic), maxWallets: MAX_WHITELISTED_WALLETS_PER_USER });
    } catch (e) {
      if (e.code === 'WHITELIST_WALLET_LIMIT') {
        return res.status(400).json({ message: e.message, code: 'WHITELIST_WALLET_LIMIT' });
      }
      if (e.code === 'WHITELIST_WALLET_DUPLICATE') {
        return res.status(400).json({ message: e.message, code: 'WHITELIST_WALLET_DUPLICATE' });
      }
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaErrorMessage });
      return res.status(500).json({ message: e.message || 'Failed to add whitelisted wallet' });
    }
  });

  app.delete('/whitelist-wallets/:id', authMiddleware, async (req, res) => {
    try {
      const existing = await getWhitelistedWalletForUser(req.userId, req.params.id);
      if (!existing) return res.status(404).json({ message: 'Wallet not found' });
      await deleteWhitelistedWalletForUser(req.userId, req.params.id);
      const rows = await listWhitelistedWalletsByUserId(req.userId);
      return res.json({ success: true, wallets: rows.map(toPublic), maxWallets: MAX_WHITELISTED_WALLETS_PER_USER });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaErrorMessage });
      return res.status(500).json({ message: e.message || 'Failed to remove whitelisted wallet' });
    }
  });
}

module.exports = { registerWhitelistWalletRoutes };
