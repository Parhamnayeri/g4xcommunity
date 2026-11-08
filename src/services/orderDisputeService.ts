/**
 * orderDisputeService.ts — مدیریت اختلافات و بازبینی شواهد سفارشات (Order Disputes & Proof Review)
 * 
 * فاز ۲ تکمیلی:
 *  - چرخه حیات استاندارد اختلاف: OPEN -> UNDER_REVIEW -> AWAITING_EVIDENCE -> RESOLVED / CANCELLED / REJECTED
 *  - ثبت خودکار توقیف اسکرو (EscrowHold) و ممانعت اکید از آزادسازی مالی تا زمان تعیین تکلیف
 *  - جلوگیری از ایجاد مناقشه تکراری فعال برای یک سفارش
 *  - جداسازی اختیار بازبینی شواهد (Staff) از اختیار صدور رای نهایی (Admin / Owner)
 *  - ممنوعیت اکید خود-تصویبی (Self-Approval Prohibition) برای اعضای ذی‌نفع در تراکنش
 *  - اعتبارسنجی فرمت پیوندهای مدارک و شواهد
 *  - همگام‌سازی اعلانات انگلیسی در کانال خصوصی هماهنگی سفارش
 *  - ایمنی مالی ۱۰۰٪: عدم اعمال اعتبار والت، عدم پرداخت یا جابجایی وجه
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import { EmbedBuilder } from 'discord.js';
import { recordProofSubmitted, recordStaffReview } from './financeV2/g4xBoostReleaseService';
import { Prisma } from '@prisma/client';

export const VALID_DISPUTE_TYPES = [
  'completion',
  'quality',
  'misconduct',
  'key_failure',
  'payment',
  'other',
] as const;

export type DisputeType = (typeof VALID_DISPUTE_TYPES)[number];

export const VALID_DISPUTE_STATUSES = [
  'open',
  'under_review',
  'waiting_for_evidence',
  'resolved',
  'rejected',
  'cancelled',
] as const;

export type DisputeStatus = (typeof VALID_DISPUTE_STATUSES)[number];

export interface OpenDisputeInput {
  orderId: number;
  actorId: string;
  disputeType: string;
  description: string;
  evidenceUrl?: string;
  runId?: number;
  discordClient?: any;
}

export interface RequestEvidenceInput {
  disputeId: number;
  staffId: string;
  requestNotes: string;
  discordClient?: any;
}

export interface SubmitEvidenceInput {
  disputeId: number;
  actorId: string;
  evidenceUrl: string;
  description?: string;
  discordClient?: any;
}

export interface AddReviewNotesInput {
  disputeId: number;
  staffId: string;
  notes: string;
}

export interface ResolveDisputeInput {
  disputeId: number;
  resolverId: string;
  decision: 'resolved' | 'rejected' | 'cancelled';
  resolutionNotes: string;
  discordClient?: any;
}

export interface SubmitProofInput {
  runId: number;
  submittedById: string;
  proofType?: string;
  evidenceUrl: string;
  description?: string;
  discordClient?: any;
}

export interface ReviewProofInput {
  proofId: number;
  reviewerId: string;
  decision: 'approve' | 'reject';
  reviewNotes?: string;
  discordClient?: any;
}

/**
 * Validates that an evidence URL is a valid web URL and not a script or dangerous URI scheme.
 */
export function validateEvidenceUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.length < 5 || trimmed.length > 2048) return false;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    // Allow internal storage keys like proof_ord_123_run_1.png
    if (/^[a-zA-Z0-9_\-\.\/]+\.(png|jpg|jpeg|webp|gif|mp4|webm)$/i.test(trimmed)) {
      return true;
    }
    return false;
  }
}

/**
 * Maps internal technical dispute statuses to simple human-readable English labels.
 */
export function formatDisputeStatusLabel(status: string): { label: string; badgeClass: string } {
  switch (status) {
    case 'open':
      return { label: 'Open', badgeClass: 'badge-amber' };
    case 'under_review':
      return { label: 'Under Review', badgeClass: 'badge-blue' };
    case 'waiting_for_evidence':
      return { label: 'Awaiting Evidence', badgeClass: 'badge-purple' };
    case 'resolved':
      return { label: 'Resolved', badgeClass: 'badge-green' };
    case 'rejected':
      return { label: 'Rejected', badgeClass: 'badge-red' };
    case 'cancelled':
      return { label: 'Cancelled', badgeClass: 'badge-gray' };
    default:
      return { label: status.toUpperCase(), badgeClass: 'badge' };
  }
}

/**
 * Helper to post English notifications to the order's execution channel.
 */
async function notifyOrderExecutionChannel(
  orderId: number,
  client: any,
  embed: EmbedBuilder
): Promise<void> {
  if (!client) return;
  try {
    const mapping = await prisma.orderChannel.findFirst({
      where: { orderId, channelType: 'execution', status: 'active' },
    });
    if (!mapping) return;

    let channel = client.channels?.cache?.get?.(mapping.discordChannelId);
    if (!channel && typeof client.channels?.fetch === 'function') {
      channel = await client.channels.fetch(mapping.discordChannelId).catch(() => null);
    }

    if (channel && typeof channel.send === 'function') {
      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.warn(`[OrderDisputeService] Could not send dispute update to channel:`, err);
  }
}

/**
 * 1. Open a new dispute on an eligible order.
 */
export async function openOrderDispute(input: OpenDisputeInput) {
  const { orderId, actorId, disputeType, description, evidenceUrl, runId, discordClient } = input;

  if (!description || description.trim().length < 5) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      'A meaningful dispute description (minimum 5 characters) is required.'
    );
  }

  if (evidenceUrl && !validateEvidenceUrl(evidenceUrl)) {
    throw new DomainError(
      DomainErrorCode.INVALID_EVIDENCE_URL,
      'Invalid evidence URL format. Must be an HTTP/HTTPS link or valid screenshot reference.'
    );
  }

  // 1. Fetch order with participants
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      assignments: { where: { status: 'assigned' } },
      runs: true,
      disputes: {
        where: { status: { in: ['open', 'under_review', 'waiting_for_evidence'] } },
      },
    },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} not found`);
  }

  // 2. Lifecycle Check: Cannot dispute draft, payment_pending or already cancelled orders
  if (['draft', 'payment_pending', 'cancelled'].includes(order.status)) {
    throw new DomainError(
      DomainErrorCode.INVALID_ORDER_TRANSITION,
      `Cannot open dispute for order #${orderId} in '${order.status}' status`
    );
  }

  // 3. Participant Authorization Check: Must be assigned booster, customer, advertiser, or creator
  const isAssignedBooster = order.assignments.some((a) => a.userId === actorId);
  const isOrderCustomer = order.customerId === actorId;
  const isOrderAdvertiser = order.advertiserId === actorId;
  const isOrderCreator = order.creatorId === actorId;

  if (!isAssignedBooster && !isOrderCustomer && !isOrderAdvertiser && !isOrderCreator) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      `User '${actorId}' is not an authorized participant for order #${orderId}`
    );
  }

  // 4. Duplicate Active Dispute Check
  if (order.disputes && order.disputes.length > 0) {
    throw new DomainError(
      DomainErrorCode.DUPLICATE_ACTIVE_DISPUTE,
      `Order #${orderId} already has an active dispute (#${order.disputes[0].id}) under review`
    );
  }

  // 5. Run Verification if runId is specified
  if (runId) {
    const run = order.runs.find((r) => r.id === runId);
    if (!run) {
      throw new DomainError(
        DomainErrorCode.RUN_ORDER_MISMATCH,
        `Run #${runId} does not belong to order #${orderId}`
      );
    }
  }

  // 6. Atomic creation of OrderDispute, EscrowHold, and AuditLog
  const result = await prisma.$transaction(async (tx) => {
    const dispute = await tx.orderDispute.create({
      data: {
        orderId: order.id,
        runId: runId || null,
        openedById: actorId,
        disputeType: VALID_DISPUTE_TYPES.includes(disputeType as any) ? disputeType : 'other',
        description: description.trim(),
        status: 'open',
        resolutionNotes: evidenceUrl ? `Initial Evidence: ${evidenceUrl.trim()}` : null,
      },
    });

    const hold = await tx.escrowHold.create({
      data: {
        disputeId: dispute.id,
        orderId: order.id,
        currency: order.currency,
        amountMinor: order.grossAmountMinor,
        status: 'active',
        createdById: actorId,
        reason: `Dispute #${dispute.id} (${dispute.disputeType}) opened by participant`,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'ORDER_DISPUTE_OPENED',
        entityType: 'OrderDispute',
        entityId: String(dispute.id),
        newValues: JSON.stringify({
          disputeId: dispute.id,
          orderId: order.id,
          disputeType: dispute.disputeType,
          description: dispute.description,
          holdId: hold.id,
        }),
      },
    });

    return { dispute, hold };
  });

  // 7. Post English Notification in Coordination Channel
  if (discordClient) {
    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle(`⚠️ Dispute Opened: Order #${order.id}`)
      .setDescription(
        `A participant has reported an issue regarding Order #${order.id}.\n\n` +
          `• **Opened By:** <@${actorId}>\n` +
          `• **Dispute Type:** ${result.dispute.disputeType.toUpperCase()}\n` +
          `• **Explanation:** ${description.trim()}\n` +
          (evidenceUrl ? `• **Evidence Attached:** ${evidenceUrl.trim()}\n` : '') +
          `• **Financial Status:** Release paused pending staff review.\n` +
          `• **Channel Status:** Retention active; channel will not be archived.`
      )
      .setFooter({ text: 'G4X Community — Dispute & Proof System' })
      .setTimestamp();

    await notifyOrderExecutionChannel(order.id, discordClient, embed);

    try {
      const { publishOrRefreshOrderCard } = await import('./orderDiscordService');
      await publishOrRefreshOrderCard(discordClient, order.id);
    } catch (err) {
      console.warn(`[OrderDisputeService] Could not refresh public card after dispute opened:`, err);
    }
  }

  return result;
}

/**
 * 2. Staff requests additional evidence from the claimant/participants.
 */
export async function requestDisputeEvidence(input: RequestEvidenceInput) {
  const { disputeId, staffId, requestNotes, discordClient } = input;

  if (!requestNotes || requestNotes.trim().length < 3) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      'A specific evidence request note is required.'
    );
  }

  const dispute = await prisma.orderDispute.findUnique({
    where: { id: disputeId },
    include: { order: true },
  });

  if (!dispute) {
    throw new DomainError(DomainErrorCode.DISPUTE_NOT_FOUND, `Dispute #${disputeId} not found`);
  }

  if (['resolved', 'rejected', 'cancelled'].includes(dispute.status)) {
    throw new DomainError(
      DomainErrorCode.DISPUTE_ALREADY_RESOLVED,
      `Cannot request evidence for dispute #${disputeId} in '${dispute.status}' status`
    );
  }

  const updatedNotes = dispute.resolutionNotes
    ? `${dispute.resolutionNotes}\n[Staff Request by ${staffId}]: ${requestNotes.trim()}`
    : `[Staff Request by ${staffId}]: ${requestNotes.trim()}`;

  const updatedDispute = await prisma.$transaction(async (tx) => {
    const res = await tx.orderDispute.update({
      where: { id: disputeId },
      data: {
        status: 'waiting_for_evidence',
        assignedReviewerId: staffId,
        resolutionNotes: updatedNotes,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: staffId,
        action: 'DISPUTE_EVIDENCE_REQUESTED',
        entityType: 'OrderDispute',
        entityId: String(disputeId),
        newValues: JSON.stringify({
          disputeId,
          orderId: dispute.orderId,
          requestNotes: requestNotes.trim(),
        }),
      },
    });

    return res;
  });

  if (discordClient) {
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`📋 Additional Evidence Requested: Order #${dispute.orderId}`)
      .setDescription(
        `Staff has reviewed Dispute #${dispute.id} and requested additional information.\n\n` +
          `• **Staff Reviewer:** <@${staffId}>\n` +
          `• **Requested Details:** ${requestNotes.trim()}\n` +
          `• **Action Required:** Please reply in this channel or submit via the Web Portal.`
      )
      .setFooter({ text: 'G4X Community — Dispute & Proof System' })
      .setTimestamp();

    await notifyOrderExecutionChannel(dispute.orderId, discordClient, embed);
  }

  return updatedDispute;
}

/**
 * 3. Participant submits additional evidence response on their dispute.
 */
export async function submitDisputeEvidence(input: SubmitEvidenceInput) {
  const { disputeId, actorId, evidenceUrl, description, discordClient } = input;

  if (!validateEvidenceUrl(evidenceUrl)) {
    throw new DomainError(
      DomainErrorCode.INVALID_EVIDENCE_URL,
      'Invalid evidence URL format. Must be an HTTP/HTTPS link or valid screenshot reference.'
    );
  }

  const dispute = await prisma.orderDispute.findUnique({
    where: { id: disputeId },
    include: {
      order: {
        include: { assignments: { where: { status: 'assigned' } } },
      },
    },
  });

  if (!dispute) {
    throw new DomainError(DomainErrorCode.DISPUTE_NOT_FOUND, `Dispute #${disputeId} not found`);
  }

  if (['resolved', 'rejected', 'cancelled'].includes(dispute.status)) {
    throw new DomainError(
      DomainErrorCode.DISPUTE_ALREADY_RESOLVED,
      `Cannot submit evidence for dispute #${disputeId} in '${dispute.status}' status`
    );
  }

  // Authorized participant check
  const isOpener = dispute.openedById === actorId;
  const isBooster = dispute.order.assignments.some((a) => a.userId === actorId);
  const isCustomer = dispute.order.customerId === actorId;
  const isAdvertiser = dispute.order.advertiserId === actorId;

  if (!isOpener && !isBooster && !isCustomer && !isAdvertiser) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      `User '${actorId}' is not authorized to submit evidence on dispute #${disputeId}`
    );
  }

  const appendText = `\n[Evidence by ${actorId}]: ${evidenceUrl.trim()} ${description ? '(' + description.trim() + ')' : ''}`;
  const updatedNotes = (dispute.resolutionNotes || '') + appendText;

  const updatedDispute = await prisma.$transaction(async (tx) => {
    const res = await tx.orderDispute.update({
      where: { id: disputeId },
      data: {
        status: 'under_review',
        resolutionNotes: updatedNotes,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'DISPUTE_EVIDENCE_SUBMITTED',
        entityType: 'OrderDispute',
        entityId: String(disputeId),
        newValues: JSON.stringify({
          disputeId,
          evidenceUrl: evidenceUrl.trim(),
          description,
        }),
      },
    });

    return res;
  });

  if (discordClient) {
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`📸 Evidence Submitted: Order #${dispute.orderId}`)
      .setDescription(
        `New evidence has been uploaded for Dispute #${dispute.id}.\n\n` +
          `• **Submitted By:** <@${actorId}>\n` +
          `• **Evidence Link:** ${evidenceUrl.trim()}\n` +
          (description ? `• **Notes:** ${description.trim()}\n` : '') +
          `• **Status:** Transitioned to Under Review.`
      )
      .setFooter({ text: 'G4X Community — Dispute & Proof System' })
      .setTimestamp();

    await notifyOrderExecutionChannel(dispute.orderId, discordClient, embed);
  }

  return updatedDispute;
}

/**
 * 4. Staff adds internal notes or moves dispute to UNDER_REVIEW.
 */
export async function addDisputeReviewNotes(input: AddReviewNotesInput) {
  const { disputeId, staffId, notes } = input;

  const dispute = await prisma.orderDispute.findUnique({
    where: { id: disputeId },
  });

  if (!dispute) {
    throw new DomainError(DomainErrorCode.DISPUTE_NOT_FOUND, `Dispute #${disputeId} not found`);
  }

  const appendText = `\n[Review Note by ${staffId}]: ${notes.trim()}`;
  const updatedNotes = (dispute.resolutionNotes || '') + appendText;

  const nextStatus = dispute.status === 'open' ? 'under_review' : dispute.status;

  return await prisma.$transaction(async (tx) => {
    const res = await tx.orderDispute.update({
      where: { id: disputeId },
      data: {
        status: nextStatus,
        assignedReviewerId: staffId,
        resolutionNotes: updatedNotes,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: staffId,
        action: 'DISPUTE_REVIEW_NOTE_ADDED',
        entityType: 'OrderDispute',
        entityId: String(disputeId),
        newValues: JSON.stringify({ disputeId, notes: notes.trim() }),
      },
    });

    return res;
  });
}

/**
 * 5. Final resolution of an order dispute by an Admin or Owner.
 * Prohibits self-approval when the reviewer is materially involved.
 * Releases the EscrowHold without executing real wallet balances.
 */
export async function resolveOrderDispute(input: ResolveDisputeInput) {
  const { disputeId, resolverId, decision, resolutionNotes, discordClient } = input;

  if (!resolutionNotes || resolutionNotes.trim().length < 5) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      'A mandatory non-empty resolution explanation (minimum 5 characters) is required.'
    );
  }

  const dispute = await prisma.orderDispute.findUnique({
    where: { id: disputeId },
    include: {
      order: {
        include: { assignments: { where: { status: 'assigned' } } },
      },
      escrowHolds: true,
    },
  });

  if (!dispute) {
    throw new DomainError(DomainErrorCode.DISPUTE_NOT_FOUND, `Dispute #${disputeId} not found`);
  }

  if (['resolved', 'rejected', 'cancelled'].includes(dispute.status)) {
    throw new DomainError(
      DomainErrorCode.DISPUTE_ALREADY_RESOLVED,
      `Dispute #${disputeId} has already been concluded with status '${dispute.status}'`
    );
  }

  // 1. Verify Resolver Authority in DB: Admin or Owner ONLY (Staff cannot resolve final disputes)
  const userRoles = await prisma.userRole.findMany({
    where: { userId: resolverId },
  });
  const roleKeys = userRoles.map((r) => r.roleKey.toLowerCase());
  const hasResolutionAuthority = roleKeys.some((k) => ['admin', 'owner'].includes(k));

  if (!hasResolutionAuthority) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      'Final dispute resolution authority is reserved for Admin and Owner roles only.'
    );
  }

  // 2. Strict Self-Approval Prohibition: Materially involved reviewer cannot self-approve
  const isClaimant = dispute.openedById === resolverId;
  const isAdvertiser = dispute.order.advertiserId === resolverId;
  const isCustomer = dispute.order.customerId === resolverId;
  const isAssignedBooster = dispute.order.assignments.some((a) => a.userId === resolverId);

  if (isClaimant || isAdvertiser || isCustomer || isAssignedBooster) {
    throw new DomainError(
      DomainErrorCode.SELF_APPROVAL_PROHIBITED,
      'Reviewers cannot resolve disputes where they are materially involved as claimant, customer, advertiser, or booster.'
    );
  }

  const now = new Date();
  const finalStatus = decision === 'rejected' ? 'rejected' : decision === 'cancelled' ? 'cancelled' : 'resolved';

  // 3. Atomic Database Update: Dispute status and EscrowHold release
  // CRITICAL: Absolutely NO WalletV2 balances or ledger transactions are credited here.
  const resolvedDispute = await prisma.$transaction(async (tx) => {
    const updated = await tx.orderDispute.update({
      where: { id: disputeId },
      data: {
        status: finalStatus,
        resolvedById: resolverId,
        resolvedAt: now,
        resolutionNotes: `${dispute.resolutionNotes || ''}\n[FINAL RESOLUTION by ${resolverId}]: ${resolutionNotes.trim()}`.trim(),
      },
    });

    // Release linked active escrow holds so financial pipelines can evaluate separately
    for (const hold of dispute.escrowHolds) {
      if (['active', 'pending'].includes(hold.status)) {
        await tx.escrowHold.update({
          where: { id: hold.id },
          data: {
            status: 'released',
            releasedById: resolverId,
            releasedAt: now,
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        actorId: resolverId,
        action: 'ORDER_DISPUTE_RESOLVED',
        entityType: 'OrderDispute',
        entityId: String(disputeId),
        newValues: JSON.stringify({
          disputeId,
          orderId: dispute.orderId,
          decision,
          finalStatus,
          resolutionNotes: resolutionNotes.trim(),
        }),
      },
    });

    return updated;
  });

  // 4. English Notification in Coordination Channel
  if (discordClient) {
    const embed = new EmbedBuilder()
      .setColor(finalStatus === 'resolved' ? 0x2ecc71 : 0x95a5a6)
      .setTitle(`⚖️ Dispute Concluded: Order #${dispute.orderId}`)
      .setDescription(
        `Dispute #${dispute.id} has been formally reviewed and resolved by Administration.\n\n` +
          `• **Decision:** ${finalStatus.toUpperCase()}\n` +
          `• **Resolved By:** <@${resolverId}>\n` +
          `• **Resolution Summary:** ${resolutionNotes.trim()}\n` +
          `• **Note:** Any financial adjustments must follow a separate, authorized operation.`
      )
      .setFooter({ text: 'G4X Community — Dispute & Proof System' })
      .setTimestamp();

    await notifyOrderExecutionChannel(dispute.orderId, discordClient, embed);

    try {
      const { publishOrRefreshOrderCard } = await import('./orderDiscordService');
      await publishOrRefreshOrderCard(discordClient, dispute.orderId);
    } catch (err) {
      console.warn(`[OrderDisputeService] Could not refresh public card after dispute resolved:`, err);
    }
  }

  return resolvedDispute;
}

/**
 * 6. Submit proof for an order run.
 */
export async function submitRunProof(input: SubmitProofInput) {
  const { runId, submittedById, proofType = 'screenshot', evidenceUrl, description, discordClient } = input;

  if (!validateEvidenceUrl(evidenceUrl)) {
    throw new DomainError(
      DomainErrorCode.INVALID_EVIDENCE_URL,
      'Invalid evidence URL format. Must be an HTTP/HTTPS link or valid screenshot reference.'
    );
  }

  const run = await prisma.orderRun.findUnique({
    where: { id: runId },
    include: {
      order: {
        include: { assignments: { where: { status: 'assigned' } } },
      },
    },
  });

  if (!run) {
    throw new DomainError(DomainErrorCode.RUN_NOT_FOUND, `Run #${runId} not found`);
  }

  // Authorization: Must be an assigned booster, order creator or advertiser
  const isAssignedBooster = run.order.assignments.some((a) => a.userId === submittedById);
  const isAdvertiser = run.order.advertiserId === submittedById;
  const isCreator = run.order.creatorId === submittedById;

  if (!isAssignedBooster && !isAdvertiser && !isCreator) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      `User '${submittedById}' is not authorized to submit proof for run #${runId}`
    );
  }

  const proof = await prisma.$transaction(async (tx) => {
    const created = await tx.runProof.create({
      data: {
        runId: run.id,
        submittedById,
        proofType,
        evidenceUrl: evidenceUrl.trim(),
        description: description?.trim() || null,
        status: 'pending',
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: submittedById,
        action: 'RUN_PROOF_SUBMITTED',
        entityType: 'RunProof',
        entityId: String(created.id),
        newValues: JSON.stringify({
          proofId: created.id,
          runId: run.id,
          orderId: run.orderId,
          proofType,
          evidenceUrl: evidenceUrl.trim(),
        }),
      },
    });

    return created;
  });

  // Track in boost release tracker if G4X order
  if (run.order.creatorType === 'g4x' && run.status === 'completed') {
    try {
      await recordProofSubmitted(run.orderId, submittedById);
    } catch (trackerErr) {
      console.warn('[OrderDisputeService] Release tracker update notice:', trackerErr);
    }
  }

  if (discordClient) {
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`📸 Completion Proof Uploaded: Order #${run.orderId}`)
      .setDescription(
        `Proof of completion for Run #${run.runNumber} has been submitted.\n\n` +
          `• **Submitted By:** <@${submittedById}>\n` +
          `• **Type:** ${proofType.toUpperCase()}\n` +
          `• **Evidence URL:** ${evidenceUrl.trim()}\n` +
          (description ? `• **Description:** ${description.trim()}\n` : '') +
          `• **Status:** Pending Staff Review.`
      )
      .setFooter({ text: 'G4X Community — Dispute & Proof System' })
      .setTimestamp();

    await notifyOrderExecutionChannel(run.orderId, discordClient, embed);
  }

  return proof;
}

/**
 * 7. Review run proof (Approve or Reject).
 */
export async function reviewRunProof(input: ReviewProofInput) {
  const { proofId, reviewerId, decision, reviewNotes, discordClient } = input;

  const proof = await prisma.runProof.findUnique({
    where: { id: proofId },
    include: {
      run: {
        include: { order: true },
      },
    },
  });

  if (!proof) {
    throw new DomainError(DomainErrorCode.PROOF_NOT_FOUND, `RunProof #${proofId} not found`);
  }

  // Self-approval prohibition: Submitter cannot approve their own proof
  if (proof.submittedById === reviewerId) {
    throw new DomainError(
      DomainErrorCode.SELF_APPROVAL_PROHIBITED,
      'Submitters cannot review or approve their own completion proof.'
    );
  }

  // Permission check: Reviewer must be Staff, Admin, or Owner
  const userRoles = await prisma.userRole.findMany({
    where: { userId: reviewerId },
  });
  const roleKeys = userRoles.map((r) => r.roleKey.toLowerCase());
  const isStaffOrAdmin = roleKeys.some((k) =>
    ['staff', 'admin', 'manager', 'owner'].includes(k)
  );

  if (!isStaffOrAdmin) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      'Proof review requires Staff, Admin, or Owner role.'
    );
  }

  const now = new Date();
  const nextStatus = decision === 'approve' ? 'approved' : 'rejected';

  const updatedProof = await prisma.$transaction(async (tx) => {
    const res = await tx.runProof.update({
      where: { id: proofId },
      data: {
        status: nextStatus,
        reviewedById: reviewerId,
        reviewedAt: now,
        reviewNotes: reviewNotes?.trim() || null,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: reviewerId,
        action: `RUN_PROOF_${nextStatus.toUpperCase()}`,
        entityType: 'RunProof',
        entityId: String(proofId),
        newValues: JSON.stringify({
          proofId,
          runId: proof.runId,
          orderId: proof.run.orderId,
          decision,
          reviewNotes,
        }),
      },
    });

    return res;
  });

  // Track staff review in release service if G4X order and approved
  if (decision === 'approve' && proof.run.order.creatorType === 'g4x') {
    try {
      await recordStaffReview(proof.run.orderId, reviewerId, reviewNotes);
    } catch (e) {
      console.warn('[OrderDisputeService] Could not record staff review in tracker:', e);
    }
  }

  if (discordClient) {
    const embed = new EmbedBuilder()
      .setColor(decision === 'approve' ? 0x2ecc71 : 0xe74c3c)
      .setTitle(`🔍 Proof Review: Order #${proof.run.orderId}`)
      .setDescription(
        `Run #${proof.run.runNumber} proof has been ${nextStatus.toUpperCase()}.\n\n` +
          `• **Reviewed By:** <@${reviewerId}>\n` +
          `• **Decision:** ${decision.toUpperCase()}\n` +
          (reviewNotes ? `• **Notes:** ${reviewNotes.trim()}\n` : '')
      )
      .setFooter({ text: 'G4X Community — Dispute & Proof System' })
      .setTimestamp();

    await notifyOrderExecutionChannel(proof.run.orderId, discordClient, embed);
  }

  return updatedProof;
}

/**
 * Queries disputes visible to a user. Staff sees all; regular users see disputes on orders they participate in.
 */
export async function getDisputesForUser(
  userId: string,
  isStaff: boolean,
  options?: { status?: string }
) {
  const whereClause: Prisma.OrderDisputeWhereInput = {};

  if (options?.status) {
    whereClause.status = options.status;
  }

  if (!isStaff) {
    whereClause.OR = [
      { openedById: userId },
      { order: { customerId: userId } },
      { order: { advertiserId: userId } },
      { order: { creatorId: userId } },
      { order: { assignments: { some: { userId, status: 'assigned' } } } },
    ];
  }

  const disputes = await prisma.orderDispute.findMany({
    where: whereClause,
    include: {
      order: {
        include: {
          game: true,
          service: true,
        },
      },
      openedBy: { select: { discordId: true, username: true } },
      assignedReviewer: { select: { discordId: true, username: true } },
      resolver: { select: { discordId: true, username: true } },
      escrowHolds: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return disputes.map((d) => ({
    ...d,
    simplifiedStatus: formatDisputeStatusLabel(d.status),
  }));
}
