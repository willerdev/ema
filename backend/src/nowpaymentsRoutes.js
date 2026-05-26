const crypto = require('crypto');
const {
  insertNowpaymentsPayment,
  getNowpaymentsPaymentForUser,
  getNowpaymentsPaymentByOrderId,
  getNowpaymentsPaymentByNpId,
  updateNowpaymentsPayment,
  listNowpaymentsPaymentsByUserId,
  insertNowpaymentsPayout,
  getNowpaymentsPayoutForUser,
  getNowpaymentsPayoutByUniqueId,
  getNowpaymentsPayoutByNpId,
  updateNowpaymentsPayout,
  listNowpaymentsPayoutsByUserId,
  insertCryptoLedgerEntry,
  getCryptoLedgerEntryBySource,
  listCryptoLedgerEntriesByUserId,
  getCryptoBalancesByUserId,
  getUserById,
  isMissingTableError,
  isAddressWhitelistedForUser,
} = require('./db');
const np = require('./services/nowpaymentsClient');
const { requireComplianceProfile } = require('./middleware/requireComplianceProfile');
const { verifyUserTotp } = require('./totpVerify');
const { buildWalletActivity, mapPublicActivity } = require('./walletActivity');
const {
  notifyDepositCredited,
  notifyWithdrawalOutcome,
  payoutOutcomeAlreadyNotified,
} = require('./depositNotifications');
const { getCombinedWithdrawable, getCashWalletUsd } = require('./walletFunding');
const { createPayoutAwaitingApproval } = require('./nowpaymentsPayoutFlow');
const { clearWithdrawalTrustScoreCache } = require('./services/withdrawalTrustScore');

const FINISHED_PAYMENT_STATUS = 'finished';
const FAILED_PAYOUT_STATUSES = ['failed', 'rejected', 'refunded'];
const TERMINAL_FAILED_PAYMENT_STATUSES = ['failed', 'expired', 'refunded'];

const { normalizeCurrency } = require('./currencyNormalize');

function newId() {
  return crypto.randomUUID();
}

function webhookBaseUrl() {
  return (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
}

function paymentIpnUrl() {
  const base = webhookBaseUrl();
  return base ? `${base}/webhooks/nowpayments/payment` : '';
}

function payoutIpnUrl() {
  const base = webhookBaseUrl();
  return base ? `${base}/webhooks/nowpayments/payout` : '';
}

/** NOWPayments allows max 6 decimal places on payout amounts. */
function roundPayoutAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n * 1e6) / 1e6;
}

function resolveClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return first;
  }
  const realIp = req.headers['x-real-ip'];
  if (realIp) return String(realIp).trim();
  const sock = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (sock) return String(sock).replace(/^::ffff:/, '');
  return null;
}

function sortObjectKeys(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  return Object.keys(obj)
    .sort()
    .reduce((acc, key) => {
      acc[key] = sortObjectKeys(obj[key]);
      return acc;
    }, {});
}

function verifyNowpaymentsIpn(req) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret) return true;
  const sig = req.headers['x-nowpayments-sig'];
  if (!sig || !req.rawBody) return false;
  let body;
  try {
    body = JSON.parse(req.rawBody.toString('utf8'));
  } catch {
    return false;
  }
  const sorted = JSON.stringify(sortObjectKeys(body));
  const expected = crypto.createHmac('sha512', secret).update(sorted).digest('hex');
  try {
    const a = Buffer.from(String(sig).toLowerCase(), 'hex');
    const b = Buffer.from(expected.toLowerCase(), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return String(sig).toLowerCase() === expected.toLowerCase();
  }
}

/** Credit user wallet in the crypto they paid with, not the merchant outcome-wallet currency. */
function depositCreditAmountAndAsset(paymentRow) {
  const asset = normalizeCurrency(paymentRow.pay_currency);
  if (!asset) return { asset: null, amount: null };
  const paid = Number(paymentRow.actually_paid);
  const expected = Number(paymentRow.pay_amount);
  let amount = null;
  if (Number.isFinite(paid) && paid > 0) amount = paid;
  else if (Number.isFinite(expected) && expected > 0) amount = expected;
  return { asset, amount };
}

function isPaymentFinished(status) {
  return String(status || '').toLowerCase() === FINISHED_PAYMENT_STATUS;
}

async function creditPaymentLedger(paymentRow) {
  if (paymentRow.ledger_credited) return paymentRow;
  const { asset, amount } = depositCreditAmountAndAsset(paymentRow);
  if (!asset || !Number.isFinite(amount) || amount <= 0) {
    console.warn('NOWPayments deposit not credited: missing pay amount', {
      paymentId: paymentRow.payment_id,
      orderId: paymentRow.order_id,
      status: paymentRow.payment_status,
      payCurrency: paymentRow.pay_currency,
      actuallyPaid: paymentRow.actually_paid,
    });
    return paymentRow;
  }

  const existing = await getCryptoLedgerEntryBySource('payment', paymentRow.id, 'in');
  if (existing) {
    return updateNowpaymentsPayment(paymentRow.id, { ledger_credited: true });
  }

  await insertCryptoLedgerEntry({
    id: newId(),
    user_id: paymentRow.user_id,
    asset,
    direction: 'in',
    amount,
    source: 'payment',
    source_id: paymentRow.id,
  });
  const updated = await updateNowpaymentsPayment(paymentRow.id, { ledger_credited: true });
  void notifyDepositCredited({
    userId: paymentRow.user_id,
    amount,
    asset,
  });
  return updated;
}

async function syncPaymentFromProvider(row) {
  if (!np.configured() || !row?.payment_id) return row;
  let remote;
  try {
    remote = await np.getPayment(row.payment_id);
  } catch (e) {
    console.warn('NOWPayments getPayment failed', row.payment_id, e.message);
    return row;
  }
  const status = remote.payment_status || remote.status || row.payment_status;
  let updated = await updateNowpaymentsPayment(row.id, {
    payment_status: status,
    actually_paid: remote.actually_paid != null ? String(remote.actually_paid) : row.actually_paid,
    pay_amount: remote.pay_amount != null ? String(remote.pay_amount) : row.pay_amount,
    pay_currency: remote.pay_currency ? normalizeCurrency(remote.pay_currency) : row.pay_currency,
    outcome_amount: remote.outcome_amount != null ? String(remote.outcome_amount) : row.outcome_amount,
    outcome_currency: remote.outcome_currency != null ? String(remote.outcome_currency) : row.outcome_currency,
    raw_last_ipn: remote,
  });
  if (isPaymentFinished(status) && !updated.ledger_credited) {
    updated = await creditPaymentLedger(updated);
  }
  return updated;
}

async function syncUncreditedPaymentsForUser(userId, limit = 15) {
  const payments = await listNowpaymentsPaymentsByUserId(userId, limit);
  for (const p of payments) {
    if (p.ledger_credited || !p.payment_id) continue;
    const st = String(p.payment_status || '').toLowerCase();
    if (TERMINAL_FAILED_PAYMENT_STATUSES.includes(st)) continue;
    await syncPaymentFromProvider(p);
  }
}

const TERMINAL_PAYOUT_STATUSES = ['finished', ...FAILED_PAYOUT_STATUSES];

/** User-facing payout status (no provider verification / admin steps exposed). */
function publicPayoutStatus(internal) {
  const s = String(internal || '').toLowerCase();
  if (s === 'finished') return 'finished';
  if (FAILED_PAYOUT_STATUSES.includes(s)) return 'failed';
  if (s === 'awaiting_approval') return 'pending';
  return 'in_progress';
}

function normalizeStoredPayoutStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'finished') return 'finished';
  if (FAILED_PAYOUT_STATUSES.includes(s)) return s;
  return 'in_progress';
}

async function syncPayoutFromProvider(row) {
  if (!np.configured() || !row?.payout_id) return row;
  try {
    const remote = await np.getPayout(row.payout_id);
    const status = remote.status || remote.payment_status || row.status;
    await applyPayoutStatusToRow(row, status, remote);
    return (await getNowpaymentsPayoutForUser(row.user_id, row.id)) || row;
  } catch (e) {
    console.warn('NOWPayments getPayout failed', row.payout_id, e.message);
    return row;
  }
}

async function syncPendingPayoutsForUser(userId, limit = 20) {
  const payouts = await listNowpaymentsPayoutsByUserId(userId, limit);
  for (const p of payouts) {
    const st = String(p.status || '').toLowerCase();
    if (TERMINAL_PAYOUT_STATUSES.includes(st) || !p.payout_id) continue;
    await syncPayoutFromProvider(p);
  }
}

async function finalizePayoutLedger(payoutRow) {
  const existing = await getCryptoLedgerEntryBySource('payout', payoutRow.id, 'out');
  if (existing) return;
  const asset = normalizeCurrency(payoutRow.currency);
  const amount = Number(payoutRow.amount);
  if (!asset || !Number.isFinite(amount) || amount <= 0) return;

  await insertCryptoLedgerEntry({
    id: newId(),
    user_id: payoutRow.user_id,
    asset,
    direction: 'out',
    amount,
    source: 'payout',
    source_id: payoutRow.id,
  });
}

async function getAvailableForAsset(userId, asset) {
  const balances = await getCryptoBalancesByUserId(userId);
  const row = balances.find((b) => b.asset === asset);
  return row ? Number(row.available) : 0;
}

async function applyPaymentIpn(body) {
  const paymentId = body.payment_id != null ? String(body.payment_id) : null;
  const orderId = body.order_id != null ? String(body.order_id) : null;
  let row = null;
  if (paymentId) row = await getNowpaymentsPaymentByNpId(paymentId);
  if (!row && orderId) row = await getNowpaymentsPaymentByOrderId(orderId);
  if (!row) return { ok: true, recorded: false };

  const status = body.payment_status || body.status || row.payment_status;
  const patch = {
    payment_status: status,
    actually_paid: body.actually_paid != null ? String(body.actually_paid) : row.actually_paid,
    pay_amount: body.pay_amount != null ? String(body.pay_amount) : row.pay_amount,
    outcome_amount: body.outcome_amount != null ? String(body.outcome_amount) : row.outcome_amount,
    outcome_currency: body.outcome_currency != null ? String(body.outcome_currency) : row.outcome_currency,
    raw_last_ipn: body,
  };
  if (body.pay_currency) patch.pay_currency = normalizeCurrency(body.pay_currency);
  if (paymentId && !row.payment_id) patch.payment_id = paymentId;

  let updated = await updateNowpaymentsPayment(row.id, patch);
  if (isPaymentFinished(status) && !updated.ledger_credited) {
    updated = await creditPaymentLedger(updated);
  }
  return { ok: true, recorded: true };
}

async function applyPayoutIpn(body) {
  const withdrawals = body.withdrawals;
  if (Array.isArray(withdrawals) && withdrawals.length) {
    let any = false;
    for (const w of withdrawals) {
      const extId = w.unique_external_id || w.id;
      if (!extId) continue;
      const row = await getNowpaymentsPayoutByUniqueId(String(extId));
      if (!row) continue;
      any = true;
      await applyPayoutStatusToRow(row, w.status || body.status, body);
    }
    return { ok: true, recorded: any };
  }

  const payoutId = body.payout_id != null ? String(body.payout_id) : body.id != null ? String(body.id) : null;
  const extId = body.unique_external_id != null ? String(body.unique_external_id) : null;
  let row = null;
  if (extId) row = await getNowpaymentsPayoutByUniqueId(extId);
  if (!row && payoutId) row = await getNowpaymentsPayoutByNpId(payoutId);
  if (!row) return { ok: true, recorded: false };

  await applyPayoutStatusToRow(row, body.status, body);
  return { ok: true, recorded: true };
}

async function applyPayoutStatusToRow(row, status, rawBody) {
  const st = normalizeStoredPayoutStatus(status || row.status);
  const patch = { status: st, raw_last_ipn: rawBody };
  if (rawBody.payout_id) patch.payout_id = String(rawBody.payout_id);
  const updated = await updateNowpaymentsPayout(row.id, patch);

  if (st === 'finished') {
    await finalizePayoutLedger(updated);
    if (!updated.reserve_released) {
      await updateNowpaymentsPayout(updated.id, { reserve_released: true });
    }
  } else if (FAILED_PAYOUT_STATUSES.includes(st) && !updated.reserve_released) {
    await refundCashFundingForPayout(updated);
    await updateNowpaymentsPayout(updated.id, { reserve_released: true, status: st });
  }
}

async function handlePaymentWebhook(req, res) {
  try {
    if (!verifyNowpaymentsIpn(req)) {
      console.warn('NOWPayments payment IPN rejected: invalid signature (check NOWPAYMENTS_IPN_SECRET)');
      return res.status(401).json({ message: 'Invalid IPN signature' });
    }
    const result = await applyPaymentIpn(req.body || {});
    return res.status(200).json(result);
  } catch (e) {
    console.error('NOWPayments payment IPN error', e);
    return res.status(500).json({ message: 'IPN handler failed' });
  }
}

async function handlePayoutWebhook(req, res) {
  try {
    if (!verifyNowpaymentsIpn(req)) {
      return res.status(401).json({ message: 'Invalid IPN signature' });
    }
    const result = await applyPayoutIpn(req.body || {});
    return res.status(200).json(result);
  } catch (e) {
    console.error('NOWPayments payout IPN error', e);
    return res.status(500).json({ message: 'IPN handler failed' });
  }
}

function registerNowpaymentsRoutes(app, { authMiddleware }) {
  const notConfiguredMessage =
    'NOWPayments is not configured. Set NOWPAYMENTS_API_KEY and NOWPAYMENTS_IPN_SECRET on the server.';
  const schemaErrorMessage =
    'NOWPayments DB schema missing. Run backend/sql/migrations/20260515_nowpayments_wallet.sql in Supabase.';

  app.get('/nowpayments/client-ip', authMiddleware, (req, res) => {
    const ip = resolveClientIp(req);
    return res.json({ ip: ip || 'unknown' });
  });

  app.get('/nowpayments/currencies', authMiddleware, async (req, res) => {
    try {
      if (!np.configured()) return res.status(503).json({ message: notConfiguredMessage });
      const data = await np.getCurrencies();
      const list = Array.isArray(data?.currencies) ? data.currencies : Array.isArray(data) ? data : [];
      return res.json({ currencies: list });
    } catch (e) {
      return res.status(e.status || 500).json({ message: e.message || 'Failed to load currencies' });
    }
  });

  app.get('/nowpayments/summary', authMiddleware, async (req, res) => {
    try {
      if (np.configured()) {
        await syncUncreditedPaymentsForUser(req.userId);
        await syncPendingPayoutsForUser(req.userId);
      }
      const balances = await getCryptoBalancesByUserId(req.userId);
      const cashWalletUsd = await getCashWalletUsd(req.userId);
      const usdtFunding = await getCombinedWithdrawable(req.userId, 'usdttrc20');
      const payments = await listNowpaymentsPaymentsByUserId(req.userId, 20);
      const payouts = await listNowpaymentsPayoutsByUserId(req.userId, 20);
      const ledger = await listCryptoLedgerEntriesByUserId(req.userId, 40);
      const payoutsForActivity = payouts.map((p) => ({ ...p, status: publicPayoutStatus(p.status) }));
      const activity = buildWalletActivity({ ledger, payments, payouts: payoutsForActivity });
      return res.json({
        balances,
        cashWalletUsd,
        maxWithdrawableUsdt: usdtFunding.maxWithdrawable,
        cashFundsCryptoWithdrawals: true,
        activity: activity.map(mapPublicActivity),
        payments: payments.map((p) => ({
          id: p.id,
          paymentId: p.payment_id,
          orderId: p.order_id,
          status: p.payment_status,
          payCurrency: p.pay_currency,
          payAmount: p.pay_amount,
          payAddress: p.pay_address,
          priceAmount: p.price_amount,
          priceCurrency: p.price_currency,
          ledgerCredited: p.ledger_credited,
          createdAt: p.created_at,
        })),
        payouts: payouts.map((p) => ({
          id: p.id,
          payoutId: p.payout_id,
          batchPayoutId: p.batch_payout_id,
          status: publicPayoutStatus(p.status),
          currency: p.currency,
          address: p.address,
          amount: p.amount,
          createdAt: p.created_at,
        })),
        ledger: ledger.map((e) => ({
          id: e.id,
          asset: e.asset,
          direction: e.direction,
          amount: e.amount,
          source: e.source,
          sourceId: e.source_id,
          createdAt: e.created_at,
        })),
        configured: np.configured(),
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaErrorMessage });
      return res.status(500).json({ message: e.message || 'Failed to load summary' });
    }
  });

  app.post('/nowpayments/deposits', authMiddleware, async (req, res) => {
    try {
      if (!np.configured()) return res.status(503).json({ message: notConfiguredMessage });

      const priceAmount = Number(req.body.priceAmount);
      const priceCurrency = String(req.body.priceCurrency || 'usd').toLowerCase();
      const payCurrency = normalizeCurrency(req.body.payCurrency);
      if (!priceAmount || priceAmount <= 0) return res.status(400).json({ message: 'Invalid priceAmount' });
      if (!payCurrency) return res.status(400).json({ message: 'payCurrency is required' });

      const orderId = `ema-${req.userId}-${newId()}`;
      const ipnUrl = paymentIpnUrl();
      if (!ipnUrl) {
        console.warn('NOWPayments: APP_BASE_URL not set — deposit IPN callbacks will not be sent on create');
      }
      const npBody = {
        price_amount: priceAmount,
        price_currency: priceCurrency,
        pay_currency: payCurrency,
        order_id: orderId,
        order_description: 'Wallet deposit',
      };
      if (ipnUrl) npBody.ipn_callback_url = ipnUrl;

      const created = await np.createPayment(npBody);
      const row = await insertNowpaymentsPayment({
        id: newId(),
        user_id: req.userId,
        payment_id: created.payment_id != null ? String(created.payment_id) : null,
        order_id: orderId,
        price_amount: priceAmount,
        price_currency: priceCurrency,
        pay_currency: payCurrency,
        pay_amount: created.pay_amount != null ? String(created.pay_amount) : null,
        pay_address: created.pay_address || null,
        payment_status: created.payment_status || 'waiting',
        actually_paid: created.actually_paid != null ? String(created.actually_paid) : null,
        outcome_amount: created.outcome_amount != null ? String(created.outcome_amount) : null,
        outcome_currency: created.outcome_currency != null ? String(created.outcome_currency) : null,
        ledger_credited: false,
        raw_last_ipn: created,
      });

      return res.json({
        id: row.id,
        paymentId: row.payment_id,
        orderId: row.order_id,
        payAddress: row.pay_address,
        payAmount: row.pay_amount,
        payCurrency: row.pay_currency,
        priceAmount: row.price_amount,
        priceCurrency: row.price_currency,
        status: row.payment_status,
        expirationEstimateDate: created.expiration_estimate_date || null,
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaErrorMessage });
      return res.status(e.status || 500).json({ message: e.message || 'Failed to create deposit' });
    }
  });

  app.get('/nowpayments/deposits/:id', authMiddleware, async (req, res) => {
    try {
      const row = await getNowpaymentsPaymentForUser(req.userId, req.params.id);
      if (!row) return res.status(404).json({ message: 'Deposit not found' });

      if (np.configured() && row.payment_id) {
        try {
          const updated = await syncPaymentFromProvider(row);
          return res.json({
            id: updated.id,
            paymentId: updated.payment_id,
            status: updated.payment_status,
            payAddress: updated.pay_address,
            payAmount: updated.pay_amount,
            payCurrency: updated.pay_currency,
            ledgerCredited: updated.ledger_credited,
          });
        } catch {
          // return cached row
        }
      }

      if (isPaymentFinished(row.payment_status) && !row.ledger_credited) {
        const credited = await creditPaymentLedger(row);
        return res.json({
          id: credited.id,
          paymentId: credited.payment_id,
          status: credited.payment_status,
          payAddress: credited.pay_address,
          payAmount: credited.pay_amount,
          payCurrency: credited.pay_currency,
          ledgerCredited: credited.ledger_credited,
        });
      }

      return res.json({
        id: row.id,
        paymentId: row.payment_id,
        status: row.payment_status,
        payAddress: row.pay_address,
        payAmount: row.pay_amount,
        payCurrency: row.pay_currency,
        ledgerCredited: row.ledger_credited,
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaErrorMessage });
      return res.status(500).json({ message: e.message || 'Failed to load deposit' });
    }
  });

  app.post('/nowpayments/withdrawals', authMiddleware, requireComplianceProfile, async (req, res) => {
    try {
      if (!np.configured()) return res.status(503).json({ message: notConfiguredMessage });
      if (!np.payoutAuthConfigured()) {
        return res.status(503).json({
          message: 'Withdrawals are not fully enabled on the server yet. Please try again later.',
          code: 'PAYOUT_NOT_CONFIGURED',
        });
      }

      const totp = await verifyUserTotp(req.userId, req.body.totpCode);
      if (!totp.ok) return res.status(totp.status).json({ message: totp.message });

      const currency = normalizeCurrency(req.body.currency);
      const address = String(req.body.address || '').trim();
      const amountRaw = Number(req.body.amount);
      const amount = roundPayoutAmount(amountRaw);
      if (!currency) return res.status(400).json({ message: 'currency is required' });
      if (!address) return res.status(400).json({ message: 'address is required' });
      if (!amount) return res.status(400).json({ message: 'Invalid amount' });

      const whitelisted = await isAddressWhitelistedForUser(req.userId, currency, address);
      if (!whitelisted) {
        return res.status(400).json({
          message: 'Withdrawal address must be one of your whitelisted wallets in Settings.',
          code: 'WALLET_NOT_WHITELISTED',
        });
      }

      const fundingPreview = await getCombinedWithdrawable(req.userId, currency);
      if (amount > fundingPreview.maxWithdrawable) {
        return res.status(400).json({
          message: `Insufficient balance. Maximum withdrawable (after fee reserve): ${fundingPreview.maxWithdrawable.toFixed(6)}.`,
          available: fundingPreview.combinedAvailable,
          maxWithdrawable: fundingPreview.maxWithdrawable,
          cryptoAvailable: fundingPreview.cryptoAvailable,
          cashWalletUsd: fundingPreview.cashWalletUsd,
          requested: amount,
        });
      }

      let payoutRow;
      try {
        payoutRow = await createPayoutAwaitingApproval({
          userId: req.userId,
          currency,
          address,
          amount,
        });
      } catch (e) {
        if (e.details) {
          return res.status(400).json({
            message: e.message || 'Insufficient balance after funding',
            ...e.details,
          });
        }
        throw e;
      }

      clearWithdrawalTrustScoreCache(req.userId);

      return res.json({
        id: payoutRow.id,
        payoutId: null,
        batchPayoutId: null,
        status: publicPayoutStatus(payoutRow.status),
        currency: payoutRow.currency,
        address: payoutRow.address,
        amount: payoutRow.amount,
        cashFunded: Number(payoutRow.cash_funded_amount || 0),
        message: 'Withdrawal submitted for approval. You will be notified when it is processed.',
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaErrorMessage });
      return res.status(e.status || 500).json({
        message: np.toPublicPayoutError(e),
        code: e.code || undefined,
      });
    }
  });

  app.post('/nowpayments/withdrawals/:id/verify', authMiddleware, async (req, res) => {
    try {
      if (!np.configured()) return res.status(503).json({ message: notConfiguredMessage });
      if (!np.payoutAuthConfigured()) {
        return res.status(503).json({
          message: 'Withdrawals are not fully enabled on the server yet. Please try again later.',
          code: 'PAYOUT_NOT_CONFIGURED',
        });
      }

      const row = await getNowpaymentsPayoutForUser(req.userId, req.params.id);
      if (!row) return res.status(404).json({ message: 'Withdrawal not found' });
      if (!row.payout_id) {
        return res.status(400).json({ message: 'Withdrawal is not ready to verify yet. Try again shortly.' });
      }

      const verificationCode = String(req.body.verificationCode || req.body.payoutVerificationCode || '')
        .replace(/\s/g, '');
      if (!verificationCode || verificationCode.length < 4) {
        return res.status(400).json({ message: 'Enter the verification code from your email.' });
      }

      let verifyRaw;
      try {
        verifyRaw = await np.verifyPayout(row.payout_id, verificationCode);
      } catch (verifyErr) {
        verifyErr.code = verifyErr.code || 'PAYOUT_VERIFY_FAILED';
        return res.status(verifyErr.status || 400).json({
          message: np.toPublicPayoutError(verifyErr),
          code: 'PAYOUT_VERIFY_FAILED',
          id: row.id,
          payoutId: row.payout_id,
          status: row.status,
        });
      }

      const status = normalizeStoredPayoutStatus(verifyRaw?.status || 'processing');
      const updated = await updateNowpaymentsPayout(row.id, {
        status,
        raw_last_ipn: { ...(row.raw_last_ipn || {}), verify: verifyRaw },
      });

      return res.json({
        id: updated.id,
        payoutId: updated.payout_id,
        status: publicPayoutStatus(updated.status),
        currency: updated.currency,
        address: updated.address,
        amount: updated.amount,
        verified: true,
        requiresVerification: false,
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaErrorMessage });
      return res.status(e.status || 500).json({
        message: np.toPublicPayoutError(e),
        code: e.code || undefined,
      });
    }
  });
}

module.exports = {
  registerNowpaymentsRoutes,
  handlePaymentWebhook,
  handlePayoutWebhook,
  normalizeCurrency,
};
