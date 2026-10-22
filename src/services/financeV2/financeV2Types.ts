/**
 * financeV2Types.ts — تعاریف، تایپ‌ها و اینام‌های معماری مالی نسخه ۲ (Finance V2 Architecture)
 *
 * اصول محوری Finance V2:
 *  ۱. والت متمرکز صرفاً بر پایه سنت دلار آمریکا (Unified USD Cents Wallet - No Parallel Internal Currencies)
 *  ۲. حذف کامل طلا به عنوان واحد پولی والت (Gold is exclusively a trade quantity in advertiser workflows)
 *  ۳. ارزهای USDT و IRT صرفاً روش‌های واریز/برداشت خارجی هستند (External Settlement Methods Only)
 *  ۴. کارمزد اسکای‌کوچ: ۱۰٪ به ازای هر سفارش، جایگزین کامل خط‌مشی قدیمی ۵٪ + ۵ دلار (SkyCoach 10% per order)
 *  ۵. برداشت تتر بوسترها: کارمزد ثابت ۴۰ سنت دلار، شبکه BEP-20، پرداخت دستی (USDT $0.40 fee)
 *  ۶. برداشت تومانی بوسترها: کارمزد ثابت ۱.۳۰ دلار، تخفیف ۳,۰۰۰ تومان به ازای هر دلار، تسویه چهارشنبه/شنبه (IRT $1.30 fee & 3k discount)
 *  ۷. فرآیند آزادسازی ۲۴ ساعته اختصاصی بوست‌های منتشره G4X از زمان تایید ادمین (G4X 24h release from Admin approval)
 *  ۸. گردش‌کار شارژ ادورتایزر از طریق مبادله طلا تا زمان تایید شفاف مالک مسدود است (Pending Business Confirmation)
 */

export enum WalletV2BalanceCategory {
  AVAILABLE = 'availableCents',
  RESERVED = 'reservedCents',
  PENDING_EARNINGS = 'pendingEarningsCents',
  CONFIRMED_EARNINGS = 'confirmedEarningsCents',
  PAID = 'paidCents',
  REFUNDED = 'refundedCents',
}

export enum LedgerV2EntryType {
  EARNING_PENDING = 'EARNING_PENDING',
  EARNING_CONFIRMED = 'EARNING_CONFIRMED',
  AVAILABLE_RELEASE = 'AVAILABLE_RELEASE',
  WITHDRAWAL_RESERVE = 'WITHDRAWAL_RESERVE',
  WITHDRAWAL_SETTLE = 'WITHDRAWAL_SETTLE',
  WITHDRAWAL_REVERSE = 'WITHDRAWAL_REVERSE',
  ADVERTISER_DEPOSIT = 'ADVERTISER_DEPOSIT',
  MANUAL_ADJUSTMENT = 'MANUAL_ADJUSTMENT',
  ORDER_FEE_COLLECTION = 'ORDER_FEE_COLLECTION',
}

export enum LedgerV2Direction {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export enum AdvertiserFundingMethod {
  USDT = 'USDT',
  IRT = 'IRT',
  GOLD_EXCHANGE = 'GOLD_EXCHANGE',
}

export enum AdvertiserFundingStatus {
  DRAFT = 'DRAFT',
  QUOTED = 'QUOTED',
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  PAYMENT_SUBMITTED = 'PAYMENT_SUBMITTED',
  PENDING_ADMIN_VERIFICATION = 'PENDING_ADMIN_VERIFICATION',
  CONFIRMED_CREDITED = 'CONFIRMED_CREDITED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  PENDING_BUSINESS_CONFIRMATION = 'PENDING_BUSINESS_CONFIRMATION',
}

export enum GoldExchangeTradeStatus {
  TRADE_PENDING = 'TRADE_PENDING',
  TRADE_COMPLETED_IN_GAME = 'TRADE_COMPLETED_IN_GAME',
  TRADE_VERIFIED = 'TRADE_VERIFIED',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PAYMENT_CONFIRMED = 'PAYMENT_CONFIRMED',
  PENDING_BUSINESS_CONFIRMATION = 'PENDING_BUSINESS_CONFIRMATION',
  RECONCILED = 'RECONCILED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

export enum BoosterWithdrawalMethod {
  USDT_BEP20 = 'USDT_BEP20',
  IRT_BANK = 'IRT_BANK',
}

export enum BoosterWithdrawalStatus {
  DRAFT = 'DRAFT',
  QUOTED = 'QUOTED',
  USER_CONFIRMED = 'USER_CONFIRMED',
  REQUESTED = 'REQUESTED',
  RESERVED = 'RESERVED',
  UNDER_ADMIN_REVIEW = 'UNDER_ADMIN_REVIEW',
  PROCESSING = 'PROCESSING',
  PAID = 'PAID',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export enum G4XBoostReleaseStage {
  RUN_COMPLETED = 'RUN_COMPLETED',
  PROOF_SUBMITTED = 'PROOF_SUBMITTED',
  STAFF_REVIEW = 'STAFF_REVIEW',
  ADMIN_FINAL_APPROVED = 'ADMIN_FINAL_APPROVED',
  HOLD_24_HOURS = 'HOLD_24_HOURS',
  ELIGIBLE_FOR_RELEASE = 'ELIGIBLE_FOR_RELEASE',
  AVAILABLE = 'AVAILABLE',
}

export enum PayoutCycleDay {
  WEDNESDAY = 'WEDNESDAY',
  SATURDAY = 'SATURDAY',
  MANUAL = 'MANUAL',
}

/**
 * ثابت‌های پیش‌فرض مصوب قوانین مالی جدید
 */
export const FINANCE_V2_CONSTANTS = {
  // برداشت تتر بوستر
  BOOSTER_USDT_WITHDRAWAL_FEE_CENTS: 40, // $0.40
  BOOSTER_USDT_NETWORK: 'BEP20',

  // برداشت تومانی بوستر
  BOOSTER_IRT_WITHDRAWAL_FEE_CENTS: 130, // $1.30
  BOOSTER_IRT_RATE_DISCOUNT_PER_USD: 3000, // 3,000 IRT discount per USD

  // خط‌مشی کارمزد اسکای‌کوچ مصوب مالک
  SKYCOACH_NEW_ORDER_FEE_RATE: 0.10, // 10% per order
  SKYCOACH_MIN_WITHDRAWAL_THRESHOLD_CENTS: 5000, // $50.00
  EXTERNAL_BNB_TRANSFER_FEE_CENTS: 30, // $0.30 when actually incurred

  // خط‌مشی‌های پلتفرم‌های دیگر
  G2G_SALE_COMMISSION_RATE: 0.0899, // 8.99%
  G2G_WITHDRAWAL_BATCH_RATE: 0.0399, // 3.99%
  G2G_WITHDRAWAL_BATCH_FIXED_CENTS: 99, // $0.99
  G2G_MIN_WITHDRAWAL_THRESHOLD_CENTS: 1000, // $10.00
  G2G_TOOBIT_BNB_TRANSFER_FEE_CENTS: 30, // $0.30

  ELDORADO_WOW_CURRENCY_RATE: 0.015, // 1.5%
  ELDORADO_MIN_WITHDRAWAL_THRESHOLD_CENTS: 20000, // $200.00
  ELDORADO_BNB_TRANSFER_ESTIMATE_CENTS: 150, // $1.50

  // هولد ۲۴ ساعته بوست‌های G4X
  G4X_BOOST_HOLD_HOURS: 24,
  LEGACY_ESCROW_HOLD_HOURS: 72,

  // پیکربندی پیش‌فرض زمان‌بندی تسویه تومان
  DEFAULT_PAYOUT_TIMEZONE: 'Asia/Tehran',
} as const;
