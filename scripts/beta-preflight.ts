/**
 * scripts/beta-preflight.ts
 *
 * Preflight Safety Verification for G4X Operational Closed Beta v0.001.
 *
 * Verifies all security & isolation invariants WITHOUT starting live Discord,
 * without accessing production databases, and without leaking any secret values:
 *  1. Operator environment file (.env.beta.local) exists and is NOT tracked by Git.
 *  2. Confinement of DATABASE_URL strictly within <repoRoot>/prisma/staging/ (e.g. beta_v0001.db).
 *  3. All six financial & external synchronization safety gates strictly 'false'.
 *  4. NOWPAYMENTS_MODE strictly 'disabled'.
 *  5. Local loopback network binding (BETA_HOST=127.0.0.1; forbids 0.0.0.0 / ::).
 *  6. Strong cryptographic secrets (SESSION_SECRET, G4X_OWNER_ACCESS_KEY, WITHDRAWAL_QUOTE_SIGNING_SECRET)
 *     verified by entropy/length without ever printing or logging their plaintext values.
 *  7. Closed-Beta invite allowlist containing valid Discord snowflakes.
 *
 * Usage:
 *   npx ts-node scripts/beta-preflight.ts [--env=<path>]
 *   npm run beta:preflight
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  loadBetaEnvFile,
  validateBetaEnvironment,
  BetaEnvValidationResult,
} from '../src/beta/validateBetaEnv';

export function runBetaPreflight(customPath?: string): {
  success: boolean;
  validation: BetaEnvValidationResult;
  isGitTracked: boolean;
} {
  console.log('\n============================================================');
  console.log('🚀 G4X Community — Operational Closed Beta v0.001 Preflight');
  console.log('============================================================\n');

  const { loaded, filePath } = loadBetaEnvFile(customPath);
  console.log('[Preflight] 1. Beta Environment File:');
  let isGitTracked = false;

  if (loaded && filePath) {
    const normPath = filePath.replace(/\\/g, '/');
    console.log(`  - File: ${normPath}`);

    // Verify git tracking status
    const gitCheck = spawnSync('git', ['status', '--porcelain', filePath], {
      encoding: 'utf8',
    });
    // If tracked by git and modified/committed
    const lsFilesCheck = spawnSync('git', ['ls-files', filePath], {
      encoding: 'utf8',
    });
    isGitTracked = (lsFilesCheck.stdout || '').trim().length > 0;

    if (isGitTracked) {
      console.error('  - Git Status: ❌ TRACKED BY GIT (INSECURE! Must be git-ignored)');
    } else {
      console.log('  - Git Status: ✅ SECURE (Not tracked by Git)');
    }
  } else {
    console.log('  - Status: ⚠️ No .env.beta.local or .env.beta found; relying on process.env');
  }

  const validation = validateBetaEnvironment(process.env, {
    requireDiscordBotConfig: process.env.BETA_DISCORD_ENABLED === 'true',
  });

  console.log('\n[Preflight] 2. Network & Loopback Binding:');
  console.log(`  - Host: ${validation.host}`);
  console.log(`  - Port: ${validation.port}`);
  if (validation.host === '127.0.0.1' || validation.host === 'localhost') {
    console.log('  - Loopback: ✅ SECURE (Bound strictly to local interface)');
  } else {
    console.log('  - Loopback: ⚠️ NON-DEFAULT HOST');
  }

  console.log('\n[Preflight] 3. Database Confinement:');
  console.log(`  - Resolved DB Path: ${validation.resolvedDatabasePath?.replace(/\\/g, '/') ?? 'NONE'}`);
  console.log(`  - Canonical URL:    ${validation.resolvedDatabaseUrl ?? 'NONE'}`);

  console.log('\n[Preflight] 4. Mandatory Safety Gates (Lockdown):');
  const gates = [
    'ESCROW_RELEASE_ENABLED',
    'FINANCE_V2_LIVE_CREDITS_ENABLED',
    'FINANCE_V2_LIVE_PAYOUTS_ENABLED',
    'FINANCE_V2_P2P_SETTLEMENT_ENABLED',
    'NOWPAYMENTS_LIVE_COLLECTION_ENABLED',
    'RAIDERIO_LIVE_SYNC_ENABLED',
  ];
  for (const g of gates) {
    const val = process.env[g];
    console.log(`  - ${g}: ${val === 'false' ? '🔒 false (LOCKED)' : `❌ ${val ?? 'UNDEFINED'}`}`);
  }
  console.log(`  - NOWPAYMENTS_MODE: ${(process.env.NOWPAYMENTS_MODE || 'disabled') === 'disabled' ? '🔒 disabled' : `❌ ${process.env.NOWPAYMENTS_MODE}`}`);

  console.log('\n[Preflight] 5. Invite-Only Allowlist:');
  console.log(`  - Configured IDs Count: ${validation.inviteAllowlistIds.length}`);

  console.log('\n[Preflight] 6. Discord Bot Containment:');
  const discordEnabled = process.env.BETA_DISCORD_ENABLED === 'true';
  console.log(`  - Discord Gateway Bot: ${discordEnabled ? 'ACTIVE (containment enabled)' : 'OFFLINE (disabled for web-only preflight)'}`);

  const success = validation.valid && !isGitTracked;

  console.log('\n============================================================');
  if (success) {
    console.log('✅ PREFLIGHT RESULT: PASS — Ready for Operational Beta Runner');
  } else {
    console.log('❌ PREFLIGHT RESULT: FAIL');
    for (const err of validation.errors) {
      console.log(`   - Error: ${err}`);
    }
    if (isGitTracked) {
      console.log('   - Error: Environment file containing secrets must NOT be committed to git.');
    }
  }
  console.log('============================================================\n');

  return { success, validation, isGitTracked };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const envArg = args.find((a) => a.startsWith('--env='));
  const customPath = envArg ? envArg.slice('--env='.length) : undefined;
  const result = runBetaPreflight(customPath);
  process.exit(result.success ? 0 : 1);
}
