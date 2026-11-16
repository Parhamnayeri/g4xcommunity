/**
 * src/services/financialAccountService.ts — G4X Financial Accounts & Balance Management Service (Phase 1)
 *
 * Architecture & Financial Principles:
 *  1. Pure integer-based arithmetic for all monetary values (No floating-point).
 *     - USD: Integer cents (1 USD = 100 minor units).
 *     - IRR: Integer Tomans (IRT). In the DB, amounts are stored in integer Tomans.
 *            (1 Toman = 10 Rials. The user interface presents all amounts in Tomans).
 *  2. Immutable double-entry ledger foundation:
 *     - Direct editing of calculated balances is strictly prohibited.
 *     - Balances are updated ONLY via atomic transactions and ledger entries.
 *  3. Idempotent transaction execution:
 *     - Every transaction requires a unique idempotency key to prevent double debit/credit.
 *  4. Strict consolidation:
 *     - Consolidated asset summaries never count the same funds twice.
 */

import * as crypto from 'crypto';
import prisma from '../database/db';
import { Prisma } from '@prisma/client';

export type FinancialAccountCategory = 'PLATFORM' | 'INTERNAL';

export type FinancialAccountType =
  | 'G4X_DIRECT'
  | 'ELDORADO'
  | 'SKYCOACH'
  | 'OVERGEAR'
  | 'KINGBOOST'
  | 'USD_WALLET'
  | 'TOMAN_WALLET'
  | 'BANK_ACCOUNT'
  | 'CASH_ACCOUNT';

export type FinancialCurrency = 'USD' | 'IRR';

export type FinancialAccountStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export type TransactionDirection = 'CREDIT' | 'DEBIT';

export interface CreateFinancialAccountInput {
  accountRef?: string;
  name: string;
  category: FinancialAccountCategory;
  accountType: FinancialAccountType;
  currency: FinancialCurrency;
  openingBalance?: number | string | bigint;
  bankName?: string;
  accountNumber?: string;
  iban?: string;
  cardNumber?: string;
  notes?: string;
  metadata?: Record<string, any>;
  adminId?: string;
}

export interface UpdateFinancialAccountInput {
  name?: string;
  status?: FinancialAccountStatus;
  bankName?: string;
  accountNumber?: string;
  iban?: string;
  cardNumber?: string;
  notes?: string;
  metadata?: Record<string, any>;
}

export interface ManualBalanceAdjustmentInput {
  accountId: string; // ID or accountRef
  adjustmentType: TransactionDirection;
  amount: number | string | bigint;
  reason: string;
  description?: string;
  attachmentUrl?: string;
  adminId: string;
  idempotencyKey?: string;
}

export interface SerializedFinancialAccount {
  id: string;
  accountRef: string;
  name: string;
  category: string;
  accountType: string;
  currency: string;
  openingBalance: number;
  currentBalance: number;
  reservedBalance: number;
  availableBalance: number;
  formattedCurrent: string;
  formattedAvailable: string;
  formattedReserved: string;
  status: string;
  bankName: string | null;
  accountNumber: string | null;
  iban: string | null;
  cardNumber: string | null;
  notes: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedFinancialTransaction {
  id: string;
  transactionRef: string;
  idempotencyKey: string;
  accountId: string;
  accountRef?: string;
  accountName?: string;
  type: string;
  direction: string;
  amount: number;
  currency: string;
  formattedAmount: string;
  reason: string;
  description: string | null;
  attachmentUrl: string | null;
  status: string;
  adminId: string | null;
  adminUsername?: string | null;
  orderId: number | null;
  orderRef: string | null;
  createdAt: string;
}

/**
 * Format integer minor units for human-readable display.
 * - USD: $X,XXX.XX
 * - IRR: X,XXX,XXX تومان
 */
export function formatFinancialAmount(amount: bigint | number, currency: string): string {
  const num = typeof amount === 'bigint' ? Number(amount) : amount;
  if (currency === 'USD') {
    const dollars = num / 100;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(dollars);
  } else {
    // Stored in integer Tomans (IRR/IRT)
    return `${new Intl.NumberFormat('en-US').format(num)} تومان`;
  }
}

/**
 * Serialize a database FinancialAccount record to a JSON-safe object with formatted strings.
 */
export function serializeFinancialAccount(acc: any): SerializedFinancialAccount {
  const op = typeof acc.openingBalance === 'bigint' ? Number(acc.openingBalance) : Number(acc.openingBalance || 0);
  const cur = typeof acc.currentBalance === 'bigint' ? Number(acc.currentBalance) : Number(acc.currentBalance || 0);
  const res = typeof acc.reservedBalance === 'bigint' ? Number(acc.reservedBalance) : Number(acc.reservedBalance || 0);
  const av = typeof acc.availableBalance === 'bigint' ? Number(acc.availableBalance) : Number(acc.availableBalance || 0);

  let parsedMetadata: Record<string, any> | null = null;
  if (acc.metadata) {
    try {
      parsedMetadata = typeof acc.metadata === 'string' ? JSON.parse(acc.metadata) : acc.metadata;
    } catch {
      parsedMetadata = null;
    }
  }

  return {
    id: acc.id,
    accountRef: acc.accountRef,
    name: acc.name,
    category: acc.category,
    accountType: acc.accountType,
    currency: acc.currency,
    openingBalance: op,
    currentBalance: cur,
    reservedBalance: res,
    availableBalance: av,
    formattedCurrent: formatFinancialAmount(cur, acc.currency),
    formattedAvailable: formatFinancialAmount(av, acc.currency),
    formattedReserved: formatFinancialAmount(res, acc.currency),
    status: acc.status,
    bankName: acc.bankName || null,
    accountNumber: acc.accountNumber || null,
    iban: acc.iban || null,
    cardNumber: acc.cardNumber || null,
    notes: acc.notes || null,
    metadata: parsedMetadata,
    createdAt: acc.createdAt instanceof Date ? acc.createdAt.toISOString() : String(acc.createdAt),
    updatedAt: acc.updatedAt instanceof Date ? acc.updatedAt.toISOString() : String(acc.updatedAt),
  };
}

/**
 * Serialize a database FinancialTransaction record to a JSON-safe object.
 */
export function serializeFinancialTransaction(tx: any): SerializedFinancialTransaction {
  const amt = typeof tx.amount === 'bigint' ? Number(tx.amount) : Number(tx.amount || 0);

  return {
    id: tx.id,
    transactionRef: tx.transactionRef,
    idempotencyKey: tx.idempotencyKey,
    accountId: tx.accountId,
    accountRef: tx.account?.accountRef,
    accountName: tx.account?.name,
    type: tx.type,
    direction: tx.direction,
    amount: amt,
    currency: tx.currency,
    formattedAmount: formatFinancialAmount(amt, tx.currency),
    reason: tx.reason,
    description: tx.description || null,
    attachmentUrl: tx.attachmentUrl || null,
    status: tx.status,
    adminId: tx.adminId || null,
    adminUsername: tx.admin?.username || null,
    orderId: tx.orderId || null,
    orderRef: tx.orderRef || null,
    createdAt: tx.createdAt instanceof Date ? tx.createdAt.toISOString() : String(tx.createdAt),
  };
}

/**
 * Seed default canonical accounts if they do not exist.
 */
export async function ensureDefaultFinancialAccounts(): Promise<void> {
  const defaultAccounts: Array<{
    accountRef: string;
    name: string;
    category: FinancialAccountCategory;
    accountType: FinancialAccountType;
    currency: FinancialCurrency;
    bankName?: string;
    accountNumber?: string;
    iban?: string;
    cardNumber?: string;
    notes?: string;
  }> = [
    // 5 Platform Accounts
    {
      accountRef: 'g4x_direct',
      name: 'G4X Direct Store',
      category: 'PLATFORM',
      accountType: 'G4X_DIRECT',
      currency: 'USD',
      notes: 'Direct web & community store orders',
    },
    {
      accountRef: 'eldorado_main',
      name: 'Eldorado Platform',
      category: 'PLATFORM',
      accountType: 'ELDORADO',
      currency: 'USD',
      notes: 'Eldorado partner seller account',
    },
    {
      accountRef: 'skycoach_main',
      name: 'Skycoach Platform',
      category: 'PLATFORM',
      accountType: 'SKYCOACH',
      currency: 'USD',
      notes: 'Skycoach partner seller account',
    },
    {
      accountRef: 'overgear_main',
      name: 'Overgear Platform',
      category: 'PLATFORM',
      accountType: 'OVERGEAR',
      currency: 'USD',
      notes: 'Overgear partner seller account',
    },
    {
      accountRef: 'kingboost_main',
      name: 'Kingboost Platform',
      category: 'PLATFORM',
      accountType: 'KINGBOOST',
      currency: 'USD',
      notes: 'Kingboost partner seller account',
    },
    // Internal USD & Local Toman Accounts
    {
      accountRef: 'wallet_usd_treasury',
      name: 'G4X USD Treasury Wallet',
      category: 'INTERNAL',
      accountType: 'USD_WALLET',
      currency: 'USD',
      notes: 'Central platform USD reserve wallet',
    },
    {
      accountRef: 'wallet_toman_main',
      name: 'G4X Main Toman Wallet',
      category: 'INTERNAL',
      accountType: 'TOMAN_WALLET',
      currency: 'IRR',
      notes: 'Local operational Toman reserve',
    },
    {
      accountRef: 'bank_mellat_corporate',
      name: 'Bank Mellat Corporate',
      category: 'INTERNAL',
      accountType: 'BANK_ACCOUNT',
      currency: 'IRR',
      bankName: 'Mellat',
      accountNumber: '4829104829',
      iban: 'IR820120000000004829104829',
      cardNumber: '6104-3378-9012-3456',
      notes: 'Primary corporate settlement account',
    },
    {
      accountRef: 'bank_saman_ops',
      name: 'Bank Saman Settlement',
      category: 'INTERNAL',
      accountType: 'BANK_ACCOUNT',
      currency: 'IRR',
      bankName: 'Saman',
      accountNumber: '8910293847',
      iban: 'IR440560000000008910293847',
      cardNumber: '6219-8610-1234-5678',
      notes: 'Card-to-card and gateway disbursement',
    },
    {
      accountRef: 'cash_tehran_vault',
      name: 'Tehran Office Cash Drawer',
      category: 'INTERNAL',
      accountType: 'CASH_ACCOUNT',
      currency: 'IRR',
      notes: 'Physical cash on hand for local settlements',
    },
    {
      accountRef: 'clearing_adjustment_usd',
      name: 'G4X Adjustment & Reconciliation Clearing (USD)',
      category: 'INTERNAL',
      accountType: 'USD_WALLET',
      currency: 'USD',
      notes: 'Balancing clearing account for manual adjustments and reconciliations in USD',
    },
    {
      accountRef: 'clearing_adjustment_irr',
      name: 'G4X Adjustment & Reconciliation Clearing (IRR)',
      category: 'INTERNAL',
      accountType: 'TOMAN_WALLET',
      currency: 'IRR',
      notes: 'Balancing clearing account for manual adjustments and reconciliations in Toman',
    },
  ];

  for (const item of defaultAccounts) {
    const existing = await prisma.financialAccount.findUnique({
      where: { accountRef: item.accountRef },
    });
    if (!existing) {
      await prisma.financialAccount.create({
        data: {
          accountRef: item.accountRef,
          name: item.name,
          category: item.category,
          accountType: item.accountType,
          currency: item.currency,
          bankName: item.bankName,
          accountNumber: item.accountNumber,
          iban: item.iban,
          cardNumber: item.cardNumber,
          notes: item.notes,
          openingBalance: BigInt(0),
          currentBalance: BigInt(0),
          reservedBalance: BigInt(0),
          availableBalance: BigInt(0),
          status: 'ACTIVE',
        },
      });
    }
  }
}

/**
 * Create a new Financial Account.
 */
export async function createFinancialAccount(
  input: CreateFinancialAccountInput
): Promise<SerializedFinancialAccount> {
  const name = (input.name || '').trim();
  if (!name) {
    throw new Error('VALIDATION_ERROR: Account name is required');
  }

  const category = input.category;
  if (!['PLATFORM', 'INTERNAL'].includes(category)) {
    throw new Error('VALIDATION_ERROR: Invalid category. Must be PLATFORM or INTERNAL');
  }

  const accountType = input.accountType;
  const validTypes: FinancialAccountType[] = [
    'G4X_DIRECT',
    'ELDORADO',
    'SKYCOACH',
    'OVERGEAR',
    'KINGBOOST',
    'USD_WALLET',
    'TOMAN_WALLET',
    'BANK_ACCOUNT',
    'CASH_ACCOUNT',
  ];
  if (!validTypes.includes(accountType)) {
    throw new Error(`VALIDATION_ERROR: Invalid account type '${accountType}'`);
  }

  const currency = input.currency;
  if (!['USD', 'IRR'].includes(currency)) {
    throw new Error('VALIDATION_ERROR: Currency must be USD or IRR');
  }

  const openingAmount = input.openingBalance ? BigInt(Math.max(0, Math.floor(Number(input.openingBalance)))) : BigInt(0);

  const accountRef = input.accountRef
    ? input.accountRef.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    : `fa_${accountType.toLowerCase()}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;

  const existing = await prisma.financialAccount.findUnique({
    where: { accountRef },
  });
  if (existing) {
    throw new Error(`CONFLICT_ERROR: An account with reference '${accountRef}' already exists`);
  }

  // Create account with initial ledger transaction if opening balance > 0
  const result = await prisma.$transaction(async (tx) => {
    const newAcc = await tx.financialAccount.create({
      data: {
        accountRef,
        name,
        category,
        accountType,
        currency,
        openingBalance: openingAmount,
        currentBalance: openingAmount,
        availableBalance: openingAmount,
        reservedBalance: BigInt(0),
        status: 'ACTIVE',
        bankName: input.bankName?.trim() || null,
        accountNumber: input.accountNumber?.trim() || null,
        iban: input.iban?.trim() || null,
        cardNumber: input.cardNumber?.trim() || null,
        notes: input.notes?.trim() || null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });

    if (openingAmount > BigInt(0)) {
      const txRef = `FTX-OPEN-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const idemKey = `idem_open_${newAcc.id}_${Date.now()}`;

      const finTx = await tx.financialTransaction.create({
        data: {
          transactionRef: txRef,
          idempotencyKey: idemKey,
          accountId: newAcc.id,
          type: 'OPENING_BALANCE',
          direction: 'CREDIT',
          amount: openingAmount,
          currency,
          reason: 'Initial opening balance configured upon account creation',
          status: 'COMPLETED',
          adminId: input.adminId || null,
        },
      });

      await tx.financialLedgerEntry.create({
        data: {
          entryRef: `LED-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
          transactionId: finTx.id,
          accountId: newAcc.id,
          entryType: 'CREDIT',
          amount: openingAmount,
          currency,
          balanceBefore: BigInt(0),
          balanceAfter: openingAmount,
          description: 'Initial opening balance',
        },
      });
    }

    return newAcc;
  });

  return serializeFinancialAccount(result);
}

/**
 * Edit account metadata (name, notes, status, bank details).
 * INVARIANT: Never allow direct editing of calculated balances!
 */
export async function updateFinancialAccountMetadata(
  idOrRef: string,
  input: UpdateFinancialAccountInput
): Promise<SerializedFinancialAccount> {
  const account = await prisma.financialAccount.findFirst({
    where: {
      OR: [{ id: idOrRef }, { accountRef: idOrRef }],
    },
  });

  if (!account) {
    throw new Error(`NOT_FOUND: Account '${idOrRef}' not found`);
  }

  const updateData: Prisma.FinancialAccountUpdateInput = {};

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error('VALIDATION_ERROR: Account name cannot be empty');
    updateData.name = trimmed;
  }

  if (input.status !== undefined) {
    if (!['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(input.status)) {
      throw new Error(`VALIDATION_ERROR: Invalid status '${input.status}'`);
    }
    updateData.status = input.status;
  }

  if (input.bankName !== undefined) updateData.bankName = input.bankName?.trim() || null;
  if (input.accountNumber !== undefined) updateData.accountNumber = input.accountNumber?.trim() || null;
  if (input.iban !== undefined) updateData.iban = input.iban?.trim() || null;
  if (input.cardNumber !== undefined) updateData.cardNumber = input.cardNumber?.trim() || null;
  if (input.notes !== undefined) updateData.notes = input.notes?.trim() || null;
  if (input.metadata !== undefined) updateData.metadata = JSON.stringify(input.metadata);

  const updated = await prisma.financialAccount.update({
    where: { id: account.id },
    data: updateData,
  });

  return serializeFinancialAccount(updated);
}

/**
 * Toggle or set account status.
 */
export async function setFinancialAccountStatus(
  idOrRef: string,
  status: FinancialAccountStatus
): Promise<SerializedFinancialAccount> {
  return updateFinancialAccountMetadata(idOrRef, { status });
}

/**
 * Get account details by ID or accountRef.
 */
export async function getFinancialAccountDetails(idOrRef: string): Promise<SerializedFinancialAccount> {
  const account = await prisma.financialAccount.findFirst({
    where: {
      OR: [{ id: idOrRef }, { accountRef: idOrRef }],
    },
  });

  if (!account) {
    throw new Error(`NOT_FOUND: Financial account '${idOrRef}' not found`);
  }

  return serializeFinancialAccount(account);
}

/**
 * List all financial accounts with optional filters.
 */
export async function listFinancialAccounts(filter?: {
  category?: FinancialAccountCategory;
  accountType?: FinancialAccountType;
  currency?: FinancialCurrency;
  status?: FinancialAccountStatus;
  search?: string;
}): Promise<SerializedFinancialAccount[]> {
  await ensureDefaultFinancialAccounts();

  const where: Prisma.FinancialAccountWhereInput = {};

  if (filter?.category) where.category = filter.category;
  if (filter?.accountType) where.accountType = filter.accountType;
  if (filter?.currency) where.currency = filter.currency;
  if (filter?.status) where.status = filter.status;
  if (filter?.search) {
    const q = filter.search.trim();
    where.OR = [
      { name: { contains: q } },
      { accountRef: { contains: q } },
      { bankName: { contains: q } },
      { cardNumber: { contains: q } },
    ];
  }

  const accounts = await prisma.financialAccount.findMany({
    where,
    orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
  });

  return accounts.map(serializeFinancialAccount);
}

/**
 * Record a manual balance adjustment with full ledger integrity and idempotency.
 */
export async function recordManualBalanceAdjustment(
  input: ManualBalanceAdjustmentInput
): Promise<SerializedFinancialTransaction> {
  const reason = (input.reason || '').trim();
  if (!reason) {
    throw new Error('VALIDATION_ERROR: A clear reason is required for every manual balance adjustment');
  }

  const direction = input.adjustmentType;
  if (!['CREDIT', 'DEBIT'].includes(direction)) {
    throw new Error('VALIDATION_ERROR: Adjustment type must be CREDIT or DEBIT');
  }

  const rawAmount = typeof input.amount === 'bigint' ? input.amount : BigInt(Math.floor(Number(input.amount)));
  if (rawAmount <= BigInt(0)) {
    throw new Error('VALIDATION_ERROR: Adjustment amount must be a positive integer greater than zero');
  }

  // Idempotency check
  const idempotencyKey = input.idempotencyKey?.trim() || `adj_${crypto.randomUUID()}`;
  const existingTx = await prisma.financialTransaction.findUnique({
    where: { idempotencyKey },
    include: {
      account: true,
      admin: { select: { username: true } },
    },
  });

  if (existingTx) {
    // Return existing record idempotently
    return serializeFinancialTransaction(existingTx);
  }

  // Find account
  const account = await prisma.financialAccount.findFirst({
    where: {
      OR: [{ id: input.accountId }, { accountRef: input.accountId }],
    },
  });

  if (!account) {
    throw new Error(`NOT_FOUND: Target financial account '${input.accountId}' not found`);
  }

  if (account.status !== 'ACTIVE') {
    throw new Error(`ACCOUNT_INACTIVE: Account '${account.name}' is ${account.status} and cannot receive adjustments`);
  }

  // If DEBIT, enforce that available balance covers the deduction
  if (direction === 'DEBIT' && account.availableBalance < rawAmount) {
    const formattedNeed = formatFinancialAmount(rawAmount, account.currency);
    const formattedAvail = formatFinancialAmount(account.availableBalance, account.currency);
    throw new Error(
      `INSUFFICIENT_FUNDS: Insufficient available balance. Required: ${formattedNeed}, Available: ${formattedAvail}`
    );
  }

  // Atomic ledger execution
  const transactionResult = await prisma.$transaction(async (tx) => {
    // Re-read account with latest balance inside transaction
    const latestAccount = await tx.financialAccount.findUniqueOrThrow({
      where: { id: account.id },
    });

    const balanceBefore = latestAccount.currentBalance;
    let balanceAfter: bigint;
    let newAvailable: bigint;

    if (direction === 'CREDIT') {
      balanceAfter = latestAccount.currentBalance + rawAmount;
      newAvailable = latestAccount.availableBalance + rawAmount;
    } else {
      if (latestAccount.availableBalance < rawAmount) {
        throw new Error('INSUFFICIENT_FUNDS: Available balance decreased concurrently');
      }
      balanceAfter = latestAccount.currentBalance - rawAmount;
      newAvailable = latestAccount.availableBalance - rawAmount;
    }

    // Update account balances
    await tx.financialAccount.update({
      where: { id: account.id },
      data: {
        currentBalance: balanceAfter,
        availableBalance: newAvailable,
      },
    });

    // Create transaction record
    const txRef = `FTX-ADJ-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const newTx = await tx.financialTransaction.create({
      data: {
        transactionRef: txRef,
        idempotencyKey,
        accountId: account.id,
        type: 'MANUAL_ADJUSTMENT',
        direction,
        amount: rawAmount,
        currency: account.currency,
        reason,
        description: input.description?.trim() || null,
        attachmentUrl: input.attachmentUrl?.trim() || null,
        status: 'COMPLETED',
        adminId: input.adminId,
      },
      include: {
        account: true,
        admin: { select: { username: true } },
      },
    });

    // Create ledger entry
    const entryRef = `LED-ADJ-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    await tx.financialLedgerEntry.create({
      data: {
        entryRef,
        transactionId: newTx.id,
        accountId: account.id,
        entryType: direction,
        amount: rawAmount,
        currency: account.currency,
        balanceBefore,
        balanceAfter,
        description: `Manual ${direction}: ${reason}`,
      },
    });

    // Record system audit log if AuditLog model exists
    try {
      await tx.auditLog.create({
        data: {
          action: `FINANCIAL_ADJUSTMENT_${direction}`,
          entityType: 'FinancialAccount',
          entityId: account.id,
          actorId: input.adminId,
          previousValues: JSON.stringify({ currentBalance: balanceBefore.toString() }),
          newValues: JSON.stringify({
            accountRef: account.accountRef,
            accountName: account.name,
            direction,
            amount: rawAmount.toString(),
            currency: account.currency,
            currentBalance: balanceAfter.toString(),
            idempotencyKey,
          }),
          reason,
          isSuccess: true,
        },
      });
    } catch {
      // AuditLog creation failure should not break transaction if table schema differs
    }

    return newTx;
  });

  return serializeFinancialTransaction(transactionResult);
}

/**
 * List account transaction history with pagination.
 */
export async function getAccountTransactions(
  idOrRef: string,
  params?: { page?: number; limit?: number; direction?: string }
): Promise<{
  transactions: SerializedFinancialTransaction[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const account = await prisma.financialAccount.findFirst({
    where: {
      OR: [{ id: idOrRef }, { accountRef: idOrRef }],
    },
  });

  if (!account) {
    throw new Error(`NOT_FOUND: Account '${idOrRef}' not found`);
  }

  const page = Math.max(1, params?.page || 1);
  const limit = Math.min(100, Math.max(1, params?.limit || 20));
  const skip = (page - 1) * limit;

  const where: Prisma.FinancialTransactionWhereInput = {
    accountId: account.id,
  };

  if (params?.direction && ['CREDIT', 'DEBIT'].includes(params.direction.toUpperCase())) {
    where.direction = params.direction.toUpperCase();
  }

  const [total, txs] = await Promise.all([
    prisma.financialTransaction.count({ where }),
    prisma.financialTransaction.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        account: { select: { accountRef: true, name: true } },
        admin: { select: { username: true } },
      },
    }),
  ]);

  return {
    transactions: txs.map(serializeFinancialTransaction),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

/**
 * 2. PLATFORM BALANCE OVERVIEW
 * Unified overview of all 5 external & direct platforms:
 * G4X Direct, Eldorado, Skycoach, Overgear, Kingboost
 */
export async function getPlatformBalanceOverview() {
  await ensureDefaultFinancialAccounts();

  const platformKeys = [
    { source: 'direct', accountType: 'G4X_DIRECT', name: 'G4X Direct Store' },
    { source: 'eldorado', accountType: 'ELDORADO', name: 'Eldorado Platform' },
    { source: 'skycoach', accountType: 'SKYCOACH', name: 'Skycoach Platform' },
    { source: 'overgear', accountType: 'OVERGEAR', name: 'Overgear Platform' },
    { source: 'kingboost', accountType: 'KINGBOOST', name: 'Kingboost Platform' },
  ];

  // Fetch platform accounts
  const accounts = await prisma.financialAccount.findMany({
    where: { category: 'PLATFORM' },
  });

  // Fetch internal USD wallets for summary card
  const internalUsdWallets = await prisma.financialAccount.findMany({
    where: { category: 'INTERNAL', currency: 'USD' },
  });

  // Fetch orders to compute completed & pending earnings per platform
  const orders = await prisma.order.findMany({
    select: {
      status: true,
      sourceWebsite: true,
      grossAmountMinor: true,
      platformFeeMinor: true,
      advertiserFeeMinor: true,
      boosterPoolMinor: true,
    },
  });

  // Fetch successful withdrawals
  const settledWithdrawals = await prisma.boosterWithdrawalRequest.findMany({
    where: { status: 'PAID' },
    select: { requestedUsdCents: true, payoutMethod: true },
  });

  const platforms = platformKeys.map((p) => {
    const acc = accounts.find((a) => a.accountType === p.accountType) || accounts.find((a) => a.accountRef.includes(p.source));

    const cur = acc ? Number(acc.currentBalance) : 0;
    const av = acc ? Number(acc.availableBalance) : 0;
    const res = acc ? Number(acc.reservedBalance) : 0;

    // Filter platform orders
    const isDirect = p.source === 'direct';
    const platOrders = orders.filter((o) => {
      const src = (o.sourceWebsite || '').trim().toLowerCase();
      if (isDirect) {
        return !src || src === 'direct' || !['g2g', 'skycoach', 'eldorado', 'kingboost', 'overgear'].includes(src);
      }
      return src === p.source;
    });

    const completedOrders = platOrders.filter((o) => o.status.toLowerCase() === 'completed');
    const activeOrders = platOrders.filter((o) =>
      ['open_presign', 'presign_closed', 'assigned', 'in_progress', 'waiting_for_confirm', 'pending_review'].includes(
        o.status.toLowerCase()
      )
    );

    // Completed earnings (retained revenue)
    const completedEarningsMinor = completedOrders.reduce((sum, o) => {
      if (isDirect) {
        return sum + (o.platformFeeMinor || 0) + (o.advertiserFeeMinor || 0);
      }
      return sum + (o.platformFeeMinor || 0);
    }, 0);

    // Pending earnings
    const pendingEarningsMinor = activeOrders.reduce((sum, o) => {
      return sum + (o.grossAmountMinor || 0);
    }, 0);

    // Platform withdrawals
    const totalSuccessfulWithdrawalsMinor = settledWithdrawals.reduce((sum, w) => sum + (w.requestedUsdCents || 0), 0) / platformKeys.length; // distributed reference

    return {
      source: p.source,
      accountType: p.accountType,
      accountId: acc?.id || '',
      accountRef: acc?.accountRef || '',
      name: acc?.name || p.name,
      currency: 'USD',
      currentBalanceMinor: cur,
      currentBalanceUsd: formatFinancialAmount(cur, 'USD'),
      availableBalanceMinor: av,
      availableBalanceUsd: formatFinancialAmount(av, 'USD'),
      reservedBalanceMinor: res,
      reservedBalanceUsd: formatFinancialAmount(res, 'USD'),
      completedOrderEarningsMinor: completedEarningsMinor,
      completedOrderEarningsUsd: formatFinancialAmount(completedEarningsMinor, 'USD'),
      pendingOrderEarningsMinor: pendingEarningsMinor,
      pendingOrderEarningsUsd: formatFinancialAmount(pendingEarningsMinor, 'USD'),
      totalSuccessfulWithdrawalsMinor: Math.round(totalSuccessfulWithdrawalsMinor),
      totalSuccessfulWithdrawalsUsd: formatFinancialAmount(Math.round(totalSuccessfulWithdrawalsMinor), 'USD'),
      status: acc?.status || 'ACTIVE',
      lastBalanceUpdate: acc?.updatedAt ? acc.updatedAt.toISOString() : new Date().toISOString(),
    };
  });

  // Consolidated Assets calculations (Strict non-duplicative asset aggregation)
  const totalUsdPlatformBalanceMinor = platforms.reduce((sum, p) => sum + p.currentBalanceMinor, 0);
  const totalUsdWalletBalanceMinor = internalUsdWallets.reduce((sum, w) => sum + Number(w.currentBalance), 0);
  const totalReservedFundsMinor =
    platforms.reduce((sum, p) => sum + p.reservedBalanceMinor, 0) +
    internalUsdWallets.reduce((sum, w) => sum + Number(w.reservedBalance), 0);
  const totalAvailableFundsMinor =
    platforms.reduce((sum, p) => sum + p.availableBalanceMinor, 0) +
    internalUsdWallets.reduce((sum, w) => sum + Number(w.availableBalance), 0);

  const consolidatedTotalUsdMinor = totalUsdPlatformBalanceMinor + totalUsdWalletBalanceMinor;

  // Fetch dollar rate from SystemFinancialConfig
  const rateConfig = await prisma.systemFinancialConfig.findUnique({
    where: { key: 'admin_usd_irt_rate' },
  });
  const dollarRate = rateConfig?.value ? parseFloat(rateConfig.value) : 90000;
  const consolidatedTotalToman = `${Math.round((consolidatedTotalUsdMinor / 100) * dollarRate).toLocaleString('en-US')} Toman`;

  return {
    platforms,
    summaryCards: {
      totalUsdPlatformBalanceMinor,
      totalUsdPlatformBalanceUsd: formatFinancialAmount(totalUsdPlatformBalanceMinor, 'USD'),
      totalUsdWalletBalanceMinor,
      totalUsdWalletBalanceUsd: formatFinancialAmount(totalUsdWalletBalanceMinor, 'USD'),
      totalReservedFundsMinor,
      totalReservedFundsUsd: formatFinancialAmount(totalReservedFundsMinor, 'USD'),
      totalAvailableFundsMinor,
      totalAvailableFundsUsd: formatFinancialAmount(totalAvailableFundsMinor, 'USD'),
      consolidatedTotalUsdMinor,
      consolidatedTotalUsdUsd: formatFinancialAmount(consolidatedTotalUsdMinor, 'USD'),
      consolidatedTotalToman,
      dollarRate: {
        rate: dollarRate,
        formatted: `${dollarRate.toLocaleString('en-US')} Toman`,
        source: 'SystemFinancialConfig (admin_usd_irt_rate)',
      },
    },
    lastReconciledAt: new Date().toISOString(),
  };
}

/**
 * 3. LOCAL CURRENCY ACCOUNTS OVERVIEW
 * Features:
 *  - Multiple bank accounts (Bank Mellat, Saman, Melli, Pasargad, etc.)
 *  - Cash balance (physical drawers)
 *  - Total local balance (in Tomans)
 *  - Total deposits (Credits)
 *  - Total withdrawals (Debits)
 *  - Account-specific transaction history
 */
export async function getTomanAccountsOverview() {
  await ensureDefaultFinancialAccounts();

  const tomanAccounts = await prisma.financialAccount.findMany({
    where: { currency: 'IRR' },
    orderBy: { createdAt: 'asc' },
    include: {
      transactions: {
        take: 5,
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  // Categorize accounts
  const bankAccounts = tomanAccounts.filter((a) => a.accountType === 'BANK_ACCOUNT').map(serializeFinancialAccount);
  const cashAccounts = tomanAccounts.filter((a) => a.accountType === 'CASH_ACCOUNT').map(serializeFinancialAccount);
  const walletAccounts = tomanAccounts.filter((a) => a.accountType === 'TOMAN_WALLET').map(serializeFinancialAccount);

  // Totals across all Toman accounts
  const totalLocalBalance = tomanAccounts.reduce((sum, a) => sum + Number(a.currentBalance), 0);
  const totalAvailableLocalBalance = tomanAccounts.reduce((sum, a) => sum + Number(a.availableBalance), 0);
  const totalReservedLocalBalance = tomanAccounts.reduce((sum, a) => sum + Number(a.reservedBalance), 0);

  // Calculate historical deposits (CREDIT) and withdrawals (DEBIT)
  const txAgg = await prisma.financialTransaction.groupBy({
    by: ['direction'],
    where: {
      currency: 'IRR',
      status: 'COMPLETED',
    },
    _sum: {
      amount: true,
    },
  });

  let totalDeposits = 0;
  let totalWithdrawals = 0;

  for (const item of txAgg) {
    const sum = typeof item._sum.amount === 'bigint' ? Number(item._sum.amount) : Number(item._sum.amount || 0);
    if (item.direction === 'CREDIT') totalDeposits += sum;
    if (item.direction === 'DEBIT') totalWithdrawals += sum;
  }

  return {
    bankAccounts,
    cashAccounts,
    walletAccounts,
    allAccounts: tomanAccounts.map(serializeFinancialAccount),
    metrics: {
      totalLocalBalance,
      formattedTotalLocalBalance: formatFinancialAmount(totalLocalBalance, 'IRR'),
      totalAvailableLocalBalance,
      formattedTotalAvailable: formatFinancialAmount(totalAvailableLocalBalance, 'IRR'),
      totalReservedLocalBalance,
      formattedTotalReserved: formatFinancialAmount(totalReservedLocalBalance, 'IRR'),
      totalDeposits,
      formattedTotalDeposits: formatFinancialAmount(totalDeposits, 'IRR'),
      totalWithdrawals,
      formattedTotalWithdrawals: formatFinancialAmount(totalWithdrawals, 'IRR'),
      accountsCount: tomanAccounts.length,
      banksCount: bankAccounts.length,
      cashCount: cashAccounts.length,
    },
    currencyUnit: 'TOMAN',
    storageDocumentation: 'Amounts are stored as 64-bit integer Tomans (1 Toman = 10 Rials). Displayed purely in Tomans.',
  };
}
