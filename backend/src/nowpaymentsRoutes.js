const crypto = require('crypto');
const {
  insertNowpaymentsPayment,
  getNowpaymentsPaymentForUser,
  getNowpaymentsPaymentByOrderId,
  getNowpaymentsPaymentByNpId,
  updateNowpaymentsPayment,
  listNowpaymentsPaymentsByUserId,
  insertNowpaymentsPayout,
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
const { decryptTotpSecret } = require('./totpCrypto');
const { verifySync } = require('otplib');
const { requireComplianceProfile } = require('./middleware/requireComplianceProfile');

const FINISHED_PAYMENT_STATUS = 'finished';
const FAILED_PAYOUT_STATUSES = ['failed', 'rejected', 'refunded'];

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

async function verifyUserTotp(userId, totpCode) {
  const user = await getUserById(userId);
  if (!user) return { ok: false, status: 404, message: 'User not found' };
  if (!user.totp_enabled) return { ok: true };
  const code = totpCode != null ? String(totpCode).replace(/\s/g, '') : '';
  if (!code || code.length < 6) {
    return { ok: false, status: 400, message: 'Authenticator code is required for withdrawal' };
  }
  if (!user.totp_secret_enc) {
    return { ok: false, status: 500, message: 'Server configuration error' };
  }
  let secret;
  try {
    secret = decryptTotpSecret(user.totp_secret_enc);
  } catch {
    return { ok: false, status: 500, message: 'Server configuration error' };
  }
  const totpResult = verifySync({ secret, token: code, epochTolerance: 1 });
  if (!totpResult.valid) {
    return { ok: false, status: 401, message: 'Invalid authenticator code' };
  }
  return { ok: true };
}

async function creditPaymentLedger(paymentRow) {
  if (paymentRow.ledger_credited) return;
  const asset = normalizeCurrency(paymentRow.outcome_currency || paymentRow.pay_currency);
  const amountRaw =
    paymentRow.outcome_amount || paymentRow.actually_paid || paymentRow.pay_amount || paymentRow.price_amount;
  const amount = Number(amountRaw);
  if (!asset || !Number.isFinite(amount) || amount <= 0) return;

  const existing = await getCryptoLedgerEntryBySource('payment', paymentRow.id, 'in');
  if (existing) {
    await updateNowpaymentsPayment(paymentRow.id, { ledger_credited: true });
    return;
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
  await updateNowpaymentsPayment(paymentRow.id, { ledger_credited: true });
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
    outcome_amount: body.outcome_amount != null ? String(body.outcome_amount) : row.outcome_amount,
    outcome_currency: body.outcome_currency != null ? String(body.outcome_currency) : row.outcome_currency,
    raw_last_ipn: body,
  };
  if (paymentId && !row.payment_id) patch.payment_id = paymentId;

  const updated = await updateNowpaymentsPayment(row.id, patch);
  if (String(status).toLowerCase() === FINISHED_PAYMENT_STATUS) {
    await creditPaymentLedger(updated);
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
  const st = String(status || row.status).toLowerCase();
  const patch = { status: st, raw_last_ipn: rawBody };
  if (rawBody.payout_id) patch.payout_id = String(rawBody.payout_id);
  const updated = await updateNowpaymentsPayout(row.id, patch);

  if (st === 'finished') {
    await finalizePayoutLedger(updated);
    if (!updated.reserve_released) {
      await updateNowpaymentsPayout(updated.id, { reserve_released: true });
    }
  } else if (FAILED_PAYOUT_STATUSES.includes(st) && !updated.reserve_released) {
    await updateNowpaymentsPayout(updated.id, { reserve_released: true, status: st });
  }
}

async function handlePaymentWebhook(req, res) {
  try {
    if (!verifyNowpaymentsIpn(req)) {
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
      const balances = await getCryptoBalancesByUserId(req.userId);
      const payments = await listNowpaymentsPaymentsByUserId(req.userId, 20);
      const payouts = await listNowpaymentsPayoutsByUserId(req.userId, 20);
      const ledger = await listCryptoLedgerEntriesByUserId(req.userId, 40);
      return res.json({
        balances,
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
          createdAt: p.created_at,
        })),
        payouts: payouts.map((p) => ({
          id: p.id,
          payoutId: p.payout_id,
          status: p.status,
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
      const npBody = {
        price_amount: priceAmount,
        price_currency: priceCurrency,
        pay_currency: payCurrency,
        order_id: orderId,
        order_description: `Ema deposit ${orderId}`,
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
          const remote = await np.getPayment(row.payment_id);
          const status = remote.payment_status || remote.status;
          if (status && status !== row.payment_status) {
            const updated = await updateNowpaymentsPayment(row.id, {
              payment_status: status,
              actually_paid: remote.actually_paid != null ? String(remote.actually_paid) : row.actually_paid,
              outcome_amount: remote.outcome_amount != null ? String(remote.outcome_amount) : row.outcome_amount,
              outcome_currency: remote.outcome_currency != null ? String(remote.outcome_currency) : row.outcome_currency,
              raw_last_ipn: remote,
            });
            if (String(status).toLowerCase() === FINISHED_PAYMENT_STATUS) {
              await creditPaymentLedger(updated);
            }
            return res.json({
              id: updated.id,
              paymentId: updated.payment_id,
              status: updated.payment_status,
              payAddress: updated.pay_address,
              payAmount: updated.pay_amount,
              payCurrency: updated.pay_currency,
              ledgerCredited: updated.ledger_credited,
            });
          }
        } catch {
          // return cached row
        }
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
      const amount = Number(req.body.amount);
      if (!currency) return res.status(400).json({ message: 'currency is required' });
      if (!address) return res.status(400).json({ message: 'address is required' });
      if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

      const whitelisted = await isAddressWhitelistedForUser(req.userId, currency, address);
      if (!whitelisted) {
        return res.status(400).json({
          message: 'Withdrawal address must be one of your whitelisted wallets in Settings.',
          code: 'WALLET_NOT_WHITELISTED',
        });
      }

      const available = await getAvailableForAsset(req.userId, currency);
      if (available < amount) {
        return res.status(400).json({ message: 'Insufficient crypto balance', available, requested: amount });
      }

      const uniqueExternalId = `ema-payout-${newId()}`;
      const payoutRow = await insertNowpaymentsPayout({
        id: newId(),
        user_id: req.userId,
        payout_id: null,
        unique_external_id: uniqueExternalId,
        currency,
        address,
        amount,
        status: 'pending',
        reserve_released: false,
        raw_last_ipn: null,
      });

      const ipnUrl = payoutIpnUrl();
      const npBody = {
        payout_description: `Ema withdrawal ${uniqueExternalId}`,
        withdrawals: [
          {
            unique_external_id: uniqueExternalId,
            address,
            currency,
            amount,
          },
        ],
      };
      if (ipnUrl) npBody.ipn_callback_url = ipnUrl;

      let npResult;
      try {
        npResult = await np.createPayout(npBody);
      } catch (e) {
        await updateNowpaymentsPayout(payoutRow.id, {
          status: 'failed',
          reserve_released: true,
          raw_last_ipn: { error: e.message },
        });
        throw e;
      }

      const payoutId =
        npResult.payout_id != null
          ? String(npResult.payout_id)
          : npResult.id != null
            ? String(npResult.id)
            : null;

      const updated = await updateNowpaymentsPayout(payoutRow.id, {
        payout_id: payoutId,
        status: npResult.status || 'processing',
        raw_last_ipn: npResult,
      });

      return res.json({
        id: updated.id,
        payoutId: updated.payout_id,
        status: updated.status,
        currency: updated.currency,
        address: updated.address,
        amount: updated.amount,
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
