/**
 * src/test/exchange_phase6_discord_portal_suite.ts
 *
 * Comprehensive Test Suite for G4X Exchange Phase 6:
 *  1. Rule 1: No Payment = No Discord Channel (assertTradeEscrowFunded fails on unpaid trade)
 *  2. Funded Trade Room Creation & Idempotency (ensureExchangeDiscordRoom, 13-field Welcome Embed, Zero PII)
 *  3. G4!exchange info Command (Live trade breakdown embed)
 *  4. G4!exchange proof Command (Delivery proof guidelines & attachment logging)
 *  5. Rule 2 & 3: G4!exchange confirm (Buyer-only, transitions to AWAITING_FINAL_APPROVAL, ZERO wallet balance mutation)
 *  6. G4!exchange dispute (Transitions to DISPUTED, freezes escrow to FROZEN_DISPUTE, alerts staff)
 *  7. Rule 4: G4!exchange close & Archival (Requires terminal trade, locks permissions, moves to Archive category, NEVER deletes)
 *  8. Configuration Get/Update with RBAC & Audit Log
 */

import prisma from '../database/db';
import { ChannelType } from 'discord.js';
import {
  ensureExchangeDiscordRoom,
  archiveExchangeDiscordRoom,
  buildTradeWelcomeEmbed,
  getExchangeDiscordConfig,
  updateExchangeDiscordConfig,
} from '../services/exchangeDiscordService';
import { handleExchangeCommand } from '../commands/exchangeCommands';
import {
  payTradeWithWallet,
} from '../services/exchangePaymentService';
import {
  submitSellOffer,
  acceptSellOffer,
  TradeValidationError,
} from '../services/exchangeTradeService';
import {
  ensureExchangeDefaults,
} from '../services/exchangeConfigService';
import { setGlobalDiscordClient } from '../services/orderDiscordService';

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
  console.log('=== STARTING G4X EXCHANGE PHASE 6 DISCORD PORTAL & BOT COMMANDS SUITE ===\n');

  const BUYER_ID = `P6_BUYER_${Date.now()}`;
  const SELLER_ID = `P6_SELLER_${Date.now()}`;
  const ADMIN_ID = `P6_ADMIN_${Date.now()}`;

  // Track if channel.delete was ever called (Strict Rule 4 Violation)
  let channelDeleteCalled = false;

  // Mock Discord Channel & Guild
  const sentMessages: any[] = [];
  const mockChannel: any = {
    id: `chan_${Date.now()}`,
    name: 'mock-channel',
    type: ChannelType.GuildText,
    guild: null as any,
    send: async (data: any) => {
      sentMessages.push(data);
      return {
        id: `msg_${Date.now()}_${Math.random()}`,
        pin: async () => {},
      };
    },
    permissionOverwrites: {
      edit: async (id: string, perms: any) => {
        return perms;
      },
    },
    setParent: async (catId: string) => {
      mockChannel.parentId = catId;
      return mockChannel;
    },
    setName: async (newName: string) => {
      mockChannel.name = newName;
      return mockChannel;
    },
    delete: async () => {
      channelDeleteCalled = true;
      throw new Error('CRITICAL VIOLATION: channel.delete() was called!');
    },
  };

  const channelMap: any = new Map<string, any>();
  channelMap.set(mockChannel.id, mockChannel);
  channelMap.first = () => mockChannel;
  channelMap.find = (fn: any) => {
    for (const val of channelMap.values()) {
      if (fn(val)) return val;
    }
    return undefined;
  };

  const mockGuild: any = {
    id: 'mock_guild_123',
    roles: {
      everyone: { id: 'mock_guild_123' },
    },
    channels: {
      cache: channelMap,
      create: async (data: any) => {
        mockChannel.name = data.name;
        mockChannel.id = `chan_${Date.now()}_created`;
        channelMap.set(mockChannel.id, mockChannel);
        return mockChannel;
      },
    },
  };
  mockChannel.guild = mockGuild;

  const mockGuildCache: any = new Map([['mock_guild_123', mockGuild]]);
  mockGuildCache.first = () => mockGuild;
  mockGuildCache.get = (id: string) => mockGuild;

  const mockClient: any = {
    user: { id: 'bot_exchange_id' },
    guilds: {
      cache: mockGuildCache,
    },
    channels: {
      cache: channelMap,
      fetch: async (id: string) => channelMap.get(id) || null,
    },
  };

  setGlobalDiscordClient(mockClient);

  try {
    console.log('--- SETUP: Seeding Test Catalog, Roles, Users & Central Wallets ---');
    await ensureExchangeDefaults();

    // Ensure roles
    await prisma.role.upsert({ where: { roleKey: 'exchanger' }, create: { roleKey: 'exchanger', name: 'Exchanger' }, update: {} });
    await prisma.role.upsert({ where: { roleKey: 'admin' }, create: { roleKey: 'admin', name: 'Admin' }, update: {} });
    await prisma.role.upsert({ where: { roleKey: 'staff' }, create: { roleKey: 'staff', name: 'Staff' }, update: {} });

    // Seed Buyer & Seller
    await prisma.user.upsert({
      where: { discordId: BUYER_ID },
      create: { discordId: BUYER_ID, username: 'p6_buyer', displayName: 'P6 Buyer', isActive: true },
      update: { isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: BUYER_ID, roleKey: 'exchanger' } },
      create: { userId: BUYER_ID, roleKey: 'exchanger' },
      update: {},
    });
    await prisma.exchangeKycRequest.upsert({
      where: { userId: BUYER_ID },
      create: { userId: BUYER_ID, status: 'APPROVED', approvedAt: new Date() },
      update: { status: 'APPROVED' },
    });
    await prisma.exchangeUserPermission.upsert({
      where: { userId: BUYER_ID },
      create: { userId: BUYER_ID, canCreateBuyOrder: true, canSubmitSellOffer: true },
      update: { canCreateBuyOrder: true, canSubmitSellOffer: true },
    });

    await prisma.user.upsert({
      where: { discordId: SELLER_ID },
      create: { discordId: SELLER_ID, username: 'p6_seller', displayName: 'P6 Seller', isActive: true },
      update: { isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: SELLER_ID, roleKey: 'exchanger' } },
      create: { userId: SELLER_ID, roleKey: 'exchanger' },
      update: {},
    });
    await prisma.exchangeKycRequest.upsert({
      where: { userId: SELLER_ID },
      create: { userId: SELLER_ID, status: 'APPROVED', approvedAt: new Date() },
      update: { status: 'APPROVED' },
    });
    await prisma.exchangeUserPermission.upsert({
      where: { userId: SELLER_ID },
      create: { userId: SELLER_ID, canCreateBuyOrder: true, canSubmitSellOffer: true },
      update: { canCreateBuyOrder: true, canSubmitSellOffer: true },
    });

    // Seed Admin
    await prisma.user.upsert({
      where: { discordId: ADMIN_ID },
      create: { discordId: ADMIN_ID, username: 'p6_admin', displayName: 'P6 Admin', isActive: true },
      update: { isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleKey: { userId: ADMIN_ID, roleKey: 'admin' } },
      create: { userId: ADMIN_ID, roleKey: 'admin' },
      update: {},
    });

    // Seed Buyer Wallet with $100.00
    await prisma.wallet.upsert({
      where: { userId: BUYER_ID },
      create: {
        userId: BUYER_ID,
        balanceUsd: 10000,
        reservedBalance: 0,
        frozenBalance: 0,
        isFrozen: false,
      },
      update: {
        balanceUsd: 10000,
        reservedBalance: 0,
        frozenBalance: 0,
        isFrozen: false,
      },
    });

    // Seed Seller Wallet with $0.00
    await prisma.wallet.upsert({
      where: { userId: SELLER_ID },
      create: {
        userId: SELLER_ID,
        balanceUsd: 0,
        reservedBalance: 0,
        frozenBalance: 0,
        isFrozen: false,
      },
      update: {
        balanceUsd: 0,
        reservedBalance: 0,
        frozenBalance: 0,
        isFrozen: false,
      },
    });

    // Get catalog seeds
    const game = await prisma.exchangeGame.findFirstOrThrow({ where: { isActive: true } });
    const currency = await prisma.exchangeCurrency.findFirstOrThrow({ where: { gameId: game.id, isActive: true } });
    const region = await prisma.exchangeRegion.findFirst({ where: { isActive: true } });
    const delivery = await prisma.exchangeDeliveryMethod.findFirstOrThrow({ where: { isActive: true } });

    console.log('\n--- TEST 1: Rule 1 — No Payment = No Discord Channel ---');
    // Create Buy Order
    const buyOrder = await prisma.exchangeBuyOrder.create({
      data: {
        orderCode: `BO-P6-${Date.now()}`,
        buyerUserId: BUYER_ID,
        buyerDiscordId: BUYER_ID,
        gameId: game.id,
        currencyId: currency.id,
        regionId: region ? region.id : null,
        pricePerUnitCents: 100, // $1.00
        unitLabelSnapshot: currency.unitLabel,
        unitMultiplierSnapshot: currency.unitMultiplier,
        minTradeBaseUnits: '100000',
        maxTradeBaseUnits: '1000000',
        totalCapacityBaseUnits: '1000000',
        reservedCapacityBaseUnits: '0',
        remainingCapacityBaseUnits: '1000000',
        filledCapacityBaseUnits: '0',
        acceptedDeliveryMethodIdsJson: JSON.stringify([delivery.id]),
        status: 'ACTIVE',
      },
    });

    // Submit Sell Offer
    const offer = await submitSellOffer({
      buyOrderId: buyOrder.id,
      sellerUserId: SELLER_ID,
      offeredAmountBaseUnits: '500000',
      deliveryMethodId: delivery.id,
    });

    // Accept Offer -> Creates Trade in AWAITING_PAYMENT
    const unpaidTrade = await acceptSellOffer({
      offerId: offer.id,
      buyerUserId: BUYER_ID,
    });
    assert(unpaidTrade.status === 'AWAITING_PAYMENT', 'Trade created in AWAITING_PAYMENT state');

    // Attempt to ensure Discord room on unpaid trade
    let rule1Passed = false;
    try {
      await ensureExchangeDiscordRoom(unpaidTrade.id, BUYER_ID);
    } catch (err: any) {
      if (err.statusCode === 400 || err.message.includes('TRADE_ESCROW_NOT_FUNDED') || err.message.includes('not confirmed')) {
        rule1Passed = true;
      }
    }
    assert(rule1Passed, 'Rule 1 Enforced: ensureExchangeDiscordRoom strictly refused on unpaid trade');

    const unpaidRoomCount = await prisma.exchangeDiscordRoom.count({ where: { tradeId: unpaidTrade.id } });
    assert(unpaidRoomCount === 0, 'No ExchangeDiscordRoom record created for unpaid trade');

    console.log('\n--- TEST 2: Funded Trade Room Creation & Idempotency ---');
    // Pay Trade with Buyer Wallet
    const payRes = await payTradeWithWallet(unpaidTrade.id, BUYER_ID);
    assert(payRes.escrow.status === 'RESERVED', 'Escrow successfully funded in RESERVED status');

    // The payment service auto-invokes ensureExchangeDiscordRoom, or we can invoke directly
    const room = await ensureExchangeDiscordRoom(unpaidTrade.id, BUYER_ID);
    assert(room.status === 'ACTIVE', 'Discord Room created in ACTIVE status');
    assert(room.buyerDiscordId === BUYER_ID, 'Room has correct buyerDiscordId');
    assert(room.sellerDiscordId === SELLER_ID, 'Room has correct sellerDiscordId');
    assert(room.channelName.startsWith('exchange-'), `Channel name formatted correctly: #${room.channelName}`);

    // Check Trade status transitioned to DELIVERY_IN_PROGRESS
    const fundedTrade = await prisma.exchangeTrade.findUniqueOrThrow({
      where: { id: unpaidTrade.id },
      include: { events: true },
    });
    assert(fundedTrade.status === 'DELIVERY_IN_PROGRESS', 'Trade transitioned to DELIVERY_IN_PROGRESS upon room creation');

    const createdEvent = fundedTrade.events.find((e) => e.eventType === 'DISCORD_ROOM_CREATED');
    assert(Boolean(createdEvent), 'ExchangeTradeEvent with DISCORD_ROOM_CREATED recorded in timeline');

    // Verify 13-field Welcome Embed
    const welcomeEmbed = buildTradeWelcomeEmbed(fundedTrade, 'https://g4x.online');
    const fields = welcomeEmbed.data.fields || [];
    assert(fields.length === 13, `Welcome embed contains exactly 13 fields (got ${fields.length})`);

    // Verify Zero Buyer KYC/PII in embed
    const embedJson = JSON.stringify(welcomeEmbed.data);
    assert(!embedJson.includes('p5_buyer@') && !embedJson.includes('passport') && !embedJson.includes('nationalId'), 'Welcome embed has ZERO Buyer KYC/PII leakage');

    // Verify Idempotency: repeated call returns existing room
    const roomSecondCall = await ensureExchangeDiscordRoom(unpaidTrade.id, BUYER_ID);
    assert(roomSecondCall.id === room.id, 'ensureExchangeDiscordRoom is idempotent: returns existing room');

    console.log('\n--- TEST 3: G4!exchange info Command ---');
    let infoReply: any = null;
    const infoMessage: any = {
      channel: { id: room.channelId },
      author: { id: BUYER_ID },
      reply: async (data: any) => {
        infoReply = data;
      },
    };
    await handleExchangeCommand(infoMessage, ['info']);
    assert(Boolean(infoReply && infoReply.embeds && infoReply.embeds.length > 0), 'G4!exchange info replies with overview embed');
    assert(Boolean(infoReply?.embeds?.[0]?.data?.title?.includes(fundedTrade.tradeCode)), 'Overview embed includes correct tradeCode');

    console.log('\n--- TEST 4: G4!exchange proof Command ---');
    let proofReply: any = null;
    const proofMessage: any = {
      channel: { id: room.channelId },
      author: { id: SELLER_ID },
      attachments: new Map([
        ['att_1', { url: 'https://cdn.discordapp.com/attachments/proof123.png' }],
      ]),
      reply: async (data: any) => {
        proofReply = data;
      },
    };
    await handleExchangeCommand(proofMessage, ['proof']);
    assert(Boolean(proofReply), 'G4!exchange proof acknowledged seller screenshot upload');

    const proofEvent = await prisma.exchangeTradeEvent.findFirst({
      where: { tradeId: fundedTrade.id, eventType: 'PROOF_SHARED_IN_DISCORD' },
    });
    assert(Boolean(proofEvent && (proofEvent.note?.includes('proof attachment') || proofEvent.metadataJson?.includes('proof123.png'))), 'Delivery proof screenshot logged in trade audit timeline');

    console.log('\n--- TEST 5: Rule 2 & 3 — G4!exchange confirm (Buyer-Only & Zero Wallet Mutation) ---');
    // Seller attempting confirm -> rejected
    let sellerConfirmFailed = false;
    const sellerConfirmMessage: any = {
      channel: { id: room.channelId },
      author: { id: SELLER_ID },
      reply: async (data: any) => {
        if (typeof data === 'string' && data.includes('Only the Trade Buyer')) {
          sellerConfirmFailed = true;
        }
      },
    };
    await handleExchangeCommand(sellerConfirmMessage, ['confirm']);
    assert(sellerConfirmFailed, 'Seller cannot execute G4!exchange confirm (Buyer-Only)');

    // Capture wallet balances before confirm
    const sellerWalletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: SELLER_ID } });
    const buyerWalletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: BUYER_ID } });

    // Buyer executes confirm
    let buyerConfirmSuccess = false;
    const buyerConfirmMessage: any = {
      channel: { id: room.channelId },
      author: { id: BUYER_ID },
      reply: async (data: any) => {
        if (typeof data === 'string' && (data.includes('Admin/Owner Final Review') || data.includes('Delivery Confirmed'))) {
          buyerConfirmSuccess = true;
        }
      },
    };
    await handleExchangeCommand(buyerConfirmMessage, ['confirm']);
    assert(buyerConfirmSuccess, 'Buyer G4!exchange confirm transitioned trade to AWAITING_FINAL_APPROVAL');

    const tradeAfterConfirm = await prisma.exchangeTrade.findUniqueOrThrow({
      where: { id: fundedTrade.id },
      include: { escrow: true },
    });
    assert(tradeAfterConfirm.status === 'AWAITING_FINAL_APPROVAL', 'Trade status is AWAITING_FINAL_APPROVAL');

    // CRITICAL: Strict Rule 2 & 3 Verification
    const sellerWalletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: SELLER_ID } });
    const buyerWalletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: BUYER_ID } });
    assert(
      sellerWalletAfter.balanceUsd === sellerWalletBefore.balanceUsd,
      'Rule 2 Enforced: Zero direct bot wallet mutation (Seller balance unchanged)'
    );
    assert(
      buyerWalletAfter.balanceUsd === buyerWalletBefore.balanceUsd,
      'Rule 2 Enforced: Zero direct bot wallet mutation (Buyer balance unchanged)'
    );
    assert(
      tradeAfterConfirm.escrow?.status === 'RESERVED',
      'Rule 3 Enforced: Buyer Confirmation != Fund Release (Escrow still RESERVED, awaits Web Admin Payout)'
    );

    console.log('\n--- TEST 6: G4!exchange dispute ---');
    let disputeSuccess = false;
    const disputeMessage: any = {
      channel: { id: room.channelId },
      author: { id: BUYER_ID },
      reply: async (data: any) => {
        if (data && data.embeds) {
          disputeSuccess = true;
        }
      },
    };
    await handleExchangeCommand(disputeMessage, ['dispute', 'In-game', 'trade', 'quantity', 'was', 'short']);
    assert(disputeSuccess, 'G4!exchange dispute posted dispute alert embed');

    const tradeAfterDispute = await prisma.exchangeTrade.findUniqueOrThrow({
      where: { id: fundedTrade.id },
      include: { escrow: true },
    });
    assert(tradeAfterDispute.status === 'DISPUTED', 'Trade transitioned to DISPUTED');
    assert(tradeAfterDispute.escrow?.status === 'FROZEN_DISPUTE', 'Escrow frozen to FROZEN_DISPUTE');

    const disputeEvent = await prisma.exchangeTradeEvent.findFirst({
      where: { tradeId: fundedTrade.id, eventType: 'DISPUTE_OPENED' },
    });
    assert(Boolean(disputeEvent), 'ExchangeTradeEvent with DISPUTE_OPENED logged in timeline');

    console.log('\n--- TEST 7: Rule 4 — G4!exchange close & Archival (NEVER Delete) ---');
    // Attempt close while DISPUTED -> rejected
    let closeBlocked = false;
    const adminCloseMessage: any = {
      channel: { id: room.channelId },
      author: { id: ADMIN_ID },
      member: {
        roles: {
          cache: new Map([['admin_role', { id: 'admin_role' }]]),
        },
      },
      reply: async (data: any) => {
        if (typeof data === 'string' && data.includes('Cannot close this room')) {
          closeBlocked = true;
        }
      },
    };
    await handleExchangeCommand(adminCloseMessage, ['close']);
    assert(closeBlocked, 'G4!exchange close blocked on non-terminal trade (DISPUTED)');

    // Set trade to COMPLETED
    await prisma.exchangeTrade.update({
      where: { id: fundedTrade.id },
      data: { status: 'COMPLETED' },
    });

    // Execute close as Admin
    let closeSuccess = false;
    adminCloseMessage.reply = async (data: any) => {
      if (typeof data === 'string' && data.includes('archived and locked')) {
        closeSuccess = true;
      }
    };
    await handleExchangeCommand(adminCloseMessage, ['close']);
    assert(closeSuccess, 'G4!exchange close archived completed trade channel');

    const archivedRoom = await prisma.exchangeDiscordRoom.findUniqueOrThrow({
      where: { tradeId: fundedTrade.id },
    });
    assert(archivedRoom.status === 'ARCHIVED', 'ExchangeDiscordRoom marked as ARCHIVED in DB');
    assert(Boolean(archivedRoom.archivedAt), 'Archived timestamp recorded');
    assert(!channelDeleteCalled, 'Rule 4 Enforced: channel.delete() was NEVER called');

    console.log('\n--- TEST 8: Configuration Get & Update with RBAC & Audit Log ---');
    const initialConfig = await getExchangeDiscordConfig();
    assert(initialConfig !== null && typeof initialConfig === 'object', 'getExchangeDiscordConfig returns config');

    const updatedConfig = await updateExchangeDiscordConfig({
      exchangeCategoryId: '123456789012345678',
      exchangeArchiveCategoryId: '123456789012345679',
      exchangeAlertChannelId: '123456789012345680',
      actorId: ADMIN_ID,
      reason: 'Automated test suite configuration update',
    });
    assert(updatedConfig.exchangeCategoryId === '123456789012345678', 'Category ID updated successfully');
    assert(updatedConfig.exchangeArchiveCategoryId === '123456789012345679', 'Archive Category ID updated successfully');
    assert(updatedConfig.exchangeAlertChannelId === '123456789012345680', 'Alert Channel ID updated successfully');

    const configAudit = await prisma.auditLog.findFirst({
      where: { action: 'DISCORD_SETTINGS_UPDATED' },
      orderBy: { createdAt: 'desc' },
    });
    assert(Boolean(configAudit && configAudit.actorId === ADMIN_ID), 'AuditLog entry written for Discord config update');

    console.log('\n======================================================');
    console.log(`PHASE 6 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error: any) {
    console.error('FATAL TEST ERROR:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runSuite();
