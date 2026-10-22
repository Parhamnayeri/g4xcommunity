/**
 * financialPolicyService.ts — مدیریت خط‌مشی‌ها و نرخ‌های کارمزد پلتفرم‌های واسط و داخلی (G4X Financial Engine)
 *
 * پشتیبانی کامل از:
 *  - G2G (کمیسیون فروش 8.99%، کارمزد دسته برداشت 3.99% + $0.99، انتقال Toobit/BNB $0.30، حداقل برداشت $10)
 *  - SkyCoach (مبلغ سفارش تغییر نمی‌کند، کارمزد دسته برداشت 5% + $5، انتقال BNB $0.30، حداقل برداشت $50)
 *  - Eldorado (کمیسیون وابسته به بازی و دسته‌بندی؛ WoW Currency 1.5%؛ عدم فرض 0% برای N/A؛ حداقل برداشت $200؛ انتقال $1.50)
 *  - Website (کارمزد اختصاصی سفارش G4X مصوب مدیریت؛ فاقد نرخ پیش‌فرض جهانی)
 *  - Advertiser (کمیسیون اختصاصی ادورتایزر مصوب ادمین؛ عدم امکان تغییر توسط خود ادورتایزر؛ خط‌مشی مشترک WoW Gold)
 */

import prisma from '../database/db';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';

export type PlatformType = 'g2g' | 'skycoach' | 'eldorado' | 'website' | 'advertiser';
export type ListingCategoryType = 'currency' | 'top_ups' | 'items' | 'accounts' | 'boosting';

export interface FeePolicyLookupOptions {
  platform: PlatformType;
  feeType: 'sale_commission' | 'withdrawal_fee' | 'transfer_fee' | 'g4x_fee' | 'advertiser_commission';
  gameSlug?: string;
  listingCategory?: string;
  payoutRouteScope?: string;
}

export interface CreatePolicyInput {
  platform: PlatformType;
  feeType: 'sale_commission' | 'withdrawal_fee' | 'transfer_fee' | 'g4x_fee' | 'advertiser_commission';
  chargingEvent: 'sale' | 'withdrawal';
  gameSlug?: string;
  listingCategory?: string;
  percentageRate?: number;
  fixedMinor?: number;
  feeBasis?: 'gross_sale' | 'platform_net' | 'batch_total' | 'external_net';
  currency?: string;
  minThresholdMinor?: number;
  payoutRouteScope?: string;
  changeReason?: string;
}

/**
 * حداقل آستانه‌های مجاز تجمعی برای درخواست برداشت از پلتفرم‌ها (به واحد minor - سنت)
 */
export const PLATFORM_WITHDRAWAL_THRESHOLDS_MINOR: Record<string, number> = {
  g2g: 1000,       // $10.00
  skycoach: 5000,  // $50.00
  eldorado: 20000, // $200.00 (مسیر پیش‌فرض جاری مالک)
};

/**
 * دریافت حداقل آستانه برداشت پلتفرم (Synchronous Fast Lookup / Fallback)
 */
export function getPlatformWithdrawalThreshold(platform: string): number {
  return PLATFORM_WITHDRAWAL_THRESHOLDS_MINOR[platform.toLowerCase()] || 0;
}

/**
 * واکشی برخط حداقل آستانه برداشت پلتفرم از جدول سیاست‌های مصوب سیستم
 */
export async function getPlatformWithdrawalThresholdAsync(
  platform: string,
  payoutRouteScope?: string
): Promise<number> {
  const policy = await prisma.platformFeePolicy.findFirst({
    where: {
      platform: platform.toLowerCase(),
      feeType: { in: ['withdrawal_fee', 'transfer_fee', 'sale_commission'] },
      minThresholdMinor: { not: null },
      ...(payoutRouteScope ? { payoutRouteScope } : {}),
      isApproved: true,
    },
    orderBy: { version: 'desc' },
  });

  if (policy && policy.minThresholdMinor !== null && policy.minThresholdMinor !== undefined) {
    PLATFORM_WITHDRAWAL_THRESHOLDS_MINOR[platform.toLowerCase()] = policy.minThresholdMinor;
    return policy.minThresholdMinor;
  }

  return getPlatformWithdrawalThreshold(platform);
}

/**
 * به‌روزرسانی نسخه‌بندی‌شده و ممیزی‌شده حداقل آستانه برداشت پلتفرم توسط مدیر مجاز
 */
export async function updatePlatformWithdrawalThreshold(
  platform: string,
  newThresholdMinor: number,
  actorId: string,
  reason: string
) {
  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to update withdrawal thresholds'}`);
  }

  if (newThresholdMinor <= 0) {
    throw new Error('INVALID_THRESHOLD: Minimum withdrawal threshold must be greater than zero');
  }

  if (!reason || reason.trim().length < 5) {
    throw new Error('AUDIT_REASON_REQUIRED: A valid audit reason is required for policy threshold updates');
  }

  const existingPolicy = await prisma.platformFeePolicy.findFirst({
    where: {
      platform: platform.toLowerCase(),
      minThresholdMinor: { not: null },
      isApproved: true,
    },
    orderBy: { version: 'desc' },
  });

  const nextVersion = existingPolicy ? existingPolicy.version + 1 : 1;

  const newPolicy = await prisma.platformFeePolicy.create({
    data: {
      platform: platform.toLowerCase(),
      feeType: existingPolicy?.feeType || 'withdrawal_fee',
      chargingEvent: existingPolicy?.chargingEvent || 'withdrawal',
      percentageRate: existingPolicy?.percentageRate ?? null,
      fixedMinor: existingPolicy?.fixedMinor ?? null,
      feeBasis: existingPolicy?.feeBasis || 'batch_total',
      currency: existingPolicy?.currency || 'USD',
      minThresholdMinor: newThresholdMinor,
      version: nextVersion,
      isApproved: true,
      approvedBy: actorId,
      changeReason: reason,
    },
  });

  // به‌روزرسانی کش سریع محلی
  PLATFORM_WITHDRAWAL_THRESHOLDS_MINOR[platform.toLowerCase()] = newThresholdMinor;

  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'PLATFORM_WITHDRAWAL_THRESHOLD_UPDATED',
      entityType: 'PlatformFeePolicy',
      entityId: String(newPolicy.id),
      previousValues: existingPolicy ? JSON.stringify(existingPolicy) : null,
      newValues: JSON.stringify(newPolicy),
      reason,
    },
  });

  return newPolicy;
}

/**
 * مقداردهی اولیه یا اطمینان از وجود سیاست‌های کارمزد مصوب سیستم
 */
export async function seedStandardFeePolicies(): Promise<void> {
  // ۱. خط‌مشی کمیسیون فروش G2G (8.99%)
  await prisma.platformFeePolicy.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      platform: 'g2g',
      feeType: 'sale_commission',
      chargingEvent: 'sale',
      percentageRate: 0.0899,
      feeBasis: 'gross_sale',
      currency: 'USD',
      minThresholdMinor: 1000,
      version: 1,
      isApproved: true,
      changeReason: 'Standard G2G sale commission (8.99%)',
    },
  });

  // ۲. خط‌مشی کارمزد دسته برداشت G2G (3.99% + $0.99)
  await prisma.platformFeePolicy.upsert({
    where: { id: 2 },
    update: {},
    create: {
      id: 2,
      platform: 'g2g',
      feeType: 'withdrawal_fee',
      chargingEvent: 'withdrawal',
      percentageRate: 0.0399,
      fixedMinor: 99,
      feeBasis: 'batch_total',
      currency: 'USD',
      minThresholdMinor: 1000,
      version: 1,
      isApproved: true,
      changeReason: 'Standard G2G withdrawal batch fee (3.99% + $0.99)',
    },
  });

  // ۳. کارمزد انتقال شبکه Toobit/BNB برای G2G ($0.30)
  await prisma.platformFeePolicy.upsert({
    where: { id: 3 },
    update: {},
    create: {
      id: 3,
      platform: 'g2g',
      feeType: 'transfer_fee',
      chargingEvent: 'withdrawal',
      fixedMinor: 30,
      feeBasis: 'batch_total',
      currency: 'USD',
      payoutRouteScope: 'toobit_bnb',
      version: 1,
      isApproved: true,
      changeReason: 'G2G Toobit/BNB transfer fee ($0.30)',
    },
  });

  // ۴. خط‌مشی قدیمی ۵٪ + ۵ دلار بازنشسته شد (RETIRED)
  await prisma.platformFeePolicy.upsert({
    where: { id: 4 },
    update: {
      isApproved: false,
      effectiveTo: new Date(),
      changeReason: 'RETIRED: Superseded by new owner policy (10% per order)',
    },
    create: {
      id: 4,
      platform: 'skycoach',
      feeType: 'withdrawal_fee',
      chargingEvent: 'withdrawal',
      percentageRate: 0.05,
      fixedMinor: 500,
      feeBasis: 'batch_total',
      currency: 'USD',
      minThresholdMinor: 5000,
      version: 1,
      isApproved: false,
      changeReason: 'RETIRED: Superseded by new owner policy (10% per order)',
    },
  });

  // ۴.ب. خط‌مشی جدید کارمزد سفارش SkyCoach (۱۰٪ به ازای هر سفارش - بدون ۵ دلار ثابت)
  await prisma.platformFeePolicy.upsert({
    where: { id: 40 },
    update: {
      percentageRate: 0.10,
      fixedMinor: null,
      isApproved: true,
      changeReason: 'NEW OWNER POLICY: 10% per order replacing legacy 5% + $5',
    },
    create: {
      id: 40,
      platform: 'skycoach',
      feeType: 'sale_commission',
      chargingEvent: 'sale',
      percentageRate: 0.10,
      fixedMinor: null,
      feeBasis: 'gross_sale',
      currency: 'USD',
      minThresholdMinor: 5000,
      version: 2,
      isApproved: true,
      changeReason: 'NEW OWNER POLICY: 10% per order replacing legacy 5% + $5',
    },
  });

  // ۵. کارمزد انتقال BNB برای SkyCoach ($0.30)
  await prisma.platformFeePolicy.upsert({
    where: { id: 5 },
    update: {},
    create: {
      id: 5,
      platform: 'skycoach',
      feeType: 'transfer_fee',
      chargingEvent: 'withdrawal',
      fixedMinor: 30,
      feeBasis: 'batch_total',
      currency: 'USD',
      payoutRouteScope: 'bep20_bnb',
      version: 1,
      isApproved: true,
      changeReason: 'SkyCoach BNB transfer fee ($0.30)',
    },
  });

  // ۶. خط‌مشی فروش Eldorado برای WoW Currency (1.5%)
  await prisma.platformFeePolicy.upsert({
    where: { id: 6 },
    update: {},
    create: {
      id: 6,
      platform: 'eldorado',
      gameSlug: 'wow',
      listingCategory: 'currency',
      feeType: 'sale_commission',
      chargingEvent: 'sale',
      percentageRate: 0.015,
      feeBasis: 'gross_sale',
      currency: 'USD',
      version: 1,
      isApproved: true,
      changeReason: 'Eldorado WoW Currency sale commission (1.5%)',
    },
  });

  // ۷. کارمزد برداشت و انتقال تخمینی مسیر جاری Eldorado ($1.50 BNB / حداقل $200)
  await prisma.platformFeePolicy.upsert({
    where: { id: 7 },
    update: {},
    create: {
      id: 7,
      platform: 'eldorado',
      feeType: 'transfer_fee',
      chargingEvent: 'withdrawal',
      fixedMinor: 150,
      feeBasis: 'batch_total',
      currency: 'USD',
      minThresholdMinor: 20000,
      version: 1,
      isApproved: true,
      changeReason: 'Eldorado owner route transfer fee estimate ($1.50, min $200)',
    },
  });

  // ۸. خط‌مشی‌های استاندارد اولیه مستقر شدند (عدم اجرای خودکار ممیزی اصلاحی در استارت‌آپ/سید)
}

/**
 * بررسی غیرمخرب و ممیزی سیاست‌های کارمزد تاییدنشده (Phase 3.3.1 / Phase 3.4)
 * پشتیبانی کامل از حالت امن فقط‌خواندنی (dryRun: true)
 * عدم ابطال کورکورانه؛ شناسایی بر مبنای سوابق موثق یا نشانه‌گذاری برای بازبینی انسانی
 */
export async function reviewAndCorrectUnapprovedPolicies(
  actorId?: string,
  dryRun: boolean = false
): Promise<{
  reviewed: number;
  corrected: number;
  flaggedAmbiguous: number;
  details: string[];
  dryRun: boolean;
}> {
  const details: string[] = [];
  const candidateGoldPolicies = await prisma.platformFeePolicy.findMany({
    where: {
      platform: 'advertiser',
      currency: 'GOLD',
      feeType: 'g4x_fee',
      OR: [
        { percentageRate: 0.10 },
        { changeReason: { contains: '10%' } },
      ],
      isApproved: true,
    },
  });

  let validActorId: string | null = null;
  if (actorId && !dryRun) {
    const user = await prisma.user.findUnique({ where: { discordId: actorId } });
    if (user) validActorId = actorId;
  }

  let corrected = 0;
  let flaggedAmbiguous = 0;

  for (const policy of candidateGoldPolicies) {
    // بررسی منشأ (Provenance Check): آیا این رکورد ناشی از سید اولیه تاییدنشده است یا تایید صریح مدیریت دارد؟
    const isLegacyUnapprovedSeed =
      policy.id === 8 ||
      policy.approvedBy === null ||
      !policy.approvedBy ||
      policy.changeReason?.toLowerCase().includes('seed') ||
      policy.changeReason?.toLowerCase().includes('legacy') ||
      policy.changeReason?.toLowerCase().includes('unapproved');

    if (!isLegacyUnapprovedSeed && policy.approvedBy) {
      // این خط‌مشی دارای شناسه تاییدکننده است؛ بنابراین کورکورانه لغو نمی‌شود و برای بازبینی مدیر پرچم‌گذاری می‌گردد
      flaggedAmbiguous++;
      details.push(
        `[FLAGGED_FOR_REVIEW] Policy #${policy.id} has 10% rate but was approved by ${policy.approvedBy}. Retained for explicit management review.`
      );
      continue;
    }

    if (dryRun) {
      corrected++;
      details.push(
        `[DRY_RUN] Policy #${policy.id} identified as unapproved legacy seeded 10% rate. Would be revoked safely.`
      );
    } else {
      const updated = await prisma.platformFeePolicy.update({
        where: { id: policy.id },
        data: {
          isApproved: false,
          effectiveTo: new Date(),
          changeReason:
            'REVOKED_UNAPPROVED_RATE: 10% rate was unapproved per Phase 3.3.1 audit. Pending explicit management configuration.',
        },
      });

      await prisma.auditLog.create({
        data: {
          actorId: validActorId,
          action: 'FINANCIAL_POLICY_REVOKED',
          entityType: 'PlatformFeePolicy',
          entityId: String(policy.id),
          previousValues: JSON.stringify(policy),
          newValues: JSON.stringify(updated),
          reason: 'Unapproved 10% Gold advertiser fee rate revoked per Phase 3.3.1 business rule audit.',
        },
      });

      details.push(`Policy #${policy.id} revoked: previously approved with unapproved 10% rate.`);
      corrected++;
    }
  }

  return {
    reviewed: candidateGoldPolicies.length,
    corrected,
    flaggedAmbiguous,
    details,
    dryRun,
  };
}

/**
 * واکشی خط‌مشی مشترک مصوب کارمزد سفارشات طلای ادورتایزر
 */
export async function getSharedAdvertiserGoldFeePolicy() {
  return prisma.platformFeePolicy.findFirst({
    where: {
      platform: 'advertiser',
      feeType: 'g4x_fee',
      listingCategory: 'currency',
      currency: 'GOLD',
      isApproved: true,
    },
    orderBy: { version: 'desc' },
  });
}

/**
 * تنظیم درصد مصوب مشترک سفارشات طلای ادورتایزر توسط مدیریت مجاز (Versioned & Audited)
 */
export async function configureSharedAdvertiserGoldFeePolicy(options: {
  percentageRate: number;
  actorId: string;
  reason?: string;
}) {
  const { percentageRate, actorId, reason } = options;
  if (percentageRate < 0 || percentageRate > 1) {
    throw new Error('INVALID_FEE_RATE: Percentage rate must be between 0.00 and 1.00');
  }

  return createOrUpdateFeePolicy(
    {
      platform: 'advertiser',
      feeType: 'g4x_fee',
      chargingEvent: 'sale',
      listingCategory: 'currency',
      currency: 'GOLD',
      percentageRate,
      feeBasis: 'gross_sale',
      changeReason: reason || 'Approved management shared Gold advertiser G4X fee policy',
    },
    actorId
  );
}

/**
 * واکشی خط‌مشی کارمزد مصوب با توجه به پلتفرم، بازی، دسته‌بندی و نوع کارمزد
 */
export async function getFeePolicy(options: FeePolicyLookupOptions) {
  const { platform, feeType, gameSlug, listingCategory, payoutRouteScope } = options;

  // برای پلتفرم Eldorado، اگر نوع کارمزد sale_commission است، بازی و دسته‌بندی باید مشخص باشند
  if (platform === 'eldorado' && feeType === 'sale_commission') {
    if (!gameSlug || !listingCategory) {
      return null;
    }

    const policy = await prisma.platformFeePolicy.findFirst({
      where: {
        platform: 'eldorado',
        feeType: 'sale_commission',
        gameSlug: { in: [gameSlug.toLowerCase(), gameSlug.toLowerCase().startsWith('wow') ? 'wow' : gameSlug.toLowerCase()] },
        listingCategory: listingCategory.toLowerCase(),
        isApproved: true,
      },
      orderBy: { version: 'desc' },
    });

    return policy;
  }

  // جستجوی عمومی با تطابق دقیق‌ترین شرایط
  const policy = await prisma.platformFeePolicy.findFirst({
    where: {
      platform: platform.toLowerCase(),
      feeType,
      ...(gameSlug ? { gameSlug: gameSlug.toLowerCase() } : {}),
      ...(listingCategory ? { listingCategory: listingCategory.toLowerCase() } : {}),
      ...(payoutRouteScope ? { payoutRouteScope } : {}),
      isApproved: true,
    },
    orderBy: { version: 'desc' },
  });

  return policy;
}

/**
 * ایجاد یا ویرایش نسخه‌بندی‌شده یک خط‌مشی کارمزد با کنترل دسترسی و ثبت ممیزی
 */
export async function createOrUpdateFeePolicy(input: CreatePolicyInput, actorId: string) {
  // بررسی امنیتی: فقط Owner یا Manager مجاز به تغییر خط‌مشی‌های مالی هستند
  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to manage financial policies'}`);
  }

  // واکشی آخرین نسخه برای افزایش شماره نسخه (Immutable Versioning)
  const existing = await prisma.platformFeePolicy.findFirst({
    where: {
      platform: input.platform.toLowerCase(),
      feeType: input.feeType,
      gameSlug: input.gameSlug?.toLowerCase() ?? null,
      listingCategory: input.listingCategory?.toLowerCase() ?? null,
      payoutRouteScope: input.payoutRouteScope ?? null,
    },
    orderBy: { version: 'desc' },
  });

  const nextVersion = existing ? existing.version + 1 : 1;

  // اگر نسخه قبلی وجود دارد، تاریخ انقضای آن ثبت می‌شود
  if (existing) {
    await prisma.platformFeePolicy.update({
      where: { id: existing.id },
      data: { effectiveTo: new Date() },
    });
  }

  const newPolicy = await prisma.platformFeePolicy.create({
    data: {
      platform: input.platform.toLowerCase(),
      feeType: input.feeType,
      chargingEvent: input.chargingEvent,
      gameSlug: input.gameSlug?.toLowerCase() ?? null,
      listingCategory: input.listingCategory?.toLowerCase() ?? null,
      percentageRate: input.percentageRate ?? null,
      fixedMinor: input.fixedMinor ?? null,
      feeBasis: input.feeBasis ?? null,
      currency: input.currency ?? 'USD',
      minThresholdMinor: input.minThresholdMinor ?? null,
      payoutRouteScope: input.payoutRouteScope ?? null,
      version: nextVersion,
      isApproved: true,
      approvedBy: actorId,
      changeReason: input.changeReason ?? 'Admin policy update',
      effectiveFrom: new Date(),
    },
  });

  // ثبت لاگ ممیزی
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'FINANCIAL_POLICY_UPDATED',
      entityType: 'PlatformFeePolicy',
      entityId: String(newPolicy.id),
      previousValues: existing ? JSON.stringify(existing) : null,
      newValues: JSON.stringify(newPolicy),
      reason: input.changeReason ?? 'Admin policy update',
    },
  });

  return newPolicy;
}

/**
 * تنظیم درصد کمیسیون یک ادورتایزر توسط ادمین (جلوگیری از خود-تنظیمی ادورتایزر)
 */
export async function setAdvertiserCommissionRate(
  advertiserId: string,
  commissionRate: number,
  actorId: string
): Promise<void> {
  // گارد امنیتی: ادورتایزر هرگز نباید بتواند کمیسیون خود را تعیین کند
  if (advertiserId === actorId) {
    throw new Error('PERMISSION_DENIED: Advertisers cannot set or modify their own commission rate');
  }

  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  if (!auth.allowed) {
    throw new Error('PERMISSION_DENIED: Only authorized management can configure advertiser commissions');
  }

  if (commissionRate < 0 || commissionRate > 1) {
    throw new Error('INVALID_COMMISSION_RATE: Commission rate must be between 0.00 and 1.00');
  }

  await prisma.wallet.upsert({
    where: { userId: advertiserId },
    update: { customCommissionRate: commissionRate },
    create: {
      userId: advertiserId,
      customCommissionRate: commissionRate,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'ADVERTISER_COMMISSION_SET',
      entityType: 'UserWallet',
      entityId: advertiserId,
      newValues: JSON.stringify({ customCommissionRate: commissionRate }),
    },
  });
}

/**
 * دریافت درصد کمیسیون ادورتایزر
 */
export async function getAdvertiserCommissionRate(advertiserId: string): Promise<number | null> {
  const wallet = await prisma.wallet.findUnique({
    where: { userId: advertiserId },
  });

  return wallet?.customCommissionRate ?? null;
}
