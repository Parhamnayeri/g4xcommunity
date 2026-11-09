/**
 * permissionTypes.ts — تعاریف متمرکز دسترسی‌ها، نقش‌ها و ماتریس مجوزهای پلتفرم G4X
 */

export enum Permission {
  // ۱. پیکربندی زیرساخت و سیستم (منحصراً Owner)
  SYSTEM_CONFIG_MANAGE = 'SYSTEM_CONFIG_MANAGE',
  SERVICE_CONFIG_MANAGE = 'SERVICE_CONFIG_MANAGE',
  CHANNEL_ROUTING_MANAGE = 'CHANNEL_ROUTING_MANAGE',
  AUDIT_LOG_VIEW = 'AUDIT_LOG_VIEW',
  SENSITIVE_IDENTITY_REVIEW = 'SENSITIVE_IDENTITY_REVIEW',

  // ۲. مدیریت نقش‌های کاربران و بررسی درخواست‌های عضویت
  USER_ROLE_ASSIGN = 'USER_ROLE_ASSIGN',
  USER_VIEW_PERMITTED = 'USER_VIEW_PERMITTED',
  USER_BAN = 'USER_BAN',
  BOOSTER_APPLICATION_REVIEW = 'BOOSTER_APPLICATION_REVIEW',
  PILOT_APPLICATION_REVIEW = 'PILOT_APPLICATION_REVIEW',
  ADVERTISER_APPLICATION_REVIEW = 'ADVERTISER_APPLICATION_REVIEW',
  EXCHANGER_APPLICATION_REVIEW = 'EXCHANGER_APPLICATION_REVIEW',

  // ۳. چرخه حیات و عملیات سفارشات
  ORDER_VIEW_PERMITTED = 'ORDER_VIEW_PERMITTED',
  ORDER_VIEW_PRIVATE = 'ORDER_VIEW_PRIVATE',
  ORDER_CREATE_INTERNAL = 'ORDER_CREATE_INTERNAL',
  ORDER_CREATE_ADVERTISER = 'ORDER_CREATE_ADVERTISER',
  ORDER_EDIT_OPERATIONAL = 'ORDER_EDIT_OPERATIONAL',
  ORDER_PAYMENT_VERIFY = 'ORDER_PAYMENT_VERIFY',
  ORDER_PUBLISH = 'ORDER_PUBLISH',
  ORDER_ASSIGN = 'ORDER_ASSIGN',
  ORDER_REPLACE_BOOSTER = 'ORDER_REPLACE_BOOSTER',
  ORDER_FINAL_APPROVE = 'ORDER_FINAL_APPROVE',
  ORDER_CANCEL = 'ORDER_CANCEL',

  // ۴. کلیم‌ها، تیم‌ها، ران‌ها، مدارک و اختلافات
  CLAIM_CREATE = 'CLAIM_CREATE',
  CLAIM_WITHDRAW = 'CLAIM_WITHDRAW',
  SQUAD_MANAGE_OWN = 'SQUAD_MANAGE_OWN',
  RUN_START_ASSIGNED = 'RUN_START_ASSIGNED',
  RUN_PAUSE_ASSIGNED = 'RUN_PAUSE_ASSIGNED',
  RUN_FINISH_ASSIGNED = 'RUN_FINISH_ASSIGNED',
  PROOF_SUBMIT_ASSIGNED = 'PROOF_SUBMIT_ASSIGNED',
  PROOF_REVIEW = 'PROOF_REVIEW',
  DISPUTE_CREATE = 'DISPUTE_CREATE',
  DISPUTE_REVIEW = 'DISPUTE_REVIEW',
  DISPUTE_RESOLVE = 'DISPUTE_RESOLVE',

  // ۵. صرافی و مبادلات ارزی
  EXCHANGER_OFFER_MANAGE_OWN = 'EXCHANGER_OFFER_MANAGE_OWN',
  EXCHANGER_TRADE_VIEW_OWN = 'EXCHANGER_TRADE_VIEW_OWN',

  // ۶. خزانه‌داری، والت و اسکرو
  WALLET_VIEW_OWN = 'WALLET_VIEW_OWN',
  FINANCE_ADMIN_VIEW = 'FINANCE_ADMIN_VIEW',
  WITHDRAWAL_VIEW = 'WITHDRAWAL_VIEW',
  WITHDRAWAL_REVIEW = 'WITHDRAWAL_REVIEW',
  MANUAL_DEPOSIT_REVIEW = 'MANUAL_DEPOSIT_REVIEW',
  FINANCE_ADJUST = 'FINANCE_ADJUST',
  FINANCIAL_POLICY_MANAGE = 'FINANCIAL_POLICY_MANAGE',
  ESCROW_HOLD_MANAGE = 'ESCROW_HOLD_MANAGE',
  ESCROW_RELEASE_ADMIN = 'ESCROW_RELEASE_ADMIN',

  // ۷. تیکت‌های پشتیبانی
  SUPPORT_TICKET_CREATE = 'SUPPORT_TICKET_CREATE',
  SUPPORT_TICKET_MANAGE = 'SUPPORT_TICKET_MANAGE',
}

/**
 * نقش‌های معتبر سیستم
 */
export type SystemRoleKey =
  | 'owner'
  | 'manager'
  | 'admin'
  | 'staff'
  | 'advertiser'
  | 'booster'
  | 'pilot'
  | 'exchanger';

/**
 * ماتریس پایه مجوزهای ثابت نقش‌ها (Role Permission Matrix)
 * سلسله‌مراتب مقتدرانه: Owner > Admin > Management (manager) > Staff
 * توجه: دسترسی‌های وابسته به مالکیت (Contextual Permissions) در سطح سرویس احراز می‌شوند.
 */
export const ROLE_PERMISSIONS: Record<SystemRoleKey, Permission[]> = {
  owner: [
    // ۱. مالک به عنوان سوپریوزر زیرساخت به تمامی مجوزها دسترسی دارد
    Permission.SYSTEM_CONFIG_MANAGE,
    Permission.SERVICE_CONFIG_MANAGE,
    Permission.CHANNEL_ROUTING_MANAGE,
    Permission.AUDIT_LOG_VIEW,
    Permission.SENSITIVE_IDENTITY_REVIEW,
    Permission.USER_ROLE_ASSIGN,
    Permission.USER_VIEW_PERMITTED,
    Permission.USER_BAN,
    Permission.BOOSTER_APPLICATION_REVIEW,
    Permission.PILOT_APPLICATION_REVIEW,
    Permission.ADVERTISER_APPLICATION_REVIEW,
    Permission.EXCHANGER_APPLICATION_REVIEW,
    Permission.ORDER_VIEW_PERMITTED,
    Permission.ORDER_VIEW_PRIVATE,
    Permission.ORDER_CREATE_INTERNAL,
    Permission.ORDER_CREATE_ADVERTISER,
    Permission.ORDER_EDIT_OPERATIONAL,
    Permission.ORDER_PAYMENT_VERIFY,
    Permission.ORDER_PUBLISH,
    Permission.ORDER_ASSIGN,
    Permission.ORDER_REPLACE_BOOSTER,
    Permission.ORDER_FINAL_APPROVE,
    Permission.ORDER_CANCEL,
    Permission.CLAIM_CREATE,
    Permission.CLAIM_WITHDRAW,
    Permission.SQUAD_MANAGE_OWN,
    Permission.RUN_START_ASSIGNED,
    Permission.RUN_PAUSE_ASSIGNED,
    Permission.RUN_FINISH_ASSIGNED,
    Permission.PROOF_SUBMIT_ASSIGNED,
    Permission.PROOF_REVIEW,
    Permission.DISPUTE_CREATE,
    Permission.DISPUTE_REVIEW,
    Permission.DISPUTE_RESOLVE,
    Permission.EXCHANGER_OFFER_MANAGE_OWN,
    Permission.EXCHANGER_TRADE_VIEW_OWN,
    Permission.WALLET_VIEW_OWN,
    Permission.FINANCE_ADMIN_VIEW,
    Permission.WITHDRAWAL_VIEW,
    Permission.WITHDRAWAL_REVIEW,
    Permission.MANUAL_DEPOSIT_REVIEW,
    Permission.FINANCE_ADJUST,
    Permission.FINANCIAL_POLICY_MANAGE,
    Permission.ESCROW_HOLD_MANAGE,
    Permission.ESCROW_RELEASE_ADMIN,
    Permission.SUPPORT_TICKET_CREATE,
    Permission.SUPPORT_TICKET_MANAGE,
  ],

  admin: [
    // ۲. ادمین: وراثت کامل اختیارات عملیاتی Staff و Management + دسترسی‌های اختصاصی:
    // بررسی مدارک حساس KYC، مدیریت و بررسی واریز/برداشت، انتساب نقش‌های غیرحساس، مسدودسازی، ایجاد و ویرایش سفارشات
    // فاقد اختیارات انحصاری مالک: SYSTEM_CONFIG_MANAGE, FINANCIAL_POLICY_MANAGE, ESCROW_HOLD_MANAGE, ESCROW_RELEASE_ADMIN, FINANCE_ADJUST
    Permission.SERVICE_CONFIG_MANAGE,
    Permission.CHANNEL_ROUTING_MANAGE,
    Permission.AUDIT_LOG_VIEW,
    Permission.SENSITIVE_IDENTITY_REVIEW,
    Permission.USER_ROLE_ASSIGN,
    Permission.USER_VIEW_PERMITTED,
    Permission.USER_BAN,
    Permission.BOOSTER_APPLICATION_REVIEW,
    Permission.PILOT_APPLICATION_REVIEW,
    Permission.ADVERTISER_APPLICATION_REVIEW,
    Permission.EXCHANGER_APPLICATION_REVIEW,
    Permission.ORDER_VIEW_PERMITTED,
    Permission.ORDER_VIEW_PRIVATE,
    Permission.ORDER_CREATE_INTERNAL,
    Permission.ORDER_EDIT_OPERATIONAL,
    Permission.ORDER_PAYMENT_VERIFY,
    Permission.ORDER_PUBLISH,
    Permission.ORDER_ASSIGN,
    Permission.ORDER_REPLACE_BOOSTER,
    Permission.ORDER_FINAL_APPROVE,
    Permission.ORDER_CANCEL,
    Permission.PROOF_REVIEW,
    Permission.DISPUTE_CREATE,
    Permission.DISPUTE_REVIEW,
    Permission.DISPUTE_RESOLVE,
    Permission.WALLET_VIEW_OWN,
    Permission.FINANCE_ADMIN_VIEW,
    Permission.WITHDRAWAL_VIEW,
    Permission.WITHDRAWAL_REVIEW,
    Permission.MANUAL_DEPOSIT_REVIEW,
    Permission.SUPPORT_TICKET_CREATE,
    Permission.SUPPORT_TICKET_MANAGE,
  ],

  manager: [
    // ۳. مدیریت (Management/manager): مدیریت عملیاتی سفارشات، کاربران و درخواست‌ها؛ مشاهده صرف صف برداشت (Read-Only)
    // فاقد: SENSITIVE_IDENTITY_REVIEW, WITHDRAWAL_REVIEW, MANUAL_DEPOSIT_REVIEW, USER_ROLE_ASSIGN, FINANCE_ADJUST, SYSTEM_CONFIG_MANAGE
    Permission.SERVICE_CONFIG_MANAGE,
    Permission.CHANNEL_ROUTING_MANAGE,
    Permission.AUDIT_LOG_VIEW,
    Permission.USER_VIEW_PERMITTED,
    Permission.USER_BAN,
    Permission.BOOSTER_APPLICATION_REVIEW,
    Permission.PILOT_APPLICATION_REVIEW,
    Permission.ADVERTISER_APPLICATION_REVIEW,
    Permission.EXCHANGER_APPLICATION_REVIEW,
    Permission.ORDER_VIEW_PERMITTED,
    Permission.ORDER_VIEW_PRIVATE,
    Permission.ORDER_CREATE_INTERNAL,
    Permission.ORDER_EDIT_OPERATIONAL,
    Permission.ORDER_PAYMENT_VERIFY,
    Permission.ORDER_PUBLISH,
    Permission.ORDER_ASSIGN,
    Permission.ORDER_REPLACE_BOOSTER,
    Permission.ORDER_FINAL_APPROVE,
    Permission.ORDER_CANCEL,
    Permission.PROOF_REVIEW,
    Permission.DISPUTE_CREATE,
    Permission.DISPUTE_REVIEW,
    Permission.DISPUTE_RESOLVE,
    Permission.WALLET_VIEW_OWN,
    Permission.FINANCE_ADMIN_VIEW,
    Permission.WITHDRAWAL_VIEW,
    Permission.SUPPORT_TICKET_CREATE,
    Permission.SUPPORT_TICKET_MANAGE,
  ],

  staff: [
    // ۴. پشتیبان/استاف: محیط کاری سفارشات و فهرست کاربران صرفاً فقط‌خواندنی؛ بررسی مدارک ران‌ها، تیکت‌ها و اختلافات
    // فاقد: ایجاد، ویرایش، لغو، انتساب بوستر، بررسی پرداخت، تایید نهایی، بن/آن‌بن و دسترسی به اسناد حساس
    Permission.ORDER_VIEW_PERMITTED,
    Permission.USER_VIEW_PERMITTED,
    Permission.PROOF_REVIEW,
    Permission.DISPUTE_REVIEW,
    Permission.DISPUTE_CREATE,
    Permission.SUPPORT_TICKET_CREATE,
    Permission.SUPPORT_TICKET_MANAGE,
    Permission.WALLET_VIEW_OWN,
  ],

  advertiser: [
    // ادورتایزر: ایجاد سفارشات مجاز؛ تخصیص کاندیداها صرفاً روی سفارشات خودش؛ فاقد تایید واریز یا اتمام نهایی
    Permission.ORDER_CREATE_ADVERTISER,
    Permission.DISPUTE_CREATE,
    Permission.SUPPORT_TICKET_CREATE,
    Permission.WALLET_VIEW_OWN,
  ],

  booster: [
    // بوستر: ثبت کلیم در صورت داشتن صلاحیت؛ ثبت مدرک ران‌های منتسب؛ فاقد بررسی مدرک یا تایید نهایی
    Permission.PROOF_SUBMIT_ASSIGNED,
    Permission.CLAIM_CREATE,
    Permission.CLAIM_WITHDRAW,
    Permission.SQUAD_MANAGE_OWN,
    Permission.RUN_START_ASSIGNED,
    Permission.RUN_PAUSE_ASSIGNED,
    Permission.RUN_FINISH_ASSIGNED,
    Permission.DISPUTE_CREATE,
    Permission.SUPPORT_TICKET_CREATE,
    Permission.WALLET_VIEW_OWN,
  ],

  pilot: [
    // پایلوت: نیازمند احراز هویت مجزای پایلوت و تاییدیه سرویس است
    Permission.PROOF_SUBMIT_ASSIGNED,
    Permission.CLAIM_CREATE,
    Permission.CLAIM_WITHDRAW,
    Permission.RUN_START_ASSIGNED,
    Permission.RUN_PAUSE_ASSIGNED,
    Permission.RUN_FINISH_ASSIGNED,
    Permission.DISPUTE_CREATE,
    Permission.SUPPORT_TICKET_CREATE,
    Permission.WALLET_VIEW_OWN,
  ],

  exchanger: [
    // صراف: مدیریت پیشنهادات و معاملات صرافی خودش؛ فاقد دسترسی به سفارشات بوست و اسناد هویتی
    Permission.EXCHANGER_OFFER_MANAGE_OWN,
    Permission.EXCHANGER_TRADE_VIEW_OWN,
    Permission.SUPPORT_TICKET_CREATE,
    Permission.WALLET_VIEW_OWN,
  ],
};

/**
 * محاسبه اجتماع مجوزهای اعطا شده از کلیه نقش‌های فعال کاربر
 */
export function getEffectivePermissions(roleKeys: string[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roleKeys) {
    const perms = ROLE_PERMISSIONS[role as SystemRoleKey] || [];
    for (const p of perms) {
      set.add(p);
    }
  }
  return Array.from(set);
}

/**
 * عملیات حساس نیازمند ثبت لاگ ممیزی در AuditLog
 */
export const SENSITIVE_PERMISSIONS: Permission[] = [
  Permission.SYSTEM_CONFIG_MANAGE,
  Permission.SERVICE_CONFIG_MANAGE,
  Permission.SENSITIVE_IDENTITY_REVIEW,
  Permission.USER_ROLE_ASSIGN,
  Permission.USER_BAN,
  Permission.ORDER_PAYMENT_VERIFY,
  Permission.ORDER_FINAL_APPROVE,
  Permission.WITHDRAWAL_REVIEW,
  Permission.MANUAL_DEPOSIT_REVIEW,
  Permission.FINANCE_ADJUST,
  Permission.FINANCIAL_POLICY_MANAGE,
  Permission.ESCROW_HOLD_MANAGE,
  Permission.ESCROW_RELEASE_ADMIN,
];

/**
 * کانتکست اطلاعات منبع جهت ارزیابی مجوزهای زمینه‌ای (Contextual Authorization)
 */
export interface AuthorizationContext {
  orderId?: number;
  order?: {
    id: number;
    advertiserId?: string | null;
    creatorId?: string | null;
    creatorType?: string | null;
    gameSlug: string;
    serviceId: number;
    orderMode?: string;
    status: string;
    sourceType?: string;
    sourceWebsite?: string | null;
    externalOrderId?: string | null;
  };
  runId?: number;
  assignmentId?: number;
  squadId?: number;
  offerId?: number;
  tradeId?: number;
  targetUserId?: string;
  gameSlug?: string;
  serviceId?: number;
}
