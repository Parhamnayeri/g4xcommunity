/**
 * frontend/src/types/financialAccounts.ts
 * Type definitions for G4X Financial Accounts & Balance Management System (Phase 1)
 */

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

export interface FinancialAccountItem {
  id: string;
  accountRef: string;
  name: string;
  category: FinancialAccountCategory;
  accountType: FinancialAccountType;
  currency: FinancialCurrency;
  openingBalance: number;
  currentBalance: number;
  reservedBalance: number;
  availableBalance: number;
  formattedCurrent: string;
  formattedAvailable: string;
  formattedReserved: string;
  status: FinancialAccountStatus;
  bankName: string | null;
  accountNumber: string | null;
  iban: string | null;
  cardNumber: string | null;
  notes: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialTransactionItem {
  id: string;
  transactionRef: string;
  idempotencyKey: string;
  accountId: string;
  accountRef?: string;
  accountName?: string;
  type: string;
  direction: TransactionDirection;
  amount: number;
  currency: FinancialCurrency;
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

export interface PlatformOverviewItem {
  source: string;
  accountType: string;
  accountId: string;
  accountRef: string;
  name: string;
  currency: 'USD';
  currentBalanceMinor: number;
  currentBalanceUsd: string;
  availableBalanceMinor: number;
  availableBalanceUsd: string;
  reservedBalanceMinor: number;
  reservedBalanceUsd: string;
  completedOrderEarningsMinor: number;
  completedOrderEarningsUsd: string;
  pendingOrderEarningsMinor: number;
  pendingOrderEarningsUsd: string;
  totalSuccessfulWithdrawalsMinor: number;
  totalSuccessfulWithdrawalsUsd: string;
  status: string;
  lastBalanceUpdate: string;
}

export interface PlatformOverviewSummaryCards {
  totalUsdPlatformBalanceMinor: number;
  totalUsdPlatformBalanceUsd: string;
  totalUsdWalletBalanceMinor: number;
  totalUsdWalletBalanceUsd: string;
  totalReservedFundsMinor: number;
  totalReservedFundsUsd: string;
  totalAvailableFundsMinor: number;
  totalAvailableFundsUsd: string;
  consolidatedTotalUsdMinor: number;
  consolidatedTotalUsdUsd: string;
}

export interface PlatformBalanceOverviewResponse {
  success: boolean;
  platforms: PlatformOverviewItem[];
  summaryCards: PlatformOverviewSummaryCards;
  lastReconciledAt: string;
}

export interface TomanOverviewMetrics {
  totalLocalBalance: number;
  formattedTotalLocalBalance: string;
  totalAvailableLocalBalance: number;
  formattedTotalAvailable: string;
  totalReservedLocalBalance: number;
  formattedTotalReserved: string;
  totalDeposits: number;
  formattedTotalDeposits: string;
  totalWithdrawals: number;
  formattedTotalWithdrawals: string;
  accountsCount: number;
  banksCount: number;
  cashCount: number;
}

export interface TomanAccountsOverviewResponse {
  success: boolean;
  bankAccounts: FinancialAccountItem[];
  cashAccounts: FinancialAccountItem[];
  walletAccounts: FinancialAccountItem[];
  allAccounts: FinancialAccountItem[];
  metrics: TomanOverviewMetrics;
  currencyUnit: string;
  storageDocumentation: string;
}

export interface CreateAccountPayload {
  accountRef?: string;
  name: string;
  category: FinancialAccountCategory;
  accountType: FinancialAccountType;
  currency: FinancialCurrency;
  openingBalance?: number;
  bankName?: string;
  accountNumber?: string;
  iban?: string;
  cardNumber?: string;
  notes?: string;
  metadata?: Record<string, any>;
}

export interface UpdateAccountPayload {
  name?: string;
  status?: FinancialAccountStatus;
  bankName?: string;
  accountNumber?: string;
  iban?: string;
  cardNumber?: string;
  notes?: string;
  metadata?: Record<string, any>;
}

export interface ManualAdjustmentPayload {
  accountId: string;
  adjustmentType: TransactionDirection;
  amount: number;
  reason: string;
  description?: string;
  attachmentUrl?: string;
  idempotencyKey?: string;
}
