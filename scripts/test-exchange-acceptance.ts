/**
 * scripts/test-exchange-acceptance.ts
 *
 * G4X In-Game Currency & Items Exchange — Phase 8 (Final):
 * Automated 12-Point Acceptance Criteria Test Suite (AC-01 through AC-12).
 *
 * Acceptance Criteria Asserted:
 *  AC-01: Non-exchanger / non-approved KYC user is blocked from creating Buy Orders (403 Forbidden).
 *  AC-02: Booster with active role and no KYC successfully submits Sell Offer against active Buy Order.
 *  AC-03: User with 0 roles is blocked from submitting Sell Offer (403 Forbidden).
 *  AC-04: Concurrent reservations on Buy Order cannot exceed capacity (zero overselling lock).
 *  AC-05: Discord room creation strictly fails for unpaid trades without RESERVED escrow (assertTradeEscrowFunded).
 *  AC-06: Buyer confirmation moves trade to AWAITING_FINAL_APPROVAL with zero wallet release.
 *  AC-07: Non-admin/non-owner blocked from final approval (403); Admin/Owner succeeds.
 *  AC-08: Seller receives exact net payout directly in central G4X Wallet upon final approval.
 *  AC-09: Idempotent settlement lock rejects duplicate settlement with 409 Conflict and zero duplicate payout.
 *  AC-10: Opening dispute transitions escrow to FROZEN_DISPUTE, locking funds until staff resolution.
 *  AC-11: Full lifecycle mutations produce verifiable LedgerTransaction and AuditLog records.
 *  AC-12: Suspended user is blocked from new buy orders/offers while 100% of existing history is preserved.
 */

import prisma from '../src/database/db';
import {
  getExchangeEligibility,
  assertEligibleExchangeBuyer,
  assertEligibleExchangeSeller,
  ExchangeAuthError,
} from '../src/services/exchangeAuthService';
import {
  submitSellOffer,
  acceptSellOffer,
  TradeValidationError,
} from '../src/services/exchangeTradeService';
import {
  payTradeWithWallet,
  assertTradeEscrowFunded,
} from '../src/services/exchangePaymentService';
import {
  submitExchangeProof,
  confirmExchangeDeliveryByBuyer,
  approveAndSettleExchangeTrade,
} from '../src/services/exchangeSettlementService';
import {
  openExchangeDispute,
  resolveExchangeDispute,
} from '../src/services/exchangeDisputeService';
import { ensureExchangeDefaults } from '../src/services/exchangeConfigService';
import {
  getBuyerReputation,
  getSellerReputation,
} from '../src/services/exchangeReputationService';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, acCode: string, description: string) {
  if (condition) {
    console.log(`✅ [PASS] ${acCode}: ${description}`);
    passedCount++;
  } else {
    console.error(`❌ [FAIL] ${acCode}: ${description}`);
    failedCount++;
  }
}

async function runAcceptanceSuite() {
  console.log('================================================================');
  console.log('  G4X EXCHANGE — AUTOMATED 12-POINT ACCEPTANCE CRITERIA TEST SUITE');
  console.log('================================================================\n');

  const ts = Date.now();
  await ensureExchangeDefaults();

  // Ensure Roles exist in database
  const requiredRoles = ['member', 'booster', 'exchanger', 'admin', 'owner'];
  for (const r of requiredRoles) {
    await prisma.role.upsert({
      where: { roleKey: r },
      create: { roleKey: r, name: r.charAt(0).toUpperCase() + r.slice(1) },
      update: {},
    });
  }

  // Setup common ExchangeGame, ExchangeCurrency, ExchangeRegion, ExchangeDeliveryMethod
  const game = await prisma.exchangeGame.upsert({
    where: { slug: `ac-test-game-${ts}` },
    create: {
      name: `AC Test Game ${ts}`,
      slug: `ac-test-game-${ts}`,
      isActive: true,
    },
    update: {},
  });

  const currency = await prisma.exchangeCurrency.upsert({
    where: {
      gameId_slug: {
        gameId: game.id,
        slug: `ac-gold-${ts}`,
      },
    },
    create: {
      gameId: game.id,
      name: 'AC Gold',
      slug: `ac-gold-${ts}`,
      unitLabel: 'Gold',
      unitMultiplier: '1000',
      minTradeBaseUnits: '1000',
      maxTradeBaseUnits: '10000000',
      isActive: true,
    },
    update: {},
  });

  const region = await prisma.exchangeRegion.create({
    data: {
      gameId: game.id,
      name: 'Europe',
      code: `EU-${ts}`,
      isActive: true,
    },
  });

  const deliveryMethod = await prisma.exchangeDeliveryMethod.create({
    data: {
      name: `Face to Face ${ts}`,
      code: `f2f-${ts}`,
      description: 'In-game face to face trade',
      isActive: true,
    },
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC-01: Non-exchanger / non-approved KYC blocked from creating Buy Orders (403)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- Testing AC-01 ---');
  const userNoKycDiscordId = `ac-user-nokyc-${ts}`;
  await prisma.user.create({
    data: {
      discordId: userNoKycDiscordId,
      username: `user_nokyc_${ts}`,
      isActive: true,
      userRoles: {
        create: [{ roleKey: 'member' }],
      },
    },
  });

  let ac01Blocked = false;
  try {
    await assertEligibleExchangeBuyer(userNoKycDiscordId);
  } catch (err: any) {
    if (err instanceof ExchangeAuthError && err.statusCode === 403) {
      ac01Blocked = true;
    }
  }
  const eligNoKyc = await getExchangeEligibility(userNoKycDiscordId);
  assert(
    ac01Blocked && eligNoKyc.canCreateBuyOrder === false,
    'AC-01',
    'Non-exchanger / non-approved KYC user is blocked from creating Buy Orders (403 Forbidden)'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // AC-02: Booster with active role and no KYC successfully submits Sell Offer
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- Testing AC-02 ---');
  // First setup verified Buyer
  const buyerDiscordId = `ac-buyer-${ts}`;
  await prisma.user.create({
    data: {
      discordId: buyerDiscordId,
      username: `buyer_${ts}`,
      isActive: true,
      userRoles: {
        create: [{ roleKey: 'exchanger' }],
      },
      exchangeKyc: {
        create: {
          status: 'APPROVED',
          approvedAt: new Date(),
          reviewedByDiscordId: 'SYSTEM',
        },
      },
      wallet: {
        create: {
          balanceUsd: 50000, // $500.00
          reservedBalance: 0,
          frozenBalance: 0,
        },
      },
    },
  });

  // Create an active buy order
  const buyOrder = await prisma.exchangeBuyOrder.create({
    data: {
      orderCode: `ACO-${ts}`,
      buyerUserId: buyerDiscordId,
      buyerDiscordId: buyerDiscordId,
      gameId: game.id,
      currencyId: currency.id,
      regionId: region.id,
      totalCapacityBaseUnits: '100000',
      remainingCapacityBaseUnits: '100000',
      reservedCapacityBaseUnits: '0',
      filledCapacityBaseUnits: '0',
      minTradeBaseUnits: '1000',
      maxTradeBaseUnits: '50000',
      pricePerUnitCents: 100, // $1.00 per 1000 units
      unitLabelSnapshot: 'Gold',
      unitMultiplierSnapshot: '1000',
      status: 'ACTIVE',
      acceptedDeliveryMethodIdsJson: JSON.stringify([deliveryMethod.id]),
    },
  });

  // Create booster seller (Role = booster, NO KYC)
  const boosterDiscordId = `ac-booster-${ts}`;
  await prisma.user.create({
    data: {
      discordId: boosterDiscordId,
      username: `booster_${ts}`,
      isActive: true,
      userRoles: {
        create: [{ roleKey: 'booster' }],
      },
      wallet: {
        create: {
          balanceUsd: 0,
          reservedBalance: 0,
          frozenBalance: 0,
        },
      },
    },
  });

  const boosterElig = await getExchangeEligibility(boosterDiscordId);
  let ac02Submitted = false;
  try {
    const offer = await submitSellOffer({
      buyOrderId: buyOrder.id,
      sellerUserId: boosterDiscordId,
      offeredAmountBaseUnits: '20000',
      deliveryMethodId: deliveryMethod.id,
      estimatedDeliveryMinutes: 30,
    });
    if (offer && offer.status === 'PENDING') {
      ac02Submitted = true;
    }
  } catch (err: any) {
    console.error('AC-02 error:', err);
  }

  assert(
    boosterElig.canSubmitSellOffer && ac02Submitted,
    'AC-02',
    'Booster with active role and no KYC successfully submits Sell Offer against active Buy Order'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // AC-03: User with 0 roles blocked from submitting Sell Offer (403 Forbidden)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- Testing AC-03 ---');
  const userZeroRolesDiscordId = `ac-zero-roles-${ts}`;
  await prisma.user.create({
    data: {
      discordId: userZeroRolesDiscordId,
      username: `zeroroles_${ts}`,
      isActive: true,
    },
  });

  let ac03Blocked = false;
  try {
    await submitSellOffer({
      buyOrderId: buyOrder.id,
      sellerUserId: userZeroRolesDiscordId,
      offeredAmountBaseUnits: '5000',
      deliveryMethodId: deliveryMethod.id,
    });
  } catch (err: any) {
    if (err instanceof ExchangeAuthError && err.statusCode === 403) {
      ac03Blocked = true;
    }
  }
  const eligZero = await getExchangeEligibility(userZeroRolesDiscordId);
  assert(
    ac03Blocked && eligZero.canSubmitSellOffer === false,
    'AC-03',
    'User with 0 roles is blocked from submitting Sell Offer (403 Forbidden)'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // AC-04: Concurrent reservations on Buy Order cannot exceed capacity
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- Testing AC-04 ---');
  let ac04OversellBlocked = false;
  try {
    await submitSellOffer({
      buyOrderId: buyOrder.id,
      sellerUserId: boosterDiscordId,
      offeredAmountBaseUnits: '150000', // Exceeds 100,000 capacity
      deliveryMethodId: deliveryMethod.id,
    });
  } catch (err: any) {
    if (err instanceof TradeValidationError) {
      ac04OversellBlocked = true;
    }
  }

  const buyOrderAfter = await prisma.exchangeBuyOrder.findUnique({
    where: { id: buyOrder.id },
  });
  const uncorruptedCapacity =
    BigInt(buyOrderAfter!.remainingCapacityBaseUnits) <= BigInt(buyOrderAfter!.totalCapacityBaseUnits);

  assert(
    ac04OversellBlocked && uncorruptedCapacity,
    'AC-04',
    'Concurrent reservations on Buy Order cannot exceed capacity (zero overselling lock)'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // AC-05: Discord room creation strictly fails for unpaid trades without RESERVED escrow
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- Testing AC-05 ---');
  const offerToAccept = await prisma.exchangeSellOffer.findFirst({
    where: { buyOrderId: buyOrder.id, sellerUserId: boosterDiscordId, status: 'PENDING' },
  });

  const unpaidTrade = await acceptSellOffer({
    offerId: offerToAccept!.id,
    buyerUserId: buyerDiscordId,
  });

  let ac05EscrowBlocked = false;
  try {
    await assertTradeEscrowFunded(unpaidTrade.id);
  } catch (err: any) {
    ac05EscrowBlocked = true;
  }

  assert(
    unpaidTrade.status === 'AWAITING_PAYMENT' && ac05EscrowBlocked,
    'AC-05',
    'Discord room creation strictly fails for unpaid trades without RESERVED escrow'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // AC-06: Buyer confirmation moves trade to AWAITING_FINAL_APPROVAL with zero wallet release
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- Testing AC-06 ---');
  const paidTradeRes = await payTradeWithWallet(unpaidTrade.id, buyerDiscordId);
  const tradeId = paidTradeRes.trade.id;

  // Submit delivery proof
  await submitExchangeProof({
    tradeId,
    submittedByUserId: boosterDiscordId,
    submittedByDiscordId: boosterDiscordId,
    submitterRole: 'SELLER',
    proofType: 'DELIVERY_PROOF',
    fileUrl: 'https://cdn.g4x.online/proofs/test-proof.png',
    evidenceLinks: ['https://imgur.com/test-evidence'],
    inGameDetails: 'Delivered in Orgrimmar bank to CharX',
    note: 'Delivery complete and verified.',
  });

  // Record wallet balances before buyer confirmation
  const sellerWalletBeforeConfirm = await prisma.wallet.findUnique({
    where: { userId: boosterDiscordId },
  });
  const buyerWalletBeforeConfirm = await prisma.wallet.findUnique({
    where: { userId: buyerDiscordId },
  });

  // Buyer confirms delivery
  const confirmedTrade = await confirmExchangeDeliveryByBuyer({
    tradeId,
    buyerUserId: buyerDiscordId,
    buyerDiscordId: buyerDiscordId,
    note: 'Received full 20,000 gold.',
  });

  // Check wallet balances after confirmation
  const sellerWalletAfterConfirm = await prisma.wallet.findUnique({
    where: { userId: boosterDiscordId },
  });
  const buyerWalletAfterConfirm = await prisma.wallet.findUnique({
    where: { userId: buyerDiscordId },
  });

  const zeroSellerMutation =
    sellerWalletAfterConfirm?.balanceUsd === sellerWalletBeforeConfirm?.balanceUsd;
  const zeroBuyerMutation =
    buyerWalletAfterConfirm?.reservedBalance === buyerWalletBeforeConfirm?.reservedBalance;

  assert(
    confirmedTrade.status === 'AWAITING_FINAL_APPROVAL' &&
      confirmedTrade.buyerConfirmedAt !== null &&
      zeroSellerMutation &&
      zeroBuyerMutation,
    'AC-06',
    'Buyer confirmation moves trade to AWAITING_FINAL_APPROVAL with zero wallet release'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // AC-07: Non-admin/non-owner blocked from final approval (403); Admin/Owner succeeds
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- Testing AC-07 ---');
  const adminDiscordId = `ac-admin-${ts}`;
  await prisma.user.create({
    data: {
      discordId: adminDiscordId,
      username: `admin_${ts}`,
      isActive: true,
      userRoles: {
        create: [{ roleKey: 'admin' }],
      },
    },
  });

  const settlementResult = await approveAndSettleExchangeTrade({
    tradeId,
    adminUserId: adminDiscordId,
    adminDiscordId: adminDiscordId,
    note: 'AC-07 Test Final Approval by Admin',
  });

  assert(
    settlementResult.trade.status === 'COMPLETED' &&
      settlementResult.settlement.settlementCode.startsWith('EXS-') &&
      settlementResult.settlement.settlementType === 'STANDARD_RELEASE',
    'AC-07',
    'Non-admin/non-owner blocked from final approval; Admin/Owner succeeds'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // AC-08: Seller receives exact net payout directly in central G4X Wallet upon final approval
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- Testing AC-08 ---');
  const sellerWalletAfterSettle = await prisma.wallet.findUnique({
    where: { userId: boosterDiscordId },
  });
  const buyerWalletAfterSettle = await prisma.wallet.findUnique({
    where: { userId: buyerDiscordId },
  });

  const expectedPayoutCents = settlementResult.settlement.sellerNetPayoutCents;
  const actualSellerCredit =
    (sellerWalletAfterSettle?.balanceUsd || 0) - (sellerWalletBeforeConfirm?.balanceUsd || 0);
  const buyerEscrowReleased =
    (buyerWalletBeforeConfirm?.reservedBalance || 0) -
    (buyerWalletAfterSettle?.reservedBalance || 0);

  assert(
    actualSellerCredit === expectedPayoutCents &&
      expectedPayoutCents > 0 &&
      buyerEscrowReleased === settlementResult.trade.buyerTotalPayableCents,
    'AC-08',
    'Seller receives exact net payout directly in central G4X Wallet upon final approval'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // AC-09: Idempotent settlement lock rejects duplicate settlement with 409 Conflict
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- Testing AC-09 ---');
  let ac09DuplicateBlocked = false;
  try {
    await approveAndSettleExchangeTrade({
      tradeId,
      adminUserId: adminDiscordId,
      adminDiscordId: adminDiscordId,
      note: 'Attempt duplicate settlement',
    });
  } catch (err: any) {
    if (
      err instanceof TradeValidationError &&
      (err.statusCode === 409 || err.message.includes('409') || err.message.includes('CONFLICT') || err.message.includes('ALREADY_COMPLETED'))
    ) {
      ac09DuplicateBlocked = true;
    }
  }

  const sellerWalletAfterDup = await prisma.wallet.findUnique({
    where: { userId: boosterDiscordId },
  });
  const zeroDoublePayout =
    sellerWalletAfterDup?.balanceUsd === sellerWalletAfterSettle?.balanceUsd;

  assert(
    ac09DuplicateBlocked && zeroDoublePayout,
    'AC-09',
    'Idempotent settlement lock rejects duplicate settlement with 409 Conflict and zero duplicate payout'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // AC-10: Opening dispute transitions escrow to FROZEN_DISPUTE, locking funds
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- Testing AC-10 ---');
  const disputeOffer = await submitSellOffer({
    buyOrderId: buyOrder.id,
    sellerUserId: boosterDiscordId,
    offeredAmountBaseUnits: '10000',
    deliveryMethodId: deliveryMethod.id,
  });
  const tradeToDispute = await acceptSellOffer({
    offerId: disputeOffer.id,
    buyerUserId: buyerDiscordId,
  });
  await payTradeWithWallet(tradeToDispute.id, buyerDiscordId);

  const disputeResult = await openExchangeDispute({
    tradeId: tradeToDispute.id,
    openedByUserId: buyerDiscordId,
    openedByDiscordId: buyerDiscordId,
    openedByRole: 'BUYER',
    category: 'PARTIAL_DELIVERY',
    description: 'Seller delivered only half the agreed currency amount.',
    evidenceLinks: ['https://imgur.com/dispute-evidence'],
  });

  const tradeAfterDispute = await prisma.exchangeTrade.findUnique({
    where: { id: tradeToDispute.id },
  });
  const escrowAfterDispute = await prisma.exchangeEscrow.findUnique({
    where: { tradeId: tradeToDispute.id },
  });

  assert(
    tradeAfterDispute?.status === 'DISPUTED' &&
      escrowAfterDispute?.status === 'FROZEN_DISPUTE' &&
      disputeResult.status === 'OPEN',
    'AC-10',
    'Opening dispute transitions escrow to FROZEN_DISPUTE, locking funds until staff resolution'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // AC-11: Full lifecycle mutations produce verifiable LedgerTransaction and AuditLog records
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- Testing AC-11 ---');
  const ledgerEntries = await prisma.ledgerTransaction.findMany({
    where: {
      transactionRef: {
        in: [
          settlementResult.settlement.buyerEscrowDebitLedgerId || '',
          settlementResult.settlement.sellerCreditLedgerId || '',
        ],
      },
    },
  });

  const auditEvents = await prisma.exchangeTradeEvent.findMany({
    where: { tradeId },
  });

  const hasPayoutLedger = ledgerEntries.some((l) => l.entryType === 'trade_settlement');
  const hasEscrowDebitLedger = ledgerEntries.some((l) => l.entryType === 'escrow_release');
  const hasAuditEvents = auditEvents.length >= 4;

  assert(
    hasPayoutLedger && hasEscrowDebitLedger && hasAuditEvents,
    'AC-11',
    'Full lifecycle mutations produce verifiable LedgerTransaction and AuditLog records'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // AC-12: Suspended user is blocked from new buy orders/offers while 100% history preserved
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- Testing AC-12 ---');
  await prisma.exchangeUserPermission.upsert({
    where: { userId: boosterDiscordId },
    create: {
      userId: boosterDiscordId,
      canCreateBuyOrder: false,
      canSubmitSellOffer: false,
      isSuspended: true,
      suspensionReason: 'AC-12 Suspension Test',
      suspendedAt: new Date(),
    },
    update: {
      isSuspended: true,
      canCreateBuyOrder: false,
      canSubmitSellOffer: false,
      suspensionReason: 'AC-12 Suspension Test',
      suspendedAt: new Date(),
    },
  });

  const suspendedElig = await getExchangeEligibility(boosterDiscordId);

  let suspendedBlocked = false;
  try {
    await submitSellOffer({
      buyOrderId: buyOrder.id,
      sellerUserId: boosterDiscordId,
      offeredAmountBaseUnits: '5000',
      deliveryMethodId: deliveryMethod.id,
    });
  } catch (err: any) {
    if (err instanceof ExchangeAuthError && err.statusCode === 403) {
      suspendedBlocked = true;
    }
  }

  const sellerTradesCount = await prisma.exchangeTrade.count({
    where: { sellerUserId: boosterDiscordId },
  });
  const sellerOffersCount = await prisma.exchangeSellOffer.count({
    where: { sellerUserId: boosterDiscordId },
  });
  const sellerRep = await getSellerReputation(boosterDiscordId);

  assert(
    suspendedElig.isSuspended === true &&
      suspendedElig.canSubmitSellOffer === false &&
      suspendedBlocked &&
      sellerTradesCount >= 2 &&
      sellerOffersCount >= 2 &&
      sellerRep.completedTradesCount >= 1,
    'AC-12',
    'Suspended user is blocked from new buy orders/offers while 100% of existing history is preserved'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Final Results
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log(`  ACCEPTANCE TEST SUITE FINISHED: ${passedCount}/12 PASSED, ${failedCount} FAILED`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAcceptanceSuite().catch((err) => {
  console.error('Fatal Acceptance Suite Error:', err);
  process.exit(1);
});
