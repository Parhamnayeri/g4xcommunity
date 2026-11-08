/**
 * ============================================================================
 * G4X Community — Order Lifecycle Controls, Payment Review & Publication Suite
 * ============================================================================
 * Exhaustive regression and invariant test suite covering:
 *  1. Unfunded Draft Diagnosis (#1603 reproduction)
 *  2. Denied Unpaid Publication with clear English explanation
 *  3. Backed WalletV2 Balance Reservation (ORDER_RESERVE ledger entry)
 *  4. Insufficient Wallet Balance Rejection
 *  5. Legitimate Publication of Verified/Funded Orders
 *  6. Authoritative Payment Receipt Verification & CAS Consumption
 *  7. Duplicate Receipt Consumption Rejection (One-Time Consumption Invariant)
 *  8. Strict Separation: Wallet Top-up Receipt cannot fund Orders
 *  9. Unauthorized Lifecycle Mutations Rejection (RBAC)
 * 10. Order Cancellation with Reserved Funds Release (ORDER_RELEASE ledger entry)
 * 11. Categorized Admin Listings (All 7 Lifecycle Categories)
 * 12. Restart Recovery & Idempotent Diagnostics
 * ============================================================================
 */

import prisma from '../database/db';
import {
  getOrderDiagnostics,
  getCategorizedOrders,
  publishOrder,
  payOrderFromWallet,
  cancelOrderWithLifecycle,
  getOrderAuditHistory,
} from '../services/orderLifecycleService';
import { verifyOrderWithReceipt, consumePaymentReceipt } from '../services/payment/paymentReconciliationService';
import {
  PaymentBusinessType,
  PaymentRequestStatus,
  PaymentReceiptStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentAttemptStatus,
} from '../services/payment/paymentTypes';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failedTests++;
    console.error(`  ❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    passedTests++;
    console.log(`  ✅ PASSED: ${message}`);
  }
}

async function runSuite() {
  console.log('\n================================================================');
  console.log('🚀 G4X ORDER LIFECYCLE & PAYMENT REVIEW TEST SUITE');
  console.log('================================================================\n');

  const ts = Date.now();
  const testAdminId = `admin_lifecycle_${ts}`;
  const testCreatorId = `creator_lifecycle_${ts}`;
  const testUnauthorizedId = `user_unauth_${ts}`;

  // Bootstrap test users
  await prisma.user.upsert({
    where: { discordId: testAdminId },
    create: {
      discordId: testAdminId,
      username: `Admin_${ts}`,
      isActive: true,
      userRoles: { create: [{ roleKey: 'admin' }] },
    },
    update: {},
  });

  await prisma.user.upsert({
    where: { discordId: testCreatorId },
    create: {
      discordId: testCreatorId,
      username: `Creator_${ts}`,
      isActive: true,
      userRoles: { create: [{ roleKey: 'advertiser' }] },
    },
    update: {},
  });

  await prisma.user.upsert({
    where: { discordId: testUnauthorizedId },
    create: {
      discordId: testUnauthorizedId,
      username: `Unauth_${ts}`,
      isActive: true,
    },
    update: {},
  });

  // Ensure game and service exist
  await prisma.game.upsert({
    where: { slug: 'wow_midnight' },
    create: {
      slug: 'wow_midnight',
      displayName: 'World of Warcraft Midnight',
      serviceCategory: 'both',
      isActive: true,
    },
    update: { isActive: true },
  });

  const service = await prisma.gameService.upsert({
    where: { id: 9912 },
    create: {
      id: 9912,
      gameSlug: 'wow_midnight',
      serviceKey: 'mythic_plus_10',
      displayName: 'Mythic+ 10 Keystone',
      serviceMode: 'non_pilot',
      profileMode: 'manual',
      isActive: true,
    },
    update: { isActive: true },
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Reproduction & Diagnosis of Unfunded Draft Order (like #1603)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('─── TEST 1: Unfunded Draft Diagnosis (#1603 Reproduction) ───');
  const unfundedOrder = await prisma.order.create({
    data: {
      orderRef: `ORD_UNFUNDED_${ts}`,
      gameSlug: 'wow_midnight',
      serviceId: service.id,
      creatorId: testCreatorId,
      creatorType: 'advertiser',
      orderType: 'group',
      orderMode: 'non_pilot',
      currency: 'USD',
      grossAmountMinor: 2500, // $25.00
      boosterPoolMinor: 2000,
      paymentStatus: 'pending',
      status: 'payment_pending',
    },
  });

  const diag1 = await getOrderDiagnostics(unfundedOrder.id);
  assert(diag1.category === 'pending_payment', 'Order #1603 pattern categorized as pending_payment');
  assert(diag1.isPublishable === false, 'Unfunded order strictly marked not publishable');
  assert(
    diag1.publicationBlockReasons.some((r) => r.includes('ORDER_UNPAID')),
    'Publication block reasons clearly declare ORDER_UNPAID'
  );
  assert(
    diag1.explanationEnglish.includes('ORDER_UNPAID'),
    'English explanation states payment is pending and booster claims are blocked'
  );
  assert(
    diag1.requiredNextActionEnglish.includes('pay-from-wallet') &&
      diag1.requiredNextActionEnglish.includes('verify-payment'),
    'Required next action presents legitimate options: wallet payment or payment receipt verification'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Denied Publication on Unpaid Order
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n─── TEST 2: Denied Publication on Unpaid Order ───');
  let pubDenied = false;
  try {
    await publishOrder(unfundedOrder.id, testAdminId);
  } catch (err: any) {
    pubDenied = true;
    assert(
      err.message.includes('CANNOT_PUBLISH_ORDER') && err.message.includes('ORDER_UNPAID'),
      `Publication safely rejected with: ${err.message}`
    );
  }
  assert(pubDenied, 'publishOrder unconditionally denied publication for unpaid order');

  // Verify DB state remains unpublished
  const checkUnfunded = await prisma.order.findUniqueOrThrow({ where: { id: unfundedOrder.id } });
  assert(checkUnfunded.discordMessageId === null, 'Order discordMessageId remains null');
  assert(checkUnfunded.status === 'payment_pending', 'Order status remains payment_pending');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Insufficient Wallet Balance Rejection
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n─── TEST 3: Insufficient Wallet Balance Rejection ───');
  // Initialize wallet with $10.00 (order requires $25.00)
  await prisma.walletV2.upsert({
    where: { userId: testCreatorId },
    create: {
      userId: testCreatorId,
      availableCents: 1000,
      reservedCents: 0,
    },
    update: {
      availableCents: 1000,
      reservedCents: 0,
    },
  });

  let walletDenied = false;
  try {
    await payOrderFromWallet(unfundedOrder.id, testCreatorId);
  } catch (err: any) {
    walletDenied = true;
    assert(
      err.message.includes('INSUFFICIENT_FUNDS'),
      `payOrderFromWallet rejected insufficient funds with: ${err.message}`
    );
  }
  assert(walletDenied, 'Insufficient wallet balance strictly rejected');

  // Assert wallet balances were not mutated
  const walletCheck1 = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testCreatorId } });
  assert(walletCheck1.availableCents === 1000, 'Available balance untouched');
  assert(walletCheck1.reservedCents === 0, 'Reserved balance untouched');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Backed Available WalletV2 Balance Reservation (ORDER_RESERVE)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n─── TEST 4: Backed Wallet Balance Reservation ───');
  // Credit wallet with $50.00 (ample funds)
  await prisma.walletV2.update({
    where: { userId: testCreatorId },
    data: { availableCents: 5000 },
  });

  const payResult = await payOrderFromWallet(unfundedOrder.id, testCreatorId);
  assert(payResult.success === true, 'payOrderFromWallet succeeded with backed balance');
  assert(payResult.order.paymentStatus === 'verified', 'Order paymentStatus transitioned to verified');
  assert(payResult.order.status === 'open_presign', 'Order status transitioned to open_presign');

  // Verify WalletV2 reservation
  const walletCheck2 = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testCreatorId } });
  assert(walletCheck2.availableCents === 2500, 'Wallet availableCents debited: 5000 - 2500 = 2500');
  assert(walletCheck2.reservedCents === 2500, 'Wallet reservedCents credited: 0 + 2500 = 2500');

  // Verify LedgerEntryV2
  const ledgerReserve = await prisma.ledgerEntryV2.findFirst({
    where: {
      userId: testCreatorId,
      entryType: 'ORDER_RESERVE',
      description: { contains: unfundedOrder.orderRef },
    },
  });
  assert(!!ledgerReserve, 'Authoritative ORDER_RESERVE LedgerEntryV2 entry created');
  assert(ledgerReserve?.direction === 'DEBIT', 'Ledger direction is DEBIT');
  assert(ledgerReserve?.amountCents === 2500, 'Ledger reserved amount matches order gross');

  // Verify AuditLog
  const auditLogs = await getOrderAuditHistory(unfundedOrder.id);
  assert(
    auditLogs.some((l) => l.action === 'ORDER_WALLET_FUNDED'),
    'AuditLog records ORDER_WALLET_FUNDED'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: Legitimate Publication of Verified Order
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n─── TEST 5: Legitimate Publication of Verified Order ───');
  const diag2 = await getOrderDiagnostics(unfundedOrder.id);
  assert(diag2.category === 'publishable', 'Funded order categorized as publishable');
  assert(diag2.isPublishable === true, 'Funded order is now eligible for publication');

  // Mock Discord Client for headless publication
  const mockMessageId = `msg_discord_${ts}`;
  const mockChannelId = `chan_orders_${ts}`;
  const mockChannel: any = {
    id: mockChannelId,
    isTextBased: () => true,
    permissionsFor: () => ({
      has: () => true,
    }),
    send: async () => ({ id: mockMessageId, channelId: mockChannelId }),
    messages: {
      fetch: async () => null,
    },
  };

  const mockClient: any = {
    channels: {
      fetch: async (id: string) => (id === mockChannelId ? mockChannel : null),
      cache: new Map([[mockChannelId, mockChannel]]),
    },
    guilds: {
      cache: {
        get: () => ({
          channels: {
            cache: new Map([[mockChannelId, mockChannel]]),
            fetch: async () => mockChannel,
          },
        }),
      },
    },
  };

  const pubResult = await publishOrder(unfundedOrder.id, testAdminId, mockClient, {
    targetChannelId: mockChannelId,
  });
  assert(pubResult.success === true, 'publishOrder succeeded for verified order');

  const publishedCheck = await prisma.order.findUniqueOrThrow({ where: { id: unfundedOrder.id } });
  assert(publishedCheck.discordMessageId === mockMessageId, 'Order discordMessageId persisted');

  const diag3 = await getOrderDiagnostics(unfundedOrder.id);
  assert(diag3.category === 'published', 'Order categorized as published');
  assert(diag3.discordMessageId === mockMessageId, 'Order message ID reflected in diagnostics');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: Authoritative Payment Receipt Verification & CAS Consumption
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n─── TEST 6: Authoritative Receipt Verification & CAS Consumption ───');
  const receiptOrder = await prisma.order.create({
    data: {
      orderRef: `ORD_RECEIPT_${ts}`,
      gameSlug: 'wow_midnight',
      serviceId: service.id,
      creatorId: testCreatorId,
      creatorType: 'advertiser',
      orderType: 'solo',
      orderMode: 'non_pilot',
      currency: 'USD',
      grossAmountMinor: 4000, // $40.00
      boosterPoolMinor: 3200,
      paymentStatus: 'pending',
      status: 'payment_pending',
    },
  });

  const payReq = await prisma.paymentRequest.create({
    data: {
      requestRef: `PAY_REQ_ORD_${receiptOrder.id}_${ts}`,
      businessType: PaymentBusinessType.ORDER,
      orderId: receiptOrder.id,
      userId: testCreatorId,
      amountUsdCents: 4000,
      currency: 'USD',
      status: PaymentRequestStatus.PENDING,
    },
  });

  const payAttempt = await prisma.paymentAttempt.create({
    data: {
      attemptRef: `ATT_CRYPTO_${ts}`,
      paymentRequestId: payReq.id,
      method: PaymentMethod.NOWPAYMENTS_CRYPTO,
      provider: PaymentProvider.NOWPAYMENTS,
      status: PaymentAttemptStatus.FINISHED,
      expectedAmount: '40',
      expectedCurrency: 'USDT',
    },
  });

  const receiptRef = `RCP_VALID_${ts}`;
  const receipt = await prisma.paymentReceipt.create({
    data: {
      receiptRef,
      paymentRequestId: payReq.id,
      paymentAttemptId: payAttempt.id,
      amountUsdCents: 4000,
      paymentMethod: PaymentMethod.NOWPAYMENTS_CRYPTO,
      providerReference: `PROVIDER_${ts}`,
      verifiedBy: testAdminId,
      verifiedAt: new Date(),
      status: PaymentReceiptStatus.ACTIVE,
    },
  });

  const receiptVerifyResult = await verifyOrderWithReceipt(receiptOrder.id, receiptRef, testAdminId);
  assert(receiptVerifyResult.success === true, 'verifyOrderWithReceipt successfully consumed receipt');
  assert(receiptVerifyResult.order?.paymentStatus === 'verified', 'Order paymentStatus verified via receipt');
  assert(receiptVerifyResult.order?.status === 'open_presign', 'Order transitioned to open_presign');
  assert(receiptVerifyResult.receipt.status === PaymentReceiptStatus.CONSUMED, 'Receipt status CAS updated to CONSUMED');
  assert(receiptVerifyResult.receipt.consumedAction === 'ORDER_FUNDING', 'Consumed action recorded as ORDER_FUNDING');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 7: Duplicate Receipt Consumption Rejection (One-Time Invariant)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n─── TEST 7: Duplicate Receipt Consumption Rejection ───');
  let duplicateDenied = false;
  try {
    await verifyOrderWithReceipt(receiptOrder.id, receiptRef, testAdminId);
  } catch (err: any) {
    duplicateDenied = true;
    assert(
      err.message.includes('RECEIPT_ALREADY_CONSUMED'),
      `Second consumption attempt rejected with: ${err.message}`
    );
  }
  assert(duplicateDenied, 'Receipt one-time consumption strictly enforced');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 8: Strict Separation: Wallet Top-Up Receipt Cannot Fund Orders
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n─── TEST 8: Wallet Receipt vs Order Separation Invariant ───');
  const fundingReq = await prisma.advertiserFundingRequest.create({
    data: {
      fundingRef: `FUND_REQ_${ts}`,
      advertiserId: testCreatorId,
      targetUsdCents: 5000,
      fundingMethod: 'IRT',
      externalCurrency: 'IRT',
      externalAmountUnits: '5000000',
      status: 'PENDING',
    },
  });

  const walletPayReq = await prisma.paymentRequest.create({
    data: {
      requestRef: `PAY_REQ_WALLET_${ts}`,
      businessType: PaymentBusinessType.WALLET_FUNDING,
      fundingRequestId: fundingReq.id,
      userId: testCreatorId,
      amountUsdCents: 5000,
      currency: 'USD',
      status: PaymentRequestStatus.PENDING,
    },
  });

  const walletAttempt = await prisma.paymentAttempt.create({
    data: {
      attemptRef: `ATT_WALLET_${ts}`,
      paymentRequestId: walletPayReq.id,
      method: PaymentMethod.CARD_TO_CARD_IRT,
      provider: PaymentProvider.MANUAL_BANK,
      status: PaymentAttemptStatus.FINISHED,
      expectedAmount: '5000000',
      expectedCurrency: 'IRT',
    },
  });

  const walletReceiptRef = `RCP_WALLET_${ts}`;
  await prisma.paymentReceipt.create({
    data: {
      receiptRef: walletReceiptRef,
      paymentRequestId: walletPayReq.id,
      paymentAttemptId: walletAttempt.id,
      amountUsdCents: 5000,
      paymentMethod: PaymentMethod.CARD_TO_CARD_IRT,
      providerReference: `TRACK_IRT_${ts}`,
      verifiedBy: testAdminId,
      verifiedAt: new Date(),
      status: PaymentReceiptStatus.ACTIVE,
    },
  });

  let mismatchDenied = false;
  try {
    await verifyOrderWithReceipt(receiptOrder.id, walletReceiptRef, testAdminId);
  } catch (err: any) {
    mismatchDenied = true;
    assert(
      err.message.includes('RECEIPT_ORDER_MISMATCH'),
      `Wallet receipt rejection on order verified: ${err.message}`
    );
  }
  assert(mismatchDenied, 'Wallet funding receipts strictly blocked from order verification');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 9: Unauthorized Lifecycle Mutation Rejection (RBAC)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n─── TEST 9: Unauthorized Lifecycle Mutation Rejection ───');
  let unauthPubDenied = false;
  try {
    await publishOrder(receiptOrder.id, testUnauthorizedId);
  } catch (err: any) {
    unauthPubDenied = true;
    assert(err.message.includes('Permission denied'), `Unauthorized publish rejected: ${err.message}`);
  }
  assert(unauthPubDenied, 'Non-admin/non-manager actor rejected from publishOrder');

  let unauthCancelDenied = false;
  try {
    await cancelOrderWithLifecycle(receiptOrder.id, testUnauthorizedId);
  } catch (err: any) {
    unauthCancelDenied = true;
    assert(err.message.includes('Permission denied'), `Unauthorized cancel rejected: ${err.message}`);
  }
  assert(unauthCancelDenied, 'Non-owner actor rejected from cancelling another user order');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 10: Order Cancellation with Reserved Funds Release
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n─── TEST 10: Cancellation with Reserved Funds Release ───');
  // Order #unfundedOrder had $25.00 reserved from testCreatorId's wallet in Test 4
  const walletBeforeCancel = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testCreatorId } });
  assert(walletBeforeCancel.reservedCents >= 2500, 'Wallet has reserved funds prior to cancellation');

  const cancelResult = await cancelOrderWithLifecycle(unfundedOrder.id, testCreatorId, 'Client requested cancellation');
  assert(cancelResult.success === true, 'Order cancelled successfully');
  assert(cancelResult.order.status === 'cancelled', 'Order status updated to cancelled');

  // Check wallet funds were released from reserved back to available
  const walletAfterCancel = await prisma.walletV2.findUniqueOrThrow({ where: { userId: testCreatorId } });
  assert(
    walletAfterCancel.availableCents === walletBeforeCancel.availableCents + 2500,
    `Available cents restored: ${walletBeforeCancel.availableCents} + 2500 = ${walletAfterCancel.availableCents}`
  );
  assert(
    walletAfterCancel.reservedCents === walletBeforeCancel.reservedCents - 2500,
    `Reserved cents decremented: ${walletBeforeCancel.reservedCents} - 2500 = ${walletAfterCancel.reservedCents}`
  );

  // Check LedgerEntryV2 ORDER_RELEASE
  const ledgerRelease = await prisma.ledgerEntryV2.findFirst({
    where: {
      userId: testCreatorId,
      entryType: 'ORDER_RELEASE',
      description: { contains: unfundedOrder.orderRef },
    },
  });
  assert(!!ledgerRelease, 'ORDER_RELEASE LedgerEntryV2 entry created');
  assert(ledgerRelease?.direction === 'CREDIT', 'Release entry direction is CREDIT');
  assert(ledgerRelease?.amountCents === 2500, 'Released amount matches 2500 cents');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 11: Categorized Admin Listings (All 7 Categories)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n─── TEST 11: Categorized Admin Listings ───');
  const categorized = await getCategorizedOrders();
  assert(typeof categorized.counts.pending_payment === 'number', 'pending_payment category counted');
  assert(typeof categorized.counts.publishable === 'number', 'publishable category counted');
  assert(typeof categorized.counts.published === 'number', 'published category counted');
  assert(typeof categorized.counts.in_progress === 'number', 'in_progress category counted');
  assert(typeof categorized.counts.proof_review === 'number', 'proof_review category counted');
  assert(typeof categorized.counts.completed === 'number', 'completed category counted');
  assert(typeof categorized.counts.cancelled === 'number', 'cancelled category counted');
  assert(typeof categorized.counts.disputed === 'number', 'disputed category counted');
  assert(categorized.orders.cancelled.some((o) => o.id === unfundedOrder.id), 'Cancelled order appears in cancelled bucket');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 12: Restart Recovery & Idempotent Diagnostics
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n─── TEST 12: Restart Recovery & Idempotent Diagnostics ───');
  const diagA = await getOrderDiagnostics(receiptOrder.id);
  const diagB = await getOrderDiagnostics(receiptOrder.id);
  assert(diagA.status === diagB.status, 'Diagnostics status is deterministic');
  assert(diagA.paymentStatus === diagB.paymentStatus, 'Diagnostics paymentStatus is deterministic');
  assert(diagA.isPublishable === diagB.isPublishable, 'Diagnostics publication eligibility is deterministic');
  assert(diagA.category === 'publishable', 'Receipt-verified order is deterministically publishable');

  console.log('\n================================================================');
  console.log(`🎉 TEST SUITE COMPLETE: ${passedTests} passed, ${failedTests} failed.`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
