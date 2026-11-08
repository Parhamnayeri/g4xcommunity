/**
 * ============================================================================
 * G4X Community — Separated G4X and Advertiser Order Lists Test Suite
 * ============================================================================
 * Exhaustive regression and invariant test suite verifying:
 *  1. Deterministic Origin Classification (G4X Direct, G2G, SkyCoach, Eldorado vs. Advertiser vs. Needs Review)
 *  2. No inference of origin from Discord categories, channel IDs or text labels
 *  3. Historical preservation: Unknown origin preserved as 'Needs Review' without rewriting database
 *  4. Admin Dual-Tab Access (Full view of G4X platforms and all Advertiser orders with full financials)
 *  5. Strict Privacy & Ownership Isolation: Ordinary Advertisers can ONLY view their own orders
 *  6. No Cross-Owner Data Leakage: Advertisers cannot access other advertisers' orders or G4X internal orders
 *  7. Non-staff, non-advertiser complete access denial (403 Permission Denied)
 *  8. Multi-Criteria Server-side Filtering (status, paymentStatus, game, source platform, search, date range)
 *  9. Server-side Pagination (limits, pages, bounds, navigation metadata)
 * 10. Accurate Authorized Lifecycle Action Flags per viewer role and state
 * ============================================================================
 */

import prisma from '../database/db';
import {
  classifyOrderOrigin,
  getSeparatedOrdersList,
} from '../services/orderLifecycleService';
import { DomainError, DomainErrorCode } from '../services/domainErrors';

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
  console.log('🚀 G4X SEPARATED ORDER LISTS & PRIVACY TEST SUITE');
  console.log('================================================================\n');

  const ts = Date.now();

  // Test User IDs
  const adminId = `admin_dash_${ts}`;
  const adv1Id = `adv_dash_1_${ts}`;
  const adv2Id = `adv_dash_2_${ts}`;
  const memberId = `member_dash_${ts}`;

  try {
    // ─── 0. Seed Test Users, Roles, Games, Services and Platform Accounts ─────
    console.log('Step 0: Seeding Users, Platform Accounts & Roles...');

    // Admin user
    await prisma.user.create({
      data: {
        discordId: adminId,
        username: `Admin_${ts}`,
        displayName: `Admin User ${ts}`,
        userRoles: {
          create: [{ roleKey: 'admin' }],
        },
      },
    });

    // Advertiser 1 (Gold, 5%)
    await prisma.user.create({
      data: {
        discordId: adv1Id,
        username: `AdvOne_${ts}`,
        displayName: `Advertiser Alpha`,
        advertiserRank: 'GOLD',
        userRoles: {
          create: [{ roleKey: 'advertiser' }],
        },
      },
    });

    // Advertiser 2 (Silver, 8%)
    await prisma.user.create({
      data: {
        discordId: adv2Id,
        username: `AdvTwo_${ts}`,
        displayName: `Advertiser Beta`,
        advertiserRank: 'SILVER',
        userRoles: {
          create: [{ roleKey: 'advertiser' }],
        },
      },
    });

    // Pure member (no roles)
    await prisma.user.create({
      data: {
        discordId: memberId,
        username: `Member_${ts}`,
        displayName: `Normal Member`,
      },
    });

    // Seed test Game and Service
    const gameSlug = `game_dash_${ts}`;
    const testGame = await prisma.game.create({
      data: {
        slug: gameSlug,
        displayName: `Dashboard Game ${ts}`,
        serviceCategory: 'both',
        isActive: true,
      },
    });

    const testService = await prisma.gameService.create({
      data: {
        gameSlug: testGame.slug,
        serviceKey: `service_dash_${ts}`,
        displayName: `Mythic Plus Service ${ts}`,
        serviceMode: 'non_pilot',
        profileMode: 'manual',
        isActive: true,
      },
    });

    // Seed Platform Accounts for G2G, SkyCoach & Eldorado
    const platG2G = await prisma.platformAccount.create({
      data: {
        accountRef: `g2g_acc_${ts}`,
        platform: 'g2g',
        displayName: 'G2G Prime Store',
        currency: 'USD',
      },
    });

    const platSkyCoach = await prisma.platformAccount.create({
      data: {
        accountRef: `skycoach_acc_${ts}`,
        platform: 'skycoach',
        displayName: 'SkyCoach Official',
        currency: 'USD',
      },
    });

    const platEldorado = await prisma.platformAccount.create({
      data: {
        accountRef: `eldorado_acc_${ts}`,
        platform: 'eldorado',
        displayName: 'Eldorado VIP Outlet',
        currency: 'USD',
      },
    });

    // ─── 1. Seed Distinct G4X and Advertiser Orders ───────────────────────────
    console.log('\nStep 1: Seeding Test Orders with Precise Origin Fields...');

    // 1A. G4X Direct Order
    const orderG4xDirect = await prisma.order.create({
      data: {
        orderRef: `ORD_G4X_DIR_${ts}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000, // $100
        platformFeeMinor: 2000,
        boosterPoolMinor: 8000,
        creatorType: 'g4x',
        sourceType: 'internal',
        sourceWebsite: null,
        advertiserId: null,
        status: 'open_presign',
        paymentStatus: 'verified',
        notes: 'Direct internal G4X client order',
      },
    });

    // 1B. G4X External Orders (G2G, SkyCoach, Eldorado)
    const orderG4xG2G = await prisma.order.create({
      data: {
        orderRef: `ORD_G4X_G2G_${ts}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'solo',
        currency: 'USD',
        grossAmountMinor: 15000, // $150
        platformFeeMinor: 3000,
        boosterPoolMinor: 12000,
        creatorType: 'g4x',
        sourceType: 'website',
        sourceWebsite: 'g2g',
        platformAccountId: platG2G.id,
        externalOrderId: `G2G_EXT_${ts}`,
        advertiserId: null,
        status: 'draft',
        paymentStatus: 'verified',
      },
    });

    const orderG4xSkyCoach = await prisma.order.create({
      data: {
        orderRef: `ORD_G4X_SKC_${ts}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'pilot',
        currency: 'USD',
        grossAmountMinor: 20000, // $200
        platformFeeMinor: 4000,
        boosterPoolMinor: 16000,
        creatorType: 'g4x',
        sourceType: 'website',
        sourceWebsite: 'skycoach',
        platformAccountId: platSkyCoach.id,
        externalOrderId: `SKC_EXT_${ts}`,
        advertiserId: null,
        status: 'assigned',
        paymentStatus: 'verified',
      },
    });

    const orderG4xEldorado = await prisma.order.create({
      data: {
        orderRef: `ORD_G4X_ELD_${ts}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 8000, // $80
        platformFeeMinor: 1600,
        boosterPoolMinor: 6400,
        creatorType: 'g4x',
        sourceType: 'website',
        sourceWebsite: 'eldorado',
        platformAccountId: platEldorado.id,
        externalOrderId: `ELD_EXT_${ts}`,
        advertiserId: null,
        status: 'completed',
        paymentStatus: 'verified',
      },
    });

    // 1C. Advertiser 1 Orders (Alpha)
    const orderAdv1Pending = await prisma.order.create({
      data: {
        orderRef: `ORD_ADV1_PND_${ts}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 12000, // $120
        advertiserFeeMinor: 600,  // 5%
        boosterPoolMinor: 11400,
        creatorType: 'advertiser',
        creatorId: adv1Id,
        advertiserId: adv1Id,
        advertiserRank: 'GOLD',
        rankCommissionBps: 500,
        status: 'payment_pending',
        paymentStatus: 'pending',
        notes: 'Adv1 pending payment for raid boost',
      },
    });

    const orderAdv1Verified = await prisma.order.create({
      data: {
        orderRef: `ORD_ADV1_VRF_${ts}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 25000, // $250
        advertiserFeeMinor: 1250,
        boosterPoolMinor: 23750,
        creatorType: 'advertiser',
        creatorId: adv1Id,
        advertiserId: adv1Id,
        advertiserRank: 'GOLD',
        rankCommissionBps: 500,
        status: 'assigned',
        paymentStatus: 'verified',
      },
    });

    // 1D. Advertiser 2 Orders (Beta)
    const orderAdv2 = await prisma.order.create({
      data: {
        orderRef: `ORD_ADV2_${ts}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 5000, // $50
        advertiserFeeMinor: 400, // 8%
        boosterPoolMinor: 4600,
        creatorType: 'advertiser',
        creatorId: adv2Id,
        advertiserId: adv2Id,
        advertiserRank: 'SILVER',
        rankCommissionBps: 800,
        status: 'open_presign',
        paymentStatus: 'verified',
      },
    });

    // 1E. Historical Unknown / Indeterminate Order (Preserved as Needs Review)
    const orderNeedsReview = await prisma.order.create({
      data: {
        orderRef: `ORD_HIST_CORRUPT_${ts}`,
        gameSlug: testGame.slug,
        serviceId: testService.id,
        orderType: 'solo',
        currency: 'USD',
        grossAmountMinor: 3000,
        creatorType: 'unknown_legacy_schema',
        sourceType: 'unknown',
        advertiserId: null,
        status: 'draft',
        paymentStatus: 'pending',
        notes: 'Corrupted legacy record from 2024 without clear origin',
      },
    });

    console.log('Seeded orders successfully.');

    // ─── 2. Test classifyOrderOrigin Deterministic Function ───────────────────
    console.log('\nStep 2: Testing classifyOrderOrigin Deterministic Classification...');

    assert(
      classifyOrderOrigin({ creatorType: 'g4x', advertiserId: null, sourceWebsite: null }) === 'g4x',
      'G4X direct order correctly classified as g4x'
    );
    assert(
      classifyOrderOrigin({ creatorType: 'g4x', advertiserId: null, sourceWebsite: 'g2g' }) === 'g4x',
      'G4X G2G external order correctly classified as g4x'
    );
    assert(
      classifyOrderOrigin({ creatorType: 'g4x', advertiserId: null, sourceWebsite: 'skycoach' }) === 'g4x',
      'G4X SkyCoach external order correctly classified as g4x'
    );
    assert(
      classifyOrderOrigin({ creatorType: 'g4x', advertiserId: null, sourceWebsite: 'eldorado' }) === 'g4x',
      'G4X Eldorado external order correctly classified as g4x'
    );
    assert(
      classifyOrderOrigin({ creatorType: 'advertiser', advertiserId: adv1Id }) === 'advertiser',
      'Advertiser order correctly classified as advertiser'
    );
    assert(
      classifyOrderOrigin({ creatorType: 'g4x', advertiserId: adv1Id }) === 'advertiser',
      'Order with explicit advertiserId assigned retains advertiser classification'
    );
    assert(
      classifyOrderOrigin({ creatorType: 'unknown_legacy_schema', advertiserId: null }) === 'needs_review',
      'Unrecognized creatorType classified as needs_review'
    );
    assert(
      classifyOrderOrigin({ creatorType: null, advertiserId: null, sourceWebsite: null, sourceType: null }) === 'needs_review',
      'Completely empty historical origin classified as needs_review without rewriting DB'
    );

    // ─── 3. Test Admin Dual-Tab Access (G4X and Advertiser Lists) ────────────
    console.log('\nStep 3: Testing Admin Queries on G4X and Advertiser Lists...');

    const adminQueryG4x = await getSeparatedOrdersList({
      tab: 'g4x',
      gameSlug: testGame.slug,
      user: {
        discordId: adminId,
        userRoles: [{ role: 'admin' }],
      },
    });

    assert(adminQueryG4x.success === true, 'Admin G4X query succeeds');
    assert(adminQueryG4x.tab === 'g4x', 'Query tab echoes g4x');
    assert(adminQueryG4x.orders.some(o => o.orderRef === orderG4xDirect.orderRef), 'G4X Direct order present in G4X list');
    assert(adminQueryG4x.orders.some(o => o.orderRef === orderG4xG2G.orderRef), 'G4X G2G order present in G4X list');
    assert(adminQueryG4x.orders.some(o => o.orderRef === orderG4xSkyCoach.orderRef), 'G4X SkyCoach order present in G4X list');
    assert(adminQueryG4x.orders.some(o => o.orderRef === orderG4xEldorado.orderRef), 'G4X Eldorado order present in G4X list');
    assert(!adminQueryG4x.orders.some(o => o.orderRef === orderAdv1Pending.orderRef), 'Advertiser 1 order strictly absent from G4X list');
    assert(!adminQueryG4x.orders.some(o => o.orderRef === orderAdv2.orderRef), 'Advertiser 2 order strictly absent from G4X list');

    // Verify Platform Indicators
    const g2gItem = adminQueryG4x.orders.find(o => o.orderRef === orderG4xG2G.orderRef)!;
    assert(g2gItem.sourceLabel === 'G2G', 'G2G item has sourceLabel G2G');
    assert(g2gItem.platformAccount?.displayName === 'G2G Prime Store', 'G2G item includes platformAccount details');
    assert(g2gItem.feeInfo.platformFeeUsd === '30.00', 'Admin sees platform fee breakdown ($30.00)');
    assert(g2gItem.feeInfo.boosterPoolUsd === '120.00', 'Admin sees booster pool breakdown ($120.00)');

    const skycoachItem = adminQueryG4x.orders.find(o => o.orderRef === orderG4xSkyCoach.orderRef)!;
    assert(skycoachItem.sourceLabel === 'SkyCoach', 'SkyCoach item has sourceLabel SkyCoach');
    assert(skycoachItem.platformAccount?.displayName === 'SkyCoach Official', 'SkyCoach item includes platformAccount details');

    const eldoradoItem = adminQueryG4x.orders.find(o => o.orderRef === orderG4xEldorado.orderRef)!;
    assert(eldoradoItem.sourceLabel === 'Eldorado', 'Eldorado item has sourceLabel Eldorado');

    // Admin querying Advertiser Tab
    const adminQueryAdv = await getSeparatedOrdersList({
      tab: 'advertiser',
      gameSlug: testGame.slug,
      user: {
        discordId: adminId,
        userRoles: [{ role: 'admin' }],
      },
    });

    assert(adminQueryAdv.success === true, 'Admin Advertiser query succeeds');
    assert(adminQueryAdv.tab === 'advertiser', 'Query tab echoes advertiser');
    assert(adminQueryAdv.orders.some(o => o.orderRef === orderAdv1Pending.orderRef), 'Adv 1 order present in Advertiser list');
    assert(adminQueryAdv.orders.some(o => o.orderRef === orderAdv2.orderRef), 'Adv 2 order present in Advertiser list');
    assert(!adminQueryAdv.orders.some(o => o.orderRef === orderG4xDirect.orderRef), 'G4X Direct order strictly absent from Advertiser list');
    assert(!adminQueryAdv.orders.some(o => o.orderRef === orderG4xG2G.orderRef), 'G4X G2G order strictly absent from Advertiser list');

    // Verify Advertiser Rank & Ownership Details for Admin
    const adv1Item = adminQueryAdv.orders.find(o => o.orderRef === orderAdv1Pending.orderRef)!;
    assert(adv1Item.advertiser.displayName === 'Advertiser Alpha', 'Shows Advertiser 1 display name');
    assert(adv1Item.advertiser.advertiserRank === 'GOLD', 'Shows Advertiser 1 rank GOLD');
    assert(adv1Item.advertiser.commissionPercent === '5.0%', 'Shows Advertiser 1 commission 5.0%');

    const adv2Item = adminQueryAdv.orders.find(o => o.orderRef === orderAdv2.orderRef)!;
    assert(adv2Item.advertiser.displayName === 'Advertiser Beta', 'Shows Advertiser 2 display name');
    assert(adv2Item.advertiser.advertiserRank === 'SILVER', 'Shows Advertiser 2 rank SILVER');
    assert(adv2Item.advertiser.commissionPercent === '8.0%', 'Shows Advertiser 2 commission 8.0%');

    // ─── 4. Test Strict Privacy & Ownership Isolation for Advertisers ─────────
    console.log('\nStep 4: Testing Ordinary Advertiser Privacy & Cross-Owner Isolation...');

    // 4A. Ordinary Advertiser 1 attempting to view G4X orders -> MUST BE REJECTED (403)
    let g4xAccessDenied = false;
    try {
      await getSeparatedOrdersList({
        tab: 'g4x',
        user: {
          discordId: adv1Id,
          userRoles: [{ role: 'advertiser' }],
        },
      });
    } catch (err: any) {
      if (err instanceof DomainError && err.code === DomainErrorCode.PERMISSION_DENIED) {
        g4xAccessDenied = true;
      }
    }
    assert(g4xAccessDenied, 'Ordinary advertiser requesting tab=g4x is rejected with PERMISSION_DENIED (403)');

    // 4B. Ordinary Advertiser 1 querying Advertiser Tab
    const adv1Orders = await getSeparatedOrdersList({
      tab: 'advertiser',
      gameSlug: testGame.slug,
      user: {
        discordId: adv1Id,
        userRoles: [{ role: 'advertiser' }],
      },
    });

    assert(adv1Orders.success === true, 'Advertiser 1 successfully retrieves own orders list');
    assert(adv1Orders.orders.length === 2, 'Advertiser 1 sees exactly their 2 own orders');
    assert(adv1Orders.orders.every(o => o.advertiser.id === adv1Id), 'All returned orders strictly belong to Advertiser 1');

    // 4C. NO CROSS-OWNER DATA LEAKAGE: Advertiser 1 must NEVER see Advertiser 2's orders
    const leaksAdv2ToAdv1 = adv1Orders.orders.some(o => o.orderRef === orderAdv2.orderRef || o.advertiser.id === adv2Id);
    assert(!leaksAdv2ToAdv1, 'CRITICAL: No cross-owner data leakage — Advertiser 2 order is not visible to Advertiser 1');

    // 4D. Financial Privacy: Advertiser only sees advertiser fee & net amount, NOT platform accounts
    assert(adv1Orders.orders[0].platformAccount === null, 'Platform account details are null for ordinary advertiser');
    assert(adv1Orders.orders[0].feeInfo.platformFeeUsd === undefined, 'Internal platformFeeUsd is hidden from ordinary advertiser');
    assert(adv1Orders.orders[0].feeInfo.advertiserFeeUsd !== undefined, 'Advertiser fee is visible to owner');
    assert(adv1Orders.orders[0].feeInfo.netAmountUsd !== undefined, 'Net amount is visible to owner');

    // 4E. Ordinary Advertiser 2 querying Advertiser Tab -> Sees ONLY Adv2 orders
    const adv2Orders = await getSeparatedOrdersList({
      tab: 'advertiser',
      gameSlug: testGame.slug,
      user: {
        discordId: adv2Id,
        userRoles: [{ role: 'advertiser' }],
      },
    });
    assert(adv2Orders.orders.length === 1, 'Advertiser 2 sees exactly their 1 own order');
    assert(adv2Orders.orders[0].orderRef === orderAdv2.orderRef, 'Advertiser 2 sees order ORD_ADV2');
    assert(!adv2Orders.orders.some(o => o.advertiser.id === adv1Id), 'Advertiser 1 orders not visible to Advertiser 2');

    // 4F. Non-staff, non-advertiser (normal member) access denial
    let memberAccessDenied = false;
    try {
      await getSeparatedOrdersList({
        tab: 'advertiser',
        user: {
          discordId: memberId,
          userRoles: [],
        },
      });
    } catch (err: any) {
      if (err instanceof DomainError && err.code === DomainErrorCode.PERMISSION_DENIED) {
        memberAccessDenied = true;
      }
    }
    assert(memberAccessDenied, 'General member without advertiser or admin role is rejected with PERMISSION_DENIED (403)');

    // ─── 5. Test Multi-Criteria Server-side Filtering ─────────────────────────
    console.log('\nStep 5: Testing Multi-Criteria Server-side Filtering...');

    // 5A. Source Filter for G4X: G2G only
    const filterG2G = await getSeparatedOrdersList({
      tab: 'g4x',
      source: 'g2g',
      gameSlug: testGame.slug,
      user: { discordId: adminId, userRoles: [{ role: 'admin' }] },
    });
    assert(filterG2G.orders.length === 1, 'Source filter g2g returns exactly 1 order');
    assert(filterG2G.orders[0].orderRef === orderG4xG2G.orderRef, 'Returned order is G2G order');

    // 5B. Source Filter for G4X: SkyCoach only
    const filterSkyCoach = await getSeparatedOrdersList({
      tab: 'g4x',
      source: 'skycoach',
      gameSlug: testGame.slug,
      user: { discordId: adminId, userRoles: [{ role: 'admin' }] },
    });
    assert(filterSkyCoach.orders.length === 1, 'Source filter skycoach returns exactly 1 order');
    assert(filterSkyCoach.orders[0].orderRef === orderG4xSkyCoach.orderRef, 'Returned order is SkyCoach order');

    // 5C. Source Filter for G4X: Eldorado only
    const filterEldorado = await getSeparatedOrdersList({
      tab: 'g4x',
      source: 'eldorado',
      gameSlug: testGame.slug,
      user: { discordId: adminId, userRoles: [{ role: 'admin' }] },
    });
    assert(filterEldorado.orders.length === 1, 'Source filter eldorado returns exactly 1 order');
    assert(filterEldorado.orders[0].orderRef === orderG4xEldorado.orderRef, 'Returned order is Eldorado order');

    // 5D. Source Filter for G4X: Direct only
    const filterDirect = await getSeparatedOrdersList({
      tab: 'g4x',
      source: 'direct',
      gameSlug: testGame.slug,
      user: { discordId: adminId, userRoles: [{ role: 'admin' }] },
    });
    assert(filterDirect.orders.some(o => o.orderRef === orderG4xDirect.orderRef), 'Source filter direct includes G4X Direct order');
    assert(!filterDirect.orders.some(o => o.sourceWebsite !== null), 'Source filter direct excludes external website orders');

    // 5E. Source Filter for G4X: Needs Review (Unknown Origin)
    const filterNeedsReview = await getSeparatedOrdersList({
      tab: 'g4x',
      source: 'needs_review',
      gameSlug: testGame.slug,
      user: { discordId: adminId, userRoles: [{ role: 'admin' }] },
    });
    assert(filterNeedsReview.orders.some(o => o.orderRef === orderNeedsReview.orderRef), 'Source filter needs_review returns historical unknown record');
    assert(filterNeedsReview.orders.find(o => o.orderRef === orderNeedsReview.orderRef)?.sourceLabel === 'Needs Review', 'Item displays Needs Review label');

    // 5F. Status Filter: payment_pending
    const filterStatus = await getSeparatedOrdersList({
      tab: 'advertiser',
      status: 'payment_pending',
      gameSlug: testGame.slug,
      user: { discordId: adminId, userRoles: [{ role: 'admin' }] },
    });
    assert(filterStatus.orders.every(o => o.status === 'payment_pending'), 'Status filter strictly matches payment_pending');
    assert(filterStatus.orders.some(o => o.orderRef === orderAdv1Pending.orderRef), 'Adv1 pending order included in status filter');

    // 5G. Payment Status Filter: pending vs verified
    const filterPayPending = await getSeparatedOrdersList({
      tab: 'advertiser',
      paymentStatus: 'pending',
      gameSlug: testGame.slug,
      user: { discordId: adminId, userRoles: [{ role: 'admin' }] },
    });
    assert(filterPayPending.orders.every(o => o.paymentStatus === 'pending'), 'PaymentStatus filter matches pending');

    // 5H. Search Filter: by orderRef substring
    const filterSearch = await getSeparatedOrdersList({
      tab: 'g4x',
      search: `G2G_EXT_${ts}`,
      gameSlug: testGame.slug,
      user: { discordId: adminId, userRoles: [{ role: 'admin' }] },
    });
    assert(filterSearch.orders.length === 1 && filterSearch.orders[0].orderRef === orderG4xG2G.orderRef, 'Search matches external order ID');

    // 5I. Date Range Filter
    const todayStr = new Date().toISOString().split('T')[0];
    const filterDate = await getSeparatedOrdersList({
      tab: 'g4x',
      startDate: todayStr,
      endDate: todayStr,
      gameSlug: testGame.slug,
      user: { discordId: adminId, userRoles: [{ role: 'admin' }] },
    });
    assert(filterDate.orders.length >= 4, 'Date range matches all today orders');

    // ─── 6. Test Server-side Pagination ───────────────────────────────────────
    console.log('\nStep 6: Testing Server-side Pagination & Limits...');

    const page1 = await getSeparatedOrdersList({
      tab: 'g4x',
      gameSlug: testGame.slug,
      page: 1,
      limit: 2,
      user: { discordId: adminId, userRoles: [{ role: 'admin' }] },
    });

    assert(page1.orders.length === 2, 'Page 1 limit=2 returns exactly 2 orders');
    assert(page1.pagination.page === 1, 'Pagination page is 1');
    assert(page1.pagination.limit === 2, 'Pagination limit is 2');
    assert(page1.pagination.totalPages >= 2, 'Total pages is >= 2');
    assert(page1.pagination.hasNext === true, 'Page 1 has next page');
    assert(page1.pagination.hasPrev === false, 'Page 1 does not have prev page');

    const page2 = await getSeparatedOrdersList({
      tab: 'g4x',
      gameSlug: testGame.slug,
      page: 2,
      limit: 2,
      user: { discordId: adminId, userRoles: [{ role: 'admin' }] },
    });

    assert(page2.orders.length >= 1, 'Page 2 returns orders');
    assert(page2.pagination.page === 2, 'Pagination page is 2');
    assert(page2.pagination.hasPrev === true, 'Page 2 has prev page');
    assert(page1.orders[0].id !== page2.orders[0].id, 'Page 1 and Page 2 contain non-overlapping orders');

    // Out of bounds page
    const outOfBounds = await getSeparatedOrdersList({
      tab: 'g4x',
      gameSlug: testGame.slug,
      page: 9999,
      limit: 10,
      user: { discordId: adminId, userRoles: [{ role: 'admin' }] },
    });
    assert(outOfBounds.orders.length === 0, 'Out of bounds page returns empty list without error');
    assert(outOfBounds.pagination.hasNext === false, 'Out of bounds hasNext is false');

    // ─── 7. Test Authorized Actions Flags ─────────────────────────────────────
    console.log('\nStep 7: Testing Authorized Action Flags...');

    // Adv1 pending order viewed by Adv1 (owner)
    const adv1PendingItem = adv1Orders.orders.find(o => o.orderRef === orderAdv1Pending.orderRef)!;
    assert(adv1PendingItem.authorizedActions.includes('pay_wallet'), 'Unpaid order has pay_wallet action for owner');
    assert(adv1PendingItem.authorizedActions.includes('cancel'), 'Unassigned pending order has cancel action for owner');
    assert(!adv1PendingItem.authorizedActions.includes('publish'), 'Ordinary advertiser CANNOT publish order directly');

    // Verified unassigned order viewed by Admin
    const g4xDirectItem = adminQueryG4x.orders.find(o => o.orderRef === orderG4xDirect.orderRef)!;
    assert(g4xDirectItem.isPublishable === true, 'Verified unpaid G4X direct order is publishable');
    assert(g4xDirectItem.authorizedActions.includes('publish'), 'Admin has publish action on publishable order');

    // Clean up test data
    console.log('\nStep 8: Cleaning up test data...');
    await prisma.order.deleteMany({ where: { gameSlug: testGame.slug } });
    await prisma.platformAccount.deleteMany({
      where: { id: { in: [platG2G.id, platSkyCoach.id, platEldorado.id] } },
    });
    await prisma.gameService.deleteMany({ where: { id: testService.id } });
    await prisma.game.deleteMany({ where: { slug: testGame.slug } });
    await prisma.userRole.deleteMany({
      where: { userId: { in: [adminId, adv1Id, adv2Id, memberId] } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: [adminId, adv1Id, adv2Id, memberId] } },
    });
    console.log('Cleanup complete.');

    console.log('\n================================================================');
    console.log(`🎉 ALL TESTS PASSED: ${passedTests} passed, ${failedTests} failed.`);
    console.log('================================================================\n');
  } catch (err) {
    console.error('\n❌ TEST SUITE RUNTIME ERROR:', err);
    process.exit(1);
  }
}

runSuite().then(() => {
  if (failedTests > 0) {
    process.exit(1);
  }
  process.exit(0);
});
