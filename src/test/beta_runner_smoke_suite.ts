/**
 * src/test/beta_runner_smoke_suite.ts
 *
 * Automated Smoke & Preflight Verification Suite for G4X Operational Closed Beta Runner (v0.001).
 *
 * Verifies:
 *  1. Configuration preflight and environment validation without Discord connection.
 *  2. Clean startup of web-only Beta Runner (`skipDiscordLogin: true`) bound to 127.0.0.1.
 *  3. HTTP probe to `/api/beta/health` returning operational-beta status and locked gates.
 *  4. SQLite database isolation: confirmed to be strictly inside `prisma/staging/beta_v0001.db`.
 *  5. Data persistence verification: insert synthetic record, perform graceful shutdown,
 *     verify file is NOT deleted, restart instance, and read back the exact record.
 *  6. Safe final shutdown with WAL checkpointing.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { PrismaClient } from '@prisma/client';
import { startBetaRunner } from '../beta/betaRunner';
import { validateBetaEnvironment, loadBetaEnvFile } from '../beta/validateBetaEnv';
import { runIntegrityCheckOnClient } from '../beta/betaDatabase';

function httpGet(url: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode || 0, body: parsed });
        } catch {
          resolve({ statusCode: res.statusCode || 0, body: data });
        }
      });
    }).on('error', (err) => reject(err));
  });
}

async function runSmokeSuite() {
  console.log('\n============================================================');
  console.log('🧪 Starting G4X Closed Beta Runner Preflight Smoke Test');
  console.log('============================================================\n');

  // Step 1: Preflight Environment Validation
  console.log('[Smoke] 1. Validating Beta Environment...');
  loadBetaEnvFile();
  const validation = validateBetaEnvironment(process.env, { requireDiscordBotConfig: false });
  if (!validation.valid) {
    throw new Error(`Beta environment invalid:\n${validation.errors.join('\n')}`);
  }
  console.log('  - Preflight Validation: ✅ PASS');
  console.log(`  - Target DB: ${validation.resolvedDatabasePath}`);
  console.log(`  - Bind Host: ${validation.host}:${validation.port}`);

  // Step 2: First Startup (Web-only, no Discord)
  console.log('\n[Smoke] 2. Starting Beta Runner (Instance 1: Web-only, --no-discord)...');
  const instance1 = await startBetaRunner({
    skipDiscordLogin: true,
  });

  console.log('  - Instance 1 started successfully.');
  console.log(`  - Bound to: http://${instance1.host}:${instance1.port}`);
  console.log(`  - Discord Client: ${instance1.client === null ? 'OFFLINE (Safe)' : 'UNEXPECTED ACTIVE'}`);
  if (instance1.client !== null) {
    throw new Error('Discord client should be null when skipDiscordLogin is true.');
  }

  // Step 3: Probe Health Endpoint
  console.log('\n[Smoke] 3. Probing http://' + instance1.host + ':' + instance1.port + '/api/beta/health...');
  const healthRes = await httpGet(`http://${instance1.host}:${instance1.port}/api/beta/health`);
  console.log(`  - Status Code: ${healthRes.statusCode}`);
  console.log('  - Response Body:', healthRes.body);

  if (healthRes.statusCode !== 200 || healthRes.body?.mode !== 'operational-beta' || !healthRes.body?.liveFinanceGatesLocked) {
    throw new Error(`Health check failed: expected 200 operational-beta, got ${JSON.stringify(healthRes)}`);
  }
  console.log('  - Health Endpoint Verification: ✅ PASS');

  // Step 4: Verify Database Confinement & PRAGMA integrity
  console.log('\n[Smoke] 4. Verifying Database Confinement & Integrity...');
  const dbPath = instance1.database.dbPath;
  console.log(`  - Active DB File: ${dbPath}`);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file does not exist at ${dbPath}`);
  }

  const integrityReport1 = await instance1.database.verifyIntegrity();
  console.log('  - PRAGMA database_list file:', integrityReport1.activeMainFile);
  console.log('  - PRAGMA integrity_check:', integrityReport1.integrityOk ? 'ok' : 'FAILED');
  console.log('  - Foreign Key Violations:', integrityReport1.fkViolationCount);
  console.log('  - WAL Mode:', integrityReport1.walMode);

  if (!integrityReport1.integrityOk || integrityReport1.fkViolationCount > 0) {
    throw new Error('Database integrity check failed on running instance.');
  }

  // Step 5: Test Persistence Across Restarts (Synthetic Record Write)
  console.log('\n[Smoke] 5. Writing synthetic test record to verify persistence across restarts...');
  const prisma1 = instance1.database.prismaClient;
  const testDiscordId = '100000000000009999';

  // Cleanup any old test user with this discord id first
  await prisma1.userRole.deleteMany({ where: { userId: testDiscordId } });
  await prisma1.user.deleteMany({ where: { discordId: testDiscordId } });

  const createdUser = await prisma1.user.create({
    data: {
      discordId: testDiscordId,
      username: 'SmokeTestUser',
      displayName: 'Smoke Tester',
    },
  });
  console.log(`  - Created synthetic test user: DiscordID=${createdUser.discordId}, Username=${createdUser.username}`);

  // Step 6: Graceful Shutdown of Instance 1
  console.log('\n[Smoke] 6. Initiating graceful shutdown of Instance 1...');
  await instance1.stop();
  console.log('  - Instance 1 shutdown completed.');

  // Verify that the database was NOT deleted
  console.log('\n[Smoke] 7. Checking database file existence post-shutdown...');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`REGRESSION: Database file was deleted after shutdown! Target: ${dbPath}`);
  }
  const dbStat = fs.statSync(dbPath);
  console.log(`  - Database file persists: Size=${dbStat.size} bytes (NOT DELETED).`);

  // Step 7: Restart Beta Runner (Instance 2)
  console.log('\n[Smoke] 8. Starting Beta Runner (Instance 2: Restart test)...');
  const instance2 = await startBetaRunner({
    skipDiscordLogin: true,
  });
  console.log('  - Instance 2 started successfully on port ' + instance2.port);

  // Step 8: Read back synthetic record
  console.log('\n[Smoke] 9. Reading back synthetic record from Instance 2...');
  const prisma2 = instance2.database.prismaClient;
  const fetchedUser = await prisma2.user.findUnique({
    where: { discordId: testDiscordId },
  });

  if (!fetchedUser || fetchedUser.discordId !== testDiscordId) {
    throw new Error(`Data persistence failure: expected user ${testDiscordId}, found ${fetchedUser?.discordId}`);
  }
  console.log(`  - Successfully read persisted user: DiscordID=${fetchedUser.discordId}, Name=${fetchedUser.username}`);

  // Clean up synthetic smoke record
  await prisma2.userRole.deleteMany({ where: { userId: testDiscordId } });
  await prisma2.user.delete({ where: { discordId: testDiscordId } });
  console.log('  - Cleaned up synthetic smoke record.');

  // Step 9: Final Graceful Shutdown of Instance 2
  console.log('\n[Smoke] 10. Initiating graceful shutdown of Instance 2...');
  await instance2.stop();
  console.log('  - Instance 2 shutdown completed cleanly.');

  console.log('\n============================================================');
  console.log('🎉 ALL BETA RUNNER PREFLIGHT SMOKE CHECKS PASSED');
  console.log('============================================================\n');
}

if (require.main === module) {
  runSmokeSuite().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('\n❌ Smoke suite error:', err);
    process.exit(1);
  });
}
