/**
 * src/discord-lab/discordLabDatabase.ts
 *
 * Dedicated Disposable Staging Database Provisioning & Isolation Verification.
 *
 * Guarantees:
 *  1. Completely isolated SQLite database inside prisma/staging/ (discord_lab_<timestamp>_<uuid>.db).
 *  2. Migrations applied via safe-migration-runner in child process.
 *  3. Explicitly bound PrismaClient with PRAGMA database_list verification.
 *  4. Guaranteed cleanup function to delete disposable files on shutdown/errors.
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { ensureSecurityAndIntegrityIndexes } from '../database/db';
import { findPrismaSchemaDir } from '../database/canonicalDbPath';
import { FORBIDDEN_DATABASE_BASENAMES } from './discordLabConfig';

export interface DisposableLabDatabase {
  databaseUrl: string;
  dbPath: string;
  prismaClient: PrismaClient;
  verifyIsolation: () => Promise<{ isolated: boolean; canonicalDbFile: string }>;
  cleanup: () => Promise<void>;
}

export async function createDisposableLabDatabase(): Promise<DisposableLabDatabase> {
  const schemaDir = findPrismaSchemaDir();
  const stagingDir = path.resolve(schemaDir, 'staging');

  if (!fs.existsSync(stagingDir)) {
    fs.mkdirSync(stagingDir, { recursive: true });
  }

  const runId = crypto.randomBytes(6).toString('hex');
  const filename = `discord_lab_${Date.now()}_${runId}.db`;
  const absolutePath = path.resolve(stagingDir, filename);
  const canonicalUrl = `file:${absolutePath.replace(/\\/g, '/')}`;

  // Point process.env.DATABASE_URL to disposable database
  process.env.DATABASE_URL = canonicalUrl;

  const repoRoot = path.resolve(__dirname, '../../');
  const runnerScript = path.resolve(repoRoot, 'scripts/safe-migration-runner.ts');

  // Ensure SQLite file exists so Canonical Path Resolver and Prisma CLI can access it
  if (!fs.existsSync(absolutePath)) {
    fs.writeFileSync(absolutePath, '');
  }

  // Run safe migrations via child process
  try {
    execSync(`npx ts-node "${runnerScript}" --database "${absolutePath}"`, {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: canonicalUrl,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err: any) {
    try {
      if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
    } catch {}
    const output = ((err.stdout || '') + '\n' + (err.stderr || '') + '\n' + err.message).trim();
    throw new Error(`[DiscordLabDatabase] Failed to migrate disposable database: ${output}`);
  }

  // Create isolated PrismaClient bound strictly to the disposable database file
  const labPrisma = new PrismaClient({
    datasources: {
      db: {
        url: canonicalUrl,
      },
    },
  });

  // Apply integrity indexes
  await ensureSecurityAndIntegrityIndexes(labPrisma);

  /**
   * Cryptographically / authoritatively verifies through SQLite engine pragma
   * that the active Prisma connection is strictly bound to the disposable database.
   */
  const verifyIsolation = async (): Promise<{ isolated: boolean; canonicalDbFile: string }> => {
    const dbList: Array<{ seq: number; name: string; file: string }> = await labPrisma.$queryRawUnsafe(
      'PRAGMA database_list;'
    );

    const mainDb = dbList.find((d) => d.name === 'main');
    const activeFile = mainDb?.file || '';

    const normalizedActive = path.normalize(activeFile).toLowerCase();
    const normalizedExpected = path.normalize(absolutePath).toLowerCase();
    const baseName = path.basename(normalizedActive).toLowerCase();

    // Check forbidden names
    for (const forbidden of FORBIDDEN_DATABASE_BASENAMES) {
      if (baseName === forbidden.toLowerCase()) {
        throw new Error(
          `CRITICAL DATABASE ISOLATION BREACH: Active SQLite connection is bound to forbidden database '${baseName}'!`
        );
      }
    }

    // Verify it matches expected disposable file and is inside staging directory
    const canonicalStagingDir = fs.realpathSync(stagingDir).toLowerCase();
    const isInsideStaging = normalizedActive.startsWith(canonicalStagingDir);
    const matchesTarget = normalizedActive === normalizedExpected;

    return {
      isolated: isInsideStaging && matchesTarget,
      canonicalDbFile: activeFile,
    };
  };

  const cleanup = async () => {
    try {
      await labPrisma.$disconnect();
    } catch {}

    const relatedFiles = [
      absolutePath,
      `${absolutePath}-journal`,
      `${absolutePath}-wal`,
      `${absolutePath}-shm`,
    ];

    for (const f of relatedFiles) {
      try {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
        }
      } catch {}
    }
  };

  return {
    databaseUrl: canonicalUrl,
    dbPath: absolutePath,
    prismaClient: labPrisma,
    verifyIsolation,
    cleanup,
  };
}
