/**
 * src/services/registrationService.ts — سرویس ثبت‌نام و بررسی درخواست‌های عضویت پلتفرم G4X
 * 
 * فاز ۳.۲.۳: بازیابی کامل چرخه درخواست، همگام‌سازی نقش دیسکورد و پردازش صف اعلانات
 */

import prisma from '../database/db';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';
import { fetchCharacterData, fetchRaiderIOProfile, parseRaiderIOProfileUrl, RaiderIOSnapshot } from './raiderio';
import { Prisma } from '@prisma/client';
import { PermissionFlagsBits } from 'discord.js';
import { processNotificationOutbox } from './notificationWorker';

export type RegistrationCategory = 'booster' | 'pilot' | 'advertiser' | 'exchanger';

export type ApplicationStatus =
  | 'pending'
  | 'info_requested'
  | 'awaiting_identity_verification'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'cancelled';

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
  raiderioUrl?: string;
}

export interface PilotRegistrationInput {
  userId: string;
  gameSlug: string;
  serviceId?: number;
  preferredLanguage?: string;
  experience?: string;
  raiderioUrl?: string;
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
  requestedCommission?: any;
}

export interface ExchangerRegistrationInput {
  userId: string;
  preferredLanguage?: string;
  introduction: string;
  experience: string;
  gameCurrencies: string[];
  settlementCurrencies: string[];
  contactInfo?: string;
}

export interface ApplicationReviewInput {
  reviewerId: string;
  applicationId: number;
  decision: 'approve' | 'reject' | 'request_info' | 'start_identity_verification' | 'retry_role_sync' | 'verify_identity';
  reason?: string;
  reviewNotes?: string;
  discordClient?: any;
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

export const ACTIVE_APPLICATION_STATUSES = [
  'pending',
  'info_requested',
  'awaiting_identity_verification',
  'under_review',
];

/**
 * ایجاد یا اطمینان از وجود رکورد کاربر در دیتابیس
 */
export async function ensureUserExists(
  userId: string,
  username?: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
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
export async function upsertUserGameApproval(
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

  // جلوگیری از درخواست‌های فعال همزمان
  const existingPending = await prisma.registrationApplication.findFirst({
    where: {
      userId,
      category: 'booster',
      gameSlug,
      serviceId: serviceId ?? null,
      status: { in: ACTIVE_APPLICATION_STATUSES },
    },
  });

  if (existingPending) {
    throw new Error('DUPLICATE_PENDING_APPLICATION: You already have an active booster application for this game and service');
  }

  let wowCharacterId: number | null = null;
  const qualificationsData: Record<string, any> = {
    experience: input.experience ?? '',
    mainRole: input.mainRole ?? '',
    specialization: input.specialization ?? '',
  };

  // الزامات اختصاصی WoW Midnight: اعتبارسنجی و واکشی پروفایل Raider.IO
  if (gameSlug === 'wow_midnight') {
    let targetUrl = input.raiderioUrl;
    if (!targetUrl && input.characterName && input.realm) {
      const reg = (input.region || 'eu').toLowerCase();
      targetUrl = `https://raider.io/characters/${reg}/${encodeURIComponent(input.realm.trim())}/${encodeURIComponent(input.characterName.trim())}`;
    }

    if (!targetUrl) {
      throw new Error('MISSING_RAIDERIO_URL: World of Warcraft: Midnight booster applications require a valid Raider.IO character profile URL');
    }

    const parsed = parseRaiderIOProfileUrl(targetUrl);
    if (!parsed) {
      throw new Error('INVALID_RAIDERIO_URL: Invalid Raider.IO character profile URL. Format must be https://raider.io/characters/<region>/<realm>/<name>');
    }

    const rioSnapshot = await fetchRaiderIOProfile(targetUrl);
    qualificationsData.raiderioSnapshot = rioSnapshot;
    qualificationsData.raiderioUrl = parsed.canonicalUrl;

    if (!input.characterName) input.characterName = parsed.characterName;
    if (!input.realm) input.realm = parsed.realm;
    if (!input.region) input.region = parsed.region;
  }

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

  const application = await prisma.registrationApplication.create({
    data: {
      userId,
      category: 'booster',
      gameSlug,
      serviceId: serviceId ?? null,
      preferredLanguage,
      qualifications: JSON.stringify(qualificationsData),
      status: 'pending',
      roleSyncStatus: 'pending',
    },
  });

  await upsertUserGameApproval(prisma, userId, gameSlug, serviceId ?? null, 'booster', 'pending');

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: 'REGISTRATION_APPLICATION_SUBMITTED',
      entityType: 'RegistrationApplication',
      entityId: String(application.id),
      newValues: JSON.stringify({ category: 'booster', gameSlug, serviceId }),
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
      status: { in: ACTIVE_APPLICATION_STATUSES },
    },
  });

  if (existingPending) {
    throw new Error('DUPLICATE_PENDING_APPLICATION: You already have an active pilot application for this game');
  }

  let rioSnapshot: RaiderIOSnapshot | null = null;
  let canonicalRioUrl: string | null = null;

  if (gameSlug === 'wow_midnight') {
    if (!input.raiderioUrl) {
      throw new Error('MISSING_RAIDERIO_URL: World of Warcraft: Midnight pilot applications require a valid Raider.IO character profile URL');
    }

    const parsed = parseRaiderIOProfileUrl(input.raiderioUrl);
    if (!parsed) {
      throw new Error('INVALID_RAIDERIO_URL: Invalid Raider.IO character profile URL. Format must be https://raider.io/characters/<region>/<realm>/<name>');
    }

    rioSnapshot = await fetchRaiderIOProfile(input.raiderioUrl);
    canonicalRioUrl = parsed.canonicalUrl;
  }

  const qualificationsData: Record<string, any> = {
    experience: input.experience ?? '',
    contactPreferences: input.contactPreferences ?? {},
    notes: input.notes ?? '',
    identityVerificationState: 'awaiting_secure_submission',
    ...(rioSnapshot ? { raiderioSnapshot: rioSnapshot, raiderioUrl: canonicalRioUrl } : {}),
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
      roleSyncStatus: 'pending',
      identityStatus: 'awaiting_submission',
    },
  });

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
 * ۳. ثبت‌نام ادورتایزر
 */
export async function registerAdvertiser(input: AdvertiserRegistrationInput) {
  const { userId, preferredLanguage = 'en' } = input;

  await ensureUserExists(userId);

  if (input.requestedCommission !== undefined && input.requestedCommission !== null) {
    throw new Error('COMMISSION_SELECTION_FORBIDDEN: Advertisers cannot set or propose their own commission rate');
  }

  const existingPending = await prisma.registrationApplication.findFirst({
    where: {
      userId,
      category: 'advertiser',
      status: { in: ACTIVE_APPLICATION_STATUSES },
    },
  });

  if (existingPending) {
    throw new Error('DUPLICATE_PENDING_APPLICATION: You already have an active advertiser application');
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
      roleSyncStatus: 'pending',
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
 * ۴. ثبت‌نام صراف
 */
export async function registerExchanger(input: ExchangerRegistrationInput) {
  const { userId, preferredLanguage = 'en' } = input;

  await ensureUserExists(userId);

  if (!input.gameCurrencies || input.gameCurrencies.length === 0) {
    throw new Error('INVALID_CURRENCY_SELECTION: At least one in-game currency must be selected');
  }
  for (const gc of input.gameCurrencies) {
    if (!SUPPORTED_EXCHANGER_GAME_CURRENCIES.includes(gc)) {
      throw new Error(`UNSUPPORTED_GAME_CURRENCY: '${gc}' is not a supported exchange game currency`);
    }
  }

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
      status: { in: ACTIVE_APPLICATION_STATUSES },
    },
  });

  if (existingPending) {
    throw new Error('DUPLICATE_PENDING_APPLICATION: You already have an active exchanger application');
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
      roleSyncStatus: 'pending',
      identityStatus: 'awaiting_submission',
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
 * ۵. ارسال مدارک تکمیلی توسط متقاضی (حل مشکل BUG 1)
 */
export async function submitSupplementalInfo(
  applicationId: number,
  userId: string,
  supplementalInfo: string,
  discordClient?: any
) {
  const application = await prisma.registrationApplication.findUnique({
    where: { id: applicationId },
  });

  if (!application) {
    throw new Error('APPLICATION_NOT_FOUND: Application does not exist');
  }

  // اعتبارسنجی مالکیت قطعی درخواست (Security Guard)
  if (application.userId !== userId) {
    throw new Error('UNAUTHORIZED_APPLICANT: You can only update your own applications');
  }

  if (application.status !== 'info_requested') {
    throw new Error(
      `INVALID_STATUS_FOR_SUPPLEMENTAL: Cannot provide info when application status is '${application.status}'`
    );
  }

  if (!supplementalInfo || supplementalInfo.trim().length === 0) {
    throw new Error('MISSING_SUPPLEMENTAL_INFO: Supplemental information cannot be empty');
  }

  // انتقال امن وضعیت به under_review
  const updatedApp = await prisma.registrationApplication.update({
    where: { id: applicationId },
    data: {
      status: 'under_review',
      supplementalInfo: supplementalInfo.trim(),
      infoRespondedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: 'REGISTRATION_SUPPLEMENTAL_INFO_SUBMITTED',
      entityType: 'RegistrationApplication',
      entityId: String(applicationId),
      newValues: JSON.stringify({ status: 'under_review', respondedAt: new Date() }),
    },
  });

  // ثبت اعلان در صف اوت‌باکس
  await prisma.notificationOutbox.create({
    data: {
      eventKey: `reg_supp_${applicationId}_${Date.now()}`,
      recipientId: userId,
      notificationType: 'APPLICATION_SUPPLEMENTAL_RECEIVED',
      deliveryChannel: 'discord_dm',
      payload: JSON.stringify({
        applicationId,
        category: application.category,
        status: 'under_review',
      }),
    },
  });

  // پردازش بلادرنگ اوت‌باکس
  if (discordClient) {
    processNotificationOutbox(discordClient).catch(() => null);
  }

  return updatedApp;
}

/**
 * ۶. واکشی درخواست‌های فعال یک کاربر (جهت ریکاوری و منوی My Applications)
 */
export async function getUserActiveApplications(userId: string) {
  return await prisma.registrationApplication.findMany({
    where: {
      userId,
      status: { in: ACTIVE_APPLICATION_STATUSES },
    },
    orderBy: { submittedAt: 'desc' },
  });
}

/**
 * ۷. بررسی و صدور تصمیم مدیریتی بر روی درخواست (Admin Review Workflow)
 */
export async function reviewApplication(input: ApplicationReviewInput) {
  const { reviewerId, applicationId, decision, reason, reviewNotes, discordClient } = input;

  const application = await prisma.registrationApplication.findUnique({
    where: { id: applicationId },
  });

  if (!application) {
    throw new Error('APPLICATION_NOT_FOUND: Application does not exist');
  }

  // جلوگیری صریح از خود-تاییدی متقاضی (Security Guard)
  if (application.userId === reviewerId) {
    throw new Error('CANNOT_REVIEW_OWN_APPLICATION: Applicants cannot review their own application');
  }

  // تعیین مجوز مورد نیاز
  let requiredPermission = Permission.BOOSTER_APPLICATION_REVIEW;
  if (application.category === 'pilot') {
    requiredPermission = Permission.PILOT_APPLICATION_REVIEW;
  } else if (application.category === 'advertiser') {
    requiredPermission = Permission.ADVERTISER_APPLICATION_REVIEW;
  } else if (application.category === 'exchanger') {
    requiredPermission = Permission.EXCHANGER_APPLICATION_REVIEW;
  }

  if (decision === 'start_identity_verification' || decision === 'verify_identity') {
    requiredPermission = Permission.SENSITIVE_IDENTITY_REVIEW;
  }

  const authResult = await authorize(reviewerId, requiredPermission);
  if (!authResult.allowed) {
    throw new Error(`UNAUTHORIZED_REVIEWER: ${authResult.reason || 'Insufficient permissions to review this application'}`);
  }

  // تراکنش اتمیک
  return await prisma.$transaction(async (tx) => {
    const currentApp = await tx.registrationApplication.findUnique({
      where: { id: applicationId },
    });

    if (!currentApp) {
      throw new Error('APPLICATION_NOT_FOUND: Application does not exist');
    }

    const applicantId = currentApp.userId;

    // ۱. بررسی اقدام تایید (Approve)
    if (decision === 'approve') {
      if (['approved', 'rejected', 'cancelled'].includes(currentApp.status)) {
        throw new Error(`APPLICATION_ALREADY_REVIEWED: Application is already marked as '${currentApp.status}'`);
      }

      // شرط دوگانه پایلوت: احراز هویت تاییدشده الزامی است
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

      // شرط صراف: احراز هویت تاییدشده
      if (currentApp.category === 'exchanger' && currentApp.identityStatus !== 'verified') {
        // احراز هویت صراف باید تایید شده باشد
        throw new Error('EXCHANGER_VERIFICATION_REQUIRED: Exchanger approval requires approved identity verification');
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

      // ۲. اعطای نقش در دیتابیس
      const roleKey = currentApp.category;
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

      // ۲.۱. انتساب رنک تجاری ادورتایزر (تخصیص برنز به ادورتایزرهای جدید با حفظ رنک‌های پیشین)
      if (currentApp.category === 'advertiser') {
        const applicantUser = await tx.user.findUnique({
          where: { discordId: applicantId },
          select: { advertiserRank: true },
        });

        if (!applicantUser?.advertiserRank) {
          await tx.user.update({
            where: { discordId: applicantId },
            data: { advertiserRank: 'BRONZE' },
          });
        }
      }

      // ۳. به‌روزرسانی UserGameApproval
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

      // ۴. ثبت لاگ ممیزی تایید
      await tx.auditLog.create({
        data: {
          actorId: reviewerId,
          action: 'REGISTRATION_APPLICATION_APPROVED',
          entityType: 'RegistrationApplication',
          entityId: String(applicationId),
          newValues: JSON.stringify({ status: 'approved', roleKey, reviewerId }),
        },
      });

      // ۵. ثبت اعلان تایید در صف اوت‌باکس
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

      // ۶. همگام‌سازی واقعی نقش دیسکورد و ذخیره وضعیت در دیتابیس
      await syncDiscordRole(discordClient, applicantId, roleKey, applicationId, tx);

      // اجرای فوری ورکر اعلانات
      if (discordClient) {
        processNotificationOutbox(discordClient).catch(() => null);
      }

      return updatedApp;

    // ۲. بررسی اقدام رد (Reject)
    } else if (decision === 'reject') {
      if (['approved', 'rejected', 'cancelled'].includes(currentApp.status)) {
        throw new Error(`APPLICATION_ALREADY_REVIEWED: Application is already marked as '${currentApp.status}'`);
      }

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

      if (discordClient) {
        processNotificationOutbox(discordClient).catch(() => null);
      }

      return updatedApp;

    // ۳. درخواست اطلاعات تکمیلی (Request Info)
    } else if (decision === 'request_info') {
      if (['approved', 'rejected', 'cancelled'].includes(currentApp.status)) {
        throw new Error(`APPLICATION_ALREADY_REVIEWED: Application is already marked as '${currentApp.status}'`);
      }

      const updatedApp = await tx.registrationApplication.update({
        where: { id: applicationId },
        data: {
          status: 'info_requested',
          reviewNotes: reviewNotes || reason || 'Additional information required',
          reviewedById: reviewerId,
          infoRequestedAt: new Date(),
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

      if (discordClient) {
        processNotificationOutbox(discordClient).catch(() => null);
      }

      return updatedApp;

    // ۴. شروع فرآیند احراز هویت (Start Identity Verification)
    } else if (decision === 'start_identity_verification') {
      if (['approved', 'rejected', 'cancelled'].includes(currentApp.status)) {
        throw new Error(`APPLICATION_ALREADY_REVIEWED: Application is already marked as '${currentApp.status}'`);
      }

      const updatedApp = await tx.registrationApplication.update({
        where: { id: applicationId },
        data: {
          status: 'awaiting_identity_verification',
          identityStatus: 'awaiting_submission',
          reviewNotes: 'Identity verification initiated. Awaiting secure submission.',
          reviewedById: reviewerId,
        },
      });

      if (currentApp.category === 'pilot' && currentApp.gameSlug) {
        await tx.pilotVerification.updateMany({
          where: {
            userId: applicantId,
            gameSlug: currentApp.gameSlug,
          },
          data: {
            status: 'pending',
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
          newValues: JSON.stringify({ status: 'awaiting_identity_verification' }),
        },
      });

      await tx.notificationOutbox.create({
        data: {
          eventKey: `reg_id_init_${applicationId}_${Date.now()}`,
          recipientId: applicantId,
          notificationType: 'APPLICATION_IDENTITY_INITIATED',
          deliveryChannel: 'discord_dm',
          payload: JSON.stringify({
            applicationId,
            category: currentApp.category,
          }),
        },
      });

      if (discordClient) {
        processNotificationOutbox(discordClient).catch(() => null);
      }

      return updatedApp;

    // ۵. تایید رسمی احراز هویت پایلوت یا صراف (Verify Identity)
    } else if (decision === 'verify_identity') {
      if (currentApp.category === 'pilot' && currentApp.gameSlug) {
        await tx.pilotVerification.updateMany({
          where: {
            userId: applicantId,
            gameSlug: currentApp.gameSlug,
          },
          data: {
            status: 'approved',
            reviewedBy: reviewerId,
            reviewedAt: new Date(),
            reviewNote: reviewNotes || 'Identity verified by authorized management',
          },
        });
      }

      const updatedApp = await tx.registrationApplication.update({
        where: { id: applicationId },
        data: {
          identityStatus: 'verified',
          status: 'under_review',
          reviewNotes: reviewNotes || 'Identity verification verified by staff',
          reviewedById: reviewerId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: reviewerId,
          action: 'REGISTRATION_IDENTITY_VERIFIED',
          entityType: 'RegistrationApplication',
          entityId: String(applicationId),
          newValues: JSON.stringify({ identityStatus: 'verified' }),
        },
      });

      return updatedApp;

    // ۶. تلاش مجدد همگام‌سازی نقش (Retry Role Sync)
    } else if (decision === 'retry_role_sync') {
      if (currentApp.status !== 'approved') {
        throw new Error('CANNOT_RETRY_SYNC_UNAPPROVED: Role synchronization can only be retried for approved applications');
      }

      const roleKey = currentApp.category;
      await syncDiscordRole(discordClient, applicantId, roleKey, applicationId, tx);

      return currentApp;
    }

    throw new Error(`UNKNOWN_DECISION: Invalid decision '${decision}'`);
  });
}

/**
 * همگام‌سازی نقش دیسکورد با اعتبارسنجی کامل، ثبت وضعیت و عدم سقط تراکنش
 */
export async function syncDiscordRole(
  client: any,
  userId: string,
  roleKey: string,
  applicationId?: number,
  tx?: Prisma.TransactionClient
): Promise<{ success: boolean; reason?: string }> {
  const db = tx || prisma;

  if (!client) {
    if (applicationId) {
      await db.registrationApplication.update({
        where: { id: applicationId },
        data: {
          roleSyncStatus: 'failed',
          roleSyncError: 'DISCORD_CLIENT_NOT_AVAILABLE',
        },
      });
    }
    return { success: false, reason: 'DISCORD_CLIENT_NOT_AVAILABLE' };
  }

  const roleEnvMap: Record<string, string | undefined> = {
    booster: process.env.ROLE_BOOSTER,
    pilot: process.env.ROLE_PILOT,
    advertiser: process.env.ROLE_ADVERTISER,
    exchanger: process.env.ROLE_EXCHANGER,
  };

  const targetRoleId = roleEnvMap[roleKey];
  const guildId = process.env.DISCORD_GUILD_ID;

  // اعتبارسنجی فرمت اسنوفلیک دیسکورد
  const isSnowflake = (id?: string) => Boolean(id && /^\d{17,20}$/.test(id.trim()));

  if (!isSnowflake(guildId)) {
    const errorMsg = `INVALID_GUILD_CONFIG: DISCORD_GUILD_ID is missing or not a valid snowflake ('${guildId}')`;
    if (applicationId) {
      await db.registrationApplication.update({
        where: { id: applicationId },
        data: { roleSyncStatus: 'failed', roleSyncError: errorMsg },
      });
    }
    await db.auditLog.create({
      data: {
        action: 'DISCORD_ROLE_SYNC_FAILED',
        entityType: 'DiscordGuild',
        entityId: guildId || 'missing',
        reason: errorMsg,
        isSuccess: false,
      },
    });
    return { success: false, reason: errorMsg };
  }

  if (!isSnowflake(targetRoleId)) {
    const errorMsg = `INVALID_ROLE_CONFIG: Role ID for '${roleKey}' is missing or not a valid snowflake ('${targetRoleId}')`;
    if (applicationId) {
      await db.registrationApplication.update({
        where: { id: applicationId },
        data: { roleSyncStatus: 'failed', roleSyncError: errorMsg },
      });
    }
    await db.auditLog.create({
      data: {
        action: 'DISCORD_ROLE_SYNC_FAILED',
        entityType: 'DiscordRole',
        entityId: targetRoleId || 'missing',
        reason: errorMsg,
        isSuccess: false,
      },
    });
    return { success: false, reason: errorMsg };
  }

  try {
    const guild = await client.guilds.fetch(guildId!).catch(() => null);
    if (!guild) {
      const errorMsg = `GUILD_NOT_FOUND: Bot cannot fetch guild ${guildId}`;
      if (applicationId) {
        await db.registrationApplication.update({
          where: { id: applicationId },
          data: { roleSyncStatus: 'failed', roleSyncError: errorMsg },
        });
      }
      return { success: false, reason: errorMsg };
    }

    // بررسی دسترسی ManageRoles ربات
    const botMember = guild.members.me || (await guild.members.fetch(client.user.id).catch(() => null));
    if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      const errorMsg = 'BOT_MISSING_MANAGE_ROLES: Bot lacks Manage Roles permission in the guild';
      if (applicationId) {
        await db.registrationApplication.update({
          where: { id: applicationId },
          data: { roleSyncStatus: 'failed', roleSyncError: errorMsg },
        });
      }
      await db.auditLog.create({
        data: {
          action: 'DISCORD_ROLE_SYNC_FAILED',
          entityType: 'DiscordPermission',
          entityId: 'ManageRoles',
          reason: errorMsg,
          isSuccess: false,
        },
      });
      return { success: false, reason: errorMsg };
    }

    // بررسی وجود رول و سلسله‌مراتب رول‌ها (Role Hierarchy)
    const targetRole = guild.roles.cache.get(targetRoleId!) || (await guild.roles.fetch(targetRoleId!).catch(() => null));
    if (!targetRole) {
      const errorMsg = `TARGET_ROLE_NOT_FOUND: Role ${targetRoleId} does not exist in guild`;
      if (applicationId) {
        await db.registrationApplication.update({
          where: { id: applicationId },
          data: { roleSyncStatus: 'failed', roleSyncError: errorMsg },
        });
      }
      return { success: false, reason: errorMsg };
    }

    if (botMember.roles.highest.position <= targetRole.position) {
      const errorMsg = `ROLE_HIERARCHY_VIOLATION: Bot's highest role (${botMember.roles.highest.name}) is below or equal to target role (${targetRole.name})`;
      if (applicationId) {
        await db.registrationApplication.update({
          where: { id: applicationId },
          data: { roleSyncStatus: 'failed', roleSyncError: errorMsg },
        });
      }
      await db.auditLog.create({
        data: {
          action: 'DISCORD_ROLE_SYNC_FAILED',
          entityType: 'DiscordRoleHierarchy',
          entityId: targetRoleId!,
          reason: errorMsg,
          isSuccess: false,
        },
      });
      return { success: false, reason: errorMsg };
    }

    // واکشی عضو
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      const errorMsg = `MEMBER_NOT_FOUND: Applicant ${userId} is not a member of guild ${guildId}`;
      if (applicationId) {
        await db.registrationApplication.update({
          where: { id: applicationId },
          data: { roleSyncStatus: 'failed', roleSyncError: errorMsg },
        });
      }
      await db.auditLog.create({
        data: {
          action: 'DISCORD_ROLE_SYNC_FAILED',
          entityType: 'DiscordMember',
          entityId: userId,
          reason: errorMsg,
          isSuccess: false,
        },
      });
      return { success: false, reason: errorMsg };
    }

    // تخصیص رول
    await member.roles.add(targetRoleId!);

    // به‌روزرسانی وضعیت موفقیت
    if (applicationId) {
      await db.registrationApplication.update({
        where: { id: applicationId },
        data: {
          roleSyncStatus: 'synced',
          roleSyncError: null,
        },
      });
    }

    await db.auditLog.create({
      data: {
        action: 'DISCORD_ROLE_SYNC_SUCCESS',
        entityType: 'DiscordRole',
        entityId: targetRoleId!,
        newValues: JSON.stringify({ userId, roleKey }),
        isSuccess: true,
      },
    });

    return { success: true };
  } catch (err: any) {
    const errorMsg = err?.message || 'UNKNOWN_DISCORD_ROLE_ERROR';
    if (applicationId) {
      await db.registrationApplication.update({
        where: { id: applicationId },
        data: {
          roleSyncStatus: 'failed',
          roleSyncError: errorMsg,
        },
      });
    }
    await db.auditLog.create({
      data: {
        action: 'DISCORD_ROLE_SYNC_FAILED',
        entityType: 'DiscordRole',
        entityId: targetRoleId || 'unknown',
        reason: errorMsg,
        isSuccess: false,
      },
    });
    return { success: false, reason: errorMsg };
  }
}

/**
 * ارسال DM به متقاضی (سازگار با نسخه‌های قبل)
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
    console.warn(`[RegistrationService] Could not send DM to user ${userId}:`, err?.message || err);
  }
}

/**
 * دریافت شناسه کانال اختصاصی بازبینی برای هر دسته‌بندی
 */
export function getReviewChannelForCategory(
  category: RegistrationCategory,
  clientOrGuild?: any
): string | null {
  if (category === 'booster') {
    if (process.env.CHANNEL_APP_BOOSTERS) return process.env.CHANNEL_APP_BOOSTERS;
  } else if (category === 'advertiser') {
    if (process.env.CHANNEL_APP_ADVERTISERS || process.env.CHANNEL_APP_ADV) {
      return process.env.CHANNEL_APP_ADVERTISERS || process.env.CHANNEL_APP_ADV || null;
    }
  } else if (category === 'pilot') {
    if (process.env.CHANNEL_APP_PILOTS) return process.env.CHANNEL_APP_PILOTS;
  } else if (category === 'exchanger') {
    if (process.env.CHANNEL_APP_EXCHANGERS) return process.env.CHANNEL_APP_EXCHANGERS;
  }

  if (clientOrGuild) {
    const channelCache = clientOrGuild.channels?.cache;
    if (channelCache) {
      const targetName =
        category === 'booster'
          ? 'app-boosters'
          : category === 'advertiser'
          ? 'app-adv'
          : category === 'pilot'
          ? 'app-pilots'
          : 'app-exchangers';

      const found = channelCache.find(
        (c: any) =>
          c.name === targetName ||
          (category === 'advertiser' && c.name === 'app-advertisers')
      );
      if (found) return found.id;
    }
  }

  return process.env.CHANNEL_APPLY_REQUESTS || null;
}

/**
 * دریافت شناسه کانال عمومی ورود ثبت‌نام برای هر دسته‌بندی
 */
export function getPublicChannelForCategory(
  category: RegistrationCategory,
  clientOrGuild?: any
): string | null {
  if (category === 'booster') {
    if (process.env.CHANNEL_BECOME_BOOSTER) return process.env.CHANNEL_BECOME_BOOSTER;
  } else if (category === 'advertiser') {
    if (process.env.CHANNEL_BECOME_ADVERTISER || process.env.CHANNEL_BECOME_ADV) {
      return process.env.CHANNEL_BECOME_ADVERTISER || process.env.CHANNEL_BECOME_ADV || null;
    }
  } else if (category === 'pilot') {
    if (process.env.CHANNEL_BECOME_PILOT || process.env.CHANNEL_BECOME_PILOT_BOOSTER) {
      return process.env.CHANNEL_BECOME_PILOT || process.env.CHANNEL_BECOME_PILOT_BOOSTER || null;
    }
  } else if (category === 'exchanger') {
    if (process.env.CHANNEL_BECOME_EXCHANGER) return process.env.CHANNEL_BECOME_EXCHANGER;
  }

  if (clientOrGuild && clientOrGuild.channels?.cache) {
    const targetName =
      category === 'booster'
        ? 'become-booster'
        : category === 'advertiser'
        ? 'become-adv'
        : category === 'pilot'
        ? 'become-pilot-booster'
        : 'become-exchanger';

    const found = clientOrGuild.channels.cache.find(
      (c: any) =>
        c.name === targetName ||
        (category === 'advertiser' && c.name === 'become-advertiser') ||
        (category === 'pilot' && c.name === 'become-pilot')
    );
    if (found) return found.id;
  }

  return null;
}

