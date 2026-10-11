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

  if (sourceAmountMinor < 0) {
    throw new Error('INVALID_AMOUNT: Source amount cannot be negative');
  }

  let grossSaleMinor: number | null = null;
  let platformSaleCommissionMinor = 0;
  let platformOrderNetMinor = 0;
  let allocatedWithdrawalFeeMinor = 0;
  let allocatedTransferFeeMinor = 0;
  let otherExternalFeesMinor = 0;
  let g4xFeeMinor = 0;
  let advertiserFeeMinor = 0;
  let calculationStatus = 'provisional';
  let policyVersion: number | null = null;
  let snapshotNotes = notes || null;

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
    // طبق تصحیح قوانین SkyCoach:
    // ۱. مبلغ سفارش تغییر نمی‌کند و ۵٪ + ۵ دلار در ایجاد سفارش کسر نمی‌شود.
    // ۲. مبلغ ۵ دلار هزینه هر سفارش نیست بلکه برای کل دسته است.
    // ۳. مبلغ نمایشی به عنوان سهم مانده پلتفرم ثبت می‌شود.
    grossSaleMinor = sourceAmountMinor;
    platformSaleCommissionMinor = 0;
    platformOrderNetMinor = sourceAmountMinor;
    const policy = await getFeePolicy({ platform: 'skycoach', feeType: 'withdrawal_fee' });
    policyVersion = policy?.version ?? 1;
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

    // دریافت کمیسیون اختصاصی ادورتایزر مصوب ادمین
    const customRate = advertiserId ? await getAdvertiserCommissionRate(advertiserId) : null;
    if (customRate !== null && customRate !== undefined) {
      advertiserFeeMinor = Math.round(grossSaleMinor * customRate);
    }

    if (currency.toUpperCase() === 'GOLD') {
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
        // عدم جایگزینی هرگونه نرخ پیش‌فرض؛ بدون درصد مصوب مدیریت، کارمزد صفر و وضعیت موقت ثبت می‌شود
        snapshotNotes =
          'MISSING_SHARED_GOLD_FEE_RATE: Shared advertiser Gold G4X fee policy has not been configured by management. Calculation is provisional.';
        g4xFeeMinor = 0;
      } else {
        const goldRate = goldPolicy.percentageRate;
        g4xFeeMinor = Math.round(grossSaleMinor * goldRate);
      }
    } else {
      // در سفارشات USD یا USDT ادورتایزر، نرخ طلا اعمال نمی‌شود و تبدیل ساختگی طلا به دلار ممنوع است
      if (g4xFeeRate !== undefined && g4xFeeRate !== null) {
        g4xFeeMinor = Math.round(grossSaleMinor * g4xFeeRate);
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
    boosterPoolMinor = grossSaleMinor! - advertiserFeeMinor - g4xFeeMinor;
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
      g4xFeeRate: g4xFeeRate ?? null,
      g4xFeeMinor,
      advertiserFeeMinor,
      boosterPoolMinor,
      currency: currency.toUpperCase(),
      calculationStatus,
      policyVersion,
      listingCategory: listingCategory ?? null,
      notes: snapshotNotes,
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
      g4xFeeRate: g4xFeeRate ?? null,
      g4xFeeMinor,
      advertiserFeeMinor,
      boosterPoolMinor,
      currency: currency.toUpperCase(),
      calculationStatus,
      policyVersion,
      listingCategory: listingCategory ?? null,
      notes: snapshotNotes,
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
    // 5% + $5.00 یکبار برای کل دسته اعمال می‌شود
    calculatedBatchFee = Math.round(totalContributionsMinor * 0.05) + 500;
    calculatedTransferFee = 30; // $0.30 هزینه انتقال BNB در صورت شمول
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

  // ۲. واکشی اسنپ‌شات سفارش
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
