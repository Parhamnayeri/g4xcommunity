/**
 * teamService.ts — مدیریت تیم‌های آماده بوسترها (Premade Squads)
 *
 * قوانین بیزینس:
 *  - فقط بوسترهای تایید شده و فعال مجاز به تشکیل و عضویت در تیم هستند
 *  - عضویت در تیم باید صراحتاً توسط عضو پذیرفته شود (Explicit Acceptance)
 *  - لیدر تیم حق ارسال دعوت‌نامه و مدیریت را دارد
 *  - جلوگیری از اعضای تکراری و دعوت‌نامه‌های همزمان تکراری
 *  - مدیریت ایمن خروج لیدر (انتقال رهبری یا انحلال ایمن)
 *  - جلوگیری از انحلال غیرمجاز تیم
 *  - حفظ الزامات ۴ نفره در Mythic+
 *  - هیچ تخصیص مالی خودکاری هنگام ایجاد تیم ایجاد نمی‌شود
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import { ensureApprovedBooster, isUserAdminOrManager } from './characterService';
import { Prisma } from '@prisma/client';

export type SquadType = 'duo' | 'trio' | 'full';

export const SQUAD_CAPACITIES: Record<SquadType, number> = {
  duo: 2,
  trio: 3,
  full: 4, // 4-Booster requirement for Mythic+
};

export interface CreateTeamInput {
  leaderId: string;
  teamName: string;
  squadType?: SquadType;
  gameSlug?: string;
  actorId?: string;
}

export interface InviteMemberInput {
  squadIdOrName: number | string;
  leaderId: string;
  targetUserId: string;
  memberRole?: string;
  gameSlug?: string;
}

/**
 * یافتن تیم بر اساس شناسه عددی یا نام تیم
 */
export async function findSquad(
  identifier: number | string,
  gameSlug: string = 'wow_midnight',
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  if (typeof identifier === 'number' || !isNaN(Number(identifier))) {
    return client.premadeSquad.findUnique({
      where: { id: Number(identifier) },
      include: {
        leader: true,
        members: {
          include: {
            user: true,
            character: true,
          },
        },
      },
    });
  }

  const teamName = String(identifier).trim();
  return client.premadeSquad.findFirst({
    where: {
      teamName: { equals: teamName },
      gameSlug: { in: [gameSlug, 'wow_midnight', 'wow'] },
    },
    include: {
      leader: true,
      members: {
        include: {
          user: true,
          character: true,
        },
      },
    },
  });
}

/**
 * ایجاد تیم جدید
 */
export async function createTeam(
  input: CreateTeamInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const actorId = input.actorId || input.leaderId;
  if (actorId !== input.leaderId) {
    const authorized = await isUserAdminOrManager(actorId, client);
    if (!authorized) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        `Actor '${actorId}' is not authorized to create a team for leader '${input.leaderId}'.`
      );
    }
  }

  const gameSlug = input.gameSlug || 'wow_midnight';
  await ensureApprovedBooster(input.leaderId, gameSlug, client);

  const teamName = input.teamName.trim();
  if (!teamName || teamName.length < 3 || teamName.length > 40) {
    throw new DomainError(
      DomainErrorCode.SQUAD_NOT_APPROVED,
      'Team name must be between 3 and 40 characters.'
    );
  }

  const squadType = (input.squadType || 'full') as SquadType;
  if (!['duo', 'trio', 'full'].includes(squadType)) {
    throw new DomainError(
      DomainErrorCode.SQUAD_INVALID_SIZE,
      `Invalid squad type '${input.squadType}'. Allowed: duo, trio, full.`
    );
  }

  // بررسی عدم تکراری بودن نام تیم در وضعیت فعال
  const existingSquad = await client.premadeSquad.findFirst({
    where: {
      teamName: { equals: teamName },
      gameSlug: { in: [gameSlug, 'wow_midnight', 'wow'] },
      status: { not: 'disbanded' },
    },
  });

  if (existingSquad) {
    throw new DomainError(
      DomainErrorCode.SQUAD_NAME_TAKEN,
      `Team name '${teamName}' is already taken and active.`
    );
  }

  // یافتن کاراکتر اصلی لیدر (در صورت وجود)
  const leaderMainChar = await client.wowCharacter.findFirst({
    where: { userId: input.leaderId, isActive: true, isMain: true },
  });

  // اطمینان از وجود بازی در دیتابیس
  const game = await client.game.findUnique({
    where: { slug: gameSlug },
  }) || await client.game.findFirst({
    where: { slug: { in: ['wow_midnight', 'wow'] } },
  });
  const finalGameSlug = game ? game.slug : gameSlug;

  return (client as typeof prisma).$transaction(async (tx) => {
    const squad = await tx.premadeSquad.create({
      data: {
        gameSlug: finalGameSlug,
        teamName,
        leaderId: input.leaderId,
        squadType,
        status: 'active',
      },
    });

    await tx.squadMember.create({
      data: {
        squadId: squad.id,
        userId: input.leaderId,
        memberRole: 'leader',
        characterId: leaderMainChar ? leaderMainChar.id : null,
        status: 'accepted',
      },
    });

    return tx.premadeSquad.findUnique({
      where: { id: squad.id },
      include: {
        leader: true,
        members: {
          include: {
            user: true,
            character: true,
          },
        },
      },
    });
  });
}

/**
 * دعوت عضو جدید به تیم
 */
export async function inviteMember(
  input: InviteMemberInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const gameSlug = input.gameSlug || 'wow_midnight';
  const squad = await findSquad(input.squadIdOrName, gameSlug, client);
  if (!squad || squad.status === 'disbanded') {
    throw new DomainError(
      DomainErrorCode.SQUAD_NOT_FOUND,
      `Active squad '${input.squadIdOrName}' not found.`
    );
  }

  // فقط لیدر یا ادمین مجاز به دعوت است
  if (squad.leaderId !== input.leaderId) {
    const authorized = await isUserAdminOrManager(input.leaderId, client);
    if (!authorized) {
      throw new DomainError(
        DomainErrorCode.SQUAD_NOT_LEADER,
        `User '${input.leaderId}' is not the leader of team '${squad.teamName}'.`
      );
    }
  }

  // بررسی تایید صلاحیت کاربر دعوت‌شونده
  await ensureApprovedBooster(input.targetUserId, squad.gameSlug, client);

  // بررسی ظرفیت تیم بر اساس squadType
  const maxCapacity = SQUAD_CAPACITIES[(squad.squadType as SquadType) || 'full'] ?? 4;
  const currentMembersCount = squad.members.filter((m) => m.status === 'accepted' || m.status === 'pending').length;

  if (currentMembersCount >= maxCapacity) {
    throw new DomainError(
      DomainErrorCode.SQUAD_CAPACITY_EXCEEDED,
      `Team '${squad.teamName}' is at maximum capacity (${maxCapacity} members for '${squad.squadType}').`
    );
  }

  // بررسی وضعیت فعلی کاربر در تیم
  const existingMember = squad.members.find((m) => m.userId === input.targetUserId);
  if (existingMember) {
    if (existingMember.status === 'accepted') {
      throw new DomainError(
        DomainErrorCode.SQUAD_ALREADY_MEMBER,
        `User '${input.targetUserId}' is already an active member of team '${squad.teamName}'.`
      );
    }
    if (existingMember.status === 'pending') {
      throw new DomainError(
        DomainErrorCode.SQUAD_INVITATION_EXISTS,
        `A pending invitation already exists for user '${input.targetUserId}' in team '${squad.teamName}'.`
      );
    }

    // اگر قبلاً رد کرده بوده، به حالت pending بازمی‌گردانیم
    return client.squadMember.update({
      where: {
        squadId_userId: {
          squadId: squad.id,
          userId: input.targetUserId,
        },
      },
      data: {
        status: 'pending',
        memberRole: input.memberRole || existingMember.memberRole || 'dps',
        joinedAt: new Date(),
      },
    });
  }

  // ایجاد رکورد دعوت جدید
  return client.squadMember.create({
    data: {
      squadId: squad.id,
      userId: input.targetUserId,
      memberRole: input.memberRole || 'dps',
      status: 'pending',
    },
  });
}

/**
 * پذیرش دعوت تیم توسط عضو
 */
export async function acceptInvitation(
  squadIdOrName: number | string,
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const squad = await findSquad(squadIdOrName, 'wow_midnight', client);
  if (!squad || squad.status === 'disbanded') {
    throw new DomainError(
      DomainErrorCode.SQUAD_NOT_FOUND,
      `Active squad '${squadIdOrName}' not found.`
    );
  }

  // بررسی اینکه کاربر هنوز بوستر فعال است
  await ensureApprovedBooster(userId, squad.gameSlug, client);

  const member = await client.squadMember.findUnique({
    where: {
      squadId_userId: {
        squadId: squad.id,
        userId,
      },
    },
  });

  if (!member || member.status !== 'pending') {
    throw new DomainError(
      DomainErrorCode.SQUAD_INVITATION_NOT_FOUND,
      `No pending invitation found for user '${userId}' in team '${squad.teamName}'.`
    );
  }

  // یافتن کاراکتر اصلی کاربر برای الحاق به عضویت تیم
  const userMainChar = await client.wowCharacter.findFirst({
    where: { userId, isActive: true, isMain: true },
  });

  return client.squadMember.update({
    where: {
      squadId_userId: {
        squadId: squad.id,
        userId,
      },
    },
    data: {
      status: 'accepted',
      characterId: userMainChar ? userMainChar.id : member.characterId,
      joinedAt: new Date(),
    },
  });
}

/**
 * رد دعوت تیم توسط عضو
 */
export async function declineInvitation(
  squadIdOrName: number | string,
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const squad = await findSquad(squadIdOrName, 'wow_midnight', client);
  if (!squad) {
    throw new DomainError(
      DomainErrorCode.SQUAD_NOT_FOUND,
      `Squad '${squadIdOrName}' not found.`
    );
  }

  const member = await client.squadMember.findUnique({
    where: {
      squadId_userId: {
        squadId: squad.id,
        userId,
      },
    },
  });

  if (!member || member.status !== 'pending') {
    throw new DomainError(
      DomainErrorCode.SQUAD_INVITATION_NOT_FOUND,
      `No pending invitation found for user '${userId}' in team '${squad.teamName}'.`
    );
  }

  return client.squadMember.update({
    where: {
      squadId_userId: {
        squadId: squad.id,
        userId,
      },
    },
    data: {
      status: 'declined',
    },
  });
}

/**
 * خروج از تیم (با مدیریت خروج لیدر)
 */
export async function leaveTeam(
  squadIdOrName: number | string,
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const squad = await findSquad(squadIdOrName, 'wow_midnight', client);
  if (!squad || squad.status === 'disbanded') {
    throw new DomainError(
      DomainErrorCode.SQUAD_NOT_FOUND,
      `Active squad '${squadIdOrName}' not found.`
    );
  }

  const member = squad.members.find((m) => m.userId === userId && m.status === 'accepted');
  if (!member) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      `User '${userId}' is not an active member of team '${squad.teamName}'.`
    );
  }

  return (client as typeof prisma).$transaction(async (tx) => {
    const isLeader = squad.leaderId === userId;

    if (!isLeader) {
      // عضو عادی خارج می‌شود
      await tx.squadMember.delete({
        where: {
          squadId_userId: {
            squadId: squad.id,
            userId,
          },
        },
      });
      return { action: 'left', squadId: squad.id, newLeaderId: squad.leaderId };
    }

    // اگر کاربر لیدر تیم است:
    // یافتن سایر اعضای پذیرفته‌شده بر اساس سابقه عضویت
    const otherMembers = squad.members
      .filter((m) => m.userId !== userId && m.status === 'accepted')
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

    if (otherMembers.length > 0) {
      // انتقال رهبری به قدیمی‌ترین عضو پذیرفته‌شده
      const newLeader = otherMembers[0];
      await tx.premadeSquad.update({
        where: { id: squad.id },
        data: { leaderId: newLeader.userId },
      });

      await tx.squadMember.update({
        where: {
          squadId_userId: {
            squadId: squad.id,
            userId: newLeader.userId,
          },
        },
        data: { memberRole: 'leader' },
      });

      await tx.squadMember.delete({
        where: {
          squadId_userId: {
            squadId: squad.id,
            userId,
          },
        },
      });

      return { action: 'leader_transferred', squadId: squad.id, newLeaderId: newLeader.userId };
    }

    // اگر هیچ عضو دیگری وجود ندارد، تیم منحل می‌شود
    await tx.premadeSquad.update({
      where: { id: squad.id },
      data: { status: 'disbanded' },
    });

    await tx.squadMember.delete({
      where: {
        squadId_userId: {
          squadId: squad.id,
          userId,
        },
      },
    });

    return { action: 'disbanded', squadId: squad.id, newLeaderId: null };
  });
}

/**
 * انحلال تیم
 */
export async function disbandTeam(
  squadIdOrName: number | string,
  actorId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const squad = await findSquad(squadIdOrName, 'wow_midnight', client);
  if (!squad || squad.status === 'disbanded') {
    throw new DomainError(
      DomainErrorCode.SQUAD_NOT_FOUND,
      `Active squad '${squadIdOrName}' not found.`
    );
  }

  // فقط لیدر یا ادمین مجاز به انحلال تیم هستند
  if (squad.leaderId !== actorId) {
    const authorized = await isUserAdminOrManager(actorId, client);
    if (!authorized) {
      throw new DomainError(
        DomainErrorCode.PERMISSION_DENIED,
        `Actor '${actorId}' is not authorized to disband team '${squad.teamName}'.`
      );
    }
  }

  return (client as typeof prisma).$transaction(async (tx) => {
    const updated = await tx.premadeSquad.update({
      where: { id: squad.id },
      data: { status: 'disbanded' },
    });

    return updated;
  });
}

/**
 * دریافت لیست تیم‌های مرتبط با کاربر یا همه تیم‌ها
 */
export async function listTeams(
  userId?: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  return client.premadeSquad.findMany({
    where: {
      status: { not: 'disbanded' },
      ...(userId
        ? {
            OR: [
              { leaderId: userId },
              { members: { some: { userId } } },
            ],
          }
        : {}),
    },
    include: {
      leader: true,
      members: {
        include: {
          user: true,
          character: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}
