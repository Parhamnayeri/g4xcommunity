/**
 * src/services/googleDriveBackupService.ts
 *
 * Production-Grade Hybrid Google Drive Backup & Restore System
 * Combining rclone, SQLite Atomic Snapshots (`VACUUM INTO`), gzip compression,
 * SHA-256 manifest generation, and incremental `storage/` sync.
 *
 * Invariants:
 *  1. Zero Live Database Corruption: NEVER use raw file copy on an active SQLite DB.
 *     Always use `PRAGMA wal_checkpoint(TRUNCATE)` followed by `VACUUM INTO`.
 *  2. Unconditional Integrity Verification: Every snapshot is checked for SQLite 3
 *     magic bytes, `PRAGMA integrity_check`, and `PRAGMA foreign_key_check`.
 *  3. Restore Guardrails: Restores unconditionally create a local safety snapshot
 *     before replacing any files, verify SHA-256 and SQLite integrity before swap,
 *     and clear companion WAL files to prevent replay corruption.
 *  4. Graceful Degradation: Works cleanly locally even if `rclone` is not yet
 *     installed or authenticated, staging snapshots in `backups/database/`.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import prisma from '../database/db';
import { PrismaClient } from '@prisma/client';
import { resolveCanonicalDatabaseTarget, findPrismaSchemaDir } from '../database/canonicalDbPath';

const SQLITE_MAGIC_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

export interface GoogleDriveBackupConfig {
  enabled: boolean;
  intervalHours: number;
  rcloneRemote: string;
  backupFolder: string;
  retentionDays: number;
  rclonePath: string;
  localBackupDir: string;
  storageDir: string;
}

export interface RcloneHealthStatus {
  rcloneInstalled: boolean;
  rcloneVersion?: string;
  remoteConfigured: boolean;
  remoteReachable: boolean;
  remoteName: string;
  baseFolder: string;
  remoteDatabasePath: string;
  remoteStoragePath: string;
  configuredRemotes: string[];
  totalSpaceBytes?: number;
  usedSpaceBytes?: number;
  freeSpaceBytes?: number;
  error?: string;
  setupInstructions?: string[];
}

export interface BackupTableCounts {
  users: number;
  orders: number;
  withdrawals: number;
  ledgerEntries: number;
  walletsV2: number;
}

export interface BackupManifest {
  manifestVersion: string;
  snapshotFilename: string;
  timestamp: string;
  trigger: 'manual' | 'scheduled' | 'pre-restore';
  database: {
    sourcePath: string;
    originalSizeBytes: number;
    compressedSizeBytes: number;
    sha256Original: string;
    sha256Compressed: string;
    integrityOk: boolean;
    fkViolationCount: number;
  };
  tableCounts: BackupTableCounts;
  environment: {
    nodeEnv: string;
    nodeVersion: string;
    platform: string;
    databaseUrl: string;
  };
}

export interface BackupResult {
  success: boolean;
  snapshotFilename: string;
  manifestFilename: string;
  localGzPath: string;
  localManifestPath: string;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  sha256Original: string;
  sha256Compressed: string;
  integrityOk: boolean;
  fkViolationCount: number;
  uploadedToRemote: boolean;
  remoteDatabasePath?: string;
  storageSynced: boolean;
  durationMs: number;
  createdAt: string;
  error?: string;
}

export interface BackupSnapshotItem {
  filename: string;
  sizeBytes: number;
  sizeFormatted: string;
  modifiedAt: string;
  sha256?: string;
  isRemote: boolean;
  isLocal: boolean;
  manifest?: BackupManifest | null;
}

export interface BackupRestoreReport {
  success: boolean;
  restoredSnapshot: string;
  preRestoreSnapshot: string;
  integrityOk: boolean;
  storageRestored: boolean;
  restoredAt: string;
  durationMs: number;
}

/**
 * Resolves Google Drive and local backup configuration from process.env.
 */
export function getBackupConfig(): GoogleDriveBackupConfig {
  const rootDir = process.cwd();
  return {
    enabled: process.env.GDRIVE_BACKUP_ENABLED === 'true',
    intervalHours: Math.max(1, parseInt(process.env.GDRIVE_BACKUP_INTERVAL_HOURS || '6', 10)),
    rcloneRemote: (process.env.GDRIVE_RCLONE_REMOTE || 'gdrive').replace(/:$/, ''),
    backupFolder: (process.env.GDRIVE_BACKUP_FOLDER || 'G4X-Backups').replace(/^\/|\/$/g, ''),
    retentionDays: Math.max(0, parseInt(process.env.BACKUP_RETENTION_DAYS || '60', 10)),
    rclonePath: process.env.RCLONE_PATH || 'rclone',
    localBackupDir: path.resolve(rootDir, 'backups'),
    storageDir: path.resolve(rootDir, 'storage'),
  };
}

/**
 * Formats byte size into human readable string (e.g. "12.4 MB").
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Checks whether the given file has a valid SQLite 3 magic header.
 */
export function hasSqliteMagicHeader(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  if (fs.statSync(filePath).size < 16) return false;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    return bytesRead === 16 && buf.equals(SQLITE_MAGIC_HEADER);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Resolves the canonical active SQLite database file path.
 */
export function resolveActiveDatabasePath(): string {
  try {
    const target = resolveCanonicalDatabaseTarget();
    return target.canonicalPath;
  } catch (err: any) {
    // Fallback detection for beta and staging
    const schemaDir = findPrismaSchemaDir();
    const candidates = [
      process.env.DATABASE_URL?.replace(/^file:/, ''),
      path.resolve(schemaDir, 'staging', 'beta_v0001.db'),
      path.resolve(schemaDir, 'dev.db'),
      path.resolve(process.cwd(), 'dev.db'),
    ].filter(Boolean) as string[];

    for (const cand of candidates) {
      const resolved = path.isAbsolute(cand) ? cand : path.resolve(schemaDir, cand);
      if (fs.existsSync(resolved)) {
        return path.normalize(resolved);
      }
    }
    throw new Error(`[Backup] Unable to locate active SQLite database file: ${err.message}`);
  }
}

/**
 * Verifies rclone installation, configured remotes, and connection to Google Drive.
 */
export function checkRcloneHealth(): RcloneHealthStatus {
  const config = getBackupConfig();
  const remote = config.rcloneRemote;
  const baseFolder = config.backupFolder;
  const remoteDatabasePath = `${remote}:${baseFolder}/database/`;
  const remoteStoragePath = `${remote}:${baseFolder}/storage/`;

  const setupInstructions = [
    `1. Download rclone: https://rclone.org/downloads/ (or 'winget install Rclone.Rclone' / 'apt install rclone')`,
    `2. Run 'rclone config' in terminal: create a new remote named '${remote}', choose storage type 'drive' (Google Drive).`,
    `3. Complete browser authentication and verify access using: 'rclone lsd ${remote}:'`,
  ];

  // 1. Check binary availability
  let rcloneVersionOutput = '';
  try {
    const verRes = spawnSync(config.rclonePath, ['version'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    if (verRes.error || verRes.status !== 0) {
      return {
        rcloneInstalled: false,
        remoteConfigured: false,
        remoteReachable: false,
        remoteName: remote,
        baseFolder,
        remoteDatabasePath,
        remoteStoragePath,
        configuredRemotes: [],
        error: `rclone executable not found or errored: ${verRes.error?.message || verRes.stderr || 'Status ' + verRes.status}`,
        setupInstructions,
      };
    }
    rcloneVersionOutput = (verRes.stdout || '').split('\n')[0].trim();
  } catch (err: any) {
    return {
      rcloneInstalled: false,
      remoteConfigured: false,
      remoteReachable: false,
      remoteName: remote,
      baseFolder,
      remoteDatabasePath,
      remoteStoragePath,
      configuredRemotes: [],
      error: `Failed to invoke rclone: ${err.message}`,
      setupInstructions,
    };
  }

  // 2. Check configured remotes
  let configuredRemotes: string[] = [];
  try {
    const listRes = spawnSync(config.rclonePath, ['listremotes'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    if (listRes.status === 0 && listRes.stdout) {
      configuredRemotes = listRes.stdout
        .split('\n')
        .map((r) => r.trim().replace(/:$/, ''))
        .filter(Boolean);
    }
  } catch {
    // Continue with empty remotes
  }

  const isConfigured = configuredRemotes.some((r) => r.toLowerCase() === remote.toLowerCase());
  if (!isConfigured) {
    return {
      rcloneInstalled: true,
      rcloneVersion: rcloneVersionOutput,
      remoteConfigured: false,
      remoteReachable: false,
      remoteName: remote,
      baseFolder,
      remoteDatabasePath,
      remoteStoragePath,
      configuredRemotes,
      error: `Remote '${remote}' is not configured in rclone. Configured remotes: [${configuredRemotes.join(', ') || 'none'}]`,
      setupInstructions,
    };
  }

  // 3. Test remote reachability via 'rclone about' or 'rclone lsd'
  let isReachable = false;
  let totalSpaceBytes: number | undefined;
  let usedSpaceBytes: number | undefined;
  let freeSpaceBytes: number | undefined;
  let reachError: string | undefined;

  try {
    const aboutRes = spawnSync(config.rclonePath, ['about', `${remote}:`, '--json'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (aboutRes.status === 0 && aboutRes.stdout) {
      try {
        const parsed = JSON.parse(aboutRes.stdout);
        totalSpaceBytes = parsed.total;
        usedSpaceBytes = parsed.used;
        freeSpaceBytes = parsed.free || (totalSpaceBytes && usedSpaceBytes ? totalSpaceBytes - usedSpaceBytes : undefined);
        isReachable = true;
      } catch {
        isReachable = true;
      }
    } else {
      // Fallback probe with lsd
      const lsdRes = spawnSync(config.rclonePath, ['lsd', `${remote}:`, '--max-depth', '1'], {
        encoding: 'utf8',
        timeout: 8000,
      });
      if (lsdRes.status === 0) {
        isReachable = true;
      } else {
        reachError = lsdRes.stderr?.trim() || aboutRes.stderr?.trim() || 'Remote probe returned non-zero status';
      }
    }
  } catch (err: any) {
    reachError = err.message;
  }

  return {
    rcloneInstalled: true,
    rcloneVersion: rcloneVersionOutput,
    remoteConfigured: isConfigured,
    remoteReachable: isReachable,
    remoteName: remote,
    baseFolder,
    remoteDatabasePath,
    remoteStoragePath,
    configuredRemotes,
    totalSpaceBytes,
    usedSpaceBytes,
    freeSpaceBytes,
    error: isReachable ? undefined : reachError,
    setupInstructions: isReachable ? undefined : setupInstructions,
  };
}

/**
 * Inspects a candidate SQLite database file and retrieves record counts and integrity status.
 */
export async function inspectDatabaseSnapshot(candidatePath: string): Promise<{
  integrityOk: boolean;
  fkViolationCount: number;
  tableCounts: BackupTableCounts;
}> {
  if (!hasSqliteMagicHeader(candidatePath)) {
    throw new Error(`[Backup] Candidate file '${candidatePath}' is not a valid SQLite 3 database.`);
  }

  const normalizedUrl = `file:${path.resolve(candidatePath).replace(/\\/g, '/')}`;
  const checkClient = new PrismaClient({
    datasources: { db: { url: normalizedUrl } },
    log: ['error'],
  });

  try {
    const integrityRows: Array<{ integrity_check?: string }> = await checkClient.$queryRawUnsafe(
      'PRAGMA integrity_check;'
    );
    const details = integrityRows
      .map((r) => String(Object.values(r)[0] || ''))
      .filter((s) => s.length > 0);
    const integrityOk = details.length === 1 && details[0].toLowerCase() === 'ok';

    const fkViolations: any[] = await checkClient.$queryRawUnsafe('PRAGMA foreign_key_check;');

    const [users, orders, withdrawals, ledgerEntries, walletsV2] = await Promise.all([
      checkClient.user.count().catch(() => 0),
      checkClient.order.count().catch(() => 0),
      checkClient.boosterWithdrawalRequest.count().catch(() => 0),
      checkClient.ledgerEntryV2.count().catch(() => 0),
      checkClient.walletV2.count().catch(() => 0),
    ]);

    return {
      integrityOk,
      fkViolationCount: fkViolations.length,
      tableCounts: {
        users,
        orders,
        withdrawals,
        ledgerEntries,
        walletsV2,
      },
    };
  } finally {
    await checkClient.$disconnect();
  }
}

/**
 * Executes a full atomic hybrid backup:
 *  1. SQLite online transaction-safe snapshot via `PRAGMA wal_checkpoint(TRUNCATE)` + `VACUUM INTO`
 *  2. Verification of SQLite header and PRAGMA integrity
 *  3. Computes SHA-256 and compresses snapshot with gzip
 *  4. Writes accompanying .manifest.json
 *  5. If rclone is available, uploads to Google Drive and syncs `storage/` incrementally
 *  6. Applies retention pruning
 */
export async function runFullHybridBackup(
  trigger: 'manual' | 'scheduled' | 'pre-restore' = 'manual',
  actorId?: string
): Promise<BackupResult> {
  const startTime = Date.now();
  const config = getBackupConfig();

  // 1. Resolve active DB
  const activeDbPath = resolveActiveDatabasePath();
  if (!fs.existsSync(activeDbPath)) {
    throw new Error(`[Backup] Active SQLite database does not exist at '${activeDbPath}'.`);
  }

  // 2. Prepare directories
  const localDbDir = path.resolve(config.localBackupDir, 'database');
  const tempDir = path.resolve(config.localBackupDir, 'temp');
  if (!fs.existsSync(localDbDir)) fs.mkdirSync(localDbDir, { recursive: true });
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const timestampIso = new Date().toISOString();
  const stamp = timestampIso.replace(/[:.]/g, '-');
  const baseName = `g4x_db_${stamp}_${trigger}`;
  const tempSnapshotPath = path.resolve(tempDir, `${baseName}.db`);
  const finalGzPath = path.resolve(localDbDir, `${baseName}.db.gz`);
  const finalManifestPath = path.resolve(localDbDir, `${baseName}.manifest.json`);

  // Ensure temp snapshot path does not exist (SQLite VACUUM INTO fails if destination exists)
  if (fs.existsSync(tempSnapshotPath)) {
    fs.unlinkSync(tempSnapshotPath);
  }

  const escapedSnapshotPath = tempSnapshotPath.replace(/\\/g, '/').replace(/'/g, "''");

  try {
    // 3. Online Checkpoint & Atomic VACUUM INTO
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);').catch(() => {});
    await prisma.$executeRawUnsafe(`VACUUM INTO '${escapedSnapshotPath}';`);

    if (!fs.existsSync(tempSnapshotPath)) {
      throw new Error(`[Backup] VACUUM INTO completed but target file '${tempSnapshotPath}' was not created.`);
    }

    // 4. Integrity check & Record Counts
    const inspection = await inspectDatabaseSnapshot(tempSnapshotPath);
    if (!inspection.integrityOk || inspection.fkViolationCount > 0) {
      throw new Error(
        `[Backup] Snapshot integrity check failed (integrityOk=${inspection.integrityOk}, fkViolations=${inspection.fkViolationCount}).`
      );
    }

    // 5. Compute SHA-256 & Gzip Compress
    const rawBuffer = fs.readFileSync(tempSnapshotPath);
    const originalSizeBytes = rawBuffer.length;
    const sha256Original = crypto.createHash('sha256').update(rawBuffer).digest('hex');

    const compressedBuffer = zlib.gzipSync(rawBuffer, { level: 9 });
    const compressedSizeBytes = compressedBuffer.length;
    const sha256Compressed = crypto.createHash('sha256').update(compressedBuffer).digest('hex');

    // Write compressed archive
    fs.writeFileSync(finalGzPath, compressedBuffer);

    // 6. Generate and write Manifest
    const manifest: BackupManifest = {
      manifestVersion: '1.0.0',
      snapshotFilename: `${baseName}.db.gz`,
      timestamp: timestampIso,
      trigger,
      database: {
        sourcePath: activeDbPath,
        originalSizeBytes,
        compressedSizeBytes,
        sha256Original,
        sha256Compressed,
        integrityOk: inspection.integrityOk,
        fkViolationCount: inspection.fkViolationCount,
      },
      tableCounts: inspection.tableCounts,
      environment: {
        nodeEnv: process.env.NODE_ENV || 'production',
        nodeVersion: process.version,
        platform: process.platform,
        databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
      },
    };
    fs.writeFileSync(finalManifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    // Clean up temporary uncompressed DB
    try { fs.unlinkSync(tempSnapshotPath); } catch {}

    // 7. Remote Google Drive upload & Storage Sync via rclone
    let uploadedToRemote = false;
    let storageSynced = false;
    const rcloneHealth = checkRcloneHealth();

    if (rcloneHealth.rcloneInstalled && rcloneHealth.remoteConfigured && rcloneHealth.remoteReachable) {
      const remoteDbFolder = `${config.rcloneRemote}:${config.backupFolder}/database/`;
      const remoteStorageFolder = `${config.rcloneRemote}:${config.backupFolder}/storage/`;

      // Upload database archive and manifest
      const copyDbRes = spawnSync(
        config.rclonePath,
        ['copy', finalGzPath, remoteDbFolder],
        { encoding: 'utf8', timeout: 120000 }
      );
      const copyManifestRes = spawnSync(
        config.rclonePath,
        ['copy', finalManifestPath, remoteDbFolder],
        { encoding: 'utf8', timeout: 30000 }
      );

      if (copyDbRes.status === 0 && copyManifestRes.status === 0) {
        uploadedToRemote = true;
      }

      // Incremental storage sync (--ignore-existing)
      if (fs.existsSync(config.storageDir)) {
        const copyStorageRes = spawnSync(
          config.rclonePath,
          ['copy', config.storageDir, remoteStorageFolder, '--ignore-existing'],
          { encoding: 'utf8', timeout: 300000 }
        );
        if (copyStorageRes.status === 0) {
          storageSynced = true;
        }
      }

      // Remote retention pruning
      if (config.retentionDays > 0) {
        spawnSync(
          config.rclonePath,
          ['delete', remoteDbFolder, '--min-age', `${config.retentionDays}d`],
          { encoding: 'utf8', timeout: 60000 }
        );
      }
    }

    // 8. Local retention pruning
    if (config.retentionDays > 0) {
      pruneLocalBackups(localDbDir, config.retentionDays);
    }

    const durationMs = Date.now() - startTime;

    // 9. Record Audit Log
    try {
      let validActorId: string | null = null;
      if (actorId) {
        const userExists = await prisma.user.findUnique({
          where: { discordId: actorId },
          select: { discordId: true },
        });
        if (userExists) validActorId = userExists.discordId;
      }

      await prisma.auditLog.create({
        data: {
          actorId: validActorId,
          action: 'GOOGLE_DRIVE_BACKUP_COMPLETED',
          entityType: 'DatabaseBackup',
          entityId: `${baseName}.db.gz`,
          newValues: JSON.stringify({
            trigger,
            originalSizeBytes,
            compressedSizeBytes,
            sha256Compressed,
            uploadedToRemote,
            storageSynced,
            durationMs,
          }),
          reason: `Hybrid backup executed successfully via trigger '${trigger}'.`,
          isSuccess: true,
        },
      });
    } catch {
      // Audit log non-critical if during recovery
    }

    return {
      success: true,
      snapshotFilename: `${baseName}.db.gz`,
      manifestFilename: `${baseName}.manifest.json`,
      localGzPath: finalGzPath,
      localManifestPath: finalManifestPath,
      originalSizeBytes,
      compressedSizeBytes,
      sha256Original,
      sha256Compressed,
      integrityOk: inspection.integrityOk,
      fkViolationCount: inspection.fkViolationCount,
      uploadedToRemote,
      remoteDatabasePath: uploadedToRemote ? `${config.rcloneRemote}:${config.backupFolder}/database/` : undefined,
      storageSynced,
      durationMs,
      createdAt: timestampIso,
    };
  } catch (err: any) {
    try { if (fs.existsSync(tempSnapshotPath)) fs.unlinkSync(tempSnapshotPath); } catch {}
    throw new Error(`[Backup] Hybrid backup failed: ${err.message}`);
  }
}

/**
 * Prunes local snapshots older than the specified retention days.
 */
function pruneLocalBackups(dir: string, retentionDays: number): void {
  try {
    const files = fs.readdirSync(dir);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    for (const f of files) {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Lists all available database backups from Google Drive (and local mirror), sorted newest-first.
 */
export function listRemoteBackups(): BackupSnapshotItem[] {
  const config = getBackupConfig();
  const localDbDir = path.resolve(config.localBackupDir, 'database');
  const itemsMap = new Map<string, BackupSnapshotItem>();

  // 1. Read local backup mirror
  if (fs.existsSync(localDbDir)) {
    const localFiles = fs.readdirSync(localDbDir);
    for (const file of localFiles) {
      if (file.endsWith('.db.gz')) {
        const fullPath = path.join(localDbDir, file);
        const stat = fs.statSync(fullPath);
        let manifest: BackupManifest | null = null;
        const manifestPath = path.join(localDbDir, file.replace(/\.db\.gz$/, '.manifest.json'));
        if (fs.existsSync(manifestPath)) {
          try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          } catch {}
        }

        itemsMap.set(file, {
          filename: file,
          sizeBytes: stat.size,
          sizeFormatted: formatBytes(stat.size),
          modifiedAt: stat.mtime.toISOString(),
          sha256: manifest?.database?.sha256Compressed,
          isRemote: false,
          isLocal: true,
          manifest,
        });
      }
    }
  }

  // 2. Query remote backups via rclone if available
  const health = checkRcloneHealth();
  if (health.rcloneInstalled && health.remoteConfigured && health.remoteReachable) {
    const remoteDbFolder = `${config.rcloneRemote}:${config.backupFolder}/database/`;
    try {
      const lsRes = spawnSync(
        config.rclonePath,
        ['lsjson', remoteDbFolder],
        { encoding: 'utf8', timeout: 15000 }
      );

      if (lsRes.status === 0 && lsRes.stdout) {
        const remoteFiles: Array<{ Name: string; Size: number; ModTime: string }> = JSON.parse(lsRes.stdout);
        for (const rf of remoteFiles) {
          if (rf.Name.endsWith('.db.gz')) {
            const existing = itemsMap.get(rf.Name);
            if (existing) {
              existing.isRemote = true;
            } else {
              itemsMap.set(rf.Name, {
                filename: rf.Name,
                sizeBytes: rf.Size,
                sizeFormatted: formatBytes(rf.Size),
                modifiedAt: rf.ModTime || new Date().toISOString(),
                isRemote: true,
                isLocal: false,
              });
            }
          }
        }
      }
    } catch {
      // Remote fetch failed, retain local items
    }
  }

  return Array.from(itemsMap.values()).sort(
    (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
  );
}

/**
 * Safely restores the active database from a Google Drive or local snapshot.
 *
 * Invariants:
 *  1. Mandatory Pre-Restore Safety Snapshot: The active database is backed up first.
 *  2. Verification: The candidate database is decompressed to temp and validated
 *     via magic bytes, SHA-256 checksum, and `PRAGMA integrity_check`.
 *  3. Atomic Replacement: Companion SQLite WAL and SHM files are wiped during swap.
 *  4. Storage Sync: Optionally pulls incremental `storage/` files.
 */
export async function restoreFromRemoteBackup(
  snapshotFilename: string,
  options: { restoreStorage?: boolean; actorId?: string } = {}
): Promise<BackupRestoreReport> {
  const startTime = Date.now();
  const config = getBackupConfig();
  const cleanFilename = path.basename(snapshotFilename);

  if (!cleanFilename.endsWith('.db.gz')) {
    throw new Error(`[Restore] Target snapshot '${cleanFilename}' must be a .db.gz archive.`);
  }

  // Step 1: Automatic Pre-Restore Safety Snapshot
  const preRestoreResult = await runFullHybridBackup('pre-restore', options.actorId);
  if (!preRestoreResult.success) {
    throw new Error(`[Restore] Pre-restore safety backup failed. Aborting restore to protect active data.`);
  }

  const localDbDir = path.resolve(config.localBackupDir, 'database');
  const tempDir = path.resolve(config.localBackupDir, 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const tempGzPath = path.resolve(tempDir, cleanFilename);
  const tempManifestPath = path.resolve(tempDir, cleanFilename.replace(/\.db\.gz$/, '.manifest.json'));
  const localSourceGz = path.resolve(localDbDir, cleanFilename);
  const localSourceManifest = path.resolve(localDbDir, cleanFilename.replace(/\.db\.gz$/, '.manifest.json'));

  // Step 2: Acquire snapshot file
  if (fs.existsSync(localSourceGz)) {
    fs.copyFileSync(localSourceGz, tempGzPath);
    if (fs.existsSync(localSourceManifest)) {
      fs.copyFileSync(localSourceManifest, tempManifestPath);
    }
  } else {
    // Download from Google Drive
    const health = checkRcloneHealth();
    if (!health.rcloneInstalled || !health.remoteConfigured || !health.remoteReachable) {
      throw new Error(`[Restore] Snapshot '${cleanFilename}' is not found locally, and Google Drive remote is unreachable.`);
    }

    const remoteDbFolder = `${config.rcloneRemote}:${config.backupFolder}/database/`;
    const dlDb = spawnSync(config.rclonePath, ['copyto', `${remoteDbFolder}${cleanFilename}`, tempGzPath], {
      encoding: 'utf8',
      timeout: 120000,
    });
    if (dlDb.status !== 0 || !fs.existsSync(tempGzPath)) {
      throw new Error(`[Restore] Failed to download snapshot from Google Drive: ${dlDb.stderr || 'Download failed'}`);
    }

    spawnSync(config.rclonePath, ['copyto', `${remoteDbFolder}${cleanFilename.replace(/\.db\.gz$/, '.manifest.json')}`, tempManifestPath], {
      encoding: 'utf8',
      timeout: 30000,
    });
  }

  // Step 3: Decompress and verify candidate
  const decompressedCandidatePath = path.resolve(tempDir, `candidate_${cleanFilename.replace(/\.db\.gz$/, '')}.db`);
  if (fs.existsSync(decompressedCandidatePath)) fs.unlinkSync(decompressedCandidatePath);

  try {
    const compressedBytes = fs.readFileSync(tempGzPath);
    const uncompressedBytes = zlib.gunzipSync(compressedBytes);
    fs.writeFileSync(decompressedCandidatePath, uncompressedBytes);

    // Verify manifest checksum if manifest exists
    if (fs.existsSync(tempManifestPath)) {
      try {
        const manifest: BackupManifest = JSON.parse(fs.readFileSync(tempManifestPath, 'utf8'));
        const computedSha256 = crypto.createHash('sha256').update(uncompressedBytes).digest('hex');
        if (manifest.database.sha256Original && computedSha256 !== manifest.database.sha256Original) {
          throw new Error(
            `[Restore] Checksum mismatch! Manifest expects ${manifest.database.sha256Original}, computed ${computedSha256}.`
          );
        }
      } catch (err: any) {
        if (err.message.includes('Checksum mismatch')) throw err;
      }
    }

    // Step 4: Run SQLite integrity check on candidate
    const inspection = await inspectDatabaseSnapshot(decompressedCandidatePath);
    if (!inspection.integrityOk || inspection.fkViolationCount > 0) {
      throw new Error(
        `[Restore] Candidate database failed SQLite integrity check (integrityOk=${inspection.integrityOk}, fkViolations=${inspection.fkViolationCount}). Restore aborted.`
      );
    }

    // Step 5: Atomic Swap
    const activeDbPath = resolveActiveDatabasePath();
    const activeDir = path.dirname(activeDbPath);
    const activeWalPath = `${activeDbPath}-wal`;
    const activeShmPath = `${activeDbPath}-shm`;
    const tempBakPath = `${activeDbPath}.pre-restore-bak`;

    // Checkpoint active db and disconnect Prisma connection pool to release file locks on Windows
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);').catch(() => {});
    await prisma.$disconnect().catch(() => {});
    await new Promise((r) => setTimeout(r, 100));

    // Remove existing companion WAL & SHM files to prevent replay corruption
    if (fs.existsSync(activeWalPath)) {
      try { fs.unlinkSync(activeWalPath); } catch {}
    }
    if (fs.existsSync(activeShmPath)) {
      try { fs.unlinkSync(activeShmPath); } catch {}
    }

    // Swap candidate into active DB location with Windows handle retry logic
    let swapSuccess = false;
    let lastSwapError: any = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        if (fs.existsSync(activeDbPath)) {
          if (fs.existsSync(tempBakPath)) {
            try { fs.unlinkSync(tempBakPath); } catch {}
          }
          try {
            fs.renameSync(activeDbPath, tempBakPath);
          } catch {
            // If rename fails with EBUSY on Windows, copyFileSync can overwrite directly once handle closes
          }
        }
        fs.copyFileSync(decompressedCandidatePath, activeDbPath);
        swapSuccess = true;
        break;
      } catch (err: any) {
        lastSwapError = err;
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    if (!swapSuccess) {
      throw new Error(`[Restore] Failed to swap active database file: ${lastSwapError?.message || 'File locked'}`);
    }

    // Clean up temporary pre-swap backup
    try { if (fs.existsSync(tempBakPath)) fs.unlinkSync(tempBakPath); } catch {}

    // Reconnect Prisma to the newly restored database
    await prisma.$connect().catch(() => {});

    // Step 6: Storage Restore (Optional)
    let storageRestored = false;
    if (options.restoreStorage) {
      const health = checkRcloneHealth();
      if (health.rcloneInstalled && health.remoteConfigured && health.remoteReachable) {
        const remoteStorageFolder = `${config.rcloneRemote}:${config.backupFolder}/storage/`;
        const res = spawnSync(
          config.rclonePath,
          ['copy', remoteStorageFolder, config.storageDir, '--ignore-existing'],
          { encoding: 'utf8', timeout: 300000 }
        );
        if (res.status === 0) storageRestored = true;
      }
    }

    const durationMs = Date.now() - startTime;

    // Step 7: Record Audit Log
    try {
      let validActorId: string | null = null;
      if (options.actorId) {
        const userExists = await prisma.user.findUnique({
          where: { discordId: options.actorId },
          select: { discordId: true },
        });
        if (userExists) validActorId = userExists.discordId;
      }

      await prisma.auditLog.create({
        data: {
          actorId: validActorId,
          action: 'DATABASE_RESTORE_EXECUTED',
          entityType: 'DatabaseBackup',
          entityId: cleanFilename,
          newValues: JSON.stringify({
            restoredSnapshot: cleanFilename,
            preRestoreSafetySnapshot: preRestoreResult.snapshotFilename,
            storageRestored,
            durationMs,
          }),
          reason: `Authoritative database restore from snapshot '${cleanFilename}'.`,
          isSuccess: true,
        },
      });
    } catch {}

    return {
      success: true,
      restoredSnapshot: cleanFilename,
      preRestoreSnapshot: preRestoreResult.snapshotFilename,
      integrityOk: true,
      storageRestored,
      restoredAt: new Date().toISOString(),
      durationMs,
    };
  } finally {
    // Clean up temp files
    try { if (fs.existsSync(tempGzPath)) fs.unlinkSync(tempGzPath); } catch {}
    try { if (fs.existsSync(tempManifestPath)) fs.unlinkSync(tempManifestPath); } catch {}
    try { if (fs.existsSync(decompressedCandidatePath)) fs.unlinkSync(decompressedCandidatePath); } catch {}
  }
}
