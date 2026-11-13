/**
 * financeV2WalletService.ts — سرویس مدیریت والت تک‌ارزی سنت دلار (Finance V2 Unified USD Wallet)
 *
 * اصول حسابداری و امنیت:
 *  ۱. تمام موجودی‌ها منحصراً به سنت دلار آمریکا (USD Cents) نگهداری می‌شوند.
 *  ۲. هیچ مانده ارزی موازی برای تتر، تومان، لیر یا طلا وجود ندارد.
 *  ۳. پایستگی کامل دارایی‌ها و جلوگیری از موجودی منفی (Conservation Invariant & No Negative Balances).
 *  ۴. تمام تغییرات مانده‌ها همراه با یک رکورد متناظر در دفتر کل (LedgerEntryV2) ثبت می‌شوند.
 *  ۵. تضمین بازگشت کامل تراکنش در صورت بروز خطا (Atomic Database Transactions).
 */

import prisma from '../../database/db';
import { Prisma } from '@prisma/client';
import {
  LedgerV2EntryType,
  LedgerV2Direction,
  LedgerV2AccountType,
  BalancedJournalPosting,
  BalancedJournalPostingResult,
  BalancedJournalLeg,
  FINANCE_V2_FEATURE_GATES,
} from './financeV2Types';

export interface WalletV2Summary {
  userId: string;
  availableCents: number;
  reservedCents: number;
  pendingEarningsCents: number;
  confirmedEarningsCents: number;
  paidCents: number;
  refundedCents: number;
  totalHeldCents: number; // available + reserved
  lifetimeEarnedCents: number; // confirmedEarnings + paid
  customCommissionRate: number | null;
  updatedAt: Date;
}

export interface LedgerEntryOptions {
  entryRef?: string;
  orderId?: number;
  fundingRequestId?: number;
  withdrawalRequestId?: number;
  description?: string;
  metadata?: Record<string, any>;
  createdBy?: string;
  postingGroupId?: string;
  accountType?: LedgerV2AccountType;
  reversalOfEntryRef?: string;
  idempotencyKey?: string;
  isSimulated?: boolean;
}

/**
 * بررسی سوئیچ‌های ایمنی پروداکشن (Fail-Closed Production Feature Gates)
 */
export function assertLiveCreditsEnabled(): void {
  if (process.env.FINANCE_V2_LIVE_CREDITS_ENABLED !== 'true') {
    throw new Error(
      'LIVE_CREDITS_DISABLED: Real money credits to live wallets are strictly disabled in this phase (FINANCE_V2_LIVE_CREDITS_ENABLED != true)'
    );
  }
}

export function assertLivePayoutsEnabled(): void {
  if (process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED !== 'true') {
    throw new Error(
      'LIVE_PAYOUTS_DISABLED: Real money payout settlements from user wallets are strictly disabled in this phase (FINANCE_V2_LIVE_PAYOUTS_ENABLED != true)'
    );
  }
}

export function assertEscrowReleaseEnabled(): void {
  if (process.env.ESCROW_RELEASE_ENABLED !== 'true') {
    throw new Error(
      'ESCROW_RELEASE_DISABLED: Real payout and escrow release to withdrawable wallet balance is strictly disabled in this phase (ESCROW_RELEASE_ENABLED != true)'
    );
  }
}

export function assertP2pSettlementEnabled(): void {
  if (process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED !== 'true') {
    throw new Error(
      'P2P_SETTLEMENT_DISABLED: P2P wallet transfers and settlements are strictly disabled in this phase (FINANCE_V2_P2P_SETTLEMENT_ENABLED != true)'
    );
  }
}

/**
 * ثبت سند دفتر کل متعادل دوطرفه (Balanced Double-Entry Journal Posting)
 * ناوردا: مجموع اقلام بدهکار (Debits) باید دقیقاً با مجموع اقلام بستانکار (Credits) برابر باشد.
 */
export async function recordBalancedJournalPosting(
  posting: BalancedJournalPosting,
  tx?: Prisma.TransactionClient
): Promise<BalancedJournalPostingResult> {
  if (!posting.legs || posting.legs.length < 2) {
    throw new Error('INVALID_JOURNAL_POSTING: A balanced journal posting must contain at least 2 legs');
  }

  let totalDebits = 0;
  let totalCredits = 0;

  for (const leg of posting.legs) {
    if (!Number.isSafeInteger(leg.amountCents) || leg.amountCents <= 0) {
      throw new Error(`INVALID_JOURNAL_AMOUNT: Leg amount must be a positive safe integer, got ${leg.amountCents}`);
    }
    if (leg.direction === LedgerV2Direction.DEBIT) {
      totalDebits += leg.amountCents;
    } else if (leg.direction === LedgerV2Direction.CREDIT) {
      totalCredits += leg.amountCents;
    } else {
      throw new Error(`INVALID_DIRECTION: Direction must be CREDIT or DEBIT`);
    }
  }

  if (totalDebits !== totalCredits) {
    throw new Error(
      `UNBALANCED_JOURNAL_POSTING: Sum of debits (${totalDebits} cents) does not match sum of credits (${totalCredits} cents) for posting group '${posting.postingGroupId}'`
    );
  }

  const runWithTx = async (dbTx: Prisma.TransactionClient) => {
    const createdEntries = [];
    for (const leg of posting.legs) {
      const entryRef = leg.entryRef || `LEDGER_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      // در صورت وجود idempotencyKey، از ثبت تکراری جلوگیری می‌شود
      if (leg.idempotencyKey) {
        const existing = await dbTx.ledgerEntryV2.findUnique({
          where: { idempotencyKey: leg.idempotencyKey },
        });
        if (existing) {
          throw new Error(`DUPLICATE_IDEMPOTENCY_KEY: Ledger entry with idempotency key '${leg.idempotencyKey}' already exists`);
        }
      }

      const entry = await dbTx.ledgerEntryV2.create({
        data: {
          entryRef,
          postingGroupId: posting.postingGroupId,
          accountType: leg.accountType || LedgerV2AccountType.USER_WALLET,
          userId: leg.userId || null,
          orderId: leg.orderId || null,
          fundingRequestId: leg.fundingRequestId || null,
          withdrawalRequestId: leg.withdrawalRequestId || null,
          goldTradeId: leg.goldTradeId || null,
          amountCents: leg.amountCents,
          entryType: leg.entryType,
          direction: leg.direction,
          reversalOfEntryRef: leg.reversalOfEntryRef || null,
          idempotencyKey: leg.idempotencyKey || null,
          description: leg.description || `Journal leg for group ${posting.postingGroupId}`,
          metadata: leg.metadata ? JSON.stringify(leg.metadata) : null,
          createdBy: leg.createdBy || null,
        },
      });
      createdEntries.push(entry);
    }

    return {
      postingGroupId: posting.postingGroupId,
      balanced: true,
      totalDebitsCents: totalDebits,
      totalCreditsCents: totalCredits,
      entries: createdEntries,
    };
  };

  if (tx) {
    return await runWithTx(tx);
  }
  return await prisma.$transaction(runWithTx);
}

/**
 * اعتبارسنجی ناوردای سلامت مالی والت (Financial Invariants Assertion)
 */
export function assertWalletInvariants(wallet: {
  availableCents: number;
  reservedCents: number;
  pendingEarningsCents: number;
  confirmedEarningsCents: number;
  paidCents: number;
  refundedCents: number;
}) {
  if (wallet.availableCents < 0) {
    throw new Error(`INVARIANT_VIOLATION: Available balance cannot be negative (${wallet.availableCents})`);
  }
  if (wallet.reservedCents < 0) {
    throw new Error(`INVARIANT_VIOLATION: Reserved balance cannot be negative (${wallet.reservedCents})`);
  }
  if (wallet.pendingEarningsCents < 0) {
    throw new Error(`INVARIANT_VIOLATION: Pending earnings cannot be negative (${wallet.pendingEarningsCents})`);
  }
  if (wallet.confirmedEarningsCents < 0) {
    throw new Error(`INVARIANT_VIOLATION: Confirmed earnings cannot be negative (${wallet.confirmedEarningsCents})`);
  }
  if (wallet.paidCents < 0) {
    throw new Error(`INVARIANT_VIOLATION: Paid balance cannot be negative (${wallet.paidCents})`);
  }
  if (wallet.refundedCents < 0) {
    throw new Error(`INVARIANT_VIOLATION: Refunded balance cannot be negative (${wallet.refundedCents})`);
  }
}

/**
 * واکشی یا مقداردهی اولیه والت تک‌ارزی دلار برای کاربر
 */
export async function getOrCreateWalletV2(
  userId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma
) {
  const existing = await tx.walletV2.findUnique({
    where: { userId },
  });

  if (existing) {
    return existing;
  }

  // اطمینان از وجود کاربر در جدول کاربران قبل از اتصال والت
  const user = await tx.user.findUnique({
    where: { discordId: userId },
  });

  if (!user) {
    throw new Error(`USER_NOT_FOUND: User '${userId}' does not exist, cannot create WalletV2`);
  }

  return await tx.walletV2.create({
    data: {
      userId,
      availableCents: 0,
      reservedCents: 0,
      pendingEarningsCents: 0,
      confirmedEarningsCents: 0,
      paidCents: 0,
      refundedCents: 0,
      customCommissionRate: null,
    },
  });
}

/**
 * دریافت خلاصه تفکیک‌شده و حسابرسی‌شده وضعیت والت
 */
export async function getWalletV2Summary(userId: string): Promise<WalletV2Summary> {
  const wallet = await getOrCreateWalletV2(userId);
  assertWalletInvariants(wallet);

  return {
    userId: wallet.userId,
    availableCents: wallet.availableCents,
    reservedCents: wallet.reservedCents,
    pendingEarningsCents: wallet.pendingEarningsCents,
    confirmedEarningsCents: wallet.confirmedEarningsCents,
    paidCents: wallet.paidCents,
    refundedCents: wallet.refundedCents,
    totalHeldCents: wallet.availableCents + wallet.reservedCents,
    lifetimeEarnedCents: wallet.confirmedEarningsCents + wallet.paidCents,
    customCommissionRate: wallet.customCommissionRate,
    updatedAt: wallet.updatedAt,
  };
}

/**
 * واریز به موجودی در دسترس (Available USD Cents Credit)
 * موارد مصرف: واریز تاییدشده ادورتایزر، آزادسازی درآمد، تعدیل دستی مثبت
 */
export async function creditAvailableCents(
  userId: string,
  amountCents: number,
  entryType: LedgerV2EntryType,
  options: LedgerEntryOptions = {},
  externalTx?: Prisma.TransactionClient
) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`INVALID_AMOUNT: Credit amount must be a positive safe integer, got ${amountCents}`);
  }

  const runWithTx = async (tx: Prisma.TransactionClient) => {
    const wallet = await getOrCreateWalletV2(userId, tx);

    const newAvailable = wallet.availableCents + amountCents;
    const updatedWallet = await tx.walletV2.update({
      where: { userId },
      data: {
        availableCents: newAvailable,
      },
    });

    assertWalletInvariants(updatedWallet);

    const entryRef = options.entryRef || `LEDGER_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    if (options.idempotencyKey) {
      const existing = await tx.ledgerEntryV2.findUnique({
        where: { idempotencyKey: options.idempotencyKey },
      });
      if (existing) {
        throw new Error(`DUPLICATE_IDEMPOTENCY_KEY: Ledger entry with idempotency key '${options.idempotencyKey}' already exists`);
      }
    }

    const ledgerEntry = await tx.ledgerEntryV2.create({
      data: {
        entryRef,
        postingGroupId: options.postingGroupId || null,
        accountType: options.accountType || LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
        userId,
        orderId: options.orderId,
        fundingRequestId: options.fundingRequestId,
        withdrawalRequestId: options.withdrawalRequestId,
        amountCents,
        entryType,
        direction: LedgerV2Direction.CREDIT,
        balanceAfterAvailableCents: newAvailable,
        balanceAfterReservedCents: updatedWallet.reservedCents,
        reversalOfEntryRef: options.reversalOfEntryRef || null,
        idempotencyKey: options.idempotencyKey || null,
        description: options.description || `Credit ${amountCents} cents to available balance`,
        metadata: options.metadata ? JSON.stringify(options.metadata) : null,
        createdBy: options.createdBy,
      },
    });

    return { wallet: updatedWallet, ledgerEntry };
  };

  if (externalTx) {
    return await runWithTx(externalTx);
  }
  return await prisma.$transaction(runWithTx);
}

/**
 * رزرو موجودی از موجودی در دسترس جهت تسویه یا برداشت (Reserve Available Cents)
 * قید سخت‌گیرانه: موجودی در دسترس نباید منفی شود.
 */
export async function reserveAvailableCents(
  userId: string,
  amountCents: number,
  entryType: LedgerV2EntryType = LedgerV2EntryType.WITHDRAWAL_RESERVE,
  options: LedgerEntryOptions = {},
  externalTx?: Prisma.TransactionClient
) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`INVALID_AMOUNT: Reservation amount must be a positive safe integer, got ${amountCents}`);
  }

  const runWithTx = async (tx: Prisma.TransactionClient) => {
    const wallet = await getOrCreateWalletV2(userId, tx);

    if (wallet.availableCents < amountCents) {
      throw new Error(
        `INSUFFICIENT_AVAILABLE_FUNDS: Available balance ($${(wallet.availableCents / 100).toFixed(2)}) is less than requested reservation ($${(amountCents / 100).toFixed(2)})`
      );
    }

    const newAvailable = wallet.availableCents - amountCents;
    const newReserved = wallet.reservedCents + amountCents;

    const updatedWallet = await tx.walletV2.update({
      where: { userId },
      data: {
        availableCents: newAvailable,
        reservedCents: newReserved,
      },
    });

    assertWalletInvariants(updatedWallet);

    const entryRef = options.entryRef || `LEDGER_RES_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    if (options.idempotencyKey) {
      const existing = await tx.ledgerEntryV2.findUnique({
        where: { idempotencyKey: options.idempotencyKey },
      });
      if (existing) {
        throw new Error(`DUPLICATE_IDEMPOTENCY_KEY: Ledger entry with idempotency key '${options.idempotencyKey}' already exists`);
      }
    }

    const ledgerEntry = await tx.ledgerEntryV2.create({
      data: {
        entryRef,
        postingGroupId: options.postingGroupId || null,
        accountType: options.accountType || LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
        userId,
        orderId: options.orderId,
        withdrawalRequestId: options.withdrawalRequestId,
        amountCents,
        entryType,
        direction: LedgerV2Direction.DEBIT,
        balanceAfterAvailableCents: newAvailable,
        balanceAfterReservedCents: newReserved,
        reversalOfEntryRef: options.reversalOfEntryRef || null,
        idempotencyKey: options.idempotencyKey || null,
        description: options.description || `Reserved ${amountCents} cents for withdrawal`,
        metadata: options.metadata ? JSON.stringify(options.metadata) : null,
        createdBy: options.createdBy,
      },
    });

    return { wallet: updatedWallet, ledgerEntry };
  };

  if (externalTx) {
    return await runWithTx(externalTx);
  }
  return await prisma.$transaction(runWithTx);
}

/**
 * قطعی‌سازی تسویه وجوه رزروشده به وضعیت پرداخت‌شده (Settle Reserved to Paid)
 * پس از تایید قطعی انتقال برون‌بانکی/بلاکچین توسط ادمین
 */
export async function settleReservedCents(
  userId: string,
  amountCents: number,
  options: LedgerEntryOptions = {},
  externalTx?: Prisma.TransactionClient
) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`INVALID_AMOUNT: Settlement amount must be a positive safe integer, got ${amountCents}`);
  }

  const runWithTx = async (tx: Prisma.TransactionClient) => {
    const wallet = await getOrCreateWalletV2(userId, tx);

    if (wallet.reservedCents < amountCents) {
      throw new Error(
        `INSUFFICIENT_RESERVED_FUNDS: Reserved balance ($${(wallet.reservedCents / 100).toFixed(2)}) is less than settlement amount ($${(amountCents / 100).toFixed(2)})`
      );
    }

    const newReserved = wallet.reservedCents - amountCents;
    const newPaid = wallet.paidCents + amountCents;

    const updatedWallet = await tx.walletV2.update({
      where: { userId },
      data: {
        reservedCents: newReserved,
        paidCents: newPaid,
      },
    });

    assertWalletInvariants(updatedWallet);

    const entryRef = options.entryRef || `LEDGER_SETTLE_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    if (options.idempotencyKey) {
      const existing = await tx.ledgerEntryV2.findUnique({
        where: { idempotencyKey: options.idempotencyKey },
      });
      if (existing) {
        throw new Error(`DUPLICATE_IDEMPOTENCY_KEY: Ledger entry with idempotency key '${options.idempotencyKey}' already exists`);
      }
    }

    const ledgerEntry = await tx.ledgerEntryV2.create({
      data: {
        entryRef,
        postingGroupId: options.postingGroupId || null,
        accountType: options.accountType || LedgerV2AccountType.LIABILITY_USER_WALLET_RESERVED,
        userId,
        withdrawalRequestId: options.withdrawalRequestId,
        amountCents,
        entryType: LedgerV2EntryType.WITHDRAWAL_SETTLE,
        direction: LedgerV2Direction.DEBIT,
        balanceAfterAvailableCents: updatedWallet.availableCents,
        balanceAfterReservedCents: newReserved,
        reversalOfEntryRef: options.reversalOfEntryRef || null,
        idempotencyKey: options.idempotencyKey || null,
        description: options.description || `Settled ${amountCents} cents withdrawal payout`,
        metadata: options.metadata ? JSON.stringify(options.metadata) : null,
        createdBy: options.createdBy,
      },
    });

    return { wallet: updatedWallet, ledgerEntry };
  };

  if (externalTx) {
    return await runWithTx(externalTx);
  }
  return await prisma.$transaction(runWithTx);
}

/**
 * آزادسازی و استرداد وجوه رزروشده به موجودی در دسترس در صورت رد یا لغو برداشت (Reverse Reserved)
 */
export async function reverseReservedCents(
  userId: string,
  amountCents: number,
  reason: string,
  options: LedgerEntryOptions = {},
  externalTx?: Prisma.TransactionClient
) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`INVALID_AMOUNT: Reversal amount must be a positive safe integer, got ${amountCents}`);
  }

  const runWithTx = async (tx: Prisma.TransactionClient) => {
    const wallet = await getOrCreateWalletV2(userId, tx);

    if (wallet.reservedCents < amountCents) {
      throw new Error(
        `INSUFFICIENT_RESERVED_FUNDS: Reserved balance ($${(wallet.reservedCents / 100).toFixed(2)}) is less than reversal amount ($${(amountCents / 100).toFixed(2)})`
      );
    }

    const newReserved = wallet.reservedCents - amountCents;
    const newAvailable = wallet.availableCents + amountCents;

    const updatedWallet = await tx.walletV2.update({
      where: { userId },
      data: {
        reservedCents: newReserved,
        availableCents: newAvailable,
      },
    });

    assertWalletInvariants(updatedWallet);

    const entryRef = options.entryRef || `LEDGER_REV_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    if (options.idempotencyKey) {
      const existing = await tx.ledgerEntryV2.findUnique({
        where: { idempotencyKey: options.idempotencyKey },
      });
      if (existing) {
        throw new Error(`DUPLICATE_IDEMPOTENCY_KEY: Ledger entry with idempotency key '${options.idempotencyKey}' already exists`);
      }
    }

    const ledgerEntry = await tx.ledgerEntryV2.create({
      data: {
        entryRef,
        postingGroupId: options.postingGroupId || null,
        accountType: options.accountType || LedgerV2AccountType.LIABILITY_USER_WALLET_RESERVED,
        userId,
        withdrawalRequestId: options.withdrawalRequestId,
        amountCents,
        entryType: LedgerV2EntryType.WITHDRAWAL_REVERSE,
        direction: LedgerV2Direction.CREDIT,
        balanceAfterAvailableCents: newAvailable,
        balanceAfterReservedCents: newReserved,
        reversalOfEntryRef: options.reversalOfEntryRef || null,
        idempotencyKey: options.idempotencyKey || null,
        description: options.description || `Reversed ${amountCents} cents to available balance: ${reason}`,
        metadata: options.metadata ? JSON.stringify(options.metadata) : null,
        createdBy: options.createdBy,
      },
    });

    return { wallet: updatedWallet, ledgerEntry };
  };

  if (externalTx) {
    return await runWithTx(externalTx);
  }
  return await prisma.$transaction(runWithTx);
}

/**
 * ثبت عواید در حال انتظار (Pending Earnings) به ازای ران یا سفارش انجام‌شده
 */
export async function recordPendingEarnings(
  userId: string,
  amountCents: number,
  options: LedgerEntryOptions = {},
  externalTx?: Prisma.TransactionClient
) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`INVALID_AMOUNT: Pending earnings must be a positive safe integer, got ${amountCents}`);
  }

  const runWithTx = async (tx: Prisma.TransactionClient) => {
    if (options.idempotencyKey) {
      const existing = await tx.ledgerEntryV2.findUnique({
        where: { idempotencyKey: options.idempotencyKey },
      });
      if (existing) {
        const wallet = await getOrCreateWalletV2(userId, tx);
        return { wallet, ledgerEntry: existing };
      }
    }

    const wallet = await getOrCreateWalletV2(userId, tx);

    const newPending = wallet.pendingEarningsCents + amountCents;
    const updatedWallet = await tx.walletV2.update({
      where: { userId },
      data: {
        pendingEarningsCents: newPending,
      },
    });

    assertWalletInvariants(updatedWallet);

    const entryRef = options.entryRef || `LEDGER_PEND_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const ledgerEntry = await tx.ledgerEntryV2.create({
      data: {
        entryRef,
        postingGroupId: options.postingGroupId || null,
        accountType: options.accountType || LedgerV2AccountType.LIABILITY_USER_WALLET_PENDING,
        userId,
        orderId: options.orderId,
        amountCents,
        entryType: LedgerV2EntryType.EARNING_PENDING,
        direction: LedgerV2Direction.CREDIT,
        balanceAfterAvailableCents: wallet.availableCents,
        balanceAfterReservedCents: wallet.reservedCents,
        reversalOfEntryRef: options.reversalOfEntryRef || null,
        idempotencyKey: options.idempotencyKey || null,
        description: options.description || `Recorded pending earnings: ${amountCents} cents`,
        metadata: options.metadata ? JSON.stringify(options.metadata) : null,
        createdBy: options.createdBy,
      },
    });

    return { wallet: updatedWallet, ledgerEntry };
  };

  if (externalTx) {
    return await runWithTx(externalTx);
  }
  return await prisma.$transaction(runWithTx);
}

/**
 * تایید عواید پس از بررسی مدارک و تایید مدیریت (Transition Pending to Confirmed)
 */
export async function confirmPendingEarnings(
  userId: string,
  amountCents: number,
  options: LedgerEntryOptions = {},
  externalTx?: Prisma.TransactionClient
) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`INVALID_AMOUNT: Confirmation amount must be a positive safe integer, got ${amountCents}`);
  }

  const runWithTx = async (tx: Prisma.TransactionClient) => {
    if (options.idempotencyKey) {
      const existing = await tx.ledgerEntryV2.findUnique({
        where: { idempotencyKey: options.idempotencyKey },
      });
      if (existing) {
        const wallet = await getOrCreateWalletV2(userId, tx);
        return { wallet, ledgerEntry: existing };
      }
    }

    const wallet = await getOrCreateWalletV2(userId, tx);

    if (wallet.pendingEarningsCents < amountCents) {
      throw new Error(
        `INSUFFICIENT_PENDING_EARNINGS: Pending earnings ($${(wallet.pendingEarningsCents / 100).toFixed(2)}) is less than confirmation amount ($${(amountCents / 100).toFixed(2)})`
      );
    }

    const newPending = wallet.pendingEarningsCents - amountCents;
    const newConfirmed = wallet.confirmedEarningsCents + amountCents;

    const updatedWallet = await tx.walletV2.update({
      where: { userId },
      data: {
        pendingEarningsCents: newPending,
        confirmedEarningsCents: newConfirmed,
      },
    });

    assertWalletInvariants(updatedWallet);

    const entryRef = options.entryRef || `LEDGER_CONF_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const ledgerEntry = await tx.ledgerEntryV2.create({
      data: {
        entryRef,
        postingGroupId: options.postingGroupId || null,
        accountType: options.accountType || LedgerV2AccountType.LIABILITY_USER_WALLET_CONFIRMED,
        userId,
        orderId: options.orderId,
        amountCents,
        entryType: LedgerV2EntryType.EARNING_CONFIRMED,
        direction: LedgerV2Direction.CREDIT,
        balanceAfterAvailableCents: wallet.availableCents,
        balanceAfterReservedCents: wallet.reservedCents,
        reversalOfEntryRef: options.reversalOfEntryRef || null,
        idempotencyKey: options.idempotencyKey || null,
        description: options.description || `Confirmed earnings: ${amountCents} cents`,
        metadata: options.metadata ? JSON.stringify(options.metadata) : null,
        createdBy: options.createdBy,
      },
    });

    return { wallet: updatedWallet, ledgerEntry };
  };

  if (externalTx) {
    return await runWithTx(externalTx);
  }
  return await prisma.$transaction(runWithTx);
}

/**
 * آزادسازی عواید تاییدشده به موجودی در دسترس (Release Confirmed to Available)
 * قید ایمنی: منوط به فعال بودن کلید سراسری ESCROW_RELEASE_ENABLED=true در محیط
 */
export async function releaseConfirmedEarningsToAvailable(
  userId: string,
  amountCents: number,
  options: LedgerEntryOptions = {},
  externalTx?: Prisma.TransactionClient
) {
  assertEscrowReleaseEnabled();

  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`INVALID_AMOUNT: Release amount must be a positive safe integer, got ${amountCents}`);
  }

  const runWithTx = async (tx: Prisma.TransactionClient) => {
    const wallet = await getOrCreateWalletV2(userId, tx);

    if (wallet.confirmedEarningsCents < amountCents) {
      throw new Error(
        `INSUFFICIENT_CONFIRMED_EARNINGS: Confirmed earnings ($${(wallet.confirmedEarningsCents / 100).toFixed(2)}) is less than release amount ($${(amountCents / 100).toFixed(2)})`
      );
    }

    const newConfirmed = wallet.confirmedEarningsCents - amountCents;
    const newAvailable = wallet.availableCents + amountCents;

    const updatedWallet = await tx.walletV2.update({
      where: { userId },
      data: {
        confirmedEarningsCents: newConfirmed,
        availableCents: newAvailable,
      },
    });

    assertWalletInvariants(updatedWallet);

    const entryRef = options.entryRef || `LEDGER_REL_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    if (options.idempotencyKey) {
      const existing = await tx.ledgerEntryV2.findUnique({
        where: { idempotencyKey: options.idempotencyKey },
      });
      if (existing) {
        throw new Error(`DUPLICATE_IDEMPOTENCY_KEY: Ledger entry with idempotency key '${options.idempotencyKey}' already exists`);
      }
    }

    const ledgerEntry = await tx.ledgerEntryV2.create({
      data: {
        entryRef,
        postingGroupId: options.postingGroupId || null,
        accountType: options.accountType || LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
        userId,
        orderId: options.orderId,
        amountCents,
        entryType: LedgerV2EntryType.AVAILABLE_RELEASE,
        direction: LedgerV2Direction.CREDIT,
        balanceAfterAvailableCents: newAvailable,
        balanceAfterReservedCents: wallet.reservedCents,
        reversalOfEntryRef: options.reversalOfEntryRef || null,
        idempotencyKey: options.idempotencyKey || null,
        description: options.description || `Released ${amountCents} cents to available balance`,
        metadata: options.metadata ? JSON.stringify(options.metadata) : null,
        createdBy: options.createdBy,
      },
    });

    return { wallet: updatedWallet, ledgerEntry };
  };

  if (externalTx) {
    return await runWithTx(externalTx);
  }
  return await prisma.$transaction(runWithTx);
}
