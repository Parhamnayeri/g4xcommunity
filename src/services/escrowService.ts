/**
 * escrowService.ts — موتور اعتبارسنجی و تسویه ایمن اسکرو (Safe Escrow Release Engine)
 *
 * اصلاحات فاز ۲.۶.۳:
 *  - اصلاح معناشناسی وضعیت لجر: تغییر وضعیت تعهد موفق از 'posted' به 'settled' (نه 'reversed')
 *  - استراتژی دقیق تایم‌استمپ اسکرو: آغاز شمارش ۷۲ ساعت از زمان تایید اتمام سفارش (order.completedAt یا escrowStartAt)
 *  - اعتبارسنجی تطابق ارز و دامنه هولدهای مالی (EscrowHold Currency & Order Consistency)
 *  - عدم ایجاد مانده‌های والت برای ارزهای تسویه برون‌سیستمی نظیر TRY
 *  - تضمین عدم منفی شدن موجودی والت از طریق قید CHECK دیتابیس و اعتبارسنجی در کد
 */

import prisma from '../database/db';
import { Prisma } from '@prisma/client';

/**
 * ارزهای پشتیبانی‌شده در والت داخلی پلتفرم
 * توجه: ارزهایی مانند TRY صرفاً روش تسویه خارجی (External Settlement Target) هستند
 * و نباید به عنوان دارایی نگهداری‌شده در والت داخلی فرض شوند.
 */
export const SUPPORTED_WALLET_CURRENCIES = ['USD', 'GOLD', 'USDT', 'IRT'] as const;
export type SupportedCurrency = typeof SUPPORTED_WALLET_CURRENCIES[number];

export interface WalletCurrencyKeys {
  balanceKey: 'balanceUsd' | 'balanceGold' | 'balanceUsdt' | 'balanceIrt';
  escrowKey: 'escrowUsd' | 'escrowGold' | 'escrowUsdt' | 'escrowIrt';
}

/**
 * دریافت نام فیلدهای متناظر ارز در مدل Wallet
 */
export function getWalletKeys(currency: string): WalletCurrencyKeys | null {
  const upper = currency.toUpperCase();
  if (!SUPPORTED_WALLET_CURRENCIES.includes(upper as SupportedCurrency)) {
    return null;
  }
  const c = upper.toLowerCase();
  const capitalized = c.charAt(0).toUpperCase() + c.slice(1);
  return {
    balanceKey: `balance${capitalized}` as WalletCurrencyKeys['balanceKey'],
    escrowKey: `escrow${capitalized}` as WalletCurrencyKeys['escrowKey'],
  };
}

/**
 * بررسی وضعیت فعال بودن آزادسازی اسکرو بر اساس متغیر محیطی
 */
export function isEscrowReleaseEnabled(): boolean {
  return process.env.ESCROW_RELEASE_ENABLED === 'true';
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  details?: {
    transactionId: number;
    orderId?: number | null;
    userId?: string | null;
    currency?: string;
    amountMinor?: number;
    escrowStartAt?: Date | null;
    blockingDisputeIds?: number[];
    activeHoldIds?: number[];
  };
}

export interface ReleaseExecutionResult {
  success: boolean;
  transactionId: number;
  releaseRef?: string;
  error?: string;
  reasons?: string[];
}

export interface BatchProcessingSummary {
  enabled: boolean;
  totalCandidates: number;
  releasedCount: number;
  blockedCount: number;
  skippedCount: number;
  failedCount: number;
  results: ReleaseExecutionResult[];
}

/**
 * ارزیابی کامل اهلیت یک تراکنش اسکرو بر اساس شروط سخت‌گیرانه فاز ۲.۶.۳
 */
export async function checkEscrowEligibility(
  transactionId: number,
  options?: { now?: Date; txClient?: Prisma.TransactionClient },
): Promise<EligibilityResult> {
  const client = options?.txClient ?? prisma;
  const now = options?.now ?? new Date();
  const reasons: string[] = [];

  const record = await client.ledgerTransaction.findUnique({
    where: { id: transactionId },
    include: {
      escrowHolds: true,
      user: {
        include: {
          wallet: true,
        },
      },
    },
  });

  if (!record) {
    return {
      eligible: false,
      reasons: ['TRANSACTION_NOT_FOUND'],
    };
  }

  const details = {
    transactionId: record.id,
    orderId: record.orderId,
    userId: record.userId,
    currency: record.currency,
    amountMinor: record.amountMinor,
    escrowStartAt: record.escrowStartAt,
    blockingDisputeIds: [] as number[],
    activeHoldIds: [] as number[],
  };

  // شرط ۱: تراکنش باید یک تعهد قفل اسکرو باشد
  if (record.entryType !== 'escrow_lock') {
    reasons.push(`INVALID_ENTRY_TYPE: Expected 'escrow_lock', got '${record.entryType}'`);
  }

  // شرط ۲: موعد سررسید releaseAt باید فرارسیده باشد
  if (!record.releaseAt || record.releaseAt > now) {
    reasons.push(
      `RELEASE_AT_NOT_REACHED: releaseAt is ${record.releaseAt ? record.releaseAt.toISOString() : 'null'}`,
    );
  }

  // شرط ۴: تراکنش نباید قبلاً آزاد، تسویه یا معکوس شده باشد
  if (record.status !== 'posted') {
    reasons.push(`TRANSACTION_NOT_POSTED: Status is '${record.status}'`);
  }

  // شرط ۵ و ۳: بررسی سفارش و زمان شروع واقعی دوره اسکرو (Escrow Start Time Policy)
  let orderData = null;
  if (!record.orderId) {
    reasons.push('MISSING_ORDER_RELATION: Ledger entry has no linked orderId; requires manual review');
  } else {
    orderData = await client.order.findUnique({
      where: { id: record.orderId },
      include: {
        service: {
          include: {
            settings: true,
          },
        },
        runs: {
          include: {
            proofs: true,
          },
        },
        disputes: true,
        escrowHolds: true,
      },
    });

    if (!orderData) {
      reasons.push(`ORDER_NOT_FOUND: Linked order #${record.orderId} does not exist`);
    } else {
      if (orderData.status !== 'completed') {
        reasons.push(`ORDER_NOT_COMPLETED: Order status is '${orderData.status}'`);
      }
      if (orderData.paymentStatus !== 'verified' && orderData.paymentStatus !== 'unneeded') {
        reasons.push(`ORDER_PAYMENT_NOT_VERIFIED: Payment status is '${orderData.paymentStatus}'`);
      }
      if (!orderData.completedAt) {
        reasons.push('ORDER_COMPLETION_UNVERIFIED: completedAt timestamp is missing');
      }

      // شرط ۶: تمام ران‌های سفارش باید به طور کامل خاتمه یافته باشند
      if (orderData.runs && orderData.runs.length > 0) {
        const incompleteRuns = orderData.runs.filter((r) => r.status !== 'completed');
        if (incompleteRuns.length > 0) {
          reasons.push(
            `RUNS_INCOMPLETE: ${incompleteRuns.length} run(s) are not completed (${incompleteRuns.map((r) => `#${r.runNumber}: ${r.status}`).join(', ')})`,
          );
        }

        // شرط ۷: برای هر رانی که نیازمند مدرک است، حداقل یک مدرک تاییدشده (approved) وجود داشته باشد
        const proofRequired = orderData.service?.settings?.proofRequired ?? true;
        if (proofRequired) {
          for (const run of orderData.runs) {
            const hasApprovedProof = run.proofs.some((p) => p.status === 'approved');
            if (!hasApprovedProof) {
              reasons.push(
                `MISSING_APPROVED_PROOF: Run #${run.runNumber} requires proof but has no approved proof`,
              );
            }
          }
        }
      }

      // شرط ۸: عدم وجود مناقشه و شکایت باز یا در حال بررسی روی سفارش
      const blockingDisputeStatuses = ['open', 'under_review', 'waiting_for_evidence'];
      const blockingDisputes = orderData.disputes.filter((d) =>
        blockingDisputeStatuses.includes(d.status),
      );
      if (blockingDisputes.length > 0) {
        details.blockingDisputeIds = blockingDisputes.map((d) => d.id);
        reasons.push(
          `ACTIVE_DISPUTE_EXISTS: Order has ${blockingDisputes.length} active dispute(s) [${details.blockingDisputeIds.join(', ')}]`,
        );
      }

      // شرط ۹: ارزیابی هولدهای مالی (EscrowHold) و انطباق ارز و دامنه
      const activeHoldStatuses = ['active', 'pending'];
      const directHolds = record.escrowHolds.filter((h) => activeHoldStatuses.includes(h.status));
      const orderHolds = orderData.escrowHolds.filter((h) => activeHoldStatuses.includes(h.status));
      const allActiveHolds = [...new Set([...directHolds, ...orderHolds])];

      if (allActiveHolds.length > 0) {
        details.activeHoldIds = allActiveHolds.map((h) => h.id);
        reasons.push(
          `ACTIVE_FINANCIAL_HOLD_EXISTS: ${allActiveHolds.length} active escrow hold(s) apply [${details.activeHoldIds.join(', ')}]`,
        );
      }

      // بررسی تطابق ارز و ساختار هولدها
      for (const hold of allActiveHolds) {
        if (hold.currency.toUpperCase() !== record.currency.toUpperCase()) {
          reasons.push(
            `HOLD_CURRENCY_MISMATCH: Hold #${hold.id} currency (${hold.currency}) does not match obligation currency (${record.currency})`,
          );
        }
        if (hold.orderId && record.orderId && hold.orderId !== record.orderId) {
          reasons.push(
            `HOLD_ORDER_MISMATCH: Hold #${hold.id} order (${hold.orderId}) does not match obligation order (${record.orderId})`,
          );
        }
      }
    }
  }

  // سیاست زمان شروع اسکرو (فاز ۲.۶.۴):
  // دوره ۷۲ ساعته باید الزاماً حداقل ۷۲ ساعت پس از تایید قطعی اتمام سفارش (orderData.completedAt) باشد.
  // اگر فیلد صریح escrowStartAt زودتر از orderData.completedAt باشد، رهایش همچنان باید تا orderData.completedAt + 72h منتظر بماند.
  // در غیاب شواهد تایید اتمام معتبر، سیستم باید fail-closed عمل کند.
  let reliableEscrowStart: Date | null = null;
  if (orderData && orderData.completedAt) {
    if (record.escrowStartAt && record.escrowStartAt > orderData.completedAt) {
      reliableEscrowStart = record.escrowStartAt;
    } else {
      reliableEscrowStart = orderData.completedAt;
    }
  } else if (!orderData && record.escrowStartAt) {
    // برای لجر تست‌های مستقیم فاقد سفارش (که با MISSING_ORDER_RELATION نیز مسدود می‌شوند)
    reliableEscrowStart = record.escrowStartAt;
  }

  if (!reliableEscrowStart) {
    reasons.push(
      'MISSING_RELIABLE_ESCROW_START: Neither reliable escrowStartAt nor order.completedAt is available; blocked for manual review',
    );
  } else {
    details.escrowStartAt = reliableEscrowStart;
    const requiredHours = Number(process.env.ESCROW_RELEASE_HOURS ?? 72);
    const minElapsedMs = requiredHours * 60 * 60 * 1000;
    const elapsedSinceCompletion = now.getTime() - reliableEscrowStart.getTime();

    if (elapsedSinceCompletion < minElapsedMs) {
      reasons.push(
        `MINIMUM_ESCROW_TIME_NOT_ELAPSED: Only ${Math.floor(elapsedSinceCompletion / 3600000)}h elapsed since confirmed completion (required ${requiredHours}h from ${reliableEscrowStart.toISOString()})`,
      );
    }
  }

  // شرط ۱۰: ارزیابی صحت ارز، کاربر، مبلغ و موجودی والت
  if (!record.userId) {
    reasons.push('MISSING_RECIPIENT_USER: Transaction has no recipient userId');
  }

  if (record.amountMinor <= 0) {
    reasons.push(`INVALID_AMOUNT: amountMinor must be > 0 (got ${record.amountMinor})`);
  }

  const walletKeys = getWalletKeys(record.currency);
  if (!walletKeys) {
    reasons.push(
      `UNSUPPORTED_CURRENCY: Currency '${record.currency}' is not supported by platform wallet`,
    );
  } else if (record.userId) {
    const wallet = record.user?.wallet;
    if (!wallet) {
      reasons.push(`MISSING_WALLET: User '${record.userId}' does not have a wallet`);
    } else {
      const escrowBalance = (wallet as any)[walletKeys.escrowKey] ?? 0;
      if (escrowBalance < record.amountMinor) {
        reasons.push(
          `INSUFFICIENT_ESCROW_BALANCE: Wallet escrow is ${escrowBalance}, needed ${record.amountMinor}`,
        );
      }
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    details,
  };
}

/**
 * اجرای اتمیک و امن آزادسازی اسکرو در قالب Prisma Transaction
 *
 * در این فاز:
 *  - وضعیت تراکنش قفل اولیه به 'settled' تغییر می‌یابد (نه 'reversed')
 *  - قفل خوش‌بینانه همزمانی فعال است
 *  - قید CHECK دیتابیس مانع از منفی شدن والت می‌شود
 */
export async function executeEscrowRelease(
  transactionId: number,
  options?: {
    now?: Date;
    actorId?: string | null;
    ignoreDisabledFlag?: boolean;
  },
): Promise<ReleaseExecutionResult> {
  const now = options?.now ?? new Date();

  // در صورتی که تسویه غیرفعال باشد، اجرای واقعی انجام نمی‌شود
  if (!isEscrowReleaseEnabled() && !options?.ignoreDisabledFlag) {
    return {
      success: false,
      transactionId,
      error: 'ESCROW_RELEASE_DISABLED',
      reasons: ['Automatic escrow release is disabled (ESCROW_RELEASE_ENABLED != true)'],
    };
  }

  try {
    const releaseResult = await prisma.$transaction(async (tx) => {
      // ۱. اعتبارسنجی مجدد اهلیت درون تراکنش اتمیک
      const eligibility = await checkEscrowEligibility(transactionId, { now, txClient: tx });
      if (!eligibility.eligible) {
        return {
          success: false,
          transactionId,
          error: 'ELIGIBILITY_CHECK_FAILED',
          reasons: eligibility.reasons,
        };
      }

      // ۲. دریافت تراکنش لجر
      const ledgerTx = await tx.ledgerTransaction.findUnique({
        where: { id: transactionId },
      });

      if (!ledgerTx || ledgerTx.status !== 'posted') {
        throw new Error('CONCURRENT_CONFLICT: Transaction status was modified concurrently');
      }

      const walletKeys = getWalletKeys(ledgerTx.currency)!;

      // ۳. قفل و بروزرسانی وضعیت تراکنش قفل اولیه با وضعیت صحیح حسابداری: 'settled'
      const updateCount = await tx.ledgerTransaction.updateMany({
        where: {
          id: transactionId,
          status: 'posted',
        },
        data: {
          status: 'settled', // تصحیح شد: settled به جای reversed!
        },
      });

      if (updateCount.count === 0) {
        throw new Error('CONCURRENT_CONFLICT: Optimistic lock failed; already processed');
      }

      // ۴. بررسی و کسر از اسکرو والت + افزودن به موجودی قابل برداشت
      const wallet = await tx.wallet.findUnique({
        where: { userId: ledgerTx.userId! },
      });

      if (!wallet || (wallet as any)[walletKeys.escrowKey] < ledgerTx.amountMinor) {
        throw new Error('INSUFFICIENT_ESCROW_BALANCE: Insufficient escrow in wallet at time of settlement');
      }

      // اعمال انتقال با قید CHECK دیتابیس
      await tx.wallet.update({
        where: { userId: ledgerTx.userId! },
        data: {
          [walletKeys.escrowKey]: { decrement: ledgerTx.amountMinor },
          [walletKeys.balanceKey]: { increment: ledgerTx.amountMinor },
        },
      });

      // ۵. ثبت رکورد رهایش اسکرو در دفتر کل با کلید یکتای پایدار (Idempotent Reference)
      const releaseRef = `RELEASE-${ledgerTx.transactionRef}`;
      await tx.ledgerTransaction.create({
        data: {
          transactionRef: releaseRef,
          userId: ledgerTx.userId,
          orderId: ledgerTx.orderId,
          currency: ledgerTx.currency,
          amountMinor: ledgerTx.amountMinor,
          entryType: 'escrow_release',
          status: 'posted',
          createdAt: now,
        },
      });

      // ۶. ثبت لاگ حسابرسی (AuditLog)
      await tx.auditLog.create({
        data: {
          actorId: options?.actorId ?? null,
          action: 'ESCROW_RELEASE_SETTLED',
          entityType: 'LedgerTransaction',
          entityId: String(ledgerTx.id),
          previousValues: JSON.stringify({
            status: 'posted',
            walletEscrow: (wallet as any)[walletKeys.escrowKey],
            walletBalance: (wallet as any)[walletKeys.balanceKey],
          }),
          newValues: JSON.stringify({
            status: 'settled', // تصحیح شد: settled
            walletEscrow: (wallet as any)[walletKeys.escrowKey] - ledgerTx.amountMinor,
            walletBalance: (wallet as any)[walletKeys.balanceKey] + ledgerTx.amountMinor,
            releaseTransactionRef: releaseRef,
          }),
          reason: `Automated escrow release settled for order #${ledgerTx.orderId}`,
          isSuccess: true,
          createdAt: now,
        },
      });

      return {
        success: true,
        transactionId,
        releaseRef,
      };
    });

    return releaseResult;
  } catch (error: any) {
    console.error(`[EscrowService] Release execution failed for tx #${transactionId}:`, error);
    return {
      success: false,
      transactionId,
      error: error.message || 'TRANSACTION_EXECUTION_FAILED',
      reasons: [error.message],
    };
  }
}

/**
 * پردازش دسته‌ای تراکنش‌های سررسیده اسکرو با ایزوله‌سازی خطاها
 */
export async function processAllPendingEscrows(
  batchSize: number = 50,
  options?: { now?: Date; ignoreDisabledFlag?: boolean },
): Promise<BatchProcessingSummary> {
  const now = options?.now ?? new Date();
  const enabled = isEscrowReleaseEnabled() || options?.ignoreDisabledFlag === true;

  // یافتن کاندیداهای بالقوه
  const candidates = await prisma.ledgerTransaction.findMany({
    where: {
      entryType: 'escrow_lock',
      status: 'posted',
      releaseAt: {
        lte: now,
      },
    },
    take: batchSize,
    orderBy: { releaseAt: 'asc' },
  });

  const summary: BatchProcessingSummary = {
    enabled,
    totalCandidates: candidates.length,
    releasedCount: 0,
    blockedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    results: [],
  };

  if (!enabled) {
    console.log(
      `[EscrowService] 🔒 Automatic escrow release is DISABLED (ESCROW_RELEASE_ENABLED != true). Found ${candidates.length} candidate(s), skipped execution.`,
    );
    summary.skippedCount = candidates.length;
    return summary;
  }

  for (const candidate of candidates) {
    try {
      // ارزیابی اهلیت
      const eligibility = await checkEscrowEligibility(candidate.id, { now });
      if (!eligibility.eligible) {
        summary.blockedCount++;
        summary.results.push({
          success: false,
          transactionId: candidate.id,
          error: 'ELIGIBILITY_BLOCKED',
          reasons: eligibility.reasons,
        });
        console.warn(
          `[EscrowService] ⚠️ Transaction #${candidate.id} BLOCKED: ${eligibility.reasons.join('; ')}`,
        );
        continue;
      }

      // تسویه
      const result = await executeEscrowRelease(candidate.id, {
        now,
        ignoreDisabledFlag: options?.ignoreDisabledFlag,
      });

      summary.results.push(result);
      if (result.success) {
        summary.releasedCount++;
        console.log(
          `[EscrowService] ✅ Released escrow #${candidate.id} (${candidate.amountMinor} ${candidate.currency}) -> ${result.releaseRef}`,
        );
      } else {
        summary.failedCount++;
        console.error(
          `[EscrowService] ❌ Failed to release escrow #${candidate.id}: ${result.error}`,
        );
      }
    } catch (err: any) {
      summary.failedCount++;
      summary.results.push({
        success: false,
        transactionId: candidate.id,
        error: err.message,
      });
      console.error(
        `[EscrowService] ❌ Unexpected failure processing candidate #${candidate.id}:`,
        err,
      );
    }
  }

  return summary;
}

/**
 * توابع کمکی برای عملیات امن روی والت با حفاظت در برابر موجودی منفی
 */
export async function safeTransferEscrowToAvailable(
  userId: string,
  currency: string,
  amountMinor: number,
  txClient: Prisma.TransactionClient,
): Promise<void> {
  if (amountMinor <= 0) {
    throw new Error('Transfer amount must be strictly positive');
  }
  const keys = getWalletKeys(currency);
  if (!keys) {
    throw new Error(`Unsupported wallet currency: ${currency}`);
  }

  // بررسی موجودی اسکرو قبل از کسر
  const wallet = await txClient.wallet.findUnique({ where: { userId } });
  if (!wallet || (wallet as any)[keys.escrowKey] < amountMinor) {
    throw new Error('Insufficient escrow balance for transfer');
  }

  await txClient.wallet.update({
    where: { userId },
    data: {
      [keys.escrowKey]: { decrement: amountMinor },
      [keys.balanceKey]: { increment: amountMinor },
    },
  });
}

export async function safeLockAvailableToEscrow(
  userId: string,
  currency: string,
  amountMinor: number,
  txClient: Prisma.TransactionClient,
): Promise<void> {
  if (amountMinor <= 0) {
    throw new Error('Lock amount must be strictly positive');
  }
  const keys = getWalletKeys(currency);
  if (!keys) {
    throw new Error(`Unsupported wallet currency: ${currency}`);
  }

  const wallet = await txClient.wallet.findUnique({ where: { userId } });
  if (!wallet || (wallet as any)[keys.balanceKey] < amountMinor) {
    throw new Error('Insufficient available balance to lock in escrow');
  }

  await txClient.wallet.update({
    where: { userId },
    data: {
      [keys.balanceKey]: { decrement: amountMinor },
      [keys.escrowKey]: { increment: amountMinor },
    },
  });
}
