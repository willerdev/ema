const { ethers, JsonRpcProvider, Contract } = require('ethers');

const USDT_ETHEREUM_MAINNET = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

const ERC20_MIN_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

function getProvider() {
  const url = process.env.ETHEREUM_RPC_URL;
  if (!url || !String(url).trim()) throw new Error('ETHEREUM_RPC_URL is not configured');
  // Tatum gateway rejects JSON-RPC batch calls on free tier (HTTP 402).
  // Force single-call transport so balance and token reads work reliably.
  return new JsonRpcProvider(String(url).trim(), undefined, { batchMaxCount: 1 });
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
  const tx = await signer.sendTransaction({
    to: toAddress,
    value: ethers.parseEther(String(amountEthString)),
  });
  return { txHash: tx.hash };
}

async function sendErc20Usdt(signer, toAddress, amountUsdtString) {
  const c = new Contract(USDT_ETHEREUM_MAINNET, ERC20_MIN_ABI, signer);
  const amount = ethers.parseUnits(String(amountUsdtString), 6);
  const tx = await c.transfer(toAddress, amount);
  return { txHash: tx.hash };
}

module.exports = {
  getProvider,
  getEthBalanceFormatted,
  getUsdtBalanceFormatted,
  sendNativeEth,
  sendErc20Usdt,
  USDT_ETHEREUM_MAINNET,
};
