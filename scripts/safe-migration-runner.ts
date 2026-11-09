/**
 * scripts/safe-migration-runner.ts
 *
 * Dedicated Safe Migration Runner for G4X Community.
 *
 * MISSION:
 *  Guarantees that `prisma migrate deploy` is ONLY invoked if the Pre-Migration
 *  Safety Gate passes cleanly, and that Prisma CLI ALWAYS executes against the
 *  EXACT same canonical SQLite target evaluated by the safety gate.
 *
 * Safety Invariants:
 *  1. Resolves a single canonical SQLite target matching Prisma schema-relative rules.
 *  2. Strictly rejects conflicting DATABASE_URL and --database values.
 *  3. Executes runPreMigrationGate against the canonical target.
 *  4. Stops immediately on any failed safety check (foreign keys, duplicates, incomplete migrations).
 *  5. Re-verifies canonical target before spawning Prisma CLI process.
 *  6. Spawns Prisma migrate deploy passing canonical DATABASE_URL and explicit --schema path.
 *  7. Captures and propagates the exact Prisma exit code.
 *  8. Never falls back to a guessed default database path.
 *
 * Usage:
 *   npx ts-node scripts/safe-migration-runner.ts [--database /path/to/db.sqlite]
 *   npm run migrate:safe
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { resolveCanonicalDatabaseTarget, findPrismaSchemaDir } from './canonical-db-path';
import { runPreMigrationGate } from './pre-migration-gate';

dotenv.config();

export interface SafeMigrationRunnerOptions {
  databaseUrl?: string;
  args?: string[];
  silent?: boolean;
}

export interface SafeMigrationRunnerResult {
  success: boolean;
  canonicalPath: string;
  canonicalUrl: string;
  gatePassed: boolean;
  gateReason: string;
  prismaExecuted: boolean;
  prismaExitCode: number;
  error?: string;
}

export function findPrismaCliPath(): string {
  try {
    return require.resolve('prisma/build/index.js');
  } catch {
    const local = path.resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
    if (fs.existsSync(local)) {
      return local;
    }
    throw new Error('[CRITICAL SAFETY ERROR] Unable to locate Prisma CLI binary (prisma/build/index.js).');
  }
}

export async function runSafeMigration(options: SafeMigrationRunnerOptions = {}): Promise<SafeMigrationRunnerResult> {
  const args = options.args || process.argv.slice(2);
  const schemaDir = findPrismaSchemaDir();
  const schemaPath = path.resolve(schemaDir, 'schema.prisma');

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`[CRITICAL SAFETY ERROR] Prisma schema not found at '${schemaPath}'.`);
  }

  // 1. Resolve single canonical database target (rejects conflicting CLI and ENV values)
  const target = resolveCanonicalDatabaseTarget({
    databaseUrl: options.databaseUrl,
    args,
  });

  const log = (msg: string) => {
    if (!options.silent) {
      console.log(msg);
    }
  };

  log(`[SafeMigrationRunner] Canonical target: ${target.canonicalPath}`);
  log(`[SafeMigrationRunner] Canonical URL:    ${target.canonicalUrl}`);
  log(`[SafeMigrationRunner] Schema path:      ${schemaPath}`);

  // 2. Run Pre-Migration Safety Gate
  const gateResult = await runPreMigrationGate({
    databaseUrl: target.canonicalUrl,
    args,
  });

  if (!gateResult.canProceed) {
    const errorMsg = `[SafeMigrationRunner] ❌ PRE-MIGRATION GATE BLOCKED: ${gateResult.reason}`;
    console.error(errorMsg);
    return {
      success: false,
      canonicalPath: target.canonicalPath,
      canonicalUrl: target.canonicalUrl,
      gatePassed: false,
      gateReason: gateResult.reason,
      prismaExecuted: false,
      prismaExitCode: -1,
      error: errorMsg,
    };
  }

  log(`[SafeMigrationRunner] 🟢 Safety gate passed. Verifying database before spawning Prisma...`);

  // 3. Re-verify database target immediately prior to spawn
  if (!fs.existsSync(target.canonicalPath)) {
    throw new Error(
      `[CRITICAL SAFETY ERROR] Target SQLite file disappeared before migration spawn at '${target.canonicalPath}'.`
    );
  }

  let finalCanonicalCheck = target.canonicalPath;
  try {
    finalCanonicalCheck = fs.realpathSync(target.canonicalPath);
  } catch {}

  if (finalCanonicalCheck.toLowerCase() !== target.canonicalPath.toLowerCase()) {
    throw new Error(
      `[CRITICAL SAFETY ERROR] Target SQLite path changed between validation and execution: '${target.canonicalPath}' -> '${finalCanonicalCheck}'.`
    );
  }

  // 4. Spawn Prisma CLI with DATABASE_URL strictly bound to the canonical target
  const prismaCliPath = findPrismaCliPath();
  log(`[SafeMigrationRunner] Spawning Prisma migrate deploy...`);

  const prismaExitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [prismaCliPath, 'migrate', 'deploy', `--schema=${schemaPath}`],
      {
        stdio: options.silent ? 'pipe' : 'inherit',
        env: {
          ...process.env,
          DATABASE_URL: target.canonicalUrl,
        },
      }
    );

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn Prisma process: ${err.message}`));
    });

    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });

  if (prismaExitCode !== 0) {
    const errorMsg = `[SafeMigrationRunner] ❌ Prisma migrate deploy failed with exit code ${prismaExitCode}.`;
    console.error(errorMsg);
    return {
      success: false,
      canonicalPath: target.canonicalPath,
      canonicalUrl: target.canonicalUrl,
      gatePassed: true,
      gateReason: gateResult.reason,
      prismaExecuted: true,
      prismaExitCode,
      error: errorMsg,
    };
  }

  log(`[SafeMigrationRunner] ✅ Migration completed successfully with exit code 0.`);
  return {
    success: true,
    canonicalPath: target.canonicalPath,
    canonicalUrl: target.canonicalUrl,
    gatePassed: true,
    gateReason: gateResult.reason,
    prismaExecuted: true,
    prismaExitCode: 0,
  };
}

// Direct CLI Execution
if (require.main === module) {
  runSafeMigration()
    .then((result) => {
      if (!result.success) {
        process.exit(result.prismaExitCode > 0 ? result.prismaExitCode : 1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n[SafeMigrationRunner] ❌ Fatal error:', err.message);
      process.exit(1);
    });
}
