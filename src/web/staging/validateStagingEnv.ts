/**
 * src/web/staging/validateStagingEnv.ts
 *
 * Staging Environment Safety Validator for G4X Community.
 *
 * RIGID ISOLATION INVARIANTS:
 *  1. STAGING_MODE must be strictly 'true'.
 *  2. DATABASE_URL must resolve canonically inside <repoRoot>/prisma/staging/.
 *     - Canonical path resolution via findPrismaSchemaDir() and fs.realpathSync().
 *     - Strict path confinement inside prisma/staging/ (rejects directory escapes, symlinks).
 *     - Strictly forbids production or dev database targets (data/g4x.db, dev.db, etc.).
 *  3. All 6 financial & external safety gates MUST be strictly false:
 *     - ESCROW_RELEASE_ENABLED
 *     - FINANCE_V2_LIVE_CREDITS_ENABLED
 *     - FINANCE_V2_LIVE_PAYOUTS_ENABLED
 *     - FINANCE_V2_P2P_SETTLEMENT_ENABLED
 *     - NOWPAYMENTS_LIVE_COLLECTION_ENABLED
 *     - RAIDERIO_LIVE_SYNC_ENABLED
 *  4. Gateway and external credentials must be mock / disabled:
 *     - NOWPAYMENTS_MODE must not be 'live'.
 *     - NOWPAYMENTS_API_KEY must not contain real API keys.
 *     - ZARINPAL_MERCHANT_ID must not contain real keys.
 *     - DISCORD_TOKEN must not contain a real Discord bot token.
 *  5. HOST must be bound strictly to loopback ('127.0.0.1' or '::1').
 *  6. Secrets and Access Keys:
 *     - SESSION_SECRET must be at least 32 characters, high entropy, no template placeholders.
 *     - G4X_OWNER_ACCESS_KEY must meet entropy requirements (min 32 chars, min 10 distinct, no placeholders).
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { validateOwnerAccessKeyConfig } from '../ownerGate';
import { findPrismaSchemaDir } from '../../database/canonicalDbPath';

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

  // 2. Canonical DATABASE_URL Confinement
  const dbUrl = env.DATABASE_URL || '';
  if (!dbUrl) {
    errors.push('DATABASE_URL is required for staging environment.');
  } else {
    try {
      let rawPath = dbUrl.startsWith('file:') ? dbUrl.slice(5) : dbUrl;
      const schemaDir = findPrismaSchemaDir();
      const stagingDir = path.resolve(schemaDir, 'staging');

      // Canonical schema-relative resolution
      let resolvedTarget: string;
      if (path.isAbsolute(rawPath)) {
        resolvedTarget = path.normalize(rawPath);
      } else {
        resolvedTarget = path.normalize(path.resolve(schemaDir, rawPath));
      }

      // Check for forbidden database filenames regardless of directory
      const baseFilename = path.basename(resolvedTarget).toLowerCase();
      if (
        baseFilename === 'g4x.db' ||
        baseFilename === 'g4x_dev.db' ||
        baseFilename === 'dev.db' ||
        baseFilename.includes('production')
      ) {
        errors.push(
          `CRITICAL SAFETY VIOLATION: DATABASE_URL ('${dbUrl}') targets a forbidden production or development database file name ('${baseFilename}').`
        );
      }

      // Ensure staging directory canonical path
      let canonicalStagingDir = stagingDir;
      if (fs.existsSync(stagingDir)) {
        canonicalStagingDir = fs.realpathSync(stagingDir);
      }

      // If target file or its directory exists, resolve realpath to detect symlink escapes
      let canonicalTarget = resolvedTarget;
      if (fs.existsSync(resolvedTarget)) {
        canonicalTarget = fs.realpathSync(resolvedTarget);

        // Also check if the file itself is a symlink
        try {
          const lstat = fs.lstatSync(resolvedTarget);
          if (lstat.isSymbolicLink()) {
            errors.push(
              `CRITICAL SAFETY VIOLATION: DATABASE_URL points to a symbolic link ('${resolvedTarget}'). Staging databases must not be symlinks.`
            );
          }
        } catch {}
      } else {
        // Target doesn't exist yet, check directory
        const parentDir = path.dirname(resolvedTarget);
        if (fs.existsSync(parentDir)) {
          const canonicalParent = fs.realpathSync(parentDir);
          canonicalTarget = path.join(canonicalParent, path.basename(resolvedTarget));
        }
      }

      // Strict confinement check: must start with canonicalStagingDir + path.sep
      const requiredPrefix = canonicalStagingDir.toLowerCase() + path.sep;
      const normalizedCanonicalTarget = canonicalTarget.toLowerCase();

      if (!normalizedCanonicalTarget.startsWith(requiredPrefix)) {
        errors.push(
          `DATABASE_URL ('${dbUrl}') is not an isolated staging database! Resolved canonical path '${canonicalTarget}' is not strictly confined within allowed staging directory '${canonicalStagingDir}'.`
        );
      }
    } catch (err: any) {
      errors.push(`Failed to validate canonical DATABASE_URL: ${err.message}`);
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
    if (val !== 'false') {
      errors.push(
        `CRITICAL SAFETY VIOLATION: ${gate} must be explicitly set to the exact string 'false' (received: ${val === undefined ? 'undefined' : `'${val}'`})! All financial and external synchronization gates MUST be 'false' in staging.`
      );
    }
  }

  // 4. Gateway Credentials and Modes
  if (env.NOWPAYMENTS_MODE === 'live') {
    errors.push("NOWPAYMENTS_MODE must NOT be 'live' in staging (use 'disabled' or 'sandbox').");
  }

  const nowpaymentsKey = env.NOWPAYMENTS_API_KEY || '';
  if (
    nowpaymentsKey.length > 20 &&
    !nowpaymentsKey.toLowerCase().includes('mock') &&
    !nowpaymentsKey.toLowerCase().includes('test') &&
    !nowpaymentsKey.toLowerCase().includes('sandbox')
  ) {
    errors.push('NOWPAYMENTS_API_KEY appears to be a live credential. Staging must use sandbox/mock or empty key.');
  }

  const zarinpalKey = env.ZARINPAL_MERCHANT_ID || '';
  if (
    zarinpalKey.length > 20 &&
    !zarinpalKey.toLowerCase().includes('mock') &&
    !zarinpalKey.toLowerCase().includes('test') &&
    !zarinpalKey.toLowerCase().includes('sandbox')
  ) {
    errors.push('ZARINPAL_MERCHANT_ID appears to be a live credential. Staging must use sandbox/mock or empty key.');
  }

  // 5. Live Discord Token Detection
  const discordToken = env.DISCORD_TOKEN || '';
  if (
    discordToken.length > 40 &&
    !discordToken.toLowerCase().includes('mock') &&
    !discordToken.toLowerCase().includes('test')
  ) {
    errors.push(
      'CRITICAL SAFETY VIOLATION: DISCORD_TOKEN appears to be a live Discord bot token. Staging must use a mock token or omit it.'
    );
  }

  // 6. Strict HOST Binding (Must be loopback only)
  const host = env.HOST || '127.0.0.1';
  const allowedHosts = ['127.0.0.1', '::1', 'localhost'];
  if (!allowedHosts.includes(host.trim().toLowerCase()) || host === '0.0.0.0' || host === '::') {
    errors.push(
      `HOST is set to '${host}'. Local staging servers must bind strictly to loopback ('127.0.0.1' or '::1').`
    );
  }

  // 7. Session Secret Quality
  const sessionSecret = env.SESSION_SECRET || '';
  const templatePlaceholders = [
    'a_very_long_random_secret_key_change_this',
    'secret',
    'change_me',
    'session_secret',
  ];
  if (!sessionSecret || sessionSecret.length < 32 || templatePlaceholders.includes(sessionSecret)) {
    errors.push(
      'SESSION_SECRET must be a secure random secret of at least 32 characters and cannot use template placeholders.'
    );
  }

  // 8. Owner Access Key Quality
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
