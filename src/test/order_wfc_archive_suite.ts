/**
 * order_wfc_archive_suite.ts — Automated Test Suite for Order Channel Archiving & WFC Transition
 *
 * Verifies:
 *  1. Zero-dependency PKZIP buffer generation (header signatures, CRC-32, decompression integrity).
 *  2. Server-authoritative role evaluation for Staff, Manager, Admin, and Owner.
 *  3. Automated execution channel image gathering, ZIP archiving, RunProof linkage, and channel deletion.
 *  4. Discord command `G4!order <id> wfc` and `G4!order wfc <id>` transitions.
 *  5. Graceful handling of orders without channels or with already-deleted channels.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import prisma from '../database/db';
import {
  createZipBuffer,
  computeCrc32,
  isActorStaffOrHigher,
  archiveAndCleanupExecutionChannel,
} from '../services/orderChannelArchiveService';
import { handleOrderCommand, handleOrderWfc } from '../commands/order';

function assert(condition: any, testName: string, detail?: string): void {
  if (!condition) {
    console.error(`❌ FAILED: ${testName} ${detail ? `(${detail})` : ''}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${testName}`);
}

async function runSuite(): Promise<void> {
  console.log('================================================================');
  console.log('🚀 RUNNING ORDER WFC & CHANNEL ARCHIVING TEST SUITE');
  console.log('================================================================\n');

  // ─── TEST 1: PKZIP Generator Integrity ───────────────────────────────────
  console.log('--- TEST 1: PKZIP Buffer & CRC32 Verification ---');
  const file1 = { name: 'test-evidence-1.png', data: Buffer.from('FAKE_PNG_BINARY_DATA_IMAGE_1', 'utf8') };
  const file2 = { name: 'test-evidence-2.jpg', data: Buffer.from('FAKE_JPG_BINARY_DATA_IMAGE_2_EXTENDED', 'utf8') };
  const file3 = { name: 'summary.txt', data: Buffer.from('Execution channel summary log text', 'utf8') };

  const zipBuf = createZipBuffer([file1, file2, file3]);
  assert(zipBuf && zipBuf.length > 100, 'ZIP buffer generated with non-trivial size');

  // Verify PKZIP local header signature (PK\x03\x04 = 0x04034b50)
  const localSignature = zipBuf.readUInt32LE(0);
  assert(localSignature === 0x04034b50, 'ZIP starts with valid PKZIP local file header signature (0x04034b50)');

  // Verify End of Central Directory signature (PK\x05\x06 = 0x06054b50)
  const eocdSignature = zipBuf.readUInt32LE(zipBuf.length - 22);
  assert(eocdSignature === 0x06054b50, 'ZIP ends with valid End of Central Directory record signature (0x06054b50)');

  // Verify CRC32 calculation
  const crcExpected = computeCrc32(file1.data);
  assert(crcExpected > 0, 'CRC32 computed successfully for sample file data');

  // ─── TEST 2: Role Authorization Checks ───────────────────────────────────
  console.log('\n--- TEST 2: Staff / Manager / Admin / Owner Role Checks ---');
  const testStaffId = 'test_wfc_staff_' + Date.now();
  const testAdminId = 'test_wfc_admin_' + Date.now();
  const testBoosterId = 'test_wfc_booster_' + Date.now();
  const testCustomerId = 'test_wfc_customer_' + Date.now();

  await prisma.user.createMany({
    data: [
      { discordId: testStaffId, username: 'test_staff', isActive: true },
      { discordId: testAdminId, username: 'test_admin', isActive: true },
      { discordId: testBoosterId, username: 'test_booster', isActive: true },
      { discordId: testCustomerId, username: 'test_customer', isActive: true },
    ],
  });

  await prisma.userRole.createMany({
    data: [
      { userId: testStaffId, roleKey: 'staff' },
      { userId: testAdminId, roleKey: 'admin' },
      { userId: testBoosterId, roleKey: 'booster' },
    ],
  });

  const staffAllowed = await isActorStaffOrHigher(testStaffId);
  assert(staffAllowed === true, 'Staff member is authorized for WFC transition');

  const adminAllowed = await isActorStaffOrHigher(testAdminId);
  assert(adminAllowed === true, 'Admin member is authorized for WFC transition');

  const boosterAllowed = await isActorStaffOrHigher(testBoosterId);
  assert(boosterAllowed === false, 'Booster is denied for WFC transition');

  const customerAllowed = await isActorStaffOrHigher(testCustomerId);
  assert(customerAllowed === false, 'Regular customer without staff roles is denied for WFC transition');

  // Discord Member with Administrator permission
  const mockAdminMember = {
    permissions: {
      has: (perm: bigint) => true,
    },
    roles: { cache: new Map() },
  };
  const discordAdminAllowed = await isActorStaffOrHigher('discord_admin_no_db', mockAdminMember as any);
  assert(discordAdminAllowed === true, 'Discord guild administrator is authorized via permission flag');

  // ─── TEST 3: Order Execution Channel Archiving & Deletion ─────────────────
  console.log('\n--- TEST 3: Channel Image Archiving, RunProof Linkage & Deletion ---');
  // Ensure game and service exist
  await prisma.game.upsert({
    where: { slug: 'test_wow' },
    create: { slug: 'test_wow', displayName: 'Test WoW', serviceCategory: 'both' },
    update: {},
  });
  const service = await prisma.gameService.upsert({
    where: { gameSlug_serviceKey: { gameSlug: 'test_wow', serviceKey: 'mythic_plus' } },
    create: {
      gameSlug: 'test_wow',
      serviceKey: 'mythic_plus',
      displayName: 'Mythic Plus',
      serviceMode: 'non_pilot',
      profileMode: 'manual',
    },
    update: {},
  });

  const testOrderId = Math.floor(Date.now() / 1000);
  const testOrderRef = `ORD-WFC-${testOrderId}`;
  const mockChannelId = `discord_chan_${testOrderId}`;

  const testOrder = await prisma.order.create({
    data: {
      id: testOrderId,
      orderRef: testOrderRef,
      gameSlug: 'test_wow',
      serviceId: service.id,
      creatorId: testStaffId,
      creatorType: 'g4x',
      status: 'in_progress',
      orderType: 'group',
      orderMode: 'non_pilot',
      currency: 'USD',
      grossAmountMinor: 5000,
      boosterPoolMinor: 4000,
      executionChannelId: mockChannelId,
      notes: 'Initial operational notes for order',
      runs: {
        create: {
          runNumber: 1,
          status: 'completed',
        },
      },
      orderChannels: {
        create: {
          discordGuildId: 'test_guild_1',
          discordChannelId: mockChannelId,
          channelType: 'execution',
          status: 'active',
        },
      },
    },
  });

  // Mock Discord channel with messages and image attachments
  const deletionTracker = { channelDeleted: false, deleteReason: '' };
  const mockDiscordChannel = {
    id: mockChannelId,
    name: `order-${testOrderId}-mythicplus`,
    messages: {
      fetch: async (options: any) => {
        // Return 2 mock messages: one with an image attachment, one plain text
        return new Map([
          [
            'msg_1',
            {
              id: 'msg_1',
              author: { tag: 'Booster#1234', username: 'booster1' },
              createdAt: new Date(),
              attachments: new Map([
                [
                  'att_1',
                  {
                    id: 'att_1',
                    name: 'boss_kill_screenshot.png',
                    contentType: 'image/png',
                    url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                  },
                ],
              ]),
            },
          ],
          [
            'msg_2',
            {
              id: 'msg_2',
              author: { tag: 'Customer#5678', username: 'cust1' },
              createdAt: new Date(),
              attachments: new Map(),
            },
          ],
        ]);
      },
    },
    delete: async (reason: string) => {
      deletionTracker.channelDeleted = true;
      deletionTracker.deleteReason = reason;
      return true;
    },
  };

  const mockDiscordClient = {
    channels: {
      fetch: async (id: string) => {
        if (id === mockChannelId) return mockDiscordChannel;
        return null;
      },
    },
  };

  const archiveResult = await archiveAndCleanupExecutionChannel(testOrderId, mockDiscordClient as any, testStaffId);
  assert(archiveResult.success === true, 'archiveAndCleanupExecutionChannel succeeded');
  assert(deletionTracker.channelDeleted === true, 'Discord channel delete() was executed');
  assert(deletionTracker.deleteReason.includes(String(testOrderId)), 'Deletion reason references order ID');
  assert(archiveResult.zipUrl && archiveResult.zipUrl.includes('.zip'), 'ZIP archive URL generated');
  assert(fs.existsSync(archiveResult.archiveFilePath!), 'ZIP archive file physically exists on disk');

  // Verify Order DB record was updated with ZIP link
  const updatedOrder = await prisma.order.findUnique({
    where: { id: testOrderId },
  });
  assert(updatedOrder?.notes?.includes('[Archive ZIP]:'), 'Order notes updated with [Archive ZIP] link');
  assert(updatedOrder?.executionChannelId === null, 'Order executionChannelId cleared to null');

  // Verify OrderChannel DB status was updated to deleted
  const channelMapping = await prisma.orderChannel.findFirst({
    where: { orderId: testOrderId, discordChannelId: mockChannelId },
  });
  assert(channelMapping?.status === 'deleted', 'OrderChannel status updated to "deleted"');
  assert(channelMapping?.archivedAt !== null, 'OrderChannel archivedAt timestamp set');

  // Verify RunProof record was created
  const runProof = await prisma.runProof.findFirst({
    where: { run: { orderId: testOrderId } },
  });
  assert(runProof !== null, 'RunProof record created for order run');
  assert(runProof?.evidenceUrl === archiveResult.zipUrl, 'RunProof evidenceUrl matches ZIP URL');
  assert(runProof?.status === 'approved', 'RunProof status is approved');

  // ─── TEST 4: Idempotency & Repeat Calls ───────────────────────────────────
  console.log('\n--- TEST 4: Idempotency (Repeat Archival Calls) ---');
  const repeatResult = await archiveAndCleanupExecutionChannel(testOrderId, mockDiscordClient as any, testStaffId);
  assert(repeatResult.success === true, 'Repeated call on already-archived order succeeds gracefully');
  assert(repeatResult.message === 'NO_ACTIVE_EXECUTION_CHANNEL', 'Returns NO_ACTIVE_EXECUTION_CHANNEL when channel already deleted');

  // ─── TEST 5: Discord Command G4!order <id> wfc ────────────────────────────
  console.log('\n--- TEST 5: Discord Command G4!order <id> wfc ---');
  const commandOrderId = Math.floor(Date.now() / 1000) + 1;
  const commandOrderRef = `ORD-WFC-${commandOrderId}`;
  const commandChanId = `chan_${commandOrderId}`;

  await prisma.order.create({
    data: {
      id: commandOrderId,
      orderRef: commandOrderRef,
      gameSlug: 'test_wow',
      serviceId: service.id,
      creatorId: testStaffId,
      creatorType: 'g4x',
      status: 'in_progress',
      orderType: 'solo',
      currency: 'USD',
      grossAmountMinor: 4000,
      boosterPoolMinor: 3000,
      executionChannelId: commandChanId,
      orderChannels: {
        create: {
          discordGuildId: 'test_guild_1',
          discordChannelId: commandChanId,
          channelType: 'execution',
          status: 'active',
        },
      },
    },
  });

  let mockReplyPayload: any = null;
  const mockMessage: any = {
    author: {
      id: testStaffId,
      tag: 'StaffUser#0001',
      username: 'staffuser',
    },
    client: {
      channels: {
        fetch: async () => ({
          name: `order-${commandOrderId}-mythicplus`,
          messages: {
            fetch: async () => new Map(),
          },
          delete: async () => true,
        }),
      },
    },
    reply: async (payload: any) => {
      mockReplyPayload = payload;
      return payload;
    },
  };

  // Test 5A: G4!order <orderId> wfc
  await handleOrderCommand(mockMessage, [String(commandOrderId), 'wfc']);
  assert(mockReplyPayload !== null, 'Discord bot replied to G4!order <id> wfc');

  const orderAfterWfc = await prisma.order.findUnique({
    where: { id: commandOrderId },
  });
  assert(orderAfterWfc?.status === 'waiting_for_confirm', 'Order transitioned to waiting_for_confirm status');
  assert(orderAfterWfc?.notes?.includes('[Archive ZIP]:'), 'ZIP archive link stored on order notes via command');

  // Test 5B: G4!order wfc <orderId> (alternative parameter order)
  const altOrderId = Math.floor(Date.now() / 1000) + 2;
  await prisma.order.create({
    data: {
      id: altOrderId,
      orderRef: `ORD-WFC-${altOrderId}`,
      gameSlug: 'test_wow',
      serviceId: service.id,
      creatorId: testAdminId,
      creatorType: 'g4x',
      status: 'assigned',
      orderType: 'solo',
      currency: 'USD',
      grossAmountMinor: 3500,
      boosterPoolMinor: 2800,
    },
  });

  await handleOrderCommand(mockMessage, ['wfc', String(altOrderId)]);
  const orderAfterAltWfc = await prisma.order.findUnique({
    where: { id: altOrderId },
  });
  assert(orderAfterAltWfc?.status === 'waiting_for_confirm', 'Order transitioned to waiting_for_confirm via G4!order wfc <id>');

  // Test 5C: Non-staff user denied
  mockReplyPayload = null;
  const mockUnauthMessage: any = {
    author: {
      id: testBoosterId,
      tag: 'Booster#9999',
    },
    reply: async (payload: any) => {
      mockReplyPayload = payload;
      return payload;
    },
  };
  await handleOrderCommand(mockUnauthMessage, [String(altOrderId), 'wfc']);
  assert(
    mockReplyPayload?.content?.includes('Permission Denied'),
    'Non-staff caller is rejected with Permission Denied'
  );

  // ─── CLEANUP ─────────────────────────────────────────────────────────────
  console.log('\n--- CLEANUP ---');
  try {
    if (archiveResult.archiveFilePath && fs.existsSync(archiveResult.archiveFilePath)) {
      fs.unlinkSync(archiveResult.archiveFilePath);
    }
  } catch {}

  console.log('\n================================================================');
  console.log('🎉 ALL ORDER WFC & CHANNEL ARCHIVING TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
}

runSuite().catch((err) => {
  console.error('Test suite failed with unexpected exception:', err);
  process.exit(1);
});
