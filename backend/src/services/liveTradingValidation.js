const VALID_BOT_TYPES = new Set(['synthetix_ea', 'quantix_ea']);

const MIN_DEPOSIT_BY_BOT = {
  synthetix_ea: 1000,
  quantix_ea: 200,
};

function getMinDeposit(botType) {
  return MIN_DEPOSIT_BY_BOT[String(botType || '').toLowerCase()] ?? 200;
}

function validateBotType(botType) {
  const key = String(botType || '').toLowerCase();
  if (!VALID_BOT_TYPES.has(key)) {
    const err = new Error('Choose a valid trading program');
    err.statusCode = 400;
    throw err;
  }
  return key;
}

function validateTradingPassword(password) {
  const p = String(password || '');
  if (p.length < 8 || p.length > 32) {
    const err = new Error('Trading password must be 8–32 characters');
    err.statusCode = 400;
    throw err;
  }
  if (!/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/[0-9]/.test(p)) {
    const err = new Error('Trading password needs upper, lower, and a number');
    err.statusCode = 400;
    throw err;
  }
  return p;
}

module.exports = {
  VALID_BOT_TYPES,
  MIN_DEPOSIT_BY_BOT,
  getMinDeposit,
  validateBotType,
  validateTradingPassword,
};
