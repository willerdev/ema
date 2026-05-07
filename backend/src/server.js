require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  getUserByEmail,
  getUserById,
  createUser,
  updateAlpacaKeys,
  getWalletByUserId,
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
} = require('./db');
const { authMiddleware } = require('./middleware/auth');
const { getClient, getAuthorizedClient } = require('./services/alpacaClient');
const { ensureMetaApiAccount, fetchMt5Balance, fetchMt5OpenPositions, extractErrorMessage } = require('./services/mt5Client');

const app = express();
app.use(cors());
app.use(express.json());

function alpacaErrorMessage(error, fallback) {
  const upstream =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message;
  if (process.env.NODE_ENV === 'production') return fallback;
  return upstream || fallback;
}

function signToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET || 'ema-dev-secret', { expiresIn: '7d' });
}

const currentUser = (req) => getUserById(req.userId);
const toMt5Summary = (account) => ({
  id: account.id,
  metaapiAccountId: account.metaapi_account_id || '',
  login: account.login,
  server: account.server,
  accountName: account.account_name || '',
  cachedBalance: account.cached_balance !== null && account.cached_balance !== undefined ? Number(account.cached_balance) : null,
  cachedEquity: account.cached_equity !== null && account.cached_equity !== undefined ? Number(account.cached_equity) : null,
  cachedCurrency: account.cached_currency || null,
  balanceLastUpdatedAt: account.balance_last_updated_at || null,
  updatedAt: account.updated_at,
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.get('/health/db', async (_, res) => {
  try {
    const counts = await checkDatabaseHealth();
    return res.json({ status: 'ok', database: 'connected', counts });
  } catch {
    return res.status(500).json({ status: 'error', database: 'unreachable' });
  }
});

app.post('/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password || password.length < 6) return res.status(400).json({ message: 'Invalid credentials' });
    const existing = await getUserByEmail(email);
    if (existing) return res.status(400).json({ message: 'Email already in use' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await createUser({ email, passwordHash });
    return res.json({ token: signToken(user), user: { id: user.id, email: user.email } });
  } catch (error) {
    const isSchemaMissing = error?.code === 'PGRST205';
    const message = isSchemaMissing
      ? 'Database schema not initialized. Run backend/sql/schema.sql in Supabase SQL Editor.'
      : process.env.NODE_ENV === 'production'
        ? 'Registration failed'
        : error?.message || 'Registration failed';
    return res.status(500).json({ message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await getUserByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    return res.json({ token: signToken(user), user: { id: user.id, email: user.email } });
  } catch (error) {
    const message = process.env.NODE_ENV === 'production' ? 'Login failed' : error?.message || 'Login failed';
    return res.status(500).json({ message });
  }
});

app.get('/auth/me', authMiddleware, async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(404).json({ message: 'User not found' });
  return res.json({ user: { id: user.id, email: user.email } });
});

app.get('/profile', authMiddleware, async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(404).json({ message: 'User not found' });

  return res.json({
    profile: {
      email: user.email,
      username: user.email.split('@')[0],
      accountStatus: 'active',
    },
  });
});

app.post('/alpaca/validate-keys', authMiddleware, async (req, res) => {
  try {
    const { apiKey, secretKey } = req.body;
    const { client, environment } = await getAuthorizedClient(apiKey, secretKey);
    const account = await client.validateKeys();
    return res.json({ valid: true, environment, account: account.data });
  } catch (error) {
    return res.status(400).json({ valid: false, message: alpacaErrorMessage(error, 'Invalid Alpaca API keys') });
  }
});

app.post('/alpaca/keys', authMiddleware, async (req, res) => {
  try {
    const { apiKey, secretKey } = req.body;
    if (!apiKey || !secretKey) return res.status(400).json({ message: 'Missing keys' });
    await updateAlpacaKeys(req.userId, apiKey, secretKey);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ message: 'Failed to update Alpaca keys' });
  }
});

app.get('/alpaca/status', authMiddleware, async (req, res) => {
  const user = await currentUser(req);
  return res.json({
    configured: Boolean(user?.alpaca_api_key && user?.alpaca_secret_key),
  });
});

app.use('/alpaca', authMiddleware, async (req, res, next) => {
  const user = await currentUser(req);
  if (!user?.alpaca_api_key || !user?.alpaca_secret_key) return res.status(400).json({ message: 'Alpaca keys not configured in Settings' });
  try {
    const { client, environment } = await getAuthorizedClient(user.alpaca_api_key, user.alpaca_secret_key);
    req.alpaca = client;
    req.alpacaEnvironment = environment;
    return next();
  } catch (error) {
    return res.status(401).json({ message: alpacaErrorMessage(error, 'Alpaca credentials unauthorized') });
  }
});

app.get('/alpaca/account', async (req, res) => {
  try {
    const data = await req.alpaca.account();
    return res.json(data.data);
  } catch (error) {
    return res.status(500).json({ message: alpacaErrorMessage(error, 'Failed to fetch account') });
  }
});

app.get('/alpaca/portfolio/history', async (req, res) => {
  try {
    const period = req.query.period || '1M';
    const timeframe = req.query.timeframe || '1D';
    const data = await req.alpaca.portfolioHistory(period, timeframe);
    return res.json(data.data);
  } catch (error) {
    return res.status(500).json({ message: alpacaErrorMessage(error, 'Failed to fetch portfolio history') });
  }
});

app.get('/alpaca/market/overview', async (req, res) => {
  try {
    const stockSymbols = ['AAPL', 'TSLA', 'NVDA', 'SPY'];
    const [barsResponse, btcQuote] = await Promise.all([
      req.alpaca.stockBars(stockSymbols.join(',')),
      req.alpaca.cryptoQuote('BTC/USD'),
    ]);

    const bars = barsResponse.data?.bars || {};
    const markets = stockSymbols.map((symbol) => {
      const bar = bars[symbol] || {};
      const close = Number(bar.c || 0);
      const open = Number(bar.o || close);
      const high = Number(bar.h || close);
      const low = Number(bar.l || close);
      const changePercent = open > 0 ? ((close - open) / open) * 100 : 0;
      return { symbol, price: close, open, high, low, close, changePercent };
    });

    const btc = btcQuote.data?.quotes?.['BTC/USD'];
    const btcPrice = Number(btc?.ap || btc?.bp || 0);
    markets.push({
      symbol: 'BTC/USD',
      price: btcPrice,
      open: btcPrice,
      high: btcPrice,
      low: btcPrice,
      close: btcPrice,
      changePercent: 0,
    });

    return res.json(markets);
  } catch (error) {
    return res.status(500).json({ message: alpacaErrorMessage(error, 'Failed to fetch market overview') });
  }
});

app.get('/alpaca/assets/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const assetClass = req.query.assetClass || 'us_equity';
    const data = await req.alpaca.assets(String(q), String(assetClass));
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ message: alpacaErrorMessage(error, 'Failed to search assets') });
  }
});

app.get('/alpaca/quote/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const data = await req.alpaca.stockQuote(symbol);
    const quote = data.data.quotes?.[symbol] || {};
    const price = Number(quote.ap || quote.bp || 0);
    return res.json({
      symbol,
      price,
      bid: Number(quote.bp || 0),
      ask: Number(quote.ap || 0),
      spread: Number((quote.ap || 0) - (quote.bp || 0)),
    });
  } catch (error) {
    return res.status(500).json({ message: alpacaErrorMessage(error, 'Failed to fetch quote') });
  }
});

app.get('/alpaca/positions', async (req, res) => {
  try {
    const data = await req.alpaca.positions();
    return res.json(data.data);
  } catch (error) {
    return res.status(500).json({ message: alpacaErrorMessage(error, 'Failed to fetch positions') });
  }
});

app.post('/alpaca/positions/:symbol/close', async (req, res) => {
  try {
    const data = await req.alpaca.closePosition(req.params.symbol);
    return res.json(data.data);
  } catch (error) {
    return res.status(500).json({ message: alpacaErrorMessage(error, 'Failed to close position') });
  }
});

app.get('/alpaca/orders', async (req, res) => {
  try {
    const data = await req.alpaca.orders();
    return res.json(data.data);
  } catch (error) {
    return res.status(500).json({ message: alpacaErrorMessage(error, 'Failed to fetch orders') });
  }
});

app.post('/alpaca/orders', async (req, res) => {
  const { symbol, qty, side, type, limit_price, stop_price, take_profit, stop_loss } = req.body;
  if (!symbol || !qty || !side || !type) return res.status(400).json({ message: 'Invalid order payload' });

  const payload = {
    symbol: symbol.toUpperCase(),
    qty,
    side,
    type,
    time_in_force: 'day',
    ...(type === 'limit' ? { limit_price } : {}),
    ...(type === 'stop' ? { stop_price } : {}),
    ...(take_profit ? { take_profit: { limit_price: Number(take_profit) } } : {}),
    ...(stop_loss ? { stop_loss: { stop_price: Number(stop_loss) } } : {}),
  };

  try {
    const data = await req.alpaca.order(payload);
    return res.json(data.data);
  } catch (error) {
    return res.status(500).json({ message: alpacaErrorMessage(error, 'Failed to place order') });
  }
});

app.get('/wallet', authMiddleware, async (req, res) => {
  try {
    const wallet = await getWalletByUserId(req.userId);
    const transactions = await getTransactionsByUserId(req.userId);
    return res.json({ balance: Number(wallet?.balance || 0), transactions });
  } catch {
    return res.status(500).json({ message: 'Failed to fetch wallet' });
  }
});

app.post('/wallet/deposit', authMiddleware, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const method = req.body.method || 'bank_transfer';
    const referenceId = req.body.referenceId || `DEP-${Date.now()}`;
    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

    const wallet = await getWalletByUserId(req.userId);
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });

    const nextBalance = Number(wallet.balance) + amount;
    await setWalletBalance(req.userId, nextBalance);
    const transaction = await createTransaction({ userId: req.userId, type: 'deposit', amount, status: `completed:${method}:${referenceId}` });

    return res.json({ balance: nextBalance, transaction });
  } catch {
    return res.status(500).json({ message: 'Deposit failed' });
  }
});

app.post('/wallet/withdraw', authMiddleware, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const method = req.body.method || 'bank_transfer';
    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

    const wallet = await getWalletByUserId(req.userId);
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });
    if (Number(wallet.balance) < amount) return res.status(400).json({ message: 'Insufficient wallet balance' });

    const nextBalance = Number(wallet.balance) - amount;
    await setWalletBalance(req.userId, nextBalance);
    const transaction = await createTransaction({ userId: req.userId, type: 'withdraw', amount, status: `pending:${method}` });

    return res.json({ balance: nextBalance, transaction });
  } catch {
    return res.status(500).json({ message: 'Withdraw failed' });
  }
});

app.post('/wallet/reset', authMiddleware, async (req, res) => {
  try {
    const suppliedToken = req.headers['x-dev-reset-token'];
    const expectedToken = process.env.DEV_RESET_TOKEN;
    if (!expectedToken || suppliedToken !== expectedToken) {
      return res.status(403).json({ message: 'Invalid or missing reset token' });
    }
    await setWalletBalance(req.userId, 0);
    await clearTransactionsByUserId(req.userId);
    return res.json({ success: true, balance: 0 });
  } catch {
    return res.status(500).json({ message: 'Wallet reset failed' });
  }
});

app.get('/mt5/accounts', authMiddleware, async (req, res) => {
  try {
    const accounts = await listMt5AccountsByUserId(req.userId);
    return res.json({
      accounts: accounts.map(toMt5Summary),
    });
  } catch {
    return res.status(500).json({ message: 'Failed to fetch MT5 accounts' });
  }
});

app.post('/mt5/accounts', authMiddleware, async (req, res) => {
  try {
    const { login, password, server, accountName } = req.body;
    if (!login || !password || !server) {
      return res.status(400).json({ message: 'login, password and server are required' });
    }
    // Save credentials first; do not block save flow on MetaApi provisioning latency.
    // Provisioning happens later when user explicitly refreshes live balance.
    const saved = await createMt5AccountForUser(req.userId, {
      login: String(login),
      password: String(password),
      server: String(server),
      accountName: String(accountName || ''),
      metaapiAccountId: '',
    });
    return res.json({
      success: true,
      account: toMt5Summary(saved),
    });
  } catch (error) {
    return res.status(500).json({ message: extractErrorMessage(error, 'Failed to save MT5 account') });
  }
});

app.get('/mt5/accounts/:id/balance', authMiddleware, async (req, res) => {
  try {
    const account = await getMt5AccountByIdForUser(req.userId, req.params.id);
    if (!account) {
      return res.status(404).json({ message: 'MT5 account not found' });
    }
    return res.json({
      isLive: false,
      hasSnapshot: account.cached_balance !== null && account.cached_balance !== undefined,
      balance: account.cached_balance !== null && account.cached_balance !== undefined ? Number(account.cached_balance) : 0,
      equity: account.cached_equity !== null && account.cached_equity !== undefined ? Number(account.cached_equity) : 0,
      currency: account.cached_currency || 'USD',
      login: account.login,
      server: account.server,
      accountName: account.account_name || '',
      updatedAt: account.balance_last_updated_at || null,
    });
  } catch (error) {
    const message = process.env.NODE_ENV === 'production'
      ? 'Failed to fetch MT5 balance'
      : extractErrorMessage(error, 'Failed to fetch MT5 balance');
    return res.status(500).json({ message });
  }
});

app.post('/mt5/accounts/:id/refresh-balance', authMiddleware, async (req, res) => {
  try {
    const account = await getMt5AccountByIdForUser(req.userId, req.params.id);
    if (!account) return res.status(404).json({ message: 'MT5 account not found' });

    const { accountId } = await ensureMetaApiAccount({
      metaapiAccountId: account.metaapi_account_id,
      login: account.login,
      password: account.password,
      server: account.server,
      accountName: account.account_name || '',
    });
    if (accountId && accountId !== account.metaapi_account_id) {
      await setMt5AccountMetaApiId(req.userId, account.id, accountId);
    }

    const live = await fetchMt5Balance({ accountId });
    const updatedAt = new Date().toISOString();
    await updateMt5AccountSnapshot(req.userId, account.id, {
      balance: Number(live.balance || 0),
      equity: Number(live.equity || live.balance || 0),
      currency: String(live.currency || 'USD'),
      updatedAt,
    });

    return res.json({
      isLive: true,
      balance: Number(live.balance || 0),
      equity: Number(live.equity || live.balance || 0),
      currency: String(live.currency || 'USD'),
      login: live.login || account.login,
      server: live.server || account.server,
      accountName: live.name || account.account_name || '',
      updatedAt,
    });
  } catch (error) {
    const message = process.env.NODE_ENV === 'production'
      ? 'Failed to refresh MT5 balance'
      : extractErrorMessage(error, 'Failed to refresh MT5 balance');
    return res.status(500).json({ message });
  }
});

app.get('/mt5/accounts/:id/positions', authMiddleware, async (req, res) => {
  try {
    const account = await getMt5AccountByIdForUser(req.userId, req.params.id);
    if (!account) {
      return res.status(404).json({ message: 'MT5 account not found' });
    }

    const { accountId } = await ensureMetaApiAccount({
      metaapiAccountId: account.metaapi_account_id,
      login: account.login,
      password: account.password,
      server: account.server,
      accountName: account.account_name || '',
    });
    if (accountId && accountId !== account.metaapi_account_id) {
      await setMt5AccountMetaApiId(req.userId, account.id, accountId);
    }

    const positions = await fetchMt5OpenPositions({ accountId });
    return res.json({ positions });
  } catch (error) {
    const message = process.env.NODE_ENV === 'production'
      ? 'Failed to fetch MT5 positions'
      : extractErrorMessage(error, 'Failed to fetch MT5 positions');
    return res.status(500).json({ message });
  }
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`EMA backend listening on :${port}`));
