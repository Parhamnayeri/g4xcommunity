/**
 * src/discord-lab/discordLabConfig.ts
 *
 * Safe Live Discord Integration Test Mode Configuration & Environment Resolution.
 *
 * Invariants:
 *  1. Local machine only (HOST = 127.0.0.1 or ::1).
 *  2. Disposable staging SQLite database strictly inside <repoRoot>/prisma/staging/.
 *  3. Explicit dedicated test Guild ID allowlist (Snowflake 17-20 digits).
 *  4. All six financial/external safety gates strictly 'false'.
 *  5. Operator-managed external/git-ignored credentials file.
 *  6. Kill switch detection.
 */

import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import { findPrismaSchemaDir } from '../database/canonicalDbPath';

export const DISCORD_SNOWFLAKE_REGEX = /^[1-9][0-9]{16,19}$/;

export const MANDATORY_SAFETY_GATES = [
  'ESCROW_RELEASE_ENABLED',
  'FINANCE_V2_LIVE_CREDITS_ENABLED',
  'FINANCE_V2_LIVE_PAYOUTS_ENABLED',
  'FINANCE_V2_P2P_SETTLEMENT_ENABLED',
  'NOWPAYMENTS_LIVE_COLLECTION_ENABLED',
  'RAIDERIO_LIVE_SYNC_ENABLED',
] as const;

export type MandatorySafetyGate = (typeof MANDATORY_SAFETY_GATES)[number];

export const FORBIDDEN_DATABASE_BASENAMES = [
  'g4x.db',
  'g4x_dev.db',
  'dev.db',
  'production.db',
  'prod.db',
] as const;

export const KNOWN_PLACEHOLDER_GUILDS = [
  '123456789012345678',
  '000000000000000000',
  '111111111111111111',
  '999999999999999999',
] as const;

export interface ExternalEnvFileResolution {
  filePath: string | null;
  exists: boolean;
  isExternal: boolean;
  isGitTracked: boolean;
  error?: string;
}

/**
 * Checks whether a given file path is tracked by git.
 * Fails safely if git command is unavailable or file is outside git root.
 */
export function isPathGitTracked(absoluteFilePath: string): boolean {
  try {
    const repoRoot = path.resolve(__dirname, '../../');
    const relative = path.relative(repoRoot, absoluteFilePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      // Outside the repository: cannot be git-tracked by this repository
      return false;
    }
    const output = execSync(`git ls-files --error-unmatch "${relative}"`, {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return output.trim().length > 0;
  } catch {
    // Non-zero exit code means file is untracked (or outside repo)
    return false;
  }
}

/**
 * Resolves the operator-managed external/git-ignored environment file.
 *
 * Search order:
 *  1. Custom CLI argument `--env-file <path>`
 *  2. Process environment variable `DISCORD_LAB_ENV_FILE`
 *  3. `<repoRoot>/../.env.discord-lab` (outside repository)
 *  4. `<repoRoot>/.env.discord-lab.local` (inside repository, ignored by .env.*)
 */
export function resolveDiscordLabEnvFile(customPath?: string): ExternalEnvFileResolution {
  const repoRoot = path.resolve(__dirname, '../../');

  // Check CLI argument --env-file
  let candidatePath = customPath;
  if (!candidatePath) {
    const envFileArgIdx = process.argv.indexOf('--env-file');
    if (envFileArgIdx !== -1 && process.argv[envFileArgIdx + 1]) {
      candidatePath = process.argv[envFileArgIdx + 1];
    }
  }

  // Check environment variable
  if (!candidatePath && process.env.DISCORD_LAB_ENV_FILE) {
    candidatePath = process.env.DISCORD_LAB_ENV_FILE;
  }

  // Check default external locations
  const searchLocations = candidatePath
    ? [path.resolve(process.cwd(), candidatePath)]
    : [
        path.resolve(repoRoot, '..', '.env.discord-lab'),
        path.resolve(repoRoot, '.env.discord-lab.local'),
        path.resolve(repoRoot, '.env.discord-lab'),
      ];

  for (const loc of searchLocations) {
    if (fs.existsSync(loc)) {
      const isTracked = isPathGitTracked(loc);
      const isOutside = path.relative(repoRoot, loc).startsWith('..');

      if (isTracked) {
        return {
          filePath: loc,
          exists: true,
          isExternal: isOutside,
          isGitTracked: true,
          error: `CRITICAL SECURITY ERROR: The environment file '${loc}' is tracked by Git! Secrets must NEVER be stored in tracked files.`,
        };
      }

      return {
        filePath: loc,
        exists: true,
        isExternal: isOutside,
        isGitTracked: false,
      };
    }
  }

  // Not found in any default location
  return {
    filePath: null,
    exists: false,
    isExternal: false,
    isGitTracked: false,
    error: `No operator-managed Discord Lab environment file found. Looked in: ${searchLocations.join(', ')}`,
  };
}

/**
 * Loads environment variables from the resolved external/git-ignored file into process.env.
 * Never prints or leaks values.
 */
export function loadDiscordLabEnvironment(customPath?: string): ExternalEnvFileResolution {
  const resolution = resolveDiscordLabEnvFile(customPath);
  if (resolution.exists && resolution.filePath && !resolution.isGitTracked) {
    dotenv.config({ path: resolution.filePath, override: true });
  }
  return resolution;
}
