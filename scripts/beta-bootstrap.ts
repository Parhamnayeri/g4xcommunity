/**
 * scripts/beta-bootstrap.ts
 *
 * Dedicated bootstrap script for G4X Operational Closed Beta v0.001.
 * Migrates, secures, and seeds the isolated beta database (e.g. prisma/staging/beta_v0001.db)
 * with:
 *  - System roles (owner, manager, admin, staff, advertiser, booster, pilot, exchanger)
 *  - Supported games and game services
 *  - Default platform accounts (g2g_main, skycoach_main, eldorado_main, kingboost_main, overgear_main)
 *  - Initial Owner/Admin user (ready for OwnerGate and admin operations)
 *  - Initial Tester user (ready for booster/pilot/advertiser testing)
 *
 * Usage:
 *   npx ts-node scripts/beta-bootstrap.ts [--env=<path>]
 *   npm run beta:bootstrap
 */

import { loadBetaEnvFile, validateBetaEnvironment } from '../src/beta/validateBetaEnv';
import { initializeBetaDatabase } from '../src/beta/betaDatabase';

async function main() {
  console.log('\n============================================================');
  console.log('🚀 G4X Community — Operational Beta Database Bootstrap');
  console.log('============================================================\n');

  const args = process.argv.slice(2);
  const envArg = args.find((a) => a.startsWith('--env='));
  const customEnvPath = envArg ? envArg.slice('--env='.length) : undefined;

  const { loaded, filePath } = loadBetaEnvFile(customEnvPath);
  console.log(`[Bootstrap] Config File: ${loaded ? filePath : 'Default / process.env'}`);

  const validation = validateBetaEnvironment(process.env, { requireDiscordBotConfig: false });
  if (!validation.valid || !validation.resolvedDatabaseUrl) {
    console.error('❌ Environment validation failed:');
    for (const err of validation.errors) {
      console.error(`   - ${err}`);
    }
    process.exit(1);
  }

  console.log(`[Bootstrap] Target DB: ${validation.resolvedDatabasePath}`);
  console.log(`[Bootstrap] Initializing, migrating, and seeding beta database...`);

  const handle = await initializeBetaDatabase(validation.resolvedDatabaseUrl, { silent: false });

  console.log(`[Bootstrap] Verifying database integrity...`);
  const report = await handle.verifyIntegrity();
  console.log(`[Bootstrap] Integrity OK: ${report.integrityOk ? '✅ YES' : '❌ NO'}`);
  console.log(`[Bootstrap] FK Violations: ${report.fkViolationCount === 0 ? '✅ 0' : `❌ ${report.fkViolationCount}`}`);
  console.log(`[Bootstrap] Journal Mode:  ${report.walMode}`);

  await handle.disconnect();

  console.log('\n============================================================');
  console.log('✅ BETA BOOTSTRAP COMPLETE: Database is fully prepared for Beta');
  console.log('============================================================\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Bootstrap] Fatal error:', err?.message || err);
    process.exit(1);
  });
}
