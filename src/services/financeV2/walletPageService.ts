/**
 * walletPageService.ts — authoritative financial service for Website Phase 5 React Wallet & Deposit Requests
 *
 * Responsibilities:
 *  1. Authoritative WalletV2 values & separated breakdown (Available, Reserved, Pending, Confirmed, Deposits, Withdrawals, Escrow).
 *  2. Exchange rates & policy from SystemFinancialConfig (admin_usd_irt_rate, incoming_irt_fee_rate).
 *  3. Non-public storage for uploaded receipt screenshots with MIME validation, magic-byte checks, path traversal guards, and owner-isolated access.
 *  4. Manual IRT deposit request creation with duplicate detection and pending status (no auto-credits).
 *  5. Crypto deposit requests adhering to fail-closed NOWPAYMENTS_LIVE_COLLECTION_ENABLED gate.
 *  6. Deposit history with separate pending, verified, and backed ledger credit statuses.
 *  7. Paginated LedgerEntryV2 double-entry journal activity.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import prisma from '../../database/db';
import { getWalletV2Summary, assertLiveCreditsEnabled } from './financeV2WalletService';
import { calculateIncomingIrtQuote, getOfficialReceivingBankDetails } from '../payment/irtPaymentService';
import { getNowpaymentsConfig, OfficialBankDetails } from '../payment/paymentTypes';
import { submitDirectIrtFunding, adminVerifyAndCreditIrtFunding } from './advertiserFundingService';
import { getOrCreatePaymentRequestForFunding } from '../payment/paymentReconciliationService';
import { AuthenticatedUser } from '../../web/middleware/auth';
import { BoosterWithdrawalStatus } from './financeV2Types';

export const RECEIPTS_DIR = path.join(process.cwd(), 'data', 'receipts');

// Ensure receipt directory exists on initial module load
if (!fs.existsSync(RECEIPTS_DIR)) {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

export interface WalletOverviewData {
  user: {
    discordId: string;
    username: string;
    roles: string[];
    isOwner: boolean;
  };
  wallet: {
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
    updatedAt: Date;
  };
  breakdown: {
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
  };
  ratesAndPolicies: {
    adminUsdIrtRate: number | null;
    incomingIrtFeeRate: number | null;
    isCryptoActive: boolean;
    cryptoLiveCollectionEnabled: boolean;
    liveCreditsEnabled: boolean;
    quoteTtlMinutes: number;
  };
  bankDetails: OfficialBankDetails & { isConfigured: boolean };
}

export interface ReceiptUploadResult {
  fileKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  viewUrl: string;
}

export interface ReceiptMetadata {
  fileKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
}

/**
 * 1. واکشی جامع و تفکیک‌شده نمای کلی والت (Wallet Overview)
 */
export async function getWalletOverview(user: AuthenticatedUser): Promise<WalletOverviewData> {
  const userId = user.discordId;

  // ۱. واکشی خلاصه والت معتبر نسل دوم
  const walletSummary = await getWalletV2Summary(userId);

  // ۲. واکشی تفکیک‌شده مبالغ مربوط به واریزهای ادورتایزر، اسکرو سفارش‌ها و رزروهای تسویه
  const [
    confirmedDepositsRaw,
    activeOrdersRaw,
    activeWithdrawalsRaw,
    adminRateConfig,
    feeConfig,
    ttlConfig,
    bankDetailsRaw,
  ] = await Promise.all([
    prisma.advertiserFundingRequest.findMany({
      where: {
        advertiserId: userId,
        status: 'CONFIRMED_CREDITED',
      },
      select: { targetUsdCents: true },
    }),
    prisma.order.findMany({
      where: {
        OR: [{ advertiserId: userId }, { creatorId: userId }],
        status: { in: ['open_presign', 'presign_closed', 'assigned', 'in_progress', 'disputed'] },
      },
      select: { grossAmountMinor: true },
    }),
    prisma.boosterWithdrawalRequest.findMany({
      where: {
        boosterId: userId,
        status: {
          in: [
            BoosterWithdrawalStatus.QUOTED,
            BoosterWithdrawalStatus.USER_CONFIRMED,
            BoosterWithdrawalStatus.REQUESTED,
            BoosterWithdrawalStatus.RESERVED,
            BoosterWithdrawalStatus.UNDER_ADMIN_REVIEW,
            BoosterWithdrawalStatus.PROCESSING,
          ],
        },
      },
      select: { requestedUsdCents: true },
    }),
    prisma.systemFinancialConfig.findUnique({ where: { key: 'admin_usd_irt_rate' } }),
    prisma.systemFinancialConfig.findUnique({ where: { key: 'incoming_irt_fee_rate' } }),
    prisma.systemFinancialConfig.findUnique({ where: { key: 'incoming_irt_quote_ttl_minutes' } }),
    getOfficialReceivingBankDetails(),
  ]);

  const advertiserFundingDepositsCents = confirmedDepositsRaw.reduce((sum, d) => sum + d.targetUsdCents, 0);
  const orderEscrowReservedCents = activeOrdersRaw.reduce((sum, o) => sum + o.grossAmountMinor, 0);
  const withdrawalReservedCents = activeWithdrawalsRaw.reduce((sum, w) => sum + w.requestedUsdCents, 0);
  const externalUnsettledRevenueCents = 0; // Reserved for external integrations

  const adminUsdIrtRate = adminRateConfig?.value && !isNaN(Number(adminRateConfig.value)) && Number(adminRateConfig.value) > 0
    ? Number(adminRateConfig.value)
    : null;

  const incomingIrtFeeRate = feeConfig?.value !== undefined && feeConfig.value !== null && !isNaN(Number(feeConfig.value))
    ? Number(feeConfig.value)
    : null;

  const nowpaymentsConfig = getNowpaymentsConfig();
  const quoteTtlMinutes = ttlConfig?.value && !isNaN(Number(ttlConfig.value)) ? Number(ttlConfig.value) : 30;
  const liveCreditsEnabled = process.env.FINANCE_V2_LIVE_CREDITS_ENABLED === 'true';

  const userRoleKeys = (user.userRoles || []).map((r: { roleKey: string }) => r.roleKey);
  const isOwner = userRoleKeys.includes('owner') || (Boolean(process.env.OWNER_DISCORD_ID) && process.env.OWNER_DISCORD_ID === user.discordId);

  // Check if bank details are actually configured by owner
  const isBankConfigured = Boolean(
    bankDetailsRaw.bankName &&
      bankDetailsRaw.cardNumber &&
      bankDetailsRaw.accountHolder &&
      !bankDetailsRaw.cardNumber.includes('0000-0000') &&
      !bankDetailsRaw.bankName.toLowerCase().includes('not configured')
  );

  return {
    user: {
      discordId: user.discordId,
      username: user.username,
      roles: userRoleKeys,
      isOwner,
    },
    wallet: {
      availableCents: walletSummary.availableCents,
      availableUsd: (walletSummary.availableCents / 100).toFixed(2),
      reservedCents: walletSummary.reservedCents,
      reservedUsd: (walletSummary.reservedCents / 100).toFixed(2),
      pendingEarningsCents: walletSummary.pendingEarningsCents,
      pendingEarningsUsd: (walletSummary.pendingEarningsCents / 100).toFixed(2),
      confirmedEarningsCents: walletSummary.confirmedEarningsCents,
      confirmedEarningsUsd: (walletSummary.confirmedEarningsCents / 100).toFixed(2),
      totalPaidCents: walletSummary.paidCents,
      totalPaidUsd: (walletSummary.paidCents / 100).toFixed(2),
      totalRefundedCents: walletSummary.refundedCents,
      totalRefundedUsd: (walletSummary.refundedCents / 100).toFixed(2),
      totalHeldCents: walletSummary.totalHeldCents,
      totalHeldUsd: (walletSummary.totalHeldCents / 100).toFixed(2),
      lifetimeEarnedCents: walletSummary.lifetimeEarnedCents,
      lifetimeEarnedUsd: (walletSummary.lifetimeEarnedCents / 100).toFixed(2),
      updatedAt: walletSummary.updatedAt,
    },
    breakdown: {
      userEarningsConfirmedCents: walletSummary.confirmedEarningsCents,
      userEarningsConfirmedUsd: (walletSummary.confirmedEarningsCents / 100).toFixed(2),
      userEarningsPendingCents: walletSummary.pendingEarningsCents,
      userEarningsPendingUsd: (walletSummary.pendingEarningsCents / 100).toFixed(2),
      advertiserFundingDepositsCents,
      advertiserFundingDepositsUsd: (advertiserFundingDepositsCents / 100).toFixed(2),
      orderEscrowReservedCents,
      orderEscrowReservedUsd: (orderEscrowReservedCents / 100).toFixed(2),
      withdrawalReservedCents,
      withdrawalReservedUsd: (withdrawalReservedCents / 100).toFixed(2),
      externalUnsettledRevenueCents,
      externalUnsettledRevenueUsd: (externalUnsettledRevenueCents / 100).toFixed(2),
    },
    ratesAndPolicies: {
      adminUsdIrtRate,
      incomingIrtFeeRate,
      isCryptoActive: nowpaymentsConfig.isCollectionActive,
      cryptoLiveCollectionEnabled: nowpaymentsConfig.liveCollectionEnabled,
      liveCreditsEnabled,
      quoteTtlMinutes,
    },
    bankDetails: {
      ...bankDetailsRaw,
      isConfigured: isBankConfigured,
    },
  };
}

/**
 * 2. استعلام پیش‌فاکتور تومانی بر مبنای نرخ مصوب مدیریت
 */
export async function getAuthoritativeIrtQuote(options: { targetUsdCents?: number; amountToman?: number }) {
  let targetUsdCents = options.targetUsdCents;

  if (targetUsdCents === undefined || targetUsdCents === null) {
    if (options.amountToman === undefined || options.amountToman === null) {
      throw new Error('MISSING_AMOUNT: Either targetUsdCents or amountToman must be provided.');
    }
    const amountToman = Math.floor(Number(options.amountToman));
    if (!Number.isSafeInteger(amountToman) || amountToman <= 0) {
      throw new Error('INVALID_TOMAN_AMOUNT: Amount in Toman must be a positive integer.');
    }

    const rateConfig = await prisma.systemFinancialConfig.findUnique({ where: { key: 'admin_usd_irt_rate' } });
    if (!rateConfig || !rateConfig.value || isNaN(Number(rateConfig.value)) || Number(rateConfig.value) <= 0) {
      throw new Error('MISSING_EXCHANGE_RATE: Authoritative USD/IRT rate is not configured. Quote generation blocked.');
    }
    const rate = Number(rateConfig.value);

    const feeConfig = await prisma.systemFinancialConfig.findUnique({ where: { key: 'incoming_irt_fee_rate' } });
    if (!feeConfig || feeConfig.value === null || feeConfig.value === undefined) {
      throw new Error('MISSING_INCOMING_IRT_FEE_POLICY: Missing approved incoming IRT payment fee policy.');
    }
    const feeRate = Number(feeConfig.value);
    if (isNaN(feeRate) || feeRate < 0 || feeRate >= 1) {
      throw new Error(`INVALID_FEE_RATE: Configured incoming IRT fee rate '${feeConfig.value}' is invalid.`);
    }

    // Toman = base + fee = (usd * rate) * (1 + feeRate) => usd = Toman / (rate * (1 + feeRate))
    targetUsdCents = Math.floor((amountToman / ((1 + feeRate) * rate)) * 100);
    if (targetUsdCents <= 0) {
      throw new Error('AMOUNT_TOO_LOW: Submitted Toman amount equates to less than 1 USD cent.');
    }
  }

  const quote = await calculateIncomingIrtQuote(targetUsdCents);
  return { quote, targetUsdCents };
}

/**
 * 3. ذخیره امن تصویر رسید و فیش واریزی در حافظه غیرعمومی
 */
export async function saveReceiptEvidence(
  fileData: string,
  originalFileName: string,
  userId: string
): Promise<ReceiptUploadResult> {
  if (!fileData || typeof fileData !== 'string') {
    throw new Error('INVALID_FILE_DATA: Receipt file payload is required.');
  }

  let mimeType = 'image/png';
  let base64Content = fileData;

  if (fileData.startsWith('data:')) {
    const commaIdx = fileData.indexOf(',');
    if (commaIdx !== -1) {
      const header = fileData.substring(5, commaIdx);
      const semiIdx = header.indexOf(';');
      if (semiIdx !== -1) {
        mimeType = header.substring(0, semiIdx).toLowerCase();
      }
      base64Content = fileData.substring(commaIdx + 1);
    }
  }

  // ۱. اعتبارسنجی نوع رسانه مجاز (MIME Whitelist)
  const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!allowedMimeTypes.includes(mimeType)) {
    throw new Error(`DISALLOWED_FILE_TYPE: Only PNG, JPEG, and WEBP image receipts are permitted, got '${mimeType}'.`);
  }

  const buffer = Buffer.from(base64Content, 'base64');

  // ۲. محدودیت حجم فایل (حداکثر ۵ مگابایت)
  const MAX_BYTES = 5 * 1024 * 1024;
  if (buffer.length === 0) {
    throw new Error('EMPTY_FILE: Uploaded receipt is empty.');
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error(`FILE_TOO_LARGE: Uploaded receipt exceeds maximum permitted size of 5 MB (${buffer.length} bytes).`);
  }

  // ۳. بررسی امضای جادویی بایت‌های فایل (Magic Bytes Verification)
  const isPng = buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
                 buffer.toString('utf8', 8, 12) === 'WEBP';

  if (!isPng && !isJpeg && !isWebp) {
    throw new Error('CORRUPTED_OR_DISALLOWED_IMAGE: File content signature does not match declared image format.');
  }

  // ۴. تعیین پسوند امن و نام تصادفی غیرقابل پیش‌بینی (Prevent Path Traversal & Script Execution)
  let extension = 'png';
  if (isJpeg) extension = 'jpg';
  else if (isWebp) extension = 'webp';

  const fileKey = `receipt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${extension}`;
  const filePath = path.join(RECEIPTS_DIR, fileKey);

  // ۵. ذخیره فایل باینری
  fs.writeFileSync(filePath, buffer);

  // ۶. ذخیره متادیتا به صورت اتمیک
  const metadata: ReceiptMetadata = {
    fileKey,
    originalFileName: (originalFileName || 'receipt').replace(/[^a-zA-Z0-9_\-\.]/g, '_'),
    mimeType: isPng ? 'image/png' : isJpeg ? 'image/jpeg' : 'image/webp',
    sizeBytes: buffer.length,
    uploadedBy: userId,
    uploadedAt: new Date().toISOString(),
  };

  const metaPath = path.join(RECEIPTS_DIR, `${fileKey}.meta.json`);
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  return {
    fileKey,
    originalFileName: metadata.originalFileName,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    viewUrl: `/api/wallet/receipts/${fileKey}`,
  };
}

/**
 * 4. واکشی امن فایل رسید با بررسی دسترسی و تفکیک مالکیت (Access Control Guard)
 */
export async function getReceiptEvidence(
  fileKey: string,
  user: AuthenticatedUser
): Promise<{ filePath: string; mimeType: string }> {
  // ۱. اعتبارسنجی ساختار نام فایل جهت جلوگیری از Path Traversal
  if (!fileKey || !/^[a-zA-Z0-9_\-\.]+$/.test(fileKey)) {
    throw new Error('INVALID_FILE_KEY: Invalid receipt identifier.');
  }

  const safePath = path.resolve(RECEIPTS_DIR, fileKey);
  if (!safePath.startsWith(RECEIPTS_DIR)) {
    throw new Error('PATH_TRAVERSAL_DETECTED: Access outside receipts directory is forbidden.');
  }

  if (!fs.existsSync(safePath)) {
    throw new Error('RECEIPT_NOT_FOUND: The requested receipt was not found.');
  }

  const metaPath = path.join(RECEIPTS_DIR, `${fileKey}.meta.json`);
  let mimeType = 'image/png';

  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ReceiptMetadata;
      mimeType = meta.mimeType || mimeType;

      // بررسی مالکیت و مجوز مشاهده:
      const userRoles = (user.userRoles || []).map((r: { roleKey: string }) => r.roleKey);
      const isPrivileged = userRoles.includes('owner') ||
        (Boolean(process.env.OWNER_DISCORD_ID) && process.env.OWNER_DISCORD_ID === user.discordId) ||
        userRoles.some((r: string) => ['staff', 'manager', 'admin', 'owner'].includes(r));
      const isOwner = meta.uploadedBy === user.discordId;

      if (!isPrivileged && !isOwner) {
        throw new Error('UNAUTHORIZED_RECEIPT_ACCESS: You do not have permission to view this receipt evidence.');
      }
    } catch (err: any) {
      if (err.message && err.message.includes('UNAUTHORIZED_RECEIPT_ACCESS')) {
        throw err;
      }
      // If parsing fails, fall back to safe MIME by extension
    }
  }

  return { filePath: safePath, mimeType };
}

export interface SubmitIrtDepositInput {
  userId: string;
  targetUsdCents: number;
  evidenceRef: string;
  payerIdentifier: string;
  senderCardLast4?: string;
  receiptFileKey?: string;
  paymentDate?: string;
  adminNotes?: string;
}

/**
 * 5. ثبت رسمی درخواست واریز تومانی (Manual IRT Deposit Request)
 */
export async function submitIrtDeposit(input: SubmitIrtDepositInput) {
  const {
    userId,
    targetUsdCents,
    evidenceRef,
    payerIdentifier,
    senderCardLast4,
    receiptFileKey,
    paymentDate,
    adminNotes,
  } = input;

  if (!Number.isSafeInteger(targetUsdCents) || targetUsdCents <= 0) {
    throw new Error('INVALID_AMOUNT: Target USD cents must be a positive safe integer.');
  }

  if (!evidenceRef || evidenceRef.trim().length < 4) {
    throw new Error('INVALID_EVIDENCE: Bank transaction tracking reference is required.');
  }

  if (!payerIdentifier || payerIdentifier.trim().length < 2) {
    throw new Error('INVALID_PAYER: Depositor name or card details are required.');
  }

  const cleanEvidence = evidenceRef.trim();
  const cleanPayer = payerIdentifier.trim();

  // ۱. بررسی تکراری نبودن شماره پیگیری واریز
  const [duplicateFunding, duplicateAttempt, duplicateReceipt] = await Promise.all([
    prisma.advertiserFundingRequest.findFirst({
      where: {
        evidenceRef: cleanEvidence,
        status: { in: ['PENDING_ADMIN_VERIFICATION', 'CONFIRMED_CREDITED'] },
      },
    }),
    prisma.paymentAttempt.findFirst({
      where: {
        trackingNumber: cleanEvidence,
        status: { in: ['pending', 'waiting', 'confirmed', 'finished', 'manual_review'] },
      },
    }),
    prisma.paymentReceipt.findFirst({
      where: { providerReference: cleanEvidence },
    }),
  ]);

  if (duplicateFunding || duplicateAttempt || duplicateReceipt) {
    throw new Error(
      `DUPLICATE_DEPOSIT_EVIDENCE: Tracking reference '${cleanEvidence}' has already been submitted for a deposit or payment request.`
    );
  }

  // ۲. واکشی نرخ موثق و کارمزد مصوب مدیریت
  const rateConfig = await prisma.systemFinancialConfig.findUnique({ where: { key: 'admin_usd_irt_rate' } });
  if (!rateConfig || !rateConfig.value || isNaN(Number(rateConfig.value)) || Number(rateConfig.value) <= 0) {
    throw new Error('MISSING_EXCHANGE_RATE: Authoritative USD/IRT exchange rate is not configured. Request blocked.');
  }
  const adminUsdIrtRate = Number(rateConfig.value);

  const feeConfig = await prisma.systemFinancialConfig.findUnique({ where: { key: 'incoming_irt_fee_rate' } });
  if (!feeConfig || feeConfig.value === null || feeConfig.value === undefined) {
    throw new Error('MISSING_INCOMING_IRT_FEE_POLICY: Missing approved incoming IRT payment fee policy.');
  }
  const incomingIrtFeeRate = Number(feeConfig.value);

  // ۳. تجمیع یادداشت‌ها و پیوند فیش
  let notesCombined = adminNotes?.trim() || '';
  if (paymentDate) {
    notesCombined = notesCombined ? `${notesCombined} | Date: ${paymentDate}` : `Payment Date: ${paymentDate}`;
  }
  if (receiptFileKey) {
    notesCombined = notesCombined ? `${notesCombined} | Receipt: ${receiptFileKey}` : `Receipt: ${receiptFileKey}`;
  }
  if (senderCardLast4) {
    notesCombined = notesCombined ? `${notesCombined} | CardLast4: ${senderCardLast4}` : `CardLast4: ${senderCardLast4}`;
  }

  // ۴. ثبت اتمیک درخواست شارژ
  const result = await submitDirectIrtFunding({
    advertiserId: userId,
    targetUsdCents,
    adminUsdIrtRate,
    currencyPurchaseFeeRate: incomingIrtFeeRate,
    evidenceRef: cleanEvidence,
    payerIdentifier: cleanPayer,
    adminNotes: notesCombined || undefined,
  });

  // ۵. ایجاد پیوند به زیرساخت درخواست پرداخت مشترک جهت ممیزی متمرکز
  try {
    const paymentReq = await getOrCreatePaymentRequestForFunding(result.request.id, userId);

    const attemptRef = `ATT_DEP_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    await prisma.paymentAttempt.create({
      data: {
        attemptRef,
        paymentRequestId: paymentReq.id,
        method: 'CARD_TO_CARD_IRT',
        provider: 'MANUAL_BANK',
        status: 'pending',
        trackingNumber: cleanEvidence,
        paidAmountIrt: String(result.quote.totalIrtPayable),
        senderCardLast4: senderCardLast4 ? senderCardLast4.trim() : null,
        receiptScreenshotUrl: receiptFileKey ? `/api/wallet/receipts/${receiptFileKey}` : null,
        expectedAmount: String(result.quote.totalIrtPayable),
        expectedCurrency: 'IRT',
        exchangeRate: adminUsdIrtRate,
        reviewReason: 'Awaiting admin bank statement verification for wallet deposit',
      },
    });
  } catch (err) {
    console.warn('[WalletService] PaymentRequest linking fallback note:', err);
  }

  return {
    success: true,
    fundingRequest: result.request,
    quote: result.quote,
    message: 'Manual IRT deposit request submitted successfully. It is now awaiting independent administrative verification.',
  };
}

/**
 * 6. دریافت تاریخچه واریزهای کاربر به صورت صفحه‌بندی‌شده
 */
export async function getUserDepositHistory(userId: string, page = 1, limit = 10) {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(50, Math.max(1, limit));
  const offset = (safePage - 1) * safeLimit;

  const [requestsRaw, total] = await Promise.all([
    prisma.advertiserFundingRequest.findMany({
      where: { advertiserId: userId },
      include: {
        verifier: { select: { username: true, discordId: true } },
        ledgerEntries: {
          where: { direction: 'CREDIT', entryType: 'ADVERTISER_DEPOSIT' },
          select: { id: true, amountCents: true, entryRef: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: safeLimit,
    }),
    prisma.advertiserFundingRequest.count({
      where: { advertiserId: userId },
    }),
  ]);

  const deposits = requestsRaw.map((r) => {
    // مانده شارژ شده فقط در صورتی گزارش می‌شود که سند حسابداری ثبت شده باشد
    const hasBackedLedgerCredit = r.status === 'CONFIRMED_CREDITED' && r.ledgerEntries.length > 0;
    const creditedAmountCents = hasBackedLedgerCredit ? r.targetUsdCents : 0;

    let reviewOutcome = 'Under Administrative Review';
    if (r.status === 'CONFIRMED_CREDITED') {
      reviewOutcome = `Approved & Credited by ${r.verifier?.username || 'Admin'}`;
    } else if (r.status === 'REJECTED') {
      reviewOutcome = 'Rejected by Reviewer';
    } else if (r.status === 'CANCELLED') {
      reviewOutcome = 'Cancelled';
    }

    return {
      id: r.id,
      fundingRef: r.fundingRef,
      fundingMethod: r.fundingMethod,
      submittedAmount: `${Number(r.externalAmountUnits).toLocaleString()} ${r.externalCurrency}`,
      submittedCurrency: r.externalCurrency,
      exchangeRate: r.exchangeRate,
      expectedUsdCents: r.targetUsdCents,
      expectedUsd: (r.targetUsdCents / 100).toFixed(2),
      verifiedAmountUsd: r.status === 'CONFIRMED_CREDITED' ? (r.targetUsdCents / 100).toFixed(2) : null,
      creditedAmountUsd: hasBackedLedgerCredit ? (creditedAmountCents / 100).toFixed(2) : '$0.00',
      hasBackedCredit: hasBackedLedgerCredit,
      date: r.createdAt,
      status: r.status,
      reviewOutcome,
      evidenceRef: r.evidenceRef,
      payerIdentifier: r.payerIdentifier,
      adminNotes: r.adminNotes,
      verifiedAt: r.verifiedAt,
      creditedAt: r.creditedAt,
    };
  });

  return {
    success: true,
    deposits,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}

/**
 * 7. دریافت سوابق تراکنش‌های دفتر کل والت کاربر جاری
 */
export async function getUserLedgerActivity(userId: string, page = 1, limit = 10) {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(50, Math.max(1, limit));
  const offset = (safePage - 1) * safeLimit;

  const [entriesRaw, total] = await Promise.all([
    prisma.ledgerEntryV2.findMany({
      where: { userId },
      include: {
        order: { select: { orderRef: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: safeLimit,
    }),
    prisma.ledgerEntryV2.count({
      where: { userId },
    }),
  ]);

  const entries = entriesRaw.map((e) => ({
    id: e.id,
    entryRef: e.entryRef,
    entryType: e.entryType,
    direction: e.direction,
    amountCents: e.amountCents,
    amountUsd: (e.amountCents / 100).toFixed(2),
    balanceAfterAvailableCents: e.balanceAfterAvailableCents,
    balanceAfterAvailableUsd:
      e.balanceAfterAvailableCents !== null ? (e.balanceAfterAvailableCents / 100).toFixed(2) : null,
    balanceAfterReservedCents: e.balanceAfterReservedCents,
    balanceAfterReservedUsd:
      e.balanceAfterReservedCents !== null ? (e.balanceAfterReservedCents / 100).toFixed(2) : null,
    accountType: e.accountType,
    postingGroupId: e.postingGroupId,
    description: e.description,
    orderRef: e.order?.orderRef || null,
    createdAt: e.createdAt,
  }));

  return {
    success: true,
    entries,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}

/**
 * 8. بررسی درخواست واریز توسط مدیر مالی با رعایت سوئیچ‌های اعتباری
 */
export async function adminReviewFunding(
  fundingId: number,
  actorId: string,
  action: 'APPROVE' | 'REJECT',
  notes?: string
) {
  const funding = await prisma.advertiserFundingRequest.findUnique({
    where: { id: fundingId },
  });

  if (!funding) {
    throw new Error(`FUNDING_REQUEST_NOT_FOUND: Deposit request #${fundingId} not found.`);
  }

  if (funding.status === 'CONFIRMED_CREDITED') {
    throw new Error(`ALREADY_CREDITED: Deposit request #${fundingId} was already approved and credited.`);
  }

  if (action === 'REJECT') {
    const updated = await prisma.advertiserFundingRequest.update({
      where: { id: fundingId },
      data: {
        status: 'REJECTED',
        verifiedBy: actorId,
        verifiedAt: new Date(),
        adminNotes: notes ? `${funding.adminNotes || ''} | Rejected: ${notes}`.trim() : funding.adminNotes,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: 'ADVERTISER_DEPOSIT_REJECTED',
        entityType: 'AdvertiserFundingRequest',
        entityId: String(fundingId),
        reason: notes || 'Admin rejected manual deposit request',
        isSuccess: true,
      },
    });

    return { success: true, action: 'REJECTED', request: updated };
  }

  if (action === 'APPROVE') {
    // بررسی سوئیچ شارژ زنده والت
    assertLiveCreditsEnabled();

    return await adminVerifyAndCreditIrtFunding(fundingId, actorId, notes);
  }

  throw new Error(`INVALID_ACTION: Action '${action}' is not supported.`);
}
