/**
 * characterService.ts — Authoritative WoW Character & Raider.IO Profile Service (Task 4)
 *
 * Rules:
 *  - Approved WoW Boosters manage their own WoW characters.
 *  - Region/Realm/Name normalization with duplicate prevention.
 *  - Optional Raider.IO URL support with anti-SSRF validation.
 *  - One Main Character per booster with safe atomic selection.
 *  - Soft-delete: historical references in orders/teams are preserved (isActive: false).
 *  - Reactivation of previously deactivated characters.
 *  - Rate-limit cooldown (60s) on manual sync requests.
 *  - Never automatically approve Booster or Pilot based solely on character existence.
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import {
  fetchRaiderIOProfile,
  parseRaiderIOProfileUrl,
  syncCharacter,
  checkRefreshCooldown,
} from './raiderio';
import { Prisma } from '@prisma/client';

export const SUPPORTED_REGIONS = ['eu', 'us', 'kr', 'tw', 'cn'] as const;
export type SupportedRegion = typeof SUPPORTED_REGIONS[number];

export interface AddCharacterInput {
  userId: string;
  characterName?: string;
  realm?: string;
  region?: string;
  raiderioUrl?: string;
  gameSlug?: string;
  actorId?: string;
  requireVerified?: boolean;
}

/**
 * Check if actor is an Admin, Manager, Owner, or Staff member
 */
export async function isUserAdminOrManager(
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<boolean> {
  const roles = await client.userRole.findMany({
    where: { userId },
  });
  return roles.some((r) => ['owner', 'manager', 'admin', 'staff'].includes(r.roleKey));
}

/**
 * Ensures user is an active approved booster for World of Warcraft.
 * Staff/Admins retain operational bypass for administrative setup.
 */
export async function ensureApprovedBooster(
  userId: string,
  gameSlug: string = 'wow',
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

  // Managers and Admins are always authorized
  const isAdmin = user.userRoles.some((r) => ['owner', 'manager', 'admin', 'staff'].includes(r.roleKey));
  if (isAdmin) return;

  // Check WoW game approval
  const approval = await client.userGameApproval.findFirst({
    where: {
      userId,
      gameSlug: { in: [gameSlug, 'wow', 'wow_midnight'] },
      approvalType: { in: ['booster', 'non_pilot'] },
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
 * Adds or reactivates a WoW Character for an approved booster.
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

  const gameSlug = input.gameSlug || 'wow';
  await ensureApprovedBooster(input.userId, gameSlug, client);

  let region = (input.region || '').trim().toLowerCase();
  let realm = (input.realm || '').trim().toLowerCase();
  let characterName = (input.characterName || '').trim();

  // If Raider.IO URL is supplied, parse and extract authoritative fields
  if (input.raiderioUrl) {
    const parsed = parseRaiderIOProfileUrl(input.raiderioUrl);
    if (!parsed) {
      throw new DomainError(
        DomainErrorCode.INVALID_EVIDENCE_URL,
        'Invalid Raider.IO profile URL format. Must be an official https://raider.io/characters/... link.'
      );
    }
    region = parsed.region;
    realm = parsed.realm;
    characterName = parsed.characterName;
  }

  // Default region to 'eu' if not provided
  if (!region) region = 'eu';

  if (!SUPPORTED_REGIONS.includes(region as SupportedRegion)) {
    throw new DomainError(
      DomainErrorCode.INVALID_CHARACTER_REGION,
      `Invalid region '${region}'. Supported regions: ${SUPPORTED_REGIONS.join(', ')}`
    );
  }

  // Normalize realm and character name
  realm = realm.replace(/\s+/g, '-');

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

  // Resolve authoritative game record in database
  const game =
    (await client.game.findUnique({ where: { slug: gameSlug } })) ||
    (await client.game.findFirst({ where: { slug: { in: ['wow', 'wow_midnight'] } } })) ||
    (await client.game.findFirst({ where: { isActive: true } }));
  const finalGameSlug = game ? game.slug : gameSlug;

  // 1. Cross-Booster Duplicate Prevention: Character cannot be actively claimed by another booster
  const activeOnOtherUser = await client.wowCharacter.findFirst({
    where: {
      gameSlug: finalGameSlug,
      region,
      realm,
      characterName: { equals: characterName },
      isActive: true,
      userId: { not: input.userId },
    },
  });

  if (activeOnOtherUser) {
    throw new DomainError(
      DomainErrorCode.CHARACTER_ALREADY_EXISTS,
      `Character '${characterName}' on realm '${realm}' (${region.toUpperCase()}) is already actively registered by another booster.`
    );
  }

  // 2. Self Duplicate / Reactivation Check
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

  // Query Raider.IO profile for initial stats and metadata
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
  const canonicalUrl =
    rioSnapshot.profileUrl ||
    `https://raider.io/characters/${region}/${encodeURIComponent(realm)}/${encodeURIComponent(characterName)}`;
  const recentRunsJson =
    rioSnapshot.recentRuns && rioSnapshot.recentRuns.length > 0 ? JSON.stringify(rioSnapshot.recentRuns) : null;

  // Determine if this should be the Main Character (first active character is automatically Main)
  const activeCharCount = await client.wowCharacter.count({
    where: { userId: input.userId, isActive: true },
  });
  const shouldBeMain = activeCharCount === 0;

  let character;
  if (existing) {
    // Reactivate previously saved/deactivated character
    character = await client.wowCharacter.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        isMain: shouldBeMain ? true : existing.isMain,
        characterClass: rioSnapshot.characterClass || existing.characterClass,
        activeSpec: rioSnapshot.activeSpec || existing.activeSpec,
        activeRole: rioSnapshot.activeRole || existing.activeRole,
        faction: rioSnapshot.faction || existing.faction,
        thumbnailUrl: rioSnapshot.thumbnailUrl || existing.thumbnailUrl,
        itemLevel: rioSnapshot.itemLevelEquipped ?? existing.itemLevel,
        mythicScore: rioSnapshot.mythicScore ?? existing.mythicScore,
        tankScore: rioSnapshot.tankScore ?? existing.tankScore,
        healerScore: rioSnapshot.healerScore ?? existing.healerScore,
        dpsScore: rioSnapshot.dpsScore ?? existing.dpsScore,
        raidProgression: rioSnapshot.raidProgression ?? existing.raidProgression,
        recentRunsJson: recentRunsJson || existing.recentRunsJson,
        raiderioUrl: canonicalUrl,
        syncStatus,
        syncError: rioSnapshot.errorDetails || null,
        lastSyncedAt: new Date(),
      },
    });
  } else {
    // Create fresh character record
    character = await client.wowCharacter.create({
      data: {
        userId: input.userId,
        gameSlug: finalGameSlug,
        characterName,
        realm,
        region,
        characterClass: rioSnapshot.characterClass || null,
        activeSpec: rioSnapshot.activeSpec || null,
        activeRole: rioSnapshot.activeRole || null,
        faction: rioSnapshot.faction || null,
        thumbnailUrl: rioSnapshot.thumbnailUrl || null,
        itemLevel: rioSnapshot.itemLevelEquipped ?? null,
        mythicScore: rioSnapshot.mythicScore ?? null,
        tankScore: rioSnapshot.tankScore ?? null,
        healerScore: rioSnapshot.healerScore ?? null,
        dpsScore: rioSnapshot.dpsScore ?? null,
        raidProgression: rioSnapshot.raidProgression ?? null,
        recentRunsJson,
        raiderioUrl: canonicalUrl,
        isMain: shouldBeMain,
        isActive: true,
        syncStatus,
        syncError: rioSnapshot.errorDetails || null,
        lastSyncedAt: new Date(),
      },
    });
  }

  return character;
}

/**
 * List registered characters for a user
 */
export async function listUserCharacters(
  userId: string,
  options: { includeInactive?: boolean } = {},
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const where: any = { userId };
  if (!options.includeInactive) {
    where.isActive = true;
  }

  return client.wowCharacter.findMany({
    where,
    orderBy: [{ isMain: 'desc' }, { mythicScore: 'desc' }, { createdAt: 'desc' }],
  });
}

/**
 * Find a specific character by ID or Name
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
 * Retrieve comprehensive character details including parsed recent runs
 */
export async function getCharacterDetails(
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
        `Actor '${effectiveActor}' is not authorized to inspect characters for user '${userId}'.`
      );
    }
  }

  const char = await findUserCharacter(userId, identifier, client);
  if (!char) {
    throw new DomainError(DomainErrorCode.CHARACTER_NOT_FOUND, `Character '${identifier}' not found.`);
  }

  let recentRuns = [];
  try {
    if (char.recentRunsJson) {
      recentRuns = JSON.parse(char.recentRunsJson);
    }
  } catch {}

  const cooldown = checkRefreshCooldown(char.id);

  return {
    ...char,
    recentRuns,
    refreshCooldown: cooldown,
  };
}

/**
 * Sets a character as the booster's Main Character
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
    // Reset all characters of this user to isMain: false
    await tx.wowCharacter.updateMany({
      where: { userId, isMain: true },
      data: { isMain: false },
    });

    // Set target character as Main
    const updated = await tx.wowCharacter.update({
      where: { id: char.id },
      data: { isMain: true },
    });

    return updated;
  });
}

/**
 * Synchronizes character profile with fresh data from Raider.IO.
 * Enforces a 60-second cooldown per character.
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

  // Enforce manual refresh cooldown
  const cooldown = checkRefreshCooldown(char.id);
  if (!cooldown.allowed) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Rate limit cooldown: Please wait ${cooldown.remainingSeconds} seconds before refreshing this character again.`
    );
  }

  const result = await syncCharacter(char.id);
  const updated = await client.wowCharacter.findUnique({
    where: { id: char.id },
  });

  return { result, character: updated! };
}

/**
 * Safely removes (deactivates) a character from active roster.
 * Historic references in orders, runs, and teams are strictly preserved.
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
    // Soft-deactivate character
    const updated = await tx.wowCharacter.update({
      where: { id: char.id },
      data: {
        isActive: false,
        isMain: false,
      },
    });

    // If removed character was Main, elect the highest-scoring active character as Main
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

/**
 * Reactivates a previously deactivated character
 */
export async function reactivateCharacter(
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
        `Actor '${effectiveActor}' is not authorized to reactivate characters for user '${userId}'.`
      );
    }
  }

  const char = await findUserCharacter(userId, identifier, client);
  if (!char) {
    throw new DomainError(DomainErrorCode.CHARACTER_NOT_FOUND, `Character '${identifier}' not found for user '${userId}'.`);
  }

  if (char.isActive) {
    return char; // Already active
  }

  // Check if user currently has an active Main
  const activeMain = await client.wowCharacter.findFirst({
    where: { userId, isActive: true, isMain: true },
  });

  const reactivated = await (client as typeof prisma).$transaction(async (tx) => {
    const updated = await tx.wowCharacter.update({
      where: { id: char.id },
      data: {
        isActive: true,
        isMain: !activeMain,
      },
    });
    return updated;
  });

  // Attempt background sync
  syncCharacter(char.id).catch(() => {});

  return reactivated;
}
