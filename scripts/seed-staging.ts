/**
 * scripts/seed-staging.ts
 *
 * Synthetic Test Dataset Seeder for G4X Isolated Staging Environment.
 *
 * SAFETY INVARIANTS:
 *  1. Only runs in STAGING_MODE or against a validated isolated database.
 *  2. Synthetic users use 18-digit numeric snowflakes in range 999999999999990001 - 999999999999990010.
 *  3. Exactly ONE user has the 'owner' role to satisfy OwnerGate resolution.
 *  4. Seeds realistic orders, characters, wallets, roles, channels, and policy CMS documents.
 */

import { PrismaClient } from '@prisma/client';
import prismaInstance from '../src/database/db';
import { seed as seedBaseDefaults } from '../src/database/seed';

export { SYNTHETIC_USERS } from '../src/web/staging/syntheticUsers';
import { SYNTHETIC_USERS } from '../src/web/staging/syntheticUsers';

export async function seedStagingDatabase(prisma: PrismaClient = prismaInstance): Promise<void> {
  console.log('[SeedStaging] 🧪 Beginning synthetic staging dataset seeding...');

  // Initialize base system defaults (supported games, canonical services)
  await seedBaseDefaults();

  // 1. Roles
  const roles = [
    { roleKey: 'owner', name: 'Owner' },
    { roleKey: 'admin', name: 'Administrator' },
    { roleKey: 'manager', name: 'Manager' },
    { roleKey: 'staff', name: 'Staff' },
    { roleKey: 'advertiser', name: 'Advertiser' },
    { roleKey: 'exchanger', name: 'Exchanger' },
    { roleKey: 'booster', name: 'Booster' },
    { roleKey: 'pilot', name: 'Pilot' },
  ];

  for (const r of roles) {
    await prisma.role.upsert({
      where: { roleKey: r.roleKey },
      update: { name: r.name },
      create: r,
    });
  }

  // 2. Synthetic Users
  const userDefs = [
    {
      discordId: SYNTHETIC_USERS.OWNER,
      username: 'staging_owner',
      displayName: 'Staging Platform Owner',
      roles: ['owner'],
      advertiserRank: null,
    },
    {
      discordId: SYNTHETIC_USERS.ADMIN,
      username: 'staging_admin',
      displayName: 'Staging System Admin',
      roles: ['admin'],
      advertiserRank: null,
    },
    {
      discordId: SYNTHETIC_USERS.MANAGEMENT,
      username: 'staging_management',
      displayName: 'Staging Operations Manager',
      roles: ['manager'],
      advertiserRank: null,
    },
    {
      discordId: SYNTHETIC_USERS.STAFF,
      username: 'staging_staff',
      displayName: 'Staging Support Staff',
      roles: ['staff'],
      advertiserRank: null,
    },
    {
      discordId: SYNTHETIC_USERS.ADVERTISER,
      username: 'staging_advertiser',
      displayName: 'Staging Top Advertiser',
      roles: ['advertiser'],
      advertiserRank: 'GOLD',
    },
    {
      discordId: SYNTHETIC_USERS.EXCHANGER,
      username: 'staging_exchanger',
      displayName: 'Staging Currency Exchanger',
      roles: ['exchanger'],
      advertiserRank: null,
    },
    {
      discordId: SYNTHETIC_USERS.BOOSTER,
      username: 'staging_booster',
      displayName: 'Staging Pro Booster',
      roles: ['booster'],
      advertiserRank: null,
    },
    {
      discordId: SYNTHETIC_USERS.PILOT,
      username: 'staging_pilot',
      displayName: 'Staging Verified Pilot',
      roles: ['pilot', 'booster'],
      advertiserRank: null,
    },
    {
      discordId: SYNTHETIC_USERS.MULTI_ROLE,
      username: 'staging_multirole',
      displayName: 'Staging Multi-Role User (Booster + Staff)',
      roles: ['booster', 'staff'],
      advertiserRank: null,
    },
    {
      discordId: SYNTHETIC_USERS.UNVERIFIED,
      username: 'staging_unverified',
      displayName: 'Staging New Customer',
      roles: [],
      advertiserRank: null,
    },
  ];

  for (const u of userDefs) {
    await prisma.user.upsert({
      where: { discordId: u.discordId },
      update: {
        username: u.username,
        displayName: u.displayName,
        advertiserRank: u.advertiserRank,
        isActive: true,
      },
      create: {
        discordId: u.discordId,
        username: u.username,
        displayName: u.displayName,
        advertiserRank: u.advertiserRank,
        isActive: true,
      },
    });

    // Wallets
    await prisma.wallet.upsert({
      where: { userId: u.discordId },
      update: {},
      create: {
        userId: u.discordId,
        balanceUsd: 100.0,
        balanceIrt: 5000000,
        balanceGold: 500000,
      },
    });

    await prisma.walletV2.upsert({
      where: { userId: u.discordId },
      update: {},
      create: {
        userId: u.discordId,
        availableCents: 10000,
        reservedCents: 0,
        confirmedEarningsCents: 15000,
      },
    });

    // Clean old roles
    await prisma.userRole.deleteMany({
      where: { userId: u.discordId },
    });

    for (const r of u.roles) {
      await prisma.userRole.create({
        data: {
          userId: u.discordId,
          roleKey: r,
          grantedBy: SYNTHETIC_USERS.OWNER,
        },
      });
    }
  }

  // 3. Catalog: Game and Services
  const wowGame = await prisma.game.upsert({
    where: { slug: 'wow' },
    update: {
      displayName: 'World of Warcraft',
      serviceCategory: 'both',
      isActive: true,
    },
    create: {
      slug: 'wow',
      displayName: 'World of Warcraft',
      serviceCategory: 'both',
      description: 'Retail & Classic Boosting and Key Runs',
      isActive: true,
      sortOrder: 1,
    },
  });

  const mplusService = await prisma.gameService.upsert({
    where: { id: 1 },
    update: {
      gameSlug: 'wow',
      serviceKey: 'keystone-10-15',
      displayName: 'Mythic+ Keystone 10-15',
      serviceMode: 'non_pilot',
      profileMode: 'raiderio',
      isActive: true,
    },
    create: {
      id: 1,
      gameSlug: 'wow',
      serviceKey: 'keystone-10-15',
      displayName: 'Mythic+ Keystone 10-15',
      serviceMode: 'non_pilot',
      profileMode: 'raiderio',
      isActive: true,
      sortOrder: 1,
    },
  });

  const raidService = await prisma.gameService.upsert({
    where: { id: 2 },
    update: {
      gameSlug: 'wow',
      serviceKey: 'heroic-raid-full',
      displayName: 'Heroic Raid Full Clear',
      serviceMode: 'pilot',
      profileMode: 'none',
      isActive: true,
    },
    create: {
      id: 2,
      gameSlug: 'wow',
      serviceKey: 'heroic-raid-full',
      displayName: 'Heroic Raid Full Clear',
      serviceMode: 'pilot',
      profileMode: 'none',
      isActive: true,
      sortOrder: 2,
    },
  });

  // 4. Game Approvals
  const approvedBoosters = [
    SYNTHETIC_USERS.BOOSTER,
    SYNTHETIC_USERS.PILOT,
    SYNTHETIC_USERS.MULTI_ROLE,
  ];

  for (const bId of approvedBoosters) {
    await prisma.userGameApproval.upsert({
      where: {
        userId_gameSlug_serviceId_approvalType: {
          userId: bId,
          gameSlug: 'wow',
          serviceId: 1,
          approvalType: 'booster',
        },
      },
      update: { status: 'approved' },
      create: {
        userId: bId,
        gameSlug: 'wow',
        serviceId: 1,
        approvalType: 'booster',
        status: 'approved',
        reviewedBy: SYNTHETIC_USERS.ADMIN,
        reviewedAt: new Date(),
      },
    });
  }

  // 5. WoW Characters
  await prisma.wowCharacter.upsert({
    where: {
      userId_gameSlug_region_realm_characterName: {
        userId: SYNTHETIC_USERS.BOOSTER,
        gameSlug: 'wow',
        region: 'eu',
        realm: 'tarren-mill',
        characterName: 'Frostblade',
      },
    },
    update: {
      characterClass: 'Death Knight',
      activeSpec: 'Frost',
      itemLevel: 630,
      mythicScore: 2850.5,
      dpsScore: 2850.5,
      isMain: true,
      isActive: true,
      syncStatus: 'synced',
    },
    create: {
      userId: SYNTHETIC_USERS.BOOSTER,
      gameSlug: 'wow',
      region: 'eu',
      realm: 'tarren-mill',
      characterName: 'Frostblade',
      characterClass: 'Death Knight',
      activeSpec: 'Frost',
      itemLevel: 630,
      mythicScore: 2850.5,
      dpsScore: 2850.5,
      isMain: true,
      isActive: true,
      syncStatus: 'synced',
    },
  });

  await prisma.wowCharacter.upsert({
    where: {
      userId_gameSlug_region_realm_characterName: {
        userId: SYNTHETIC_USERS.PILOT,
        gameSlug: 'wow',
        region: 'eu',
        realm: 'kazzak',
        characterName: 'Holyheal',
      },
    },
    update: {
      characterClass: 'Priest',
      activeSpec: 'Holy',
      itemLevel: 625,
      mythicScore: 2700.0,
      healerScore: 2700.0,
      isMain: true,
      isActive: true,
      syncStatus: 'synced',
    },
    create: {
      userId: SYNTHETIC_USERS.PILOT,
      gameSlug: 'wow',
      region: 'eu',
      realm: 'kazzak',
      characterName: 'Holyheal',
      characterClass: 'Priest',
      activeSpec: 'Holy',
      itemLevel: 625,
      mythicScore: 2700.0,
      healerScore: 2700.0,
      isMain: true,
      isActive: true,
      syncStatus: 'synced',
    },
  });

  // 6. Orders across statuses
  const ordersData = [
    {
      id: 101,
      orderRef: 'G4X-STG-101',
      gameSlug: 'wow',
      serviceId: 1,
      customerId: SYNTHETIC_USERS.UNVERIFIED,
      advertiserId: SYNTHETIC_USERS.ADVERTISER,
      creatorId: SYNTHETIC_USERS.ADVERTISER,
      creatorType: 'advertiser',
      orderName: '+12 Keystone Vault Run',
      orderType: 'group',
      orderMode: 'non_pilot',
      currency: 'USD',
      grossAmountMinor: 4500,
      platformFeeMinor: 450,
      advertiserFeeMinor: 450,
      boosterPoolMinor: 3600,
      paymentStatus: 'pending',
      status: 'payment_pending',
    },
    {
      id: 102,
      orderRef: 'G4X-STG-102',
      gameSlug: 'wow',
      serviceId: 1,
      customerId: SYNTHETIC_USERS.UNVERIFIED,
      advertiserId: SYNTHETIC_USERS.ADVERTISER,
      creatorId: SYNTHETIC_USERS.ADVERTISER,
      creatorType: 'advertiser',
      orderName: '+15 Keystone Timed',
      orderType: 'group',
      orderMode: 'non_pilot',
      currency: 'USD',
      grossAmountMinor: 6000,
      platformFeeMinor: 600,
      advertiserFeeMinor: 600,
      boosterPoolMinor: 4800,
      paymentStatus: 'verified',
      paymentVerifiedBy: SYNTHETIC_USERS.STAFF,
      status: 'open_presign',
      publishedAt: new Date(),
    },
    {
      id: 103,
      orderRef: 'G4X-STG-103',
      gameSlug: 'wow',
      serviceId: 1,
      customerId: SYNTHETIC_USERS.UNVERIFIED,
      advertiserId: SYNTHETIC_USERS.ADVERTISER,
      creatorId: SYNTHETIC_USERS.ADVERTISER,
      creatorType: 'advertiser',
      orderName: '+14 Keystone Fast Clear',
      orderType: 'solo',
      orderMode: 'non_pilot',
      currency: 'USD',
      grossAmountMinor: 5000,
      platformFeeMinor: 500,
      advertiserFeeMinor: 500,
      boosterPoolMinor: 4000,
      paymentStatus: 'verified',
      status: 'in_progress',
      executionChannelId: '999999999999993001',
      publishedAt: new Date(Date.now() - 3600 * 1000),
    },
    {
      id: 104,
      orderRef: 'G4X-STG-104',
      gameSlug: 'wow',
      serviceId: 2,
      customerId: SYNTHETIC_USERS.UNVERIFIED,
      advertiserId: SYNTHETIC_USERS.ADVERTISER,
      creatorId: SYNTHETIC_USERS.STAFF,
      creatorType: 'g4x',
      orderName: 'Heroic Raid 9/9 Clear',
      orderType: 'pilot',
      orderMode: 'pilot',
      currency: 'USD',
      grossAmountMinor: 12000,
      platformFeeMinor: 1200,
      advertiserFeeMinor: 1200,
      boosterPoolMinor: 9600,
      paymentStatus: 'verified',
      status: 'completed',
      completedAt: new Date(Date.now() - 1800 * 1000),
    },
    {
      id: 105,
      orderRef: 'G4X-STG-105',
      gameSlug: 'wow',
      serviceId: 1,
      customerId: SYNTHETIC_USERS.UNVERIFIED,
      advertiserId: SYNTHETIC_USERS.ADVERTISER,
      creatorId: SYNTHETIC_USERS.ADVERTISER,
      creatorType: 'advertiser',
      orderName: 'Cancelled +10 Run',
      orderType: 'group',
      orderMode: 'non_pilot',
      currency: 'USD',
      grossAmountMinor: 3500,
      paymentStatus: 'refunded',
      status: 'cancelled',
    },
  ];

  for (const o of ordersData) {
    await prisma.order.upsert({
      where: { id: o.id },
      update: o,
      create: o,
    });
  }

  // 7. Order Channels and Assignments
  // Clean existing order_channels for order 103
  await prisma.orderChannel.deleteMany({
    where: { orderId: 103 },
  });

  await prisma.orderChannel.create({
    data: {
      orderId: 103,
      discordGuildId: '999999999999990000',
      discordChannelId: '999999999999993001',
      channelType: 'execution',
      status: 'active',
    },
  });

  // Assignments for in_progress and completed
  await prisma.orderAssignment.deleteMany({
    where: { orderId: { in: [103, 104] } },
  });

  await prisma.orderAssignment.create({
    data: {
      orderId: 103,
      userId: SYNTHETIC_USERS.BOOSTER,
      assignedById: SYNTHETIC_USERS.STAFF,
      assignedRole: 'dps',
      status: 'assigned',
    },
  });

  await prisma.orderAssignment.create({
    data: {
      orderId: 104,
      userId: SYNTHETIC_USERS.PILOT,
      assignedById: SYNTHETIC_USERS.STAFF,
      assignedRole: 'pilot',
      status: 'completed',
    },
  });

  // 8. Financial Requests: Booster Withdrawal & Advertiser Funding
  await prisma.boosterWithdrawalRequest.deleteMany({
    where: { boosterId: SYNTHETIC_USERS.BOOSTER },
  });

  await prisma.boosterWithdrawalRequest.create({
    data: {
      withdrawalRef: 'WDR-STG-001',
      boosterId: SYNTHETIC_USERS.BOOSTER,
      payoutMethod: 'USDT_BEP20',
      status: 'REQUESTED',
      requestedUsdCents: 1500,
      fixedFeeUsdCents: 40,
      netUsdCents: 1460,
      quotedNetPayoutAmount: '14.60',
      quotedCurrency: 'USDT',
      destinationAddress: '0x1234567890123456789012345678901234567890',
    },
  });

  await prisma.advertiserFundingRequest.deleteMany({
    where: { advertiserId: SYNTHETIC_USERS.ADVERTISER },
  });

  await prisma.advertiserFundingRequest.create({
    data: {
      fundingRef: 'FND-STG-001',
      advertiserId: SYNTHETIC_USERS.ADVERTISER,
      fundingMethod: 'IRT',
      status: 'PENDING_ADMIN_VERIFICATION',
      targetUsdCents: 5200,
      externalCurrency: 'IRT',
      externalAmountUnits: '5000000',
      exchangeRate: 90000,
      currencyPurchaseFeeRate: 0.05,
      evidenceRef: 'BANK-STG-RECEIPT-998811',
    },
  });

  // 9. Rules & Policy CMS Document
  const policyDoc = await prisma.policyDocument.upsert({
    where: { slug: 'community-rules' },
    update: {
      title: 'G4X Community Official Policy & Rules',
      description: 'Official unified guidelines and platform policies for G4X Community.',
    },
    create: {
      slug: 'community-rules',
      title: 'G4X Community Official Policy & Rules',
      description: 'Official unified guidelines and platform policies for G4X Community.',
    },
  });

  const rawPolicyMarkdown = `# G4X Community Official Rules & Policies

## 1. General Community Guidelines
All members must treat staff, boosters, and advertisers with mutual respect.
Off-platform transactions or circumventing the G4X escrow system are strictly prohibited.

## 2. Order Execution & Booster Terms
Boosters must provide verifiable in-game proof for every completed key or raid clear.
Payouts are held for 24 hours following Admin final review.
`;

  const policyVer = await prisma.policyVersion.upsert({
    where: {
      documentId_versionNumber: {
        documentId: policyDoc.id,
        versionNumber: 1,
      },
    },
    update: {
      status: 'PUBLISHED',
      title: 'G4X Community Official Policy & Rules v1.0',
      rawContentMarkdown: rawPolicyMarkdown,
      authorDiscordId: SYNTHETIC_USERS.OWNER,
      publishedAt: new Date(),
    },
    create: {
      documentId: policyDoc.id,
      versionNumber: 1,
      status: 'PUBLISHED',
      title: 'G4X Community Official Policy & Rules v1.0',
      rawContentMarkdown: rawPolicyMarkdown,
      authorDiscordId: SYNTHETIC_USERS.OWNER,
      publishedAt: new Date(),
    },
  });

  await prisma.policyDocument.update({
    where: { id: policyDoc.id },
    data: { currentPublishedVersionId: policyVer.id },
  });

  // 10. Platform Accounts & Financial Policies (Deliverables 1 & 3)
  const defaultAccounts = [
    { accountRef: 'g2g_main', platform: 'g2g', displayName: 'G2G Main Account' },
    { accountRef: 'skycoach_main', platform: 'skycoach', displayName: 'SkyCoach Main Account' },
    { accountRef: 'eldorado_main', platform: 'eldorado', displayName: 'Eldorado Main Account' },
    { accountRef: 'kingboost_main', platform: 'kingboost', displayName: 'Kingboost Main Account' },
    { accountRef: 'overgear_main', platform: 'overgear', displayName: 'Overgear Main Account' },
  ];

  for (const acct of defaultAccounts) {
    await prisma.platformAccount.upsert({
      where: { accountRef: acct.accountRef },
      update: { platform: acct.platform, displayName: acct.displayName, isActive: true },
      create: {
        accountRef: acct.accountRef,
        platform: acct.platform,
        displayName: acct.displayName,
        currency: 'USD',
        isActive: true,
      },
    });
  }

  console.log('[SeedStaging] ✅ Synthetic staging dataset seeded successfully.');
}

// CLI Execution
if (require.main === module) {
  seedStagingDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[SeedStaging] ❌ Seeding failed:', err);
      process.exit(1);
    });
}
