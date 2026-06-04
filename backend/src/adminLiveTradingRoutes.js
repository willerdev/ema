const {
  listAllPlatformLiveTradingAccountsAdmin,
  listRecentLiveTradingTransfersAdmin,
  getUsersByIds,
  getLiveTradingWalletByMt5AccountId,
  isMissingTableError,
} = require('./db');
const { computeLiveBalances } = require('./services/mt5BridgeService');
const { requireSuperAdmin } = require('./middleware/adminAuth');

function registerAdminLiveTradingRoutes(app, { adminAuthMiddleware }) {
  const schemaMsg =
    'Live trading schema missing. Run backend/sql/migrations/20260614_live_trading_accounts.sql in Supabase.';

  app.get('/admin/api/live-trading/overview', adminAuthMiddleware, requireSuperAdmin, async (_req, res) => {
    try {
      const accounts = await listAllPlatformLiveTradingAccountsAdmin(500);
      const transfers = await listRecentLiveTradingTransfersAdmin(80);
      const userIds = [...new Set(accounts.map((a) => a.user_id))];
      const users = await getUsersByIds(userIds);
      const emailById = new Map(users.map((u) => [u.id, u.email]));

      let totalDeposited = 0;
      let totalOpenProfit = 0;
      const accountRows = [];
      for (const acc of accounts) {
        const wallet = await getLiveTradingWalletByMt5AccountId(acc.id);
        const b = computeLiveBalances(acc, wallet);
        totalDeposited += b.depositedBalance;
        if (b.snapshotFresh) totalOpenProfit += b.openProfit;
        accountRows.push({
          id: acc.id,
          userId: acc.user_id,
          userEmail: emailById.get(acc.user_id) || '—',
          botType: acc.bot_type,
          accountName: acc.account_name,
          login: acc.login,
          depositedBalance: b.depositedBalance,
          openProfit: b.openProfit,
          displayBalance: b.displayBalance,
          snapshotFresh: b.snapshotFresh,
          createdAt: acc.created_at,
        });
      }

      return res.json({
        stats: {
          users: userIds.length,
          accounts: accounts.length,
          totalDepositedUsd: Math.round(totalDeposited * 100) / 100,
          totalOpenProfitUsd: Math.round(totalOpenProfit * 100) / 100,
        },
        accounts: accountRows,
        transfers: transfers.map((t) => ({
          id: t.id,
          userId: t.user_id,
          mt5AccountId: t.mt5_account_id,
          direction: t.direction,
          amount: Number(t.amount),
          createdAt: t.created_at,
        })),
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Overview failed' });
    }
  });
}

module.exports = { registerAdminLiveTradingRoutes };
