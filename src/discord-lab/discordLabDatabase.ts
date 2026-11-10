/**
 * src/discord-lab/discordLabDatabase.ts
 *
 * Dedicated Disposable Staging Database Provisioning for Discord Lab Mode.
 *
 * Guarantees:
 *  1. Completely isolated SQLite database inside prisma/staging/ (discord_lab_<uuid>.db).
 *  2. Migrations applied via safe-migration-runner in child process (clean rootDir boundary).
 *  3. Guaranteed cleanup function to delete disposable files on shutdown/errors.
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execSync } from 'child_process';
import prisma, { ensureSecurityAndIntegrityIndexes } from '../database/db';
import { findPrismaSchemaDir } from '../database/canonicalDbPath';

export interface DisposableLabDatabase {
  databaseUrl: string;
  dbPath: string;
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
  const relativeUrl = `file:./staging/${filename}`;

  // Point process.env.DATABASE_URL to disposable database
  process.env.DATABASE_URL = relativeUrl;

  const repoRoot = path.resolve(__dirname, '../../');
  const runnerScript = path.resolve(repoRoot, 'scripts/safe-migration-runner.ts');

  // Run safe migrations via child process
  try {
    execSync(`npx ts-node "${runnerScript}" --database "${absolutePath}"`, {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: relativeUrl,
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

  // Apply integrity indexes
  await ensureSecurityAndIntegrityIndexes();

  const cleanup = async () => {
    try {
      await prisma.$disconnect();
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
    databaseUrl: relativeUrl,
    dbPath: absolutePath,
    cleanup,
  };
}
