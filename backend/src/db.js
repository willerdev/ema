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
    if (patch.indefinitePause !== undefined) row.drops_paused = Boolean(patch.indefinitePause);
    if (patch.pauseFrom !== undefined) row.drops_pause_from = patch.pauseFrom;
    if (patch.pauseUntil !== undefined) row.drops_pause_until = patch.pauseUntil;
    if (patch.bandIndexes !== undefined) {
      row.drops_pause_band_indexes = normalizeBandIndexes(patch.bandIndexes);
    }
    if (patch.pauseFrom || patch.pauseUntil) row.drops_paused = false;
  }

  const { data, error } = await supabase
    .from('airfarming_state')
    .update(row)
    .eq('user_id', userId)
    .select('*')
    .single();
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
    if (stateRes.error && isSchemaError(stateRes.error)) {
      stateRes = await supabase
        .from('airfarming_state')
        .select('user_id, drops_paused, auto_fund_enabled, week_start')
        .in('user_id', ids);
    }
    if (!stateRes.error) {
      for (const s of stateRes.data || []) stateByUser.set(s.user_id, s);
    } else if (!isSchemaError(stateRes.error)) throw stateRes.error;
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
      dropsPaused: pause.dropsPausedNow,
      dropsPauseUntil: pause.dropsPauseUntil,
      autoFundEnabled: Boolean(st?.auto_fund_enabled),
      airfarmingWeekStart: st?.week_start || null,
    };
  });
}

async function getAdminUserDetail(userId) {
  const user = await getUserById(userId);
  if (!user) return null;

  const [wallet, afWallet, state, transactions, scheduledDrops] = await Promise.all([
    getWalletByUserId(userId),
    getAirfarmingWalletByUserId(userId),
    getAirfarmingStateByUserId(userId),
    getTransactionsByUserId(userId),
    supabase
      .from('airfarming_drops')
      .select('id, drop_index, due_at, percent, min_balance, max_balance, status')
      .eq('user_id', userId)
      .eq('status', 'scheduled')
      .order('due_at', { ascending: true })
      .limit(10),
  ]);

  if (scheduledDrops.error && !isSchemaError(scheduledDrops.error)) throw scheduledDrops.error;

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
  const { data, error } = await supabase
    .from('airfarming_drops')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .eq('status', 'scheduled')
    .order('due_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
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
  getAirfarmingDropsPausedByUserIds,
  insertAirfarmingEvent,
  listAirfarmingEventsByUserId,
  getScheduledAirfarmingDrop,
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
  getAirfarmingDropBandByIndex,
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
  insertSupportTicket,
  listSupportTicketsByUserId,
  getSupportTicketForUser,
  getSupportTicketById,
  listSupportTicketsAdmin,
  updateSupportTicketStatus,
  adminMoveCashToAirfarming,
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
