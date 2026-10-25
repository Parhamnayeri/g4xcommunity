/**
 * paymentTypes.ts — تعاریف، اینام‌ها و تایپ‌های سیستم پرداخت و اعتبارسنجی G4X
 *
 * اصول معماری:
 *  ۱. تفکیک کامل:
 *     - درخواست پرداخت (PaymentRequest)
 *     - تلاش‌های پرداخت (PaymentAttempt)
 *     - رسید تاییدشده یکتا (PaymentReceipt)
 *     - اقدام تجاری مصرف‌کننده رسید (Business Action: Order Funding / Wallet Top-Up)
 *  ۲. هیچگاه ایجاد پرداخت به منزله دریافت وجه تلقی نمی‌شود.
 *  ۳. سوییچ‌های امنیتی پیش‌فرض غیرفعال (Fail-Closed Feature Gates).
 */

export enum PaymentMethod {
  CARD_TO_CARD_IRT = 'CARD_TO_CARD_IRT',
  NOWPAYMENTS_CRYPTO = 'NOWPAYMENTS_CRYPTO',
}

export enum PaymentProvider {
  MANUAL_BANK = 'MANUAL_BANK',
  NOWPAYMENTS = 'NOWPAYMENTS',
}

export enum PaymentRequestStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  VERIFIED = 'verified',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export enum PaymentAttemptStatus {
  PENDING = 'pending',
  WAITING = 'waiting',
  CONFIRMING = 'confirming',
  CONFIRMED = 'confirmed',
  SENDING = 'sending',
  PARTIALLY_PAID = 'partially_paid',
  FINISHED = 'finished',
  FAILED = 'failed',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
  REJECTED = 'rejected',
  MANUAL_REVIEW = 'manual_review',
}

export enum PaymentReceiptStatus {
  ACTIVE = 'ACTIVE',
  CONSUMED = 'CONSUMED',
  VOIDED = 'VOIDED',
}

export enum PaymentBusinessType {
  ORDER = 'ORDER',
  WALLET_FUNDING = 'WALLET_FUNDING',
}

export interface IrtPaymentQuote {
  targetUsdCents: number;
  adminUsdIrtRate: number;
  incomingIrtFeeRate: number;
  baseIrtAmount: number;
  feeIrtAmount: number;
  totalIrtAmount: number;
  quoteExpiresAt: Date;
  quoteHash: string;
}

export interface OfficialBankDetails {
  bankName: string;
  cardNumber: string;
  accountHolder: string;
  iban?: string;
}

export interface IrtEvidenceSubmissionInput {
  attemptRef: string;
  trackingNumber: string;
  paidAmountIrt: number;
  senderCardLast4: string;
  receiptScreenshotUrl?: string;
  actorId: string;
}

export interface AdminIrtReviewInput {
  attemptId: number;
  action: 'APPROVE' | 'REJECT' | 'MANUAL_REVIEW';
  reason?: string;
  actualAmountReceivedIrt?: number;
  actorId: string;
}

export interface NowpaymentsCreateInput {
  paymentRequestId: number;
  payCurrency: string; // e.g. "usdtbsc", "btc", "eth"
  actorId: string;
}

export interface NowpaymentsIpnPayload {
  payment_id: number | string;
  parent_payment_id?: number | string | null;
  invoice_id?: number | string | null;
  payment_status: string;
  pay_address: string;
  payin_extra_id?: string | null;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  actually_paid: number;
  actually_paid_at_fiat?: number;
  pay_currency: string;
  order_id?: string | null;
  order_description?: string | null;
  purchase_id?: string | number | null;
  outcome_amount?: number;
  outcome_currency?: string;
  payment_extra_ids?: any;
  fee?: {
    currency?: string;
    depositFee?: number;
    withdrawalFee?: number;
    serviceFee?: number;
  };
}

export interface NowpaymentsPaymentDetails {
  payment_id: string;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  actually_paid?: number;
  pay_currency: string;
  order_id?: string;
  order_description?: string;
  purchase_id?: string;
  payin_extra_id?: string | null;
  network?: string;
  valid_until?: string;
  expiration_estimate_date?: string;
  outcome_amount?: number;
  outcome_currency?: string;
  parent_payment_id?: string | null;
}

/**
 * پیکربندی کنترل‌ها و سوئیچ‌های NOWPayments
 */
export function getNowpaymentsConfig() {
  const mode = (process.env.NOWPAYMENTS_MODE || 'disabled').toLowerCase();
  const sandboxEnabled = process.env.NOWPAYMENTS_SANDBOX_ENABLED === 'true';
  const liveCollectionEnabled = process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED === 'true';
  const apiKey = (process.env.NOWPAYMENTS_API_KEY || '').trim();
  const ipnSecret = (process.env.NOWPAYMENTS_IPN_SECRET || '').trim();
  const ipnCallbackUrl = (process.env.NOWPAYMENTS_IPN_CALLBACK_URL || '').trim();

  let baseUrl = 'https://api.sandbox.nowpayments.io/v1';
  let isCollectionActive = false;

  if (mode === 'sandbox' && sandboxEnabled) {
    baseUrl = 'https://api.sandbox.nowpayments.io/v1';
    isCollectionActive = true;
  } else if (mode === 'live' && liveCollectionEnabled) {
    baseUrl = 'https://api.nowpayments.io/v1';
    isCollectionActive = true;
  } else {
    isCollectionActive = false;
  }

  return {
    mode,
    sandboxEnabled,
    liveCollectionEnabled,
    isCollectionActive,
    apiKey,
    ipnSecret,
    ipnCallbackUrl,
    baseUrl,
  };
}
