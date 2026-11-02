/**
 * withdraw.ts — تایپ‌های مربوط به فرآیند تسویه حساب و مدیریت مقاصد پرداخت
 */

export type WithdrawalPayoutMethod = 'USDT_BEP20' | 'IRT_BANK';

export interface WithdrawalWalletData {
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
  pendingWithdrawalRequestsCents: number;
  pendingWithdrawalRequestsUsd: string;
  eligibleWithdrawalCents: number;
  eligibleWithdrawalUsd: string;
}

export interface WithdrawalPolicyData {
  usdtBep20FeeCents: number;
  usdtBep20FeeUsd: string;
  irtBankFeeCents: number;
  irtBankFeeUsd: string;
  adminUsdIrtRate: number | null;
  irtRateDiscount: number;
  effectiveIrtRate: number | null;
  irtTuesdayCutoffHour: number | null;
  livePayoutsEnabled: boolean;
  scheduleSummary: string;
}

export interface UserPayoutPreferenceData {
  bankAccountHolder: string | null;
  bankIban: string | null;
  maskedBankIban: string | null;
  cryptoAddress: string | null;
  maskedCryptoAddress: string | null;
  cryptoNetwork: string;
  updatedAt?: string;
}

export interface WithdrawalOverviewResponse {
  success: boolean;
  wallet: WithdrawalWalletData;
  policy: WithdrawalPolicyData;
  payoutPreference: UserPayoutPreferenceData | null;
  error?: string;
}

export interface WithdrawalQuoteData {
  id: number;
  withdrawalRef: string;
  payoutMethod: WithdrawalPayoutMethod;
  requestedUsdCents: number;
  requestedUsd: string;
  fixedFeeUsdCents: number;
  fixedFeeUsd: string;
  netUsdCents: number;
  netUsd: string;
  quoteRate: number | null;
  effectiveRate: number | null;
  rateDiscount: number | null;
  quotedNetPayoutAmount: string;
  quotedCurrency: 'USDT' | 'IRT';
  destinationAddress: string;
  maskedDestinationAddress: string;
  destinationAccountHolder?: string | null;
  scheduledCycleDay?: string | null;
  scheduledCycleDate?: string | null;
  schedulingStatus?: string;
  quoteExpiresAt?: string;
  quoteHash?: string;
  status: string;
  simplifiedStatus: {
    label: string;
    colorClass: string;
    rawStatus: string;
  };
}

export interface WithdrawalQuoteResponse {
  success: boolean;
  quote: WithdrawalQuoteData;
  error?: string;
}

export interface WithdrawalConfirmResponse {
  success: boolean;
  request: {
    id: number;
    withdrawalRef: string;
    payoutMethod: WithdrawalPayoutMethod;
    requestedUsdCents: number;
    requestedUsd: string;
    fixedFeeUsdCents: number;
    fixedFeeUsd: string;
    netUsdCents: number;
    netUsd: string;
    quotedNetPayoutAmount: string;
    quotedCurrency: string;
    quoteRate: number | null;
    effectiveRate: number | null;
    destinationAddress: string;
    maskedDestinationAddress: string;
    destinationAccountHolder?: string | null;
    scheduledCycleDay?: string | null;
    scheduledCycleDate?: string | null;
    status: string;
    simplifiedStatus: {
      label: string;
      colorClass: string;
      rawStatus: string;
    };
    userConfirmedAt?: string;
    createdAt: string;
  };
  wallet: {
    availableCents: number;
    availableUsd: string;
    reservedCents: number;
    reservedUsd: string;
  };
  error?: string;
}

export interface WithdrawalHistoryItem {
  id: number;
  withdrawalRef: string;
  payoutMethod: string;
  requestedUsdCents: number;
  requestedUsd: string;
  fixedFeeUsdCents: number;
  fixedFeeUsd: string;
  netUsdCents: number;
  netUsd: string;
  quotedNetPayoutAmount: string;
  quotedCurrency: string;
  quoteRate: number | null;
  effectiveRate: number | null;
  destinationAddress: string;
  maskedDestinationAddress: string;
  destinationAccountHolder?: string | null;
  scheduledCycleDay?: string | null;
  scheduledCycleDate?: string | null;
  schedulingStatus?: string;
  status: string;
  simplifiedStatus: {
    label: string;
    colorClass: string;
    rawStatus: string;
  };
  externalTxHash?: string | null;
  rawTxHash?: string | null;
  bankReceiptRef?: string | null;
  rejectionReason?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  processedAt?: string | null;
}

export interface WithdrawalHistoryResponse {
  success: boolean;
  withdrawals: WithdrawalHistoryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  error?: string;
}
