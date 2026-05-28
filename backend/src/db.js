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

function isSchemaError(error) {
  if (!error) return false;
  if (isMissingTableError(error)) return true;
  if (error.code === 'PGRST204' || error.code === '42703') return true;
  const msg = String(error.message || error.details || '');
  return /does not exist|Could not find the/i.test(msg);
}

function isMissingColumnError(error, columnName) {
  if (!error) return false;
  const msg = String(error.message || error.details || '');
  return isSchemaError(error) && msg.includes(String(columnName));
}

/** Omit scheduled-pause columns when DB migration 20260601 is not applied yet. */
function withoutPauseScheduleFields(row) {
  if (!row || typeof row !== 'object') return row;
  const {
    drops_pause_from: _f,
    drops_pause_until: _u,
    drops_pause_band_indexes: _b,
    ...rest
  } = row;
  return rest;
}

function withoutPauseBandIndexes(row) {
  if (!row || typeof row !== 'object') return row;
  const { drops_pause_band_indexes: _b, ...rest } = row;
  return rest;
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

async function updateUserPasswordHash(userId, passwordHash) {
  const { error } = await supabase.from('users').update({ password_hash: passwordHash }).eq('id', userId);
  if (error) throw error;
}

async function replacePasswordResetCode({ userId, codeHash, expiresAt }) {
  await supabase.from('password_reset_codes').delete().eq('user_id', userId);
  const { error } = await supabase.from('password_reset_codes').insert({
    id: id(),
    user_id: userId,
    code_hash: codeHash,
    expires_at: expiresAt,
  });
  if (error) throw error;
}

/** Returns true if a matching unused, unexpired code was consumed. */
async function consumePasswordResetCode({ userId, codeHash }) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('password_reset_codes')
    .select('id')
    .eq('user_id', userId)
    .eq('code_hash', codeHash)
    .is('used_at', null)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) return false;
  const { error: usedErr } = await supabase
    .from('password_reset_codes')
    .update({ used_at: now })
    .eq('id', data.id);
  if (usedErr) throw usedErr;
  return true;
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

async function getUserIdByTransferCode(transferCode) {
  const code = String(transferCode || '').trim();
  if (!code) return null;
  const { data, error } = await supabase.from('users').select('id').eq('transfer_code', code).maybeSingle();
  if (error) throw error;
  return data?.id ? String(data.id) : null;
}

/** Resolve peer transfer ID to recipient first name (compliance profile only). */
async function lookupPeerTransferRecipient(fromUserId, transferCode) {
  const code = String(transferCode || '').trim();
  if (!code) return { found: false };
  const toUserId = await getUserIdByTransferCode(code);
  if (!toUserId) return { found: false };
  if (toUserId === String(fromUserId)) return { found: false, self: true };
  const profile = await getComplianceProfileByUserId(toUserId);
  const first = profile?.legal_first_name ? String(profile.legal_first_name).trim() : '';
  return { found: true, recipientFirstName: first || null };
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

async function getTransactionById(id) {
  const { data, error } = await supabase.from('transactions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function updateTransaction(id, patch) {
  const { data, error } = await supabase.from('transactions').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
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
  let { data, error } = await supabase.from('airfarming_state').upsert(row, { onConflict: 'user_id' }).select('*').single();
  if (error && isSchemaError(error)) {
    ({ data, error } = await supabase
      .from('airfarming_state')
      .upsert(withoutPauseScheduleFields(row), { onConflict: 'user_id' })
      .select('*')
      .single());
  }
  if (error) throw error;
  return data;
}

async function updateAirfarmingAutoFundSetting(userId, enabled) {
  const { data, error } = await supabase
    .from('airfarming_state')
    .update({
      auto_fund_enabled: Boolean(enabled),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function mondayUtcYmd(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  const offset = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

async function ensureAirfarmingStateRow(userId) {
  const weekYmd = mondayUtcYmd();
  let row = await getAirfarmingStateByUserId(userId);
  if (!row || row.week_start !== weekYmd) {
    const sameWeek = row?.week_start === weekYmd;
    row = await upsertAirfarmingState({
      user_id: userId,
      week_start: weekYmd,
      weekly_event_target: 2,
      weekly_events_used: sameWeek ? Number(row?.weekly_events_used || 0) : 0,
      event_offsets_hours: sameWeek ? row?.event_offsets_hours ?? [] : [],
      last_event_at: sameWeek ? row?.last_event_at ?? null : null,
      auto_fund_enabled: Boolean(row?.auto_fund_enabled),
      drops_paused: Boolean(row?.drops_paused),
      drops_pause_from: row?.drops_pause_from ?? null,
      drops_pause_until: row?.drops_pause_until ?? null,
      drops_pause_band_indexes: row?.drops_pause_band_indexes ?? null,
      updated_at: new Date().toISOString(),
    });
  }
  return row;
}

async function updateAirfarmingDropsPaused(userId, paused) {
  await ensureAirfarmingStateRow(userId);
  const { data, error } = await supabase
    .from('airfarming_state')
    .update({
      drops_paused: Boolean(paused),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function updateAirfarmingUserDropPause(userId, patch) {
  const { normalizeBandIndexes } = require('./airfarmingPause');
  await ensureAirfarmingStateRow(userId);
  const row = { updated_at: new Date().toISOString() };

  if (patch.clearPause) {
    row.drops_paused = false;
    row.drops_pause_from = null;
    row.drops_pause_until = null;
    row.drops_pause_band_indexes = null;
  } else {
    if (patch.indefinitePause === true) {
      row.drops_paused = true;
      row.drops_pause_from = null;
      row.drops_pause_until = null;
      row.drops_pause_band_indexes = null;
    } else {
      if (patch.indefinitePause !== undefined) row.drops_paused = Boolean(patch.indefinitePause);
      if (patch.pauseFrom !== undefined) row.drops_pause_from = patch.pauseFrom;
      if (patch.pauseUntil !== undefined) row.drops_pause_until = patch.pauseUntil;
      if (patch.bandIndexes !== undefined) {
        row.drops_pause_band_indexes = normalizeBandIndexes(patch.bandIndexes);
      }
      if (patch.pauseFrom || patch.pauseUntil) row.drops_paused = false;
    }
  }

  let { data, error } = await supabase
    .from('airfarming_state')
    .update(row)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error && isMissingColumnError(error, 'drops_pause_band_indexes')) {
    ({ data, error } = await supabase
      .from('airfarming_state')
      .update(withoutPauseBandIndexes(row))
      .eq('user_id', userId)
      .select('*')
      .single());
  }
  if (error && isSchemaError(error)) {
    ({ data, error } = await supabase
      .from('airfarming_state')
      .update(withoutPauseScheduleFields(row))
      .eq('user_id', userId)
      .select('*')
      .single());
  }
  if (error) throw error;
  return data;
}

async function getActiveGlobalDropPauses(now = new Date()) {
  const iso = now.toISOString();
  const { data, error } = await supabase
    .from('airfarming_global_pause')
    .select('*')
    .lte('starts_at', iso)
    .gt('ends_at', iso)
    .order('starts_at', { ascending: false });
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function listGlobalDropPauses({ limit = 20 } = {}) {
  const cap = Math.min(100, Math.max(1, Number(limit) || 20));
  const { data, error } = await supabase
    .from('airfarming_global_pause')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(cap);
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function insertGlobalDropPause({ startsAt, endsAt, bandIndexes, note }) {
  const { normalizeBandIndexes } = require('./airfarmingPause');
  const row = {
    id: id(),
    starts_at: startsAt,
    ends_at: endsAt,
    band_indexes: normalizeBandIndexes(bandIndexes),
    note: note ? String(note).trim().slice(0, 500) : null,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('airfarming_global_pause').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function endGlobalDropPauseEarly(pauseId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('airfarming_global_pause')
    .update({ ends_at: now })
    .eq('id', pauseId)
    .gt('ends_at', now)
    .select('*')
    .single();
  if (error?.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

async function listUsersAdmin({ limit = 100, search = '' } = {}) {
  let query = supabase
    .from('users')
    .select('id, email, created_at, transfer_code')
    .order('created_at', { ascending: false })
    .limit(limit);
  const term = String(search || '').trim();
  if (term) query = query.ilike('email', `%${term}%`);
  let { data, error } = await query;
  if (error && isSchemaError(error)) {
    query = supabase
      .from('users')
      .select('id, email, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (term) query = query.ilike('email', `%${term}%`);
    ({ data, error } = await query);
  }
  if (error) throw error;
  const users = data || [];
  const ids = users.map((u) => u.id);

  const cashByUser = new Map();
  const afByUser = new Map();
  const stateByUser = new Map();
  const vipByUser = new Map();

  if (ids.length) {
    const walletsRes = await supabase.from('wallets').select('user_id, balance').in('user_id', ids);
    if (!walletsRes.error) {
      for (const w of walletsRes.data || []) cashByUser.set(w.user_id, Number(w.balance));
    } else if (!isSchemaError(walletsRes.error)) throw walletsRes.error;

    const afRes = await supabase.from('airfarming_wallets').select('user_id, balance').in('user_id', ids);
    if (!afRes.error) {
      for (const w of afRes.data || []) afByUser.set(w.user_id, Number(w.balance));
    } else if (!isSchemaError(afRes.error)) throw afRes.error;

    let stateRes = await supabase
      .from('airfarming_state')
      .select(
        'user_id, drops_paused, drops_pause_from, drops_pause_until, drops_pause_band_indexes, auto_fund_enabled, week_start'
      )
      .in('user_id', ids);
    if (stateRes.error && isMissingColumnError(stateRes.error, 'drops_pause_band_indexes')) {
      stateRes = await supabase
        .from('airfarming_state')
        .select('user_id, drops_paused, drops_pause_from, drops_pause_until, auto_fund_enabled, week_start')
        .in('user_id', ids);
    }
    if (stateRes.error && isSchemaError(stateRes.error)) {
      stateRes = await supabase
        .from('airfarming_state')
        .select('user_id, drops_paused, auto_fund_enabled, week_start')
        .in('user_id', ids);
    }
    if (!stateRes.error) {
      for (const s of stateRes.data || []) stateByUser.set(s.user_id, s);
    } else if (!isSchemaError(stateRes.error)) throw stateRes.error;

    const vipRes = await supabase
      .from('vip_investments')
      .select('user_id, principal_usd, status, matures_at, created_at')
      .eq('status', 'active')
      .in('user_id', ids)
      .order('created_at', { ascending: false });
    if (!vipRes.error) {
      for (const row of vipRes.data || []) {
        if (!vipByUser.has(row.user_id)) vipByUser.set(row.user_id, row);
      }
    } else if (!isSchemaError(vipRes.error)) {
      throw vipRes.error;
    }
  }

  const { pauseStatusFromState } = require('./airfarmingPause');
  return users.map((u) => {
    const st = stateByUser.get(u.id);
    const pause = pauseStatusFromState(st);
    return {
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      transferCode: u.transfer_code || null,
      cashBalance: cashByUser.get(u.id) ?? 0,
      airfarmingBalance: afByUser.get(u.id) ?? 0,
      vipPrincipalUsd: Number(vipByUser.get(u.id)?.principal_usd || 0),
      vipActive: Boolean(vipByUser.get(u.id)),
      dropsPaused: pause.dropsPausedNow,
      dropsPauseUntil: pause.dropsPauseUntil,
      autoFundEnabled: Boolean(st?.auto_fund_enabled),
      airfarmingWeekStart: st?.week_start || null,
    };
  });
}

const NP_DEPOSIT_DONE = new Set(['finished', 'confirmed', 'paid', 'sending']);

function dayKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDailyBucket(map, iso, amount) {
  const day = dayKey(iso);
  const n = Number(amount);
  if (!day || !Number.isFinite(n) || n <= 0) return;
  map.set(day, (map.get(day) || 0) + n);
}

function mapToChartSeries(map) {
  const points = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, amount]) => ({ date, amount: Math.round(amount * 100) / 100 }));
  const total = Math.round(points.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  return { points, total };
}

/** Last 90 days: daily deposit and airfarming profit totals for admin charts. */
async function getAdminUserChartSeries(userId, days = 90) {
  const span = Math.min(365, Math.max(7, Number(days) || 90));
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - span);
  const sinceIso = since.toISOString();

  const depositMap = new Map();
  const profitMap = new Map();

  const [txRes, npRes, dropsRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('type, amount, status, created_at')
      .eq('user_id', userId)
      .eq('type', 'deposit')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true }),
    supabase
      .from('nowpayments_payments')
      .select('price_amount, payment_status, created_at, updated_at')
      .eq('user_id', userId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true }),
    supabase
      .from('airfarming_drops')
      .select('profit_amount, paid_at, status')
      .eq('user_id', userId)
      .eq('status', 'paid')
      .not('paid_at', 'is', null)
      .gte('paid_at', sinceIso)
      .order('paid_at', { ascending: true }),
  ]);

  if (txRes.error && !isSchemaError(txRes.error)) throw txRes.error;
  if (npRes.error && !isSchemaError(npRes.error)) throw npRes.error;
  if (dropsRes.error && !isSchemaError(dropsRes.error)) throw dropsRes.error;

  for (const t of txRes.data || []) {
    const st = String(t.status || '').toLowerCase();
    if (st.startsWith('failed') || st === 'cancelled') continue;
    addDailyBucket(depositMap, t.created_at, t.amount);
  }

  for (const p of npRes.data || []) {
    const st = String(p.payment_status || '').toLowerCase();
    if (!NP_DEPOSIT_DONE.has(st)) continue;
    const at = p.updated_at || p.created_at;
    addDailyBucket(depositMap, at, p.price_amount);
  }

  for (const d of dropsRes.data || []) {
    addDailyBucket(profitMap, d.paid_at, d.profit_amount);
  }

  return {
    days: span,
    deposits: mapToChartSeries(depositMap),
    profits: mapToChartSeries(profitMap),
  };
}

async function getAdminUserDetail(userId) {
  const user = await getUserById(userId);
  if (!user) return null;

  const [wallet, afWallet, state, transactions, scheduledDrops, cryptoBalances, vipInvestment] = await Promise.all([
    getWalletByUserId(userId),
    getAirfarmingWalletByUserId(userId),
    getAirfarmingStateByUserId(userId),
    getTransactionsByUserId(userId),
    supabase
      .from('airfarming_drops')
      .select('id, drop_index, due_at, percent, min_balance, max_balance, band_index, status')
      .eq('user_id', userId)
      .eq('status', 'scheduled')
      .order('due_at', { ascending: true })
      .limit(10),
    getCryptoBalancesByUserId(userId).catch(() => []),
    getActiveVipInvestmentForUser(userId).catch(() => null),
  ]);

  if (scheduledDrops.error && !isSchemaError(scheduledDrops.error)) throw scheduledDrops.error;

  const usdtRow = (cryptoBalances || []).find(
    (b) => b.asset === 'usdttrc20' || b.asset === 'usdt'
  );
  const usdtAvailable = usdtRow ? Number.parseFloat(String(usdtRow.available)) || 0 : 0;

  const { pauseStatusFromState } = require('./airfarmingPause');
  const pause = pauseStatusFromState(state);

  return {
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.created_at,
      transferCode: user.transfer_code || null,
      totpEnabled: Boolean(user.totp_enabled),
    },
    cashBalance: Number.parseFloat(String(wallet?.balance ?? 0)) || 0,
    airfarmingBalance: Number.parseFloat(String(afWallet?.balance ?? 0)) || 0,
    usdtBalance: usdtAvailable,
    vipInvestment: vipInvestmentToApi(vipInvestment),
    cryptoBalances: (cryptoBalances || []).map((b) => ({
      asset: b.asset,
      available: Number.parseFloat(String(b.available)) || 0,
    })),
    airfarming: state
      ? {
          weekStart: state.week_start,
          dropsPaused: pause.dropsPausedNow,
          dropsPausedIndefinite: pause.dropsPausedIndefinite,
          dropsPauseFrom: pause.dropsPauseFrom,
          dropsPauseUntil: pause.dropsPauseUntil,
          dropsPauseBandIndexes: pause.dropsPauseBandIndexes,
          pauseMode: pause.pauseMode,
          autoFundEnabled: Boolean(state.auto_fund_enabled),
          weeklyEventsUsed: Number(state.weekly_events_used || 0),
        }
      : null,
    transactions: (transactions || []).slice(0, 50).map((t) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount),
      status: t.status,
      createdAt: t.created_at,
    })),
    scheduledDrops: (scheduledDrops.error ? [] : scheduledDrops.data || []).map((d) => ({
      id: d.id,
      dropIndex: Number(d.drop_index),
      dueAt: d.due_at,
      percent: Number(d.percent),
      minBalance: Number(d.min_balance),
      maxBalance: Number(d.max_balance),
      status: d.status,
    })),
  };
}

async function getAirfarmingDropsPausedByUserIds(userIds) {
  const { pauseStatusFromState } = require('./airfarmingPause');
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  let { data, error } = await supabase
    .from('airfarming_state')
    .select('user_id, drops_paused, drops_pause_from, drops_pause_until, drops_pause_band_indexes')
    .in('user_id', ids);
  if (error && isSchemaError(error)) {
    ({ data, error } = await supabase.from('airfarming_state').select('user_id, drops_paused').in('user_id', ids));
  }
  if (error && isSchemaError(error)) return new Map();
  if (error) throw error;
  return new Map((data || []).map((r) => [r.user_id, pauseStatusFromState(r).dropsPausedNow]));
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

async function getScheduledAirfarmingDrop(userId, weekStart) {
  const rows = await listScheduledAirfarmingDropsForUser(userId, weekStart, 1);
  return rows[0] || null;
}

async function listScheduledAirfarmingDropsForUser(userId, weekStart, limit = 50) {
  const cap = Math.min(100, Math.max(1, Number(limit) || 50));
  const { data, error } = await supabase
    .from('airfarming_drops')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .eq('status', 'scheduled')
    .order('due_at', { ascending: true })
    .limit(cap);
  if (error) throw error;
  return data || [];
}

async function getMaxAirfarmingDropIndex(userId, weekStart) {
  const { data, error } = await supabase
    .from('airfarming_drops')
    .select('drop_index')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .order('drop_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.drop_index != null ? Number(data.drop_index) : -1;
}

async function getLastAirfarmingDropForWeek(userId, weekStart) {
  const { data, error } = await supabase
    .from('airfarming_drops')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .order('drop_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function insertAirfarmingDrop(row) {
  const { data, error } = await supabase.from('airfarming_drops').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function updateAirfarmingDrop(id, patch) {
  const { data, error } = await supabase.from('airfarming_drops').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

async function getAirfarmingDropById(id) {
  const { data, error } = await supabase.from('airfarming_drops').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function listScheduledAirfarmingDropsAdmin({ upcomingOnly = false, limit = 500 } = {}) {
  let query = supabase
    .from('airfarming_drops')
    .select('*')
    .eq('status', 'scheduled')
    .order('due_at', { ascending: true })
    .limit(limit);
  if (upcomingOnly) {
    query = query.gte('due_at', new Date().toISOString());
  }
  const { data, error } = await query;
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function getUsersByIds(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase.from('users').select('id, email').in('id', ids);
  if (error) throw error;
  return data || [];
}

async function listAirfarmingDropsByUserId(userId, limit = 40) {
  const { data, error } = await supabase
    .from('airfarming_drops')
    .select('*')
    .eq('user_id', userId)
    .order('due_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function listAirfarmingDropsForWeek(userId, weekStart, limit = 50) {
  const { data, error } = await supabase
    .from('airfarming_drops')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .in('status', ['paid', 'missed'])
    .order('due_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function listAirfarmingDropBands() {
  const { data, error } = await supabase
    .from('airfarming_drop_bands')
    .select('*')
    .eq('active', true)
    .order('band_index', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getAirfarmingDropBandByIndex(bandIndex) {
  const { data, error } = await supabase
    .from('airfarming_drop_bands')
    .select('*')
    .eq('band_index', bandIndex)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function listAirfarmingDropBandsAdmin() {
  const { data, error } = await supabase
    .from('airfarming_drop_bands')
    .select('*')
    .order('band_index', { ascending: true });
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function updateAirfarmingDropBand(bandIndex, patch) {
  const row = { updated_at: new Date().toISOString() };
  if (patch.label !== undefined) row.label = String(patch.label).trim().slice(0, 120);
  if (patch.balanceHint !== undefined) row.balance_hint = String(patch.balanceHint).trim().slice(0, 200);
  if (patch.percent !== undefined) row.percent = patch.percent;
  if (patch.minBalance !== undefined) row.min_balance = patch.minBalance;
  if (patch.maxBalance !== undefined) row.max_balance = patch.maxBalance;
  if (patch.active !== undefined) row.active = Boolean(patch.active);

  let { data, error } = await supabase
    .from('airfarming_drop_bands')
    .update(row)
    .eq('band_index', bandIndex)
    .select('*')
    .single();
  if (error && isMissingColumnError(error, 'min_balance')) {
    const { min_balance, max_balance, ...rest } = row;
    ({ data, error } = await supabase
      .from('airfarming_drop_bands')
      .update(rest)
      .eq('band_index', bandIndex)
      .select('*')
      .single());
  }
  if (error) throw error;
  return data;
}

const DEFAULT_PLATFORM_SETTINGS = { id: 'default', max_percent: 57.9, max_profit_per_drop: 5000 };

async function getAirfarmingPlatformSettings() {
  const { data, error } = await supabase
    .from('airfarming_platform_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();
  if (error && isSchemaError(error)) return { ...DEFAULT_PLATFORM_SETTINGS };
  if (error) throw error;
  return data || { ...DEFAULT_PLATFORM_SETTINGS };
}

async function updateAirfarmingPlatformSettings(patch) {
  const existing = await getAirfarmingPlatformSettings();
  const row = {
    id: 'default',
    max_percent:
      patch.maxPercent !== undefined ? patch.maxPercent : Number(existing.max_percent) || 57.9,
    max_profit_per_drop:
      patch.maxProfitPerDrop !== undefined
        ? patch.maxProfitPerDrop
        : Number(existing.max_profit_per_drop) || 5000,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('airfarming_platform_settings')
    .upsert(row, { onConflict: 'id' })
    .select('*')
    .single();
  if (error && isSchemaError(error)) throw new Error('Run migration 20260603_airfarming_drop_settings.sql in Supabase');
  if (error) throw error;
  return data;
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

async function getExpertTradingWalletByUserId(userId) {
  const { data, error } = await supabase
    .from('expert_trading_wallets')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertExpertTradingWalletRow(row) {
  const { data, error } = await supabase
    .from('expert_trading_wallets')
    .upsert(row, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function insertExpertTradingTransfer(row) {
  const { data, error } = await supabase.from('expert_trading_transfers').insert(row).select('*').single();
  if (error) throw error;
  return data;
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

async function getNowpaymentsPayoutById(id) {
  const { data, error } = await supabase.from('nowpayments_payouts').select('*').eq('id', id).maybeSingle();
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
      'awaiting_approval',
      'processing',
      'creating',
      'sending',
      'waiting',
      'awaiting_verify',
      'in_progress',
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

async function getLocalMoneyOrderById(id) {
  const { data, error } = await supabase.from('local_money_orders').select('*').eq('id', id).maybeSingle();
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

const ILLEGAL_WITHDRAW_STATUSES = new Set(['failed', 'rejected', 'refunded', 'cancelled', 'cancelled_by_user', 'expired']);
const COMPLETED_DEPOSIT_STATUSES = new Set(['completed', 'successful', 'success', 'succeeded', 'finished', 'approved']);
const COMPLETED_WITHDRAW_STATUSES = new Set([
  'finished',
  'approved',
  'completed',
  'successful',
  'success',
  'succeeded',
  'in_progress',
  'processing',
  'creating',
  'sending',
  'waiting',
  'awaiting_verify',
]);

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function isIllegalWithdrawStatus(status) {
  const s = String(status || '').toLowerCase();
  if (ILLEGAL_WITHDRAW_STATUSES.has(s)) return true;
  if (s.includes('reject')) return true;
  return false;
}

function withdrawalAmountUsd(amount) {
  const n = Number.parseFloat(String(amount ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function depositAmountUsd(amount) {
  return withdrawalAmountUsd(amount);
}

function withinWindow(createdAt, sinceIso) {
  if (!sinceIso) return true;
  return new Date(createdAt).getTime() >= new Date(sinceIso).getTime();
}

/**
 * Aggregate withdrawal and deposit activity from cash wallet, crypto payouts, and mobile money.
 * @returns {Promise<{
 *   withdrawCount7d: number;
 *   withdrawCount30d: number;
 *   withdrawCountLifetime: number;
 *   withdrawAmount7d: number;
 *   withdrawAmount90d: number;
 *   depositAmount90d: number;
 *   illegalCount90d: number;
 * }>}
 */
async function getUserWithdrawalDepositStats(userId) {
  const since7 = isoDaysAgo(7);
  const since30 = isoDaysAgo(30);
  const since90 = isoDaysAgo(90);

  const stats = {
    withdrawCount7d: 0,
    withdrawCount30d: 0,
    withdrawCountLifetime: 0,
    withdrawAmount7d: 0,
    withdrawAmount90d: 0,
    depositAmount90d: 0,
    illegalCount90d: 0,
  };

  const bumpWithdraw = (amount, createdAt) => {
    const amt = withdrawalAmountUsd(amount);
    if (amt <= 0) return;
    stats.withdrawCountLifetime += 1;
    if (withinWindow(createdAt, since30)) stats.withdrawCount30d += 1;
    if (withinWindow(createdAt, since7)) {
      stats.withdrawCount7d += 1;
      stats.withdrawAmount7d += amt;
    }
    if (withinWindow(createdAt, since90)) stats.withdrawAmount90d += amt;
  };

  const [txRes, npPayRes, npPayoutRes, localRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('type, amount, status, created_at')
      .eq('user_id', userId)
      .in('type', ['withdraw', 'deposit'])
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('nowpayments_payments')
      .select('price_amount, payment_status, ledger_credited, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('nowpayments_payouts')
      .select('amount, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('local_money_orders')
      .select('type, crypto_amount, status, created_at')
      .eq('user_id', userId)
      .in('type', ['withdraw', 'deposit'])
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  if (txRes.error && !isSchemaError(txRes.error)) throw txRes.error;
  if (npPayRes.error && !isSchemaError(npPayRes.error)) throw npPayRes.error;
  if (npPayoutRes.error && !isSchemaError(npPayoutRes.error)) throw npPayoutRes.error;
  if (localRes.error && !isSchemaError(localRes.error)) throw localRes.error;

  for (const row of txRes.data || []) {
    const createdAt = row.created_at;
    if (row.type === 'deposit') {
      const s = String(row.status || '').toLowerCase();
      if (!COMPLETED_DEPOSIT_STATUSES.has(s) && !s.startsWith('approved')) continue;
      const amt = depositAmountUsd(row.amount);
      if (withinWindow(createdAt, since90)) stats.depositAmount90d += amt;
      continue;
    }
    if (row.type !== 'withdraw') continue;
    const s = String(row.status || '').toLowerCase();
    if (isIllegalWithdrawStatus(s)) {
      if (withinWindow(createdAt, since90)) stats.illegalCount90d += 1;
      continue;
    }
    if (s.startsWith('pending')) {
      if (withinWindow(createdAt, since90)) bumpWithdraw(row.amount, createdAt);
      continue;
    }
    if (COMPLETED_WITHDRAW_STATUSES.has(s) || s.startsWith('approved')) {
      bumpWithdraw(row.amount, createdAt);
    }
  }

  for (const row of npPayRes.data || []) {
    const credited = Boolean(row.ledger_credited);
    const s = String(row.payment_status || '').toLowerCase();
    if (!credited && s !== 'finished') continue;
    const amt = depositAmountUsd(row.price_amount);
    if (withinWindow(row.created_at, since90)) stats.depositAmount90d += amt;
  }

  for (const row of npPayoutRes.data || []) {
    const s = String(row.status || '').toLowerCase();
    const createdAt = row.created_at;
    if (isIllegalWithdrawStatus(s)) {
      if (withinWindow(createdAt, since90)) stats.illegalCount90d += 1;
      continue;
    }
    if (s === 'awaiting_approval' || COMPLETED_WITHDRAW_STATUSES.has(s)) {
      bumpWithdraw(row.amount, createdAt);
    }
  }

  for (const row of localRes.data || []) {
    const createdAt = row.created_at;
    const s = String(row.status || '').toLowerCase();
    const amt = withdrawalAmountUsd(row.crypto_amount);
    if (row.type === 'deposit') {
      if (COMPLETED_DEPOSIT_STATUSES.has(s) && withinWindow(createdAt, since90)) {
        stats.depositAmount90d += amt;
      }
      continue;
    }
    if (isIllegalWithdrawStatus(s)) {
      if (withinWindow(createdAt, since90)) stats.illegalCount90d += 1;
      continue;
    }
    if (COMPLETED_WITHDRAW_STATUSES.has(s) || s === 'awaiting_approval' || s === 'pending' || s === 'processing') {
      bumpWithdraw(row.crypto_amount, createdAt);
    }
  }

  return stats;
}

/** All withdrawals awaiting manual admin approval. */
async function listPendingWithdrawalsAdmin({ limit = 200 } = {}) {
  const cap = Math.min(500, Math.max(1, Number(limit) || 200));
  const items = [];

  const [txRes, npRes, localRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('*')
      .eq('type', 'withdraw')
      .like('status', 'pending%')
      .order('created_at', { ascending: false })
      .limit(cap),
    supabase
      .from('nowpayments_payouts')
      .select('*')
      .eq('status', 'awaiting_approval')
      .eq('reserve_released', false)
      .order('created_at', { ascending: false })
      .limit(cap),
    supabase
      .from('local_money_orders')
      .select('*')
      .eq('type', 'withdraw')
      .eq('status', 'awaiting_approval')
      .order('created_at', { ascending: false })
      .limit(cap),
  ]);

  if (txRes.error && !isSchemaError(txRes.error)) throw txRes.error;
  if (npRes.error && !isSchemaError(npRes.error)) throw npRes.error;
  if (localRes.error && !isSchemaError(localRes.error)) throw localRes.error;

  for (const t of txRes.data || []) {
    items.push({
      source: 'cash_wallet',
      id: t.id,
      userId: t.user_id,
      amount: Number(t.amount),
      asset: 'USD',
      status: t.status,
      destination: t.status.replace(/^pending:/, ''),
      createdAt: t.created_at,
    });
  }
  for (const p of npRes.data || []) {
    items.push({
      source: 'nowpayments',
      id: p.id,
      userId: p.user_id,
      amount: Number(p.amount),
      asset: String(p.currency || '').toUpperCase(),
      status: p.status,
      destination: p.address,
      createdAt: p.created_at,
    });
  }
  for (const o of localRes.data || []) {
    items.push({
      source: 'local_money',
      id: o.id,
      userId: o.user_id,
      amount: Number(o.crypto_amount),
      asset: String(o.crypto_asset || 'usdt').toUpperCase(),
      status: o.status,
      destination: o.phone,
      fiatAmount: Number(o.fiat_amount),
      fiatCurrency: o.fiat_currency,
      countryCode: o.country_code,
      createdAt: o.created_at,
    });
  }

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const userIds = [...new Set(items.map((i) => i.userId))];
  const users = await getUsersByIds(userIds);
  const emailByUserId = new Map(users.map((u) => [u.id, u.email]));

  return items.slice(0, cap).map((row) => ({
    ...row,
    userEmail: emailByUserId.get(row.userId) || '—',
    sourceLabel:
      row.source === 'cash_wallet'
        ? 'Cash wallet'
        : row.source === 'nowpayments'
          ? 'Crypto (NOWPayments)'
          : 'Mobile money',
  }));
}

async function insertSupportTicket(row) {
  const now = new Date().toISOString();
  const payload = {
    id: row.id || id(),
    user_id: row.user_id,
    category: row.category,
    status: row.status || 'under_review',
    payload: row.payload || {},
    related_activity_id: row.related_activity_id || null,
    created_at: row.created_at || now,
    updated_at: row.updated_at || now,
  };
  const { data, error } = await supabase.from('support_tickets').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

async function listSupportTicketsByUserId(userId, limit = 30) {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function getSupportTicketForUser(userId, ticketId) {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('user_id', userId)
    .eq('id', ticketId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getSupportTicketById(ticketId) {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('id', ticketId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function listSupportTicketsAdmin({ limit = 200, status, category, search } = {}) {
  const cap = Math.min(500, Math.max(1, Number(limit) || 200));
  let query = supabase.from('support_tickets').select('*').order('created_at', { ascending: false }).limit(cap);
  if (status) query = query.eq('status', String(status));
  if (category) query = query.eq('category', String(category));
  const term = String(search || '').trim();
  if (term) {
    const { data: userRows, error: userErr } = await supabase
      .from('users')
      .select('id')
      .ilike('email', `%${term}%`)
      .limit(100);
    if (userErr) throw userErr;
    const ids = (userRows || []).map((u) => u.id);
    if (!ids.length) return [];
    query = query.in('user_id', ids);
  }
  const { data, error } = await query;
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function updateSupportTicketStatus(ticketId, status) {
  const { data, error } = await supabase
    .from('support_tickets')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', ticketId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function adminMoveCashToAirfarming(userId, amount) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    const err = new Error('Invalid amount');
    err.statusCode = 400;
    throw err;
  }

  const wallet = await ensureWalletForUser(userId);
  const cash = Number.parseFloat(String(wallet.balance ?? 0)) || 0;
  if (cash < amt) {
    const err = new Error('Insufficient cash wallet balance');
    err.statusCode = 400;
    throw err;
  }

  const af = await getAirfarmingWalletByUserId(userId);
  const nextAf = (Number.parseFloat(String(af?.balance ?? 0)) || 0) + amt;
  const now = new Date().toISOString();

  await setWalletBalance(userId, cash - amt);
  await upsertAirfarmingWalletRow({
    user_id: userId,
    balance: nextAf,
    updated_at: now,
  });
  await insertAirfarmingTransfer({
    id: id(),
    user_id: userId,
    direction: 'to_airfarming',
    amount: amt,
    created_at: now,
  });

  return { cashWallet: cash - amt, airfarmingBalance: nextAf, amount: amt };
}

function roundWalletUsd(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * Admin set or adjust user wallet (cash, airfarming, or USDT ledger).
 * @param {'cash'|'airfarming'|'usdt'} wallet
 * @param {'set'|'adjust'} mode - set absolute balance, or add/subtract amount
 */
async function adminAdjustUserWallet(userId, { wallet, mode = 'set', amount, reason }) {
  const note = String(reason || '').trim();
  if (!note) {
    const err = new Error('A reason is required for balance adjustments');
    err.statusCode = 400;
    throw err;
  }

  const w = String(wallet || '').toLowerCase();
  if (!['cash', 'airfarming', 'usdt'].includes(w)) {
    const err = new Error('wallet must be cash, airfarming, or usdt');
    err.statusCode = 400;
    throw err;
  }

  const raw = Number(amount);
  if (!Number.isFinite(raw)) {
    const err = new Error('Valid amount is required');
    err.statusCode = 400;
    throw err;
  }

  const m = mode === 'adjust' ? 'adjust' : 'set';
  const now = new Date().toISOString();
  const auditId = id();

  if (w === 'cash') {
    await ensureWalletForUser(userId);
    const row = await getWalletByUserId(userId);
    const previous = roundWalletUsd(row?.balance);
    const next =
      m === 'adjust' ? roundWalletUsd(previous + raw) : roundWalletUsd(raw);
    if (next < 0) {
      const err = new Error('Cash balance cannot be negative');
      err.statusCode = 400;
      throw err;
    }
    await setWalletBalance(userId, next);
    const change = roundWalletUsd(next - previous);
    if (change > 0) {
      await createTransaction({
        userId,
        type: 'deposit',
        amount: change,
        status: 'completed',
      });
    } else if (change < 0) {
      await createTransaction({
        userId,
        type: 'withdraw',
        amount: Math.abs(change),
        status: 'completed',
      });
    }
    return {
      wallet: 'cash',
      mode: m,
      previousBalance: previous,
      newBalance: next,
      change,
      reason: note,
      auditId,
    };
  }

  if (w === 'airfarming') {
    const af = await getAirfarmingWalletByUserId(userId);
    const previous = roundWalletUsd(af?.balance);
    const next =
      m === 'adjust' ? roundWalletUsd(previous + raw) : roundWalletUsd(raw);
    if (next < 0) {
      const err = new Error('Airfarming balance cannot be negative');
      err.statusCode = 400;
      throw err;
    }
    await upsertAirfarmingWalletRow({
      user_id: userId,
      balance: next,
      updated_at: now,
    });
    const change = roundWalletUsd(next - previous);
    if (change > 0) {
      await insertAirfarmingTransfer({
        id: id(),
        user_id: userId,
        direction: 'to_airfarming',
        amount: change,
        created_at: now,
      });
    } else if (change < 0) {
      await insertAirfarmingTransfer({
        id: id(),
        user_id: userId,
        direction: 'to_cash',
        amount: Math.abs(change),
        created_at: now,
      });
    }
    return {
      wallet: 'airfarming',
      mode: m,
      previousBalance: previous,
      newBalance: next,
      change,
      reason: note,
      auditId,
    };
  }

  const asset = 'usdttrc20';
  const balances = await getCryptoBalancesByUserId(userId);
  const row = balances.find((b) => b.asset === asset || b.asset === 'usdt');
  const previous = roundWalletUsd(row?.available ?? 0);
  const next = m === 'adjust' ? roundWalletUsd(previous + raw) : roundWalletUsd(raw);
  if (next < 0) {
    const err = new Error('USDT balance cannot be negative');
    err.statusCode = 400;
    throw err;
  }
  const change = roundWalletUsd(next - previous);
  if (change > 0) {
    await insertCryptoLedgerEntry({
      id: id(),
      user_id: userId,
      asset,
      direction: 'in',
      amount: change,
      source: 'admin_adjustment',
      source_id: auditId,
    });
  } else if (change < 0) {
    await insertCryptoLedgerEntry({
      id: id(),
      user_id: userId,
      asset,
      direction: 'out',
      amount: Math.abs(change),
      source: 'admin_adjustment',
      source_id: auditId,
    });
  }
  return {
    wallet: 'usdt',
    asset,
    mode: m,
    previousBalance: previous,
    newBalance: next,
    change,
    reason: note,
    auditId,
  };
}

async function getActiveAppAnnouncement() {
  const { data, error } = await supabase
    .from('app_announcements')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && isSchemaError(error)) return null;
  if (error) throw error;
  return data;
}

async function listAppAnnouncementsAdmin(limit = 30) {
  const { data, error } = await supabase
    .from('app_announcements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function publishAppAnnouncement({ title, body }) {
  const now = new Date().toISOString();
  await supabase.from('app_announcements').update({ active: false, updated_at: now }).eq('active', true);
  const row = {
    id: id(),
    title: String(title).trim(),
    body: String(body).trim(),
    active: true,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from('app_announcements').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function clearActiveAppAnnouncement() {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('app_announcements')
    .update({ active: false, updated_at: now })
    .eq('active', true);
  if (error) throw error;
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

function utcTodayYmd(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function planRowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    planDate: row.plan_date,
    budgetUsd: Number(row.budget_usd),
    budgetSpentUsd: Number(row.budget_spent_usd),
    projectedPayoutUsd: Number(row.projected_payout_usd),
    marketSnapshot: row.market_snapshot || {},
    status: row.status,
    planSummary: row.plan_summary || null,
    model: row.model || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function allocationRowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    planId: row.plan_id,
    userId: row.user_id,
    bandIndex: row.band_index != null ? Number(row.band_index) : null,
    percent: row.percent != null ? Number(row.percent) : null,
    minBalance: row.min_balance != null ? Number(row.min_balance) : null,
    maxBalance: row.max_balance != null ? Number(row.max_balance) : null,
    projectedProfit: Number(row.projected_profit || 0),
    eligible: Boolean(row.eligible),
    dropId: row.drop_id || null,
    appliedAt: row.applied_at || null,
    createdAt: row.created_at,
  };
}

async function getAiDailyPlanByDate(planDate) {
  const { data, error } = await supabase
    .from('ai_daily_plans')
    .select('*')
    .eq('plan_date', planDate)
    .maybeSingle();
  if (error && isSchemaError(error)) return null;
  if (error) throw error;
  return data;
}

async function getAiDailyPlanById(id) {
  const { data, error } = await supabase.from('ai_daily_plans').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertAiDailyPlan({
  planDate,
  budgetUsd,
  marketSnapshot,
  status,
  planSummary,
  model,
  projectedPayoutUsd,
  budgetSpentUsd,
}) {
  const date = planDate || utcTodayYmd();
  const existing = await getAiDailyPlanByDate(date);
  const now = new Date().toISOString();
  const row = {
    plan_date: date,
    updated_at: now,
  };
  if (budgetUsd !== undefined) row.budget_usd = Math.round(Number(budgetUsd) * 100) / 100;
  if (marketSnapshot !== undefined) row.market_snapshot = marketSnapshot;
  if (status !== undefined) row.status = status;
  if (planSummary !== undefined) row.plan_summary = planSummary;
  if (model !== undefined) row.model = model;
  if (projectedPayoutUsd !== undefined) row.projected_payout_usd = Math.round(Number(projectedPayoutUsd) * 100) / 100;
  if (budgetSpentUsd !== undefined) row.budget_spent_usd = Math.round(Number(budgetSpentUsd) * 100) / 100;

  if (existing) {
    const { data, error } = await supabase
      .from('ai_daily_plans')
      .update(row)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  const insert = {
    id: id(),
    plan_date: date,
    budget_usd: budgetUsd !== undefined ? row.budget_usd : 0,
    budget_spent_usd: budgetSpentUsd !== undefined ? row.budget_spent_usd : 0,
    projected_payout_usd: projectedPayoutUsd !== undefined ? row.projected_payout_usd : 0,
    market_snapshot: marketSnapshot !== undefined ? marketSnapshot : {},
    status: status || 'draft',
    plan_summary: planSummary || null,
    model: model || null,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from('ai_daily_plans').insert(insert).select('*').single();
  if (error) throw error;
  return data;
}

async function updateAiDailyPlan(planId, patch) {
  const row = { updated_at: new Date().toISOString() };
  if (patch.budgetUsd !== undefined) row.budget_usd = Math.round(Number(patch.budgetUsd) * 100) / 100;
  if (patch.budgetSpentUsd !== undefined) row.budget_spent_usd = Math.round(Number(patch.budgetSpentUsd) * 100) / 100;
  if (patch.projectedPayoutUsd !== undefined) row.projected_payout_usd = Math.round(Number(patch.projectedPayoutUsd) * 100) / 100;
  if (patch.marketSnapshot !== undefined) row.market_snapshot = patch.marketSnapshot;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.planSummary !== undefined) row.plan_summary = patch.planSummary;
  if (patch.model !== undefined) row.model = patch.model;

  const { data, error } = await supabase
    .from('ai_daily_plans')
    .update(row)
    .eq('id', planId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function clearAiAllocationsForPlan(planId) {
  const { error } = await supabase.from('ai_user_drop_allocations').delete().eq('plan_id', planId);
  if (error && isSchemaError(error)) return;
  if (error) throw error;
}

async function upsertAiUserAllocation({
  planId,
  userId,
  bandIndex,
  percent,
  minBalance,
  maxBalance,
  projectedProfit,
  eligible,
  dropId,
  appliedAt,
}) {
  const row = {};
  if (bandIndex !== undefined) row.band_index = bandIndex;
  if (percent !== undefined) row.percent = percent;
  if (minBalance !== undefined) row.min_balance = minBalance;
  if (maxBalance !== undefined) row.max_balance = maxBalance;
  if (projectedProfit !== undefined) row.projected_profit = projectedProfit;
  if (eligible !== undefined) row.eligible = Boolean(eligible);
  if (dropId !== undefined) row.drop_id = dropId;
  if (appliedAt !== undefined) row.applied_at = appliedAt;

  const { data: existing } = await supabase
    .from('ai_user_drop_allocations')
    .select('id')
    .eq('plan_id', planId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from('ai_user_drop_allocations')
      .update({
        band_index: row.band_index,
        percent: row.percent,
        min_balance: row.min_balance,
        max_balance: row.max_balance,
        projected_profit: row.projected_profit,
        eligible: row.eligible,
        drop_id: row.drop_id,
        applied_at: row.applied_at,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('ai_user_drop_allocations')
    .insert({
      id: id(),
      plan_id: planId,
      user_id: userId,
      band_index: bandIndex ?? null,
      percent: percent ?? null,
      min_balance: minBalance ?? null,
      max_balance: maxBalance ?? null,
      projected_profit: projectedProfit ?? 0,
      eligible: eligible !== false,
      drop_id: dropId ?? null,
      applied_at: appliedAt ?? null,
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function listAiAllocationsByPlan(planId, { limit = 5000 } = {}) {
  const { data, error } = await supabase
    .from('ai_user_drop_allocations')
    .select('*')
    .eq('plan_id', planId)
    .order('projected_profit', { ascending: false })
    .limit(limit);
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function getAiAllocationForUserPlan(planId, userId) {
  const { data, error } = await supabase
    .from('ai_user_drop_allocations')
    .select('*')
    .eq('plan_id', planId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getActiveAiAllocationForUserToday(userId, planDate = utcTodayYmd()) {
  const plan = await getAiDailyPlanByDate(planDate);
  if (!plan || plan.status !== 'active') return { plan: null, allocation: null };
  const allocation = await getAiAllocationForUserPlan(plan.id, userId);
  return { plan, allocation };
}

async function incrementAiDailyBudgetSpent(planDate, amount) {
  const plan = await getAiDailyPlanByDate(planDate);
  if (!plan) return null;
  const add = Math.round(Number(amount) * 100) / 100;
  const next = Math.round((Number(plan.budget_spent_usd) + add) * 100) / 100;
  return updateAiDailyPlan(plan.id, { budgetSpentUsd: next });
}

async function recalcPlanProjectedTotals(planId) {
  const rows = await listAiAllocationsByPlan(planId);
  const total = rows
    .filter((r) => r.eligible)
    .reduce((s, r) => s + Number(r.projected_profit || 0), 0);
  return updateAiDailyPlan(planId, { projectedPayoutUsd: Math.round(total * 100) / 100 });
}

async function listUsersForAiPlannerBatch({ offset = 0, limit = 50 } = {}) {
  const cap = Math.min(200, Math.max(1, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email')
    .order('created_at', { ascending: true })
    .range(off, off + cap - 1);
  if (error) throw error;
  const list = users || [];
  const ids = list.map((u) => u.id);
  if (!ids.length) return { users: [], hasMore: false };

  const cashByUser = new Map();
  const afByUser = new Map();
  const { pauseStatusFromState } = require('./airfarmingPause');

  const walletsRes = await supabase.from('wallets').select('user_id, balance').in('user_id', ids);
  if (!walletsRes.error) {
    for (const w of walletsRes.data || []) cashByUser.set(w.user_id, Number(w.balance));
  }

  const afRes = await supabase.from('airfarming_wallets').select('user_id, balance').in('user_id', ids);
  if (!afRes.error) {
    for (const w of afRes.data || []) afByUser.set(w.user_id, Number(w.balance));
  }

  let stateRes = await supabase
    .from('airfarming_state')
    .select('user_id, drops_paused, drops_pause_from, drops_pause_until, drops_pause_band_indexes')
    .in('user_id', ids);
  if (stateRes.error && isSchemaError(stateRes.error)) {
    stateRes = await supabase.from('airfarming_state').select('user_id, drops_paused').in('user_id', ids);
  }

  const stateByUser = new Map();
  if (!stateRes.error) {
    for (const s of stateRes.data || []) stateByUser.set(s.user_id, s);
  }

  const weekStart = (() => {
    const d = new Date();
    const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dow = utc.getUTCDay();
    utc.setUTCDate(utc.getUTCDate() - ((dow + 6) % 7));
    return utc.toISOString().slice(0, 10);
  })();

  const paidByUser = new Map();
  const paidRes = await supabase
    .from('airfarming_drops')
    .select('user_id')
    .eq('week_start', weekStart)
    .eq('status', 'paid')
    .in('user_id', ids);
  if (!paidRes.error) {
    for (const r of paidRes.data || []) {
      paidByUser.set(r.user_id, (paidByUser.get(r.user_id) || 0) + 1);
    }
  }

  const mapped = list.map((u) => {
    const st = stateByUser.get(u.id);
    const pause = pauseStatusFromState(st);
    return {
      id: u.id,
      email: u.email,
      cashBalance: cashByUser.get(u.id) ?? 0,
      airfarmingBalance: afByUser.get(u.id) ?? 0,
      dropsPaused: pause.dropsPausedNow,
      paidDropsThisWeek: paidByUser.get(u.id) || 0,
    };
  });

  return { users: mapped, hasMore: list.length === cap };
}

async function countUsersForAiPlanner() {
  const { count, error } = await supabase.from('users').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

async function listAiDailyPlansAdmin({ limit = 45 } = {}) {
  const lim = Math.min(90, Math.max(1, Number(limit) || 45));
  const { data, error } = await supabase
    .from('ai_daily_plans')
    .select('*')
    .order('plan_date', { ascending: false })
    .limit(lim);
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function listAirfarmingDropsForUserIdsWeek(userIds, weekStart) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('airfarming_drops')
    .select(
      'id, user_id, week_start, drop_index, due_at, paid_at, status, percent, min_balance, max_balance, profit_amount, percent_locked, band_index'
    )
    .eq('week_start', weekStart)
    .in('user_id', ids)
    .order('due_at', { ascending: true });
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function listAirfarmingWalletsByUserIds(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase.from('airfarming_wallets').select('user_id, balance').in('user_id', ids);
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function listAirfarmingStatesByUserIds(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return [];
  let res = await supabase
    .from('airfarming_state')
    .select('user_id, drops_paused, drops_pause_from, drops_pause_until, drops_pause_band_indexes')
    .in('user_id', ids);
  if (res.error && isSchemaError(res.error)) {
    res = await supabase.from('airfarming_state').select('user_id, drops_paused').in('user_id', ids);
  }
  if (res.error && isSchemaError(res.error)) return [];
  if (res.error) throw res.error;
  return res.data || [];
}

const VIP_DAILY_RATE = 0.09;
const VIP_LOCK_DAYS = 30;
const VIP_MIN_INVEST_USD = 100;
const VIP_EARLY_PENALTY_RATE = 0.3;

function roundWalletUsd(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function vipInvestmentToApi(row) {
  if (!row) return null;
  const now = Date.now();
  const maturesMs = new Date(row.matures_at).getTime();
  const daysLeft = Math.max(0, Math.ceil((maturesMs - now) / (24 * 3600 * 1000)));
  return {
    id: row.id,
    userId: row.user_id,
    principalUsd: Number(row.principal_usd),
    startedAt: row.started_at,
    maturesAt: row.matures_at,
    status: row.status,
    totalAccruedUsd: Number(row.total_accrued_usd),
    daysAccrued: Number(row.days_accrued),
    daysLeft,
    matured: now >= maturesMs,
    dailyRate: VIP_DAILY_RATE,
    lockDays: VIP_LOCK_DAYS,
  };
}

async function getActiveVipInvestmentForUser(userId) {
  const { data, error } = await supabase
    .from('vip_investments')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && isSchemaError(error)) return null;
  if (error) throw error;
  return data;
}

async function getVipInvestmentById(id) {
  const { data, error } = await supabase.from('vip_investments').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function createVipInvestment({ userId, principalUsd, startedAt, maturesAt }) {
  const now = new Date().toISOString();
  const row = {
    id: id(),
    user_id: userId,
    principal_usd: roundWalletUsd(principalUsd),
    started_at: startedAt || now,
    matures_at: maturesAt,
    status: 'active',
    total_accrued_usd: 0,
    days_accrued: 0,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from('vip_investments').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function updateVipInvestment(investmentId, patch) {
  const row = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.principalUsd !== undefined) row.principal_usd = roundWalletUsd(patch.principalUsd);
  if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
  if (patch.maturesAt !== undefined) row.matures_at = patch.maturesAt;
  if (patch.totalAccruedUsd !== undefined) row.total_accrued_usd = roundWalletUsd(patch.totalAccruedUsd);
  if (patch.daysAccrued !== undefined) row.days_accrued = Number(patch.daysAccrued);
  const { data, error } = await supabase
    .from('vip_investments')
    .update(row)
    .eq('id', investmentId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function listActiveVipInvestments() {
  const { data, error } = await supabase
    .from('vip_investments')
    .select('*')
    .eq('status', 'active')
    .lt('days_accrued', VIP_LOCK_DAYS);
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function getVipAccrualForInvestmentDay(investmentId, accrualDateYmd) {
  const { data, error } = await supabase
    .from('vip_accruals')
    .select('*')
    .eq('investment_id', investmentId)
    .eq('accrual_date', accrualDateYmd)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function insertVipAccrual(row) {
  const { data, error } = await supabase.from('vip_accruals').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function listVipAccrualsForUserBetween(userId, startYmd, endYmd) {
  const { data, error } = await supabase
    .from('vip_accruals')
    .select('*')
    .eq('user_id', userId)
    .gte('accrual_date', startYmd)
    .lte('accrual_date', endYmd)
    .order('accrual_date', { ascending: true });
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function listVipAccrualsForUserOnDate(userId, dateYmd) {
  const { data, error } = await supabase
    .from('vip_accruals')
    .select('*')
    .eq('user_id', userId)
    .eq('accrual_date', dateYmd)
    .order('created_at', { ascending: true });
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

function userDropScheduleRowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    weekStart: row.week_start,
    dropCount: Number(row.drop_count),
    targetTotalUsd: Number(row.target_total_usd),
    referenceBalance: Number(row.reference_balance),
    status: row.status,
    planSummary: row.plan_summary || null,
    plannerMode: row.planner_mode || null,
    items: Array.isArray(row.items) ? row.items : [],
    appliedAt: row.applied_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getUserDropSchedule(userId, weekStart) {
  const { data, error } = await supabase
    .from('user_drop_schedules')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (error && isSchemaError(error)) return null;
  if (error) throw error;
  return data;
}

async function upsertUserDropSchedule({
  userId,
  weekStart,
  dropCount,
  targetTotalUsd,
  referenceBalance,
  status,
  planSummary,
  plannerMode,
  items,
  appliedAt,
}) {
  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    week_start: weekStart,
    drop_count: Number(dropCount),
    target_total_usd: Number(targetTotalUsd),
    reference_balance: Number(referenceBalance),
    status: status || 'draft',
    plan_summary: planSummary ?? null,
    planner_mode: plannerMode ?? null,
    items: items || [],
    applied_at: appliedAt ?? null,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from('user_drop_schedules')
    .upsert(row, { onConflict: 'user_id,week_start' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function deleteScheduledAirfarmingDropsForUserWeek(userId, weekStart) {
  const { error } = await supabase
    .from('airfarming_drops')
    .delete()
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .eq('status', 'scheduled');
  if (error) throw error;
}

async function listPaidAirfarmingDropsForUserBetween(userId, startIso, endIso) {
  const { data, error } = await supabase
    .from('airfarming_drops')
    .select('id, profit_amount, paid_at, percent, status')
    .eq('user_id', userId)
    .eq('status', 'paid')
    .not('paid_at', 'is', null)
    .gte('paid_at', startIso)
    .lte('paid_at', endIso)
    .order('paid_at', { ascending: true });
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function listContractAccrualsForUserBetween(userId, startYmd, endYmd) {
  const { data, error } = await supabase
    .from('contract_accruals')
    .select('*')
    .eq('user_id', userId)
    .gte('accrual_date', startYmd)
    .lte('accrual_date', endYmd)
    .order('accrual_date', { ascending: true });
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

async function listContractAccrualsForUserOnDate(userId, dateYmd) {
  const { data, error } = await supabase
    .from('contract_accruals')
    .select('*')
    .eq('user_id', userId)
    .eq('accrual_date', dateYmd)
    .order('created_at', { ascending: true });
  if (error && isSchemaError(error)) return [];
  if (error) throw error;
  return data || [];
}

module.exports = {
  utcTodayYmd,
  getUserByEmail,
  getUserById,
  updateUserPasswordHash,
  replacePasswordResetCode,
  consumePasswordResetCode,
  createUser,
  updateAlpacaKeys,
  updateUserTotpSecretEnc,
  setTotpEnabled,
  clearTotp,
  getWalletByUserId,
  ensureWalletForUser,
  setWalletBalance,
  ensureUserTransferCode,
  lookupPeerTransferRecipient,
  rpcWalletPeerTransfer,
  createTransaction,
  getTransactionById,
  updateTransaction,
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
  isSchemaError,
  getAirfarmingStateByUserId,
  upsertAirfarmingState,
  updateAirfarmingAutoFundSetting,
  ensureAirfarmingStateRow,
  updateAirfarmingDropsPaused,
  updateAirfarmingUserDropPause,
  getActiveGlobalDropPauses,
  listGlobalDropPauses,
  insertGlobalDropPause,
  endGlobalDropPauseEarly,
  listUsersAdmin,
  getAdminUserDetail,
  getAdminUserChartSeries,
  getAirfarmingDropsPausedByUserIds,
  insertAirfarmingEvent,
  listAirfarmingEventsByUserId,
  getScheduledAirfarmingDrop,
  listScheduledAirfarmingDropsForUser,
  getMaxAirfarmingDropIndex,
  getLastAirfarmingDropForWeek,
  insertAirfarmingDrop,
  updateAirfarmingDrop,
  getAirfarmingDropById,
  listScheduledAirfarmingDropsAdmin,
  getUsersByIds,
  listAirfarmingDropsByUserId,
  listAirfarmingDropsForWeek,
  listAirfarmingDropBands,
  listAirfarmingDropBandsAdmin,
  updateAirfarmingDropBand,
  getAirfarmingDropBandByIndex,
  getAirfarmingPlatformSettings,
  updateAirfarmingPlatformSettings,
  getAirfarmingWalletByUserId,
  upsertAirfarmingWalletRow,
  insertAirfarmingTransfer,
  getContractWalletByUserId,
  upsertContractWalletRow,
  getContractAccrualForUserDay,
  insertContractAccrual,
  listContractWalletsWithPositiveBalance,
  getExpertTradingWalletByUserId,
  upsertExpertTradingWalletRow,
  insertExpertTradingTransfer,
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
  getNowpaymentsPayoutById,
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
  getActiveAppAnnouncement,
  listAppAnnouncementsAdmin,
  publishAppAnnouncement,
  clearActiveAppAnnouncement,
  insertSupportTicket,
  listSupportTicketsByUserId,
  getSupportTicketForUser,
  getSupportTicketById,
  listSupportTicketsAdmin,
  updateSupportTicketStatus,
  adminMoveCashToAirfarming,
  adminAdjustUserWallet,
  getNotificationPreferencesByUserId,
  upsertNotificationPreferences,
  insertLocalMoneyOrder,
  updateLocalMoneyOrder,
  getLocalMoneyOrderById,
  getLocalMoneyOrderForUser,
  listPendingWithdrawalsAdmin,
  getUserWithdrawalDepositStats,
  planRowToApi,
  allocationRowToApi,
  getAiDailyPlanByDate,
  getAiDailyPlanById,
  upsertAiDailyPlan,
  updateAiDailyPlan,
  clearAiAllocationsForPlan,
  upsertAiUserAllocation,
  listAiAllocationsByPlan,
  getAiAllocationForUserPlan,
  getActiveAiAllocationForUserToday,
  incrementAiDailyBudgetSpent,
  recalcPlanProjectedTotals,
  listUsersForAiPlannerBatch,
  countUsersForAiPlanner,
  listAiDailyPlansAdmin,
  listAirfarmingDropsForUserIdsWeek,
  listAirfarmingWalletsByUserIds,
  listAirfarmingStatesByUserIds,
  getLocalMoneyOrderByReference,
  getLocalMoneyOrderByChargeId,
  listLocalMoneyOrdersByUserId,
  listPendingLocalMoneyWithdrawalsByUserId,
  VIP_DAILY_RATE,
  VIP_LOCK_DAYS,
  VIP_MIN_INVEST_USD,
  VIP_EARLY_PENALTY_RATE,
  vipInvestmentToApi,
  getActiveVipInvestmentForUser,
  getVipInvestmentById,
  createVipInvestment,
  updateVipInvestment,
  listActiveVipInvestments,
  getVipAccrualForInvestmentDay,
  insertVipAccrual,
  listVipAccrualsForUserBetween,
  listVipAccrualsForUserOnDate,
  listPaidAirfarmingDropsForUserBetween,
  listContractAccrualsForUserBetween,
  listContractAccrualsForUserOnDate,
  userDropScheduleRowToApi,
  getUserDropSchedule,
  upsertUserDropSchedule,
  deleteScheduledAirfarmingDropsForUserWeek,
};
