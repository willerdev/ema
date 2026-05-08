const urlBase = process.env.CHECK_BASE_URL || 'https://ema-0gp3.onrender.com';
const email = process.env.CHECK_EMAIL || '';
const password = process.env.CHECK_PASSWORD || '';
const bearerToken = process.env.CHECK_BEARER_TOKEN || '';

async function jfetch(path, options = {}) {
  const res = await fetch(`${urlBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function checkRpcReachability() {
  const rpcUrl = process.env.ETHEREUM_RPC_URL;
  if (!rpcUrl) {
    console.log('Skip ETHEREUM_RPC_URL reachability (not set in this shell).');
    return;
  }
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
  const res = await fetch(String(rpcUrl).trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  console.log('ETHEREUM_RPC_URL eth_blockNumber:', res.status, data?.result ? { block: data.result } : data);
}

async function main() {
  console.log(`Checking backend: ${urlBase}`);
  const health = await jfetch('/health');
  console.log('health:', health.status, health.data);

  const healthDb = await jfetch('/health/db');
  console.log('health/db:', healthDb.status, healthDb.data);

  await checkRpcReachability();

  let token = bearerToken;
  if (token) {
    console.log('Using CHECK_BEARER_TOKEN for auth/crypto checks.');
  } else {
    if (!email || !password) {
      console.log('Skip auth/crypto checks (set CHECK_BEARER_TOKEN, or CHECK_EMAIL and CHECK_PASSWORD).');
      return;
    }
    const login = await jfetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    console.log('auth/login:', login.status, login.data?.message ? { message: login.data.message } : { ok: true });
    if (login.status !== 200 || !login.data?.token) return;
    token = login.data.token;
  }

  const summaryBefore = await jfetch('/crypto/summary', {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('crypto/summary (before onboard):', summaryBefore.status, summaryBefore.data);

  const onboard = await jfetch('/crypto/onboard', {
    method: 'POST',
    body: '{}',
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('crypto/onboard:', onboard.status, onboard.data);

  const summaryAfter = await jfetch('/crypto/summary', {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('crypto/summary (after onboard):', summaryAfter.status, summaryAfter.data);
}

main().catch((e) => {
  console.error('check failed:', e?.message || e);
  process.exit(1);
});
