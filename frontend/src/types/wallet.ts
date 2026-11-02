/**
 * wallet.ts — Type definitions for Website Phase 5 React Wallet & Deposit Requests
 */

export interface WalletBalanceData {
  availableCents: number;
  availableUsd: string;
  reservedCents: number;
  reservedUsd: string;
  pendingEarningsCents: number;
  pendingEarningsUsd: string;
  confirmedEarningsCents: number;
  confirmedEarningsUsd: string;
  totalPaidCents: number;
  totalPaidUsd: string;
  totalRefundedCents: number;
  totalRefundedUsd: string;
  totalHeldCents: number;
  totalHeldUsd: string;
  lifetimeEarnedCents: number;
  lifetimeEarnedUsd: string;
  updatedAt: string;
}

export interface WalletBreakdownData {
  userEarningsConfirmedCents: number;
  userEarningsConfirmedUsd: string;
  userEarningsPendingCents: number;
  userEarningsPendingUsd: string;
  advertiserFundingDepositsCents: number;
  advertiserFundingDepositsUsd: string;
  orderEscrowReservedCents: number;
  orderEscrowReservedUsd: string;
  withdrawalReservedCents: number;
  withdrawalReservedUsd: string;
  externalUnsettledRevenueCents: number;
  externalUnsettledRevenueUsd: string;
}

export interface RatesAndPoliciesData {
  adminUsdIrtRate: number | null;
  incomingIrtFeeRate: number | null;
  isCryptoActive: boolean;
  cryptoLiveCollectionEnabled: boolean;
  liveCreditsEnabled: boolean;
  quoteTtlMinutes: number;
}

export interface OfficialBankDetailsData {
  bankName: string;
  cardNumber: string;
  accountHolder: string;
  iban?: string;
  isConfigured: boolean;
}

export interface WalletOverviewResponse {
  success: boolean;
  user: {
    discordId: string;
    username: string;
    roles: string[];
    isOwner: boolean;
  };
  wallet: WalletBalanceData;
  breakdown: WalletBreakdownData;
  ratesAndPolicies: RatesAndPoliciesData;
  bankDetails: OfficialBankDetailsData;
  error?: string;
}

export interface IrtQuoteData {
  targetUsdCents: number;
  adminUsdIrtRate: number;
  incomingIrtFeeRate: number;
  baseIrtAmount: number;
  feeIrtAmount: number;
  totalIrtAmount: number;
  quoteExpiresAt: string;
  quoteHash: string;
}

export interface IrtQuoteResponse {
  success: boolean;
  quote: IrtQuoteData;
  targetUsdCents: number;
  error?: string;
}

export interface ReceiptUploadResponse {
  success: boolean;
  fileKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  viewUrl: string;
  error?: string;
}

export interface SubmitIrtDepositInput {
  targetUsdCents: number;
  evidenceRef: string;
  payerIdentifier: string;
  senderCardLast4?: string;
  receiptFileKey?: string;
  paymentDate?: string;
  adminNotes?: string;
}

export interface SubmitIrtDepositResponse {
  success: boolean;
  fundingRequest?: {
    id: number;
    fundingRef: string;
    status: string;
    targetUsdCents: number;
    externalCurrency: string;
    externalAmountUnits: string;
    createdAt: string;
  };
  quote?: IrtQuoteData;
  message?: string;
  error?: string;
}

export interface DepositHistoryItem {
  id: number;
  fundingRef: string;
  fundingMethod: string;
  submittedAmount: string;
  submittedCurrency: string;
  exchangeRate: number | null;
  expectedUsdCents: number;
  expectedUsd: string;
  verifiedAmountUsd: string | null;
  creditedAmountUsd: string;
  hasBackedCredit: boolean;
  date: string;
  status: 'PENDING_ADMIN_VERIFICATION' | 'CONFIRMED_CREDITED' | 'REJECTED' | 'CANCELLED' | string;
  reviewOutcome: string;
  evidenceRef: string | null;
  payerIdentifier: string | null;
  adminNotes: string | null;
  verifiedAt: string | null;
  creditedAt: string | null;
}

export interface DepositHistoryResponse {
  success: boolean;
  deposits: DepositHistoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  error?: string;
}

export interface LedgerHistoryItem {
  id: number;
  entryRef: string;
  entryType: string;
  direction: 'CREDIT' | 'DEBIT';
  amountCents: number;
  amountUsd: string;
  balanceAfterAvailableCents: number | null;
  balanceAfterAvailableUsd: string | null;
  balanceAfterReservedCents: number | null;
  balanceAfterReservedUsd: string | null;
  accountType: string;
  postingGroupId: string;
  description: string;
  orderRef: string | null;
  createdAt: string;
}

export interface LedgerHistoryResponse {
  success: boolean;
  entries: LedgerHistoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  error?: string;
}
