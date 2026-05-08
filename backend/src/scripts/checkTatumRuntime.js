const urlBase = process.env.CHECK_BASE_URL || 'https://ema-0gp3.onrender.com';
const email = process.env.CHECK_EMAIL || '';
const password = process.env.CHECK_PASSWORD || '';

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

async function main() {
  console.log(`Checking backend: ${urlBase}`);
  const health = await jfetch('/health');
  console.log('health:', health.status, health.data);

  const healthDb = await jfetch('/health/db');
  console.log('health/db:', healthDb.status, healthDb.data);

  if (!email || !password) {
    console.log('Skip auth/crypto checks (CHECK_EMAIL and CHECK_PASSWORD not set).');
    return;
  }

  const login = await jfetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  console.log('auth/login:', login.status, login.data?.message ? { message: login.data.message } : { ok: true });
  if (login.status !== 200 || !login.data?.token) return;

  const token = login.data.token;
  const summary = await jfetch('/crypto/summary', {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('crypto/summary:', summary.status, summary.data);

  const onboard = await jfetch('/crypto/onboard', {
    method: 'POST',
    body: '{}',
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('crypto/onboard:', onboard.status, onboard.data);
}

main().catch((e) => {
  console.error('check failed:', e?.message || e);
  process.exit(1);
});

