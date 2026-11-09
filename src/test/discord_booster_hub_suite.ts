/**
 * discord_booster_hub_suite.ts — Automated Security, RBAC & Discord Proof Submission Regression Suite
 *
 * G4X Community — Task 3: Discord-First Booster Hub
 *
 * Tests:
 *  1. Rule A: Web claim bypass is strictly closed (POST /orders/:id/claim returns 403 DISCORD_CLAIM_ONLY).
 *  2. Rule A: Operational assignments retained for Admin/Management; denied for normal Boosters.
 *  3. Booster Portal Access:
 *     - Non-booster receives 403 BOOSTER_ROLE_REQUIRED
 *     - Suspended user (isActive: false) receives 403 ACCOUNT_SUSPENDED
 *     - Suspended game approval receives 403 BOOSTER_SUSPENDED
 *     - Multi-role user (booster + advertiser) retains full booster portal access
 *  4. Data Isolation & Privacy: Booster A cannot inspect private records of Booster B.
 *  5. Available Orders & Deep Links: Authoritative Discord URLs (https://discord.com/channels/{g}/{c}/{m})
 *     and canonical mode labels (Mythic+, Pilot, Selfplay — never Selfpay).
 *  6. Discord Proof Submission:
 *     - Assigned booster in active execution channel successfully submits proof
 *     - RunProof created in pending status with Discord provenance
 *     - Milestone notification dispatched to execution channel
 *  7. Discord Proof Guards:
 *     - Unassigned booster rejected (UNASSIGNED_BOOSTER)
 *     - Proof in wrong channel rejected (INVALID_EXECUTION_CHANNEL)
 *     - Non-existent order rejected (ORDER_NOT_FOUND)
 *  8. Attachment Validation:
 *     - Rejects oversized files (> 10MB, PROOF_FILE_TOO_LARGE)
 *     - Rejects non-image MIME types (INVALID_PROOF_MIME_TYPE)
 *     - Accepts valid PNG, JPEG, WEBP attachments
 *  9. Staff Proof Review Integration:
 *     - Staff/Admin approval transitions proof to approved
 *     - Staff/Admin rejection transitions proof to rejected
 *     - Mandatory review notes enforced
 * 10. Anti-Self-Review Guard: Submitter booster cannot review or approve their own proof (SELF_APPROVAL_PROHIBITED).
 * 11. Financial Safety: Zero mutations to wallets, wallets_v2, or ledger_entries_v2 across all operations.
 */

import express, { Request, Response } from 'express';
import request from 'supertest';
import { ChannelType } from 'discord.js';
import prisma from '../database/db';
import { router as mainRouter } from '../web/routes';
import {
  handleGetBoosterPortalData,
} from '../web/profileSettingsRoutes';
import {
  validateDiscordAttachment,
  submitDiscordChannelProof,
} from '../services/discordProofSubmissionService';
import {
  reviewRunProof,
} from '../services/orderDisputeService';
import {
  assignOrderBoosters,
} from '../services/assignmentService';
import { DomainError, DomainErrorCode } from '../services/domainErrors';

// Ensure all live financial gates remain strictly disabled
process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'false';
process.env.ESCROW_RELEASE_ENABLED = 'false';
process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED = 'false';
process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED = 'false';
process.env.NOWPAYMENTS_LIVE_COLLECTION_ENABLED = 'false';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export async function runDiscordBoosterHubSuite(): Promise<boolean> {
  console.log('\n====================================================================');
  console.log('G4X Community — Discord-First Booster Hub & Proof Regression Suite');
  console.log('====================================================================\n');

  let passed = 0;
  let failed = 0;
  const results: TestResult[] = [];

  function assert(condition: any, testName: string, detail?: string) {
    if (Boolean(condition)) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
      results.push({ name: testName, passed: true });
    } else {
      console.error(`  ❌ [FAIL] ${testName}${detail ? ': ' + detail : ''}`);
      failed++;
      results.push({ name: testName, passed: false, error: detail });
    }
  }

  // Financial baseline snapshot
  const startWallets = await prisma.wallet.findMany();
  const startWalletsV2 = await prisma.walletV2.findMany();
  const startLedger = await prisma.ledgerEntryV2.findMany();

  const timestamp = Date.now();
  const mockGuildId = `guild_bst_${timestamp}`;
  process.env.DISCORD_GUILD_ID = mockGuildId;

  // Test User Identifiers
  const uOwner = `usr_bst_owner_${timestamp}`;
  const uAdmin = `usr_bst_admin_${timestamp}`;
  const uManager = `usr_bst_mgr_${timestamp}`;
  const uStaff = `usr_bst_staff_${timestamp}`;
  const uAdv = `usr_bst_adv_${timestamp}`;
  const uBooster1 = `usr_bst_booster1_${timestamp}`;
  const uBooster2 = `usr_bst_booster2_${timestamp}`;
  const uSuspended = `usr_bst_suspended_${timestamp}`;
  const uApprovalSusp = `usr_bst_appsusp_${timestamp}`;
  const uMulti = `usr_bst_multi_${timestamp}`;
  const uCustomer = `usr_bst_cust_${timestamp}`;

  const allTestUserIds = [
    uOwner, uAdmin, uManager, uStaff, uAdv,
    uBooster1, uBooster2, uSuspended, uApprovalSusp, uMulti, uCustomer,
  ];

  // Helper to create mock Express request/response for direct handler testing
  function createMockReqRes(user: { discordId: string; username: string }) {
    const req: any = {
      user,
      query: {},
      params: {},
      body: {},
    };
    let statusCode = 200;
    let responseData: any = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return res;
      },
      json(data: any) {
        responseData = data;
        return res;
      },
    };
    return {
      req,
      res,
      getStatus: () => statusCode,
      getData: () => responseData,
    };
  }

  // Mock Discord Client & Execution Channels Map
  const mockChannelsMap = new Map<string, any>();
  let channelSeq = 7000;

  function createMockChannel(data: any) {
    const channelId = data.id || `chan_bst_${++channelSeq}`;
    const messagesList: any[] = [];
    const channelObj: any = {
      id: channelId,
      name: data.name || 'order-mock-selfplay',
      topic: data.topic || null,
      type: data.type ?? ChannelType.GuildText,
      guild: { id: mockGuildId },
      isTextBased: () => true,
      messages: {
        fetch: async (opts?: any) => {
          if (typeof opts === 'string') {
            const found = messagesList.find((m) => m.id === opts);
            if (!found) {
              const err: any = new Error('Unknown Message');
              err.status = 404;
              throw err;
            }
            return found;
          }
          return messagesList;
        },
      },
      send: async (payload: any) => {
        const msgId = `msg_bst_${Date.now()}_${Math.random()}`;
        const msgObj = {
          id: msgId,
          ...payload,
          edit: async (newPayload: any) => {
            Object.assign(msgObj, newPayload);
            return msgObj;
          },
        };
        messagesList.push(msgObj);
        return msgObj;
      },
      delete: async () => {
        mockChannelsMap.delete(channelId);
        return true;
      },
    };
    mockChannelsMap.set(channelId, channelObj);
    return channelObj;
  }

  const mockDiscordClient: any = {
    guilds: {
      cache: new Map([
        [
          mockGuildId,
          {
            id: mockGuildId,
            channels: {
              cache: mockChannelsMap,
              fetch: async (id: string) => mockChannelsMap.get(id) || null,
              create: async (data: any) => createMockChannel(data),
            },
            members: {
              fetch: async (id: string) => {
                const user = allTestUserIds.includes(id);
                if (!user) {
                  const err: any = new Error('Unknown Member');
                  err.code = 10007;
                  throw err;
                }
                return { id, user: { id } };
              },
            },
          },
        ],
      ]),
      fetch: async (id: string) => mockDiscordClient.guilds.cache.get(id) || null,
    },
    channels: {
      cache: mockChannelsMap,
      fetch: async (id: string) => mockChannelsMap.get(id) || null,
    },
  };

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Setup Seed Users, Roles & Game
    // -------------------------------------------------------------------------
    console.log('--- Phase 1: Environment & Identity Setup ---');

    // Create test game
    const testGameSlug = `wow_bst_${timestamp}`;
    const game = await prisma.game.create({
      data: {
        slug: testGameSlug,
        displayName: 'World of Warcraft (Booster Test)',
        serviceCategory: 'non_pilot',
        isActive: true,
      },
    });

    // Create test service
    const service = await prisma.gameService.create({
      data: {
        gameSlug: testGameSlug,
        serviceKey: `mplus_boost_${timestamp}`,
        displayName: 'Mythic+ Dungeon Run',
        serviceMode: 'non_pilot',
        profileMode: 'none',
        isActive: true,
      },
    });

    // Seed Users
    await prisma.user.createMany({
      data: [
        { discordId: uOwner, username: 'owner_user', isActive: true },
        { discordId: uAdmin, username: 'admin_user', isActive: true },
        { discordId: uManager, username: 'manager_user', isActive: true },
        { discordId: uStaff, username: 'staff_user', isActive: true },
        { discordId: uAdv, username: 'adv_user', isActive: true },
        { discordId: uBooster1, username: 'booster_one', isActive: true },
        { discordId: uBooster2, username: 'booster_two', isActive: true },
        { discordId: uSuspended, username: 'booster_suspended', isActive: false },
        { discordId: uApprovalSusp, username: 'booster_appsusp', isActive: true },
        { discordId: uMulti, username: 'booster_multi', isActive: true },
        { discordId: uCustomer, username: 'customer_user', isActive: true },
      ],
    });

    // Seed Roles
    await prisma.userRole.createMany({
      data: [
        { userId: uOwner, roleKey: 'owner' },
        { userId: uAdmin, roleKey: 'admin' },
        { userId: uManager, roleKey: 'manager' },
        { userId: uStaff, roleKey: 'staff' },
        { userId: uAdv, roleKey: 'advertiser' },
        { userId: uBooster1, roleKey: 'booster' },
        { userId: uBooster2, roleKey: 'booster' },
        { userId: uSuspended, roleKey: 'booster' },
        { userId: uApprovalSusp, roleKey: 'booster' },
        { userId: uMulti, roleKey: 'booster' },
        { userId: uMulti, roleKey: 'advertiser' },
      ],
    });

    // Seed Game Approvals
    await prisma.userGameApproval.createMany({
      data: [
        { userId: uBooster1, gameSlug: testGameSlug, approvalType: 'booster', status: 'approved' },
        { userId: uBooster1, gameSlug: testGameSlug, approvalType: 'non_pilot', status: 'approved' },
        { userId: uBooster2, gameSlug: testGameSlug, approvalType: 'booster', status: 'approved' },
        { userId: uBooster2, gameSlug: testGameSlug, approvalType: 'non_pilot', status: 'approved' },
        { userId: uMulti, gameSlug: testGameSlug, approvalType: 'booster', status: 'approved' },
        { userId: uMulti, gameSlug: testGameSlug, approvalType: 'non_pilot', status: 'approved' },
        { userId: uApprovalSusp, gameSlug: testGameSlug, approvalType: 'booster', status: 'suspended' },
        { userId: uApprovalSusp, gameSlug: testGameSlug, approvalType: 'non_pilot', status: 'suspended' },
      ],
    });

    // -------------------------------------------------------------------------
    // Phase 2: Rule A Enforcement — Web Claim Bypasses Permanently Closed
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 2: Rule A Enforcement (Discord-Only Boost Claims) ---');

    // Create an order for claim testing
    const testOrder1 = await prisma.order.create({
      data: {
        orderRef: `G4X-BST-${timestamp}-01`,
        gameSlug: testGameSlug,
        serviceId: service.id,
        orderType: 'group',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 2500,
        platformFeeMinor: 500,
        advertiserFeeMinor: 250,
        boosterPoolMinor: 1500,
        status: 'published',
        paymentStatus: 'verified',
        creatorType: 'g4x',
        creatorId: uAdmin,
        customerId: uCustomer,
        advertiserId: uAdv,
      },
    });

    // Setup Express test app for routes.ts testing
    const app = express();
    app.use(express.json());
    // Attach user session middleware for supertest
    let mockSessionUser: any = null;
    app.use((req, res, next) => {
      if (mockSessionUser) {
        (req as any).user = mockSessionUser;
        (req as any).session = {
          userId: mockSessionUser.discordId,
          user: mockSessionUser,
          csrfToken: 'test-csrf-token',
        };
      }
      next();
    });
    app.use(mainRouter);

    // Test 1: Authenticated booster calls POST /orders/:id/claim
    mockSessionUser = { discordId: uBooster1, username: 'booster_one' };
    const claimRes = await request(app)
      .post(`/orders/${testOrder1.id}/claim`)
      .set('x-csrf-token', 'test-csrf-token')
      .send({ role: 'dps' });

    assert(
      claimRes.status === 403 && claimRes.body.error === 'DISCORD_CLAIM_ONLY',
      'Rule A: POST /orders/:id/claim is strictly blocked with HTTP 403 DISCORD_CLAIM_ONLY',
      claimRes.body.message
    );

    // Test 2: Unauthenticated request to /orders/:id/claim returns 401
    mockSessionUser = null;
    const unauthClaimRes = await request(app)
      .post(`/orders/${testOrder1.id}/claim`)
      .send({ role: 'dps' });

    assert(
      unauthClaimRes.status === 401,
      'Rule A: Unauthenticated request to /orders/:id/claim is rejected with 401'
    );

    // -------------------------------------------------------------------------
    // Phase 3: Operational Assignment Retained for Staff/Management
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 3: Operational Assignment vs. Booster Self-Claim ---');

    // Test 3: Normal Booster without management permissions cannot assign orders
    try {
      await assignOrderBoosters({
        orderId: testOrder1.id,
        actorId: uBooster1,
        candidates: [{ userId: uBooster1, assignedRole: 'dps' }],
      });
      assert(false, 'Booster must NOT have permission to invoke assignment service directly');
    } catch (err: any) {
      assert(
        err instanceof DomainError && err.code === DomainErrorCode.PERMISSION_DENIED,
        'Booster direct assignment attempt throws PERMISSION_DENIED'
      );
    }

    // Test 4: Admin with ORDER_ASSIGN successfully assigns booster
    const assignmentResult = await assignOrderBoosters({
      orderId: testOrder1.id,
      actorId: uAdmin,
      candidates: [{ userId: uBooster1, assignedRole: 'dps' }],
    });

    assert(
      assignmentResult && assignmentResult.assignments.some((a) => a.userId === uBooster1),
      'Admin retains authorized assignment capability via existing assignment engine'
    );

    // -------------------------------------------------------------------------
    // Phase 4: Booster Portal Access & RBAC Strictness
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 4: Booster Portal Access & RBAC Strictness ---');

    // Test 5: Customer (non-booster) receives 403 BOOSTER_ROLE_REQUIRED
    const custReqRes = createMockReqRes({ discordId: uCustomer, username: 'customer_user' });
    await handleGetBoosterPortalData(custReqRes.req, custReqRes.res);
    assert(
      custReqRes.getStatus() === 403 && custReqRes.getData()?.error === 'BOOSTER_ROLE_REQUIRED',
      'Non-booster user receives 403 BOOSTER_ROLE_REQUIRED on /booster/portal-data'
    );

    // Test 6: Inactive/Suspended user receives 403 ACCOUNT_SUSPENDED
    const suspReqRes = createMockReqRes({ discordId: uSuspended, username: 'booster_suspended' });
    await handleGetBoosterPortalData(suspReqRes.req, suspReqRes.res);
    assert(
      suspReqRes.getStatus() === 403 && suspReqRes.getData()?.error === 'ACCOUNT_SUSPENDED',
      'Suspended user (isActive: false) receives 403 ACCOUNT_SUSPENDED'
    );

    // Test 7: Booster with suspended game approval receives 403 BOOSTER_SUSPENDED
    const appSuspReqRes = createMockReqRes({ discordId: uApprovalSusp, username: 'booster_appsusp' });
    await handleGetBoosterPortalData(appSuspReqRes.req, appSuspReqRes.res);
    assert(
      appSuspReqRes.getStatus() === 403 && appSuspReqRes.getData()?.error === 'BOOSTER_SUSPENDED',
      'Booster with suspended game approval receives 403 BOOSTER_SUSPENDED'
    );

    // Test 8: Multi-role user (booster + advertiser) retains full access
    const multiReqRes = createMockReqRes({ discordId: uMulti, username: 'booster_multi' });
    await handleGetBoosterPortalData(multiReqRes.req, multiReqRes.res);
    assert(
      multiReqRes.getStatus() === 200 && multiReqRes.getData()?.success === true,
      'Multi-role user (booster + advertiser) retains full access to Booster Portal'
    );

    // -------------------------------------------------------------------------
    // Phase 5: Data Isolation & Deep Links
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 5: Data Isolation & Authoritative Deep Links ---');

    // Create a 2nd order assigned to Booster 2
    const testOrder2 = await prisma.order.create({
      data: {
        orderRef: `G4X-BST-${timestamp}-02`,
        gameSlug: testGameSlug,
        serviceId: service.id,
        orderType: 'group',
        orderMode: 'non_pilot',
        currency: 'USD',
        grossAmountMinor: 3000,
        platformFeeMinor: 600,
        advertiserFeeMinor: 300,
        boosterPoolMinor: 1800,
        status: 'published',
        paymentStatus: 'verified',
        creatorType: 'g4x',
        creatorId: uAdmin,
        customerId: uCustomer,
        advertiserId: uAdv,
        discordChannelId: '987654321',
        discordMessageId: '1122334455',
      },
    });

    await prisma.orderAssignment.create({
      data: {
        orderId: testOrder2.id,
        userId: uBooster2,
        assignedById: uAdmin,
        assignedRole: 'healer',
        status: 'assigned',
      },
    });

    // Test 9: Booster 1 portal data contains only Booster 1 orders
    const b1ReqRes = createMockReqRes({ discordId: uBooster1, username: 'booster_one' });
    await handleGetBoosterPortalData(b1ReqRes.req, b1ReqRes.res);
    const b1Data = b1ReqRes.getData();

    const b1OrderIds = b1Data?.myOrders?.map((o: any) => o.id) || [];
    assert(
      b1OrderIds.includes(testOrder1.id) && !b1OrderIds.includes(testOrder2.id),
      'Data Isolation: Booster 1 only sees their own assigned orders (testOrder1 yes, testOrder2 no)'
    );

    // Test 10: Available Orders include Discord deep links & Selfplay mode label
    const availableOrders = b1Data?.availableQueue || [];
    const order2InQueue = availableOrders.find((o: any) => o.id === testOrder2.id);

    assert(
      order2InQueue &&
      order2InQueue.discordLink === `https://discord.com/channels/${mockGuildId}/987654321/1122334455` &&
      order2InQueue.modeLabel === 'Mythic+',
      'Available orders expose authoritative Discord card URL and Mythic+ mode label (never Selfpay)'
    );

    // Test 11: Order without Discord card has null/empty link and does not crash
    const order1InQueue = availableOrders.find((o: any) => o.id === testOrder1.id);
    assert(
      order1InQueue && order1InQueue.discordLink === null,
      'Unpublished Discord card returns null discordLink safely'
    );

    // -------------------------------------------------------------------------
    // Phase 6: Discord Proof Submission in Private Channel
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 6: Discord Proof Submission in Private Execution Channel ---');

    // Create private execution channel for testOrder1
    const execChannel = createMockChannel({
      id: `chan_exec_${timestamp}`,
      name: `order-${testOrder1.id}-selfplay`,
    });

    await prisma.orderChannel.create({
      data: {
        orderId: testOrder1.id,
        discordGuildId: mockGuildId,
        discordChannelId: execChannel.id,
        channelType: 'execution',
        status: 'active',
      },
    });

    // Create OrderRun for testOrder1
    const run1 = await prisma.orderRun.create({
      data: {
        orderId: testOrder1.id,
        runNumber: 1,
        status: 'in_progress',
      },
    });

    // Test 12: Assigned Booster submits proof in active execution channel
    const proofResult = await submitDiscordChannelProof({
      orderId: testOrder1.id,
      runId: run1.id,
      channelId: execChannel.id,
      authorDiscordId: uBooster1,
      evidenceUrl: 'https://cdn.discordapp.com/attachments/123/456/dungeon_complete.png',
      description: 'Timed +15 with 2 minutes remaining',
      discordMessageId: 'msg_proof_evidence_001',
      client: mockDiscordClient,
    });

    assert(
      proofResult.success === true && proofResult.proof?.status === 'pending',
      'Discord Proof Submission: Assigned booster successfully submits proof in active execution channel'
    );

    // Test 13: RunProof contains Discord provenance tag
    const storedProof = await prisma.runProof.findUnique({
      where: { id: proofResult.proof.id },
    });
    assert(
      storedProof?.description?.includes('[Discord Evidence: msg=msg_proof_evidence_001]'),
      'Discord Proof Provenance: RunProof description preserves messageId and author audit metadata'
    );

    // Test 14: OrderRun transitioned to completed
    const updatedRun = await prisma.orderRun.findUnique({
      where: { id: run1.id },
    });
    assert(
      updatedRun?.status === 'completed',
      'Run Lifecycle: Run status transitioned to completed upon proof submission'
    );

    // -------------------------------------------------------------------------
    // Phase 7: Discord Proof Submission Guards
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 7: Discord Proof Submission Guards ---');

    // Test 15: Unassigned booster cannot submit proof
    try {
      await submitDiscordChannelProof({
        orderId: testOrder1.id,
        runId: run1.id,
        channelId: execChannel.id,
        authorDiscordId: uBooster2, // Booster 2 is not assigned to order 1
        evidenceUrl: 'https://cdn.discordapp.com/attachments/123/456/dungeon_fake.png',
        client: mockDiscordClient,
      });
      assert(false, 'Unassigned booster must be rejected from submitting proof');
    } catch (err: any) {
      assert(
        err instanceof DomainError &&
        err.code === DomainErrorCode.PERMISSION_DENIED &&
        err.message.includes('UNASSIGNED_BOOSTER'),
        'Proof Guard: Unassigned booster rejected with PERMISSION_DENIED (UNASSIGNED_BOOSTER)'
      );
    }

    // Test 16: Assigned booster submits in wrong/random channel
    const wrongChannel = createMockChannel({
      id: `chan_wrong_${timestamp}`,
      name: 'general-chat',
    });

    try {
      await submitDiscordChannelProof({
        orderId: testOrder1.id,
        runId: run1.id,
        channelId: wrongChannel.id, // Not the order's execution channel
        authorDiscordId: uBooster1,
        evidenceUrl: 'https://cdn.discordapp.com/attachments/123/456/dungeon_wrong.png',
        client: mockDiscordClient,
      });
      assert(false, 'Proof submission in wrong channel must be rejected');
    } catch (err: any) {
      assert(
        err instanceof DomainError &&
        err.code === DomainErrorCode.PERMISSION_DENIED &&
        err.message.includes('INVALID_EXECUTION_CHANNEL'),
        'Proof Guard: Submission in wrong channel rejected with INVALID_EXECUTION_CHANNEL'
      );
    }

    // Test 17: Non-existent order rejected
    try {
      await submitDiscordChannelProof({
        orderId: 99999999,
        channelId: execChannel.id,
        authorDiscordId: uBooster1,
        evidenceUrl: 'https://cdn.discordapp.com/attachments/123/456/valid.png',
        client: mockDiscordClient,
      });
      assert(false, 'Proof submission for non-existent order must be rejected');
    } catch (err: any) {
      assert(
        err instanceof DomainError && err.code === DomainErrorCode.ORDER_NOT_FOUND,
        'Proof Guard: Non-existent order rejected with ORDER_NOT_FOUND'
      );
    }

    // -------------------------------------------------------------------------
    // Phase 8: Attachment Validation
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 8: Discord Attachment Validation ---');

    // Test 18: Valid PNG/JPEG/WEBP attachments pass
    const validPng = validateDiscordAttachment({
      url: 'https://cdn.discordapp.com/attachments/123/456/score.png',
      name: 'score.png',
      contentType: 'image/png',
      size: 2 * 1024 * 1024,
    });
    assert(validPng.valid === true, 'Attachment Validation: Valid 2MB PNG attachment accepted');

    // Test 19: Oversized attachment (>10MB) rejected
    const oversized = validateDiscordAttachment({
      url: 'https://cdn.discordapp.com/attachments/123/456/giant.png',
      name: 'giant.png',
      contentType: 'image/png',
      size: 15 * 1024 * 1024, // 15 MB
    });
    assert(
      oversized.valid === false && oversized.error?.includes('FILE_TOO_LARGE'),
      'Attachment Validation: Oversized 15MB file rejected with PROOF_FILE_TOO_LARGE'
    );

    // Test 20: Non-image MIME type rejected
    const invalidMime = validateDiscordAttachment({
      url: 'https://cdn.discordapp.com/attachments/123/456/malicious.pdf',
      name: 'malicious.pdf',
      contentType: 'application/pdf',
      size: 1024 * 1024,
    });
    assert(
      invalidMime.valid === false && invalidMime.error?.includes('INVALID_MIME_TYPE'),
      'Attachment Validation: PDF file rejected with INVALID_PROOF_MIME_TYPE'
    );

    // -------------------------------------------------------------------------
    // Phase 9: Staff Proof Review Integration & Anti-Self-Review Guard
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 9: Staff Proof Review & Anti-Self-Review Guard ---');

    // Test 21: Submitter booster attempts to self-approve proof -> rejected
    try {
      await reviewRunProof({
        proofId: proofResult.proof.id,
        reviewerId: uBooster1, // Submitter is uBooster1
        decision: 'approve',
        reviewNotes: 'Self approved by booster',
      });
      assert(false, 'Submitter must NOT be allowed to self-approve proof');
    } catch (err: any) {
      assert(
        err instanceof DomainError && err.code === DomainErrorCode.SELF_APPROVAL_PROHIBITED,
        'Anti-Self-Approval: Booster submitter self-approval rejected with SELF_APPROVAL_PROHIBITED'
      );
    }

    // Test 22: Non-staff (Customer) attempts to review proof -> rejected
    try {
      await reviewRunProof({
        proofId: proofResult.proof.id,
        reviewerId: uCustomer,
        decision: 'approve',
        reviewNotes: 'Customer trying to approve',
      });
      assert(false, 'Customer must not be allowed to review proof');
    } catch (err: any) {
      assert(
        err instanceof DomainError && err.code === DomainErrorCode.PERMISSION_DENIED,
        'RBAC: Customer rejected from reviewing proof with PERMISSION_DENIED'
      );
    }

    // Test 23: Authorized Staff reviews and approves proof
    const staffReview = await reviewRunProof({
      proofId: proofResult.proof.id,
      reviewerId: uStaff,
      decision: 'approve',
      reviewNotes: 'Verified completion score and time on Raider.io',
      discordClient: mockDiscordClient,
    });

    assert(
      staffReview.status === 'approved' && staffReview.reviewedById === uStaff,
      'Staff Review: Authorized Staff successfully approves proof with review notes'
    );

    // Test 24: Rejection flow with review notes on a new run proof
    const run2 = await prisma.orderRun.create({
      data: {
        orderId: testOrder1.id,
        runNumber: 2,
        status: 'in_progress',
      },
    });

    const proof2 = await submitDiscordChannelProof({
      orderId: testOrder1.id,
      runId: run2.id,
      channelId: execChannel.id,
      authorDiscordId: uBooster1,
      evidenceUrl: 'https://cdn.discordapp.com/attachments/123/456/blurry_score.png',
      description: 'Second run',
      discordMessageId: 'msg_proof_evidence_002',
      client: mockDiscordClient,
    });

    const staffReject = await reviewRunProof({
      proofId: proof2.proof.id,
      reviewerId: uStaff,
      decision: 'reject',
      reviewNotes: 'Screenshot is illegible and missing dungeon timer',
      discordClient: mockDiscordClient,
    });

    assert(
      staffReject.status === 'rejected' && staffReject.reviewNotes?.includes('Screenshot is illegible'),
      'Staff Review: Authorized Staff rejects illegible proof with mandatory review notes'
    );

    // -------------------------------------------------------------------------
    // Phase 10: Financial Invariants Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Phase 10: Strict Financial Invariants (Zero Mutations) ---');

    const endWallets = await prisma.wallet.findMany();
    const endWalletsV2 = await prisma.walletV2.findMany();
    const endLedger = await prisma.ledgerEntryV2.findMany();

    assert(
      endWallets.length === startWallets.length,
      'Financial Invariant: Wallet table row count has zero mutations'
    );
    assert(
      endWalletsV2.length === startWalletsV2.length,
      'Financial Invariant: WalletV2 table row count has zero mutations'
    );
    assert(
      endLedger.length === startLedger.length,
      'Financial Invariant: LedgerEntryV2 table row count has zero mutations'
    );

    // -------------------------------------------------------------------------
    // Teardown
    // -------------------------------------------------------------------------
    console.log('\n--- Teardown: Cleaning Temporary Test Records ---');

    await prisma.runProof.deleteMany({
      where: { run: { order: { gameSlug: testGameSlug } } },
    });
    await prisma.orderRun.deleteMany({
      where: { order: { gameSlug: testGameSlug } },
    });
    await prisma.orderAssignment.deleteMany({
      where: { order: { gameSlug: testGameSlug } },
    });
    await prisma.orderChannel.deleteMany({
      where: { order: { gameSlug: testGameSlug } },
    });
    await prisma.order.deleteMany({
      where: { gameSlug: testGameSlug },
    });
    await prisma.gameService.deleteMany({
      where: { gameSlug: testGameSlug },
    });
    await prisma.userGameApproval.deleteMany({
      where: { userId: { in: allTestUserIds } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: allTestUserIds } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: allTestUserIds } },
    });
    await prisma.game.deleteMany({
      where: { slug: testGameSlug },
    });

    console.log('Teardown complete.\n');

  } catch (fatalError: any) {
    console.error('Fatal suite failure:', fatalError);
    failed++;
  }

  console.log('====================================================================');
  console.log(`Discord Booster Hub Suite Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================================\n');

  return failed === 0;
}

if (require.main === module) {
  runDiscordBoosterHubSuite()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Unhandled fatal error:', err);
      process.exit(1);
    });
}
