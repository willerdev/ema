const crypto = require('crypto');
const {
  insertSupportTicket,
  listSupportTicketsByUserId,
  getSupportTicketForUser,
  getUserById,
  isMissingTableError,
} = require('./db');

const SCHEMA_MSG =
  'Support schema missing. Run backend/sql/migrations/20260524_support_tickets.sql in Supabase.';

const CATEGORIES = new Set(['withdraw', 'deposit', 'daily_earning', 'transfer', 'general']);

function newId() {
  return crypto.randomUUID();
}

function toPublicTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    category: row.category,
    status: row.status,
    payload: row.payload || {},
    relatedActivityId: row.related_activity_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validatePayload(category, body) {
  const p = body?.payload && typeof body.payload === 'object' ? body.payload : body;
  const errors = [];

  if (category === 'withdraw') {
    if (!String(p.address || '').trim()) errors.push('Withdrawal address is required');
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) errors.push('Valid withdrawal amount is required');
  } else if (category === 'deposit') {
    if (!String(p.transactionId || '').trim()) errors.push('Transaction ID or TXID is required');
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) errors.push('Valid deposit amount is required');
  } else if (category === 'daily_earning') {
    const amount = Number(p.amountInvested);
    if (!Number.isFinite(amount) || amount <= 0) errors.push('Amount invested is required');
    if (!String(p.dateInvested || '').trim()) errors.push('Date invested is required');
  } else if (category === 'transfer') {
    if (!String(p.recipientTransferId || '').trim()) errors.push('Recipient transfer ID is required');
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) errors.push('Valid transfer amount is required');
  } else if (category === 'general') {
    if (!String(p.subject || '').trim()) errors.push('Subject is required');
    if (!String(p.message || '').trim()) errors.push('Message is required');
  }

  return { ok: errors.length === 0, errors, normalized: p };
}

function registerSupportRoutes(app, { authMiddleware }) {
  app.get('/support/tickets', authMiddleware, async (req, res) => {
    try {
      const rows = await listSupportTicketsByUserId(req.userId, 50);
      return res.json({ tickets: rows.map(toPublicTicket) });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: SCHEMA_MSG });
      return res.status(500).json({ message: e.message || 'Failed to load support tickets' });
    }
  });

  app.get('/support/tickets/:id', authMiddleware, async (req, res) => {
    try {
      const row = await getSupportTicketForUser(req.userId, req.params.id);
      if (!row) return res.status(404).json({ message: 'Ticket not found' });
      return res.json({ ticket: toPublicTicket(row) });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: SCHEMA_MSG });
      return res.status(500).json({ message: e.message || 'Failed to load ticket' });
    }
  });

  app.post('/support/tickets', authMiddleware, async (req, res) => {
    try {
      const category = String(req.body?.category || '').trim();
      if (!CATEGORIES.has(category)) {
        return res.status(400).json({ message: 'Invalid support category' });
      }

      const user = await getUserById(req.userId);
      if (!user) return res.status(404).json({ message: 'User not found' });

      const totpEnabled = Boolean(user.totp_enabled);
      if (category === 'withdraw' && !totpEnabled) {
        return res.status(400).json({
          message: 'Enable two-factor authentication in Settings before submitting a withdrawal support request.',
          code: 'TOTP_REQUIRED',
        });
      }

      const validation = validatePayload(category, req.body);
      if (!validation.ok) {
        return res.status(400).json({ message: 'Validation failed', errors: validation.errors });
      }

      const payload = { ...validation.normalized, totpEnabledAtSubmit: totpEnabled };
      const relatedActivityId =
        req.body?.relatedActivityId != null ? String(req.body.relatedActivityId).trim() : null;

      const row = await insertSupportTicket({
        id: newId(),
        user_id: req.userId,
        category,
        status: 'under_review',
        payload,
        related_activity_id: relatedActivityId || null,
      });

      return res.status(201).json({
        ticket: toPublicTicket(row),
        message: 'Your request is under review. We will follow up if we need more information.',
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: SCHEMA_MSG });
      return res.status(500).json({ message: e.message || 'Failed to submit support request' });
    }
  });
}

module.exports = { registerSupportRoutes };
