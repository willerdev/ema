const { createClient } = require('@supabase/supabase-js');
const {
  VIP_LOAN_RECIPIENT_EXEMPT_DEPOSIT_USD,
  VIP_LOAN_RECIPIENT_DEPOSIT_WINDOW_DAYS,
  roundUsd,
} = require('./vipFarmerConstants');
const { getOpenVipLoanForUser, insertVipLoanFundTransfer } = require('./vipFarmerRepository');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function isSchemaError(error) {
  const code = error?.code || '';
  const msg = String(error?.message || '');
  return code === '42P01' || code === 'PGRST205' || msg.includes('does not exist');
}

async function sumUserUsdtDepositsBetween(userId, startIso, endIso) {
  let total = 0;
  const { data: payments, error: pErr } = await supabase
    .from('nowpayments_payments')
    .select('price_amount, ledger_credited, created_at')
    .eq('user_id', userId)
    .eq('ledger_credited', true)
    .gte('created_at', startIso)
    .lte('created_at', endIso);
  if (pErr && !isSchemaError(pErr)) throw pErr;
  for (const row of payments || []) {
    total += Number(row.price_amount) || 0;
  }

  const { data: ledger, error: lErr } = await supabase
    .from('crypto_ledger')
    .select('amount, created_at')
    .eq('user_id', userId)
    .eq('direction', 'in')
    .gte('created_at', startIso)
    .lte('created_at', endIso);
  if (lErr && !isSchemaError(lErr)) throw lErr;
  for (const row of ledger || []) {
    total += Number(row.amount) || 0;
  }

  return roundUsd(total);
}

async function recipientExemptFromLoanTaint(recipientUserId, disbursedAt) {
  if (!disbursedAt) return false;
  const end = new Date(disbursedAt);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - VIP_LOAN_RECIPIENT_DEPOSIT_WINDOW_DAYS);
  const deposited = await sumUserUsdtDepositsBetween(
    recipientUserId,
    start.toISOString(),
    end.toISOString()
  );
  return deposited >= VIP_LOAN_RECIPIENT_EXEMPT_DEPOSIT_USD;
}

async function recordVipLoanFundTransferIfNeeded({ fromUserId, toUserId, transferId, amountUsd }) {
  const loan = await getOpenVipLoanForUser(fromUserId);
  if (!loan || loan.status !== 'active') return null;

  const amt = roundUsd(Math.min(Number(amountUsd) || 0, Number(loan.outstanding_usd) || 0));
  if (amt <= 0) return null;

  const exempt = await recipientExemptFromLoanTaint(toUserId, loan.disbursed_at);
  return insertVipLoanFundTransfer({
    loan_id: loan.id,
    transfer_id: transferId || null,
    from_user_id: fromUserId,
    to_user_id: toUserId,
    amount_usd: amt,
    recipient_exempt: exempt,
  });
}

async function getNonExemptVipLoanTaintUsd(userId) {
  const { data, error } = await supabase
    .from('vip_loan_fund_transfers')
    .select('amount_usd')
    .eq('to_user_id', userId)
    .eq('recipient_exempt', false);
  if (error && isSchemaError(error)) return 0;
  if (error) throw error;
  return roundUsd((data || []).reduce((s, r) => s + Number(r.amount_usd || 0), 0));
}

module.exports = {
  recordVipLoanFundTransferIfNeeded,
  getNonExemptVipLoanTaintUsd,
  recipientExemptFromLoanTaint,
};
