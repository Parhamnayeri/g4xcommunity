/* Never uses an existing DB: each invocation creates and migrates a private disposable SQLite file. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'g4x-release-blockers-'));
fs.writeFileSync(path.join(directory, 'release_fixture.db'), '', { flag: 'wx' });

const env = {
  ...process.env,
  DATABASE_URL: `file:${directory.replace(/\\/g, '/')}/release_fixture.db`,
  NODE_ENV: 'test',
  COOKIE_SECURE: 'false',
  WEB_BASE_URL: 'http://localhost:3000',
  WITHDRAWAL_QUOTE_SIGNING_SECRET: process.env.WITHDRAWAL_QUOTE_SIGNING_SECRET || 'test_withdrawal_quote_signing_secret_min_32_characters_high_entropy_safe',
  EXCHANGE_QUOTE_SIGNING_SECRET: process.env.EXCHANGE_QUOTE_SIGNING_SECRET || 'test_exchange_quote_signing_secret_min_32_characters_high_entropy_safe',
};

// All 6 financial and external feature gates MUST be explicitly false
for (const name of [
  'ESCROW_RELEASE_ENABLED',
  'FINANCE_V2_LIVE_CREDITS_ENABLED',
  'FINANCE_V2_LIVE_PAYOUTS_ENABLED',
  'FINANCE_V2_P2P_SETTLEMENT_ENABLED',
  'NOWPAYMENTS_LIVE_COLLECTION_ENABLED',
  'RAIDERIO_LIVE_SYNC_ENABLED'
]) {
  env[name] = 'false';
}

env.NOWPAYMENTS_MODE = 'disabled';

let exitCode = 0;

function run(args) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit', timeout: 240000 });
  if (result.status !== 0) {
    const code = result.status ?? (result.signal ? 1 : 1);
    const err = new Error(`Command failed with status ${code}`);
    err.exitCode = code;
    throw err;
  }
}

try {
  console.log(`Disposable test database: ${directory}`);
  run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  const selected = process.argv[2];
  if (selected && selected !== 'startup' && selected !== 'test-failure-injection') {
    run(['node_modules/ts-node/dist/bin.js', 'src/database/seed.ts']);
  }
  if (!selected || selected === 'startup') run(['node_modules/ts-node/dist/bin.js', 'src/test/startup_persistence_suite.ts']);
  else if (selected === 'spa') run(['node_modules/ts-node/dist/bin.js', 'src/test/spa_routing_suite.ts']);
  else if (selected === 'characters') run(['node_modules/ts-node/dist/bin.js', 'src/test/raiderio_booster_character_suite.ts']);
  else if (selected === 'booster-hub') run(['node_modules/ts-node/dist/bin.js', 'src/test/discord_booster_hub_suite.ts']);
  else if (selected === 'discord-order-workflow') run(['node_modules/ts-node/dist/bin.js', 'src/test/discord_order_workflow_suite.ts']);
  else if (selected === 'manual-deposit') run(['node_modules/ts-node/dist/bin.js', 'src/test/manual_irt_deposit_workflow_suite.ts']);
  else if (selected === 'rules-cms') run(['node_modules/ts-node/dist/bin.js', 'src/test/dynamic_rules_and_policies_cms_suite.ts']);
  else if (selected === 'discord-commands') run(['node_modules/ts-node/dist/bin.js', 'src/test/private_discord_commands_guide_suite.ts']);
  else if (selected === 'permissions') run(['node_modules/ts-node/dist/bin.js', 'src/test/permission_authorization_suite.ts']);
  else if (selected === 'test-failure-injection') {
    const err = new Error('SIMULATED_TEST_SUITE_CRASH');
    err.exitCode = 88;
    throw err;
  }
  else if (selected.endsWith('.ts')) run(['node_modules/ts-node/dist/bin.js', selected]);
  else {
    console.error(`Unknown suite: ${selected}`);
    exitCode = 1;
  }
} catch (err) {
  exitCode = err.exitCode || 1;
} finally {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {}
}

if (exitCode !== 0) {
  process.exit(exitCode);
}
