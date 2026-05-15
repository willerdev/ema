const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend .env');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function isMissingTableError(error) {
  return error?.code === 'PGRST205';
}

function id() {
  return crypto.randomUUID();
}

async function getUserByEmail(email) {
  const { data, error } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
  if (error) throw error;
  return data;
}

async function getUserById(userId) {
  const { data, error } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function createUser({ email, passwordHash }) {
  const userId = id();
  const walletId = id();

  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      id: userId,
      email,
      password_hash: passwordHash,
      alpaca_api_key: '',
      alpaca_secret_key: '',
    })
    .select('*')
    .single();
  if (userError) throw userError;

  const { error: walletError } = await supabase.from('wallets').insert({ id: walletId, user_id: userId, balance: 0 });
  if (walletError) throw walletError;

  return user;
}

async function updateAlpacaKeys(userId, apiKey, secretKey) {
  const { error } = await supabase
    .from('users')
    .update({ alpaca_api_key: apiKey, alpaca_secret_key: secretKey })
    .eq('id', userId);
  if (error) throw error;
}

async function updateUserTotpSecretEnc(userId, totpSecretEnc) {
  const { error } = await supabase.from('users').update({ totp_secret_enc: totpSecretEnc }).eq('id', userId);
  if (error) throw error;
}

async function setTotpEnabled(userId, enabled) {
  const { error } = await supabase.from('users').update({ totp_enabled: enabled }).eq('id', userId);
  if (error) throw error;
}

async function clearTotp(userId) {
  const { error } = await supabase
    .from('users')
    .update({ totp_enabled: false, totp_secret_enc: null })
    .eq('id', userId);
  if (error) throw error;
}

async function getWalletByUserId(userId) {
  const { data, error } = await supabase.from('wallets').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Ensures a `wallets` row exists for the user (internal cash ledger). */
async function ensureWalletForUser(userId) {
  const existing = await getWalletByUserId(userId);
  if (existing) return existing;
  const walletId = id();
  const { data, error } = await supabase
    .from('wallets')
    .insert({ id: walletId, user_id: userId, balance: 0 })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      return getWalletByUserId(userId);
    }
    throw error;
  }
  return data;
}

async function setWalletBalance(userId, nextBalance) {
  const { error } = await supabase.from('wallets').update({ balance: nextBalance }).eq('user_id', userId);
  if (error) throw error;
}

async function createTransaction({ userId, type, amount, status }) {
  const tx = {
    id: id(),
    user_id: userId,
    type,
    amount,
    status,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('transactions').insert(tx).select('*').single();
  if (error) throw error;
  return data;
}

async function getTransactionsByUserId(userId) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function clearTransactionsByUserId(userId) {
  const { error } = await supabase.from('transactions').delete().eq('user_id', userId);
  if (error) throw error;
}

async function listMt5AccountsByUserId(userId) {
  const { data, error } = await supabase
    .from('mt5_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getMt5AccountByIdForUser(userId, accountId) {
  const { data, error } = await supabase
    .from('mt5_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('id', accountId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createMt5AccountForUser(userId, { login, password, server, accountName, metaapiAccountId }) {
  const payload = {
    id: id(),
    user_id: userId,
    metaapi_account_id: metaapiAccountId || '',
    login,
    password,
    server,
    account_name: accountName || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('mt5_accounts')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function setMt5AccountMetaApiId(userId, accountId, metaapiAccountId) {
  const { error } = await supabase
    .from('mt5_accounts')
    .update({ metaapi_account_id: metaapiAccountId || '', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', accountId);
  if (error) throw error;
}

async function updateMt5AccountSnapshot(userId, accountId, snapshot) {
  const payload = {
    cached_balance: snapshot.balance,
    cached_equity: snapshot.equity,
    cached_currency: snapshot.currency,
    balance_last_updated_at: snapshot.updatedAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('mt5_accounts')
    .update(payload)
    .eq('user_id', userId)
    .eq('id', accountId);
  if (error) throw error;
}

async function getMt5AccountByEaWebhookToken(token) {
  if (!token) return null;
  const { data, error } = await supabase
    .from('mt5_accounts')
    .select('*')
    .eq('ea_webhook_token', String(token).trim())
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getMt5AccountByLoginAndServer(login, server) {
  if (!login || !server) return null;
  const { data, error } = await supabase
    .from('mt5_accounts')
    .select('*')
    .eq('login', String(login).trim())
    .eq('server', String(server).trim())
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function setMt5EaWebhookToken(userId, accountId, token) {
  const { error } = await supabase
    .from('mt5_accounts')
    .update({ ea_webhook_token: token, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', accountId);
  if (error) throw error;
}

async function insertMt5EaTelemetry({ mt5AccountId, payload }) {
  const { data, error } = await supabase
    .from('mt5_ea_telemetry')
    .insert({
      mt5_account_id: mt5AccountId,
      payload: payload && typeof payload === 'object' ? payload : {},
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

async function insertMt5EaCommand(row) {
  const { data, error } = await supabase.from('mt5_ea_commands').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function listPendingMt5EaCommands(mt5AccountId, limit = 50) {
  const { data, error } = await supabase
    .from('mt5_ea_commands')
    .select('id, client_id, side, symbol, volume, stop_loss, take_profit, magic, status, created_at')
    .eq('mt5_account_id', mt5AccountId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function ackMt5EaCommand(mt5AccountId, commandId, { status, ackTicket, ackError, ackMeta }) {
  const { data, error } = await supabase
    .from('mt5_ea_commands')
    .update({
      status,
      ack_ticket: ackTicket ?? null,
      ack_error: ackError ?? null,
      ack_meta: ackMeta ?? null,
      acked_at: new Date().toISOString(),
    })
    .eq('id', commandId)
    .eq('mt5_account_id', mt5AccountId)
    .eq('status', 'pending')
    .select('id');
  if (error) throw error;
  return data && data.length ? data[0] : null;
}

async function checkDatabaseHealth() {
  const [
    usersResult,
    walletsResult,
    transactionsResult,
    mt5Result,
    cryptoEthResult,
    airResult,
    airWalletResult,
    contractResult,
  ] = await Promise.all([
    supabase.from('users').select('*').limit(1),
    supabase.from('wallets').select('*').limit(1),
    supabase.from('transactions').select('*').limit(1),
    supabase.from('mt5_accounts').select('*').limit(1),
    supabase.from('crypto_ethereum_wallets').select('*').limit(1),
    supabase.from('airfarming_state').select('*').limit(1),
    supabase.from('airfarming_wallets').select('*').limit(1),
    supabase.from('contract_wallets').select('*').limit(1),
  ]);
  const cryptoError = cryptoEthResult?.error;
  const airError = airResult?.error;
  const airWalletError = airWalletResult?.error;
  const contractError = contractResult?.error;
  const firstError = usersResult.error || walletsResult.error || transactionsResult.error || mt5Result?.error;
  if (firstError) throw firstError;
  if (cryptoError && !isMissingTableError(cryptoError)) throw cryptoError;
  if (airError && !isMissingTableError(airError)) throw airError;
  if (airWalletError && !isMissingTableError(airWalletError)) throw airWalletError;
  if (contractError && !isMissingTableError(contractError)) throw contractError;

  return {
    users: usersResult.data?.length ?? 0,
    wallets: walletsResult.data?.length ?? 0,
    transactions: transactionsResult.data?.length ?? 0,
    mt5_accounts: mt5Result?.data?.length ?? 0,
    crypto_ethereum_wallets: cryptoError ? null : cryptoEthResult?.data?.length ?? 0,
    crypto_wallets_schema_ready: !cryptoError,
    airfarming_state: airError ? null : airResult?.data?.length ?? 0,
    airfarming_schema_ready: !airError,
    airfarming_wallets: airWalletError ? null : airWalletResult?.data?.length ?? 0,
    airfarming_wallet_schema_ready: !airWalletError,
    contract_wallets: contractError ? null : contractResult?.data?.length ?? 0,
    contract_schema_ready: !contractError,
  };
}

async function getCryptoEthereumWalletByUserId(userId) {
  const { data, error } = await supabase.from('crypto_ethereum_wallets').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getNextCryptoEthereumDerivationIndex() {
  const { data, error } = await supabase
    .from('crypto_ethereum_wallets')
    .select('derivation_index')
    .order('derivation_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const max = data?.derivation_index;
  if (max === undefined || max === null) return 0;
  return Number(max) + 1;
}

async function insertCryptoEthereumWallet(row) {
  const { data, error } = await supabase.from('crypto_ethereum_wallets').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function updateCryptoEthereumWalletByUserId(userId, patch) {
  const { data, error } = await supabase.from('crypto_ethereum_wallets').update(patch).eq('user_id', userId).select('*').single();
  if (error) throw error;
  return data;
}

async function findUserIdByDepositAddress(address) {
  if (!address) return null;
  const normalized = String(address).toLowerCase();
  const { data, error } = await supabase
    .from('crypto_ethereum_wallets')
    .select('user_id')
    .ilike('address', normalized)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.user_id || null;
}

async function insertTatumOnchainTx(row) {
  const { data, error } = await supabase.from('tatum_onchain_txs').insert(row).select('*').single();
  if (error) {
    if (error.code === '23505') return null;
    throw error;
  }
  return data;
}

async function listTatumOnchainTxsByUserId(userId, limit = 50) {
  const { data, error } = await supabase
    .from('tatum_onchain_txs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function getTrackedUsdtBalanceByUserId(userId) {
  const { data, error } = await supabase
    .from('tatum_onchain_txs')
    .select('direction,amount_display,status')
    .eq('user_id', userId)
    .eq('asset', 'USDT')
    .neq('status', 'pending');
  if (error) throw error;
  let total = 0;
  for (const row of data || []) {
    const n = Number(row.amount_display || 0);
    if (!Number.isFinite(n)) continue;
    total += row.direction === 'out' ? -n : n;
  }
  if (total < 0) total = 0;
  return String(total);
}

async function getAirfarmingStateByUserId(userId) {
  const { data, error } = await supabase.from('airfarming_state').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertAirfarmingState(row) {
  const { data, error } = await supabase.from('airfarming_state').upsert(row, { onConflict: 'user_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function insertAirfarmingEvent(row) {
  const { data, error } = await supabase.from('airfarming_events').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function listAirfarmingEventsByUserId(userId, limit = 30) {
  const { data, error } = await supabase
    .from('airfarming_events')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function getAirfarmingWalletByUserId(userId) {
  const { data, error } = await supabase.from('airfarming_wallets').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertAirfarmingWalletRow(row) {
  const { data, error } = await supabase.from('airfarming_wallets').upsert(row, { onConflict: 'user_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function insertAirfarmingTransfer(row) {
  const { data, error } = await supabase.from('airfarming_transfers').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function getContractWalletByUserId(userId) {
  const { data, error } = await supabase.from('contract_wallets').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertContractWalletRow(row) {
  const { data, error } = await supabase.from('contract_wallets').upsert(row, { onConflict: 'user_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function getContractAccrualForUserDay(userId, accrualDateYmd) {
  const { data, error } = await supabase
    .from('contract_accruals')
    .select('*')
    .eq('user_id', userId)
    .eq('accrual_date', accrualDateYmd)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function insertContractAccrual(row) {
  const { data, error } = await supabase.from('contract_accruals').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function listContractWalletsWithPositiveBalance() {
  const { data, error } = await supabase.from('contract_wallets').select('*').gt('balance', 0);
  if (error) throw error;
  return data || [];
}

// --- NOWPayments crypto ledger ---

async function insertNowpaymentsPayment(row) {
  const { data, error } = await supabase.from('nowpayments_payments').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function getNowpaymentsPaymentById(id) {
  const { data, error } = await supabase.from('nowpayments_payments').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function getNowpaymentsPaymentByOrderId(orderId) {
  const { data, error } = await supabase.from('nowpayments_payments').select('*').eq('order_id', orderId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getNowpaymentsPaymentByNpId(paymentId) {
  const { data, error } = await supabase
    .from('nowpayments_payments')
    .select('*')
    .eq('payment_id', String(paymentId))
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getNowpaymentsPaymentForUser(userId, id) {
  const { data, error } = await supabase
    .from('nowpayments_payments')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateNowpaymentsPayment(id, patch) {
  const { data, error } = await supabase
    .from('nowpayments_payments')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function listNowpaymentsPaymentsByUserId(userId, limit = 30) {
  const { data, error } = await supabase
    .from('nowpayments_payments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function insertNowpaymentsPayout(row) {
  const { data, error } = await supabase.from('nowpayments_payouts').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function getNowpaymentsPayoutByUniqueId(uniqueExternalId) {
  const { data, error } = await supabase
    .from('nowpayments_payouts')
    .select('*')
    .eq('unique_external_id', uniqueExternalId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getNowpaymentsPayoutByNpId(payoutId) {
  const { data, error } = await supabase
    .from('nowpayments_payouts')
    .select('*')
    .eq('payout_id', String(payoutId))
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getNowpaymentsPayoutForUser(userId, id) {
  const { data, error } = await supabase
    .from('nowpayments_payouts')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateNowpaymentsPayout(id, patch) {
  const { data, error } = await supabase
    .from('nowpayments_payouts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function listNowpaymentsPayoutsByUserId(userId, limit = 30) {
  const { data, error } = await supabase
    .from('nowpayments_payouts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function listPendingNowpaymentsPayoutsByUserId(userId) {
  const { data, error } = await supabase
    .from('nowpayments_payouts')
    .select('*')
    .eq('user_id', userId)
    .eq('reserve_released', false)
    .in('status', ['pending', 'processing', 'creating', 'sending', 'waiting']);
  if (error) throw error;
  return data || [];
}

async function insertCryptoLedgerEntry(row) {
  const { data, error } = await supabase.from('crypto_ledger_entries').insert(row).select('*').single();
  if (error) {
    if (error.code === '23505') return null;
    throw error;
  }
  return data;
}

async function getCryptoLedgerEntryBySource(source, sourceId, direction) {
  const { data, error } = await supabase
    .from('crypto_ledger_entries')
    .select('*')
    .eq('source', source)
    .eq('source_id', sourceId)
    .eq('direction', direction)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function listCryptoLedgerEntriesByUserId(userId, limit = 100) {
  const { data, error } = await supabase
    .from('crypto_ledger_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/** Available balance per asset: ledger in - ledger out - pending payout reserves. */
async function getCryptoBalancesByUserId(userId) {
  const [ledgerResult, pendingPayouts] = await Promise.all([
    supabase.from('crypto_ledger_entries').select('asset, direction, amount').eq('user_id', userId),
    listPendingNowpaymentsPayoutsByUserId(userId),
  ]);
  if (ledgerResult.error) throw ledgerResult.error;

  const byAsset = {};
  for (const row of ledgerResult.data || []) {
    const asset = String(row.asset || '').toLowerCase();
    if (!asset) continue;
    const n = Number(row.amount);
    if (!Number.isFinite(n)) continue;
    if (!byAsset[asset]) byAsset[asset] = { in: 0, out: 0, reserved: 0 };
    if (row.direction === 'in') byAsset[asset].in += n;
    else if (row.direction === 'out') byAsset[asset].out += n;
  }

  for (const p of pendingPayouts) {
    const asset = String(p.currency || '').toLowerCase();
    const n = Number(p.amount);
    if (!asset || !Number.isFinite(n)) continue;
    if (!byAsset[asset]) byAsset[asset] = { in: 0, out: 0, reserved: 0 };
    byAsset[asset].reserved += n;
  }

  const balances = [];
  const allAssets = new Set([...Object.keys(byAsset)]);
  for (const asset of allAssets) {
    const { in: ins = 0, out: outs = 0, reserved = 0 } = byAsset[asset] || {};
    const available = Math.max(0, ins - outs - reserved);
    balances.push({
      asset,
      available: String(available),
      totalIn: String(ins),
      totalOut: String(outs),
      reserved: String(reserved),
    });
  }
  balances.sort((a, b) => a.asset.localeCompare(b.asset));
  return balances;
}

// --- User compliance profile ---

async function getComplianceProfileByUserId(userId) {
  const { data, error } = await supabase
    .from('user_compliance_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertComplianceProfile(userId, normalized) {
  const { validateCompliancePayload } = require('./complianceProfile');
  const check = validateCompliancePayload({
    legal_first_name: normalized.legal_first_name,
    legal_last_name: normalized.legal_last_name,
    country: normalized.country,
    profession: normalized.profession,
    source_of_funds: normalized.source_of_funds,
    source_of_funds_detail: normalized.source_of_funds_detail,
    planned_investment_amount: normalized.planned_investment_amount,
    planned_investment_currency: normalized.planned_investment_currency,
    planned_investment_duration: normalized.planned_investment_duration,
    date_of_birth: normalized.date_of_birth,
    phone: normalized.phone,
    address_line: normalized.address_line,
    city: normalized.city,
    accept_terms: Boolean(normalized.accepted_terms_at),
  });

  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    legal_first_name: normalized.legal_first_name,
    legal_last_name: normalized.legal_last_name,
    country: normalized.country,
    profession: normalized.profession,
    source_of_funds: normalized.source_of_funds,
    source_of_funds_detail: normalized.source_of_funds_detail,
    planned_investment_amount: normalized.planned_investment_amount,
    planned_investment_currency: normalized.planned_investment_currency || 'usd',
    planned_investment_duration: normalized.planned_investment_duration,
    date_of_birth: normalized.date_of_birth || null,
    phone: normalized.phone,
    address_line: normalized.address_line,
    city: normalized.city,
    accepted_terms_at: normalized.accepted_terms_at,
    completed_at: check.ok ? now : null,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('user_compliance_profiles')
    .upsert(row, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  getUserByEmail,
  getUserById,
  createUser,
  updateAlpacaKeys,
  updateUserTotpSecretEnc,
  setTotpEnabled,
  clearTotp,
  getWalletByUserId,
  ensureWalletForUser,
  setWalletBalance,
  createTransaction,
  getTransactionsByUserId,
  clearTransactionsByUserId,
  listMt5AccountsByUserId,
  getMt5AccountByIdForUser,
  createMt5AccountForUser,
  setMt5AccountMetaApiId,
  updateMt5AccountSnapshot,
  getMt5AccountByEaWebhookToken,
  getMt5AccountByLoginAndServer,
  setMt5EaWebhookToken,
  insertMt5EaTelemetry,
  insertMt5EaCommand,
  listPendingMt5EaCommands,
  ackMt5EaCommand,
  checkDatabaseHealth,
  getCryptoEthereumWalletByUserId,
  getNextCryptoEthereumDerivationIndex,
  insertCryptoEthereumWallet,
  updateCryptoEthereumWalletByUserId,
  findUserIdByDepositAddress,
  insertTatumOnchainTx,
  listTatumOnchainTxsByUserId,
  getTrackedUsdtBalanceByUserId,
  isMissingTableError,
  getAirfarmingStateByUserId,
  upsertAirfarmingState,
  insertAirfarmingEvent,
  listAirfarmingEventsByUserId,
  getAirfarmingWalletByUserId,
  upsertAirfarmingWalletRow,
  insertAirfarmingTransfer,
  getContractWalletByUserId,
  upsertContractWalletRow,
  getContractAccrualForUserDay,
  insertContractAccrual,
  listContractWalletsWithPositiveBalance,
  insertNowpaymentsPayment,
  getNowpaymentsPaymentById,
  getNowpaymentsPaymentByOrderId,
  getNowpaymentsPaymentByNpId,
  getNowpaymentsPaymentForUser,
  updateNowpaymentsPayment,
  listNowpaymentsPaymentsByUserId,
  insertNowpaymentsPayout,
  getNowpaymentsPayoutByUniqueId,
  getNowpaymentsPayoutByNpId,
  updateNowpaymentsPayout,
  getNowpaymentsPayoutForUser,
  listNowpaymentsPayoutsByUserId,
  listPendingNowpaymentsPayoutsByUserId,
  insertCryptoLedgerEntry,
  getCryptoLedgerEntryBySource,
  listCryptoLedgerEntriesByUserId,
  getCryptoBalancesByUserId,
  getComplianceProfileByUserId,
  upsertComplianceProfile,
};
