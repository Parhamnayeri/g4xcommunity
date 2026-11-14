/**
 * platformBalanceService.ts — مدیریت مانده‌حساب‌ها، حساب‌های چندگانه و دفاتر کل پلتفرم‌های خارجی (Phase 3.4)
 *
 * اصول حسابداری:
 *  ۱. تفکیک قطعی حساب‌های پلتفرم (G2G, SkyCoach, Eldorado) و عدم ادغام موجودی‌ها یا ارزها بدون مجوز
 *  ۲. تفکیک دقیق وضعیت‌های مالی:
 *      - salesCreditedMinor: کل عواید فروش ثبت‌شده در پلتفرم
 *      - pendingReleaseMinor: وجوه در حال انتظار آزادسازی پلتفرم (دوره تسویه/امانی خارجی)
 *      - eligibleBalanceMinor: وجوه قطعی و آماده برداشت
 *      - reservedBatchMinor: وجوه رزروشده برای یک دسته برداشت جاری/فعال
 *      - withdrawnTotalMinor: وجوهی که از پلتفرم خارج شده است
 *      - receivedTotalMinor: وجوهی که واقعاً توسط G4X دریافت شده است
 *  ۳. محاسبات صرفاً بر اساس اعداد صحیح (Minor Units / Cents) - اکیداً بدون اعشار ممیز شناور (No Floating Point)
 *  ۴. مدیریت حداقل آستانه‌های برداشت:
 *      - G2G: $10.00 (1000 minor)
 *      - SkyCoach: $50.00 (5000 minor)
 *      - Eldorado: $200.00 (20000 minor)
 *  ۵. تعدیلات دستی با ثبت دقیق مستندات و لاگ ممیزی
 */

import prisma from '../database/db';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';
import { getPlatformWithdrawalThreshold } from './financialPolicyService';
import { Prisma } from '@prisma/client';

export type ExternalPlatform = 'g2g' | 'skycoach' | 'eldorado' | 'kingboost' | 'overgear';

export interface CreatePlatformAccountInput {
  accountRef: string;
  platform: ExternalPlatform;
  displayName: string;
  currency?: string;
  notes?: string;
  actorId: string;
}

export interface PlatformBalanceSummary {
  accountId: number;
  accountRef: string;
  platform: string;
  displayName: string;
  currency: string;
  salesCreditedMinor: number;
  pendingReleaseMinor: number;
  eligibleBalanceMinor: number;
  reservedBatchMinor: number;
  withdrawnTotalMinor: number;
  receivedTotalMinor: number;
  minWithdrawalThresholdMinor: number;
  isEligibleForWithdrawal: boolean;
  isActive: boolean;
}

export interface ManualAdjustmentInput {
  accountRef: string;
  adjustmentType: 'credit_eligible' | 'debit_eligible' | 'hold_pending' | 'release_pending' | 'external_fee_charge';
  amountMinor: number;
  reason: string;
  actorId: string;
  externalTxRef?: string;
}

/**
 * دریافت یا ایجاد حساب پیش‌فرض پلتفرم خارجی
 */
export async function getOrCreatePlatformAccount(
  accountRef: string,
  platform: ExternalPlatform,
  displayName?: string,
  currency = 'USD',
  tx: Prisma.TransactionClient | typeof prisma = prisma
) {
  const existing = await tx.platformAccount.findUnique({
    where: { accountRef: accountRef.toLowerCase() },
  });

  if (existing) {
    if (existing.platform.toLowerCase() !== platform.toLowerCase()) {
      throw new Error(
        `PLATFORM_MISMATCH: Account '${accountRef}' is registered under platform '${existing.platform}', cannot use as '${platform}'`
      );
    }
    if (existing.currency.toUpperCase() !== currency.toUpperCase()) {
      throw new Error(
        `CURRENCY_MISMATCH: Account '${accountRef}' uses currency '${existing.currency}', requested '${currency}'`
      );
    }
    return existing;
  }

  const created = await tx.platformAccount.create({
    data: {
      accountRef: accountRef.toLowerCase(),
      platform: platform.toLowerCase(),
      displayName: displayName || `${platform.toUpperCase()} (${accountRef})`,
      currency: currency.toUpperCase(),
    },
  });

  return created;
}

/**
 * ایجاد یک حساب فروشنده جدید در یک پلتفرم با کنترل دسترسی
 */
export async function createPlatformAccount(input: CreatePlatformAccountInput) {
  const { accountRef, platform, displayName, currency = 'USD', notes, actorId } = input;

  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to create platform accounts'}`);
  }

  const existing = await prisma.platformAccount.findUnique({
    where: { accountRef: accountRef.toLowerCase() },
  });

  if (existing) {
    throw new Error(`ACCOUNT_ALREADY_EXISTS: Platform account '${accountRef}' is already registered`);
  }

  const account = await prisma.platformAccount.create({
    data: {
      accountRef: accountRef.toLowerCase(),
      platform: platform.toLowerCase(),
      displayName,
      currency: currency.toUpperCase(),
      notes,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'PLATFORM_ACCOUNT_CREATED',
      entityType: 'PlatformAccount',
      entityId: String(account.id),
      newValues: JSON.stringify(account),
      reason: `Created external platform seller account: ${displayName}`,
    },
  });

  return account;
}

/**
 * دریافت خلاصه مانده‌های کلیه حساب‌های پلتفرم
 */
export async function getPlatformAccountsSummary(actorId: string): Promise<PlatformBalanceSummary[]> {
  const auth = await authorize(actorId, Permission.FINANCE_ADMIN_VIEW);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to view platform balances'}`);
  }

  const accounts = await prisma.platformAccount.findMany({
    orderBy: [{ platform: 'asc' }, { accountRef: 'asc' }],
  });

  return accounts.map((acc) => {
    const minThreshold = getPlatformWithdrawalThreshold(acc.platform);
    return {
      accountId: acc.id,
      accountRef: acc.accountRef,
      platform: acc.platform,
      displayName: acc.displayName,
      currency: acc.currency,
      salesCreditedMinor: acc.salesCreditedMinor,
      pendingReleaseMinor: acc.pendingReleaseMinor,
      eligibleBalanceMinor: acc.eligibleBalanceMinor,
      reservedBatchMinor: acc.reservedBatchMinor,
      withdrawnTotalMinor: acc.withdrawnTotalMinor,
      receivedTotalMinor: acc.receivedTotalMinor,
      minWithdrawalThresholdMinor: minThreshold,
      isEligibleForWithdrawal: acc.eligibleBalanceMinor >= minThreshold,
      isActive: acc.isActive,
    };
  });
}

/**
 * بررسی واجد شرایط بودن مانده جهت برداشت (Withdrawal Eligibility Check)
 * محاسبه فقط از مانده قابل برداشت حساب مشخص، با استثنا کردن وجوه معلق، رزروشده و برداشته‌شده
 */
export async function checkPlatformWithdrawalEligibility(
  accountRef: string,
  requestedAmountMinor?: number
): Promise<{
  eligible: boolean;
  eligibleBalanceMinor: number;
  minThresholdMinor: number;
  requestedAmountMinor?: number;
  reason?: string;
  account: any;
}> {
  const account = await prisma.platformAccount.findUnique({
    where: { accountRef: accountRef.toLowerCase() },
  });

  if (!account) {
    throw new Error(`PLATFORM_ACCOUNT_NOT_FOUND: Platform account '${accountRef}' does not exist`);
  }

  if (!account.isActive) {
    return {
      eligible: false,
      eligibleBalanceMinor: account.eligibleBalanceMinor,
      minThresholdMinor: 0,
      reason: 'ACCOUNT_INACTIVE: This platform account is deactivated',
      account,
    };
  }

  const minThresholdMinor = getPlatformWithdrawalThreshold(account.platform);

  // ۱. بررسی حداقل آستانه برداشت پلتفرم
  if (account.eligibleBalanceMinor < minThresholdMinor) {
    return {
      eligible: false,
      eligibleBalanceMinor: account.eligibleBalanceMinor,
      minThresholdMinor,
      reason: `THRESHOLD_NOT_MET: Eligible balance ($${(account.eligibleBalanceMinor / 100).toFixed(2)}) is below the minimum platform withdrawal threshold of $${(minThresholdMinor / 100).toFixed(2)}`,
      account,
    };
  }

  // ۲. در صورت تعیین مبلغ درخواستی مشخص
  if (requestedAmountMinor !== undefined) {
    if (requestedAmountMinor <= 0) {
      return {
        eligible: false,
        eligibleBalanceMinor: account.eligibleBalanceMinor,
        minThresholdMinor,
        requestedAmountMinor,
        reason: 'INVALID_AMOUNT: Requested withdrawal amount must be greater than zero',
        account,
      };
    }
    if (requestedAmountMinor < minThresholdMinor) {
      return {
        eligible: false,
        eligibleBalanceMinor: account.eligibleBalanceMinor,
        minThresholdMinor,
        requestedAmountMinor,
        reason: `AMOUNT_BELOW_THRESHOLD: Requested amount ($${(requestedAmountMinor / 100).toFixed(2)}) is below minimum threshold ($${(minThresholdMinor / 100).toFixed(2)})`,
        account,
      };
    }
    if (requestedAmountMinor > account.eligibleBalanceMinor) {
      return {
        eligible: false,
        eligibleBalanceMinor: account.eligibleBalanceMinor,
        minThresholdMinor,
        requestedAmountMinor,
        reason: `INSUFFICIENT_ELIGIBLE_FUNDS: Requested amount ($${(requestedAmountMinor / 100).toFixed(2)}) exceeds eligible balance ($${(account.eligibleBalanceMinor / 100).toFixed(2)})`,
        account,
      };
    }
  }

  return {
    eligible: true,
    eligibleBalanceMinor: account.eligibleBalanceMinor,
    minThresholdMinor,
    requestedAmountMinor,
    account,
  };
}

/**
 * ثبت عواید فروش ناشی از سفارش در حساب پلتفرم (Order Sales Proceeds Credit)
 * با تفکیک واریز به موجودی در حال انتظار یا موجودی مستقیم قابل برداشت
 */
export async function creditOrderSalesProceeds(
  input: {
    accountRef: string;
    orderId: number;
    orderRef: string;
    amountMinor: number;
    currency?: string;
    isPendingRelease?: boolean;
    actorId?: string;
  },
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const { accountRef, orderId, orderRef, amountMinor, currency = 'USD', isPendingRelease = false, actorId } = input;

  if (amountMinor <= 0) {
    throw new Error('INVALID_AMOUNT: Order proceeds credit amount must be greater than zero');
  }

  const account = await client.platformAccount.findUnique({
    where: { accountRef: accountRef.toLowerCase() },
  });

  if (!account) {
    throw new Error(`PLATFORM_ACCOUNT_NOT_FOUND: Platform account '${accountRef}' does not exist`);
  }

  if (account.currency.toUpperCase() !== currency.toUpperCase()) {
    throw new Error(
      `CURRENCY_MISMATCH: Account currency is ${account.currency}, cannot credit ${currency}`
    );
  }

  // به‌روزرسانی مانده‌های حساب
  const updated = await client.platformAccount.update({
    where: { id: account.id },
    data: {
      salesCreditedMinor: { increment: amountMinor },
      pendingReleaseMinor: isPendingRelease ? { increment: amountMinor } : undefined,
      eligibleBalanceMinor: !isPendingRelease ? { increment: amountMinor } : undefined,
    },
  });

  // ثبت در دفتر کل تراکنش‌های حساب پلتفرم
  const txRef = `PTX_SALE_${orderRef}_${Date.now()}`;
  await client.platformAccountTransaction.create({
    data: {
      transactionRef: txRef,
      accountId: account.id,
      entryType: isPendingRelease ? 'platform_hold' : 'sale_credit',
      amountMinor,
      currency: currency.toUpperCase(),
      orderId,
      orderRef,
      reason: `Sales proceeds for order ${orderRef} (${isPendingRelease ? 'held pending platform release' : 'credited eligible'})`,
      balanceSnapshotMinor: updated.eligibleBalanceMinor,
      createdBy: actorId ?? null,
    },
  });

  return updated;
}

/**
 * آزادسازی وجوه در حال انتظار توسط پلتفرم و انتقال به مانده قابل برداشت
 */
export async function releasePlatformHeldFunds(
  input: {
    accountRef: string;
    amountMinor: number;
    orderId?: number;
    reason?: string;
    actorId: string;
  },
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const { accountRef, amountMinor, orderId, reason, actorId } = input;

  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE, undefined, client);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to release platform funds'}`);
  }

  if (amountMinor <= 0) {
    throw new Error('INVALID_AMOUNT: Release amount must be greater than zero');
  }

  const account = await client.platformAccount.findUnique({
    where: { accountRef: accountRef.toLowerCase() },
  });

  if (!account) {
    throw new Error(`PLATFORM_ACCOUNT_NOT_FOUND: Platform account '${accountRef}' does not exist`);
  }

  if (account.pendingReleaseMinor < amountMinor) {
    throw new Error(
      `INSUFFICIENT_PENDING_FUNDS: Pending release balance (${account.pendingReleaseMinor}) is less than release amount (${amountMinor})`
    );
  }

  const updated = await client.platformAccount.update({
    where: { id: account.id },
    data: {
      pendingReleaseMinor: { decrement: amountMinor },
      eligibleBalanceMinor: { increment: amountMinor },
    },
  });

  const txRef = `PTX_REL_${account.accountRef}_${Date.now()}`;
  await client.platformAccountTransaction.create({
    data: {
      transactionRef: txRef,
      accountId: account.id,
      entryType: 'platform_release',
      amountMinor,
      currency: account.currency,
      orderId: orderId ?? null,
      reason: reason || 'Platform release: held proceeds transferred to eligible withdrawal balance',
      balanceSnapshotMinor: updated.eligibleBalanceMinor,
      createdBy: actorId,
    },
  });

  return updated;
}

/**
 * ثبت تعدیل یا تصحیح دستی مانده‌حساب پلتفرم با ثبت مستند و لاگ ممیزی کامل
 */
export async function recordManualBalanceAdjustment(input: ManualAdjustmentInput) {
  const { accountRef, adjustmentType, amountMinor, reason, actorId, externalTxRef } = input;

  const auth = await authorize(actorId, Permission.FINANCIAL_POLICY_MANAGE);
  if (!auth.allowed) {
    throw new Error(`UNAUTHORIZED_FINANCIAL_ACTION: ${auth.reason || 'Insufficient permissions to perform financial balance adjustments'}`);
  }

  if (!reason || reason.trim().length < 5) {
    throw new Error('AUDIT_REASON_REQUIRED: A detailed audit reason is required for manual platform balance adjustments');
  }

  if (amountMinor <= 0) {
    throw new Error('INVALID_AMOUNT: Adjustment amount must be strictly greater than zero');
  }

  return await prisma.$transaction(async (tx) => {
    const account = await tx.platformAccount.findUnique({
      where: { accountRef: accountRef.toLowerCase() },
    });

    if (!account) {
      throw new Error(`PLATFORM_ACCOUNT_NOT_FOUND: Account '${accountRef}' does not exist`);
    }

    let updateData: Prisma.PlatformAccountUpdateInput = {};

    switch (adjustmentType) {
      case 'credit_eligible':
        updateData = { eligibleBalanceMinor: { increment: amountMinor } };
        break;
      case 'debit_eligible':
        if (account.eligibleBalanceMinor < amountMinor) {
          throw new Error(`INSUFFICIENT_FUNDS: Cannot debit ${amountMinor} from eligible balance of ${account.eligibleBalanceMinor}`);
        }
        updateData = { eligibleBalanceMinor: { decrement: amountMinor } };
        break;
      case 'hold_pending':
        if (account.eligibleBalanceMinor < amountMinor) {
          throw new Error(`INSUFFICIENT_FUNDS: Cannot hold ${amountMinor} from eligible balance of ${account.eligibleBalanceMinor}`);
        }
        updateData = {
          eligibleBalanceMinor: { decrement: amountMinor },
          pendingReleaseMinor: { increment: amountMinor },
        };
        break;
      case 'release_pending':
        if (account.pendingReleaseMinor < amountMinor) {
          throw new Error(`INSUFFICIENT_FUNDS: Cannot release ${amountMinor} from pending balance of ${account.pendingReleaseMinor}`);
        }
        updateData = {
          pendingReleaseMinor: { decrement: amountMinor },
          eligibleBalanceMinor: { increment: amountMinor },
        };
        break;
      case 'external_fee_charge':
        if (account.eligibleBalanceMinor < amountMinor) {
          throw new Error(`INSUFFICIENT_FUNDS: Cannot deduct fee ${amountMinor} from eligible balance of ${account.eligibleBalanceMinor}`);
        }
        updateData = { eligibleBalanceMinor: { decrement: amountMinor } };
        break;
      default:
        throw new Error(`UNKNOWN_ADJUSTMENT_TYPE: ${adjustmentType}`);
    }

    const updatedAccount = await tx.platformAccount.update({
      where: { id: account.id },
      data: updateData,
    });

    const txRef = `PTX_ADJ_${Date.now()}`;
    await tx.platformAccountTransaction.create({
      data: {
        transactionRef: txRef,
        accountId: account.id,
        entryType: 'manual_adjustment',
        amountMinor,
        currency: account.currency,
        externalTxRef: externalTxRef ?? null,
        reason: `[${adjustmentType}] ${reason}`,
        balanceSnapshotMinor: updatedAccount.eligibleBalanceMinor,
        createdBy: actorId,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'PLATFORM_BALANCE_ADJUSTMENT',
        entityType: 'PlatformAccount',
        entityId: String(account.id),
        previousValues: JSON.stringify(account),
        newValues: JSON.stringify(updatedAccount),
        reason: `Manual adjustment [${adjustmentType}]: ${reason}`,
      },
    });

    return updatedAccount;
  });
}
