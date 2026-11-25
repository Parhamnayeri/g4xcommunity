/**
 * src/services/exchangeAuthService.ts
 *
 * G4X In-Game Currency & Items Exchange — Phase 2:
 * Exchanger KYC Verification, Role Synchronization, and Buyer/Seller Authorization Guards.
 *
 * Strict Guardrails:
 *  - 8-State Exchanger KYC lifecycle:
 *    NOT_SUBMITTED | PENDING_REVIEW | UNDER_REVIEW | APPROVED | REJECTED | REQUIRES_ADDITIONAL_INFO | EXPIRED | SUSPENDED
 *  - Buyer Guard: Requires active 'exchanger' role AND APPROVED non-expired non-suspended KYC.
 *  - Seller Guard: User ONLY needs >= 1 active G4X role (UserRole). NO separate KYC or 'exchanger' role required to sell.
 *  - Pre-existing Exchanger Bridge: Existing 'exchanger' role holders are smoothly bridged without lockout.
 *  - Full Audit Logging for every KYC review & role mutation.
 */

import prisma from '../database/db';
import { logExchangeAudit } from './exchangeConfigService';

export type ExchangeKycStatus =
  | 'NOT_SUBMITTED'
  | 'PENDING_REVIEW'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'REQUIRES_ADDITIONAL_INFO'
  | 'EXPIRED'
  | 'SUSPENDED';

export const PRIVILEGED_EXCHANGE_BUYER_ROLES = new Set([
  'staff',
  'management',
  'manager',
  'admin',
  'owner',
]);

export interface ExchangeEligibility {
  userId: string;
  hasExchangerRole: boolean;
  hasPrivilegedBuyerRole: boolean;
  kycStatus: ExchangeKycStatus;
  kycExpiresAt: Date | null;
  isSuspended: boolean;
  canCreateBuyOrder: boolean;
  canSubmitSellOffer: boolean;
  activeRoles: string[];
  blockingReasons: string[];
}

export class ExchangeAuthError extends Error {
  public statusCode: number;
  public reasons: string[];

  constructor(message: string, statusCode: number = 403, reasons: string[] = []) {
    super(message);
    this.name = 'ExchangeAuthError';
    this.statusCode = statusCode;
    this.reasons = reasons;
  }
}

/**
 * Evaluates the full Exchange eligibility for a user.
 * Bridges existing 'exchanger' role holders automatically so they are never locked out.
 * Allows staff, management, manager, admin, and owner roles to buy game currency
 * independently of having the 'exchanger' role or exchanger KYC.
 */
export async function getExchangeEligibility(userId: string): Promise<ExchangeEligibility> {
  const blockingReasons: string[] = [];

  const user = await prisma.user.findUnique({
    where: { discordId: userId },
    include: {
      userRoles: true,
      exchangeKyc: true,
      exchangePermission: true,
    },
  });

  if (!user || !user.isActive) {
    return {
      userId,
      hasExchangerRole: false,
      hasPrivilegedBuyerRole: false,
      kycStatus: 'NOT_SUBMITTED',
      kycExpiresAt: null,
      isSuspended: false,
      canCreateBuyOrder: false,
      canSubmitSellOffer: false,
      activeRoles: [],
      blockingReasons: ['User account does not exist or is deactivated.'],
    };
  }

  const activeRoles = (user.userRoles || []).map((r) => r.roleKey.toLowerCase());
  const isOwnerByEnv = Boolean(process.env.OWNER_DISCORD_ID) && process.env.OWNER_DISCORD_ID === user.discordId;
  const hasExchangerRole = activeRoles.includes('exchanger');
  const hasPrivilegedBuyerRole =
    isOwnerByEnv || activeRoles.some((r) => PRIVILEGED_EXCHANGE_BUYER_ROLES.has(r));

  // Check suspension status
  const isSuspended = Boolean(user.exchangePermission?.isSuspended);

  // Backward compatibility bridge:
  // If user has 'exchanger' role but no KYC or NOT_SUBMITTED, auto-upsert APPROVED status so they are not disrupted
  let kycRecord = user.exchangeKyc;
  if (hasExchangerRole && (!kycRecord || kycRecord.status === 'NOT_SUBMITTED')) {
    kycRecord = await prisma.exchangeKycRequest.upsert({
      where: { userId },
      create: {
        userId,
        status: 'APPROVED',
        notes: 'Auto-bridged legacy verified exchanger',
        approvedAt: new Date(),
        reviewedByDiscordId: 'SYSTEM',
      },
      update: {
        status: 'APPROVED',
        approvedAt: new Date(),
      },
    });

    await prisma.exchangeUserPermission.upsert({
      where: { userId },
      create: {
        userId,
        canCreateBuyOrder: true,
        canSubmitSellOffer: true,
        isSuspended: false,
      },
      update: {
        canCreateBuyOrder: true,
      },
    });
  }

  const kycStatus = (kycRecord?.status as ExchangeKycStatus) || 'NOT_SUBMITTED';
  const kycExpiresAt = kycRecord?.expiresAt || null;
  const isKycExpired = Boolean(kycExpiresAt && new Date(kycExpiresAt).getTime() <= Date.now());

  // 1. Seller Eligibility Rule:
  // User ONLY needs at least one active G4X role. NO separate KYC or 'exchanger' role required to sell.
  const canSubmitSellOffer = (activeRoles.length > 0 || isOwnerByEnv) && !isSuspended;
  if (activeRoles.length === 0 && !isOwnerByEnv) {
    blockingReasons.push('User must have at least one active G4X role (e.g. booster, advertiser, exchanger, staff) to sell.');
  }
  if (isSuspended) {
    blockingReasons.push('Exchange privileges are suspended.');
  }

  // 2. Buyer Eligibility Rule:
  // Staff, management, manager, admin, and owner roles can buy game currency independently
  // of 'exchanger' role and exchanger KYC. Standard members require active 'exchanger' role AND APPROVED KYC.
  let canCreateBuyOrder = true;

  if (!hasPrivilegedBuyerRole) {
    if (!hasExchangerRole) {
      canCreateBuyOrder = false;
      blockingReasons.push('Exchanger role (or Staff/Management/Admin/Owner access) is required to create buy orders.');
    }

    if (kycStatus !== 'APPROVED') {
      canCreateBuyOrder = false;
      blockingReasons.push(`Exchanger KYC verification is ${kycStatus}. Approved KYC is required to create buy orders.`);
    }

    if (isKycExpired) {
      canCreateBuyOrder = false;
      blockingReasons.push('Exchanger KYC verification has expired.');
    }
  }

  if (isSuspended) {
    canCreateBuyOrder = false;
  }

  // If explicitly disabled in permissions table
  if (user.exchangePermission && !user.exchangePermission.canCreateBuyOrder) {
    canCreateBuyOrder = false;
    blockingReasons.push('Buy order permissions have been restricted for this account.');
  }

  return {
    userId,
    hasExchangerRole,
    hasPrivilegedBuyerRole,
    kycStatus,
    kycExpiresAt,
    isSuspended,
    canCreateBuyOrder,
    canSubmitSellOffer,
    activeRoles,
    blockingReasons,
  };
}

/**
 * Strict Buyer Guard: Asserts user is eligible to create buy orders.
 * Throws 403 ExchangeAuthError if ineligible.
 */
export async function assertEligibleExchangeBuyer(userId: string): Promise<ExchangeEligibility> {
  const eligibility = await getExchangeEligibility(userId);
  if (!eligibility.canCreateBuyOrder) {
    throw new ExchangeAuthError(
      'Access Denied: Only approved Exchangers with valid KYC or Staff/Management/Admin/Owner roles may create Exchange Buy Orders.',
      403,
      eligibility.blockingReasons
    );
  }
  return eligibility;
}

/**
 * Strict Seller Guard: Asserts user is eligible to submit sell offers.
 * Requires at least 1 active role and non-suspended status.
 * Throws 403 ExchangeAuthError if ineligible.
 */
export async function assertEligibleExchangeSeller(userId: string): Promise<ExchangeEligibility> {
  const eligibility = await getExchangeEligibility(userId);
  if (!eligibility.canSubmitSellOffer) {
    throw new ExchangeAuthError(
      'Access Denied: User is not eligible to submit Exchange sell offers.',
      403,
      eligibility.blockingReasons
    );
  }
  return eligibility;
}

/**
 * Submits or resubmits an Exchanger KYC application.
 */
export async function submitExchangerKycApplication(params: {
  userId: string;
  documentsMetaJson?: string;
  notes?: string;
}) {
  const { userId, documentsMetaJson, notes } = params;

  const existing = await prisma.exchangeKycRequest.findUnique({
    where: { userId },
  });

  if (existing?.status === 'APPROVED') {
    throw new ExchangeAuthError('User KYC is already APPROVED. No re-submission needed.', 400);
  }

  const kyc = await prisma.exchangeKycRequest.upsert({
    where: { userId },
    create: {
      userId,
      status: 'PENDING_REVIEW',
      documentsMetaJson: documentsMetaJson || null,
      notes: notes || null,
      submittedAt: new Date(),
    },
    update: {
      status: 'PENDING_REVIEW',
      documentsMetaJson: documentsMetaJson !== undefined ? documentsMetaJson : existing?.documentsMetaJson,
      notes: notes !== undefined ? notes : existing?.notes,
      submittedAt: new Date(),
      adminReviewNotes: null,
      reviewedByDiscordId: null,
      reviewedAt: null,
    },
  });

  await prisma.exchangeUserPermission.upsert({
    where: { userId },
    create: {
      userId,
      canCreateBuyOrder: false,
      canSubmitSellOffer: true,
      isSuspended: false,
    },
    update: {
      canCreateBuyOrder: false,
    },
  });

  await logExchangeAudit({
    actorId: userId,
    action: 'EXCHANGE_KYC_SUBMITTED',
    entityType: 'ExchangeKycRequest',
    entityId: kyc.id,
    previousValues: existing ? { status: existing.status } : null,
    newValues: { status: 'PENDING_REVIEW', submittedAt: kyc.submittedAt },
    reason: notes || 'Submitted Exchanger KYC application',
  });

  return kyc;
}

/**
 * Admin / Staff review of an Exchanger KYC request.
 */
export async function reviewExchangerKyc(params: {
  adminDiscordId: string;
  requestId: string;
  action: 'APPROVE' | 'REJECT' | 'REQUEST_INFO' | 'SUSPEND' | 'EXPIRE';
  notes?: string;
  expiresAt?: Date | null;
}) {
  const { adminDiscordId, requestId, action, notes, expiresAt } = params;

  const kyc = await prisma.exchangeKycRequest.findUnique({
    where: { id: requestId },
  });

  if (!kyc) {
    throw new ExchangeAuthError('Exchange KYC request not found', 404);
  }

  let nextStatus: ExchangeKycStatus;
  switch (action) {
    case 'APPROVE':
      nextStatus = 'APPROVED';
      break;
    case 'REJECT':
      nextStatus = 'REJECTED';
      break;
    case 'REQUEST_INFO':
      nextStatus = 'REQUIRES_ADDITIONAL_INFO';
      break;
    case 'SUSPEND':
      nextStatus = 'SUSPENDED';
      break;
    case 'EXPIRE':
      nextStatus = 'EXPIRED';
      break;
    default:
      throw new ExchangeAuthError(`Invalid KYC review action: ${action}`, 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedKyc = await tx.exchangeKycRequest.update({
      where: { id: requestId },
      data: {
        status: nextStatus,
        adminReviewNotes: notes || null,
        reviewedByDiscordId: adminDiscordId,
        reviewedAt: new Date(),
        approvedAt: action === 'APPROVE' ? new Date() : kyc.approvedAt,
        expiresAt: action === 'APPROVE' && expiresAt ? expiresAt : kyc.expiresAt,
      },
    });

    if (action === 'APPROVE') {
      // 1. Ensure 'exchanger' role exists
      await tx.role.upsert({
        where: { roleKey: 'exchanger' },
        create: { roleKey: 'exchanger', name: 'Exchanger' },
        update: {},
      });

      // 2. Grant role
      await tx.userRole.upsert({
        where: {
          userId_roleKey: {
            userId: kyc.userId,
            roleKey: 'exchanger',
          },
        },
        create: {
          userId: kyc.userId,
          roleKey: 'exchanger',
          grantedBy: adminDiscordId,
          grantedAt: new Date(),
        },
        update: {
          grantedBy: adminDiscordId,
          grantedAt: new Date(),
        },
      });

      // 3. Grant permission
      await tx.exchangeUserPermission.upsert({
        where: { userId: kyc.userId },
        create: {
          userId: kyc.userId,
          canCreateBuyOrder: true,
          canSubmitSellOffer: true,
          isSuspended: false,
        },
        update: {
          canCreateBuyOrder: true,
          isSuspended: false,
          suspensionReason: null,
        },
      });
    } else {
      // Non-approved: disable canCreateBuyOrder
      await tx.exchangeUserPermission.upsert({
        where: { userId: kyc.userId },
        create: {
          userId: kyc.userId,
          canCreateBuyOrder: false,
          canSubmitSellOffer: action !== 'SUSPEND',
          isSuspended: action === 'SUSPEND',
          suspensionReason: action === 'SUSPEND' ? notes || 'Suspended by admin' : null,
          suspendedAt: action === 'SUSPEND' ? new Date() : null,
          suspendedByDiscordId: action === 'SUSPEND' ? adminDiscordId : null,
        },
        update: {
          canCreateBuyOrder: false,
          ...(action === 'SUSPEND'
            ? {
                isSuspended: true,
                suspensionReason: notes || 'Suspended by admin',
                suspendedAt: new Date(),
                suspendedByDiscordId: adminDiscordId,
                canSubmitSellOffer: false,
              }
            : {}),
        },
      });
    }

    return updatedKyc;
  });

  await logExchangeAudit({
    actorId: adminDiscordId,
    action: `EXCHANGE_KYC_${action}`,
    entityType: 'ExchangeKycRequest',
    entityId: kyc.id,
    previousValues: { status: kyc.status },
    newValues: { status: nextStatus, adminReviewNotes: notes },
    reason: notes || `Admin reviewed KYC application: ${action}`,
  });

  return result;
}

/**
 * Directly toggles/grants/revokes the 'exchanger' role for a user.
 */
export async function setExchangerRole(params: {
  adminDiscordId: string;
  targetDiscordId: string;
  grant: boolean;
  reason?: string;
}) {
  const { adminDiscordId, targetDiscordId, grant, reason } = params;

  await prisma.$transaction(async (tx) => {
    if (grant) {
      await tx.role.upsert({
        where: { roleKey: 'exchanger' },
        create: { roleKey: 'exchanger', name: 'Exchanger' },
        update: {},
      });

      await tx.userRole.upsert({
        where: {
          userId_roleKey: {
            userId: targetDiscordId,
            roleKey: 'exchanger',
          },
        },
        create: {
          userId: targetDiscordId,
          roleKey: 'exchanger',
          grantedBy: adminDiscordId,
          grantedAt: new Date(),
        },
        update: {
          grantedBy: adminDiscordId,
          grantedAt: new Date(),
        },
      });

      await tx.exchangeUserPermission.upsert({
        where: { userId: targetDiscordId },
        create: {
          userId: targetDiscordId,
          canCreateBuyOrder: true,
          canSubmitSellOffer: true,
          isSuspended: false,
        },
        update: {
          canCreateBuyOrder: true,
        },
      });
    } else {
      await tx.userRole.deleteMany({
        where: {
          userId: targetDiscordId,
          roleKey: 'exchanger',
        },
      });

      await tx.exchangeUserPermission.upsert({
        where: { userId: targetDiscordId },
        create: {
          userId: targetDiscordId,
          canCreateBuyOrder: false,
          canSubmitSellOffer: true,
          isSuspended: false,
        },
        update: {
          canCreateBuyOrder: false,
        },
      });
    }
  });

  await logExchangeAudit({
    actorId: adminDiscordId,
    action: grant ? 'EXCHANGE_ROLE_GRANTED' : 'EXCHANGE_ROLE_REVOKED',
    entityType: 'UserRole',
    entityId: `${targetDiscordId}:exchanger`,
    newValues: { granted: grant },
    reason: reason || (grant ? 'Granted exchanger role' : 'Revoked exchanger role'),
  });

  return { success: true, targetDiscordId, grant };
}

/**
 * Lists Exchanger KYC requests for Admin/Staff review.
 */
export async function listExchangeKycRequests(params: {
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (params.status && params.status !== 'ALL') {
    where.status = params.status;
  }

  const [items, total] = await Promise.all([
    prisma.exchangeKycRequest.findMany({
      where,
      include: {
        user: {
          select: {
            discordId: true,
            username: true,
            displayName: true,
            createdAt: true,
            userRoles: {
              select: { roleKey: true },
            },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.exchangeKycRequest.count({ where }),
  ]);

  return {
    items: items.map((item: any) => ({
      ...item,
      user: item.user
        ? {
            discordId: item.user.discordId,
            username: item.user.username,
            displayName: item.user.displayName || item.user.username,
            roles: (item.user.userRoles || []).map((r: { roleKey: string }) => r.roleKey),
            createdAt: item.user.createdAt,
          }
        : null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
