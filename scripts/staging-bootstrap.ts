/**
 * scripts/staging-bootstrap.ts
 *
 * Isolated Local Staging Environment Bootstrap for G4X Community.
 *
 * MISSION:
 *  Prepares, migrates, secures, and seeds a fresh disposable staging database
 *  completely isolated from production data, Discord, or payment gateways.
 *
 * Safety Invariants:
 *  1. Strictly validates staging configuration using `validateStagingEnvironment()`.
 *  2. Refuses to operate on any database outside `<repoRoot>/prisma/staging/`.
 *  3. Executes `runSafeMigration` ensuring all Prisma migrations apply cleanly.
 *  4. Applies SQLite partial unique indexes and referential integrity checks.
 *  5. Seeds comprehensive synthetic dataset with 10 test identities and sample data.
 *  6. Validates OwnerGate single-owner resolution against the newly prepared database.
 *
 * Usage:
 *   npx ts-node scripts/staging-bootstrap.ts [--env-file .env.staging]
 *   npm run staging:bootstrap
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { validateStagingEnvironment } from './validate-staging-env';
import { findPrismaSchemaDir, resolveCanonicalDatabaseTarget } from './canonical-db-path';
import { runSafeMigration } from './safe-migration-runner';
import { ensureSecurityAndIntegrityIndexes } from '../src/database/db';
import { seedStagingDatabase, SYNTHETIC_USERS } from './seed-staging';
import { resolveDatabaseOwner } from '../src/web/ownerGate';

// Support optional --env-file CLI arg
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

export interface StagingBootstrapResult {
  success: boolean;
  canonicalPath: string;
  migrationsApplied: boolean;
  integrityVerified: boolean;
  seeded: boolean;
  ownerResolved: boolean;
  error?: string;
}

export async function bootstrapStagingEnvironment(options: {
  args?: string[];
  databaseUrl?: string;
  silent?: boolean;
} = {}): Promise<StagingBootstrapResult> {
  const args = options.args || process.argv.slice(2);
  const log = (msg: string) => {
    if (!options.silent) console.log(msg);
  };

  log('[StagingBootstrap] 🚀 Initializing isolated staging environment bootstrap...');

  // 1. Validate Staging Environment
  const envValidation = validateStagingEnvironment();
  if (!envValidation.valid) {
    const errorMsg = `[StagingBootstrap] ❌ Staging environment validation FAILED:\n${envValidation.errors.map((e) => `  - ${e}`).join('\n')}`;
    console.error(errorMsg);
    return {
      success: false,
      canonicalPath: '',
      migrationsApplied: false,
      integrityVerified: false,
      seeded: false,
      ownerResolved: false,
      error: errorMsg,
    };
  }

  // 2. Resolve target database path
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
  // Strict staging directory boundary check
  if (!canonicalTarget.toLowerCase().startsWith(requiredPrefix)) {
    const errorMsg = `[CRITICAL SAFETY ERROR] Target database path '${target.canonicalPath}' is NOT inside allowed staging directory '${canonicalStagingDir}'. Refusing to bootstrap non-staging database!`;
    console.error(errorMsg);
    return {
      success: false,
      canonicalPath: target.canonicalPath,
      migrationsApplied: false,
      integrityVerified: false,
      seeded: false,
      ownerResolved: false,
      error: errorMsg,
    };
  }

  // Ensure staging directory exists
  const targetDir = path.dirname(target.canonicalPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    log(`[StagingBootstrap] 📁 Created staging directory: ${targetDir}`);
  }

  // Ensure SQLite file exists so that Canonical Path Resolver and Prisma CLI can access it
  if (!fs.existsSync(target.canonicalPath)) {
    fs.writeFileSync(target.canonicalPath, '');
    log(`[StagingBootstrap] 📄 Created initial empty SQLite file at ${target.canonicalPath}`);
  }

  // 3. Run Safe Migration Runner
  log(`[StagingBootstrap] 📦 Deploying Prisma migrations via SafeMigrationRunner...`);
  const migrationResult = await runSafeMigration({
    databaseUrl: target.canonicalUrl,
    args,
    silent: options.silent,
  });

  if (!migrationResult.success) {
    const errorMsg = `[StagingBootstrap] ❌ Database migration failed: ${migrationResult.error}`;
    console.error(errorMsg);
    return {
      success: false,
      canonicalPath: target.canonicalPath,
      migrationsApplied: false,
      integrityVerified: false,
      seeded: false,
      ownerResolved: false,
      error: errorMsg,
    };
  }

  // 4. Initialize Database Integrity and Indexes
  log(`[StagingBootstrap] 🔒 Verifying foreign keys and creating partial unique indexes...`);
  const prisma = new PrismaClient({
    datasources: {
      db: { url: target.canonicalUrl },
    },
  });

  try {
    await ensureSecurityAndIntegrityIndexes(prisma);
    log(`[StagingBootstrap] 🟢 Foreign-key integrity check and partial unique indexes verified.`);

    // 5. Seed Synthetic Dataset
    log(`[StagingBootstrap] 🌱 Seeding synthetic test dataset...`);
    await seedStagingDatabase(prisma);

    // 6. Verify Synthetic Identities
    const userCount = await prisma.user.count();
    const roleCount = await prisma.userRole.count();
    const orderCount = await prisma.order.count();
    log(`[StagingBootstrap] 📊 Verification: ${userCount} users, ${roleCount} role assignments, ${orderCount} orders.`);

    if (userCount < 10) {
      throw new Error(`Expected at least 10 synthetic users, found ${userCount}`);
    }

    // 7. Verify Owner Resolution
    const ownerResult = await resolveDatabaseOwner(prisma);
    if (!ownerResult.owner || ownerResult.owner.discordId !== SYNTHETIC_USERS.OWNER) {
      throw new Error(
        `OwnerGate resolution failed! Expected owner '${SYNTHETIC_USERS.OWNER}', got '${ownerResult.owner?.discordId}' (Reason: ${ownerResult.reason})`
      );
    }
    log(`[StagingBootstrap] 👑 OwnerGate verified single owner: ${ownerResult.owner.username} (${ownerResult.owner.discordId})`);

    log(`[StagingBootstrap] ✅ Staging environment bootstrap COMPLETED successfully!`);

    await prisma.$disconnect();

    return {
      success: true,
      canonicalPath: target.canonicalPath,
      migrationsApplied: true,
      integrityVerified: true,
      seeded: true,
      ownerResolved: true,
    };
  } catch (err: any) {
    await prisma.$disconnect();
    const errorMsg = `[StagingBootstrap] ❌ Post-migration bootstrap failed: ${err.message}`;
    console.error(errorMsg);
    return {
      success: false,
      canonicalPath: target.canonicalPath,
      migrationsApplied: true,
      integrityVerified: false,
      seeded: false,
      ownerResolved: false,
      error: errorMsg,
    };
  }
}

// CLI Execution
if (require.main === module) {
  bootstrapStagingEnvironment()
    .then((result) => {
      if (!result.success) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[StagingBootstrap] Fatal error:', err.message);
      process.exit(1);
    });
}
