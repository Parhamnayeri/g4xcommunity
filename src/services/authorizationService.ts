/**
 * authorizationService.ts — موتور متمرکز احراز دسترسی و ارزیابی اختیارات پلتفرم G4X
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import {
  Permission,
  SystemRoleKey,
  ROLE_PERMISSIONS,
  SENSITIVE_PERMISSIONS,
  AuthorizationContext,
} from './permissionTypes';
import { Prisma } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
  actorId: string;
  permission: Permission;
  context?: AuthorizationContext;
}

/**
 * متد اصلی ارزیابی دسترسی بازیگر (Actor Identity, Role Union & Contextual Authorization)
 * این متد به صورت Fail-Closed عمل کرده و هرگونه خطای دیتابیس یا فقدان داده به سلب دسترسی منجر می‌شود.
 */
export async function authorize(
  actorId: string,
  permission: Permission,
  context?: AuthorizationContext,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<AuthorizationResult> {
  if (!actorId) {
    return {
      allowed: false,
      reason: 'MISSING_ACTOR_ID: Actor identifier is required',
      actorId: '',
      permission,
      context,
    };
  }

  try {
    // ۱. استعلام اطلاعات کاربر و نقش‌های ثبت‌شده در دیتابیس (سرور مرجع نهایی است)
    const user = await client.user.findUnique({
      where: { discordId: actorId },
      include: {
        userRoles: true,
      },
    });

    if (!user || !user.isActive) {
      return {
        allowed: false,
        reason: 'USER_NOT_FOUND_OR_INACTIVE: User does not exist or is deactivated',
        actorId,
        permission,
        context,
      };
    }

    const userRoles = user.userRoles.map((r) => r.roleKey as SystemRoleKey);

    // ۲. بررسی سوپریوزر (Owner Bypass برای عملیات مجاز زیرساختی و اجرایی)
    const isOwner = userRoles.includes('owner');
    if (isOwner) {
      // ثبت لاگ برای عملیات حساس مالک
      if (SENSITIVE_PERMISSIONS.includes(permission)) {
        await logAuthorizationAudit(client, actorId, permission, true, 'OWNER_SUPERUSER_ACCESS', context);
      }
      return { allowed: true, actorId, permission, context };
    }

    // ۳. کاربر فاقد هرگونه نقش
    if (userRoles.length === 0) {
      // کاربر بدون نقش فقط مجاز به مشاهده والت خودش است
      if (permission === Permission.WALLET_VIEW_OWN && (!context?.targetUserId || context.targetUserId === actorId)) {
        return { allowed: true, actorId, permission, context };
      }
      await logAuthorizationAudit(client, actorId, permission, false, 'NO_ROLES_ASSIGNED', context);
      return {
        allowed: false,
        reason: 'NO_ROLES_ASSIGNED: User holds no system roles',
        actorId,
        permission,
        context,
      };
    }

    // ۴. بررسی موارد انحصاری Owner
    const ownerExclusivePermissions = [
      Permission.SYSTEM_CONFIG_MANAGE,
      Permission.FINANCIAL_POLICY_MANAGE,
      Permission.ESCROW_HOLD_MANAGE,
      Permission.ESCROW_RELEASE_ADMIN,
      Permission.FINANCE_ADJUST,
    ];

    if (ownerExclusivePermissions.includes(permission) && !isOwner) {
      const reasonCode = permission === Permission.FINANCE_ADJUST ? 'FINANCE_ADJUST_FORBIDDEN' : 'OWNER_ONLY_INFRASTRUCTURE';
      await logAuthorizationAudit(client, actorId, permission, false, reasonCode, context);
      return {
        allowed: false,
        reason: `${reasonCode}: This action is strictly reserved for Owner`,
        actorId,
        permission,
        context,
      };
    }

    // ۵. بررسی اسناد هویتی حساس (فقط Admin و Owner؛ مدیریت و استاف سلب دسترسی هستند)
    if (permission === Permission.SENSITIVE_IDENTITY_REVIEW && !userRoles.includes('admin') && !isOwner) {
      await logAuthorizationAudit(client, actorId, permission, false, 'SENSITIVE_IDENTITY_ACCESS_DENIED', context);
      return {
        allowed: false,
        reason: 'SENSITIVE_IDENTITY_ACCESS_DENIED: Identity documents can only be reviewed by Admin or Owner',
        actorId,
        permission,
        context,
      };
    }

    // بررسی تایید واریز دستی (MANUAL_DEPOSIT_REVIEW: فقط Admin و Owner)
    if (permission === Permission.MANUAL_DEPOSIT_REVIEW && !userRoles.includes('admin') && !isOwner) {
      await logAuthorizationAudit(client, actorId, permission, false, 'MANUAL_DEPOSIT_REVIEW_FORBIDDEN', context);
      return {
        allowed: false,
        reason: 'MANUAL_DEPOSIT_REVIEW_FORBIDDEN: Manual deposit review requires Admin or Owner',
        actorId,
        permission,
        context,
      };
    }

    // بررسی تایید یا رد برداشت (WITHDRAWAL_REVIEW: فقط Admin و Owner؛ مدیریت فقط خواندنی است)
    if (permission === Permission.WITHDRAWAL_REVIEW && !userRoles.includes('admin') && !isOwner) {
      await logAuthorizationAudit(client, actorId, permission, false, 'WITHDRAWAL_REVIEW_FORBIDDEN', context);
      return {
        allowed: false,
        reason: 'WITHDRAWAL_REVIEW_FORBIDDEN: Withdrawal approvals and review require Admin or Owner',
        actorId,
        permission,
        context,
      };
    }

    // بررسی ضد خود-تاییدی (Anti-Self-Approval): کاربر نمی‌تواند خود را مسدود کند یا به خود نقش دهد
    if (context?.targetUserId && context.targetUserId === actorId) {
      if ([Permission.USER_BAN, Permission.USER_ROLE_ASSIGN].includes(permission)) {
        await logAuthorizationAudit(client, actorId, permission, false, 'ANTI_SELF_APPROVAL', context);
        return {
          allowed: false,
          reason: 'ANTI_SELF_APPROVAL: Cannot modify roles or ban your own account',
          actorId,
          permission,
          context,
        };
      }
    }

    // ۶. ارزیابی دسترسی‌های مبتنی بر منبع و زمینه (Contextual Authorization Rules)

    // ۶.۱. مشاهده یا عملیات سفارشات (Order Scope)
    if (
      [
        Permission.ORDER_ASSIGN,
        Permission.ORDER_CANCEL,
        Permission.ORDER_REPLACE_BOOSTER,
        Permission.ORDER_VIEW_PRIVATE,
      ].includes(permission)
    ) {
      // ممانعت قاطع از دسترسی صراف به اطلاعات سفارشات بوست
      if (userRoles.includes('exchanger') && !userRoles.some((r) => ['manager', 'admin'].includes(r))) {
        await logAuthorizationAudit(client, actorId, permission, false, 'EXCHANGER_CONFIDENTIAL_DENIED', context);
        return {
          allowed: false,
          reason: 'EXCHANGER_CONFIDENTIAL_DENIED: Exchangers cannot access boost order source records',
          actorId,
          permission,
          context,
        };
      }

      const isManagerOrAdmin = userRoles.some((r) => ['manager', 'admin'].includes(r));
      if (isManagerOrAdmin) {
        return { allowed: true, actorId, permission, context };
      }

      if (userRoles.includes('advertiser')) {
        const order = await resolveOrderContext(client, context);
        if (!order) {
          return {
            allowed: false,
            reason: 'ORDER_CONTEXT_REQUIRED: Order context required for advertiser authorization',
            actorId,
            permission,
            context,
          };
        }

        // Genuine Advertiser-originated enforcement: must NOT have external marketplace sourceWebsite and must have advertiser identity
        const isAdvertiserOriginated =
          !order.sourceWebsite &&
          (Boolean(order.advertiserId) || order.creatorType === 'advertiser');

        if (!isAdvertiserOriginated) {
          await logAuthorizationAudit(client, actorId, permission, false, 'NON_ADVERTISER_ORDER_SCOPE', context);
          return {
            allowed: false,
            reason: 'NON_ADVERTISER_ORDER_SCOPE: Advertisers cannot manage non-advertiser marketplace or internal orders',
            actorId,
            permission,
            context,
          };
        }

        const isOwnerOfOrder =
          (order.advertiserId && order.advertiserId === actorId) ||
          (order.creatorId && order.creatorId === actorId && order.creatorType === 'advertiser');

        if (!isOwnerOfOrder) {
          await logAuthorizationAudit(client, actorId, permission, false, 'UNAUTHORIZED_ORDER_SCOPE', context);
          return {
            allowed: false,
            reason: 'UNAUTHORIZED_ORDER_SCOPE: Advertisers can only manage their own authorized orders',
            actorId,
            permission,
            context,
          };
        }

        return { allowed: true, actorId, permission, context };
      }

      // سایر نقش‌ها (استاف، بوستر و ...) اجازه مدیریت سفارش ندارند
      await logAuthorizationAudit(client, actorId, permission, false, 'INSUFFICIENT_ORDER_ROLE', context);
      return {
        allowed: false,
        reason: `INSUFFICIENT_ORDER_ROLE: Role not authorized for ${permission}`,
        actorId,
        permission,
        context,
      };
    }

    // ۶.۲. تایید پرداخت واریزی درون‌بازی یا ارز سفارش (ORDER_PAYMENT_VERIFY)
    if (permission === Permission.ORDER_PAYMENT_VERIFY) {
      const isAuthorizedVerifier = userRoles.some((r) => ['manager', 'admin'].includes(r));
      if (!isAuthorizedVerifier) {
        await logAuthorizationAudit(client, actorId, permission, false, 'PAYMENT_VERIFY_FORBIDDEN', context);
        return {
          allowed: false,
          reason: 'PAYMENT_VERIFY_FORBIDDEN: Staff and advertisers cannot verify payments',
          actorId,
          permission,
          context,
        };
      }
      return { allowed: true, actorId, permission, context };
    }

    // ۶.۳. تایید نهایی اتمام سفارش (ORDER_FINAL_APPROVE)
    if (permission === Permission.ORDER_FINAL_APPROVE) {
      const isAuthorizedApprover = userRoles.some((r) => ['manager', 'admin'].includes(r));
      if (!isAuthorizedApprover) {
        await logAuthorizationAudit(client, actorId, permission, false, 'FINAL_APPROVE_FORBIDDEN', context);
        return {
          allowed: false,
          reason: 'FINAL_APPROVE_FORBIDDEN: Final completion approval requires Admin, Manager or Owner',
          actorId,
          permission,
          context,
        };
      }
      return { allowed: true, actorId, permission, context };
    }

    // ۶.۴. ثبت مدرک ران توسط بوستر (PROOF_SUBMIT_ASSIGNED)
    if (permission === Permission.PROOF_SUBMIT_ASSIGNED) {
      if (!userRoles.includes('booster') && !userRoles.includes('pilot')) {
        return {
          allowed: false,
          reason: 'BOOSTER_ROLE_REQUIRED: Must be a booster or pilot to submit proof',
          actorId,
          permission,
          context,
        };
      }

      if (context?.runId) {
        const run = await client.orderRun.findUnique({ where: { id: context.runId } });
        if (!run) {
          return { allowed: false, reason: 'RUN_NOT_FOUND', actorId, permission, context };
        }

        // Exact RunAssignment verification when granular run assignments exist
        const runAssignmentCount = await client.runAssignment.count({
          where: { runId: run.id },
        });

        let isAssigned = false;
        if (runAssignmentCount > 0) {
          const runAssigned = await client.runAssignment.findFirst({
            where: {
              runId: run.id,
              status: 'assigned',
              assignment: { userId: actorId },
            },
          });
          isAssigned = !!runAssigned;
        } else {
          const assignment = await client.orderAssignment.findFirst({
            where: { orderId: run.orderId, userId: actorId, status: 'assigned' },
          });
          isAssigned = !!assignment;
        }

        if (!isAssigned) {
          await logAuthorizationAudit(client, actorId, permission, false, 'UNASSIGNED_RUN_PROOF', context);
          return {
            allowed: false,
            reason: 'UNASSIGNED_RUN_PROOF: Booster cannot submit proof for an unassigned run',
            actorId,
            permission,
            context,
          };
        }
      }

      return { allowed: true, actorId, permission, context };
    }

    // ۶.۵. ثبت کلیم و صلاحیت بازی/سرویس (CLAIM_CREATE)
    if (permission === Permission.CLAIM_CREATE) {
      if (!userRoles.includes('booster') && !userRoles.includes('pilot')) {
        return {
          allowed: false,
          reason: 'BOOSTER_ROLE_REQUIRED: Must hold booster or pilot role to register claims',
          actorId,
          permission,
          context,
        };
      }

      if (context?.gameSlug) {
        const approval = await client.userGameApproval.findFirst({
          where: {
            userId: actorId,
            gameSlug: context.gameSlug,
            OR: [{ serviceId: null }, ...(context.serviceId ? [{ serviceId: context.serviceId }] : [])],
            approvalType: 'booster',
            status: 'approved',
          },
        });

        if (!approval) {
          await logAuthorizationAudit(client, actorId, permission, false, 'INACTIVE_OR_MISSING_APPROVAL', context);
          return {
            allowed: false,
            reason: 'INACTIVE_OR_MISSING_APPROVAL: Booster qualification is not approved for this game',
            actorId,
            permission,
            context,
          };
        }
      }

      if (context?.serviceId) {
        const service = await client.gameService.findUnique({ where: { id: context.serviceId } });
        if (service && (service.serviceMode === 'pilot' || service.requiresPilotApproval)) {
          const pilotVerif = await client.pilotVerification.findFirst({
            where: {
              userId: actorId,
              gameSlug: service.gameSlug,
              status: 'approved',
            },
          });

          if (!pilotVerif || (pilotVerif.expiresAt && pilotVerif.expiresAt < new Date())) {
            await logAuthorizationAudit(client, actorId, permission, false, 'PILOT_VERIFICATION_REQUIRED', context);
            return {
              allowed: false,
              reason: 'PILOT_VERIFICATION_REQUIRED: Approved and active pilot verification is required',
              actorId,
              permission,
              context,
            };
          }
        }
      }

      return { allowed: true, actorId, permission, context };
    }

    // ۶.۶. مدیریت پیشنهادات صرافی (EXCHANGER_OFFER_MANAGE_OWN)
    if (permission === Permission.EXCHANGER_OFFER_MANAGE_OWN) {
      if (!userRoles.includes('exchanger')) {
        return {
          allowed: false,
          reason: 'EXCHANGER_ROLE_REQUIRED: Exchanger role required',
          actorId,
          permission,
          context,
        };
      }

      if (context?.offerId) {
        const offer = await client.exchangerOffer.findUnique({ where: { id: context.offerId } });
        if (!offer || offer.exchangerId !== actorId) {
          await logAuthorizationAudit(client, actorId, permission, false, 'UNAUTHORIZED_EXCHANGER_OFFER', context);
          return {
            allowed: false,
            reason: 'UNAUTHORIZED_EXCHANGER_OFFER: Exchangers can only manage their own offers',
            actorId,
            permission,
            context,
          };
        }
      }

      return { allowed: true, actorId, permission, context };
    }

    // ۶.۷. مشاهده والت شخصی در برابر والت دیگران
    if (permission === Permission.WALLET_VIEW_OWN) {
      if (context?.targetUserId && context.targetUserId !== actorId) {
        const canViewOthers = userRoles.some((r) => ['owner', 'admin', 'manager'].includes(r));
        if (!canViewOthers) {
          await logAuthorizationAudit(client, actorId, permission, false, 'UNAUTHORIZED_WALLET_VIEW', context);
          return {
            allowed: false,
            reason: 'UNAUTHORIZED_WALLET_VIEW: Viewing other users wallets requires elevated financial role',
            actorId,
            permission,
            context,
          };
        }
      }
      return { allowed: true, actorId, permission, context };
    }

    // ۶.۸. تعدیل مانده و جابجایی مالی (FINANCE_ADJUST)
    if (permission === Permission.FINANCE_ADJUST) {
      if (!isOwner) {
        await logAuthorizationAudit(client, actorId, permission, false, 'FINANCE_ADJUST_FORBIDDEN', context);
        return {
          allowed: false,
          reason: 'FINANCE_ADJUST_FORBIDDEN: Staff, management, and admins cannot adjust financial balances. Reserved for Owner.',
          actorId,
          permission,
          context,
        };
      }
      return { allowed: true, actorId, permission, context };
    }

    // ۷. بررسی عمومی تطابق با ماتریس پایه مجوزهای نقش‌ها
    const allRolePermissions = new Set<Permission>();
    for (const r of userRoles) {
      const perms = ROLE_PERMISSIONS[r] || [];
      for (const p of perms) {
        allRolePermissions.add(p);
      }
    }

    if (!allRolePermissions.has(permission)) {
      await logAuthorizationAudit(client, actorId, permission, false, 'PERMISSION_NOT_IN_ROLE_MATRIX', context);
      return {
        allowed: false,
        reason: `PERMISSION_DENIED: Roles [${userRoles.join(', ')}] lack permission ${permission}`,
        actorId,
        permission,
        context,
      };
    }

    // ثبت لاگ برای عملیات حساس تاییدشده
    if (SENSITIVE_PERMISSIONS.includes(permission)) {
      await logAuthorizationAudit(client, actorId, permission, true, 'AUTHORIZED', context);
    }

    return { allowed: true, actorId, permission, context };
  } catch (error: any) {
    console.error('[AuthorizationService] Authorization check failed with exception:', error);
    // گارد Fail-Closed: هرگونه خطای دیتابیس منجر به رد دسترسی می‌شود
    return {
      allowed: false,
      reason: `DATABASE_OR_INTERNAL_ERROR: ${error.message}`,
      actorId,
      permission,
      context,
    };
  }
}

/**
 * نسخه ارزیابی دسترسی که در صورت عدم احراز، DomainError پرتاب می‌کند
 */
export async function assertAuthorized(
  actorId: string,
  permission: Permission,
  context?: AuthorizationContext,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<AuthorizationResult> {
  const result = await authorize(actorId, permission, context, client);
  if (!result.allowed) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      result.reason ?? `Access denied for permission ${permission}`,
      { permission, actorId, context },
    );
  }
  return result;
}

/**
 * ثبت لاگ ممیزی امنیتی برای ارزیابی‌های دسترسی
 */
async function logAuthorizationAudit(
  client: Prisma.TransactionClient | typeof prisma,
  actorId: string,
  permission: Permission,
  isAllowed: boolean,
  reason: string,
  context?: AuthorizationContext,
) {
  try {
    await client.auditLog.create({
      data: {
        actorId,
        action: `AUTH_${permission}_${isAllowed ? 'ALLOWED' : 'DENIED'}`,
        entityType: context?.orderId ? 'order' : (context?.offerId ? 'exchanger_offer' : 'permission'),
        entityId: String(context?.orderId ?? context?.offerId ?? permission),
        reason,
        isSuccess: isAllowed,
        newValues: JSON.stringify({
          permission,
          allowed: isAllowed,
          contextEntity: context?.orderId ?? context?.offerId ?? null,
        }),
      },
    });
  } catch (err) {
    console.error('[AuthorizationService] Failed to record audit log:', err);
  }
}

/**
 * متد کمکی برای دریافت اطلاعات سفارش از کانتکست یا دیتابیس
 */
async function resolveOrderContext(
  client: Prisma.TransactionClient | typeof prisma,
  context?: AuthorizationContext,
) {
  if (context?.order) {
    return context.order;
  }
  if (context?.orderId) {
    return await client.order.findUnique({
      where: { id: context.orderId },
    });
  }
  return null;
}

/**
 * میدل‌ویر Express جهت محافظت از روت‌های وب بر مبنای سیستم متمرکز مجوزها
 */
export function requirePermission(
  permission: Permission,
  contextResolver?: (req: Request) => AuthorizationContext,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const actorId = (req as any).user?.discordId ?? (req.session as any)?.userId;
    if (!actorId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    const context = contextResolver ? contextResolver(req) : undefined;
    const authResult = await authorize(actorId, permission, context);

    if (!authResult.allowed) {
      res.status(403).json({
        error: 'Forbidden',
        message: authResult.reason ?? 'Insufficient permissions',
        permission,
      });
      return;
    }

    next();
  };
}

/**
 * گارد اختصاصی برای اینتراکشن‌های دیسکورد
 */
export async function guardDiscordInteraction(
  discordUserId: string,
  permission: Permission,
  context?: AuthorizationContext,
): Promise<AuthorizationResult> {
  return await authorize(discordUserId, permission, context);
}
