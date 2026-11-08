import { Permission } from './permissionTypes';

/** UI capabilities only; mutations still reauthorize in the existing domain services. */
export function orderWorkspaceActions(
  order: {
    status: string;
    paymentStatus: string;
    creatorType: string;
    discordMessageId?: string | null;
    assignments?: unknown[];
    boostReleaseTracker?: { stage: string; adminFinalApprovedAt?: Date | null } | null;
    disputes?: { status: string }[];
    escrowHolds?: { status: string }[];
  },
  permissions: ReadonlySet<Permission>,
  publishable: boolean,
): string[] {
  const actions = ['view_diagnostics'];
  if (['completed', 'cancelled'].includes(order.status)) return actions;
  if (permissions.has(Permission.ORDER_CANCEL)) actions.push('cancel');
  if (permissions.has(Permission.ORDER_PUBLISH)) {
    if (order.discordMessageId && ['verified', 'unneeded'].includes(order.paymentStatus))
      actions.push('refresh_card');
    else if (publishable) actions.push('publish');
  }
  const unpaid = order.paymentStatus === 'pending' && ['draft', 'payment_pending'].includes(order.status);
  if (unpaid && permissions.has(Permission.ORDER_PAYMENT_VERIFY))
    actions.push('pay_wallet', 'verify_payment');
  if (
    ['open_presign', 'presign_closed'].includes(order.status) &&
    ['verified', 'unneeded'].includes(order.paymentStatus) &&
    permissions.has(Permission.ORDER_ASSIGN)
  )
    actions.push('assign');
  const blocked =
    order.disputes?.some((d) => ['open', 'under_review', 'waiting_for_evidence'].includes(d.status)) ||
    order.escrowHolds?.some((h) => h.status === 'active');
  if (order.creatorType === 'g4x' && !blocked) {
    if (order.boostReleaseTracker?.stage === 'PROOF_SUBMITTED' && permissions.has(Permission.PROOF_REVIEW))
      actions.push('staff_review');
    if (
      order.boostReleaseTracker?.stage === 'STAFF_REVIEW' &&
      !order.boostReleaseTracker.adminFinalApprovedAt &&
      permissions.has(Permission.ORDER_FINAL_APPROVE)
    )
      actions.push('final_approve');
  }
  return actions;
}
