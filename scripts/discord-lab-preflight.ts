/**
 * scripts/discord-lab-preflight.ts
 *
 * Preflight Safety Verification for G4X Discord Lab Integration.
 *
 * Verifies all 8 safety dimensions WITHOUT starting any live Discord connection:
 *  1. Operator-managed external/git-ignored environment file.
 *  2. Confined, disposable SQLite database inside prisma/staging/.
 *  3. All six financial & external synchronization safety gates strictly 'false'.
 *  4. Dedicated test Guild ID allowlist (valid Snowflake, non-placeholder).
 *  5. Local loopback binding (HOST=127.0.0.1).
 *  6. Kill switch status (inactive).
 *  7. Credential format verification without leaking or printing values.
 *  8. Refusal to run in production NODE_ENV.
 *
 * Usage:
 *   npx ts-node scripts/discord-lab-preflight.ts [--env-file <path>]
 *   npm run discord-lab:preflight
 */

import {
  loadDiscordLabEnvironment,
  resolveDiscordLabEnvFile,
} from '../src/discord-lab/discordLabConfig';
import { validateDiscordLabEnvironment } from '../src/discord-lab/validateDiscordLabEnv';
import { checkKillSwitch } from '../src/discord-lab/discordLabKillSwitch';

export function runDiscordLabPreflight(customPath?: string): {
  success: boolean;
  errors: string[];
  warnings: string[];
} {
  console.log('\n============================================================');
  console.log('🧪 G4X Community — Safe Live Discord Lab Preflight Checker');
  console.log('============================================================\n');

  // 1. Resolve environment file
  const envResolution = resolveDiscordLabEnvFile(customPath);
  console.log('[Preflight] 1. Operator Environment File:');
  if (envResolution.exists && envResolution.filePath) {
    console.log(`  - Location: ${envResolution.filePath}`);
    console.log(`  - Outside Repository: ${envResolution.isExternal ? 'YES' : 'NO'}`);
    console.log(`  - Git Tracked: ${envResolution.isGitTracked ? '❌ YES (INSECURE)' : '✅ NO (SECURE)'}`);
    if (envResolution.isGitTracked) {
      console.error(`  - ERROR: ${envResolution.error}`);
    }
  } else {
    console.log(`  - Status: ⚠️ Not found in standard locations`);
    console.log(`  - Notice: ${envResolution.error}`);
  }

  // Load into process.env if available
  loadDiscordLabEnvironment(customPath);

  // Set DISCORD_LAB_MODE if not explicitly set (preflight evaluation context)
  if (!process.env.DISCORD_LAB_MODE) {
    process.env.DISCORD_LAB_MODE = 'true';
  }

  // Ensure database URL points to staging if not set
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'file:./staging/discord_lab_preflight.db';
  }

  // 2. Run Comprehensive Validation
  const validation = validateDiscordLabEnvironment(process.env, {
    requireToken: false, // In preflight, we verify token format if present, but do not block structural check if missing
  });

  console.log('\n[Preflight] 2. Host & Network Binding:');
  console.log(`  - Host: ${validation.sanitizedSummary.host} (Loopback only: ${validation.sanitizedSummary.host === '127.0.0.1' || validation.sanitizedSummary.host === '::1' ? '✅' : '❌'})`);

  console.log('\n[Preflight] 3. Database Confinement:');
  console.log(`  - Target: ${validation.sanitizedSummary.canonicalDatabasePath || 'Pending dynamic allocation'}`);
  console.log(`  - Staging Confined: ${validation.errors.some((e) => e.includes('DATABASE_URL')) ? '❌' : '✅'}`);

  console.log('\n[Preflight] 4. Six Financial & External Safety Gates:');
  for (const [gate, val] of Object.entries(validation.sanitizedSummary.gatesStatus)) {
    const isOk = val === 'false';
    console.log(`  - ${gate}: '${val}' ${isOk ? '✅' : '❌ CRITICAL VIOLATION'}`);
  }

  console.log('\n[Preflight] 5. Dedicated Test Guild Allowlist:');
  console.log(`  - Allowed Guild ID: ${validation.sanitizedSummary.allowedGuildId}`);
  console.log(`  - Application ID: ${validation.sanitizedSummary.applicationId ?? 'Not specified'}`);
  console.log(`  - Allowlist Validated: ${validation.errors.some((e) => e.includes('GUILD_ID')) ? '❌' : '✅'}`);

  console.log('\n[Preflight] 6. Emergency Kill Switch Status:');
  const killStatus = checkKillSwitch();
  if (killStatus.active) {
    console.log(`  - Kill Switch: ❌ ACTIVE (${killStatus.reason})`);
  } else {
    console.log('  - Kill Switch: ✅ INACTIVE (Ready for testing)');
  }

  console.log('\n[Preflight] 7. Bot Credential Status:');
  console.log(`  - Token Configured: ${validation.sanitizedSummary.tokenConfigured ? '✅ YES (Format verified, value masked)' : '⚠️ Not configured yet'}`);

  console.log('\n------------------------------------------------------------');
  if (validation.valid && !envResolution.isGitTracked && !killStatus.active) {
    console.log('✅ PREFLIGHT VERIFICATION: PASSED');
    console.log('All safety controls, isolation gates, and allowlists are properly configured.');
    console.log('NOTE: Live Discord bot connection has NOT been started.');
    console.log('------------------------------------------------------------\n');
    return { success: true, errors: [], warnings: validation.warnings };
  } else {
    console.error('❌ PREFLIGHT VERIFICATION: FAILED');
    const allErrors = [
      ...(envResolution.isGitTracked && envResolution.error ? [envResolution.error] : []),
      ...validation.errors,
    ];
    allErrors.forEach((e) => console.error(`  - ${e}`));
    console.log('------------------------------------------------------------\n');
    return { success: false, errors: allErrors, warnings: validation.warnings };
  }
}

// CLI Execution
if (require.main === module) {
  const result = runDiscordLabPreflight();
  process.exit(result.success ? 0 : 1);
}
