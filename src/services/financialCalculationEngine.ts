/**
 * financialCalculationEngine.ts — موتور محاسبات و تسویه مقدماتی مالی G4X (Phase 3.3)
 *
 * قابلیت‌های کلیدی:
 *  - تفکیک دقیق سطوح حسابداری:
 *      A. GROSS_SALE_AMOUNT
 *      B. PLATFORM_ORDER_NET
 *      C. PLATFORM_WITHDRAWAL_CONTRIBUTION
 *      D. PLATFORM_WITHDRAWAL_NET
 *      E. G4X_FEE
 *      F. BOOSTER_POOL
 *  - محاسبات کارمزد G2G: کمیسیون فروش 8.99%؛ عدم کسر مجدد در صورت ثبت خالص؛ کارمزد دسته 3.99% + $0.99؛ انتقال $0.30؛ حداقل $10
 *  - محاسبات کارمزد SkyCoach: مبلغ سفارش در زمان ایجاد تغییر نمی‌کند؛ کارمزد 5% + $5 یکبار برای کل دسته؛ انتقال $0.30 مجزا؛ حداقل $50
 *  - محاسبات کارمزد Eldorado: ماتریس بازی و دسته‌بندی؛ WoW Currency 1.5%؛ عدم فرض 0% برای N/A؛ حداقل برداشت $200؛ انتقال $1.50
 *  - کارمزد سفارش وب‌سایت G4X: درصد اختصاصی مصوب مدیریت پس از کسر هزینه‌های واقعی برون‌سازمانی؛ عدم وجود نرخ پیش‌فرض جهانی
 *  - سفارشات ادورتایزر: کمیسیون اختصاصی مصوب ادمین؛ خط‌مشی مشترک طلای WoW (10%)؛ اعتبارسنجی ارز؛ عدم تبدیل ساختگی طلا به دلار
 *  - تسهیم استخری بوسترها: تقسیم کاملاً مساوی میان بوسترهای واجد شرایط؛ 100% در حالت تک‌نفره؛ تقسیم میان ۴ بوستر در Mythic+؛ تقسیم میان N بوستر در سایر سرویس‌ها
 *  - توزیع دقیق باقیمانده (Largest Remainder Method) و پایستگی کامل سنت‌ها (Conservation Invariant)
 *  - عدم واریز موجودی قابل برداشت به والت در این فاز (ESCROW_RELEASE_ENABLED=false)
 */

import prisma from '../database/db';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';
import {
  getFeePolicy,
  getPlatformWithdrawalThreshold,
  getAdvertiserCommissionRate,
} from './financialPolicyService';
import {
  getAdvertiserRank,
  calculateRankCommission,
  AdvertiserRank,
  isValidAdvertiserRank,
  ADVERTISER_RANK_POLICY_VERSION,
  ADVERTISER_RANK_RATES_BPS,
} from './advertiserRankService';

// ─── ۱. توابع کمکی محاسبات صحیح و پایستگی سنت‌ها (Exact Arithmetic) ────────────

export interface AllocationItem {
  id: number | string;
  contributionMinor: number;
}

export interface AllocatedResult {
  id: number | string;
  allocatedMinor: number;
}

/**
 * تسهیم تناسبی کارمزد دسته میان مشارکت‌کنندگان با روش Largest Remainder (Hare-Niemeyer)
 * این تابع تضمین می‌کند که مجموع مقادیر تسهیم‌شده دقیقاً برابر با totalFeeMinor باشد.
 */
export function allocateProportionalWithRemainder(
  totalFeeMinor: number,
  items: AllocationItem[]
): AllocatedResult[] {
  if (items.length === 0) return [];
  if (totalFeeMinor === 0) {
    return items.map((it) => ({ id: it.id, allocatedMinor: 0 }));
  }

  const totalContributions = items.reduce((sum, it) => sum + it.contributionMinor, 0);
  if (totalContributions <= 0) {
    throw new Error('INVALID_CONTRIBUTIONS: Total contributions must be greater than zero for fee allocation');
  }

  // ۱. محاسبه سهم کف و باقیمانده اعشاری هر آیتم
  const computed = items.map((it, index) => {
    const exactQuota = (totalFeeMinor * it.contributionMinor) / totalContributions;
    const floorQuota = Math.floor(exactQuota);
    const remainder = exactQuota - floorQuota;
    return {
      index,
      id: it.id,
      floorQuota,
      remainder,
    };
  });

  const sumFloor = computed.reduce((sum, it) => sum + it.floorQuota, 0);
  let leftoverCents = totalFeeMinor - sumFloor;

  // ۲. مرتب‌سازی بر اساس بیشترین باقیمانده اعشاری برای تخصیص سنت‌های باقیمانده
  // در صورت برابری، از شاخص یا شناسه به صورت پایدار (Deterministic) استفاده می‌شود
  const sorted = [...computed].sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder - a.remainder;
    }
    return String(a.id).localeCompare(String(b.id));
  });

  const bonusMap = new Map<number, number>();
  for (let i = 0; i < leftoverCents; i++) {
    const item = sorted[i % sorted.length];
    bonusMap.set(item.index, (bonusMap.get(item.index) || 0) + 1);
  }

  // ۳. تشکیل نتیجه نهایی و اعتبارسنجی قید پایستگی
  const results: AllocatedResult[] = computed.map((it) => ({
    id: it.id,
    allocatedMinor: it.floorQuota + (bonusMap.get(it.index) || 0),
  }));

  const allocatedTotal = results.reduce((sum, r) => sum + r.allocatedMinor, 0);
  if (allocatedTotal !== totalFeeMinor) {
    throw new Error(
      `CONSERVATION_INVARIANT_VIOLATION: Allocated fee sum (${allocatedTotal}) does not match actual total (${totalFeeMinor})`
    );
  }

  return results;
}

/**
 * تقسیم کاملاً مساوی استخر بوسترها میان اعضای واجد شرایط همراه با توزیع دقیق باقیمانده
 */
export function splitPoolEquallyWithRemainder(
  poolMinor: number,
  boosterIds: string[]
): Array<{ boosterId: string; allocatedMinor: number }> {
  if (boosterIds.length === 0) {
    throw new Error('NO_BOOSTERS: Cannot split booster pool with zero eligible boosters');
  }

  if (poolMinor < 0) {
    throw new Error('INVALID_POOL_AMOUNT: Booster pool amount cannot be negative');
  }

  const count = boosterIds.length;
  const baseShare = Math.floor(poolMinor / count);
  let remainder = poolMinor % count;

  // توزیع پایدار و مساوی: هر بوستر سهم پایه دریافت می‌کند و باقیمانده تک‌سنتی به نفرات اول داده می‌شود
  const allocations = boosterIds.map((boosterId, idx) => {
    const extra = idx < remainder ? 1 : 0;
    return {
      boosterId,
      allocatedMinor: baseShare + extra,
    };
  });

  const sumAllocated = allocations.reduce((sum, a) => sum + a.allocatedMinor, 0);
  if (sumAllocated !== poolMinor) {
    throw new Error(
      `CONSERVATION_INVARIANT_VIOLATION: Booster pool split sum (${sumAllocated}) does not match pool (${poolMinor})`
    );
  }

  return allocations;
}

// ─── ۲. محاسبه اسنپ‌شات مالی سفارش (Calculate Order Financial Snapshot) ─────────

export interface CalculateOrderSnapshotInput {
  orderId: number;
  sourcePlatform: 'g2g' | 'skycoach' | 'eldorado' | 'website' | 'advertiser' | 'direct';
  sourceAmountType: 'gross_sale' | 'platform_net';
  sourceAmountMinor: number;
  currency?: string;
  gameSlug?: string;
  listingCategory?: string;
  g4xFeeRate?: number; // نرخ کارمزد سفارش وب‌سایت مصوب مدیریت (مثلاً 0.15 برای 15%)
  advertiserId?: string;
  actorId?: string;
  notes?: string;
  allowProvisional?: boolean;
}

/**
 * محاسبه و ثبت اسنپ‌شات اولیه مالی سفارش
 */
export async function calculateOrderFinancialSnapshot(input: CalculateOrderSnapshotInput) {
  const {
    orderId,
    sourcePlatform,
    sourceAmountType,
    sourceAmountMinor,
    currency = 'USD',
    gameSlug,
    listingCategory,
    g4xFeeRate,
    advertiserId,
    actorId,
    notes,
    allowProvisional = true,
  } = input;

  if (
    typeof sourceAmountMinor !== 'number' ||
    !Number.isSafeInteger(sourceAmountMinor) ||
    sourceAmountMinor <= 0
  ) {
    throw new Error(
      `INVALID_SOURCE_AMOUNT: Source amount must be a positive safe integer in minor units (cents), got ${sourceAmountMinor}`
    );
  }

  // Authoritative Order verification
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (order) {
    const authOwnerId = order.advertiserId || order.creatorId;
    if (advertiserId && authOwnerId && authOwnerId !== advertiserId) {
      throw new Error(
        `ADVERTISER_MISMATCH: Provided advertiserId '${advertiserId}' does not match authoritative order owner '${authOwnerId}'`
      );
    }
  }

  let grossSaleMinor: number | null = null;
  let platformSaleCommissionMinor = 0;
  let platformOrderNetMinor = 0;
  let allocatedWithdrawalFeeMinor = 0;
  let allocatedTransferFeeMinor = 0;
  let otherExternalFeesMinor = 0;
  let g4xFeeMinor = 0;
  let advertiserFeeMinor = 0;
  let effectiveG4xFeeRate: number | null | undefined = g4xFeeRate;
  let calculationStatus = 'provisional';
  let policyVersion: number | null = null;
  let snapshotNotes = notes || null;
  let snapAdvertiserRank: string | null = null;
  let snapRankFeeBps: number | null = null;
  let snapRemainingMinor: number | null = null;
  let snapTimestamp: Date = new Date();

  // Check if an existing snapshot already exists for this order
  const existingSnapshot = await prisma.orderFinancialSnapshot.findUnique({
    where: { orderId },
  });

  // Finalized financial snapshots are strictly immutable
  if (existingSnapshot?.calculationStatus === 'finalized') {
    const hasConflict =
      existingSnapshot.sourceAmountMinor !== sourceAmountMinor ||
      existingSnapshot.sourcePlatform !== sourcePlatform ||
      existingSnapshot.currency !== currency.toUpperCase() ||
      (advertiserId && existingSnapshot.advertiserId && existingSnapshot.advertiserId !== advertiserId);

    if (hasConflict) {
      throw new Error(
        `FINALIZED_SNAPSHOT_IMMUTABLE: Order #${orderId} financial snapshot is finalized and cannot be recalculated with conflicting parameters`
      );
    }
    return existingSnapshot;
  }

  // ── الف. پردازش بر اساس پلتفرم مبدا ──

  if (sourcePlatform === 'g2g') {
    const policy = await getFeePolicy({ platform: 'g2g', feeType: 'sale_commission' });
    policyVersion = policy?.version ?? 1;
    const saleCommissionRate = policy?.percentageRate ?? 0.0899; // 8.99%

    if (sourceAmountType === 'gross_sale') {
      grossSaleMinor = sourceAmountMinor;
      platformSaleCommissionMinor = Math.round(grossSaleMinor * saleCommissionRate);
      platformOrderNetMinor = grossSaleMinor - platformSaleCommissionMinor;
    } else {
      // platform_net: مبلغ وارد شده خالص دریافتی پلتفرم است — هرگز مجدداً کسر نمی‌شود!
      grossSaleMinor = null;
      platformSaleCommissionMinor = 0;
      platformOrderNetMinor = sourceAmountMinor;
    }
    // هزینه‌های برداشت G2G (3.99% + $0.99) و انتقال ($0.30) در زمان تسویه دسته اعمال می‌شوند
  } else if (sourcePlatform === 'skycoach') {
    // طبق تصمیم نهایی مالک (Finance V2):
    // خط‌مشی قدیمی ۵٪ + ۵ دلار کاملاً بازنشسته شد.
    // کارمزد مصوب جدید: ۱۰٪ به ازای هر سفارش (10% per order).
    // هرگز نباید هر دو کارمزد کسر شوند و هیچ کارمزد ۵ دلاری روی سفارشات یا دسته وضع نمی‌گردد.
    const policy = await getFeePolicy({ platform: 'skycoach', feeType: 'sale_commission' });
    policyVersion = policy?.version ?? 2;
    const orderFeeRate = policy?.percentageRate ?? 0.10;

    if (sourceAmountType === 'gross_sale') {
      grossSaleMinor = sourceAmountMinor;
      platformSaleCommissionMinor = Math.round(grossSaleMinor * orderFeeRate);
      platformOrderNetMinor = grossSaleMinor - platformSaleCommissionMinor;
    } else {
      // platform_net: مبلغ وارد شده از قبل با احتساب کسر ۱۰٪ خالص است — عدم کسر مجدد
      grossSaleMinor = null;
      platformSaleCommissionMinor = 0;
      platformOrderNetMinor = sourceAmountMinor;
    }
  } else if (sourcePlatform === 'eldorado') {
    if (sourceAmountType === 'platform_net') {
      // مبلغ خالص واریز شده پلتفرم است — عدم کسر مجدد کمیسیون
      grossSaleMinor = null;
      platformSaleCommissionMinor = 0;
      platformOrderNetMinor = sourceAmountMinor;
    } else {
      // gross_sale: وابستگی کامل به ماتریس بازی و دسته‌بندی
      grossSaleMinor = sourceAmountMinor;
      const policy = await getFeePolicy({
        platform: 'eldorado',
        feeType: 'sale_commission',
        gameSlug,
        listingCategory,
      });

      if (!policy || policy.percentageRate === null || policy.percentageRate === undefined) {
        // قانون اکید: N/A هرگز نباید به عنوان ۰٪ تلقی شود. در صورت نامشخص بودن، نهایی‌سازی مسدود می‌گردد.
        if (!allowProvisional) {
          throw new Error(
            `ELDORADO_CATEGORY_RATE_UNDEFINED: Fee policy for Eldorado game '${gameSlug}' and category '${listingCategory}' is undefined (N/A). Cannot assume 0% or finalize calculation.`
          );
        }
        platformSaleCommissionMinor = 0;
        platformOrderNetMinor = grossSaleMinor;
        snapshotNotes = `ELDORADO_FEE_UNKNOWN: Game '${gameSlug}' category '${listingCategory}' has no approved rate. Calculation remains provisional.`;
      } else {
        policyVersion = policy.version;
        platformSaleCommissionMinor = Math.round(grossSaleMinor * policy.percentageRate);
        platformOrderNetMinor = grossSaleMinor - platformSaleCommissionMinor;
      }
    }
  } else if (sourcePlatform === 'website') {
    // سفارشات وب‌سایت
    grossSaleMinor = sourceAmountMinor;
    platformSaleCommissionMinor = 0;
    platformOrderNetMinor = sourceAmountMinor;

    // کارمزد وب‌سایت باید درصد اختصاصی سفارش مصوب مدیریت باشد. هیچ نرخ پیش‌فرض جهانی وجود ندارد.
    if (g4xFeeRate === undefined || g4xFeeRate === null) {
      snapshotNotes = 'MISSING_ORDER_G4X_FEE_RATE: Order-specific G4X fee rate is pending admin approval.';
    }
  } else if (sourcePlatform === 'advertiser') {
    // سفارشات ادورتایزر
    grossSaleMinor = sourceAmountMinor;
    platformOrderNetMinor = sourceAmountMinor;

    // اگر اسنپ‌شات قبلی روی سفارش وجود داشته باشد، نرخ و رنک اسنپ‌شات‌شده حفظ می‌شود
    if (existingSnapshot && existingSnapshot.advertiserRank) {
      if (
        (existingSnapshot.grossSaleMinor !== null && existingSnapshot.grossSaleMinor !== sourceAmountMinor) ||
        (advertiserId && existingSnapshot.advertiserId && existingSnapshot.advertiserId !== advertiserId)
      ) {
        throw new Error(
          `CONFLICTING_SNAPSHOT_RECALCULATION: Order #${orderId} commercial terms are locked in an existing snapshot. Conflicting recalculation is rejected.`
        );
      }
      snapAdvertiserRank = existingSnapshot.advertiserRank;
      snapRankFeeBps =
        existingSnapshot.rankFeeBasisPoints ??
        (isValidAdvertiserRank(snapAdvertiserRank)
          ? ADVERTISER_RANK_RATES_BPS[snapAdvertiserRank as AdvertiserRank]
          : null);
      g4xFeeMinor = existingSnapshot.g4xFeeMinor;
      advertiserFeeMinor = 0;
      snapRemainingMinor = existingSnapshot.remainingAmountMinor ?? (grossSaleMinor - g4xFeeMinor);
      snapTimestamp = existingSnapshot.snapshotTimestamp ?? existingSnapshot.createdAt;
      policyVersion = existingSnapshot.policyVersion ?? ADVERTISER_RANK_POLICY_VERSION;
      effectiveG4xFeeRate = snapRankFeeBps ? snapRankFeeBps / 10000 : existingSnapshot.g4xFeeRate;
    } else {
      // استعلام رنک فعال تجاری ادورتایزر
      const activeRank = advertiserId ? await getAdvertiserRank(advertiserId) : null;

      if (currency.toUpperCase() === 'GOLD') {
        const customRate = advertiserId ? await getAdvertiserCommissionRate(advertiserId) : null;
        if (customRate !== null && customRate !== undefined) {
          advertiserFeeMinor = Math.round(grossSaleMinor * customRate);
        }
        // خط‌مشی مشترک سفارشات طلای ادورتایزر (Shared policy across all gold advertiser orders)
        const goldPolicy = await getFeePolicy({
          platform: 'advertiser',
          feeType: 'g4x_fee',
          listingCategory: 'currency',
        });
        if (
          !goldPolicy ||
          goldPolicy.percentageRate === null ||
          goldPolicy.percentageRate === undefined ||
          !goldPolicy.isApproved
        ) {
          snapshotNotes =
            'MISSING_SHARED_GOLD_FEE_RATE: Shared advertiser Gold G4X fee policy has not been configured by management. Calculation is provisional.';
          g4xFeeMinor = 0;
        } else {
          const goldRate = goldPolicy.percentageRate;
          g4xFeeMinor = Math.round(grossSaleMinor * goldRate);
        }
      } else if (activeRank) {
        // محاسبه بر اساس سیستم رنک مصوب مالک برای سفارشات بوست مستقیم ادورتایزر
        const calc = calculateRankCommission(grossSaleMinor, activeRank);
        snapAdvertiserRank = activeRank;
        snapRankFeeBps = calc.rankCommissionBasisPoints;
        g4xFeeMinor = calc.g4xFeeMinor;
        advertiserFeeMinor = 0;
        snapRemainingMinor = calc.remainingMinor;
        effectiveG4xFeeRate = calc.rankCommissionBasisPoints / 10000;
        policyVersion = ADVERTISER_RANK_POLICY_VERSION;
      } else if (advertiserId) {
        // بررسی وضعیت انتقال داده‌های قدیمی (Legacy Commission Migration)
        const legacyCustomRate = await getAdvertiserCommissionRate(advertiserId);
        if (legacyCustomRate !== null && legacyCustomRate !== undefined) {
          advertiserFeeMinor = Math.round(grossSaleMinor * legacyCustomRate);
          if (g4xFeeRate !== undefined && g4xFeeRate !== null) {
            g4xFeeMinor = Math.round(grossSaleMinor * g4xFeeRate);
          }
          snapshotNotes =
            'UNRESOLVED_ADVERTISER_RANK_MIGRATION: Advertiser has legacy custom commission rate but no approved advertiser rank mapping. Explicit Admin mapping required before finalization.';
        } else {
          if (!allowProvisional) {
            throw new Error(
              `MISSING_ADVERTISER_COMMISSION_RATE: MISSING_ADVERTISER_RANK: Advertiser '${advertiserId}' has no commercial rank or commission rate configured by management. Finalization blocked.`
            );
          }
          snapshotNotes =
            'MISSING_ADVERTISER_COMMISSION_RATE: Advertiser commercial rank has not been configured by authorized management.';
        }
      }
    }
  } else {
    // direct
    grossSaleMinor = sourceAmountMinor;
    platformSaleCommissionMinor = 0;
    platformOrderNetMinor = sourceAmountMinor;
  }

  // مبنای خالص خارجی: مبلغ خالص پلتفرم منهای هزینه‌های برداشت و تراکنش
  const externalNetBaseMinor =
    platformOrderNetMinor - allocatedWithdrawalFeeMinor - allocatedTransferFeeMinor - otherExternalFeesMinor;

  // محاسبه سهم G4X بر اساس مبنای خارجی خالص
  if (sourcePlatform === 'website' && g4xFeeRate !== undefined && g4xFeeRate !== null) {
    g4xFeeMinor = Math.round(externalNetBaseMinor * g4xFeeRate);
  }

  // استخر بوسترها: باقیمانده خالص پس از کسر تمامی کارمزدهای مصوب
  let boosterPoolMinor: number;
  if (sourcePlatform === 'advertiser') {
    if (snapAdvertiserRank && snapRemainingMinor !== null) {
      boosterPoolMinor = snapRemainingMinor;
    } else {
      boosterPoolMinor = grossSaleMinor! - advertiserFeeMinor - g4xFeeMinor;
    }
  } else {
    boosterPoolMinor = externalNetBaseMinor - g4xFeeMinor;
  }

  if (boosterPoolMinor < 0) {
    boosterPoolMinor = 0;
  }

  // ذخیره یا به‌روزرسانی اسنپ‌شات در دیتابیس
  const snapshot = await prisma.orderFinancialSnapshot.upsert({
    where: { orderId },
    update: {
      sourcePlatform,
      sourceAmountType,
      sourceAmountMinor,
      grossSaleMinor,
      platformSaleCommissionMinor,
      platformOrderNetMinor,
      allocatedWithdrawalFeeMinor,
      allocatedTransferFeeMinor,
      otherExternalFeesMinor,
      externalNetBaseMinor,
      g4xFeeRate: effectiveG4xFeeRate ?? null,
      g4xFeeMinor,
      advertiserFeeMinor,
      boosterPoolMinor,
      currency: currency.toUpperCase(),
      calculationStatus,
      policyVersion,
      listingCategory: listingCategory ?? null,
      notes: snapshotNotes,
      advertiserId: advertiserId ?? existingSnapshot?.advertiserId ?? null,
      advertiserRank: snapAdvertiserRank ?? existingSnapshot?.advertiserRank ?? null,
      rankFeeBasisPoints: snapRankFeeBps ?? existingSnapshot?.rankFeeBasisPoints ?? null,
      remainingAmountMinor: snapRemainingMinor ?? existingSnapshot?.remainingAmountMinor ?? boosterPoolMinor,
      snapshotTimestamp: snapTimestamp ?? existingSnapshot?.snapshotTimestamp ?? new Date(),
    },
    create: {
      orderId,
      sourcePlatform,
      sourceAmountType,
      sourceAmountMinor,
      grossSaleMinor,
      platformSaleCommissionMinor,
      platformOrderNetMinor,
      allocatedWithdrawalFeeMinor,
      allocatedTransferFeeMinor,
      otherExternalFeesMinor,
      externalNetBaseMinor,
      g4xFeeRate: effectiveG4xFeeRate ?? null,
      g4xFeeMinor,
      advertiserFeeMinor,
      boosterPoolMinor,
      currency: currency.toUpperCase(),
      calculationStatus,
      policyVersion,
      listingCategory: listingCategory ?? null,
      notes: snapshotNotes,
      advertiserId: advertiserId ?? null,
      advertiserRank: snapAdvertiserRank ?? null,
      rankFeeBasisPoints: snapRankFeeBps ?? null,
      remainingAmountMinor: snapRemainingMinor ?? boosterPoolMinor,
      snapshotTimestamp: snapTimestamp ?? new Date(),
    },
  });

  return snapshot;
}

// ─── ۳. تسویه دسته برداشت پلتفرم (Platform Withdrawal Batch Reconciliation) ────

export interface OrderBatchContribution {
  orderId: number;
  contributionMinor: number;
}

export interface ReconcileWithdrawalBatchInput {
  platform: 'g2g' | 'skycoach' | 'eldorado';
  orderContributions: OrderBatchContribution[];
  actualBatchFeeMinor?: number; // در صورت ارائه فاکتور واقعی تسویه برون‌سیستمی
  actualTransferFeeMinor?: number; // کارمزد واقعی انتقال شبکه (مثلا $0.30 یا $1.50)
  externalReceiptRef?: string;
  externalReceiptNotes?: string;
  actorId: string;
}

/**
 * ایجاد و تسویه قطعی دسته برداشت پلتفرم و تخصیص تناسبی هزینه‌ها به سفارشات
 */
export async function createAndReconcileWithdrawalBatch(input: ReconcileWithdrawalBatchInput) {
  const {
    platform,
    orderContributions,
    actualBatchFeeMinor: inputBatchFee,
    actualTransferFeeMinor: inputTransferFee,
    externalReceiptRef,
    externalReceiptNotes,
    actorId,
  } = input;

  // ۱. بررسی دسترسی مدیر
  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to reconcile withdrawal batches'}`);
  }

  if (orderContributions.length === 0) {
    throw new Error('EMPTY_BATCH: Withdrawal batch must contain at least one order contribution');
  }

  const totalContributionsMinor = orderContributions.reduce((sum, o) => sum + o.contributionMinor, 0);

  // ۲. بررسی حداقل آستانه مجاز برداشت تجمعی پلتفرم
  const minThreshold = getPlatformWithdrawalThreshold(platform);
  if (totalContributionsMinor < minThreshold) {
    throw new Error(
      `MINIMUM_WITHDRAWAL_THRESHOLD_NOT_MET: Platform '${platform}' requires minimum aggregated withdrawal of ${minThreshold} minor units ($${(minThreshold / 100).toFixed(2)}), but total batch contribution is ${totalContributionsMinor} minor units ($${(totalContributionsMinor / 100).toFixed(2)})`
    );
  }

  // ۳. محاسبه یا تطبیق کارمزد دسته بر اساس خط‌مشی و فاکتور
  let calculatedBatchFee = 0;
  let calculatedTransferFee = 0;

  if (platform === 'skycoach') {
    // طبق تصمیم نهایی مالک: کارمزد ۱۰٪ در سطح سفارش شناسایی شده است.
    // کارمزد دسته صفر منظور می‌شود تا کارمزد ۱۰٪ مجدداً کسر نشود و کارمزد ۵ دلاری نیز کسر نگردد.
    // هزینه انتقال شبکه برون‌سیستمی (BNB $0.30 طبق خط‌مشی مصوب) به عنوان هزینه مجزا در سطح دسته محاسبه می‌شود.
    calculatedBatchFee = 0;
    const skyTransferPolicy = await getFeePolicy({ platform: 'skycoach', feeType: 'transfer_fee' });
    calculatedTransferFee = skyTransferPolicy?.fixedMinor ?? 30;
  } else if (platform === 'g2g') {
    // 3.99% + $0.99 برای دسته
    calculatedBatchFee = Math.round(totalContributionsMinor * 0.0399) + 99;
    calculatedTransferFee = 30; // $0.30 انتقال Toobit/BNB
  } else if (platform === 'eldorado') {
    // حداقل $200 و تخمین انتقال BNB مبلغ $1.50
    calculatedBatchFee = 0;
    calculatedTransferFee = 150; // $1.50
  }

  const actualBatchFeeMinor = inputBatchFee !== undefined ? inputBatchFee : calculatedBatchFee;
  const actualTransferFeeMinor = inputTransferFee !== undefined ? inputTransferFee : calculatedTransferFee;
  const netReceivedMinor = totalContributionsMinor - actualBatchFeeMinor - actualTransferFeeMinor;

  // ۴. تسهیم تناسبی دقیق کارمزد دسته و کارمزد انتقال میان سفارشات
  const batchAllocations = allocateProportionalWithRemainder(
    actualBatchFeeMinor,
    orderContributions.map((o) => ({ id: o.orderId, contributionMinor: o.contributionMinor }))
  );

  const transferAllocations = allocateProportionalWithRemainder(
    actualTransferFeeMinor,
    orderContributions.map((o) => ({ id: o.orderId, contributionMinor: o.contributionMinor }))
  );

  const batchRef = `BATCH_${platform.toUpperCase()}_${Date.now()}`;

  // ۵. ثبت دسته، سهم سفارشات و به‌روزرسانی اسنپ‌شات‌ها در تراکنش دیتابیس
  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.platformWithdrawalBatch.create({
      data: {
        batchRef,
        platform,
        currency: 'USD',
        status: 'reconciled',
        totalContributionsMinor,
        actualBatchFeeMinor,
        actualTransferFeeMinor,
        netReceivedMinor,
        externalReceiptRef: externalReceiptRef ?? null,
        externalReceiptNotes: externalReceiptNotes ?? null,
        withdrawnAt: new Date(),
        reconciledAt: new Date(),
        reconciledBy: actorId,
      },
    });

    const createdAllocations = [];

    for (const contrib of orderContributions) {
      const bAlloc = batchAllocations.find((a) => a.id === contrib.orderId)?.allocatedMinor || 0;
      const tAlloc = transferAllocations.find((a) => a.id === contrib.orderId)?.allocatedMinor || 0;
      const netContrib = contrib.contributionMinor - bAlloc - tAlloc;

      const orderAlloc = await tx.orderWithdrawalAllocation.create({
        data: {
          batchId: batch.id,
          orderId: contrib.orderId,
          contributionAmountMinor: contrib.contributionMinor,
          allocatedBatchFeeMinor: bAlloc,
          allocatedTransferFeeMinor: tAlloc,
          netContributionMinor: netContrib,
        },
      });
      createdAllocations.push(orderAlloc);

      // به‌روزرسانی اسنپ‌شات مالی سفارش با مبالغ واقعی تسویه شده
      const existingSnapshot = await tx.orderFinancialSnapshot.findUnique({
        where: { orderId: contrib.orderId },
      });

      if (existingSnapshot) {
        const newExternalNet =
          existingSnapshot.platformOrderNetMinor - bAlloc - tAlloc - existingSnapshot.otherExternalFeesMinor;

        let newG4xFee = existingSnapshot.g4xFeeMinor;
        if (existingSnapshot.g4xFeeRate !== null && existingSnapshot.g4xFeeRate !== undefined) {
          // محاسبه کارمزد G4X دقیقاً بر اساس مانده خالص پس از کسر هزینه‌های خارجی
          newG4xFee = Math.round(newExternalNet * existingSnapshot.g4xFeeRate);
        }

        const newBoosterPool = Math.max(0, newExternalNet - newG4xFee);

        await tx.orderFinancialSnapshot.update({
          where: { orderId: contrib.orderId },
          data: {
            allocatedWithdrawalFeeMinor: bAlloc,
            allocatedTransferFeeMinor: tAlloc,
            externalNetBaseMinor: newExternalNet,
            g4xFeeMinor: newG4xFee,
            boosterPoolMinor: newBoosterPool,
            calculationStatus: 'reconciled',
            notes: [existingSnapshot.notes, `Reconciled with withdrawal batch ${batchRef}`]
              .filter(Boolean)
              .join(' | '),
          },
        });
      }
    }

    // ثبت لاگ ممیزی تسویه
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'PLATFORM_WITHDRAWAL_BATCH_RECONCILED',
        entityType: 'PlatformWithdrawalBatch',
        entityId: String(batch.id),
        newValues: JSON.stringify({
          batchRef,
          totalContributionsMinor,
          actualBatchFeeMinor,
          actualTransferFeeMinor,
          netReceivedMinor,
          orderCount: orderContributions.length,
        }),
      },
    });

    return { batch, allocations: createdAllocations };
  });

  return result;
}

// ─── ۴. نهایی‌سازی مالی و تسهیم استخر بوسترها (Finalize Financials & Payout) ────

export interface FinalizeBoosterAllocationInput {
  orderId: number;
  actorId: string;
  participatingBoosterIds?: string[];
  serviceType?: 'solo' | 'mythic_plus' | 'team';
}

/**
 * نهایی‌سازی اسنپ‌شات مالی سفارش و تسهیم مساوی استخر بوسترها میان اعضای واجد شرایط
 * نکته حیاتی: این تابع هیچ تغییری در مانده قابل برداشت والت اعضا ایجاد نمی‌کند.
 */
export async function finalizeOrderFinancialsAndBoosterAllocation(input: FinalizeBoosterAllocationInput) {
  const { orderId, actorId, participatingBoosterIds: explicitBoosterIds, serviceType } = input;

  // ۱. بررسی دسترسی مدیر
  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to finalize order financials'}`);
  }

  // ۲. بررسی وجود سفارش و وضعیت پرداخت
  const orderForFinalize = await prisma.order.findUnique({
    where: { id: orderId },
  });
  if (!orderForFinalize) {
    throw new Error(`ORDER_NOT_FOUND: Order #${orderId} does not exist`);
  }
  if (orderForFinalize.paymentStatus !== 'verified' && orderForFinalize.paymentStatus !== 'unneeded') {
    throw new Error(
      `ORDER_PAYMENT_NOT_VERIFIED: Order #${orderId} cannot be financially finalized. Payment status is '${orderForFinalize.paymentStatus}'`
    );
  }

  // ۳. واکشی اسنپ‌شات سفارش
  const snapshot = await prisma.orderFinancialSnapshot.findUnique({
    where: { orderId },
  });

  if (!snapshot) {
    throw new Error(`FINANCIAL_SNAPSHOT_NOT_FOUND: No financial snapshot exists for order ${orderId}`);
  }

  // ۳. بررسی موانع نهایی‌سازی (Guardrails)
  if (snapshot.sourcePlatform === 'website') {
    if (snapshot.g4xFeeRate === null || snapshot.g4xFeeRate === undefined) {
      throw new Error(
        'MISSING_ORDER_G4X_FEE_RATE: Website orders require an explicit approved order-specific G4X fee rate to finalize'
      );
    }
  }

  if (snapshot.sourcePlatform === 'eldorado' && snapshot.sourceAmountType === 'gross_sale') {
    if (snapshot.notes?.includes('ELDORADO_FEE_UNKNOWN')) {
      throw new Error(
        'ELDORADO_CATEGORY_RATE_UNDEFINED: Cannot finalize Eldorado order with undefined category commission (N/A cannot be assumed 0%)'
      );
    }
  }

  if (snapshot.sourcePlatform === 'advertiser' && snapshot.currency.toUpperCase() === 'GOLD') {
    const goldPolicy = await getFeePolicy({
      platform: 'advertiser',
      feeType: 'g4x_fee',
      listingCategory: 'currency',
    });
    if (
      !goldPolicy ||
      goldPolicy.percentageRate === null ||
      goldPolicy.percentageRate === undefined ||
      !goldPolicy.isApproved
    ) {
      throw new Error(
        'MISSING_SHARED_GOLD_FEE_RATE: Shared advertiser Gold G4X fee policy has not been configured by management. Finalization blocked.'
      );
    }
  }

  if (snapshot.sourcePlatform === 'advertiser' && snapshot.currency.toUpperCase() !== 'GOLD') {
    if (
      snapshot.notes?.includes('UNRESOLVED_ADVERTISER_RANK_MIGRATION') ||
      snapshot.notes?.includes('MISSING_ADVERTISER_RANK')
    ) {
      throw new Error(
        'UNRESOLVED_ADVERTISER_RANK_MIGRATION: Cannot finalize advertiser order without an approved advertiser rank configured by management'
      );
    }
    if (snapshot.notes?.includes('MISSING_ADVERTISER_COMMISSION_RATE')) {
      throw new Error(
        'MISSING_ADVERTISER_COMMISSION_RATE: Cannot finalize advertiser order without an approved advertiser commission rate'
      );
    }
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });
    const targetAdvId = order?.advertiserId || order?.customerId || order?.creatorId;
    if (targetAdvId) {
      const advRank = snapshot.advertiserRank || (await getAdvertiserRank(targetAdvId));
      if (!advRank) {
        const legacyRate = await getAdvertiserCommissionRate(targetAdvId);
        if (legacyRate !== null && legacyRate !== undefined) {
          throw new Error(
            'UNRESOLVED_ADVERTISER_RANK_MIGRATION: Advertiser has legacy custom commission rate but no approved advertiser rank mapping. Finalization blocked.'
          );
        }
        throw new Error(
          'MISSING_ADVERTISER_COMMISSION_RATE: Advertiser commission rate must be configured per advertiser by authorized management'
        );
      }
    }
  }

  // برای سفارشات پلتفرم‌های خارجی، تسویه دسته برداشت الزامی است مگر آنکه صراحتاً منعطف باشد
  if (
    ['g2g', 'skycoach', 'eldorado'].includes(snapshot.sourcePlatform) &&
    snapshot.calculationStatus === 'provisional'
  ) {
    throw new Error(
      'UNRECONCILED_WITHDRAWAL: External platform fees must be reconciled via a withdrawal batch before finalization'
    );
  }

  // ۴. تعیین بوسترهای واجد شرایط
  let boosterIds: string[] = [];

  if (explicitBoosterIds && explicitBoosterIds.length > 0) {
    boosterIds = Array.from(new Set(explicitBoosterIds));
  } else {
    // استخراج بوسترهای ران‌های تکمیل‌شده
    const completedRuns = await prisma.orderRun.findMany({
      where: { orderId, status: 'completed' },
      include: {
        runAssignments: {
          where: { status: { in: ['completed', 'assigned'] } },
          include: { assignment: true },
        },
      },
    });

    const ids = new Set<string>();
    for (const run of completedRuns) {
      for (const ra of run.runAssignments) {
        if (ra.assignment?.userId) {
          ids.add(ra.assignment.userId);
        }
      }
    }
    boosterIds = Array.from(ids);
  }

  if (boosterIds.length === 0) {
    throw new Error('NO_ELIGIBLE_BOOSTERS: Cannot allocate booster pool with zero eligible participating boosters');
  }

  // ۵. اعتبارسنجی قوانین نوع سرویس
  if (serviceType === 'mythic_plus') {
    if (boosterIds.length !== 4) {
      throw new Error(
        `MYTHIC_PLUS_BOOSTER_COUNT_INVALID: Mythic+ requires exactly 4 eligible participating boosters for equal split (found ${boosterIds.length})`
      );
    }
  } else if (serviceType === 'solo') {
    if (boosterIds.length !== 1) {
      throw new Error(`SOLO_BOOSTER_COUNT_INVALID: Single-player service requires exactly 1 booster (found ${boosterIds.length})`);
    }
  }

  // ۶. تقسیم کاملاً مساوی استخر بوسترها همراه با توزیع دقیق باقیمانده تک‌سنتی
  const allocations = splitPoolEquallyWithRemainder(snapshot.boosterPoolMinor, boosterIds);

  // ۷. ثبت تخصیص‌ها و قطعی‌سازی وضعیت اسنپ‌شات در تراکنش بدون واریز والت
  const result = await prisma.$transaction(async (tx) => {
    // حذف تخصیص‌های احتمالی قبلی برای این سفارش جهت تضمین Idempotency
    await tx.boosterPayoutAllocation.deleteMany({
      where: { orderId },
    });

    const createdAllocations = [];
    for (const alloc of allocations) {
      const record = await tx.boosterPayoutAllocation.create({
        data: {
          orderId,
          boosterId: alloc.boosterId,
          allocatedMinor: alloc.allocatedMinor,
          currency: snapshot.currency,
          payoutRole: boosterIds.length === 1 ? 'solo' : 'team_member',
        },
      });
      createdAllocations.push(record);
    }

    // به‌روزرسانی وضعیت اسنپ‌شات به finalized
    const updatedSnapshot = await tx.orderFinancialSnapshot.update({
      where: { orderId },
      data: {
        calculationStatus: 'finalized',
        finalizedBy: actorId,
        finalizedAt: new Date(),
      },
    });

    // ثبت لاگ ممیزی نهایی‌سازی
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'ORDER_FINANCIALS_FINALIZED',
        entityType: 'OrderFinancialSnapshot',
        entityId: String(orderId),
        newValues: JSON.stringify({
          boosterPoolMinor: snapshot.boosterPoolMinor,
          boosterCount: boosterIds.length,
          allocations,
        }),
      },
    });

    // نکته امنیتی: هیچ افزایش موجودی در والت اعضا ایجاد نمی‌شود (No withdrawable wallet balance credits in Phase 3.3)
    return {
      snapshot: updatedSnapshot,
      allocations: createdAllocations,
    };
  });

  return result;
}
