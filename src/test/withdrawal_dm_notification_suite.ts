/**
 * src/test/withdrawal_dm_notification_suite.ts
 *
 * تست خودکار سرویس ارسال پیام خصوصی (Discord DM) پس از پرداخت و تسویه Withdrawal
 */

import {
  buildWithdrawalPaidPayload,
  dispatchWithdrawalPaidDirectMessage,
  WithdrawalNotificationDetails,
} from '../services/financeV2/withdrawalNotificationService';

function assert(condition: any, testName: string, detail?: string) {
  if (!condition) {
    console.error(`❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    throw new Error(`Assertion failed: ${testName}`);
  }
  console.log(`✅ [PASS] ${testName}`);
}

export async function runWithdrawalDmNotificationSuite(): Promise<void> {
  console.log('\n=== STARTING WITHDRAWAL DM NOTIFICATION TEST SUITE ===\n');

  // 1. تست ساختار پیام و امبد برای تسویه تومانی (IRT_BANK)
  const irtWithdrawal: WithdrawalNotificationDetails = {
    id: 101,
    withdrawalRef: 'WDR_IRT_BANK_1731682999_TEST',
    boosterId: '123456789012345678',
    payoutMethod: 'IRT_BANK',
    requestedUsdCents: 5000, // $50.00
    fixedFeeUsdCents: 100,  // $1.00
    netUsdCents: 4900,      // $49.00
    quotedNetPayoutAmount: '4500000',
    quotedCurrency: 'IRT',
    destinationAddress: 'IR120120000000001234567890',
    destinationAccountHolder: 'Ali Rezaei',
    bankReceiptRef: 'PAYA-9876543210',
    processedAt: new Date('2026-11-15T12:00:00Z'),
  };

  const irtPayload = buildWithdrawalPaidPayload(irtWithdrawal, 'https://g4xcommunity.com');
  assert(
    irtPayload.embed.data.title?.includes('Settlement Receipt'),
    '1. IRT Payout embed title correctly indicates official settlement receipt',
    `Title: ${irtPayload.embed.data.title}`
  );
  assert(
    irtPayload.embed.data.fields?.some((f) => f.value.includes('4,500,000 تومان')),
    '2. IRT Payout embed displays formatted Toman disbursed amount with thousand separators',
    'Toman amount verified'
  );
  assert(
    irtPayload.embed.data.fields?.some((f) => f.value.includes('Ali Rezaei') && f.value.includes('IR120120000000001234567890')),
    '3. IRT Payout embed contains Sheba number and account holder name',
    'Account holder and IBAN verified'
  );
  assert(
    irtPayload.embed.data.fields?.some((f) => f.value.includes('PAYA-9876543210')),
    '4. IRT Payout embed contains bank tracking receipt reference',
    'Bank tracking code verified'
  );

  // 2. تست ساختار پیام و امبد برای تسویه تتر (USDT_BEP20)
  const usdtWithdrawal: WithdrawalNotificationDetails = {
    id: 102,
    withdrawalRef: 'WDR_USDT_BEP20_1731683000_TEST',
    boosterId: '987654321098765432',
    payoutMethod: 'USDT_BEP20',
    requestedUsdCents: 10000, // $100.00
    fixedFeeUsdCents: 30,    // $0.30
    netUsdCents: 9970,       // $99.70
    quotedNetPayoutAmount: '99.70',
    quotedCurrency: 'USDT',
    destinationAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    externalTxHash: '0x3a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b',
    processedAt: new Date('2026-11-15T12:00:00Z'),
  };

  const usdtPayload = buildWithdrawalPaidPayload(usdtWithdrawal, 'https://g4xcommunity.com');
  assert(
    usdtPayload.embed.data.fields?.some((f) => f.value.includes('$99.70 USDT')),
    '5. USDT Payout embed displays exact net USDT disbursed amount',
    'Net USDT verified'
  );
  assert(
    usdtPayload.embed.data.fields?.some((f) => f.value.includes('bscscan.com/tx/0x3a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b')),
    '6. USDT Payout embed provides direct BscScan blockchain explorer URL',
    'BscScan link verified'
  );

  // 3. تست ارسال DM با دیسکورد کلاینت ماک (Mock Client)
  let sentMessagePayload: any = null;
  const mockClient = {
    users: {
      fetch: async (id: string) => {
        if (id === '123456789012345678') {
          return {
            id,
            send: async (msg: any) => {
              sentMessagePayload = msg;
              return { id: 'msg_999' };
            },
          };
        }
        return null;
      },
    },
  };

  const dispatchResult = await dispatchWithdrawalPaidDirectMessage(irtWithdrawal, mockClient);
  assert(
    dispatchResult.success && dispatchResult.dmSent,
    '7. dispatchWithdrawalPaidDirectMessage successfully sends DM to booster user',
    `Result: ${JSON.stringify(dispatchResult)}`
  );
  assert(
    sentMessagePayload !== null && sentMessagePayload.embeds?.length > 0,
    '8. Sent Discord message payload contains rich embed and action components',
    'Message payload verified'
  );

  // 4. تست سناریوی بسته بودن DM (Discord Error 50007)
  const mockClosedDmClient = {
    users: {
      fetch: async (id: string) => {
        return {
          id,
          send: async () => {
            const err: any = new Error('Cannot send messages to this user');
            err.code = 50007;
            throw err;
          },
        };
      },
    },
  };

  const closedDmResult = await dispatchWithdrawalPaidDirectMessage(irtWithdrawal, mockClosedDmClient);
  assert(
    closedDmResult.success === true && closedDmResult.dmSent === false,
    '9. Closed DM error is caught gracefully without throwing unhandled exceptions',
    `Error gracefully handled: ${closedDmResult.error}`
  );

  // 5. تست عدم وجود دیسکورد کلاینت (Offline Client Safe Fallback)
  const noClientResult = await dispatchWithdrawalPaidDirectMessage(irtWithdrawal, null);
  assert(
    noClientResult.success === true && noClientResult.dmSent === false,
    '10. Null client fallback handles offline/test environments safely',
    `Offline handled: ${noClientResult.error}`
  );

  console.log('\n======================================================');
  console.log('WITHDRAWAL DM NOTIFICATION TEST SUITE: ALL PASSED');
  console.log('======================================================\n');
}

if (require.main === module) {
  runWithdrawalDmNotificationSuite().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
}
