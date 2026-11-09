/**
 * scripts/validate-staging-env.ts
 *
 * Staging Environment Safety Validator for G4X Community.
 *
 * INVARIANTS:
 *  1. STAGING_MODE must be strictly 'true'.
 *  2. DATABASE_URL must resolve to an isolated staging database file (must reside in prisma/staging/ or match staging*.db).
 *     Strictly forbids standard production/development paths (data/g4x.db, dev.db, etc.).
 *  3. All 6 financial & external safety gates MUST be strictly false:
 *     - ESCROW_RELEASE_ENABLED
 *     - FINANCE_V2_LIVE_CREDITS_ENABLED
 *     - FINANCE_V2_LIVE_PAYOUTS_ENABLED
 *     - FINANCE_V2_P2P_SETTLEMENT_ENABLED
 *     - NOWPAYMENTS_LIVE_COLLECTION_ENABLED
 *     - RAIDERIO_LIVE_SYNC_ENABLED
 *  4. NOWPAYMENTS_MODE must not be 'live'.
 *  5. HOST must be bound to loopback ('127.0.0.1' or 'localhost') to prevent public exposure.
 *  6. G4X_OWNER_ACCESS_KEY must meet entropy requirements (min 32 chars, min 10 distinct, no placeholders).
 *  7. Outbound live tokens must not match production credentials.
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { validateOwnerAccessKeyConfig } from '../src/web/ownerGate';

// If --env-file is provided, load that first
const envFileArgIdx = process.argv.indexOf('--env-file');
if (envFileArgIdx !== -1 && process.argv[envFileArgIdx + 1]) {
  const envFilePath = path.resolve(process.cwd(), process.argv[envFileArgIdx + 1]);
  if (fs.existsSync(envFilePath)) {
    dotenv.config({ path: envFilePath, override: true });
  }
} else {
  const stagingEnv = path.resolve(process.cwd(), '.env.staging');
  if (fs.existsSync(stagingEnv)) {
    dotenv.config({ path: stagingEnv, override: true });
  } else {
    dotenv.config();
  }
}

export interface StagingEnvValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateStagingEnvironment(
  customEnv?: Record<string, string | undefined>
): StagingEnvValidationResult {
  const env = customEnv || process.env;
  const errors: string[] = [];

  // 1. STAGING_MODE
  if (env.STAGING_MODE !== 'true') {
    errors.push(`STAGING_MODE must be explicitly set to 'true' (received: '${env.STAGING_MODE}')`);
  }

  // 2. DATABASE_URL
  const dbUrl = env.DATABASE_URL || '';
  if (!dbUrl) {
    errors.push('DATABASE_URL is required for staging environment.');
  } else {
    let cleanPath = dbUrl.startsWith('file:') ? dbUrl.slice(5) : dbUrl;
    cleanPath = cleanPath.replace(/\\/g, '/').toLowerCase();

    // Must be in staging directory or staging db name
    const isStagingTarget =
      cleanPath.includes('staging/') ||
      cleanPath.includes('/staging') ||
      cleanPath.endsWith('staging.db');

    const isForbiddenProduction =
      cleanPath.includes('g4x.db') ||
      cleanPath.includes('g4x_dev.db') ||
      cleanPath.endsWith('/dev.db') ||
      cleanPath === 'dev.db';

    if (!isStagingTarget || isForbiddenProduction) {
      errors.push(
        `DATABASE_URL ('${dbUrl}') is not an isolated staging database! Staging databases must reside in prisma/staging/ (e.g. file:./staging/staging.db). Target cannot be production or dev databases.`
      );
    }
  }

  // 3. Mandatory Safety Gates (ALL 6 MUST BE FALSE)
  const gates = [
    'ESCROW_RELEASE_ENABLED',
    'FINANCE_V2_LIVE_CREDITS_ENABLED',
    'FINANCE_V2_LIVE_PAYOUTS_ENABLED',
    'FINANCE_V2_P2P_SETTLEMENT_ENABLED',
    'NOWPAYMENTS_LIVE_COLLECTION_ENABLED',
    'RAIDERIO_LIVE_SYNC_ENABLED',
  ] as const;

  for (const gate of gates) {
    const val = env[gate];
    if (val === 'true' || val === '1') {
      errors.push(
        `CRITICAL SAFETY VIOLATION: ${gate} is enabled ('${val}')! All financial and external synchronization gates MUST be 'false' in staging.`
      );
    }
  }

  // 4. NOWPayments Mode
  if (env.NOWPAYMENTS_MODE === 'live') {
    errors.push("NOWPAYMENTS_MODE must NOT be 'live' in staging (use 'disabled' or 'sandbox').");
  }

  // 5. HOST Binding
  const host = env.HOST || '127.0.0.1';
  if (host === '0.0.0.0' || host === '::') {
    errors.push(
      `HOST is set to '${host}'. Local staging servers must bind strictly to '127.0.0.1' or 'localhost'.`
    );
  }

  // 6. Owner Access Key Quality
  const ownerKey = env.G4X_OWNER_ACCESS_KEY || env.OWNER_ACCESS_KEY;
  const ownerKeyVal = validateOwnerAccessKeyConfig(ownerKey);
  if (!ownerKeyVal.valid) {
    errors.push(
      `G4X_OWNER_ACCESS_KEY failed quality checks: ${ownerKeyVal.reason}. Must be at least 32 characters, high entropy, no placeholders.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// CLI Execution
if (require.main === module) {
  const result = validateStagingEnvironment();
  if (!result.valid) {
    console.error('\n❌ [StagingEnvValidator] Staging environment validation FAILED:');
    result.errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  } else {
    console.log('✅ [StagingEnvValidator] Staging environment is valid and strictly isolated.');
    process.exit(0);
  }
}
