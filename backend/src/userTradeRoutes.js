const { isMissingTableError } = require('./db');
const { listTradeHistory } = require('./userTradeService');

const schemaMsg =
  'Trade history schema missing. Run backend/sql/migrations/20260610_user_recorded_trades.sql in Supabase.';

function registerUserTradeRoutes(app, { authMiddleware }) {
  app.get('/user-trades/history', authMiddleware, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      return res.json(await listTradeHistory(req.userId, limit));
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to load trade history' });
    }
  });
}

module.exports = { registerUserTradeRoutes };
