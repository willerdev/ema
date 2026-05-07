#!/usr/bin/env node
require('dotenv').config();
const readline = require('readline');
const { ensureMetaApiAccount, fetchMt5Balance, fetchMt5OpenPositions, extractErrorMessage } = require('../services/mt5Client');

function ask(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, (answer) => resolve(String(answer || '').trim())));
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('MT5 MetaApi connectivity test');
    console.log('----------------------------');

    const login = await ask(rl, 'MT5 Login: ');
    const password = await ask(rl, 'MT5 Password: ');
    const server = await ask(rl, 'MT5 Server (e.g. DerivSVG-Server-02): ');
    const accountName = await ask(rl, 'Account Name (optional): ');

    if (!login || !password || !server) {
      throw new Error('Login, password, and server are required.');
    }

    console.log('\nConnecting via MetaApi...');
    const { accountId } = await ensureMetaApiAccount({
      metaapiAccountId: '',
      login,
      password,
      server,
      accountName,
    });
    console.log(`Connected. MetaApi accountId: ${accountId}`);

    console.log('\nFetching account balance...');
    const balance = await fetchMt5Balance({ accountId });
    console.log(`Balance: ${balance.currency} ${Number(balance.balance).toFixed(2)}`);
    console.log(`Equity: ${balance.currency} ${Number(balance.equity).toFixed(2)}`);
    console.log(`Server: ${balance.server || server}`);

    console.log('\nFetching open positions...');
    const positions = await fetchMt5OpenPositions({ accountId });
    console.log(`Open positions: ${positions.length}`);
  } catch (error) {
    console.error('\nMT5 test failed:');
    console.error(extractErrorMessage(error, 'Unknown error'));
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

main();
