/**
 * statusSimplifier.ts — نگاشت یکپارچه وضعیت‌های فنی به ۶ برچسب ساده و شفاف کاربر (MVP User-Facing States)
 *
 * برچسب‌های استاندارد کاربر:
 *  1. Pending
 *  2. In Progress
 *  3. Awaiting Verification
 *  4. Completed
 *  5. Cancelled
 *  6. Disputed
 *
 * این ماژول وضعیت‌های داخلی را بدون تخریب جزئیات ممیزی و حسابداری، به برچسب‌های استاندارد ترجمه می‌کند.
 */

export type SimplifiedStatus =
  | 'Pending'
  | 'In Progress'
  | 'Awaiting Verification'
  | 'Completed'
  | 'Cancelled'
  | 'Disputed';

export interface SimplifiedStatusResult {
  label: SimplifiedStatus;
  colorClass: 'badge-amber' | 'badge-blue' | 'badge-purple' | 'badge-green' | 'badge-red' | 'badge-gray';
  rawStatus: string;
}

/**
 * نگاشت وضعیت سفارش بوست (Order / G4XBoostReleaseTracker)
 */
export function mapOrderStatus(rawStatus: string, releaseStage?: string | null): SimplifiedStatusResult {
  const norm = (rawStatus || '').toLowerCase();
  const stage = (releaseStage || '').toUpperCase();

  if (norm === 'disputed') {
    return { label: 'Disputed', colorClass: 'badge-red', rawStatus };
  }
  if (norm === 'cancelled' || norm === 'rejected') {
    return { label: 'Cancelled', colorClass: 'badge-gray', rawStatus };
  }
  if (norm === 'completed') {
    if (stage === 'RUN_COMPLETED' || stage === 'PROOF_SUBMITTED' || stage === 'STAFF_REVIEW' || stage === 'HOLD_24_HOURS') {
      return { label: 'Awaiting Verification', colorClass: 'badge-purple', rawStatus: stage || norm };
    }
    return { label: 'Completed', colorClass: 'badge-green', rawStatus };
  }
  if (norm === 'assigned' || norm === 'in_progress') {
    return { label: 'In Progress', colorClass: 'badge-blue', rawStatus };
  }
  // open_presign, draft, pending
  return { label: 'Pending', colorClass: 'badge-amber', rawStatus };
}

/**
 * نگاشت وضعیت معاملات طلا (GoldTrade)
 */
export function mapGoldTradeStatus(rawStatus: string): SimplifiedStatusResult {
  const norm = (rawStatus || '').toUpperCase();

  if (norm === 'DISPUTED') {
    return { label: 'Disputed', colorClass: 'badge-red', rawStatus };
  }
  if (norm === 'CANCELLED' || norm === 'REJECTED') {
    return { label: 'Cancelled', colorClass: 'badge-gray', rawStatus };
  }
  if (norm === 'SETTLED') {
    return { label: 'Completed', colorClass: 'badge-green', rawStatus };
  }
  if (
    norm === 'GOLD_DELIVERED' ||
    norm === 'DELIVERY_VERIFIED' ||
    norm === 'PAYMENT_PENDING' ||
    norm === 'PAYMENT_VERIFIED' ||
    norm === 'READY_TO_SETTLE'
  ) {
    return { label: 'Awaiting Verification', colorClass: 'badge-purple', rawStatus };
  }
  if (norm === 'ACCEPTED' || norm === 'FUNDS_RESERVED' || norm === 'GOLD_DELIVERY_PENDING') {
    return { label: 'In Progress', colorClass: 'badge-blue', rawStatus };
  }
  // DRAFT, QUOTED
  return { label: 'Pending', colorClass: 'badge-amber', rawStatus };
}

/**
 * نگاشت وضعیت درخواست‌های برداشت بوستر (BoosterWithdrawalRequest)
 */
export function mapWithdrawalStatus(rawStatus: string): SimplifiedStatusResult {
  const norm = (rawStatus || '').toUpperCase();

  if (norm === 'REJECTED' || norm === 'CANCELLED') {
    return { label: 'Cancelled', colorClass: 'badge-gray', rawStatus };
  }
  if (norm === 'PAID') {
    return { label: 'Completed', colorClass: 'badge-green', rawStatus };
  }
  if (norm === 'ADMIN_APPROVED' || norm === 'PROCESSING') {
    return { label: 'Awaiting Verification', colorClass: 'badge-purple', rawStatus };
  }
  if (norm === 'USER_CONFIRMED' || norm === 'RESERVED' || norm === 'SCHEDULED') {
    return { label: 'In Progress', colorClass: 'badge-blue', rawStatus };
  }
  // DRAFT, QUOTED
  return { label: 'Pending', colorClass: 'badge-amber', rawStatus };
}

/**
 * نگاشت وضعیت درخواست‌های ثبت‌نام (RegistrationApplication)
 */
export function mapApplicationStatus(rawStatus: string): SimplifiedStatusResult {
  const norm = (rawStatus || '').toLowerCase();

  if (norm === 'approved') {
    return { label: 'Completed', colorClass: 'badge-green', rawStatus };
  }
  if (norm === 'rejected' || norm === 'cancelled') {
    return { label: 'Cancelled', colorClass: 'badge-gray', rawStatus };
  }
  if (
    norm === 'under_review' ||
    norm === 'info_requested' ||
    norm === 'awaiting_identity_verification'
  ) {
    return { label: 'Awaiting Verification', colorClass: 'badge-purple', rawStatus };
  }
  // pending
  return { label: 'Pending', colorClass: 'badge-amber', rawStatus };
}
