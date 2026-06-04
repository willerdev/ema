const crypto = require('crypto');
const {
  ensureWalletForUser,
  setWalletBalance,
  getMt5AccountByIdForUser,
  createPlatformMt5AccountForUser,
  listPlatformMt5AccountsByUserId,
  ensureLiveTradingWallet,
  setLiveTradingWalletBalance,
  insertLiveTradingTransfer,
  listMarketPrices,
  insertMt5EaCloseCommand,
  isMissingTableError,
} = require('./db');
const { getMinDeposit, validateBotType, validateTradingPassword } = require('./services/liveTradingValidation');
const { computeLiveBalances } = require('./services/mt5BridgeService');
const { mapPricesForApi } = require('./services/priceFeedNormalize');

function newId() {
  return crypto.randomUUID();
}

function liveAccountToApi(account, walletRow) {
  const balances = computeLiveBalances(account, walletRow);
  return {
    id: account.id,
    botType: account.bot_type,
    accountName: account.account_name || '',
    login: account.login,
    depositedBalance: balances.depositedBalance,
    openProfit: balances.openProfit,
    displayBalance: balances.displayBalance,
    snapshotFresh: balances.snapshotFresh,
    minDepositUsd: getMinDeposit(account.bot_type),
    createdAt: account.created_at,
  };
}

function registerLiveTradingRoutes(app, { authMiddleware }) {
  const schemaMsg =
    'Live trading schema missing. Run backend/sql/migrations/20260614_live_trading_accounts.sql in Supabase.';

  app.get('/live-trading/accounts', authMiddleware, async (req, res) => {
    try {
      const accounts = await listPlatformMt5AccountsByUserId(req.userId);
      const out = [];
      for (const acc of accounts) {
        const w = await ensureLiveTradingWallet(req.userId, acc.id);
        out.push(liveAccountToApi(acc, w));
      }
      return res.json({ accounts: out });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to list accounts' });
    }
  });

  app.post('/live-trading/accounts', authMiddleware, async (req, res) => {
    try {
      const botType = validateBotType(req.body?.botType);
      const password = validateTradingPassword(req.body?.password);
      const accountName = String(req.body?.accountName || '').trim().slice(0, 80);
      const account = await createPlatformMt5AccountForUser(req.userId, {
        botType,
        password,
        accountName,
        leverage: req.body?.leverage,
      });
      const wallet = await ensureLiveTradingWallet(req.userId, account.id);
      return res.status(201).json({ account: liveAccountToApi(account, wallet) });
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to create account' });
    }
  });

  app.get('/live-trading/accounts/:id/summary', authMiddleware, async (req, res) => {
    try {
      const account = await getMt5AccountByIdForUser(req.userId, req.params.id);
      if (!account?.is_platform_provisioned) return res.status(404).json({ message: 'Account not found' });
      const wallet = await ensureLiveTradingWallet(req.userId, account.id);
      return res.json(liveAccountToApi(account, wallet));
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Summary failed' });
    }
  });

  app.post('/live-trading/accounts/:id/fund', authMiddleware, async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
      const account = await getMt5AccountByIdForUser(req.userId, req.params.id);
      if (!account?.is_platform_provisioned) return res.status(404).json({ message: 'Account not found' });
      const min = getMinDeposit(account.bot_type);
      if (amount < min) {
        return res.status(400).json({ message: `Minimum deposit is $${min}` });
      }
      const cashWallet = await ensureWalletForUser(req.userId);
      const cash = Number.parseFloat(String(cashWallet.balance ?? 0)) || 0;
      if (cash < amount) return res.status(400).json({ message: 'Insufficient cash wallet balance' });

      const wallet = await ensureLiveTradingWallet(req.userId, account.id);
      const nextBal = Number(wallet.balance || 0) + amount;
      await setWalletBalance(req.userId, cash - amount);
      const updated = await setLiveTradingWalletBalance(wallet.id, nextBal);
      await insertLiveTradingTransfer({
        userId: req.userId,
        mt5AccountId: account.id,
        direction: 'to_live',
        amount,
      });
      return res.json({
        cashWalletUsd: cash - amount,
        account: liveAccountToApi(account, updated),
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Fund failed' });
    }
  });

  app.post('/live-trading/accounts/:id/return-to-cash', authMiddleware, async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
      const account = await getMt5AccountByIdForUser(req.userId, req.params.id);
      if (!account?.is_platform_provisioned) return res.status(404).json({ message: 'Account not found' });
      const wallet = await ensureLiveTradingWallet(req.userId, account.id);
      const bal = Number(wallet.balance || 0);
      if (bal < amount) return res.status(400).json({ message: 'Insufficient trading balance' });

      const cashWallet = await ensureWalletForUser(req.userId);
      const cash = Number.parseFloat(String(cashWallet.balance ?? 0)) || 0;
      const updated = await setLiveTradingWalletBalance(wallet.id, bal - amount);
      await setWalletBalance(req.userId, cash + amount);
      await insertLiveTradingTransfer({
        userId: req.userId,
        mt5AccountId: account.id,
        direction: 'to_cash',
        amount,
      });
      return res.json({
        cashWalletUsd: cash + amount,
        account: liveAccountToApi(account, updated),
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Withdraw failed' });
    }
  });

  app.get('/live-trading/prices', authMiddleware, async (req, res) => {
    try {
      const rows = await listMarketPrices();
      return res.json({ prices: mapPricesForApi(rows) });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Prices failed' });
    }
  });

  app.get('/live-trading/accounts/:id/positions', authMiddleware, async (req, res) => {
    try {
      const account = await getMt5AccountByIdForUser(req.userId, req.params.id);
      if (!account?.is_platform_provisioned) return res.status(404).json({ message: 'Account not found' });
      const wallet = await ensureLiveTradingWallet(req.userId, account.id);
      const balances = computeLiveBalances(account, wallet);
      if (!balances.snapshotFresh) {
        return res.status(503).json({
          message: 'Live trading is not connected yet. Try again in a moment.',
        });
      }
      return res.json({ positions: balances.positions });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Positions failed' });
    }
  });

  app.post('/live-trading/accounts/:id/positions/close', authMiddleware, async (req, res) => {
    try {
      const positionId = req.body?.positionId;
      if (!positionId) return res.status(400).json({ message: 'positionId required' });
      const account = await getMt5AccountByIdForUser(req.userId, req.params.id);
      if (!account?.is_platform_provisioned) return res.status(404).json({ message: 'Account not found' });
      const wallet = await ensureLiveTradingWallet(req.userId, account.id);
      const balances = computeLiveBalances(account, wallet);
      const pos = balances.positions.find((p) => p.id === String(positionId));
      if (!pos) return res.status(404).json({ message: 'Position not found' });
      await insertMt5EaCloseCommand({
        mt5AccountId: account.id,
        positionTicket: positionId,
        closeSide: pos.side === 'buy' ? 'sell' : 'buy',
        clientId: newId(),
      });
      return res.json({ ok: true, message: 'Close requested' });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Close failed' });
    }
  });
}

module.exports = { registerLiveTradingRoutes, liveAccountToApi };
