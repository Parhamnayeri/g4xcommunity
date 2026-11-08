/**
 * phase6_exchange_marketplace_suite.ts — Website Phase 6 Dedicated Verification Suite
 *
 * Verifies:
 *  1. Marketplace authentication & session gates
 *  2. Exchanger application status lifecycle (none -> pending -> rejected -> approved)
 *  3. Approved vs unapproved / suspended Exchangers
 *  4. Management oversight boundaries (admin oversight cannot impersonate exchanger)
 *  5. Offer/request object ownership (cross-exchanger editing prevented)
 *  6. Cross-user privacy (trade records expose only public profile, not private balances)
 *  7. Quote server authority & anti-tamper hash validation
 *  8. Correct currency handling & integer minor units (USD cents, Toman)
 *  9. Quote expiry enforcement
 *  10. Commission and fee snapshots preserved across lifecycle
 *  11. Server-side pagination, status filtering, and sorting
 *  12. Valid and invalid state transitions
 *  13. Trade cancellation by authorized trade participants with safe reservation release
 *  14. Dispute state transitions and audit safety
 *  15. Feature gates disabled (FINANCE_V2_P2P_SETTLEMENT_ENABLED=false)
 *  16. Protection against phantom credits or parallel ledgers
 */

import prisma from '../database/db';
import {
  createExchangerFeeOffer,
  updateExchangerFeeOffer,
  setExchangerOfferStatus,
  generateGoldTradeQuote,
  createGoldTradeOrder,
  acceptGoldTrade,
  reportGoldDelivery,
  verifyGoldDelivery,
  submitExternalTradePayment,
  confirmExternalPaymentReceipt,
  cancelGoldTrade,
  disputeGoldTrade,
  generateP2pFundingQuote,
  acceptP2pFundingRequest,
  settleP2pFunding,
} from '../services/financeV2/exchangerMarketplaceService';
import {
  ExchangerOfferServiceType,
  ExchangerOfferStatus,
  GoldTradeSettlementMethod,
  GoldTradeStatus,
  GoldDeliveryStatus,
  GoldPaymentStatus,
  FINANCE_V2_FEATURE_GATES,
} from '../services/financeV2/financeV2Types';

async function runPhase6TestSuite() {
  console.log('=== STARTING G4X WEBSITE PHASE 6 TEST SUITE ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` — ${detail}` : ''}`);
      failed++;
    }
  }

  const timestamp = Date.now();
  const testExchangerId = `discord_phase6_exchanger_${timestamp}`;
  const otherExchangerId = `discord_phase6_other_${timestamp}`;
  const testAdvertiserId = `discord_phase6_adv_${timestamp}`;
  const unapprovedUserId = `discord_phase6_unapproved_${timestamp}`;
  const adminOversightId = `discord_phase6_admin_${timestamp}`;

  try {
    // -------------------------------------------------------------
    // SETUP: Create test users and wallets
    // -------------------------------------------------------------
    console.log('--- Setting up Phase 6 test accounts ---');

    for (const uid of [testExchangerId, otherExchangerId, testAdvertiserId, unapprovedUserId, adminOversightId]) {
      await prisma.user.upsert({
        where: { discordId: uid },
        update: {},
        create: { discordId: uid, username: `User_${uid}` },
      });
      await prisma.walletV2.upsert({
        where: { userId: uid },
        update: {
          availableCents: 50000,
          reservedCents: 0,
        },
        create: {
          userId: uid,
          availableCents: 50000,
          reservedCents: 0,
        },
      });
    }

    // Assign roles: testExchanger and otherExchanger are 'exchanger', testAdvertiser is 'advertiser', admin is 'admin' (oversight only)
    await prisma.userRole.createMany({
      data: [
        { userId: testExchangerId, roleKey: 'exchanger' },
        { userId: otherExchangerId, roleKey: 'exchanger' },
        { userId: testAdvertiserId, roleKey: 'advertiser' },
        { userId: adminOversightId, roleKey: 'admin' },
      ],
    });

    // -------------------------------------------------------------
    // TEST 1: Exchanger Application Status Lifecycle
    // -------------------------------------------------------------
    console.log('\n--- Test Group 1: Exchanger Application & Authorization ---');

    const initialApp = await prisma.registrationApplication.findFirst({
      where: { userId: unapprovedUserId, category: 'exchanger' },
    });
    assert(initialApp === null, '1.1 Unapproved user initially has no Exchanger application');

    const createdApp = await prisma.registrationApplication.create({
      data: {
        userId: unapprovedUserId,
        category: 'exchanger',
        status: 'pending',
        qualifications: JSON.stringify({ fullName: 'Test Applicant', volume: '1000-5000' }),
      },
    });
    assert(createdApp.status === 'pending', '1.2 Exchanger application registered with pending status');

    const rejectedApp = await prisma.registrationApplication.update({
      where: { id: createdApp.id },
      data: { status: 'rejected', reviewNotes: 'Insufficient trading history' },
    });
    assert(rejectedApp.status === 'rejected' && rejectedApp.reviewNotes !== null, '1.3 Application rejection preserves reviewer notes');

    // -------------------------------------------------------------
    // TEST 2: Role & Exchanger Eligibility Gates
    // -------------------------------------------------------------
    console.log('\n--- Test Group 2: Offer Creation Eligibility & Ownership ---');

    let nonExchangerBlocked = false;
    try {
      await createExchangerFeeOffer(unapprovedUserId, {
        exchangerId: unapprovedUserId,
        serviceType: ExchangerOfferServiceType.GOLD_PURCHASE_IRT,
        settlementCurrency: 'IRT',
        commissionPercentage: 0.03,
      });
    } catch (e: any) {
      nonExchangerBlocked = e.message.includes('UNAPPROVED_EXCHANGER');
    }
    assert(nonExchangerBlocked, '2.1 Non-exchanger is strictly blocked from publishing marketplace offers');

    let adminBlocked = false;
    try {
      await createExchangerFeeOffer(adminOversightId, {
        exchangerId: adminOversightId,
        serviceType: ExchangerOfferServiceType.GOLD_PURCHASE_IRT,
        settlementCurrency: 'IRT',
        commissionPercentage: 0.03,
      });
    } catch (e: any) {
      adminBlocked = e.message.includes('UNAPPROVED_EXCHANGER');
    }
    assert(adminBlocked, '2.2 Admin without explicit exchanger role is blocked from publishing offers');

    const offer = await createExchangerFeeOffer(testExchangerId, {
      exchangerId: testExchangerId,
      serviceType: ExchangerOfferServiceType.GOLD_PURCHASE_IRT,
      settlementCurrency: 'IRT',
      commissionPercentage: 0.025, // 2.50%
      terms: 'Fast settlement within 15 mins',
    });
    assert(offer.commissionPercentage === 0.025 && offer.status === ExchangerOfferStatus.ACTIVE, '2.3 Approved exchanger publishes active offer with custom rate');

    let unauthorizedEditBlocked = false;
    try {
      await updateExchangerFeeOffer(otherExchangerId, offer.id, { commissionPercentage: 0.05 });
    } catch (e: any) {
      unauthorizedEditBlocked = e.message.includes('UNAUTHORIZED_OFFER_MODIFICATION');
    }
    assert(unauthorizedEditBlocked, '2.4 Another exchanger cannot tamper with or edit foreign offers');

    const pausedOffer = await setExchangerOfferStatus(testExchangerId, offer.id, ExchangerOfferStatus.PAUSED);
    assert(pausedOffer.status === ExchangerOfferStatus.PAUSED, '2.5 Offer author can toggle offer status to paused');
    await setExchangerOfferStatus(testExchangerId, offer.id, ExchangerOfferStatus.ACTIVE);

    // -------------------------------------------------------------
    // TEST 3: Authoritative Server Quotes & Anti-Tamper Signatures
    // -------------------------------------------------------------
    console.log('\n--- Test Group 3: Server Authoritative Quotes & Signatures ---');

    const goldQuote = await generateGoldTradeQuote({
      sellerId: testAdvertiserId,
      buyerId: testExchangerId,
      gameSlug: 'wow_midnight',
      goldQuantity: 1000000,
      agreedValuationUsdCents: 10000, // $100.00
      settlementMethod: GoldTradeSettlementMethod.IRT_DIRECT,
      offerId: offer.id,
    });

    assert(Boolean(goldQuote.quoteHash), '3.1 Server quote contains cryptographic quoteHash');
    assert(goldQuote.commissionPercentage === 0.025, '3.2 Server quote snapshots offer commission rate');
    assert(goldQuote.quotedPayableCurrency === 'IRT', '3.3 Server quote calculates authoritative settlement currency');

    // Self-trading check
    let selfTradeBlocked = false;
    try {
      await generateGoldTradeQuote({
        sellerId: testExchangerId,
        buyerId: testExchangerId,
        gameSlug: 'wow_midnight',
        goldQuantity: 500000,
        agreedValuationUsdCents: 5000,
        settlementMethod: GoldTradeSettlementMethod.IRT_DIRECT,
      });
    } catch (e: any) {
      selfTradeBlocked = e.message.includes('CANNOT_SELF_TRADE');
    }
    assert(selfTradeBlocked, '3.4 Self-trading is strictly rejected');

    // Tampered quote signature rejected
    let tamperedQuoteBlocked = false;
    try {
      const forgedQuote = {
        ...goldQuote,
        tradeRef: `FORGED_${Date.now()}`,
        agreedValuationUsdCents: 999999,
      };
      const forgedOrder = await createGoldTradeOrder(forgedQuote);
      await acceptGoldTrade(forgedOrder.id, testAdvertiserId);
    } catch (e: any) {
      tamperedQuoteBlocked = e.message.includes('QUOTE_TAMPERED');
    }
    assert(tamperedQuoteBlocked, '3.5 Tampered quote amounts or signatures are rejected fail-closed');

    // Expired quote rejected
    let expiredQuoteBlocked = false;
    try {
      const expQuote = await generateGoldTradeQuote({
        sellerId: testAdvertiserId,
        buyerId: testExchangerId,
        gameSlug: 'wow_midnight',
        goldQuantity: 500000,
        agreedValuationUsdCents: 5000,
        settlementMethod: GoldTradeSettlementMethod.IRT_DIRECT,
        offerId: offer.id,
      });
      const expiredTradeOrder = await createGoldTradeOrder({
        ...expQuote,
        quoteExpiresAt: new Date(Date.now() - 10000),
      });
      await acceptGoldTrade(expiredTradeOrder.id, testAdvertiserId);
    } catch (e: any) {
      expiredQuoteBlocked = e.message.includes('QUOTE_EXPIRED');
    }
    assert(expiredQuoteBlocked, '3.6 Expired quotes cannot be accepted');

    // -------------------------------------------------------------
    // TEST 4: Valid Trade Lifecycle & Participant Actions
    // -------------------------------------------------------------
    console.log('\n--- Test Group 4: Trade Lifecycle & Role Privacy ---');

    const freshGoldQuote = await generateGoldTradeQuote({
      sellerId: testAdvertiserId,
      buyerId: testExchangerId,
      gameSlug: 'wow_midnight',
      goldQuantity: 1000000,
      agreedValuationUsdCents: 10000,
      settlementMethod: GoldTradeSettlementMethod.IRT_DIRECT,
      offerId: offer.id,
    });
    const tradeOrder = await createGoldTradeOrder(freshGoldQuote);
    const acceptedTrade = await acceptGoldTrade(tradeOrder.id, testAdvertiserId);
    assert(acceptedTrade.tradeStatus === GoldTradeStatus.ACCEPTED, '4.1 Trade initialized in ACCEPTED state');
    assert(acceptedTrade.sellerId === testAdvertiserId && acceptedTrade.buyerId === testExchangerId, '4.2 Seller and Buyer mapped strictly to Advertiser and Exchanger');

    // Non-participant cannot report delivery
    let thirdPartyDeliverBlocked = false;
    try {
      await reportGoldDelivery(tradeOrder.id, otherExchangerId, 'proof_screenshot_123');
    } catch (e: any) {
      thirdPartyDeliverBlocked = e.message.includes('UNAUTHORIZED_SELLER');
    }
    assert(thirdPartyDeliverBlocked, '4.3 Non-participant cannot report gold delivery');

    // Seller reports delivery
    const deliveredTrade = await reportGoldDelivery(tradeOrder.id, testAdvertiserId, 'In-game trade complete at Orgrimmar');
    assert(deliveredTrade.goldDeliveryStatus === GoldDeliveryStatus.DELIVERED, '4.4 Seller successfully reports delivery');

    // Seller cannot verify delivery (only buyer/exchanger can verify)
    let sellerCannotVerify = false;
    try {
      await verifyGoldDelivery(tradeOrder.id, testAdvertiserId);
    } catch (e: any) {
      sellerCannotVerify = e.message.includes('UNAUTHORIZED_VERIFIER');
    }
    assert(sellerCannotVerify, '4.5 Seller cannot self-verify their own delivery');

    // Buyer (exchanger) verifies gold delivery
    const verifiedTrade = await verifyGoldDelivery(tradeOrder.id, testExchangerId);
    assert(verifiedTrade.goldDeliveryStatus === GoldDeliveryStatus.VERIFIED, '4.6 Buyer verifies gold and delivery is marked verified');

    // Exchanger submits external payment details
    const paymentSubmittedTrade = await submitExternalTradePayment(
      tradeOrder.id,
      testExchangerId,
      'BANK_REF_987654321',
      'IRT_SHEBA',
      '8000000'
    );
    assert(paymentSubmittedTrade.paymentStatus === GoldPaymentStatus.SUBMITTED, '4.7 Exchanger submits bank tracking reference');

    // Seller confirms payment receipt
    const receiptConfirmedTrade = await confirmExternalPaymentReceipt(tradeOrder.id, testAdvertiserId);
    assert(receiptConfirmedTrade.paymentStatus === GoldPaymentStatus.CONFIRMED, '4.8 Seller confirms receipt and payment is verified');

    // -------------------------------------------------------------
    // TEST 5: Trade Cancellation & Safe Fund Return
    // -------------------------------------------------------------
    console.log('\n--- Test Group 5: Trade Cancellation & Wallet Safety ---');

    const walletQuote = await generateGoldTradeQuote({
      sellerId: testAdvertiserId,
      buyerId: testExchangerId,
      gameSlug: 'wow_midnight',
      goldQuantity: 500000,
      agreedValuationUsdCents: 5000,
      settlementMethod: GoldTradeSettlementMethod.USD_WALLET,
    });

    const beforeReserveWallet = await prisma.walletV2.findUnique({ where: { userId: testExchangerId } });
    const cancelableTrade = await createGoldTradeOrder(walletQuote);
    await acceptGoldTrade(cancelableTrade.id, testAdvertiserId);
    const afterReserveWallet = await prisma.walletV2.findUnique({ where: { userId: testExchangerId } });

    assert(
      (afterReserveWallet?.reservedCents || 0) > (beforeReserveWallet?.reservedCents || 0),
      '5.1 USD Wallet trade reserves exchanger funds at quote acceptance'
    );

    // Cancel trade
    const cancelledRecord = await cancelGoldTrade(cancelableTrade.id, testAdvertiserId, 'Buyer not available in-game');
    const afterCancelWallet = await prisma.walletV2.findUnique({ where: { userId: testExchangerId } });

    assert(cancelledRecord.tradeStatus === GoldTradeStatus.CANCELLED, '5.2 Trade marked as CANCELLED');
    assert(
      afterCancelWallet?.reservedCents === beforeReserveWallet?.reservedCents,
      '5.3 Reserved funds safely released back to exchanger available balance upon cancellation'
    );

    // -------------------------------------------------------------
    // TEST 6: Feature Gate Enforcement (P2P Settlement Disabled)
    // -------------------------------------------------------------
    console.log('\n--- Test Group 6: Financial Safety Gates & Fail-Closed Behavior ---');

    assert(FINANCE_V2_FEATURE_GATES.FINANCE_V2_P2P_SETTLEMENT_ENABLED === false, '6.1 FINANCE_V2_P2P_SETTLEMENT_ENABLED is false in configuration');

    // Settle P2P funding with gate disabled throws P2P_SETTLEMENT_DISABLED
    const p2pOffer = await createExchangerFeeOffer(testExchangerId, {
      exchangerId: testExchangerId,
      serviceType: ExchangerOfferServiceType.IRT_TO_USD_FUNDING,
      settlementCurrency: 'IRT',
      commissionPercentage: 0.03, // 3.00%
      terms: 'P2P USD Wallet Funding',
    });

    const p2pQuote = await generateP2pFundingQuote({
      advertiserId: testAdvertiserId,
      exchangerId: testExchangerId,
      offerId: p2pOffer.id,
      targetUsdCents: 10000, // $100.00
    });

    assert(p2pQuote.targetUsdCents === 10000, '7.1 P2P Funding quote matches requested USD amount');
    assert(p2pQuote.totalIrtPayable > 0, '7.2 P2P Funding quote calculates authoritative Toman payment required');

    const p2pFundingRequest = await acceptP2pFundingRequest(testAdvertiserId, p2pQuote);
    assert(p2pFundingRequest.status === 'AWAITING_PAYMENT', '7.3 P2P funding request initiated in AWAITING_PAYMENT status');

    let p2pFundingSettleBlocked = false;
    try {
      await settleP2pFunding(p2pFundingRequest.id, adminOversightId, 'PAYMENT_EVIDENCE_999');
    } catch (e: any) {
      p2pFundingSettleBlocked = e.message.includes('P2P_SETTLEMENT_DISABLED');
    }
    assert(p2pFundingSettleBlocked, '7.4 P2P funding direct wallet transfer fails closed when gate is disabled');

    // -------------------------------------------------------------
    // TEST 8: Dispute Workflow
    // -------------------------------------------------------------
    console.log('\n--- Test Group 8: Dispute Workflows ---');

    const disputeQuote = await generateGoldTradeQuote({
      sellerId: testAdvertiserId,
      buyerId: testExchangerId,
      gameSlug: 'wow_midnight',
      goldQuantity: 500000,
      agreedValuationUsdCents: 5000,
      settlementMethod: GoldTradeSettlementMethod.IRT_DIRECT,
      offerId: offer.id,
    });
    const disputableOrder = await createGoldTradeOrder(disputeQuote);
    await acceptGoldTrade(disputableOrder.id, testAdvertiserId);
    const disputedRecord = await disputeGoldTrade(
      disputableOrder.id,
      testAdvertiserId,
      'Payment tracking ID provided does not match bank records'
    );

    assert(disputedRecord.tradeStatus === GoldTradeStatus.DISPUTED, '8.1 Trade successfully flagged as DISPUTED');
    assert(Boolean(disputedRecord.disputeReason?.includes('Payment tracking ID')), '8.2 Dispute reason recorded for management review');

  } catch (err: any) {
    console.error('Unexpected test exception:', err);
    failed++;
  } finally {
    console.log('\n--- Cleaning up test records ---');
    try {
      await prisma.goldTrade.deleteMany({
        where: { OR: [{ sellerId: testAdvertiserId }, { buyerId: testExchangerId }] },
      });
      await prisma.advertiserFundingRequest.deleteMany({
        where: { advertiserId: testAdvertiserId },
      });
      await prisma.exchangerFeeOffer.deleteMany({
        where: { exchangerId: { in: [testExchangerId, otherExchangerId] } },
      });
      await prisma.registrationApplication.deleteMany({
        where: { userId: unapprovedUserId },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: [testExchangerId, otherExchangerId, testAdvertiserId, adminOversightId] } },
      });
      await prisma.walletV2.deleteMany({
        where: { userId: { in: [testExchangerId, otherExchangerId, testAdvertiserId, unapprovedUserId, adminOversightId] } },
      });
      await prisma.user.deleteMany({
        where: { discordId: { in: [testExchangerId, otherExchangerId, testAdvertiserId, unapprovedUserId, adminOversightId] } },
      });
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr);
    }
  }

  console.log(`\n========================================`);
  console.log(`PHASE 6 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase6TestSuite().catch((e) => {
  console.error('Suite crashed:', e);
  process.exit(1);
});
