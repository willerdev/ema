const { isMissingTableError } = require('./db');
const { requireSuperAdmin } = require('./middleware/adminAuth');
const { enrichVipInvestmentApi, listAdminVipInvestments, adminUpdateVipInvestment } = require('./vipFarmerService');
const { listActiveVipInvestmentsAdmin, listVipReinvestEvents } = require('./vipFarmerRepository');
const {
  listAdminVipExitRequests,
  previewApproveVipExit,
  approveVipExit,
  rejectVipExit,
} = require('./vipExitService');
const { listAdminVipLoans, approveVipLoan, rejectVipLoan } = require('./vipLoanService');

function registerAdminVipFarmerRoutes(app, { adminAuthMiddleware }) {
  const schemaMsg =
    'VIP Farmers v2 schema missing. Run backend/sql/migrations/20260708_vip_farmers_v2.sql in Supabase.';

  app.get('/admin/api/vip-farmers/investments', adminAuthMiddleware, async (_req, res) => {
    try {
      return res.json(await listAdminVipInvestments());
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to load VIP investments' });
    }
  });

  app.patch('/admin/api/vip-farmers/investments/:id', adminAuthMiddleware, async (req, res) => {
    try {
      return res.json(
        await adminUpdateVipInvestment(req.params.id, req.body || {}, req.adminUser)
      );
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to update investment' });
    }
  });

  app.get('/admin/api/vip-farmers', adminAuthMiddleware, requireSuperAdmin, async (_req, res) => {
    try {
      const rows = await listActiveVipInvestmentsAdmin();
      const investments = [];
      for (const row of rows) {
        investments.push(await enrichVipInvestmentApi(row));
      }
      return res.json({ investments, count: investments.length });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to load VIP Farmers' });
    }
  });

  app.get('/admin/api/vip-farmers/exit-requests', adminAuthMiddleware, async (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status) : 'pending';
      return res.json(await listAdminVipExitRequests(status));
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to load exit requests' });
    }
  });

  app.post(
    '/admin/api/vip-farmers/exit-requests/:id/preview-approve',
    adminAuthMiddleware,
    async (req, res) => {
      try {
        return res.json(await previewApproveVipExit(req.params.id, req.body?.overrides || {}));
      } catch (e) {
        if (e.statusCode === 400) return res.status(400).json({ message: e.message });
        if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
        return res.status(500).json({ message: e.message || 'Preview failed' });
      }
    }
  );

  app.post(
    '/admin/api/vip-farmers/exit-requests/:id/approve',
    adminAuthMiddleware,
    async (req, res) => {
      try {
        return res.json(
          await approveVipExit(req.params.id, {
            adminNote: req.body?.adminNote,
            overrides: req.body?.overrides,
          })
        );
      } catch (e) {
        if (e.statusCode === 400) return res.status(400).json({ message: e.message });
        if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
        return res.status(500).json({ message: e.message || 'Approve failed' });
      }
    }
  );

  app.post(
    '/admin/api/vip-farmers/exit-requests/:id/reject',
    adminAuthMiddleware,
    async (req, res) => {
      try {
        return res.json(await rejectVipExit(req.params.id, req.body?.adminNote));
      } catch (e) {
        if (e.statusCode === 400) return res.status(400).json({ message: e.message });
        if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
        return res.status(500).json({ message: e.message || 'Reject failed' });
      }
    }
  );

  app.get('/admin/api/vip-farmers/loans', adminAuthMiddleware, async (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status) : 'pending';
      return res.json(await listAdminVipLoans(status));
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to load loans' });
    }
  });

  app.post('/admin/api/vip-farmers/loans/:id/approve', adminAuthMiddleware, async (req, res) => {
    try {
      return res.json(await approveVipLoan(req.params.id, req.body?.adminNote));
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Approve failed' });
    }
  });

  app.post('/admin/api/vip-farmers/loans/:id/reject', adminAuthMiddleware, async (req, res) => {
    try {
      return res.json(await rejectVipLoan(req.params.id, req.body?.adminNote));
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Reject failed' });
    }
  });

  app.get('/admin/api/vip-farmers/reinvestments', adminAuthMiddleware, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const rows = await listVipReinvestEvents(limit);
      return res.json({
        events: rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          investmentId: r.investment_id,
          amountUsd: Number(r.amount_usd),
          previousPrincipalUsd: Number(r.previous_principal_usd),
          newPrincipalUsd: Number(r.new_principal_usd),
          lockReset: Boolean(r.lock_reset),
          createdAt: r.created_at,
        })),
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to load reinvestments' });
    }
  });
}

module.exports = { registerAdminVipFarmerRoutes };
