/**
 * order_amount_pair_booster_pool_suite.ts — Comprehensive Test Suite for:
 * 1. G4X External Order Amount Pair parsing: "Site Gross - Booster Pool (USD)"
 * 2. Defensible Net validation against platform fee policies (G2G, SkyCoach, Eldorado)
 * 3. Mythic+ 4-Booster Equal Distribution & Exact One-Cent Remainder Preservation
 * 4. Advertiser Single-Amount isolation & rank commission preservation
 * 5. End-to-End Discord Modal Submission & Ephemeral / Card Embed Display
 */

import prisma from '../database/db';
import {
  parseExternalOrderAmountPair,
  parseDecimalStringToCents,
  validateExternalOrderDefensibleNet,
  formatBoosterShareDisplay,
  splitPoolEquallyWithRemainder,
  calculateOrderFinancialSnapshot,
} from '../services/financialCalculationEngine';
import { seedStandardFeePolicies } from '../services/financialPolicyService';
import {
  createWizardSession,
  updateWizardSession,
} from '../services/orderWizardStateService';
import { handleOrderWizardModalSubmit } from '../interactions/orderWizardInteractions';
import { buildOrderEmbed } from '../services/orderDiscordService';
import { AdvertiserRank } from '../services/advertiserRankService';

function assert(condition: boolean, testName: string, details?: any) {
  if (!condition) {
    console.error(`❌ FAILED: ${testName}`, details ? details : '');
    throw new Error(`Test failed: ${testName}`);
  }
  console.log(`✅ PASSED: ${testName}`);
}

async function runSuite() {
  console.log('========================================================================');
  console.log('🧪 RUNNING: Order Amount Pair & Booster Pool Calculation Suite');
  console.log('========================================================================\n');

  await seedStandardFeePolicies();

  const ts = Date.now();
  const testManagerId = `mgr_test_${ts}`;
  const testAdvId = `adv_test_${ts}`;
  const testGuildId = 'guild_amount_suite_123';

  // Create test users
  await prisma.user.upsert({
    where: { discordId: testManagerId },
    update: {},
    create: {
      discordId: testManagerId,
      username: `manager_${ts}`,
      userRoles: { create: [{ roleKey: 'manager' }] },
    },
  });

  await prisma.user.upsert({
    where: { discordId: testAdvId },
    update: { advertiserRank: AdvertiserRank.GOLD },
    create: {
      discordId: testAdvId,
      username: `adv_${ts}`,
      advertiserRank: AdvertiserRank.GOLD,
      userRoles: { create: [{ roleKey: 'advertiser' }] },
    },
  });

  // Ensure game and service exist
  let testGame = await prisma.game.findFirst({ where: { slug: 'wow_midnight', isActive: true } });
  if (!testGame) {
    testGame = await prisma.game.create({
      data: {
        slug: 'wow_midnight',
        displayName: 'World of Warcraft: Midnight',
        serviceCategory: 'rpg',
        isActive: true,
      },
    });
  }

  let testMythicService = await prisma.gameService.findFirst({
    where: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus', isActive: true },
  });
  if (!testMythicService) {
    testMythicService = await prisma.gameService.create({
      data: {
        gameSlug: 'wow_midnight',
        serviceKey: 'mythic_plus',
        displayName: 'Mythic+ Keystone Run',
        serviceMode: 'non_pilot',
        profileMode: 'public',
        isActive: true,
      },
    });
  }

  // Ensure platform accounts
  const g2gAccount = await prisma.platformAccount.upsert({
    where: { accountRef: 'g2g_amount_suite' },
    update: { isActive: true },
    create: {
      accountRef: 'g2g_amount_suite',
      platform: 'g2g',
      displayName: 'G2G Suite Main',
      isActive: true,
    },
  });

  const skyAccount = await prisma.platformAccount.upsert({
    where: { accountRef: 'sky_amount_suite' },
    update: { isActive: true },
    create: {
      accountRef: 'sky_amount_suite',
      platform: 'skycoach',
      displayName: 'SkyCoach Suite Main',
      isActive: true,
    },
  });

  const eldoradoAccount = await prisma.platformAccount.upsert({
    where: { accountRef: 'eldo_amount_suite' },
    update: { isActive: true },
    create: {
      accountRef: 'eldo_amount_suite',
      platform: 'eldorado',
      displayName: 'Eldorado Suite Main',
      isActive: true,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PART 1: Format Parsing & Integer Cent Safety
  // ─────────────────────────────────────────────────────────────────────────
  console.log('--- PART 1: Parsing "Site Gross - Booster Pool (USD)" ---');

  // 1. Valid: 120-100
  const pair1 = parseExternalOrderAmountPair('120-100');
  assert(
    pair1.grossMinor === 12000 && pair1.boosterPoolMinor === 10000,
    '1. Valid pair "120-100" parsed into exact integer cents (12000 and 10000)'
  );

  // 2. Valid: 120.50-100.25
  const pair2 = parseExternalOrderAmountPair('120.50-100.25');
  assert(
    pair2.grossMinor === 12050 && pair2.boosterPoolMinor === 10025,
    '2. Valid pair with decimals "120.50-100.25" parsed into exact integer cents (12050 and 10025)'
  );

  // 3. Valid: 120 - 100 (optional whitespace)
  const pair3 = parseExternalOrderAmountPair('120 - 100');
  assert(
    pair3.grossMinor === 12000 && pair3.boosterPoolMinor === 10000,
    '3. Valid pair with spaces "120 - 100" parsed into exact integer cents'
  );

  // 4. Valid: leading and trailing spaces
  const pair4 = parseExternalOrderAmountPair('   120.5 - 100.25   ');
  assert(
    pair4.grossMinor === 12050 && pair4.boosterPoolMinor === 10025,
    '4. Valid pair with leading/trailing spaces parsed correctly'
  );

  // 5. Do NOT parse '-' as mathematical subtraction
  assert(
    pair1.boosterPoolMinor !== 2000 && pair1.grossMinor === 12000 && pair1.boosterPoolMinor === 10000,
    '5. Does not parse "-" as subtraction (120-100 is NOT parsed as 20)'
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PART 2: Rejection of Malformed and Invalid Inputs
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- PART 2: Rejections of Malformed / Invalid Values ---');

  const malformedInputs = [
    { input: '', desc: 'Empty string' },
    { input: '   ', desc: 'Whitespace string' },
    { input: '120', desc: 'Single number without pool' },
    { input: '120-', desc: 'Missing booster pool number' },
    { input: '-100', desc: 'Missing gross number' },
    { input: '-120-100', desc: 'Negative gross amount' },
    { input: '120--100', desc: 'Negative booster pool amount' },
    { input: '0-0', desc: 'Zero gross and zero pool' },
    { input: '0-100', desc: 'Zero gross amount' },
    { input: '120-0', desc: 'Zero booster pool amount' },
    { input: '120-100-50', desc: 'Multiple dashes' },
    { input: 'abc-100', desc: 'Non-numeric gross' },
    { input: '120-xyz', desc: 'Non-numeric booster pool' },
    { input: '120.555-100', desc: 'More than 2 decimal places on gross' },
    { input: '120-100.255', desc: 'More than 2 decimal places on booster pool' },
    { input: '100-120', desc: 'Booster pool greater than gross (100-120)' },
    { input: '100.25-100.50', desc: 'Booster pool greater than gross with decimals' },
    { input: '9007199254740992-100', desc: 'Unsafe integer value' },
  ];

  for (const { input, desc } of malformedInputs) {
    let rejected = false;
    try {
      parseExternalOrderAmountPair(input as any);
    } catch {
      rejected = true;
    }
    assert(rejected, `6. Rejects: ${desc} ("${input}")`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PART 3: Financial Validation & Defensible Net Availability
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- PART 3: Defensible Net Availability on External Platforms ---');

  // G2G: 8.99% commission
  // 120 gross -> commission: round(12000 * 0.0899) = 1079 -> net: 10921 ($109.21)
  const g2gValid = await validateExternalOrderDefensibleNet({
    platform: 'g2g',
    grossMinor: 12000,
    boosterPoolMinor: 10000,
  });
  assert(
    g2gValid.isDefensible &&
    g2gValid.platformCommissionMinor === 1079 &&
    g2gValid.platformNetMinor === 10921,
    '7. G2G defensible net validated: $120.00 gross -> $10.79 fee (8.99%) -> $109.21 net >= $100.00 pool'
  );

  // G2G Deficit Risk: Gross $100.00 -> Net $91.01. Pool $95.00 exceeds net!
  let g2gDeficitRejected = false;
  try {
    await validateExternalOrderDefensibleNet({
      platform: 'g2g',
      grossMinor: 10000,
      boosterPoolMinor: 9500,
    });
  } catch (err: any) {
    if (err.message.includes('EXCESSIVE_BOOSTER_POOL')) {
      g2gDeficitRejected = true;
    }
  }
  assert(
    g2gDeficitRejected,
    '8. G2G rejects booster pool ($95.00) exceeding defensible net ($91.01) (EXCESSIVE_BOOSTER_POOL)'
  );

  // SkyCoach: 10% commission
  // 120.50 gross (12050) -> commission: round(12050 * 0.10) = 1205 -> net: 10845 ($108.45)
  const skyValid = await validateExternalOrderDefensibleNet({
    platform: 'skycoach',
    grossMinor: 12050,
    boosterPoolMinor: 10025,
  });
  assert(
    skyValid.isDefensible &&
    skyValid.platformCommissionMinor === 1205 &&
    skyValid.platformNetMinor === 10845,
    '9. SkyCoach defensible net validated: $120.50 gross -> $12.05 fee (10%) -> $108.45 net >= $100.25 pool'
  );

  // SkyCoach Deficit Risk: Gross $100.00 -> Net $90.00. Pool $92.00 exceeds net!
  let skyDeficitRejected = false;
  try {
    await validateExternalOrderDefensibleNet({
      platform: 'skycoach',
      grossMinor: 10000,
      boosterPoolMinor: 9200,
    });
  } catch (err: any) {
    if (err.message.includes('EXCESSIVE_BOOSTER_POOL')) {
      skyDeficitRejected = true;
    }
  }
  assert(
    skyDeficitRejected,
    '10. SkyCoach rejects booster pool ($92.00) exceeding defensible net ($90.00)'
  );

  // Eldorado: 1.5% commission on WoW Currency
  // 200.00 gross (20000) -> commission: round(20000 * 0.015) = 300 -> net: 19700 ($197.00)
  const eldoValid = await validateExternalOrderDefensibleNet({
    platform: 'eldorado',
    grossMinor: 20000,
    boosterPoolMinor: 19500,
    gameSlug: 'wow',
    listingCategory: 'currency',
  });
  assert(
    eldoValid.isDefensible &&
    eldoValid.platformCommissionMinor === 300 &&
    eldoValid.platformNetMinor === 19700,
    '11. Eldorado defensible net validated: $200.00 gross -> $3.00 fee (1.5%) -> $197.00 net >= $195.00 pool'
  );

  // Eldorado Deficit Risk: Gross $200.00 -> Net $197.00. Pool $198.00 exceeds net!
  let eldoDeficitRejected = false;
  try {
    await validateExternalOrderDefensibleNet({
      platform: 'eldorado',
      grossMinor: 20000,
      boosterPoolMinor: 19800,
      gameSlug: 'wow',
      listingCategory: 'currency',
    });
  } catch (err: any) {
    if (err.message.includes('EXCESSIVE_BOOSTER_POOL')) {
      eldoDeficitRejected = true;
    }
  }
  assert(
    eldoDeficitRejected,
    '12. Eldorado rejects booster pool ($198.00) exceeding defensible net ($197.00)'
  );

  // Missing Fee Policy: Fail closed
  let missingPolicyRejected = false;
  try {
    await validateExternalOrderDefensibleNet({
      platform: 'eldorado',
      grossMinor: 10000,
      boosterPoolMinor: 8000,
      gameSlug: 'unregistered_game_xyz',
      listingCategory: 'unregistered_category',
    });
  } catch (err: any) {
    if (err.message.includes('MISSING_FEE_POLICY')) {
      missingPolicyRejected = true;
    }
  }
  assert(
    missingPolicyRejected,
    '13. Fails closed with MISSING_FEE_POLICY when applicable fee policy is missing or unapproved'
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PART 4: Mythic+ 4-Booster Equal Distribution & One-Cent Remainder
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- PART 4: Mythic+ 4-Booster Equal Distribution ---');

  const boosterIds4 = ['b_tank', 'b_heal', 'b_dps1', 'b_dps2'];

  // Case A: Even split — $100.00 (10000 cents) / 4 = $25.00 each
  const split100 = splitPoolEquallyWithRemainder(10000, boosterIds4);
  assert(
    split100.length === 4 &&
    split100.every((b) => b.allocatedMinor === 2500) &&
    split100.reduce((sum, b) => sum + b.allocatedMinor, 0) === 10000,
    '14. Even pool ($100.00) splits into exactly 4 x 2500 cents ($25.00 each)'
  );
  const display100 = formatBoosterShareDisplay(10000, 4);
  assert(
    display100.isExact === true &&
    display100.displayText === '$25.00 each' &&
    display100.breakdownText === '4 × $25.00',
    '15. Even pool formatBoosterShareDisplay shows "$25.00 each" and "4 × $25.00"'
  );

  // Case B: 1-cent remainder — $100.01 (10001 cents) / 4 = 1 x $25.01, 3 x $25.00
  const split100_01 = splitPoolEquallyWithRemainder(10001, boosterIds4);
  const shares01 = split100_01.map((b) => b.allocatedMinor);
  assert(
    shares01[0] === 2501 &&
    shares01[1] === 2500 &&
    shares01[2] === 2500 &&
    shares01[3] === 2500 &&
    shares01.reduce((sum, v) => sum + v, 0) === 10001,
    '16. 1-cent remainder ($100.01) preserves penny: 1 x $25.01, 3 x $25.00 (Conservation Invariant)'
  );
  const display100_01 = formatBoosterShareDisplay(10001, 4);
  assert(
    display100_01.isExact === false &&
    display100_01.displayText === '$25.00 - $25.01 each' &&
    display100_01.breakdownText === '1 × $25.01, 3 × $25.00',
    '17. 1-cent remainder formatBoosterShareDisplay displays range "$25.00 - $25.01 each"'
  );

  // Case C: 2-cent remainder — $100.02 (10002 cents)
  const split100_02 = splitPoolEquallyWithRemainder(10002, boosterIds4);
  const shares02 = split100_02.map((b) => b.allocatedMinor);
  assert(
    shares02[0] === 2501 &&
    shares02[1] === 2501 &&
    shares02[2] === 2500 &&
    shares02[3] === 2500 &&
    shares02.reduce((sum, v) => sum + v, 0) === 10002,
    '18. 2-cent remainder ($100.02): 2 x $25.01, 2 x $25.00'
  );
  const display100_02 = formatBoosterShareDisplay(10002, 4);
  assert(
    display100_02.isExact === false &&
    display100_02.breakdownText === '2 × $25.01, 2 × $25.00',
    '19. 2-cent remainder breakdown shows "2 × $25.01, 2 × $25.00"'
  );

  // Case D: 3-cent remainder — $100.03 (10003 cents)
  const split100_03 = splitPoolEquallyWithRemainder(10003, boosterIds4);
  const shares03 = split100_03.map((b) => b.allocatedMinor);
  assert(
    shares03[0] === 2501 &&
    shares03[1] === 2501 &&
    shares03[2] === 2501 &&
    shares03[3] === 2500 &&
    shares03.reduce((sum, v) => sum + v, 0) === 10003,
    '20. 3-cent remainder ($100.03): 3 x $25.01, 1 x $25.00'
  );
  const display100_03 = formatBoosterShareDisplay(10003, 4);
  assert(
    display100_03.isExact === false &&
    display100_03.breakdownText === '3 × $25.01, 1 × $25.00',
    '21. 3-cent remainder breakdown shows "3 × $25.01, 1 × $25.00"'
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PART 5: End-to-End Discord Modal Integration (G4X External vs. Advertiser)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- PART 5: Discord Dropdown Wizard End-to-End Integration ---');

  // A. G4X External Modal Submission with Valid Pair (120-100)
  const g4xSession = await createWizardSession({
    userId: testManagerId,
    guildId: testGuildId,
    origin: 'g4x',
  });
  await updateWizardSession(g4xSession.sessionId, {
    platform: 'g2g',
    platformAccountId: g2gAccount.id,
    platformAccountRef: g2gAccount.accountRef,
    gameSlug: 'wow_midnight',
    serviceId: testMythicService.id,
    serviceKey: testMythicService.serviceKey,
    serviceName: testMythicService.displayName,
    orderMode: 'non_pilot',
    step: 'modal',
  });

  let replyG4x: any = null;
  await handleOrderWizardModalSubmit({
    customId: `ord_wiz:modal:${g4xSession.sessionId}`,
    user: { id: testManagerId },
    guildId: testGuildId,
    fields: {
      getTextInputValue: (f: string) => {
        if (f === 'site_order_id') return `G2G-PAIR-${ts}`;
        if (f === 'amount_usd') return '120-100';
        if (f === 'key_level') return '+10 Siege of Boralus';
        if (f === 'runs_count') return '1';
        return '';
      },
    },
    reply: async (p: any) => { replyG4x = p; },
  } as any);

  assert(
    replyG4x?.embeds?.[0]?.data?.title?.includes('Created Successfully'),
    '22. G4X order submitted with "120-100" succeeds'
  );

  const confirmDescription = replyG4x?.embeds?.[0]?.data?.description || '';
  assert(
    confirmDescription.includes('Site Gross Amount') &&
    confirmDescription.includes('$120.00 USD') &&
    confirmDescription.includes('Expected Platform Net') &&
    confirmDescription.includes('$109.21 USD') &&
    confirmDescription.includes('Total Booster Pool') &&
    confirmDescription.includes('$100.00 USD') &&
    confirmDescription.includes('Per Booster Share (4 Boosters)') &&
    confirmDescription.includes('$25.00 each'),
    '23. Confirmation embed displays Gross ($120.00), Defensible Net ($109.21), Total Pool ($100.00), and Per Booster Share ($25.00 each)'
  );

  const createdG4xOrder = await prisma.order.findFirst({
    where: { externalOrderId: `G2G-PAIR-${ts}` },
    include: { financialSnapshot: true },
  });
  assert(
    createdG4xOrder !== null &&
    createdG4xOrder.grossAmountMinor === 12000 &&
    createdG4xOrder.boosterPoolMinor === 10000 &&
    createdG4xOrder.paymentStatus === 'unneeded' &&
    createdG4xOrder.status === 'open_presign',
    '24. Order persisted with grossAmountMinor 12000, boosterPoolMinor 10000, paymentStatus unneeded'
  );

  const snapG4x = createdG4xOrder!.financialSnapshot;
  assert(
    snapG4x !== null &&
    snapG4x.grossSaleMinor === 12000 &&
    snapG4x.platformSaleCommissionMinor === 1079 &&
    snapG4x.platformOrderNetMinor === 10921 &&
    snapG4x.boosterPoolMinor === 10000 &&
    snapG4x.calculationStatus === 'provisional',
    '25. Financial snapshot records 1079 platform fee, 10921 net, 10000 booster pool, provisional status'
  );

  // Verify Gross minus Booster Pool ($9.21) is NOT treated as G4X net revenue or received cash
  assert(
    snapG4x!.g4xFeeMinor === 0,
    '26. Gross minus Booster Pool difference is NOT treated as G4X net revenue'
  );

  // Verify Order Card Embed contains Booster Reward and Per Booster Share
  const cardEmbed = buildOrderEmbed(createdG4xOrder);
  const boosterField = cardEmbed.data.fields?.find((f) => f.name.includes('Booster Reward'));
  assert(
    boosterField !== undefined &&
    boosterField.value.includes('$100.00 USD') &&
    boosterField.value.includes('$25.00 each'),
    '27. Discord Order Card embed displays Total Booster Pool ($100.00 USD) and Per Booster Share ($25.00 each)'
  );

  // B. G4X External Modal Submission with Deficit Risk (100-95 on G2G)
  const g4xDeficitSession = await createWizardSession({
    userId: testManagerId,
    guildId: testGuildId,
    origin: 'g4x',
  });
  await updateWizardSession(g4xDeficitSession.sessionId, {
    platform: 'g2g',
    platformAccountId: g2gAccount.id,
    platformAccountRef: g2gAccount.accountRef,
    gameSlug: 'wow_midnight',
    serviceId: testMythicService.id,
    serviceKey: testMythicService.serviceKey,
    serviceName: testMythicService.displayName,
    orderMode: 'non_pilot',
    step: 'modal',
  });

  let replyDeficit: any = null;
  await handleOrderWizardModalSubmit({
    customId: `ord_wiz:modal:${g4xDeficitSession.sessionId}`,
    user: { id: testManagerId },
    guildId: testGuildId,
    fields: {
      getTextInputValue: (f: string) => {
        if (f === 'site_order_id') return `G2G-DEFICIT-${ts}`;
        if (f === 'amount_usd') return '100-95';
        if (f === 'key_level') return '+10 Grim Batol';
        if (f === 'runs_count') return '1';
        return '';
      },
    },
    reply: async (p: any) => { replyDeficit = p; },
  } as any);

  assert(
    replyDeficit?.content?.includes('Financial Validation Failed') &&
    replyDeficit?.content?.includes('EXCESSIVE_BOOSTER_POOL'),
    '28. Modal submit rejects pool exceeding available net with EXCESSIVE_BOOSTER_POOL'
  );

  // C. Advertiser Order with Single Amount (Preserves Rank Commission)
  const advSession = await createWizardSession({
    userId: testAdvId,
    guildId: testGuildId,
    origin: 'adv',
  });
  await updateWizardSession(advSession.sessionId, {
    gameSlug: 'wow_midnight',
    serviceId: testMythicService.id,
    serviceKey: testMythicService.serviceKey,
    serviceName: testMythicService.displayName,
    orderMode: 'non_pilot',
    step: 'modal',
  });

  let replyAdv: any = null;
  await handleOrderWizardModalSubmit({
    customId: `ord_wiz:modal:${advSession.sessionId}`,
    user: { id: testAdvId },
    guildId: testGuildId,
    fields: {
      getTextInputValue: (f: string) => {
        if (f === 'amount_usd') return '80.00';
        if (f === 'key_level') return '+10 Grim Batol';
        if (f === 'runs_count') return '1';
        return '';
      },
    },
    reply: async (p: any) => { replyAdv = p; },
  } as any);

  assert(
    replyAdv?.embeds?.[0]?.data?.title?.includes('Created Successfully'),
    '29. Advertiser single amount "80.00" succeeds without pair input requirement'
  );

  const createdAdvOrder = await prisma.order.findFirst({
    where: { creatorId: testAdvId },
    orderBy: { id: 'desc' },
    include: { financialSnapshot: true },
  });
  assert(
    createdAdvOrder !== null &&
    createdAdvOrder.grossAmountMinor === 8000 &&
    createdAdvOrder.financialSnapshot?.advertiserRank === AdvertiserRank.GOLD &&
    createdAdvOrder.financialSnapshot?.rankFeeBasisPoints === 1099 &&
    createdAdvOrder.boosterPoolMinor === 8000 - Math.round(8000 * 0.1099),
    '30. Advertiser Gold rank commission (10.99%) preserved exactly'
  );

  console.log('\n========================================================================');
  console.log('🎉 ALL 30 ASSERTIONS PASSED SUCCESSFULLY!');
  console.log('========================================================================');
}

runSuite()
  .catch((e) => {
    console.error('Test suite failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
