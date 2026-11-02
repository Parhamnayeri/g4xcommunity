/**
 * payoutVerificationService.ts — اعتبارسنجی مدارک تسویه برون‌سیستمی و انطباق تراکنش‌های مالی
 *
 * اصول و الزامات امنیتی:
 *  ۱. رد هرگونه مقدار متنی دلخواه کاربر/ادمین بدون انطباق مستقل و موثق (Authoritative Reconciliation).
 *  ۲. برای تتر BEP-20: انطباق دقیق شبکه BSC، هش ۶۶ کاراکتری هگز، موفقیت تراکنش، آدرس گیرنده، قرارداد توکن USDT و مبلغ.
 *  ۳. برای تومان IRT: بررسی مدارک تسویه بانکی معتبر، تایید دوطرفه مالی و جلوگیری از ثبت ردیابی فاقد استناد.
 *  ۴. ممانعت قطعی از استفاده مجدد از مدارک تسویه در چندین درخواست (Duplicate Evidence Replay Prevention).
 *  ۵. در صورت در دسترس نبودن زیرساخت استعلام زنده یا غیرفعال بودن FINANCE_V2_LIVE_PAYOUTS_ENABLED،
 *     درخواست در وضعیت بررسی ادمین (UNDER_ADMIN_REVIEW / PROCESSING) باقی می‌ماند و وضعیت PAID ثبت نمی‌شود.
 */

import prisma from '../../database/db';
import { BoosterWithdrawalMethod, BoosterWithdrawalStatus } from './financeV2Types';

// آدرس‌های رسمی قرارداد توکن USDT روی شبکه BNB Smart Chain
export const BSC_USDT_CONTRACT_MAINNET = '0x55d398326f99059fF775485246999027B3197955'.toLowerCase();
export const BSC_USDT_CONTRACT_TESTNET = '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd'.toLowerCase();

export interface UsdtPayoutReconciliationEvidence {
  network: string; // e.g., 'BNB_SMART_CHAIN' | 'BSC' | 'BSC_TESTNET'
  txHash: string;
  tokenContract: string;
  recipientAddress: string;
  amountUnits: string; // e.g. "49.60"
  confirmed: boolean;
  status: 'SUCCESS' | 'FAILED';
  confirmations?: number;
  blockNumber?: number;
}

export interface IrtPayoutReconciliationEvidence {
  bankName: string;
  trackingCode: string;
  transferType: 'SATNA' | 'PAYA' | 'INTERNAL_CARD' | 'INTERNAL_ACCOUNT';
  transferTimestamp: Date | string;
  secondaryReviewerId?: string; // تایید دوطرفه کارشناس امور مالی
  reconciliationNotes?: string;
}

export interface PayoutReconciliationResult {
  verified: boolean;
  reason?: string;
  normalizedEvidenceRef?: string;
  reconciliationMetadata?: Record<string, any>;
}

/**
 * ۱. اعتبارسنجی قالب مدرک تسویه بر اساس روش برداشت
 */
export function validatePayoutEvidenceFormat(
  method: BoosterWithdrawalMethod,
  options: {
    externalTxHash?: string | null;
    bankReceiptRef?: string | null;
  }
): { isValid: boolean; error?: string; normalizedRef: string } {
  if (method === BoosterWithdrawalMethod.USDT_BEP20) {
    const tx = options.externalTxHash ? options.externalTxHash.trim() : '';
    if (!tx) {
      return { isValid: false, error: 'MISSING_TX_HASH: External transaction hash is required for BEP-20 payouts', normalizedRef: '' };
    }
    // هش تراکنش استاندارد EVM / BSC: پیشوند 0x و ۶۴ کاراکتر هگزادسیمال (مجموعاً ۶۶ کاراکتر)
    const bep20TxRegex = /^0x[0-9a-fA-F]{64}$/;
    if (!bep20TxRegex.test(tx)) {
      return {
        isValid: false,
        error: 'INVALID_BLOCKCHAIN_TX_HASH: Transaction hash must be a valid 66-character 0x-prefixed hexadecimal string on BNB Smart Chain',
        normalizedRef: '',
      };
    }
    return { isValid: true, normalizedRef: tx.toLowerCase() };
  } else if (method === BoosterWithdrawalMethod.IRT_BANK) {
    const ref = options.bankReceiptRef ? options.bankReceiptRef.trim() : '';
    if (!ref) {
      return { isValid: false, error: 'MISSING_BANK_RECEIPT: Bank tracking code or settlement reference is required for IRT payouts', normalizedRef: '' };
    }
    if (ref.length < 6 || ref.length > 50) {
      return {
        isValid: false,
        error: 'INVALID_BANK_RECEIPT_LENGTH: Bank reference number must be between 6 and 50 characters',
        normalizedRef: '',
      };
    }
    return { isValid: true, normalizedRef: ref };
  }

  return { isValid: false, error: `UNSUPPORTED_PAYOUT_METHOD: ${method}`, normalizedRef: '' };
}

/**
 * ۲. ممانعت از استفاده مجدد از مدرک تسویه در سایر درخواست‌ها (Duplicate Evidence Prevention)
 */
export async function assertNoDuplicatePayoutEvidence(
  method: BoosterWithdrawalMethod,
  normalizedRef: string,
  excludeRequestId: number,
  txClient: any = prisma
): Promise<void> {
  if (!normalizedRef) return;

  const whereClause: any = {
    id: { not: excludeRequestId },
    status: { in: [BoosterWithdrawalStatus.PAID, BoosterWithdrawalStatus.PROCESSING] },
  };

  if (method === BoosterWithdrawalMethod.USDT_BEP20) {
    whereClause.externalTxHash = { equals: normalizedRef };
  } else {
    whereClause.bankReceiptRef = { equals: normalizedRef };
  }

  const existing = await txClient.boosterWithdrawalRequest.findFirst({
    where: whereClause,
    select: { id: true, withdrawalRef: true, status: true },
  });

  if (existing) {
    throw new Error(
      `DUPLICATE_PAYOUT_EVIDENCE: Settlement evidence '${normalizedRef}' has already been recorded for withdrawal #${existing.id} (${existing.withdrawalRef})`
    );
  }
}

/**
 * ۳. انطباق مستقل تراکنش تتر BEP-20 روی زنجیره بلوکی
 */
export async function reconcileUsdtBep20Payout(
  request: {
    id: number;
    destinationAddress: string;
    quotedNetPayoutAmount: string;
  },
  txHash: string,
  evidence?: UsdtPayoutReconciliationEvidence | null
): Promise<PayoutReconciliationResult> {
  const normTx = txHash.toLowerCase();

  // در صورتی که مدرک تفصیلی انطباق ارسال شده باشد
  if (evidence) {
    if (evidence.txHash.toLowerCase() !== normTx) {
      return {
        verified: false,
        reason: 'RECONCILIATION_TX_MISMATCH: Provided reconciliation evidence txHash does not match target transaction',
      };
    }

    const netLower = evidence.network.toLowerCase();
    const isBsc = netLower.includes('bsc') || netLower.includes('bnb') || netLower.includes('binance');
    if (!isBsc) {
      return {
        verified: false,
        reason: `INVALID_BLOCKCHAIN_NETWORK: Expected BNB Smart Chain (BEP-20), received '${evidence.network}'`,
      };
    }

    if (evidence.status !== 'SUCCESS' || !evidence.confirmed) {
      return {
        verified: false,
        reason: 'TRANSACTION_NOT_CONFIRMED: Blockchain transaction is pending or failed on-chain',
      };
    }

    const expectedRecipient = request.destinationAddress.toLowerCase();
    if (evidence.recipientAddress.toLowerCase() !== expectedRecipient) {
      return {
        verified: false,
        reason: `RECIPIENT_ADDRESS_MISMATCH: On-chain recipient '${evidence.recipientAddress}' does not match withdrawal destination '${request.destinationAddress}'`,
      };
    }

    const tokenLower = evidence.tokenContract.toLowerCase();
    const isUsdtContract =
      tokenLower === BSC_USDT_CONTRACT_MAINNET ||
      tokenLower === BSC_USDT_CONTRACT_TESTNET ||
      (process.env.USDT_BEP20_CONTRACT_ADDRESS && tokenLower === process.env.USDT_BEP20_CONTRACT_ADDRESS.toLowerCase());

    if (!isUsdtContract) {
      return {
        verified: false,
        reason: `INVALID_TOKEN_CONTRACT: Expected BSC USDT contract, received '${evidence.tokenContract}'`,
      };
    }

    const expectedAmount = parseFloat(request.quotedNetPayoutAmount);
    const actualAmount = parseFloat(evidence.amountUnits);
    if (isNaN(actualAmount) || Math.abs(expectedAmount - actualAmount) > 0.001) {
      return {
        verified: false,
        reason: `PAYOUT_AMOUNT_MISMATCH: Expected ${expectedAmount} USDT, but on-chain transferred ${actualAmount} USDT`,
      };
    }

    return {
      verified: true,
      normalizedEvidenceRef: normTx,
      reconciliationMetadata: {
        network: evidence.network,
        tokenContract: evidence.tokenContract,
        confirmed: true,
        confirmations: evidence.confirmations ?? 1,
      },
    };
  }

  // در صورتی که اوراکل استعلام RPC بلاکچین یا سیستم تصدیق بیرونی وجود نداشته باشد
  // طبق دستورالعمل: درخواست در وضعیت بررسی باقی مانده و نباید PAID شود.
  return {
    verified: false,
    reason:
      'UNAVAILABLE_VERIFICATION_INFRASTRUCTURE: Live blockchain verification oracle is not configured. Request cannot be marked PAID and remains in review.',
  };
}

/**
 * ۴. انطباق مستقل تسویه حواله بانکی تومانی (IRT Bank Settlement Reconciliation)
 */
export async function reconcileIrtBankPayout(
  request: {
    id: number;
    destinationAddress: string;
    quotedNetPayoutAmount: string;
  },
  receiptRef: string,
  evidence?: IrtPayoutReconciliationEvidence | null
): Promise<PayoutReconciliationResult> {
  const normRef = receiptRef.trim();

  if (evidence) {
    if (!evidence.bankName || evidence.bankName.trim().length < 2) {
      return {
        verified: false,
        reason: 'MISSING_SETTLEMENT_BANK: Valid originating banking institution must be specified',
      };
    }

    if (!evidence.secondaryReviewerId) {
      return {
        verified: false,
        reason: 'DUAL_AUTHORIZATION_REQUIRED: IRT bank payout requires independent secondary authorized finance review',
      };
    }

    return {
      verified: true,
      normalizedEvidenceRef: normRef,
      reconciliationMetadata: {
        bankName: evidence.bankName,
        transferType: evidence.transferType,
        secondaryReviewerId: evidence.secondaryReviewerId,
        transferTimestamp: evidence.transferTimestamp,
      },
    };
  }

  return {
    verified: false,
    reason:
      'PENDING_FINANCE_SETTLEMENT_EVIDENCE: IRT bank payout requires verified bank settlement evidence and dual authorized finance review.',
  };
}
