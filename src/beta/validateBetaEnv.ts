/**
 * src/beta/validateBetaEnv.ts
 *
 * Strict Operational Closed-Beta Environment Validator (v0.001).
 *
 * Security & Containment Invariants:
 *  1. Completely separate from disposable Discord Lab (`discordLabRunner`) and production (`src/index.ts`).
 *  2. Enforces `BETA_MODE=true`.
 *  3. Hard-locks all six live financial/external gates strictly to 'false' and `NOWPAYMENTS_MODE` != 'live'.
 *  4. Confines `DATABASE_URL` inside `<repoRoot>/prisma/staging/` (persistent beta DB e.g. `prisma/staging/beta_v0001.db`).
 *     Refuses production/development database names (`data/g4x.db`, `dev.db`, `g4x.db`, `g4x_dev.db`).
 *  5. Enforces invite-only allowlist configuration (`BETA_INVITE_ALLOWLIST_IDS` / `OWNER_DISCORD_ID`),
 *     strong `SESSION_SECRET`, strong `G4X_OWNER_ACCESS_KEY`, and valid `WITHDRAWAL_QUOTE_SIGNING_SECRET`.
 *  6. Enforces dedicated bot containment (`BETA_ALLOWED_GUILD_ID`, `BETA_APPLICATION_ID`, `BETA_BOT_TOKEN`)
 *     when running the Discord bot; never falls back to production `DISCORD_TOKEN`.
 *  7. Enforces non-public HTTP bind host (`127.0.0.1` by default; blocks wildcard `0.0.0.0` / `::`).
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { findPrismaSchemaDir } from '../database/canonicalDbPath';
import { validateWithdrawalQuoteSigningConfig } from '../services/financeV2/boosterWithdrawalService';

export interface BetaEnvValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  resolvedDatabasePath: string | null;
  resolvedDatabaseUrl: string | null;
  allowedGuildId: string | null;
  applicationId: string | null;
  botToken: string | null;
  host: string;
  port: number;
  inviteAllowlistIds: string[];
}

const SNOWFLAKE_RE = /^[1-9][0-9]{16,19}$/;

const FORBIDDEN_LIVE_GATES = [
  'FINANCE_V2_LIVE_CREDITS_ENABLED',
  'FINANCE_V2_P2P_SETTLEMENT_ENABLED',
  'NOWPAYMENTS_LIVE_COLLECTION_ENABLED',
  'ESCROW_RELEASE_ENABLED',
  'RAIDERIO_LIVE_SYNC_ENABLED',
] as const;

export function parseBetaInviteAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  const rawIds = [
    env.BETA_INVITE_ALLOWLIST_IDS || '',
    env.OWNER_DISCORD_ID || '',
  ]
    .join(',')
    .split(/[\s,;]+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return Array.from(new Set(rawIds));
}

export function validateBetaDatabaseUrl(databaseUrl: string | undefined): {
  valid: boolean;
  resolvedPath: string | null;
  canonicalUrl: string | null;
  error?: string;
} {
  if (!databaseUrl || !databaseUrl.startsWith('file:')) {
    return {
      valid: false,
      resolvedPath: null,
      canonicalUrl: null,
      error: `DATABASE_URL must be a SQLite file: URI confined inside prisma/staging/ (received: '${databaseUrl ?? 'UNDEFINED'}').`,
    };
  }

  let rawPath = databaseUrl.slice('file:'.length);
  const queryIdx = rawPath.indexOf('?');
  if (queryIdx !== -1) {
    rawPath = rawPath.slice(0, queryIdx);
  }
  if (!rawPath) {
    return {
      valid: false,
      resolvedPath: null,
      canonicalUrl: null,
      error: 'DATABASE_URL file path cannot be empty.',
    };
  }

  const schemaDir = findPrismaSchemaDir();
  const resolvedPath = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(schemaDir, rawPath);
  const stagingRoot = path.resolve(schemaDir, 'staging');

  const rel = path.relative(stagingRoot, resolvedPath);
  const isInsideStaging =
    rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);

  if (!isInsideStaging) {
    return {
      valid: false,
      resolvedPath,
      canonicalUrl: null,
      error: `DATABASE_URL ('${resolvedPath}') is outside confined staging root '${stagingRoot}'.`,
    };
  }

  const baseName = path.basename(resolvedPath).toLowerCase();
  const forbiddenBaseNames = new Set(['g4x.db', 'dev.db', 'g4x_dev.db', 'prod.db', 'production.db']);
  if (forbiddenBaseNames.has(baseName)) {
    return {
      valid: false,
      resolvedPath,
      canonicalUrl: null,
      error: `DATABASE_URL basename '${baseName}' is forbidden in Operational Beta mode.`,
    };
  }

  // Must not overwrite a temporary disposable Discord Lab database prefix
  if (baseName.startsWith('discord_lab_')) {
    return {
      valid: false,
      resolvedPath,
      canonicalUrl: null,
      error: `DATABASE_URL basename '${baseName}' belongs to disposable Discord Lab databases; persistent beta must use a dedicated persistent DB (e.g. beta_v0001.db).`,
    };
  }

  return {
    valid: true,
    resolvedPath,
    canonicalUrl: `file:${resolvedPath.replace(/\\/g, '/')}`,
  };
}

export function loadBetaEnvFile(
  customEnvPath?: string,
  options: { override?: boolean } = {}
): { loaded: boolean; filePath: string | null } {
  const candidates = customEnvPath
    ? [path.resolve(customEnvPath)]
    : [
        path.resolve(process.cwd(), '.env.beta.local'),
        path.resolve(process.cwd(), '.env.beta'),
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const parsed = dotenv.parse(fs.readFileSync(candidate, 'utf8'));
      for (const [k, v] of Object.entries(parsed)) {
        if (options.override || process.env[k] === undefined) {
          process.env[k] = v;
        }
      }
      return { loaded: true, filePath: candidate };
    }
  }
  return { loaded: false, filePath: null };
}

export function validateBetaEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: { requireDiscordBotConfig?: boolean; strictBotTokenRequired?: boolean } = {}
): BetaEnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (env.BETA_MODE !== 'true') {
    errors.push("BETA_MODE must be strictly 'true'.");
  }

  // Strictly block Disposable Discord Lab flag inside persistent beta runner
  if (env.DISCORD_LAB_MODE === 'true') {
    errors.push("DISCORD_LAB_MODE cannot be 'true' when running persistent Operational Beta (betaRunner).");
  }

  // Hard-lock all five live financial/external gates
  for (const gate of FORBIDDEN_LIVE_GATES) {
    const val = env[gate];
    if (val !== 'false') {
      errors.push(
        `Safety violation: '${gate}' must be strictly 'false' in G4X Operational Closed Beta v0.001 (got '${val ?? 'UNDEFINED'}').`
      );
    }
  }

  if (env.FINANCE_V2_LIVE_PAYOUTS_ENABLED === 'true') {
    warnings.push('FINANCE_V2_LIVE_PAYOUTS_ENABLED is true: Live wallet payout settlement is active for testing.');
  }

  const npMode = (env.NOWPAYMENTS_MODE || 'disabled').trim().toLowerCase();
  if (npMode === 'live' || (npMode !== 'disabled' && npMode !== 'off')) {
    errors.push(`NOWPAYMENTS_MODE must be 'disabled' in closed beta v0.001 (got '${env.NOWPAYMENTS_MODE}').`);
  }

  // Database containment verification
  const dbCheck = validateBetaDatabaseUrl(env.DATABASE_URL);
  if (!dbCheck.valid) {
    errors.push(dbCheck.error || 'Invalid BETA DATABASE_URL.');
  }

  // Secrets & Quote Signing Secret check
  if (!env.SESSION_SECRET || env.SESSION_SECRET.trim().length < 24) {
    errors.push('SESSION_SECRET must be set to a cryptographically strong value (>= 24 chars).');
  }
  if (!env.G4X_OWNER_ACCESS_KEY || env.G4X_OWNER_ACCESS_KEY.trim().length < 16) {
    errors.push('G4X_OWNER_ACCESS_KEY must be set to a strong key (>= 16 chars).');
  }

  const quoteConfigCheck = validateWithdrawalQuoteSigningConfig(env.WITHDRAWAL_QUOTE_SIGNING_SECRET);
  if (!quoteConfigCheck.valid) {
    errors.push(quoteConfigCheck.reason || 'Invalid WITHDRAWAL_QUOTE_SIGNING_SECRET.');
  }

  // Invite-only Allowlist check
  const inviteAllowlistIds = parseBetaInviteAllowlist(env);
  if (inviteAllowlistIds.length === 0) {
    errors.push('BETA_INVITE_ALLOWLIST_IDS (or OWNER_DISCORD_ID) must contain at least one invited Discord ID.');
  } else {
    for (const id of inviteAllowlistIds) {
      if (!SNOWFLAKE_RE.test(id)) {
        errors.push(`Invalid Discord ID '${id}' in BETA_INVITE_ALLOWLIST_IDS / OWNER_DISCORD_ID.`);
      }
    }
  }

  // Non-public network bind check
  const host = (env.BETA_HOST || env.HOST || '127.0.0.1').trim();
  const lowerHost = host.toLowerCase();
  if (lowerHost === '0.0.0.0' || lowerHost === '::' || lowerHost === '[::]') {
    errors.push(`Public wildcard bind host '${host}' is forbidden in Closed Beta v0.001. Bind to 127.0.0.1 or a private tunnel/Tailscale interface.`);
  }

  const parsedPort = Number(env.BETA_PORT || env.PORT || 3002);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    errors.push(`Invalid BETA_PORT/PORT '${env.BETA_PORT || env.PORT}'.`);
  }

  // Discord bot containment config (supports BETA_* and DISCORD_* aliases; never falls back to production DISCORD_TOKEN)
  const requireDiscord = options.requireDiscordBotConfig ?? (env.BETA_DISCORD_ENABLED === 'true');
  const botToken = (env.BETA_BOT_TOKEN || env.DISCORD_BOT_TOKEN || '').trim() || null;
  const allowedGuildId = (env.BETA_ALLOWED_GUILD_ID || env.DISCORD_GUILD_ID || '').trim() || null;
  const applicationId = (env.BETA_APPLICATION_ID || env.DISCORD_CLIENT_ID || '').trim() || null;

  if (requireDiscord) {
    if (!botToken || botToken.length < 20) {
      errors.push('BETA_BOT_TOKEN (or DISCORD_BOT_TOKEN) is required when Beta Discord bot is enabled (never falls back to DISCORD_TOKEN).');
    } else if (env.DISCORD_TOKEN && botToken === env.DISCORD_TOKEN.trim()) {
      errors.push('BETA_BOT_TOKEN / DISCORD_BOT_TOKEN cannot match production DISCORD_TOKEN.');
    }

    if (!allowedGuildId || !SNOWFLAKE_RE.test(allowedGuildId)) {
      errors.push(`BETA_ALLOWED_GUILD_ID ('${allowedGuildId ?? 'UNDEFINED'}') must be a valid Discord Guild ID.`);
    }

    if (!applicationId || !SNOWFLAKE_RE.test(applicationId)) {
      errors.push(`BETA_APPLICATION_ID ('${applicationId ?? 'UNDEFINED'}') must be a valid Discord Application ID.`);
    }
  } else if (botToken && (!allowedGuildId || !applicationId)) {
    warnings.push('BETA_BOT_TOKEN is present without complete guild/application IDs; Discord bot will remain offline.');
  }

  if (env.BETA_OAUTH_ENABLED !== 'false') {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI) {
      warnings.push('Discord OAuth2 credentials (DISCORD_CLIENT_ID / SECRET / REDIRECT_URI) are not fully set.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    resolvedDatabasePath: dbCheck.resolvedPath,
    resolvedDatabaseUrl: dbCheck.canonicalUrl,
    allowedGuildId,
    applicationId,
    botToken,
    host,
    port: parsedPort,
    inviteAllowlistIds,
  };
}
