/**
 * src/services/exchangeSettlementService.ts
 *
 * G4X In-Game Currency & Items Exchange — Phase 7:
 * Delivery Proofs, Buyer Confirmation, Idempotent Final Approval & Settlement.
 *
 * Strict Non-Negotiable Invariants:
 *  1. Strict No-Float Rule: ALL currency values, commissions, payouts, and refunds
 *     are stored and computed in exact integer USD cents (Int).
 *  2. Idempotent Settlement Lock: ExchangeSettlement has a @unique constraint on tradeId.
 *     Inside an atomic prisma.$transaction, if an ExchangeSettlement already exists or
 *     escrow is not in RESERVED/FROZEN_DISPUTE status with releasedAt===null, the operation
 *     fails closed with 409 Conflict. A Seller can NEVER be paid twice or Buyer refunded twice.
 *  3. Central G4X Wallet & Ledger Synchronization: Every Seller payout credit, Buyer escrow debit,
 *     and refund executes atomically against Wallet / WalletV2 and writes immutable LedgerTransaction rows.
 *  4. Buyer Confirmation != Fund Release: Confirming delivery sets status to AWAITING_FINAL_APPROVAL.
 *     It NEVER mutates wallet balances or releases escrow directly.
 *  5. Archive Only: Completed Discord rooms are archived, NEVER deleted.
 */

import prisma from '../database/db';
import {
  ExchangeTrade,
  ExchangeProof,
  ExchangeSettlement,
  ExchangeEscrow,
  ExchangeTradeEvent,
  ExchangeNotification,
} from '@prisma/client';
import { TradeValidationError } from './exchangeTradeService';
import { logExchangeAudit } from './exchangeConfigService';
import { archiveExchangeDiscordRoom, getPublicWebUrl } from './exchangeDiscordService';
import { getGlobalDiscordClient } from './orderDiscordService';
import { getSystemSetting } from './systemSettingService';
import { EmbedBuilder } from 'discord.js';

/**
 * Generates sequential human-readable settlement code: EXS-1001, EXS-1002, etc.
 */
export async function generateNextSettlementCode(tx: any = prisma): Promise<string> {
  const count = await tx.exchangeSettlement.count();
  const candidate = `EXS-${1000 + count + 1}`;
  const exists = await tx.exchangeSettlement.findUnique({
    where: { settlementCode: candidate },
  });
  if (!exists) return candidate;

  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `EXS-${1000 + count + 1}-${randomSuffix}`;
}

/**
 * Sends an alert message to the configured exchange alert channel in Discord (if any).
 */
async function sendExchangeAlert(embed: EmbedBuilder): Promise<void> {
  const alertChannelId = await getSystemSetting(
    'exchange_alert_channel_id',
    process.env.DISCORD_EXCHANGE_ALERT_CHANNEL_ID || ''
  );

  if (!alertChannelId) return;

  const client = getGlobalDiscordClient();
  if (!client) return;

  try {
    const channel =
      client.channels?.cache?.get(alertChannelId) ||
      (await client.channels?.fetch?.(alertChannelId).catch(() => null));

    if (channel && typeof channel.send === 'function') {
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err: any) {
    console.warn('[ExchangeSettlement] Failed to send alert to alertChannel:', err.message);
  }
}

/**
 * Sends a message into the trade's Discord room (if room exists).
 */
async function sendTradeRoomMessage(tradeId: string, embed: EmbedBuilder): Promise<void> {
  const room = await prisma.exchangeDiscordRoom.findUnique({
    where: { tradeId },
  });
  if (!room || room.status === 'ARCHIVED') return;

  const client = getGlobalDiscordClient();
  if (!client) return;

  try {
    const channel =
      client.channels?.cache?.get(room.channelId) ||
      (await client.channels?.fetch?.(room.channelId).catch(() => null));

    if (channel && typeof channel.send === 'function') {
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err: any) {
    console.warn('[ExchangeSettlement] Failed to send message to trade room:', err.message);
  }
}

export interface SubmitExchangeProofParams {
  tradeId: string;
  submittedByUserId: string;
  submittedByDiscordId: string;
  submitterRole: 'SELLER' | 'BUYER' | 'ADMIN' | 'OWNER';
  proofType?: 'DELIVERY_PROOF' | 'ADDITIONAL_PROOF' | 'DISPUTE_EVIDENCE';
  fileUrl?: string;
  evidenceLinks?: string[];
  inGameDetails?: string;
  note?: string;
}

/**
 * Submits evidence / delivery proof for an exchange trade.
 * Transitions trade from DELIVERY_IN_PROGRESS / ADDITIONAL_PROOF_REQUESTED to PROOF_SUBMITTED.
 */
export async function submitExchangeProof(params: SubmitExchangeProofParams): Promise<ExchangeProof> {
  const {
    tradeId,
    submittedByUserId,
    submittedByDiscordId,
    submitterRole,
    proofType = 'DELIVERY_PROOF',
    fileUrl,
    evidenceLinks = [],
    inGameDetails,
    note,
  } = params;

  const trade = await prisma.exchangeTrade.findUnique({
    where: { id: tradeId },
    include: {
      escrow: true,
      game: true,
      currency: true,
      buyer: true,
      seller: true,
    },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  if (['COMPLETED', 'CANCELLED'].includes(trade.status)) {
    throw new TradeValidationError(`Cannot submit proof for trade in status '${trade.status}'`, 400);
  }

  const proof = await prisma.$transaction(async (tx) => {
    const createdProof = await tx.exchangeProof.create({
      data: {
        tradeId,
        submittedByUserId,
        submittedByDiscordId,
        submitterRole,
        proofType,
        fileUrl: fileUrl || null,
        evidenceLinksJson: JSON.stringify(evidenceLinks),
        inGameDetails: inGameDetails || null,
        note: note || null,
        reviewStatus: 'PENDING',
      },
    });

    // If trade was in DELIVERY_IN_PROGRESS or ADDITIONAL_PROOF_REQUESTED, transition to PROOF_SUBMITTED
    const shouldUpdateStatus = ['DELIVERY_IN_PROGRESS', 'ADDITIONAL_PROOF_REQUESTED'].includes(trade.status);
    const toStatus = shouldUpdateStatus ? 'PROOF_SUBMITTED' : trade.status;

    if (shouldUpdateStatus) {
      await tx.exchangeTrade.update({
        where: { id: tradeId },
        data: { status: 'PROOF_SUBMITTED' },
      });
    }

    await tx.exchangeTradeEvent.create({
      data: {
        tradeId,
        eventType: 'PROOF_SUBMITTED',
        actorUserId: submittedByUserId,
        actorDiscordId: submittedByDiscordId,
        actorRole: submitterRole,
        fromStatus: trade.status,
        toStatus,
        note: note ? `Proof submitted: ${note}` : 'Delivery proof submitted.',
        metadataJson: JSON.stringify({
          proofId: createdProof.id,
          proofType,
          fileUrl: fileUrl || null,
          inGameDetails: inGameDetails || null,
        }),
      },
    });

    // Create In-App Notification for counterparty
    const recipientDiscordId = submitterRole === 'SELLER' ? trade.buyerDiscordId : trade.sellerDiscordId;
    const recipientRole = submitterRole === 'SELLER' ? 'BUYER' : 'SELLER';

    await tx.exchangeNotification.create({
      data: {
        recipientDiscordId,
        recipientRole,
        tradeId,
        type: 'PROOF_SUBMITTED',
        title: '📸 Delivery Proof Submitted',
        message: `${submitterRole === 'SELLER' ? 'Seller' : 'Participant'} has submitted proof for Trade ${trade.tradeCode}. Please review and confirm receipt.`,
      },
    });

    return createdProof;
  });

  await logExchangeAudit({
    actorId: submittedByDiscordId,
    action: 'PROOF_SUBMITTED',
    entityType: 'ExchangeTrade',
    entityId: tradeId,
    previousValues: { status: trade.status },
    newValues: { proofId: proof.id, proofType },
    reason: note || 'Proof uploaded',
  });

  // Post update to Discord room if present
  const publicUrl = getPublicWebUrl();
  const roomEmbed = new EmbedBuilder()
    .setColor(0x2196f3)
    .setTitle(`📸 Proof Uploaded — ${trade.tradeCode}`)
    .setDescription(
      `<@${submittedByDiscordId}> (${submitterRole}) uploaded evidence for Trade **${trade.tradeCode}**.\n` +
      (inGameDetails ? `• **In-Game Details:** \`${inGameDetails}\`\n` : '') +
      (note ? `• **Note:** ${note}\n` : '') +
      (fileUrl ? `• **Attachment:** [View Proof Document/Screenshot](${fileUrl})\n` : '') +
      `\n🔗 **[Review on Web Portal](${publicUrl}/exchange/trades/${trade.id})**`
    )
    .setTimestamp();

  sendTradeRoomMessage(tradeId, roomEmbed).catch(() => {});

  return proof;
}

export interface ConfirmDeliveryParams {
  tradeId: string;
  buyerUserId: string;
  buyerDiscordId: string;
  note?: string;
}

/**
 * Buyer confirms in-game delivery receipt.
 * STRICT SAFETY RULE: This transitions trade to AWAITING_FINAL_APPROVAL.
 * It NEVER mutates wallet balances or releases escrow funds directly!
 */
export async function confirmExchangeDeliveryByBuyer(params: ConfirmDeliveryParams): Promise<ExchangeTrade> {
  const { tradeId, buyerUserId, buyerDiscordId, note } = params;

  const trade = await prisma.exchangeTrade.findUnique({
    where: { id: tradeId },
    include: {
      escrow: true,
      game: true,
      currency: true,
    },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  // Verify buyer identity
  if (trade.buyerUserId !== buyerUserId && trade.buyerDiscordId !== buyerDiscordId) {
    throw new TradeValidationError('Unauthorized: Only the Buyer can confirm receipt of this trade.', 403);
  }

  if (['COMPLETED', 'CANCELLED', 'DISPUTED'].includes(trade.status)) {
    throw new TradeValidationError(`Cannot confirm delivery for trade in status '${trade.status}'`, 400);
  }

  if (!trade.escrow || trade.escrow.status !== 'RESERVED') {
    throw new TradeValidationError('Cannot confirm trade: Escrow is not in active RESERVED status.', 400);
  }

  const now = new Date();
  const updatedTrade = await prisma.$transaction(async (tx) => {
    const updated = await tx.exchangeTrade.update({
      where: { id: tradeId },
      data: {
        status: 'AWAITING_FINAL_APPROVAL',
        buyerConfirmedAt: now,
      },
    });

    await tx.exchangeTradeEvent.create({
      data: {
        tradeId,
        eventType: 'BUYER_CONFIRMED',
        actorUserId: buyerUserId,
        actorDiscordId: buyerDiscordId,
        actorRole: 'BUYER',
        fromStatus: trade.status,
        toStatus: 'AWAITING_FINAL_APPROVAL',
        note: note ? `Buyer confirmed delivery: ${note}` : 'Buyer confirmed in-game receipt of goods.',
      },
    });

    await tx.exchangeTradeEvent.create({
      data: {
        tradeId,
        eventType: 'AWAITING_FINAL_APPROVAL',
        actorDiscordId: buyerDiscordId,
        actorRole: 'SYSTEM',
        fromStatus: trade.status,
        toStatus: 'AWAITING_FINAL_APPROVAL',
        note: 'Trade queued for Admin/Owner final approval and payout settlement.',
      },
    });

    // Notify Admin Team
    await tx.exchangeNotification.create({
      data: {
        recipientRole: 'ADMIN_TEAM',
        tradeId,
        type: 'AWAITING_FINAL_APPROVAL',
        title: `✅ Trade Ready for Final Approval (${trade.tradeCode})`,
        message: `Buyer has confirmed delivery for Trade ${trade.tradeCode}. Net payout: $${(trade.netSellerCents / 100).toFixed(2)}. Requires admin sign-off.`,
      },
    });

    return updated;
  });

  await logExchangeAudit({
    actorId: buyerDiscordId,
    action: 'BUYER_CONFIRMED_DELIVERY',
    entityType: 'ExchangeTrade',
    entityId: tradeId,
    previousValues: { status: trade.status },
    newValues: { status: 'AWAITING_FINAL_APPROVAL', buyerConfirmedAt: now },
    reason: note || 'Buyer confirmed on web platform',
  });

  const publicUrl = getPublicWebUrl();

  // Alert Discord room
  const roomEmbed = new EmbedBuilder()
    .setColor(0x4caf50)
    .setTitle(`✅ Delivery Confirmed by Buyer — ${trade.tradeCode}`)
    .setDescription(
      `Buyer <@${trade.buyerDiscordId}> confirmed receipt of goods.\n` +
      `The trade has entered the **Admin Final Review Queue** for payout approval.\n` +
      `Funds remain safely secured in Escrow until administrative sign-off.\n\n` +
      `🔗 **[View Trade Details](${publicUrl}/exchange/trades/${trade.id})**`
    )
    .setTimestamp();

  sendTradeRoomMessage(tradeId, roomEmbed).catch(() => {});

  // Alert Admin Channel
  const alertEmbed = new EmbedBuilder()
    .setColor(0x4caf50)
    .setTitle(`🔔 Trade Ready for Final Approval — ${trade.tradeCode}`)
    .setDescription(
      `Buyer <@${trade.buyerDiscordId}> confirmed delivery for Trade **${trade.tradeCode}**.\n` +
      `• **Seller:** <@${trade.sellerDiscordId}>\n` +
      `• **Payout Amount:** **$${(trade.netSellerCents / 100).toFixed(2)}**\n\n` +
      `🔗 **[Review & Settle on Web Admin Portal](${publicUrl}/exchange/trades/${trade.id})**`
    )
    .setTimestamp();

  sendExchangeAlert(alertEmbed).catch(() => {});

  return updatedTrade;
}

export interface RequestAdditionalProofParams {
  tradeId: string;
  actorDiscordId: string;
  actorRole: 'ADMIN' | 'OWNER' | 'BUYER';
  reason: string;
}

/**
 * Requests additional proof from the seller.
 */
export async function requestAdditionalProof(params: RequestAdditionalProofParams): Promise<ExchangeTrade> {
  const { tradeId, actorDiscordId, actorRole, reason } = params;

  const trade = await prisma.exchangeTrade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  if (['COMPLETED', 'CANCELLED'].includes(trade.status)) {
    throw new TradeValidationError(`Cannot request proof for trade in status '${trade.status}'`, 400);
  }

  const updatedTrade = await prisma.$transaction(async (tx) => {
    const updated = await tx.exchangeTrade.update({
      where: { id: tradeId },
      data: { status: 'ADDITIONAL_PROOF_REQUESTED' },
    });

    await tx.exchangeTradeEvent.create({
      data: {
        tradeId,
        eventType: 'ADDITIONAL_PROOF_REQUESTED',
        actorDiscordId,
        actorRole,
        fromStatus: trade.status,
        toStatus: 'ADDITIONAL_PROOF_REQUESTED',
        note: reason,
      },
    });

    // Notify seller
    await tx.exchangeNotification.create({
      data: {
        recipientDiscordId: trade.sellerDiscordId,
        recipientRole: 'SELLER',
        tradeId,
        type: 'ADDITIONAL_PROOF_REQUESTED',
        title: '⚠️ Additional Delivery Proof Requested',
        message: `Additional evidence has been requested for Trade ${trade.tradeCode}. Reason: ${reason}`,
      },
    });

    return updated;
  });

  await logExchangeAudit({
    actorId: actorDiscordId,
    action: 'ADDITIONAL_PROOF_REQUESTED',
    entityType: 'ExchangeTrade',
    entityId: tradeId,
    previousValues: { status: trade.status },
    newValues: { status: 'ADDITIONAL_PROOF_REQUESTED' },
    reason,
  });

  const publicUrl = getPublicWebUrl();
  const roomEmbed = new EmbedBuilder()
    .setColor(0xff9800)
    .setTitle(`⚠️ Additional Proof Requested — ${trade.tradeCode}`)
    .setDescription(
      `<@${actorDiscordId}> (${actorRole}) requested additional proof from Seller <@${trade.sellerDiscordId}>.\n` +
      `• **Reason:** ${reason}\n\n` +
      `🔗 **[Upload Proof on Web Portal](${publicUrl}/exchange/trades/${trade.id})**`
    )
    .setTimestamp();

  sendTradeRoomMessage(tradeId, roomEmbed).catch(() => {});

  return updatedTrade;
}

export interface AddTradeInternalNoteParams {
  tradeId: string;
  adminDiscordId: string;
  note: string;
}

/**
 * Appends an internal admin note to a trade (never exposed to buyer/seller).
 */
export async function addTradeInternalNote(params: AddTradeInternalNoteParams): Promise<ExchangeTrade> {
  const { tradeId, adminDiscordId, note } = params;

  const trade = await prisma.exchangeTrade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] <@${adminDiscordId}>: ${note.trim()}`;
  const newNotes = trade.internalAdminNotes ? `${trade.internalAdminNotes}\n${entry}` : entry;

  const updated = await prisma.exchangeTrade.update({
    where: { id: tradeId },
    data: { internalAdminNotes: newNotes },
  });

  await prisma.exchangeTradeEvent.create({
    data: {
      tradeId,
      eventType: 'INTERNAL_NOTE_ADDED',
      actorDiscordId: adminDiscordId,
      actorRole: 'ADMIN',
      note: `Internal Note added: "${note.length > 50 ? note.slice(0, 50) + '...' : note}"`,
    },
  });

  await logExchangeAudit({
    actorId: adminDiscordId,
    action: 'INTERNAL_NOTE_ADDED',
    entityType: 'ExchangeTrade',
    entityId: tradeId,
    newValues: { note },
    reason: 'Staff added internal note',
  });

  return updated;
}

export interface RejectTradeFinalApprovalParams {
  tradeId: string;
  adminDiscordId: string;
  reason: string;
}

/**
 * Staff/Admin rejects final approval and returns trade to ADDITIONAL_PROOF_REQUESTED.
 */
export async function rejectTradeFinalApproval(params: RejectTradeFinalApprovalParams): Promise<ExchangeTrade> {
  const { tradeId, adminDiscordId, reason } = params;

  const trade = await prisma.exchangeTrade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  if (trade.status !== 'AWAITING_FINAL_APPROVAL') {
    throw new TradeValidationError(`Trade is not in AWAITING_FINAL_APPROVAL status (currently '${trade.status}')`, 400);
  }

  const updatedTrade = await prisma.$transaction(async (tx) => {
    const updated = await tx.exchangeTrade.update({
      where: { id: tradeId },
      data: { status: 'ADDITIONAL_PROOF_REQUESTED' },
    });

    await tx.exchangeTradeEvent.create({
      data: {
        tradeId,
        eventType: 'FINAL_APPROVAL_REJECTED',
        actorDiscordId: adminDiscordId,
        actorRole: 'ADMIN',
        fromStatus: 'AWAITING_FINAL_APPROVAL',
        toStatus: 'ADDITIONAL_PROOF_REQUESTED',
        note: `Final Approval Rejected by Staff: ${reason}`,
      },
    });

    await tx.exchangeNotification.create({
      data: {
        recipientDiscordId: trade.sellerDiscordId,
        recipientRole: 'SELLER',
        tradeId,
        type: 'ADDITIONAL_PROOF_REQUESTED',
        title: '❌ Final Approval Rejected — Additional Proof Needed',
        message: `Admin rejected final approval for Trade ${trade.tradeCode}. Reason: ${reason}. Please upload valid delivery proof.`,
      },
    });

    return updated;
  });

  await logExchangeAudit({
    actorId: adminDiscordId,
    action: 'FINAL_APPROVAL_REJECTED',
    entityType: 'ExchangeTrade',
    entityId: tradeId,
    previousValues: { status: 'AWAITING_FINAL_APPROVAL' },
    newValues: { status: 'ADDITIONAL_PROOF_REQUESTED' },
    reason,
  });

  const publicUrl = getPublicWebUrl();
  const roomEmbed = new EmbedBuilder()
    .setColor(0xd32f2f)
    .setTitle(`❌ Final Approval Rejected — ${trade.tradeCode}`)
    .setDescription(
      `Staff rejected final payout approval for Trade **${trade.tradeCode}**.\n` +
      `• **Reason:** ${reason}\n` +
      `• **Status:** Set back to \`ADDITIONAL_PROOF_REQUESTED\`\n\n` +
      `🔗 **[Review Details on Web Portal](${publicUrl}/exchange/trades/${trade.id})**`
    )
    .setTimestamp();

  sendTradeRoomMessage(tradeId, roomEmbed).catch(() => {});

  return updatedTrade;
}

export interface ApproveAndSettleParams {
  tradeId: string;
  adminUserId: string;
  adminDiscordId: string;
  note?: string;
  settlementType?: 'STANDARD_RELEASE' | 'DISPUTE_RELEASE';
}

export interface SettleResult {
  settlement: ExchangeSettlement;
  trade: ExchangeTrade;
}

/**
 * Idempotent Final Approval & Escrow Settlement Engine.
 * STRICT SAFETY & IDEMPOTENCY LOCK:
 *  - Checks if an ExchangeSettlement already exists for this trade -> throws 409 Conflict.
 *  - Verifies escrow exists in RESERVED (or FROZEN_DISPUTE) status and has not been released/refunded.
 *  - All calculations in exact integer cents (Int):
 *      grossValueCents = trade.grossValueCents
 *      buyerCommissionCents = trade.buyerFeeCents
 *      sellerCommissionCents = trade.sellerFeeCents
 *      g4xTotalRevenueCents = buyerCommissionCents + sellerCommissionCents
 *      sellerNetPayoutCents = trade.netSellerCents
 *  - Decrements Buyer's reservedBalance in central Wallet.
 *  - Credits Seller's availableBalance / balanceUsd in central Wallet.
 *  - Writes immutable LedgerTransaction records.
 *  - Updates ExchangeBuyOrder reserved vs filled capacity.
 *  - Safe async post-transaction hook archives the Discord room (NEVER deletes).
 */
export async function approveAndSettleExchangeTrade(params: ApproveAndSettleParams): Promise<SettleResult> {
  const { tradeId, adminUserId, adminDiscordId, note, settlementType = 'STANDARD_RELEASE' } = params;

  // 1. Perform atomic transaction
  const result = await prisma.$transaction(async (tx) => {
    // IDEMPOTENCY CHECK 1: Ensure not already settled
    const existingSettlement = await tx.exchangeSettlement.findUnique({
      where: { tradeId },
    });
    if (existingSettlement) {
      throw new TradeValidationError(
        `CONFLICT_ALREADY_SETTLED: Trade ${tradeId} has already been settled via code ${existingSettlement.settlementCode} on ${existingSettlement.settledAt.toISOString()}.`,
        409
      );
    }

    // 2. Fetch trade with all required relations
    const trade = await tx.exchangeTrade.findUnique({
      where: { id: tradeId },
      include: {
        escrow: true,
        buyOrder: true,
        seller: true,
        buyer: true,
      },
    });

    if (!trade) {
      throw new TradeValidationError('Trade not found', 404);
    }

    if (trade.status === 'COMPLETED') {
      throw new TradeValidationError('CONFLICT_ALREADY_COMPLETED: Trade is already COMPLETED.', 409);
    }

    if (trade.status === 'CANCELLED') {
      throw new TradeValidationError('Trade is CANCELLED. Cannot approve a cancelled trade.', 400);
    }

    const escrow = trade.escrow;
    if (!escrow) {
      throw new TradeValidationError('NO_ESCROW: No escrow record associated with this trade.', 400);
    }

    if (escrow.releasedAt !== null) {
      throw new TradeValidationError(
        `CONFLICT_ALREADY_RELEASED: Escrow ${escrow.id} has already been released at ${escrow.releasedAt.toISOString()}.`,
        409
      );
    }

    if (escrow.refundedAt !== null) {
      throw new TradeValidationError(
        `CONFLICT_ALREADY_REFUNDED: Escrow ${escrow.id} has already been refunded at ${escrow.refundedAt.toISOString()}.`,
        409
      );
    }

    if (!['RESERVED', 'FROZEN_DISPUTE'].includes(escrow.status)) {
      throw new TradeValidationError(
        `INVALID_ESCROW_STATUS: Escrow must be in RESERVED or FROZEN_DISPUTE status (currently '${escrow.status}').`,
        400
      );
    }

    // 3. Exact Integer Cent Math (STRICT NO-FLOAT RULE)
    const grossValueCents = trade.grossValueCents;
    const buyerCommissionCents = trade.buyerFeeCents;
    const sellerCommissionCents = trade.sellerFeeCents;
    const g4xTotalRevenueCents = buyerCommissionCents + sellerCommissionCents;
    const sellerNetPayoutCents = trade.netSellerCents;

    // Safety Invariant Verification
    if (sellerNetPayoutCents + sellerCommissionCents !== grossValueCents) {
      throw new TradeValidationError(
        `INVARIANT_VIOLATION: Net seller ($${sellerNetPayoutCents / 100}) + seller fee ($${sellerCommissionCents / 100}) does not equal gross ($${grossValueCents / 100}).`,
        500
      );
    }

    const now = new Date();
    const txRefBuyer = `TX_EXS_BUYER_DEBIT_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const txRefSeller = `TX_EXS_SELLER_CREDIT_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    // 4. Central Wallet & Ledger Updates

    // 4a. Buyer Escrow Release: decrement buyer's reserved balance if fundingSource was WALLET
    if (escrow.fundingSource === 'WALLET') {
      const buyerWallet = await tx.wallet.findUnique({ where: { userId: trade.buyerUserId } });
      if (buyerWallet) {
        await tx.wallet.update({
          where: { userId: trade.buyerUserId },
          data: {
            reservedBalance: { decrement: escrow.reservedAmountCents },
          },
        });
      }

      const buyerWalletV2 = await tx.walletV2.findUnique({ where: { userId: trade.buyerUserId } });
      if (buyerWalletV2) {
        await tx.walletV2.update({
          where: { userId: trade.buyerUserId },
          data: {
            reservedCents: { decrement: escrow.reservedAmountCents },
          },
        });
      }
    }

    // Record immutable ledger entry for Buyer's escrow deduction
    await tx.ledgerTransaction.create({
      data: {
        transactionRef: txRefBuyer,
        userId: trade.buyerUserId,
        currency: 'USD',
        amountMinor: escrow.reservedAmountCents,
        entryType: 'escrow_release',
        status: 'posted',
        createdBy: adminDiscordId,
      },
    });

    // 4b. Seller Payout Credit: Credit seller's central wallet available balance
    await tx.wallet.upsert({
      where: { userId: trade.sellerUserId },
      update: {
        balanceUsd: { increment: sellerNetPayoutCents },
      },
      create: {
        userId: trade.sellerUserId,
        balanceUsd: sellerNetPayoutCents,
      },
    });

    const sellerWalletV2 = await tx.walletV2.findUnique({ where: { userId: trade.sellerUserId } });
    if (sellerWalletV2) {
      await tx.walletV2.update({
        where: { userId: trade.sellerUserId },
        data: {
          availableCents: { increment: sellerNetPayoutCents },
        },
      });
    }

    // Record immutable ledger entry for Seller's payout credit
    await tx.ledgerTransaction.create({
      data: {
        transactionRef: txRefSeller,
        userId: trade.sellerUserId,
        currency: 'USD',
        amountMinor: sellerNetPayoutCents,
        entryType: 'trade_settlement',
        status: 'posted',
        createdBy: adminDiscordId,
      },
    });

    // 5. Update Escrow Record
    await tx.exchangeEscrow.update({
      where: { id: escrow.id },
      data: {
        status: 'RELEASED',
        releasedAt: now,
        resolutionLedgerId: txRefSeller,
      },
    });

    // 6. Update BuyOrder Capacity (reserved -> filled)
    const buyOrder = trade.buyOrder;
    if (buyOrder) {
      const orderReservedBig = BigInt(buyOrder.reservedCapacityBaseUnits || '0');
      const tradeQtyBig = BigInt(trade.quantityBaseUnits || '0');
      const orderFilledBig = BigInt(buyOrder.filledCapacityBaseUnits || '0');

      const nextReserved = orderReservedBig > tradeQtyBig ? (orderReservedBig - tradeQtyBig).toString() : '0';
      const nextFilled = (orderFilledBig + tradeQtyBig).toString();

      const isCompleted = BigInt(buyOrder.remainingCapacityBaseUnits || '0') <= 0n;

      await tx.exchangeBuyOrder.update({
        where: { id: buyOrder.id },
        data: {
          reservedCapacityBaseUnits: nextReserved,
          filledCapacityBaseUnits: nextFilled,
          status: isCompleted ? 'COMPLETED' : undefined,
        },
      });
    }

    // 7. Create ExchangeSettlement Record
    const settlementCode = await generateNextSettlementCode(tx);
    const settlement = await tx.exchangeSettlement.create({
      data: {
        settlementCode,
        tradeId: trade.id,
        escrowId: escrow.id,
        buyerUserId: trade.buyerUserId,
        sellerUserId: trade.sellerUserId,
        settlementType,
        grossValueCents,
        buyerCommissionCents,
        sellerCommissionCents,
        g4xTotalRevenueCents,
        sellerNetPayoutCents,
        buyerRefundCents: 0,
        buyerEscrowDebitLedgerId: txRefBuyer,
        sellerCreditLedgerId: txRefSeller,
        approvedByDiscordId: adminDiscordId,
        approvalNote: note || 'Final approval and payout granted by admin.',
        settledAt: now,
      },
    });

    // 8. Update Trade Status
    const completedTrade = await tx.exchangeTrade.update({
      where: { id: trade.id },
      data: {
        status: 'COMPLETED',
        finalApprovedAt: now,
        completedAt: now,
      },
    });

    // 9. Create Trade Event
    await tx.exchangeTradeEvent.create({
      data: {
        tradeId: trade.id,
        eventType: 'SETTLED',
        actorUserId: adminUserId,
        actorDiscordId: adminDiscordId,
        actorRole: 'ADMIN',
        fromStatus: trade.status,
        toStatus: 'COMPLETED',
        note: `Trade settled via ${settlementCode}. Seller credited $${(sellerNetPayoutCents / 100).toFixed(2)}. G4X Revenue: $${(g4xTotalRevenueCents / 100).toFixed(2)}.`,
        metadataJson: JSON.stringify({
          settlementId: settlement.id,
          settlementCode,
          sellerNetPayoutCents,
          g4xTotalRevenueCents,
        }),
      },
    });

    // 10. In-App Notifications for participants
    await tx.exchangeNotification.create({
      data: {
        recipientDiscordId: trade.sellerDiscordId,
        recipientRole: 'SELLER',
        tradeId: trade.id,
        type: 'TRADE_COMPLETED',
        title: '🎉 Payment Released to Your Balance!',
        message: `Trade ${trade.tradeCode} has been finalized and approved! $${(sellerNetPayoutCents / 100).toFixed(2)} USD has been credited to your central wallet balance.`,
      },
    });

    await tx.exchangeNotification.create({
      data: {
        recipientDiscordId: trade.buyerDiscordId,
        recipientRole: 'BUYER',
        tradeId: trade.id,
        type: 'TRADE_COMPLETED',
        title: '🤝 Trade Successfully Completed',
        message: `Trade ${trade.tradeCode} has been officially settled and closed. Thank you for trading on G4X Exchange!`,
      },
    });

    return { settlement, trade: completedTrade };
  });

  // 11. Audit Logging
  await logExchangeAudit({
    actorId: adminDiscordId,
    action: 'TRADE_FINAL_APPROVED_AND_SETTLED',
    entityType: 'ExchangeTrade',
    entityId: tradeId,
    newValues: {
      settlementCode: result.settlement.settlementCode,
      sellerNetPayoutCents: result.settlement.sellerNetPayoutCents,
      status: 'COMPLETED',
    },
    reason: note || 'Final approval granted by admin',
  });

  const publicUrl = getPublicWebUrl();

  // 12. Alert Discord Room & Safe Post-Transaction Discord Channel Archival
  const completeEmbed = new EmbedBuilder()
    .setColor(0x4caf50)
    .setTitle(`🎉 Trade Completed & Settled — ${result.trade.tradeCode}`)
    .setDescription(
      `Final approval granted by Staff <@${adminDiscordId}>.\n` +
      `• **Seller Net Payout:** **$${(result.settlement.sellerNetPayoutCents / 100).toFixed(2)}** credited to central wallet.\n` +
      `• **Settlement Code:** \`${result.settlement.settlementCode}\`\n\n` +
      `🔒 *This trade channel will now be archived. Thank you for using G4X Escrow!*`
    )
    .setTimestamp();

  sendTradeRoomMessage(tradeId, completeEmbed).catch(() => {});

  // Archive channel asynchronously (Archive ONLY, never delete)
  archiveExchangeDiscordRoom(tradeId, adminDiscordId, 'Trade completed and settled')
    .catch((err) => console.warn(`[ExchangeSettlement] Failed to auto-archive channel for trade ${tradeId}:`, err.message));

  return result;
}

/**
 * Gets all delivery proofs for a trade.
 */
export async function getExchangeProofsForTrade(tradeId: string): Promise<ExchangeProof[]> {
  return prisma.exchangeProof.findMany({
    where: { tradeId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Gets settlement record by tradeId.
 */
export async function getSettlementByTradeId(tradeId: string): Promise<ExchangeSettlement | null> {
  return prisma.exchangeSettlement.findUnique({
    where: { tradeId },
  });
}
