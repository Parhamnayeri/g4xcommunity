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

    case 'cancel':
      await handleOrderCancel(message, args.slice(1));
      break;

    case 'assign':
      await message.reply({
        content:
          'ℹ️ **Order Assignment**: Booster assignment is managed via the Web Portal or automated squad selection to prevent double-booking. Chat assignment is currently disabled.',
      });
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
    const orderRef = `ORD_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Determine if creator is advertiser
    const user = await prisma.user.findUnique({
      where: { discordId: actorId },
      include: { userRoles: true },
    });
    const isAdv = user?.userRoles?.some((r) => r.roleKey === 'advertiser') ?? false;

    // 4. Create the authoritative Order in DB
    const order = await prisma.order.create({
      data: {
        orderRef,
        gameSlug,
        serviceId,
        creatorId: actorId,
        creatorType: isAdv ? 'advertiser' : 'g4x',
        advertiserId: isAdv ? actorId : null,
        orderType,
        orderMode: service.serviceMode === 'pilot' ? 'pilot' : 'non_pilot',
        currency: 'USD',
        grossAmountMinor: grossCents,
        boosterPoolMinor: grossCents,
        paymentStatus: 'verified',
        status: 'open_presign',
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

    // 5. Automatically publish real order card to Discord
    const pubResult = await publishOrRefreshOrderCard(message.client, order.id, message.guild?.id);

    let confirmationText = `✅ **Order Created Successfully!**\n• Order ID: **#${order.id}**\n• Reference: \`${order.orderRef}\`\n• Game: **${game.displayName}**\n• Service: **${service.displayName}**\n• Status: **${order.status}**`;
    if (pubResult.success) {
      confirmationText += `\n📢 **Published to Orders Board** (Message ID: \`${pubResult.messageId}\`)`;
    } else {
      confirmationText += `\n⚠️ **Card Publication Warning**: ${pubResult.error || 'Configured orders channel not found'}`;
    }

    await message.reply({ content: confirmationText });
  } catch (err: any) {
    console.error('[OrderCommand] Order creation failed:', err);
    await message.reply({
      content: `❌ **Order Creation Failed**: ${err?.message || err}`,
    });
  }
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
        '  *View comprehensive details, required roles, and pre-sign status.*\n\n' +
        '• `G4!order create <gameSlug> <serviceId> <amountUsd> [type] [notes...]`\n' +
        '  *Create a new boost order and publish it to the Discord orders board. (Authorized Advertisers & Management only).*\n\n' +
        '• `G4!order cancel <orderId> [reason...]`\n' +
        '  *Cancel an open or active order. (Authorized Management & Order Owners only).*\n\n' +
        '• `G4!order help`\n' +
        '  *Display this help menu.*'
    )
    .setFooter({ text: 'G4X Community Bot' });

  await message.reply({ embeds: [embed] });
}
