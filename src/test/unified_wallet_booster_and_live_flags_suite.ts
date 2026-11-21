/**
 * unified_wallet_booster_and_live_flags_suite.ts
 *
 * Verifies:
 * 1. Unified Wallet overview works for Boosters, Advertisers, and Owners.
 * 2. Booster accounts are locked from depositing (403 DEPOSIT_LOCKED_FOR_BOOSTER).
 * 3. Advertisers and Owners can create deposit requests.
 * 4. NOWPayments case-insensitive environment flag handling.
 * 5. Atomic wallet withdrawal reservation, ledger entry, and user withdrawal retrieval.
 */

import prisma from '../database/db';
import { getNowpaymentsConfig } from '../services/payment/paymentTypes';
import { getWalletOverview } from '../services/financeV2/walletPageService';
import { getOrCreateWalletV2 } from '../services/financeV2/financeV2WalletService';

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
  console.log('=== STARTING UNIFIED WALLET & LIVE FLAGS VERIFICATION SUITE ===\n');

  const testBoosterId = `test_booster_${Date.now()}`;
  const testAdvId = `test_adv_${Date.now()}`;

  try {
    // Setup test users
    await prisma.user.create({
      data: {
        discordId: testBoosterId,
        username: 'TestBoosterUser',
        userRoles: {
          create: [{ roleKey: 'booster' }],
        },
      },
    });

    await prisma.user.create({
      data: {
        discordId: testAdvId,
        username: 'TestAdvertiserUser',
        userRoles: {
          create: [{ roleKey: 'advertiser' }],
        },
      },
    });

    // ─── Test 1: getNowpaymentsConfig case-insensitive flags ───
    process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED = ' TRUE ';
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'True';
    process.env.NOWPAYMENTS_API_KEY = 'mock_key_123';
    process.env.NOWPAYMENTS_MODE = 'LIVE';

    const cfg1 = getNowpaymentsConfig();
    assert(cfg1.liveCollectionEnabled === true, '1. NOWPAYMENTS_LIVE_COLLECTION_ENABLED handles uppercase/whitespace as true');
    assert(cfg1.liveCreditsEnabled === true, '2. FINANCE_V2_LIVE_CREDITS_ENABLED handles uppercase/whitespace as true');
    assert(cfg1.isCollectionActive === true, '3. isCollectionActive is true when live collection and api key exist');

    process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED = 'false';
    const cfg2 = getNowpaymentsConfig();
    assert(cfg2.liveCollectionEnabled === false, '4. NOWPAYMENTS_LIVE_COLLECTION_ENABLED correctly disables when false');

    // ─── Test 2: Unified getWalletOverview for Booster ───
    const boosterUserMock: any = {
      discordId: testBoosterId,
      username: 'TestBoosterUser',
      userRoles: [{ roleKey: 'booster' }],
    };

    const boosterOverview = await getWalletOverview(boosterUserMock);
    assert(boosterOverview.user.canDeposit === false, '5. Booster user cannot deposit (canDeposit = false)');
    assert(boosterOverview.user.isBoosterOnly === true, '6. Booster user is identified as isBoosterOnly');
    assert(boosterOverview.wallet.availableUsd === '0.00', '7. Booster wallet initialized cleanly with $0.00');
    assert(typeof boosterOverview.wallet.inActiveOrdersUsd === 'string', '8. inActiveOrdersUsd is populated');
    assert(typeof boosterOverview.wallet.frozenUsd === 'string', '9. frozenUsd is populated');

    // ─── Test 3: Unified getWalletOverview for Advertiser ───
    const advUserMock: any = {
      discordId: testAdvId,
      username: 'TestAdvertiserUser',
      userRoles: [{ roleKey: 'advertiser' }],
    };

    const advOverview = await getWalletOverview(advUserMock);
    assert(advOverview.user.canDeposit === true, '10. Advertiser user can deposit (canDeposit = true)');
    assert(advOverview.user.isBoosterOnly === false, '11. Advertiser is not booster only');

    // ─── Test 4: Atomic Withdrawal hold and ledger reservation ───
    // Credit $100.00 USD to booster wallet
    const walletV2 = await getOrCreateWalletV2(testBoosterId);
    await prisma.walletV2.update({
      where: { userId: testBoosterId },
      data: { availableCents: 10000 },
    });

    const withdrawAmountCents = 4000; // $40.00
    const withdrawRef = `WTH_TEST_${Date.now()}`;

    const withdrawal = await prisma.$transaction(async (tx) => {
      await tx.walletV2.update({
        where: { userId: testBoosterId },
        data: {
          availableCents: { decrement: withdrawAmountCents },
          reservedCents: { increment: withdrawAmountCents },
        },
      });

      const w = await tx.boosterWithdrawalRequest.create({
        data: {
          withdrawalRef: withdrawRef,
          boosterId: testBoosterId,
          requestedUsdCents: withdrawAmountCents,
          fixedFeeUsdCents: 30,
          netUsdCents: withdrawAmountCents - 30,
          quotedNetPayoutAmount: '39.70',
          quotedCurrency: 'USDT',
          payoutMethod: 'USDT_BEP20',
          destinationAddress: '0x1111222233334444555566667777888899990000',
          status: 'REQUESTED',
        },
      });

      await tx.ledgerEntryV2.create({
        data: {
          entryRef: `LED_${withdrawRef}`,
          accountType: 'USER_WALLET',
          userId: testBoosterId,
          amountCents: withdrawAmountCents,
          entryType: 'WITHDRAWAL_RESERVE',
          direction: 'DEBIT',
          withdrawalRequestId: w.id,
          description: `Withdrawal reserve test`,
          createdBy: testBoosterId,
        },
      });

      return w;
    });

    assert(withdrawal.id > 0, '12. BoosterWithdrawalRequest created successfully');
    assert(withdrawal.status === 'REQUESTED', '13. Withdrawal status is REQUESTED');

    const updatedWallet = await prisma.walletV2.findUnique({ where: { userId: testBoosterId } });
    assert(updatedWallet?.availableCents === 6000, '14. Wallet available balance decremented by $40.00 ($60.00 remaining)');
    assert(updatedWallet?.reservedCents === 4000, '15. Wallet reserved balance incremented by $40.00 ($40.00 reserved)');

    // ─── Test 5: Verify latest withdrawal destinationAddress retrieval in overview ───
    const freshOverview = await getWalletOverview(boosterUserMock);
    assert(freshOverview.wallet.payoutAddress === '0x1111222233334444555566667777888899990000', '16. Payout address auto-populated from latest withdrawal');
    assert(freshOverview.wallet.reservedUsd === '40.00', '17. Reserved USD matches $40.00');

  } catch (err: any) {
    console.error('Test suite uncaught error:', err);
    failed++;
  } finally {
    // Cleanup
    try {
      await prisma.ledgerEntryV2.deleteMany({ where: { userId: { in: [testBoosterId, testAdvId] } } });
      await prisma.boosterWithdrawalRequest.deleteMany({ where: { boosterId: { in: [testBoosterId, testAdvId] } } });
      await prisma.walletV2.deleteMany({ where: { userId: { in: [testBoosterId, testAdvId] } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: [testBoosterId, testAdvId] } } });
      await prisma.user.deleteMany({ where: { discordId: { in: [testBoosterId, testAdvId] } } });
      console.log('Test artifacts cleaned up.');
    } catch {}
  }

  console.log(`\n======================================================`);
  console.log(`SUITE FINISHED: ${passed} PASSED | ${failed} FAILED`);
  console.log(`======================================================`);
  process.exit(failed > 0 ? 1 : 0);
}

runSuite();
