/**
 * frontend/src/types/financialLedger.ts — Phase 4 Financial Ledger, Audit Trail & Reconciliation Types
 */

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

export interface UserFinancialRoleInfo {
  success: boolean;
  userId: string;
  username: string;
  roles: string[];
  financialTier: FinancialRoleTier | null;
  canView: boolean;
  canManage: boolean;
  canAdmin: boolean;
  isSuperAdmin: boolean;
}

export interface JournalRecordItem {
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

export interface TrialBalanceAccountItem {
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

export interface TrialBalanceData {
  currency: string;
  totalDebitsMinor: number;
  formattedTotalDebits: string;
  totalCreditsMinor: number;
  formattedTotalCredits: string;
  discrepancyMinor: number;
  formattedDiscrepancy: string;
  isBalanced: boolean;
  accounts: TrialBalanceAccountItem[];
  generatedAt: string;
}

export interface FinancialAuditLogItem {
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

export interface BalanceReconciliationItem {
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
