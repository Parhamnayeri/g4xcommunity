/**
 * scripts/staging-reset.ts
 *
 * Safe Staging Database Reset Utility for G4X Community.
 *
 * SAFETY INVARIANTS:
 *  1. Requires explicit `--confirm-staging-reset` CLI flag.
 *  2. Evaluates `validateStagingEnvironment()`.
 *  3. Strictly resolves the target SQLite database file.
 *  4. Enforces that the target SQLite database file is strictly inside `prisma/staging/`.
 *     REFUSES to delete or touch any file outside the staging directory.
 *  5. Removes `.db`, `.db-journal`, `.db-wal`, and `.db-shm` files cleanly.
 *
 * Usage:
 *   npx ts-node scripts/staging-reset.ts --confirm-staging-reset [--env-file .env.staging]
 *   npm run staging:reset -- --confirm-staging-reset
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { validateStagingEnvironment } from './validate-staging-env';
import { findPrismaSchemaDir, resolveCanonicalDatabaseTarget } from './canonical-db-path';

// Parse optional --env-file
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

export interface StagingResetOptions {
  confirmFlag?: boolean;
  args?: string[];
  databaseUrl?: string;
  silent?: boolean;
}

export interface StagingResetResult {
  success: boolean;
  deletedFiles: string[];
  targetPath: string;
  error?: string;
}

export async function resetStagingDatabase(options: StagingResetOptions = {}): Promise<StagingResetResult> {
  const args = options.args || process.argv.slice(2);
  const hasConfirmFlag = options.confirmFlag ?? args.includes('--confirm-staging-reset');

  const log = (msg: string) => {
    if (!options.silent) {
      console.log(msg);
    }
  };

  // 1. Guard against accidental reset without confirmation flag
  if (!hasConfirmFlag) {
    const errorMsg =
      '[StagingReset] ❌ SAFETY GUARD: Resetting the staging database requires the explicit flag `--confirm-staging-reset`.';
    console.error(errorMsg);
    return {
      success: false,
      deletedFiles: [],
      targetPath: '',
      error: errorMsg,
    };
  }

  // 2. Validate staging environment configuration
  const envValidation = validateStagingEnvironment();
  if (!envValidation.valid) {
    const errorMsg = `[StagingReset] ❌ Staging environment validation failed:\n${envValidation.errors.map((e) => `  - ${e}`).join('\n')}`;
    console.error(errorMsg);
    return {
      success: false,
      deletedFiles: [],
      targetPath: '',
      error: errorMsg,
    };
  }

  // 3. Resolve canonical database target
  const target = resolveCanonicalDatabaseTarget({
    databaseUrl: options.databaseUrl || process.env.DATABASE_URL,
    args,
    allowMissingFile: true,
  });

  const schemaDir = findPrismaSchemaDir();
  const stagingDir = path.resolve(schemaDir, 'staging');
  let canonicalStagingDir = stagingDir;
  if (fs.existsSync(stagingDir)) {
    canonicalStagingDir = fs.realpathSync(stagingDir);
  }

  let canonicalTarget = target.canonicalPath;
  if (fs.existsSync(canonicalTarget)) {
    canonicalTarget = fs.realpathSync(canonicalTarget);
  } else {
    const parent = path.dirname(canonicalTarget);
    if (fs.existsSync(parent)) {
      canonicalTarget = path.join(fs.realpathSync(parent), path.basename(canonicalTarget));
    }
  }

  const requiredPrefix = canonicalStagingDir.toLowerCase() + path.sep;

  // 4. Strict directory confinement check
  if (!canonicalTarget.toLowerCase().startsWith(requiredPrefix)) {
    const errorMsg = `[CRITICAL SAFETY ERROR] Target database path '${target.canonicalPath}' is NOT located within allowed staging directory '${canonicalStagingDir}'. Refusing to reset non-staging database!`;
    console.error(errorMsg);
    return {
      success: false,
      deletedFiles: [],
      targetPath: target.canonicalPath,
      error: errorMsg,
    };
  }

  // 5. Delete staging database and journal files
  const filesToDelete = [
    target.canonicalPath,
    `${target.canonicalPath}-journal`,
    `${target.canonicalPath}-wal`,
    `${target.canonicalPath}-shm`,
  ];

  const deletedFiles: string[] = [];

  for (const file of filesToDelete) {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
        deletedFiles.push(file);
        log(`[StagingReset] 🗑️ Deleted staging artifact: ${path.basename(file)}`);
      } catch (err: any) {
        const errorMsg = `[StagingReset] Failed to delete '${file}': ${err.message}`;
        console.error(errorMsg);
        return {
          success: false,
          deletedFiles,
          targetPath: target.canonicalPath,
          error: errorMsg,
        };
      }
    }
  }

  log(`[StagingReset] ✅ Staging database reset cleanly (${deletedFiles.length} file(s) removed).`);
  return {
    success: true,
    deletedFiles,
    targetPath: target.canonicalPath,
  };
}

// CLI Execution
if (require.main === module) {
  resetStagingDatabase()
    .then((result) => {
      if (!result.success) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[StagingReset] Fatal error:', err.message);
      process.exit(1);
    });
}
