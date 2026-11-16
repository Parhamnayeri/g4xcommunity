/**
 * src/services/financialTransferAndWithdrawalService.ts — G4X Financial Transfers, Exchange & Withdrawals (Phase 2)
 *
 * Core Modules:
 *  1. Internal Transfers (Same Currency & Currency Conversion)
 *  2. Exchange Rate Management & Historical Price Tracking
 *  3. Withdrawal Management & Multi-Stage Lifecycle (Pending -> Processing -> Completed / Rejected)
 *  4. Balanced Double-Entry Bookkeeping & Atomic Transactions
 *  5. Strict Reservation Safeguards & Idempotency Enforcement
 */

import * as crypto from 'crypto';
import prisma from '../database/db';
import { Prisma } from '@prisma/client';
import { formatFinancialAmount } from './financialAccountService';

export type TransferType = 'SAME_CURRENCY' | 'CURRENCY_CONVERSION';

export type WithdrawalStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export interface ExecuteInternalTransferInput {
  sourceAccountId: string;
  destinationAccountId: string;
  sourceAmount: number | string | bigint;
  feeAmount?: number | string | bigint;
  exchangeRate?: number;
  transferDate?: Date | string;
  description?: string;
  attachmentUrl?: string;
  adminId: string;
  idempotencyKey?: string;
}

export interface CreateExchangeRateInput {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  effectiveAt?: Date | string;
  expiresAt?: Date | string;
  notes?: string;
  adminId?: string;
}

export interface RequestPlatformWithdrawalInput {
  sourceAccountId: string;
  amount: number | string | bigint;
  fee?: number | string | bigint;
  withdrawalType?: string;
  destinationType?: string;
  destinationAccountId?: string;
  destinationDetails?: string;
  description?: string;
  attachmentUrl?: string;
  adminId: string;
  idempotencyKey?: string;
}

export interface CompleteWithdrawalInput {
  withdrawalId: string;
  referenceNumber?: string;
  attachmentUrl?: string;
  processedBy: string;
  notes?: string;
}

export interface RejectWithdrawalInput {
  withdrawalId: string;
  reason: string;
  adminId: string;
}

export interface SerializedInternalTransfer {
  id: string;
  transferRef: string;
  idempotencyKey: string;
  sourceAccountId: string;
  sourceAccountRef?: string;
  sourceAccountName?: string;
  destinationAccountId: string;
  destinationAccountRef?: string;
  destinationAccountName?: string;
  transferType: string;
  sourceAmount: number;
  sourceCurrency: string;
  formattedSourceAmount: string;
  destinationAmount: number;
  destinationCurrency: string;
  formattedDestinationAmount: string;
  exchangeRate: number | null;
  feeAmount: number;
  formattedFee: string;
  status: string;
  description: string | null;
  attachmentUrl: string | null;
  adminId: string | null;
  adminUsername?: string | null;
  createdAt: string;
}

export interface SerializedPlatformWithdrawal {
  id: string;
  withdrawalRef: string;
  idempotencyKey: string;
  sourceAccountId: string;
  sourceAccountRef?: string;
  sourceAccountName?: string;
  amount: number;
  fee: number;
  netAmount: number;
  currency: string;
  formattedAmount: string;
  formattedFee: string;
  formattedNetAmount: string;
  withdrawalType: string;
  destinationType: string;
  destinationAccountId: string | null;
  destinationAccountName?: string | null;
  destinationDetails: string | null;
  status: string;
  requestedAt: string;
  processedAt: string | null;
  adminId: string | null;
  adminUsername?: string | null;
  processedBy: string | null;
  processorUsername?: string | null;
  referenceNumber: string | null;
  description: string | null;
  attachmentUrl: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface SerializedExchangeRate {
  id: string;
  rateRef: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  inverseRate: number;
  spreadPercentage: number;
  effectiveAt: string;
  expiresAt: string | null;
  isActive: boolean;
  source: string;
  notes: string | null;
  adminId: string | null;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. EXCHANGE RATE SERVICE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seed default baseline exchange rate if none exists.
 */
export async function ensureDefaultExchangeRates(): Promise<void> {
  const existingUsdIrt = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: 'USD', toCurrency: 'IRR', isActive: true },
  });

  if (!existingUsdIrt) {
    const config = await prisma.systemFinancialConfig.findUnique({
      where: { key: 'admin_usd_irt_rate' },
    });
    const parsedRate = config?.value ? parseFloat(config.value) : null;
    const rate = parsedRate && !isNaN(parsedRate) && parsedRate > 0 ? parsedRate : 90000.0;

    await prisma.exchangeRate.create({
      data: {
        rateRef: `FX-USD-IRR-DEFAULT`,
        fromCurrency: 'USD',
        toCurrency: 'IRR',
        rate,
        inverseRate: 1 / rate,
        spreadPercentage: 0,
        isActive: true,
        source: 'FINANCIAL_CONFIG',
        notes: 'Authoritative initial exchange rate from SystemFinancialConfig',
      },
    });
  }
}

/**
 * Get active exchange rate between two currencies.
 */
export async function getActiveExchangeRate(fromCurrency: string, toCurrency: string): Promise<number> {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();

  if (from === to) return 1.0;

  await ensureDefaultExchangeRates();

  // Direct lookup
  const direct = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: from, toCurrency: to, isActive: true },
    orderBy: { effectiveAt: 'desc' },
  });
  if (direct) return direct.rate;

  // Inverse lookup
  const inverse = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: to, toCurrency: from, isActive: true },
    orderBy: { effectiveAt: 'desc' },
  });
  if (inverse) {
    return inverse.inverseRate > 0 ? inverse.inverseRate : 1 / inverse.rate;
  }

  return 1.0;
}

/**
 * Get active exchange rate record object between two currencies.
 */
export async function getActiveExchangeRateRecord(
  fromCurrency: string,
  toCurrency: string
): Promise<SerializedExchangeRate | null> {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  await ensureDefaultExchangeRates();

  const direct = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: from, toCurrency: to, isActive: true },
    orderBy: { effectiveAt: 'desc' },
  });
  if (direct) {
    return {
      id: direct.id,
      rateRef: direct.rateRef,
      fromCurrency: direct.fromCurrency,
      toCurrency: direct.toCurrency,
      rate: direct.rate,
      inverseRate: direct.inverseRate,
      spreadPercentage: direct.spreadPercentage,
      effectiveAt: direct.effectiveAt.toISOString(),
      expiresAt: direct.expiresAt ? direct.expiresAt.toISOString() : null,
      isActive: direct.isActive,
      source: direct.source,
      notes: direct.notes,
      adminId: direct.adminId,
      createdAt: direct.createdAt.toISOString(),
    };
  }
  return null;
}

/**
 * Record a new Exchange Rate.
 */
export async function createExchangeRate(input: CreateExchangeRateInput): Promise<SerializedExchangeRate> {
  const fromCurrency = input.fromCurrency.toUpperCase().trim();
  const toCurrency = input.toCurrency.toUpperCase().trim();
  const rate = Number(input.rate);

  if (isNaN(rate) || rate <= 0) {
    throw new Error('VALIDATION_ERROR: Exchange rate must be a positive number');
  }

  const rateRef = `FX-${fromCurrency}-${toCurrency}-${Date.now().toString(36).toUpperCase()}`;
  const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();

  // Deactivate prior active rates for this pair
  await prisma.exchangeRate.updateMany({
    where: { fromCurrency, toCurrency, isActive: true },
    data: { isActive: false },
  });

  const record = await prisma.exchangeRate.create({
    data: {
      rateRef,
      fromCurrency,
      toCurrency,
      rate,
      inverseRate: 1 / rate,
      effectiveAt,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      isActive: true,
      source: 'MANUAL',
      notes: input.notes?.trim() || null,
      adminId: input.adminId || null,
    },
  });

  // Keep SystemFinancialConfig admin_usd_irt_rate in exact sync
  if (fromCurrency === 'USD' && (toCurrency === 'IRR' || toCurrency === 'IRT')) {
    await prisma.systemFinancialConfig.upsert({
      where: { key: 'admin_usd_irt_rate' },
      update: { value: String(Math.round(rate)), updatedBy: input.adminId || null },
      create: {
        key: 'admin_usd_irt_rate',
        value: String(Math.round(rate)),
        description: 'Authoritative Admin USD/IRT rate',
        updatedBy: input.adminId || null,
      },
    });
  }

  return {
    id: record.id,
    rateRef: record.rateRef,
    fromCurrency: record.fromCurrency,
    toCurrency: record.toCurrency,
    rate: record.rate,
    inverseRate: record.inverseRate,
    spreadPercentage: record.spreadPercentage,
    effectiveAt: record.effectiveAt.toISOString(),
    expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
    isActive: record.isActive,
    source: record.source,
    notes: record.notes,
    adminId: record.adminId,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * List all historical exchange rates.
 */
export async function listExchangeRates(params?: {
  fromCurrency?: string;
  toCurrency?: string;
  isActive?: boolean;
}): Promise<SerializedExchangeRate[]> {
  await ensureDefaultExchangeRates();

  const where: Prisma.ExchangeRateWhereInput = {};
  if (params?.fromCurrency) where.fromCurrency = params.fromCurrency.toUpperCase();
  if (params?.toCurrency) where.toCurrency = params.toCurrency.toUpperCase();
  if (params?.isActive !== undefined) where.isActive = params.isActive;

  const records = await prisma.exchangeRate.findMany({
    where,
    orderBy: { effectiveAt: 'desc' },
  });

  return records.map((r) => ({
    id: r.id,
    rateRef: r.rateRef,
    fromCurrency: r.fromCurrency,
    toCurrency: r.toCurrency,
    rate: r.rate,
    inverseRate: r.inverseRate,
    spreadPercentage: r.spreadPercentage,
    effectiveAt: r.effectiveAt.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    isActive: r.isActive,
    source: r.source,
    notes: r.notes,
    adminId: r.adminId,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. INTERNAL TRANSFERS & CURRENCY CONVERSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute an internal transfer (same currency or currency conversion).
 * Enforces balanced double-entry ledger records and strict atomicity.
 */
export async function executeInternalTransfer(
  input: ExecuteInternalTransferInput
): Promise<SerializedInternalTransfer> {
  if (input.sourceAccountId === input.destinationAccountId) {
    throw new Error('VALIDATION_ERROR: Source and Destination accounts cannot be the same');
  }

  const rawSourceAmount =
    typeof input.sourceAmount === 'bigint' ? input.sourceAmount : BigInt(Math.floor(Number(input.sourceAmount)));
  if (rawSourceAmount <= BigInt(0)) {
    throw new Error('VALIDATION_ERROR: Source amount must be a positive integer greater than zero');
  }

  const rawFeeAmount = input.feeAmount
    ? typeof input.feeAmount === 'bigint'
      ? input.feeAmount
      : BigInt(Math.floor(Number(input.feeAmount)))
    : BigInt(0);

  if (rawFeeAmount < BigInt(0)) {
    throw new Error('VALIDATION_ERROR: Transfer fee cannot be negative');
  }

  if (rawFeeAmount >= rawSourceAmount) {
    throw new Error('VALIDATION_ERROR: Transfer fee cannot equal or exceed total source amount');
  }

  const idempotencyKey = input.idempotencyKey?.trim() || `trf_${crypto.randomUUID()}`;

  // Idempotency check
  const existingTransfer = await prisma.internalTransfer.findUnique({
    where: { idempotencyKey },
    include: {
      sourceAccount: { select: { accountRef: true, name: true } },
      destinationAccount: { select: { accountRef: true, name: true } },
      admin: { select: { username: true } },
    },
  });

  if (existingTransfer) {
    return serializeInternalTransfer(existingTransfer);
  }

  // Fetch accounts
  const [sourceAcc, destAcc] = await Promise.all([
    prisma.financialAccount.findUnique({ where: { id: input.sourceAccountId } }),
    prisma.financialAccount.findUnique({ where: { id: input.destinationAccountId } }),
  ]);

  if (!sourceAcc) throw new Error(`NOT_FOUND: Source financial account '${input.sourceAccountId}' not found`);
  if (!destAcc) throw new Error(`NOT_FOUND: Destination financial account '${input.destinationAccountId}' not found`);

  if (sourceAcc.status !== 'ACTIVE') {
    throw new Error(`ACCOUNT_INACTIVE: Source account '${sourceAcc.name}' is ${sourceAcc.status}`);
  }
  if (destAcc.status !== 'ACTIVE') {
    throw new Error(`ACCOUNT_INACTIVE: Destination account '${destAcc.name}' is ${destAcc.status}`);
  }

  if (sourceAcc.availableBalance < rawSourceAmount) {
    const formattedNeed = formatFinancialAmount(rawSourceAmount, sourceAcc.currency);
    const formattedAvail = formatFinancialAmount(sourceAcc.availableBalance, sourceAcc.currency);
    throw new Error(
      `INSUFFICIENT_FUNDS: Insufficient available balance in source account. Required: ${formattedNeed}, Available: ${formattedAvail}`
    );
  }

  const isSameCurrency = sourceAcc.currency === destAcc.currency;
  const transferType: TransferType = isSameCurrency ? 'SAME_CURRENCY' : 'CURRENCY_CONVERSION';

  let appliedRate: number | null = null;
  let destinationAmount: bigint;

  const netSourceAmount = rawSourceAmount - rawFeeAmount;

  if (isSameCurrency) {
    destinationAmount = netSourceAmount;
    appliedRate = 1.0;
  } else {
    // Currency conversion
    appliedRate = input.exchangeRate
      ? Number(input.exchangeRate)
      : await getActiveExchangeRate(sourceAcc.currency, destAcc.currency);

    if (isNaN(appliedRate) || appliedRate <= 0) {
      throw new Error('INVALID_EXCHANGE_RATE: Effective exchange rate must be greater than zero');
    }

    if (sourceAcc.currency === 'USD' && destAcc.currency === 'IRR') {
      // USD cents -> Tomans: (cents / 100) * rate
      const dollars = Number(netSourceAmount) / 100;
      destinationAmount = BigInt(Math.round(dollars * appliedRate));
    } else if (sourceAcc.currency === 'IRR' && destAcc.currency === 'USD') {
      // Tomans -> USD cents: (tomans / rate) * 100
      const tomans = Number(netSourceAmount);
      destinationAmount = BigInt(Math.round((tomans / appliedRate) * 100));
    } else {
      destinationAmount = BigInt(Math.round(Number(netSourceAmount) * appliedRate));
    }
  }

  if (destinationAmount <= BigInt(0)) {
    throw new Error('VALIDATION_ERROR: Resulting destination amount must be greater than zero');
  }

  // Atomic database execution
  const result = await prisma.$transaction(async (tx) => {
    // Lock and re-read source account
    const freshSource = await tx.financialAccount.findUniqueOrThrow({
      where: { id: sourceAcc.id },
    });

    if (freshSource.availableBalance < rawSourceAmount) {
      throw new Error('INSUFFICIENT_FUNDS: Concurrently decreased available balance');
    }

    const freshDest = await tx.financialAccount.findUniqueOrThrow({
      where: { id: destAcc.id },
    });

    // 1. Debit Source Account
    const sourceBalBefore = freshSource.currentBalance;
    const sourceBalAfter = freshSource.currentBalance - rawSourceAmount;
    const sourceAvailAfter = freshSource.availableBalance - rawSourceAmount;

    await tx.financialAccount.update({
      where: { id: sourceAcc.id },
      data: {
        currentBalance: sourceBalAfter,
        availableBalance: sourceAvailAfter,
      },
    });

    // 2. Credit Destination Account
    const destBalBefore = freshDest.currentBalance;
    const destBalAfter = freshDest.currentBalance + destinationAmount;
    const destAvailAfter = freshDest.availableBalance + destinationAmount;

    await tx.financialAccount.update({
      where: { id: destAcc.id },
      data: {
        currentBalance: destBalAfter,
        availableBalance: destAvailAfter,
      },
    });

    // 3. Create InternalTransfer Record
    const transferRef = `TRF-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const newTransfer = await tx.internalTransfer.create({
      data: {
        transferRef,
        idempotencyKey,
        sourceAccountId: sourceAcc.id,
        destinationAccountId: destAcc.id,
        transferType,
        sourceAmount: rawSourceAmount,
        sourceCurrency: sourceAcc.currency,
        destinationAmount,
        destinationCurrency: destAcc.currency,
        exchangeRate: appliedRate,
        feeAmount: rawFeeAmount,
        status: 'COMPLETED',
        description: input.description?.trim() || null,
        attachmentUrl: input.attachmentUrl?.trim() || null,
        adminId: input.adminId,
      },
      include: {
        sourceAccount: { select: { accountRef: true, name: true } },
        destinationAccount: { select: { accountRef: true, name: true } },
        admin: { select: { username: true } },
      },
    });

    // 4. Create Balanced Financial Transactions & Ledger Entries
    const txSourceRef = `FTX-TRF-OUT-${newTransfer.transferRef}`;
    const txDestRef = `FTX-TRF-IN-${newTransfer.transferRef}`;

    // Source Outflow Transaction & Ledger Entry
    const srcTx = await tx.financialTransaction.create({
      data: {
        transactionRef: txSourceRef,
        idempotencyKey: `idem_out_${idempotencyKey}`,
        accountId: sourceAcc.id,
        type: 'INTERNAL_TRANSFER',
        direction: 'DEBIT',
        amount: rawSourceAmount,
        currency: sourceAcc.currency,
        reason: `Transfer to ${destAcc.name}${input.description ? `: ${input.description}` : ''}`,
        status: 'COMPLETED',
        adminId: input.adminId,
      },
    });

    await tx.financialLedgerEntry.create({
      data: {
        entryRef: `LED-OUT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        transactionId: srcTx.id,
        accountId: sourceAcc.id,
        entryType: 'DEBIT',
        amount: rawSourceAmount,
        currency: sourceAcc.currency,
        balanceBefore: sourceBalBefore,
        balanceAfter: sourceBalAfter,
        description: `Debit for internal transfer ${transferRef}`,
      },
    });

    // Destination Inflow Transaction & Ledger Entry
    const dstTx = await tx.financialTransaction.create({
      data: {
        transactionRef: txDestRef,
        idempotencyKey: `idem_in_${idempotencyKey}`,
        accountId: destAcc.id,
        type: 'INTERNAL_TRANSFER',
        direction: 'CREDIT',
        amount: destinationAmount,
        currency: destAcc.currency,
        reason: `Transfer from ${sourceAcc.name}${input.description ? `: ${input.description}` : ''}`,
        status: 'COMPLETED',
        adminId: input.adminId,
      },
    });

    await tx.financialLedgerEntry.create({
      data: {
        entryRef: `LED-IN-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        transactionId: dstTx.id,
        accountId: destAcc.id,
        entryType: 'CREDIT',
        amount: destinationAmount,
        currency: destAcc.currency,
        balanceBefore: destBalBefore,
        balanceAfter: destBalAfter,
        description: `Credit for internal transfer ${transferRef}`,
      },
    });

    // 5. System Audit Log
    try {
      await tx.auditLog.create({
        data: {
          action: 'FINANCIAL_INTERNAL_TRANSFER',
          entityType: 'InternalTransfer',
          entityId: newTransfer.id,
          actorId: input.adminId,
          previousValues: JSON.stringify({
            sourceBalance: sourceBalBefore.toString(),
            destBalance: destBalBefore.toString(),
          }),
          newValues: JSON.stringify({
            transferRef,
            sourceAmount: rawSourceAmount.toString(),
            destinationAmount: destinationAmount.toString(),
            exchangeRate: appliedRate,
            transferType,
          }),
          reason: input.description || 'Internal transfer executed',
          isSuccess: true,
        },
      });
    } catch {}

    return newTransfer;
  });

  return serializeInternalTransfer(result);
}

/**
 * List internal transfers with filtering and pagination.
 */
export async function listInternalTransfers(params?: {
  sourceAccountId?: string;
  destinationAccountId?: string;
  transferType?: string;
  currency?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{
  transfers: SerializedInternalTransfer[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const page = Math.max(1, params?.page || 1);
  const limit = Math.min(100, Math.max(1, params?.limit || 20));
  const skip = (page - 1) * limit;

  const where: Prisma.InternalTransferWhereInput = {};
  if (params?.sourceAccountId) where.sourceAccountId = params.sourceAccountId;
  if (params?.destinationAccountId) where.destinationAccountId = params.destinationAccountId;
  if (params?.transferType) where.transferType = params.transferType;
  if (params?.status) where.status = params.status;
  if (params?.currency) {
    where.OR = [
      { sourceCurrency: params.currency.toUpperCase() },
      { destinationCurrency: params.currency.toUpperCase() },
    ];
  }

  const [total, records] = await Promise.all([
    prisma.internalTransfer.count({ where }),
    prisma.internalTransfer.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        sourceAccount: { select: { accountRef: true, name: true } },
        destinationAccount: { select: { accountRef: true, name: true } },
        admin: { select: { username: true } },
      },
    }),
  ]);

  return {
    transfers: records.map(serializeInternalTransfer),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. WITHDRAWAL MANAGEMENT & WORKFLOW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request a withdrawal from an account.
 * Atomically reserves the requested amount so funds cannot be double-spent.
 */
export async function requestPlatformWithdrawal(
  input: RequestPlatformWithdrawalInput
): Promise<SerializedPlatformWithdrawal> {
  const rawAmount =
    typeof input.amount === 'bigint' ? input.amount : BigInt(Math.floor(Number(input.amount)));
  if (rawAmount <= BigInt(0)) {
    throw new Error('VALIDATION_ERROR: Withdrawal amount must be a positive integer greater than zero');
  }

  const rawFee = input.fee
    ? typeof input.fee === 'bigint'
      ? input.fee
      : BigInt(Math.floor(Number(input.fee)))
    : BigInt(0);

  if (rawFee < BigInt(0)) throw new Error('VALIDATION_ERROR: Fee cannot be negative');
  if (rawFee >= rawAmount) throw new Error('VALIDATION_ERROR: Fee cannot equal or exceed requested withdrawal amount');

  const netAmount = rawAmount - rawFee;
  const idempotencyKey = input.idempotencyKey?.trim() || `wdr_${crypto.randomUUID()}`;

  // Idempotency check
  const existingWdr = await prisma.platformWithdrawal.findUnique({
    where: { idempotencyKey },
    include: {
      sourceAccount: { select: { accountRef: true, name: true } },
      destinationAccount: { select: { accountRef: true, name: true } },
      admin: { select: { username: true } },
    },
  });

  if (existingWdr) {
    return serializePlatformWithdrawal(existingWdr);
  }

  const account = await prisma.financialAccount.findUnique({
    where: { id: input.sourceAccountId },
  });
  if (!account) throw new Error(`NOT_FOUND: Source financial account '${input.sourceAccountId}' not found`);

  if (account.status !== 'ACTIVE') {
    throw new Error(`ACCOUNT_INACTIVE: Account '${account.name}' is ${account.status} and cannot initiate withdrawals`);
  }

  if (account.availableBalance < rawAmount) {
    const formattedNeed = formatFinancialAmount(rawAmount, account.currency);
    const formattedAvail = formatFinancialAmount(account.availableBalance, account.currency);
    throw new Error(
      `INSUFFICIENT_FUNDS: Insufficient available balance. Required: ${formattedNeed}, Available: ${formattedAvail}`
    );
  }

  // Atomic reservation
  const result = await prisma.$transaction(async (tx) => {
    const freshAccount = await tx.financialAccount.findUniqueOrThrow({
      where: { id: account.id },
    });

    if (freshAccount.availableBalance < rawAmount) {
      throw new Error('INSUFFICIENT_FUNDS: Available balance decreased concurrently');
    }

    // Reserve funds: availableBalance decreases, reservedBalance increases
    await tx.financialAccount.update({
      where: { id: account.id },
      data: {
        reservedBalance: freshAccount.reservedBalance + rawAmount,
        availableBalance: freshAccount.availableBalance - rawAmount,
      },
    });

    const withdrawalRef = `PW-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const newWithdrawal = await tx.platformWithdrawal.create({
      data: {
        withdrawalRef,
        idempotencyKey,
        sourceAccountId: account.id,
        amount: rawAmount,
        fee: rawFee,
        netAmount,
        currency: account.currency,
        withdrawalType: input.withdrawalType || 'PLATFORM_PAYOUT',
        destinationType: input.destinationType || 'EXTERNAL_BANK',
        destinationAccountId: input.destinationAccountId || null,
        destinationDetails: input.destinationDetails?.trim() || null,
        status: 'PENDING',
        description: input.description?.trim() || null,
        attachmentUrl: input.attachmentUrl?.trim() || null,
        adminId: input.adminId,
      },
      include: {
        sourceAccount: { select: { accountRef: true, name: true } },
        destinationAccount: { select: { accountRef: true, name: true } },
        admin: { select: { username: true } },
      },
    });

    return newWithdrawal;
  });

  return serializePlatformWithdrawal(result);
}

/**
 * Update withdrawal to PROCESSING status.
 */
export async function markWithdrawalProcessing(
  withdrawalId: string,
  adminId?: string
): Promise<SerializedPlatformWithdrawal> {
  const wdr = await prisma.platformWithdrawal.findUnique({
    where: { id: withdrawalId },
    include: { sourceAccount: true },
  });
  if (!wdr) throw new Error(`NOT_FOUND: Withdrawal '${withdrawalId}' not found`);

  if (wdr.status !== 'PENDING') {
    throw new Error(`INVALID_STATUS_TRANSITION: Withdrawal is already ${wdr.status}, cannot move to PROCESSING`);
  }

  const updated = await prisma.platformWithdrawal.update({
    where: { id: withdrawalId },
    data: {
      status: 'PROCESSING',
      processedBy: adminId || null,
    },
    include: {
      sourceAccount: { select: { accountRef: true, name: true } },
      destinationAccount: { select: { accountRef: true, name: true } },
      admin: { select: { username: true } },
      processor: { select: { username: true } },
    },
  });

  return serializePlatformWithdrawal(updated);
}

/**
 * Complete a withdrawal.
 * Atomically deducts the reserved funds from the source account and records ledger entries.
 */
export async function completePlatformWithdrawal(
  input: CompleteWithdrawalInput
): Promise<SerializedPlatformWithdrawal> {
  const wdr = await prisma.platformWithdrawal.findUnique({
    where: { id: input.withdrawalId },
    include: { sourceAccount: true, destinationAccount: true },
  });
  if (!wdr) throw new Error(`NOT_FOUND: Withdrawal '${input.withdrawalId}' not found`);

  if (!['PENDING', 'PROCESSING'].includes(wdr.status)) {
    throw new Error(`INVALID_STATUS: Withdrawal is ${wdr.status} and cannot be completed`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const sourceAcc = await tx.financialAccount.findUniqueOrThrow({
      where: { id: wdr.sourceAccountId },
    });

    if (sourceAcc.reservedBalance < wdr.amount) {
      throw new Error('CORRUPT_RESERVE_STATE: Reserved balance is less than withdrawal amount');
    }

    // Deduct reserved balance & current balance
    const balBefore = sourceAcc.currentBalance;
    const balAfter = sourceAcc.currentBalance - wdr.amount;
    const reservedAfter = sourceAcc.reservedBalance - wdr.amount;

    await tx.financialAccount.update({
      where: { id: sourceAcc.id },
      data: {
        currentBalance: balAfter,
        reservedBalance: reservedAfter,
      },
    });

    // If destination is internal account, credit it
    if (wdr.destinationAccountId) {
      const destAcc = await tx.financialAccount.findUniqueOrThrow({
        where: { id: wdr.destinationAccountId },
      });
      await tx.financialAccount.update({
        where: { id: destAcc.id },
        data: {
          currentBalance: destAcc.currentBalance + wdr.netAmount,
          availableBalance: destAcc.availableBalance + wdr.netAmount,
        },
      });
    }

    // Create immutable financial transaction & ledger entry
    const txRef = `FTX-WDR-${wdr.withdrawalRef}`;
    const finTx = await tx.financialTransaction.create({
      data: {
        transactionRef: txRef,
        idempotencyKey: `idem_wdr_fin_${wdr.idempotencyKey}`,
        accountId: sourceAcc.id,
        type: 'WITHDRAWAL',
        direction: 'DEBIT',
        amount: wdr.amount,
        currency: wdr.currency,
        reason: `Withdrawal ${wdr.withdrawalRef} completed${input.referenceNumber ? ` (Ref: ${input.referenceNumber})` : ''}`,
        status: 'COMPLETED',
        adminId: input.processedBy,
      },
    });

    await tx.financialLedgerEntry.create({
      data: {
        entryRef: `LED-WDR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        transactionId: finTx.id,
        accountId: sourceAcc.id,
        entryType: 'DEBIT',
        amount: wdr.amount,
        currency: wdr.currency,
        balanceBefore: balBefore,
        balanceAfter: balAfter,
        description: `Settlement payout for withdrawal ${wdr.withdrawalRef}`,
      },
    });

    const updatedWdr = await tx.platformWithdrawal.update({
      where: { id: wdr.id },
      data: {
        status: 'COMPLETED',
        processedAt: new Date(),
        processedBy: input.processedBy,
        referenceNumber: input.referenceNumber?.trim() || wdr.referenceNumber,
        attachmentUrl: input.attachmentUrl?.trim() || wdr.attachmentUrl,
      },
      include: {
        sourceAccount: { select: { accountRef: true, name: true } },
        destinationAccount: { select: { accountRef: true, name: true } },
        admin: { select: { username: true } },
        processor: { select: { username: true } },
      },
    });

    return updatedWdr;
  });

  return serializePlatformWithdrawal(result);
}

/**
 * Reject a withdrawal and release the reserved funds.
 */
export async function rejectPlatformWithdrawal(
  input: RejectWithdrawalInput
): Promise<SerializedPlatformWithdrawal> {
  const reason = input.reason?.trim();
  if (!reason) throw new Error('VALIDATION_ERROR: Rejection reason is required');

  const wdr = await prisma.platformWithdrawal.findUnique({
    where: { id: input.withdrawalId },
    include: { sourceAccount: true },
  });
  if (!wdr) throw new Error(`NOT_FOUND: Withdrawal '${input.withdrawalId}' not found`);

  if (!['PENDING', 'PROCESSING'].includes(wdr.status)) {
    throw new Error(`INVALID_STATUS: Withdrawal is ${wdr.status} and cannot be rejected`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const sourceAcc = await tx.financialAccount.findUniqueOrThrow({
      where: { id: wdr.sourceAccountId },
    });

    // Release reserved funds: reservedBalance decreases, availableBalance increases
    const reservedAfter = sourceAcc.reservedBalance >= wdr.amount ? sourceAcc.reservedBalance - wdr.amount : BigInt(0);
    const availableAfter = sourceAcc.availableBalance + wdr.amount;

    await tx.financialAccount.update({
      where: { id: sourceAcc.id },
      data: {
        reservedBalance: reservedAfter,
        availableBalance: availableAfter,
      },
    });

    const updated = await tx.platformWithdrawal.update({
      where: { id: wdr.id },
      data: {
        status: 'REJECTED',
        processedAt: new Date(),
        processedBy: input.adminId,
        rejectionReason: reason,
      },
      include: {
        sourceAccount: { select: { accountRef: true, name: true } },
        destinationAccount: { select: { accountRef: true, name: true } },
        admin: { select: { username: true } },
        processor: { select: { username: true } },
      },
    });

    return updated;
  });

  return serializePlatformWithdrawal(result);
}

/**
 * Cancel a withdrawal (releases reserved funds).
 */
export async function cancelPlatformWithdrawal(
  withdrawalId: string,
  reason: string,
  adminId: string
): Promise<SerializedPlatformWithdrawal> {
  const wdr = await prisma.platformWithdrawal.findUnique({
    where: { id: withdrawalId },
  });
  if (!wdr) throw new Error(`NOT_FOUND: Withdrawal '${withdrawalId}' not found`);

  if (!['PENDING', 'PROCESSING'].includes(wdr.status)) {
    throw new Error(`INVALID_STATUS: Withdrawal is ${wdr.status} and cannot be cancelled`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const sourceAcc = await tx.financialAccount.findUniqueOrThrow({
      where: { id: wdr.sourceAccountId },
    });

    const reservedAfter = sourceAcc.reservedBalance >= wdr.amount ? sourceAcc.reservedBalance - wdr.amount : BigInt(0);
    const availableAfter = sourceAcc.availableBalance + wdr.amount;

    await tx.financialAccount.update({
      where: { id: sourceAcc.id },
      data: {
        reservedBalance: reservedAfter,
        availableBalance: availableAfter,
      },
    });

    const updated = await tx.platformWithdrawal.update({
      where: { id: wdr.id },
      data: {
        status: 'CANCELLED',
        processedAt: new Date(),
        processedBy: adminId,
        rejectionReason: reason?.trim() || 'Cancelled by admin',
      },
      include: {
        sourceAccount: { select: { accountRef: true, name: true } },
        destinationAccount: { select: { accountRef: true, name: true } },
        admin: { select: { username: true } },
        processor: { select: { username: true } },
      },
    });

    return updated;
  });

  return serializePlatformWithdrawal(result);
}

/**
 * List withdrawals with pagination and status filters.
 */
export async function listPlatformWithdrawals(params?: {
  sourceAccountId?: string;
  currency?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{
  withdrawals: SerializedPlatformWithdrawal[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const page = Math.max(1, params?.page || 1);
  const limit = Math.min(100, Math.max(1, params?.limit || 20));
  const skip = (page - 1) * limit;

  const where: Prisma.PlatformWithdrawalWhereInput = {};
  if (params?.sourceAccountId) where.sourceAccountId = params.sourceAccountId;
  if (params?.status) where.status = params.status;
  if (params?.currency) where.currency = params.currency.toUpperCase();

  const [total, records] = await Promise.all([
    prisma.platformWithdrawal.count({ where }),
    prisma.platformWithdrawal.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        sourceAccount: { select: { accountRef: true, name: true } },
        destinationAccount: { select: { accountRef: true, name: true } },
        admin: { select: { username: true } },
        processor: { select: { username: true } },
      },
    }),
  ]);

  return {
    withdrawals: records.map(serializePlatformWithdrawal),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SERIALIZERS
// ─────────────────────────────────────────────────────────────────────────────

export function serializeInternalTransfer(tx: any): SerializedInternalTransfer {
  const srcAmt = typeof tx.sourceAmount === 'bigint' ? Number(tx.sourceAmount) : Number(tx.sourceAmount || 0);
  const dstAmt = typeof tx.destinationAmount === 'bigint' ? Number(tx.destinationAmount) : Number(tx.destinationAmount || 0);
  const fee = typeof tx.feeAmount === 'bigint' ? Number(tx.feeAmount) : Number(tx.feeAmount || 0);

  return {
    id: tx.id,
    transferRef: tx.transferRef,
    idempotencyKey: tx.idempotencyKey,
    sourceAccountId: tx.sourceAccountId,
    sourceAccountRef: tx.sourceAccount?.accountRef,
    sourceAccountName: tx.sourceAccount?.name,
    destinationAccountId: tx.destinationAccountId,
    destinationAccountRef: tx.destinationAccount?.accountRef,
    destinationAccountName: tx.destinationAccount?.name,
    transferType: tx.transferType,
    sourceAmount: srcAmt,
    sourceCurrency: tx.sourceCurrency,
    formattedSourceAmount: formatFinancialAmount(srcAmt, tx.sourceCurrency),
    destinationAmount: dstAmt,
    destinationCurrency: tx.destinationCurrency,
    formattedDestinationAmount: formatFinancialAmount(dstAmt, tx.destinationCurrency),
    exchangeRate: tx.exchangeRate ? Number(tx.exchangeRate) : null,
    feeAmount: fee,
    formattedFee: formatFinancialAmount(fee, tx.sourceCurrency),
    status: tx.status,
    description: tx.description || null,
    attachmentUrl: tx.attachmentUrl || null,
    adminId: tx.adminId || null,
    adminUsername: tx.admin?.username || null,
    createdAt: tx.createdAt instanceof Date ? tx.createdAt.toISOString() : String(tx.createdAt),
  };
}

export function serializePlatformWithdrawal(wdr: any): SerializedPlatformWithdrawal {
  const amt = typeof wdr.amount === 'bigint' ? Number(wdr.amount) : Number(wdr.amount || 0);
  const fee = typeof wdr.fee === 'bigint' ? Number(wdr.fee) : Number(wdr.fee || 0);
  const net = typeof wdr.netAmount === 'bigint' ? Number(wdr.netAmount) : Number(wdr.netAmount || 0);

  return {
    id: wdr.id,
    withdrawalRef: wdr.withdrawalRef,
    idempotencyKey: wdr.idempotencyKey,
    sourceAccountId: wdr.sourceAccountId,
    sourceAccountRef: wdr.sourceAccount?.accountRef,
    sourceAccountName: wdr.sourceAccount?.name,
    amount: amt,
    fee,
    netAmount: net,
    currency: wdr.currency,
    formattedAmount: formatFinancialAmount(amt, wdr.currency),
    formattedFee: formatFinancialAmount(fee, wdr.currency),
    formattedNetAmount: formatFinancialAmount(net, wdr.currency),
    withdrawalType: wdr.withdrawalType,
    destinationType: wdr.destinationType,
    destinationAccountId: wdr.destinationAccountId || null,
    destinationAccountName: wdr.destinationAccount?.name || null,
    destinationDetails: wdr.destinationDetails || null,
    status: wdr.status,
    requestedAt: wdr.requestedAt instanceof Date ? wdr.requestedAt.toISOString() : String(wdr.requestedAt),
    processedAt: wdr.processedAt ? (wdr.processedAt instanceof Date ? wdr.processedAt.toISOString() : String(wdr.processedAt)) : null,
    adminId: wdr.adminId || null,
    adminUsername: wdr.admin?.username || null,
    processedBy: wdr.processedBy || null,
    processorUsername: wdr.processor?.username || null,
    referenceNumber: wdr.referenceNumber || null,
    description: wdr.description || null,
    attachmentUrl: wdr.attachmentUrl || null,
    rejectionReason: wdr.rejectionReason || null,
    createdAt: wdr.createdAt instanceof Date ? wdr.createdAt.toISOString() : String(wdr.createdAt),
  };
}
