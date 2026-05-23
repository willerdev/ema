const { isMissingTableError } = require('./db');
const { getJournalMonth, getJournalDay } = require('./journalService');

function registerJournalRoutes(app, { authMiddleware }) {
  app.get('/journal/month', authMiddleware, async (req, res) => {
    try {
      const now = new Date();
      const year = Number(req.query.year) || now.getUTCFullYear();
      const month = Number(req.query.month) || now.getUTCMonth() + 1;
      if (month < 1 || month > 12) {
        return res.status(400).json({ message: 'Invalid month' });
      }
      const data = await getJournalMonth(req.userId, year, month);
      return res.json(data);
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'Journal data unavailable. Run Supabase migrations.' });
      }
      return res.status(500).json({ message: e.message || 'Failed to load journal month' });
    }
  });

  app.get('/journal/day', authMiddleware, async (req, res) => {
    try {
      const date = String(req.query.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: 'date query required (YYYY-MM-DD UTC)' });
      }
      const data = await getJournalDay(req.userId, date);
      return res.json(data);
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'Journal data unavailable. Run Supabase migrations.' });
      }
      return res.status(500).json({ message: e.message || 'Failed to load journal day' });
    }
  });
}

module.exports = { registerJournalRoutes };
