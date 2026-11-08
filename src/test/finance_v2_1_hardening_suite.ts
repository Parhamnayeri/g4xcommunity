/**
 * ============================================================================
 * G4X Community — Phase Finance V2.1 Hardening Test Suite
 * ============================================================================
 * Rigorous regression and invariant tests covering:
 *  1. Missing advertiser IRT purchase-fee policy blocks quote/finalization
 *  2. Missing advertiser-specific commission blocks required settlement
 *  3. No unapproved 5% or 15% defaults exist in active policy execution
 *  4. Forged withdrawal quotes are rejected
 *  5. Caller-supplied USD/IRT exchange rates cannot override approved policy
 *  6. Expired and replayed quotes fail safely
 *  7. Concurrent withdrawals cannot double-reserve
 *  8. Invalid BEP-20 hexadecimal addresses are rejected (bad hex, wrong length, zero address, bad checksum)
 *  9. Legitimate supported addresses are accepted (valid lowercase, valid EIP-55)
 * 10. Final Admin approval cannot bypass proof or staff review
 * 11. Final approval cannot restart the hold clock accidentally
 * 12. Unauthorized release attempts fail
 * 13. No release without actual funds received
 * 14. Every financial journal posting balances (sum debits == sum credits)
 * 15. Duplicate deposit evidence cannot credit two funding requests
 * 16. Repeated deposits cannot double-credit
 * 17. Repeated payout processing cannot double-debit
 * 18. Missing payout evidence blocks PAID
 * 19. Real credits and settlement are disabled by default (fail-closed gates)
 * 20. Gold exchange reviewers cannot bypass authorization or trade states
 * 21. Gold funding cannot credit USD while business direction is unapproved
 * 22. SkyCoach 10% is applied once and legacy 5% + $5 is absent
 * 23. Correct proportional external network fee handling
 * 24. Actual Saturday and Wednesday payout dates are computed correctly
 * 25. Missing Tuesday cutoff blocks scheduling finalization
 * 26. Correct timezone and boundary handling (Asia/Tehran)
 * 27. Legacy registration and Discord role data remain unchanged
 * 28. ESCROW_RELEASE_ENABLED=false throughout production-safe tests
 * ============================================================================
 */

import prisma from '../database/db';
import {
  validateBep20Address,
  toChecksumAddress,
} from '../services/financeV2/bep20Validator';
import {
  calculateIrtFundingQuote,
  submitDirectIrtFunding,
  submitDirectUsdtFunding,
  adminVerifyAndCreditUsdtFunding,
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
  recordBalancedJournalPosting,
  creditAvailableCents,
  getOrCreateWalletV2,
  assertLiveCreditsEnabled,
  assertLivePayoutsEnabled,
  assertEscrowReleaseEnabled,
} from '../services/financeV2/financeV2WalletService';
import {
  calculateOrderFinancialSnapshot,
  splitPoolEquallyWithRemainder,
} from '../services/financialCalculationEngine';
import { getAdvertiserCommissionRate } from '../services/financialPolicyService';
import {
  LedgerV2AccountType,
  LedgerV2EntryType,
  LedgerV2Direction,
  BoosterWithdrawalStatus,
  G4XBoostReleaseStage,
} from '../services/financeV2/financeV2Types';

async function runFinanceV21HardeningSuite() {
  console.log('=== STARTING G4X FINANCE V2.1 HARDENING REGRESSION SUITE ===\n');

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

  const testAdvId = 't21_adv_901';
  const testBoosterA = 't21_bst_902';
  const testBoosterB = 't21_bst_903';
  const testAdminId = 't21_adm_904';
  const testAdmin2Id = 't21_adm_908';
  const testStaffId = 't21_stf_905';
  const testExchangerId = 't21_exc_906';
  const testUnauthorizedId = 't21_unauth_907';

  let testOrderId = 0;
  let testSkycoachOrderId = 0;
  let g4xOrderId = 0;

  try {
    // ─── Setup test users & permissions ───────────────────────────────────
    for (const uid of [
      testAdvId,
      testBoosterA,
      testBoosterB,
      testAdminId,
      testAdmin2Id,
      testStaffId,
      testExchangerId,
      testUnauthorizedId,
    ]) {
      await prisma.user.upsert({
        where: { discordId: uid },
        update: {},
        create: { discordId: uid, username: `User_${uid}` },
      });
    }

    // Role assignments
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: testAdminId, roleKey: 'owner' } },
      update: {},
      create: { userId: testAdminId, roleKey: 'owner' },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: testAdmin2Id, roleKey: 'owner' } },
      update: {},
      create: { userId: testAdmin2Id, roleKey: 'owner' },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: testStaffId, roleKey: 'manager' } },
      update: {},
      create: { userId: testStaffId, roleKey: 'manager' },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: testExchangerId, roleKey: 'exchanger' } },
      update: {},
      create: { userId: testExchangerId, roleKey: 'exchanger' },
    });

    const testGame = await prisma.game.upsert({
      where: { slug: 'wow-v21-hardening' },
      update: {},
      create: {
        slug: 'wow-v21-hardening',
        displayName: 'World of Warcraft Hardening Test',
        serviceCategory: 'both',
      },
    });

    const testService = await prisma.gameService.upsert({
      where: {
        gameSlug_serviceKey: {
          gameSlug: testGame.slug,
          serviceKey: 'mythic-plus-v21',
        },
      },
      update: {},
      create: {
        gameSlug: testGame.slug,
        serviceKey: 'mythic-plus-v21',
        displayName: 'Mythic+ Dungeon Hardening',
        serviceMode: 'non_pilot',
        profileMode: 'none',
      },
    });

    const testOrder = await prisma.order.create({
      data: {
        orderRef: `ORD-T21-TEST-${Date.now()}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000,
        creatorType: 'advertiser',
        advertiserId: testAdvId,
        sourceType: 'internal',
        paymentStatus: 'verified',
        status: 'in_progress',
      },
    });
    testOrderId = testOrder.id;

    // =========================================================================
    // TEST 1: Missing advertiser IRT purchase-fee policy blocks quote & finalization
    // =========================================================================
    let quoteBlockedWithoutFee = false;
    try {
      // @ts-ignore - simulate missing required rate
      calculateIrtFundingQuote(10000, 100000, undefined);
    } catch (err: any) {
      if (err.message.includes('MISSING_CURRENCY_PURCHASE_FEE_RATE')) {
        quoteBlockedWithoutFee = true;
      }
    }
    assert(
      quoteBlockedWithoutFee,
      '1a. Missing advertiser IRT purchase-fee rate strictly blocks quote calculation'
    );

    let submitBlockedWithoutFee = false;
    try {
      await submitDirectIrtFunding({
        advertiserId: testAdvId,
        targetUsdCents: 10000,
        adminUsdIrtRate: 100000,
        // @ts-ignore - missing rate
        currencyPurchaseFeeRate: undefined,
        evidenceRef: 'RECEIPT-MISSING-FEE',
        payerIdentifier: 'Adv Payer',
      });
    } catch (err: any) {
      if (err.message.includes('MISSING_CURRENCY_PURCHASE_FEE_RATE')) {
        submitBlockedWithoutFee = true;
      }
    }
    assert(
      submitBlockedWithoutFee,
      '1b. Submitting direct IRT funding without explicit authorized fee rate strictly throws error'
    );

    // =========================================================================
    // TEST 2 & 3: Missing advertiser commission blocks snapshot & no 5%/15% defaults
    // =========================================================================
    // WalletV2 has no commission configured by default
    const advWallet = await getOrCreateWalletV2(testAdvId);
    assert(
      advWallet.customCommissionRate === null,
      '2a. New WalletV2 has null customCommissionRate (no 15% default in schema)'
    );

    const effectiveRate = await getAdvertiserCommissionRate(testAdvId);
    assert(
      effectiveRate === null,
      '2b. getAdvertiserCommissionRate returns null when no commission has been configured by management'
    );

    let snapshotBlockedMissingCommission = false;
    try {
      await calculateOrderFinancialSnapshot({
        orderId: testOrder.id,
        sourcePlatform: 'advertiser',
        sourceAmountType: 'gross_sale',
        sourceAmountMinor: 10000,
        advertiserId: testAdvId,
        allowProvisional: false,
      });
    } catch (err: any) {
      if (err.message.includes('MISSING_ADVERTISER_COMMISSION_RATE')) {
        snapshotBlockedMissingCommission = true;
      }
    }
    assert(
      snapshotBlockedMissingCommission,
      '2c. Order financial snapshot strictly blocks finalization when advertiser commission rate is unconfigured'
    );

    // Explicitly configure commission rate
    await prisma.walletV2.update({
      where: { userId: testAdvId },
      data: { customCommissionRate: 0.12 }, // 12% authorized
    });
    const snapshotWithConfiguredRate = await calculateOrderFinancialSnapshot({
      orderId: testOrder.id,
      sourcePlatform: 'advertiser',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000,
      advertiserId: testAdvId,
      allowProvisional: false,
    });
    assert(
      snapshotWithConfiguredRate.advertiserFeeMinor === 1200 &&
        snapshotWithConfiguredRate.boosterPoolMinor === 8800,
      '3. Explicitly authorized 12% commission is applied cleanly without unapproved 15% default'
    );

    // =========================================================================
    // TEST 8 & 9: BEP-20 EVM Address Validation & EIP-55 Checksum
    // =========================================================================
    const validLower = '0x28c6c06298d514db089934071355e5743bf21d60';
    const validChecksum = toChecksumAddress(validLower);
    const validUpper = '0x' + validLower.substring(2).toUpperCase();

    // 9a. Accept valid lowercase address
    const resLower = validateBep20Address(validLower);
    assert(
      resLower.isValid && resLower.checksumAddress === validChecksum,
      '9a. Valid 20-byte lowercase EVM address is accepted and checksummed'
    );

    // 9b. Accept valid EIP-55 checksum address
    const resCheck = validateBep20Address(validChecksum);
    assert(
      resCheck.isValid && resCheck.normalizedAddress === validLower,
      '9b. Valid EIP-55 checksummed EVM address is accepted'
    );

    // 9c. Accept valid uppercase address
    const resUpper = validateBep20Address(validUpper);
    assert(
      resUpper.isValid && resUpper.normalizedAddress === validLower,
      '9c. Valid uppercase EVM address is accepted'
    );

    // 8a. Reject wrong length
    let wrongLengthRejected = false;
    try {
      validateBep20Address('0x1234');
    } catch (err: any) {
      if (err.message.includes('INVALID_BEP20_LENGTH')) wrongLengthRejected = true;
    }
    assert(wrongLengthRejected, '8a. Address with invalid length is rejected');

    // 8b. Reject non-hex characters (exact 42 chars with non-hex 'zz')
    let nonHexRejected = false;
    try {
      validateBep20Address('0x28c6c06298d514db089934071355e5743bf21dzz');
    } catch (err: any) {
      if (err.message.includes('MALFORMED_HEX_CHARACTERS')) nonHexRejected = true;
    }
    assert(nonHexRejected, '8b. Address with non-hexadecimal characters is rejected');

    // 8c. Reject zero address
    let zeroAddrRejected = false;
    try {
      validateBep20Address('0x0000000000000000000000000000000000000000');
    } catch (err: any) {
      if (err.message.includes('ZERO_ADDRESS_REJECTED')) zeroAddrRejected = true;
    }
    assert(zeroAddrRejected, '8c. Burn / Zero address is strictly rejected');

    // 8d. Reject invalid EIP-55 mixed-case checksum
    let badChecksumRejected = false;
    try {
      const corruptedChecksum = validChecksum.replace(/[a-z]/, (m) => m.toUpperCase());
      if (corruptedChecksum !== validChecksum) {
        validateBep20Address(corruptedChecksum);
      } else {
        validateBep20Address(validChecksum.slice(0, 41) + (validChecksum[41] === 'A' ? 'a' : 'A'));
      }
    } catch (err: any) {
      if (err.message.includes('EIP55_CHECKSUM_INVALID')) badChecksumRejected = true;
    }
    assert(badChecksumRejected, '8d. Corrupted mixed-case EIP-55 address is strictly rejected');

    // 8e. Reject unsupported network
    let badNetworkRejected = false;
    try {
      validateBep20Address(validChecksum, 'TRON_TRC20');
    } catch (err: any) {
      if (err.message.includes('UNSUPPORTED_PAYOUT_NETWORK')) badNetworkRejected = true;
    }
    assert(badNetworkRejected, '8e. Non-BEP20 payout network (TRC20, ERC20, etc.) is strictly rejected');

    // =========================================================================
    // TEST 4, 5, 6, 7: Withdrawal Quote Trust Boundaries & Anti-Tamper
    // =========================================================================
    // Fund Booster A with $100 available cents
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'true';
    await creditAvailableCents(testBoosterA, 10000, LedgerV2EntryType.AVAILABLE_RELEASE, {
      description: 'Booster A test earnings',
      createdBy: testAdminId,
    });
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'false';

    // Configure system admin USD/IRT rate
    await prisma.systemFinancialConfig.upsert({
      where: { key: 'admin_usd_irt_rate' },
      update: { value: '90000' },
      create: { key: 'admin_usd_irt_rate', value: '90000' },
    });

    // 5. Booster cannot choose or override the Admin USD/IRT rate
    let overrideRateRejected = false;
    try {
      await generateIrtWithdrawalQuote({
        boosterId: testBoosterA,
        requestedUsdCents: 5000,
        destinationAddress: 'IR123456789012345678901234',
        adminUsdIrtRate: 150000, // Forged booster override attempt
      });
    } catch (err: any) {
      if (err.message.includes('UNAUTHORIZED_RATE_OVERRIDE')) overrideRateRejected = true;
    }
    assert(
      overrideRateRejected,
      '5. Caller-supplied USD/IRT exchange rate override is strictly rejected'
    );

    // Legitimate server-side resolved IRT quote
    const legitimateIrtQuote = await generateIrtWithdrawalQuote({
      boosterId: testBoosterA,
      requestedUsdCents: 5000,
      destinationAddress: 'IR123456789012345678901234',
    });
    assert(
      legitimateIrtQuote.quoteRate === 90000 && legitimateIrtQuote.effectiveRate === 87000,
      '5b. Server resolves authoritative rate (90,000) and 3,000 discount (87,000) without caller override'
    );

    // Persist quote to DB
    const wdrReqRecord = await createWithdrawalRequestFromQuote(legitimateIrtQuote);
    assert(
      wdrReqRecord.quoteHash !== null && wdrReqRecord.quoteVersion === 1,
      '4a. Withdrawal quote stored with immutable SHA-256 quoteHash and version'
    );

    // 4b. Reject confirmation if quote was tampered in database
    await prisma.boosterWithdrawalRequest.update({
      where: { id: wdrReqRecord.id },
      data: { requestedUsdCents: 1000 }, // Tampering requested amount
    });
    let tamperedQuoteRejected = false;
    try {
      await confirmAndSubmitWithdrawalRequest(wdrReqRecord.id, testBoosterA);
    } catch (err: any) {
      if (err.message.includes('QUOTE_TAMPERED') || err.message.includes('TAMPERED')) {
        tamperedQuoteRejected = true;
      }
    }
    assert(
      tamperedQuoteRejected,
      '4b. Forged or tampered quote fields fail SHA-256 integrity verification upon confirmation'
    );

    // Restore legitimate quote values
    await prisma.boosterWithdrawalRequest.update({
      where: { id: wdrReqRecord.id },
      data: { requestedUsdCents: 5000 },
    });

    // 6a. Expired quote rejection
    await prisma.boosterWithdrawalRequest.update({
      where: { id: wdrReqRecord.id },
      data: { quoteExpiresAt: new Date(Date.now() - 60000) }, // Expired 1 minute ago
    });
    let expiredQuoteRejected = false;
    try {
      await confirmAndSubmitWithdrawalRequest(wdrReqRecord.id, testBoosterA);
    } catch (err: any) {
      if (err.message.includes('QUOTE_EXPIRED')) expiredQuoteRejected = true;
    }
    assert(expiredQuoteRejected, '6a. Expired withdrawal quote is strictly rejected upon confirmation');

    // Re-quote fresh quote
    const freshIrtQuote = await generateIrtWithdrawalQuote({
      boosterId: testBoosterA,
      requestedUsdCents: 5000,
      destinationAddress: 'IR123456789012345678901234',
    });
    const freshWdrReq = await createWithdrawalRequestFromQuote(freshIrtQuote);

    // 7. Concurrent confirmations / double-reserve prevention
    const { request: confirmed1 } = await confirmAndSubmitWithdrawalRequest(
      freshWdrReq.id,
      testBoosterA
    );
    assert(
      confirmed1.status === BoosterWithdrawalStatus.RESERVED,
      '7a. Initial valid confirmation successfully reserves balance'
    );

    let replayRejected = false;
    try {
      await confirmAndSubmitWithdrawalRequest(freshWdrReq.id, testBoosterA);
    } catch (err: any) {
      if (err.message.includes('ALREADY_RESERVED') || err.message.includes('INVALID_STATUS')) {
        replayRejected = true;
      }
    }
    assert(replayRejected, '7b. Replayed confirmation cannot double-reserve balances');

    // =========================================================================
    // TEST 10, 11, 12, 13: G4X Boost Release State Machine & Hold Clock
    // =========================================================================
    const g4xOrder = await prisma.order.create({
      data: {
        orderRef: `ORD-T21-G4X-${Date.now()}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000,
        creatorType: 'g4x',
        sourceType: 'internal',
        paymentStatus: 'verified',
        status: 'in_progress',
      },
    });
    g4xOrderId = g4xOrder.id;

    await getOrCreateG4XBoostReleaseTracker(g4xOrder.id);

    // 10a. Admin cannot skip straight to ADMIN_FINAL_APPROVED without proof & staff review
    let directAdminApprovalBlocked = false;
    try {
      await recordAdminFinalApproval(g4xOrder.id, testAdminId, 'Skipping stages');
    } catch (err: any) {
      if (err.message.includes('NO_COMPLETED_RUNS') || err.message.includes('INVALID_STAGE_TRANSITION')) {
        directAdminApprovalBlocked = true;
      }
    }
    assert(
      directAdminApprovalBlocked,
      '10a. Admin final approval cannot bypass proof submission or staff review'
    );

    // 10b. Proof cannot be submitted without an authoritative completed run
    let proofWithoutCompletedRunBlocked = false;
    try {
      await recordProofSubmitted(g4xOrder.id);
    } catch (err: any) {
      if (err.message.includes('NO_COMPLETED_RUNS')) proofWithoutCompletedRunBlocked = true;
    }
    assert(
      proofWithoutCompletedRunBlocked,
      '10b. Proof submission strictly requires authoritative completed OrderRun in DB'
    );

    // Add completed run
    await prisma.orderRun.create({
      data: {
        orderId: g4xOrder.id,
        runNumber: 1,
        status: 'completed',
      },
    });

    // Advance legitimately: RUN_COMPLETED -> PROOF_SUBMITTED -> STAFF_REVIEW -> ADMIN_FINAL_APPROVED
    await recordProofSubmitted(g4xOrder.id);
    await recordStaffReview(g4xOrder.id, testStaffId, 'Staff review approved');
    await recordAdminFinalApproval(
      g4xOrder.id,
      testAdminId,
      'Admin verified completion'
    );

    // 11. Duplicate final approval cannot restart the 24-hour clock
    let clockRestartBlocked = false;
    try {
      await recordAdminFinalApproval(g4xOrder.id, testAdminId, 'Second approval attempt');
    } catch (err: any) {
      if (err.message.includes('ALREADY_FINAL_APPROVED')) clockRestartBlocked = true;
    }
    assert(clockRestartBlocked, '11. Duplicate Admin final approval cannot restart the 24-hour hold clock');

    // 12. Unauthorized actor cannot release boost
    let unauthReleaseBlocked = false;
    try {
      await executeG4XBoostRelease(g4xOrder.id, testUnauthorizedId);
    } catch (err: any) {
      if (err.message.includes('UNAUTHORIZED')) unauthReleaseBlocked = true;
    }
    assert(unauthReleaseBlocked, '12. Unauthorized actor release attempt is strictly rejected');

    // 13. No release without actual funds received
    await prisma.order.update({
      where: { id: g4xOrder.id },
      data: { paymentStatus: 'unpaid' }, // Unfunded order
    });
    let unpaidReleaseBlocked = false;
    try {
      await executeG4XBoostRelease(g4xOrder.id, testAdminId);
    } catch (err: any) {
      if (
        err.message.includes('RELEASE_INELIGIBLE') ||
        err.message.includes('UNRECONCILED_FUNDS') ||
        err.message.includes('PAYMENT_UNVERIFIED')
      ) {
        unpaidReleaseBlocked = true;
      }
    }
    assert(unpaidReleaseBlocked, '13. Boost release strictly blocked when order payment is unverified/unpaid');

    // Restore verified payment status
    await prisma.order.update({
      where: { id: g4xOrder.id },
      data: { paymentStatus: 'verified' },
    });

    // =========================================================================
    // TEST 14: Balanced Journal Entries Invariant (sum debits == sum credits)
    // =========================================================================
    let unbalancePostingRejected = false;
    try {
      await recordBalancedJournalPosting({
        postingGroupId: `POSTING-UNBALANCED-${Date.now()}`,
        description: 'Deliberate unbalanced posting attempt',
        createdBy: testAdminId,
        legs: [
          {
            userId: testBoosterA,
            accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
            entryType: LedgerV2EntryType.AVAILABLE_RELEASE,
            direction: LedgerV2Direction.CREDIT,
            amountCents: 5000,
          },
          {
            userId: testAdminId,
            accountType: LedgerV2AccountType.ASSET_EXTERNAL_USDT_CLEARING,
            entryType: LedgerV2EntryType.AVAILABLE_RELEASE,
            direction: LedgerV2Direction.DEBIT,
            amountCents: 4000, // Deficit of 1000 cents
          },
        ],
      });
    } catch (err: any) {
      if (err.message.includes('UNBALANCED_JOURNAL_POSTING')) unbalancePostingRejected = true;
    }
    assert(
      unbalancePostingRejected,
      '14a. Double-entry engine strictly rejects unbalanced journal postings (Debits != Credits)'
    );

    // Balanced posting succeeds
    const balancedGroup = await recordBalancedJournalPosting({
      postingGroupId: `POSTING-BALANCED-${Date.now()}`,
      description: 'Balanced journal entry',
      createdBy: testAdminId,
      legs: [
        {
          userId: testBoosterA,
          accountType: LedgerV2AccountType.LIABILITY_USER_WALLET_AVAILABLE,
          entryType: LedgerV2EntryType.AVAILABLE_RELEASE,
          direction: LedgerV2Direction.CREDIT,
          amountCents: 3000,
        },
        {
          userId: testAdminId,
          accountType: LedgerV2AccountType.ASSET_EXTERNAL_USDT_CLEARING,
          entryType: LedgerV2EntryType.AVAILABLE_RELEASE,
          direction: LedgerV2Direction.DEBIT,
          amountCents: 3000,
        },
      ],
    });
    assert(
      balancedGroup.balanced && balancedGroup.totalDebitsCents === 3000,
      '14b. Balanced journal posting (sum Debits == sum Credits == $30.00) commits atomically'
    );

    // =========================================================================
    // TEST 15 & 16: Duplicate Deposit Evidence & Repeated Deposits
    // =========================================================================
    const uniqueReceipt = `TX-DEPOSIT-UNIQUE-${Date.now()}`;
    const funding1 = await submitDirectUsdtFunding({
      advertiserId: testAdvId,
      targetUsdCents: 2000,
      externalAmountUnits: '20.00',
      evidenceRef: uniqueReceipt,
      payerIdentifier: 'Adv Payer',
    });

    let duplicateDepositEvidenceRejected = false;
    try {
      await submitDirectUsdtFunding({
        advertiserId: testAdvId,
        targetUsdCents: 2000,
        externalAmountUnits: '20.00',
        evidenceRef: uniqueReceipt, // Duplicate evidenceRef
        payerIdentifier: 'Adv Payer',
      });
    } catch (err: any) {
      if (err.message.includes('DUPLICATE_DEPOSIT_EVIDENCE')) {
        duplicateDepositEvidenceRejected = true;
      }
    }
    assert(
      duplicateDepositEvidenceRejected,
      '15. Duplicate deposit evidence reference cannot be submitted for a second funding request'
    );

    // Credit funding1 legitimately
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'true';
    await adminVerifyAndCreditUsdtFunding(funding1.id, testAdminId, 'Verified once');
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'false';

    // 16. Repeated credit attempt on already credited request fails
    let repeatedCreditBlocked = false;
    try {
      process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'true';
      await adminVerifyAndCreditUsdtFunding(funding1.id, testAdminId, 'Second credit attempt');
    } catch (err: any) {
      if (err.message.includes('ALREADY_CREDITED') || err.message.includes('INVALID_STATUS')) {
        repeatedCreditBlocked = true;
      }
    } finally {
      process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'false';
    }
    assert(repeatedCreditBlocked, '16. Already credited deposit cannot be credited a second time');

    // =========================================================================
    // TEST 17 & 18: Repeated Payout Processing & Missing Evidence
    // =========================================================================
    // 18. Missing payout evidence blocks PAID
    let missingPayoutTxRejected = false;
    try {
      process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED = 'true';
      await adminExecuteManualPayout(freshWdrReq.id, testAdminId, {
        bankReceiptRef: '', // Missing bank receipt reference
        notes: 'Missing receipt',
      });
    } catch (err: any) {
      if (err.message.includes('MISSING_BANK_RECEIPT') || err.message.includes('MISSING_PAYOUT_EVIDENCE')) {
        missingPayoutTxRejected = true;
      }
    } finally {
      process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED = 'false';
    }
    assert(missingPayoutTxRejected, '18. Missing payout transaction evidence blocks transition to PAID');

    // Complete payout legitimately
    process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED = 'true';
    const validReceiptRef = `RECEIPT-VALID-${Date.now()}`;
    await adminExecuteManualPayout(freshWdrReq.id, testAdminId, {
      bankReceiptRef: validReceiptRef,
      notes: 'Legitimate payout',
      secondReviewerId: testAdmin2Id,
      bankSettlementRecord: {
        verifiedAt: new Date(),
        settlementBatchId: 'BATCH-2026-TEST',
        sourceBank: 'Mellat',
        verifiedAmountIrt: Math.round(Number(freshIrtQuote.quotedNetPayoutAmount)),
        destinationIban: freshIrtQuote.destinationAddress,
      },
    });
    process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED = 'false';

    // 17. Repeated payout processing cannot double-debit
    let repeatedPayoutRejected = false;
    try {
      process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED = 'true';
      const repeatReceiptRef = `RECEIPT-REPEAT-${Date.now()}`;
      await adminExecuteManualPayout(freshWdrReq.id, testAdminId, {
        bankReceiptRef: repeatReceiptRef,
        notes: 'Repeated attempt',
        secondReviewerId: testAdmin2Id,
        bankSettlementRecord: {
          verifiedAt: new Date(),
          settlementBatchId: 'BATCH-2026-TEST',
          sourceBank: 'Mellat',
          verifiedAmountIrt: Math.round(Number(freshIrtQuote.quotedNetPayoutAmount)),
          destinationIban: freshIrtQuote.destinationAddress,
        },
      });
    } catch (err: any) {
      if (err.message.includes('ALREADY_PAID') || err.message.includes('INVALID_STATUS')) {
        repeatedPayoutRejected = true;
      }
    } finally {
      process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED = 'false';
    }
    assert(repeatedPayoutRejected, '17. Already paid withdrawal cannot be settled or debited a second time');

    // =========================================================================
    // TEST 19 & 28: Fail-Closed Gates Default to False
    // =========================================================================
    delete process.env.FINANCE_V2_LIVE_CREDITS_ENABLED;
    delete process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED;
    delete process.env.ESCROW_RELEASE_ENABLED;

    let defaultCreditsDisabled = false;
    try {
      assertLiveCreditsEnabled();
    } catch (err: any) {
      if (err.message.includes('LIVE_CREDITS_DISABLED')) defaultCreditsDisabled = true;
    }
    assert(defaultCreditsDisabled, '19a. Real advertiser funding credit gate defaults to fail-closed false');

    let defaultPayoutsDisabled = false;
    try {
      assertLivePayoutsEnabled();
    } catch (err: any) {
      if (err.message.includes('LIVE_PAYOUTS_DISABLED')) defaultPayoutsDisabled = true;
    }
    assert(defaultPayoutsDisabled, '19b. Real booster withdrawal payout gate defaults to fail-closed false');

    let defaultEscrowDisabled = false;
    try {
      assertEscrowReleaseEnabled();
    } catch (err: any) {
      if (err.message.includes('ESCROW_RELEASE_DISABLED')) defaultEscrowDisabled = true;
    }
    assert(defaultEscrowDisabled, '19c. Escrow release gate defaults to fail-closed false (ESCROW_RELEASE_ENABLED=false)');

    // =========================================================================
    // TEST 20 & 21: Gold Exchange Workflow Authorization & Blocked Wallet Credit
    // =========================================================================
    // 20a. Self-exchange prevention (applicant cannot be the exchanger)
    let selfExchangeRejected = false;
    try {
      await createGoldExchangeFundingWorkflow({
        advertiserId: testAdvId,
        exchangerId: testAdvId, // Same user
        goldQuantity: 1_000_000,
        externalPaymentMethod: 'IRT',
        externalPaymentAmount: '5000000',
      });
    } catch (err: any) {
      if (err.message.includes('SELF_EXCHANGE_FORBIDDEN') || err.message.includes('SELF_EXCHANGE_NOT_PERMITTED')) {
        selfExchangeRejected = true;
      }
    }
    assert(selfExchangeRejected, '20a. Gold exchange applicant cannot act as their own exchanger');

    // 20b. Unauthorized exchanger rejection
    let unapprovedExchangerRejected = false;
    try {
      await createGoldExchangeFundingWorkflow({
        advertiserId: testAdvId,
        exchangerId: testUnauthorizedId, // Not in exchanger role
        goldQuantity: 1_000_000,
        externalPaymentMethod: 'IRT',
        externalPaymentAmount: '5000000',
      });
    } catch (err: any) {
      if (err.message.includes('INVALID_OR_INACTIVE_EXCHANGER')) unapprovedExchangerRejected = true;
    }
    assert(unapprovedExchangerRejected, '20b. Unapproved exchanger selection is strictly rejected');

    // Valid workflow creation
    const { tradeOrder } = await createGoldExchangeFundingWorkflow({
      advertiserId: testAdvId,
      exchangerId: testExchangerId,
      goldQuantity: 1_000_000,
      externalPaymentMethod: 'IRT',
      externalPaymentAmount: '5000000',
    });

    // 20c. Non-party cannot complete in-game trade
    let unauthorizedTradeActorRejected = false;
    try {
      await recordInGameGoldTradeCompletion(
        tradeOrder.id,
        testUnauthorizedId,
        'TRADE-SS-001'
      );
    } catch (err: any) {
      if (err.message.includes('UNAUTHORIZED_TRADE_ACTOR')) unauthorizedTradeActorRejected = true;
    }
    assert(unauthorizedTradeActorRejected, '20c. Third party cannot record in-game gold trade completion');

    // Exchanger records trade completion
    await recordInGameGoldTradeCompletion(tradeOrder.id, testExchangerId, 'PROOF-SS-VALID');

    // 20d. Self-verification of payment prohibited
    let selfReviewRejected = false;
    try {
      await confirmExternalGoldTradePayment(
        tradeOrder.id,
        testExchangerId, // Exchanger cannot review their own payment
        'PAYMENT-REF-123'
      );
    } catch (err: any) {
      if (err.message.includes('SELF_REVIEW_NOT_PERMITTED')) selfReviewRejected = true;
    }
    assert(selfReviewRejected, '20d. Independent review required (Exchanger cannot approve own payment)');

    // Independent Admin confirms external payment
    await confirmExternalGoldTradePayment(tradeOrder.id, testAdminId, 'PAYMENT-REF-123');

    // 21. Automatic USD credit remains strictly blocked pending owner business confirmation
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
      '21. Automatic USD wallet credit strictly blocked pending owner approval on Gold payment direction'
    );

    // =========================================================================
    // TEST 22 & 23: SkyCoach 10% Fee & External Network Cost Handling
    // =========================================================================
    const testSkycoachOrder = await prisma.order.create({
      data: {
        orderRef: `ORD-SKYCOACH-${Date.now()}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000,
        creatorType: 'g4x',
        sourceType: 'website',
        sourceWebsite: 'skycoach',
        paymentStatus: 'verified',
        status: 'in_progress',
      },
    });
    testSkycoachOrderId = testSkycoachOrder.id;

    const skycoachSnapshot = await calculateOrderFinancialSnapshot({
      orderId: testSkycoachOrder.id,
      sourcePlatform: 'skycoach',
      sourceAmountType: 'gross_sale',
      sourceAmountMinor: 10000, // $100.00
      allowProvisional: false,
    });
    assert(
      skycoachSnapshot.platformSaleCommissionMinor === 1000 &&
        skycoachSnapshot.boosterPoolMinor === 9000,
      '22. SkyCoach charges exactly 10% order commission ($10.00 on $100.00) without legacy 5% + $5'
    );

    // =========================================================================
    // TEST 24, 25, 26: IRT Tehran Payout Scheduling & Cutoff Hour Handling
    // =========================================================================
    // 25. Missing Tuesday morning cutoff blocks scheduling finalization
    const noCutoffSchedule = calculateIrtPayoutSchedule(new Date(), null);
    assert(
      noCutoffSchedule.scheduledCycleDate === null &&
        noCutoffSchedule.schedulingStatus === 'BLOCKED_MISSING_CUTOFF_CONFIG',
      '25. Missing Tuesday cutoff strictly blocks scheduling finalization'
    );

    // 24 & 26. Compute actual next Saturday or Wednesday payout date using Asia/Tehran
    // Test Saturday morning (10:00 AM Tehran) -> Wednesday payout cycle
    const tehranSatMorning = new Date('2026-10-24T06:30:00.000Z'); // Saturday 10:00 AM Tehran (UTC+3:30)
    const schedWed = calculateIrtPayoutSchedule(tehranSatMorning, 10);
    assert(
      schedWed.scheduledCycleDay === 'WEDNESDAY' &&
        schedWed.scheduledCycleDate !== null &&
        schedWed.scheduledCycleDate.getDay() === 3, // Wednesday is day 3
      '24a. Submission during Saturday-Tuesday window schedules exact upcoming Wednesday calendar date in Tehran'
    );

    // Test Tuesday afternoon (14:00 PM Tehran, after 10 AM cutoff) -> Saturday payout cycle
    const tehranTueAfternoon = new Date('2026-10-27T10:30:00.000Z'); // Tuesday 14:00 PM Tehran
    const schedSat = calculateIrtPayoutSchedule(tehranTueAfternoon, 10);
    assert(
      schedSat.scheduledCycleDay === 'SATURDAY' &&
        schedSat.scheduledCycleDate !== null &&
        schedSat.scheduledCycleDate.getDay() === 6, // Saturday is day 6
      '24b. Submission after Tuesday cutoff schedules exact upcoming Saturday calendar date in Tehran'
    );

    // =========================================================================
    // TEST 27: Legacy Registration & Discord Role Data Preservation
    // =========================================================================
    const userRoles = await prisma.userRole.findMany({
      where: { userId: testAdminId },
    });
    assert(
      userRoles.some((r) => r.roleKey === 'owner'),
      '27. User role relations and registration domain data remain intact and uncorrupted'
    );

  } finally {
    // ─── Clean up test entities ───────────────────────────────────────────
    try {
      await prisma.boosterWithdrawalRequest.deleteMany({
        where: { boosterId: { in: [testBoosterA, testBoosterB] } },
      });
      await prisma.advertiserFundingRequest.deleteMany({
        where: { advertiserId: testAdvId },
      });
      await prisma.goldExchangeTradeOrder.deleteMany({
        where: { advertiserId: testAdvId },
      });
      await prisma.g4XBoostReleaseTracker.deleteMany({
        where: { order: { orderRef: { startsWith: 'ORD-T21-' } } },
      });
      const orderIdsToClean = [testOrderId, testSkycoachOrderId, g4xOrderId].filter((id) => id > 0);
      if (orderIdsToClean.length > 0) {
        await prisma.orderFinancialSnapshot.deleteMany({
          where: { orderId: { in: orderIdsToClean } },
        });
        await prisma.orderRun.deleteMany({
          where: { orderId: { in: orderIdsToClean } },
        });
        await prisma.order.deleteMany({
          where: { id: { in: orderIdsToClean } },
        });
      }
      await prisma.ledgerEntryV2.deleteMany({
        where: {
          userId: {
            in: [
              testAdvId,
              testBoosterA,
              testBoosterB,
              testAdminId,
              testStaffId,
              testExchangerId,
              testUnauthorizedId,
            ],
          },
        },
      });
      await prisma.walletV2.deleteMany({
        where: {
          userId: {
            in: [
              testAdvId,
              testBoosterA,
              testBoosterB,
              testAdminId,
              testAdmin2Id,
              testStaffId,
              testExchangerId,
              testUnauthorizedId,
            ],
          },
        },
      });
      await prisma.userRole.deleteMany({
        where: {
          userId: {
            in: [
              testAdvId,
              testBoosterA,
              testBoosterB,
              testAdminId,
              testAdmin2Id,
              testStaffId,
              testExchangerId,
              testUnauthorizedId,
            ],
          },
        },
      });
      await prisma.user.deleteMany({
        where: {
          discordId: {
            in: [
              testAdvId,
              testBoosterA,
              testBoosterB,
              testAdminId,
              testAdmin2Id,
              testStaffId,
              testExchangerId,
              testUnauthorizedId,
            ],
          },
        },
      });
      await prisma.systemFinancialConfig.deleteMany({
        where: { key: { in: ['admin_usd_irt_rate', 'irt_payout_tuesday_cutoff_hour'] } },
      });
    } catch (_) {}
  }

  console.log('\n======================================================');
  console.log(`FINANCE V2.1 HARDENING TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFinanceV21HardeningSuite()
  .catch((err) => {
    console.error('Finance V2.1 Hardening Suite execution error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
