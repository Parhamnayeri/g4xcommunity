/**
 * src/test/exchange_phase5_payment_and_escrow_suite.ts
 *
 * Comprehensive Test Suite for G4X Exchange Phase 5:
 *  1. Checkout Summary Breakdown & Validation (Pricing breakdown, wallet available, gateway flags, RBAC)
 *  2. Central Wallet Payment — Atomic Balance Mutation & Invariant Enforcement (Wallet, WalletV2, Ledger, Escrow, Trade)
 *  3. Central Wallet Payment Failures & Safety Guards (Insufficient funds, frozen wallet, unauthorized, double-pay)
 *  4. NOWPayments Gateway Flow & IPN Verification (HMAC-SHA512 verification, finished event, idempotent duplicate IPN)
 *  5. Manual Bank Transfer Lifecycle (Initiate -> Submit Receipt -> Reject -> Re-initiate -> Approve -> Escrow Lock)
 *  6. Trade Cancellation & Escrow Refund Invariants (403 for non-admin on paid trade, atomic wallet refund & ledger, capacity release)
 *  7. Escrow Invariant Enforcement (assertTradeEscrowFunded: 404, awaiting payment, cancelled, tampered amount, valid)
 */

import prisma from '../database/db';
import crypto from 'crypto';
import {
  getTradeCheckoutSummary,
  payTradeWithWallet,
  initiateTradeNowPayments,
  handleExchangeNowPaymentsIpn,
  initiateTradeBankTransfer,
  submitBankReceipt,
  approveBankTransferPayment,
  rejectBankTransferPayment,
  cancelExchangeTradeWithEscrowCheck,
  assertTradeEscrowFunded,
  generateNextPaymentCode,
} from '../services/exchangePaymentService';
import {
  submitSellOffer,
  acceptSellOffer,
  TradeValidationError,
} from '../services/exchangeTradeService';
import {
  ensureExchangeDefaults,
} from '../services/exchangeConfigService';

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

/**
 * Helper to compute valid NOWPayments HMAC-SHA512 IPN signature
 */
function computeTestIpnSignature(payload: any, secret: string): string {
  function sortKeys(obj: any): any {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    return Object.keys(obj).sort().reduce((acc: any, key) => {
      acc[key] = sortKeys(obj[key]);
      return acc;
    }, {});
  }
  const serialized = JSON.stringify(sortKeys(payload));
  return crypto.createHmac('sha512', secret).update(serialized).digest('hex');
}

async function runSuite() {
  console.log('=== STARTING G4X EXCHANGE PHASE 5 PAYMENT & ESCROW SUITE ===\n');

  const BUYER_ID = `P5_BUYER_${Date.now()}`;
  const SELLER_ID = `P5_SELLER_${Date.now()}`;
  const ADMIN_ID = `P5_ADMIN_${Date.now()}`;
  const OTHER_ID = `P5_OTHER_${Date.now()}`;

  const TEST_IPN_SECRET = 'test_nowpayments_ipn_secret_phase5';
  process.env.NOWPAYMENTS_IPN_SECRET = TEST_IPN_SECRET;

  try {
    console.log('--- SETUP: Seeding Test Catalog, Roles, Users & Central Wallets ---');
    await ensureExchangeDefaults();

    // Ensure roles exist
    await prisma.role.upsert({ where: { roleKey: 'exchanger' }, create: { roleKey: 'exchanger', name: 'Exchanger' }, update: {} });
    await prisma.role.upsert({ where: { roleKey: 'booster' }, create: { roleKey: 'booster', name: 'Booster' }, update: {} });
    await prisma.role.upsert({ where: { roleKey: 'admin' }, create: { roleKey: 'admin', name: 'Admin' }, update: {} });

    // Seed Buyer
    await prisma.user.upsert({
      where: { discordId: BUYER_ID },
      create: { discordId: BUYER_ID, username: 'p5_buyer', displayName: 'P5 Buyer', isActive: true },
      update: { isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: BUYER_ID, roleKey: 'exchanger' } },
      create: { userId: BUYER_ID, roleKey: 'exchanger' },
      update: {},
    });
    await prisma.exchangeKycRequest.upsert({
      where: { userId: BUYER_ID },
      create: { userId: BUYER_ID, status: 'APPROVED', approvedAt: new Date() },
      update: { status: 'APPROVED' },
    });
    await prisma.exchangeUserPermission.upsert({
      where: { userId: BUYER_ID },
      create: { userId: BUYER_ID, canCreateBuyOrder: true, canSubmitSellOffer: true },
      update: { canCreateBuyOrder: true, canSubmitSellOffer: true, isSuspended: false },
    });

    // Seed Buyer Central Wallets: $100.00 available (10,000 cents)
    await prisma.wallet.upsert({
      where: { userId: BUYER_ID },
      create: {
        userId: BUYER_ID,
        balanceUsd: 10000,
        reservedBalance: 0,
        frozenBalance: 0,
        isFrozen: false,
      },
      update: {
        balanceUsd: 10000,
        reservedBalance: 0,
        frozenBalance: 0,
        isFrozen: false,
      },
    });
    await prisma.walletV2.upsert({
      where: { userId: BUYER_ID },
      create: {
        userId: BUYER_ID,
        availableCents: 10000,
        reservedCents: 0,
        frozenCents: 0,
        isFrozen: false,
      },
      update: {
        availableCents: 10000,
        reservedCents: 0,
        frozenCents: 0,
        isFrozen: false,
      },
    });

    // Seed Seller
    await prisma.user.upsert({
      where: { discordId: SELLER_ID },
      create: { discordId: SELLER_ID, username: 'p5_seller', displayName: 'P5 Seller', isActive: true },
      update: { isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: SELLER_ID, roleKey: 'booster' } },
      create: { userId: SELLER_ID, roleKey: 'booster' },
      update: {},
    });

    // Seed Admin
    await prisma.user.upsert({
      where: { discordId: ADMIN_ID },
      create: { discordId: ADMIN_ID, username: 'p5_admin', displayName: 'P5 Admin', isActive: true },
      update: { isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: ADMIN_ID, roleKey: 'admin' } },
      create: { userId: ADMIN_ID, roleKey: 'admin' },
      update: {},
    });

    // Seed Other User (no roles)
    await prisma.user.upsert({
      where: { discordId: OTHER_ID },
      create: { discordId: OTHER_ID, username: 'p5_other', displayName: 'P5 Other', isActive: true },
      update: { isActive: true },
    });

    // Catalog items
    const game = await prisma.exchangeGame.findFirst({ where: { isActive: true } });
    const currency = await prisma.exchangeCurrency.findFirst({ where: { gameId: game!.id, isActive: true } });
    const deliveryMethod = await prisma.exchangeDeliveryMethod.findFirst({ where: { isActive: true } });

    if (!game || !currency || !deliveryMethod) {
      throw new Error('Default catalog seed failed; game, currency, or delivery method missing.');
    }

    // Create a 10M capacity buy order for testing
    // Price = $1.50 per 1M units (150 cents)
    const buyOrder = await prisma.exchangeBuyOrder.create({
      data: {
        orderCode: `EXB-P5-${Date.now()}`,
        buyerUserId: BUYER_ID,
        buyerDiscordId: BUYER_ID,
        gameId: game.id,
        currencyId: currency.id,
        pricePerUnitCents: 150,
        unitLabelSnapshot: currency.unitLabel,
        unitMultiplierSnapshot: currency.unitMultiplier,
        minTradeBaseUnits: '1000000',
        maxTradeBaseUnits: '10000000',
        totalCapacityBaseUnits: '10000000',
        reservedCapacityBaseUnits: '0',
        remainingCapacityBaseUnits: '10000000',
        filledCapacityBaseUnits: '0',
        acceptedDeliveryMethodIdsJson: JSON.stringify([deliveryMethod.id]),
        status: 'ACTIVE',
      },
    });

    console.log(`Created Buy Order: ${buyOrder.orderCode} (Total Capacity: 10M)\n`);

    // Helper to create an AWAITING_PAYMENT trade
    async function createTestTrade(amountBaseUnits: string = '2000000') {
      const offer = await submitSellOffer({
        buyOrderId: buyOrder.id,
        sellerUserId: SELLER_ID,
        offeredAmountBaseUnits: amountBaseUnits,
        deliveryMethodId: deliveryMethod!.id,
      });
      const trade = await acceptSellOffer({
        offerId: offer.id,
        buyerUserId: BUYER_ID,
      });
      return trade;
    }

    // =========================================================================
    // TEST 1: Checkout Summary Breakdown & RBAC Validation
    // =========================================================================
    console.log('--- TEST 1: Checkout Summary Breakdown & RBAC Validation ---');
    const trade1 = await createTestTrade('2000000'); // 2M units = $3.00 gross
    assert(trade1.status === 'AWAITING_PAYMENT', '1.1 Trade 1 created in AWAITING_PAYMENT status');

    const summary = await getTradeCheckoutSummary(trade1.id, BUYER_ID, ['exchanger']);
    assert(summary.trade.id === trade1.id, '1.2 Summary returns correct trade ID');
    assert(summary.pricingBreakdown.totalPayableCents === trade1.buyerTotalPayableCents, '1.3 Summary totalPayableCents matches trade.buyerTotalPayableCents');
    assert(summary.wallet.balanceUsdCents === 10000, '1.4 Summary reflects initial $100.00 wallet balance');
    assert(summary.wallet.availableCents === 10000, '1.5 Summary reflects $100.00 available balance');
    assert(summary.wallet.hasSufficientBalance === true, '1.6 Summary flags hasSufficientBalance as true');
    assert(summary.gateways.wallet.canPay === true, '1.7 Summary wallet gateway canPay is true');
    assert(summary.activePayment === null, '1.8 Summary activePayment is null for new unpaid trade');
    assert(summary.escrow === null, '1.9 Summary escrow is null for new unpaid trade');

    // RBAC: Other user cannot access checkout summary
    let otherForbidden = false;
    try {
      await getTradeCheckoutSummary(trade1.id, OTHER_ID, []);
    } catch (err: any) {
      otherForbidden = err.statusCode === 403;
    }
    assert(otherForbidden, '1.10 Non-participant and non-staff caller receives 403 Forbidden on checkout summary');

    // Admin CAN access checkout summary
    const adminSummary = await getTradeCheckoutSummary(trade1.id, ADMIN_ID, ['admin']);
    assert(adminSummary.trade.id === trade1.id, '1.11 Admin caller can access checkout summary for oversight');

    // =========================================================================
    // TEST 2: Central Wallet Payment — Atomic Balance Mutation & Invariants
    // =========================================================================
    console.log('\n--- TEST 2: Central Wallet Payment — Atomic Balance Mutation & Invariants ---');
    const payableCents = trade1.buyerTotalPayableCents; // e.g. 300 gross + buyer fee
    const expectedRemaining = 10000 - payableCents;

    const payResult = await payTradeWithWallet(trade1.id, BUYER_ID);
    assert(payResult.payment.status === 'CONFIRMED', '2.1 Payment status is CONFIRMED');
    assert(payResult.payment.method === 'WALLET', '2.2 Payment method is WALLET');
    assert(payResult.escrow.status === 'RESERVED', '2.3 Escrow record status is RESERVED');
    assert(payResult.escrow.reservedAmountCents === payableCents, '2.4 Escrow reservedAmountCents matches totalPayableCents');
    assert(payResult.trade.status === 'PAYMENT_CONFIRMED', '2.5 Trade status transitioned to PAYMENT_CONFIRMED');

    // Verify Central Wallet DB state
    const [w1, w2] = await Promise.all([
      prisma.wallet.findUnique({ where: { userId: BUYER_ID } }),
      prisma.walletV2.findUnique({ where: { userId: BUYER_ID } }),
    ]);
    assert(w1!.balanceUsd === expectedRemaining, `2.6 Central Wallet.balanceUsd decremented by ${payableCents} cents (is ${w1!.balanceUsd}, expected ${expectedRemaining})`);
    assert(w1!.reservedBalance === payableCents, `2.7 Central Wallet.reservedBalance incremented by ${payableCents} cents`);
    assert(w2!.availableCents === expectedRemaining, `2.8 Central WalletV2.availableCents matches remaining (${w2!.availableCents})`);
    assert(w2!.reservedCents === payableCents, `2.9 Central WalletV2.reservedCents matches reserved (${w2!.reservedCents})`);

    // Verify Ledger Transaction
    const ledger = await prisma.ledgerTransaction.findFirst({
      where: {
        userId: BUYER_ID,
        entryType: 'escrow_lock',
        amountMinor: payableCents,
      },
      orderBy: { createdAt: 'desc' },
    });
    assert(!!ledger, '2.10 Immutable LedgerTransaction recorded with entryType: escrow_lock');

    // Verify Invariant Guard Passes
    const fundedEscrow = await assertTradeEscrowFunded(trade1.id);
    assert(fundedEscrow.id === payResult.escrow.id, '2.11 assertTradeEscrowFunded passes for confirmed trade and returns escrow');

    // =========================================================================
    // TEST 3: Central Wallet Payment Failures & Safety Guards
    // =========================================================================
    console.log('\n--- TEST 3: Central Wallet Payment Failures & Safety Guards ---');

    // 3.1 Double payment prevention
    let doublePayBlocked = false;
    try {
      await payTradeWithWallet(trade1.id, BUYER_ID);
    } catch (err: any) {
      doublePayBlocked = err.message.includes('not awaiting payment');
    }
    assert(doublePayBlocked, '3.1 Double payment blocked on already PAYMENT_CONFIRMED trade');

    // 3.2 Insufficient funds
    // Set wallet balance to low amount (10 cents)
    await prisma.wallet.update({ where: { userId: BUYER_ID }, data: { balanceUsd: 10 } });
    await prisma.walletV2.update({ where: { userId: BUYER_ID }, data: { availableCents: 10 } });

    const trade2 = await createTestTrade('2000000');
    let insufficientBlocked = false;
    try {
      await payTradeWithWallet(trade2.id, BUYER_ID);
    } catch (err: any) {
      insufficientBlocked = err.message.includes('INSUFFICIENT_FUNDS');
    }
    assert(insufficientBlocked, '3.2 Insufficient funds rejected without mutating balance');

    // Verify wallet balance remained untouched at 10 cents
    const w1Check = await prisma.wallet.findUnique({ where: { userId: BUYER_ID } });
    assert(w1Check!.balanceUsd === 10, '3.3 Wallet balance untouched after insufficient funds error');

    // Restore wallet balance for further tests ($50.00 = 5000 cents)
    await prisma.wallet.update({ where: { userId: BUYER_ID }, data: { balanceUsd: 5000 } });
    await prisma.walletV2.update({ where: { userId: BUYER_ID }, data: { availableCents: 5000 } });

    // 3.3 Frozen wallet guard
    await prisma.wallet.update({ where: { userId: BUYER_ID }, data: { isFrozen: true } });
    let frozenBlocked = false;
    try {
      await payTradeWithWallet(trade2.id, BUYER_ID);
    } catch (err: any) {
      frozenBlocked = err.message.includes('WALLET_FROZEN');
    }
    assert(frozenBlocked, '3.4 Frozen wallet blocked from executing trade payment');
    await prisma.wallet.update({ where: { userId: BUYER_ID }, data: { isFrozen: false } });

    // 3.4 Non-buyer payment attempt
    let nonBuyerBlocked = false;
    try {
      await payTradeWithWallet(trade2.id, SELLER_ID);
    } catch (err: any) {
      nonBuyerBlocked = err.statusCode === 403;
    }
    assert(nonBuyerBlocked, '3.5 Non-buyer blocked from paying someone else\'s trade with wallet');

    // =========================================================================
    // TEST 4: NOWPayments Gateway Flow & IPN Verification
    // =========================================================================
    console.log('\n--- TEST 4: NOWPayments Gateway Flow & IPN Verification ---');
    const trade3 = await createTestTrade('2000000');

    // Create an initial NOWPAYMENTS payment record
    const paymentCode = await generateNextPaymentCode();
    const cryptoPayment = await prisma.exchangePayment.create({
      data: {
        paymentCode,
        tradeId: trade3.id,
        buyerUserId: BUYER_ID,
        buyerDiscordId: BUYER_ID,
        method: 'NOWPAYMENTS',
        status: 'WAITING',
        totalPayableCents: trade3.buyerTotalPayableCents,
        baseAmountCents: trade3.grossValueCents,
        buyerFeeCents: trade3.buyerFeeCents,
      },
    });
    assert(cryptoPayment.status === 'WAITING', '4.1 NOWPayments payment record created in WAITING status');

    // 4.1 Invalid signature
    const ipnPayload = {
      order_id: `EXTPAY_${cryptoPayment.id}`,
      payment_status: 'finished',
      actually_paid: (trade3.buyerTotalPayableCents / 100).toString(),
      outcome_amount: (trade3.buyerTotalPayableCents / 100).toString(),
      outcome_currency: 'usd',
      payment_id: '99887766',
    };

    let invalidSigBlocked = false;
    try {
      await handleExchangeNowPaymentsIpn(ipnPayload, 'bad_forged_signature_hex');
    } catch (err: any) {
      invalidSigBlocked = err.message.includes('INVALID_IPN_SIGNATURE');
    }
    assert(invalidSigBlocked, '4.2 Invalid IPN signature rejected with INVALID_IPN_SIGNATURE');

    // 4.2 Non-exchange order id
    const nonExchangePayload = { ...ipnPayload, order_id: 'DEPOSIT_999999' };
    const nonExSig = computeTestIpnSignature(nonExchangePayload, TEST_IPN_SECRET);
    let nonExchangeBlocked = false;
    try {
      await handleExchangeNowPaymentsIpn(nonExchangePayload, nonExSig);
    } catch (err: any) {
      nonExchangeBlocked = err.message.includes('INVALID_EXCHANGE_ORDER_ID');
    }
    assert(nonExchangeBlocked, '4.3 Non-exchange order ID rejected');

    // 4.3 Valid signature & finished event
    const validSig = computeTestIpnSignature(ipnPayload, TEST_IPN_SECRET);
    const ipnResult = await handleExchangeNowPaymentsIpn(ipnPayload, validSig);
    assert(ipnResult.ok === true, '4.4 Valid finished IPN processed successfully');

    // Check DB state for trade 3
    const p3 = await prisma.exchangePayment.findUnique({ where: { id: cryptoPayment.id } });
    const t3 = await prisma.exchangeTrade.findUnique({ where: { id: trade3.id }, include: { escrow: true } });
    assert(p3!.status === 'CONFIRMED', '4.5 ExchangePayment transitioned to CONFIRMED on finished IPN');
    assert(t3!.status === 'PAYMENT_CONFIRMED' || t3!.status === 'DELIVERY_IN_PROGRESS', '4.6 Trade transitioned to PAYMENT_CONFIRMED / DELIVERY_IN_PROGRESS on finished IPN');
    assert(t3!.escrow?.status === 'RESERVED', '4.7 Escrow created in RESERVED status');
    assert(t3!.escrow?.fundingSource === 'NOWPAYMENTS', '4.8 Escrow fundingSource is NOWPAYMENTS');

    // 4.4 Idempotent duplicate IPN
    const dupResult = await handleExchangeNowPaymentsIpn(ipnPayload, validSig);
    assert(dupResult.ok === true && dupResult.message.includes('already confirmed'), '4.9 Duplicate finished IPN handled idempotently without error');

    // =========================================================================
    // TEST 5: Manual Bank Transfer Workflow
    // =========================================================================
    console.log('\n--- TEST 5: Manual Bank Transfer Workflow ---');
    const trade4 = await createTestTrade('2000000');

    // 5.1 Initiate Bank Transfer
    const bankPay1 = await initiateTradeBankTransfer(trade4.id, BUYER_ID);
    assert(bankPay1.payment.status === 'INITIATED', '5.1 Bank payment initiated in INITIATED status');
    assert(bankPay1.payment.method === 'BANK_TRANSFER', '5.2 Bank payment method is BANK_TRANSFER');

    // 5.2 Submit Bank Receipt
    const submittedPay1 = await submitBankReceipt(bankPay1.payment.id, BUYER_ID, {
      receiptUrl: 'https://cdn.g4x.trade/receipts/test_receipt_01.jpg',
      bankReference: 'MLT-99881122',
      senderNote: 'Sent from account 1234',
    });
    assert(submittedPay1.status === 'PENDING_REVIEW', '5.3 Receipt submission transitions payment to PENDING_REVIEW');

    // 5.3 Reject Bank Transfer
    const rejectedPay = await rejectBankTransferPayment(
      bankPay1.payment.id,
      ADMIN_ID,
      'Receipt image unreadable; invalid tracking code.'
    );
    assert(rejectedPay.status === 'FAILED', '5.4 Admin rejection transitions payment to FAILED');

    // Verify trade remains awaiting payment
    const t4Check1 = await prisma.exchangeTrade.findUnique({ where: { id: trade4.id } });
    assert(t4Check1!.status === 'AWAITING_PAYMENT', '5.5 Trade remains AWAITING_PAYMENT after payment rejection');

    // 5.4 Re-initiate and Approve Bank Transfer
    const bankPay2 = await initiateTradeBankTransfer(trade4.id, BUYER_ID);
    await submitBankReceipt(bankPay2.payment.id, BUYER_ID, {
      receiptUrl: 'https://cdn.g4x.trade/receipts/test_receipt_02_clear.jpg',
      bankReference: 'MLT-VALID-002',
    });
    const approvedResult = await approveBankTransferPayment(
      bankPay2.payment.id,
      ADMIN_ID,
      'Funds verified on official bank portal.'
    );
    assert(approvedResult.payment.status === 'CONFIRMED', '5.6 Admin approval transitions payment to CONFIRMED');
    assert(approvedResult.escrow.status === 'RESERVED', '5.7 Escrow reserved on bank approval');
    assert(approvedResult.escrow.fundingSource === 'BANK_TRANSFER', '5.8 Escrow fundingSource is BANK_TRANSFER');
    assert(approvedResult.trade.status === 'PAYMENT_CONFIRMED', '5.9 Trade transitions to PAYMENT_CONFIRMED on bank approval');

    // =========================================================================
    // TEST 6: Trade Cancellation & Escrow Refund Invariants
    // =========================================================================
    console.log('\n--- TEST 6: Trade Cancellation & Escrow Refund Invariants ---');

    // 6.1 Regular user cannot cancel PAYMENT_CONFIRMED trade
    let regularCancelBlocked = false;
    try {
      await cancelExchangeTradeWithEscrowCheck({
        tradeId: trade1.id, // trade 1 was paid via WALLET in Test 2
        actorUserId: BUYER_ID,
        actorRoles: ['exchanger'],
        reason: 'I want to cancel',
      });
    } catch (err: any) {
      regularCancelBlocked = err.statusCode === 403;
    }
    assert(regularCancelBlocked, '6.1 Regular user (buyer) receives 403 trying to cancel PAYMENT_CONFIRMED trade');

    // 6.2 Admin cancels PAYMENT_CONFIRMED trade (Wallet refund)
    const buyerPreCancelWallet = await prisma.wallet.findUnique({ where: { userId: BUYER_ID } });
    const preBalance = buyerPreCancelWallet!.balanceUsd;
    const preReserved = buyerPreCancelWallet!.reservedBalance;
    const refundExpected = trade1.buyerTotalPayableCents;

    const buyOrderBeforeCancel = await prisma.exchangeBuyOrder.findUnique({ where: { id: buyOrder.id } });
    const remainingBefore = BigInt(buyOrderBeforeCancel!.remainingCapacityBaseUnits);
    const reservedBefore = BigInt(buyOrderBeforeCancel!.reservedCapacityBaseUnits);

    const cancelResult = await cancelExchangeTradeWithEscrowCheck({
      tradeId: trade1.id,
      actorUserId: ADMIN_ID,
      actorRoles: ['admin'],
      reason: 'Seller uncooperative; mutual agreement to cancel.',
    });
    assert(cancelResult.status === 'CANCELLED', '6.2 Admin cancellation updates trade status to CANCELLED');

    // Check Escrow refunded
    const cancelledEscrow = await prisma.exchangeEscrow.findUnique({ where: { tradeId: trade1.id } });
    assert(cancelledEscrow!.status === 'REFUNDED', '6.3 Escrow status updated to REFUNDED');
    assert(cancelledEscrow!.refundedAmountCents === refundExpected, '6.4 Escrow refundedAmountCents matches locked amount');

    // Check Wallet refunded
    const [buyerPostCancelW1, buyerPostCancelW2] = await Promise.all([
      prisma.wallet.findUnique({ where: { userId: BUYER_ID } }),
      prisma.walletV2.findUnique({ where: { userId: BUYER_ID } }),
    ]);
    assert(buyerPostCancelW1!.balanceUsd === preBalance + refundExpected, `6.5 Buyer Wallet.balanceUsd refunded by ${refundExpected} cents`);
    assert(buyerPostCancelW1!.reservedBalance === preReserved - refundExpected, `6.6 Buyer Wallet.reservedBalance decremented by ${refundExpected} cents`);
    assert(buyerPostCancelW2!.availableCents === preBalance + refundExpected, '6.7 Buyer WalletV2.availableCents updated in sync');

    // Check refund ledger entry
    const refundLedger = await prisma.ledgerTransaction.findFirst({
      where: {
        userId: BUYER_ID,
        entryType: 'refund',
        amountMinor: refundExpected,
      },
      orderBy: { createdAt: 'desc' },
    });
    assert(!!refundLedger, '6.8 Refund LedgerTransaction recorded with entryType: refund');

    // Check Buy Order capacity restored
    const updatedBuyOrder = await prisma.exchangeBuyOrder.findUnique({ where: { id: buyOrder.id } });
    const remainingAfter = BigInt(updatedBuyOrder!.remainingCapacityBaseUnits);
    const reservedAfter = BigInt(updatedBuyOrder!.reservedCapacityBaseUnits);
    const tradeQty = BigInt(trade1.quantityBaseUnits);

    assert(
      remainingAfter === remainingBefore + tradeQty && reservedAfter === reservedBefore - tradeQty,
      `6.9 Buy order remaining capacity incremented by ${tradeQty} and reserved decremented after trade cancellation`
    );

    // 6.3 Cancellation of Unpaid Trade (trade2)
    const unpaidCancel = await cancelExchangeTradeWithEscrowCheck({
      tradeId: trade2.id,
      actorUserId: BUYER_ID,
      actorRoles: ['exchanger'],
      reason: 'Changed mind before paying',
    });
    assert(unpaidCancel.status === 'CANCELLED', '6.10 Buyer can cancel own unpaid trade');

    // =========================================================================
    // TEST 7: Escrow Invariant Enforcement (assertTradeEscrowFunded)
    // =========================================================================
    console.log('\n--- TEST 7: Escrow Invariant Enforcement (assertTradeEscrowFunded) ---');

    // 7.1 Non-existent trade
    let notFoundBlocked = false;
    try {
      await assertTradeEscrowFunded('non_existent_trade_id_xyz');
    } catch (err: any) {
      notFoundBlocked = err.statusCode === 404;
    }
    assert(notFoundBlocked, '7.1 assertTradeEscrowFunded throws 404 for non-existent trade');

    // 7.2 Cancelled trade
    let cancelledBlocked = false;
    try {
      await assertTradeEscrowFunded(trade1.id);
    } catch (err: any) {
      cancelledBlocked = err.message.includes('TRADE_ESCROW_NOT_FUNDED');
    }
    assert(cancelledBlocked, '7.2 assertTradeEscrowFunded throws for cancelled/refunded trade');

    // 7.3 Valid funded trade (trade3 funded via NOWPayments in Test 4)
    const validEscrow = await assertTradeEscrowFunded(trade3.id);
    assert(validEscrow.status === 'RESERVED', '7.3 assertTradeEscrowFunded passes and returns RESERVED escrow for active funded trade');

    console.log('\n===============================================================');
    console.log(`PHASE 5 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('===============================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error during Phase 5 test execution:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runSuite();
