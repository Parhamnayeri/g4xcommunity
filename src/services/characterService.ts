/**
 * characterService.ts — مدیریت کاراکترهای WoW بوسترها (Phase 2)
 *
 * قابلیت‌ها:
 *  - ثبت چندین کاراکتر WoW با اعتبارسنجی صلاحیت بوستر
 *  - استعلام و همگام‌سازی اطلاعات از Raider.IO
 *  - انتخاب کاراکتر اصلی (Main Character)
 *  - حذف / غیرفعال‌سازی ایمن کاراکتر
 *  - انتخاب کاراکتر مناسب برای کلیم سفارشات
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import { fetchRaiderIOProfile, syncCharacter } from './raiderio';
import { Prisma } from '@prisma/client';

export const SUPPORTED_REGIONS = ['eu', 'us', 'kr', 'tw', 'cn'] as const;
export type SupportedRegion = typeof SUPPORTED_REGIONS[number];

export interface AddCharacterInput {
  userId: string;
  characterName: string;
  realm: string;
  region?: string;
  gameSlug?: string;
  actorId?: string;
  requireVerified?: boolean;
}

/**
 * بررسی اینکه آیا کاربر مدیر یا ادمین است
 */
export async function isUserAdminOrManager(userId: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<boolean> {
  const roles = await client.userRole.findMany({
    where: { userId },
  });
  return roles.some((r) => ['owner', 'manager', 'admin', 'staff'].includes(r.roleKey));
}

/**
 * اعتبارسنجی صلاحیت بوستر برای بازی WoW
 */
export async function ensureApprovedBooster(
  userId: string,
  gameSlug: string = 'wow_midnight',
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  const user = await client.user.findUnique({
    where: { discordId: userId },
    include: { userRoles: true },
  });

  if (!user || !user.isActive) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      `User '${userId}' is not active or does not exist.`
    );
  }

  // مدیران همواره مجاز هستند
  const isAdmin = user.userRoles.some((r) => ['owner', 'manager', 'admin', 'staff'].includes(r.roleKey));
  if (isAdmin) return;

  // بررسی تاییدیه بوستر برای WoW
  const approval = await client.userGameApproval.findFirst({
    where: {
      userId,
      gameSlug: { in: [gameSlug, 'wow', 'wow_midnight'] },
      approvalType: 'booster',
      status: 'approved',
    },
  });

  if (!approval) {
    throw new DomainError(
      DomainErrorCode.BOOSTER_NOT_APPROVED,
      `User '${userId}' is not an approved Booster for World of Warcraft.`
    );
  }
}

/**
 * افزودن کاراکتر جدید برای بوستر
 */
export async function addCharacter(
  input: AddCharacterInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const actorId = input.actorId || input.userId;
  if (actorId !== input.userId) {
    const authorized = await isUserAdminOrManager(actorId, client);
    if (!authorized) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        `Actor '${actorId}' is not authorized to add characters for user '${input.userId}'.`
      );
    }
  }

  const gameSlug = input.gameSlug || 'wow_midnight';
  await ensureApprovedBooster(input.userId, gameSlug, client);

  const region = (input.region || 'eu').trim().toLowerCase();
  if (!SUPPORTED_REGIONS.includes(region as SupportedRegion)) {
    throw new DomainError(
      DomainErrorCode.INVALID_CHARACTER_REGION,
      `Invalid region '${input.region}'. Supported regions: ${SUPPORTED_REGIONS.join(', ')}`
    );
  }

  const characterName = input.characterName.trim();
  const realm = input.realm.trim().toLowerCase();

  if (!characterName || characterName.length < 2 || characterName.length > 30) {
    throw new DomainError(
      DomainErrorCode.CHARACTER_NOT_FOUND,
      'Character name must be between 2 and 30 characters.'
    );
  }

  if (!realm || realm.length < 2 || realm.length > 50) {
    throw new DomainError(
      DomainErrorCode.CHARACTER_NOT_FOUND,
      'Realm name must be between 2 and 50 characters.'
    );
  }

  // بررسی وجود کاراکتر تکراری برای همین کاربر
  const existing = await client.wowCharacter.findFirst({
    where: {
      userId: input.userId,
      region,
      realm,
      characterName: { equals: characterName },
    },
  });

  if (existing && existing.isActive) {
    throw new DomainError(
      DomainErrorCode.CHARACTER_ALREADY_EXISTS,
      `Character '${characterName}' on realm '${realm}' (${region.toUpperCase()}) is already registered and active.`
    );
  }

  // استعلام از Raider.IO
  const rioSnapshot = await fetchRaiderIOProfile({
    region,
    realm,
    characterName,
  });

  if (input.requireVerified && rioSnapshot.fetchStatus === 'not_found') {
    throw new DomainError(
      DomainErrorCode.CHARACTER_NOT_FOUND,
      `Character '${characterName}' on realm '${realm}' (${region.toUpperCase()}) was not found on Raider.IO.`
    );
  }

  const syncStatus = rioSnapshot.fetchStatus === 'success' ? 'synced' : rioSnapshot.fetchStatus;

  // بررسی وضعیت مین بودن
  const activeCharCount = await client.wowCharacter.count({
    where: { userId: input.userId, isActive: true },
  });
  const shouldBeMain = activeCharCount === 0;

  // ایجاد یا فعال‌سازی مجدد کاراکتر
  const canonicalUrl = rioSnapshot.profileUrl || `https://raider.io/characters/${region}/${encodeURIComponent(realm)}/${encodeURIComponent(characterName)}`;

  let character;
  if (existing) {
    character = await client.wowCharacter.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        isMain: shouldBeMain ? true : existing.isMain,
        characterClass: rioSnapshot.characterClass || existing.characterClass,
        activeSpec: rioSnapshot.activeSpec || existing.activeSpec,
        itemLevel: rioSnapshot.itemLevelEquipped ?? existing.itemLevel,
        mythicScore: rioSnapshot.mythicScore ?? existing.mythicScore,
        tankScore: rioSnapshot.tankScore ?? existing.tankScore,
        healerScore: rioSnapshot.healerScore ?? existing.healerScore,
        dpsScore: rioSnapshot.dpsScore ?? existing.dpsScore,
        raidProgression: rioSnapshot.raidProgression ?? existing.raidProgression,
        raiderioUrl: canonicalUrl,
        syncStatus,
        lastSyncedAt: new Date(),
      },
    });
  } else {
    // اطمینان از وجود بازی در دیتابیس
    const game = await client.game.findUnique({
      where: { slug: gameSlug },
    }) || await client.game.findFirst({
      where: { slug: { in: ['wow_midnight', 'wow'] } },
    });
    const finalGameSlug = game ? game.slug : gameSlug;

    character = await client.wowCharacter.create({
      data: {
        userId: input.userId,
        gameSlug: finalGameSlug,
        characterName,
        realm,
        region,
        characterClass: rioSnapshot.characterClass || null,
        activeSpec: rioSnapshot.activeSpec || null,
        itemLevel: rioSnapshot.itemLevelEquipped ?? null,
        mythicScore: rioSnapshot.mythicScore ?? null,
        tankScore: rioSnapshot.tankScore ?? null,
        healerScore: rioSnapshot.healerScore ?? null,
        dpsScore: rioSnapshot.dpsScore ?? null,
        raidProgression: rioSnapshot.raidProgression ?? null,
        raiderioUrl: canonicalUrl,
        isMain: shouldBeMain,
        isActive: true,
        syncStatus,
        lastSyncedAt: new Date(),
      },
    });
  }

  return character;
}

/**
 * دریافت لیست کاراکترهای فعال بوستر
 */
export async function listUserCharacters(
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  return client.wowCharacter.findMany({
    where: { userId, isActive: true },
    orderBy: [
      { isMain: 'desc' },
      { mythicScore: 'desc' },
      { createdAt: 'desc' },
    ],
  });
}

/**
 * پیدا کردن یک کاراکتر با ID یا نام
 */
export async function findUserCharacter(
  userId: string,
  identifier: number | string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  if (typeof identifier === 'number' || !isNaN(Number(identifier))) {
    return client.wowCharacter.findFirst({
      where: { id: Number(identifier), userId },
    });
  }

  return client.wowCharacter.findFirst({
    where: {
      userId,
      characterName: { equals: String(identifier).trim() },
    },
  });
}

/**
 * تنظیم کاراکتر اصلی (Main Character)
 */
export async function setMainCharacter(
  userId: string,
  identifier: number | string,
  actorId?: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const effectiveActor = actorId || userId;
  if (effectiveActor !== userId) {
    const authorized = await isUserAdminOrManager(effectiveActor, client);
    if (!authorized) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        `Actor '${effectiveActor}' is not authorized to modify characters for user '${userId}'.`
      );
    }
  }

  const char = await findUserCharacter(userId, identifier, client);
  if (!char || !char.isActive) {
    throw new DomainError(
      DomainErrorCode.CHARACTER_NOT_FOUND,
      `Active character '${identifier}' not found for user '${userId}'.`
    );
  }

  return (client as typeof prisma).$transaction(async (tx) => {
    // بازنشانی تمام کاراکترها به غیر اصلی
    await tx.wowCharacter.updateMany({
      where: { userId, isMain: true },
      data: { isMain: false },
    });

    // تنظیم کاراکتر مورد نظر به عنوان اصلی
    const updated = await tx.wowCharacter.update({
      where: { id: char.id },
      data: { isMain: true },
    });

    return updated;
  });
}

/**
 * همگام‌سازی مجدد کاراکتر از طریق Raider.IO
 */
export async function syncCharacterProfile(
  identifier: number | string,
  userId: string,
  actorId?: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const effectiveActor = actorId || userId;
  if (effectiveActor !== userId) {
    const authorized = await isUserAdminOrManager(effectiveActor, client);
    if (!authorized) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        `Actor '${effectiveActor}' is not authorized to sync characters for user '${userId}'.`
      );
    }
  }

  const char = await findUserCharacter(userId, identifier, client);
  if (!char || !char.isActive) {
    throw new DomainError(
      DomainErrorCode.CHARACTER_NOT_FOUND,
      `Active character '${identifier}' not found for user '${userId}'.`
    );
  }

  const result = await syncCharacter(char.id);
  const updated = await client.wowCharacter.findUnique({
    where: { id: char.id },
  });

  return { result, character: updated! };
}

/**
 * حذف / غیرفعال‌سازی کاراکتر
 */
export async function removeCharacter(
  identifier: number | string,
  userId: string,
  actorId?: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const effectiveActor = actorId || userId;
  if (effectiveActor !== userId) {
    const authorized = await isUserAdminOrManager(effectiveActor, client);
    if (!authorized) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        `Actor '${effectiveActor}' is not authorized to remove characters for user '${userId}'.`
      );
    }
  }

  const char = await findUserCharacter(userId, identifier, client);
  if (!char || !char.isActive) {
    throw new DomainError(
      DomainErrorCode.CHARACTER_NOT_FOUND,
      `Active character '${identifier}' not found for user '${userId}'.`
    );
  }

  return (client as typeof prisma).$transaction(async (tx) => {
    const updated = await tx.wowCharacter.update({
      where: { id: char.id },
      data: {
        isActive: false,
        isMain: false,
      },
    });

    // اگر کاراکتر حذف‌شده کاراکتر اصلی بود، یک کاراکتر فعال دیگر را به عنوان اصلی برمی‌گزینیم
    if (char.isMain) {
      const nextChar = await tx.wowCharacter.findFirst({
        where: { userId, isActive: true },
        orderBy: [{ mythicScore: 'desc' }, { createdAt: 'desc' }],
      });
      if (nextChar) {
        await tx.wowCharacter.update({
          where: { id: nextChar.id },
          data: { isMain: true },
        });
      }
    }

    return updated;
  });
}
