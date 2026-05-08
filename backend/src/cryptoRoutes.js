const crypto = require('crypto');
const { ethers } = require('ethers');
const {
  upsertTatumCryptoProfile,
  listTatumVirtualAccountsByUserId,
  insertTatumVirtualAccount,
  getTatumVirtualAccountByUserAndCurrency,
  findUserIdByDepositAddress,
  insertTatumOnchainTx,
  listTatumOnchainTxsByUserId,
} = require('./db');
const tatum = require('./services/tatumClient');

const CHAIN = 'ETHEREUM';

function cryptoConfigured() {
  try {
    tatum.getApiKey();
    tatum.getMasterXpub();
    tatum.getMasterMnemonic();
    return true;
  } catch {
    return false;
  }
}

function webhookBaseUrl() {
  return (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
}

function webhookUrl() {
  const base = webhookBaseUrl();
  return base ? `${base}/crypto/webhooks/tatum` : '';
}

function verifyTatumWebhook(req) {
  const secret = process.env.TATUM_WEBHOOK_HMAC_SECRET;
  if (!secret) return true;
  const received = req.headers['x-payload-hash'];
  if (!received || !req.rawBody) return false;
  const expected = crypto.createHmac('sha512', secret).update(req.rawBody).digest('base64');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(String(received));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function newId() {
  return crypto.randomUUID();
}

async function ensureSubscriptionsForAddress(address) {
  const url = webhookUrl();
  if (!url) return;
  try {
    await tatum.incomingNativeSubscription({ address, webhookUrl: url });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('Tatum native subscription:', e.message);
  }
  try {
    await tatum.incomingFungibleSubscription({ address, webhookUrl: url });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('Tatum fungible subscription:', e.message);
  }
}

async function provisionUserCryptoAccounts(userId) {
  let ethRow = await getTatumVirtualAccountByUserAndCurrency(userId, 'ETH');
  let usdtRow = await getTatumVirtualAccountByUserAndCurrency(userId, 'USDT');

  if (ethRow && usdtRow) {
    await ensureSubscriptionsForAddress(ethRow.deposit_address);
    return { ethRow, usdtRow };
  }

  if (!ethRow && usdtRow) {
    throw new Error('Inconsistent crypto wallet state (USDT without ETH). Contact support.');
  }

  let derivationIndex;

  if (!ethRow) {
    const ethAccount = await tatum.createLedgerAccountEth({
      externalId: String(userId),
      accountingCurrency: 'USD',
    });
    if (ethAccount.customerId) await upsertTatumCryptoProfile(userId, ethAccount.customerId);
    const ethDeposit = await tatum.generateDepositAddress(ethAccount.id);
    derivationIndex = ethDeposit.derivationKey ?? ethDeposit.index ?? 0;
    ethRow = await insertTatumVirtualAccount({
      id: newId(),
      user_id: userId,
      currency: 'ETH',
      chain: CHAIN,
      tatum_account_id: ethAccount.id,
      deposit_address: ethDeposit.address,
      derivation_index: derivationIndex,
    });
  } else {
    derivationIndex = ethRow.derivation_index;
  }

  if (!usdtRow) {
    const usdtAccount = await tatum.createLedgerAccountUsdt({
      externalId: String(userId),
      accountingCurrency: 'USD',
    });
    if (usdtAccount.customerId) await upsertTatumCryptoProfile(userId, usdtAccount.customerId);
    const usdtDeposit = await tatum.generateDepositAddress(usdtAccount.id, derivationIndex);
    usdtRow = await insertTatumVirtualAccount({
      id: newId(),
      user_id: userId,
      currency: 'USDT',
      chain: CHAIN,
      tatum_account_id: usdtAccount.id,
      deposit_address: usdtDeposit.address,
      derivation_index: usdtDeposit.derivationKey ?? derivationIndex,
    });
  }

  await ensureSubscriptionsForAddress(ethRow.deposit_address);
  return { ethRow, usdtRow };
}

function formatAmountDisplay(asset, rawValueStr) {
  try {
    if (asset === 'ETH') return ethers.formatEther(BigInt(rawValueStr || '0'));
    if (asset === 'USDT') return ethers.formatUnits(BigInt(rawValueStr || '0'), 6);
  } catch {
    return rawValueStr || '0';
  }
  return rawValueStr || '0';
}

async function handleTatumWebhook(req, res) {
  try {
    if (!verifyTatumWebhook(req)) {
      return res.status(401).json({ message: 'Invalid webhook signature' });
    }
    const payload = req.body?.data ? req.body : { data: req.body };
    const d = payload.data || {};
    const txId = d.txId || d.hash;
    if (!txId) return res.status(200).json({ ok: true, ignored: true });

    const to = String(d.to || '').toLowerCase();
    const from = String(d.from || '').toLowerCase();
    const userId = await findUserIdByDepositAddress(to);
    if (!userId) return res.status(200).json({ ok: true, unknownAddress: true });

    const contract = String(d.contractAddress || '').toLowerCase();
    const usdtContract = tatum.USDT_ETHEREUM_MAINNET.toLowerCase();
    const subType = String(d.subscriptionType || '');

    if (subType.includes('FUNGIBLE') && !contract) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    if (contract && contract !== usdtContract) {
      return res.status(200).json({ ok: true, ignored: 'unsupported_token' });
    }

    const isUsdt = Boolean(contract) && contract === usdtContract;

    let asset = 'ETH';
    let rawValue = d.amount ?? d.value;
    let logIndex = d.logIndex ?? d.additionalData?.logIndex;
    if (typeof logIndex === 'string') logIndex = parseInt(logIndex, 10);
    if (Number.isNaN(logIndex)) logIndex = null;

    if (isUsdt) {
      asset = 'USDT';
      rawValue = d.amount ?? d.value;
    }

    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const amountDisplay = formatAmountDisplay(asset, String(rawValue));
    const dedupeKey = `${txId}:${logIndex ?? 'n'}:${asset}:in`;

    const inserted = await insertTatumOnchainTx({
      id: newId(),
      user_id: userId,
      direction: 'in',
      asset,
      amount_display: amountDisplay,
      tx_hash: txId,
      log_index: logIndex,
      from_address: from || null,
      to_address: to || null,
      status: 'confirmed',
      dedupe_key: dedupeKey,
    });
    return res.status(200).json({ ok: true, recorded: Boolean(inserted) });
  } catch (e) {
    console.error('Tatum webhook error', e);
    return res.status(500).json({ message: 'Webhook handler failed' });
  }
}

function registerCryptoRoutes(app, { authMiddleware }) {
  app.post('/crypto/onboard', authMiddleware, async (req, res) => {
    try {
      if (!cryptoConfigured()) {
        return res.status(503).json({
          message:
            'Crypto is not configured. Set TATUM_API_KEY, TATUM_ETH_MASTER_XPUB, and TATUM_ETH_MASTER_MNEMONIC on the server.',
        });
      }
      const { ethRow, usdtRow } = await provisionUserCryptoAccounts(req.userId);
      return res.json({
        depositAddress: ethRow.deposit_address,
        accounts: [
          { currency: 'ETH', tatumAccountId: ethRow.tatum_account_id, derivationIndex: ethRow.derivation_index },
          { currency: 'USDT', tatumAccountId: usdtRow.tatum_account_id, derivationIndex: usdtRow.derivation_index },
        ],
      });
    } catch (e) {
      const msg = e?.message || 'Crypto onboard failed';
      const status = e?.status && e.status < 600 ? e.status : 500;
      return res.status(status).json({ message: msg });
    }
  });

  app.get('/crypto/summary', authMiddleware, async (req, res) => {
    try {
      if (!cryptoConfigured()) {
        return res.status(503).json({
          message:
            'Crypto is not configured. Set TATUM_API_KEY, TATUM_ETH_MASTER_XPUB, and TATUM_ETH_MASTER_MNEMONIC on the server.',
        });
      }
      const rows = (await listTatumVirtualAccountsByUserId(req.userId)).sort((a, b) =>
        String(a.currency).localeCompare(String(b.currency))
      );
      if (!rows.length) {
        return res.json({
          onboarded: false,
          depositAddress: null,
          balances: [],
          activity: [],
          swap: { enabled: false, message: 'Swap is not available yet (phase 2).' },
        });
      }
      const depositAddress = rows[0]?.deposit_address || null;
      const balances = [];
      for (const row of rows) {
        try {
          const b = await tatum.getAccountBalance(row.tatum_account_id);
          balances.push({
            currency: row.currency,
            accountBalance: b.accountBalance,
            availableBalance: b.availableBalance,
          });
        } catch {
          balances.push({ currency: row.currency, accountBalance: '0', availableBalance: '0' });
        }
      }
      const activity = await listTatumOnchainTxsByUserId(req.userId, 40);
      return res.json({
        onboarded: true,
        depositAddress,
        balances,
        activity: activity.map((t) => ({
          id: t.id,
          direction: t.direction,
          asset: t.asset,
          amountDisplay: t.amount_display,
          txHash: t.tx_hash,
          createdAt: t.created_at,
        })),
        swap: { enabled: false, message: 'Swap is not available yet (phase 2).' },
      });
    } catch {
      return res.status(500).json({ message: 'Failed to load crypto summary' });
    }
  });

  app.get('/crypto/swap-status', authMiddleware, async (req, res) => {
    return res.json({ enabled: false, message: 'Swap is not available yet (phase 2).' });
  });

  app.post('/crypto/send', authMiddleware, async (req, res) => {
    try {
      if (!cryptoConfigured()) {
        return res.status(503).json({
          message:
            'Crypto is not configured. Set TATUM_API_KEY, TATUM_ETH_MASTER_XPUB, and TATUM_ETH_MASTER_MNEMONIC on the server.',
        });
      }
      const { to, amount, asset } = req.body || {};
      const upper = String(asset || '').toUpperCase();
      if (!to || amount === undefined || amount === null || !['ETH', 'USDT'].includes(upper)) {
        return res.status(400).json({ message: 'Provide to (0x…), amount, and asset (ETH or USDT)' });
      }
      if (!ethers.isAddress(to)) return res.status(400).json({ message: 'Invalid recipient address' });

      const va = await getTatumVirtualAccountByUserAndCurrency(req.userId, upper);
      if (!va) return res.status(400).json({ message: 'Crypto wallet not onboarded. Call POST /crypto/onboard first.' });

      const checksumTo = ethers.getAddress(to);
      let result;

      if (upper === 'ETH') {
        result = await tatum.ethTransferFromVirtualAccount({
          senderAccountId: va.tatum_account_id,
          address: checksumTo,
          amount: String(amount),
          index: Number(va.derivation_index),
        });
      } else {
        const units = ethers.parseUnits(String(amount), 6).toString();
        result = await tatum.erc20TransferFromVirtualAccount({
          senderAccountId: va.tatum_account_id,
          address: checksumTo,
          amount: units,
          index: Number(va.derivation_index),
        });
      }

      const txHash = result.txId || result.id;
      await insertTatumOnchainTx({
        id: newId(),
        user_id: req.userId,
        direction: 'out',
        asset: upper,
        amount_display: String(amount),
        tx_hash: txHash || `pending-${result.id}`,
        log_index: null,
        from_address: va.deposit_address,
        to_address: checksumTo,
        status: result.completed === false ? 'pending' : 'confirmed',
        dedupe_key: `out:${result.id}:${upper}`,
      });

      return res.json({
        id: result.id,
        txId: result.txId,
        completed: result.completed,
      });
    } catch (e) {
      const msg = e?.message || 'Send failed';
      const status = e?.status && e.status < 600 ? e.status : 500;
      return res.status(status).json({ message: msg });
    }
  });
}

module.exports = { registerCryptoRoutes, handleTatumWebhook };
