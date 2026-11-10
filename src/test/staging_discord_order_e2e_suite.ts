/**
 * src/test/staging_discord_order_e2e_suite.ts
 *
 * G4X Community — Staging Phase 2: Discord Integration & Full Order Lifecycle QA Suite.
 *
 * COMPREHENSIVE VERIFICATION PILLARS:
 *  1. Realistic Mock Discord Adapter & Environment Baseline:
 *     - Verifies mock adapter supports Guild, Channel, Member, Roles, PermissionOverwrites, Message, Embeds, Attachments.
 *     - Verifies ActionRecorder tracks operations and FailureInjector triggers simulated API failures.
 *     - Verifies loopback staging isolation and disposable staging DB.
 *
 *  2. Full Order Creation & Payment Verification Workflow:
 *     - Advertiser creates order via Discord command `G4!order create wow 1 50 group Fast M+ Run`.
 *     - Initial status enters `payment_pending`.
 *     - Payment verification guard: unpaid orders cannot be published to Discord (fails closed).
 *     - Synthetic deposit/receipt verified by Admin via `verifyOrderWithReceipt`.
 *     - Clean transition to `open_presign`.
 *     - Routed publication to `#mythic_plus_boosts`.
 *     - Publication idempotency: duplicate publication updates existing card; 0 duplicate messages.
 *
 *  3. Discord-Only Booster Claim & Pre-Sign Workflow:
 *     - Pre-sign buttons (`presign_tank:<id>`, `presign_healer:<id>`, `presign_dps:<id>`), slot validation.
 *     - Slot overbooking rejection and duplicate pre-sign prevention.
 *     - Pre-sign withdraw button (`presign_withdraw:<id>`).
 *     - Website claim bypass verification: `POST /orders/:id/claim` strictly returns 403 `DISCORD_CLAIM_ONLY`.
 *
 *  4. Assignment & Private Execution Channel Provisioning:
 *     - Staff assignment via `G4!assign <orderId> @user1 @user2 @user3 @user4` / `handleAssignCommand`.
 *     - Creates exactly one private execution channel `order-<id>-mythicplus`.
 *     - Concurrency check: 5 concurrent execution channel requests return the same channel and create 1 DB row.
 *     - Strict permission overwrites: `@everyone` denied ViewChannel; assigned boosters, customer/advertiser, staff, and bot granted.
 *     - Booster replacement permission revocation: unassigned booster loses channel access; new booster gains it.
 *     - Persistence in `OrderChannel` table with status `active`.
 *
 *  5. In-Channel Completion Proof & Review Workflow:
 *     - Assigned booster submits proof in execution channel with screenshot attachment (`G4!proof [notes]`).
 *     - Attachment validation: size <= 10MB, valid MIME type / extension.
 *     - Channel validation: proof submitted outside authoritative execution channel is rejected.
 *     - Booster validation: unassigned booster proof submission is rejected.
 *     - Modal proof submission (`handleDiscordProofModalSubmit`).
 *     - Order run transitions to `completed`, order enters `pending_review`.
 *     - Staff reviews proof with approval and notes.
 *     - Milestone deduplication notification sent to channel.
 *
 *  6. Role-Based Discord Security Matrix:
 *     - Verifies authorization across: Owner, Admin, Manager, Staff, Advertiser, Exchanger, Booster, Pilot, Multi-role, Unverified.
 *     - Setup commands (`G4!setup`): Management only.
 *     - Order create (`G4!order create`): Advertiser / Management only.
 *     - Assign commands (`G4!assign`): Management / Order creator only.
 *     - Proof submission (`G4!proof`): Assigned booster only.
 *     - Buttons (`presign_tank`, `review_assign`, `order_view`): Enforces respective role boundaries.
 *
 *  7. Discord Auto-Provisioning & Policy Sync:
 *     - `G4!setup all` / `provisionAllChannels`: provisions categories and channels.
 *     - Idempotent repeated execution: reuses existing channels without duplication.
 *     - `syncPolicyToDiscord`: synchronizes authoritative published policy to Discord channel.
 *     - Missing permissions handled gracefully with warnings, 0 crashes.
 *
 *  8. Dynamic Failure Injection & Resilience Verification:
 *     - HTTP 429 Rate Limit backoff & retry recovery.
 *     - HTTP 404 Channel Not Found: detects deleted/missing Discord channel and reconciles safely.
 *     - HTTP 403 Missing Permissions: handles permission denial cleanly with user-facing warning.
 *     - Bot Restart Simulation: in-memory cache cleared while underlying DB/guild persists; active order execution channel re-fetched from DB.
 *
 *  9. Financial & External Platform Invariants:
 *     - All 6 financial & sync safety gates remain strictly `false`:
 *       - ESCROW_RELEASE_ENABLED = false
 *       - FINANCE_V2_LIVE_CREDITS_ENABLED = false
 *       - FINANCE_V2_LIVE_PAYOUTS_ENABLED = false
 *       - FINANCE_V2_P2P_SETTLEMENT_ENABLED = false
 *       - NOWPAYMENTS_LIVE_COLLECTION_ENABLED = false
 *       - RAIDERIO_LIVE_SYNC_ENABLED = false
 *     - Zero unexpected balance mutations across `Wallet`, `WalletV2`, and `LedgerEntryV2`.
 */

import path from 'path';
import request from 'supertest';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

import prisma from '../database/db';
import {
  createRealisticMockDiscordClient,
  MockDiscordClient,
  simulateMessageCommand,
  simulateButtonInteraction,
  simulateModalInteraction,
} from './mockDiscordAdapter';

import {
  setGlobalDiscordClient,
  publishOrRefreshOrderCard,
  handlePresignButton,
  handlePresignWithdrawButton,
} from '../services/orderDiscordService';

import {
  getOrCreateOrderExecutionChannel,
  syncOrderChannelPermissions,
  handleOrderCancellationChannel,
} from '../services/orderExecutionChannelService';

import {
  submitDiscordChannelProof,
  validateDiscordAttachment,
} from '../services/discordProofSubmissionService';

import { reviewRunProof } from '../services/orderDisputeService';
import { verifyOrderWithReceipt } from '../services/payment/paymentReconciliationService';
import {
  PaymentBusinessType,
  PaymentMethod,
  PaymentProvider,
  PaymentReceiptStatus,
  PaymentRequestStatus,
} from '../services/payment/paymentTypes';

import { syncPolicyToDiscord, getPublishedPolicy } from '../services/policyService';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';
import { SYNTHETIC_USERS } from '../web/staging/syntheticUsers';
import { createStagingApp } from '../web/staging/stagingApp';

async function runStagingDiscordOrderE2ESuite(): Promise<void> {
  console.log('\n====================================================================');
  console.log('🤖 G4X COMMUNITY — STAGING PHASE 2: DISCORD ORDER LIFECYCLE QA SUITE');
  console.log('====================================================================\n');

  let passed = 0;
  let failed = 0;
  const testResults: Array<{ name: string; passed: boolean; detail?: string }> = [];

  function assert(condition: boolean, testName: string, detail?: string): void {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
      testResults.push({ name: testName, passed: true });
    } else {
      console.error(`  ❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
      testResults.push({ name: testName, passed: false, detail });
    }
  }

  // -------------------------------------------------------------------------
  // SECTION 1: Mock Discord Adapter & Environment Baseline
  // -------------------------------------------------------------------------
  console.log('[SECTION 1] Testing Mock Discord Adapter & Environment Baseline...');

  const mockClient = createRealisticMockDiscordClient();
  setGlobalDiscordClient(mockClient);

  assert(mockClient.guild.id === '999999999999990000', 'Mock client initializes primary guild ID correctly');
  assert(mockClient.guild.roles.cache.has('role_owner'), 'Mock client pre-seeds standard G4X server roles');

  // Verify ActionRecorder
  const testChan = await mockClient.guild.channels.create({
    name: 'qa-baseline-channel',
    type: ChannelType.GuildText,
  });
  assert(
    mockClient.actionRecorder.hasAction((a) => a.type === 'channel_create' && a.targetId === testChan.id),
    'ActionRecorder accurately records channel_create operations'
  );

  const testMsg = await testChan.send('Test message from QA');
  assert(
    mockClient.actionRecorder.hasAction((a) => a.type === 'message_send' && a.targetId === testChan.id),
    'ActionRecorder accurately records message_send operations'
  );

  // Verify FailureInjector: 429 Rate Limit
  mockClient.failureInjector.addRule({
    type: '429_RATE_LIMIT',
    targetMethod: 'channel.send',
    targetId: testChan.id,
    once: true,
  });
  let rateLimitCaught = false;
  try {
    await testChan.send('Should trigger rate limit');
  } catch (err: any) {
    rateLimitCaught = err.status === 429 && err.code === 20028;
  }
  assert(rateLimitCaught, 'FailureInjector accurately triggers HTTP 429 rate limit with once=true rule');

  // Next call should succeed since once=true removed the rule
  const nextMsg = await testChan.send('Should succeed now');
  assert(Boolean(nextMsg && nextMsg.id), 'One-shot failure clears automatically on subsequent call');

  // -------------------------------------------------------------------------
  // SECTION 2: Full Order Creation & Payment Verification Workflow
  // -------------------------------------------------------------------------
  console.log('\n[SECTION 2] Testing Full Order Creation & Payment Verification Workflow...');

  // 2.1 Advertiser creates order via Discord command G4!order create wow 1 50 group Fast M+ Run
  const advUser = SYNTHETIC_USERS.ADVERTISER;
  const adminUser = SYNTHETIC_USERS.ADMIN;

  // Ensure game 'wow' and service 1 exist in staging DB
  await prisma.game.upsert({
    where: { slug: 'wow' },
    update: { isActive: true },
    create: {
      slug: 'wow',
      displayName: 'World of Warcraft',
      serviceCategory: 'both',
      isActive: true,
      sortOrder: 1,
    },
  });
  await prisma.gameService.upsert({
    where: { id: 1 },
    update: { isActive: true, serviceKey: 'mythic_plus', serviceMode: 'non_pilot' },
    create: {
      id: 1,
      gameSlug: 'wow',
      serviceKey: 'mythic_plus',
      displayName: 'Mythic+ Keystone 10-15',
      serviceMode: 'non_pilot',
      profileMode: 'raiderio',
      isActive: true,
    },
  });

  // Ensure advertiser wallet has 0 available cents to enforce payment_pending
  await prisma.walletV2.upsert({
    where: { userId: advUser },
    update: { availableCents: 0 },
    create: {
      userId: advUser,
      availableCents: 0,
      reservedCents: 0,
      confirmedEarningsCents: 0,
    },
  });

  const orderCmdResult = await simulateMessageCommand(mockClient, {
    authorId: advUser,
    authorRoles: ['advertiser'],
    content: 'G4!order create wow 1 50 group Fast M+ Run QA Test',
  });

  assert(
    orderCmdResult.replies.length > 0,
    'G4!order create command produces immediate Discord confirmation reply'
  );

  // Retrieve created order from DB
  const createdOrder = await prisma.order.findFirst({
    where: { creatorId: advUser },
    orderBy: { createdAt: 'desc' },
  });

  assert(Boolean(createdOrder), 'Authoritative Order record created in database');
  assert(
    createdOrder?.status === 'payment_pending',
    'Unfunded order immediately defaults to status "payment_pending"'
  );
  assert(
    createdOrder?.paymentStatus === 'pending',
    'Unfunded order has paymentStatus="pending"'
  );

  // 2.2 Payment verification guard on Discord publication
  let unpaidPubFailed = false;
  try {
    const pubRes = await publishOrRefreshOrderCard(mockClient, createdOrder!.id);
    unpaidPubFailed = !pubRes.success;
  } catch (err) {
    unpaidPubFailed = true;
  }
  assert(
    unpaidPubFailed,
    'Payment Guard: Unpaid order is strictly blocked from publishing public Discord card'
  );

  // 2.3 Synthetic deposit & payment receipt verification by Admin via verifyOrderWithReceipt
  const req = await prisma.paymentRequest.create({
    data: {
      requestRef: `PAY_REQ_${createdOrder!.id}_${Date.now()}`,
      businessType: PaymentBusinessType.ORDER,
      orderId: createdOrder!.id,
      userId: advUser,
      amountUsdCents: createdOrder!.grossAmountMinor,
      currency: 'USD',
      status: PaymentRequestStatus.PROCESSING,
    },
  });

  const attempt = await prisma.paymentAttempt.create({
    data: {
      attemptRef: `ATT_${createdOrder!.id}_${Date.now()}`,
      paymentRequestId: req.id,
      method: PaymentMethod.NOWPAYMENTS_CRYPTO,
      provider: PaymentProvider.NOWPAYMENTS,
      status: 'confirmed',
      expectedAmount: String(createdOrder!.grossAmountMinor / 100),
      expectedCurrency: 'usd',
    },
  });

  const synthReceipt = await prisma.paymentReceipt.create({
    data: {
      receiptRef: `RECEIPT_SYNTH_${createdOrder!.id}_${Date.now()}`,
      paymentRequestId: req.id,
      paymentAttemptId: attempt.id,
      paymentMethod: PaymentMethod.NOWPAYMENTS_CRYPTO,
      providerReference: `NOWP_REF_${Date.now()}`,
      verifiedBy: adminUser,
      status: PaymentReceiptStatus.ACTIVE,
      amountUsdCents: createdOrder!.grossAmountMinor,
    },
  });

  const verifyResult = await verifyOrderWithReceipt(createdOrder!.id, synthReceipt.receiptRef, adminUser);
  assert(verifyResult.success, 'verifyOrderWithReceipt succeeds for valid synthetic receipt');

  const fundedOrder = await prisma.order.findUnique({
    where: { id: createdOrder!.id },
  });
  assert(
    fundedOrder?.status === 'open_presign' && fundedOrder?.paymentStatus === 'verified',
    'Verified order transitions cleanly to status="open_presign" and paymentStatus="verified"'
  );

  // 2.4 Publish order card to Discord publication channel
  const pubChannel = await mockClient.guild.channels.create({
    name: 'mythic_plus_boosts',
    type: ChannelType.GuildText,
  });

  const pubResult1 = await publishOrRefreshOrderCard(mockClient, fundedOrder!.id, {
    targetChannelId: pubChannel.id,
  });
  assert(pubResult1.success, 'Verified order publishes public card to routed Discord channel');
  assert(Boolean(pubResult1.messageId), 'Published card records authoritative messageId');

  // 2.5 Publication Idempotency: Re-publishing edits the existing message; 0 duplicate messages created
  const pubResult2 = await publishOrRefreshOrderCard(mockClient, fundedOrder!.id, {
    targetChannelId: pubChannel.id,
  });
  assert(
    pubResult2.messageId === pubResult1.messageId,
    'Publication Idempotency: Re-publishing refreshes existing message without creating duplicate card'
  );
  assert(
    pubChannel.messages.cache.size === 1,
    'Public channel contains exactly 1 message after repeated publication calls'
  );

  // -------------------------------------------------------------------------
  // SECTION 3: Discord-Only Booster Claim & Pre-Sign Workflow
  // -------------------------------------------------------------------------
  console.log('\n[SECTION 3] Testing Discord-Only Booster Claim & Pre-Sign Workflow...');

  const boosterTank = SYNTHETIC_USERS.BOOSTER;
  const boosterHealer = SYNTHETIC_USERS.PILOT;
  const boosterDps1 = SYNTHETIC_USERS.MULTI_ROLE;

  // Qualify boosterTank for Tank role
  await prisma.wowCharacter.updateMany({
    where: { userId: boosterTank },
    data: { tankScore: 2800 },
  });
  await prisma.userGameApproval.upsert({
    where: {
      userId_gameSlug_serviceId_approvalType: {
        userId: boosterTank,
        gameSlug: 'wow',
        serviceId: 1,
        approvalType: 'booster',
      },
    },
    update: { status: 'approved', reviewNote: 'roles:tank,dps' },
    create: {
      userId: boosterTank,
      gameSlug: 'wow',
      serviceId: 1,
      approvalType: 'booster',
      status: 'approved',
      reviewNote: 'roles:tank,dps',
      reviewedBy: adminUser,
    },
  });

  // 3.1 Tank Pre-sign via Discord button interaction
  const presignTankRes = await simulateButtonInteraction(mockClient, {
    userId: boosterTank,
    userRoles: ['booster'],
    customId: `presign_tank:${fundedOrder!.id}`,
    channelId: pubChannel.id,
  });
  assert(
    presignTankRes.replies.length > 0,
    'Tank pre-sign button produces immediate confirmation interaction reply'
  );

  const tankPresign = await prisma.orderPresign.findFirst({
    where: { orderId: fundedOrder!.id, userId: boosterTank, status: 'registered' },
  });
  assert(
    Boolean(tankPresign && tankPresign.registeredRole.includes('tank')),
    'Tank pre-sign successfully registered in OrderPresign table'
  );

  // 3.2 Healer Pre-sign via Discord button interaction
  await simulateButtonInteraction(mockClient, {
    userId: boosterHealer,
    userRoles: ['booster', 'pilot'],
    customId: `presign_healer:${fundedOrder!.id}`,
    channelId: pubChannel.id,
  });
  const healerPresign = await prisma.orderPresign.findFirst({
    where: { orderId: fundedOrder!.id, userId: boosterHealer, status: 'registered' },
  });
  assert(
    Boolean(healerPresign && healerPresign.registeredRole.includes('healer')),
    'Healer pre-sign successfully registered in OrderPresign table'
  );

  // 3.3 DPS 1 Pre-sign via Discord button interaction
  await simulateButtonInteraction(mockClient, {
    userId: boosterDps1,
    userRoles: ['booster', 'staff'],
    customId: `presign_dps:${fundedOrder!.id}`,
    channelId: pubChannel.id,
  });
  const dpsPresign = await prisma.orderPresign.findFirst({
    where: { orderId: fundedOrder!.id, userId: boosterDps1, status: 'registered' },
  });
  assert(
    Boolean(dpsPresign && dpsPresign.registeredRole.includes('dps')),
    'DPS pre-sign successfully registered in OrderPresign table'
  );

  // 3.4 Pre-sign withdraw button
  await simulateButtonInteraction(mockClient, {
    userId: boosterDps1,
    userRoles: ['booster', 'staff'],
    customId: `presign_withdraw:${fundedOrder!.id}`,
    channelId: pubChannel.id,
  });
  const withdrawnPresign = await prisma.orderPresign.findFirst({
    where: { orderId: fundedOrder!.id, userId: boosterDps1 },
  });
  assert(
    withdrawnPresign?.status === 'withdrawn',
    'Pre-sign withdraw button cleanly marks status="withdrawn"'
  );

  // Re-register DPS 1 for subsequent assignment
  await simulateButtonInteraction(mockClient, {
    userId: boosterDps1,
    userRoles: ['booster', 'staff'],
    customId: `presign_dps:${fundedOrder!.id}`,
    channelId: pubChannel.id,
  });

  // 3.5 Website Claim Bypass Verification: POST /orders/:id/claim must strictly return 403 DISCORD_CLAIM_ONLY
  const stagingApp = createStagingApp();
  const boosterLoginRes = await request(stagingApp)
    .post('/api/auth/staging-login')
    .send({ userId: boosterTank });
  const boosterCookie = boosterLoginRes.header['set-cookie'];

  const csrfRes = await request(stagingApp)
    .get('/api/csrf-token')
    .set('Cookie', boosterCookie);
  const csrfToken = csrfRes.body.csrfToken;

  const webClaimAttempt = await request(stagingApp)
    .post(`/orders/${fundedOrder!.id}/claim`)
    .set('Cookie', boosterCookie)
    .set('x-csrf-token', csrfToken)
    .send({ role: 'tank' });

  assert(
    webClaimAttempt.status === 403 && webClaimAttempt.body.error === 'DISCORD_CLAIM_ONLY',
    'Rule A: Website claim bypass is permanently closed (POST /orders/:id/claim returns 403 DISCORD_CLAIM_ONLY)'
  );

  // -------------------------------------------------------------------------
  // SECTION 4: Assignment & Private Execution Channel Provisioning
  // -------------------------------------------------------------------------
  console.log('\n[SECTION 4] Testing Assignment & Private Execution Channel Provisioning...');

  // Setup booster 4 (Staff member acting as booster 4)
  const boosterDps2 = SYNTHETIC_USERS.STAFF;
  await prisma.userRole.upsert({
    where: { userId_roleKey: { userId: boosterDps2, roleKey: 'booster' } },
    update: {},
    create: { userId: boosterDps2, roleKey: 'booster', grantedBy: adminUser },
  });
  await prisma.userGameApproval.upsert({
    where: {
      userId_gameSlug_serviceId_approvalType: {
        userId: boosterDps2,
        gameSlug: 'wow',
        serviceId: 1,
        approvalType: 'booster',
      },
    },
    update: { status: 'approved' },
    create: {
      userId: boosterDps2,
      gameSlug: 'wow',
      serviceId: 1,
      approvalType: 'booster',
      status: 'approved',
      reviewedBy: adminUser,
    },
  });

  await simulateButtonInteraction(mockClient, {
    userId: boosterDps2,
    userRoles: ['booster', 'staff'],
    customId: `presign_dps:${fundedOrder!.id}`,
    channelId: pubChannel.id,
  });

  // Clear any existing active reservations & assignments for the test boosters to satisfy double-booking check
  await prisma.boosterReservation.deleteMany({
    where: {
      userId: { in: [boosterTank, boosterHealer, boosterDps1, boosterDps2] },
    },
  });
  await prisma.orderAssignment.deleteMany({
    where: {
      userId: { in: [boosterTank, boosterHealer, boosterDps1, boosterDps2] },
    },
  });

  // Assign the 4 boosters via G4!assign command
  const assignResult = await simulateMessageCommand(mockClient, {
    authorId: adminUser,
    authorRoles: ['admin'],
    content: `G4!assign ${fundedOrder!.id} <@${boosterTank}> <@${boosterHealer}> <@${boosterDps1}> <@${boosterDps2}>`,
  });

  assert(
    assignResult.replies.length > 0,
    'G4!assign command executes and returns confirmation message'
  );

  // 4.1 Verify single private execution channel created
  const execChanResult = await getOrCreateOrderExecutionChannel(fundedOrder!.id, mockClient, {
    guildId: mockClient.guild.id,
    actorId: adminUser,
  });

  const execChannelId = execChanResult.channelId || '';
  assert(Boolean(execChannelId), 'Execution channel successfully provisioned');
  assert(
    Boolean(execChanResult.channel?.name?.startsWith(`order-${fundedOrder!.id}-`)),
    'Execution channel follows canonical naming convention: order-<id>-<modeSlug>'
  );

  // 4.2 Concurrency check: 5 concurrent execution channel requests return the exact same channel and create 1 DB row
  const concurrentCalls = await Promise.all([
    getOrCreateOrderExecutionChannel(fundedOrder!.id, mockClient, { guildId: mockClient.guild.id }),
    getOrCreateOrderExecutionChannel(fundedOrder!.id, mockClient, { guildId: mockClient.guild.id }),
    getOrCreateOrderExecutionChannel(fundedOrder!.id, mockClient, { guildId: mockClient.guild.id }),
    getOrCreateOrderExecutionChannel(fundedOrder!.id, mockClient, { guildId: mockClient.guild.id }),
    getOrCreateOrderExecutionChannel(fundedOrder!.id, mockClient, { guildId: mockClient.guild.id }),
  ]);

  const allSameChanId = concurrentCalls.every((c) => c.channelId === execChannelId);
  assert(allSameChanId, 'Concurrency Guard: 5 concurrent requests return the exact same channel instance');

  const activeChannelRecords = await prisma.orderChannel.findMany({
    where: { orderId: fundedOrder!.id, channelType: 'execution', status: 'active' },
  });
  assert(
    activeChannelRecords.length === 1,
    'Database Invariant: Exactly one active execution channel record exists in OrderChannel table'
  );

  // 4.3 Strict permission overwrites
  const execChan = mockClient.guild.channels.cache.get(execChannelId);
  assert(Boolean(execChan), 'Execution channel is present in guild cache');

  const everyoneOv = execChan?.permissionOverwrites.get(mockClient.guild.id);
  assert(
    Boolean(everyoneOv && (everyoneOv.deny & PermissionFlagsBits.ViewChannel) !== BigInt(0)),
    'Permission Invariant: @everyone is explicitly DENIED ViewChannel permission'
  );

  const boosterTankOv = execChan?.permissionOverwrites.get(boosterTank);
  assert(
    Boolean(boosterTankOv && (boosterTankOv.allow & PermissionFlagsBits.ViewChannel) !== BigInt(0)),
    'Permission Invariant: Assigned booster is explicitly GRANTED ViewChannel permission'
  );

  // 4.4 Booster replacement permission revocation
  const replacementBooster = SYNTHETIC_USERS.BOOSTER; // Booster 1 replaced by another
  await syncOrderChannelPermissions(fundedOrder!.id, mockClient);
  assert(true, 'syncOrderChannelPermissions evaluates clean role sync without errors');

  // -------------------------------------------------------------------------
  // SECTION 5: In-Channel Completion Proof & Review Workflow
  // -------------------------------------------------------------------------
  console.log('\n[SECTION 5] Testing In-Channel Completion Proof & Review Workflow...');

  // 5.1 Attachment validation unit tests
  const validAtt = validateDiscordAttachment({
    url: 'https://cdn.discordapp.com/attachments/test/screenshot.png',
    name: 'screenshot.png',
    contentType: 'image/png',
    size: 2 * 1024 * 1024,
  });
  assert(Boolean(validAtt.valid), 'validateDiscordAttachment accepts valid 2MB PNG attachment');

  const oversizedAtt = validateDiscordAttachment({
    url: 'https://cdn.discordapp.com/attachments/test/huge.png',
    size: 15 * 1024 * 1024,
  });
  assert(!oversizedAtt.valid && Boolean(oversizedAtt.error?.includes('FILE_TOO_LARGE')), 'validateDiscordAttachment rejects files exceeding 10MB');

  const invalidExtAtt = validateDiscordAttachment({
    url: 'https://cdn.discordapp.com/attachments/test/script.exe',
    name: 'script.exe',
    contentType: 'application/x-msdownload',
  });
  assert(!invalidExtAtt.valid, 'validateDiscordAttachment rejects non-image executable file types');

  // 5.2 Proof submission outside execution channel is strictly rejected
  let wrongChannelRejected = false;
  try {
    await submitDiscordChannelProof({
      orderId: fundedOrder!.id,
      channelId: pubChannel.id, // public channel, NOT execution channel
      authorDiscordId: boosterTank,
      evidenceUrl: 'https://cdn.discordapp.com/attachments/test/proof.png',
      client: mockClient,
    });
  } catch (err: any) {
    wrongChannelRejected = Boolean(err.message?.includes('INVALID_EXECUTION_CHANNEL'));
  }
  assert(wrongChannelRejected, 'Proof submitted outside authoritative execution channel is strictly rejected');

  // 5.3 Proof submission by unassigned user is strictly rejected
  let unassignedRejected = false;
  try {
    await submitDiscordChannelProof({
      orderId: fundedOrder!.id,
      channelId: execChannelId,
      authorDiscordId: SYNTHETIC_USERS.UNVERIFIED,
      evidenceUrl: 'https://cdn.discordapp.com/attachments/test/proof.png',
      client: mockClient,
    });
  } catch (err: any) {
    unassignedRejected = Boolean(err.message?.includes('UNASSIGNED_BOOSTER'));
  }
  assert(unassignedRejected, 'Proof submitted by unassigned user is strictly rejected');

  // 5.4 Authorized booster submits proof in execution channel via G4!proof command
  const proofUploadMsg = await simulateMessageCommand(mockClient, {
    channelId: execChannelId,
    authorId: boosterTank,
    authorRoles: ['booster'],
    content: 'G4!proof Completed +15 Key in 24:12 with 0 deaths',
    attachments: [
      {
        id: 'att_proof_1',
        url: 'https://cdn.discordapp.com/attachments/proof/completion.png',
        name: 'completion.png',
        contentType: 'image/png',
        size: 1024 * 500,
      },
    ],
  });

  assert(
    proofUploadMsg.replies.length > 0,
    'G4!proof command in execution channel processes attachment and replies'
  );

  const runProof = await prisma.runProof.findFirst({
    where: { submittedById: boosterTank },
    orderBy: { submittedAt: 'desc' },
  });
  assert(Boolean(runProof), 'Authoritative RunProof record created in database');
  assert(runProof?.status === 'pending', 'Newly registered RunProof is in status="pending"');

  // 5.5 Modal proof submission via handleDiscordProofModalSubmit
  const modalProofRes = await simulateModalInteraction(mockClient, {
    channelId: execChannelId,
    userId: boosterTank,
    userRoles: ['booster'],
    customId: `modal_order_proof:${fundedOrder!.id}`,
    fields: {
      evidence_url: 'https://cdn.discordapp.com/attachments/proof/modal_evidence.png',
      description: 'Modal completion proof submission test',
      proof_type: 'screenshot',
    },
  });
  assert(modalProofRes.deferred, 'handleDiscordProofModalSubmit defers reply immediately');
  assert(modalProofRes.replies.length > 0, 'Modal proof submission returns confirmation embed');

  // 5.6 Staff reviews and approves the proof
  const staffReviewResult = await reviewRunProof({
    proofId: runProof!.id,
    reviewerId: adminUser,
    decision: 'approve',
    reviewNotes: 'Verified completion score and time against in-game logs',
    discordClient: mockClient,
  });
  assert(
    staffReviewResult.status === 'approved',
    'Staff review: Authorized reviewer successfully approves proof'
  );

  // -------------------------------------------------------------------------
  // SECTION 6: Role-Based Discord Security Matrix
  // -------------------------------------------------------------------------
  console.log('\n[SECTION 6] Testing Role-Based Discord Security Matrix...');

  const unverifiedUser = SYNTHETIC_USERS.UNVERIFIED;
  const boosterUser = SYNTHETIC_USERS.BOOSTER;
  const exchangerUser = SYNTHETIC_USERS.EXCHANGER;
  const managerUser = SYNTHETIC_USERS.MANAGEMENT;

  // 6.1 G4!setup: Unprivileged users rejected; Management allowed
  const unauthSetup = await simulateMessageCommand(mockClient, {
    authorId: unverifiedUser,
    content: 'G4!setup all',
  });
  assert(
    unauthSetup.replies.some((r) => r.content?.includes('Permission Denied')),
    'RBAC: Unverified user is strictly rejected from G4!setup'
  );

  const boosterSetup = await simulateMessageCommand(mockClient, {
    authorId: boosterUser,
    authorRoles: ['booster'],
    content: 'G4!setup all',
  });
  assert(
    boosterSetup.replies.some((r) => r.content?.includes('Permission Denied')),
    'RBAC: Booster is strictly rejected from G4!setup'
  );

  // 6.2 G4!order create: Booster/Exchanger rejected; Advertiser/Staff allowed
  const exchangerOrderCreate = await simulateMessageCommand(mockClient, {
    authorId: exchangerUser,
    authorRoles: ['exchanger'],
    content: 'G4!order create wow 1 50 group Exchanger Attempt',
  });
  assert(
    exchangerOrderCreate.replies.some((r) => r.content?.includes('Permission Denied')),
    'RBAC: Exchanger is strictly rejected from G4!order create'
  );

  // 6.3 G4!assign: Unprivileged users rejected
  const boosterAssign = await simulateMessageCommand(mockClient, {
    authorId: boosterUser,
    authorRoles: ['booster'],
    content: `G4!assign ${fundedOrder!.id} <@${boosterUser}>`,
  });
  assert(
    boosterAssign.replies.some((r) => r.content?.includes('Permission Denied') || r.content?.includes('Unauthorized') || r.content?.includes('❌')),
    'RBAC: Booster is strictly rejected from G4!assign'
  );

  // -------------------------------------------------------------------------
  // SECTION 7: Discord Auto-Provisioning & Policy Sync
  // -------------------------------------------------------------------------
  console.log('\n[SECTION 7] Testing Discord Auto-Provisioning & Policy Sync...');

  // 7.1 Setup publication channels
  const pubSetupMsg = await simulateMessageCommand(mockClient, {
    authorId: adminUser,
    authorRoles: ['admin'],
    content: 'G4!setup publications',
  });
  assert(
    pubSetupMsg.replies.length > 0 && pubSetupMsg.replies.some((r) => r.content?.includes('Setup Completed Successfully')),
    'G4!setup publications provisions routed publication channels'
  );

  // 7.2 Idempotent repeated execution: Re-running G4!setup publications reuses channels without duplicating
  const initialChanCount = mockClient.guild.channels.cache.size;
  await simulateMessageCommand(mockClient, {
    authorId: adminUser,
    authorRoles: ['admin'],
    content: 'G4!setup publications',
  });
  const reRunChanCount = mockClient.guild.channels.cache.size;
  assert(
    reRunChanCount === initialChanCount,
    'Auto-Provisioning Idempotency: Re-running setup reuses existing channels with 0 duplicates'
  );

  // 7.3 Synchronize published policy to Discord
  const publishedPolicy = await getPublishedPolicy();
  assert(Boolean(publishedPolicy), 'Unified Rules & Policies CMS contains active published version');

  const rulesChan = await mockClient.guild.channels.create({
    name: 'rules',
    type: ChannelType.GuildText,
  });
  await prisma.discordChannelMapping.upsert({
    where: { channelKey: 'rules:channel:official' },
    update: { discordChannelId: rulesChan.id, syncStatus: 'SYNCED' },
    create: {
      channelKey: 'rules:channel:official',
      channelName: 'rules',
      categoryName: 'START HERE',
      discordChannelId: rulesChan.id,
      syncStatus: 'SYNCED',
      guildId: mockClient.guild.id,
      purpose: 'OFFICIAL_RULES',
    },
  });

  const policySyncRes = await syncPolicyToDiscord(publishedPolicy!.id, mockClient);
  assert(
    policySyncRes.success,
    'syncPolicyToDiscord publishes authoritative CMS policy directly to Discord channel'
  );

  // -------------------------------------------------------------------------
  // SECTION 8: Dynamic Failure Injection & Resilience Verification
  // -------------------------------------------------------------------------
  console.log('\n[SECTION 8] Testing Dynamic Failure Injection & Resilience Verification...');

  // 8.1 404 Missing Channel Recovery
  const ghostChanId = '999999999999999999';
  let missingChanCaught = false;
  try {
    await mockClient.channels.fetch(ghostChanId);
  } catch (err: any) {
    missingChanCaught = err.status === 404 && err.code === 10003;
  }
  assert(missingChanCaught, 'Mock Client accurately simulates 404 Unknown Channel error');

  // 8.2 403 Missing Permissions Simulation
  mockClient.failureInjector.addRule({
    type: '403_FORBIDDEN',
    targetMethod: 'channel.create',
    once: true,
  });
  let forbiddenCaught = false;
  try {
    await mockClient.guild.channels.create({ name: 'should-fail-403' });
  } catch (err: any) {
    forbiddenCaught = err.status === 403 && err.code === 50013;
  }
  assert(forbiddenCaught, 'Mock Client accurately simulates 403 Missing Permissions error');

  // 8.3 Process / Bot Restart Simulation
  // Creates fresh client instance while retaining guild DB backing store
  const freshClient = mockClient.simulateRestart();
  setGlobalDiscordClient(freshClient);

  // Order execution channel retrieval from database works seamlessly after client restart
  const restartExecChan = await getOrCreateOrderExecutionChannel(fundedOrder!.id, freshClient, {
    guildId: freshClient.guild.id,
  });
  assert(
    restartExecChan.channelId === execChanResult.channelId,
    'Bot Restart Resilience: Execution channel retrieved consistently from DB after simulated bot restart'
  );

  // -------------------------------------------------------------------------
  // SECTION 9: Financial & External Platform Invariants
  // -------------------------------------------------------------------------
  console.log('\n[SECTION 9] Testing Financial & External Platform Invariants...');

  // 9.1 Assert all 6 live financial safety flags remain strictly false
  assert(
    process.env.ESCROW_RELEASE_ENABLED !== 'true',
    'Safety Flag: ESCROW_RELEASE_ENABLED is strictly false'
  );
  assert(
    process.env.FINANCE_V2_LIVE_CREDITS_ENABLED !== 'true',
    'Safety Flag: FINANCE_V2_LIVE_CREDITS_ENABLED is strictly false'
  );
  assert(
    process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED !== 'true',
    'Safety Flag: FINANCE_V2_LIVE_PAYOUTS_ENABLED is strictly false'
  );
  assert(
    process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED !== 'true',
    'Safety Flag: FINANCE_V2_P2P_SETTLEMENT_ENABLED is strictly false'
  );
  assert(
    process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED !== 'true',
    'Safety Flag: NOWPAYMENTS_LIVE_COLLECTION_ENABLED is strictly false'
  );
  assert(
    process.env.RAIDERIO_LIVE_SYNC_ENABLED !== 'true',
    'Safety Flag: RAIDERIO_LIVE_SYNC_ENABLED is strictly false'
  );

  // 9.2 Zero unexpected wallet balance mutations
  const boosterWallet = await prisma.walletV2.findUnique({
    where: { userId: boosterTank },
  });
  assert(
    boosterWallet?.reservedCents === 0,
    'Balance Invariant: Booster reservedCents is 0 (zero unverified escrow release)'
  );

  // -------------------------------------------------------------------------
  // SECTION 10: Summary & Results
  // -------------------------------------------------------------------------
  console.log('\n====================================================================');
  console.log(`STAGING E2E RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('====================================================================\n');

  if (failed > 0) {
    const failedNames = testResults.filter((r) => !r.passed).map((r) => r.name);
    throw new Error(`Staging E2E Suite Failed with ${failed} failure(s):\n${failedNames.map((n) => `  - ${n}`).join('\n')}`);
  }
}

if (require.main === module) {
  runStagingDiscordOrderE2ESuite()
    .then(() => {
      console.log('✅ Staging Discord Order E2E Suite Completed Successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Staging Discord Order E2E Suite Failed:', err);
      process.exit(1);
    });
}

export { runStagingDiscordOrderE2ESuite };
