const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function newId() {
  return crypto.randomUUID();
}

function isSchemaError(error) {
  const code = error?.code || '';
  const msg = String(error?.message || '');
  return code === '42P01' || code === 'PGRST205' || msg.includes('does not exist');
}

async function insertPlatformRevenueEvent({ userId, investmentId, loanId, eventType, amountUsd, meta }) {
  const row = {
    id: newId(),
    user_id: userId || null,
    investment_id: investmentId || null,
    loan_id: loanId || null,
    event_type: eventType,
    amount_usd: Number(amountUsd) || 0,
    meta: meta || null,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('platform_revenue_events').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function insertVipReinvestEvent(row) {
  const { data, error } = await supabase.from('vip_reinvest_events').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function listVipReinvestEvents(limit = 100) {
  const { data, error } = await supabase
    .from('vip_reinvest_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(200, limit));
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function getPendingVipExitForUser(userId) {
  const { data, error } = await supabase
    .from('vip_exit_requests')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && isSchemaError(error)) return null;
  if (error) throw error;
  return data;
}

async function listVipExitRequestsForUser(userId, limit = 20) {
  const { data, error } = await supabase
    .from('vip_exit_requests')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function listVipExitRequestsAdmin({ status = 'pending', limit = 100 } = {}) {
  let q = supabase.from('vip_exit_requests').select('*').order('created_at', { ascending: false }).limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function getVipExitRequestById(id) {
  const { data, error } = await supabase.from('vip_exit_requests').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function insertVipExitRequest(row) {
  const { data, error } = await supabase.from('vip_exit_requests').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function updateVipExitRequest(id, patch) {
  const row = { ...patch, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('vip_exit_requests').update(row).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

async function getOpenVipLoanForUser(userId) {
  const { data, error } = await supabase
    .from('vip_loans')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['pending', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && isSchemaError(error)) return null;
  if (error) throw error;
  return data;
}

async function listVipLoansAdmin({ status, limit = 100 } = {}) {
  let q = supabase.from('vip_loans').select('*').order('created_at', { ascending: false }).limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function getVipLoanById(id) {
  const { data, error } = await supabase.from('vip_loans').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function insertVipLoan(row) {
  const { data, error } = await supabase.from('vip_loans').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function updateVipLoan(id, patch) {
  const row = { ...patch, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('vip_loans').update(row).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

async function countLifetimeVipAccrualDays(userId) {
  const { count, error } = await supabase
    .from('vip_accruals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error && isSchemaError(error)) return 0;
  if (error) throw error;
  return Number(count) || 0;
}

async function sumVipAccrualsLastDays(userId, days) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(1, Number(days) || 30));
  const startYmd = start.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('vip_accruals')
    .select('amount')
    .eq('user_id', userId)
    .gte('accrual_date', startYmd);
  if (error && isSchemaError(error)) return 0;
  if (error) throw error;
  return (data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
}

async function insertVipLoanFundTransfer(row) {
  const payload = {
    id: newId(),
    created_at: new Date().toISOString(),
    ...row,
  };
  const { data, error } = await supabase.from('vip_loan_fund_transfers').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

async function listActiveVipInvestmentsAdmin() {
  const { data, error } = await supabase
    .from('vip_investments')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

function exitRequestToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    investmentId: row.investment_id,
    mode: row.mode,
    revenuePercent: Number(row.revenue_percent),
    destination: row.destination,
    walletAddress: row.wallet_address,
    principalUsd: Number(row.principal_usd),
    revenueBaseUsd: Number(row.revenue_base_usd),
    revenueSelectedUsd: Number(row.revenue_selected_usd),
    penaltyUsd: Number(row.penalty_usd),
    gasFeesUsd: Number(row.gas_fees_usd),
    commissionUsd: Number(row.commission_usd),
    gasRewardUsd: Number(row.gas_reward_usd),
    netRevenueUsd: Number(row.net_revenue_usd),
    principalReturnUsd: Number(row.principal_return_usd),
    netTotalUsd: Number(row.net_total_usd),
    investmentExtraCreditUsd: Number(row.investment_extra_credit_usd),
    workingDays: Number(row.working_days),
    calendarDays: Number(row.calendar_days),
    penaltyFree: Boolean(row.penalty_free),
    status: row.status,
    adminNote: row.admin_note,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

function loanToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    investmentId: row.investment_id,
    amountUsd: Number(row.amount_usd),
    commissionRate: Number(row.commission_rate),
    commissionUsd: Number(row.commission_usd),
    disbursedUsd: Number(row.disbursed_usd),
    lastMonthEarningsUsd: Number(row.last_month_earnings_usd),
    maxLoanUsd: Number(row.max_loan_usd),
    outstandingUsd: Number(row.outstanding_usd),
    repaidUsd: Number(row.repaid_usd),
    status: row.status,
    adminNote: row.admin_note,
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at,
    disbursedAt: row.disbursed_at,
    repaidAt: row.repaid_at,
  };
}

module.exports = {
  isSchemaError,
  newId,
  insertPlatformRevenueEvent,
  insertVipReinvestEvent,
  listVipReinvestEvents,
  getPendingVipExitForUser,
  listVipExitRequestsForUser,
  listVipExitRequestsAdmin,
  getVipExitRequestById,
  insertVipExitRequest,
  updateVipExitRequest,
  getOpenVipLoanForUser,
  listVipLoansAdmin,
  getVipLoanById,
  insertVipLoan,
  updateVipLoan,
  countLifetimeVipAccrualDays,
  sumVipAccrualsLastDays,
  listActiveVipInvestmentsAdmin,
  insertVipLoanFundTransfer,
  exitRequestToApi,
  loanToApi,
};
