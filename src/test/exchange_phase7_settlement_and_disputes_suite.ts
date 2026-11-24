/**
 * src/test/exchange_phase7_settlement_and_disputes_suite.ts
 *
 * Comprehensive Test Suite for G4X Exchange Phase 7:
 *  1. Delivery Proofs Submission (submitExchangeProof, getExchangeProofsForTrade)
 *  2. Additional Proof Request (requestAdditionalProof)
 *  3. Buyer Confirmation Invariant (confirmExchangeDeliveryByBuyer -> AWAITING_FINAL_APPROVAL, zero balance mutation)
 *  4. Final Approval Rejection (rejectTradeFinalApproval -> ADDITIONAL_PROOF_REQUESTED)
 *  5. Idempotent Settlement Engine (approveAndSettleExchangeTrade, exact integer cents, Wallet & Ledger sync, 409 idempotency lock)
 *  6. Internal Admin Notes (addTradeInternalNote)
 *  7. Dispute Flow: Open Dispute (openExchangeDispute, FROZEN_DISPUTE escrow lock, DISPUTED status)
 *  8. Dispute Resolution: FULL_REFUND_TO_BUYER (escrow refunded, wallet balance restored, buy order capacity restored, trade CANCELLED)
 *  9. Dispute Resolution: PARTIAL_REFUND (exact cent split, dual ledger entries, escrow PARTIALLY_REFUNDED)
 * 10. Dispute Resolution: RELEASE_TO_SELLER (delegates to idempotent settlement, trade COMPLETED)
 * 11. Read & Operations Queries (getExchangeApprovalQueue, getExchangeDisputeByTradeId, getSettlementByTradeId)
 */

import prisma from '../database/db';
import {
  submitExchangeProof,
  confirmExchangeDeliveryByBuyer,
  requestAdditionalProof,
  addTradeInternalNote,
  rejectTradeFinalApproval,
  approveAndSettleExchangeTrade,
  getExchangeProofsForTrade,
  getSettlementByTradeId,
} from '../services/exchangeSettlementService';
import {
  openExchangeDispute,
  resolveExchangeDispute,
  getExchangeDisputeById,
  getExchangeDisputeByTradeId,
  listExchangeDisputes,
} from '../services/exchangeDisputeService';
import {
  submitSellOffer,
  acceptSellOffer,
  TradeValidationError,
} from '../services/exchangeTradeService';
import { payTradeWithWallet } from '../services/exchangePaymentService';
import { ensureExchangeDefaults } from '../services/exchangeConfigService';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`);
    failed++;
  }
}

async function runSuite() {
  console.log('=== STARTING G4X EXCHANGE PHASE 7 SETTLEMENT & DISPUTES SUITE ===\n');

  const timestamp = Date.now();
  const BUYER_DISCORD_ID = `P7_BUYER_${timestamp}`;
  const SELLER_DISCORD_ID = `P7_SELLER_${timestamp}`;
  const ADMIN_DISCORD_ID = `P7_ADMIN_${timestamp}`;
  const OTHER_DISCORD_ID = `P7_OTHER_${timestamp}`;

  try {
    console.log('--- SETUP: Seeding Test Catalog, Roles, Users & Central Wallets ---');
    await ensureExchangeDefaults();

    // Roles
    await prisma.role.upsert({ where: { roleKey: 'exchanger' }, create: { roleKey: 'exchanger', name: 'Exchanger' }, update: {} });
    await prisma.role.upsert({ where: { roleKey: 'booster' }, create: { roleKey: 'booster', name: 'Booster' }, update: {} });
    await prisma.role.upsert({ where: { roleKey: 'admin' }, create: { roleKey: 'admin', name: 'Admin' }, update: {} });

    // Buyer
    await prisma.user.upsert({
      where: { discordId: BUYER_DISCORD_ID },
      create: { discordId: BUYER_DISCORD_ID, username: 'p7_buyer', displayName: 'P7 Buyer', isActive: true },
      update: { isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: BUYER_DISCORD_ID, roleKey: 'exchanger' } },
      create: { userId: BUYER_DISCORD_ID, roleKey: 'exchanger' },
      update: {},
    });
    await prisma.exchangeKycRequest.upsert({
      where: { userId: BUYER_DISCORD_ID },
      create: { userId: BUYER_DISCORD_ID, status: 'APPROVED', approvedAt: new Date() },
      update: { status: 'APPROVED' },
    });
    await prisma.exchangeUserPermission.upsert({
      where: { userId: BUYER_DISCORD_ID },
      create: { userId: BUYER_DISCORD_ID, canCreateBuyOrder: true, canSubmitSellOffer: true },
      update: { canCreateBuyOrder: true, canSubmitSellOffer: true, isSuspended: false },
    });

    // Seller
    await prisma.user.upsert({
      where: { discordId: SELLER_DISCORD_ID },
      create: { discordId: SELLER_DISCORD_ID, username: 'p7_seller', displayName: 'P7 Seller', isActive: true },
      update: { isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: SELLER_DISCORD_ID, roleKey: 'booster' } },
      create: { userId: SELLER_DISCORD_ID, roleKey: 'booster' },
      update: {},
    });

    // Admin
    await prisma.user.upsert({
      where: { discordId: ADMIN_DISCORD_ID },
      create: { discordId: ADMIN_DISCORD_ID, username: 'p7_admin', displayName: 'P7 Admin', isActive: true },
      update: { isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: ADMIN_DISCORD_ID, roleKey: 'admin' } },
      create: { userId: ADMIN_DISCORD_ID, roleKey: 'admin' },
      update: {},
    });

    // Other User
    await prisma.user.upsert({
      where: { discordId: OTHER_DISCORD_ID },
      create: { discordId: OTHER_DISCORD_ID, username: 'p7_other', displayName: 'P7 Other', isActive: true },
      update: { isActive: true },
    });

    // Catalog entities
    const game = await prisma.exchangeGame.findFirst({ where: { isActive: true } });
    const currency = await prisma.exchangeCurrency.findFirst({ where: { gameId: game!.id, isActive: true } });
    const deliveryMethod = await prisma.exchangeDeliveryMethod.findFirst({ where: { isActive: true } });

    if (!game || !currency || !deliveryMethod) {
      throw new Error('Catalog entities missing.');
    }

    // Helper to fund buyer wallet
    async function fundBuyerWallet(amountCents: number) {
      await prisma.wallet.upsert({
        where: { userId: BUYER_DISCORD_ID },
        create: { userId: BUYER_DISCORD_ID, balanceUsd: amountCents, reservedBalance: 0 },
        update: { balanceUsd: amountCents, reservedBalance: 0 },
      });
      await prisma.walletV2.upsert({
        where: { userId: BUYER_DISCORD_ID },
        create: { userId: BUYER_DISCORD_ID, availableCents: amountCents, reservedCents: 0 },
        update: { availableCents: amountCents, reservedCents: 0 },
      });
    }

    // Fund buyer with $2000.00 USD (200,000 cents)
    await fundBuyerWallet(200000);

    // Ensure Seller starts with $0.00 USD
    await prisma.wallet.upsert({
      where: { userId: SELLER_DISCORD_ID },
      create: { userId: SELLER_DISCORD_ID, balanceUsd: 0, reservedBalance: 0 },
      update: { balanceUsd: 0, reservedBalance: 0 },
    });

    // Create Buy Order
    const buyOrder = await prisma.exchangeBuyOrder.create({
      data: {
        orderCode: `EXB-P7-${timestamp}`,
        buyerUserId: BUYER_DISCORD_ID,
        buyerDiscordId: BUYER_DISCORD_ID,
        gameId: game.id,
        currencyId: currency.id,
        pricePerUnitCents: 200, // $2.00 per unit
        unitLabelSnapshot: currency.unitLabel,
        unitMultiplierSnapshot: currency.unitMultiplier,
        minTradeBaseUnits: '1000',
        maxTradeBaseUnits: '100000',
        totalCapacityBaseUnits: '500000',
        reservedCapacityBaseUnits: '0',
        remainingCapacityBaseUnits: '500000',
        filledCapacityBaseUnits: '0',
        acceptedDeliveryMethodIdsJson: JSON.stringify([deliveryMethod.id]),
        status: 'ACTIVE',
      },
    });

    // Helper to create and fund a trade
    async function createFundedTrade(qtyUnits: string = '5000') {
      const offer = await submitSellOffer({
        buyOrderId: buyOrder.id,
        sellerUserId: SELLER_DISCORD_ID,
        offeredAmountBaseUnits: qtyUnits,
        deliveryMethodId: deliveryMethod!.id,
      });

      const trade = await acceptSellOffer({
        offerId: offer.id,
        buyerUserId: BUYER_DISCORD_ID,
      });

      await payTradeWithWallet(trade.id, BUYER_DISCORD_ID);

      const fundedTrade = await prisma.exchangeTrade.findUnique({
        where: { id: trade.id },
        include: { escrow: true },
      });

      return fundedTrade!;
    }

    console.log('\n--- TEST GROUP 1: Delivery Proof Submission & Gallery ---');
    const trade1 = await createFundedTrade('5000');
    assert(trade1.status === 'DELIVERY_IN_PROGRESS', 'Trade 1 starts in DELIVERY_IN_PROGRESS status (room auto-created)');
    assert(trade1.escrow?.status === 'RESERVED', 'Trade 1 escrow is in RESERVED status');

    const proof1 = await submitExchangeProof({
      tradeId: trade1.id,
      submittedByUserId: SELLER_DISCORD_ID,
      submittedByDiscordId: SELLER_DISCORD_ID,
      submitterRole: 'SELLER',
      proofType: 'DELIVERY_PROOF',
      fileUrl: 'https://cdn.g4x.gg/proofs/delivery_1001.png',
      evidenceLinks: ['https://imgur.com/gallery/p7delivery'],
      inGameDetails: 'Traded 5000 gold face-to-face in Stormwind',
      note: 'Trade completed smoothly with buyer',
    });

    assert(Boolean(proof1 && proof1.id), 'submitExchangeProof persists proof entity');
    assert(proof1.reviewStatus === 'PENDING', 'submitExchangeProof initializes reviewStatus as PENDING');

    const trade1AfterProof = await prisma.exchangeTrade.findUnique({ where: { id: trade1.id } });
    assert(trade1AfterProof?.status === 'PROOF_SUBMITTED', 'Trade transitions to PROOF_SUBMITTED upon seller delivery proof submission');

    const proofsList = await getExchangeProofsForTrade(trade1.id);
    assert(proofsList.length === 1 && proofsList[0].id === proof1.id, 'getExchangeProofsForTrade retrieves uploaded proofs gallery');

    console.log('\n--- TEST GROUP 2: Request Additional Proof ---');
    const trade1ReqProof = await requestAdditionalProof({
      tradeId: trade1.id,
      actorDiscordId: ADMIN_DISCORD_ID,
      actorRole: 'ADMIN',
      reason: 'Screenshot does not clearly show character name. Please upload complete screen.',
    });
    assert(trade1ReqProof.status === 'ADDITIONAL_PROOF_REQUESTED', 'requestAdditionalProof updates trade status to ADDITIONAL_PROOF_REQUESTED');

    // Resubmit additional proof
    await submitExchangeProof({
      tradeId: trade1.id,
      submittedByUserId: SELLER_DISCORD_ID,
      submittedByDiscordId: SELLER_DISCORD_ID,
      submitterRole: 'SELLER',
      proofType: 'ADDITIONAL_PROOF',
      fileUrl: 'https://cdn.g4x.gg/proofs/delivery_1001_full.png',
      note: 'Full screen capture showing both character names and trade log',
    });
    const trade1Resubmitted = await prisma.exchangeTrade.findUnique({ where: { id: trade1.id } });
    assert(trade1Resubmitted?.status === 'PROOF_SUBMITTED', 'Resubmitting proof resets trade status to PROOF_SUBMITTED');

    console.log('\n--- TEST GROUP 3: Buyer Confirmation Invariant (Zero Payout on Confirm) ---');
    // Non-buyer cannot confirm
    let unauthorizedConfirmCaught = false;
    try {
      await confirmExchangeDeliveryByBuyer({
        tradeId: trade1.id,
        buyerUserId: OTHER_DISCORD_ID,
        buyerDiscordId: OTHER_DISCORD_ID,
      });
    } catch (err: any) {
      unauthorizedConfirmCaught = err instanceof TradeValidationError && err.statusCode === 403;
    }
    assert(unauthorizedConfirmCaught, 'confirmExchangeDeliveryByBuyer blocks non-buyer with 403 Forbidden');

    // Capture balances before buyer confirmation
    const buyerWalletBefore = await prisma.wallet.findUnique({ where: { userId: BUYER_DISCORD_ID } });
    const sellerWalletBefore = await prisma.wallet.findUnique({ where: { userId: SELLER_DISCORD_ID } });

    const trade1Confirmed = await confirmExchangeDeliveryByBuyer({
      tradeId: trade1.id,
      buyerUserId: BUYER_DISCORD_ID,
      buyerDiscordId: BUYER_DISCORD_ID,
      note: 'Received items in full, thank you!',
    });

    assert(trade1Confirmed.status === 'AWAITING_FINAL_APPROVAL', 'Buyer confirmation moves trade to AWAITING_FINAL_APPROVAL');
    assert(trade1Confirmed.buyerConfirmedAt !== null, 'Buyer confirmation sets buyerConfirmedAt timestamp');

    // Verify STRICT INVARIANT: zero fund release to seller, escrow remains RESERVED
    const escrowAfterConfirm = await prisma.exchangeEscrow.findUnique({ where: { tradeId: trade1.id } });
    const buyerWalletAfterConfirm = await prisma.wallet.findUnique({ where: { userId: BUYER_DISCORD_ID } });
    const sellerWalletAfterConfirm = await prisma.wallet.findUnique({ where: { userId: SELLER_DISCORD_ID } });

    assert(escrowAfterConfirm?.status === 'RESERVED', 'Escrow status remains strictly RESERVED upon buyer confirmation');
    assert(escrowAfterConfirm?.releasedAt === null, 'Escrow releasedAt timestamp remains strictly NULL upon buyer confirmation');
    assert(buyerWalletAfterConfirm?.reservedBalance === buyerWalletBefore?.reservedBalance, 'Buyer reserved balance unchanged by confirmation');
    assert(sellerWalletAfterConfirm?.balanceUsd === sellerWalletBefore?.balanceUsd, 'Seller wallet receives ZERO funds on buyer confirmation (no premature payout)');

    console.log('\n--- TEST GROUP 4: Staff Rejection of Final Approval ---');
    const trade1Rejected = await rejectTradeFinalApproval({
      tradeId: trade1.id,
      adminDiscordId: ADMIN_DISCORD_ID,
      reason: 'Need clarification on guild bank transfer log',
    });
    assert(trade1Rejected.status === 'ADDITIONAL_PROOF_REQUESTED', 'rejectTradeFinalApproval returns trade to ADDITIONAL_PROOF_REQUESTED');

    // Buyer re-confirms for final approval
    await confirmExchangeDeliveryByBuyer({
      tradeId: trade1.id,
      buyerUserId: BUYER_DISCORD_ID,
      buyerDiscordId: BUYER_DISCORD_ID,
      note: 'Confirmed with admin as well',
    });

    console.log('\n--- TEST GROUP 5: Internal Admin Notes ---');
    const trade1WithNote = await addTradeInternalNote({
      tradeId: trade1.id,
      adminDiscordId: ADMIN_DISCORD_ID,
      note: 'Verified with guild officer log. Approved for final payout release.',
    });
    assert(Boolean(trade1WithNote.internalAdminNotes?.includes('Verified with guild officer log')), 'addTradeInternalNote appends staff notes cleanly');

    console.log('\n--- TEST GROUP 6: Idempotent Final Approval & Settlement Engine ---');
    const initialBuyerWallet = await prisma.wallet.findUnique({ where: { userId: BUYER_DISCORD_ID } });
    const initialSellerWallet = await prisma.wallet.findUnique({ where: { userId: SELLER_DISCORD_ID } });
    const initialLedgerCount = await prisma.ledgerTransaction.count({ where: { userId: SELLER_DISCORD_ID } });

    const settleResult = await approveAndSettleExchangeTrade({
      tradeId: trade1.id,
      adminUserId: ADMIN_DISCORD_ID,
      adminDiscordId: ADMIN_DISCORD_ID,
      note: 'Delivery verified and approved by admin',
    });

    assert(Boolean(settleResult.settlement && settleResult.settlement.id), 'approveAndSettleExchangeTrade generates settlement record');
    assert(settleResult.settlement.settlementCode.startsWith('EXS-'), 'Settlement code matches EXS-XXXX format');
    assert(settleResult.trade.status === 'COMPLETED', 'Trade status transitions to COMPLETED on settlement');
    assert(settleResult.trade.completedAt !== null, 'Trade completedAt timestamp is recorded');
    assert(settleResult.trade.finalApprovedAt !== null, 'Trade finalApprovedAt timestamp is recorded');

    // Exact cent validation
    assert(
      settleResult.settlement.grossValueCents === trade1.grossValueCents,
      `Gross value exact cents match ($${trade1.grossValueCents / 100})`
    );
    assert(
      settleResult.settlement.sellerNetPayoutCents === trade1.netSellerCents,
      `Seller net payout exact cents match ($${trade1.netSellerCents / 100})`
    );
    assert(
      settleResult.settlement.g4xTotalRevenueCents === (trade1.buyerFeeCents + trade1.sellerFeeCents),
      'G4X total revenue exact cents match (buyerFee + sellerFee)'
    );

    // Escrow state verification
    const settledEscrow = await prisma.exchangeEscrow.findUnique({ where: { tradeId: trade1.id } });
    assert(settledEscrow?.status === 'RELEASED', 'Escrow status transitioned to RELEASED');
    assert(settledEscrow?.releasedAt !== null, 'Escrow releasedAt timestamp is set');
    assert(settledEscrow?.resolutionLedgerId !== null, 'Escrow resolutionLedgerId is recorded');

    // Central Wallet Balance verification
    const buyerWalletAfterSettle = await prisma.wallet.findUnique({ where: { userId: BUYER_DISCORD_ID } });
    const sellerWalletAfterSettle = await prisma.wallet.findUnique({ where: { userId: SELLER_DISCORD_ID } });

    const expectedBuyerReserved = (initialBuyerWallet?.reservedBalance || 0) - (trade1.escrow?.reservedAmountCents || 0);
    const expectedSellerBalance = (initialSellerWallet?.balanceUsd || 0) + trade1.netSellerCents;

    assert(
      buyerWalletAfterSettle?.reservedBalance === expectedBuyerReserved,
      `Buyer reservedBalance decremented by escrow amount: ${buyerWalletAfterSettle?.reservedBalance} === ${expectedBuyerReserved}`
    );
    assert(
      sellerWalletAfterSettle?.balanceUsd === expectedSellerBalance,
      `Seller balanceUsd credited by exact sellerNetPayoutCents: ${sellerWalletAfterSettle?.balanceUsd} === ${expectedSellerBalance}`
    );

    // Ledger records verification
    const sellerLedger = await prisma.ledgerTransaction.findFirst({
      where: { userId: SELLER_DISCORD_ID, entryType: 'trade_settlement' },
    });
    assert(Boolean(sellerLedger && sellerLedger.amountMinor === trade1.netSellerCents), 'Immutable LedgerTransaction recorded for seller payout');

    // Buy order capacity transition (reserved -> filled)
    const buyOrderAfterSettle = await prisma.exchangeBuyOrder.findUnique({ where: { id: buyOrder.id } });
    assert(
      buyOrderAfterSettle?.filledCapacityBaseUnits === '5000',
      `BuyOrder filled capacity incremented by trade quantity: ${buyOrderAfterSettle?.filledCapacityBaseUnits} === 5000`
    );

    // IDEMPOTENCY LOCK: Calling approveAndSettleExchangeTrade second time MUST fail with 409 Conflict
    let duplicateSettlementBlocked = false;
    try {
      await approveAndSettleExchangeTrade({
        tradeId: trade1.id,
        adminUserId: ADMIN_DISCORD_ID,
        adminDiscordId: ADMIN_DISCORD_ID,
      });
    } catch (err: any) {
      duplicateSettlementBlocked = err instanceof TradeValidationError && err.statusCode === 409;
    }
    assert(duplicateSettlementBlocked, 'Idempotency Lock: duplicate settlement call fails closed with 409 Conflict');

    // Verify balances did not mutate on duplicate call
    const sellerWalletAfterDuplicate = await prisma.wallet.findUnique({ where: { userId: SELLER_DISCORD_ID } });
    assert(
      sellerWalletAfterDuplicate?.balanceUsd === expectedSellerBalance,
      'Zero duplicate payout: Seller balance identical after aborted duplicate settlement'
    );

    console.log('\n--- TEST GROUP 7: Dispute Engine — Opening Disputes & Escrow Freezing ---');
    const trade2 = await createFundedTrade('6000');
    assert(trade2.escrow?.status === 'RESERVED', 'Trade 2 escrow initially RESERVED');

    const dispute1 = await openExchangeDispute({
      tradeId: trade2.id,
      openedByUserId: BUYER_DISCORD_ID,
      openedByDiscordId: BUYER_DISCORD_ID,
      openedByRole: 'BUYER',
      category: 'BUYER_NOT_RECEIVED',
      description: 'Seller did not meet at the agreed in-game location after 45 minutes.',
      evidenceLinks: ['https://discord.com/channels/evidence/chat-screenshot'],
    });

    assert(Boolean(dispute1 && dispute1.id), 'openExchangeDispute creates dispute record');
    assert(dispute1.disputeCode.startsWith('EXD-'), 'Dispute code matches EXD-XXXX format');
    assert(dispute1.status === 'OPEN', 'Dispute initialized in OPEN status');

    const trade2AfterDispute = await prisma.exchangeTrade.findUnique({
      where: { id: trade2.id },
      include: { escrow: true },
    });
    assert(trade2AfterDispute?.status === 'DISPUTED', 'Trade status transitions to DISPUTED');
    assert(trade2AfterDispute?.escrow?.status === 'FROZEN_DISPUTE', 'Escrow status FROZEN_DISPUTE locks funds against unauthorized movement');

    // Duplicate dispute on same trade blocked
    let duplicateDisputeBlocked = false;
    try {
      await openExchangeDispute({
        tradeId: trade2.id,
        openedByUserId: BUYER_DISCORD_ID,
        openedByDiscordId: BUYER_DISCORD_ID,
        openedByRole: 'BUYER',
        category: 'BUYER_NOT_RECEIVED',
        description: 'Second dispute attempt',
      });
    } catch (err: any) {
      duplicateDisputeBlocked = err instanceof TradeValidationError && err.statusCode === 409;
    }
    assert(duplicateDisputeBlocked, 'Cannot open duplicate active dispute on trade with active dispute (409 Conflict)');

    console.log('\n--- TEST GROUP 8: Dispute Resolution — FULL_REFUND_TO_BUYER ---');
    const buyerWalletBeforeRefund = await prisma.wallet.findUnique({ where: { userId: BUYER_DISCORD_ID } });
    const orderBeforeRefund = await prisma.exchangeBuyOrder.findUnique({ where: { id: buyOrder.id } });

    const resolvedDispute1 = await resolveExchangeDispute({
      disputeId: dispute1.id,
      adminUserId: ADMIN_DISCORD_ID,
      adminDiscordId: ADMIN_DISCORD_ID,
      outcome: 'FULL_REFUND_TO_BUYER',
      note: 'Seller failed to provide delivery proof within 24h. Full refund issued to buyer.',
    });

    assert(resolvedDispute1.status === 'RESOLVED', 'Dispute status becomes RESOLVED');
    assert(resolvedDispute1.resolutionOutcome === 'FULL_REFUND_TO_BUYER', 'Dispute resolution outcome recorded as FULL_REFUND_TO_BUYER');

    const trade2Resolved = await prisma.exchangeTrade.findUnique({
      where: { id: trade2.id },
      include: { escrow: true },
    });
    assert(trade2Resolved?.status === 'CANCELLED', 'Trade status transitioned to CANCELLED on full dispute refund');
    assert(trade2Resolved?.escrow?.status === 'REFUNDED', 'Escrow status transitioned to REFUNDED');
    assert(trade2Resolved?.escrow?.refundedAt !== null, 'Escrow refundedAt timestamp is recorded');

    // Central Wallet Refund verification
    const buyerWalletAfterRefund = await prisma.wallet.findUnique({ where: { userId: BUYER_DISCORD_ID } });
    const expectedBuyerBalAfterRefund = (buyerWalletBeforeRefund?.balanceUsd || 0) + (trade2.escrow?.reservedAmountCents || 0);
    const expectedBuyerResAfterRefund = (buyerWalletBeforeRefund?.reservedBalance || 0) - (trade2.escrow?.reservedAmountCents || 0);

    assert(
      buyerWalletAfterRefund?.balanceUsd === expectedBuyerBalAfterRefund,
      `Buyer balanceUsd refunded by escrow amount: ${buyerWalletAfterRefund?.balanceUsd} === ${expectedBuyerBalAfterRefund}`
    );
    assert(
      buyerWalletAfterRefund?.reservedBalance === expectedBuyerResAfterRefund,
      `Buyer reservedBalance released: ${buyerWalletAfterRefund?.reservedBalance} === ${expectedBuyerResAfterRefund}`
    );

    // Buy order capacity restored
    const orderAfterRefund = await prisma.exchangeBuyOrder.findUnique({ where: { id: buyOrder.id } });
    const expectedRemaining = BigInt(orderBeforeRefund?.remainingCapacityBaseUnits || '0') + BigInt('6000');
    assert(
      orderAfterRefund?.remainingCapacityBaseUnits === expectedRemaining.toString(),
      'BuyOrder remaining capacity restored on dispute cancellation'
    );

    console.log('\n--- TEST GROUP 9: Dispute Resolution — PARTIAL_REFUND ---');
    const trade3 = await createFundedTrade('4000');
    const dispute2 = await openExchangeDispute({
      tradeId: trade3.id,
      openedByUserId: BUYER_DISCORD_ID,
      openedByDiscordId: BUYER_DISCORD_ID,
      openedByRole: 'BUYER',
      category: 'PARTIAL_DELIVERY',
      description: 'Seller only delivered 2000 of the 4000 units.',
    });

    const totalEscrowCents = trade3.escrow?.reservedAmountCents || 0;
    const halfRefundCents = Math.floor(totalEscrowCents / 2);
    const halfPayoutCents = totalEscrowCents - halfRefundCents;

    const resolvedDispute2 = await resolveExchangeDispute({
      disputeId: dispute2.id,
      adminUserId: ADMIN_DISCORD_ID,
      adminDiscordId: ADMIN_DISCORD_ID,
      outcome: 'PARTIAL_REFUND',
      buyerRefundCents: halfRefundCents,
      sellerPayoutCents: halfPayoutCents,
      note: 'Partial delivery verified. 50% refunded to buyer, 50% paid to seller.',
    });

    assert(resolvedDispute2.status === 'RESOLVED', 'Partial dispute marked RESOLVED');
    assert(resolvedDispute2.resolutionOutcome === 'PARTIAL_REFUND', 'Outcome recorded as PARTIAL_REFUND');
    assert(resolvedDispute2.resolutionBuyerRefundCents === halfRefundCents, 'Buyer partial refund cents recorded');
    assert(resolvedDispute2.resolutionSellerPayoutCents === halfPayoutCents, 'Seller partial payout cents recorded');

    const trade3AfterPartial = await prisma.exchangeTrade.findUnique({
      where: { id: trade3.id },
      include: { escrow: true },
    });
    assert(trade3AfterPartial?.status === 'COMPLETED', 'Trade status is COMPLETED upon partial settlement');
    assert(trade3AfterPartial?.escrow?.status === 'PARTIALLY_REFUNDED', 'Escrow status is PARTIALLY_REFUNDED');

    console.log('\n--- TEST GROUP 10: Dispute Resolution — RELEASE_TO_SELLER ---');
    const trade4 = await createFundedTrade('3000');
    const dispute3 = await openExchangeDispute({
      tradeId: trade4.id,
      openedByUserId: BUYER_DISCORD_ID,
      openedByDiscordId: BUYER_DISCORD_ID,
      openedByRole: 'BUYER',
      category: 'SUSPECTED_FRAUD',
      description: 'Dispute opened accidentally',
    });

    const resolvedDispute3 = await resolveExchangeDispute({
      disputeId: dispute3.id,
      adminUserId: ADMIN_DISCORD_ID,
      adminDiscordId: ADMIN_DISCORD_ID,
      outcome: 'RELEASE_TO_SELLER',
      note: 'Buyer admitted mistake. Complete delivery verified via video log. Released in full to seller.',
    });

    assert(resolvedDispute3.status === 'RESOLVED', 'Dispute marked RESOLVED');
    assert(resolvedDispute3.resolutionOutcome === 'RELEASE_TO_SELLER', 'Outcome recorded as RELEASE_TO_SELLER');

    const trade4AfterRelease = await prisma.exchangeTrade.findUnique({
      where: { id: trade4.id },
      include: { escrow: true },
    });
    assert(trade4AfterRelease?.status === 'COMPLETED', 'Trade status COMPLETED upon RELEASE_TO_SELLER resolution');
    assert(trade4AfterRelease?.escrow?.status === 'RELEASED', 'Escrow status RELEASED upon RELEASE_TO_SELLER resolution');

    console.log('\n--- TEST GROUP 11: Operations Queries & Helpers ---');
    const disputeFromDb = await getExchangeDisputeById(dispute1.id);
    assert(Boolean(disputeFromDb && disputeFromDb.id === dispute1.id), 'getExchangeDisputeById retrieves dispute');

    const disputeByTrade = await getExchangeDisputeByTradeId(trade2.id);
    assert(Boolean(disputeByTrade && disputeByTrade.tradeId === trade2.id), 'getExchangeDisputeByTradeId retrieves dispute');

    const settlementFromDb = await getSettlementByTradeId(trade1.id);
    assert(Boolean(settlementFromDb && settlementFromDb.tradeId === trade1.id), 'getSettlementByTradeId retrieves settlement');

    const disputesList = await listExchangeDisputes({ limit: 10 });
    assert(disputesList.disputes.length >= 3, `listExchangeDisputes returns list of disputes (count: ${disputesList.disputes.length})`);

    console.log(`\n======================================================`);
    console.log(`PHASE 7 TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log(`======================================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error: any) {
    console.error('FATAL ERROR in Phase 7 Test Suite:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runSuite();
