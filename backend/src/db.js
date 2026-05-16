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

const CROCKFORD_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** @returns {string} Format `EMA-` + 8 Crockford-ish chars (no I,L,O,U). */
function randomTransferCode() {
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += CROCKFORD_CHARS[crypto.randomInt(0, CROCKFORD_CHARS.length)];
  }
  return `EMA-${suffix}`;
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

  await ensureUserTransferCode(userId);

  const { data: fresh, error: freshErr } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  if (freshErr) throw freshErr;
  return fresh || user;
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

/** Assigns `users.transfer_code` if missing (immutable once set). */
async function ensureUserTransferCode(userId) {
  const row = await getUserById(userId);
  if (!row) return null;
  if (row.transfer_code) return String(row.transfer_code);

  for (let attempt = 0; attempt < 24; attempt++) {
    const code = randomTransferCode();
    const { data, error } = await supabase
      .from('users')
      .update({ transfer_code: code })
      .eq('id', userId)
      .is('transfer_code', null)
      .select('transfer_code')
      .maybeSingle();
    if (error?.code === '23505') continue;
    if (error) throw error;
    if (data?.transfer_code) return String(data.transfer_code);
    const again = await getUserById(userId);
    if (again?.transfer_code) return String(again.transfer_code);
  }
  throw new Error('Failed to assign transfer code');
}

async function rpcWalletPeerTransfer({ fromUserId, toTransferCode, amount, idempotencyKey }) {
  const { data, error } = await supabase.rpc('wallet_peer_transfer', {
    p_from_user_id: fromUserId,
    p_to_code: toTransferCode,
    p_amount: amount,
    p_idempotency_key: idempotencyKey ?? null,
  });
  if (error) throw error;
  return data;
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

async function deleteMt5EaRowsForAccount(accountId) {
  for (const table of ['mt5_ea_commands', 'mt5_ea_telemetry']) {
    const { error } = await supabase.from(table).delete().eq('mt5_account_id', accountId);
    if (error && !isMissingTableError(error)) throw error;
  }
}

async function deleteMt5AccountForUser(userId, accountId) {
  const account = await getMt5AccountByIdForUser(userId, accountId);
  if (!account) return false;

  await deleteMt5EaRowsForAccount(accountId);

  const { data, error } = await supabase
    .from('mt5_accounts')
    .delete()
    .eq('user_id', userId)
    .eq('id', accountId)
    .select('id');
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
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
  const id = String(payoutId);
  const { data, error } = await supabase
    .from('nowpayments_payouts')
    .select('*')
    .eq('payout_id', id)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: byBatch, error: batchErr } = await supabase
    .from('nowpayments_payouts')
    .select('*')
    .eq('batch_payout_id', id)
    .maybeSingle();
  if (batchErr) throw batchErr;
  return byBatch;
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
    .in('status', [
      'pending',
      'processing',
      'creating',
      'sending',
      'waiting',
      'awaiting_verify',
    ]);
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

  let pendingLocal = [];
  try {
    pendingLocal = await listPendingLocalMoneyWithdrawalsByUserId(userId);
  } catch (e) {
    if (!isMissingTableError(e)) throw e;
  }
  for (const o of pendingLocal) {
    const asset = String(o.crypto_asset || 'usdt').toLowerCase();
    const n = Number(o.crypto_amount);
    if (!Number.isFinite(n)) continue;
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

const MAX_WHITELISTED_WALLETS_PER_USER = 3;

async function listWhitelistedWalletsByUserId(userId) {
  const { data, error } = await supabase
    .from('user_whitelisted_wallets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function countWhitelistedWalletsByUserId(userId) {
  const { count, error } = await supabase
    .from('user_whitelisted_wallets')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw error;
  return count ?? 0;
}

async function getWhitelistedWalletForUser(userId, id) {
  const { data, error } = await supabase
    .from('user_whitelisted_wallets')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function insertWhitelistedWallet(row) {
  const count = await countWhitelistedWalletsByUserId(row.user_id);
  if (count >= MAX_WHITELISTED_WALLETS_PER_USER) {
    const err = new Error('Maximum of 3 whitelisted wallets allowed');
    err.code = 'WHITELIST_WALLET_LIMIT';
    throw err;
  }
  const { data, error } = await supabase.from('user_whitelisted_wallets').insert(row).select('*').single();
  if (error) {
    if (error.code === '23505') {
      const dup = new Error('This address is already whitelisted for this currency');
      dup.code = 'WHITELIST_WALLET_DUPLICATE';
      throw dup;
    }
    throw error;
  }
  return data;
}

async function deleteWhitelistedWalletForUser(userId, id) {
  const { error } = await supabase.from('user_whitelisted_wallets').delete().eq('user_id', userId).eq('id', id);
  if (error) throw error;
}

async function isAddressWhitelistedForUser(userId, currency, address) {
  const cur = String(currency || '').trim().toLowerCase();
  const addr = String(address || '').trim().toLowerCase();
  if (!cur || !addr) return false;
  const rows = await listWhitelistedWalletsByUserId(userId);
  return rows.some(
    (r) => String(r.currency || '').toLowerCase() === cur && String(r.address || '').trim().toLowerCase() === addr
  );
}

async function listNotificationsForUser(userId, limit = 100) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 100));
  const { data: broadcast, error: bErr } = await supabase
    .from('app_notifications')
    .select('*')
    .is('user_id', null)
    .order('created_at', { ascending: false })
    .limit(lim);
  if (bErr) throw bErr;

  const { data: personal, error: pErr } = await supabase
    .from('app_notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(lim);
  if (pErr) throw pErr;

  const merged = [...(personal || []), ...(broadcast || [])];
  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const seen = new Set();
  const out = [];
  for (const row of merged) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= lim) break;
  }
  return out;
}

// --- Local mobile money (deposit / withdraw to phone) ---

async function insertLocalMoneyOrder(row) {
  const { data, error } = await supabase.from('local_money_orders').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function updateLocalMoneyOrder(id, patch) {
  const { data, error } = await supabase
    .from('local_money_orders')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getLocalMoneyOrderForUser(id, userId) {
  const { data, error } = await supabase
    .from('local_money_orders')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getLocalMoneyOrderByReference(reference) {
  const ref = String(reference || '').trim();
  if (!ref) return null;
  const { data, error } = await supabase
    .from('local_money_orders')
    .select('*')
    .eq('provider_reference', ref)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getLocalMoneyOrderByChargeId(chargeId) {
  const id = String(chargeId || '').trim();
  if (!id) return null;
  const { data, error } = await supabase
    .from('local_money_orders')
    .select('*')
    .eq('provider_charge_id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function listLocalMoneyOrdersByUserId(userId, limit = 30) {
  const { data, error } = await supabase
    .from('local_money_orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function listPendingLocalMoneyWithdrawalsByUserId(userId) {
  const { data, error } = await supabase
    .from('local_money_orders')
    .select('*')
    .eq('user_id', userId)
    .eq('type', 'withdraw')
    .eq('ledger_posted', true)
    .in('status', ['pending', 'awaiting_approval', 'processing']);
  if (error) throw error;
  return data || [];
}

async function createAppNotification({ userId, title, body }) {
  const row = {
    user_id: userId || null,
    title: String(title).trim(),
    body: String(body).trim(),
  };
  const { data, error } = await supabase.from('app_notifications').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function getNotificationPreferencesByUserId(userId) {
  const { data, error } = await supabase
    .from('user_notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertNotificationPreferences(userId, patch) {
  const existing = await getNotificationPreferencesByUserId(userId);
  const now = new Date().toISOString();
  let premiumAlertsEnabled =
    patch.premiumAlertsEnabled !== undefined
      ? Boolean(patch.premiumAlertsEnabled)
      : Boolean(existing?.premium_alerts_enabled);
  let notifySms =
    patch.notifySms !== undefined ? Boolean(patch.notifySms) : Boolean(existing?.notify_sms);
  let notifyEmail =
    patch.notifyEmail !== undefined ? Boolean(patch.notifyEmail) : Boolean(existing?.notify_email);
  let premiumTermsAcceptedAt = existing?.premium_terms_accepted_at || null;

  if (patch.acceptPremiumTerms) {
    premiumTermsAcceptedAt = now;
  }
  if (!premiumAlertsEnabled) {
    notifySms = false;
    notifyEmail = false;
  }

  const row = {
    user_id: userId,
    premium_alerts_enabled: premiumAlertsEnabled,
    notify_sms: notifySms,
    notify_email: notifyEmail,
    premium_terms_accepted_at: premiumTermsAcceptedAt,
    updated_at: now,
    ...(existing ? {} : { created_at: now }),
  };

  const { data, error } = await supabase
    .from('user_notification_preferences')
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
  ensureUserTransferCode,
  rpcWalletPeerTransfer,
  createTransaction,
  getTransactionsByUserId,
  clearTransactionsByUserId,
  listMt5AccountsByUserId,
  getMt5AccountByIdForUser,
  createMt5AccountForUser,
  deleteMt5AccountForUser,
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
  listWhitelistedWalletsByUserId,
  countWhitelistedWalletsByUserId,
  getWhitelistedWalletForUser,
  insertWhitelistedWallet,
  deleteWhitelistedWalletForUser,
  isAddressWhitelistedForUser,
  MAX_WHITELISTED_WALLETS_PER_USER,
  listNotificationsForUser,
  createAppNotification,
  getNotificationPreferencesByUserId,
  upsertNotificationPreferences,
  insertLocalMoneyOrder,
  updateLocalMoneyOrder,
  getLocalMoneyOrderForUser,
  getLocalMoneyOrderByReference,
  getLocalMoneyOrderByChargeId,
  listLocalMoneyOrdersByUserId,
  listPendingLocalMoneyWithdrawalsByUserId,
};
