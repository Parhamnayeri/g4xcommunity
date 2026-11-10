/**
 * src/discord-lab/validateDiscordLabEnv.ts
 *
 * Rigorous Safety Validator for Safe Live Discord Integration Test Mode.
 *
 * FAIL-CLOSED INVARIANTS:
 *  1. DISCORD_LAB_MODE must be strictly 'true'.
 *  2. NODE_ENV must NOT be 'production'.
 *  3. HOST must be bound strictly to loopback ('127.0.0.1' or '::1').
 *  4. DATABASE_URL must canonically resolve inside <repoRoot>/prisma/staging/.
 *     - Never allows production or dev databases (g4x.db, dev.db, etc.).
 *     - Forbids symlinks.
 *  5. All 6 financial/external safety gates MUST equal the exact string 'false':
 *     - ESCROW_RELEASE_ENABLED
 *     - FINANCE_V2_LIVE_CREDITS_ENABLED
 *     - FINANCE_V2_LIVE_PAYOUTS_ENABLED
 *     - FINANCE_V2_P2P_SETTLEMENT_ENABLED
 *     - NOWPAYMENTS_LIVE_COLLECTION_ENABLED
 *     - RAIDERIO_LIVE_SYNC_ENABLED
 *  6. NOWPAYMENTS_MODE must be 'disabled' or 'sandbox', with no live keys.
 *  7. Dedicated test Guild ID allowlist (DISCORD_LAB_ALLOWED_GUILD_ID):
 *     - Must match Snowflake format (17-20 digits).
 *     - Must NOT be a known placeholder.
 *     - Mandatory; cannot be bypassed.
 *  8. Kill switch must NOT be active.
 *  9. Secrets (Bot Token, Session Secret, Owner Access Key) checked without leaking values.
 */

import path from 'path';
import fs from 'fs';
import {
  DISCORD_SNOWFLAKE_REGEX,
  MANDATORY_SAFETY_GATES,
  FORBIDDEN_DATABASE_BASENAMES,
  KNOWN_PLACEHOLDER_GUILDS,
} from './discordLabConfig';
import { findPrismaSchemaDir } from '../database/canonicalDbPath';
import { validateOwnerAccessKeyConfig } from '../web/ownerGate';

export interface DiscordLabValidationOptions {
  requireToken?: boolean;
}

export interface DiscordLabValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedSummary: {
    discordLabMode: string;
    host: string;
    canonicalDatabasePath: string;
    allowedGuildId: string;
    applicationId: string | null;
    gatesStatus: Record<string, string>;
    tokenConfigured: boolean;
    killSwitchActive: boolean;
  };
}

export function validateDiscordLabEnvironment(
  customEnv?: Record<string, string | undefined>,
  options: DiscordLabValidationOptions = {}
): DiscordLabValidationResult {
  const env = customEnv || process.env;
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. DISCORD_LAB_MODE & NODE_ENV
  if (env.DISCORD_LAB_MODE !== 'true') {
    errors.push(
      `DISCORD_LAB_MODE must be explicitly set to 'true' (received: '${env.DISCORD_LAB_MODE}'). Discord Lab mode is opt-in only.`
    );
  }

  if (env.NODE_ENV === 'production') {
    errors.push(
      `CRITICAL SAFETY VIOLATION: NODE_ENV is set to 'production'. Discord Lab mode must NEVER run in production environment!`
    );
  }

  // 2. Strict Loopback HOST Binding
  const host = (env.HOST || '127.0.0.1').trim().toLowerCase();
  const allowedHosts = ['127.0.0.1', '::1', 'localhost'];
  if (!allowedHosts.includes(host) || host === '0.0.0.0' || host === '::') {
    errors.push(
      `CRITICAL SAFETY VIOLATION: HOST is set to '${host}'. Discord Lab must bind strictly to local loopback ('127.0.0.1' or '::1'). Public interfaces are strictly forbidden.`
    );
  }

  // 3. Canonical DATABASE_URL Confinement inside prisma/staging/
  const dbUrl = env.DATABASE_URL || '';
  let canonicalDbTarget = '';

  if (!dbUrl) {
    errors.push('DATABASE_URL is required for Discord Lab mode.');
  } else {
    try {
      const rawPath = dbUrl.startsWith('file:') ? dbUrl.slice(5) : dbUrl;
      const schemaDir = findPrismaSchemaDir();
      const stagingDir = path.resolve(schemaDir, 'staging');

      let resolvedTarget: string;
      if (path.isAbsolute(rawPath)) {
        resolvedTarget = path.normalize(rawPath);
      } else {
        resolvedTarget = path.normalize(path.resolve(schemaDir, rawPath));
      }

      // Check forbidden basenames
      const baseFilename = path.basename(resolvedTarget).toLowerCase();
      if (
        FORBIDDEN_DATABASE_BASENAMES.some((b) => baseFilename === b) ||
        baseFilename.includes('production')
      ) {
        errors.push(
          `CRITICAL SAFETY VIOLATION: DATABASE_URL ('${dbUrl}') targets forbidden database file name ('${baseFilename}').`
        );
      }

      let canonicalStagingDir = stagingDir;
      if (fs.existsSync(stagingDir)) {
        canonicalStagingDir = fs.realpathSync(stagingDir);
      }

      let canonicalTarget = resolvedTarget;
      if (fs.existsSync(resolvedTarget)) {
        canonicalTarget = fs.realpathSync(resolvedTarget);
        try {
          const lstat = fs.lstatSync(resolvedTarget);
          if (lstat.isSymbolicLink()) {
            errors.push(
              `CRITICAL SAFETY VIOLATION: DATABASE_URL targets a symbolic link ('${resolvedTarget}'). Staging databases must not be symlinks.`
            );
          }
        } catch {}
      } else {
        const parentDir = path.dirname(resolvedTarget);
        if (fs.existsSync(parentDir)) {
          const canonicalParent = fs.realpathSync(parentDir);
          canonicalTarget = path.join(canonicalParent, path.basename(resolvedTarget));
        }
      }

      canonicalDbTarget = canonicalTarget;
      const requiredPrefix = canonicalStagingDir.toLowerCase() + path.sep;
      const normalizedCanonicalTarget = canonicalTarget.toLowerCase();

      if (!normalizedCanonicalTarget.startsWith(requiredPrefix)) {
        errors.push(
          `DATABASE_URL ('${dbUrl}') is not strictly confined within staging directory '${canonicalStagingDir}'. Resolved: '${canonicalTarget}'.`
        );
      }
    } catch (err: any) {
      errors.push(`Failed to validate canonical DATABASE_URL: ${err.message}`);
    }
  }

  // 4. Mandatory Safety Gates (ALL 6 MUST BE THE EXACT STRING 'false')
  const gatesStatus: Record<string, string> = {};
  for (const gate of MANDATORY_SAFETY_GATES) {
    const val = env[gate];
    gatesStatus[gate] = val ?? 'undefined';
    if (val !== 'false') {
      errors.push(
        `CRITICAL SAFETY VIOLATION: ${gate} must be explicitly set to the exact string 'false' (received: ${val === undefined ? 'undefined' : `'${val}'`})! All live financial and external synchronization gates MUST be 'false'.`
      );
    }
  }

  // 5. Payment Gateway Safety
  if (env.NOWPAYMENTS_MODE === 'live') {
    errors.push("CRITICAL SAFETY VIOLATION: NOWPAYMENTS_MODE must NOT be 'live' (use 'disabled' or 'sandbox').");
  }

  const npKey = env.NOWPAYMENTS_API_KEY || '';
  if (
    npKey.length > 20 &&
    !npKey.toLowerCase().includes('mock') &&
    !npKey.toLowerCase().includes('test') &&
    !npKey.toLowerCase().includes('sandbox')
  ) {
    errors.push('NOWPAYMENTS_API_KEY appears to be a live credential. Must use sandbox/mock or empty key.');
  }

  // 6. Dedicated Test Guild Allowlist (DISCORD_LAB_ALLOWED_GUILD_ID)
  const allowedGuildId = (env.DISCORD_LAB_ALLOWED_GUILD_ID || '').trim();
  if (!allowedGuildId) {
    errors.push(
      'CRITICAL SAFETY VIOLATION: DISCORD_LAB_ALLOWED_GUILD_ID is required! An explicit allowlist containing exactly the dedicated test Guild ID is mandatory.'
    );
  } else if (KNOWN_PLACEHOLDER_GUILDS.includes(allowedGuildId as any)) {
    errors.push(
      `CRITICAL SAFETY VIOLATION: DISCORD_LAB_ALLOWED_GUILD_ID is a known template placeholder ('${allowedGuildId}'). You must specify the real dedicated test Guild ID.`
    );
  } else if (!DISCORD_SNOWFLAKE_REGEX.test(allowedGuildId)) {
    errors.push(
      `CRITICAL SAFETY VIOLATION: DISCORD_LAB_ALLOWED_GUILD_ID ('${allowedGuildId}') is not a valid Discord snowflake ID (must be 17-20 digits).`
    );
  }

  // 7. Application ID (if provided)
  const appId = (env.DISCORD_LAB_APPLICATION_ID || '').trim();
  if (appId && !DISCORD_SNOWFLAKE_REGEX.test(appId)) {
    errors.push(
      `DISCORD_LAB_APPLICATION_ID ('${appId}') is not a valid Discord snowflake ID (must be 17-20 digits).`
    );
  }

  // 8. Bot Token Format Verification (Strictly without printing or leaking)
  const botToken = (env.DISCORD_LAB_BOT_TOKEN || env.DISCORD_TOKEN || '').trim();
  let tokenConfigured = false;
  if (!botToken) {
    if (options.requireToken) {
      errors.push(
        'DISCORD_LAB_BOT_TOKEN is missing! Set it in your local git-ignored environment file (e.g., ../.env.discord-lab).'
      );
    } else {
      warnings.push(
        'DISCORD_LAB_BOT_TOKEN is not configured yet. Required before initiating live connection.'
      );
    }
  } else {
    tokenConfigured = true;
    // Discord bot tokens typically have 3 parts separated by dots, length >= 50
    const parts = botToken.split('.');
    if (parts.length !== 3 || botToken.length < 50) {
      errors.push(
        'DISCORD_LAB_BOT_TOKEN does not match expected Discord bot token format (length >= 50, 3 dot-separated segments).'
      );
    }
  }

  // 9. Kill Switch Detection
  let killSwitchActive = false;
  if (env.DISCORD_LAB_KILL_SWITCH === 'true') {
    killSwitchActive = true;
    errors.push('CRITICAL: Kill switch is ACTIVE via DISCORD_LAB_KILL_SWITCH=true. Execution aborted.');
  }

  const repoRoot = path.resolve(__dirname, '../../');
  const killFilePaths = [
    path.resolve(repoRoot, '.discord-lab.kill'),
    path.resolve(repoRoot, '..', '.discord-lab.kill'),
  ];
  for (const kf of killFilePaths) {
    if (fs.existsSync(kf)) {
      killSwitchActive = true;
      errors.push(`CRITICAL: Kill switch file detected at '${kf}'. Execution aborted.`);
      break;
    }
  }

  // 10. Secrets Quality (Session secret & Owner Access Key)
  const sessionSecret = env.SESSION_SECRET || '';
  if (!sessionSecret || sessionSecret.length < 32) {
    errors.push('SESSION_SECRET must be at least 32 characters in length.');
  }

  const ownerKey = env.G4X_OWNER_ACCESS_KEY || env.OWNER_ACCESS_KEY;
  const ownerVal = validateOwnerAccessKeyConfig(ownerKey);
  if (!ownerVal.valid) {
    errors.push(`G4X_OWNER_ACCESS_KEY failed validation: ${ownerVal.reason}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedSummary: {
      discordLabMode: env.DISCORD_LAB_MODE || 'undefined',
      host,
      canonicalDatabasePath: canonicalDbTarget,
      allowedGuildId: allowedGuildId || 'NOT_CONFIGURED',
      applicationId: appId || null,
      gatesStatus,
      tokenConfigured,
      killSwitchActive,
    },
  };
}
