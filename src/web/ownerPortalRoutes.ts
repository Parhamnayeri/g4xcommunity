/**
 * src/web/ownerPortalRoutes.ts — Owner Executive Control & System Configuration API (Website Phase 8)
 * 
 * Strict Invariants:
 *  1. Protected by OwnerGate and live server-authoritative database owner resolution.
 *  2. Never grant Owner access merely because frontend claims role="owner".
 *  3. Live financial feature gates are strictly read-only; no UI toggle or bypass endpoints exist.
 *  4. Financial configuration validated server-side, preserving historical quotes and snapshots.
 *  5. Sensitive banking details masked where appropriate; secrets redacted in AuditLog.
 *  6. Withdrawal-only 3,000-toman deduction policy is respected and never applied to deposits.
 */

import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../database/db';
import { requireAuth, requireCsrf, AuthenticatedRequest } from './middleware/auth';
import { resolveDatabaseOwner, ownerGateRateLimiter } from './ownerGate';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';
import { ADVERTISER_RANK_RATES_BPS, ADVERTISER_RANK_LABELS, formatBasisPoints, AdvertiserRank } from '../services/advertiserRankService';

export const ownerPortalRouter = Router();

/**
 * Strict Owner-Only Access Guard:
 *  - Authenticated session
 *  - Active database user holding 'owner' role
 *  - Matches the authoritative resolved database owner snowflake
 *  - Verified live SYSTEM_CONFIG_MANAGE permission
 */
export async function requireOwnerPortalAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = (req as AuthenticatedRequest).user;
  if (!user || !user.isActive) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication session required' });
    return;
  }

  // 1. Live role check from database
  const userRoles = (user.userRoles || []).map((r) => r.roleKey);
  if (!userRoles.includes('owner')) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Owner privileges strictly required.' });
    return;
  }

  // 2. Strict OwnerGate identity validation against single database owner
  const ownerResolution = await resolveDatabaseOwner(prisma);
  if (!ownerResolution.owner || ownerResolution.owner.discordId !== user.discordId) {
    res.status(403).json({
      error: 'OWNER_GATE_VERIFICATION_FAILED',
      message: 'Access denied: Identity does not match the authoritative established platform owner.',
    });
    return;
  }

  // 3. Live server-authoritative permission check
  const auth = await authorize(user.discordId, Permission.SYSTEM_CONFIG_MANAGE);
  if (!auth.allowed) {
    res.status(403).json({ error: 'PERMISSION_DENIED', message: auth.reason });
    return;
  }

  next();
}

/**
 * Banking field masking helpers
 */
function maskCard(card?: string | null): string {
  if (!card) return '';
  const clean = card.replace(/[\s-]/g, '');
  if (clean.length < 10) return '****';
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-****-${clean.slice(-4)}`;
}

function maskIban(iban?: string | null): string {
  if (!iban) return '';
  const clean = iban.replace(/\s+/g, '').toUpperCase();
  if (clean.length < 10) return 'IR** ****';
  return `IR** **** **** **** **** **${clean.slice(-4, -2)} ${clean.slice(-2)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. OWNER EXECUTIVE OVERVIEW & SYSTEM HEALTH
// ─────────────────────────────────────────────────────────────────────────────

ownerPortalRouter.get(
  '/owner/overview',
  requireAuth,
  requireOwnerPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;

      const [
        totalUsers,
        activeUsers,
        walletsV1Agg,
        walletsV2Agg,
        ordersTotal,
        disputesTotal,
        auditLogsCount,
        recentAudits,
        ownerResolution,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.wallet.aggregate({
          _sum: {
            balanceUsd: true,
            escrowUsd: true,
            balanceGold: true,
            escrowGold: true,
            balanceUsdt: true,
            balanceIrt: true,
          },
        }),
        prisma.walletV2.aggregate({
          _sum: {
            availableCents: true,
            reservedCents: true,
            pendingEarningsCents: true,
            confirmedEarningsCents: true,
            paidCents: true,
          },
        }),
        prisma.order.count(),
        prisma.orderDispute.count({ where: { status: 'OPEN' } }),
        prisma.auditLog.count(),
        prisma.auditLog.findMany({
          take: 8,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            actorId: true,
            action: true,
            entityType: true,
            entityId: true,
            isSuccess: true,
            createdAt: true,
            reason: true,
          },
        }),
        resolveDatabaseOwner(prisma),
      ]);

      const featureGates = [
        {
          key: 'ESCROW_RELEASE_ENABLED',
          name: 'Escrow Automated Release',
          isEnabled: process.env.ESCROW_RELEASE_ENABLED === 'true',
          description: 'Enables automated release of escrow funds upon order completion.',
          statusNotice: 'Strictly disabled (false). Escrow requires manual approval.',
        },
        {
          key: 'FINANCE_V2_LIVE_CREDITS_ENABLED',
          name: 'Finance V2 Live Credits',
          isEnabled: process.env.FINANCE_V2_LIVE_CREDITS_ENABLED === 'true',
          description: 'Enables live wallet crediting upon deposit confirmation.',
          statusNotice: 'Strictly disabled (false). Live credits blocked pending readiness review.',
        },
        {
          key: 'FINANCE_V2_LIVE_PAYOUTS_ENABLED',
          name: 'Finance V2 Live Payouts',
          isEnabled: process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED === 'true',
          description: 'Enables live blockchain and banking disbursement from platform treasury.',
          statusNotice: 'Strictly disabled (false). Payout disbursement requires future explicit authorization.',
        },
        {
          key: 'FINANCE_V2_P2P_SETTLEMENT_ENABLED',
          name: 'Finance V2 P2P Settlement',
          isEnabled: process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED === 'true',
          description: 'Enables direct peer-to-peer settlement between Advertisers and Exchangers.',
          statusNotice: 'Strictly disabled (false) in current phase.',
        },
        {
          key: 'NOWPAYMENTS_LIVE_COLLECTION_ENABLED',
          name: 'NOWPayments Live Gateway',
          isEnabled: process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED === 'true',
          description: 'Enables automated cryptocurrency payment collection and automated reconciliation.',
          statusNotice: 'Strictly disabled (false). Manual verification required.',
        },
      ];

      res.json({
        success: true,
        owner: {
          discordId: user.discordId,
          username: user.username,
          displayName: user.displayName,
          establishedOwnerId: ownerResolution.owner?.discordId,
          isAuthoritativeOwner: ownerResolution.owner?.discordId === user.discordId,
        },
        stats: {
          totalUsers,
          activeUsers,
          ordersTotal,
          openDisputes: disputesTotal,
          auditLogsCount,
          walletsOverview: {
            v1: walletsV1Agg._sum,
            v2: walletsV2Agg._sum,
          },
        },
        featureGates,
        recentAudits,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'OWNER_OVERVIEW_FAILED', message: err.message || 'Failed to fetch owner overview' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. READ-ONLY FEATURE GATES INDICATORS
// ─────────────────────────────────────────────────────────────────────────────

ownerPortalRouter.get(
  '/owner/feature-gates',
  requireAuth,
  requireOwnerPortalAccess,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const gates = [
        {
          key: 'ESCROW_RELEASE_ENABLED',
          name: 'Escrow Automated Release',
          isEnabled: process.env.ESCROW_RELEASE_ENABLED === 'true',
          description: 'Automated release of escrowed booster funds upon run proof approval.',
          policy: 'Must remain false. Release requires manual verification.',
        },
        {
          key: 'FINANCE_V2_LIVE_CREDITS_ENABLED',
          name: 'Finance V2 Live Credits',
          isEnabled: process.env.FINANCE_V2_LIVE_CREDITS_ENABLED === 'true',
          description: 'Automated crediting of user wallets upon deposit confirmation.',
          policy: 'Must remain false. Phantom balance injection strictly prohibited.',
        },
        {
          key: 'FINANCE_V2_LIVE_PAYOUTS_ENABLED',
          name: 'Finance V2 Live Payouts',
          isEnabled: process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED === 'true',
          description: 'Direct blockchain USDT and Iranian Sheba payouts from hot wallet/treasury.',
          policy: 'Must remain false. Live disbursement requires separate readiness authorization.',
        },
        {
          key: 'FINANCE_V2_P2P_SETTLEMENT_ENABLED',
          name: 'Finance V2 P2P Settlement',
          isEnabled: process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED === 'true',
          description: 'Autonomous P2P gold-currency settlement between Advertisers and Exchangers.',
          policy: 'Must remain false. Controlled administrative oversight enforced.',
        },
        {
          key: 'NOWPAYMENTS_LIVE_COLLECTION_ENABLED',
          name: 'NOWPayments Live Gateway',
          isEnabled: process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED === 'true',
          description: 'Live cryptocurrency payment processing and automated webhook ingestion.',
          policy: 'Must remain false. Sandbox and manual payment tracking active.',
        },
      ];

      res.json({
        success: true,
        gates,
        policyNotice: 'Feature gates are statically configured via server environment. No UI toggles or runtime override endpoints exist.',
      });
    } catch (err: any) {
      res.status(500).json({ error: 'GATES_FETCH_FAILED', message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. SYSTEM FINANCIAL CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

ownerPortalRouter.get(
  '/owner/financial-config',
  requireAuth,
  requireOwnerPortalAccess,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const configs = await prisma.systemFinancialConfig.findMany({
        orderBy: { key: 'asc' },
      });

      const configMap = new Map(configs.map((c) => [c.key, c]));

      const getVal = (key: string, defaultVal: string) => configMap.get(key)?.value ?? defaultVal;

      const rawCard = getVal('irt_bank_card_number', '6037-9918-0000-0000');
      const rawIban = getVal('irt_bank_iban', 'IR000000000000000000000000');

      const sanitizedConfigs = {
        admin_usd_irt_rate: {
          key: 'admin_usd_irt_rate',
          value: getVal('admin_usd_irt_rate', '60000'),
          unit: 'IRT / Toman per 1 USD',
          description: 'Authoritative platform reference rate for USD/IRT conversions.',
          updatedAt: configMap.get('admin_usd_irt_rate')?.updatedAt,
          updatedBy: configMap.get('admin_usd_irt_rate')?.updatedBy,
        },
        incoming_irt_fee_rate: {
          key: 'incoming_irt_fee_rate',
          value: getVal('incoming_irt_fee_rate', '0.02'),
          unit: 'Percentage (0.02 = 2.00%)',
          description: 'Platform incoming fee percentage applied to manual IRT deposits.',
          updatedAt: configMap.get('incoming_irt_fee_rate')?.updatedAt,
          updatedBy: configMap.get('incoming_irt_fee_rate')?.updatedBy,
        },
        incoming_irt_quote_ttl_minutes: {
          key: 'incoming_irt_quote_ttl_minutes',
          value: getVal('incoming_irt_quote_ttl_minutes', '30'),
          unit: 'Minutes',
          description: 'Validity lifespan for generated IRT card-to-card quotes.',
          updatedAt: configMap.get('incoming_irt_quote_ttl_minutes')?.updatedAt,
          updatedBy: configMap.get('incoming_irt_quote_ttl_minutes')?.updatedBy,
        },
        irt_bank_name: {
          key: 'irt_bank_name',
          value: getVal('irt_bank_name', 'Bank Melli Iran'),
          unit: 'String',
          description: 'Receiving bank name for official G4X card-to-card deposits.',
          updatedAt: configMap.get('irt_bank_name')?.updatedAt,
          updatedBy: configMap.get('irt_bank_name')?.updatedBy,
        },
        irt_bank_card_holder: {
          key: 'irt_bank_card_holder',
          value: getVal('irt_bank_card_holder', 'G4X Community Official Account'),
          unit: 'String',
          description: 'Authorized card holder name displayed on deposit invoices.',
          updatedAt: configMap.get('irt_bank_card_holder')?.updatedAt,
          updatedBy: configMap.get('irt_bank_card_holder')?.updatedBy,
        },
        irt_bank_card_number: {
          key: 'irt_bank_card_number',
          value: rawCard,
          maskedValue: maskCard(rawCard),
          unit: '16-digit Card Number',
          description: 'Official Iranian bank card number for incoming deposit verification.',
          updatedAt: configMap.get('irt_bank_card_number')?.updatedAt,
          updatedBy: configMap.get('irt_bank_card_number')?.updatedBy,
        },
        irt_bank_iban: {
          key: 'irt_bank_iban',
          value: rawIban,
          maskedValue: maskIban(rawIban),
          unit: 'IR Sheba / IBAN',
          description: 'Official Iranian Sheba account number for high-volume deposits.',
          updatedAt: configMap.get('irt_bank_iban')?.updatedAt,
          updatedBy: configMap.get('irt_bank_iban')?.updatedBy,
        },
        irt_payout_tuesday_cutoff_hour: {
          key: 'irt_payout_tuesday_cutoff_hour',
          value: getVal('irt_payout_tuesday_cutoff_hour', '14'),
          unit: 'Hour (0-23 UTC+3:30)',
          description: 'Weekly cutoff hour on Tuesdays for booster IRT withdrawal settlement.',
          updatedAt: configMap.get('irt_payout_tuesday_cutoff_hour')?.updatedAt,
          updatedBy: configMap.get('irt_payout_tuesday_cutoff_hour')?.updatedBy,
        },
      };

      // Advertiser rank commission settings
      const advertiserRanks = Object.values(AdvertiserRank).map((rank) => ({
        rank,
        label: ADVERTISER_RANK_LABELS[rank],
        basisPoints: ADVERTISER_RANK_RATES_BPS[rank],
        percentageFormatted: formatBasisPoints(ADVERTISER_RANK_RATES_BPS[rank]),
      }));

      // Recent config audit trail
      const auditTrail = await prisma.auditLog.findMany({
        where: { entityType: 'SystemFinancialConfig' },
        orderBy: { createdAt: 'desc' },
        take: 15,
        include: {
          actor: { select: { discordId: true, username: true, displayName: true } },
        },
      });

      res.json({
        success: true,
        configs: sanitizedConfigs,
        advertiserRanks,
        withdrawalDeductionPolicy: {
          fixedDeductionToman: 3000,
          description: 'Per-transaction Iranian banking transfer fee of 3,000 Toman deducted solely from Booster IRT withdrawals. Strictly never applied to deposits.',
        },
        auditTrail: auditTrail.map((a) => ({
          id: a.id,
          actor: a.actor?.displayName || a.actor?.username || a.actorId,
          action: a.action,
          configKey: a.entityId,
          reason: a.reason,
          createdAt: a.createdAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'CONFIG_FETCH_FAILED', message: err.message });
    }
  }
);

ownerPortalRouter.put(
  '/owner/financial-config',
  requireAuth,
  requireOwnerPortalAccess,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { configs, reason } = req.body;

      if (!configs || typeof configs !== 'object') {
        res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'Configs object is required.' });
        return;
      }

      if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
        res.status(400).json({
          error: 'MANDATORY_REASON_REQUIRED',
          message: 'An audit reason of at least 5 characters is required for financial configuration changes.',
        });
        return;
      }

      // Validated configuration key updates
      const validatedUpdates: Record<string, string> = {};

      if (configs.admin_usd_irt_rate !== undefined) {
        const rate = Number(configs.admin_usd_irt_rate);
        if (isNaN(rate) || rate <= 0 || !Number.isFinite(rate)) {
          res.status(400).json({ error: 'INVALID_RATE', message: 'admin_usd_irt_rate must be a positive safe number.' });
          return;
        }
        validatedUpdates.admin_usd_irt_rate = String(Math.round(rate));
      }

      if (configs.incoming_irt_fee_rate !== undefined) {
        const fee = Number(configs.incoming_irt_fee_rate);
        if (isNaN(fee) || fee < 0 || fee >= 0.5) {
          res.status(400).json({ error: 'INVALID_FEE_RATE', message: 'incoming_irt_fee_rate must be a fraction between 0.00 and 0.49 (0% to 49%).' });
          return;
        }
        validatedUpdates.incoming_irt_fee_rate = String(fee);
      }

      if (configs.incoming_irt_quote_ttl_minutes !== undefined) {
        const ttl = parseInt(configs.incoming_irt_quote_ttl_minutes, 10);
        if (isNaN(ttl) || ttl < 5 || ttl > 1440) {
          res.status(400).json({ error: 'INVALID_TTL', message: 'incoming_irt_quote_ttl_minutes must be between 5 and 1440 minutes.' });
          return;
        }
        validatedUpdates.incoming_irt_quote_ttl_minutes = String(ttl);
      }

      if (configs.irt_bank_name !== undefined) {
        const name = String(configs.irt_bank_name).trim();
        if (name.length < 2 || name.length > 100) {
          res.status(400).json({ error: 'INVALID_BANK_NAME', message: 'irt_bank_name must be between 2 and 100 characters.' });
          return;
        }
        validatedUpdates.irt_bank_name = name;
      }

      if (configs.irt_bank_card_holder !== undefined) {
        const holder = String(configs.irt_bank_card_holder).trim();
        if (holder.length < 2 || holder.length > 100) {
          res.status(400).json({ error: 'INVALID_HOLDER_NAME', message: 'irt_bank_card_holder must be between 2 and 100 characters.' });
          return;
        }
        validatedUpdates.irt_bank_card_holder = holder;
      }

      if (configs.irt_bank_card_number !== undefined) {
        const cardClean = String(configs.irt_bank_card_number).replace(/[\s-]/g, '');
        if (!/^\d{16}$/.test(cardClean)) {
          res.status(400).json({ error: 'INVALID_CARD_NUMBER', message: 'irt_bank_card_number must be exactly 16 digits.' });
          return;
        }
        // Format as XXXX-XXXX-XXXX-XXXX
        validatedUpdates.irt_bank_card_number = `${cardClean.slice(0, 4)}-${cardClean.slice(4, 8)}-${cardClean.slice(8, 12)}-${cardClean.slice(12, 16)}`;
      }

      if (configs.irt_bank_iban !== undefined) {
        const ibanClean = String(configs.irt_bank_iban).replace(/\s+/g, '').toUpperCase();
        if (!/^IR\d{24}$/.test(ibanClean)) {
          res.status(400).json({ error: 'INVALID_IBAN', message: 'irt_bank_iban must be a valid 26-character Iranian Sheba (IR + 24 digits).' });
          return;
        }
        validatedUpdates.irt_bank_iban = ibanClean;
      }

      if (configs.irt_payout_tuesday_cutoff_hour !== undefined) {
        const hour = parseInt(configs.irt_payout_tuesday_cutoff_hour, 10);
        if (isNaN(hour) || hour < 0 || hour > 23) {
          res.status(400).json({ error: 'INVALID_CUTOFF_HOUR', message: 'irt_payout_tuesday_cutoff_hour must be an integer between 0 and 23.' });
          return;
        }
        validatedUpdates.irt_payout_tuesday_cutoff_hour = String(hour);
      }

      if (Object.keys(validatedUpdates).length === 0) {
        res.status(400).json({ error: 'NO_VALID_UPDATES', message: 'No valid configuration fields supplied.' });
        return;
      }

      // Execute atomic transaction preserving historical records
      await prisma.$transaction(async (tx) => {
        for (const [key, value] of Object.entries(validatedUpdates)) {
          const prev = await tx.systemFinancialConfig.findUnique({ where: { key } });

          await tx.systemFinancialConfig.upsert({
            where: { key },
            create: {
              key,
              value,
              updatedBy: user.discordId,
              updatedAt: new Date(),
            },
            update: {
              value,
              updatedBy: user.discordId,
              updatedAt: new Date(),
            },
          });

          // Redact card number or IBAN in audit log
          let loggedPrev = prev?.value || 'UNSET';
          let loggedNew = value;
          if (key === 'irt_bank_card_number') {
            loggedPrev = maskCard(loggedPrev);
            loggedNew = maskCard(loggedNew);
          } else if (key === 'irt_bank_iban') {
            loggedPrev = maskIban(loggedPrev);
            loggedNew = maskIban(loggedNew);
          }

          await tx.auditLog.create({
            data: {
              actorId: user.discordId,
              action: 'FINANCIAL_CONFIG_UPDATED',
              entityType: 'SystemFinancialConfig',
              entityId: key,
              previousValues: JSON.stringify({ key, value: loggedPrev }),
              newValues: JSON.stringify({ key, value: loggedNew }),
              reason: reason.trim(),
              isSuccess: true,
            },
          });
        }
      });

      res.json({
        success: true,
        message: 'Financial configuration successfully updated and audited.',
        updatedKeys: Object.keys(validatedUpdates),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'CONFIG_UPDATE_FAILED', message: err.message || 'Failed to update financial configuration' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. WALLET & LEDGER OVERSIGHT
// ─────────────────────────────────────────────────────────────────────────────

ownerPortalRouter.get(
  '/owner/wallets-ledgers',
  requireAuth,
  requireOwnerPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));

      const [walletsV2Count, totalLedgerEntries, ledgerEntries, walletsV2Agg] = await Promise.all([
        prisma.walletV2.count(),
        prisma.ledgerEntryV2.count(),
        prisma.ledgerEntryV2.findMany({
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            user: { select: { username: true, displayName: true } },
          },
        }),
        prisma.walletV2.aggregate({
          _sum: {
            availableCents: true,
            reservedCents: true,
            pendingEarningsCents: true,
            confirmedEarningsCents: true,
            paidCents: true,
          },
        }),
      ]);

      const sumAvail = walletsV2Agg._sum?.availableCents || 0;
      const sumReserved = walletsV2Agg._sum?.reservedCents || 0;
      const sumPending = walletsV2Agg._sum?.pendingEarningsCents || 0;

      res.json({
        success: true,
        summary: {
          totalWalletsV2: walletsV2Count,
          totalLedgerEntries,
          aggregateBalances: {
            availableUsd: (sumAvail / 100).toFixed(2),
            reservedUsd: (sumReserved / 100).toFixed(2),
            pendingEarningsUsd: (sumPending / 100).toFixed(2),
            totalLiabilitiesUsd: ((sumAvail + sumReserved + sumPending) / 100).toFixed(2),
          },
        },
        recentEntries: ledgerEntries.map((e) => ({
          id: e.id,
          entryRef: e.entryRef,
          userId: e.userId,
          username: e.user?.displayName || e.user?.username || e.userId,
          amountCents: e.amountCents,
          amountFormatted: `$${(e.amountCents / 100).toFixed(2)}`,
          direction: e.direction,
          entryType: e.entryType,
          accountType: e.accountType,
          description: e.description,
          relatedEntity: e.orderId
            ? `Order #${e.orderId}`
            : e.fundingRequestId
            ? `Deposit #${e.fundingRequestId}`
            : e.withdrawalRequestId
            ? `Withdrawal #${e.withdrawalRequestId}`
            : e.goldTradeId
            ? `GoldTrade #${e.goldTradeId}`
            : null,
          createdAt: e.createdAt,
        })),
        pagination: {
          page,
          limit,
          total: totalLedgerEntries,
          totalPages: Math.ceil(totalLedgerEntries / limit),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: 'LEDGER_FETCH_FAILED', message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. OWNER AUDIT LOG EXPLORATION
// ─────────────────────────────────────────────────────────────────────────────

ownerPortalRouter.get(
  '/owner/audit-logs',
  requireAuth,
  requireOwnerPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 30));
      const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
      const entityType = typeof req.query.entityType === 'string' ? req.query.entityType.trim() : '';
      const actorId = typeof req.query.actorId === 'string' ? req.query.actorId.trim() : '';

      const whereClause: any = {};
      if (action) whereClause.action = { contains: action };
      if (entityType) whereClause.entityType = entityType;
      if (actorId) whereClause.actorId = actorId;

      const [total, logs] = await Promise.all([
        prisma.auditLog.count({ where: whereClause }),
        prisma.auditLog.findMany({
          where: whereClause,
          include: {
            actor: { select: { discordId: true, username: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      res.json({
        success: true,
        logs: logs.map((l) => ({
          id: l.id,
          actor: l.actor?.displayName || l.actor?.username || l.actorId,
          actorId: l.actorId,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          previousValues: l.previousValues,
          newValues: l.newValues,
          reason: l.reason,
          isSuccess: l.isSuccess,
          createdAt: l.createdAt,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: 'OWNER_AUDIT_FAILED', message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. SECURITY & OPERATIONAL HEALTH
// ─────────────────────────────────────────────────────────────────────────────

ownerPortalRouter.get(
  '/owner/security-health',
  requireAuth,
  requireOwnerPortalAccess,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const ownerResolution = await resolveDatabaseOwner(prisma);
      const activeSessionsCount = await prisma.session.count({
        where: { expiresAt: { gt: new Date() } },
      });

      res.json({
        success: true,
        securityStatus: {
          databaseOwnerStatus: ownerResolution.reason || 'ESTABLISHED_UNIQUE_OWNER',
          ownerSnowflake: ownerResolution.owner?.discordId,
          ownerUsername: ownerResolution.owner?.username,
          activeSessions: activeSessionsCount,
          nodeEnv: process.env.NODE_ENV || 'development',
          rateLimiterWindowMinutes: 15,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: 'HEALTH_CHECK_FAILED', message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. GOOGLE DRIVE BACKUPS & DISASTER RECOVERY
// ─────────────────────────────────────────────────────────────────────────────

import {
  checkRcloneHealth,
  runFullHybridBackup,
  listRemoteBackups,
  restoreFromRemoteBackup,
} from '../services/googleDriveBackupService';
import { getSchedulerStatus } from '../services/backupScheduler';

// ۱. وضعیت سیستم پشتیبان‌گیری و فهرست اسنپ‌شات‌ها
ownerPortalRouter.get(
  ['/owner/backups', '/api/owner/backups'],
  requireAuth,
  requireOwnerPortalAccess,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const rcloneStatus = checkRcloneHealth();
      const schedulerStatus = getSchedulerStatus();
      const snapshots = listRemoteBackups();

      res.json({
        success: true,
        rcloneStatus,
        schedulerStatus,
        snapshots,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'BACKUP_FETCH_FAILED', message: err.message || 'Failed to inspect backups' });
    }
  }
);

// ۲. اجرای دستی پشتیبان‌گیری اتمیک هیبریدی و همگام‌سازی ابری
ownerPortalRouter.post(
  ['/owner/backups/run', '/api/owner/backups/run'],
  requireAuth,
  requireOwnerPortalAccess,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const result = await runFullHybridBackup('manual', actorId);

      res.json({
        success: true,
        backup: result,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'BACKUP_RUN_FAILED', message: err.message || 'Backup execution failed' });
    }
  }
);

// ۳. بازگردانی تاییدشده دیتابیس از اسنپ‌شات با اسنپ‌شات ایمنی پیش از ریستور
ownerPortalRouter.post(
  ['/owner/backups/restore', '/api/owner/backups/restore'],
  requireAuth,
  requireOwnerPortalAccess,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).user.discordId;
      const { snapshotFilename, confirmPhrase, restoreStorage } = req.body;

      if (!snapshotFilename || typeof snapshotFilename !== 'string') {
        res.status(400).json({ error: 'INVALID_REQUEST', message: 'snapshotFilename is required.' });
        return;
      }

      if (confirmPhrase !== 'RESTORE') {
        res.status(400).json({
          error: 'CONFIRMATION_REQUIRED',
          message: 'Explicit safety confirmation phrase RESTORE is strictly required.',
        });
        return;
      }

      const report = await restoreFromRemoteBackup(snapshotFilename, {
        restoreStorage: Boolean(restoreStorage),
        actorId,
      });

      res.json({
        success: true,
        report,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'RESTORE_FAILED', message: err.message || 'Database restore failed' });
    }
  }
);

