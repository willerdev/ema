const crypto = require('crypto');
const { ethers } = require('ethers');
const {
  getCryptoEthereumWalletByUserId,
  getNextCryptoEthereumDerivationIndex,
  insertCryptoEthereumWallet,
  findUserIdByDepositAddress,
  insertTatumOnchainTx,
  listTatumOnchainTxsByUserId,
  isMissingTableError,
} = require('./db');
const tatum = require('./services/tatumClient');
const ethWallet = require('./services/ethWallet');
const ethChain = require('./services/ethChain');

function cryptoConfigured() {
  try {
    tatum.getApiKey();
    tatum.getMasterMnemonic();
    ethChain.getProvider();
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

async function provisionUserEthereumWallet(userId) {
  const existing = await getCryptoEthereumWalletByUserId(userId);
  if (existing) {
    await ensureSubscriptionsForAddress(existing.address);
    return existing;
  }

  const mnemonic = tatum.getMasterMnemonic();
  const derivationIndex = await getNextCryptoEthereumDerivationIndex();
  const address = ethers.getAddress(ethWallet.deriveAddress(mnemonic, derivationIndex));

  const row = await insertCryptoEthereumWallet({
    user_id: userId,
    derivation_index: derivationIndex,
    address,
  });
  await ensureSubscriptionsForAddress(row.address);
  return row;
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
  const schemaErrorMessage =
    'Crypto DB schema is not initialized. Run backend/sql/schema.sql in Supabase SQL editor to create crypto_ethereum_wallets and tatum_onchain_txs.';

  const notConfiguredMessage =
    'Crypto is not configured. Set TATUM_API_KEY, TATUM_ETH_MASTER_MNEMONIC, ETHEREUM_RPC_URL, and APP_BASE_URL (for webhooks) on the server.';

  const swapState = { enabled: false, message: 'Swap is currently unavailable.' };

  app.post('/crypto/onboard', authMiddleware, async (req, res) => {
    try {
      if (!cryptoConfigured()) {
        return res.status(503).json({ message: notConfiguredMessage });
      }
      const wallet = await provisionUserEthereumWallet(req.userId);
      return res.json({
        depositAddress: wallet.address,
        derivationIndex: wallet.derivation_index,
        wallets: [
          { asset: 'ETH', chain: 'ETHEREUM', address: wallet.address },
          { asset: 'USDT', chain: 'ETHEREUM', address: wallet.address },
        ],
      });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: schemaErrorMessage });
      }
      const msg = e?.message || 'Crypto onboard failed';
      const status = e?.status && e.status < 600 ? e.status : 500;
      return res.status(status).json({ message: msg });
    }
  });

  app.get('/crypto/summary', authMiddleware, async (req, res) => {
    try {
      if (!cryptoConfigured()) {
        return res.status(503).json({ message: notConfiguredMessage });
      }
      const wallet = await getCryptoEthereumWalletByUserId(req.userId);
      if (!wallet) {
        return res.json({
          onboarded: false,
          depositAddress: null,
          balances: [],
          activity: [],
          wallets: [],
          swap: swapState,
        });
      }

      let ethBalance = '0';
      let usdtBalance = '0';
      try {
        ethBalance = await ethChain.getEthBalanceFormatted(wallet.address);
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') console.warn('ETH balance:', e.message);
      }
      try {
        usdtBalance = await ethChain.getUsdtBalanceFormatted(wallet.address);
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') console.warn('USDT balance:', e.message);
      }

      const balances = [
        { asset: 'ETH', balance: ethBalance },
        { asset: 'USDT', balance: usdtBalance },
      ];

      const activity = await listTatumOnchainTxsByUserId(req.userId, 40);
      return res.json({
        onboarded: true,
        depositAddress: wallet.address,
        wallets: [
          { asset: 'ETH', chain: 'ETHEREUM', address: wallet.address },
          { asset: 'USDT', chain: 'ETHEREUM', address: wallet.address },
        ],
        balances,
        activity: activity.map((t) => ({
          id: t.id,
          direction: t.direction,
          asset: t.asset,
          amountDisplay: t.amount_display,
          txHash: t.tx_hash,
          createdAt: t.created_at,
        })),
        swap: swapState,
      });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: schemaErrorMessage });
      }
      return res.status(500).json({ message: e?.message || 'Failed to load crypto summary' });
    }
  });

  app.get('/crypto/swap-status', authMiddleware, async (req, res) => {
    return res.json(swapState);
  });

  app.post('/crypto/send', authMiddleware, async (req, res) => {
    try {
      if (!cryptoConfigured()) {
        return res.status(503).json({ message: notConfiguredMessage });
      }
      const { to, amount, asset } = req.body || {};
      const upper = String(asset || '').toUpperCase();
      if (!to || amount === undefined || amount === null || !['ETH', 'USDT'].includes(upper)) {
        return res.status(400).json({ message: 'Provide to (0x…), amount, and asset (ETH or USDT)' });
      }
      if (!ethers.isAddress(to)) return res.status(400).json({ message: 'Invalid recipient address' });

      const wallet = await getCryptoEthereumWalletByUserId(req.userId);
      if (!wallet) {
        return res.status(400).json({ message: 'Crypto wallet not onboarded. Call POST /crypto/onboard first.' });
      }

      const checksumTo = ethers.getAddress(to);
      const mnemonic = tatum.getMasterMnemonic();
      const provider = ethChain.getProvider();
      const signer = ethWallet.getSignerAtIndex(mnemonic, Number(wallet.derivation_index), provider);

      let txHash;
      if (upper === 'ETH') {
        const out = await ethChain.sendNativeEth(signer, checksumTo, String(amount));
        txHash = out.txHash;
      } else {
        const out = await ethChain.sendErc20Usdt(signer, checksumTo, String(amount));
        txHash = out.txHash;
      }

      const dedupeKey = `out:${txHash}:${upper}`;
      await insertTatumOnchainTx({
        id: newId(),
        user_id: req.userId,
        direction: 'out',
        asset: upper,
        amount_display: String(amount),
        tx_hash: txHash,
        log_index: null,
        from_address: wallet.address,
        to_address: checksumTo,
        status: 'pending',
        dedupe_key: dedupeKey,
      });

      return res.json({
        id: txHash,
        txId: txHash,
        completed: false,
      });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: schemaErrorMessage });
      }
      const msg = e?.message || 'Send failed';
      const status = e?.status && e.status < 600 ? e.status : 500;
      return res.status(status).json({ message: msg });
    }
  });
}

module.exports = { registerCryptoRoutes, handleTatumWebhook };
