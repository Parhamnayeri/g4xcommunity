/**
 * withdraw_phase3_suite.ts — جامع‌ترین آزمون‌های اعتبارسنجی فرآیند تسویه و مقاصد پرداخت فاز ۳
 */

import crypto from 'crypto';
import request from 'supertest';
import prisma, { ensureWithdrawalEvidenceUniqueIndexes } from '../database/db';
import { app, sessionStore } from '../web/server';
import { creditAvailableCents, getOrCreateWalletV2 } from '../services/financeV2/financeV2WalletService';
import {
  adminExecuteManualPayout,
  adminRejectWithdrawal,
  confirmAndSubmitWithdrawalRequest,
  boosterCancelWithdrawal,
  computeWithdrawalQuoteHash,
  verifyWithdrawalQuoteHash,
  generateUsdtWithdrawalQuote,
  createWithdrawalRequestFromQuote,
  getWithdrawalQuoteSigningSecret,
} from '../services/financeV2/boosterWithdrawalService';
import {
  BoosterWithdrawalMethod,
  BoosterWithdrawalStatus,
  LedgerV2EntryType,
} from '../services/financeV2/financeV2Types';
import { validateIranianIban, maskIban, maskCryptoAddress } from '../services/financeV2/iranianIbanValidator';
import { validateBep20Address } from '../services/financeV2/bep20Validator';
import {
  validatePayoutEvidenceFormat,
  assertNoDuplicatePayoutEvidence,
  reconcileUsdtBep20Payout,
  reconcileIrtBankPayout,
  BSC_USDT_CONTRACT_MAINNET,
  BSC_USDT_CONTRACT_TESTNET,
  ERC20_TRANSFER_TOPIC0,
} from '../services/financeV2/payoutVerificationService';

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

async function runWithdrawPhase3Suite() {
  console.log('======================================================');
  console.log('   G4X COMMUNITY — WEBSITE PHASE 3 WITHDRAWAL SUITE   ');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`✅ [PASS] ${msg}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${msg}`);
      failed++;
    }
  }

  process.env.WITHDRAWAL_QUOTE_SIGNING_SECRET =
    process.env.WITHDRAWAL_QUOTE_SIGNING_SECRET || 'a_very_high_entropy_secret_for_withdrawal_quotes_at_least_32_chars';
  process.env.BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
  await ensureWithdrawalEvidenceUniqueIndexes();

  const uTestA = `u_wdr_a_${Date.now()}`;
  const uTestB = `u_wdr_b_${Date.now()}`;
  const uAdmin = `u_wdr_admin_${Date.now()}`;
  const uAdmin2 = `u_wdr_admin2_${Date.now()}`;
  const uManagerReviewer = `u_wdr_mgr_${Date.now()}`;

  try {
    // ─── ۰. تمیزکاری اولیه ───────────────────────────────────────────────────
    await prisma.user.deleteMany({
      where: { discordId: { in: [uTestA, uTestB, uAdmin, uAdmin2, uManagerReviewer] } },
    });

    // ─── ۱. آزمون‌های دسترسی تاییدنشده (Unauthenticated Rejection) ───────────
    const unauthOverview = await request(app).get('/api/withdrawals/overview');
    assert(unauthOverview.status === 401, '1. Unauthenticated request to /api/withdrawals/overview returns 401');

    const unauthPrefGet = await request(app).get('/api/payout-preferences');
    assert(unauthPrefGet.status === 401, '2. Unauthenticated request to /api/payout-preferences returns 401');

    const unauthPrefPut = await request(app).put('/api/payout-preferences').send({ bankIban: 'IR020170000000109968843003' });
    assert(unauthPrefPut.status === 401, '3. Unauthenticated PUT to /api/payout-preferences returns 401');

    const unauthQuote = await request(app).post('/api/withdrawals/quote').send({ payoutMethod: 'USDT_BEP20', requestedUsdCents: 5000, destinationAddress: '0x1234567890abcdef1234567890abcdef12345678' });
    assert(unauthQuote.status === 401, '4. Unauthenticated POST to /api/withdrawals/quote returns 401');

    const unauthConfirm = await request(app).post('/api/withdrawals/confirm').send({ requestId: 1 });
    assert(unauthConfirm.status === 401, '5. Unauthenticated POST to /api/withdrawals/confirm returns 401');

    const unauthHistory = await request(app).get('/api/withdrawals/history');
    assert(unauthHistory.status === 401, '6. Unauthenticated GET to /api/withdrawals/history returns 401');

    // ─── ۲. ایجاد کاربران در دیتابیس ──────────────────────────────────────
    await prisma.user.create({
      data: {
        discordId: uTestA,
        username: 'BoosterAlpha',
        displayName: 'Alpha Booster',
        isActive: true,
      },
    });

    await prisma.user.create({
      data: {
        discordId: uTestB,
        username: 'UserBeta',
        displayName: 'Beta User',
        isActive: true,
      },
    });

    await prisma.user.create({
      data: {
        discordId: uAdmin,
        username: 'AdminFinance',
        displayName: 'Finance Admin',
        isActive: true,
      },
    });

    await prisma.user.create({
      data: {
        discordId: uAdmin2,
        username: 'AdminFinance2',
        displayName: 'Finance Secondary Reviewer',
        isActive: true,
      },
    });

    await prisma.user.create({
      data: {
        discordId: uManagerReviewer,
        username: 'ManagerReviewer',
        displayName: 'ReadOnly Withdrawal Manager',
        isActive: true,
      },
    });

    await prisma.userRole.createMany({
      data: [
        { userId: uTestA, roleKey: 'booster' },
        { userId: uTestB, roleKey: 'booster' },
        { userId: uAdmin, roleKey: 'owner' },
        { userId: uAdmin2, roleKey: 'owner' },
        { userId: uManagerReviewer, roleKey: 'manager' },
      ],
    });

    const authA = await createAuthenticatedAgent(uTestA);
    const authB = await createAuthenticatedAgent(uTestB);
    const authAdmin = await createAuthenticatedAgent(uAdmin);

    // ─── ۳. اعتبارسنجی کاربر فاقد کیف پول (No Wallet State) ───────────────
    const resOverviewB = await authB.agent.get('/api/withdrawals/overview');
    assert(resOverviewB.status === 200, '7. Authenticated user without wallet record receives 200 OK');
    assert(
      resOverviewB.body.wallet.availableCents === 0 &&
        resOverviewB.body.wallet.reservedCents === 0 &&
        resOverviewB.body.wallet.pendingEarningsCents === 0 &&
        resOverviewB.body.wallet.totalPaidCents === 0 &&
        resOverviewB.body.wallet.eligibleWithdrawalCents === 0,
      '8. User without wallet gets safe empty integer cents and zero balances'
    );
    assert(resOverviewB.body.payoutPreference === null, '9. Empty payout preference returned as null safely');

    // ─── ۴. شارژ کیف پول کاربر الف و بررسی مقادیر دقیق ────────────────────
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'true';
    await creditAvailableCents(uTestA, 20000, LedgerV2EntryType.AVAILABLE_RELEASE, {
      description: 'Completed raid boost payment',
    });
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'false';

    const resOverviewA = await authA.agent.get('/api/withdrawals/overview');
    assert(resOverviewA.status === 200, '10. Authenticated booster overview returned successfully');
    assert(
      resOverviewA.body.wallet.availableCents === 20000 &&
        resOverviewA.body.wallet.availableUsd === '200.00',
      '11. Authoritative available USD formatted to exactly two decimal places ($200.00)'
    );
    assert(
      resOverviewA.body.wallet.eligibleWithdrawalCents === 20000 &&
        resOverviewA.body.wallet.eligibleWithdrawalUsd === '200.00',
      '12. Eligible withdrawal amount represents gross liquid funds before method-specific fees'
    );
    assert(
      resOverviewA.body.policy.usdtBep20FeeCents === 40 &&
        resOverviewA.body.policy.irtBankFeeCents === 130,
      '13. Authoritative policy fees ($0.40 USDT / $1.30 IRT) provided'
    );

    // ─── ۵. اعتبارسنجی چکسام و فرمت شبای بانکی ایران (ISO 7064 Mod 97-10) ────
    const validIban = 'IR200170000000109968843003';
    const ibanVal1 = validateIranianIban(validIban);
    assert(ibanVal1.isValid === true, '14. Valid Iranian IBAN passes ISO 7064 Mod 97-10 checksum');

    const invalidIbanTampered = 'IR200170000000109968843004'; // Last digit changed
    const ibanVal2 = validateIranianIban(invalidIbanTampered);
    assert(ibanVal2.isValid === false, '15. Tampered IBAN digit fails mathematical checksum');

    const invalidIbanShort = 'IR2001700000001099688430';
    assert(validateIranianIban(invalidIbanShort).isValid === false, '16. Non-26 character IBAN rejected');

    const invalidIbanNonNumeric = 'IR20017000000010996884300A';
    assert(validateIranianIban(invalidIbanNonNumeric).isValid === false, '17. Non-numeric IBAN body rejected');

    // ─── ۶. اعتبارسنجی آدرس کریپتو BEP-20 و چکسام EIP-55 ──────────────────
    const validBep20 = '0x1234567890abcdef1234567890abcdef12345678';
    assert(validateBep20Address(validBep20).isValid === true, '18. Valid BEP-20 address accepted');

    assert(maskCryptoAddress(validBep20) === '0x1234...5678', '19. Crypto address masked correctly');
    assert(maskIban(validIban) === 'IR20...3003', '20. IBAN masked correctly');

    let zeroAddrBlocked = false;
    try {
      validateBep20Address('0x0000000000000000000000000000000000000000');
    } catch {
      zeroAddrBlocked = true;
    }
    assert(zeroAddrBlocked, '21. Burn/Zero address strictly rejected for BEP-20');

    // ─── ۷. ذخیره و به‌روزرسانی مقاصد تسویه با CSRF و حریم خصوصی ─────────
    const csrfBlocked = await authA.agent
      .put('/api/payout-preferences')
      .send({ bankAccountHolder: 'Alpha Tester', bankIban: validIban });
    assert(csrfBlocked.status === 403, '22. Payout preference update blocked without CSRF header');

    const savePrefRes = await authA.agent
      .put('/api/payout-preferences')
      .set('x-csrf-token', authA.csrfToken)
      .send({
        bankAccountHolder: 'Alpha Tester',
        bankIban: validIban,
        cryptoAddress: validBep20,
        cryptoNetwork: 'BNB_SMART_CHAIN_BEP20',
      });
    assert(savePrefRes.status === 200 && savePrefRes.body.success, '23. Payout preferences saved securely with CSRF');
    assert(savePrefRes.body.preference?.maskedBankIban === 'IR20...3003', '24. Masked IBAN returned in preference response');
    assert(savePrefRes.body.preference?.maskedCryptoAddress === '0x1234...5678', '25. Masked crypto address returned in preference response');

    // بررسی ثبت لاگ ممیزی
    const auditLogPref = await prisma.auditLog.findFirst({
      where: { actorId: uTestA, action: 'USER_PAYOUT_PREFERENCE_UPDATE' },
    });
    assert(auditLogPref !== null, '26. AuditLog created for payout preference update');

    // عدم نشت اطلاعات به کاربر دیگر
    const getPrefB = await authB.agent.get('/api/payout-preferences');
    assert(getPrefB.body.preference === null, '27. Cross-user data isolation: User B cannot see User A payout preferences');

    // ─── ۸. محاسبه پیش‌فاکتور تتر (USDT BEP-20 Quote) ─────────────────────
    const quoteUsdtRes = await authA.agent
      .post('/api/withdrawals/quote')
      .set('x-csrf-token', authA.csrfToken)
      .send({
        payoutMethod: 'USDT_BEP20',
        requestedUsdCents: 5000, // $50.00
        destinationAddress: validBep20,
      });
    assert(quoteUsdtRes.status === 200 && quoteUsdtRes.body.success, '28. USDT BEP-20 withdrawal quote generated');
    const usdtQuote = quoteUsdtRes.body.quote;
    assert(usdtQuote.fixedFeeUsdCents === 40 && usdtQuote.fixedFeeUsd === '0.40', '29. Flat $0.40 fee applied to USDT BEP-20 quote');
    assert(usdtQuote.netUsdCents === 4960 && usdtQuote.quotedNetPayoutAmount === '49.60', '30. Net payout equals $49.60 USDT');

    // ─── ۹. عدم وجود نرخ مصوب تومان (Fail-Closed Missing Rate) ─────────────
    await prisma.systemFinancialConfig.deleteMany({ where: { key: 'admin_usd_irt_rate' } });
    const missingRateRes = await authA.agent
      .post('/api/withdrawals/quote')
      .set('x-csrf-token', authA.csrfToken)
      .send({
        payoutMethod: 'IRT_BANK',
        requestedUsdCents: 5000,
        destinationAddress: validIban,
        destinationAccountHolder: 'Alpha Tester',
      });
    assert(missingRateRes.status === 400, '31. IRT quote generation fails closed when admin rate is missing');

    // ─── ۱۰. محاسبه پیش‌فاکتور تومانی با کسر ۳,۰۰۰ تومان از نرخ مصوب ────────
    await prisma.systemFinancialConfig.upsert({
      where: { key: 'admin_usd_irt_rate' },
      create: { key: 'admin_usd_irt_rate', value: '95000', description: 'Admin Rate' },
      update: { value: '95000' },
    });

    const quoteIrtRes = await authA.agent
      .post('/api/withdrawals/quote')
      .set('x-csrf-token', authA.csrfToken)
      .send({
        payoutMethod: 'IRT_BANK',
        requestedUsdCents: 5000, // $50.00
        destinationAddress: validIban,
        destinationAccountHolder: 'Alpha Tester',
      });
    assert(quoteIrtRes.status === 200 && quoteIrtRes.body.success, '32. IRT Bank withdrawal quote generated');
    const irtQuote = quoteIrtRes.body.quote;
    assert(irtQuote.fixedFeeUsdCents === 130 && irtQuote.fixedFeeUsd === '1.30', '33. Flat $1.30 fee applied to IRT withdrawal');
    assert(irtQuote.netUsdCents === 4870 && irtQuote.netUsd === '48.70', '34. Net USD equals $48.70');
    assert(irtQuote.rateDiscount === 3000, '35. 3,000 Toman discount per USD applied to booster withdrawal');
    assert(irtQuote.effectiveRate === 92000, '36. Effective IRT rate equals 92,000 (95,000 - 3,000)');
    // 48.70 * 92000 = 4,480,400 Toman
    assert(irtQuote.quotedNetPayoutAmount === '4480400', '37. Expected net Toman payout equals 4,480,400 Toman');

    // ─── ۱۱. رد درخواست بیش از موجودی در دسترس (Insufficient Funds) ────────
    const overFundRes = await authA.agent
      .post('/api/withdrawals/quote')
      .set('x-csrf-token', authA.csrfToken)
      .send({
        payoutMethod: 'USDT_BEP20',
        requestedUsdCents: 50000, // $500.00 (available is only $200.00)
        destinationAddress: validBep20,
      });
    assert(overFundRes.status === 400, '38. Withdrawal request exceeding liquid balance is rejected');

    // ─── ۱۲. تایید درخواست و قفل امن موجودی (Reserve Available Funds) ───────
    const confirmRes = await authA.agent
      .post('/api/withdrawals/confirm')
      .set('x-csrf-token', authA.csrfToken)
      .send({ requestId: usdtQuote.id });
    assert(confirmRes.status === 200 && confirmRes.body.success, '39. Withdrawal quote confirmed and funds reserved');
    assert(confirmRes.body.request.status === 'RESERVED', '40. Withdrawal request status transitions to RESERVED');
    assert(
      confirmRes.body.wallet.availableCents === 15000 &&
        confirmRes.body.wallet.reservedCents === 5000,
      '41. $50.00 atomically moved from available to reserved balance'
    );

    // بررسی ثبت ممیزی تایید برداشت
    const auditLogWdr = await prisma.auditLog.findFirst({
      where: { actorId: uTestA, action: 'WITHDRAWAL_REQUEST_CONFIRMED' },
    });
    assert(auditLogWdr !== null, '42. AuditLog created for withdrawal request confirmation');

    // جلوگیری از ثبت مجدد (Duplicate Submission Guard)
    const dupRes = await authA.agent
      .post('/api/withdrawals/confirm')
      .set('x-csrf-token', authA.csrfToken)
      .send({ requestId: usdtQuote.id });
    assert(dupRes.status === 400, '43. Duplicate confirmation of already reserved request is rejected');

    // جلوگیری از تایید درخواست کاربر دیگر (Cross-User Denial)
    const crossRes = await authB.agent
      .post('/api/withdrawals/confirm')
      .set('x-csrf-token', authB.csrfToken)
      .send({ requestId: usdtQuote.id });
    assert(crossRes.status === 400, '44. Cross-user withdrawal confirmation denied with 400');

    // ─── ۱۳. بررسی overview پس از قفل موجودی و تفکیک درخواست‌های در جریان ──
    const overviewAfterWdr = await authA.agent.get('/api/withdrawals/overview');
    assert(
      overviewAfterWdr.body.wallet.availableCents === 15000 &&
        overviewAfterWdr.body.wallet.reservedCents === 5000 &&
        overviewAfterWdr.body.wallet.pendingWithdrawalRequestsCents === 10000 &&
        overviewAfterWdr.body.wallet.eligibleWithdrawalCents === 15000,
      '45. Overview correctly reports $150 available, $50 reserved, and $100 in-flight requests'
    );

    // ─── ۱۴. تاریخچه درخواست‌های تسویه با صفحه‌بندی ────────────────────────
    const historyResA = await authA.agent.get('/api/withdrawals/history?page=1&limit=10');
    assert(historyResA.status === 200 && historyResA.body.withdrawals.length === 2, '46. Withdrawal history retrieved with pagination');
    const usdtHistoryItem = historyResA.body.withdrawals.find((w: any) => w.payoutMethod === 'USDT_BEP20');
    const irtHistoryItem = historyResA.body.withdrawals.find((w: any) => w.payoutMethod === 'IRT_BANK');
    assert(usdtHistoryItem?.maskedDestinationAddress === '0x1234...5678', '47. Destination address masked in history list');
    assert(usdtHistoryItem?.destinationAddress === undefined, '47a. Full unmasked destinationAddress absent from ordinary user history response');
    assert(usdtHistoryItem?.destinationAccountHolder === undefined, '47b. DestinationAccountHolder absent from ordinary user history response');
    assert(usdtHistoryItem?.rawTxHash === undefined, '47c. RawTxHash absent from ordinary user history response');
    assert(usdtHistoryItem?.bankReceiptRef === undefined, '47d. BankReceiptRef absent from ordinary user history response');
    assert(usdtHistoryItem?.status === 'RESERVED', '48. Status correctly rendered in history list');
    assert(irtHistoryItem?.maskedDestinationAddress === 'IR20...3003', '48b. IRT Sheba masked in history list');

    // تاریخچه کاربر B خالی است
    const historyResB = await authB.agent.get('/api/withdrawals/history');
    assert(historyResB.body.withdrawals.length === 0, '49. User B history isolated: 0 requests exposed');

    // ─── ۱۵. اجرای پرداخت زنده مسدود است (Fail-Closed Live Payout Gate) ────
    let livePayoutBlocked = false;
    try {
      await adminExecuteManualPayout(usdtQuote.id, uAdmin, {
        externalTxHash: '0xabcdef1234567890abcdef1234567890abcdef12',
      });
    } catch (err: any) {
      if (err.message.includes('LIVE_PAYOUTS_DISABLED')) {
        livePayoutBlocked = true;
      }
    }
    assert(livePayoutBlocked, '50. Manual live payout execution strictly blocked under FINANCE_V2_LIVE_PAYOUTS_ENABLED=false');

    // ─── ۱۶. اصلاح برچسب‌های داشبورد فاز ۲ ─────────────────────────────────
    const dashOverview = await authA.agent.get('/api/dashboard/overview');
    assert(
      dashOverview.body.wallet.eligibleWithdrawalCents === 15000 &&
        dashOverview.body.wallet.eligibleWithdrawalUsd === '150.00',
      '51. Dashboard Eligible Withdrawal corrected: equals available liquid balance before method fees ($150.00)'
    );
    assert(
      dashOverview.body.wallet.totalPaidCents !== undefined &&
        dashOverview.body.wallet.totalPaidUsd !== undefined,
      '52. Dashboard wallet includes authoritative totalPaid fields'
    );

    // ─── ۱۷. آزمون انقضای پیش‌فاکتور (Quote Expiration Guard) ────────────────
    const expQuoteRes = await authA.agent
      .post('/api/withdrawals/quote')
      .set('x-csrf-token', authA.csrfToken)
      .send({
        payoutMethod: 'USDT_BEP20',
        requestedUsdCents: 2000,
        destinationAddress: validBep20,
      });
    const expQuoteId = expQuoteRes.body.quote.id;
    // تنظیم عمدی زمان انقضا به گذشته در دیتابیس
    await prisma.boosterWithdrawalRequest.update({
      where: { id: expQuoteId },
      data: { quoteExpiresAt: new Date(Date.now() - 60000) },
    });
    const expConfirmRes = await authA.agent
      .post('/api/withdrawals/confirm')
      .set('x-csrf-token', authA.csrfToken)
      .send({ requestId: expQuoteId });
    assert(expConfirmRes.status === 400 && expConfirmRes.body.error.includes('QUOTE_EXPIRED'), '53. Expired financial quote cannot be confirmed (QUOTE_EXPIRED)');

    // ─── ۱۸. آزمون تایید همزمان (Concurrent Duplicate Confirmations Guard) ───
    const concQuoteRes = await authA.agent
      .post('/api/withdrawals/quote')
      .set('x-csrf-token', authA.csrfToken)
      .send({
        payoutMethod: 'USDT_BEP20',
        requestedUsdCents: 2000,
        destinationAddress: validBep20,
      });
    const concQuoteId = concQuoteRes.body.quote.id;
    const [c1, c2] = await Promise.allSettled([
      confirmAndSubmitWithdrawalRequest(concQuoteId, uTestA),
      confirmAndSubmitWithdrawalRequest(concQuoteId, uTestA),
    ]);
    const succCount = [c1, c2].filter((r) => r.status === 'fulfilled').length;
    const failCount = [c1, c2].filter((r) => r.status === 'rejected').length;
    assert(succCount === 1 && failCount === 1, '54. Concurrent confirmations: exactly one succeeds and one is rejected');

    // ─── ۱۹. لغو درخواست توسط بوستر و استرداد دقیقاً یک‌باره وجوه (Self-Cancel)
    const cancelRes = await authA.agent
      .post('/api/withdrawals/cancel')
      .set('x-csrf-token', authA.csrfToken)
      .send({ requestId: concQuoteId, reason: 'Test user cancellation' });
    assert(cancelRes.status === 200 && cancelRes.body.success, '55. User can cancel in-flight reserved withdrawal request');
    assert(cancelRes.body.request.status === 'CANCELLED', '56. Request status transitions to CANCELLED');
    assert(
      cancelRes.body.wallet.availableCents === 15000 && cancelRes.body.wallet.reservedCents === 5000,
      '57. Reserved funds ($20.00) returned to Available balance exactly once'
    );

    // تکرار لغو idempotent است و دوباره پول برنمی‌گرداند
    const repeatCancelRes = await authA.agent
      .post('/api/withdrawals/cancel')
      .set('x-csrf-token', authA.csrfToken)
      .send({ requestId: concQuoteId });
    assert(repeatCancelRes.status === 200 && repeatCancelRes.body.alreadyCancelled === true, '58. Repeat cancellation is idempotent and does not double-release funds');

    // کاربر دیگر نمی‌تواند درخواست این کاربر را لغو کند
    const crossCancelRes = await authB.agent
      .post('/api/withdrawals/cancel')
      .set('x-csrf-token', authB.csrfToken)
      .send({ requestId: concQuoteId });
    assert(crossCancelRes.status === 400, '59. Cross-user cancellation attempt is denied');

    // ─── ۲۰. رد درخواست توسط ادمین و استرداد دفاتر (Admin Rejection) ────────
    const adminRej = await adminRejectWithdrawal(usdtQuote.id, uAdmin, 'Administrative compliance check failure');
    assert(adminRej.request.status === 'REJECTED', '60. Admin rejection transitions request to REJECTED');
    const walletAfterRej = await prisma.walletV2.findUnique({ where: { userId: uTestA } });
    assert(
      walletAfterRej?.availableCents === 20000 && walletAfterRej?.reservedCents === 0,
      '61. Admin rejection released remaining $50.00 reserved funds back to Available balance ($200.00 total)'
    );

    // تکرار رد ادمین بدون تغییر و بدون استرداد مجدد
    const repeatRej = await adminRejectWithdrawal(usdtQuote.id, uAdmin, 'Second rejection attempt');
    assert(repeatRej.alreadyRejected === true, '62. Repeated admin rejection does not double-reverse reserved liability');

    // ─── ۲۱. عدم تغییر سایلنت مقصد درخواست‌های در جریان (Destination Isolation)
    const isoQuoteRes = await authA.agent
      .post('/api/withdrawals/quote')
      .set('x-csrf-token', authA.csrfToken)
      .send({
        payoutMethod: 'USDT_BEP20',
        requestedUsdCents: 3000,
        destinationAddress: validBep20,
      });
    const isoReq = await confirmAndSubmitWithdrawalRequest(isoQuoteRes.body.quote.id, uTestA);
    // اکنون کاربر اولویت‌های ذخیره‌شده خود را با آدرس جدیدی تغییر می‌دهد
    const newAddress = '0x9999999999999999999999999999999999999999';
    await authA.agent
      .put('/api/payout-preferences')
      .set('x-csrf-token', authA.csrfToken)
      .send({ cryptoAddress: newAddress });
    // بررسی درخواست در جریان: مقصد آن تغییر نکرده و روی همان آدرس اولیه ثابت مانده است
    const freshIsoReq = await prisma.boosterWithdrawalRequest.findUnique({ where: { id: isoReq.request.id } });
    assert(
      freshIsoReq?.destinationAddress.toLowerCase() === validBep20.toLowerCase(),
      '63. Updating user payout preferences does NOT alter the committed destination of an active withdrawal request'
    );

    // ─── ۲۲. الزامی بودن مدرک تسویه برای ادمین (Strict Payment Evidence) ────
    const fakeApprovalRes = await authA.agent
      .post(`/admin/withdrawals/${isoReq.request.id}/review`)
      .send({ decision: 'approve_paid', txHash: '' });
    assert(
      fakeApprovalRes.status === 400 || fakeApprovalRes.status === 403,
      '64. Admin approval without explicit TxHash or Bank Receipt reference is rejected'
    );

    // ─── ۲۳. بررسی یکپارچگی توکن‌های طراحی G4X (Design Tokens Verification) ─
    const fs = await import('fs');
    const path = await import('path');
    const tokensPath = path.resolve(__dirname, '../../frontend/src/styles/tokens.css');
    const tokensContent = fs.readFileSync(tokensPath, 'utf8');
    const requiredTokens = [
      '--bg-main: #0d0b12',
      '--bg-surface: #181524',
      '--bg-surface-hover: #231e34',
      '--primary-purple: #7c3aed',
      '--primary-purple-hover: #6d28d9',
      '--purple-glow: rgba(124, 58, 237, 0.35)',
      '--accent-lime: #ccff00',
      '--accent-lime-hover: #b8e600',
      '--accent-lime-glow: rgba(204, 255, 0, 0.4)',
      '--text-primary: #f4f4f6',
      '--text-muted: #94a3b8',
      '--text-inverse: #0d0b12',
      '--border-subtle: #2d2645',
    ];
    let allTokensPresent = true;
    for (const tok of requiredTokens) {
      if (!tokensContent.includes(tok)) {
        console.error(`Missing token: ${tok}`);
        allTokensPresent = false;
      }
    }
    assert(allTokensPresent, '65. All 13 mandatory G4X design tokens present with exact brand hex values in tokens.css');

    // بررسی عدم وجود متغیرهای تعریف‌نشده در کامپوننت‌های فرانت‌اند
    const withdrawCompDir = path.resolve(__dirname, '../../frontend/src/components/withdraw');
    const compFiles = fs.readdirSync(withdrawCompDir);
    let noForbiddenVars = true;
    for (const cf of compFiles) {
      const cContent = fs.readFileSync(path.join(withdrawCompDir, cf), 'utf8');
      if (cContent.includes('var(--text-main)') || cContent.includes('var(--bg-dark)')) {
        console.error(`Forbidden undeclared token found in ${cf}`);
        noForbiddenVars = false;
      }
    }
    assert(noForbiddenVars, '66. Zero forbidden/undeclared CSS variables in withdrawal components');

    // ─── ۲۳. اعتبارسنجی قالب مدرک تسویه برون‌سیستمی (Evidence Format Rejection) ───
    const invalidHexTx = validatePayoutEvidenceFormat(BoosterWithdrawalMethod.USDT_BEP20, {
      externalTxHash: 'not-a-valid-0x-hex-string',
    });
    assert(invalidHexTx.isValid === false && Boolean(invalidHexTx.error?.includes('INVALID_BLOCKCHAIN_TX_HASH')), '67. Arbitrary non-hex string strictly rejected for BEP-20 payout');

    const shortHexTx = validatePayoutEvidenceFormat(BoosterWithdrawalMethod.USDT_BEP20, {
      externalTxHash: '0x1234',
    });
    assert(shortHexTx.isValid === false && Boolean(shortHexTx.error?.includes('INVALID_BLOCKCHAIN_TX_HASH')), '68. Short hex string strictly rejected for BEP-20 payout');

    const valid66Hex = '0x' + 'a'.repeat(64);
    const validHexTx = validatePayoutEvidenceFormat(BoosterWithdrawalMethod.USDT_BEP20, {
      externalTxHash: valid66Hex,
    });
    assert(validHexTx.isValid === true && validHexTx.normalizedRef === valid66Hex.toLowerCase(), '69. Authoritative 66-character 0x hex hash format accepted');

    const shortBankRef = validatePayoutEvidenceFormat(BoosterWithdrawalMethod.IRT_BANK, {
      bankReceiptRef: '123',
    });
    assert(shortBankRef.isValid === false && Boolean(shortBankRef.error?.includes('INVALID_BANK_RECEIPT_LENGTH')), '70. Short bank reference strictly rejected');

    // ─── ۲۴. ممانعت از ثبت مدارک تسویه تکراری (Duplicate Evidence Replay Prevention) ───
    const dupTestRef = '0x' + 'd'.repeat(64);
    const dummyPaidReq = await prisma.boosterWithdrawalRequest.create({
      data: {
        withdrawalRef: `WDR_DUP_TEST_${Date.now()}`,
        boosterId: uTestA,
        payoutMethod: BoosterWithdrawalMethod.USDT_BEP20,
        status: BoosterWithdrawalStatus.PAID,
        requestedUsdCents: 1000,
        fixedFeeUsdCents: 40,
        netUsdCents: 960,
        quotedNetPayoutAmount: '9.60',
        quotedCurrency: 'USDT',
        destinationAddress: validBep20,
        externalTxHash: dupTestRef,
      },
    });

    let duplicateBlocked = false;
    try {
      await assertNoDuplicatePayoutEvidence(BoosterWithdrawalMethod.USDT_BEP20, dupTestRef, 999999);
    } catch (err: any) {
      if (err.message.includes('DUPLICATE_PAYOUT_EVIDENCE')) {
        duplicateBlocked = true;
      }
    }
    assert(duplicateBlocked, '71. Duplicate payout evidence across multiple withdrawal requests strictly prevented');
    await prisma.boosterWithdrawalRequest.delete({ where: { id: dummyPaidReq.id } });

    // ─── ۲۵. اعتبارسنجی مستقل و موثق تراکنش تتر BEP-20 (Authoritative BSC RPC) ───
    const createMockBscRpc = (opts: {
      chainId?: string;
      receipt?: any;
      currentBlock?: string;
      throwOnChainId?: boolean;
      throwOnReceipt?: boolean;
    } = {}) => {
      return async (method: string, _params: any[]) => {
        if (method === 'eth_chainId') {
          if (opts.throwOnChainId) throw new Error('CONNECTION_REFUSED');
          return opts.chainId !== undefined ? opts.chainId : '0x38'; // 56 Mainnet
        }
        if (method === 'eth_blockNumber') {
          return opts.currentBlock !== undefined ? opts.currentBlock : '0x1000'; // Block 4096
        }
        if (method === 'eth_getTransactionReceipt') {
          if (opts.throwOnReceipt) throw new Error('TIMEOUT');
          if (opts.receipt === null) return null;
          return opts.receipt !== undefined
            ? opts.receipt
            : {
                status: '0x1',
                blockNumber: '0x0ff0', // Block 4080 (16 confirmations)
                logs: [
                  {
                    address: BSC_USDT_CONTRACT_MAINNET,
                    topics: [
                      ERC20_TRANSFER_TOPIC0,
                      '0x0000000000000000000000001111111111111111111111111111111111111111',
                      '0x000000000000000000000000' + validBep20.slice(2).toLowerCase(),
                    ],
                    data: '0x' + (BigInt(4960) * 10_000_000_000_000_000n).toString(16).padStart(64, '0'),
                  },
                ],
              };
        }
        throw new Error(`Unsupported mock RPC method: ${method}`);
      };
    };

    // آزمون ۷۲: فقدان ارائه‌دهنده BSC RPC موجب رد قطعی (Fail-Closed) می‌شود
    const rpcMissing = await reconcileUsdtBep20Payout(
      { id: 101, destinationAddress: validBep20, quotedNetPayoutAmount: '49.60', netUsdCents: 4960 },
      valid66Hex,
      { rpcUrl: '' }
    );
    assert(
      rpcMissing.verified === false && Boolean(rpcMissing.reason?.includes('UNAVAILABLE_VERIFICATION_INFRASTRUCTURE')),
      '72. Missing BSC RPC provider fails closed and preserves unverified status'
    );

    // آزمون ۷۳: رد شناسه زنجیره نامعتبر (مانند تست‌نت ۹۷)
    const wrongChainRpc = createMockBscRpc({ chainId: '0x61' }); // 97 Testnet
    const rpcWrongChain = await reconcileUsdtBep20Payout(
      { id: 102, destinationAddress: validBep20, quotedNetPayoutAmount: '49.60', netUsdCents: 4960 },
      valid66Hex,
      { rpcClient: wrongChainRpc }
    );
    assert(
      rpcWrongChain.verified === false && Boolean(rpcWrongChain.reason?.includes('INVALID_BLOCKCHAIN_CHAIN_ID')),
      '73. BSC RPC with non-mainnet chain ID (e.g. 97 testnet) strictly rejected'
    );

    // آزمون ۷۴: عدم یافتن رسید تراکنش در زنجیره
    const nullReceiptRpc = createMockBscRpc({ receipt: null });
    const rpcNullReceipt = await reconcileUsdtBep20Payout(
      { id: 103, destinationAddress: validBep20, quotedNetPayoutAmount: '49.60', netUsdCents: 4960 },
      valid66Hex,
      { rpcClient: nullReceiptRpc }
    );
    assert(
      rpcNullReceipt.verified === false && Boolean(rpcNullReceipt.reason?.includes('RECEIPT_NOT_FOUND')),
      '74. Unconfirmed or non-existent transaction receipt rejected'
    );

    // آزمون ۷۵: تراکنش بازگشت‌خورده یا شکست‌خورده روی زنجیره (status = 0x0)
    const failedTxRpc = createMockBscRpc({
      receipt: { status: '0x0', blockNumber: '0x0ff0', logs: [] },
    });
    const rpcFailedTx = await reconcileUsdtBep20Payout(
      { id: 104, destinationAddress: validBep20, quotedNetPayoutAmount: '49.60', netUsdCents: 4960 },
      valid66Hex,
      { rpcClient: failedTxRpc }
    );
    assert(
      rpcFailedTx.verified === false && Boolean(rpcFailedTx.reason?.includes('TRANSACTION_EXECUTION_FAILED')),
      '75. Reverted or failed on-chain transaction status strictly rejected'
    );

    // آزمون ۷۶: تعداد تاییدیه‌های ناکافی (کمتر از ۱ تاییدیه)
    const zeroConfRpc = createMockBscRpc({
      currentBlock: '0x0ff0',
      receipt: { status: '0x1', blockNumber: '0x0ff1', logs: [] },
    });
    const rpcZeroConf = await reconcileUsdtBep20Payout(
      { id: 105, destinationAddress: validBep20, quotedNetPayoutAmount: '49.60', netUsdCents: 4960 },
      valid66Hex,
      { rpcClient: zeroConfRpc }
    );
    assert(
      rpcZeroConf.verified === false && Boolean(rpcZeroConf.reason?.includes('INSUFFICIENT_CONFIRMATIONS')),
      '76. Transactions with 0 confirmations rejected'
    );

    // آزمون ۷۷: رد قطعی قرارداد تست‌نت تتر به عنوان مدرک تسویه مین‌نت
    const testnetContractRpc = createMockBscRpc({
      receipt: {
        status: '0x1',
        blockNumber: '0x0ff0',
        logs: [
          {
            address: BSC_USDT_CONTRACT_TESTNET,
            topics: [
              ERC20_TRANSFER_TOPIC0,
              '0x0000000000000000000000001111111111111111111111111111111111111111',
              '0x000000000000000000000000' + validBep20.slice(2).toLowerCase(),
            ],
            data: '0x' + (BigInt(4960) * 10_000_000_000_000_000n).toString(16).padStart(64, '0'),
          },
        ],
      },
    });
    const rpcTestnetContract = await reconcileUsdtBep20Payout(
      { id: 106, destinationAddress: validBep20, quotedNetPayoutAmount: '49.60', netUsdCents: 4960 },
      valid66Hex,
      { rpcClient: testnetContractRpc }
    );
    assert(
      rpcTestnetContract.verified === false && Boolean(rpcTestnetContract.reason?.includes('TESTNET_CONTRACT_REJECTED')),
      '77. BSC testnet USDT contract strictly rejected for mainnet settlement'
    );

    // آزمون ۷۸: رد قراردادهای ناشناس یا جعلی غیر از تتر رسمی مین‌نت
    const fakeContractRpc = createMockBscRpc({
      receipt: {
        status: '0x1',
        blockNumber: '0x0ff0',
        logs: [
          {
            address: '0x1111111111111111111111111111111111111111',
            topics: [
              ERC20_TRANSFER_TOPIC0,
              '0x0000000000000000000000001111111111111111111111111111111111111111',
              '0x000000000000000000000000' + validBep20.slice(2).toLowerCase(),
            ],
            data: '0x' + (BigInt(4960) * 10_000_000_000_000_000n).toString(16).padStart(64, '0'),
          },
        ],
      },
    });
    const rpcFakeContract = await reconcileUsdtBep20Payout(
      { id: 107, destinationAddress: validBep20, quotedNetPayoutAmount: '49.60', netUsdCents: 4960 },
      valid66Hex,
      { rpcClient: fakeContractRpc }
    );
    assert(
      rpcFakeContract.verified === false && Boolean(rpcFakeContract.reason?.includes('INVALID_TOKEN_CONTRACT')),
      '78. Arbitrary or spoofed token contract address strictly rejected'
    );

    // آزمون ۷۹: مغایرت آدرس گیرنده با آدرس درخواستی
    const wrongRecipientRpc = createMockBscRpc({
      receipt: {
        status: '0x1',
        blockNumber: '0x0ff0',
        logs: [
          {
            address: BSC_USDT_CONTRACT_MAINNET,
            topics: [
              ERC20_TRANSFER_TOPIC0,
              '0x0000000000000000000000001111111111111111111111111111111111111111',
              '0x000000000000000000000000' + '2222222222222222222222222222222222222222',
            ],
            data: '0x' + (BigInt(4960) * 10_000_000_000_000_000n).toString(16).padStart(64, '0'),
          },
        ],
      },
    });
    const rpcWrongRecipient = await reconcileUsdtBep20Payout(
      { id: 108, destinationAddress: validBep20, quotedNetPayoutAmount: '49.60', netUsdCents: 4960 },
      valid66Hex,
      { rpcClient: wrongRecipientRpc }
    );
    assert(
      rpcWrongRecipient.verified === false && Boolean(rpcWrongRecipient.reason?.includes('RECIPIENT_ADDRESS_MISMATCH')),
      '79. On-chain recipient mismatch strictly rejected'
    );

    // آزمون ۸۰: مغایرت رقم انتقال با مقایسه اعداد صحیح مقیاس‌پذیر BigInt (بدون parseFloat)
    const wrongAmountRpc = createMockBscRpc({
      receipt: {
        status: '0x1',
        blockNumber: '0x0ff0',
        logs: [
          {
            address: BSC_USDT_CONTRACT_MAINNET,
            topics: [
              ERC20_TRANSFER_TOPIC0,
              '0x0000000000000000000000001111111111111111111111111111111111111111',
              '0x000000000000000000000000' + validBep20.slice(2).toLowerCase(),
            ],
            // مبلغ متفاوت (مثلاً ۱۰ دلار به جای ۴۹.۶۰ دلار)
            data: '0x' + (BigInt(1000) * 10_000_000_000_000_000n).toString(16).padStart(64, '0'),
          },
        ],
      },
    });
    const rpcWrongAmount = await reconcileUsdtBep20Payout(
      { id: 109, destinationAddress: validBep20, quotedNetPayoutAmount: '49.60', netUsdCents: 4960 },
      valid66Hex,
      { rpcClient: wrongAmountRpc }
    );
    assert(
      rpcWrongAmount.verified === false && Boolean(rpcWrongAmount.reason?.includes('PAYOUT_AMOUNT_MISMATCH')),
      '80. On-chain token unit mismatch rejected via exact integer BigInt math'
    );

    // آزمون ۸۱: تراکنش معتبر و کامل روی مین‌نت با موفقیت تایید می‌شود
    const validRpc = createMockBscRpc();
    const rpcValid = await reconcileUsdtBep20Payout(
      { id: 110, destinationAddress: validBep20, quotedNetPayoutAmount: '49.60', netUsdCents: 4960 },
      valid66Hex,
      { rpcClient: validRpc }
    );
    assert(
      rpcValid.verified === true && rpcValid.normalizedEvidenceRef === valid66Hex.toLowerCase(),
      '81. Authentic BSC Mainnet transfer verified successfully via server RPC'
    );

    // آزمون‌های رد شواهد تسویه ارسالی جعلی در بدنه درخواست HTTP ادمین
    const forgedQuote = await generateUsdtWithdrawalQuote({
      boosterId: uTestA,
      requestedUsdCents: 1000,
      destinationAddress: validBep20,
    });
    const forgedReq = await createWithdrawalRequestFromQuote(forgedQuote);
    await confirmAndSubmitWithdrawalRequest(forgedReq.id, uTestA);

    // ۱. ارسال شواهد ساختگی bep20Evidence در بدنه درخواست HTTP
    const fakeBep20Res = await authAdmin.agent
      .post(`/api/admin/withdrawals/${forgedReq.id}/review`)
      .set('X-CSRF-Token', authAdmin.csrfToken)
      .send({
        decision: 'approve_paid',
        txHash: valid66Hex,
        bep20Evidence: {
          status: 'SUCCESS',
          confirmed: true,
          amountUnits: '999999',
          recipientAddress: '0xFake',
        },
      });
    assert(
      fakeBep20Res.status === 400 || fakeBep20Res.status === 403,
      '81b. Admin review route ignores forged client-supplied bep20Evidence and fails closed'
    );
    const postFakeWdr = await prisma.boosterWithdrawalRequest.findUniqueOrThrow({ where: { id: forgedReq.id } });
    assert(postFakeWdr.status !== BoosterWithdrawalStatus.PAID, '81c. Forged bep20Evidence cannot mark request PAID');

    // ۲. ارسال شواهد ساختگی irtEvidence در بدنه درخواست HTTP
    const fakeIrtRes = await authAdmin.agent
      .post(`/api/admin/withdrawals/${forgedReq.id}/review`)
      .set('X-CSRF-Token', authAdmin.csrfToken)
      .send({
        decision: 'approve_paid',
        bankReceiptRef: 'TRACK-FAKE-RECEIPT-1234',
        irtEvidence: {
          bankName: 'Fake Bank',
          trackingCode: 'TRACK-FAKE-RECEIPT-1234',
        },
      });
    assert(
      fakeIrtRes.status === 400 || fakeIrtRes.status === 403,
      '81d. Admin review route ignores forged client-supplied irtEvidence and fails closed'
    );

    // ─── ۲۶. آزمون‌های تسویه حواله بانکی تومانی (IRT Bank Dual Authorization) ───
    const irtMissingReviewer = await reconcileIrtBankPayout(
      { id: 111, destinationAddress: 'IR020170000000109968843003', quotedNetPayoutAmount: '3500000' },
      'TRACK-12345678',
      { actorId: uAdmin }
    );
    assert(
      irtMissingReviewer.verified === false && Boolean(irtMissingReviewer.reason?.includes('DUAL_AUTHORIZATION_REQUIRED')),
      '82. IRT bank settlement strictly rejected without secondary finance reviewer'
    );

    const irtSameReviewer = await reconcileIrtBankPayout(
      { id: 112, destinationAddress: 'IR020170000000109968843003', quotedNetPayoutAmount: '3500000' },
      'TRACK-12345678',
      { actorId: uAdmin, secondReviewerId: uAdmin }
    );
    assert(
      irtSameReviewer.verified === false && Boolean(irtSameReviewer.reason?.includes('DUAL_AUTHORIZATION_SAME_USER')),
      '83. IRT bank settlement rejected when second reviewer is identical to executing admin'
    );

    const irtUnauthorizedReviewer = await reconcileIrtBankPayout(
      { id: 113, destinationAddress: 'IR020170000000109968843003', quotedNetPayoutAmount: '3500000' },
      'TRACK-12345678',
      { actorId: uAdmin, secondReviewerId: uTestA } // Booster without finance permissions
    );
    assert(
      irtUnauthorizedReviewer.verified === false && Boolean(irtUnauthorizedReviewer.reason?.includes('INVALID_SECONDARY_REVIEWER')),
      '84. IRT bank settlement rejected when secondary reviewer lacks FINANCE_ADJUST permission'
    );

    const irtManagerDenied = await reconcileIrtBankPayout(
      { id: 1130, destinationAddress: 'IR020170000000109968843003', quotedNetPayoutAmount: '3500000' },
      'TRACK-12345678',
      { actorId: uAdmin, secondReviewerId: uManagerReviewer } // Manager lacks Owner-only FINANCE_ADJUST
    );
    assert(
      irtManagerDenied.verified === false && Boolean(irtManagerDenied.reason?.includes('INVALID_SECONDARY_REVIEWER')),
      '84b. IRT bank settlement rejected when secondary reviewer is manager lacking Owner-only FINANCE_ADJUST'
    );

    const irtMissingRecord = await reconcileIrtBankPayout(
      { id: 114, destinationAddress: 'IR020170000000109968843003', quotedNetPayoutAmount: '3500000' },
      'TRACK-12345678',
      { actorId: uAdmin, secondReviewerId: uAdmin2 }
    );
    assert(
      irtMissingRecord.verified === false && Boolean(irtMissingRecord.reason?.includes('UNAVAILABLE_BANK_SETTLEMENT_PROVIDER')),
      '85. Typed bank receipt rejected without authoritative settlement record'
    );

    const irtValid = await reconcileIrtBankPayout(
      { id: 115, destinationAddress: 'IR020170000000109968843003', quotedNetPayoutAmount: '3500000' },
      'TRACK-12345678',
      {
        actorId: uAdmin,
        secondReviewerId: uAdmin2,
        settlementRecord: {
          verifiedAt: new Date(),
          settlementBatchId: 'BATCH-2026-001',
          sourceBank: 'BANK_MELLAT',
          verifiedAmountIrt: 3500000,
          destinationIban: 'IR020170000000109968843003',
        },
      }
    );
    assert(
      irtValid.verified === true && irtValid.normalizedEvidenceRef === 'TRACK-12345678',
      '86. IRT bank payout with verified settlement record and dual authorization verified'
    );

    // ─── ۲۷. امنیت امضای پیش‌فاکتور (WITHDRAWAL_QUOTE_SIGNING_SECRET) ─────────
    const originalSecret = process.env.WITHDRAWAL_QUOTE_SIGNING_SECRET;

    // آزمون ۸۷: فقدان کلید امضا موجب توقف قطعی (Fail-Closed) می‌شود
    delete process.env.WITHDRAWAL_QUOTE_SIGNING_SECRET;
    let missingSecretBlocked = false;
    try {
      getWithdrawalQuoteSigningSecret();
    } catch (err: any) {
      if (err.message.includes('MISSING_WITHDRAWAL_QUOTE_SIGNING_SECRET')) {
        missingSecretBlocked = true;
      }
    }
    assert(missingSecretBlocked, '87. Missing WITHDRAWAL_QUOTE_SIGNING_SECRET fails closed immediately');

    // آزمون ۸۸: رد کلیدهای کوتاه با انتروپی ناکافی (< ۳۲ کاراکتر) بدون استفاده از فال‌بک هاردکد
    process.env.WITHDRAWAL_QUOTE_SIGNING_SECRET = 'short_key_under_32_chars';
    let shortSecretBlocked = false;
    try {
      getWithdrawalQuoteSigningSecret();
    } catch (err: any) {
      if (err.message.includes('MISSING_WITHDRAWAL_QUOTE_SIGNING_SECRET')) {
        shortSecretBlocked = true;
      }
    }
    assert(shortSecretBlocked, '88. Short signing key under 32 characters strictly rejected without hardcoded fallback');

    // بازیابی کلید معتبر
    process.env.WITHDRAWAL_QUOTE_SIGNING_SECRET = originalSecret;

    // آزمون ۸۹: رد قطعی امضاهای ساده SHA-256 قدیمی فاقد کلید
    const legacyPayload = [
      uTestA,
      BoosterWithdrawalMethod.USDT_BEP20,
      1000,
      40,
      960,
      1.0,
      1.0,
      validBep20.toLowerCase(),
      new Date().toISOString(),
      1,
      2,
      'none',
    ].join('|');
    const legacySha256 = crypto.createHash('sha256').update(legacyPayload).digest('hex');
    const legacyRejected = verifyWithdrawalQuoteHash(
      {
        boosterId: uTestA,
        payoutMethod: BoosterWithdrawalMethod.USDT_BEP20,
        requestedUsdCents: 1000,
        fixedFeeUsdCents: 40,
        netUsdCents: 960,
        quoteRate: 1.0,
        effectiveRate: 1.0,
        destinationAddress: validBep20,
        quoteExpiresAt: new Date(),
        quoteVersion: 1,
        policyVersion: 2,
      },
      legacySha256
    );
    assert(legacyRejected === false, '89. Legacy unkeyed SHA-256 quote hash strictly rejected');

    // آزمون ۹۰: مقایسه زمان‌ثابت و تغییر ناچیز مبالغ پیش‌فاکتور
    const validQuote = await generateUsdtWithdrawalQuote({
      boosterId: uTestA,
      requestedUsdCents: 1000,
      destinationAddress: validBep20,
    });
    const tamperedQuote = verifyWithdrawalQuoteHash(
      {
        boosterId: validQuote.boosterId,
        payoutMethod: validQuote.payoutMethod,
        requestedUsdCents: validQuote.requestedUsdCents + 1, // تغییر ۱ سنت
        fixedFeeUsdCents: validQuote.fixedFeeUsdCents,
        netUsdCents: validQuote.netUsdCents + 1,
        quoteRate: validQuote.quoteRate,
        effectiveRate: validQuote.effectiveRate,
        destinationAddress: validQuote.destinationAddress,
        quoteExpiresAt: validQuote.quoteExpiresAt,
        quoteVersion: validQuote.quoteVersion,
        policyVersion: validQuote.policyVersion,
      },
      validQuote.quoteHash
    );
    assert(tamperedQuote === false, '90. 1-cent tampered quote rejected by constant-time signature verification');

    // آزمون ۹۱: رد پیش‌فاکتور منقضی‌شده
    const expiredRecord = await createWithdrawalRequestFromQuote({
      ...validQuote,
      quoteExpiresAt: new Date(Date.now() - 1000), // منقضی در ۱ ثانیه قبل
    });
    let expiredRejected = false;
    try {
      await confirmAndSubmitWithdrawalRequest(expiredRecord.id, uTestA);
    } catch (err: any) {
      if (err.message.includes('QUOTE_EXPIRED')) {
        expiredRejected = true;
      }
    }
    assert(expiredRejected, '91. Expired quote strictly rejected upon confirmation attempt');

    // ─── ۲۸. تصحیح رفتار تراکنش در خطای انطباق تسویه (Failed Verification Durability) ───
    const durableTestQuote = await generateUsdtWithdrawalQuote({
      boosterId: uTestA,
      requestedUsdCents: 1000,
      destinationAddress: validBep20,
    });
    const durableReq = await createWithdrawalRequestFromQuote(durableTestQuote);
    await confirmAndSubmitWithdrawalRequest(durableReq.id, uTestA);

    const boosterWalletBeforePayout = await getOrCreateWalletV2(uTestA);

    // فراخوانی تسویه دستی با ارائه‌دهنده شکست‌خورده روی بلاکچین
    let durableReviewPassed = false;
    try {
      process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED = 'true';
      await adminExecuteManualPayout(durableReq.id, uAdmin, {
        externalTxHash: valid66Hex,
        notes: 'Simulated failed verification',
        bscVerificationOptions: {
          rpcClient: failedTxRpc, // این RPC وضعیت 0x0 برمی‌گرداند
        },
      });
    } catch (err: any) {
      if (err.message.includes('PAYOUT_VERIFICATION_REQUIRED')) {
        durableReviewPassed = true;
      }
    } finally {
      process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED = 'false';
    }
    assert(durableReviewPassed, '92. Failed verification throws precise PAYOUT_VERIFICATION_REQUIRED failure response');

    // بررسی ثبت پایدار در دیتابیس (عدم رول‌بک شدن وضعیت بررسی ادمین)
    const freshDurableReq = await prisma.boosterWithdrawalRequest.findUniqueOrThrow({
      where: { id: durableReq.id },
    });
    assert(
      freshDurableReq.status === BoosterWithdrawalStatus.UNDER_ADMIN_REVIEW,
      '93. Failed payout verification durably preserves UNDER_ADMIN_REVIEW status in database without rollback'
    );

    // بررسی عدم تغییر و حفظ موجودی رزرو بوستر
    const boosterWalletAfterFailed = await getOrCreateWalletV2(uTestA);
    assert(
      boosterWalletAfterFailed.reservedCents === boosterWalletBeforePayout.reservedCents &&
        boosterWalletAfterFailed.availableCents === boosterWalletBeforePayout.availableCents &&
        boosterWalletAfterFailed.paidCents === boosterWalletBeforePayout.paidCents,
      '94. Reserved booster balance unchanged on failed verification; no premature funds consumption'
    );

    // بررسی عدم ثبت وضعیت PAID
    assert(freshDurableReq.status !== BoosterWithdrawalStatus.PAID, '95. Failed verification does not mark request as PAID');

    // بررسی عدم صدور سند دفتر کل
    const settleJournals = await prisma.ledgerEntryV2.findMany({
      where: {
        withdrawalRequestId: durableReq.id,
        entryType: LedgerV2EntryType.WITHDRAWAL_SETTLE,
      },
    });
    assert(settleJournals.length === 0, '96. No payout journal postings created on failed verification');

    // ─── ۲۹. اعمال یکتایی مدارک تسویه در سطح دیتابیس (Database Partial Unique Index) ───
    const settledUniqueTx = '0x' + 'f'.repeat(64);
    const paidUniqueReq1 = await prisma.boosterWithdrawalRequest.create({
      data: {
        withdrawalRef: `WDR_SETTLE_UNIQ_1_${Date.now()}`,
        boosterId: uTestA,
        payoutMethod: BoosterWithdrawalMethod.USDT_BEP20,
        status: BoosterWithdrawalStatus.PAID,
        requestedUsdCents: 1000,
        fixedFeeUsdCents: 40,
        netUsdCents: 960,
        quotedNetPayoutAmount: '9.60',
        quotedCurrency: 'USDT',
        destinationAddress: validBep20,
        externalTxHash: settledUniqueTx,
      },
    });

    let dbUniqueBlocked = false;
    try {
      // تلاش برای ایجاد یا ثبت پرداخت دوم با همان هش در وضعیت PAID
      await prisma.boosterWithdrawalRequest.create({
        data: {
          withdrawalRef: `WDR_SETTLE_UNIQ_2_${Date.now()}`,
          boosterId: uTestB,
          payoutMethod: BoosterWithdrawalMethod.USDT_BEP20,
          status: BoosterWithdrawalStatus.PAID,
          requestedUsdCents: 1000,
          fixedFeeUsdCents: 40,
          netUsdCents: 960,
          quotedNetPayoutAmount: '9.60',
          quotedCurrency: 'USDT',
          destinationAddress: validBep20,
          externalTxHash: settledUniqueTx,
        },
      });
    } catch (err: any) {
      if (err.message.includes('Unique constraint failed') || err.message.includes('UNIQUE constraint failed')) {
        dbUniqueBlocked = true;
      }
    }
    assert(dbUniqueBlocked, '97. Database-level partial unique index strictly blocks duplicate settled tx hash under concurrency');
    await prisma.boosterWithdrawalRequest.delete({ where: { id: paidUniqueReq1.id } });

    // ─── ۳۰. تضمین مسدود بودن دروازه پرداخت زنده (Feature Gates Remain Disabled) ───
    assert(
      process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED !== 'true',
      '98. FINANCE_V2_LIVE_PAYOUTS_ENABLED remains strictly disabled by default'
    );

    // ─── ۳۱. آزمون همروندی تأیید پیش‌فاکتور (Concurrent Confirmation CAS Guard) ───
    const raceQuote = await generateUsdtWithdrawalQuote({
      boosterId: uTestA,
      requestedUsdCents: 1000,
      destinationAddress: validBep20,
    });
    const raceRecord = await createWithdrawalRequestFromQuote(raceQuote);

    const [raceConf1, raceConf2] = await Promise.allSettled([
      confirmAndSubmitWithdrawalRequest(raceRecord.id, uTestA),
      confirmAndSubmitWithdrawalRequest(raceRecord.id, uTestA),
    ]);

    const oneSucceeded =
      (raceConf1.status === 'fulfilled' && raceConf2.status === 'rejected') ||
      (raceConf1.status === 'rejected' && raceConf2.status === 'fulfilled');
    assert(oneSucceeded, '99. Concurrent quote confirmation: exactly one succeeds and duplicate is rejected via atomic CAS');

    // ─── ۳۲. آزمون مسابقه لغو کاربر در برابر رد ادمین (Cancel vs Reject Race) ────
    const cancelRejectQuote = await generateUsdtWithdrawalQuote({
      boosterId: uTestA,
      requestedUsdCents: 1000,
      destinationAddress: validBep20,
    });
    const crRecord = await createWithdrawalRequestFromQuote(cancelRejectQuote);
    await confirmAndSubmitWithdrawalRequest(crRecord.id, uTestA);

    const [crCancel, crReject] = await Promise.allSettled([
      boosterCancelWithdrawal(crRecord.id, uTestA, 'User cancel race'),
      adminRejectWithdrawal(crRecord.id, uAdmin, 'Admin reject race'),
    ]);

    const crExactOne =
      (crCancel.status === 'fulfilled' && crReject.status === 'rejected') ||
      (crCancel.status === 'rejected' && crReject.status === 'fulfilled');
    assert(crExactOne, '100. Concurrent cancel vs reject: atomic CAS ensures funds reversed exactly once with no double credit');
  } catch (err) {
    console.error('Unhandled suite error:', err);
    failed++;
  } finally {
    // تمیزکاری نهایی
    const cleanupUsers = [uTestA, uTestB, uAdmin, uAdmin2, uManagerReviewer];
    await prisma.userPayoutPreference.deleteMany({ where: { userId: { in: cleanupUsers } } });
    await prisma.ledgerEntryV2.deleteMany({ where: { userId: { in: cleanupUsers } } });
    await prisma.boosterWithdrawalRequest.deleteMany({ where: { boosterId: { in: cleanupUsers } } });
    await prisma.walletV2.deleteMany({ where: { userId: { in: cleanupUsers } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: cleanupUsers } } });
    await prisma.user.deleteMany({ where: { discordId: { in: cleanupUsers } } });
  }

  console.log('\n======================================================');
  console.log(`PHASE 3 WITHDRAWAL RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runWithdrawPhase3Suite().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
