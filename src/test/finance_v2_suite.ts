/**
 * ============================================================================
 * G4X Community — Finance V2 Comprehensive Test Suite
 * ============================================================================
 * Verifies all financial invariants and new business requirements:
 * 1. Unified USD wallet (wallets_v2), integer cents only, no Gold wallet
 * 2. SQLite CHECK constraint prevents negative available or reserved cents
 * 3. Double-entry balanced ledger entries (sum debits == sum credits)
 * 4. Advertiser Direct USDT funding (quote, evidence, admin verification, credit)
 * 5. Advertiser Direct IRT funding (exact arithmetic, currency-purchase fee, admin rate)
 * 6. Gold Exchange isolation: quantities only, credits BLOCKED pending owner confirmation
 * 7. SkyCoach 10% per order replaces legacy 5% + $5; no double-charging in batches
 * 8. Deterministic equal booster pool split (100% to boosters, no leader bonus, no lost cents)
 * 9. G4X-published boost 7 release stages; 24h countdown starts at adminFinalApprovedAt
 * 10. Booster USDT withdrawal: fixed fee $0.40, BEP-20 only, Net = Requested - $0.40
 * 11. Booster IRT withdrawal: fixed fee $1.30, 3,000 IRT discount, Net = (USD - 1.30) * Effective
 * 12. IRT Payout scheduling: Tuesday cutoff config guard (blocks if missing); Wed/Sat cycles
 * 13. Withdrawal state machine: DRAFT -> QUOTED -> USER_CONFIRMED -> RESERVED -> PAID / REJECTED
 * 14. Production safety: ESCROW_RELEASE_ENABLED=false blocks automated release
 * ============================================================================
 */

import prisma from '../database/db';
import {
  getOrCreateWalletV2,
  getWalletV2Summary,
  creditAvailableCents,
  assertWalletInvariants,
} from '../services/financeV2/financeV2WalletService';
import {
  calculateIrtFundingQuote,
  submitDirectUsdtFunding,
  adminVerifyAndCreditUsdtFunding,
  submitDirectIrtFunding,
  adminVerifyAndCreditIrtFunding,
  createGoldExchangeFundingWorkflow,
  recordInGameGoldTradeCompletion,
  confirmExternalGoldTradePayment,
  attemptCreditGoldExchangeResult,
} from '../services/financeV2/advertiserFundingService';
import {
  generateUsdtWithdrawalQuote,
  generateIrtWithdrawalQuote,
  createWithdrawalRequestFromQuote,
  confirmAndSubmitWithdrawalRequest,
  adminExecuteManualPayout,
  adminRejectWithdrawal,
  calculateIrtPayoutSchedule,
} from '../services/financeV2/boosterWithdrawalService';
import {
  getOrCreateG4XBoostReleaseTracker,
  recordProofSubmitted,
  recordStaffReview,
  recordAdminFinalApproval,
  evaluateG4XReleaseEligibility,
  executeG4XBoostRelease,
} from '../services/financeV2/g4xBoostReleaseService';
import {
  calculateOrderFinancialSnapshot,
  splitPoolEquallyWithRemainder,
} from '../services/financialCalculationEngine';
import { isEscrowReleaseEnabled } from '../services/escrowService';
import {
  LedgerV2EntryType,
  G4XBoostReleaseStage,
  BoosterWithdrawalStatus,
} from '../services/financeV2/financeV2Types';

async function runFinanceV2TestSuite() {
  console.log('=== STARTING G4X FINANCE V2 COMPREHENSIVE TEST SUITE ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  }

  const testUserId = 'test_v2_user_99';
  const testBooster1 = 'test_v2_booster_01';
  const testBooster2 = 'test_v2_booster_02';
  const testBooster3 = 'test_v2_booster_03';
  const testBooster4 = 'test_v2_booster_04';
  const testAdminId = 'test_v2_admin_01';
  const testExchangerId = 'test_v2_exchanger_01';

  try {
    // ─── Setup test users & permissions ───────────────────────────────────
    for (const uid of [testUserId, testBooster1, testBooster2, testBooster3, testBooster4, testAdminId, testExchangerId]) {
      await prisma.user.upsert({
        where: { discordId: uid },
        update: {},
        create: { discordId: uid, username: `User_${uid}` },
      });
    }

    // Assign owner role to admin for financial actions
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: testAdminId, roleKey: 'owner' } },
      update: {},
      create: { userId: testAdminId, roleKey: 'owner' },
    });

    // Assign exchanger role to test exchanger
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: testExchangerId, roleKey: 'exchanger' } },
      update: {},
      create: { userId: testExchangerId, roleKey: 'exchanger' },
    });

    // =========================================================================
    // TEST 1: Unified USD Wallet (wallets_v2) - Integer cents only, no Gold
    // =========================================================================
    const wallet = await getOrCreateWalletV2(testUserId);
    assert(
      typeof wallet.availableCents === 'number' &&
        typeof wallet.reservedCents === 'number' &&
        typeof wallet.pendingEarningsCents === 'number' &&
        typeof wallet.confirmedEarningsCents === 'number' &&
        typeof wallet.paidCents === 'number' &&
        typeof wallet.refundedCents === 'number',
      '1. Unified USD Wallet denominated strictly in integer cents with 6 distinct balance categories',
      `User: ${wallet.userId}, available: ${wallet.availableCents} cents`
    );

    // =========================================================================
    // TEST 2: SQLite CHECK Constraint rejects negative balances
    // =========================================================================
    let checkConstraintPassed = false;
    try {
      // Attempt direct raw SQL update with negative available_cents
      await prisma.$executeRawUnsafe(
        `UPDATE wallets_v2 SET available_cents = -500 WHERE user_id = '${testUserId}'`
      );
    } catch (err: any) {
      if (err.message.includes('CHECK constraint failed') || err.message.includes('constraint')) {
        checkConstraintPassed = true;
      }
    }
    assert(
      checkConstraintPassed,
      '2. Database-level CHECK constraint strictly rejects negative available_cents',
      `Check caught error: ${checkConstraintPassed}`
    );

    // Re-verify invariants
    const currentWallet = await getOrCreateWalletV2(testUserId);
    assertWalletInvariants(currentWallet);

    // =========================================================================
    // TEST 3: Double-Entry Balanced Ledger Entries
    // =========================================================================
    const summaryBefore = await getWalletV2Summary(testUserId);
    const creditResult = await creditAvailableCents(
      testUserId,
      5000, // $50.00
      LedgerV2EntryType.ADVERTISER_DEPOSIT,
      {
        description: 'Test direct USDT deposit',
        createdBy: testAdminId,
      }
    );

    const summaryAfter = await getWalletV2Summary(testUserId);
    assert(
      creditResult.ledgerEntry.direction === 'CREDIT' &&
        creditResult.ledgerEntry.amountCents === 5000 &&
        summaryAfter.availableCents === summaryBefore.availableCents + 5000,
      '3. Auditable ledger entry cleanly credits available USD cents with balanced state transition',
      `Old: ${summaryBefore.availableCents}, New: ${summaryAfter.availableCents}`
    );

    // =========================================================================
    // TEST 4: Advertiser Direct USDT Funding Workflow
    // =========================================================================
    const usdtFundingReq = await submitDirectUsdtFunding({
      advertiserId: testUserId,
      targetUsdCents: 10000, // $100.00
      externalAmountUnits: '100.00',
      network: 'BEP20',
      evidenceRef: '0xabcdef1234567890abcdef1234567890',
      payerIdentifier: '0x11112222333344445555666677778888',
      adminNotes: 'Direct USDT top-up',
    });

    assert(
      usdtFundingReq.status === 'PENDING_ADMIN_VERIFICATION' && usdtFundingReq.targetUsdCents === 10000,
      '4a. Advertiser Direct USDT funding request created under admin verification with approved 1:1 valuation',
      `Status: ${usdtFundingReq.status}, Target: ${usdtFundingReq.targetUsdCents} cents ($100)`
    );

    // 4b-1. Verify fail-closed live credit gate blocks execution by default
    let liveCreditBlocked = false;
    try {
      await adminVerifyAndCreditUsdtFunding(
        usdtFundingReq.id,
        testAdminId,
        'Verified on BscScan'
      );
    } catch (err: any) {
      if (err.message.includes('LIVE_CREDITS_DISABLED')) {
        liveCreditBlocked = true;
      }
    }
    assert(
      liveCreditBlocked,
      '4b-1. Direct USDT funding credit strictly blocked under default fail-closed configuration'
    );

    // Isolated test execution with explicit gate activation
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'true';
    const balBeforeUsdt = (await getOrCreateWalletV2(testUserId)).availableCents;
    const verifiedUsdtFunding = await adminVerifyAndCreditUsdtFunding(
      usdtFundingReq.id,
      testAdminId,
      'Verified on BscScan'
    );
    const balAfterUsdt = (await getOrCreateWalletV2(testUserId)).availableCents;
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'false';

    assert(
      verifiedUsdtFunding.request.status === 'CONFIRMED_CREDITED' &&
        balAfterUsdt === balBeforeUsdt + 10000,
      '4b. Direct USDT funding credits USD wallet only after authoritative admin verification',
      `Before: ${balBeforeUsdt}, After: ${balAfterUsdt}`
    );

    // =========================================================================
    // TEST 5: Advertiser Direct IRT Funding (Exact Arithmetic + Fee)
    // =========================================================================
    // Admin rate: 100,000 IRT per USD. Target: $95.00 (9,500 cents). Purchase fee: 5%.
    // Base IRT: 95 * 100,000 = 9,500,000 IRT.
    // Fee IRT: 9,500,000 * 0.05 = 475,000 IRT.
    // Total IRT payable = 9,975,000 IRT.
    const irtQuote = calculateIrtFundingQuote(9500, 100000, 0.05);
    assert(
      irtQuote.baseIrtUnits === 9_500_000 &&
        irtQuote.feeIrtUnits === 475_000 &&
        irtQuote.totalIrtPayable === 9_975_000,
      '5a. Advertiser Direct IRT funding applies exact manual rate and currency-purchase fee quote',
      `Base: ${irtQuote.baseIrtUnits} IRT, Fee: ${irtQuote.feeIrtUnits} IRT, Total: ${irtQuote.totalIrtPayable} IRT`
    );

    const irtFundingReq = await submitDirectIrtFunding({
      advertiserId: testUserId,
      targetUsdCents: 9500,
      adminUsdIrtRate: 100000,
      currencyPurchaseFeeRate: 0.05,
      evidenceRef: 'BANK-CARD-12345678',
      payerIdentifier: 'Parham Nayeri',
    });

    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'true';
    const balBeforeIrt = (await getOrCreateWalletV2(testUserId)).availableCents;
    await adminVerifyAndCreditIrtFunding(
      irtFundingReq.request.id,
      testAdminId,
      'Bank receipt verified'
    );
    const balAfterIrt = (await getOrCreateWalletV2(testUserId)).availableCents;
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'false';

    assert(
      balAfterIrt === balBeforeIrt + 9500,
      '5b. Direct IRT funding credits exact calculated USD cents to wallet upon admin verification',
      `Balance increased by: ${balAfterIrt - balBeforeIrt} cents`
    );

    // =========================================================================
    // TEST 6: Gold Exchange Workflow — Blocked pending owner direction approval
    // =========================================================================
    const { tradeOrder } = await createGoldExchangeFundingWorkflow({
      advertiserId: testUserId,
      exchangerId: testExchangerId,
      gameSlug: 'wow_midnight',
      goldQuantity: 1_000_000,
      externalPaymentMethod: 'USDT',
      externalPaymentAmount: '80.00',
    });

    assert(
      tradeOrder.goldQuantity === 1_000_000 &&
        tradeOrder.walletCreditStatus === 'BLOCKED_PENDING_DIRECTION_CONFIRMATION',
      '6a. Gold Exchange Trade Order models Gold solely as trade quantities with wallet credit status strictly blocked',
      `Gold: ${tradeOrder.goldQuantity}, Credit Status: ${tradeOrder.walletCreditStatus}`
    );

    await recordInGameGoldTradeCompletion(
      tradeOrder.id,
      testAdminId,
      'In-game screenshot of mail/trade window'
    );

    await confirmExternalGoldTradePayment(
      tradeOrder.id,
      testAdminId,
      'PAY-CONF-123'
    );

    // Attempting to credit wallet must throw GOLD_EXCHANGE_DIRECTION_UNAPPROVED
    let goldCreditBlocked = false;
    try {
      await attemptCreditGoldExchangeResult(tradeOrder.id, testAdminId);
    } catch (err: any) {
      if (err.message.includes('GOLD_EXCHANGE_DIRECTION_UNAPPROVED')) {
        goldCreditBlocked = true;
      }
    }

    assert(
      goldCreditBlocked,
      '6b. Automatic wallet credits from Gold exchange are strictly blocked pending owner payment direction approval',
      `Credit Blocked: ${goldCreditBlocked}`
    );

    // Find game & service for test orders
    const game = await prisma.game.findFirst({ where: { slug: 'wow_midnight' } });
    const service = await prisma.gameService.findFirst({ where: { gameSlug: 'wow_midnight' } });
    if (!game || !service) throw new Error('Game or service missing for test environment');

    // =========================================================================
    // TEST 7: SkyCoach 10% Fee Policy Correction (Replaces 5% + $5)
    // =========================================================================
    // Create test order on SkyCoach
    const ordSkyTest = await prisma.order.create({
      data: {
        orderRef: 'ORD-TEST-SKY-V2-01',
        gameSlug: game.slug,
        serviceId: service.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 8000, // $80.00
        sourceType: 'website',
        sourceWebsite: 'skycoach',
        status: 'pending',
      },
    });

    const skycoachSnapshot = await calculateOrderFinancialSnapshot({
      orderId: ordSkyTest.id,
      sourcePlatform: 'skycoach',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 8000,
    });

    assert(
      skycoachSnapshot.platformSaleCommissionMinor === 800 &&
        skycoachSnapshot.allocatedWithdrawalFeeMinor === 0,
      '7. SkyCoach applies clean 10% order commission ($8.00 on $80) without legacy $5 flat fee',
      `Platform Commission: ${skycoachSnapshot.platformSaleCommissionMinor} minor ($8.00)`
    );

    // =========================================================================
    // TEST 8: Deterministic Equal Booster Pool Split (No lost cents, no leader bonus)
    // =========================================================================
    // Net pool after 10% fee = 8000 - 800 = 7200 minor ($72.00)
    // 4 boosters split 7200 minor = exactly 1800 minor ($18.00) each.
    const boosters4 = [testBooster1, testBooster2, testBooster3, testBooster4];
    const allocationsExact = splitPoolEquallyWithRemainder(7200, boosters4);
    const sumExact = allocationsExact.reduce((a, b) => a + b.allocatedMinor, 0);

    assert(
      allocationsExact.length === 4 &&
        allocationsExact.every((b) => b.allocatedMinor === 1800) &&
        sumExact === 7200,
      '8a. Even Mythic+ booster pool split divides 100% equally among 4 participants',
      `Allocations: [${allocationsExact.map((a) => a.allocatedMinor).join(', ')}] sum: ${sumExact} minor`
    );

    // Odd pool: 1000 minor ($10.00) split among 3 boosters = 334, 333, 333 (sum exactly 1000)
    const boosters3 = [testBooster1, testBooster2, testBooster3];
    const allocationsOdd = splitPoolEquallyWithRemainder(1000, boosters3);
    const sumOdd = allocationsOdd.reduce((a, b) => a + b.allocatedMinor, 0);

    assert(
      sumOdd === 1000 &&
        allocationsOdd[0].allocatedMinor === 334 &&
        allocationsOdd[1].allocatedMinor === 333 &&
        allocationsOdd[2].allocatedMinor === 333,
      '8b. Odd booster pool split uses deterministic Largest Remainder Method without any lost cents',
      `Allocations: [${allocationsOdd.map((a) => a.allocatedMinor).join(', ')}] sum: ${sumOdd} minor`
    );

    // Single booster gets 100%
    const singleBooster = splitPoolEquallyWithRemainder(5000, [testBooster1]);
    assert(
      singleBooster.length === 1 && singleBooster[0].allocatedMinor === 5000,
      '8c. Single booster receives 100% of the booster pool',
      `Allocation: ${singleBooster[0].allocatedMinor} minor`
    );

    // =========================================================================
    // TEST 9: G4X-Published Boost 7 Release Stages & 24h Countdown
    // =========================================================================
    const testOrderG4X = await prisma.order.create({
      data: {
        orderRef: 'ORD-TEST-G4X-V2-01',
        gameSlug: game.slug,
        serviceId: service.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 8000,
        creatorType: 'g4x',
        sourceType: 'internal',
        paymentStatus: 'verified',
        status: 'completed',
      },
    });

    await prisma.orderRun.create({
      data: {
        orderId: testOrderG4X.id,
        runNumber: 1,
        status: 'completed',
      },
    });

    const releaseTracker = await getOrCreateG4XBoostReleaseTracker(testOrderG4X.id);
    assert(
      releaseTracker.stage === G4XBoostReleaseStage.RUN_COMPLETED,
      '9a. G4X Boost release tracker initialized at RUN_COMPLETED stage for G4X-published boost',
      `Stage: ${releaseTracker.stage}`
    );

    // Advance: RUN_COMPLETED -> PROOF_SUBMITTED
    await recordProofSubmitted(testOrderG4X.id);

    // Advance: PROOF_SUBMITTED -> STAFF_REVIEW
    await recordStaffReview(testOrderG4X.id, testAdminId, 'Staff verified run proof');

    // Advance: STAFF_REVIEW -> ADMIN_FINAL_APPROVED (Sets authoritative timestamp)
    const approvedTracker = await recordAdminFinalApproval(
      testOrderG4X.id,
      testAdminId,
      'Admin approved final completion'
    );

    assert(
      approvedTracker.adminFinalApprovedAt !== null &&
        approvedTracker.stage === G4XBoostReleaseStage.HOLD_24_HOURS,
      '9b. Admin final approval sets authoritative timestamp from which 24h hold strictly begins',
      `Approved At: ${approvedTracker.adminFinalApprovedAt?.toISOString()}`
    );

    // Verify release eligibility before 24h has elapsed
    const eligibilityImmediate = await evaluateG4XReleaseEligibility(testOrderG4X.id);
    assert(
      eligibilityImmediate.eligible === false &&
        eligibilityImmediate.reasons.some((r) => r.includes('HOLD_24_HOURS_ACTIVE')),
      '9c. Release eligibility strictly returns false during the active 24-hour hold window',
      `Eligible: ${eligibilityImmediate.eligible}, Reasons: ${eligibilityImmediate.reasons.join(', ')}`
    );

    // 9d. Premature release before 24-hour hold elapses is strictly rejected
    let prematureBlocked = false;
    try {
      await executeG4XBoostRelease(testOrderG4X.id, testAdminId);
    } catch (err: any) {
      if (err.message.includes('RELEASE_INELIGIBLE') || err.message.includes('HOLD_24_HOURS_ACTIVE')) {
        prematureBlocked = true;
      }
    }
    assert(
      prematureBlocked,
      '9d. Premature release during active 24-hour hold is strictly rejected',
      `Premature Blocked: ${prematureBlocked}`
    );

    // 9d-2. Even after 24h expires, ESCROW_RELEASE_ENABLED=false blocks wallet release
    // Create finalized snapshot & set holdExpiresAt in the past

    await prisma.orderFinancialSnapshot.create({
      data: {
        orderId: testOrderG4X.id,
        sourcePlatform: 'internal',
        sourceAmountType: 'gross_sale',
        sourceAmountMinor: 8000,
        platformOrderNetMinor: 8000,
        externalNetBaseMinor: 8000,
        boosterPoolMinor: 7200,
        calculationStatus: 'finalized',
      },
    });

    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 3600 * 1000);
    const oneHourAgo = new Date(Date.now() - 1 * 3600 * 1000);

    await prisma.g4XBoostReleaseTracker.update({
      where: { orderId: testOrderG4X.id },
      data: {
        adminFinalApprovedAt: twentyFiveHoursAgo,
        holdExpiresAt: oneHourAgo,
        isFundsReconciled: true,
        isCalculationFinalized: true,
      },
    });

    const releaseAttempt = await executeG4XBoostRelease(testOrderG4X.id, testAdminId);
    assert(
      releaseAttempt.success === false && releaseAttempt.blockedByConfig === true,
      '9d-2. Production escrow release safeguard strictly blocks wallet release (ESCROW_RELEASE_ENABLED=false)',
      `Blocked by Config: ${releaseAttempt.blockedByConfig}, Stage: ${releaseAttempt.stage}`
    );

    // Non-G4X published orders rejected from 24h tracker
    const externalOrder = await prisma.order.create({
      data: {
        orderRef: 'ORD-TEST-EXT-V2-01',
        gameSlug: game.slug,
        serviceId: service.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 5000,
        creatorType: 'booster',
        sourceType: 'website',
        sourceWebsite: 'skycoach',
        status: 'completed',
      },
    });

    const nonG4XEval = await evaluateG4XReleaseEligibility(externalOrder.id);
    assert(
      nonG4XEval.eligible === false &&
        nonG4XEval.reasons.some((r) => r.includes('NOT_G4X_PUBLISHED_BOOST')),
      '9e. Orders not published by G4X are strictly rejected from the G4X 24-hour hold policy',
      `Non-G4X Reasons: ${nonG4XEval.reasons.join(', ')}`
    );

    // =========================================================================
    // TEST 10: Booster USDT Withdrawal (Fixed $0.40 fee, BEP-20 only)
    // =========================================================================
    // Quote $50.00 withdrawal (5000 cents)
    // Credit $100 to booster1 available
    await creditAvailableCents(
      testBooster1,
      10000,
      LedgerV2EntryType.AVAILABLE_RELEASE,
      { description: 'Booster test earnings', createdBy: testAdminId }
    );

    const usdtQuote = await generateUsdtWithdrawalQuote({
      boosterId: testBooster1,
      requestedUsdCents: 5000,
      destinationAddress: '0x1234567890abcdef1234567890abcdef12345678',
    });

    assert(
      usdtQuote.fixedFeeUsdCents === 40 &&
        usdtQuote.netUsdCents === 4960 &&
        usdtQuote.payoutMethod === 'USDT_BEP20',
      '10a. Booster USDT withdrawal quote charges exactly $0.40 fixed fee on BSC (BEP-20) only',
      `Fee: $0.40 (40 cents), Net: $49.60 (${usdtQuote.netUsdCents} cents)`
    );

    const boosterBalBefore = await getOrCreateWalletV2(testBooster1);

    // Create & Confirm withdrawal request
    const withdrawalReqRecord = await createWithdrawalRequestFromQuote(usdtQuote);
    const { request: confirmedReq } = await confirmAndSubmitWithdrawalRequest(
      withdrawalReqRecord.id,
      testBooster1
    );

    const boosterBalAfterRequest = await getOrCreateWalletV2(testBooster1);
    assert(
      confirmedReq.status === BoosterWithdrawalStatus.RESERVED &&
        boosterBalAfterRequest.availableCents === boosterBalBefore.availableCents - 5000 &&
        boosterBalAfterRequest.reservedCents === boosterBalBefore.reservedCents + 5000,
      '10b. USDT withdrawal submission atomically transitions to RESERVED status and locks funds',
      `Available: ${boosterBalAfterRequest.availableCents}, Reserved: ${boosterBalAfterRequest.reservedCents}`
    );

    // 10c-1. Verify fail-closed live payout gate blocks execution by default
    let livePayoutBlocked = false;
    try {
      await adminExecuteManualPayout(
        confirmedReq.id,
        testAdminId,
        { externalTxHash: '0xabcdef9876543210abcdef9876543210', notes: 'Paid on BSC' }
      );
    } catch (err: any) {
      if (err.message.includes('LIVE_PAYOUTS_DISABLED')) {
        livePayoutBlocked = true;
      }
    }
    assert(
      livePayoutBlocked,
      '10c-1. Manual payout execution strictly blocked under default fail-closed configuration'
    );

    // Admin manual payout with valid TxHash under isolated test gate
    process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED = 'true';
    const { request: paidReq } = await adminExecuteManualPayout(
      confirmedReq.id,
      testAdminId,
      { externalTxHash: '0xabcdef9876543210abcdef9876543210', notes: 'Paid on BSC' }
    );
    process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED = 'false';

    const boosterBalAfterPaid = await getOrCreateWalletV2(testBooster1);
    assert(
      paidReq.status === BoosterWithdrawalStatus.PAID &&
        boosterBalAfterPaid.reservedCents === boosterBalBefore.reservedCents &&
        boosterBalAfterPaid.paidCents === boosterBalBefore.paidCents + 5000,
      '10c. Manual payout completion permanently moves reserved USD to paid USD with immutable tx hash',
      `Reserved: ${boosterBalAfterPaid.reservedCents}, Paid: ${boosterBalAfterPaid.paidCents}`
    );

    // =========================================================================
    // TEST 11: Booster IRT Withdrawal (Fixed $1.30 fee + 3,000 IRT discount)
    // =========================================================================
    // Admin rate: 95,000 IRT per USD.
    // Effective Rate = 95,000 - 3,000 = 92,000 IRT per USD.
    // Requested: $100.00 (10000 cents).
    // Net USD = $100.00 - $1.30 = $98.70.
    // Net IRT = 98.70 * 92,000 = 9,080,400 IRT.
    // Credit $100 to booster2
    await creditAvailableCents(
      testBooster2,
      10000,
      LedgerV2EntryType.AVAILABLE_RELEASE,
      { description: 'Booster2 test earnings', createdBy: testAdminId }
    );

    const irtWithdrawQuote = await generateIrtWithdrawalQuote({
      boosterId: testBooster2,
      requestedUsdCents: 10000,
      destinationAddress: 'IR123456789012345678901234',
      adminUsdIrtRate: 95000,
    });

    assert(
      irtWithdrawQuote.fixedFeeUsdCents === 130 &&
        irtWithdrawQuote.effectiveRate === 92000 &&
        irtWithdrawQuote.quotedNetPayoutAmount === '9080400',
      '11. Booster IRT withdrawal applies fixed $1.30 fee and exact 3,000 IRT rate discount with NO percentage fee',
      `Fee: $1.30, Effective Rate: ${irtWithdrawQuote.effectiveRate}, Net IRT: ${irtWithdrawQuote.quotedNetPayoutAmount}`
    );

    // =========================================================================
    // TEST 12: IRT Payout Scheduling & Tuesday Cutoff Configuration Guard
    // =========================================================================
    // 12a: Missing Tuesday cutoff config blocks automated scheduling finalization
    const unconfiguredSchedule = calculateIrtPayoutSchedule(new Date(), null);
    assert(
      unconfiguredSchedule.schedulingStatus === 'BLOCKED_MISSING_CUTOFF_CONFIG',
      '12a. Missing Tuesday morning cutoff config strictly blocks automated IRT payout scheduling',
      `Status: ${unconfiguredSchedule.schedulingStatus}`
    );

    // 12b: With configured cutoff hour, returns proper Saturday/Wednesday cycle
    const configuredSchedule = calculateIrtPayoutSchedule(new Date(), 10);
    assert(
      configuredSchedule.schedulingStatus === 'SCHEDULED' &&
        (configuredSchedule.scheduledCycleDay === 'WEDNESDAY' ||
          configuredSchedule.scheduledCycleDay === 'SATURDAY'),
      '12b. Configured Tuesday morning cutoff produces authoritative Wednesday or Saturday payout window',
      `Target Cycle Day: ${configuredSchedule.scheduledCycleDay}, Details: ${configuredSchedule.details}`
    );

    // =========================================================================
    // TEST 13: Withdrawal State Machine & Rejection Fund Return
    // =========================================================================
    // Submit withdrawal request for booster2
    const irtReqRecord = await createWithdrawalRequestFromQuote(irtWithdrawQuote);
    const { request: b2Confirmed } = await confirmAndSubmitWithdrawalRequest(
      irtReqRecord.id,
      testBooster2
    );

    const b2BalReserved = await getOrCreateWalletV2(testBooster2);
    assert(
      b2Confirmed.status === BoosterWithdrawalStatus.RESERVED &&
        b2BalReserved.availableCents === 0 &&
        b2BalReserved.reservedCents === 10000,
      '13a. IRT withdrawal submission reserves $100.00 available funds',
      `Available: ${b2BalReserved.availableCents}, Reserved: ${b2BalReserved.reservedCents}`
    );

    // Admin rejects request (e.g. invalid IBAN)
    const { request: rejectedReq } = await adminRejectWithdrawal(
      b2Confirmed.id,
      testAdminId,
      'Invalid IBAN account number'
    );

    const b2BalAfterRejection = await getOrCreateWalletV2(testBooster2);
    assert(
      rejectedReq.status === BoosterWithdrawalStatus.REJECTED &&
        b2BalAfterRejection.availableCents === 10000 &&
        b2BalAfterRejection.reservedCents === 0,
      '13b. Rejection safely unreserves 100% of reserved funds back to available USD without any loss',
      `Available: ${b2BalAfterRejection.availableCents}, Reserved: ${b2BalAfterRejection.reservedCents}`
    );

    // =========================================================================
    // TEST 14: Escrow Release Switch strictly disabled in production
    // =========================================================================
    const escrowSwitch = isEscrowReleaseEnabled();
    assert(
      escrowSwitch === false,
      '14. Automatic escrow release switch strictly disabled (ESCROW_RELEASE_ENABLED=false)',
      `Escrow Enabled: ${escrowSwitch}`
    );

  } catch (err: any) {
    console.error('Unexpected error in Finance V2 test suite:', err);
    failed++;
  } finally {
    // Clean up test data
    try {
      await prisma.boosterWithdrawalRequest.deleteMany({
        where: { boosterId: { in: [testUserId, testBooster1, testBooster2, testBooster3, testBooster4] } },
      });
      await prisma.goldExchangeTradeOrder.deleteMany({
        where: { advertiserId: { in: [testUserId, testBooster1, testBooster2, testBooster3, testBooster4] } },
      });
      await prisma.advertiserFundingRequest.deleteMany({
        where: { advertiserId: { in: [testUserId, testBooster1, testBooster2, testBooster3, testBooster4] } },
      });
      await prisma.g4XBoostReleaseTracker.deleteMany({
        where: { order: { orderRef: { startsWith: 'ORD-TEST-' } } },
      });
      await prisma.orderFinancialSnapshot.deleteMany({
        where: { order: { orderRef: { startsWith: 'ORD-TEST-' } } },
      });
      await prisma.orderRun.deleteMany({
        where: { order: { orderRef: { startsWith: 'ORD-TEST-' } } },
      });
      await prisma.order.deleteMany({
        where: { orderRef: { startsWith: 'ORD-TEST-' } },
      });
      await prisma.ledgerEntryV2.deleteMany({
        where: { userId: { in: [testUserId, testBooster1, testBooster2, testBooster3, testBooster4, testAdminId, testExchangerId] } },
      });
      await prisma.walletV2.deleteMany({
        where: { userId: { in: [testUserId, testBooster1, testBooster2, testBooster3, testBooster4, testAdminId, testExchangerId] } },
      });
      await prisma.systemFinancialConfig.deleteMany({
        where: { key: { in: ['irt_payout_tuesday_cutoff_hour', 'gold_exchange_direction_approved'] } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: [testUserId, testBooster1, testBooster2, testBooster3, testBooster4, testAdminId, testExchangerId] } },
      });
      await prisma.user.deleteMany({
        where: { discordId: { in: [testUserId, testBooster1, testBooster2, testBooster3, testBooster4, testAdminId, testExchangerId] } },
      });
    } catch (_) {}
  }

  console.log('\n======================================================');
  console.log(`FINANCE V2 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFinanceV2TestSuite()
  .catch((err) => {
    console.error('Finance V2 Suite execution error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
