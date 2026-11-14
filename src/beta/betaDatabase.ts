/**
 * src/beta/betaDatabase.ts
 *
 * Persistent Operational Closed-Beta Database Provisioning, Backup, Restore & Integrity Module.
 *
 * Strictly separate from disposable `discordLabDatabase.ts`:
 *  - Persistent DB resides under `<repoRoot>/prisma/staging/` (default: `beta_v0001.db`).
 *  - Data is NEVER auto-deleted on shutdown or restart.
 *  - Provides WAL checkpointed atomic `VACUUM INTO` backups with `PRAGMA integrity_check` and
 *    `PRAGMA foreign_key_check` verification, plus safe verified restore with pre-restore snapshot.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { findPrismaSchemaDir } from '../database/canonicalDbPath';
import { ensureSecurityAndIntegrityIndexes } from '../database/db';
import { validateBetaDatabaseUrl, parseBetaInviteAllowlist } from './validateBetaEnv';
import { SYSTEM_ROLES, SUPPORTED_GAMES, GAME_SERVICES } from '../database/seed';

const SQLITE_HEADER_MAGIC = Buffer.from('SQLite format 3\0', 'utf8');

export interface BetaDatabaseHandle {
  prismaClient: PrismaClient;
  dbPath: string;
  dbUrl: string;
  wasCreatedFresh: boolean;
  verifyIntegrity: () => Promise<BetaIntegrityReport>;
  disconnect: () => Promise<void>;
}

export interface BetaIntegrityReport {
  dbPath: string;
  activeMainFile: string;
  integrityOk: boolean;
  integrityDetails: string[];
  fkViolationCount: number;
  fkViolations: any[];
  walMode: string;
}

export interface BetaBackupResult {
  backupPath: string;
  sourceDbPath: string;
  sizeBytes: number;
  sha256: string;
  integrityOk: boolean;
  fkViolationCount: number;
  counts: {
    users: number;
    orders: number;
    walletsV2: number;
    withdrawals: number;
  };
  createdAt: string;
}

export interface BetaRestoreResult {
  restoredFrom: string;
  targetDbPath: string;
  preRestoreSnapshotPath: string | null;
  integrityOk: boolean;
  fkViolationCount: number;
  counts: {
    users: number;
    orders: number;
    walletsV2: number;
    withdrawals: number;
  };
  restoredAt: string;
}

export function resolveDefaultBetaDatabasePath(): string {
  return path.resolve(findPrismaSchemaDir(), 'staging', 'beta_v0001.db');
}

export function resolveDefaultBetaBackupDir(): string {
  return path.resolve(findPrismaSchemaDir(), 'staging', 'backups');
}

function findPrismaCliPath(): string {
  try {
    return require.resolve('prisma/build/index.js');
  } catch {
    const local = path.resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
    if (fs.existsSync(local)) {
      return local;
    }
    throw new Error('[BetaDatabase] Unable to locate Prisma CLI (prisma/build/index.js).');
  }
}

export function hasSqliteMagicHeader(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (stat.size < 100) return false;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    return bytesRead === 16 && buf.equals(SQLITE_HEADER_MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

export async function runIntegrityCheckOnClient(
  client: PrismaClient,
  expectedDbPath: string
): Promise<BetaIntegrityReport> {
  const dbList: Array<{ seq: number; name: string; file: string }> =
    await client.$queryRawUnsafe('PRAGMA database_list;');
  const mainEntry = dbList.find((d) => d.name === 'main');
  const activeMainFile = path.resolve(mainEntry?.file || '');
  const normalizedExpected = path.resolve(expectedDbPath);

  if (!mainEntry || activeMainFile.toLowerCase() !== normalizedExpected.toLowerCase()) {
    throw new Error(
      `[BetaDatabase] Isolation mismatch: PRAGMA database_list main='${activeMainFile}', expected='${normalizedExpected}'.`
    );
  }

  const integrityRows: Array<{ integrity_check?: string }> = await client.$queryRawUnsafe(
    'PRAGMA integrity_check;'
  );
  const details = integrityRows
    .map((r) => String(Object.values(r)[0] || ''))
    .filter((s) => s.length > 0);
  const integrityOk = details.length === 1 && details[0].toLowerCase() === 'ok';

  const fkViolations: any[] = await client.$queryRawUnsafe('PRAGMA foreign_key_check;');
  const journalRows: Array<{ journal_mode?: string }> = await client.$queryRawUnsafe(
    'PRAGMA journal_mode;'
  );
  const walMode = String(Object.values(journalRows[0] || {})[0] || 'unknown');

  return {
    dbPath: normalizedExpected,
    activeMainFile,
    integrityOk,
    integrityDetails: details,
    fkViolationCount: fkViolations.length,
    fkViolations,
    walMode,
  };
}

export async function initializeBetaDatabase(
  databaseUrl?: string,
  options: { silent?: boolean; seed?: boolean } = {}
): Promise<BetaDatabaseHandle> {
  const rawUrl =
    databaseUrl ||
    process.env.DATABASE_URL ||
    `file:${resolveDefaultBetaDatabasePath().replace(/\\/g, '/')}`;

  const urlCheck = validateBetaDatabaseUrl(rawUrl);
  if (!urlCheck.valid || !urlCheck.resolvedPath || !urlCheck.canonicalUrl) {
    throw new Error(`[BetaDatabase] Invalid persistent beta database target: ${urlCheck.error}`);
  }

  const dbPath = urlCheck.resolvedPath;
  const dbUrl = urlCheck.canonicalUrl;
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const wasCreatedFresh = !fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0;

  if (!wasCreatedFresh) {
    if (!hasSqliteMagicHeader(dbPath)) {
      throw new Error(
        `[BetaDatabase] Existing database file at '${dbPath}' is corrupt or not a valid SQLite 3 database.`
      );
    }
    const preClient = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    try {
      const preReport = await runIntegrityCheckOnClient(preClient, dbPath);
      if (!preReport.integrityOk) {
        throw new Error(
          `[BetaDatabase] Existing DB failed integrity_check: ${preReport.integrityDetails.join('; ')}`
        );
      }
      if (preReport.fkViolationCount > 0) {
        throw new Error(
          `[BetaDatabase] Existing DB has ${preReport.fkViolationCount} foreign key violation(s).`
        );
      }
    } finally {
      await preClient.$disconnect();
    }
  }

  const schemaDir = findPrismaSchemaDir();
  const schemaPath = path.resolve(schemaDir, 'schema.prisma');
  const prismaCliPath = findPrismaCliPath();

  const deployResult = spawnSync(
    process.execPath,
    [prismaCliPath, 'migrate', 'deploy', `--schema=${schemaPath}`],
    {
      stdio: options.silent ? 'pipe' : 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
      },
      encoding: 'utf8',
    }
  );

  if (deployResult.error) {
    throw new Error(`[BetaDatabase] Failed to run prisma migrate deploy: ${deployResult.error.message}`);
  }
  if (deployResult.status !== 0) {
    throw new Error(
      `[BetaDatabase] prisma migrate deploy exited with code ${deployResult.status}: ${deployResult.stderr || deployResult.stdout || ''}`
    );
  }

  const client = new PrismaClient({
    datasources: { db: { url: dbUrl } },
  });

  await client.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  await client.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
  await client.$executeRawUnsafe('PRAGMA synchronous = NORMAL;');
  await client.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');

  await ensureSecurityAndIntegrityIndexes(client);

  if (options.seed) {
    await seedBetaDatabase(client, { silent: options.silent });
  }

  const report = await runIntegrityCheckOnClient(client, dbPath);
  if (!report.integrityOk || report.fkViolationCount > 0) {
    await client.$disconnect();
    throw new Error(
      `[BetaDatabase] Post-init integrity verification failed: integrityOk=${report.integrityOk}, fkViolations=${report.fkViolationCount}`
    );
  }

  return {
    prismaClient: client,
    dbPath,
    dbUrl,
    wasCreatedFresh,
    verifyIntegrity: () => runIntegrityCheckOnClient(client, dbPath),
    disconnect: async () => {
      try {
        await client.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch {
        // Ignore checkpoint error if connection already closing
      }
      await client.$disconnect();
    },
  };
}

export async function seedBetaDatabase(
  client: PrismaClient,
  options: { ownerDiscordId?: string; inviteAllowlistIds?: string[]; silent?: boolean } = {}
): Promise<{
  rolesCount: number;
  gamesCount: number;
  servicesCount: number;
  platformAccountsCount: number;
  ownerId: string | null;
}> {
  return await client.$transaction(async (tx) => {
    // 1. System Roles
    for (const role of SYSTEM_ROLES) {
      if (!(await tx.role.findUnique({ where: { roleKey: role.roleKey } }))) {
        await tx.role.create({ data: role });
      }
    }

    // 2. Supported Games
    for (const game of SUPPORTED_GAMES) {
      if (!(await tx.game.findUnique({ where: { slug: game.slug } }))) {
        await tx.game.create({ data: game });
      }
    }

    // 3. Game Services
    for (const service of GAME_SERVICES) {
      const where = { gameSlug_serviceKey: { gameSlug: service.gameSlug, serviceKey: service.serviceKey } };
      if (!(await tx.gameService.findUnique({ where }))) {
        await tx.gameService.create({ data: service });
      }
    }

    // 4. Default Platform Accounts (all 5 external platforms)
    const defaultAccounts = [
      { accountRef: 'g2g_main', platform: 'g2g', displayName: 'G2G Main Account' },
      { accountRef: 'skycoach_main', platform: 'skycoach', displayName: 'SkyCoach Main Account' },
      { accountRef: 'eldorado_main', platform: 'eldorado', displayName: 'Eldorado Main Account' },
      { accountRef: 'kingboost_main', platform: 'kingboost', displayName: 'Kingboost Main Account' },
      { accountRef: 'overgear_main', platform: 'overgear', displayName: 'Overgear Main Account' },
    ];
    for (const acct of defaultAccounts) {
      const existing = await tx.platformAccount.findUnique({ where: { accountRef: acct.accountRef } });
      if (!existing) {
        await tx.platformAccount.create({
          data: { ...acct, currency: 'USD', isActive: true },
        });
      } else if (!existing.isActive) {
        await tx.platformAccount.update({
          where: { accountRef: acct.accountRef },
          data: { isActive: true },
        });
      }
    }

    // 5. Initial Owner / Admin User
    const allowlisted = parseBetaInviteAllowlist(process.env);
    const ownerId =
      options.ownerDiscordId ||
      process.env.OWNER_DISCORD_ID ||
      (options.inviteAllowlistIds && options.inviteAllowlistIds[0]) ||
      (allowlisted.length > 0 ? allowlisted[0] : null);

    if (ownerId && /^\d{17,20}$/.test(ownerId)) {
      const existingUser = await tx.user.findUnique({ where: { discordId: ownerId } });
      if (!existingUser) {
        await tx.user.create({
          data: {
            discordId: ownerId,
            username: 'BetaOwner',
            displayName: 'Beta Owner',
            isActive: true,
          },
        });
      } else if (!existingUser.isActive) {
        await tx.user.update({
          where: { discordId: ownerId },
          data: { isActive: true },
        });
      }

      // Assign owner, admin, manager, staff roles
      const ownerRoles = ['owner', 'admin', 'manager', 'staff'];
      for (const roleKey of ownerRoles) {
        const hasRole = await tx.userRole.findUnique({
          where: { userId_roleKey: { userId: ownerId, roleKey } },
        });
        if (!hasRole) {
          await tx.userRole.create({
            data: { userId: ownerId, roleKey },
          });
        }
      }

      // Ensure WalletV2
      const existingWallet = await tx.walletV2.findUnique({ where: { userId: ownerId } });
      if (!existingWallet) {
        await tx.walletV2.create({
          data: {
            userId: ownerId,
            availableCents: 100000,
            reservedCents: 0,
            pendingEarningsCents: 0,
            confirmedEarningsCents: 0,
            paidCents: 0,
            refundedCents: 0,
          },
        });
      }
    }

    // 6. Additional tester account if present in allowlist
    const allAllowlist = options.inviteAllowlistIds || allowlisted;
    const testerId = allAllowlist.find((id) => id !== ownerId && /^\d{17,20}$/.test(id)) || null;

    if (testerId) {
      const existingTester = await tx.user.findUnique({ where: { discordId: testerId } });
      if (!existingTester) {
        await tx.user.create({
          data: {
            discordId: testerId,
            username: 'BetaTester',
            displayName: 'Beta Tester',
            isActive: true,
          },
        });
      } else if (!existingTester.isActive) {
        await tx.user.update({
          where: { discordId: testerId },
          data: { isActive: true },
        });
      }

      const testerRoles = ['booster', 'pilot', 'advertiser'];
      for (const roleKey of testerRoles) {
        const hasRole = await tx.userRole.findUnique({
          where: { userId_roleKey: { userId: testerId, roleKey } },
        });
        if (!hasRole) {
          await tx.userRole.create({
            data: { userId: testerId, roleKey },
          });
        }
      }

      const existingTesterWallet = await tx.walletV2.findUnique({ where: { userId: testerId } });
      if (!existingTesterWallet) {
        await tx.walletV2.create({
          data: {
            userId: testerId,
            availableCents: 50000,
            reservedCents: 0,
            pendingEarningsCents: 0,
            confirmedEarningsCents: 0,
            paidCents: 0,
            refundedCents: 0,
          },
        });
      }
    }

    // 7. Official Rules & Policies Initial Publication
    try {
      let policyDoc = await tx.policyDocument.findUnique({
        where: { slug: 'community-rules' },
        include: { versions: true },
      });
      if (!policyDoc) {
        policyDoc = await tx.policyDocument.create({
          data: {
            slug: 'community-rules',
            title: 'G4X Community Official Policy & Rules',
            description: 'Authoritative rules and operating guidelines for G4X Community members, boosters, advertisers, and exchangers.',
          },
          include: { versions: true },
        });
      }

      if (!policyDoc.currentPublishedVersionId) {
        let targetVer = policyDoc.versions.find((v) => v.status === 'DRAFT' || v.status === 'PUBLISHED');
        if (!targetVer) {
          const { INITIAL_SECTIONS_SEED, buildMarkdownFromSections } = await import('../services/policyContentConstants');
          const rawMarkdown = buildMarkdownFromSections('G4X Community Official Policy & Rules', INITIAL_SECTIONS_SEED);
          targetVer = await tx.policyVersion.create({
            data: {
              documentId: policyDoc.id,
              versionNumber: 1,
              status: 'PUBLISHED',
              title: 'G4X Community Official Policy & Rules',
              effectiveDate: new Date(),
              publishedAt: new Date(),
              authorDiscordId: ownerId || 'system',
              publisherDiscordId: ownerId || 'system',
              changelog: 'Official G4X Community Policy & Rules initial publication.',
              discordSyncStatus: 'NOT_CONFIGURED',
              rawContentMarkdown: rawMarkdown,
              sections: {
                create: INITIAL_SECTIONS_SEED.map((sec) => ({
                  sectionNumber: sec.sectionNumber,
                  sectionKey: sec.sectionKey,
                  title: sec.title,
                  sortOrder: sec.sortOrder,
                  content: sec.content || null,
                  subsections: {
                    create: sec.subsections.map((sub) => ({
                      subsectionKey: sub.subsectionKey || null,
                      title: sub.title,
                      sortOrder: sub.sortOrder,
                      content: sub.content,
                      contentType: sub.contentType,
                      tableDataJson: sub.tableDataJson || null,
                    })),
                  },
                })),
              },
            },
          });
        } else {
          await tx.policyVersion.update({
            where: { id: targetVer.id },
            data: {
              status: 'PUBLISHED',
              publishedAt: new Date(),
              publisherDiscordId: ownerId || 'system',
            },
          });
        }
        await tx.policyDocument.update({
          where: { id: policyDoc.id },
          data: { currentPublishedVersionId: targetVer.id },
        });
      }
    } catch (policyErr: any) {
      console.warn('[BetaDatabase] Policy document seed notice:', policyErr?.message || policyErr);
    }

    const rolesCount = await tx.role.count();
    const gamesCount = await tx.game.count();
    const servicesCount = await tx.gameService.count();
    const platformAccountsCount = await tx.platformAccount.count();

    if (!options.silent) {
      console.log(
        `[BetaDatabase] ✅ Seeded: ${rolesCount} roles, ${gamesCount} games, ${servicesCount} services, ${platformAccountsCount} platform accounts.`
      );
      if (ownerId) {
        console.log(`[BetaDatabase] ✅ Owner account initialized: ${ownerId} (Owner, Admin, Manager, Staff)`);
      }
      if (testerId) {
        console.log(`[BetaDatabase] ✅ Tester account initialized: ${testerId} (Booster, Pilot, Advertiser)`);
      }
    }

    return {
      rolesCount,
      gamesCount,
      servicesCount,
      platformAccountsCount,
      ownerId,
    };
  });
}

async function inspectDatabaseSnapshotCounts(dbPath: string): Promise<{
  integrityOk: boolean;
  fkViolationCount: number;
  counts: {
    users: number;
    orders: number;
    walletsV2: number;
    withdrawals: number;
  };
}> {
  if (!hasSqliteMagicHeader(dbPath)) {
    throw new Error(`[BetaDatabase] Snapshot file '${dbPath}' is missing valid SQLite header.`);
  }
  const url = `file:${path.resolve(dbPath).replace(/\\/g, '/')}`;
  const checkClient = new PrismaClient({ datasources: { db: { url } } });
  try {
    const report = await runIntegrityCheckOnClient(checkClient, dbPath);
    const [users, orders, walletsV2, withdrawals] = await Promise.all([
      checkClient.user.count(),
      checkClient.order.count(),
      checkClient.walletV2.count(),
      checkClient.boosterWithdrawalRequest.count(),
    ]);
    return {
      integrityOk: report.integrityOk,
      fkViolationCount: report.fkViolationCount,
      counts: { users, orders, walletsV2, withdrawals },
    };
  } finally {
    await checkClient.$disconnect();
  }
}

export async function createBetaDatabaseBackup(
  sourceDbPath: string,
  options: { backupDir?: string; label?: string; client?: PrismaClient } = {}
): Promise<BetaBackupResult> {
  const sourceCheck = validateBetaDatabaseUrl(`file:${path.resolve(sourceDbPath).replace(/\\/g, '/')}`);
  if (!sourceCheck.valid || !sourceCheck.resolvedPath || !sourceCheck.canonicalUrl) {
    throw new Error(`[BetaBackup] Source database rejected: ${sourceCheck.error}`);
  }
  const resolvedSource = sourceCheck.resolvedPath;
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`[BetaBackup] Source database not found at '${resolvedSource}'.`);
  }

  const backupDir = options.backupDir
    ? path.resolve(options.backupDir)
    : resolveDefaultBetaBackupDir();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rawLabel = (options.label || 'beta').replace(/[^a-zA-Z0-9_-]/g, '_');
  const backupFileName = `beta_backup_${rawLabel}_${stamp}_${crypto.randomBytes(3).toString('hex')}.db`;
  const backupPath = path.resolve(backupDir, backupFileName);
  const escapedBackupPath = backupPath.replace(/\\/g, '/').replace(/'/g, "''");

  const ownClient = !options.client;
  const activeClient =
    options.client ||
    new PrismaClient({ datasources: { db: { url: sourceCheck.canonicalUrl } } });

  try {
    await activeClient.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');
    await activeClient.$executeRawUnsafe(`VACUUM INTO '${escapedBackupPath}';`);
  } finally {
    if (ownClient) {
      await activeClient.$disconnect();
    }
  }

  const inspection = await inspectDatabaseSnapshotCounts(backupPath);
  if (!inspection.integrityOk || inspection.fkViolationCount > 0) {
    try { fs.unlinkSync(backupPath); } catch {}
    throw new Error(
      `[BetaBackup] Verified backup failed integrity check (integrityOk=${inspection.integrityOk}, fkViolations=${inspection.fkViolationCount}).`
    );
  }

  const bytes = fs.readFileSync(backupPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

  return {
    backupPath,
    sourceDbPath: resolvedSource,
    sizeBytes: bytes.length,
    sha256,
    integrityOk: inspection.integrityOk,
    fkViolationCount: inspection.fkViolationCount,
    counts: inspection.counts,
    createdAt: new Date().toISOString(),
  };
}

export async function restoreBetaDatabaseFromBackup(
  backupPath: string,
  targetDbPath: string,
  options: { preRestoreSnapshotDir?: string } = {}
): Promise<BetaRestoreResult> {
  const resolvedBackup = path.resolve(backupPath);
  if (!fs.existsSync(resolvedBackup)) {
    throw new Error(`[BetaRestore] Backup file not found: '${resolvedBackup}'.`);
  }

  const targetCheck = validateBetaDatabaseUrl(`file:${path.resolve(targetDbPath).replace(/\\/g, '/')}`);
  if (!targetCheck.valid || !targetCheck.resolvedPath || !targetCheck.canonicalUrl) {
    throw new Error(`[BetaRestore] Target database rejected: ${targetCheck.error}`);
  }
  const resolvedTarget = targetCheck.resolvedPath;

  // Verify backup BEFORE modifying the target database
  const backupInspection = await inspectDatabaseSnapshotCounts(resolvedBackup);
  if (!backupInspection.integrityOk || backupInspection.fkViolationCount > 0) {
    throw new Error(
      `[BetaRestore] Backup failed integrity verification and will NOT be restored (integrityOk=${backupInspection.integrityOk}, fkViolations=${backupInspection.fkViolationCount}).`
    );
  }

  const targetDir = path.dirname(resolvedTarget);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let preRestoreSnapshotPath: string | null = null;
  if (fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).size > 0) {
    const snapshotDir = options.preRestoreSnapshotDir
      ? path.resolve(options.preRestoreSnapshotDir)
      : resolveDefaultBetaBackupDir();
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    preRestoreSnapshotPath = path.resolve(
      snapshotDir,
      `pre_restore_${path.basename(resolvedTarget, '.db')}_${stamp}.corrupt_or_prev.bak`
    );
    fs.copyFileSync(resolvedTarget, preRestoreSnapshotPath);
  }

  // Copy via temp file in target directory, clear stale WAL/SHM/journal files, and atomically rename
  const tempRestorePath = `${resolvedTarget}.restoring.${process.pid}.${Date.now()}.tmp`;
  fs.copyFileSync(resolvedBackup, tempRestorePath);

  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecarPath = `${resolvedTarget}${suffix}`;
    if (fs.existsSync(sidecarPath)) {
      fs.unlinkSync(sidecarPath);
    }
  }

  fs.renameSync(tempRestorePath, resolvedTarget);

  const restoredCheck = await inspectDatabaseSnapshotCounts(resolvedTarget);
  if (!restoredCheck.integrityOk || restoredCheck.fkViolationCount > 0) {
    throw new Error(
      `[BetaRestore] Post-restore integrity verification failed (integrityOk=${restoredCheck.integrityOk}, fkViolations=${restoredCheck.fkViolationCount}).`
    );
  }

  return {
    restoredFrom: resolvedBackup,
    targetDbPath: resolvedTarget,
    preRestoreSnapshotPath,
    integrityOk: restoredCheck.integrityOk,
    fkViolationCount: restoredCheck.fkViolationCount,
    counts: restoredCheck.counts,
    restoredAt: new Date().toISOString(),
  };
}
