/* Owner-merge-gated validation. Does not merge, rebase, push, deploy or use an existing database. */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, ...options });
}
const status = run('gh', ['api', 'repos/Parhamnayeri/g4xcommunity/pulls/1', '--jq', '{merged:.merged,head:.head.sha,base:.base.ref}']);
let pr1;
try { pr1 = JSON.parse(status.stdout); } catch {}
if (status.status !== 0 || !pr1?.merged) {
  console.error('BLOCKED: PR #1 must first be merged by the repository owner. No integration or database operations performed.');
  process.exit(2);
}
const mainStatus = run('gh', ['api', 'repos/Parhamnayeri/g4xcommunity/git/ref/heads/main', '--jq', '.object.sha']);
const mainSha = (mainStatus.stdout || '').trim();
const ancestry = /^[0-9a-f]{40}$/.test(mainSha) ? run('git', ['merge-base', '--is-ancestor', mainSha, 'HEAD']) : null;
if (mainStatus.status !== 0 || !ancestry || ancestry.status !== 0) {
  console.error('BLOCKED: fetch and integrate the current owner-updated main into PR #2 first. No database operations performed.');
  process.exit(2);
}
const contract = run(process.execPath, ['scripts/test-pr-integration.cjs', '--combined', `--pr1-ref=${pr1.head}`]);
process.stdout.write(contract.stdout || ''); process.stderr.write(contract.stderr || '');
if (contract.status !== 0) {
  console.error('BLOCKED: update PR #2 against owner-merged main and resolve both feature families first.');
  process.exit(2);
}
if (process.argv.includes('--check-ready')) process.exit(0);
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'g4x-combined-regression-'));
const gates = Object.fromEntries(['ESCROW_RELEASE_ENABLED','FINANCE_V2_LIVE_CREDITS_ENABLED','FINANCE_V2_LIVE_PAYOUTS_ENABLED','FINANCE_V2_P2P_SETTLEMENT_ENABLED','NOWPAYMENTS_LIVE_COLLECTION_ENABLED'].map(name => [name, 'false']));
const environment = { ...process.env, ...gates, NODE_ENV: 'test', COOKIE_SECURE: 'false', WEB_BASE_URL: 'http://localhost:3000' };
const results = [];
function step(name, command, args, env, required = true) {
  const result = run(command, args, { env, timeout: 240000 });
  fs.writeFileSync(path.join(output, `${name}.log`), `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n${result.error.message}` : ''}`);
  const record = { name, command: [command, ...args], status: result.status, passed: result.status === 0, required };
  results.push(record); console.log(`${record.passed ? 'PASS' : 'FAIL'} ${name}`);
  return record.passed;
}
const suites = [
  ['order-ui', 'test:order-workspace', 'task2_order_ui'],
  ['order-api', 'test:order-workspace:api', 'task2_order_api'],
  ['native-admin-ui', 'test:native-admin:react', 'task3_admin_ui'],
  ['native-admin-api', 'test:native-admin', 'task3_admin_api'],
  ['registration', 'test:registration', 'task3_registration'],
  ['provisioning', 'test:provisioning', 'task3_provisioning'],
  ['kyc-rbac-csrf', 'test:phase7', 'task3_kyc'],
  ['ownergate', 'test:ownergate', 'task3_ownergate'],
];
for (const [name, script, basename] of suites) {
  const database = path.join(output, `${basename}.db`);
  fs.writeFileSync(database, '', { flag: 'wx' });
  const env = { ...environment, DATABASE_URL: `file:${database}` };
  if (!step(`${name}-migrations`, process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], env)) continue;
  if (!step(`${name}-seed`, 'npm', ['run', 'db:seed'], env)) continue;
  if (name === 'ownergate') {
    const fixture = "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.create({data:{discordId:'999888777666555333',username:'IsolatedIntegrationOwner',userRoles:{create:{roleKey:'owner'}}}}).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());";
    if (!step(`${name}-fixture`, process.execPath, ['-e', fixture], env)) continue;
  }
  step(name, 'npm', ['run', script], env);
}
step('production-build', 'npm', ['run', 'build'], environment);
// This is a baseline-comparison observation, never reported as a passing type check if it fails.
step('frontend-typecheck', process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'frontend/tsconfig.json', '--noEmit'], environment, false);
step('diff-check', 'git', ['diff', '--check'], environment);
fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ startedFrom: process.cwd(), databases: 'new disposable SQLite files only', results }, null, 2));
console.log(`Evidence and disposable databases retained at ${output}`);
const requiredFailure = results.some(result => result.required && !result.passed);
const observationsFailed = results.some(result => !result.required && !result.passed);
if (observationsFailed) console.log('BASELINE REVIEW REQUIRED: compare frontend diagnostics with updated main before claiming merge readiness.');
process.exitCode = requiredFailure ? 1 : observationsFailed ? 2 : 0;
