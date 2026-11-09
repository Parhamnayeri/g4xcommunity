/* Never uses an existing DB: each invocation creates and migrates a private disposable SQLite file. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'g4x-release-blockers-'));
fs.writeFileSync(path.join(directory, 'release_fixture.db'), '', { flag: 'wx' });
const env = { ...process.env, DATABASE_URL: `file:${directory.replace(/\\/g, '/')}/release_fixture.db`, NODE_ENV: 'test', COOKIE_SECURE: 'false', WEB_BASE_URL: 'http://localhost:3000' };
for (const name of ['ESCROW_RELEASE_ENABLED', 'FINANCE_V2_LIVE_CREDITS_ENABLED', 'FINANCE_V2_LIVE_PAYOUTS_ENABLED', 'FINANCE_V2_P2P_SETTLEMENT_ENABLED', 'NOWPAYMENTS_LIVE_COLLECTION_ENABLED']) env[name] = 'false';
env.NOWPAYMENTS_MODE = 'disabled';
function run(args) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit', timeout: 240000 });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Disposable test database: ${directory}`);
run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
const selected = process.argv[2];
if (selected && selected !== 'startup') run(['node_modules/ts-node/dist/bin.js', 'src/database/seed.ts']);
if (!selected || selected === 'startup') run(['node_modules/ts-node/dist/bin.js', 'src/test/startup_persistence_suite.ts']);
else if (selected === 'spa') run(['node_modules/ts-node/dist/bin.js', 'src/test/spa_routing_suite.ts']);
else if (selected === 'characters') run(['node_modules/ts-node/dist/bin.js', 'src/test/raiderio_booster_character_suite.ts']);
else if (selected === 'booster-hub') run(['node_modules/ts-node/dist/bin.js', 'src/test/discord_booster_hub_suite.ts']);
else if (selected === 'discord-order-workflow') run(['node_modules/ts-node/dist/bin.js', 'src/test/discord_order_workflow_suite.ts']);
else if (selected === 'manual-deposit') run(['node_modules/ts-node/dist/bin.js', 'src/test/manual_irt_deposit_workflow_suite.ts']);
else if (selected === 'rules-cms') run(['node_modules/ts-node/dist/bin.js', 'src/test/dynamic_rules_and_policies_cms_suite.ts']);
else if (selected === 'discord-commands') run(['node_modules/ts-node/dist/bin.js', 'src/test/private_discord_commands_guide_suite.ts']);
else if (selected.endsWith('.ts')) run(['node_modules/ts-node/dist/bin.js', selected]);
else console.error(`Unknown suite: ${selected}`);
