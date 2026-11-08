/**
 * squadValidationService.ts — اعتبارسنجی تیم‌های آماده (Premade Squads Validation)
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import { Prisma } from '@prisma/client';

/**
 * اعتبارسنجی جامع تیم آماده برای ثبت کلیم یا تخصیص به سفارش
 */
export async function validatePremadeSquad(
  squadId: number,
  orderGameSlug: string,
  serviceId: number,
  submitterId?: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
  options?: { enforceMythicPlusSize?: boolean },
) {
  const squad = await client.premadeSquad.findUnique({
    where: { id: squadId },
    include: {
      members: {
        include: {
          character: true,
          user: true,
        },
      },
    },
  });

  if (!squad) {
    throw new DomainError(DomainErrorCode.SQUAD_NOT_FOUND, `Squad #${squadId} not found`);
  }

  // ۱. بررسی تطابق بازی
  const isCompatibleGame =
    squad.gameSlug === orderGameSlug ||
    (squad.gameSlug.startsWith('wow') && orderGameSlug.startsWith('wow'));
  if (!isCompatibleGame) {
    throw new DomainError(
      DomainErrorCode.SQUAD_GAME_MISMATCH,
      `Squad belongs to game '${squad.gameSlug}', but order is for '${orderGameSlug}'`,
    );
  }

  // ۲. بررسی وضعیت تایید تیم (فقط تیم‌های active مجاز به فعالیت هستند)
  if (squad.status !== 'active') {
    throw new DomainError(
      DomainErrorCode.SQUAD_NOT_APPROVED,
      `Squad #${squadId} is not approved/active (current status: '${squad.status}')`,
    );
  }

  // ۳. بررسی مجاز بودن شخص ثبت‌کننده (لیدر یا یکی از اعضای پذیرفته‌شده تیم)
  if (submitterId) {
    const isLeader = squad.leaderId === submitterId;
    const isAcceptedMember = squad.members.some(
      (m) => m.userId === submitterId && m.status === 'accepted',
    );
    if (!isLeader && !isAcceptedMember) {
      throw new DomainError(
        DomainErrorCode.UNAUTHORIZED_SQUAD_SUBMITTER,
        `User '${submitterId}' is neither the leader nor an accepted member of squad #${squadId}`,
      );
    }
  }

  // ۴. بررسی اعضای تیم: تمام اعضا باید عضویت را پذیرفته باشند (accepted)
  if (squad.members.length === 0) {
    throw new DomainError(
      DomainErrorCode.SQUAD_NOT_APPROVED,
      `Squad #${squadId} has no registered members`,
    );
  }

  for (const member of squad.members) {
    if (member.status !== 'accepted') {
      throw new DomainError(
        DomainErrorCode.SQUAD_MEMBER_NOT_ACCEPTED,
        `Squad member '${member.userId}' has not accepted squad membership (status: '${member.status}')`,
      );
    }

    // ۵. بررسی تایید صلاحیت بازی/سرویس برای تک‌تک اعضای تیم
    const approval = await client.userGameApproval.findFirst({
      where: {
        userId: member.userId,
        gameSlug: { in: [orderGameSlug, 'wow', 'wow_midnight'] },
        OR: [{ serviceId: null }, { serviceId }],
        approvalType: 'booster',
        status: 'approved',
      },
    });

    if (!approval) {
      throw new DomainError(
        DomainErrorCode.SQUAD_MEMBER_NOT_APPROVED,
        `Squad member '${member.userId}' does not have approved booster qualification for game '${orderGameSlug}'`,
      );
    }

    // ۶. بررسی مالکیت کاراکترهای اعضای تیم و فعال بودن آن‌ها
    if (member.characterId && member.character) {
      if (member.character.userId !== member.userId) {
        throw new DomainError(
          DomainErrorCode.CHARACTER_NOT_OWNED,
          `Character '${member.character.characterName}' assigned to member '${member.userId}' belongs to user '${member.character.userId}'`,
        );
      }
      if (!member.character.isActive) {
        throw new DomainError(
          DomainErrorCode.CHARACTER_INACTIVE,
          `Character '${member.character.characterName}' assigned to member '${member.userId}' is inactive.`,
        );
      }
    }
  }

  // ۷. بررسی الزام ۴ بوستر در سرویس‌های Mythic+
  if (options?.enforceMythicPlusSize !== false) {
    const service = await client.gameService.findUnique({
      where: { id: serviceId },
    });
    if (service?.serviceKey === 'mythic_plus') {
      const acceptedMembers = squad.members.filter((m) => m.status === 'accepted');
      if (acceptedMembers.length !== 4) {
        throw new DomainError(
          DomainErrorCode.SQUAD_INVALID_SIZE,
          `Mythic+ orders require a squad of exactly 4 accepted boosters (found ${acceptedMembers.length}).`,
        );
      }
    }
  }

  return squad;
}
