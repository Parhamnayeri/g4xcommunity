/**
 * src/beta/legacyOrderImport.ts
 *
 * Safe, Idempotent Existing/Legacy Discord Order Intake for G4X Operational Closed Beta v0.001.
 *
 * Key Safety Invariants:
 *  1. Confined strictly to staging/beta SQLite databases under `prisma/staging/`.
 *  2. Defaults to dry-run preview; actual database writes require explicit `confirmImport: true`.
 *  3. Requires deterministic unique `sourceOrderId` on every row; duplicate `sourceOrderId` (in batch
 *     or already in DB via `externalOrderId` / deterministic `orderRef`) is cleanly skipped without mutation.
 *  4. Distinguishes `historical_completed` orders (creates `OrderFinancialSnapshot` with
 *     `calculationStatus = 'historical_imported'` and performs ZERO automatic WalletV2 / LedgerV2 credits)
 *     from active operational orders (`open_presign`, `assigned`, `in_progress`, etc.).
 *  5. Validates games, active services, currencies, and integer minor amounts before writing.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { validateBetaDatabaseUrl } from './validateBetaEnv';

export type LegacyIntakeMode = 'active' | 'historical_completed';

export interface LegacyBoosterAssignmentInput {
  discordId: string;
  username?: string;
  role: string;
}

export interface LegacyOrderImportRecord {
  sourceOrderId: string;
  intakeMode: LegacyIntakeMode;
  status?: string; // Active status: 'payment_pending' | 'open_presign' | 'presign_closed' | 'assigned' | 'in_progress'
  gameSlug: string;
  serviceKey: string;
  orderName?: string;
  orderType?: 'solo' | 'group' | 'pilot';
  orderMode?: 'non_pilot' | 'pilot';
  quantity?: number;
  currency?: 'USD' | 'USDT' | 'GOLD' | 'IRT';
  grossAmountMinor: number;
  platformFeeMinor?: number;
  advertiserFeeMinor?: number;
  boosterPoolMinor?: number;
  sourceType?: 'internal' | 'website' | 'direct';
  sourcePlatform?: string;
  paymentStatus?: 'pending' | 'verified' | 'unneeded';
  customerDiscordId?: string;
  customerUsername?: string;
  advertiserDiscordId?: string;
  advertiserUsername?: string;
  assignedBoosters?: LegacyBoosterAssignmentInput[];
  notes?: string;
  completedAt?: string;
}

export interface LegacyImportValidationIssue {
  index: number;
  sourceOrderId?: string;
  reason: string;
}

export interface LegacyOrderImportReport {
  dryRun: boolean;
  confirmImport: boolean;
  databaseMainFile: string;
  totalInputRows: number;
  validRows: number;
  createdActive: number;
  createdHistorical: number;
  skippedDuplicate: number;
  rejectedInvalid: number;
  issues: LegacyImportValidationIssue[];
  createdOrderIds: number[];
  createdOrderRefs: string[];
}

const VALID_ACTIVE_STATUSES = new Set([
  'payment_pending',
  'open_presign',
  'presign_closed',
  'assigned',
  'in_progress',
]);

const VALID_CURRENCIES = new Set(['USD', 'USDT', 'GOLD', 'IRT']);
const VALID_ORDER_TYPES = new Set(['solo', 'group', 'pilot']);
const VALID_ORDER_MODES = new Set(['non_pilot', 'pilot']);
const DISCORD_SNOWFLAKE_RE = /^[1-9][0-9]{16,19}$/;

export function buildDeterministicLegacyOrderRef(sourceOrderId: string): string {
  const clean = sourceOrderId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .slice(0, 32);
  const hash = crypto
    .createHash('sha256')
    .update(sourceOrderId.trim())
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `IMP-${clean}-${hash}`;
}

export async function assertConfinedBetaDatabaseClient(prismaClient: PrismaClient): Promise<string> {
  const dbList: Array<{ seq: number; name: string; file: string }> =
    await prismaClient.$queryRawUnsafe('PRAGMA database_list;');
  const mainFile = path.resolve(dbList.find((d) => d.name === 'main')?.file || '');
  if (!mainFile) {
    throw new Error('[LegacyOrderImport] Unable to determine active SQLite database file.');
  }
  const urlCheck = validateBetaDatabaseUrl(`file:${mainFile.replace(/\\/g, '/')}`);
  if (!urlCheck.valid) {
    throw new Error(`[LegacyOrderImport] Database confinement refused: ${urlCheck.error}`);
  }
  return mainFile;
}

export function parseLegacyOrdersFile(filePath: string): LegacyOrderImportRecord[] {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`[LegacyOrderImport] Input file not found: '${resolved}'.`);
  }
  const raw = fs.readFileSync(resolved, 'utf8').trim();
  if (!raw) return [];

  if (resolved.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.orders)) return parsed.orders;
    throw new Error('[LegacyOrderImport] JSON file must contain an array of order objects or { orders: [...] }.');
  }

  // Minimal RFC-safe CSV parser for flat spreadsheets (comma-separated, optional double quotes)
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const splitCsvRow = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = splitCsvRow(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvRow(line);
    const row: Record<string, any> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });
    const toOptInt = (v: any) => (v !== '' && v !== undefined ? Number(v) : undefined);
    return {
      sourceOrderId: String(row.sourceOrderId || ''),
      intakeMode: (row.intakeMode || 'active') as LegacyIntakeMode,
      status: row.status || undefined,
      gameSlug: String(row.gameSlug || ''),
      serviceKey: String(row.serviceKey || ''),
      orderName: row.orderName || undefined,
      orderType: row.orderType || undefined,
      orderMode: row.orderMode || undefined,
      quantity: toOptInt(row.quantity),
      currency: row.currency || undefined,
      grossAmountMinor: Number(row.grossAmountMinor),
      platformFeeMinor: toOptInt(row.platformFeeMinor),
      advertiserFeeMinor: toOptInt(row.advertiserFeeMinor),
      boosterPoolMinor: toOptInt(row.boosterPoolMinor),
      sourceType: row.sourceType || undefined,
      sourcePlatform: row.sourcePlatform || undefined,
      paymentStatus: row.paymentStatus || undefined,
      customerDiscordId: row.customerDiscordId || undefined,
      advertiserDiscordId: row.advertiserDiscordId || undefined,
      notes: row.notes || undefined,
      completedAt: row.completedAt || undefined,
    };
  });
}

export async function importLegacyBetaOrders(
  prismaClient: PrismaClient,
  records: LegacyOrderImportRecord[],
  options: {
    dryRun?: boolean;
    confirmImport?: boolean;
    actorDiscordId?: string;
  } = {}
): Promise<LegacyOrderImportReport> {
  const mainFile = await assertConfinedBetaDatabaseClient(prismaClient);

  const confirmImport = options.confirmImport === true;
  const dryRun = options.dryRun !== undefined ? options.dryRun : !confirmImport;
  if (!dryRun && !confirmImport) {
    throw new Error('[LegacyOrderImport] Live DB import requires explicit confirmImport: true.');
  }

  const issues: LegacyImportValidationIssue[] = [];
  const seenSourceIds = new Set<string>();
  const createdOrderIds: number[] = [];
  const createdOrderRefs: string[] = [];

  let validRows = 0;
  let createdActive = 0;
  let createdHistorical = 0;
  let skippedDuplicate = 0;

  if (options.actorDiscordId && !DISCORD_SNOWFLAKE_RE.test(options.actorDiscordId.trim())) {
    throw new Error(`[LegacyOrderImport] Invalid actorDiscordId '${options.actorDiscordId}'.`);
  }

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const rawSourceId = typeof rec?.sourceOrderId === 'string' ? rec.sourceOrderId.trim() : '';
    if (!rawSourceId || rawSourceId.length > 128) {
      issues.push({
        index: i,
        sourceOrderId: rawSourceId || undefined,
        reason: 'Missing or invalid sourceOrderId (must be 1..128 characters).',
      });
      continue;
    }

    if (seenSourceIds.has(rawSourceId)) {
      skippedDuplicate++;
      issues.push({
        index: i,
        sourceOrderId: rawSourceId,
        reason: 'Duplicate sourceOrderId within input batch (skipped).',
      });
      continue;
    }
    seenSourceIds.add(rawSourceId);

    if (rec.intakeMode !== 'active' && rec.intakeMode !== 'historical_completed') {
      issues.push({
        index: i,
        sourceOrderId: rawSourceId,
        reason: `Invalid intakeMode '${String(rec.intakeMode)}' (expected 'active' | 'historical_completed').`,
      });
      continue;
    }

    const activeStatus = rec.status?.trim() || 'open_presign';
    if (rec.intakeMode === 'active' && !VALID_ACTIVE_STATUSES.has(activeStatus)) {
      issues.push({
        index: i,
        sourceOrderId: rawSourceId,
        reason: `Invalid active status '${activeStatus}'.`,
      });
      continue;
    }

    const currency = (rec.currency || 'USD').trim().toUpperCase();
    if (!VALID_CURRENCIES.has(currency)) {
      issues.push({ index: i, sourceOrderId: rawSourceId, reason: `Unsupported currency '${currency}'.` });
      continue;
    }

    const orderType = (rec.orderType || 'group').trim();
    if (!VALID_ORDER_TYPES.has(orderType)) {
      issues.push({ index: i, sourceOrderId: rawSourceId, reason: `Invalid orderType '${orderType}'.` });
      continue;
    }

    const quantity = rec.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      issues.push({ index: i, sourceOrderId: rawSourceId, reason: `Invalid quantity '${rec.quantity}'.` });
      continue;
    }

    if (!Number.isInteger(rec.grossAmountMinor) || rec.grossAmountMinor < 0) {
      issues.push({
        index: i,
        sourceOrderId: rawSourceId,
        reason: `grossAmountMinor must be a non-negative integer (got '${rec.grossAmountMinor}').`,
      });
      continue;
    }

    const platformFeeMinor = rec.platformFeeMinor ?? 0;
    const advertiserFeeMinor = rec.advertiserFeeMinor ?? 0;
    const computedPool = rec.grossAmountMinor - platformFeeMinor - advertiserFeeMinor;
    const boosterPoolMinor = rec.boosterPoolMinor ?? Math.max(0, computedPool);

    if (
      !Number.isInteger(platformFeeMinor) || platformFeeMinor < 0 ||
      !Number.isInteger(advertiserFeeMinor) || advertiserFeeMinor < 0 ||
      !Number.isInteger(boosterPoolMinor) || boosterPoolMinor < 0
    ) {
      issues.push({
        index: i,
        sourceOrderId: rawSourceId,
        reason: 'Fee and boosterPoolMinor amounts must be non-negative integers.',
      });
      continue;
    }

    if (rec.customerDiscordId && !DISCORD_SNOWFLAKE_RE.test(rec.customerDiscordId.trim())) {
      issues.push({ index: i, sourceOrderId: rawSourceId, reason: 'Invalid customerDiscordId snowflake.' });
      continue;
    }
    if (rec.advertiserDiscordId && !DISCORD_SNOWFLAKE_RE.test(rec.advertiserDiscordId.trim())) {
      issues.push({ index: i, sourceOrderId: rawSourceId, reason: 'Invalid advertiserDiscordId snowflake.' });
      continue;
    }
    if (rec.assignedBoosters?.some((b) => !b.discordId || !DISCORD_SNOWFLAKE_RE.test(b.discordId.trim()) || !b.role)) {
      issues.push({ index: i, sourceOrderId: rawSourceId, reason: 'Invalid assignedBoosters entry.' });
      continue;
    }
    if (rec.assignedBoosters && rec.assignedBoosters.length > 0 && !options.actorDiscordId) {
      issues.push({
        index: i,
        sourceOrderId: rawSourceId,
        reason: 'actorDiscordId is required when importing assignedBoosters (OrderAssignment.assignedById FK).',
      });
      continue;
    }

    const game = await prismaClient.game.findUnique({ where: { slug: rec.gameSlug } });
    if (!game || !game.isActive) {
      issues.push({ index: i, sourceOrderId: rawSourceId, reason: `Game '${rec.gameSlug}' not found or inactive.` });
      continue;
    }

    const service = await prismaClient.gameService.findFirst({
      where: { gameSlug: game.slug, serviceKey: rec.serviceKey, isActive: true },
    });
    if (!service) {
      issues.push({
        index: i,
        sourceOrderId: rawSourceId,
        reason: `Active service '${rec.serviceKey}' not found for game '${game.slug}'.`,
      });
      continue;
    }

    const orderMode = rec.orderMode || (service.serviceMode === 'pilot' ? 'pilot' : 'non_pilot');
    if (!VALID_ORDER_MODES.has(orderMode)) {
      issues.push({ index: i, sourceOrderId: rawSourceId, reason: `Invalid orderMode '${orderMode}'.` });
      continue;
    }

    const deterministicRef = buildDeterministicLegacyOrderRef(rawSourceId);
    const existing = await prismaClient.order.findFirst({
      where: {
        OR: [
          { externalOrderId: rawSourceId },
          { orderRef: deterministicRef },
        ],
      },
      select: { id: true, orderRef: true },
    });

    if (existing) {
      skippedDuplicate++;
      continue;
    }

    validRows++;

    if (dryRun) {
      if (rec.intakeMode === 'historical_completed') {
        createdHistorical++;
      } else {
        createdActive++;
      }
      continue;
    }

    const created = await prismaClient.$transaction(async (tx) => {
      // Double-check duplicate inside transaction
      const dupInTx = await tx.order.findFirst({
        where: {
          OR: [{ externalOrderId: rawSourceId }, { orderRef: deterministicRef }],
        },
        select: { id: true },
      });
      if (dupInTx) {
        return null;
      }

      if (options.actorDiscordId) {
        await tx.user.upsert({
          where: { discordId: options.actorDiscordId },
          update: {},
          create: {
            discordId: options.actorDiscordId,
            username: `beta_operator_${options.actorDiscordId.slice(-4)}`,
            isActive: true,
          },
        });
      }

      if (rec.customerDiscordId) {
        await tx.user.upsert({
          where: { discordId: rec.customerDiscordId },
          update: {},
          create: {
            discordId: rec.customerDiscordId,
            username: rec.customerUsername || `customer_${rec.customerDiscordId.slice(-4)}`,
            isActive: true,
          },
        });
      }

      if (rec.advertiserDiscordId) {
        await tx.user.upsert({
          where: { discordId: rec.advertiserDiscordId },
          update: {},
          create: {
            discordId: rec.advertiserDiscordId,
            username: rec.advertiserUsername || `advertiser_${rec.advertiserDiscordId.slice(-4)}`,
            isActive: true,
          },
        });
      }

      const isHistorical = rec.intakeMode === 'historical_completed';
      const completedDate = isHistorical
        ? (rec.completedAt ? new Date(rec.completedAt) : new Date())
        : null;

      const order = await tx.order.create({
        data: {
          orderRef: deterministicRef,
          gameSlug: game.slug,
          serviceId: service.id,
          customerId: rec.customerDiscordId || null,
          advertiserId: rec.advertiserDiscordId || null,
          creatorId: options.actorDiscordId || null,
          creatorType: rec.advertiserDiscordId ? 'advertiser' : 'g4x',
          orderName: rec.orderName || `Imported Order ${rawSourceId}`,
          orderType,
          orderMode,
          quantity,
          notes: `${isHistorical ? '[HISTORICAL_IMPORT] ' : '[ACTIVE_BETA_IMPORT] '}sourceOrderId=${rawSourceId}${rec.notes ? ` | ${rec.notes}` : ''}`,
          sourceType: rec.sourceType || 'direct',
          externalOrderId: rawSourceId,
          currency,
          grossAmountMinor: rec.grossAmountMinor,
          platformFeeMinor,
          advertiserFeeMinor,
          boosterPoolMinor,
          paymentStatus: isHistorical ? 'verified' : (rec.paymentStatus || 'pending'),
          status: isHistorical ? 'completed' : activeStatus,
          publishedAt: new Date(),
          completedAt: completedDate,
        },
      });

      // Historical completed imports MUST be flagged 'historical_imported' and MUST NEVER auto-credit WalletV2
      await tx.orderFinancialSnapshot.create({
        data: {
          orderId: order.id,
          sourcePlatform: rec.sourcePlatform || 'discord_legacy',
          sourceAmountType: 'gross_sale',
          sourceAmountMinor: rec.grossAmountMinor,
          grossSaleMinor: rec.grossAmountMinor,
          platformSaleCommissionMinor: 0,
          platformOrderNetMinor: rec.grossAmountMinor,
          externalNetBaseMinor: rec.grossAmountMinor,
          g4xFeeMinor: platformFeeMinor,
          advertiserFeeMinor,
          boosterPoolMinor,
          currency,
          advertiserId: rec.advertiserDiscordId || null,
          calculationStatus: isHistorical ? 'historical_imported' : 'provisional',
          finalizedBy: isHistorical ? (options.actorDiscordId || null) : null,
          finalizedAt: isHistorical ? (completedDate || new Date()) : null,
        },
      });

      if (rec.assignedBoosters && rec.assignedBoosters.length > 0 && options.actorDiscordId) {
        for (const booster of rec.assignedBoosters) {
          await tx.user.upsert({
            where: { discordId: booster.discordId },
            update: {},
            create: {
              discordId: booster.discordId,
              username: booster.username || `booster_${booster.discordId.slice(-4)}`,
              isActive: true,
            },
          });

          await tx.orderAssignment.create({
            data: {
              orderId: order.id,
              userId: booster.discordId,
              assignedById: options.actorDiscordId,
              assignedRole: booster.role,
              status: isHistorical ? 'completed' : 'assigned',
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: options.actorDiscordId || null,
          action: isHistorical ? 'LEGACY_HISTORICAL_ORDER_IMPORTED' : 'LEGACY_ACTIVE_ORDER_IMPORTED',
          entityType: 'Order',
          entityId: String(order.id),
          newValues: JSON.stringify({
            orderRef: order.orderRef,
            sourceOrderId: rawSourceId,
            intakeMode: rec.intakeMode,
            status: order.status,
            grossAmountMinor: order.grossAmountMinor,
            currency: order.currency,
          }),
          reason: `Legacy Discord order intake (${rec.intakeMode})`,
          isSuccess: true,
        },
      });

      return { order, isHistorical };
    });

    if (!created) {
      skippedDuplicate++;
      continue;
    }

    if (created.isHistorical) {
      createdHistorical++;
    } else {
      createdActive++;
    }
    createdOrderIds.push(created.order.id);
    createdOrderRefs.push(created.order.orderRef);
  }

  return {
    dryRun,
    confirmImport,
    databaseMainFile: mainFile,
    totalInputRows: records.length,
    validRows,
    createdActive,
    createdHistorical,
    skippedDuplicate,
    rejectedInvalid: issues.filter((iss) => !iss.reason.includes('Duplicate sourceOrderId')).length,
    issues,
    createdOrderIds,
    createdOrderRefs,
  };
}
