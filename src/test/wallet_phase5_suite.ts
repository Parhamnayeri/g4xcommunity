/**
 * wallet_phase5_suite.ts — Website Phase 5 React Wallet & Deposit Requests Test Suite
 *
 * Verifies:
 *  1. Wallet RBAC authorization (Advertiser, Exchanger, Staff, Manager, Admin, Owner vs unprivileged).
 *  2. Wallet ownership isolation (Staff oversight cannot leak or co-mingle balances).
 *  3. Available / reserved / pending accuracy & separation of financial figures.
 *  4. Authoritative USD/IRT exchange rates and quotes (no 3000 Toman deduction, missing rate blocks quote).
 *  5. Secure receipt uploads (MIME, size, magic bytes, path traversal, owner access protection).
 *  6. Manual IRT deposit creation, duplicate evidence detection, and fail-closed live credit protection.
 *  7. Crypto deposit requests blocked while NOWPAYMENTS_LIVE_COLLECTION_ENABLED=false.
 *  8. Paginated deposit history and double-entry ledger activity.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import prisma from '../database/db';
import { app, sessionStore } from '../web/server';
import {
  RECEIPTS_DIR,
  saveReceiptEvidence,
  getReceiptEvidence,
  verifyReceiptForDeposit,
  deleteReceiptEvidence,
  getAuthoritativeIrtQuote,
  getWalletOverview,
  submitIrtDeposit,
  getUserDepositHistory,
  getUserLedgerActivity,
  adminReviewFunding,
} from '../services/financeV2/walletPageService';
import { creditAvailableCents, getOrCreateWalletV2 } from '../services/financeV2/financeV2WalletService';
import { LedgerV2EntryType } from '../services/financeV2/financeV2Types';
import { getOrCreatePaymentRequestForFunding } from '../services/payment/paymentReconciliationService';

async function createAuthenticatedAgent(userId: string) {
  const agent = request.agent(app);
  const initRes = await agent.get('/api/csrf-token');
  const cookieHeader = initRes.header['set-cookie'];
  const rawCookie = cookieHeader ? cookieHeader[0] : '';
  const match = rawCookie.match(/g4x\.sid=s%3A([^.]+)\./);
  const sid = match ? match[1] : '';

  await new Promise<void>((resolve, reject) => {
    sessionStore.get(sid, (err, sess) => {
      if (err || !sess) return reject(err || new Error('No session'));
      sess.userId = userId;
      sessionStore.set(sid, sess, (setErr) => {
        if (setErr) return reject(setErr);
        resolve();
      });
    });
  });

  return { agent, sid, csrfToken: initRes.body?.csrfToken };
}

// 1x1 transparent PNG base64 for testing valid receipt uploads
const VALID_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Fake corrupted file claiming to be PNG
const CORRUPT_PNG_BASE64 = 'data:image/png;base64,VEVTVA==';

async function runWalletPhase5Suite() {
  console.log('=== STARTING WEBSITE PHASE 5: REACT WALLET & DEPOSIT REQUESTS SUITE ===\n');

  // Test User IDs
  const userAdvertiser = 'w5_user_adv_01';
  const userExchanger = 'w5_user_exc_02';
  const userStaff = 'w5_user_stf_03';
  const userManager = 'w5_user_mng_04';
  const userAdmin = 'w5_user_adm_05';
  const userOwner = 'w5_user_own_06';
  const userBoosterOnly = 'w5_user_bst_07';
  const userVictim = 'w5_user_vic_08';

  const allTestUsers = [
    userAdvertiser,
    userExchanger,
    userStaff,
    userManager,
    userAdmin,
    userOwner,
    userBoosterOnly,
    userVictim,
  ];

  try {
    // ─── 0. Seed Test Users, Roles, and Financial Configuration ─────────────
    for (const uid of allTestUsers) {
      await prisma.user.upsert({
        where: { discordId: uid },
        update: { isActive: true },
        create: {
          discordId: uid,
          username: `TestUser_${uid}`,
          isActive: true,
        },
      });
    }

    // Clean any prior state for test users
    await prisma.ledgerEntryV2.deleteMany({ where: { userId: { in: allTestUsers } } });
    await prisma.advertiserFundingRequest.deleteMany({ where: { advertiserId: { in: allTestUsers } } });
    await prisma.paymentRequest.deleteMany({ where: { userId: { in: allTestUsers } } });
    await prisma.walletV2.deleteMany({ where: { userId: { in: allTestUsers } } });

    // Role mapping
    const roleAssignments: [string, string][] = [
      [userAdvertiser, 'advertiser'],
      [userExchanger, 'exchanger'],
      [userStaff, 'staff'],
      [userManager, 'manager'],
      [userAdmin, 'admin'],
      [userOwner, 'owner'],
      [userBoosterOnly, 'booster'],
    ];

    for (const [uid, roleKey] of roleAssignments) {
      await prisma.role.upsert({
        where: { roleKey },
        update: { name: roleKey.toUpperCase() },
        create: { roleKey, name: roleKey.toUpperCase() },
      });
      await prisma.userRole.upsert({
        where: { userId_roleKey: { userId: uid, roleKey } },
        update: {},
        create: { userId: uid, roleKey },
      });
    }

    // Configure Authoritative SystemFinancialConfig
    await prisma.systemFinancialConfig.upsert({
      where: { key: 'admin_usd_irt_rate' },
      update: { value: '95000' },
      create: { key: 'admin_usd_irt_rate', value: '95000', description: 'Authoritative USD to IRT exchange rate' },
    });

    await prisma.systemFinancialConfig.upsert({
      where: { key: 'incoming_irt_fee_rate' },
      update: { value: '0.015' }, // 1.5% fee
      create: { key: 'incoming_irt_fee_rate', value: '0.015', description: 'Incoming IRT deposit fee rate' },
    });

    await prisma.systemFinancialConfig.upsert({
      where: { key: 'irt_bank_name' },
      update: { value: 'Bank Melli Iran - VIP Treasury' },
      create: { key: 'irt_bank_name', value: 'Bank Melli Iran - VIP Treasury' },
    });

    await prisma.systemFinancialConfig.upsert({
      where: { key: 'irt_bank_card_number' },
      update: { value: '6037-9918-1234-5678' },
      create: { key: 'irt_bank_card_number', value: '6037-9918-1234-5678' },
    });

    await prisma.systemFinancialConfig.upsert({
      where: { key: 'irt_bank_card_holder' },
      update: { value: 'G4X Community Official Treasury' },
      create: { key: 'irt_bank_card_holder', value: 'G4X Community Official Treasury' },
    });

    console.log('[Setup] Test users and financial configuration seeded successfully.\n');

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 1: Wallet Authorization & RBAC Guard
    // ═════════════════════════════════════════════════════════════════════════
    console.log('--- TEST 1: Wallet RBAC Authorization Guard ---');

    // 1.1 Unauthenticated request returns 401
    const unauthRes = await request(app).get('/api/wallet/overview');
    assert.strictEqual(unauthRes.status, 401, '1.1 Unauthenticated request must return 401 Unauthorized');

    // 1.2 Booster-only user receives 403 ACCESS_DENIED
    const boosterClient = await createAuthenticatedAgent(userBoosterOnly);
    const boosterRes = await boosterClient.agent.get('/api/wallet/overview');
    assert.strictEqual(boosterRes.status, 403, '1.2 Booster-only user must be rejected with 403');
    assert.strictEqual(boosterRes.body.error, 'ACCESS_DENIED', '1.2 Error code must be ACCESS_DENIED');

    // 1.3 Advertiser succeeds (200)
    const advClient = await createAuthenticatedAgent(userAdvertiser);
    const advRes = await advClient.agent.get('/api/wallet/overview');
    assert.strictEqual(advRes.status, 200, '1.3 Advertiser access must return 200 OK');
    assert.strictEqual(advRes.body.success, true);
    assert.strictEqual(advRes.body.user.discordId, userAdvertiser);

    // 1.4 Exchanger succeeds (200)
    const excClient = await createAuthenticatedAgent(userExchanger);
    const excRes = await excClient.agent.get('/api/wallet/overview');
    assert.strictEqual(excRes.status, 200, '1.4 Exchanger access must return 200 OK');

    // 1.5 Staff succeeds (200)
    const staffClient = await createAuthenticatedAgent(userStaff);
    const staffRes = await staffClient.agent.get('/api/wallet/overview');
    assert.strictEqual(staffRes.status, 200, '1.5 Staff access must return 200 OK');

    // 1.6 Manager succeeds (200)
    const mngClient = await createAuthenticatedAgent(userManager);
    const mngRes = await mngClient.agent.get('/api/wallet/overview');
    assert.strictEqual(mngRes.status, 200, '1.6 Manager access must return 200 OK');

    // 1.7 Admin succeeds (200)
    const admClient = await createAuthenticatedAgent(userAdmin);
    const admRes = await admClient.agent.get('/api/wallet/overview');
    assert.strictEqual(admRes.status, 200, '1.7 Admin access must return 200 OK');

    // 1.8 Owner succeeds (200)
    const ownClient = await createAuthenticatedAgent(userOwner);
    const ownRes = await ownClient.agent.get('/api/wallet/overview');
    assert.strictEqual(ownRes.status, 200, '1.8 Owner access must return 200 OK');
    console.log('✅ TEST 1 PASSED: Role-based wallet authorization correctly enforced.\n');

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 2: Wallet Ownership Isolation & Balance Invariants
    // ═════════════════════════════════════════════════════════════════════════
    console.log('--- TEST 2: Wallet Ownership Isolation & Invariant Checks ---');

    // Credit $50 (5000 cents) to userAdvertiser
    await creditAvailableCents(userAdvertiser, 5000, LedgerV2EntryType.ADVERTISER_DEPOSIT, {
      description: 'Test seed credit for advertiser',
    });

    const advOverview = await advClient.agent.get('/api/wallet/overview');
    assert.strictEqual(advOverview.body.wallet.availableCents, 5000, '2.1 Advertiser available balance is 5000 cents');
    assert.strictEqual(advOverview.body.wallet.availableUsd, '50.00', '2.1 Formatted available USD is 50.00');

    // Check that userExchanger still has 0 balance (no balance leakage)
    const excOverview = await excClient.agent.get('/api/wallet/overview');
    assert.strictEqual(excOverview.body.wallet.availableCents, 0, '2.2 Exchanger balance must be isolated (0 cents)');

    // Staff user overview must reflect staff member's own wallet, not advertiser's
    const staffOverview = await staffClient.agent.get('/api/wallet/overview');
    assert.strictEqual(staffOverview.body.wallet.availableCents, 0, '2.3 Staff member wallet reflects own balance (0 cents)');
    assert.strictEqual(staffOverview.body.user.discordId, userStaff);

    // Verify user without wallet record auto-initializes WalletV2 without error
    const vicClient = await createAuthenticatedAgent(userVictim);
    // Give victim advertiser role to access wallet
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: userVictim, roleKey: 'advertiser' } },
      update: {},
      create: { userId: userVictim, roleKey: 'advertiser' },
    });
    const vicOverview = await vicClient.agent.get('/api/wallet/overview');
    assert.strictEqual(vicOverview.body.wallet.availableCents, 0, '2.4 Newly initialized wallet has 0 available cents');
    assert.strictEqual(vicOverview.body.wallet.reservedCents, 0, '2.4 Newly initialized wallet has 0 reserved cents');
    console.log('✅ TEST 2 PASSED: Wallet ownership isolation and invariants verified.\n');

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 3: Authoritative Exchange Rates & IRT Quotes
    // ═════════════════════════════════════════════════════════════════════════
    console.log('--- TEST 3: Authoritative USD/IRT Rates & Quote Calculations ---');

    // 3.1 Standard quote for $10 (1000 cents)
    const quoteRes = await advClient.agent.get('/api/wallet/quote/irt?amountCents=1000');
    assert.strictEqual(quoteRes.status, 200, '3.1 Quote calculation returns 200 OK');
    assert.strictEqual(quoteRes.body.quote.targetUsdCents, 1000);
    assert.strictEqual(quoteRes.body.quote.adminUsdIrtRate, 95000);
    assert.strictEqual(quoteRes.body.quote.incomingIrtFeeRate, 0.015);
    assert.strictEqual(quoteRes.body.quote.baseIrtAmount, 950000); // 10 * 95000
    assert.strictEqual(quoteRes.body.quote.feeIrtAmount, 14250); // 950000 * 0.015
    assert.strictEqual(quoteRes.body.quote.totalIrtAmount, 964250); // 950000 + 14250

    // 3.2 Crucial check: Withdrawal 3000 Toman discount is NOT applied to deposits!
    assert.strictEqual(
      quoteRes.body.quote.adminUsdIrtRate,
      95000,
      '3.2 Incoming deposit quote must use full 95,000 Toman rate without 3,000 Toman booster discount'
    );

    // 3.3 Quote based on Toman amount (964,250 Toman equates to 1000 USD cents)
    const tomanQuoteRes = await advClient.agent.get('/api/wallet/quote/irt?amountToman=964250');
    assert.strictEqual(tomanQuoteRes.status, 200);
    assert.strictEqual(tomanQuoteRes.body.targetUsdCents, 1000);

    // 3.4 Missing rate configuration blocks quote generation (fail-closed)
    await prisma.systemFinancialConfig.delete({ where: { key: 'admin_usd_irt_rate' } });
    const missingRateRes = await advClient.agent.get('/api/wallet/quote/irt?amountCents=1000');
    assert.strictEqual(missingRateRes.status, 400);
    assert(missingRateRes.body.error.includes('MISSING_EXCHANGE_RATE'), '3.4 Missing rate must block quote');

    // Restore rate
    await prisma.systemFinancialConfig.create({
      data: { key: 'admin_usd_irt_rate', value: '95000', description: 'Authoritative USD to IRT rate' },
    });
    console.log('✅ TEST 3 PASSED: Exchange rates and quote calculations strictly verified.\n');

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 4: Secure Receipt Upload & Non-public Storage
    // ═════════════════════════════════════════════════════════════════════════
    console.log('--- TEST 4: Secure Receipt Upload & Access Restrictions ---');

    // 4.1 Missing CSRF rejected
    const uncsrfRes = await advClient.agent
      .post('/api/wallet/receipts/upload')
      .send({ fileData: VALID_PNG_BASE64, fileName: 'screenshot.png' });
    assert.strictEqual(uncsrfRes.status, 403, '4.1 Missing CSRF token rejected with 403');

    // 4.2 Disallowed MIME type rejected
    const badMimeRes = await advClient.agent
      .post('/api/wallet/receipts/upload')
      .set('x-csrf-token', advClient.csrfToken)
      .send({ fileData: 'data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA//8AALgAAAAAAAAAQAA=', fileName: 'malware.exe' });
    assert.strictEqual(badMimeRes.status, 400, '4.2 Executable upload rejected with 400');
    assert(badMimeRes.body.error.includes('DISALLOWED_FILE_TYPE'));

    // 4.3 Corrupt image magic bytes rejected
    const corruptRes = await advClient.agent
      .post('/api/wallet/receipts/upload')
      .set('x-csrf-token', advClient.csrfToken)
      .send({ fileData: CORRUPT_PNG_BASE64, fileName: 'corrupt.png' });
    assert.strictEqual(corruptRes.status, 400, '4.3 Corrupt image magic bytes rejected with 400');
    assert(corruptRes.body.error.includes('CORRUPTED_OR_DISALLOWED_IMAGE'));

    // 4.4 Valid PNG receipt upload succeeds
    const uploadRes = await advClient.agent
      .post('/api/wallet/receipts/upload')
      .set('x-csrf-token', advClient.csrfToken)
      .send({ fileData: VALID_PNG_BASE64, fileName: 'bank_transfer_receipt.png' });
    assert.strictEqual(uploadRes.status, 201, '4.4 Valid PNG upload created with 201');
    assert.strictEqual(uploadRes.body.success, true);
    assert(uploadRes.body.fileKey.startsWith('receipt_'), '4.4 File key must have random UUID naming');
    assert(uploadRes.body.fileKey.endsWith('.png'));

    const uploadedFileKey = uploadRes.body.fileKey;

    // Verify file exists in non-public storage
    const physicalPath = path.join(RECEIPTS_DIR, uploadedFileKey);
    assert(fs.existsSync(physicalPath), '4.4 Physical receipt file exists in data/receipts');

    // 4.5 Path traversal attempt blocked
    const traversalRes = await advClient.agent.get('/api/wallet/receipts/..%2f..%2fpackage.json');
    assert([400, 403, 404].includes(traversalRes.status), '4.5 Path traversal attempt blocked');

    // 4.6 Owner access: userAdvertiser can view own receipt
    const ownerViewRes = await advClient.agent.get(`/api/wallet/receipts/${uploadedFileKey}`);
    assert.strictEqual(ownerViewRes.status, 200, '4.6 Uploader can view own receipt');
    assert.strictEqual(ownerViewRes.header['content-type'], 'image/png');

    // 4.7 Unauthorized access: userVictim cannot view userAdvertiser's receipt
    const unauthorizedViewRes = await vicClient.agent.get(`/api/wallet/receipts/${uploadedFileKey}`);
    assert.strictEqual(unauthorizedViewRes.status, 403, '4.7 Unauthorized user must be blocked with 403 Forbidden');
    assert(unauthorizedViewRes.body.error === 'FORBIDDEN');

    // 4.8 Privileged access: Admin, Manager, and Owner can view user's receipt for verification
    const adminViewRes = await admClient.agent.get(`/api/wallet/receipts/${uploadedFileKey}`);
    assert.strictEqual(adminViewRes.status, 200, '4.8 Admin can view receipt for verification');
    assert.strictEqual(adminViewRes.header['cache-control'], 'private, no-cache, no-store, must-revalidate');

    const mngViewRes = await mngClient.agent.get(`/api/wallet/receipts/${uploadedFileKey}`);
    assert.strictEqual(mngViewRes.status, 200, '4.8 Manager can view receipt for verification');

    const ownViewRes = await ownClient.agent.get(`/api/wallet/receipts/${uploadedFileKey}`);
    assert.strictEqual(ownViewRes.status, 200, '4.8 Owner can view receipt for verification');

    // 4.8b Generic staff access must be blocked by policy (no FINANCE_ADMIN_VIEW or FINANCE_ADJUST)
    const staffViewRes = await staffClient.agent.get(`/api/wallet/receipts/${uploadedFileKey}`);
    assert.strictEqual(staffViewRes.status, 403, '4.8b Generic staff access must be blocked with 403');

    // 4.9 Missing receipt metadata fails closed (403)
    const orphanKey = `receipt_${Date.now()}_aabbccddeeff0011.png`;
    fs.writeFileSync(path.join(RECEIPTS_DIR, orphanKey), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const orphanRes = await advClient.agent.get(`/api/wallet/receipts/${orphanKey}`);
    assert.strictEqual(orphanRes.status, 403, '4.9 Missing metadata fails closed with 403');
    fs.unlinkSync(path.join(RECEIPTS_DIR, orphanKey));

    // 4.10 Corrupted metadata JSON fails closed (403)
    const corruptKey = `receipt_${Date.now()}_aabbccddeeff0022.png`;
    fs.writeFileSync(path.join(RECEIPTS_DIR, corruptKey), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    fs.writeFileSync(path.join(RECEIPTS_DIR, `${corruptKey}.meta.json`), '{ bad_json: ');
    const corruptMetaRes = await advClient.agent.get(`/api/wallet/receipts/${corruptKey}`);
    assert.strictEqual(corruptMetaRes.status, 403, '4.10 Corrupted metadata JSON fails closed with 403');
    fs.unlinkSync(path.join(RECEIPTS_DIR, corruptKey));
    fs.unlinkSync(path.join(RECEIPTS_DIR, `${corruptKey}.meta.json`));

    // 4.11 Forged or invalid receipt key format rejected with 400
    const forgedKeyRes = await advClient.agent.get('/api/wallet/receipts/forged_receipt.png');
    assert.strictEqual(forgedKeyRes.status, 400, '4.11 Forged receipt format rejected with 400');
    console.log('✅ TEST 4 PASSED: Secure non-public receipt upload, metadata fail-closed and access isolation verified.\n');

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 5: Manual IRT Deposit Request & Duplicate Evidence Prevention
    // ═════════════════════════════════════════════════════════════════════════
    console.log('--- TEST 5: Manual IRT Deposit Submission & Verification ---');

    const trackingRef = `TRACK_DEP_${Date.now()}_9988`;

    // 5.1 Submit valid deposit request
    const depositSubmitRes = await advClient.agent
      .post('/api/wallet/deposits/irt')
      .set('x-csrf-token', advClient.csrfToken)
      .send({
        targetUsdCents: 2000, // $20
        evidenceRef: trackingRef,
        payerIdentifier: 'Mohammad Alavi 6037991812344321',
        senderCardLast4: '4321',
        receiptFileKey: uploadedFileKey,
        paymentDate: '2026-11-02',
        adminNotes: 'Mobile banking transfer',
        expectedExchangeRate: 95000,
        expectedTotalIrt: 1928500, // 20 * 95000 * 1.015
      });

    assert.strictEqual(depositSubmitRes.status, 201, '5.1 IRT deposit submission created with 201');
    assert.strictEqual(depositSubmitRes.body.success, true);
    assert.strictEqual(depositSubmitRes.body.fundingRequest.status, 'PENDING_ADMIN_VERIFICATION');

    const fundingId = depositSubmitRes.body.fundingRequest.id;

    // Verify atomic creation: PaymentRequest and PaymentAttempt must exist in database!
    const linkedPaymentReq = await prisma.paymentRequest.findFirst({
      where: { fundingRequestId: fundingId },
      include: { attempts: true },
    });
    assert(linkedPaymentReq, '5.1 PaymentRequest must be created atomically');
    assert.strictEqual(linkedPaymentReq.attempts.length, 1, '5.1 PaymentAttempt must be created atomically');
    assert.strictEqual(linkedPaymentReq.attempts[0].trackingNumber, trackingRef);

    // 5.2 Crucial check: Submitting receipt evidence does NOT credit wallet!
    const balanceCheck = await advClient.agent.get('/api/wallet/overview');
    assert.strictEqual(
      balanceCheck.body.wallet.availableCents,
      5000,
      '5.2 Wallet available balance must NOT increase merely because receipt was submitted (still 5000 cents)'
    );

    // 5.3 Conflicting amount on retry rejection
    const duplicateSubmitRes = await advClient.agent
      .post('/api/wallet/deposits/irt')
      .set('x-csrf-token', advClient.csrfToken)
      .send({
        targetUsdCents: 3000,
        evidenceRef: trackingRef,
        payerIdentifier: 'Mohammad Alavi',
      });
    assert.strictEqual(duplicateSubmitRes.status, 400, '5.3 Conflicting amount on retry must be rejected with 400');
    assert(duplicateSubmitRes.body.error.includes('CONFLICTING_DEPOSIT_RETRY'));

    // 5.3b Same-user identical request retry (Idempotent Recovery without new liability)
    const identicalRetryRes = await advClient.agent
      .post('/api/wallet/deposits/irt')
      .set('x-csrf-token', advClient.csrfToken)
      .send({
        targetUsdCents: 2000,
        evidenceRef: trackingRef,
        payerIdentifier: 'Mohammad Alavi 6037991812344321',
        receiptFileKey: uploadedFileKey,
        senderCardLast4: '4321',
        paymentDate: '2026-11-02',
        expectedExchangeRate: 95000,
        expectedTotalIrt: 1928500,
      });
    assert.strictEqual(identicalRetryRes.status, 201, '5.3b Same-user identical retry must succeed');
    assert.strictEqual(identicalRetryRes.body.success, true);
    assert.strictEqual(identicalRetryRes.body.fundingRequest.id, fundingId, '5.3b Must return existing funding request');
    assert.strictEqual(identicalRetryRes.body.paymentRequest.id, linkedPaymentReq!.id, '5.3b Must return existing paymentRequest');
    assert.strictEqual(identicalRetryRes.body.paymentAttempt.id, linkedPaymentReq!.attempts[0].id, '5.3b Must return exact matching PaymentAttempt');

    // Verify liability count is strictly 1 (no duplicate liability)
    const liabilityCount = await prisma.advertiserFundingRequest.count({
      where: { evidenceRef: trackingRef },
    });
    assert.strictEqual(liabilityCount, 1, '5.3b Liability count must remain exactly 1 after retry');

    // Verify balance is untouched (no phantom credit on retry)
    const retryBalanceCheck = await advClient.agent.get('/api/wallet/overview');
    assert.strictEqual(
      retryBalanceCheck.body.wallet.availableCents,
      5000,
      '5.3b Balance must NOT be credited on retry (still 5000 cents)'
    );

    // 5.3c Retry with conflicting/unrelated PaymentAttempt rejected
    const conflictEvidence = `TRACK_CONFLICT_${Date.now()}`;
    const conflictFunding = await prisma.advertiserFundingRequest.create({
      data: {
        fundingRef: `FUND_CONF_${Date.now()}`,
        advertiserId: userAdvertiser,
        fundingMethod: 'IRT',
        status: 'PENDING_ADMIN_VERIFICATION',
        targetUsdCents: 1000,
        externalCurrency: 'IRT',
        externalAmountUnits: '964250',
        exchangeRate: 95000,
        currencyPurchaseFeeRate: 0.015,
        feeAmountUnits: '14250',
        evidenceRef: conflictEvidence,
        payerIdentifier: 'Conflict Depositor',
      },
    });
    const conflictPayReq = await getOrCreatePaymentRequestForFunding(conflictFunding.id, userAdvertiser);
    // Create an unrelated/conflicting PaymentAttempt (different tracking number)
    await prisma.paymentAttempt.create({
      data: {
        attemptRef: `ATT_CONF_${Date.now()}`,
        paymentRequestId: conflictPayReq.id,
        method: 'CARD_TO_CARD_IRT',
        provider: 'MANUAL_BANK',
        status: 'pending',
        trackingNumber: 'UNRELATED_TRACKING_12345',
        paidAmountIrt: '964250',
        expectedAmount: '964250',
        expectedCurrency: 'IRT',
        exchangeRate: 95000,
      },
    });

    const unrelatedAttemptRetryRes = await advClient.agent
      .post('/api/wallet/deposits/irt')
      .set('x-csrf-token', advClient.csrfToken)
      .send({
        targetUsdCents: 1000,
        evidenceRef: conflictEvidence,
        payerIdentifier: 'Conflict Depositor',
      });
    assert.strictEqual(unrelatedAttemptRetryRes.status, 400, '5.3c Retry with conflicting attempt rejected with 400');
    assert(unrelatedAttemptRetryRes.body.error.includes('CONFLICTING_DEPOSIT_RETRY'));

    // 5.3d Retry on deposit flagged with legacyEvidenceResolution requires manual reconciliation
    const flaggedEvidence = `TRACK_FLAGGED_${Date.now()}`;
    await prisma.advertiserFundingRequest.create({
      data: {
        fundingRef: `FUND_FLAGGED_${Date.now()}`,
        advertiserId: userAdvertiser,
        fundingMethod: 'IRT',
        status: 'PENDING_ADMIN_VERIFICATION',
        targetUsdCents: 1000,
        externalCurrency: 'IRT',
        externalAmountUnits: '964250',
        exchangeRate: 95000,
        currencyPurchaseFeeRate: 0.015,
        feeAmountUnits: '14250',
        evidenceRef: flaggedEvidence,
        payerIdentifier: 'Flagged Depositor',
        legacyEvidenceResolution: 'LEGACY_CONFLICT_MANUAL_RECONCILIATION_REQUIRED',
      },
    });

    const flaggedRetryRes = await advClient.agent
      .post('/api/wallet/deposits/irt')
      .set('x-csrf-token', advClient.csrfToken)
      .send({
        targetUsdCents: 1000,
        evidenceRef: flaggedEvidence,
        payerIdentifier: 'Flagged Depositor',
      });
    assert.strictEqual(flaggedRetryRes.status, 400, '5.3d Retry on flagged duplicate rejected with 400');
    assert(flaggedRetryRes.body.error.includes('DEPOSIT_REQUIRES_MANUAL_RECONCILIATION'));

    // 5.3e Different user duplicate tracking reference rejection
    const diffUserSubmitRes = await vicClient.agent
      .post('/api/wallet/deposits/irt')
      .set('x-csrf-token', vicClient.csrfToken)
      .send({
        targetUsdCents: 2000,
        evidenceRef: trackingRef,
        payerIdentifier: 'Victim User',
      });
    assert.strictEqual(diffUserSubmitRes.status, 400, '5.3c Different user duplicate tracking reference rejected');
    assert(diffUserSubmitRes.body.error.includes('DUPLICATE_DEPOSIT_EVIDENCE'));

    // 5.4 Foreign receipt key rejection: userVictim cannot submit userAdvertiser's uploaded receipt
    const foreignReceiptSubmitRes = await vicClient.agent
      .post('/api/wallet/deposits/irt')
      .set('x-csrf-token', vicClient.csrfToken)
      .send({
        targetUsdCents: 1000,
        evidenceRef: `TRACK_VIC_${Date.now()}`,
        payerIdentifier: 'Victim User',
        receiptFileKey: uploadedFileKey,
      });
    assert.strictEqual(foreignReceiptSubmitRes.status, 400, '5.4 Foreign receipt submission rejected with 400');
    assert(foreignReceiptSubmitRes.body.error.includes('RECEIPT_OWNERSHIP_MISMATCH'));

    // 5.5 Receipt reuse across different deposits rejected: userAdvertiser cannot attach same receipt twice
    const reusedReceiptSubmitRes = await advClient.agent
      .post('/api/wallet/deposits/irt')
      .set('x-csrf-token', advClient.csrfToken)
      .send({
        targetUsdCents: 1000,
        evidenceRef: `TRACK_REUSE_${Date.now()}`,
        payerIdentifier: 'Mohammad Alavi',
        receiptFileKey: uploadedFileKey,
      });
    assert.strictEqual(reusedReceiptSubmitRes.status, 400, '5.5 Receipt reuse across different deposits rejected');
    assert(reusedReceiptSubmitRes.body.error.includes('DUPLICATE_RECEIPT_REUSE'));

    // 5.5b Retrying previously credited deposit rejected
    const creditedEvidence = `TRACK_CRED_${Date.now()}`;
    await prisma.advertiserFundingRequest.create({
      data: {
        fundingRef: `FUND_CRED_${Date.now()}`,
        advertiserId: userAdvertiser,
        fundingMethod: 'IRT',
        status: 'CONFIRMED_CREDITED',
        targetUsdCents: 1000,
        externalCurrency: 'IRT',
        externalAmountUnits: '964250',
        exchangeRate: 95000,
        currencyPurchaseFeeRate: 0.015,
        feeAmountUnits: '14250',
        evidenceRef: creditedEvidence,
        payerIdentifier: 'Credited Depositor',
      },
    });

    const retryCreditedRes = await advClient.agent
      .post('/api/wallet/deposits/irt')
      .set('x-csrf-token', advClient.csrfToken)
      .send({
        targetUsdCents: 1000,
        evidenceRef: creditedEvidence,
        payerIdentifier: 'Credited Depositor',
      });
    assert.strictEqual(retryCreditedRes.status, 400, '5.5b Retrying previously credited deposit rejected');
    assert(retryCreditedRes.body.error.includes('already approved and credited'));

    // 5.5c Retrying previously rejected deposit rejected
    const rejectedEvidence = `TRACK_REJ_${Date.now()}`;
    await prisma.advertiserFundingRequest.create({
      data: {
        fundingRef: `FUND_REJ_${Date.now()}`,
        advertiserId: userAdvertiser,
        fundingMethod: 'IRT',
        status: 'REJECTED',
        targetUsdCents: 1000,
        externalCurrency: 'IRT',
        externalAmountUnits: '964250',
        exchangeRate: 95000,
        currencyPurchaseFeeRate: 0.015,
        feeAmountUnits: '14250',
        evidenceRef: rejectedEvidence,
        payerIdentifier: 'Rejected Depositor',
      },
    });

    const retryRejectedRes = await advClient.agent
      .post('/api/wallet/deposits/irt')
      .set('x-csrf-token', advClient.csrfToken)
      .send({
        targetUsdCents: 1000,
        evidenceRef: rejectedEvidence,
        payerIdentifier: 'Rejected Depositor',
      });
    assert.strictEqual(retryRejectedRes.status, 400, '5.5c Retrying previously rejected deposit rejected');
    assert(retryRejectedRes.body.error.includes('DEPOSIT_PREVIOUSLY_REJECTED'));

    // 5.6 Rate manipulation rejection: client cannot submit a stale or tampered exchange rate
    const tamperedRateSubmitRes = await advClient.agent
      .post('/api/wallet/deposits/irt')
      .set('x-csrf-token', advClient.csrfToken)
      .send({
        targetUsdCents: 1000,
        evidenceRef: `TRACK_RATE_${Date.now()}`,
        payerIdentifier: 'Mohammad Alavi',
        expectedExchangeRate: 50000, // Tampered rate! Authoritative is 95000
      });
    assert.strictEqual(tamperedRateSubmitRes.status, 400, '5.6 Tampered exchange rate rejected with 400');
    assert(tamperedRateSubmitRes.body.error.includes('STALE_OR_INVALID_RATE'));

    // 5.7 Expired quote rejection
    const expiredQuoteSubmitRes = await advClient.agent
      .post('/api/wallet/deposits/irt')
      .set('x-csrf-token', advClient.csrfToken)
      .send({
        targetUsdCents: 1000,
        evidenceRef: `TRACK_EXP_${Date.now()}`,
        payerIdentifier: 'Mohammad Alavi',
        quoteExpiresAt: '2020-01-01T00:00:00.000Z',
      });
    assert.strictEqual(expiredQuoteSubmitRes.status, 400, '5.7 Expired quote rejected with 400');
    assert(expiredQuoteSubmitRes.body.error.includes('EXPIRED_QUOTE'));

    // 5.8 Idempotent recovery for partial legacy request
    const legacyEvidence = `LEGACY_PARTIAL_${Date.now()}`;
    const legacyFunding = await prisma.advertiserFundingRequest.create({
      data: {
        fundingRef: `FUND_LEGACY_${Date.now()}`,
        advertiserId: userAdvertiser,
        fundingMethod: 'IRT',
        status: 'PENDING_ADMIN_VERIFICATION',
        targetUsdCents: 1500,
        externalCurrency: 'IRT',
        externalAmountUnits: '1446375',
        exchangeRate: 95000,
        currencyPurchaseFeeRate: 0.015,
        feeAmountUnits: '21375',
        evidenceRef: legacyEvidence,
        payerIdentifier: 'Legacy Depositor',
      },
    });

    // Retrying submission for the legacy partial funding recovers missing PaymentRequest/PaymentAttempt
    const recoveryRes = await submitIrtDeposit({
      userId: userAdvertiser,
      targetUsdCents: 1500,
      evidenceRef: legacyEvidence,
      payerIdentifier: 'Legacy Depositor',
    });
    assert.strictEqual(recoveryRes.success, true);
    assert.strictEqual(recoveryRes.fundingRequest.id, legacyFunding.id, '5.8 Must reuse existing funding record');
    assert(recoveryRes.paymentRequest, '5.8 Must create recovered PaymentRequest');
    assert(recoveryRes.paymentAttempt, '5.8 Must create recovered PaymentAttempt');

    // 5.9 Concurrency safety: simultaneous submissions with same evidence
    const concurrentEvidence = `CONCURRENT_DEP_${Date.now()}`;
    const [c1, c2] = await Promise.allSettled([
      submitIrtDeposit({
        userId: userAdvertiser,
        targetUsdCents: 1000,
        evidenceRef: concurrentEvidence,
        payerIdentifier: 'Concurrent Payer 1',
      }),
      submitIrtDeposit({
        userId: userVictim,
        targetUsdCents: 1000,
        evidenceRef: concurrentEvidence,
        payerIdentifier: 'Concurrent Payer 2',
      }),
    ]);
    const fulfilledCount = [c1, c2].filter((r) => r.status === 'fulfilled').length;
    const rejectedCount = [c1, c2].filter((r) => r.status === 'rejected').length;
    assert.strictEqual(fulfilledCount, 1, '5.9 Exactly one concurrent deposit submission succeeds');
    assert.strictEqual(rejectedCount, 1, '5.9 Exactly one concurrent deposit submission is rejected');

    // 5.9b Missing receipt metadata fail-closed
    const dummyKey = `receipt_${Date.now()}_0123456789abcdef.png`;
    const dummyFilePath = path.join(RECEIPTS_DIR, dummyKey);
    fs.writeFileSync(dummyFilePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await assert.rejects(
      async () => {
        await verifyReceiptForDeposit(dummyKey, userAdvertiser);
      },
      (err: any) => err.message.includes('INVALID_RECEIPT_METADATA'),
      '5.9b Missing receipt metadata must fail closed'
    );
    if (fs.existsSync(dummyFilePath)) {
      fs.unlinkSync(dummyFilePath);
    }

    // 5.10 Audit protection against deleting in-use receipt
    await assert.rejects(
      async () => {
        await deleteReceiptEvidence(uploadedFileKey, {
          discordId: userAdvertiser,
          username: 'adv',
          userRoles: [{ roleKey: 'advertiser' }],
        } as any);
      },
      (err: any) => err.message.includes('RECEIPT_IN_ACTIVE_USE'),
      '5.10 Cannot delete receipt that is linked to active deposit request'
    );

    // 5.11 Unauthorized user cannot verify deposit
    const unauthReviewRes = await vicClient.agent
      .post(`/api/wallet/admin/deposits/${fundingId}/review`)
      .set('x-csrf-token', vicClient.csrfToken)
      .send({ action: 'APPROVE', notes: 'Unauthorized attempt' });
    assert.strictEqual(unauthReviewRes.status, 403, '5.11 Non-admin cannot review deposits');

    // 5.12 Admin verification with FINANCE_V2_LIVE_CREDITS_ENABLED=false
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'false';

    const gateBlockedReview = await admClient.agent
      .post(`/api/wallet/admin/deposits/${fundingId}/review`)
      .set('x-csrf-token', admClient.csrfToken)
      .send({ action: 'APPROVE', notes: 'Admin verification attempt' });

    assert.strictEqual(gateBlockedReview.status, 400);
    assert(
      gateBlockedReview.body.error.includes('LIVE_CREDITS_DISABLED'),
      '5.12 Admin approval while live credits disabled must fail with LIVE_CREDITS_DISABLED'
    );

    // Balance remains strictly protected at 5000 cents
    const protectedBalance = await advClient.agent.get('/api/wallet/overview');
    assert.strictEqual(protectedBalance.body.wallet.availableCents, 5000, '5.12 Balance uncredited and protected');
    console.log('✅ TEST 5 PASSED: Manual IRT deposit workflow, duplicate prevention, and feature gate verified.\n');

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 6: Crypto Deposit Gate Enforcement
    // ═════════════════════════════════════════════════════════════════════════
    console.log('--- TEST 6: Crypto Deposit Request Gate ---');

    process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED = 'false';

    const cryptoReqRes = await advClient.agent
      .post('/api/wallet/deposits/crypto')
      .set('x-csrf-token', advClient.csrfToken)
      .send({ targetUsdCents: 1000 });

    assert.strictEqual(cryptoReqRes.status, 403, '6.1 Crypto deposit creation blocked with 403');
    assert.strictEqual(cryptoReqRes.body.error, 'CRYPTO_COLLECTION_DISABLED');
    console.log('✅ TEST 6 PASSED: Crypto deposit gate strictly prevents unauthorized invoice creation.\n');

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 7: Deposit History & Ledger Activity Paginated Retrieval
    // ═════════════════════════════════════════════════════════════════════════
    console.log('--- TEST 7: Deposit History & Ledger Activity API ---');

    // 7.1 Deposit History
    const historyRes = await advClient.agent.get('/api/wallet/deposits?page=1&limit=10');
    assert.strictEqual(historyRes.status, 200, '7.1 Deposit history returns 200');
    assert.strictEqual(historyRes.body.success, true);
    assert(historyRes.body.deposits.length >= 1);

    const firstDeposit = historyRes.body.deposits[0];
    assert.strictEqual(firstDeposit.status, 'PENDING_ADMIN_VERIFICATION');
    assert.strictEqual(firstDeposit.creditedAmountUsd, '$0.00', '7.1 Credited amount must report $0.00 while uncredited');
    assert.strictEqual(firstDeposit.hasBackedCredit, false);

    // 7.2 Privacy check: verify payer card numbers are masked and internal adminNotes are NOT leaked!
    assert(
      firstDeposit.payerIdentifier.includes('****') || !/\b\d{16}\b/.test(firstDeposit.payerIdentifier),
      '7.2 Sensitive card number must be masked in payerIdentifier'
    );
    assert.strictEqual(
      (firstDeposit as any).adminNotes,
      undefined,
      '7.2 Internal admin notes must NEVER be exposed in public deposit history'
    );

    // Verify userExchanger sees 0 deposits (isolation)
    const excHistory = await excClient.agent.get('/api/wallet/deposits?page=1&limit=10');
    assert.strictEqual(excHistory.body.deposits.length, 0, '7.3 Exchanger sees only own deposit history (0 items)');

    // 7.4 Ledger Activity
    const ledgerRes = await advClient.agent.get('/api/wallet/ledger?page=1&limit=10');
    assert.strictEqual(ledgerRes.status, 200, '7.4 Ledger activity returns 200');
    assert.strictEqual(ledgerRes.body.success, true);
    assert(ledgerRes.body.entries.length >= 1, '7.4 Entries contains the seeded credit');

    const firstLedger = ledgerRes.body.entries[0];
    assert.strictEqual(firstLedger.direction, 'CREDIT');
    assert.strictEqual(firstLedger.amountUsd, '50.00');
    console.log('✅ TEST 7 PASSED: Deposit history, privacy masking, and ledger activity reporting verified.\n');

    console.log('═════════════════════════════════════════════════════════════════');
    console.log('🎉 ALL WEBSITE PHASE 5 TESTS COMPLETED SUCCESSFULLY (7/7 suites)');
    console.log('═════════════════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('❌ SUITE FAILURE:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runWalletPhase5Suite();
}

export { runWalletPhase5Suite };
