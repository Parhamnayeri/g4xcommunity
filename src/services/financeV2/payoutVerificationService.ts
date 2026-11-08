/**
 * payoutVerificationService.ts — اعتبارسنجی مدارک تسویه برون‌سیستمی و انطباق تراکنش‌های مالی
 *
 * اصول و الزامات امنیتی حاکمیتی:
 *  ۱. رد هرگونه مدرک جعلی یا ارسال‌شده در بدنه درخواست کاربر/ادمین بدون استعلام مستقل (Authoritative Reconciliation).
 *  ۲. برای تتر BEP-20:
 *      - هش تراکنش (TxHash) صرفاً به عنوان یک شناسه جستجوی ناموثق (Untrusted Lookup Identifier) در نظر گرفته می‌شود.
 *      - رسید تراکنش و لاگ‌های رخداد مستقیماً از ارائه‌دهنده معتبر BSC RPC سرور واکشی می‌شوند.
 *      - بررسی قطعی Chain ID (مقدار ۵۶ برای BSC Mainnet).
 *      - بررسی موفقیت تراکنش (Status = 0x1) و تعداد تاییدیه (Confirmations >= 1).
 *      - بررسی دقیق رخداد Transfer(address,address,uint256) توکن BEP-20 USDT با قرارداد رسمی مین‌نت.
 *      - رد قطعی هرگونه آدرس تست‌نت به عنوان مدرک تسویه مین‌نت.
 *      - بررسی دقیق آدرس مقصد با آدرس گیرنده روی زنجیره.
 *      - بررسی دقیق رقم انتقال با مقایسه واحدهای صحیح مقیاس‌پذیر (BigInt integer units) بدون استفاده از parseFloat.
 *      - در صورت عدم دسترسی یا خطای RPC، سامانه Fail-Closed عمل کرده و وضعیت درخواست در حال بررسی باقی می‌ماند.
 *  ۳. برای حواله بانکی تومان (IRT Bank):
 *      - عدم پذیرش مدرک بانکی صرفاً بر اساس اطلاعات متنی فیلدهای ارسالی JSON ادمین.
 *      - الزام بررسی دوطرفه مالی توسط یک ارزیاب دوم معتبر و احراز هویت‌شده (Distinct Authenticated Secondary Reviewer).
 *      - اتصال به اسناد تسویه موثق یا ارائه‌دهنده بانکی مستقل.
 *      - در غیاب استعلام بانکی مستقل، وضعیت تسویه‌نشده حفظ شده و وضعیت PAID ثبت نمی‌گردد.
 *  ۴. ممانعت قطعی از ثبت مدرک تسویه تکراری در تراکنش‌های همزمان با اتکا به قفل‌های دیتابیس.
 */

import prisma from '../../database/db';
import { authorize } from '../authorizationService';
import { Permission } from '../permissionTypes';
import { BoosterWithdrawalMethod, BoosterWithdrawalStatus } from './financeV2Types';

// آدرس‌های رسمی قرارداد توکن USDT روی شبکه BNB Smart Chain
export const BSC_USDT_CONTRACT_MAINNET = '0x55d398326f99059fF775485246999027B3197955'.toLowerCase();
export const BSC_USDT_CONTRACT_TESTNET = '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd'.toLowerCase();

// امضای رسمی رخداد Transfer توکن ERC-20 / BEP-20
// keccak256("Transfer(address,address,uint256)")
export const ERC20_TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'.toLowerCase();

export interface PayoutReconciliationResult {
  verified: boolean;
  reason?: string;
  normalizedEvidenceRef?: string;
  reconciliationMetadata?: Record<string, any>;
}

export interface UsdtReconciliationRequest {
  id: number;
  destinationAddress: string;
  quotedNetPayoutAmount: string;
  netUsdCents?: number;
}

export interface UsdtReconciliationOptions {
  rpcUrl?: string;
  rpcClient?: (method: string, params: any[]) => Promise<any>;
}

export interface IrtReconciliationOptions {
  actorId: string;
  secondReviewerId?: string;
  settlementRecord?: {
    verifiedAt: Date | string;
    settlementBatchId: string;
    sourceBank: string;
    verifiedAmountIrt: number;
    destinationIban: string;
  };
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
 * ۳. انطباق مستقل تراکنش تتر BEP-20 روی زنجیره بلوکی BSC Mainnet
 *
 * الزامات امنیتی:
 *  - استعلام مستقل رسید و لاگ‌ها از RPC معتبر سرور
 *  - بررسی Chain ID شبکه (۵۶ مین‌نت)
 *  - تایید موفقیت (status = 0x1) و تاییدیه‌ها (confirmations >= 1)
 *  - انطباق دقیق قرارداد توکن رسمی مین‌نت
 *  - انطباق دقیق گیرنده در تاپیک دوم لاگ Transfer
 *  - انطباق دقیق مقدار انتقال به کمک محاسبات اعداد صحیح BigInt
 */
export async function reconcileUsdtBep20Payout(
  request: UsdtReconciliationRequest,
  txHash: string,
  options?: UsdtReconciliationOptions
): Promise<PayoutReconciliationResult> {
  const normTx = txHash ? txHash.toLowerCase().trim() : '';

  const formatCheck = /^0x[0-9a-f]{64}$/;
  if (!formatCheck.test(normTx)) {
    return {
      verified: false,
      reason: 'INVALID_BLOCKCHAIN_TX_HASH: Transaction hash must be a valid 66-character 0x-prefixed hexadecimal string on BNB Smart Chain',
    };
  }

  // آماده‌سازی کلاینت RPC مستقل
  let rpcCall: (method: string, params: any[]) => Promise<any>;

  if (options?.rpcClient) {
    rpcCall = options.rpcClient;
  } else {
    const rpcUrl = options?.rpcUrl !== undefined ? options.rpcUrl : process.env.BSC_RPC_URL;
    if (!rpcUrl || !rpcUrl.trim()) {
      return {
        verified: false,
        reason:
          'UNAVAILABLE_VERIFICATION_INFRASTRUCTURE: Server-configured BSC_RPC_URL provider is missing. Payout verification failed closed.',
      };
    }

    rpcCall = async (method: string, params: any[]) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`RPC_HTTP_STATUS_${res.status}: ${res.statusText}`);
        }

        const data: any = await res.json();
        if (data.error) {
          throw new Error(`RPC_ERROR: ${data.error.message || JSON.stringify(data.error)}`);
        }
        return data.result;
      } finally {
        clearTimeout(timeout);
      }
    };
  }

  // ۱. بررسی شناسه زنجیره (Chain ID ۵۶ برای BSC Mainnet)
  let chainIdHex: string;
  try {
    chainIdHex = await rpcCall('eth_chainId', []);
  } catch (err: any) {
    return {
      verified: false,
      reason: `UNAVAILABLE_VERIFICATION_INFRASTRUCTURE: Failed to query BSC RPC chain ID: ${err.message}`,
    };
  }

  const chainId = parseInt(chainIdHex, 16);
  if (chainId !== 56) {
    return {
      verified: false,
      reason: `INVALID_BLOCKCHAIN_CHAIN_ID: Expected BSC Mainnet (Chain ID 56 / 0x38), received chain ID ${chainId} (${chainIdHex})`,
    };
  }

  // ۲. واکشی رسید تراکنش از RPC
  let receipt: any;
  try {
    receipt = await rpcCall('eth_getTransactionReceipt', [normTx]);
  } catch (err: any) {
    return {
      verified: false,
      reason: `UNAVAILABLE_VERIFICATION_INFRASTRUCTURE: Failed to fetch transaction receipt: ${err.message}`,
    };
  }

  if (!receipt) {
    return {
      verified: false,
      reason: 'RECEIPT_NOT_FOUND: Transaction receipt not found on BSC provider. Transaction may be unconfirmed or pending.',
    };
  }

  // ۳. بررسی وضعیت موفقیت تراکنش روی زنجیره
  const statusVal = receipt.status;
  if (statusVal !== '0x1' && statusVal !== 1 && statusVal !== '0x01') {
    return {
      verified: false,
      reason: `TRANSACTION_EXECUTION_FAILED: On-chain transaction execution failed or reverted (status: ${statusVal})`,
    };
  }

  // ۴. بررسی تعداد تاییدیه‌ها (Confirmations >= 1)
  let currentBlockHex: string;
  try {
    currentBlockHex = await rpcCall('eth_blockNumber', []);
  } catch (err: any) {
    return {
      verified: false,
      reason: `UNAVAILABLE_VERIFICATION_INFRASTRUCTURE: Failed to fetch latest block number: ${err.message}`,
    };
  }

  const currentBlock = BigInt(currentBlockHex);
  const receiptBlock = BigInt(receipt.blockNumber);
  const confirmations = currentBlock - receiptBlock + 1n;
  if (confirmations < 1n) {
    return {
      verified: false,
      reason: 'INSUFFICIENT_CONFIRMATIONS: Transaction has less than 1 confirmation on BSC Mainnet',
    };
  }

  // ۵. تجزیه لاگ‌های رخداد جهت یافتن رویداد Transfer توکن تتر
  const logs: any[] = receipt.logs || [];
  const transferLog = logs.find((l: any) =>
    Array.isArray(l.topics) &&
    l.topics.length >= 3 &&
    l.topics[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC0
  );

  if (!transferLog) {
    return {
      verified: false,
      reason: 'NO_TRANSFER_EVENT: Receipt contains no ERC-20 / BEP-20 Transfer event log',
    };
  }

  // ۶. اعتبارسنجی آدرس قرارداد توکن (منحصراً قرارداد رسمی USDT مین‌نت، رد قرارداد تست‌نت)
  const logContract = transferLog.address ? transferLog.address.toLowerCase() : '';
  if (logContract === BSC_USDT_CONTRACT_TESTNET) {
    return {
      verified: false,
      reason: 'TESTNET_CONTRACT_REJECTED: Testnet USDT contract cannot be accepted as valid mainnet settlement evidence',
    };
  }
  if (logContract !== BSC_USDT_CONTRACT_MAINNET) {
    return {
      verified: false,
      reason: `INVALID_TOKEN_CONTRACT: Expected BSC USDT Mainnet contract (${BSC_USDT_CONTRACT_MAINNET}), received '${logContract}'`,
    };
  }

  // ۷. انطباق آدرس گیرنده با مقصد ثبت‌شده در درخواست
  // تاپیک دوم (ایندکس ۲) حاوی آدرس گیرنده با پد صفر ۳۲ بایتی است
  const rawRecipientTopic: string = transferLog.topics[2] || '';
  if (rawRecipientTopic.length < 42) {
    return {
      verified: false,
      reason: 'MALFORMED_RECIPIENT_TOPIC: Transfer event recipient topic is invalid',
    };
  }
  const logRecipient = '0x' + rawRecipientTopic.slice(-40).toLowerCase();
  const expectedRecipient = request.destinationAddress.toLowerCase();
  if (logRecipient !== expectedRecipient) {
    return {
      verified: false,
      reason: `RECIPIENT_ADDRESS_MISMATCH: On-chain recipient '${logRecipient}' does not match withdrawal destination '${request.destinationAddress}'`,
    };
  }

  // ۸. انطباق دقیق مقدار انتقال با مقایسه واحدهای صحیح مقیاس‌پذیر (BigInt integer units)
  // تتر روی BSC Mainnet دارای ۱۸ رقم اعشار (Decimals = 18) است.
  // در سامانه G4X، مبلغ خالص دلاری (netUsdCents) بر حسب سنت (۰.۰۱ دلار) نگهداری می‌شود.
  // ۱ دلار = 10^18 واحد توکن | ۱ سنت = 10^16 واحد توکن (10_000_000_000_000_000n)
  let netCents = request.netUsdCents;
  if (netCents === undefined || netCents === null) {
    netCents = Math.round(parseFloat(request.quotedNetPayoutAmount) * 100);
  }

  const expectedUnits = BigInt(netCents) * 10_000_000_000_000_000n;
  let actualUnits: bigint;
  try {
    actualUnits = BigInt(transferLog.data);
  } catch {
    return {
      verified: false,
      reason: 'MALFORMED_TRANSFER_DATA: Unable to parse on-chain transfer data as integer token units',
    };
  }

  if (actualUnits !== expectedUnits) {
    return {
      verified: false,
      reason: `PAYOUT_AMOUNT_MISMATCH: Expected ${expectedUnits.toString()} token units (${netCents} cents), but on-chain transferred ${actualUnits.toString()} units`,
    };
  }

  return {
    verified: true,
    normalizedEvidenceRef: normTx,
    reconciliationMetadata: {
      chainId: 56,
      tokenContract: BSC_USDT_CONTRACT_MAINNET,
      recipient: logRecipient,
      expectedUnits: expectedUnits.toString(),
      transferredUnits: actualUnits.toString(),
      blockNumber: Number(receiptBlock),
      confirmations: Number(confirmations),
    },
  };
}

/**
 * ۴. انطباق مستقل تسویه حواله بانکی تومانی (IRT Bank Settlement Reconciliation)
 *
 * الزامات امنیتی:
 *  - عدم پذیرش مدرک بانکی صرفاً بر اساس متون تایپ‌شده کاربر/ادمین
 *  - الزام تایید دوطرفه مالی توسط یک ارزیاب مالی مستقل و احراز هویت‌شده (Distinct Second Finance Reviewer)
 *  - انطباق با سوابق تسویه مستقل بانکی (Independent Settlement Records)
 *  - در صورت عدم استعلام بانکی مستقل، وضعیت تسویه‌نشده حفظ شده و تسویه PAID مسدود می‌گردد
 */
export async function reconcileIrtBankPayout(
  request: {
    id: number;
    destinationAddress: string;
    quotedNetPayoutAmount: string;
  },
  receiptRef: string,
  options?: IrtReconciliationOptions
): Promise<PayoutReconciliationResult> {
  const normRef = receiptRef ? receiptRef.trim() : '';

  // ۱. بررسی ارزیاب دوم احراز هویت‌شده و مجزا از ادمین مجری
  if (!options?.secondReviewerId) {
    return {
      verified: false,
      reason: 'DUAL_AUTHORIZATION_REQUIRED: IRT bank payout requires an authenticated, distinct secondary finance reviewer',
    };
  }

  if (options.secondReviewerId === options.actorId) {
    return {
      verified: false,
      reason: 'DUAL_AUTHORIZATION_SAME_USER: Secondary finance reviewer must be distinct from executing administrator',
    };
  }

  // اعتبارسنجی مجوزهای مالی ارزیاب دوم در دیتابیس
  const secondAuth = await authorize(options.secondReviewerId, Permission.FINANCE_ADJUST);
  if (!secondAuth.allowed) {
    return {
      verified: false,
      reason: 'INVALID_SECONDARY_REVIEWER: Secondary reviewer lacks FINANCE_ADJUST or administrative permissions',
    };
  }

  // ۲. استعلام سوابق تسویه مستقل بانکی
  if (!options.settlementRecord) {
    return {
      verified: false,
      reason:
        'UNAVAILABLE_BANK_SETTLEMENT_PROVIDER: Independent bank-side settlement verification oracle is not connected. Payout cannot be marked PAID based solely on an unverified typed receipt reference.',
    };
  }

  // ۳. انطباق شماره شبا یا مقصد بانکی
  const cleanIban = request.destinationAddress.replace(/\s+/g, '').toUpperCase();
  const recordIban = options.settlementRecord.destinationIban.replace(/\s+/g, '').toUpperCase();
  if (cleanIban !== recordIban) {
    return {
      verified: false,
      reason: `BANK_SETTLEMENT_DESTINATION_MISMATCH: Bank settlement record destination '${recordIban}' does not match withdrawal IBAN '${cleanIban}'`,
    };
  }

  // ۴. انطباق مبلغ تومانی تسویه
  const expectedIrt = Number(request.quotedNetPayoutAmount);
  if (options.settlementRecord.verifiedAmountIrt !== expectedIrt) {
    return {
      verified: false,
      reason: `BANK_SETTLEMENT_AMOUNT_MISMATCH: Bank settlement record amount (${options.settlementRecord.verifiedAmountIrt}) does not match quoted net IRT (${expectedIrt})`,
    };
  }

  return {
    verified: true,
    normalizedEvidenceRef: normRef,
    reconciliationMetadata: {
      sourceBank: options.settlementRecord.sourceBank,
      settlementBatchId: options.settlementRecord.settlementBatchId,
      secondReviewerId: options.secondReviewerId,
      verifiedAt: options.settlementRecord.verifiedAt,
    },
  };
}
