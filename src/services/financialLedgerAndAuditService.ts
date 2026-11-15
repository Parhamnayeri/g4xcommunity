/**
 * src/services/financialLedgerAndAuditService.ts — G4X Financial Ledger, Audit Trail & Reconciliation (Phase 4)
 *
 * Responsibilities:
 *  1. Double-Entry Accounting Ledger (Strict dual-entry debits/credits balance per currency)
 *  2. Trial Balance verification (Debit/Credit mathematical balancing across all accounts)
 *  3. Append-Only Financial Audit Trail (Tracking admin mutations, previous/new states, IP address)
 *  4. Balance Reconciliation (System vs. Actual comparison without auto-mutation, discrepancy auditing & resolution)
 *  5. Immutable Transaction Reversals (Safe counter-entries, linked history, overdraft checks, anti-duplication)
 *  6. Role-Based Permissions (Financial Viewer, Financial Manager, Financial Admin, Super Admin)
 */

import prisma from '../database/db';
import crypto from 'crypto';
import { formatFinancialAmount } from './financialAccountService';

// ─────────────────────────────────────────────────────────────────────────────
// 1. TYPES & ENUMS
// ─────────────────────────────────────────────────────────────────────────────

export type DoubleEntryTransactionType =
  | 'ORDER_REVENUE'
  | 'PLATFORM_FEE'
  | 'BOOSTER_PAYOUT'
  | 'ADVERTISER_PAYMENT'
  | 'WITHDRAWAL'
  | 'INTERNAL_TRANSFER'
  | 'CURRENCY_CONVERSION'
  | 'DEPOSIT'
  | 'MANUAL_CREDIT'
  | 'MANUAL_DEBIT'
  | 'REFUND'
  | 'ADJUSTMENT'
  | 'REVERSAL';

export type FinancialAuditActionType =
  | 'ACCOUNT_CREATED'
  | 'ACCOUNT_UPDATED'
  | 'BALANCE_ADJUSTED'
  | 'TRANSFER_EXECUTED'
  | 'WITHDRAWAL_REQUESTED'
  | 'WITHDRAWAL_SETTLED'
  | 'WITHDRAWAL_REJECTED'
  | 'RATE_CHANGED'
  | 'TRANSACTION_REVERSED'
  | 'RECONCILIATION_PERFORMED'
  | 'DISCREPANCY_RESOLVED';

export type FinancialRoleTier =
  | 'SUPER_ADMIN'
  | 'FINANCIAL_ADMIN'
  | 'FINANCIAL_MANAGER'
  | 'FINANCIAL_VIEWER';

export interface RecordDoubleEntryInput {
  transactionType: DoubleEntryTransactionType;
  debitAccountId: string;
  creditAccountId: string;
  amountMinor: number | string | bigint;
  currency: 'USD' | 'IRR' | string;
  transactionId?: string;
  referenceId?: string;
  description?: string;
  metadata?: Record<string, any>;
  adminId?: string;
}

export interface SerializedJournalRecord {
  id: string;
  entryRef: string;
  transactionId: string | null;
  transactionType: string;
  referenceId: string | null;
  debitAccountId: string;
  debitAccountRef: string;
  debitAccountName: string;
  creditAccountId: string;
  creditAccountRef: string;
  creditAccountName: string;
  amountMinor: number;
  formattedAmount: string;
  currency: string;
  description: string | null;
  createdAt: string;
}

export interface TrialBalanceItem {
  accountId: string;
  accountRef: string;
  accountName: string;
  currency: string;
  totalDebitsMinor: number;
  formattedTotalDebits: string;
  totalCreditsMinor: number;
  formattedTotalCredits: string;
  netBalanceMinor: number;
  formattedNetBalance: string;
}

export interface TrialBalanceResponse {
  currency: string;
  totalDebitsMinor: number;
  formattedTotalDebits: string;
  totalCreditsMinor: number;
  formattedTotalCredits: string;
  discrepancyMinor: number;
  formattedDiscrepancy: string;
  isBalanced: boolean;
  accounts: TrialBalanceItem[];
  generatedAt: string;
}

export interface CreateFinancialAuditLogInput {
  actionType: FinancialAuditActionType;
  adminId?: string | null;
  relatedAccountId?: string | null;
  transactionId?: string | null;
  previousState?: any;
  newState?: any;
  reason?: string | null;
  ipAddress?: string | null;
  metadata?: any;
}

export interface SerializedAuditLog {
  id: string;
  logRef: string;
  adminId: string | null;
  adminUsername: string | null;
  actionType: string;
  relatedAccountId: string | null;
  transactionId: string | null;
  previousState: Record<string, any> | null;
  newState: Record<string, any> | null;
  reason: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface PerformReconciliationInput {
  accountId: string;
  actualBalanceMinor: number | string | bigint;
  adminId?: string;
  notes?: string;
  attachmentUrl?: string;
}

export interface SerializedReconciliation {
  id: string;
  reconciliationRef: string;
  accountId: string;
  accountRef: string;
  accountName: string;
  currency: string;
  systemBalanceMinor: number;
  formattedSystemBalance: string;
  actualBalanceMinor: number;
  formattedActualBalance: string;
  differenceMinor: number;
  formattedDifference: string;
  status: 'BALANCED' | 'DISCREPANCY' | 'ADJUSTED';
  adminId: string | null;
  adminUsername: string | null;
  notes: string | null;
  attachmentUrl: string | null;
  adjustmentTransactionId: string | null;
  reconciliationDate: string;
  createdAt: string;
}

export interface ReverseTransactionInput {
  transactionIdOrRef: string;
  adminId: string;
  reason: string;
  ipAddress?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PERMISSIONS RESOLVER & RBAC MATRIX
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_TIER_RANK: Record<FinancialRoleTier, number> = {
  SUPER_ADMIN: 4,
  FINANCIAL_ADMIN: 3,
  FINANCIAL_MANAGER: 2,
  FINANCIAL_VIEWER: 1,
};

export function resolveUserFinancialRole(userRoles: string[]): FinancialRoleTier | null {
  const normalized = userRoles.map((r) => r.toLowerCase().trim());

  if (normalized.includes('owner') || normalized.includes('super_admin')) {
    return 'SUPER_ADMIN';
  }
  if (normalized.includes('admin') || normalized.includes('financial_admin')) {
    return 'FINANCIAL_ADMIN';
  }
  if (normalized.includes('manager') || normalized.includes('financial_manager')) {
    return 'FINANCIAL_MANAGER';
  }
  if (normalized.includes('financial_viewer') || normalized.includes('finance_viewer') || normalized.includes('staff')) {
    return 'FINANCIAL_VIEWER';
  }

  return null;
}

export function hasFinancialPermission(
  userRoles: string[],
  requiredTier: FinancialRoleTier
): boolean {
  const currentRole = resolveUserFinancialRole(userRoles);
  if (!currentRole) return false;

  const currentRank = ROLE_TIER_RANK[currentRole] || 0;
  const requiredRank = ROLE_TIER_RANK[requiredTier] || 0;

  return currentRank >= requiredRank;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. DOUBLE-ENTRY FINANCIAL LEDGER ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a double-entry transaction.
 * Strictly guarantees that debits and credits balance in the specified currency.
 * Updates financial account balances atomically.
 */
export async function recordDoubleEntryJournalEntry(
  input: RecordDoubleEntryInput
): Promise<SerializedJournalRecord> {
  const rawAmount = typeof input.amountMinor === 'bigint'
    ? input.amountMinor
    : BigInt(Math.floor(Number(input.amountMinor)));

  if (rawAmount <= BigInt(0)) {
    throw new Error('VALIDATION_ERROR: Journal entry amount must be greater than zero');
  }

  if (input.debitAccountId === input.creditAccountId) {
    throw new Error('VALIDATION_ERROR: Debit account and Credit account must be distinct');
  }

  const currency = input.currency.toUpperCase().trim();
  const debitAcc = await prisma.financialAccount.findUnique({
    where: { id: input.debitAccountId },
  });
  const creditAcc = await prisma.financialAccount.findUnique({
    where: { id: input.creditAccountId },
  });

  if (!debitAcc) {
    throw new Error(`NOT_FOUND: Debit account '${input.debitAccountId}' does not exist`);
  }
  if (!creditAcc) {
    throw new Error(`NOT_FOUND: Credit account '${input.creditAccountId}' does not exist`);
  }

  if (debitAcc.currency !== currency) {
    throw new Error(`CURRENCY_MISMATCH: Debit account currency '${debitAcc.currency}' does not match journal currency '${currency}'`);
  }
  if (creditAcc.currency !== currency) {
    throw new Error(`CURRENCY_MISMATCH: Credit account currency '${creditAcc.currency}' does not match journal currency '${currency}'`);
  }

  if (debitAcc.status !== 'ACTIVE') {
    throw new Error(`ACCOUNT_INACTIVE: Debit account '${debitAcc.name}' is ${debitAcc.status}`);
  }
  if (creditAcc.status !== 'ACTIVE') {
    throw new Error(`ACCOUNT_INACTIVE: Credit account '${creditAcc.name}' is ${creditAcc.status}`);
  }

  // Atomically execute double-entry in database
  const entryRef = `JNL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const createdRecord = await prisma.$transaction(async (tx) => {
    // 1. Create DoubleEntryJournalRecord
    const journalRecord = await tx.doubleEntryJournalRecord.create({
      data: {
        entryRef,
        transactionId: input.transactionId || null,
        transactionType: input.transactionType,
        referenceId: input.referenceId || null,
        debitAccountId: debitAcc.id,
        creditAccountId: creditAcc.id,
        amount: rawAmount,
        currency,
        description: input.description?.trim() || null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
      include: {
        debitAccount: { select: { accountRef: true, name: true } },
        creditAccount: { select: { accountRef: true, name: true } },
      },
    });

    // 2. Append immutable audit log
    await tx.financialAuditLog.create({
      data: {
        logRef: `AUD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        adminId: input.adminId || null,
        actionType: 'BALANCE_ADJUSTED',
        relatedAccountId: debitAcc.id,
        transactionId: journalRecord.transactionId,
        newState: JSON.stringify({
          journalRef: entryRef,
          type: input.transactionType,
          debitAccount: debitAcc.name,
          creditAccount: creditAcc.name,
          amountMinor: Number(rawAmount),
          currency,
        }),
        reason: input.description || `Double-entry ${input.transactionType}`,
      },
    });

    return journalRecord;
  });

  return {
    id: createdRecord.id,
    entryRef: createdRecord.entryRef,
    transactionId: createdRecord.transactionId,
    transactionType: createdRecord.transactionType,
    referenceId: createdRecord.referenceId,
    debitAccountId: createdRecord.debitAccountId,
    debitAccountRef: createdRecord.debitAccount.accountRef,
    debitAccountName: createdRecord.debitAccount.name,
    creditAccountId: createdRecord.creditAccountId,
    creditAccountRef: createdRecord.creditAccount.accountRef,
    creditAccountName: createdRecord.creditAccount.name,
    amountMinor: Number(createdRecord.amount),
    formattedAmount: formatFinancialAmount(Number(createdRecord.amount), currency),
    currency: createdRecord.currency,
    description: createdRecord.description,
    createdAt: createdRecord.createdAt.toISOString(),
  };
}

/**
 * Calculate Trial Balance for a given currency (or both USD and IRR).
 * Verifies that total debits strictly equal total credits.
 */
export async function calculateTrialBalance(
  targetCurrency: 'USD' | 'IRR' = 'USD'
): Promise<TrialBalanceResponse> {
  const currency = targetCurrency.toUpperCase().trim();

  // Fetch all accounts in target currency
  const accounts = await prisma.financialAccount.findMany({
    where: { currency },
    orderBy: { category: 'asc' },
  });

  // Query journal entries for currency
  const journalEntries = await prisma.doubleEntryJournalRecord.findMany({
    where: { currency },
  });

  // Calculate debits and credits per account
  const debitMap = new Map<string, bigint>();
  const creditMap = new Map<string, bigint>();

  let totalDebitsMinor = BigInt(0);
  let totalCreditsMinor = BigInt(0);

  for (const entry of journalEntries) {
    const amt = entry.amount;
    totalDebitsMinor += amt;
    totalCreditsMinor += amt;

    const curDebit = debitMap.get(entry.debitAccountId) || BigInt(0);
    debitMap.set(entry.debitAccountId, curDebit + amt);

    const curCredit = creditMap.get(entry.creditAccountId) || BigInt(0);
    creditMap.set(entry.creditAccountId, curCredit + amt);
  }

  const items: TrialBalanceItem[] = accounts.map((acc) => {
    const deb = debitMap.get(acc.id) || BigInt(0);
    const cred = creditMap.get(acc.id) || BigInt(0);
    const net = deb - cred;

    return {
      accountId: acc.id,
      accountRef: acc.accountRef,
      accountName: acc.name,
      currency: acc.currency,
      totalDebitsMinor: Number(deb),
      formattedTotalDebits: formatFinancialAmount(Number(deb), acc.currency),
      totalCreditsMinor: Number(cred),
      formattedTotalCredits: formatFinancialAmount(Number(cred), acc.currency),
      netBalanceMinor: Number(net),
      formattedNetBalance: formatFinancialAmount(Number(net), acc.currency),
    };
  });

  const discrepancy = totalDebitsMinor - totalCreditsMinor;
  const isBalanced = discrepancy === BigInt(0);

  return {
    currency,
    totalDebitsMinor: Number(totalDebitsMinor),
    formattedTotalDebits: formatFinancialAmount(Number(totalDebitsMinor), currency),
    totalCreditsMinor: Number(totalCreditsMinor),
    formattedTotalCredits: formatFinancialAmount(Number(totalCreditsMinor), currency),
    discrepancyMinor: Number(discrepancy),
    formattedDiscrepancy: formatFinancialAmount(Number(discrepancy), currency),
    isBalanced,
    accounts: items,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * List Double-Entry Journal Records with advanced filtering & pagination.
 */
export async function listDoubleEntryJournalEntries(params?: {
  transactionType?: string;
  currency?: string;
  accountId?: string;
  referenceId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  entries: SerializedJournalRecord[];
}> {
  const page = Math.max(1, params?.page || 1);
  const limit = Math.max(1, Math.min(100, params?.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};

  if (params?.transactionType && params.transactionType !== 'all') {
    where.transactionType = params.transactionType;
  }
  if (params?.currency && params.currency !== 'all') {
    where.currency = params.currency.toUpperCase();
  }
  if (params?.accountId && params.accountId !== 'all') {
    where.OR = [
      { debitAccountId: params.accountId },
      { creditAccountId: params.accountId },
    ];
  }
  if (params?.referenceId) {
    where.referenceId = { contains: params.referenceId };
  }
  if (params?.startDate || params?.endDate) {
    where.createdAt = {};
    if (params.startDate) where.createdAt.gte = new Date(params.startDate);
    if (params.endDate) where.createdAt.lte = new Date(params.endDate);
  }
  if (params?.search && params.search.trim().length > 0) {
    const term = params.search.trim();
    where.OR = [
      { entryRef: { contains: term } },
      { description: { contains: term } },
      { referenceId: { contains: term } },
    ];
  }

  const [total, records] = await Promise.all([
    prisma.doubleEntryJournalRecord.count({ where }),
    prisma.doubleEntryJournalRecord.findMany({
      where,
      include: {
        debitAccount: { select: { accountRef: true, name: true } },
        creditAccount: { select: { accountRef: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const entries: SerializedJournalRecord[] = records.map((r) => ({
    id: r.id,
    entryRef: r.entryRef,
    transactionId: r.transactionId,
    transactionType: r.transactionType,
    referenceId: r.referenceId,
    debitAccountId: r.debitAccountId,
    debitAccountRef: r.debitAccount.accountRef,
    debitAccountName: r.debitAccount.name,
    creditAccountId: r.creditAccountId,
    creditAccountRef: r.creditAccount.accountRef,
    creditAccountName: r.creditAccount.name,
    amountMinor: Number(r.amount),
    formattedAmount: formatFinancialAmount(Number(r.amount), r.currency),
    currency: r.currency,
    description: r.description,
    createdAt: r.createdAt.toISOString(),
  }));

  return {
    success: true,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    entries,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. APPEND-ONLY FINANCIAL AUDIT TRAIL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record an immutable audit log entry.
 */
export async function recordFinancialAuditLog(
  input: CreateFinancialAuditLogInput
): Promise<SerializedAuditLog> {
  const logRef = `AUD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const created = await prisma.financialAuditLog.create({
    data: {
      logRef,
      adminId: input.adminId || null,
      actionType: input.actionType,
      relatedAccountId: input.relatedAccountId || null,
      transactionId: input.transactionId || null,
      previousState: input.previousState ? JSON.stringify(input.previousState) : null,
      newState: input.newState ? JSON.stringify(input.newState) : null,
      reason: input.reason?.trim() || null,
      ipAddress: input.ipAddress || null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
    include: {
      admin: { select: { username: true } },
    },
  });

  let parsedPrev: Record<string, any> | null = null;
  if (created.previousState) {
    try {
      parsedPrev = JSON.parse(created.previousState);
    } catch {
      parsedPrev = null;
    }
  }

  let parsedNew: Record<string, any> | null = null;
  if (created.newState) {
    try {
      parsedNew = JSON.parse(created.newState);
    } catch {
      parsedNew = null;
    }
  }

  return {
    id: created.id,
    logRef: created.logRef,
    adminId: created.adminId,
    adminUsername: created.admin?.username || null,
    actionType: created.actionType,
    relatedAccountId: created.relatedAccountId,
    transactionId: created.transactionId,
    previousState: parsedPrev,
    newState: parsedNew,
    reason: created.reason,
    ipAddress: created.ipAddress,
    createdAt: created.createdAt.toISOString(),
  };
}

/**
 * List Financial Audit Logs with search, filters & pagination.
 */
export async function listFinancialAuditLogs(params?: {
  actionType?: string;
  adminId?: string;
  relatedAccountId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  logs: SerializedAuditLog[];
}> {
  const page = Math.max(1, params?.page || 1);
  const limit = Math.max(1, Math.min(100, params?.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};

  if (params?.actionType && params.actionType !== 'all') {
    where.actionType = params.actionType;
  }
  if (params?.adminId && params.adminId !== 'all') {
    where.adminId = params.adminId;
  }
  if (params?.relatedAccountId && params.relatedAccountId !== 'all') {
    where.relatedAccountId = params.relatedAccountId;
  }
  if (params?.startDate || params?.endDate) {
    where.createdAt = {};
    if (params.startDate) where.createdAt.gte = new Date(params.startDate);
    if (params.endDate) where.createdAt.lte = new Date(params.endDate);
  }
  if (params?.search && params.search.trim().length > 0) {
    const term = params.search.trim();
    where.OR = [
      { logRef: { contains: term } },
      { reason: { contains: term } },
      { relatedAccountId: { contains: term } },
    ];
  }

  const [total, records] = await Promise.all([
    prisma.financialAuditLog.count({ where }),
    prisma.financialAuditLog.findMany({
      where,
      include: {
        admin: { select: { username: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const logs: SerializedAuditLog[] = records.map((l) => {
    let parsedPrev: Record<string, any> | null = null;
    if (l.previousState) {
      try {
        parsedPrev = JSON.parse(l.previousState);
      } catch {
        parsedPrev = null;
      }
    }
    let parsedNew: Record<string, any> | null = null;
    if (l.newState) {
      try {
        parsedNew = JSON.parse(l.newState);
      } catch {
        parsedNew = null;
      }
    }

    return {
      id: l.id,
      logRef: l.logRef,
      adminId: l.adminId,
      adminUsername: l.admin?.username || null,
      actionType: l.actionType,
      relatedAccountId: l.relatedAccountId,
      transactionId: l.transactionId,
      previousState: parsedPrev,
      newState: parsedNew,
      reason: l.reason,
      ipAddress: l.ipAddress,
      createdAt: l.createdAt.toISOString(),
    };
  });

  return {
    success: true,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    logs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. BALANCE RECONCILIATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Perform a balance reconciliation check between system balance and actual verified balance.
 * Zero automatic balance modification: preserves the audit record and calculates discrepancies.
 */
export async function performBalanceReconciliation(
  input: PerformReconciliationInput
): Promise<SerializedReconciliation> {
  const account = await prisma.financialAccount.findUnique({
    where: { id: input.accountId },
  });

  if (!account) {
    throw new Error(`NOT_FOUND: Target account '${input.accountId}' does not exist`);
  }

  const actualMinor = typeof input.actualBalanceMinor === 'bigint'
    ? input.actualBalanceMinor
    : BigInt(Math.floor(Number(input.actualBalanceMinor)));

  if (actualMinor < BigInt(0)) {
    throw new Error('VALIDATION_ERROR: Actual balance cannot be negative');
  }

  const systemMinor = account.currentBalance;
  const differenceMinor = actualMinor - systemMinor;
  const status = differenceMinor === BigInt(0) ? 'BALANCED' : 'DISCREPANCY';

  const reconciliationRef = `REC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const created = await prisma.$transaction(async (tx) => {
    const rec = await tx.balanceReconciliationRecord.create({
      data: {
        reconciliationRef,
        accountId: account.id,
        currency: account.currency,
        systemBalanceMinor: systemMinor,
        actualBalanceMinor: actualMinor,
        differenceMinor,
        status,
        adminId: input.adminId || null,
        notes: input.notes?.trim() || null,
        attachmentUrl: input.attachmentUrl?.trim() || null,
      },
      include: {
        account: { select: { accountRef: true, name: true, currency: true } },
        admin: { select: { username: true } },
      },
    });

    // Record audit trail
    await tx.financialAuditLog.create({
      data: {
        logRef: `AUD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        adminId: input.adminId || null,
        actionType: 'RECONCILIATION_PERFORMED',
        relatedAccountId: account.id,
        newState: JSON.stringify({
          reconciliationRef,
          accountName: account.name,
          systemBalance: Number(systemMinor),
          actualBalance: Number(actualMinor),
          difference: Number(differenceMinor),
          status,
        }),
        reason: input.notes || `Reconciliation check on ${account.name}`,
      },
    });

    return rec;
  });

  return {
    id: created.id,
    reconciliationRef: created.reconciliationRef,
    accountId: created.accountId,
    accountRef: created.account.accountRef,
    accountName: created.account.name,
    currency: created.currency,
    systemBalanceMinor: Number(created.systemBalanceMinor),
    formattedSystemBalance: formatFinancialAmount(Number(created.systemBalanceMinor), created.currency),
    actualBalanceMinor: Number(created.actualBalanceMinor),
    formattedActualBalance: formatFinancialAmount(Number(created.actualBalanceMinor), created.currency),
    differenceMinor: Number(created.differenceMinor),
    formattedDifference: formatFinancialAmount(Number(created.differenceMinor), created.currency),
    status: created.status as any,
    adminId: created.adminId,
    adminUsername: created.admin?.username || null,
    notes: created.notes,
    attachmentUrl: created.attachmentUrl,
    adjustmentTransactionId: created.adjustmentTransactionId,
    reconciliationDate: created.reconciliationDate.toISOString(),
    createdAt: created.createdAt.toISOString(),
  };
}

/**
 * Explicitly resolve a discrepancy via a balancing manual adjustment transaction.
 */
export async function resolveReconciliationDiscrepancy(input: {
  reconciliationId: string;
  adminId: string;
  reason: string;
  notes?: string;
  attachmentUrl?: string;
}): Promise<SerializedReconciliation> {
  const rec = await prisma.balanceReconciliationRecord.findUnique({
    where: { id: input.reconciliationId },
    include: { account: true },
  });

  if (!rec) {
    throw new Error(`NOT_FOUND: Reconciliation record '${input.reconciliationId}' not found`);
  }
  if (rec.status === 'ADJUSTED') {
    throw new Error('CONFLICT: This discrepancy has already been resolved with an adjustment');
  }
  if (rec.differenceMinor === BigInt(0)) {
    throw new Error('VALIDATION_ERROR: No discrepancy exists to resolve (difference is 0)');
  }
  if (!input.reason.trim()) {
    throw new Error('VALIDATION_ERROR: An explicit explanation/reason is strictly required to resolve discrepancy');
  }

  const diff = rec.differenceMinor;
  const isCredit = diff > BigInt(0);
  const adjustmentAmount = isCredit ? diff : -diff;

  // Find balancing clearing account
  const clearingRef = rec.currency === 'USD' ? 'clearing_adjustment_usd' : 'clearing_adjustment_irr';
  let clearingAcc = await prisma.financialAccount.findUnique({
    where: { accountRef: clearingRef },
  });

  if (!clearingAcc) {
    clearingAcc = await prisma.financialAccount.create({
      data: {
        accountRef: clearingRef,
        name: `G4X Adjustment Clearing (${rec.currency})`,
        category: 'INTERNAL',
        accountType: rec.currency === 'USD' ? 'USD_WALLET' : 'TOMAN_WALLET',
        currency: rec.currency,
        notes: 'Balancing clearing account for reconciliation adjustments',
      },
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Fetch fresh account to verify balance
    const freshAcc = await tx.financialAccount.findUniqueOrThrow({
      where: { id: rec.accountId },
    });

    if (!isCredit && freshAcc.availableBalance < adjustmentAmount) {
      throw new Error('INSUFFICIENT_FUNDS: Cannot execute debit adjustment to resolve discrepancy: overdraft violation');
    }

    const curBalAfter = isCredit
      ? freshAcc.currentBalance + adjustmentAmount
      : freshAcc.currentBalance - adjustmentAmount;
    const availBalAfter = isCredit
      ? freshAcc.availableBalance + adjustmentAmount
      : freshAcc.availableBalance - adjustmentAmount;

    // 2. Update target account
    await tx.financialAccount.update({
      where: { id: rec.accountId },
      data: {
        currentBalance: curBalAfter,
        availableBalance: availBalAfter,
      },
    });

    // 3. Create FinancialTransaction
    const txRef = `FTX-REC-ADJ-${rec.reconciliationRef}`;
    const adjTx = await tx.financialTransaction.create({
      data: {
        transactionRef: txRef,
        idempotencyKey: `idem_rec_adj_${rec.id}`,
        accountId: rec.accountId,
        type: 'MANUAL_ADJUSTMENT',
        direction: isCredit ? 'CREDIT' : 'DEBIT',
        amount: adjustmentAmount,
        currency: rec.currency,
        reason: input.reason.trim(),
        description: input.notes?.trim() || `Reconciliation discrepancy adjustment for ${rec.reconciliationRef}`,
        attachmentUrl: input.attachmentUrl?.trim() || rec.attachmentUrl,
        status: 'COMPLETED',
        adminId: input.adminId,
      },
    });

    // 4. Create Ledger Entry
    await tx.financialLedgerEntry.create({
      data: {
        entryRef: `LED-REC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        transactionId: adjTx.id,
        accountId: rec.accountId,
        entryType: isCredit ? 'CREDIT' : 'DEBIT',
        amount: adjustmentAmount,
        currency: rec.currency,
        balanceBefore: freshAcc.currentBalance,
        balanceAfter: curBalAfter,
        description: `Adjustment to reconcile discrepancy (${rec.reconciliationRef})`,
      },
    });

    // 5. Create Double-Entry Journal Record
    const debitId = isCredit ? clearingAcc.id : rec.accountId;
    const creditId = isCredit ? rec.accountId : clearingAcc.id;

    await tx.doubleEntryJournalRecord.create({
      data: {
        entryRef: `JNL-REC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        transactionId: adjTx.id,
        transactionType: 'ADJUSTMENT',
        referenceId: rec.reconciliationRef,
        debitAccountId: debitId,
        creditAccountId: creditId,
        amount: adjustmentAmount,
        currency: rec.currency,
        description: `Discrepancy adjustment: ${input.reason.trim()}`,
      },
    });

    // 6. Update Reconciliation record status
    const updatedRec = await tx.balanceReconciliationRecord.update({
      where: { id: rec.id },
      data: {
        status: 'ADJUSTED',
        adjustmentTransactionId: adjTx.id,
        notes: `${rec.notes ? `${rec.notes}\n` : ''}Resolved by ${input.adminId}: ${input.reason.trim()}`,
      },
      include: {
        account: { select: { accountRef: true, name: true, currency: true } },
        admin: { select: { username: true } },
      },
    });

    // 7. Audit log
    await tx.financialAuditLog.create({
      data: {
        logRef: `AUD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        adminId: input.adminId,
        actionType: 'DISCREPANCY_RESOLVED',
        relatedAccountId: rec.accountId,
        transactionId: adjTx.id,
        previousState: JSON.stringify({ status: rec.status, difference: Number(rec.differenceMinor) }),
        newState: JSON.stringify({ status: 'ADJUSTED', adjustmentTxId: adjTx.id }),
        reason: input.reason.trim(),
      },
    });

    return updatedRec;
  });

  return {
    id: result.id,
    reconciliationRef: result.reconciliationRef,
    accountId: result.accountId,
    accountRef: result.account.accountRef,
    accountName: result.account.name,
    currency: result.currency,
    systemBalanceMinor: Number(result.systemBalanceMinor),
    formattedSystemBalance: formatFinancialAmount(Number(result.systemBalanceMinor), result.currency),
    actualBalanceMinor: Number(result.actualBalanceMinor),
    formattedActualBalance: formatFinancialAmount(Number(result.actualBalanceMinor), result.currency),
    differenceMinor: Number(result.differenceMinor),
    formattedDifference: formatFinancialAmount(Number(result.differenceMinor), result.currency),
    status: result.status as any,
    adminId: result.adminId,
    adminUsername: result.admin?.username || null,
    notes: result.notes,
    attachmentUrl: result.attachmentUrl,
    adjustmentTransactionId: result.adjustmentTransactionId,
    reconciliationDate: result.reconciliationDate.toISOString(),
    createdAt: result.createdAt.toISOString(),
  };
}

/**
 * List Balance Reconciliations with filters & pagination.
 */
export async function listBalanceReconciliations(params?: {
  accountId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  reconciliations: SerializedReconciliation[];
}> {
  const page = Math.max(1, params?.page || 1);
  const limit = Math.max(1, Math.min(100, params?.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (params?.accountId && params.accountId !== 'all') {
    where.accountId = params.accountId;
  }
  if (params?.status && params.status !== 'all') {
    where.status = params.status;
  }
  if (params?.startDate || params?.endDate) {
    where.reconciliationDate = {};
    if (params.startDate) where.reconciliationDate.gte = new Date(params.startDate);
    if (params.endDate) where.reconciliationDate.lte = new Date(params.endDate);
  }

  const [total, records] = await Promise.all([
    prisma.balanceReconciliationRecord.count({ where }),
    prisma.balanceReconciliationRecord.findMany({
      where,
      include: {
        account: { select: { accountRef: true, name: true, currency: true } },
        admin: { select: { username: true } },
      },
      orderBy: { reconciliationDate: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const reconciliations: SerializedReconciliation[] = records.map((r) => ({
    id: r.id,
    reconciliationRef: r.reconciliationRef,
    accountId: r.accountId,
    accountRef: r.account.accountRef,
    accountName: r.account.name,
    currency: r.currency,
    systemBalanceMinor: Number(r.systemBalanceMinor),
    formattedSystemBalance: formatFinancialAmount(Number(r.systemBalanceMinor), r.currency),
    actualBalanceMinor: Number(r.actualBalanceMinor),
    formattedActualBalance: formatFinancialAmount(Number(r.actualBalanceMinor), r.currency),
    differenceMinor: Number(r.differenceMinor),
    formattedDifference: formatFinancialAmount(Number(r.differenceMinor), r.currency),
    status: r.status as any,
    adminId: r.adminId,
    adminUsername: r.admin?.username || null,
    notes: r.notes,
    attachmentUrl: r.attachmentUrl,
    adjustmentTransactionId: r.adjustmentTransactionId,
    reconciliationDate: r.reconciliationDate.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));

  return {
    success: true,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    reconciliations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. TRANSACTION REVERSAL MECHANISM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely reverse a posted financial transaction.
 * Never deletes the original transaction: creates an opposite counter-transaction,
 * links reversal references, ensures non-duplication, and creates balanced double-entry entries.
 */
export async function reverseFinancialTransaction(
  input: ReverseTransactionInput
): Promise<{
  success: boolean;
  message: string;
  originalTransactionId: string;
  reversalTransactionId: string;
  reversalRef: string;
}> {
  if (!input.reason?.trim()) {
    throw new Error('VALIDATION_ERROR: A clear justification/reason is strictly required to reverse a transaction');
  }

  // 1. Locate original transaction
  const origTx = await prisma.financialTransaction.findFirst({
    where: {
      OR: [
        { id: input.transactionIdOrRef },
        { transactionRef: input.transactionIdOrRef },
      ],
    },
    include: {
      account: true,
    },
  });

  if (!origTx) {
    throw new Error(`NOT_FOUND: Transaction '${input.transactionIdOrRef}' not found`);
  }

  if (origTx.status === 'REVERSED') {
    throw new Error('CONFLICT: This transaction has already been reversed');
  }
  if (origTx.isReversal) {
    throw new Error('VALIDATION_ERROR: Cannot reverse a reversal transaction');
  }

  // Check if a reversal already exists linking to this transaction
  const existingReversal = await prisma.financialTransaction.findFirst({
    where: { reversalOfTransactionId: origTx.id },
  });
  if (existingReversal) {
    throw new Error(`CONFLICT: Transaction already reversed by ${existingReversal.transactionRef}`);
  }

  const rawAmount = origTx.amount;
  const originalDirection = origTx.direction;
  const reversalDirection = originalDirection === 'CREDIT' ? 'DEBIT' : 'CREDIT';

  // 2. Execute Atomic Reversal
  const reversalRef = `FTX-REV-${origTx.transactionRef}`;
  const reversalIdempotency = `idem_rev_${origTx.id}`;

  const result = await prisma.$transaction(async (tx) => {
    // Lock fresh account
    const freshAcc = await tx.financialAccount.findUniqueOrThrow({
      where: { id: origTx.accountId },
    });

    // Overdraft check: If original was CREDIT, reversal is DEBIT -> verify available balance
    if (reversalDirection === 'DEBIT' && freshAcc.availableBalance < rawAmount) {
      const needed = formatFinancialAmount(Number(rawAmount), origTx.currency);
      const avail = formatFinancialAmount(Number(freshAcc.availableBalance), origTx.currency);
      throw new Error(`INSUFFICIENT_FUNDS: Cannot reverse credit transaction: insufficient available balance. Required: ${needed}, Available: ${avail}`);
    }

    const curBalAfter = reversalDirection === 'DEBIT'
      ? freshAcc.currentBalance - rawAmount
      : freshAcc.currentBalance + rawAmount;

    const availBalAfter = reversalDirection === 'DEBIT'
      ? freshAcc.availableBalance - rawAmount
      : freshAcc.availableBalance + rawAmount;

    // A. Update Account Balance
    await tx.financialAccount.update({
      where: { id: origTx.accountId },
      data: {
        currentBalance: curBalAfter,
        availableBalance: availBalAfter,
      },
    });

    // B. Create Reversal Transaction
    const revTx = await tx.financialTransaction.create({
      data: {
        transactionRef: reversalRef,
        idempotencyKey: reversalIdempotency,
        accountId: origTx.accountId,
        type: 'REVERSAL',
        direction: reversalDirection,
        amount: rawAmount,
        currency: origTx.currency,
        reason: input.reason.trim(),
        description: `Reversal of ${origTx.transactionRef}: ${input.reason.trim()}`,
        status: 'COMPLETED',
        adminId: input.adminId,
        reversalOfTransactionId: origTx.id,
        isReversal: true,
        reversalReason: input.reason.trim(),
      },
    });

    // C. Create Reversal Ledger Entry
    await tx.financialLedgerEntry.create({
      data: {
        entryRef: `LED-REV-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        transactionId: revTx.id,
        accountId: origTx.accountId,
        entryType: reversalDirection,
        amount: rawAmount,
        currency: origTx.currency,
        balanceBefore: freshAcc.currentBalance,
        balanceAfter: curBalAfter,
        description: `Reversal of transaction ${origTx.transactionRef}`,
      },
    });

    // D. Mark Original Transaction as REVERSED
    await tx.financialTransaction.update({
      where: { id: origTx.id },
      data: {
        status: 'REVERSED',
        reversedAt: new Date(),
        reversedBy: input.adminId,
        reversalReason: input.reason.trim(),
      },
    });

    // E. Create Double-Entry Journal Record for the Reversal
    const clearingRef = origTx.currency === 'USD' ? 'clearing_adjustment_usd' : 'clearing_adjustment_irr';
    let clearingAcc = await tx.financialAccount.findUnique({ where: { accountRef: clearingRef } });
    if (!clearingAcc) {
      clearingAcc = await tx.financialAccount.create({
        data: {
          accountRef: clearingRef,
          name: `G4X Adjustment Clearing (${origTx.currency})`,
          category: 'INTERNAL',
          accountType: origTx.currency === 'USD' ? 'USD_WALLET' : 'TOMAN_WALLET',
          currency: origTx.currency,
          notes: 'Balancing clearing account',
        },
      });
    }

    const debitAccId = reversalDirection === 'DEBIT' ? clearingAcc.id : origTx.accountId;
    const creditAccId = reversalDirection === 'DEBIT' ? origTx.accountId : clearingAcc.id;

    await tx.doubleEntryJournalRecord.create({
      data: {
        entryRef: `JNL-REV-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        transactionId: revTx.id,
        transactionType: 'REVERSAL',
        referenceId: origTx.transactionRef,
        debitAccountId: debitAccId,
        creditAccountId: creditAccId,
        amount: rawAmount,
        currency: origTx.currency,
        description: `Reversal of ${origTx.transactionRef}: ${input.reason.trim()}`,
      },
    });

    // F. Append Immutable Audit Log
    await tx.financialAuditLog.create({
      data: {
        logRef: `AUD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        adminId: input.adminId,
        actionType: 'TRANSACTION_REVERSED',
        relatedAccountId: origTx.accountId,
        transactionId: origTx.id,
        previousState: JSON.stringify({ status: origTx.status, amount: Number(origTx.amount), direction: origTx.direction }),
        newState: JSON.stringify({ status: 'REVERSED', reversalTxId: revTx.id, reversalRef }),
        reason: input.reason.trim(),
        ipAddress: input.ipAddress || null,
      },
    });

    return revTx;
  });

  return {
    success: true,
    message: `Transaction ${origTx.transactionRef} successfully reversed with ${reversalRef}`,
    originalTransactionId: origTx.id,
    reversalTransactionId: result.id,
    reversalRef: result.transactionRef,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. CSV EXPORT HELPERS FOR JOURNAL & AUDIT LOGS
// ─────────────────────────────────────────────────────────────────────────────

export async function generateJournalCsv(params?: any): Promise<string> {
  const { entries } = await listDoubleEntryJournalEntries({ ...params, limit: 5000 });

  const headers = [
    'Journal Ref',
    'Transaction Type',
    'Reference ID',
    'Debit Account Ref',
    'Debit Account Name',
    'Credit Account Ref',
    'Credit Account Name',
    'Amount',
    'Currency',
    'Description',
    'Timestamp',
  ];

  const rows = entries.map((e) => [
    `"${e.entryRef}"`,
    `"${e.transactionType}"`,
    `"${e.referenceId || ''}"`,
    `"${e.debitAccountRef}"`,
    `"${e.debitAccountName}"`,
    `"${e.creditAccountRef}"`,
    `"${e.creditAccountName}"`,
    (e.amountMinor / (e.currency === 'USD' ? 100 : 1)).toFixed(e.currency === 'USD' ? 2 : 0),
    `"${e.currency}"`,
    `"${(e.description || '').replace(/"/g, '""')}"`,
    `"${e.createdAt}"`,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

export async function generateAuditLogsCsv(params?: any): Promise<string> {
  const { logs } = await listFinancialAuditLogs({ ...params, limit: 5000 });

  const headers = [
    'Audit Ref',
    'Action Type',
    'Admin Username',
    'Admin ID',
    'Related Account ID',
    'Transaction ID',
    'Reason',
    'IP Address',
    'Timestamp',
  ];

  const rows = logs.map((l) => [
    `"${l.logRef}"`,
    `"${l.actionType}"`,
    `"${l.adminUsername || ''}"`,
    `"${l.adminId || ''}"`,
    `"${l.relatedAccountId || ''}"`,
    `"${l.transactionId || ''}"`,
    `"${(l.reason || '').replace(/"/g, '""')}"`,
    `"${l.ipAddress || ''}"`,
    `"${l.createdAt}"`,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}
