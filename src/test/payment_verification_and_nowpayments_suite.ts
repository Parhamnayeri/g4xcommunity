/**
 * ============================================================================
 * G4X Community — Payment Verification & NOWPayments Integration Test Suite
 * ============================================================================
 * Exhaustive regression and invariant test suite covering:
 *  1. Manual IRT Payments:
 *     - Missing USD/IRT exchange rate blocks quote calculation
 *     - Missing incoming_irt_fee_rate policy blocks quote calculation
 *     - Quote calculation applies management rate & fee without booster discount or fake fees
 *     - Zero / negative target amounts rejected
 *     - Required tracking number validation
 *     - Required IRT paid amount validation
 *     - Sender card last 4 digits validation (exactly 4 numeric digits)
 *     - Expired quote rejection on evidence submission
 *     - Duplicate tracking number rejection across receipts and attempts
 *     - Ambiguous duplicate tracking numbers routed to manual_review
 *     - Unauthorized admin approval rejection (FINANCE_ADJUST required)
 *     - Rejection requires explicit reason (>= 5 chars)
 *     - Verification without evidence rejection
 *     - Approval against expired quote rejection
 *     - Actual received amount mismatch rejection
 *     - Legitimate admin approval issues single-use receipt and fulfills business action
 *  2. NOWPayments Payments API & Integration:
 *     - Payment creation blocked when feature flag is disabled
 *     - Sandbox mode configuration and URL selection
 *     - Pluggable mock client implementation
 *     - Below-minimum payment rejection
 *     - Unsupported currency rejection
 *     - Fixed-rate payment creation and unexpired attempt reuse
 *  3. NOWPayments Webhook IPN Verification & Security:
 *     - Recursive key sorting canonicalization
 *     - Valid HMAC-SHA512 signature verification
 *     - Invalid signature rejection and audit logging
 *     - Out-of-order IPN protection (finished attempt cannot be downgraded)
 *     - Replayed IPN idempotency
 *     - Intermediate statuses (confirming, confirmed, sending) do not verify order
 *     - Authoritative finished IPN verifies order and issues receipt
 *     - Underpayment (partially_paid) routed to manual review
 *     - Wrong-asset deposit routed to manual review
 *     - Re-deposit (parent_payment_id present) routed to manual review
 *     - Refunded status routed to manual review
 *  4. Financial Reconciliation & Receipt Safety:
 *     - Single-use invariant: Attempting double consumption throws RECEIPT_ALREADY_CONSUMED
 *     - Wallet top-up receipt cannot be applied to an order
 *     - Order payment receipt cannot be applied to a wallet top-up
 *     - Direct order verification without receipt is strictly blocked
 * ============================================================================
 */

import crypto from 'crypto';
import prisma from '../database/db';
import {
  PaymentMethod,
  PaymentProvider,
  PaymentRequestStatus,
  PaymentAttemptStatus,
  PaymentReceiptStatus,
  PaymentBusinessType,
  getNowpaymentsConfig,
} from '../services/payment/paymentTypes';
import {
  calculateIncomingIrtQuote,
  getOfficialReceivingBankDetails,
  createIrtPaymentAttempt,
  submitIrtPaymentEvidence,
  adminReviewIrtPayment,
} from '../services/payment/irtPaymentService';
import {
  NowpaymentsClient,
  setCustomNowpaymentsClient,
} from '../services/payment/nowpaymentsClient';
import {
  sortObject,
  verifyNowPaymentsSignature,
  handleNowPaymentsIpn,
} from '../services/payment/nowpaymentsWebhook';
import {
  getOrCreatePaymentRequestForOrder,
  getOrCreatePaymentRequestForFunding,
  createNowpaymentsPaymentAttempt,
  consumePaymentReceipt,
  verifyOrderWithReceipt,
} from '../services/payment/paymentReconciliationService';

// ─── Test Runner Harness ───────────────────────────────────────────────────

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

// ─── Mock NOWPayments Client ───────────────────────────────────────────────

class MockNowpaymentsClient extends NowpaymentsClient {
  public mockStatusResponse = { message: 'OK' };
  public mockCurrencies = ['btc', 'usdttrc20', 'usdtbsc', 'eth', 'ltc'];
  public mockMinAmount = 10; // $10 USD minimum
  public mockEstimatePrice = 0.00025; // BTC price
  public mockPaymentIdCounter = Date.now();

  constructor() {
    super('https://api.sandbox.nowpayments.io/v1', 'mock_api_key_test_123');
  }

  async getStatus(): Promise<{ message: string }> {
    return this.mockStatusResponse;
  }

  async getAvailableCurrencies(fixedRate: boolean = true): Promise<string[]> {
    return this.mockCurrencies;
  }

  async getMinimumAmount(payCurrency: string, currencyFrom: string = 'usd'): Promise<any> {
    return {
      currency_from: currencyFrom,
      currency_to: payCurrency,
      min_amount: this.mockMinAmount,
      fiat_equivalent: this.mockMinAmount,
    };
  }

  async getEstimatedPrice(amount: number, currencyTo: string, currencyFrom: string = 'usd'): Promise<any> {
    return {
      currency_from: currencyFrom,
      amount_from: amount,
      currency_to: currencyTo,
      estimated_amount: this.mockEstimatePrice,
    };
  }

  async createPayment(params: any): Promise<any> {
    this.mockPaymentIdCounter++;
    return {
      payment_id: String(this.mockPaymentIdCounter),
      payment_status: 'waiting',
      pay_address: `0xMockDepositAddress_${this.mockPaymentIdCounter}`,
      price_amount: params.priceAmount,
      price_currency: params.priceCurrency || 'usd',
      pay_amount: 0.0005,
      pay_currency: params.payCurrency,
      order_id: params.orderId,
      order_description: params.orderDescription,
      purchase_id: `mock_purchase_${this.mockPaymentIdCounter}`,
      network: 'bsc',
      valid_until: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    };
  }

  async getPaymentStatus(paymentId: string): Promise<any> {
    return {
      payment_id: paymentId,
      payment_status: 'finished',
      price_amount: 50,
      price_currency: 'usd',
      pay_amount: 0.0005,
      actually_paid: 0.0005,
      pay_currency: 'usdtbsc',
      outcome_amount: 49.5,
      outcome_currency: 'usdt',
    };
  }
}

// ─── Main Test Suite Execution ─────────────────────────────────────────────

async function runPaymentSuite() {
  console.log('=== STARTING G4X PAYMENT VERIFICATION & NOWPAYMENTS INTEGRATION SUITE ===\n');

  // Test User IDs
  const testAdminId = 'tp_adm_01';
  const testUnauthorizedId = 'tp_user_unauth_02';
  const testAdvId = 'tp_adv_03';

  let testOrderId1 = 0;
  let testOrderId2 = 0;
  let testFundingId = 0;

  try {
    // ─── 0. Seed Test Users, Roles, Games, Services and Financial Config ─
    for (const uid of [testAdminId, testUnauthorizedId, testAdvId]) {
      await prisma.user.upsert({
        where: { discordId: uid },
        update: {},
        create: {
          discordId: uid,
          username: `TestUser_${uid}`,
        },
      });
    }

    // Assign owner role to testAdminId (owner role provides full financial permissions)
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: testAdminId, roleKey: 'owner' } },
      update: {},
      create: { userId: testAdminId, roleKey: 'owner' },
    });

    const testGame = await prisma.game.upsert({
      where: { slug: 'wow' },
      update: {},
      create: {
        slug: 'wow',
        displayName: 'World of Warcraft',
        serviceCategory: 'both',
      },
    });

    const testService = await prisma.gameService.upsert({
      where: {
        gameSlug_serviceKey: {
          gameSlug: testGame.slug,
          serviceKey: 'mythic-plus-test',
        },
      },
      update: {},
      create: {
        gameSlug: testGame.slug,
        serviceKey: 'mythic-plus-test',
        displayName: 'Mythic+ Dungeon Test',
        serviceMode: 'non_pilot',
        profileMode: 'none',
      },
    });

    // Ensure exchange rate & incoming fee rate exist in system config
    await prisma.systemFinancialConfig.upsert({
      where: { key: 'admin_usd_irt_rate' },
      update: { value: '95000' },
      create: { key: 'admin_usd_irt_rate', value: '95000', description: 'Authoritative USD to IRT rate' },
    });

    await prisma.systemFinancialConfig.upsert({
      where: { key: 'incoming_irt_fee_rate' },
      update: { value: '0.015' }, // 1.5% fee
      create: { key: 'incoming_irt_fee_rate', value: '0.015', description: 'Incoming IRT deposit fee rate' },
    });

    // Seed test orders and funding requests
    const order1 = await prisma.order.create({
      data: {
        orderRef: `ORD_PAY_T1_${Date.now()}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000, // $100.00
        advertiserId: testAdvId,
        paymentStatus: 'pending',
        status: 'payment_pending',
      },
    });
    testOrderId1 = order1.id;

    const order2 = await prisma.order.create({
      data: {
        orderRef: `ORD_PAY_T2_${Date.now()}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 5000, // $50.00
        advertiserId: testAdvId,
        paymentStatus: 'pending',
        status: 'payment_pending',
      },
    });
    testOrderId2 = order2.id;

    const funding1 = await prisma.advertiserFundingRequest.create({
      data: {
        fundingRef: `FND_PAY_T1_${Date.now()}`,
        advertiserId: testAdvId,
        fundingMethod: 'IRT',
        externalCurrency: 'IRT',
        externalAmountUnits: '5000000',
        targetUsdCents: 5000, // $50
        status: 'AWAITING_PAYMENT',
      },
    });
    testFundingId = funding1.id;

    // ────────────────────────────────────────────────────────────────────────
    // GROUP 1: MANUAL IRT PAYMENTS & POLICIES
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- Group 1: Manual IRT Quotes & Evidence Validation ---');

    // 1.1 Missing USD/IRT exchange rate blocks quote
    await prisma.systemFinancialConfig.update({
      where: { key: 'admin_usd_irt_rate' },
      data: { value: '' },
    });
    try {
      await calculateIncomingIrtQuote(10000);
      assert(false, '1.1 Missing USD/IRT exchange rate blocks quote');
    } catch (e: any) {
      assert(e.message.includes('MISSING_EXCHANGE_RATE'), '1.1 Missing USD/IRT exchange rate blocks quote', e.message);
    }
    // Restore exchange rate
    await prisma.systemFinancialConfig.update({
      where: { key: 'admin_usd_irt_rate' },
      data: { value: '95000' },
    });

    // 1.2 Missing incoming_irt_fee_rate blocks quote
    await prisma.systemFinancialConfig.deleteMany({
      where: { key: 'incoming_irt_fee_rate' },
    });
    try {
      await calculateIncomingIrtQuote(10000);
      assert(false, '1.2 Missing incoming_irt_fee_rate policy blocks quote');
    } catch (e: any) {
      assert(
        e.message.includes('MISSING_INCOMING_IRT_FEE_POLICY'),
        '1.2 Missing incoming_irt_fee_rate policy blocks quote',
        e.message
      );
    }
    // Restore fee rate
    await prisma.systemFinancialConfig.create({
      data: { key: 'incoming_irt_fee_rate', value: '0.015', description: 'Incoming IRT deposit fee rate' },
    });

    // 1.3 Quote calculation applies management rate & fee without booster discount or fake fees
    const quote = await calculateIncomingIrtQuote(10000); // $100.00
    // $100 * 95,000 = 9,500,000 IRT. Fee: 1.5% = 142,500 IRT. Total: 9,642,500 IRT.
    assert(
      quote.adminUsdIrtRate === 95000 &&
      quote.baseIrtAmount === 9500000 &&
      quote.feeIrtAmount === 142500 &&
      quote.totalIrtAmount === 9642500,
      '1.3 Quote calculation accurately applies management rate and fee without unapproved discounts/fees',
      `Calculated: ${quote.totalIrtAmount}`
    );

    // 1.4 Invalid target amount (0 or negative) rejected
    try {
      await calculateIncomingIrtQuote(0);
      assert(false, '1.4 Zero target USD amount rejected');
    } catch (e: any) {
      assert(e.message.includes('INVALID_TARGET_AMOUNT'), '1.4 Zero target USD amount rejected');
    }

    // 1.5 Official bank details presentation returns clean official bank info
    const bankDetails = await getOfficialReceivingBankDetails();
    assert(
      typeof bankDetails.bankName === 'string' && bankDetails.cardNumber.length >= 16,
      '1.5 Official receiving bank details returned with card and bank information'
    );

    // 1.6 Create IRT payment attempt for Order 1
    const pReqOrder1 = await getOrCreatePaymentRequestForOrder(testOrderId1, testAdvId);
    const irtAttemptRes1 = await createIrtPaymentAttempt(pReqOrder1.id, testAdvId);
    const irtAttemptOrder1 = irtAttemptRes1.attempt;
    assert(
      irtAttemptOrder1.method === PaymentMethod.CARD_TO_CARD_IRT &&
      irtAttemptOrder1.status === PaymentAttemptStatus.WAITING,
      '1.6 Created IRT PaymentAttempt in WAITING status'
    );

    // 1.7 Missing tracking number is rejected
    try {
      await submitIrtPaymentEvidence({
        attemptRef: irtAttemptOrder1.attemptRef,
        trackingNumber: '',
        paidAmountIrt: Number(irtAttemptOrder1.expectedAmount),
        senderCardLast4: '1234',
        actorId: testAdvId,
      });
      assert(false, '1.7 Missing tracking number rejected');
    } catch (e: any) {
      assert(e.message.includes('INVALID_TRACKING_NUMBER'), '1.7 Missing tracking number rejected', e.message);
    }

    // 1.8 Invalid paid amount in IRT rejected
    try {
      await submitIrtPaymentEvidence({
        attemptRef: irtAttemptOrder1.attemptRef,
        trackingNumber: 'TRK_TEST_001',
        paidAmountIrt: -500,
        senderCardLast4: '1234',
        actorId: testAdvId,
      });
      assert(false, '1.8 Negative paid amount rejected');
    } catch (e: any) {
      assert(e.message.includes('INVALID_PAID_AMOUNT'), '1.8 Negative paid amount rejected');
    }

    // 1.9 Sender card last 4 digits validation (3 digits, 5 digits, non-digits rejected)
    for (const badSuffix of ['123', '12345', '12a4', 'abcd', '']) {
      try {
        await submitIrtPaymentEvidence({
          attemptRef: irtAttemptOrder1.attemptRef,
          trackingNumber: 'TRK_TEST_001',
          paidAmountIrt: Number(irtAttemptOrder1.expectedAmount),
          senderCardLast4: badSuffix,
          actorId: testAdvId,
        });
        assert(false, `1.9 Bad card suffix '${badSuffix}' should be rejected`);
      } catch (e: any) {
        assert(e.message.includes('INVALID_SENDER_CARD_LAST4'), `1.9 Bad card suffix '${badSuffix}' rejected`);
      }
    }

    // 1.10 Expired quote rejection on evidence submission
    await prisma.paymentAttempt.update({
      where: { id: irtAttemptOrder1.id },
      data: { quoteExpiresAt: new Date(Date.now() - 60000) }, // 1 min in past
    });
    try {
      await submitIrtPaymentEvidence({
        attemptRef: irtAttemptOrder1.attemptRef,
        trackingNumber: 'TRK_TEST_001',
        paidAmountIrt: Number(irtAttemptOrder1.expectedAmount),
        senderCardLast4: '5678',
        actorId: testAdvId,
      });
      assert(false, '1.10 Expired quote on evidence submission should be rejected');
    } catch (e: any) {
      assert(e.message.includes('EXPIRED_QUOTE'), '1.10 Expired quote on evidence submission rejected');
    }

    // Refresh quote expiry to continue testing
    await prisma.paymentAttempt.update({
      where: { id: irtAttemptOrder1.id },
      data: {
        quoteExpiresAt: new Date(Date.now() + 600000),
        status: PaymentAttemptStatus.WAITING,
      },
    });

    // 1.11 Ambiguous duplicate tracking number routes to manual_review
    // Seed another pending attempt with same tracking number
    const mockTrkAmbiguous = `TRK_AMBIGUOUS_${Date.now()}`;
    await prisma.paymentAttempt.create({
      data: {
        attemptRef: `ATT_PENDING_MOCK_${Date.now()}`,
        paymentRequestId: pReqOrder1.id,
        method: PaymentMethod.CARD_TO_CARD_IRT,
        provider: PaymentProvider.MANUAL_BANK,
        status: PaymentAttemptStatus.PENDING,
        trackingNumber: mockTrkAmbiguous,
        expectedAmount: '1000000',
        expectedCurrency: 'IRT',
      },
    });

    const submitResAmbiguous = await submitIrtPaymentEvidence({
      attemptRef: irtAttemptOrder1.attemptRef,
      trackingNumber: mockTrkAmbiguous,
      paidAmountIrt: Number(irtAttemptOrder1.expectedAmount),
      senderCardLast4: '4321',
      actorId: testAdvId,
    });
    assert(
      submitResAmbiguous.attempt.status === PaymentAttemptStatus.MANUAL_REVIEW &&
      submitResAmbiguous.isAmbiguousDuplicate === true,
      '1.11 Ambiguous duplicate reference safely routed to MANUAL_REVIEW'
    );

    // 1.12 Legitimate evidence submission transitions to PENDING
    const legitimateTrk = `TRK_LEGIT_${Date.now()}`;
    const submitResLegit = await submitIrtPaymentEvidence({
      attemptRef: irtAttemptOrder1.attemptRef,
      trackingNumber: legitimateTrk,
      paidAmountIrt: Number(irtAttemptOrder1.expectedAmount),
      senderCardLast4: '4321',
      receiptScreenshotUrl: 'https://example.com/receipt.png',
      actorId: testAdvId,
    });
    assert(
      submitResLegit.attempt.status === PaymentAttemptStatus.PENDING &&
      submitResLegit.attempt.senderCardLast4 === '4321',
      '1.12 Valid evidence submission transitions attempt to PENDING'
    );

    // ────────────────────────────────────────────────────────────────────────
    // GROUP 2: IRT ADMIN REVIEW & RECEIPT CONSUMPTION
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- Group 2: IRT Admin Review & Verification ---');

    // 2.1 Unauthorized user cannot review payment
    try {
      await adminReviewIrtPayment({
        attemptId: irtAttemptOrder1.id,
        action: 'APPROVE',
        actualAmountReceivedIrt: Number(irtAttemptOrder1.expectedAmount),
        actorId: testUnauthorizedId,
      });
      assert(false, '2.1 Unauthorized actor cannot review payment');
    } catch (e: any) {
      assert(e.message.includes('UNAUTHORIZED_FINANCIAL_ACTION'), '2.1 Unauthorized actor rejected', e.message);
    }

    // 2.2 Rejection requires explicit reason (>= 5 chars)
    try {
      await adminReviewIrtPayment({
        attemptId: irtAttemptOrder1.id,
        action: 'REJECT',
        reason: 'no',
        actorId: testAdminId,
      });
      assert(false, '2.2 Short rejection reason should be rejected');
    } catch (e: any) {
      assert(e.message.includes('REJECTION_REASON_REQUIRED'), '2.2 Short rejection reason rejected');
    }

    // 2.3 Verification without evidence rejection
    const emptyAttempt = await prisma.paymentAttempt.create({
      data: {
        attemptRef: `ATT_NO_EVID_${Date.now()}`,
        paymentRequestId: pReqOrder1.id,
        method: PaymentMethod.CARD_TO_CARD_IRT,
        provider: PaymentProvider.MANUAL_BANK,
        status: PaymentAttemptStatus.WAITING,
        expectedAmount: '1000000',
        expectedCurrency: 'IRT',
      },
    });
    try {
      await adminReviewIrtPayment({
        attemptId: emptyAttempt.id,
        action: 'APPROVE',
        actualAmountReceivedIrt: 1000000,
        actorId: testAdminId,
      });
      assert(false, '2.3 Verification without evidence should fail');
    } catch (e: any) {
      assert(e.message.includes('NO_EVIDENCE_PROVIDED'), '2.3 Verification without evidence rejected');
    }

    // 2.4 Expired quote rejection upon approval
    await prisma.paymentAttempt.update({
      where: { id: irtAttemptOrder1.id },
      data: { quoteExpiresAt: new Date(Date.now() - 60000) },
    });
    try {
      await adminReviewIrtPayment({
        attemptId: irtAttemptOrder1.id,
        action: 'APPROVE',
        actualAmountReceivedIrt: Number(irtAttemptOrder1.expectedAmount),
        actorId: testAdminId,
      });
      assert(false, '2.4 Approval against expired quote should fail');
    } catch (e: any) {
      assert(e.message.includes('EXPIRED_QUOTE'), '2.4 Approval against expired quote rejected');
    }
    // Restore quote expiry
    await prisma.paymentAttempt.update({
      where: { id: irtAttemptOrder1.id },
      data: { quoteExpiresAt: new Date(Date.now() + 600000) },
    });

    // 2.5 Actual received amount mismatch rejection
    try {
      await adminReviewIrtPayment({
        attemptId: irtAttemptOrder1.id,
        action: 'APPROVE',
        actualAmountReceivedIrt: Number(irtAttemptOrder1.expectedAmount) - 1000,
        actorId: testAdminId,
      });
      assert(false, '2.5 Received amount mismatch should fail');
    } catch (e: any) {
      assert(e.message.includes('AMOUNT_MISMATCH'), '2.5 Received amount mismatch rejected', e.message);
    }

    // 2.6 Legitimate approval: moves attempt to FINISHED, creates PaymentReceipt, verifies Order 1
    const approveRes: any = await adminReviewIrtPayment({
      attemptId: irtAttemptOrder1.id,
      action: 'APPROVE',
      actualAmountReceivedIrt: Number(irtAttemptOrder1.expectedAmount),
      reason: 'Authoritative bank statement reconciled',
      actorId: testAdminId,
    });
    assert(
      approveRes.success === true &&
      approveRes.attempt.status === PaymentAttemptStatus.FINISHED &&
      approveRes.receipt !== undefined,
      '2.6 Admin approval successfully issues verified PaymentReceipt'
    );

    // Verify order 1 was transitioned
    const refreshedOrder1 = await prisma.order.findUnique({ where: { id: testOrderId1 } });
    assert(
      refreshedOrder1?.paymentStatus === 'verified' && refreshedOrder1?.status === 'open_presign',
      '2.6 Order 1 transitioned to paymentStatus=verified and status=open_presign'
    );

    // 2.7 Reusing the same tracking number across another order is blocked
    const pReqOrder2 = await getOrCreatePaymentRequestForOrder(testOrderId2, testAdvId);
    const irtAttemptRes2 = await createIrtPaymentAttempt(pReqOrder2.id, testAdvId);
    const irtAttemptOrder2 = irtAttemptRes2.attempt;
    try {
      await submitIrtPaymentEvidence({
        attemptRef: irtAttemptOrder2.attemptRef,
        trackingNumber: legitimateTrk, // Already settled in receipt!
        paidAmountIrt: Number(irtAttemptOrder2.expectedAmount),
        senderCardLast4: '4321',
        actorId: testAdvId,
      });
      assert(false, '2.7 Duplicate tracking number across orders must be rejected');
    } catch (e: any) {
      assert(e.message.includes('DUPLICATE_RECEIPT_REFERENCE'), '2.7 Duplicate tracking number across orders rejected');
    }

    // 2.8 Admin approval produces immutable audit record with sender card and tracking details
    const auditRecord = await prisma.auditLog.findFirst({
      where: {
        action: 'IRT_PAYMENT_ADMIN_APPROVED',
        entityId: String(irtAttemptOrder1.id),
      },
    });
    assert(
      auditRecord !== null &&
      Boolean(auditRecord.newValues?.includes('4321')) &&
      Boolean(auditRecord.newValues?.includes(legitimateTrk)),
      '2.8 Admin approval produces immutable audit record with sender card and tracking details'
    );

    // 2.9 Re-approving finished attempt is rejected
    try {
      await adminReviewIrtPayment({
        attemptId: irtAttemptOrder1.id,
        action: 'APPROVE',
        actualAmountReceivedIrt: Number(irtAttemptOrder1.expectedAmount),
        reason: 'Duplicate approval attempt',
        actorId: testAdminId,
      });
      assert(false, '2.9 Re-approving finished attempt should fail');
    } catch (e: any) {
      assert(
        e.message.includes('ATTEMPT_ALREADY_FINISHED'),
        '2.9 Re-approving already finished attempt rejected with ATTEMPT_ALREADY_FINISHED'
      );
    }

    // 2.10 Cannot approve another attempt when payment request is already verified
    const secondAttemptOrder1 = await prisma.paymentAttempt.create({
      data: {
        attemptRef: `ATT_SECOND_${Date.now()}`,
        paymentRequestId: pReqOrder1.id,
        method: PaymentMethod.CARD_TO_CARD_IRT,
        provider: PaymentProvider.MANUAL_BANK,
        status: PaymentAttemptStatus.PENDING,
        trackingNumber: `TRK_SECOND_${Date.now()}`,
        senderCardLast4: '4321',
        expectedAmount: '1000000',
        expectedCurrency: 'IRT',
      },
    });
    try {
      await adminReviewIrtPayment({
        attemptId: secondAttemptOrder1.id,
        action: 'APPROVE',
        actualAmountReceivedIrt: Number(secondAttemptOrder1.expectedAmount),
        reason: 'Second attempt on closed request',
        actorId: testAdminId,
      });
      assert(false, '2.10 Approving new attempt on already verified request should fail');
    } catch (e: any) {
      assert(
        e.message.includes('PAYMENT_REQUEST_ALREADY_VERIFIED'),
        '2.10 Approval against already verified payment request rejected with PAYMENT_REQUEST_ALREADY_VERIFIED'
      );
    }

    // ────────────────────────────────────────────────────────────────────────
    // GROUP 3: NOWPAYMENTS PAYMENTS API & CLIENT
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- Group 3: NOWPayments Payments API & Mock Client ---');

    // 3.1 Creation blocked when feature flag is disabled
    // Default env has NOWPAYMENTS_MODE=disabled
    process.env.NOWPAYMENTS_MODE = 'disabled';
    process.env.NOWPAYMENTS_SANDBOX_ENABLED = 'false';
    process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED = 'false';

    try {
      await createNowpaymentsPaymentAttempt({
        paymentRequestId: pReqOrder2.id,
        payCurrency: 'btc',
        actorId: testAdvId,
      });
      assert(false, '3.1 Payment creation should fail when collection is disabled');
    } catch (e: any) {
      assert(
        e.message.includes('NOWPAYMENTS_COLLECTION_DISABLED'),
        '3.1 Payment creation blocked by fail-closed feature flag',
        e.message
      );
    }

    // 3.2 Enable sandbox mode and inject mock client
    process.env.NOWPAYMENTS_MODE = 'sandbox';
    process.env.NOWPAYMENTS_SANDBOX_ENABLED = 'true';
    process.env.NOWPAYMENTS_API_KEY = 'mock_sandbox_key';
    process.env.NOWPAYMENTS_IPN_SECRET = 'mock_ipn_secret_key_12345';

    const cfg = getNowpaymentsConfig();
    assert(
      cfg.isCollectionActive === true && cfg.baseUrl.includes('sandbox'),
      '3.2 Sandbox configuration activated with sandbox base URL'
    );

    const mockClient = new MockNowpaymentsClient();
    setCustomNowpaymentsClient(mockClient);

    // 3.3 Unsupported currency rejection
    try {
      await createNowpaymentsPaymentAttempt({
        paymentRequestId: pReqOrder2.id,
        payCurrency: 'doge_unsupported',
        actorId: testAdvId,
      });
      assert(false, '3.3 Unsupported currency should be rejected');
    } catch (e: any) {
      assert(e.message.includes('UNSUPPORTED_CURRENCY'), '3.3 Unsupported currency rejected', e.message);
    }

    // 3.4 Below-minimum payment rejection
    mockClient.mockMinAmount = 500; // Require $500 while order is $50
    try {
      await createNowpaymentsPaymentAttempt({
        paymentRequestId: pReqOrder2.id,
        payCurrency: 'btc',
        actorId: testAdvId,
      });
      assert(false, '3.4 Below-minimum payment should be rejected');
    } catch (e: any) {
      assert(e.message.includes('PAYMENT_AMOUNT_BELOW_MINIMUM'), '3.4 Below-minimum payment rejected', e.message);
    }
    mockClient.mockMinAmount = 10; // Reset to $10

    // 3.5 Successful creation of NOWPayments crypto payment
    const npAttemptRes = await createNowpaymentsPaymentAttempt({
      paymentRequestId: pReqOrder2.id,
      payCurrency: 'usdtbsc',
      actorId: testAdvId,
    });
    assert(
      npAttemptRes.attempt.status === PaymentAttemptStatus.WAITING &&
      Boolean(npAttemptRes.attempt.payAddress) &&
      Boolean(npAttemptRes.attempt.providerPaymentId),
      '3.5 NOWPayments crypto payment attempt successfully created with deposit address'
    );

    // 3.6 Reusing active unexpired attempt returns isReused: true
    const reusedAttemptRes = await createNowpaymentsPaymentAttempt({
      paymentRequestId: pReqOrder2.id,
      payCurrency: 'usdtbsc',
      actorId: testAdvId,
    });
    assert(
      reusedAttemptRes.isReused === true &&
      reusedAttemptRes.attempt.id === npAttemptRes.attempt.id,
      '3.6 Active unexpired payment attempt for same asset successfully reused'
    );

    // ────────────────────────────────────────────────────────────────────────
    // GROUP 4: NOWPAYMENTS WEBHOOK IPN VALIDATION & SAFETY
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- Group 4: NOWPayments Webhook IPN Validation & Security ---');

    const ipnSecret = 'mock_ipn_secret_key_12345';
    const samplePayload = {
      payment_id: String(npAttemptRes.attempt.providerPaymentId),
      payment_status: 'finished',
      pay_address: String(npAttemptRes.attempt.payAddress),
      price_amount: 50,
      price_currency: 'usd',
      pay_amount: 0.0005,
      actually_paid: 0.0005,
      pay_currency: 'usdtbsc',
      order_id: pReqOrder2.requestRef,
      outcome_amount: 49.5,
      outcome_currency: 'usdt',
    };

    // Helper to generate valid HMAC signature
    function generateIpnSig(payload: any, secret: string): string {
      const sorted = sortObject(payload);
      return crypto.createHmac('sha512', secret).update(JSON.stringify(sorted)).digest('hex');
    }

    // 4.1 Recursive key sorting canonicalization
    const uncanonicalObj = { z: 1, a: { d: 4, b: 2 }, m: 3 };
    const sortedObj = sortObject(uncanonicalObj);
    const sortedKeys = Object.keys(sortedObj);
    const nestedKeys = Object.keys(sortedObj.a);
    assert(
      sortedKeys.join('') === 'amz' && nestedKeys.join('') === 'bd',
      '4.1 sortObject recursively and alphabetically sorts nested object keys'
    );

    // 4.2 Valid HMAC-SHA512 signature verification
    const validSig = generateIpnSig(samplePayload, ipnSecret);
    const isSigValid = verifyNowPaymentsSignature(samplePayload, validSig, ipnSecret);
    assert(isSigValid === true, '4.2 Valid HMAC-SHA512 signature verified successfully');

    // 4.3 Invalid signature rejection
    const invalidSig = generateIpnSig(samplePayload, 'wrong_secret');
    const isSigInvalid = verifyNowPaymentsSignature(samplePayload, invalidSig, ipnSecret);
    assert(isSigInvalid === false, '4.3 Tampered or invalid HMAC signature rejected');

    try {
      await handleNowPaymentsIpn(samplePayload, 'bad_signature_hex', { customSecret: ipnSecret });
      assert(false, '4.3 handleNowPaymentsIpn should reject bad signature');
    } catch (e: any) {
      assert(e.message.includes('INVALID_IPN_SIGNATURE'), '4.3 handleNowPaymentsIpn rejects invalid signature header');
    }

    // 4.4 Intermediate statuses (confirming, confirmed, sending) do NOT verify the order
    for (const interStatus of ['confirming', 'confirmed', 'sending']) {
      const intermediatePayload = {
        ...samplePayload,
        payment_status: interStatus,
      };
      const interSig = generateIpnSig(intermediatePayload, ipnSecret);
      await handleNowPaymentsIpn(intermediatePayload, interSig, {
        customSecret: ipnSecret,
        skipProviderApiCheck: true,
      });

      const orderCheck = await prisma.order.findUnique({ where: { id: testOrderId2 } });
      assert(
        orderCheck?.paymentStatus === 'pending',
        `4.4 Intermediate IPN status '${interStatus}' does not verify order (remains pending)`
      );
    }

    // 4.5 Underpayment (partially_paid) routed to manual review
    const partialPayload = {
      ...samplePayload,
      payment_status: 'partially_paid',
      actually_paid: 0.0001, // Underpaid
    };
    const partialSig = generateIpnSig(partialPayload, ipnSecret);
    const partialRes: any = await handleNowPaymentsIpn(partialPayload, partialSig, {
      customSecret: ipnSecret,
      skipProviderApiCheck: true,
    });
    assert(
      partialRes.requiresManualReview === true &&
      partialRes.attempt.status === PaymentAttemptStatus.PARTIALLY_PAID,
      '4.5 Partially paid IPN routed to PARTIALLY_PAID and flags manual review'
    );

    // 4.6 Wrong-asset deposit detection routes to manual review
    const wrongAssetPayload = {
      ...samplePayload,
      payment_status: 'finished',
      pay_currency: 'btc', // Expected usdtbsc!
    };
    const wrongAssetSig = generateIpnSig(wrongAssetPayload, ipnSecret);
    const wrongAssetRes: any = await handleNowPaymentsIpn(wrongAssetPayload, wrongAssetSig, {
      customSecret: ipnSecret,
      skipProviderApiCheck: true,
    });
    assert(
      wrongAssetRes.requiresManualReview === true &&
      wrongAssetRes.attempt.status === PaymentAttemptStatus.MANUAL_REVIEW &&
      wrongAssetRes.attempt.isWrongAsset === true,
      '4.6 Wrong-asset deposit flagged with isWrongAsset=true and routed to MANUAL_REVIEW'
    );

    // 4.7 Re-deposit (parent_payment_id present) routes to manual review
    const reDepositPayload = {
      ...samplePayload,
      payment_status: 'finished',
      parent_payment_id: 'parent_np_999999',
    };
    const reDepositSig = generateIpnSig(reDepositPayload, ipnSecret);
    const reDepositRes: any = await handleNowPaymentsIpn(reDepositPayload, reDepositSig, {
      customSecret: ipnSecret,
      skipProviderApiCheck: true,
    });
    assert(
      reDepositRes.requiresManualReview === true &&
      reDepositRes.attempt.status === PaymentAttemptStatus.MANUAL_REVIEW &&
      reDepositRes.attempt.isReDeposit === true,
      '4.7 Re-deposit with parent_payment_id flagged with isReDeposit=true and routed to MANUAL_REVIEW'
    );

    // 4.8 Refunded status routes to manual review
    const refundedPayload = {
      ...samplePayload,
      payment_status: 'refunded',
    };
    const refundedSig = generateIpnSig(refundedPayload, ipnSecret);
    const refundedRes: any = await handleNowPaymentsIpn(refundedPayload, refundedSig, {
      customSecret: ipnSecret,
      skipProviderApiCheck: true,
    });
    assert(
      refundedRes.requiresManualReview === true &&
      refundedRes.attempt.status === PaymentAttemptStatus.REFUNDED,
      '4.8 Refunded IPN status transitions to REFUNDED and flags manual review'
    );

    // Reset attempt status back to WAITING for clean finished test
    await prisma.paymentAttempt.update({
      where: { id: npAttemptRes.attempt.id },
      data: {
        status: PaymentAttemptStatus.WAITING,
        isWrongAsset: false,
        isReDeposit: false,
      },
    });

    // 4.9 Authoritative finished IPN verifies order and issues receipt
    const finishedSig = generateIpnSig(samplePayload, ipnSecret);
    const finishedRes: any = await handleNowPaymentsIpn(samplePayload, finishedSig, {
      customSecret: ipnSecret,
      skipProviderApiCheck: false, // Calls mockClient.getPaymentStatus
    });
    assert(
      finishedRes.success === true &&
      finishedRes.status === 'finished' &&
      finishedRes.receipt !== undefined,
      '4.9 Finished IPN callback creates PaymentReceipt and settles payment'
    );

    const order2Check = await prisma.order.findUnique({ where: { id: testOrderId2 } });
    assert(
      order2Check?.paymentStatus === 'verified' && order2Check?.status === 'open_presign',
      '4.9 Order 2 verified and transitioned to open_presign by finished IPN'
    );

    // 4.10 Out-of-order and replayed IPN protection: finished attempt cannot be downgraded
    const lateConfirmingPayload = {
      ...samplePayload,
      payment_status: 'confirming',
    };
    const lateConfirmingSig = generateIpnSig(lateConfirmingPayload, ipnSecret);
    const lateRes: any = await handleNowPaymentsIpn(lateConfirmingPayload, lateConfirmingSig, {
      customSecret: ipnSecret,
      skipProviderApiCheck: true,
    });
    assert(
      lateRes.idempotent === true &&
      lateRes.attempt.status === PaymentAttemptStatus.FINISHED,
      '4.10 Late out-of-order confirming callback cannot downgrade finished attempt'
    );

    // 4.11 Provider-reported finished callback with mismatched order_id fails verification
    const mismatchOrder = await prisma.order.create({
      data: {
        orderRef: `ORD_MISMATCH_${Date.now()}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 5000,
        advertiserId: testAdvId,
        paymentStatus: 'pending',
        status: 'payment_pending',
      },
    });
    const pReqMismatch = await getOrCreatePaymentRequestForOrder(mismatchOrder.id, testAdvId);
    const mismatchAttempt = await prisma.paymentAttempt.create({
      data: {
        attemptRef: `ATT_MISMATCH_${Date.now()}`,
        paymentRequestId: pReqMismatch.id,
        method: PaymentMethod.NOWPAYMENTS_CRYPTO,
        provider: PaymentProvider.NOWPAYMENTS,
        providerPaymentId: `np_mismatch_order_${Date.now()}`,
        status: PaymentAttemptStatus.WAITING,
        payCurrency: 'usdtbsc',
        payAddress: '0x1234567890abcdef1234567890abcdef12345678',
        expectedAmount: '50',
        expectedCurrency: 'usdtbsc',
      },
    });
    const fakeOrderPayload = {
      payment_id: mismatchAttempt.providerPaymentId!,
      payment_status: 'finished',
      pay_address: '0x1234567890abcdef1234567890abcdef12345678',
      pay_amount: 50,
      actually_paid: 50,
      pay_currency: 'usdtbsc',
      price_amount: 50,
      price_currency: 'usd',
      order_id: 'WRONG_UNREGISTERED_ORDER_REF',
    };
    const fakeOrderSig = generateIpnSig(fakeOrderPayload, ipnSecret);
    const fakeOrderRes: any = await handleNowPaymentsIpn(fakeOrderPayload, fakeOrderSig, {
      customSecret: ipnSecret,
      skipProviderApiCheck: true,
    });
    assert(
      fakeOrderRes.requiresManualReview === true &&
      fakeOrderRes.attempt.status === PaymentAttemptStatus.MANUAL_REVIEW,
      '4.11 Provider-reported finished payment with mismatched order_id routed to MANUAL_REVIEW'
    );
    const mismatchOrderCheck = await prisma.order.findUnique({ where: { id: mismatchOrder.id } });
    assert(
      mismatchOrderCheck?.paymentStatus === 'pending' && mismatchOrderCheck?.status === 'payment_pending',
      '4.11 Order with mismatched order_id remains payment_pending'
    );

    // 4.12 Provider-reported finished callback with mismatched price_amount (settlement terms) fails verification
    const termsMismatchAttempt = await prisma.paymentAttempt.create({
      data: {
        attemptRef: `ATT_TERMS_${Date.now()}`,
        paymentRequestId: pReqMismatch.id,
        method: PaymentMethod.NOWPAYMENTS_CRYPTO,
        provider: PaymentProvider.NOWPAYMENTS,
        providerPaymentId: `np_terms_mismatch_${Date.now()}`,
        status: PaymentAttemptStatus.WAITING,
        payCurrency: 'usdtbsc',
        payAddress: '0x1234567890abcdef1234567890abcdef12345678',
        expectedAmount: '50',
        expectedCurrency: 'usdtbsc',
      },
    });
    const fakeTermsPayload = {
      payment_id: termsMismatchAttempt.providerPaymentId!,
      payment_status: 'finished',
      pay_address: '0x1234567890abcdef1234567890abcdef12345678',
      pay_amount: 50,
      actually_paid: 50,
      pay_currency: 'usdtbsc',
      price_amount: 10, // Settlement terms mismatch! Expected 50
      price_currency: 'usd',
      order_id: pReqMismatch.requestRef,
    };
    const fakeTermsSig = generateIpnSig(fakeTermsPayload, ipnSecret);
    const fakeTermsRes: any = await handleNowPaymentsIpn(fakeTermsPayload, fakeTermsSig, {
      customSecret: ipnSecret,
      skipProviderApiCheck: true,
    });
    assert(
      fakeTermsRes.requiresManualReview === true &&
      fakeTermsRes.attempt.status === PaymentAttemptStatus.MANUAL_REVIEW,
      '4.12 Provider-reported finished payment with mismatched settlement terms (price_amount) routed to MANUAL_REVIEW'
    );

    // 4.13 Provider-reported finished callback with actually_paid: 0 routed to PARTIALLY_PAID
    const zeroPaidAttempt = await prisma.paymentAttempt.create({
      data: {
        attemptRef: `ATT_ZEROPAID_${Date.now()}`,
        paymentRequestId: pReqMismatch.id,
        method: PaymentMethod.NOWPAYMENTS_CRYPTO,
        provider: PaymentProvider.NOWPAYMENTS,
        providerPaymentId: `np_zero_paid_${Date.now()}`,
        status: PaymentAttemptStatus.WAITING,
        payCurrency: 'usdtbsc',
        payAddress: '0x1234567890abcdef1234567890abcdef12345678',
        expectedAmount: '50',
        expectedCurrency: 'usdtbsc',
      },
    });
    const zeroPaidPayload = {
      payment_id: zeroPaidAttempt.providerPaymentId!,
      payment_status: 'finished', // Provider claims finished!
      pay_address: '0x1234567890abcdef1234567890abcdef12345678',
      pay_amount: 50,
      actually_paid: 0, // but actually paid is 0!
      pay_currency: 'usdtbsc',
      price_amount: 50,
      price_currency: 'usd',
      order_id: pReqMismatch.requestRef,
    };
    const zeroPaidSig = generateIpnSig(zeroPaidPayload, ipnSecret);
    const zeroPaidRes: any = await handleNowPaymentsIpn(zeroPaidPayload, zeroPaidSig, {
      customSecret: ipnSecret,
      skipProviderApiCheck: true,
    });
    assert(
      zeroPaidRes.requiresManualReview === true &&
      zeroPaidRes.attempt.status === PaymentAttemptStatus.PARTIALLY_PAID,
      '4.13 Provider-reported finished with actually_paid=0 routed to PARTIALLY_PAID'
    );

    // ────────────────────────────────────────────────────────────────────────
    // GROUP 5: FINANCIAL RECONCILIATION & SINGLE-USE RECEIPT INVARIANT
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n--- Group 5: Financial Reconciliation & Invariant Checks ---');

    const settledReceipt = finishedRes.receipt;

    // 5.1 Single-use invariant: Attempting to consume an already-consumed receipt throws
    try {
      await consumePaymentReceipt(settledReceipt.id, testAdminId);
      assert(false, '5.1 Consuming an already-consumed receipt should throw');
    } catch (e: any) {
      assert(
        e.message.includes('RECEIPT_ALREADY_CONSUMED'),
        '5.1 Consuming an already-consumed receipt throws RECEIPT_ALREADY_CONSUMED',
        e.message
      );
    }

    // 5.2 Wallet top-up receipt cannot be applied to an order
    const pReqFunding = await getOrCreatePaymentRequestForFunding(testFundingId, testAdvId);
    const fundingAttempt = await prisma.paymentAttempt.create({
      data: {
        attemptRef: `ATT_FND_MOCK_${Date.now()}`,
        paymentRequestId: pReqFunding.id,
        method: PaymentMethod.CARD_TO_CARD_IRT,
        provider: PaymentProvider.MANUAL_BANK,
        status: PaymentAttemptStatus.FINISHED,
        expectedAmount: '5000000',
        expectedCurrency: 'IRT',
      },
    });

    const fundingReceipt = await prisma.paymentReceipt.create({
      data: {
        receiptRef: `RCP_FND_MOCK_${Date.now()}`,
        paymentRequestId: pReqFunding.id,
        paymentAttemptId: fundingAttempt.id,
        amountUsdCents: 5000,
        paymentMethod: PaymentMethod.CARD_TO_CARD_IRT,
        providerReference: `TRK_FND_${Date.now()}`,
        status: PaymentReceiptStatus.ACTIVE,
        verifiedBy: testAdminId,
      },
    });

    try {
      // Attempting to verify Order 1 with funding receipt
      await verifyOrderWithReceipt(testOrderId1, fundingReceipt.receiptRef, testAdminId);
      assert(false, '5.2 Funding receipt applied to an order should fail');
    } catch (e: any) {
      assert(
        e.message.includes('RECEIPT_ORDER_MISMATCH'),
        '5.2 Wallet funding receipt rejected when applied to order (RECEIPT_ORDER_MISMATCH)',
        e.message
      );
    }

    // 5.3 Order payment receipt cannot be applied to a wallet top-up
    // An active order receipt has businessType='ORDER', consumePaymentReceipt only updates Order
    const freshSettledReceipt = await prisma.paymentReceipt.findUnique({
      where: { id: settledReceipt.id },
      include: { paymentRequest: true },
    });
    assert(
      freshSettledReceipt?.paymentRequest?.businessType === PaymentBusinessType.ORDER &&
      freshSettledReceipt?.consumedAction === 'ORDER_FUNDING',
      '5.3 Order payment receipt strictly isolated to ORDER_FUNDING action'
    );

    // 5.4 Consuming funding receipt credits wallet and cannot be consumed again
    await prisma.walletV2.upsert({
      where: { userId: testAdvId },
      update: {},
      create: { userId: testAdvId, availableCents: 0, reservedCents: 0 },
    });
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'true';
    const walletFundingRes = await consumePaymentReceipt(fundingReceipt.id, testAdminId);
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'false';
    assert(
      walletFundingRes.businessAction === 'WALLET_FUNDING' &&
      walletFundingRes.receipt.status === PaymentReceiptStatus.CONSUMED,
      '5.4 Wallet funding receipt properly consumed for WALLET_FUNDING'
    );

    try {
      await consumePaymentReceipt(fundingReceipt.id, testAdminId);
      assert(false, '5.4 Second consumption of funding receipt should throw');
    } catch (e: any) {
      assert(
        e.message.includes('RECEIPT_ALREADY_CONSUMED'),
        '5.4 Repeated consumption of wallet funding receipt blocked'
      );
    }

    // 5.5 Direct order verification shortcut elimination
    // Verify an unverified order without receipt fails
    const unverifiedOrder = await prisma.order.create({
      data: {
        orderRef: `ORD_UNVER_${Date.now()}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 3000,
        advertiserId: testAdvId,
        paymentStatus: 'pending',
        status: 'payment_pending',
      },
    });

    try {
      await verifyOrderWithReceipt(unverifiedOrder.id, 'NON_EXISTENT_RECEIPT', testAdminId);
      assert(false, '5.5 Direct verification with nonexistent receipt should fail');
    } catch (e: any) {
      assert(e.message.includes('RECEIPT_NOT_FOUND'), '5.5 Verification blocked without legitimate receipt record');
    }

    // 5.6 Concurrency invariant: Concurrent consumption calls under Promise.all allow only 1 success
    const concurrentOrder = await prisma.order.create({
      data: {
        orderRef: `ORD_CONCUR_${Date.now()}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 4000,
        advertiserId: testAdvId,
        paymentStatus: 'pending',
        status: 'payment_pending',
      },
    });
    const concurrentPReq = await getOrCreatePaymentRequestForOrder(concurrentOrder.id, testAdvId);
    const concurrentAttempt = await prisma.paymentAttempt.create({
      data: {
        attemptRef: `ATT_CONCUR_${Date.now()}`,
        paymentRequestId: concurrentPReq.id,
        method: PaymentMethod.NOWPAYMENTS_CRYPTO,
        provider: PaymentProvider.NOWPAYMENTS,
        status: PaymentAttemptStatus.FINISHED,
        expectedAmount: '40',
        expectedCurrency: 'USD',
      },
    });
    const concurrentReceipt = await prisma.paymentReceipt.create({
      data: {
        receiptRef: `RCP_CONCUR_${Date.now()}`,
        paymentRequestId: concurrentPReq.id,
        paymentAttemptId: concurrentAttempt.id,
        amountUsdCents: 4000,
        paymentMethod: PaymentMethod.NOWPAYMENTS_CRYPTO,
        providerReference: `NP_CONCUR_${Date.now()}`,
        status: PaymentReceiptStatus.ACTIVE,
        verifiedBy: testAdminId,
      },
    });

    const concurrentResults = await Promise.allSettled([
      consumePaymentReceipt(concurrentReceipt.id, testAdminId),
      consumePaymentReceipt(concurrentReceipt.id, testAdminId),
      consumePaymentReceipt(concurrentReceipt.id, testAdminId),
    ]);

    const successes = concurrentResults.filter((r) => r.status === 'fulfilled');
    const failures = concurrentResults.filter((r) => r.status === 'rejected');

    assert(
      successes.length === 1 && failures.length === 2,
      '5.6 Concurrency invariant: Exactly 1 concurrent consumption succeeds and others throw'
    );
    const failureErrors = failures.map((f: any) => f.reason?.message || '');
    assert(
      failureErrors.every((msg) => msg.includes('RECEIPT_ALREADY_CONSUMED')),
      '5.6 Concurrent losers receive RECEIPT_ALREADY_CONSUMED'
    );

    // 5.7 Unconfigured fee policy verification: incoming_irt_fee_rate must fail-closed when unconfigured
    await prisma.systemFinancialConfig.deleteMany({
      where: { key: 'incoming_irt_fee_rate' },
    });
    try {
      await calculateIncomingIrtQuote(5000);
      assert(false, '5.7 Quote without incoming_irt_fee_rate should fail closed');
    } catch (e: any) {
      assert(
        e.message.includes('MISSING_INCOMING_IRT_FEE_POLICY'),
        '5.7 Unconfigured incoming_irt_fee_rate strictly fails closed with MISSING_INCOMING_IRT_FEE_POLICY'
      );
    }

    // Reset custom client and environment flags
    setCustomNowpaymentsClient(null);
    process.env.NOWPAYMENTS_MODE = 'disabled';
    process.env.NOWPAYMENTS_SANDBOX_ENABLED = 'false';
    process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED = 'false';

  } catch (err: any) {
    console.error('FATAL_UNHANDLED_EXCEPTION in test suite:', err);
    failed++;
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log(`TEST SUITE FINISHED. Passed: ${passed}, Failed: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPaymentSuite()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    try {
      // Ensure incoming_irt_fee_rate is removed so production DB remains unconfigured
      await prisma.systemFinancialConfig.deleteMany({
        where: { key: 'incoming_irt_fee_rate' },
      });
    } catch (e) {
      // ignore in cleanup
    }
    await prisma.$disconnect();
  });
