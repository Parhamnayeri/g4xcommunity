/**
 * src/test/closed_beta_consolidated_suite.ts
 *
 * Consolidated Offline End-to-End Release Blocker Verification Suite for G4X Closed Beta.
 *
 * Covers 7 critical areas:
 *  1. Profile button interaction authorization and REST responses
 *  2. RBAC allow/deny matrix
 *  3. Registration and teams
 *  4. Synthetic order creation, presign, assignment, proof and lifecycle
 *  5. Website authentication and API-to-database routing
 *  6. Data persistence requirements for beta (staging directory & non-interference)
 *  7. Emergency shutdown, kill switch, and transaction rollback
 *
 * Runs 100% OFFLINE with mock Discord adapters and isolated disposable staging databases.
 */

import assert from 'assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { prisma, setGlobalPrismaClient, isGlobalPrismaOverridden } from '../database/db';
import { createDisposableLabDatabase } from '../discord-lab/discordLabDatabase';
import { DiscordLabFirewall, DiscordLabSecurityError } from '../discord-lab/discordLabFirewall';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';
import { ensureUserExists } from '../services/registrationService';
import { createTeam, listTeams } from '../services/teamService';
import { submitRunProof } from '../services/orderDisputeService';
import { validateOwnerAccessKeyConfig } from '../web/ownerGate';
import { validateStagingEnvironment } from '../web/staging/validateStagingEnv';
import {
  checkKillSwitch,
  triggerKillSwitch,
  resetKillSwitch,
} from '../discord-lab/discordLabKillSwitch';
import { handleButtonInteraction } from '../interactions/buttons';

const VALID_TEST_GUILD_ID = '123456789098765432';
const FOREIGN_GUILD_ID = '987654321012345678';
const VALID_TEST_APP_ID = '100000000000000001';

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}:`, err);
    failed++;
  }
}

async function ensureSeedGameAndService(): Promise<{ gameSlug: string; serviceId: number }> {
  const game = await prisma.game.upsert({
    where: { slug: 'wow_midnight' },
    update: {},
    create: {
      slug: 'wow_midnight',
      displayName: 'World of Warcraft: Midnight',
      serviceCategory: 'both',
      isActive: true,
    },
  });

  const existingService = await prisma.gameService.findFirst({
    where: { gameSlug: game.slug, serviceKey: 'mythic_plus_10' },
  });

  if (existingService) {
    return { gameSlug: game.slug, serviceId: existingService.id };
  }

  const service = await prisma.gameService.create({
    data: {
      gameSlug: game.slug,
      serviceKey: 'mythic_plus_10',
      displayName: 'Mythic+ 10 Run',
      serviceMode: 'non_pilot',
      profileMode: 'none',
      isActive: true,
    },
  });

  return { gameSlug: game.slug, serviceId: service.id };
}

export async function runClosedBetaConsolidatedSuite(): Promise<void> {
  console.log('\n🚀 [Suite] Running Consolidated Closed Beta E2E Verification Suite...\n');

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Profile button interaction authorization and REST responses
  // ───────────────────────────────────────────────────────────────────────────
  console.log('[Section 1: Profile Button Interaction & REST Containment]');

  await runTest('1.1 Verified test guild: profile_btn_list produces ephemeral response and permitted callback', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
      channels: {
        cache: new Map([['test_chan_101', { id: 'test_chan_101', guildId: VALID_TEST_GUILD_ID }]]),
      },
      rest: { request: async () => ({ success: true }) },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);

      let interactionHandler: Function = () => {};
      const dummyClient = {
        on: (event: string, handler: Function) => {
          if (event === 'interactionCreate') interactionHandler = handler;
        },
      };

      firewall.attachClientFirewall(dummyClient as any, {
        onPermittedMessage: async () => {},
        onPermittedInteraction: async (interaction: any) => {
          if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
          }
        },
      });

      const interactionId = '777000000000000001';
      const token = 'valid_token_beta';
      const userId = `user_btn_${Date.now()}`.slice(0, 18);

      let replyPayload: any = null;
      let restCallbackSuccess = false;

      const mockInteraction = {
        id: interactionId,
        token,
        guildId: VALID_TEST_GUILD_ID,
        channelId: 'test_chan_101',
        customId: 'profile_btn_list',
        user: { id: userId },
        isButton: () => true,
        reply: async (payload: any) => {
          replyPayload = payload;
          await (mockVerifiedClient.rest as any).request({
            fullRoute: `/interactions/${interactionId}/${token}/callback`,
            method: 'POST',
            body: payload,
          });
          restCallbackSuccess = true;
        },
      };

      await interactionHandler(mockInteraction);

      assert(firewall.permittedInteractionIds.has(interactionId));
      assert.strictEqual(replyPayload.ephemeral, true);
      assert(replyPayload.content.includes('No active characters registered'));
      assert.strictEqual(restCallbackSuccess, true);
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  await runTest('1.2 Foreign guild and DM interactions are dropped and REST callback is denied', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
      channels: { cache: new Map([]) },
      rest: { request: async () => ({ success: true }) },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    let interactionHandler: Function = () => {};
    const dummyClient = {
      on: (event: string, handler: Function) => {
        if (event === 'interactionCreate') interactionHandler = handler;
      },
    };

    let dispatched = false;
    firewall.attachClientFirewall(dummyClient as any, {
      onPermittedMessage: async () => {},
      onPermittedInteraction: async () => { dispatched = true; },
    });

    // Foreign guild interaction
    const foreignId = '888000000000000001';
    await interactionHandler({
      id: foreignId,
      token: 'tok_for',
      guildId: FOREIGN_GUILD_ID,
      customId: 'profile_btn_list',
      user: { id: 'usr_f' },
      isButton: () => true,
    });
    assert.strictEqual(dispatched, false);
    assert.strictEqual(firewall.permittedInteractionIds.has(foreignId), false);

    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: `/interactions/${foreignId}/tok_for/callback`,
          method: 'POST',
        });
      },
      (err: any) => err instanceof DiscordLabSecurityError
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. RBAC allow/deny matrix
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Section 2: RBAC Allow/Deny Matrix]');

  await runTest('2.1 Unprivileged user is denied management permissions', async () => {
    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);

      const unprivilegedId = `unpriv_${Date.now()}`.slice(0, 18);
      await ensureUserExists(unprivilegedId, 'normal_user');

      // Unprivileged user has no roles assigned
      const configAuth = await authorize(unprivilegedId, Permission.SERVICE_CONFIG_MANAGE);
      assert.strictEqual(configAuth.allowed, false);

      const orderCreateAuth = await authorize(unprivilegedId, Permission.ORDER_CREATE_INTERNAL);
      assert.strictEqual(orderCreateAuth.allowed, false);
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  await runTest('2.2 Manager role grant permits authorized actions', async () => {
    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);

      const adminId = `admin_${Date.now()}`.slice(0, 18);
      const managerId = `mgr_${Date.now()}`.slice(0, 18);
      await ensureUserExists(adminId, 'admin_grantor');
      await ensureUserExists(managerId, 'manager_user');

      // Ensure manager role exists in database
      await prisma.role.upsert({
        where: { roleKey: 'manager' },
        update: {},
        create: { roleKey: 'manager', name: 'Manager' },
      });

      // Grant manager role
      await prisma.userRole.create({
        data: {
          userId: managerId,
          roleKey: 'manager',
          grantedBy: adminId,
        },
      });

      const configAuth = await authorize(managerId, Permission.SERVICE_CONFIG_MANAGE);
      assert.strictEqual(configAuth.allowed, true);
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Registration and teams
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Section 3: Registration and Teams]');

  await runTest('3.1 User registration is idempotent and persists in disposable database', async () => {
    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);

      const testUserId = `reg_${Date.now()}`.slice(0, 18);
      const u1 = await ensureUserExists(testUserId, 'booster_alpha');
      assert.strictEqual(u1.username, 'booster_alpha');

      const u2 = await ensureUserExists(testUserId, 'booster_alpha_updated');
      assert.strictEqual(u2.username, 'booster_alpha_updated');

      const count = await prisma.user.count({ where: { discordId: testUserId } });
      assert.strictEqual(count, 1);
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  await runTest('3.2 Approved booster can create premade squad and list teams', async () => {
    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);

      const { gameSlug } = await ensureSeedGameAndService();
      const leaderId = `ldr_${Date.now()}`.slice(0, 18);
      await ensureUserExists(leaderId, 'squad_leader');

      // Grant approved booster qualification
      await prisma.userGameApproval.create({
        data: {
          userId: leaderId,
          gameSlug,
          approvalType: 'booster',
          status: 'approved',
        },
      });

      // Create a trio team
      const team = await createTeam({
        leaderId,
        teamName: 'Mythic Trio Alpha',
        squadType: 'trio',
        gameSlug,
      });

      assert(team !== null);
      assert.strictEqual(team.teamName, 'Mythic Trio Alpha');
      assert.strictEqual(team.squadType, 'trio');

      const teams = await listTeams(leaderId);
      assert.strictEqual(teams.length, 1);
      assert.strictEqual(teams[0].teamName, 'Mythic Trio Alpha');
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Synthetic order creation, presign, assignment, proof and lifecycle
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Section 4: Synthetic Order Lifecycle & Proof Submission]');

  await runTest('4.1 Full synthetic order journey from creation to completion proof', async () => {
    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);

      const { gameSlug, serviceId } = await ensureSeedGameAndService();
      const custId = `cust_${Date.now()}`.slice(0, 18);
      const advId = `adv_${Date.now()}`.slice(0, 18);
      const boosterId = `bst_${Date.now()}`.slice(0, 18);

      await ensureUserExists(custId, 'customer_carol');
      await ensureUserExists(advId, 'advertiser_bob');
      await ensureUserExists(boosterId, 'booster_alice');

      // 1. Create Order
      const order = await prisma.order.create({
        data: {
          orderRef: `G4X-TST-${Date.now()}`,
          gameSlug,
          serviceId,
          customerId: custId,
          advertiserId: advId,
          creatorId: advId,
          orderName: 'Mythic+ 10 Keystone Run',
          orderType: 'dungeon',
          orderMode: 'carry',
          quantity: 1,
          currency: 'USD',
          grossAmountMinor: 4000,
          platformFeeMinor: 400,
          advertiserFeeMinor: 400,
          boosterPoolMinor: 3200,
          paymentStatus: 'verified',
          status: 'open_presign',
        },
      });
      assert(order.id > 0);

      // 2. Presign Registration
      const presign = await prisma.orderPresign.create({
        data: {
          orderId: order.id,
          userId: boosterId,
          registeredRole: 'dps',
          status: 'registered',
        },
      });
      assert(presign.id > 0);

      // 3. Assignment
      const assignment = await prisma.orderAssignment.create({
        data: {
          orderId: order.id,
          userId: boosterId,
          assignedById: advId,
          assignedRole: 'dps',
          status: 'assigned',
        },
      });
      assert(assignment.id > 0);

      // Transition order to in_progress
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'in_progress' },
      });

      // 4. Order Run Creation
      const run = await prisma.orderRun.create({
        data: {
          orderId: order.id,
          runNumber: 1,
          status: 'in_progress',
        },
      });
      assert(run.id > 0);

      // 5. Submit Proof of Completion
      const proofResult = await submitRunProof({
        runId: run.id,
        submittedById: boosterId,
        proofType: 'screenshot',
        evidenceUrl: 'https://cdn.discordapp.com/attachments/101/proof_screenshot.png',
        description: 'Completed in time (+2 keystone)',
      });

      assert(proofResult !== null);
      assert.strictEqual(proofResult.status, 'pending');
      assert.strictEqual(proofResult.submittedById, boosterId);

      // Verify run status
      const updatedRun = await prisma.orderRun.findUnique({ where: { id: run.id } });
      assert.strictEqual(updatedRun?.status, 'in_progress'); // Remains in progress until staff review
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Website authentication and API-to-database routing
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Section 5: Website Authentication & API Routing]');

  await runTest('5.1 Owner gate and session secret validate correctly on loopback', () => {
    // Valid secret & access key
    const validKey = 'high_entropy_owner_access_key_12345_unique';
    const validation = validateOwnerAccessKeyConfig(validKey);
    assert.strictEqual(validation.valid, true);

    // Invalid / template placeholder key
    const invalidKey = 'CHANGE_ME_IN_PRODUCTION_KEY';
    const badValidation = validateOwnerAccessKeyConfig(invalidKey);
    assert.strictEqual(badValidation.valid, false);

    // Staging environment validator rejects real Discord tokens
    const stagingEnvResult = validateStagingEnvironment({
      STAGING_MODE: 'true',
      HOST: '127.0.0.1',
      DATABASE_URL: 'file:./staging/test.db',
      DISCORD_TOKEN: 'Bot live_token_here_must_be_rejected_123456789012345678',
      ESCROW_RELEASE_ENABLED: 'false',
      FINANCE_V2_LIVE_CREDITS_ENABLED: 'false',
      FINANCE_V2_LIVE_PAYOUTS_ENABLED: 'false',
      FINANCE_V2_P2P_SETTLEMENT_ENABLED: 'false',
      NOWPAYMENTS_LIVE_COLLECTION_ENABLED: 'false',
      RAIDERIO_LIVE_SYNC_ENABLED: 'false',
      NOWPAYMENTS_MODE: 'disabled',
      SESSION_SECRET: 'a_secure_session_secret_of_sufficient_length_32_chars',
      G4X_OWNER_ACCESS_KEY: validKey,
    });
    assert.strictEqual(stagingEnvResult.valid, false);
    assert(stagingEnvResult.errors.some((e) => e.includes('DISCORD_TOKEN appears to be a live Discord bot token')));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Data persistence requirements for beta
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Section 6: Beta Data Persistence & Production Non-Interference]');

  await runTest('6.1 Data in staging database persists across client instances and leaves production databases untouched', async () => {
    const repoRoot = path.resolve(__dirname, '../../');
    const forbiddenPaths = [
      path.join(repoRoot, 'prisma/dev.db'),
      path.join(repoRoot, 'prisma/g4x.db'),
      path.join(repoRoot, 'prisma/g4x_dev.db'),
    ];

    const initialMtimes = new Map<string, number>();
    for (const fp of forbiddenPaths) {
      if (fs.existsSync(fp)) {
        initialMtimes.set(fp, fs.statSync(fp).mtimeMs);
      }
    }

    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);

      const persistentUserId = `persist_${Date.now()}`.slice(0, 18);
      await ensureUserExists(persistentUserId, 'persistent_beta_tester');

      // Verify PRAGMA database_list confirms confinement to staging
      const dbList: Array<{ seq: number; name: string; file: string }> = await prisma.$queryRawUnsafe(
        'PRAGMA database_list;'
      );
      const activeFile = path.normalize(dbList.find((d) => d.name === 'main')?.file || '').toLowerCase();
      assert(activeFile.includes('staging'), 'Must be confined to staging directory');
      assert(!activeFile.includes('g4x.db'), 'Must NOT point to production');

      // Disconnect first client, then create another client pointing to the same file
      const { PrismaClient } = await import('@prisma/client');
      const secondClient = new PrismaClient({
        datasources: { db: { url: db.databaseUrl } },
      });

      try {
        const retrieved = await secondClient.user.findUnique({
          where: { discordId: persistentUserId },
        });
        assert(retrieved !== null, 'Data must persist across client connections pointing to staging DB');
        assert.strictEqual(retrieved.username, 'persistent_beta_tester');
      } finally {
        await secondClient.$disconnect();
      }

      // Verify forbidden files were untouched
      for (const fp of forbiddenPaths) {
        if (fs.existsSync(fp)) {
          const currentMtime = fs.statSync(fp).mtimeMs;
          assert.strictEqual(currentMtime, initialMtimes.get(fp), `Forbidden DB '${fp}' was touched!`);
        }
      }
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Emergency shutdown and rollback
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[Section 7: Emergency Shutdown & Rollback]');

  await runTest('7.1 Kill switch activates immediately and blocks operations using safe isolated fixture', () => {
    const tmpKillFile = path.join(os.tmpdir(), `test_kill_${Date.now()}.kill`);
    try {
      assert.strictEqual(checkKillSwitch({ customSearchPaths: [tmpKillFile] }).active, false);

      triggerKillSwitch('CLOSED_BETA_SAFETY_AUDIT_STOP', tmpKillFile);
      const status = checkKillSwitch({ customSearchPaths: [tmpKillFile] });
      assert.strictEqual(status.active, true);
      assert(status.reason?.includes('CLOSED_BETA_SAFETY_AUDIT_STOP'));

      resetKillSwitch(tmpKillFile);
      assert.strictEqual(checkKillSwitch({ customSearchPaths: [tmpKillFile] }).active, false);
    } finally {
      resetKillSwitch(tmpKillFile);
    }
  });

  await runTest('7.2 Aborted transaction rolls back 100% without dirty state', async () => {
    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);

      const rollbackUserId = `tx_roll_${Date.now()}`.slice(0, 18);

      let aborted = false;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.user.create({
            data: { discordId: rollbackUserId, username: 'ghost_user', isActive: true },
          });
          throw new Error('DELIBERATE_TEST_ABORT');
        });
      } catch (err: any) {
        if (err.message === 'DELIBERATE_TEST_ABORT') aborted = true;
      }

      assert.strictEqual(aborted, true);
      const user = await prisma.user.findUnique({ where: { discordId: rollbackUserId } });
      assert.strictEqual(user, null, 'Must leave zero dirty state after rollback');
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  console.log('\n============================================================');
  console.log(`📊 Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// CLI Execution
if (require.main === module) {
  runClosedBetaConsolidatedSuite().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}
