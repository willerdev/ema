const crypto = require('crypto');
const {
  insertSupportTicket,
  listSupportTicketsByUserId,
  getSupportTicketById,
  listVipExitSupportTicketsAdmin,
  updateSupportTicketStatus,
} = require('./db');

const PENDING_TICKET_STATUSES = new Set(['under_review', 'in_progress']);

function newId() {
  return crypto.randomUUID();
}

function mapTicketStatus(status) {
  if (status === 'resolved') return 'completed';
  if (status === 'closed') return 'rejected';
  if (PENDING_TICKET_STATUSES.has(status)) return 'pending';
  return status;
}

function exitRequestToApi(row) {
  if (!row) return null;
  const p = row.payload || {};
  if (!p.vipExit) return null;
  const applied = p.applied || {};
  return {
    id: row.id,
    userId: row.user_id,
    investmentId: p.investmentId,
    mode: p.mode,
    revenuePercent: Number(p.revenuePercent),
    destination: p.destination,
    walletAddress: p.walletAddress || null,
    principalUsd: Number(p.principalUsd),
    revenueBaseUsd: Number(p.revenueBaseUsd),
    revenueSelectedUsd: Number(p.revenueSelectedUsd),
    penaltyUsd: Number(applied.penaltyUsd ?? p.penaltyUsd),
    gasFeesUsd: Number(applied.gasFeesUsd ?? p.gasFeesUsd),
    commissionUsd: Number(applied.commissionUsd ?? p.commissionUsd),
    gasRewardUsd: Number(applied.gasRewardUsd ?? p.gasRewardUsd),
    netRevenueUsd: Number(applied.netRevenueUsd ?? p.netRevenueUsd),
    principalReturnUsd: Number(p.principalReturnUsd),
    netTotalUsd: Number(applied.netTotalUsd ?? p.netTotalUsd),
    investmentExtraCreditUsd: Number(applied.investmentExtraCreditUsd ?? p.investmentExtraCreditUsd),
    workingDays: Number(p.workingDays),
    calendarDays: Number(p.calendarDays),
    penaltyFree: Boolean(p.penaltyFree),
    status: mapTicketStatus(row.status),
    adminNote: p.adminNote || null,
    reviewedAt: p.reviewedAt || null,
    createdAt: row.created_at,
  };
}

function buildExitPayload({ inv, mode, revenuePercent, destination, walletAddress, quote }) {
  return {
    vipExit: true,
    investmentId: inv.id,
    mode,
    revenuePercent,
    destination,
    walletAddress: destination === 'direct_wallet' ? walletAddress : null,
    principalUsd: quote.principalUsd,
    revenueBaseUsd: quote.revenueBaseUsd,
    revenueSelectedUsd: quote.revenueSelectedUsd,
    penaltyUsd: quote.penaltyUsd,
    gasFeesUsd: quote.gasFeesUsd,
    commissionUsd: quote.commissionUsd,
    gasRewardUsd: quote.gasRewardUsd,
    netRevenueUsd: quote.netRevenueUsd,
    principalReturnUsd: quote.principalReturnUsd,
    netTotalUsd: quote.netTotalUsd,
    investmentExtraCreditUsd: quote.investmentExtraCreditUsd,
    workingDays: quote.workingDays,
    calendarDays: quote.calendarDays,
    penaltyFree: quote.penaltyFree,
    address: destination === 'direct_wallet' ? walletAddress : 'Platform cash wallet',
    amount: quote.netTotalUsd,
  };
}

async function getPendingVipExitForUser(userId) {
  const rows = await listSupportTicketsByUserId(userId, 30);
  return (
    rows.find((row) => row.payload?.vipExit && PENDING_TICKET_STATUSES.has(row.status)) || null
  );
}

async function listVipExitRequestsForUser(userId, limit = 20) {
  const rows = await listSupportTicketsByUserId(userId, limit);
  return rows.filter((row) => row.payload?.vipExit);
}

async function listVipExitRequestsAdmin({ status = 'pending', limit = 100 } = {}) {
  const cap = Math.min(500, Math.max(1, Number(limit) || 100));
  const rows = await listVipExitSupportTicketsAdmin({ limit: cap * 2 });
  return rows
    .map((row) => ({ row, apiStatus: mapTicketStatus(row.status) }))
    .filter((item) => !status || item.apiStatus === status)
    .slice(0, cap)
    .map((item) => item.row);
}

async function getVipExitRequestById(id) {
  const row = await getSupportTicketById(id);
  if (!row?.payload?.vipExit) return null;
  return row;
}

async function insertVipExitRequest({ userId, inv, mode, revenuePercent, destination, walletAddress, quote }) {
  const now = new Date().toISOString();
  const payload = buildExitPayload({ inv, mode, revenuePercent, destination, walletAddress, quote });
  return insertSupportTicket({
    id: newId(),
    user_id: userId,
    category: 'general',
    status: 'under_review',
    payload: {
      subject: 'VIP Farmers exit request',
      message: `${mode} · ${revenuePercent}% revenue · ${destination}`,
      ...payload,
    },
    related_activity_id: inv.id,
    created_at: now,
    updated_at: now,
  });
}

async function updateVipExitRequest(id, patch) {
  const existing = await getSupportTicketById(id);
  if (!existing?.payload?.vipExit) {
    const err = new Error('Exit request not found');
    err.statusCode = 400;
    throw err;
  }

  const payload = { ...(existing.payload || {}) };
  if (patch.applied) payload.applied = patch.applied;
  if (patch.admin_note != null) payload.adminNote = patch.admin_note;
  if (patch.reviewed_at != null) payload.reviewedAt = patch.reviewed_at;

  let status = existing.status;
  if (patch.status === 'completed') status = 'resolved';
  else if (patch.status === 'rejected') status = 'closed';

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from('support_tickets')
    .update({ status, payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  exitRequestToApi,
  getPendingVipExitForUser,
  listVipExitRequestsForUser,
  listVipExitRequestsAdmin,
  getVipExitRequestById,
  insertVipExitRequest,
  updateVipExitRequest,
};
