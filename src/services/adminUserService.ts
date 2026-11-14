/**
 * adminUserService.ts — سرویس مدیریت کاربران در پنل ادمین پلتفرم G4X
 * 
 * ویژگی‌ها و اصول امنیتی:
 *  - فهرست‌بندی کاربران با صفحه‌بندی امن (Pagination) و فیلترهای جستجو بر اساس نام کاربری، شناسه دیسکورد، رول و وضعیت صلاحیت
 *  - استعلام پروفایل جامع بدون افشای داده‌های حساس (رمزها، کلیدها، شماره‌های پرداخت یا سشن‌ها)
 *  - محافظت سخت‌گیرانه از سلسله‌مراتب مالک سیستم (Owner Hierarchy & Protection Guard)
 *  - ممانعت صریح از ترفیع غیرمجاز به نقش Owner توسط ادمین‌ها یا هر حساب غیرمالک
 *  - مسدودسازی حساب (Suspension) بدون تخریب سوابق تاریخی یا تعهدات مالی، با ثبت دلیل و ممیزی
 *  - صیانت از داده‌های تاریخی: جلوگیری قطعی از حذف کاربرانی که سفارش، رکورد مالی، اسکرو، مدرک یا شکایت دارند
 *  - همگام‌سازی ایمن رول‌های دیسکورد با استفاده از سرویس موجود و مدیریت بدون کرش خطاهای API دیسکورد
 *  - ثبت متمرکز لاگ‌های امنیتی در AuditLog برای کلیه تغییرات حساس
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import { syncDiscordRole } from './registrationService';
import { SystemRoleKey, getEffectivePermissions } from './permissionTypes';

export interface ListAdminUsersOptions {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  approvalStatus?: string;
  accountStatus?: 'all' | 'active' | 'suspended';
}

export interface UserSummaryDto {
  discordId: string;
  username: string;
  displayName: string | null;
  isActive: boolean;
  roles: string[];
  permissions: string[];
  advertiserRank: string | null;
  approvalsSummary: Record<string, string>;
  restrictions: string[];
  isOwner: boolean;
  createdAt: string;
  lastActivityAt: string | null;
}

export interface PaginatedUsersResult {
  users: UserSummaryDto[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface UserProfileDto extends UserSummaryDto {
  updatedAt: string;
  rolesDetailed: {
    roleKey: string;
    grantedBy: string | null;
    grantedAt: string;
  }[];
  approvals: {
    id: number;
    gameSlug: string;
    approvalType: string;
    status: string;
    reviewedBy: string | null;
    reviewNote: string | null;
    reviewedAt: string | null;
    createdAt: string;
  }[];
  registrationApplications: {
    id: number;
    category: string;
    gameSlug: string | null;
    status: string;
    qualifications: string;
    roleSyncStatus: string;
    roleSyncError: string | null;
    rejectionReason: string | null;
    reviewNotes: string | null;
    submittedAt: string;
    reviewedAt: string | null;
  }[];
  charactersSummary: {
    count: number;
    characters: {
      id: number;
      name: string;
      realm: string;
      region: string;
      isMain: boolean;
    }[];
  };
  orderStats: {
    asCustomer: number;
    asAdvertiser: number;
    asCreator: number;
    completedRuns: number;
    disputesOpened: number;
  };
  hasHistoricalRecords: boolean;
  historicalCounts: {
    orders: number;
    completedRuns: number;
    proofs: number;
    disputes: number;
    ledgerEntries: number;
  };
}

const PRIMARY_OWNER_ID = process.env.DISCORD_OWNER_ID || '387583875066626069';

/**
 * بررسی آیا کاربر مشخص‌شده، مالک اصلی یا دارای نقش Owner است
 */
export async function isUserOwner(discordId: string, client = prisma): Promise<boolean> {
  if (discordId === PRIMARY_OWNER_ID) return true;
  const ownerRole = await client.userRole.findFirst({
    where: {
      userId: discordId,
      roleKey: 'owner',
    },
  });
  return Boolean(ownerRole);
}

/**
 * ۱. فهرست کاربران با جستجو، فیلتر و صفحه‌بندی امن
 */
export async function listAdminUsers(options: ListAdminUsersOptions): Promise<PaginatedUsersResult> {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
  const skip = (page - 1) * limit;

  const whereClause: any = {};

  // جستجو بر اساس شناسه دیسکورد، نام کاربری یا نام نمایشی
  if (options.search && options.search.trim()) {
    const q = options.search.trim();
    whereClause.OR = [
      { discordId: { contains: q } },
      { username: { contains: q } },
      { displayName: { contains: q } },
    ];
  }

  // فیلتر وضعیت حساب
  if (options.accountStatus === 'active') {
    whereClause.isActive = true;
  } else if (options.accountStatus === 'suspended') {
    whereClause.isActive = false;
  }

  // فیلتر رول
  if (options.role && options.role !== 'all') {
    whereClause.userRoles = {
      some: {
        roleKey: options.role.trim().toLowerCase(),
      },
    };
  }

  // فیلتر وضعیت تاییدیه صلاحیت بازی
  if (options.approvalStatus && options.approvalStatus !== 'all') {
    whereClause.gameApprovals = {
      some: {
        status: options.approvalStatus.trim().toLowerCase(),
      },
    };
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where: whereClause }),
    prisma.user.findMany({
      where: whereClause,
      include: {
        userRoles: true,
        gameApprovals: true,
        auditLogs: {
          select: { createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const userDtos: UserSummaryDto[] = users.map((u) => {
    const roles = u.userRoles.map((r) => r.roleKey);
    const isOwner = u.discordId === PRIMARY_OWNER_ID || roles.includes('owner');

    const approvalsSummary: Record<string, string> = {
      booster: 'none',
      pilot: 'none',
      advertiser: 'none',
      exchanger: 'none',
    };

    for (const app of u.gameApprovals) {
      if (app.approvalType in approvalsSummary) {
        // اولویت وضعیت: approved > pending > suspended > rejected
        const current = approvalsSummary[app.approvalType];
        if (app.status === 'approved' || current === 'none') {
          approvalsSummary[app.approvalType] = app.status;
        }
      }
    }

    const restrictions: string[] = [];
    if (!u.isActive) {
      restrictions.push('SUSPENDED');
    }
    if (isOwner) {
      restrictions.push('PROTECTED_OWNER');
    }

    // محاسبه آخرین فعالیت شناخته‌شده
    let lastActivityAt: string | null = null;
    const dates: number[] = [u.updatedAt.getTime(), u.createdAt.getTime()];
    if (u.auditLogs.length > 0) {
      dates.push(u.auditLogs[0].createdAt.getTime());
    }
    const maxDate = Math.max(...dates);
    if (maxDate > 0) {
      lastActivityAt = new Date(maxDate).toISOString();
    }

    return {
      discordId: u.discordId,
      username: u.username,
      displayName: u.displayName,
      isActive: u.isActive,
      roles,
      permissions: getEffectivePermissions(roles),
      advertiserRank: u.advertiserRank,
      approvalsSummary,
      restrictions,
      isOwner,
      createdAt: u.createdAt.toISOString(),
      lastActivityAt,
    };
  });

  return {
    users: userDtos,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * ۲. دریافت پروفایل کامل یک کاربر برای مدال جزئیات ادمین
 */
export async function getAdminUserProfile(targetUserId: string): Promise<UserProfileDto> {
  const u = (await prisma.user.findUnique({
    where: { discordId: targetUserId },
    include: {
      userRoles: true,
      gameApprovals: {
        orderBy: { createdAt: 'desc' },
      },
      registrationApplications: {
        orderBy: { submittedAt: 'desc' },
        take: 10,
      },
      wowCharacters: {
        select: {
          id: true,
          characterName: true,
          realm: true,
          region: true,
          isMain: true,
        },
      },
      auditLogs: {
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })) as any;

  if (!u) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, `USER_NOT_FOUND: User '${targetUserId}' does not exist`);
  }

  // استعلام آمارهای تاریخی به منظور رعایت کامل اصل عدم حذف
  const [
    customerOrdersCount,
    advOrdersCount,
    createdOrdersCount,
    completedRunsCount,
    disputesCount,
    proofsCount,
    ledgerCount,
  ] = await Promise.all([
    prisma.order.count({ where: { customerId: targetUserId } }),
    prisma.order.count({ where: { advertiserId: targetUserId } }),
    prisma.order.count({ where: { creatorId: targetUserId } }),
    prisma.orderRun.count({ where: { completedBy: targetUserId } }),
    prisma.orderDispute.count({
      where: {
        OR: [
          { openedById: targetUserId },
          { assignedReviewerId: targetUserId },
          { resolvedById: targetUserId },
        ],
      },
    }),
    prisma.runProof.count({
      where: {
        OR: [
          { submittedById: targetUserId },
          { reviewedById: targetUserId },
        ],
      },
    }),
    prisma.ledgerTransaction.count({
      where: {
        OR: [
          { userId: targetUserId },
          { createdBy: targetUserId },
        ],
      },
    }),
  ]);

  const totalHistorical = customerOrdersCount + advOrdersCount + createdOrdersCount + completedRunsCount + disputesCount + proofsCount + ledgerCount;
  const hasHistoricalRecords = totalHistorical > 0;

  const roles = u.userRoles.map((r: any) => r.roleKey);
  const isOwner = u.discordId === PRIMARY_OWNER_ID || roles.includes('owner');

  const approvalsSummary: Record<string, string> = {
    booster: 'none',
    pilot: 'none',
    advertiser: 'none',
    exchanger: 'none',
  };

  for (const app of u.gameApprovals) {
    if (app.approvalType in approvalsSummary) {
      const current = approvalsSummary[app.approvalType];
      if (app.status === 'approved' || current === 'none') {
        approvalsSummary[app.approvalType] = app.status;
      }
    }
  }

  const restrictions: string[] = [];
  if (!u.isActive) restrictions.push('SUSPENDED');
  if (isOwner) restrictions.push('PROTECTED_OWNER');

  let lastActivityAt: string | null = null;
  const dates: number[] = [u.updatedAt.getTime(), u.createdAt.getTime()];
  if (u.auditLogs.length > 0) {
    dates.push(u.auditLogs[0].createdAt.getTime());
  }
  const maxDate = Math.max(...dates);
  if (maxDate > 0) {
    lastActivityAt = new Date(maxDate).toISOString();
  }

  return {
    discordId: u.discordId,
    username: u.username,
    displayName: u.displayName,
    isActive: u.isActive,
    roles,
    permissions: getEffectivePermissions(roles),
    advertiserRank: u.advertiserRank,
    approvalsSummary,
    restrictions,
    isOwner,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    lastActivityAt,
    rolesDetailed: u.userRoles.map((r: any) => ({
      roleKey: r.roleKey,
      grantedBy: r.grantedBy,
      grantedAt: r.grantedAt.toISOString(),
    })),
    approvals: u.gameApprovals.map((a: any) => ({
      id: a.id,
      gameSlug: a.gameSlug,
      approvalType: a.approvalType,
      status: a.status,
      reviewedBy: a.reviewedBy,
      reviewNote: a.reviewNote,
      reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    })),
    registrationApplications: u.registrationApplications.map((app: any) => ({
      id: app.id,
      category: app.category,
      gameSlug: app.gameSlug,
      status: app.status,
      qualifications: app.qualifications,
      roleSyncStatus: app.roleSyncStatus,
      roleSyncError: app.roleSyncError,
      rejectionReason: app.rejectionReason,
      reviewNotes: app.reviewNotes,
      submittedAt: app.submittedAt.toISOString(),
      reviewedAt: app.reviewedAt ? app.reviewedAt.toISOString() : null,
    })),
    charactersSummary: {
      count: u.wowCharacters.length,
      characters: u.wowCharacters.map((c: any) => ({
        id: c.id,
        name: c.characterName,
        realm: c.realm,
        region: c.region,
        isMain: c.isMain,
      })),
    },
    orderStats: {
      asCustomer: customerOrdersCount,
      asAdvertiser: advOrdersCount,
      asCreator: createdOrdersCount,
      completedRuns: completedRunsCount,
      disputesOpened: disputesCount,
    },
    hasHistoricalRecords,
    historicalCounts: {
      orders: customerOrdersCount + advOrdersCount + createdOrdersCount,
      completedRuns: completedRunsCount,
      proofs: proofsCount,
      disputes: disputesCount,
      ledgerEntries: ledgerCount,
    },
  };
}

/**
 * ۳. مسدودسازی یا فعال‌سازی مجدد کاربر (Suspend / Reactivate User)
 * 
 * قوانین امنیتی:
 *  - حساب Owner سیستم هرگز و تحت هیچ شرایطی تعلیق نمی‌شود (Owner Protection Guard)
 *  - دلیل الزامی است و در لاگ ممیزی سیستم ثبت می‌گردد
 *  - تعلیق، تمامی دسترسی‌های آتی را مسدود می‌سازد ولی کلیه تعهدات مالی، سوابق و سفارشات حفظ می‌شوند
 */
export async function updateUserAccountStatus(params: {
  targetUserId: string;
  actorId: string;
  isActive: boolean;
  reason: string;
}): Promise<{ success: boolean; targetUserId: string; isActive: boolean; reason: string }> {
  const { targetUserId, actorId, isActive, reason } = params;

  if (!reason || !reason.trim() || reason.trim().length < 3) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, 'REASON_REQUIRED: A valid audit reason (min 3 chars) is mandatory for status change');
  }

  // گارد ضد خود-مسدودسازی: کاربر نمی‌تواند حساب خود را مسدود کند
  if (actorId === targetUserId) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      'SELF_STATUS_CHANGE_FORBIDDEN: You cannot suspend or deactivate your own account'
    );
  }

  // استعلام اطلاعات کاربر مجری (Actor)
  const actor = await prisma.user.findUnique({
    where: { discordId: actorId },
    include: { userRoles: true },
  });

  if (!actor || !actor.isActive) {
    throw new DomainError(DomainErrorCode.PERMISSION_DENIED, 'ACTOR_INACTIVE_OR_NOT_FOUND: Operating user is not active');
  }

  const actorRoles = actor.userRoles.map((r) => r.roleKey);
  const isActorOwner = actor.discordId === PRIMARY_OWNER_ID || actorRoles.includes('owner');
  const isActorAdmin = actorRoles.includes('admin');
  const isActorManager = actorRoles.includes('manager');

  // استاف حق تغییر وضعیت کاربران را ندارد
  if (!isActorOwner && !isActorAdmin && !isActorManager) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      'STAFF_BAN_FORBIDDEN: Staff members hold read-only user access and cannot ban or unban accounts'
    );
  }

  const user = await prisma.user.findUnique({
    where: { discordId: targetUserId },
    include: { userRoles: true },
  });

  if (!user) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, `USER_NOT_FOUND: User '${targetUserId}' does not exist`);
  }

  const targetRoles = user.userRoles.map((r) => r.roleKey);
  const targetIsOwner = user.discordId === PRIMARY_OWNER_ID || targetRoles.includes('owner');
  const targetIsAdmin = targetRoles.includes('admin');
  const targetIsManager = targetRoles.includes('manager');

  // محافظت از Owner در برابر تعلیق یا غیرفعال‌سازی
  if (targetIsOwner && !isActive) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      'OWNER_PROTECTION_VIOLATION: Cannot suspend or deactivate the platform owner account'
    );
  }

  // ممانعت ادمین از مسدودسازی ادمین‌های دیگر یا مالک
  if (isActorAdmin && !isActorOwner) {
    if (targetIsOwner || targetIsAdmin) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        'HIERARCHY_VIOLATION: Administrators cannot suspend other Admin or Owner accounts'
      );
    }
  }

  // ممانعت منیجر از مسدودسازی منیجرها، ادمین‌ها یا مالک
  if (isActorManager && !isActorAdmin && !isActorOwner) {
    if (targetIsOwner || targetIsAdmin || targetIsManager) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        'HIERARCHY_VIOLATION: Management cannot suspend Manager, Admin, or Owner accounts'
      );
    }
  }

  if (user.isActive === isActive) {
    return {
      success: true,
      targetUserId,
      isActive,
      reason: `Account is already ${isActive ? 'active' : 'suspended'}`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { discordId: targetUserId },
      data: { isActive },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: isActive ? 'USER_REACTIVATED' : 'USER_SUSPENDED',
        entityType: 'User',
        entityId: targetUserId,
        previousValues: JSON.stringify({ isActive: user.isActive, status: user.isActive ? 'active' : 'suspended' }),
        newValues: JSON.stringify({ isActive, status: isActive ? 'active' : 'suspended' }),
        reason: reason.trim(),
        isSuccess: true,
      },
    });
  });

  return {
    success: true,
    targetUserId,
    isActive,
    reason: reason.trim(),
  };
}

/**
 * ۴. تخصیص یا سلب رول کاربر (Assign / Revoke Role) با رعایت RBAC، محافظت از مالک و همگام‌سازی دیسکورد
 */
export async function assignOrRevokeUserRole(params: {
  targetUserId: string;
  actorId: string;
  roleKey: string;
  action: 'grant' | 'revoke';
  reason: string;
  discordClient?: any;
}): Promise<{
  success: boolean;
  targetUserId: string;
  roleKey: string;
  action: 'grant' | 'revoke';
  discordSync: { success: boolean; reason?: string };
}> {
  const { targetUserId, actorId, roleKey, action, reason, discordClient } = params;

  if (!reason || !reason.trim() || reason.trim().length < 3) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, 'REASON_REQUIRED: A valid audit reason (min 3 chars) is mandatory');
  }

  const validRoles: SystemRoleKey[] = [
    'owner',
    'manager',
    'admin',
    'staff',
    'advertiser',
    'booster',
    'pilot',
    'exchanger',
  ];

  const normalizedRole = roleKey.trim().toLowerCase() as SystemRoleKey;
  if (!validRoles.includes(normalizedRole)) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, `INVALID_ROLE_KEY: '${roleKey}' is not a valid system role`);
  }

  // استعلام اطلاعات کاربر بازیگر (Actor)
  const actor = await prisma.user.findUnique({
    where: { discordId: actorId },
    include: { userRoles: true },
  });

  if (!actor || !actor.isActive) {
    throw new DomainError(DomainErrorCode.PERMISSION_DENIED, 'ACTOR_INACTIVE_OR_NOT_FOUND: Operating user is not active');
  }

  const actorRoles = actor.userRoles.map((r) => r.roleKey);
  const isActorOwner = actor.discordId === PRIMARY_OWNER_ID || actorRoles.includes('owner');
  const isActorAdmin = actorRoles.includes('admin');

  // قانون امنیتی: بررسی دسترسی‌های انحصاری نقش Owner
  if (normalizedRole === 'owner') {
    if (!isActorOwner) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        'OWNER_ACCESS_DENIED: Only an established Owner can grant or transfer Owner permissions'
      );
    }

    // قانون امنیتی: رول مالک از مالک اصلی یا کاربر جاری هرگز سلب نمی‌شود
    if (action === 'revoke' && (targetUserId === PRIMARY_OWNER_ID || targetUserId === actorId)) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        'OWNER_PROTECTION_VIOLATION: Cannot revoke Owner role from primary platform owner'
      );
    }
  }

  // گارد ضد خود-ترفیع: کاربر نمی‌تواند رول‌های خود را تغییر دهد
  if (actorId === targetUserId) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      'ANTI_SELF_ELEVATION: Cannot assign or revoke roles on your own account'
    );
  }

  // رول‌های دارای امتیاز انحصاری که فقط توسط مالک قابل انتساب یا سلب هستند (owner و manager)
  const privilegedRoles: SystemRoleKey[] = ['owner', 'manager'];

  if (!isActorOwner) {
    if (!isActorAdmin) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        'ROLE_MANAGEMENT_FORBIDDEN: Only Admin and Owner can assign or revoke user roles'
      );
    }

    // ادمین مجاز به تخصیص رول‌های عملیاتی شامل admin, staff, booster, pilot, advertiser, exchanger است
    if (privilegedRoles.includes(normalizedRole)) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        `PRIVILEGE_ESCALATION_FORBIDDEN: Only Owner can assign or revoke privileged roles (${normalizedRole})`
      );
    }
  }

  // اعتبارسنجی کاربر هدف
  const targetUser = await prisma.user.findUnique({
    where: { discordId: targetUserId },
    include: { userRoles: true },
  });

  if (!targetUser) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, `USER_NOT_FOUND: User '${targetUserId}' does not exist`);
  }

  const targetRoles = targetUser.userRoles.map((r) => r.roleKey);
  const targetIsOwner = targetUser.discordId === PRIMARY_OWNER_ID || targetRoles.includes('owner');

  if (targetIsOwner && !isActorOwner) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      'OWNER_PROTECTION_VIOLATION: Cannot modify roles for platform Owner'
    );
  }

  // محافظت از آخرین مالک سیستم و مالک اصلی
  if (normalizedRole === 'owner' && action === 'revoke') {
    if (targetUserId === PRIMARY_OWNER_ID) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        'OWNER_PROTECTION_VIOLATION: Cannot revoke Owner role from primary platform owner'
      );
    }

    const ownerCount = await prisma.userRole.count({ where: { roleKey: 'owner' } });
    if (ownerCount <= 1) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        'LAST_OWNER_PROTECTION: Cannot revoke the last remaining Owner role on the platform'
      );
    }
  }

  const targetHasRole = targetUser.userRoles.some((r) => r.roleKey === normalizedRole);

  // انجام تراکنش دیتابیس (پشتیبانی کامل از چند نقشی: نقش‌های دیگر دست‌نخورده می‌مانند)
  await prisma.$transaction(async (tx) => {
    if (action === 'grant') {
      await tx.userRole.upsert({
        where: {
          userId_roleKey: {
            userId: targetUserId,
            roleKey: normalizedRole,
          },
        },
        update: {
          grantedBy: actorId,
          grantedAt: new Date(),
        },
        create: {
          userId: targetUserId,
          roleKey: normalizedRole,
          grantedBy: actorId,
          grantedAt: new Date(),
        },
      });

      // در صورت اعطای ادورتایزر، اطمینان از مقداردهی رنک پایه
      if (normalizedRole === 'advertiser' && !targetUser.advertiserRank) {
        await tx.user.update({
          where: { discordId: targetUserId },
          data: { advertiserRank: 'BRONZE' },
        });
      }

      // در صورت اعطای نقش بوستر یا پایلوت، ثبت یا تایید خودکار صلاحیت بازی‌های فعال
      if (normalizedRole === 'booster' || normalizedRole === 'pilot') {
        const activeGames = await tx.game.findMany({ where: { isActive: true } });
        for (const g of activeGames) {
          const existingApp = await tx.userGameApproval.findFirst({
            where: { userId: targetUserId, gameSlug: g.slug, approvalType: normalizedRole, serviceId: null },
          });
          if (!existingApp) {
            await tx.userGameApproval.create({
              data: {
                userId: targetUserId,
                gameSlug: g.slug,
                approvalType: normalizedRole,
                status: 'approved',
                reviewedBy: actorId,
                reviewNote: `Approved upon ${normalizedRole} role grant by ${actorId}`,
                reviewedAt: new Date(),
              },
            });
          } else if (existingApp.status !== 'approved') {
            await tx.userGameApproval.update({
              where: { id: existingApp.id },
              data: {
                status: 'approved',
                reviewedBy: actorId,
                reviewNote: `Updated to approved upon ${normalizedRole} role grant by ${actorId}`,
                reviewedAt: new Date(),
              },
            });
          }
        }
        if (normalizedRole === 'pilot') {
          for (const g of activeGames) {
            const existingPilot = await tx.pilotVerification.findFirst({
              where: { userId: targetUserId, gameSlug: g.slug },
            });
            if (!existingPilot) {
              await tx.pilotVerification.create({
                data: {
                  userId: targetUserId,
                  gameSlug: g.slug,
                  status: 'approved',
                  reviewedBy: actorId,
                  reviewedAt: new Date(),
                  reviewNote: `Auto-verified on pilot role grant`,
                },
              });
            } else if (existingPilot.status !== 'approved') {
              await tx.pilotVerification.update({
                where: { id: existingPilot.id },
                data: {
                  status: 'approved',
                  reviewedBy: actorId,
                  reviewedAt: new Date(),
                  reviewNote: `Auto-verified on pilot role grant`,
                },
              });
            }
          }
        }
      }
    } else {
      await tx.userRole.deleteMany({
        where: {
          userId: targetUserId,
          roleKey: normalizedRole,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: action === 'grant' ? 'USER_ROLE_ASSIGNED' : 'USER_ROLE_REVOKED',
        entityType: 'UserRole',
        entityId: `${targetUserId}:${normalizedRole}`,
        previousValues: JSON.stringify({ roleKey: normalizedRole, hadRole: targetHasRole }),
        newValues: JSON.stringify({ roleKey: normalizedRole, hasRole: action === 'grant' }),
        reason: reason.trim(),
        isSuccess: true,
      },
    });
  });

  // قانون ۸: همگام‌سازی نقش دیسکورد با مهار ایمن خطاهای API بدون سقط تراکنش
  let discordSync: { success: boolean; reason?: string } = { success: false, reason: 'NO_DISCORD_CLIENT' };
  try {
    if (['booster', 'pilot', 'advertiser', 'exchanger'].includes(normalizedRole)) {
      discordSync = await syncDiscordRole(discordClient, targetUserId, normalizedRole);
    } else {
      discordSync = { success: true, reason: 'DISCORD_SYNC_NOT_CONFIGURED_FOR_MANAGEMENT_ROLE' };
    }
  } catch (err: any) {
    discordSync = { success: false, reason: `DISCORD_SYNC_EXCEPTION: ${err.message || 'Unknown error'}` };
  }

  return {
    success: true,
    targetUserId,
    roleKey: normalizedRole,
    action,
    discordSync,
  };
}

/**
 * ۵. حذف امن حساب کاربر با رعایت قانون صیانت از داده‌های تاریخی و مالی (Requirement 6)
 */
export async function deleteUserSafely(params: {
  targetUserId: string;
  actorId: string;
  reason: string;
}): Promise<{ success: boolean; targetUserId: string; message: string }> {
  const { targetUserId, actorId, reason } = params;

  if (!reason || !reason.trim() || reason.trim().length < 3) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, 'REASON_REQUIRED: A valid audit reason (min 3 chars) is mandatory');
  }

  // بررسی وضعیت مالکیت
  if (targetUserId === PRIMARY_OWNER_ID) {
    throw new DomainError(DomainErrorCode.PERMISSION_DENIED, 'OWNER_PROTECTION_VIOLATION: Cannot delete the platform owner account');
  }

  const user = await prisma.user.findUnique({
    where: { discordId: targetUserId },
    include: { userRoles: true },
  });

  if (!user) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, `USER_NOT_FOUND: User '${targetUserId}' does not exist`);
  }

  if (user.userRoles.some((r) => r.roleKey === 'owner')) {
    throw new DomainError(DomainErrorCode.PERMISSION_DENIED, 'OWNER_PROTECTION_VIOLATION: Cannot delete the platform owner account');
  }

  // بررسی جامع سوابق تاریخی و مالی
  const [
    customerOrders,
    advOrders,
    createdOrders,
    completedRuns,
    disputes,
    proofs,
    ledgerV1,
    ledgerV2,
    escrowHolds,
  ] = await Promise.all([
    prisma.order.count({ where: { customerId: targetUserId } }),
    prisma.order.count({ where: { advertiserId: targetUserId } }),
    prisma.order.count({ where: { creatorId: targetUserId } }),
    prisma.orderRun.count({ where: { completedBy: targetUserId } }),
    prisma.orderDispute.count({
      where: {
        OR: [
          { openedById: targetUserId },
          { assignedReviewerId: targetUserId },
          { resolvedById: targetUserId },
        ],
      },
    }),
    prisma.runProof.count({
      where: {
        OR: [
          { submittedById: targetUserId },
          { reviewedById: targetUserId },
        ],
      },
    }),
    prisma.ledgerTransaction.count({
      where: {
        OR: [
          { userId: targetUserId },
          { createdBy: targetUserId },
        ],
      },
    }),
    prisma.ledgerEntryV2.count({ where: { userId: targetUserId } }),
    prisma.escrowHold.count({
      where: {
        OR: [
          { createdById: targetUserId },
          { releasedById: targetUserId },
        ],
      },
    }),
  ]);

  const historicalCount = customerOrders + advOrders + createdOrders + completedRuns + disputes + proofs + ledgerV1 + ledgerV2 + escrowHolds;
  if (historicalCount > 0) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `HISTORICAL_DATA_PRESERVATION: Cannot delete user with ${historicalCount} historical orders, financial records, proofs or disputes. Suspend the user account instead.`
    );
  }

  // اگر هیچ سابقه مالی یا اجرایی نداشت، با ثبت ممیزی حذف می‌شود
  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: targetUserId } });
    await tx.userGameApproval.deleteMany({ where: { userId: targetUserId } });
    await tx.registrationApplication.deleteMany({ where: { userId: targetUserId } });
    await tx.wallet.deleteMany({ where: { userId: targetUserId } });
    await tx.walletV2.deleteMany({ where: { userId: targetUserId } });
    await tx.user.delete({ where: { discordId: targetUserId } });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'USER_DELETED_SAFE',
        entityType: 'User',
        entityId: targetUserId,
        previousValues: JSON.stringify({ username: user.username }),
        reason: reason.trim(),
        isSuccess: true,
      },
    });
  });

  return {
    success: true,
    targetUserId,
    message: `User '${targetUserId}' successfully deleted (no historical records existed).`,
  };
}

/**
 * ۶. دریافت تاریخچه لاگ‌های ممیزی مربوط به یک کاربر
 */
export async function getUserAuditLogs(targetUserId: string, limit = 50) {
  const safeLimit = Math.max(1, Math.min(100, limit));

  return await prisma.auditLog.findMany({
    where: {
      OR: [
        { actorId: targetUserId },
        { entityId: targetUserId },
        { entityId: { startsWith: `${targetUserId}:` } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: safeLimit,
    include: {
      actor: {
        select: {
          discordId: true,
          username: true,
          displayName: true,
        },
      },
    },
  });
}

/**
 * ۷. دریافت تاریخچه تغییرات وضعیت و مسدودسازی کاربر (User Ban / Unban Audit History)
 */
export async function getUserBanHistory(targetUserId: string) {
  const logs = await prisma.auditLog.findMany({
    where: {
      entityType: 'User',
      entityId: targetUserId,
      action: { in: ['USER_SUSPENDED', 'USER_REACTIVATED', 'USER_BANNED', 'USER_UNBANNED'] },
    },
    include: {
      actor: { select: { discordId: true, username: true, displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return logs.map((l) => {
    let prevStatus = 'active';
    let newStatus = 'suspended';
    try {
      if (l.previousValues) {
        const parsed = JSON.parse(l.previousValues);
        prevStatus = parsed.status || (parsed.isActive ? 'active' : 'suspended');
      }
      if (l.newValues) {
        const parsed = JSON.parse(l.newValues);
        newStatus = parsed.status || (parsed.isActive ? 'active' : 'suspended');
      }
    } catch {}

    return {
      id: l.id,
      actorId: l.actorId,
      actorName: l.actor?.displayName || l.actor?.username || l.actorId,
      targetUserId: l.entityId,
      action: l.action,
      previousStatus: prevStatus,
      resultingStatus: newStatus,
      reason: l.reason,
      createdAt: l.createdAt.toISOString(),
    };
  });
}
