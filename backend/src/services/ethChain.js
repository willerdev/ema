const { ethers, JsonRpcProvider, Contract } = require('ethers');

const USDT_ETHEREUM_MAINNET = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

const ERC20_MIN_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

function isRateLimitError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('too many requests') || msg.includes('429') || msg.includes('rate limit');
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRateLimitRetry(fn, { attempts = 3, delayMs = 1200 } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRateLimitError(e) || i === attempts - 1) throw e;
      await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr || new Error('Operation failed');
}

function getProvider() {
  const url = process.env.ETHEREUM_RPC_URL;
  if (!url || !String(url).trim()) throw new Error('ETHEREUM_RPC_URL is not configured');
  // Tatum gateway rejects JSON-RPC batch calls on free tier (HTTP 402).
  // Force single-call transport so balance and token reads work reliably.
  return new JsonRpcProvider(String(url).trim(), undefined, { batchMaxCount: 1 });
}

async function rpcCall(method, params) {
  const url = process.env.ETHEREUM_RPC_URL;
  if (!url || !String(url).trim()) throw new Error('ETHEREUM_RPC_URL is not configured');
  const res = await fetch(String(url).trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`RPC ${method} returned non-JSON response`);
  }
  if (!res.ok || data?.error) {
    const msg = data?.error?.message || data?.message || `${method} failed (${res.status})`;
    throw new Error(String(msg));
  }
  return data?.result ?? null;
}

async function getEthBalanceFormatted(address) {
  const provider = getProvider();
  const wei = await provider.getBalance(address);
  return ethers.formatEther(wei);
}

async function getUsdtBalanceFormatted(address) {
  const provider = getProvider();
  const c = new Contract(USDT_ETHEREUM_MAINNET, ERC20_MIN_ABI, provider);
  const raw = await c.balanceOf(address);
  return ethers.formatUnits(raw, 6);
}

async function sendNativeEth(signer, toAddress, amountEthString) {
  const tx = await withRateLimitRetry(() =>
    signer.sendTransaction({
      to: toAddress,
      value: ethers.parseEther(String(amountEthString)),
    })
  );
  return { txHash: tx.hash };
}

async function sendErc20Usdt(signer, toAddress, amountUsdtString) {
  const c = new Contract(USDT_ETHEREUM_MAINNET, ERC20_MIN_ABI, signer);
  const amount = ethers.parseUnits(String(amountUsdtString), 6);
  const tx = await withRateLimitRetry(() => c.transfer(toAddress, amount));
  return { txHash: tx.hash };
}

async function estimateNativeEthGas(signer, toAddress, amountEthString) {
  const value = ethers.parseEther(String(amountEthString));
  const gasLimit = await withRateLimitRetry(() => signer.estimateGas({ to: toAddress, value }));
  return { gasLimit, value };
}

async function estimateUsdtTransferGas(signer, toAddress, amountUsdtString) {
  const c = new Contract(USDT_ETHEREUM_MAINNET, ERC20_MIN_ABI, signer);
  const amount = ethers.parseUnits(String(amountUsdtString), 6);
  const gasLimit = await withRateLimitRetry(() => c.transfer.estimateGas(toAddress, amount));
  return { gasLimit, amount };
}

function computeRequiredGasWei(feeData, gasLimit, bufferBps = 3000) {
  const maxFee = feeData?.maxFeePerGas || feeData?.gasPrice;
  if (!maxFee || !gasLimit) throw new Error('Unable to estimate gas fee from provider');
  const baseWei = BigInt(maxFee) * BigInt(gasLimit);
  const bps = BigInt(Math.max(0, Number(bufferBps) || 0));
  return baseWei + (baseWei * bps) / 10000n;
}

async function waitForConfirmation(provider, txHash, confirmations = 1) {
  const tx = await withRateLimitRetry(() => provider.waitForTransaction(txHash, confirmations), {
    attempts: 4,
    delayMs: 1500,
  });
  if (!tx || tx.status === 0) throw new Error('Top-up transaction failed');
  return tx;
}

async function getTransactionByHash(txHash) {
  const provider = getProvider();
  return provider.getTransaction(txHash);
}

async function getTransactionReceipt(txHash) {
  const provider = getProvider();
  return provider.getTransactionReceipt(txHash);
}

async function getTransactionByHashRaw(txHash) {
  return rpcCall('eth_getTransactionByHash', [txHash]);
}

async function getTransactionReceiptRaw(txHash) {
  return rpcCall('eth_getTransactionReceipt', [txHash]);
}

module.exports = {
  getProvider,
  getEthBalanceFormatted,
  getUsdtBalanceFormatted,
  sendNativeEth,
  sendErc20Usdt,
  estimateNativeEthGas,
  estimateUsdtTransferGas,
  computeRequiredGasWei,
  waitForConfirmation,
  getTransactionByHash,
  getTransactionReceipt,
  getTransactionByHashRaw,
  getTransactionReceiptRaw,
  USDT_ETHEREUM_MAINNET,
};
