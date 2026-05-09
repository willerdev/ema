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

async function checkDatabaseHealth() {
  const [usersResult, walletsResult, transactionsResult, mt5Result, cryptoEthResult, airResult, contractResult] =
    await Promise.all([
      supabase.from('users').select('*').limit(1),
      supabase.from('wallets').select('*').limit(1),
      supabase.from('transactions').select('*').limit(1),
      supabase.from('mt5_accounts').select('*').limit(1),
      supabase.from('crypto_ethereum_wallets').select('*').limit(1),
      supabase.from('airfarming_state').select('*').limit(1),
      supabase.from('contract_wallets').select('*').limit(1),
    ]);
  const cryptoError = cryptoEthResult?.error;
  const airError = airResult?.error;
  const contractError = contractResult?.error;
  const firstError = usersResult.error || walletsResult.error || transactionsResult.error || mt5Result?.error;
  if (firstError) throw firstError;
  if (cryptoError && !isMissingTableError(cryptoError)) throw cryptoError;
  if (airError && !isMissingTableError(airError)) throw airError;
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
  getContractWalletByUserId,
  upsertContractWalletRow,
  getContractAccrualForUserDay,
  insertContractAccrual,
  listContractWalletsWithPositiveBalance,
};
