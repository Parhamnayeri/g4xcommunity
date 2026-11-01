/**
 * gameManagementService.ts — مدیریت بازی‌ها و کتگوری‌های سرویس‌ها در پنل ادمین (Admin Game & Service Category Management)
 *
 * قابلیت‌ها:
 *  - مشاهده تمام بازی‌ها و سرویس‌ها به همراه شمارش رکوردهای وابسته
 *  - ایجاد، ویرایش، فعال‌سازی/غیرفعال‌سازی بازی‌ها
 *  - ایجاد، ویرایش، فعال‌سازی/غیرفعال‌سازی دسته‌بندی‌های سرویس و تنظیمات عملیاتی (ServiceSetting)
 *  - پشتیبانی از ترتیب نمایش (sortOrder) برای بازی‌ها و سرویس‌ها
 *  - اعتبارسنجی یکتایی و ساختار شناسه‌ها (slug و serviceKey)
 *  - ایمنی داده‌های تاریخی: تغییرناپذیری شناسه‌های رفرنس‌شده در سفارشات موجود (Immutability Guard)
 *  - ممانعت از حذف سخت (Hard-Delete Guard) بازی‌ها یا سرویس‌های دارای سوابق فعال یا تاریخی
 *  - ثبت ممیزی کامل در audit_logs برای کلیه عملیات ادمین
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';

export interface GameSettingsInput {
  claimWindowSeconds?: number;
  proofRequired?: boolean;
  allowPause?: boolean;
  allowReplacement?: boolean;
  acceptsSquads?: boolean;
  requiresRoles?: boolean;
  requiresKey?: boolean;
  isActive?: boolean;
}

export interface CreateGameInput {
  slug: string;
  displayName: string;
  serviceCategory?: string; // 'non_pilot' | 'pilot' | 'both'
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface UpdateGameInput {
  displayName?: string;
  serviceCategory?: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
  newSlug?: string;
}

export interface CreateServiceInput {
  serviceKey: string;
  displayName: string;
  serviceMode?: string; // 'non_pilot' | 'pilot'
  profileMode?: string; // 'raiderio' | 'manual' | 'none'
  requiresPilotApproval?: boolean;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
  settings?: GameSettingsInput;
}

export interface UpdateServiceInput {
  displayName?: string;
  serviceMode?: string;
  profileMode?: string;
  requiresPilotApproval?: boolean;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
  serviceKey?: string;
  settings?: GameSettingsInput;
}

const SLUG_REGEX = /^[a-z0-9_-]{2,50}$/;

export function validateIdentifierFormat(value: string, fieldName: string): string {
  if (!value || typeof value !== 'string') {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `${fieldName} is required and must be a string`
    );
  }
  const trimmed = value.trim().toLowerCase();
  if (!SLUG_REGEX.test(trimmed)) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `${fieldName} '${trimmed}' is invalid. It must be 2 to 50 lowercase characters containing only alphanumeric letters, dashes or underscores.`
    );
  }
  return trimmed;
}

export function validateDisplayName(name: string, fieldName: string = 'Display name'): string {
  if (!name || typeof name !== 'string') {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `${fieldName} is required`
    );
  }
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 100) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `${fieldName} must be between 2 and 100 characters`
    );
  }
  return trimmed;
}

export function validateServiceCategory(cat: string): string {
  const normalized = (cat || 'both').trim().toLowerCase();
  if (!['non_pilot', 'pilot', 'both'].includes(normalized)) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Invalid serviceCategory '${cat}'. Must be one of: 'non_pilot', 'pilot', 'both'`
    );
  }
  return normalized;
}

export function validateServiceMode(mode: string): string {
  const normalized = (mode || 'non_pilot').trim().toLowerCase();
  if (!['non_pilot', 'pilot'].includes(normalized)) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Invalid serviceMode '${mode}'. Must be 'non_pilot' or 'pilot'`
    );
  }
  return normalized;
}

export function validateProfileMode(mode: string): string {
  const normalized = (mode || 'manual').trim().toLowerCase();
  if (!['raiderio', 'manual', 'none'].includes(normalized)) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Invalid profileMode '${mode}'. Must be 'raiderio', 'manual', or 'none'`
    );
  }
  return normalized;
}

async function logAdminAudit(params: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousValues?: any;
  newValues?: any;
  reason?: string;
}) {
  try {
    let validActorId: string | null = null;
    if (params.actorId) {
      const user = await prisma.user.findUnique({
        where: { discordId: params.actorId },
        select: { discordId: true },
      });
      if (user) {
        validActorId = user.discordId;
      }
    }

    await prisma.auditLog.create({
      data: {
        actorId: validActorId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        previousValues: params.previousValues ? JSON.stringify(params.previousValues) : null,
        newValues: params.newValues ? JSON.stringify(params.newValues) : null,
        reason: validActorId ? params.reason : `[Actor: ${params.actorId}] ${params.reason || ''}`.trim(),
        isSuccess: true,
      },
    });
  } catch (err) {
    console.warn('[GameManagement] AuditLog error:', err);
  }
}

/**
 * فهرست تمام بازی‌ها به همراه سرویس‌ها، تنظیمات و آمار رکوردهای وابسته
 */
export async function listAdminGames() {
  const games = await prisma.game.findMany({
    orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    include: {
      services: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: {
          settings: true,
          _count: {
            select: {
              orders: true,
              approvals: true,
              registrationApplications: true,
            },
          },
        },
      },
      _count: {
        select: {
          orders: true,
          characters: true,
          squads: true,
          approvals: true,
          registrationApplications: true,
          currencyOrders: true,
        },
      },
    },
  });

  return games;
}

/**
 * ایجاد بازی جدید با اعتبارسنجی ساختار شناسه و ثبت در AuditLog
 */
export async function createGame(input: CreateGameInput, actorId: string) {
  const slug = validateIdentifierFormat(input.slug, 'Game slug');
  const displayName = validateDisplayName(input.displayName, 'Game display name');
  const serviceCategory = validateServiceCategory(input.serviceCategory || 'both');
  const description = input.description?.trim() || null;
  const sortOrder = typeof input.sortOrder === 'number' ? input.sortOrder : 0;
  const isActive = typeof input.isActive === 'boolean' ? input.isActive : true;

  const existing = await prisma.game.findUnique({
    where: { slug },
  });

  if (existing) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Game with slug '${slug}' already exists`
    );
  }

  const game = await prisma.game.create({
    data: {
      slug,
      displayName,
      serviceCategory,
      description,
      sortOrder,
      isActive,
    },
  });

  await logAdminAudit({
    actorId,
    action: 'ADMIN_GAME_CREATED',
    entityType: 'Game',
    entityId: slug,
    newValues: {
      slug,
      displayName,
      serviceCategory,
      description,
      sortOrder,
      isActive,
    },
    reason: 'Admin created a new game',
  });

  return game;
}

/**
 * ویرایش بازی با محافظت از تغییرناپذیری شناسه (Slug Immutability Guard)
 */
export async function updateGame(slug: string, input: UpdateGameInput, actorId: string) {
  const existing = await prisma.game.findUnique({
    where: { slug },
  });

  if (!existing) {
    throw new DomainError(DomainErrorCode.GAME_NOT_FOUND, `Game '${slug}' not found`);
  }

  // بررسی تغییر اسلاگ در صورت درخواست
  let targetSlug = existing.slug;
  if (input.newSlug && input.newSlug !== slug) {
    const formattedNewSlug = validateIdentifierFormat(input.newSlug, 'New game slug');

    // بررسی آیا سفارشات یا رکوردهای تاریخی به این اسلاگ وابسته هستند یا خیر
    const [orderCount, charCount, appCount] = await Promise.all([
      prisma.order.count({ where: { gameSlug: slug } }),
      prisma.wowCharacter.count({ where: { gameSlug: slug } }),
      prisma.registrationApplication.count({ where: { gameSlug: slug } }),
    ]);

    const totalRefs = orderCount + charCount + appCount;
    if (totalRefs > 0) {
      throw new DomainError(
        DomainErrorCode.VALIDATION_ERROR,
        `Game slug '${slug}' cannot be changed because it is referenced by ${totalRefs} existing records (${orderCount} orders, ${charCount} characters, ${appCount} applications). You may update the display name and description instead.`
      );
    }

    const collision = await prisma.game.findUnique({
      where: { slug: formattedNewSlug },
    });
    if (collision) {
      throw new DomainError(
        DomainErrorCode.VALIDATION_ERROR,
        `Target slug '${formattedNewSlug}' is already taken by another game`
      );
    }

    targetSlug = formattedNewSlug;
  }

  const displayName = input.displayName !== undefined
    ? validateDisplayName(input.displayName, 'Game display name')
    : existing.displayName;

  const serviceCategory = input.serviceCategory !== undefined
    ? validateServiceCategory(input.serviceCategory)
    : existing.serviceCategory;

  const description = input.description !== undefined
    ? (input.description?.trim() || null)
    : existing.description;

  const sortOrder = typeof input.sortOrder === 'number' ? input.sortOrder : existing.sortOrder;
  const isActive = typeof input.isActive === 'boolean' ? input.isActive : existing.isActive;

  const updated = await prisma.game.update({
    where: { slug },
    data: {
      displayName,
      serviceCategory,
      description,
      sortOrder,
      isActive,
      ...(targetSlug !== slug ? { slug: targetSlug } : {}),
    },
  });

  await logAdminAudit({
    actorId,
    action: 'ADMIN_GAME_UPDATED',
    entityType: 'Game',
    entityId: targetSlug,
    previousValues: existing,
    newValues: updated,
    reason: 'Admin updated game settings',
  });

  return updated;
}

/**
 * فعال یا غیرفعال کردن بازی
 */
export async function toggleGameStatus(slug: string, isActive: boolean, actorId: string) {
  const existing = await prisma.game.findUnique({ where: { slug } });
  if (!existing) {
    throw new DomainError(DomainErrorCode.GAME_NOT_FOUND, `Game '${slug}' not found`);
  }

  const updated = await prisma.game.update({
    where: { slug },
    data: { isActive },
  });

  await logAdminAudit({
    actorId,
    action: 'ADMIN_GAME_STATUS_TOGGLED',
    entityType: 'Game',
    entityId: slug,
    previousValues: { isActive: existing.isActive },
    newValues: { isActive },
    reason: `Admin ${isActive ? 'enabled' : 'disabled'} game '${slug}'`,
  });

  return updated;
}

/**
 * مرتب‌سازی مجدد بازی‌ها (Reorder Games)
 */
export async function reorderGames(items: Array<{ slug: string; sortOrder: number }>, actorId: string) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, 'Items array is required for reordering');
  }

  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      if (typeof item.sortOrder === 'number' && item.slug) {
        await tx.game.update({
          where: { slug: item.slug },
          data: { sortOrder: item.sortOrder },
        });
      }
    }
  });

  await logAdminAudit({
    actorId,
    action: 'ADMIN_GAMES_REORDERED',
    entityType: 'Game',
    entityId: 'multiple',
    newValues: items,
    reason: 'Admin updated games sort order',
  });

  return { success: true };
}

/**
 * حذف ایمن بازی با ممانعت سخت‌گیرانه در صورت وجود سوابق (Hard-Delete Guard)
 */
export async function deleteGame(slug: string, actorId: string) {
  const existing = await prisma.game.findUnique({
    where: { slug },
    include: {
      _count: {
        select: {
          orders: true,
          characters: true,
          squads: true,
          approvals: true,
          registrationApplications: true,
          currencyOrders: true,
        },
      },
    },
  });

  if (!existing) {
    throw new DomainError(DomainErrorCode.GAME_NOT_FOUND, `Game '${slug}' not found`);
  }

  const counts = existing._count;
  const totalRefs =
    counts.orders +
    counts.characters +
    counts.squads +
    counts.approvals +
    counts.registrationApplications +
    counts.currencyOrders;

  if (totalRefs > 0) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Cannot hard-delete game '${slug}' because it is referenced by ${totalRefs} existing records (${counts.orders} orders, ${counts.characters} characters, ${counts.registrationApplications} applications). Please disable the game instead.`
    );
  }

  // حذف سرویس‌های بدون رفرنس و سپس بازی
  await prisma.$transaction(async (tx) => {
    await tx.channelRoute.deleteMany({ where: { gameSlug: slug } });
    await tx.serviceSetting.deleteMany({
      where: { service: { gameSlug: slug } },
    });
    await tx.gameService.deleteMany({ where: { gameSlug: slug } });
    await tx.game.delete({ where: { slug } });
  });

  await logAdminAudit({
    actorId,
    action: 'ADMIN_GAME_DELETED',
    entityType: 'Game',
    entityId: slug,
    previousValues: existing,
    reason: 'Admin deleted unreferenced game',
  });

  return { success: true, deletedSlug: slug };
}

// ─────────────────────────────────────────────────────────────────────────────
// بخش مدیریت دسته‌بندی‌های سرویس (Service Categories Management)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ایجاد یک دسته‌بندی سرویس جدید برای بازی
 */
export async function createGameService(
  gameSlug: string,
  input: CreateServiceInput,
  actorId: string
) {
  const game = await prisma.game.findUnique({ where: { slug: gameSlug } });
  if (!game) {
    throw new DomainError(DomainErrorCode.GAME_NOT_FOUND, `Game '${gameSlug}' not found`);
  }

  const serviceKey = validateIdentifierFormat(input.serviceKey, 'Service key');
  const displayName = validateDisplayName(input.displayName, 'Service display name');
  const serviceMode = validateServiceMode(input.serviceMode || 'non_pilot');
  const profileMode = validateProfileMode(input.profileMode || 'manual');
  const requiresPilotApproval = Boolean(input.requiresPilotApproval);
  const description = input.description?.trim() || null;
  const sortOrder = typeof input.sortOrder === 'number' ? input.sortOrder : 0;
  const isActive = typeof input.isActive === 'boolean' ? input.isActive : true;

  const existing = await prisma.gameService.findFirst({
    where: { gameSlug, serviceKey },
  });

  if (existing) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Service category '${serviceKey}' already exists for game '${gameSlug}'`
    );
  }

  const created = await prisma.gameService.create({
    data: {
      gameSlug,
      serviceKey,
      displayName,
      serviceMode,
      profileMode,
      requiresPilotApproval,
      description,
      sortOrder,
      isActive,
      settings: {
        create: {
          claimWindowSeconds: input.settings?.claimWindowSeconds ?? 600,
          proofRequired: input.settings?.proofRequired ?? true,
          allowPause: input.settings?.allowPause ?? true,
          allowReplacement: input.settings?.allowReplacement ?? true,
          acceptsSquads: input.settings?.acceptsSquads ?? false,
          requiresRoles: input.settings?.requiresRoles ?? false,
          requiresKey: input.settings?.requiresKey ?? false,
          isActive: input.settings?.isActive ?? true,
        },
      },
    },
    include: {
      settings: true,
    },
  });

  await logAdminAudit({
    actorId,
    action: 'ADMIN_SERVICE_CREATED',
    entityType: 'GameService',
    entityId: String(created.id),
    newValues: created,
    reason: `Admin created service '${serviceKey}' under game '${gameSlug}'`,
  });

  return created;
}

/**
 * ویرایش دسته‌بندی سرویس و تنظیمات عملیاتی آن
 */
export async function updateGameService(
  id: number,
  input: UpdateServiceInput,
  actorId: string
) {
  const existing = await prisma.gameService.findUnique({
    where: { id },
    include: { settings: true },
  });

  if (!existing) {
    throw new DomainError(DomainErrorCode.SERVICE_NOT_FOUND, `Service category #${id} not found`);
  }

  // بررسی تغییر کلید سرویس
  let serviceKey = existing.serviceKey;
  if (input.serviceKey && input.serviceKey !== existing.serviceKey) {
    const formattedKey = validateIdentifierFormat(input.serviceKey, 'Service key');

    // بررسی ممانعت در صورت رفرنس شدن در سفارشات
    const orderCount = await prisma.order.count({ where: { serviceId: id } });
    const appCount = await prisma.registrationApplication.count({ where: { serviceId: id } });

    if (orderCount + appCount > 0) {
      throw new DomainError(
        DomainErrorCode.VALIDATION_ERROR,
        `Service key '${existing.serviceKey}' cannot be changed because it is referenced by existing orders (${orderCount}) or applications (${appCount}). You may update the display name and settings instead.`
      );
    }

    const collision = await prisma.gameService.findFirst({
      where: { gameSlug: existing.gameSlug, serviceKey: formattedKey, id: { not: id } },
    });
    if (collision) {
      throw new DomainError(
        DomainErrorCode.VALIDATION_ERROR,
        `Service key '${formattedKey}' already exists for game '${existing.gameSlug}'`
      );
    }

    serviceKey = formattedKey;
  }

  const displayName = input.displayName !== undefined
    ? validateDisplayName(input.displayName, 'Service display name')
    : existing.displayName;

  const serviceMode = input.serviceMode !== undefined
    ? validateServiceMode(input.serviceMode)
    : existing.serviceMode;

  const profileMode = input.profileMode !== undefined
    ? validateProfileMode(input.profileMode)
    : existing.profileMode;

  const requiresPilotApproval = input.requiresPilotApproval !== undefined
    ? Boolean(input.requiresPilotApproval)
    : existing.requiresPilotApproval;

  const description = input.description !== undefined
    ? (input.description?.trim() || null)
    : existing.description;

  const sortOrder = typeof input.sortOrder === 'number' ? input.sortOrder : existing.sortOrder;
  const isActive = typeof input.isActive === 'boolean' ? input.isActive : existing.isActive;

  const updated = await prisma.gameService.update({
    where: { id },
    data: {
      serviceKey,
      displayName,
      serviceMode,
      profileMode,
      requiresPilotApproval,
      description,
      sortOrder,
      isActive,
    },
    include: {
      settings: true,
    },
  });

  // به‌روزرسانی تنظیمات عملیاتی (ServiceSetting)
  if (input.settings) {
    await prisma.serviceSetting.upsert({
      where: { serviceId: id },
      create: {
        serviceId: id,
        claimWindowSeconds: input.settings.claimWindowSeconds ?? 600,
        proofRequired: input.settings.proofRequired ?? true,
        allowPause: input.settings.allowPause ?? true,
        allowReplacement: input.settings.allowReplacement ?? true,
        acceptsSquads: input.settings.acceptsSquads ?? false,
        requiresRoles: input.settings.requiresRoles ?? false,
        requiresKey: input.settings.requiresKey ?? false,
        isActive: input.settings.isActive ?? true,
      },
      update: {
        ...(input.settings.claimWindowSeconds !== undefined
          ? { claimWindowSeconds: input.settings.claimWindowSeconds }
          : {}),
        ...(input.settings.proofRequired !== undefined ? { proofRequired: input.settings.proofRequired } : {}),
        ...(input.settings.allowPause !== undefined ? { allowPause: input.settings.allowPause } : {}),
        ...(input.settings.allowReplacement !== undefined
          ? { allowReplacement: input.settings.allowReplacement }
          : {}),
        ...(input.settings.acceptsSquads !== undefined ? { acceptsSquads: input.settings.acceptsSquads } : {}),
        ...(input.settings.requiresRoles !== undefined ? { requiresRoles: input.settings.requiresRoles } : {}),
        ...(input.settings.requiresKey !== undefined ? { requiresKey: input.settings.requiresKey } : {}),
        ...(input.settings.isActive !== undefined ? { isActive: input.settings.isActive } : {}),
      },
    });
  }

  const finalResult = await prisma.gameService.findUnique({
    where: { id },
    include: { settings: true },
  });

  await logAdminAudit({
    actorId,
    action: 'ADMIN_SERVICE_UPDATED',
    entityType: 'GameService',
    entityId: String(id),
    previousValues: existing,
    newValues: finalResult,
    reason: `Admin updated service category #${id}`,
  });

  return finalResult;
}

/**
 * فعال یا غیرفعال کردن دسته‌بندی سرویس
 */
export async function toggleGameServiceStatus(id: number, isActive: boolean, actorId: string) {
  const existing = await prisma.gameService.findUnique({ where: { id } });
  if (!existing) {
    throw new DomainError(DomainErrorCode.SERVICE_NOT_FOUND, `Service category #${id} not found`);
  }

  const updated = await prisma.gameService.update({
    where: { id },
    data: { isActive },
    include: { settings: true },
  });

  await logAdminAudit({
    actorId,
    action: 'ADMIN_SERVICE_STATUS_TOGGLED',
    entityType: 'GameService',
    entityId: String(id),
    previousValues: { isActive: existing.isActive },
    newValues: { isActive },
    reason: `Admin ${isActive ? 'enabled' : 'disabled'} service category #${id} ('${existing.serviceKey}')`,
  });

  return updated;
}

/**
 * مرتب‌سازی دسته‌بندی‌های سرویس
 */
export async function reorderGameServices(
  items: Array<{ id: number; sortOrder: number }>,
  actorId: string
) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, 'Items array is required for reordering');
  }

  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      if (typeof item.sortOrder === 'number' && typeof item.id === 'number') {
        await tx.gameService.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        });
      }
    }
  });

  await logAdminAudit({
    actorId,
    action: 'ADMIN_SERVICES_REORDERED',
    entityType: 'GameService',
    entityId: 'multiple',
    newValues: items,
    reason: 'Admin updated services sort order',
  });

  return { success: true };
}

/**
 * حذف دسته‌بندی سرویس با ممانعت در صورت وجود سوابق (Hard-Delete Guard)
 */
export async function deleteGameService(id: number, actorId: string) {
  const existing = await prisma.gameService.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          orders: true,
          approvals: true,
          registrationApplications: true,
        },
      },
    },
  });

  if (!existing) {
    throw new DomainError(DomainErrorCode.SERVICE_NOT_FOUND, `Service category #${id} not found`);
  }

  const counts = existing._count;
  const totalRefs = counts.orders + counts.approvals + counts.registrationApplications;

  if (totalRefs > 0) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Cannot hard-delete service category #${id} ('${existing.serviceKey}') because it is referenced by ${totalRefs} existing records (${counts.orders} orders, ${counts.registrationApplications} applications, ${counts.approvals} qualifications). You may disable it instead.`
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.channelRoute.deleteMany({ where: { serviceId: id } });
    await tx.serviceSetting.deleteMany({ where: { serviceId: id } });
    await tx.gameService.delete({ where: { id } });
  });

  await logAdminAudit({
    actorId,
    action: 'ADMIN_SERVICE_DELETED',
    entityType: 'GameService',
    entityId: String(id),
    previousValues: existing,
    reason: `Admin deleted unreferenced service category #${id}`,
  });

  return { success: true, deletedId: id };
}
