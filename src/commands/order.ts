/**
 * order.ts — Discord Commands for Boosting Order Management (Prefix: G4!order)
 * 
 * Commands:
 *  G4!order list [game]        — List available open orders for pre-signing
 *  G4!order view <orderId>     — View full status and requirements of an order
 *  G4!order create <game> <serviceId> <amountUsd> [type] [notes...] — Create and publish order (Authorized only)
 *  G4!order cancel <orderId> [reason...] — Cancel an active order (Authorized only)
 *  G4!order help               — Show order command usage
 */

import { Message, EmbedBuilder } from 'discord.js';
import prisma from '../database/db';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';
import { validateGameAndService, ensureOrderAcceptsOperations } from '../services/orderValidationService';
import { publishOrRefreshOrderCard } from '../services/orderDiscordService';
import { handleOrderCancellationChannel } from '../services/orderExecutionChannelService';
import {
  AdvertiserRank,
  isValidAdvertiserRank,
  calculateRankCommission,
  ADVERTISER_RANK_POLICY_VERSION,
} from '../services/advertiserRankService';
import { createExternalOrder } from '../services/platformOrderService';

export async function handleOrderCommand(message: Message, args: string[]): Promise<void> {
  const subCommand = args[0]?.toLowerCase();

  switch (subCommand) {
    case 'list':
      await handleOrderList(message, args.slice(1));
      break;

    case 'view':
      await handleOrderView(message, args.slice(1));
      break;

    case 'create':
    case 'adv-create':
      await handleOrderCreate(message, args.slice(1));
      break;

    case 'ext-create':
      await handleExternalOrderCreate(message, args.slice(1));
      break;

    case 'cancel':
      await handleOrderCancel(message, args.slice(1));
      break;

    case 'assign':
      await message.reply({
        content:
          'ℹ️ **Order Assignment**: Booster assignment is managed via the Web Portal or automated squad selection to prevent double-booking. Chat assignment is currently disabled.',
      });
      break;

    case 'verify-payment':
      await handleOrderVerifyPayment(message, args.slice(1));
      break;

    case 'complete':
      await message.reply({
        content:
          'ℹ️ **Order Completion**: Order completion requires verified proof submission and 7-stage release workflow (Phase 3.1). Please submit proofs via designated channels or the Web Portal.',
      });
      break;

    case 'help':
    default:
      await sendOrderHelp(message);
      break;
  }
}

/**
 * Lists available open orders for pre-signing.
 */
async function handleOrderList(message: Message, args: string[]): Promise<void> {
  const gameFilter = args[0]?.toLowerCase();

  try {
    const orders = await prisma.order.findMany({
      where: {
        status: 'open_presign',
        paymentStatus: 'verified',
        ...(gameFilter ? { gameSlug: gameFilter } : {}),
      },
      include: {
        game: true,
        service: true,
        requiredRoles: true,
        presigns: {
          where: { status: 'registered' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('🎮 Available Boost Orders')
      .setDescription(
        orders.length === 0
          ? 'No open orders are currently available for pre-signing.'
          : `Found **${orders.length}** open order(s). Use \`G4!order view <id>\` for details.`
      );

    for (const ord of orders) {
      const activeCount = ord.presigns.length;
      let slotsDesc = `Pre-signs: **${activeCount}**`;

      if (ord.requiredRoles && ord.requiredRoles.length > 0) {
        slotsDesc = ord.requiredRoles
          .map((r) => {
            const registered = ord.presigns.filter(
              (p) => p.registeredRole.toLowerCase() === r.roleName.toLowerCase()
            ).length;
            return `${r.roleName.toUpperCase()}: ${registered}/${r.quantity}`;
          })
          .join(' | ');
      }

      embed.addFields({
        name: `Order #${ord.id} • ${ord.orderRef}`,
        value:
          `**Game:** ${ord.game?.displayName || ord.gameSlug}\n` +
          `**Service:** ${ord.service?.displayName || `Service #${ord.serviceId}`}\n` +
          `**Mode:** ${ord.orderMode} (${ord.orderType})\n` +
          `**Slots:** ${slotsDesc}`,
        inline: false,
      });
    }

    embed.setFooter({ text: 'G4X Community • Order Board' });
    embed.setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (err: any) {
    console.error('[OrderCommand] Failed to list orders:', err);
    await message.reply({
      content: `❌ Failed to list orders: ${err?.message || 'Database error'}`,
    });
  }
}

/**
 * Views full details of a specific order.
 */
async function handleOrderView(message: Message, args: string[]): Promise<void> {
  const query = args[0];
  if (!query) {
    await message.reply({
      content: '❌ **Missing Order ID**: Usage: `G4!order view <orderId>`',
    });
    return;
  }

  const orderId = Number(query);
  const whereClause = !isNaN(orderId) ? { id: orderId } : { orderRef: query };

  try {
    const order = await prisma.order.findFirst({
      where: whereClause,
      include: {
        game: true,
        service: true,
        requiredRoles: true,
        presigns: {
          where: { status: 'registered' },
          include: { user: true },
        },
        assignments: {
          where: { status: 'assigned' },
          include: { user: true },
        },
        runs: true,
        platformAccount: true,
        financialSnapshot: true,
      },
    });

    if (!order) {
      await message.reply({
        content: `❌ Order \`${query}\` not found.`,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📋 Boost Order #${order.id} • ${order.orderRef}`)
      .setDescription(
        `**Game:** ${order.game.displayName}\n` +
          `**Service:** ${order.service.displayName}\n` +
          `**Status:** \`${order.status.toUpperCase()}\`\n` +
          `**Type & Mode:** ${order.orderType.toUpperCase()} (${order.orderMode})\n` +
          `**Runs:** ${order.runs.length} / ${order.quantity}`
      );

    // Commercial Source & Economics (Task 12)
    let sourceDisplay = 'G4X Direct (Community)';
    if (order.creatorType === 'advertiser' || order.advertiserId) {
      sourceDisplay = `Direct Advertiser (${order.advertiserRank || 'Unranked'})`;
    } else if (order.sourceWebsite) {
      const platformName = order.sourceWebsite.toUpperCase();
      const acctName =
        order.platformAccount?.displayName ||
        order.platformAccount?.accountRef ||
        (order.platformAccountId ? `Account #${order.platformAccountId}` : 'Unmapped');
      sourceDisplay = `External: ${platformName} [${acctName}]`;
    }

    let economicsDisplay = `• Gross Amount: **$${(order.grossAmountMinor / 100).toFixed(2)}**\n• Booster Pool: **$${(order.boosterPoolMinor / 100).toFixed(2)}**`;
    if (order.financialSnapshot) {
      const snap = order.financialSnapshot;
      const basis =
        snap.sourceAmountType === 'platform_net'
          ? 'Platform Net (Seller fee deducted)'
          : 'Gross Sale';
      const platformFee =
        snap.platformSaleCommissionMinor > 0
          ? `$${(snap.platformSaleCommissionMinor / 100).toFixed(2)}`
          : '$0.00';
      economicsDisplay += `\n• Input Basis: **${basis}**\n• Platform Seller Fee: **${platformFee}**`;
      if (snap.notes) {
        economicsDisplay += `\n• Economics Note: *${snap.notes}*`;
      }
    }

    embed.addFields({
      name: 'Commercial Source & Economics',
      value: `**Source Platform:** ${sourceDisplay}\n${economicsDisplay}`,
      inline: false,
    });

    if (order.requiredRoles && order.requiredRoles.length > 0) {
      const roleLines = order.requiredRoles.map((r) => {
        const pres = order.presigns.filter(
          (p) => p.registeredRole.toLowerCase() === r.roleName.toLowerCase()
        );
        const users = pres.map((p) => p.user?.displayName || p.user?.username || p.userId).join(', ');
        return `• **${r.roleName.toUpperCase()}:** ${pres.length}/${r.quantity}${users ? ` (${users})` : ''}`;
      });
      embed.addFields({
        name: 'Required Slots',
        value: roleLines.join('\n'),
        inline: false,
      });
    }

    if (order.notes) {
      const cleanNotes = order.notes.replace(/fee|price|commission|wallet|gross|payout/gi, '***').slice(0, 300);
      embed.addFields({
        name: 'Notes',
        value: cleanNotes,
        inline: false,
      });
    }

    embed.setFooter({ text: `G4X Community • Order #${order.id}` });
    embed.setTimestamp(order.publishedAt || order.createdAt);

    await message.reply({ embeds: [embed] });
  } catch (err: any) {
    console.error(`[OrderCommand] Failed to view order ${query}:`, err);
    await message.reply({
      content: `❌ Failed to view order: ${err?.message || 'Database error'}`,
    });
  }
}

/**
 * Creates and publishes a new order.
 * Authorized for Management (ORDER_CREATE_INTERNAL) or Advertisers (ORDER_CREATE_ADVERTISER).
 */
async function handleOrderCreate(message: Message, args: string[]): Promise<void> {
  const actorId = message.author.id;

  // 1. Authorization check
  const authInternal = await authorize(actorId, Permission.ORDER_CREATE_INTERNAL);
  const authAdv = await authorize(actorId, Permission.ORDER_CREATE_ADVERTISER);

  if (!authInternal.allowed && !authAdv.allowed) {
    await message.reply({
      content: '❌ **Permission Denied**: You do not have permission to create orders. Only authorized Advertisers and Management may create orders.',
    });
    return;
  }

  // 2. Parse arguments: <gameSlug> <serviceId> <amountUsd> [orderType] [...notes]
  const [gameSlug, serviceIdRaw, amountUsdRaw, orderTypeRaw, ...notesArr] = args;

  if (!gameSlug || !serviceIdRaw || !amountUsdRaw) {
    await message.reply({
      content:
        '❌ **Missing Arguments**.\nUsage: `G4!order create <gameSlug> <serviceId> <amountUsd> [orderType] [notes...]`\nExample: `G4!order create wow_midnight 1 50 group Fast M+ Run`',
    });
    return;
  }

  const serviceId = Number(serviceIdRaw);
  const amountUsd = Number(amountUsdRaw);
  if (isNaN(serviceId) || serviceId <= 0 || isNaN(amountUsd) || amountUsd <= 0) {
    await message.reply({
      content: '❌ Invalid serviceId or amountUsd. Both must be positive numbers.',
    });
    return;
  }

  const orderType = orderTypeRaw?.toLowerCase() || 'group';
  const notes = notesArr.join(' ').trim() || null;

  try {
    // 3. Validate game and service using existing domain validation service
    const { game, service } = await validateGameAndService(
      gameSlug,
      serviceId,
      serviceIdRaw ? undefined : undefined
    );

    const grossCents = Math.round(amountUsd * 100);
    if (!Number.isSafeInteger(grossCents) || grossCents <= 0) {
      await message.reply({
        content: '❌ Invalid order amount. Amount must be a positive integer in cents.',
      });
      return;
    }

    const orderRef = `ORD_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Determine if creator is advertiser
    const user = await prisma.user.findUnique({
      where: { discordId: actorId },
      include: { userRoles: true },
    });
    const isAdv = user?.userRoles?.some((r) => r.roleKey === 'advertiser') ?? false;

    let advRank: AdvertiserRank | null = null;
    let platformFeeMinor = 0;
    let boosterPoolMinor = grossCents;
    let rankCommissionBps: number | null = null;

    if (isAdv) {
      if (!user?.advertiserRank || !isValidAdvertiserRank(user.advertiserRank)) {
        await message.reply({
          content:
            '❌ **Unresolved Commercial Rank**: Advertiser does not have an approved commercial rank configured by management. Order creation is blocked until an administrator assigns an approved rank.',
        });
        return;
      }
      advRank = user.advertiserRank as AdvertiserRank;
      const calc = calculateRankCommission(grossCents, advRank);
      platformFeeMinor = calc.g4xFeeMinor;
      boosterPoolMinor = calc.remainingMinor;
      rankCommissionBps = calc.rankCommissionBasisPoints;
    }

    // 4. Create the authoritative Order in DB atomically with payment check and financial snapshot
    const order = await prisma.$transaction(async (tx) => {
      // Check if creator has sufficient available balance in WalletV2 for verified payment
      const wallet = await tx.walletV2.findUnique({
        where: { userId: actorId },
      });

      const hasSufficientWalletFunds = Boolean(wallet && wallet.availableCents >= grossCents);
      let paymentStatus = 'pending';
      let orderStatus = 'payment_pending';
      let paymentVerifiedBy: string | null = null;
      let paymentVerifiedAt: Date | null = null;

      if (hasSufficientWalletFunds && wallet) {
        const newAvailable = wallet.availableCents - grossCents;
        const newReserved = wallet.reservedCents + grossCents;

        await tx.walletV2.update({
          where: { userId: actorId },
          data: {
            availableCents: newAvailable,
            reservedCents: newReserved,
          },
        });

        await tx.ledgerEntryV2.create({
          data: {
            entryRef: `LEDGER_ORD_RES_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
            userId: actorId,
            amountCents: grossCents,
            entryType: 'ORDER_RESERVE',
            direction: 'DEBIT',
            balanceAfterAvailableCents: newAvailable,
            balanceAfterReservedCents: newReserved,
            description: `Authoritative funds reserved from available USD balance for Order #${orderRef}`,
            createdBy: actorId,
          },
        });

        paymentStatus = 'verified';
        orderStatus = 'open_presign';
        paymentVerifiedBy = actorId;
        paymentVerifiedAt = new Date();
      }

      const ord = await tx.order.create({
        data: {
          orderRef,
          gameSlug,
          serviceId,
          creatorId: actorId,
          creatorType: isAdv ? 'advertiser' : 'g4x',
          advertiserId: isAdv ? actorId : null,
          advertiserRank: advRank,
          rankCommissionBps,
          orderType,
          orderMode: service.serviceMode === 'pilot' ? 'pilot' : 'non_pilot',
          currency: 'USD',
          grossAmountMinor: grossCents,
          platformFeeMinor,
          advertiserFeeMinor: 0,
          boosterPoolMinor,
          paymentStatus,
          status: orderStatus,
          paymentVerifiedBy,
          paymentVerifiedAt,
          notes,
          runs: {
            create: [{ runNumber: 1, status: 'pending' }],
          },
          // Automatically attach default Mythic+ required roles for group WoW orders
          ...(service.gameSlug === 'wow_midnight' && orderType === 'group'
            ? {
                requiredRoles: {
                  create: [
                    { roleName: 'tank', quantity: 1 },
                    { roleName: 'healer', quantity: 1 },
                    { roleName: 'dps', quantity: 3 },
                  ],
                },
              }
            : {}),
        },
        include: {
          game: true,
          service: true,
          requiredRoles: true,
        },
      });

      // Persist authoritative rank snapshot at commercial commitment point
      if (isAdv && advRank && rankCommissionBps !== null) {
        await tx.orderFinancialSnapshot.create({
          data: {
            orderId: ord.id,
            sourcePlatform: 'advertiser',
            sourceAmountType: 'gross_sale',
            sourceAmountMinor: grossCents,
            grossSaleMinor: grossCents,
            platformOrderNetMinor: grossCents,
            externalNetBaseMinor: grossCents,
            g4xFeeRate: rankCommissionBps / 10000,
            g4xFeeMinor: platformFeeMinor,
            advertiserFeeMinor: 0,
            boosterPoolMinor,
            currency: 'USD',
            calculationStatus: 'provisional',
            policyVersion: ADVERTISER_RANK_POLICY_VERSION,
            advertiserId: actorId,
            advertiserRank: advRank,
            rankFeeBasisPoints: rankCommissionBps,
            remainingAmountMinor: boosterPoolMinor,
            snapshotTimestamp: new Date(),
          },
        });
      }

      return ord;
    });

    // 5. Card Publication: Only verified orders may be published for public claims
    if (order.paymentStatus === 'verified') {
      const pubResult = await publishOrRefreshOrderCard(message.client, order.id, {
        guildId: message.guild?.id,
      });
      let confirmationText = `✅ **Order Created and Funded Successfully!**\n• Order ID: **#${order.id}**\n• Reference: \`${order.orderRef}\`\n• Game: **${game.displayName}**\n• Service: **${service.displayName}**\n• Payment: **verified (wallet reserved)**\n• Status: **${order.status}**`;
      if (pubResult.success) {
        confirmationText += `\n📢 **Published to Orders Board** (Message ID: \`${pubResult.messageId}\`)`;
      } else {
        confirmationText += `\n⚠️ **Card Publication Warning**: ${pubResult.error || 'Configured orders channel not found'}`;
      }
      await message.reply({ content: confirmationText });
    } else {
      // Unpaid draft
      await message.reply({
        content: `⚠️ **Order Created in Pending Payment Status (Draft)**.\n• Order ID: **#${order.id}**\n• Reference: \`${order.orderRef}\`\n• Game: **${game.displayName}**\n• Service: **${service.displayName}**\n• Amount: **$${(grossCents / 100).toFixed(2)}**\n• Payment Status: **pending**\n• Order Status: **payment_pending**\n\n🔒 *Booster presign, claimability, and public publication are strictly blocked until funds are deposited and payment is authoritatively verified.*`,
      });
    }
  } catch (err: any) {
    console.error('[OrderCommand] Order creation failed:', err);
    await message.reply({
      content: `❌ **Order Creation Failed**: ${err?.message || err}`,
    });
  }
}

/**
 * Creates and publishes an externally sourced order (G2G, SkyCoach, Eldorado).
 * Authorized for Management (ORDER_CREATE_INTERNAL).
 */
async function handleExternalOrderCreate(message: Message, args: string[]): Promise<void> {
  const actorId = message.author.id;

  // Usage: G4!order ext-create <gameSlug> <serviceId> <amountUsd> <platform> [accountRef] [gross|net] [orderType] [notes...]
  const [gameSlug, serviceIdRaw, amountUsdRaw, platformRaw, accountRefRaw, basisRaw, orderTypeRaw, ...notesArr] = args;

  if (!gameSlug || !serviceIdRaw || !amountUsdRaw || !platformRaw) {
    await message.reply({
      content:
        '❌ **Missing Arguments**.\n' +
        'Usage: `G4!order ext-create <gameSlug> <serviceId> <amountUsd> <platform> [accountRef] [gross|net] [orderType] [notes...]`\n' +
        'Supported platforms: `g2g`, `skycoach`, `eldorado`\n' +
        'Example: `G4!order ext-create wow_midnight 1 50 g2g g2g_main gross group Fast M+ Run`',
    });
    return;
  }

  const serviceId = Number(serviceIdRaw);
  const amountUsd = Number(amountUsdRaw);
  if (isNaN(serviceId) || serviceId <= 0 || isNaN(amountUsd) || amountUsd <= 0) {
    await message.reply({
      content: '❌ Invalid serviceId or amountUsd. Both must be positive numbers.',
    });
    return;
  }

  const amountMinor = Math.round(amountUsd * 100);
  const sourcePlatform = platformRaw.toLowerCase();
  const platformAccountRef =
    accountRefRaw && !['gross', 'net', 'group', 'solo'].includes(accountRefRaw.toLowerCase())
      ? accountRefRaw.toLowerCase()
      : `${sourcePlatform}_main`;

  let sourceAmountType: 'gross_sale' | 'platform_net' = 'gross_sale';
  if (basisRaw?.toLowerCase() === 'net' || accountRefRaw?.toLowerCase() === 'net') {
    sourceAmountType = 'platform_net';
  }

  const orderType = orderTypeRaw?.toLowerCase() || 'group';
  const notes = notesArr.join(' ').trim() || null;

  try {
    const result = await createExternalOrder({
      gameSlug,
      serviceId,
      amountMinor,
      sourcePlatform,
      platformAccountRef,
      sourceAmountType,
      orderType,
      notes: notes || undefined,
      actorId,
    });

    const { order, snapshot, platformAccount } = result;

    const pubResult = await publishOrRefreshOrderCard(message.client, order.id, {
      guildId: message.guild?.id,
    });

    let confirmationText =
      `✅ **External Platform Order Created Successfully!**\n` +
      `• Order ID: **#${order.id}**\n` +
      `• Reference: \`${order.orderRef}\`\n` +
      `• Platform: **${platformAccount.platform.toUpperCase()}** (${platformAccount.displayName})\n` +
      `• Input Basis: **${sourceAmountType === 'platform_net' ? 'Platform Net (Seller fee deducted)' : 'Gross Sale'}**\n` +
      `• Gross Amount: **$${(order.grossAmountMinor / 100).toFixed(2)}**\n` +
      `• Platform Seller Fee: **$${(snapshot.platformSaleCommissionMinor / 100).toFixed(2)}**\n` +
      `• Booster Pool: **$${(order.boosterPoolMinor / 100).toFixed(2)}**\n` +
      `• Settlement Status: **Proceeds credited to pending release**\n` +
      `• Order Status: **${order.status}**`;

    if (pubResult.success) {
      confirmationText += `\n📢 **Published to Orders Board** (Message ID: \`${pubResult.messageId}\`)`;
    } else {
      confirmationText += `\n⚠️ **Card Publication Warning**: ${pubResult.error || 'Configured orders channel not found'}`;
    }

    await message.reply({ content: confirmationText });
  } catch (err: any) {
    console.error('[OrderCommand] External order creation failed:', err);
    await message.reply({
      content: `❌ **External Order Creation Failed**: ${err?.message || err}`,
    });
  }
}

/**
 * Authoritative payment verification command for managers and administrators.
 */
async function handleOrderVerifyPayment(message: Message, args: string[]): Promise<void> {
  const actorId = message.author.id;
  const auth = await authorize(actorId, Permission.ORDER_PAYMENT_VERIFY);
  if (!auth.allowed) {
    await message.reply({
      content: `❌ **Permission Denied**: ${auth.reason || 'You lack ORDER_PAYMENT_VERIFY permission to verify order payments.'}`,
    });
    return;
  }

  const orderId = Number(args[0]);
  if (isNaN(orderId) || orderId <= 0) {
    await message.reply({
      content: '❌ **Invalid Order ID**. Usage: `G4!order verify-payment <orderId> [receiptRef]`',
    });
    return;
  }

  const receiptRef = args.slice(1).join(' ').trim() || null;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    await message.reply({ content: `❌ Order #${orderId} not found.` });
    return;
  }

  if (order.paymentStatus === 'verified') {
    await message.reply({ content: `ℹ️ Order #${orderId} payment is already verified.` });
    return;
  }

  const updatedOrder = await prisma.$transaction(async (tx) => {
    const ord = await tx.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: 'verified',
        paymentVerifiedBy: actorId,
        paymentVerifiedAt: new Date(),
        status: order.status === 'payment_pending' || order.status === 'draft' ? 'open_presign' : order.status,
      },
      include: { game: true, service: true, requiredRoles: true },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'ORDER_PAYMENT_VERIFIED',
        entityType: 'Order',
        entityId: String(orderId),
        previousValues: JSON.stringify({ paymentStatus: order.paymentStatus, status: order.status }),
        newValues: JSON.stringify({ paymentStatus: 'verified', status: ord.status, receiptRef }),
        reason: receiptRef ? `Payment verified with reference: ${receiptRef}` : 'Payment verified by administrator',
        isSuccess: true,
      },
    });

    return ord;
  });

  // Publish to Discord now that payment has been authoritatively verified
  const pubResult = await publishOrRefreshOrderCard(message.client, updatedOrder.id, {
    guildId: message.guild?.id,
  });
  await message.reply({
    content: `✅ **Payment Verified for Order #${updatedOrder.id}!**\nStatus updated to \`${updatedOrder.status}\`.${pubResult.success ? '\n📢 Published to Orders Board.' : ''}`,
  });
}

/**
 * Cancels an order.
 * Authorized for Management or Order Owner (Permission.ORDER_CANCEL).
 */
async function handleOrderCancel(message: Message, args: string[]): Promise<void> {
  const actorId = message.author.id;
  const orderIdRaw = args[0];

  if (!orderIdRaw) {
    await message.reply({
      content: '❌ **Missing Order ID**. Usage: `G4!order cancel <orderId> [reason...]`',
    });
    return;
  }

  const orderId = Number(orderIdRaw);
  if (isNaN(orderId) || orderId <= 0) {
    await message.reply({ content: '❌ Invalid Order ID.' });
    return;
  }

  const reason = args.slice(1).join(' ').trim() || 'Cancelled via Discord command';

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      await message.reply({ content: `❌ Order #${orderId} not found.` });
      return;
    }

    // Check authorization
    const auth = await authorize(actorId, Permission.ORDER_CANCEL, {
      orderId: orderId,
      targetUserId: actorId,
    });

    if (!auth.allowed) {
      await message.reply({
        content: `❌ **Permission Denied**: ${auth.reason || 'You do not have permission to cancel this order.'}`,
      });
      return;
    }

    ensureOrderAcceptsOperations(order);

    // Cancel order and release reservations
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'cancelled' },
      });

      await tx.boosterReservation.updateMany({
        where: { orderId: order.id, status: 'active' },
        data: {
          status: 'cancelled',
          releaseReason: reason,
          releasedAt: new Date(),
        },
      });
    });

    // Update published Discord card
    publishOrRefreshOrderCard(message.client, order.id).catch((e) =>
      console.warn('[OrderCommand] Card refresh error after cancellation:', e)
    );

    // Lock private coordination channel if exists
    handleOrderCancellationChannel(order.id, reason, message.client).catch((e) =>
      console.warn('[OrderCommand] Channel lock error after cancellation:', e)
    );

    await message.reply({
      content: `✅ **Order #${order.id} Cancelled**: The order has been marked as cancelled and all active reservations released.`,
    });
  } catch (err: any) {
    console.error(`[OrderCommand] Failed to cancel order #${orderId}:`, err);
    await message.reply({
      content: `❌ **Cancellation Failed**: ${err?.message || err}`,
    });
  }
}

/**
 * Sends order help text in English.
 */
async function sendOrderHelp(message: Message): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🛡️ G4X Community — Boost Orders Commands')
    .setDescription(
      'Use the following prefix commands to manage and view boost orders:\n\n' +
        '• `G4!order list [game]`\n' +
        '  *List open orders available for pre-signing.*\n\n' +
        '• `G4!order view <orderId>`\n' +
        '  *View comprehensive details, source platform, economics, and required roles.*\n\n' +
        '• `G4!order create <gameSlug> <serviceId> <amountUsd> [type] [notes...]`\n' +
        '  *Create a new direct boost order. (Authorized Advertisers & Management).*\n\n' +
        '• `G4!order ext-create <gameSlug> <serviceId> <amountUsd> <platform> [accountRef] [gross|net] [type] [notes...]`\n' +
        '  *Create an externally sourced order with explicit source platform & fee policy snapshot (G2G, SkyCoach, Eldorado).*\n\n' +
        '• `G4!order cancel <orderId> [reason...]`\n' +
        '  *Cancel an open or active order. (Authorized Management & Order Owners only).*\n\n' +
        '• `G4!order help`\n' +
        '  *Display this help menu.*'
    )
    .setFooter({ text: 'G4X Community Bot' });

  await message.reply({ embeds: [embed] });
}
