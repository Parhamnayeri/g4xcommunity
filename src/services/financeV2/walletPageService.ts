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
import { Prisma } from '@prisma/client';
import prisma from '../../database/db';
import { getWalletV2Summary, assertLiveCreditsEnabled } from './financeV2WalletService';
import { calculateIncomingIrtQuote, getOfficialReceivingBankDetails } from '../payment/irtPaymentService';
import { getNowpaymentsConfig, OfficialBankDetails } from '../payment/paymentTypes';
import {
  submitDirectIrtFunding,
  adminVerifyAndCreditIrtFunding,
  calculateIrtFundingQuote,
} from './advertiserFundingService';
import { getOrCreatePaymentRequestForFunding } from '../payment/paymentReconciliationService';
import { AuthenticatedUser } from '../../web/middleware/auth';
import { BoosterWithdrawalStatus } from './financeV2Types';
import { authorize } from '../authorizationService';
import { Permission } from '../permissionTypes';

export const RECEIPTS_DIR = path.join(process.cwd(), 'data', 'receipts');
export const RECEIPT_KEY_REGEX = /^receipt_\d+_[a-f0-9]{16}\.(png|jpg|jpeg|webp)$/i;
export const ALLOWED_RECEIPT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

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
 * - عملکرد Fail-Closed در صورت فقدان یا خرابی متادیتا
 * - اعتبارسنجی ساختار نام فایل، مسیر کانونیکال و جلوگیری از Path Traversal و Symlink
 * - احراز هویت سرور-محور برای ناظران مالی (FINANCE_ADMIN_VIEW / FINANCE_ADJUST) و ممانعت از دسترسی عمومی استاف
 * - عدم نشت اطلاعات مسیرهای سرور
 */
export async function getReceiptEvidence(
  fileKey: string,
  user: AuthenticatedUser
): Promise<{ filePath: string; mimeType: string }> {
  // ۱. اعتبارسنجی ساختار نام فایل جهت جلوگیری از Forgery و Path Traversal
  if (!fileKey || !RECEIPT_KEY_REGEX.test(fileKey)) {
    throw new Error('INVALID_FILE_KEY: Invalid receipt identifier format.');
  }

  const safePath = path.resolve(RECEIPTS_DIR, fileKey);
  const canonicalBase = fs.realpathSync(RECEIPTS_DIR);

  if (!fs.existsSync(safePath)) {
    throw new Error('RECEIPT_NOT_FOUND: The requested receipt was not found.');
  }

  // اعتبارسنجی Canonical Path جهت مقابله قطعی با Symlink و Prefix Traversal
  const canonicalPath = fs.realpathSync(safePath);
  if (!canonicalPath.startsWith(canonicalBase + path.sep)) {
    throw new Error('PATH_TRAVERSAL_DETECTED: Access outside receipts directory is forbidden.');
  }

  // ۲. بررسی وجود و سلامت متادیتا (Fail-Closed)
  const metaPath = path.resolve(RECEIPTS_DIR, `${fileKey}.meta.json`);
  if (!fs.existsSync(metaPath)) {
    throw new Error('INVALID_RECEIPT_METADATA: Receipt metadata is missing.');
  }

  const canonicalMetaPath = fs.realpathSync(metaPath);
  if (!canonicalMetaPath.startsWith(canonicalBase + path.sep)) {
    throw new Error('PATH_TRAVERSAL_DETECTED: Metadata access outside receipts directory is forbidden.');
  }

  let meta: ReceiptMetadata;
  try {
    meta = JSON.parse(fs.readFileSync(canonicalMetaPath, 'utf8')) as ReceiptMetadata;
  } catch {
    throw new Error('INVALID_RECEIPT_METADATA: Receipt metadata contains invalid JSON.');
  }

  if (!meta || typeof meta !== 'object' || !meta.uploadedBy || !meta.mimeType) {
    throw new Error('INVALID_RECEIPT_METADATA: Receipt metadata is incomplete or corrupted.');
  }

  if (meta.fileKey && meta.fileKey !== fileKey) {
    throw new Error('INVALID_RECEIPT_METADATA: Metadata file key mismatch.');
  }

  const mimeLower = meta.mimeType.toLowerCase();
  if (!ALLOWED_RECEIPT_MIME_TYPES.includes(mimeLower)) {
    throw new Error(`INVALID_RECEIPT_METADATA: Disallowed receipt MIME type '${meta.mimeType}'.`);
  }

  // ۳. بررسی مالکیت و مجوز مشاهده سرور-محور
  const isOwner = meta.uploadedBy === user.discordId;
  let isAuthorizedReviewer = false;

  if (!isOwner) {
    const userRoleKeys = (user.userRoles || []).map((r: { roleKey: string }) => r.roleKey);
    const isSystemOwner =
      userRoleKeys.includes('owner') ||
      (Boolean(process.env.OWNER_DISCORD_ID) && process.env.OWNER_DISCORD_ID === user.discordId);

    if (isSystemOwner) {
      isAuthorizedReviewer = true;
    } else {
      // استعلام دقیق اختیارات ممیزی مالی سرور (نه صرفاً برچسب‌های کلاینت)
      const [viewAuth, adjustAuth] = await Promise.all([
        authorize(user.discordId, Permission.FINANCE_ADMIN_VIEW),
        authorize(user.discordId, Permission.FINANCE_ADJUST),
      ]);
      isAuthorizedReviewer = Boolean(viewAuth.allowed || adjustAuth.allowed);
    }
  }

  if (!isOwner && !isAuthorizedReviewer) {
    throw new Error('UNAUTHORIZED_RECEIPT_ACCESS: You do not have permission to view this receipt evidence.');
  }

  return { filePath: canonicalPath, mimeType: meta.mimeType };
}

/**
 * اعتبارسنجی سند فیش جهت اتصال به درخواست واریز (Evidence Ownership & Binding Guard)
 */
export async function verifyReceiptForDeposit(
  receiptFileKey: string,
  userId: string,
  tx?: Prisma.TransactionClient,
  excludeFundingRequestId?: number
): Promise<ReceiptMetadata> {
  if (!receiptFileKey || !RECEIPT_KEY_REGEX.test(receiptFileKey)) {
    throw new Error('INVALID_RECEIPT_KEY: Receipt identifier format is invalid or forged.');
  }

  const safePath = path.resolve(RECEIPTS_DIR, receiptFileKey);
  const canonicalBase = fs.realpathSync(RECEIPTS_DIR);

  if (!fs.existsSync(safePath)) {
    throw new Error('RECEIPT_NOT_FOUND: The referenced receipt file does not exist on disk.');
  }

  const canonicalPath = fs.realpathSync(safePath);
  if (!canonicalPath.startsWith(canonicalBase + path.sep)) {
    throw new Error('PATH_TRAVERSAL_DETECTED: Access outside receipts directory is forbidden.');
  }

  const metaPath = path.resolve(RECEIPTS_DIR, `${receiptFileKey}.meta.json`);
  if (!fs.existsSync(metaPath)) {
    throw new Error('INVALID_RECEIPT_METADATA: Receipt metadata is missing.');
  }

  const canonicalMetaPath = fs.realpathSync(metaPath);
  if (!canonicalMetaPath.startsWith(canonicalBase + path.sep)) {
    throw new Error('PATH_TRAVERSAL_DETECTED: Metadata access outside receipts directory is forbidden.');
  }

  let meta: ReceiptMetadata;
  try {
    meta = JSON.parse(fs.readFileSync(canonicalMetaPath, 'utf8')) as ReceiptMetadata;
  } catch {
    throw new Error('INVALID_RECEIPT_METADATA: Receipt metadata contains invalid JSON.');
  }

  if (!meta || typeof meta !== 'object' || !meta.uploadedBy || !meta.mimeType) {
    throw new Error('INVALID_RECEIPT_METADATA: Receipt metadata is incomplete or corrupted.');
  }

  if (meta.fileKey && meta.fileKey !== receiptFileKey) {
    throw new Error('INVALID_RECEIPT_METADATA: Metadata file key mismatch.');
  }

  if (!ALLOWED_RECEIPT_MIME_TYPES.includes(meta.mimeType.toLowerCase())) {
    throw new Error(`DISALLOWED_FILE_TYPE: Receipt MIME type '${meta.mimeType}' is not approved.`);
  }

  // بررسی مالکیت فیش: کاربر ارسال‌کننده باید دقیقاً آپلودکننده فیش باشد
  if (meta.uploadedBy !== userId) {
    throw new Error('RECEIPT_OWNERSHIP_MISMATCH: Uploaded receipt belongs to another user.');
  }

  // جلوگیری از استفاده مجدد یک فیش در چند درخواست واریز نامرتبط
  const client = tx || prisma;
  const [existingFundingWithReceipt, existingAttemptWithReceipt] = await Promise.all([
    client.advertiserFundingRequest.findFirst({
      where: {
        ...(excludeFundingRequestId ? { id: { not: excludeFundingRequestId } } : {}),
        adminNotes: { contains: receiptFileKey },
        status: { in: ['PENDING_ADMIN_VERIFICATION', 'CONFIRMED_CREDITED'] },
      },
    }),
    client.paymentAttempt.findFirst({
      where: {
        receiptScreenshotUrl: { contains: receiptFileKey },
        status: { in: ['pending', 'waiting', 'confirmed', 'finished', 'manual_review'] },
        ...(excludeFundingRequestId
          ? {
              paymentRequest: {
                fundingRequestId: { not: excludeFundingRequestId },
              },
            }
          : {}),
      },
    }),
  ]);

  if (existingFundingWithReceipt || existingAttemptWithReceipt) {
    throw new Error(
      `DUPLICATE_RECEIPT_REUSE: Receipt '${receiptFileKey}' has already been attached to another deposit request.`
    );
  }

  return meta;
}

/**
 * حذف ایمن فیش با تضمین ممیزی عدم اتصال به تراکنش مالی فعال (Audit Protected Cleanup)
 */
export async function deleteReceiptEvidence(fileKey: string, user: AuthenticatedUser): Promise<void> {
  if (!fileKey || !RECEIPT_KEY_REGEX.test(fileKey)) {
    throw new Error('INVALID_FILE_KEY: Invalid receipt identifier format.');
  }

  const safePath = path.resolve(RECEIPTS_DIR, fileKey);
  const canonicalBase = fs.realpathSync(RECEIPTS_DIR);

  if (!fs.existsSync(safePath)) {
    throw new Error('RECEIPT_NOT_FOUND: The requested receipt was not found.');
  }

  const canonicalPath = fs.realpathSync(safePath);
  if (!canonicalPath.startsWith(canonicalBase + path.sep)) {
    throw new Error('PATH_TRAVERSAL_DETECTED: Access outside receipts directory is forbidden.');
  }

  const metaPath = path.resolve(RECEIPTS_DIR, `${fileKey}.meta.json`);
  let canonicalMetaPath: string | null = null;
  if (fs.existsSync(metaPath)) {
    canonicalMetaPath = fs.realpathSync(metaPath);
    if (!canonicalMetaPath.startsWith(canonicalBase + path.sep)) {
      throw new Error('PATH_TRAVERSAL_DETECTED: Metadata access outside receipts directory is forbidden.');
    }
    try {
      const meta = JSON.parse(fs.readFileSync(canonicalMetaPath, 'utf8')) as ReceiptMetadata;
      const isOwner = meta.uploadedBy === user.discordId;
      const userRoles = (user.userRoles || []).map((r: { roleKey: string }) => r.roleKey);
      const isSystemOwner =
        userRoles.includes('owner') ||
        (Boolean(process.env.OWNER_DISCORD_ID) && process.env.OWNER_DISCORD_ID === user.discordId);

      if (!isOwner && !isSystemOwner) {
        const auth = await authorize(user.discordId, Permission.FINANCE_ADJUST);
        if (!auth.allowed) {
          throw new Error('UNAUTHORIZED_RECEIPT_ACCESS: Permission denied.');
        }
      }
    } catch (err: any) {
      if (err.message && err.message.includes('UNAUTHORIZED_RECEIPT_ACCESS')) throw err;
    }
  }

  // تضمین ممیزی: فیش متصل به درخواست واریز فعال یا تاییدشده هرگز نباید حذف شود
  const [linkedFunding, linkedAttempt] = await Promise.all([
    prisma.advertiserFundingRequest.findFirst({
      where: {
        adminNotes: { contains: fileKey },
        status: { in: ['PENDING_ADMIN_VERIFICATION', 'CONFIRMED_CREDITED'] },
      },
    }),
    prisma.paymentAttempt.findFirst({
      where: {
        receiptScreenshotUrl: { contains: fileKey },
        status: { in: ['pending', 'waiting', 'confirmed', 'finished', 'manual_review'] },
      },
    }),
  ]);

  if (linkedFunding || linkedAttempt) {
    throw new Error(
      `RECEIPT_IN_ACTIVE_USE: Cannot delete receipt '${fileKey}' because it is linked to an active deposit or payment request.`
    );
  }

  fs.unlinkSync(canonicalPath);
  if (canonicalMetaPath && fs.existsSync(canonicalMetaPath)) {
    fs.unlinkSync(canonicalMetaPath);
  }
}

/**
 * استخراج شناسه فیش ثبت‌شده از یادداشت‌های واریز
 */
function extractReceiptKeyFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = notes.match(/(?:^|\|\s*)Receipt:\s*([^\s|]+)/i);
  return match ? match[1].trim() : null;
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
  expectedExchangeRate?: number;
  expectedTotalIrt?: number;
  quoteExpiresAt?: string;
  quoteHash?: string;
}

/**
 * 5. ثبت رسمی و اتمیک درخواست واریز تومانی (Atomic & Idempotent IRT Deposit Submission)
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
    expectedExchangeRate,
    expectedTotalIrt,
    quoteExpiresAt,
    quoteHash,
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

  // ۱. اعتبارسنجی نرخ و پیش‌فاکتور موثق سرور (Server-side Rate Integrity)
  const authoritativeQuote = await calculateIncomingIrtQuote(targetUsdCents);

  if (expectedExchangeRate !== undefined && Math.abs(expectedExchangeRate - authoritativeQuote.adminUsdIrtRate) > 0.001) {
    throw new Error('STALE_OR_INVALID_RATE: The USD/IRT exchange rate has updated. Please refresh your quote.');
  }

  if (expectedTotalIrt !== undefined && Math.abs(expectedTotalIrt - authoritativeQuote.totalIrtAmount) > 1) {
    throw new Error('STALE_OR_INVALID_QUOTE: Total payable IRT does not match authoritative calculation. Please refresh your quote.');
  }

  if (quoteExpiresAt !== undefined && new Date(quoteExpiresAt).getTime() < Date.now()) {
    throw new Error('EXPIRED_QUOTE: The deposit quote has expired. Please refresh to obtain a valid quote.');
  }

  if (quoteHash !== undefined && quoteHash !== authoritativeQuote.quoteHash) {
    throw new Error('INVALID_QUOTE_SIGNATURE: Deposit quote signature verification failed. Please refresh your quote.');
  }

  // ۲. تجمیع یادداشت‌ها و پیوند فیش
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

  // ۳. ثبت اتمیک در قالب تراکنش واحد دیتابیس (All-or-Nothing Transaction)
  try {
    return await prisma.$transaction(async (tx) => {
      // الف. بررسی پیگیری‌های تکراری و بازیابی عاری از اثر (Idempotent Recovery vs Anti-Reuse)
      const [duplicateFunding, duplicateAttempt, duplicateReceipt] = await Promise.all([
        tx.advertiserFundingRequest.findFirst({
          where: { evidenceRef: cleanEvidence },
          orderBy: { id: 'desc' },
        }),
        tx.paymentAttempt.findFirst({
          where: {
            trackingNumber: cleanEvidence,
            status: { in: ['pending', 'waiting', 'confirmed', 'finished', 'manual_review'] },
          },
          include: { paymentRequest: true },
        }),
        tx.paymentReceipt.findFirst({
          where: { providerReference: cleanEvidence },
        }),
      ]);

      if (duplicateFunding) {
        // ۱. در صورتی که درخواست قبلاً تایید و شارژ شده باشد:
        if (duplicateFunding.status === 'CONFIRMED_CREDITED') {
          throw new Error(
            `DUPLICATE_DEPOSIT_EVIDENCE: Deposit request #${duplicateFunding.id} was already approved and credited.`
          );
        }

        // ۲. در صورتی که درخواست قبلاً توسط مدیریت رد شده باشد:
        if (duplicateFunding.status === 'REJECTED') {
          throw new Error(
            `DEPOSIT_PREVIOUSLY_REJECTED: Previous deposit request #${duplicateFunding.id} with tracking reference '${cleanEvidence}' was rejected by administrator.`
          );
        }

        // ۳. در صورتی که کد پیگیری توسط کاربر دیگری قبلاً ثبت شده باشد:
        if (duplicateFunding.advertiserId !== userId) {
          throw new Error(
            `DUPLICATE_DEPOSIT_EVIDENCE: Tracking reference '${cleanEvidence}' has already been submitted by another user.`
          );
        }

        // ۴. در صورتی که درخواست در وضعیتی غیر از انتظار تایید ادمین باشد:
        if (duplicateFunding.status !== 'PENDING_ADMIN_VERIFICATION') {
          throw new Error(
            `DUPLICATE_DEPOSIT_EVIDENCE: Deposit request #${duplicateFunding.id} is in status '${duplicateFunding.status}' and cannot be retried.`
          );
        }

        // در صورتی که این رکورد جزو تعارضات شواهد گذشته علامت‌گذاری شده باشد، نیازمند ممیزی دستی است:
        if (duplicateFunding.legacyEvidenceResolution) {
          throw new Error(
            `DEPOSIT_REQUIRES_MANUAL_RECONCILIATION: Deposit request #${duplicateFunding.id} is flagged for manual reconciliation (${duplicateFunding.legacyEvidenceResolution}).`
          );
        }

        // ۵. در صورتی که درخواست مربوط به همین کاربر و در انتظار تایید باشد -> بررسی انطباق مشخصات تغییرناپذیر
        if (duplicateFunding.fundingMethod !== 'IRT') {
          throw new Error(
            `CONFLICTING_DEPOSIT_RETRY: Funding method mismatch on retry of deposit request #${duplicateFunding.id}.`
          );
        }

        if (duplicateFunding.targetUsdCents !== targetUsdCents) {
          throw new Error(
            `CONFLICTING_DEPOSIT_RETRY: Cannot alter target amount of existing pending deposit request #${duplicateFunding.id} (${duplicateFunding.targetUsdCents} != ${targetUsdCents}).`
          );
        }

        const boundReceiptKey = extractReceiptKeyFromNotes(duplicateFunding.adminNotes);
        if (boundReceiptKey && receiptFileKey && boundReceiptKey !== receiptFileKey) {
          throw new Error(
            `CONFLICTING_DEPOSIT_RETRY: Cannot change receipt binding on retry of pending deposit request #${duplicateFunding.id}.`
          );
        }

        const effectiveReceiptKey = receiptFileKey || boundReceiptKey;
        if (effectiveReceiptKey) {
          await verifyReceiptForDeposit(effectiveReceiptKey, userId, tx, duplicateFunding.id);
        }

        if (duplicateReceipt) {
          throw new Error(
            `DUPLICATE_DEPOSIT_EVIDENCE: Tracking reference '${cleanEvidence}' has already been submitted for a payment receipt.`
          );
        }

        if (duplicateAttempt && duplicateAttempt.paymentRequest?.fundingRequestId !== duplicateFunding.id) {
          throw new Error(
            `DUPLICATE_DEPOSIT_EVIDENCE: Tracking reference '${cleanEvidence}' has already been submitted for a different payment attempt.`
          );
        }

        // بازیابی بی‌اثر (Idempotent Recovery) بدون ایجاد تعهد مالی مجدد
        const existingPayReq = await tx.paymentRequest.findFirst({
          where: { fundingRequestId: duplicateFunding.id },
          include: { attempts: true },
        });

        let payReq = existingPayReq;
        let isRecovery = false;

        if (!payReq) {
          payReq = await getOrCreatePaymentRequestForFunding(duplicateFunding.id, userId, tx);
          isRecovery = true;
        }

        // تطابق دقیق PaymentAttempt جهت جلوگیری قطعی از بازگرداندن شواهد نامربوط یا متعارض
        const existingAttempts = payReq.attempts || [];

        // ۱. بررسی تلاش پرداخت با روش متعارض
        const conflictingMethodAttempt = existingAttempts.find((a) => a.method !== 'CARD_TO_CARD_IRT');
        if (conflictingMethodAttempt) {
          throw new Error(
            `CONFLICTING_DEPOSIT_RETRY: Deposit request #${duplicateFunding.id} has an existing payment attempt with conflicting method '${conflictingMethodAttempt.method}'.`
          );
        }

        // ۲. بررسی تلاش پرداخت با کد رهگیری متعارض
        const conflictingTrackingAttempt = existingAttempts.find(
          (a) => a.trackingNumber && a.trackingNumber !== cleanEvidence
        );
        if (conflictingTrackingAttempt) {
          throw new Error(
            `CONFLICTING_DEPOSIT_RETRY: Deposit request #${duplicateFunding.id} has an existing payment attempt bound to a different tracking reference.`
          );
        }

        // ۳. استخراج تلاش پرداخت منطبق (Exact Matching: fundingRequest + method + trackingNumber)
        let attempt = existingAttempts.find(
          (a) => a.method === 'CARD_TO_CARD_IRT' && a.trackingNumber === cleanEvidence
        );

        if (attempt) {
          // بررسی تعارض فیش در صورت وجود فیش روی attempt
          if (effectiveReceiptKey && attempt.receiptScreenshotUrl && !attempt.receiptScreenshotUrl.includes(effectiveReceiptKey)) {
            throw new Error(
              `CONFLICTING_DEPOSIT_RETRY: Payment attempt for deposit #${duplicateFunding.id} is bound to a different receipt evidence.`
            );
          }
        } else {
          // در صورت فقدان تلاش منطبق، رکورد متناظر با حفظ دقیق نرخ ارز اولیه و جزئیات تغییرناپذیر ایجاد می‌شود
          const attemptRef = `ATT_DEP_${duplicateFunding.id}_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
          attempt = await tx.paymentAttempt.create({
            data: {
              attemptRef,
              paymentRequestId: payReq.id,
              method: 'CARD_TO_CARD_IRT',
              provider: 'MANUAL_BANK',
              status: 'pending',
              trackingNumber: cleanEvidence,
              paidAmountIrt: String(duplicateFunding.externalAmountUnits),
              senderCardLast4: senderCardLast4 ? senderCardLast4.trim() : null,
              receiptScreenshotUrl: effectiveReceiptKey ? `/api/wallet/receipts/${effectiveReceiptKey}` : null,
              expectedAmount: String(duplicateFunding.externalAmountUnits),
              expectedCurrency: 'IRT',
              exchangeRate: Number(duplicateFunding.exchangeRate),
              reviewReason: 'Awaiting admin bank statement verification for wallet deposit (idempotent recovery)',
            },
          });
          isRecovery = true;
        }

        const recoveredQuote = calculateIrtFundingQuote(
          duplicateFunding.targetUsdCents,
          Number(duplicateFunding.exchangeRate),
          Number(duplicateFunding.currencyPurchaseFeeRate)
        );

        return {
          success: true,
          fundingRequest: duplicateFunding,
          quote: recoveredQuote,
          paymentRequest: payReq,
          paymentAttempt: attempt,
          message: isRecovery
            ? 'Recovered incomplete deposit request with required payment tracking.'
            : 'Idempotent deposit recovery: returned existing pending deposit request.',
        };
      }

      // ب. در صورتی که هیچ درخواست قبلی با این شناسه پیگیری وجود نداشت:
      if (duplicateAttempt || duplicateReceipt) {
        throw new Error(
          `DUPLICATE_DEPOSIT_EVIDENCE: Tracking reference '${cleanEvidence}' has already been submitted for a payment attempt or receipt.`
        );
      }

      // ج. اعتبارسنجی فیش جدید قبل از ایجاد تعهد مالی (الزامی بودن فیش برای درخواست‌های واریز تومانی جدید)
      if (!receiptFileKey || typeof receiptFileKey !== 'string' || !receiptFileKey.trim()) {
        throw new Error('MISSING_RECEIPT_EVIDENCE: A valid payment receipt screenshot is mandatory for manual IRT deposit requests.');
      }
      await verifyReceiptForDeposit(receiptFileKey.trim(), userId, tx);

      // د. ثبت درخواست شارژ ادورتایزر در دیتابیس
      const result = await submitDirectIrtFunding(
        {
          advertiserId: userId,
          targetUsdCents,
          adminUsdIrtRate: authoritativeQuote.adminUsdIrtRate,
          currencyPurchaseFeeRate: authoritativeQuote.incomingIrtFeeRate,
          evidenceRef: cleanEvidence,
          payerIdentifier: cleanPayer,
          adminNotes: notesCombined || undefined,
        },
        tx
      );

      // هـ. ایجاد اتمیک PaymentRequest
      const paymentReq = await getOrCreatePaymentRequestForFunding(result.request.id, userId, tx);

      // و. ایجاد اتمیک PaymentAttempt متناظر با شناسه یکتا
      const attemptRef = `ATT_DEP_${result.request.id}_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const attempt = await tx.paymentAttempt.create({
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
          exchangeRate: authoritativeQuote.adminUsdIrtRate,
          reviewReason: 'Awaiting admin bank statement verification for wallet deposit',
        },
      });

      return {
        success: true,
        fundingRequest: result.request,
        quote: result.quote,
        paymentRequest: paymentReq,
        paymentAttempt: attempt,
        message: 'Manual IRT deposit request submitted successfully. It is now awaiting independent administrative verification.',
      };
    });
  } catch (err: any) {
    if (err?.code === 'P2002' || (typeof err?.message === 'string' && /unique constraint failed/i.test(err.message))) {
      throw new Error(`DUPLICATE_DEPOSIT_EVIDENCE: Tracking reference '${cleanEvidence}' has already been submitted.`);
    }
    throw err;
  }
}

/**
 * ماسک‌گذاری اطلاعات هویتی و شماره کارتی پرداخت‌کننده در پاسخ‌های عمومی
 */
function maskPayerIdentifier(identifier: string | null): string {
  if (!identifier) return '';
  const trimmed = identifier.trim();

  // ماسک‌گذاری شماره کارت‌های ۱۶ رقمی
  const cardMatch = trimmed.match(/\b(\d{4})\d{8}(\d{4})\b/);
  if (cardMatch) {
    return trimmed.replace(/\b(\d{4})\d{8}(\d{4})\b/, '$1 **** **** $2');
  }

  if (/^\d{8,19}$/.test(trimmed)) {
    return `**** **** **** ${trimmed.slice(-4)}`;
  }

  return trimmed;
}

/**
 * 6. دریافت تاریخچه واریزهای کاربر به صورت صفحه‌بندی‌شده و حفظ حریم خصوصی مالی
 * - تفکیک کامل داده‌های کاربر از یادداشت‌های مدیریتی (عدم افشای adminNotes)
 * - ماسک‌گذاری شماره کارت‌های حساس
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
      payerIdentifier: maskPayerIdentifier(r.payerIdentifier),
      // یادداشت‌های داخلی مدیریت (adminNotes) و نام فایل‌های رسید عمداً جهت رعایت حریم خصوصی مالی حذف شدند
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
 * 6.1 بررسی و تطبیق درخواست‌های ناقص قبلی بدون شارژ خودکار والت (Reconciliation Guard)
 */
export async function reconcileIncompleteFundingRequests(actorId?: string) {
  const whereClause: any = {
    status: 'PENDING_ADMIN_VERIFICATION',
  };
  if (actorId) {
    whereClause.advertiserId = actorId;
  }

  const pendingRequests = await prisma.advertiserFundingRequest.findMany({
    where: whereClause,
    include: {
      paymentRequests: {
        include: { attempts: true },
      },
    },
  });

  const reconciled: Array<{ fundingId: number; paymentRequestId: number; paymentAttemptId: number }> = [];

  for (const req of pendingRequests) {
    const hasCompleteTracking = req.paymentRequests.some((pr) => pr.attempts.length > 0);
    if (!hasCompleteTracking) {
      await prisma.$transaction(async (tx) => {
        const pReq = await getOrCreatePaymentRequestForFunding(req.id, req.advertiserId, tx);
        const attemptRef = `ATT_REC_${req.id}_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const attempt = await tx.paymentAttempt.create({
          data: {
            attemptRef,
            paymentRequestId: pReq.id,
            method: 'CARD_TO_CARD_IRT',
            provider: 'MANUAL_BANK',
            status: 'pending',
            trackingNumber: req.evidenceRef || `EVID_${req.id}`,
            paidAmountIrt: String(req.externalAmountUnits),
            expectedAmount: String(req.externalAmountUnits),
            expectedCurrency: req.externalCurrency || 'IRT',
            exchangeRate: req.exchangeRate ? Number(req.exchangeRate) : null,
            reviewReason: 'Reconciled missing payment tracking for legacy pending funding request',
          },
        });
        reconciled.push({ fundingId: req.id, paymentRequestId: pReq.id, paymentAttemptId: attempt.id });
      });
    }
  }

  return { success: true, count: reconciled.length, reconciled };
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

  // Anti-self-approval check: A reviewer cannot approve or reject their own deposit request
  if (funding.advertiserId === actorId) {
    throw new Error('SELF_APPROVAL_PROHIBITED: You cannot review or approve your own deposit request.');
  }

  if (funding.status === 'CONFIRMED_CREDITED') {
    throw new Error(`ALREADY_CREDITED: Deposit request #${fundingId} was already approved and credited.`);
  }

  if (action === 'REJECT') {
    if (!notes || notes.trim().length < 5) {
      throw new Error('REJECTION_NOTES_REQUIRED: A meaningful explanation (at least 5 characters) is required when rejecting a deposit request.');
    }

    const updated = await prisma.advertiserFundingRequest.update({
      where: { id: fundingId },
      data: {
        status: 'REJECTED',
        verifiedBy: actorId,
        verifiedAt: new Date(),
        adminNotes: `${funding.adminNotes || ''} | Rejected: ${notes.trim()}`.trim(),
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: 'ADVERTISER_DEPOSIT_REJECTED',
        entityType: 'AdvertiserFundingRequest',
        entityId: String(fundingId),
        reason: notes.trim(),
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
