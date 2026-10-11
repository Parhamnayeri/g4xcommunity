/**
 * registrationService.ts — سرویس ثبت‌نام و بررسی درخواست‌های عضویت پلتفرم G4X
 * 
 * فاز ۳.۲: سیستم ثبت‌نام دیسکورد (بوستر، پایلوت، ادورتایزر، صراف)
 */

import prisma from '../database/db';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';
import { fetchCharacterData } from './raiderio';
import { Prisma } from '@prisma/client';

export type RegistrationCategory = 'booster' | 'pilot' | 'advertiser' | 'exchanger';

export interface BoosterRegistrationInput {
  userId: string;
  gameSlug: string;
  serviceId?: number;
  preferredLanguage?: string;
  experience?: string;
  mainRole?: string;
  specialization?: string;
  characterName?: string;
  realm?: string;
  region?: string;
}

export interface PilotRegistrationInput {
  userId: string;
  gameSlug: string;
  serviceId?: number;
  preferredLanguage?: string;
  experience?: string;
  contactPreferences?: {
    phone?: string;
    whatsapp?: string;
    telegram?: string;
  };
  notes?: string;
}

export interface AdvertiserRegistrationInput {
  userId: string;
  preferredLanguage?: string;
  introduction: string;
  priorExperience: string;
  contactInfo: string;
  requestedCommission?: any; // Must NOT be allowed or accepted
}

export interface ExchangerRegistrationInput {
  userId: string;
  preferredLanguage?: string;
  introduction: string;
  experience: string;
  gameCurrencies: string[];       // e.g. ['wow_gold', 'poe2_divine', 'aion2_currency']
  settlementCurrencies: string[]; // e.g. ['IRT', 'USDT', 'TRY']
  contactInfo?: string;
}

export interface ApplicationReviewInput {
  reviewerId: string;
  applicationId: number;
  decision: 'approve' | 'reject' | 'request_info' | 'start_identity_verification';
  reason?: string;
  reviewNotes?: string;
  discordClient?: any; // Optional Discord Client for role sync & DM notification
}

export const SUPPORTED_PILOT_GAMES = [
  'wow_midnight',
  'wow_classic_tbc',
  'wow_classic_era',
  'wow_classic_pandaria',
  'wow_forever',
  'aion_2',
  'poe2',
  'escape_from_tarkov',
];

export const SUPPORTED_EXCHANGER_GAME_CURRENCIES = [
  'wow_gold',
  'poe2_divine',
  'aion2_currency',
];

export const SUPPORTED_EXCHANGER_SETTLEMENT_CURRENCIES = [
  'IRT',
  'USDT',
  'TRY',
];

/**
 * ایجاد یا اطمینان از وجود رکورد کاربر در دیتابیس
 */
export async function ensureUserExists(userId: string, username?: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  return await client.user.upsert({
    where: { discordId: userId },
    update: username ? { username } : {},
    create: {
      discordId: userId,
      username: username || `user_${userId.slice(-4)}`,
    },
  });
}

/**
 * ثبت یا به‌روزرسانی امن UserGameApproval بدون تداخل با محدودیت مقادیر تهی در Prisma
 */
async function upsertUserGameApproval(
  client: Prisma.TransactionClient | typeof prisma,
  userId: string,
  gameSlug: string,
  serviceId: number | null,
  approvalType: string,
  status: string,
  reviewedBy?: string | null,
  reviewNote?: string | null
) {
  const existing = await client.userGameApproval.findFirst({
    where: {
      userId,
      gameSlug,
      serviceId: serviceId ?? null,
      approvalType,
    },
  });

  if (existing) {
    return await client.userGameApproval.update({
      where: { id: existing.id },
      data: {
        status,
        reviewedBy: reviewedBy ?? null,
        reviewNote: reviewNote ?? null,
        reviewedAt: reviewedBy ? new Date() : null,
      },
    });
  } else {
    return await client.userGameApproval.create({
      data: {
        userId,
        gameSlug,
        serviceId: serviceId ?? null,
        approvalType,
        status,
        reviewedBy: reviewedBy ?? null,
        reviewNote: reviewNote ?? null,
        reviewedAt: reviewedBy ? new Date() : null,
      },
    });
  }
}

/**
 * ۱. ثبت‌نام بوستر
 */
export async function registerBooster(input: BoosterRegistrationInput) {
  const { userId, gameSlug, serviceId, preferredLanguage = 'en' } = input;

  await ensureUserExists(userId);

  // بررسی وجود بازی و سرویس
  const game = await prisma.game.findUnique({ where: { slug: gameSlug } });
  if (!game || !game.isActive) {
    throw new Error(`INVALID_GAME: Game '${gameSlug}' is invalid or inactive`);
  }

  if (serviceId) {
    const service = await prisma.gameService.findUnique({ where: { id: serviceId } });
    if (!service || service.gameSlug !== gameSlug || !service.isActive) {
      throw new Error(`INVALID_GAME_SERVICE: Service ID ${serviceId} does not belong to game '${gameSlug}' or is inactive`);
    }
  }

  // بررسی عدم وجود درخواست در حال انتظار تکراری
  const existingPending = await prisma.registrationApplication.findFirst({
    where: {
      userId,
      category: 'booster',
      gameSlug,
      serviceId: serviceId ?? null,
      status: { in: ['pending', 'info_requested'] },
    },
  });

  if (existingPending) {
    throw new Error('DUPLICATE_PENDING_APPLICATION: You already have a pending booster application for this game and service');
  }

  let wowCharacterId: number | null = null;
  const qualificationsData: Record<string, any> = {
    experience: input.experience ?? '',
    mainRole: input.mainRole ?? '',
    specialization: input.specialization ?? '',
  };

  // بررسی کاراکتر WoW با Raider.IO در صورت موجود بودن
  if (input.characterName && input.realm) {
    const region = (input.region || 'eu').toLowerCase();
    const charName = input.characterName.trim();
    const realm = input.realm.trim();

    qualificationsData.character = {
      name: charName,
      realm,
      region,
    };

    let charData = null;
    let syncStatus = 'failed';

    try {
      charData = await fetchCharacterData(charName, realm, region);
      syncStatus = charData ? 'synced' : 'not_found';
    } catch {
      syncStatus = 'failed';
    }

    const currentSeason = charData?.mythic_plus_scores_by_season?.[0];
    const scores = currentSeason?.scores;

    const raidSummary = charData?.raid_progression
      ? Object.entries(charData.raid_progression)
          .map(([raid, prog]) => `${raid}:${prog.summary}`)
          .join(' | ')
      : null;

    const savedChar = await prisma.wowCharacter.upsert({
      where: {
        userId_gameSlug_region_realm_characterName: {
          userId,
          gameSlug,
          region,
          realm,
          characterName: charName,
        },
      },
      update: {
        characterClass: charData?.class ?? null,
        activeSpec: charData?.active_spec_name ?? null,
        itemLevel: charData?.gear?.item_level_equipped ?? null,
        mythicScore: scores?.all ?? null,
        tankScore: scores?.tank ?? null,
        healerScore: scores?.healer ?? null,
        dpsScore: scores?.dps ?? null,
        raidProgression: raidSummary,
        raiderioUrl: charData?.profile_url ?? null,
        syncStatus,
        lastSyncedAt: new Date(),
      },
      create: {
        userId,
        gameSlug,
        region,
        realm,
        characterName: charName,
        characterClass: charData?.class ?? null,
        activeSpec: charData?.active_spec_name ?? null,
        itemLevel: charData?.gear?.item_level_equipped ?? null,
        mythicScore: scores?.all ?? null,
        tankScore: scores?.tank ?? null,
        healerScore: scores?.healer ?? null,
        dpsScore: scores?.dps ?? null,
        raidProgression: raidSummary,
        raiderioUrl: charData?.profile_url ?? null,
        syncStatus,
        lastSyncedAt: new Date(),
      },
    });

    wowCharacterId = savedChar.id;
    qualificationsData.wowCharacterId = wowCharacterId;
    qualificationsData.raiderio = {
      syncStatus,
      mythicScore: scores?.all ?? null,
      class: charData?.class ?? null,
      spec: charData?.active_spec_name ?? null,
    };
  }

  // ثبت در جدول پایدار RegistrationApplication
  const application = await prisma.registrationApplication.create({
    data: {
      userId,
      category: 'booster',
      gameSlug,
      serviceId: serviceId ?? null,
      preferredLanguage,
      qualifications: JSON.stringify(qualificationsData),
      status: 'pending',
    },
  });

  // ثبت یا به‌روزرسانی UserGameApproval با وضعیت pending
  await upsertUserGameApproval(prisma, userId, gameSlug, serviceId ?? null, 'booster', 'pending');

  // ثبت لاگ ممیزی
  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: 'REGISTRATION_APPLICATION_SUBMITTED',
      entityType: 'RegistrationApplication',
      entityId: String(application.id),
      newValues: JSON.stringify({ category: 'booster', gameSlug, serviceId }),
    },
  });

  // ثبت اعلان در Persistent Notification Outbox
  await prisma.notificationOutbox.create({
    data: {
      eventKey: `reg_submit_${application.id}_${Date.now()}`,
      recipientId: userId,
      notificationType: 'REGISTRATION_SUBMITTED',
      deliveryChannel: 'discord_dm',
      payload: JSON.stringify({
        applicationId: application.id,
        category: 'booster',
        gameSlug,
        status: 'pending',
      }),
    },
  });

  return application;
}

/**
 * ۲. ثبت‌نام پایلوت
 */
export async function registerPilot(input: PilotRegistrationInput) {
  const { userId, gameSlug, serviceId, preferredLanguage = 'en' } = input;

  await ensureUserExists(userId);

  if (!SUPPORTED_PILOT_GAMES.includes(gameSlug)) {
    throw new Error(`UNSUPPORTED_PILOT_GAME: Game '${gameSlug}' is not supported for pilot operations`);
  }

  const game = await prisma.game.findUnique({ where: { slug: gameSlug } });
  if (!game || !game.isActive) {
    throw new Error(`INVALID_GAME: Game '${gameSlug}' is invalid or inactive`);
  }

  if (serviceId) {
    const service = await prisma.gameService.findUnique({ where: { id: serviceId } });
    if (!service || service.gameSlug !== gameSlug || !service.isActive) {
      throw new Error(`INVALID_GAME_SERVICE: Service ID ${serviceId} does not belong to game '${gameSlug}'`);
    }
  }

  const existingPending = await prisma.registrationApplication.findFirst({
    where: {
      userId,
      category: 'pilot',
      gameSlug,
      status: { in: ['pending', 'info_requested'] },
    },
  });

  if (existingPending) {
    throw new Error('DUPLICATE_PENDING_APPLICATION: You already have a pending pilot application for this game');
  }

  const qualificationsData = {
    experience: input.experience ?? '',
    contactPreferences: input.contactPreferences ?? {},
    notes: input.notes ?? '',
    identityVerificationState: 'awaiting_secure_submission',
  };

  const application = await prisma.registrationApplication.create({
    data: {
      userId,
      category: 'pilot',
      gameSlug,
      serviceId: serviceId ?? null,
      preferredLanguage,
      qualifications: JSON.stringify(qualificationsData),
      status: 'pending',
    },
  });

  // ایجاد وضعیت پایلوت در جدول PilotVerification با وضعیت در انتظار مدارک امن
  await prisma.pilotVerification.create({
    data: {
      userId,
      gameSlug,
      status: 'pending',
      identityDocumentRef: null,
      passportDocumentRef: null,
      selfieDocumentRef: null,
    },
  });

  // ثبت در UserGameApproval به صورت pending
  await upsertUserGameApproval(prisma, userId, gameSlug, serviceId ?? null, 'pilot', 'pending');

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: 'REGISTRATION_APPLICATION_SUBMITTED',
      entityType: 'RegistrationApplication',
      entityId: String(application.id),
      newValues: JSON.stringify({ category: 'pilot', gameSlug }),
    },
  });

  await prisma.notificationOutbox.create({
    data: {
      eventKey: `reg_submit_${application.id}_${Date.now()}`,
      recipientId: userId,
      notificationType: 'REGISTRATION_SUBMITTED',
      deliveryChannel: 'discord_dm',
      payload: JSON.stringify({
        applicationId: application.id,
        category: 'pilot',
        gameSlug,
        status: 'pending',
      }),
    },
  });

  return application;
}

/**
 * ۳. ثبت‌نام ادورتایزر (Advertiser)
 */
export async function registerAdvertiser(input: AdvertiserRegistrationInput) {
  const { userId, preferredLanguage = 'en' } = input;

  await ensureUserExists(userId);

  // امنیت: ادورتایزر اجازه انتخاب یا تغییر کمیسیون ندارد
  if (input.requestedCommission !== undefined && input.requestedCommission !== null) {
    throw new Error('COMMISSION_SELECTION_FORBIDDEN: Advertisers cannot set or propose their own commission rate');
  }

  const existingPending = await prisma.registrationApplication.findFirst({
    where: {
      userId,
      category: 'advertiser',
      status: { in: ['pending', 'info_requested'] },
    },
  });

  if (existingPending) {
    throw new Error('DUPLICATE_PENDING_APPLICATION: You already have a pending advertiser application');
  }

  const qualificationsData = {
    introduction: input.introduction.trim(),
    priorExperience: input.priorExperience.trim(),
    contactInfo: input.contactInfo.trim(),
  };

  const application = await prisma.registrationApplication.create({
    data: {
      userId,
      category: 'advertiser',
      preferredLanguage,
      qualifications: JSON.stringify(qualificationsData),
      status: 'pending',
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: 'REGISTRATION_APPLICATION_SUBMITTED',
      entityType: 'RegistrationApplication',
      entityId: String(application.id),
      newValues: JSON.stringify({ category: 'advertiser' }),
    },
  });

  await prisma.notificationOutbox.create({
    data: {
      eventKey: `reg_submit_${application.id}_${Date.now()}`,
      recipientId: userId,
      notificationType: 'REGISTRATION_SUBMITTED',
      deliveryChannel: 'discord_dm',
      payload: JSON.stringify({
        applicationId: application.id,
        category: 'advertiser',
        status: 'pending',
      }),
    },
  });

  return application;
}

/**
 * ۴. ثبت‌نام صراف (Exchanger)
 */
export async function registerExchanger(input: ExchangerRegistrationInput) {
  const { userId, preferredLanguage = 'en' } = input;

  await ensureUserExists(userId);

  // اعتبارسنجی ارزهای درون‌بازی انتخاب‌شده
  if (!input.gameCurrencies || input.gameCurrencies.length === 0) {
    throw new Error('INVALID_CURRENCY_SELECTION: At least one in-game currency must be selected');
  }
  for (const gc of input.gameCurrencies) {
    if (!SUPPORTED_EXCHANGER_GAME_CURRENCIES.includes(gc)) {
      throw new Error(`UNSUPPORTED_GAME_CURRENCY: '${gc}' is not a supported exchange game currency`);
    }
  }

  // اعتبارسنجی ارزهای تسویه خارجی (IRT, USDT, TRY)
  if (!input.settlementCurrencies || input.settlementCurrencies.length === 0) {
    throw new Error('INVALID_SETTLEMENT_SELECTION: At least one external settlement currency must be selected');
  }
  for (const sc of input.settlementCurrencies) {
    if (!SUPPORTED_EXCHANGER_SETTLEMENT_CURRENCIES.includes(sc)) {
      throw new Error(`UNSUPPORTED_SETTLEMENT_CURRENCY: '${sc}' is not a supported settlement currency`);
    }
  }

  const existingPending = await prisma.registrationApplication.findFirst({
    where: {
      userId,
      category: 'exchanger',
      status: { in: ['pending', 'info_requested'] },
    },
  });

  if (existingPending) {
    throw new Error('DUPLICATE_PENDING_APPLICATION: You already have a pending exchanger application');
  }

  const qualificationsData = {
    introduction: input.introduction.trim(),
    experience: input.experience.trim(),
    gameCurrencies: input.gameCurrencies,
    settlementCurrencies: input.settlementCurrencies,
    contactInfo: input.contactInfo?.trim() || '',
  };

  const application = await prisma.registrationApplication.create({
    data: {
      userId,
      category: 'exchanger',
      preferredLanguage,
      qualifications: JSON.stringify(qualificationsData),
      status: 'pending',
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: 'REGISTRATION_APPLICATION_SUBMITTED',
      entityType: 'RegistrationApplication',
      entityId: String(application.id),
      newValues: JSON.stringify({ category: 'exchanger' }),
    },
  });

  await prisma.notificationOutbox.create({
    data: {
      eventKey: `reg_submit_${application.id}_${Date.now()}`,
      recipientId: userId,
      notificationType: 'REGISTRATION_SUBMITTED',
      deliveryChannel: 'discord_dm',
      payload: JSON.stringify({
        applicationId: application.id,
        category: 'exchanger',
        status: 'pending',
      }),
    },
  });

  return application;
}

/**
 * ۵. بررسی و صدور تصمیم مدیریتی بر روی درخواست (Admin Review Workflow)
 */
export async function reviewApplication(input: ApplicationReviewInput) {
  const { reviewerId, applicationId, decision, reason, reviewNotes, discordClient } = input;

  // واکشی درخواست جهت بررسی نوع و احراز مجوز متمرکز
  const application = await prisma.registrationApplication.findUnique({
    where: { id: applicationId },
  });

  if (!application) {
    throw new Error('APPLICATION_NOT_FOUND: Application does not exist');
  }

  // احراز صلاحیت بررسی‌کننده از طریق AuthorizationService متمرکز
  let requiredPermission = Permission.BOOSTER_APPLICATION_REVIEW;
  if (application.category === 'pilot') {
    requiredPermission = Permission.PILOT_APPLICATION_REVIEW;
  } else if (application.category === 'advertiser') {
    requiredPermission = Permission.ADVERTISER_APPLICATION_REVIEW;
  } else if (application.category === 'exchanger') {
    requiredPermission = Permission.EXCHANGER_APPLICATION_REVIEW;
  }

  if (decision === 'start_identity_verification') {
    requiredPermission = Permission.SENSITIVE_IDENTITY_REVIEW;
  }

  const authResult = await authorize(reviewerId, requiredPermission);
  if (!authResult.allowed) {
    throw new Error(`UNAUTHORIZED_REVIEWER: ${authResult.reason || 'Insufficient permissions to review this application'}`);
  }

  // تراکنش اتمیک برای جلوگیری از تداخل و مسابقه دو بررسی‌کننده (Race Condition Prevention)
  return await prisma.$transaction(async (tx) => {
    // خواندن مجدد با قفل منطقی بر اساس وضعیت
    const currentApp = await tx.registrationApplication.findUnique({
      where: { id: applicationId },
    });

    if (!currentApp || (currentApp.status !== 'pending' && currentApp.status !== 'info_requested')) {
      throw new Error(`APPLICATION_ALREADY_REVIEWED: Application is already marked as '${currentApp?.status}'`);
    }

    const applicantId = currentApp.userId;

    if (decision === 'approve') {
      // بررسی ویژه برای پایلوت: نیازمند احراز هویت تاییدشده در دیتابیس
      if (currentApp.category === 'pilot') {
        const approvedVerif = await tx.pilotVerification.findFirst({
          where: {
            userId: applicantId,
            gameSlug: currentApp.gameSlug || '',
            status: 'approved',
          },
        });

        if (!approvedVerif) {
          throw new Error('PILOT_VERIFICATION_REQUIRED: Pilot approval requires approved identity verification');
        }
      }

      // ۱. به‌روزرسانی وضعیت درخواست به approved
      const updatedApp = await tx.registrationApplication.update({
        where: { id: applicationId },
        data: {
          status: 'approved',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          reviewNotes: reviewNotes ?? null,
        },
      });

      // ۲. اعطای نقش در دیتابیس (UserRole)
      const roleKey = currentApp.category; // 'booster' | 'pilot' | 'advertiser' | 'exchanger'
      await tx.userRole.upsert({
        where: {
          userId_roleKey: {
            userId: applicantId,
            roleKey,
          },
        },
        update: {
          grantedBy: reviewerId,
          grantedAt: new Date(),
        },
        create: {
          userId: applicantId,
          roleKey,
          grantedBy: reviewerId,
          grantedAt: new Date(),
        },
      });

      // ۳. به‌روزرسانی UserGameApproval در صورت ارتباط با بازی
      if (currentApp.gameSlug) {
        await upsertUserGameApproval(
          tx,
          applicantId,
          currentApp.gameSlug,
          currentApp.serviceId ?? null,
          currentApp.category,
          'approved',
          reviewerId,
          reviewNotes
        );
      }

      // ۴. ثبت ممیزی تایید
      await tx.auditLog.create({
        data: {
          actorId: reviewerId,
          action: 'REGISTRATION_APPLICATION_APPROVED',
          entityType: 'RegistrationApplication',
          entityId: String(applicationId),
          newValues: JSON.stringify({ status: 'approved', roleKey, reviewerId }),
        },
      });

      // ۵. ثبت اعلان در اوت‌باکس
      await tx.notificationOutbox.create({
        data: {
          eventKey: `reg_decision_${applicationId}_${Date.now()}`,
          recipientId: applicantId,
          notificationType: 'APPLICATION_APPROVED',
          deliveryChannel: 'discord_dm',
          payload: JSON.stringify({
            applicationId,
            category: currentApp.category,
            status: 'approved',
            notes: reviewNotes ?? '',
          }),
        },
      });

      // همگام‌سازی نقش دیسکورد به شکل امن و مقاوم در برابر خطا
      await syncDiscordRole(discordClient, applicantId, roleKey, tx);

      return updatedApp;

    } else if (decision === 'reject') {
      const updatedApp = await tx.registrationApplication.update({
        where: { id: applicationId },
        data: {
          status: 'rejected',
          rejectionReason: reason || 'Requirements not met',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          reviewNotes: reviewNotes ?? null,
        },
      });

      if (currentApp.gameSlug) {
        await tx.userGameApproval.updateMany({
          where: {
            userId: applicantId,
            gameSlug: currentApp.gameSlug,
            serviceId: currentApp.serviceId ?? null,
            approvalType: currentApp.category,
          },
          data: {
            status: 'rejected',
            reviewedBy: reviewerId,
            reviewedAt: new Date(),
            reviewNote: reason || 'Application rejected',
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: reviewerId,
          action: 'REGISTRATION_APPLICATION_REJECTED',
          entityType: 'RegistrationApplication',
          entityId: String(applicationId),
          newValues: JSON.stringify({ status: 'rejected', reason, reviewerId }),
        },
      });

      await tx.notificationOutbox.create({
        data: {
          eventKey: `reg_decision_${applicationId}_${Date.now()}`,
          recipientId: applicantId,
          notificationType: 'APPLICATION_REJECTED',
          deliveryChannel: 'discord_dm',
          payload: JSON.stringify({
            applicationId,
            category: currentApp.category,
            status: 'rejected',
            rejectionReason: reason || 'Requirements not met',
          }),
        },
      });

      // ارسال مستقیم DM به شکل ایمن در صورت دردسترس بودن کلاینت
      await sendApplicantDm(discordClient, applicantId, {
        title: 'Application Decision',
        description: `Your application for **${currentApp.category.toUpperCase()}** was rejected.\n**Reason:** ${reason || 'Requirements not met'}\n\nYou may reapply in the future following community guidelines.`,
      });

      return updatedApp;

    } else if (decision === 'request_info') {
      const updatedApp = await tx.registrationApplication.update({
        where: { id: applicationId },
        data: {
          status: 'info_requested',
          reviewNotes: reviewNotes || reason || 'Additional information required',
          reviewedById: reviewerId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: reviewerId,
          action: 'REGISTRATION_INFO_REQUESTED',
          entityType: 'RegistrationApplication',
          entityId: String(applicationId),
          newValues: JSON.stringify({ notes: reviewNotes || reason }),
        },
      });

      await tx.notificationOutbox.create({
        data: {
          eventKey: `reg_info_req_${applicationId}_${Date.now()}`,
          recipientId: applicantId,
          notificationType: 'APPLICATION_INFO_REQUESTED',
          deliveryChannel: 'discord_dm',
          payload: JSON.stringify({
            applicationId,
            category: currentApp.category,
            requestedInfo: reviewNotes || reason,
          }),
        },
      });

      await sendApplicantDm(discordClient, applicantId, {
        title: 'Additional Information Required',
        description: `Our team has reviewed your **${currentApp.category.toUpperCase()}** application and requested more information:\n\n> ${reviewNotes || reason || 'Please contact staff for details.'}`,
      });

      return updatedApp;

    } else if (decision === 'start_identity_verification') {
      // نیازمند Permission.SENSITIVE_IDENTITY_REVIEW
      const updatedApp = await tx.registrationApplication.update({
        where: { id: applicationId },
        data: {
          status: 'info_requested',
          reviewNotes: 'Identity verification initiated. Awaiting secure submission.',
          reviewedById: reviewerId,
        },
      });

      if (currentApp.category === 'pilot' && currentApp.gameSlug) {
        await tx.pilotVerification.updateMany({
          where: {
            userId: applicantId,
            gameSlug: currentApp.gameSlug,
            status: 'pending',
          },
          data: {
            reviewNote: 'Private identity verification initiated by staff.',
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: reviewerId,
          action: 'REGISTRATION_IDENTITY_VERIFICATION_INITIATED',
          entityType: 'RegistrationApplication',
          entityId: String(applicationId),
          newValues: JSON.stringify({ status: 'awaiting_secure_submission' }),
        },
      });

      await sendApplicantDm(discordClient, applicantId, {
        title: 'Identity Verification Initiated',
        description: `Your application requires private identity verification.\nPlease await secure instructions from authorized management. Do not send sensitive identity documents in public channels.`,
      });

      return updatedApp;
    }

    throw new Error(`UNKNOWN_DECISION: Invalid decision '${decision}'`);
  });
}

/**
 * همگام‌سازی نقش دیسکورد با مقاومت در برابر خطا و ثبت لاگ بازیابی
 */
async function syncDiscordRole(client: any, userId: string, roleKey: string, tx: Prisma.TransactionClient) {
  if (!client) return;

  const roleEnvMap: Record<string, string | undefined> = {
    booster: process.env.ROLE_BOOSTER,
    pilot: process.env.ROLE_PILOT,
    advertiser: process.env.ROLE_ADVERTISER,
    exchanger: process.env.ROLE_EXCHANGER,
  };

  const targetRoleId = roleEnvMap[roleKey] || `role_${roleKey}`;
  const guildId = process.env.DISCORD_GUILD_ID || 'guild_id';

  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      await tx.auditLog.create({
        data: {
          action: 'DISCORD_ROLE_SYNC_FAILED',
          entityType: 'DiscordGuild',
          entityId: guildId,
          reason: 'GUILD_NOT_FOUND',
          isSuccess: false,
        },
      });
      return;
    }

    const member = await guild.members.fetch(userId);
    if (!member) {
      // عضو ممکن است در سرور نباشد؛ در لاگ ثبت می‌شود
      await tx.auditLog.create({
        data: {
          action: 'DISCORD_ROLE_SYNC_FAILED',
          entityType: 'DiscordMember',
          entityId: userId,
          reason: 'MEMBER_NOT_FOUND_IN_GUILD',
          isSuccess: false,
        },
      });
      return;
    }

    await member.roles.add(targetRoleId);
  } catch (err: any) {
    // خطای دیسکورد جلوی تراکنش دیتابیس را نمی‌گیرد
    await tx.auditLog.create({
      data: {
        action: 'DISCORD_ROLE_SYNC_FAILED',
        entityType: 'DiscordRole',
        entityId: targetRoleId,
        reason: err?.message || 'UNKNOWN_DISCORD_ROLE_ERROR',
        isSuccess: false,
      },
    });
  }
}

/**
 * ارسال DM خصوصی به متقاضی با مدیریت خطای بسته بودن DM (Closed DMs gracefully handled)
 */
export async function sendApplicantDm(client: any, userId: string, embedData: { title: string; description: string }) {
  if (!client) return;

  try {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return;

    await user.send({
      embeds: [
        {
          title: `🛡️ G4X Community — ${embedData.title}`,
          description: embedData.description,
          color: 0x5865f2,
          timestamp: new Date().toISOString(),
          footer: { text: 'G4X Automated Registration Notification' },
        },
      ],
    });
  } catch (err: any) {
    // خطای کد 50007 دیسکورد: Cannot send messages to this user (DMs are closed)
    // هیچ استثنایی بالا نمی‌دهد
    console.warn(`[RegistrationService] Could not send DM to user ${userId} (DMs closed or blocked):`, err?.message || err);
  }
}
