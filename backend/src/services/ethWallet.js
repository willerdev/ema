const { HDNodeWallet } = require('ethers');

/** BIP44 Ethereum receive path: m/44'/60'/0'/0/{index} (see Tatum mnemonic derivation docs). */
const ETH_ACCOUNT_PATH_PREFIX = "m/44'/60'/0'/0";

function deriveWalletAtIndex(mnemonicPhrase, derivationIndex) {
  const phrase = String(mnemonicPhrase || '').trim();
  if (!phrase) throw new Error('Mnemonic is empty');
  if (!Number.isInteger(derivationIndex) || derivationIndex < 0) {
    throw new Error('derivationIndex must be a non-negative integer');
  }
  const path = `${ETH_ACCOUNT_PATH_PREFIX}/${derivationIndex}`;
  return HDNodeWallet.fromPhrase(phrase, null, path);
}

function deriveAddress(mnemonicPhrase, derivationIndex) {
  return deriveWalletAtIndex(mnemonicPhrase, derivationIndex).address;
}

function getSignerAtIndex(mnemonicPhrase, derivationIndex, provider) {
  const w = deriveWalletAtIndex(mnemonicPhrase, derivationIndex);
  return w.connect(provider);
}

module.exports = {
  deriveWalletAtIndex,
  deriveAddress,
  getSignerAtIndex,
  ETH_ACCOUNT_PATH_PREFIX,
};
