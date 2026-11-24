/**
 * src/services/exchangeDiscordService.ts
 *
 * G4X In-Game Currency & Items Exchange — Phase 6:
 * Discord Exchange Portal (exchange_discord_rooms), Auto Private Trade Channels (exchange-{trade-id})
 * & Discord Lifecycle Management.
 *
 * Strict Non-Negotiable Rules:
 *  1. No Payment = No Discord Channel: assertTradeEscrowFunded(tradeId) must pass (RESERVED / FROZEN_DISPUTE).
 *  2. Zero Direct Wallet Mutation by Discord bot.
 *  3. Buyer Confirmation != Fund Release: G4!exchange confirm transitions to AWAITING_FINAL_APPROVAL.
 *  4. Archive Only (NEVER Delete): lock permissions + move to Archive category + mark ARCHIVED.
 *  5. Internal Trade ID as Source of Truth: resolve via exchange_discord_rooms.channelId -> tradeId.
 *  6. Zero Buyer KYC / PII exposure in Discord embeds or messages.
 */

import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
  CategoryChannel,
  Client,
} from 'discord.js';
import prisma from '../database/db';
import { ExchangeDiscordRoom, ExchangeTrade, ExchangeEscrow } from '@prisma/client';
import { getGlobalDiscordClient } from './orderDiscordService';
import { assertTradeEscrowFunded } from './exchangePaymentService';
import { logExchangeAudit } from './exchangeConfigService';
import { getSystemSetting, setSystemSetting } from './systemSettingService';
import { TradeValidationError } from './exchangeTradeService';

export function getPublicWebUrl(): string {
  const url =
    process.env.PUBLIC_URL ||
    process.env.WEB_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://g4x.online';
  return url.replace(/\/+$/, '');
}

/**
 * Resolves or auto-creates the "G4X Exchange Rooms" Discord category for active trade channels.
 */
export async function resolveExchangeCategory(guild: any): Promise<string | null> {
  const configuredId = await getSystemSetting(
    'exchange_category_id',
    process.env.DISCORD_EXCHANGE_CATEGORY_ID || ''
  );

  if (configuredId && guild.channels?.cache?.has(configuredId)) {
    return configuredId;
  }

  // Find existing by name
  if (guild.channels?.cache) {
    const existing = guild.channels.cache.find(
      (c: any) =>
        c.type === ChannelType.GuildCategory &&
        c.name.toLowerCase() === 'g4x exchange rooms'
    );
    if (existing) {
      await setSystemSetting('exchange_category_id', existing.id, 'SYSTEM', 'Active Exchange Category ID');
      return existing.id;
    }
  }

  // Auto-create category if missing
  if (guild.channels?.create) {
    try {
      const created = await guild.channels.create({
        name: 'G4X Exchange Rooms',
        type: ChannelType.GuildCategory,
      });
      await setSystemSetting('exchange_category_id', created.id, 'SYSTEM', 'Active Exchange Category ID');
      return created.id;
    } catch (err: any) {
      console.warn('[ExchangeDiscord] Failed to auto-create category "G4X Exchange Rooms":', err.message);
    }
  }

  return null;
}

/**
 * Resolves or auto-creates the "G4X Exchange Archive" Discord category for archived trade channels.
 */
export async function resolveExchangeArchiveCategory(guild: any): Promise<string | null> {
  const configuredId = await getSystemSetting(
    'exchange_archive_category_id',
    process.env.DISCORD_EXCHANGE_ARCHIVE_CATEGORY_ID || ''
  );

  if (configuredId && guild.channels?.cache?.has(configuredId)) {
    return configuredId;
  }

  // Find existing by name
  if (guild.channels?.cache) {
    const existing = guild.channels.cache.find(
      (c: any) =>
        c.type === ChannelType.GuildCategory &&
        c.name.toLowerCase() === 'g4x exchange archive'
    );
    if (existing) {
      await setSystemSetting('exchange_archive_category_id', existing.id, 'SYSTEM', 'Archive Exchange Category ID');
      return existing.id;
    }
  }

  // Auto-create category if missing
  if (guild.channels?.create) {
    try {
      const created = await guild.channels.create({
        name: 'G4X Exchange Archive',
        type: ChannelType.GuildCategory,
      });
      await setSystemSetting('exchange_archive_category_id', created.id, 'SYSTEM', 'Archive Exchange Category ID');
      return created.id;
    } catch (err: any) {
      console.warn('[ExchangeDiscord] Failed to auto-create category "G4X Exchange Archive":', err.message);
    }
  }

  return null;
}

/**
 * Builds the comprehensive 13-field Welcome Embed pinned in the private trade room.
 * GUARANTEE: ZERO Buyer KYC/PII (only public mention <@buyerDiscordId>).
 */
export function buildTradeWelcomeEmbed(trade: any, publicUrl: string): EmbedBuilder {
  const grossUsd = (trade.grossValueCents / 100).toFixed(2);
  const buyerFeeUsd = (trade.buyerFeeCents / 100).toFixed(2);
  const sellerFeeUsd = (trade.sellerFeeCents / 100).toFixed(2);
  const netSellerUsd = (trade.netSellerCents / 100).toFixed(2);
  const pricePerUnit = (trade.pricePerUnitCentsSnapshot / 100).toFixed(2);
  const buyerBps = (trade.buyerCommissionBpsSnapshot / 100).toFixed(2);
  const sellerBps = (trade.sellerCommissionBpsSnapshot / 100).toFixed(2);

  return new EmbedBuilder()
    .setColor(0x00c853) // Green
    .setTitle(`🤝 G4X Trade Room — ${trade.tradeCode}`)
    .setDescription(
      `Private coordination channel for Trade **${trade.tradeCode}**.\n` +
      `Funds are securely reserved in Escrow. Follow the instructions below to complete the trade.`
    )
    .addFields([
      { name: '1. Trade ID', value: `\`${trade.tradeCode}\``, inline: true },
      { name: '2. Buyer', value: `<@${trade.buyerDiscordId}>`, inline: true },
      { name: '3. Seller', value: `<@${trade.sellerDiscordId}>`, inline: true },
      { name: '4. Game', value: `${trade.game?.name || 'N/A'}`, inline: true },
      { name: '5. Currency', value: `${trade.currency?.name || 'N/A'}`, inline: true },
      { name: '6. Region', value: `${trade.region?.name || 'Global'}`, inline: true },
      {
        name: '7. Trade Amount',
        value: `**${trade.quantityBaseUnits}** base units (${trade.unitLabelSnapshot})`,
        inline: false,
      },
      {
        name: '8. Agreed Price',
        value: `**$${pricePerUnit}** per ${trade.unitLabelSnapshot} · Gross Total: **$${grossUsd}**`,
        inline: false,
      },
      {
        name: '9. Buyer Fee',
        value: `$${buyerFeeUsd} (${buyerBps}%)`,
        inline: true,
      },
      {
        name: '10. Seller Fee & Payout',
        value: `Fee: $${sellerFeeUsd} (${sellerBps}%) · Net Payout: **$${netSellerUsd}**`,
        inline: true,
      },
      {
        name: '11. Payment Status',
        value: '✅ **Payment Confirmed — Funds Reserved in Escrow**',
        inline: false,
      },
      {
        name: '12. Delivery Method',
        value: `📦 **${trade.deliveryMethod?.name || 'In-Game Delivery'}**`,
        inline: false,
      },
      {
        name: '13. Instructions & Quick Commands',
        value:
          `${trade.buyerInstructionsSnapshot ? `*Buyer Note:* ${trade.buyerInstructionsSnapshot}\n\n` : ''}` +
          `• \`G4!exchange info\` — Live trade breakdown\n` +
          `• \`G4!exchange proof\` — View delivery proof guidelines & share screenshots\n` +
          `• \`G4!exchange confirm\` — Buyer confirms goods received\n` +
          `• \`G4!exchange dispute [reason]\` — Open dispute and freeze funds\n\n` +
          `🔗 **[View on G4X Web Portal](${publicUrl}/exchange/trades/${trade.id})**`,
        inline: false,
      },
    ])
    .setFooter({ text: 'G4X Exchange Protected Escrow · Never share sensitive credentials.' })
    .setTimestamp();
}

/**
 * Builds the live Trade Overview embed for G4!exchange info.
 */
export function buildTradeInfoEmbed(trade: any, publicUrl: string): EmbedBuilder {
  const grossUsd = (trade.grossValueCents / 100).toFixed(2);
  const buyerFeeUsd = (trade.buyerFeeCents / 100).toFixed(2);
  const sellerFeeUsd = (trade.sellerFeeCents / 100).toFixed(2);
  const netSellerUsd = (trade.netSellerCents / 100).toFixed(2);

  return new EmbedBuilder()
    .setColor(0x2196f3) // Blue
    .setTitle(`📋 Trade Overview — ${trade.tradeCode}`)
    .addFields([
      { name: 'Trade Code', value: `\`${trade.tradeCode}\``, inline: true },
      { name: 'Trade Status', value: `\`${trade.status}\``, inline: true },
      { name: 'Escrow Status', value: `\`${trade.escrow?.status || 'N/A'}\``, inline: true },
      { name: 'Game / Currency', value: `${trade.game?.name || 'N/A'} / ${trade.currency?.name || 'N/A'}`, inline: true },
      { name: 'Region', value: `${trade.region?.name || 'Global'}`, inline: true },
      { name: 'Delivery Method', value: `${trade.deliveryMethod?.name || 'In-Game'}`, inline: true },
      { name: 'Quantity', value: `${trade.quantityBaseUnits} ${trade.unitLabelSnapshot}`, inline: true },
      { name: 'Gross Value', value: `$${grossUsd}`, inline: true },
      { name: 'Buyer Fee', value: `$${buyerFeeUsd}`, inline: true },
      { name: 'Seller Fee', value: `$${sellerFeeUsd}`, inline: true },
      { name: 'Net Seller Payout', value: `**$${netSellerUsd}**`, inline: true },
      { name: 'Portal Link', value: `[Open Trade on Web](${publicUrl}/exchange/trades/${trade.id})`, inline: false },
    ])
    .setTimestamp();
}

/**
 * Builds the Dispute Alert embed.
 */
export function buildTradeDisputeEmbed(
  trade: any,
  reason: string,
  actorDiscordId: string,
  publicUrl: string
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xd32f2f) // Red
    .setTitle(`🚨 TRADE DISPUTED — Funds Frozen in Escrow`)
    .setDescription(
      `Trade **${trade.tradeCode}** has been marked as **DISPUTED** by <@${actorDiscordId}>.\n` +
      `**Reason:** ${reason}\n\n` +
      `⚠️ **Escrow is now FROZEN (\`FROZEN_DISPUTE\`). No funds will be released or refunded until Staff/Admin resolution.**\n` +
      `Please do not proceed with any in-game item or currency transfer until an admin reviews this case.`
    )
    .addFields([
      { name: 'Trade Code', value: `\`${trade.tradeCode}\``, inline: true },
      { name: 'Opened By', value: `<@${actorDiscordId}>`, inline: true },
      { name: 'Web Portal', value: `[Review Case](${publicUrl}/exchange/trades/${trade.id})`, inline: true },
    ])
    .setFooter({ text: 'G4X Dispute Arbitration' })
    .setTimestamp();
}

/**
 * Builds the Archival notification embed.
 */
export function buildTradeArchivedEmbed(
  trade: any,
  reason: string,
  actorDiscordId: string,
  publicUrl: string
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x757575) // Gray
    .setTitle(`🔒 Trade Room Archived`)
    .setDescription(
      `This room has been archived and locked.\n` +
      `**Trade:** ${trade.tradeCode}\n` +
      `**Archived By:** <@${actorDiscordId}>\n` +
      `**Reason:** ${reason}\n\n` +
      `All message history and submitted proofs have been preserved for audit.\n` +
      `🔗 [View Trade on Web Portal](${publicUrl}/exchange/trades/${trade.id})`
    )
    .setTimestamp();
}

/**
 * Ensures an active private Discord trade room exists for a funded trade.
 * Enforces Rule 1 (assertTradeEscrowFunded) and idempotency.
 */
export async function ensureExchangeDiscordRoom(
  tradeId: string,
  actorDiscordId: string = 'SYSTEM'
): Promise<ExchangeDiscordRoom> {
  // 1. Escrow Assertion: Throws 400 if trade is unpaid, cancelled, or escrow is not RESERVED / FROZEN_DISPUTE
  await assertTradeEscrowFunded(tradeId);

  // 2. Fetch full Trade details with snapshots and existing room
  const trade = await prisma.exchangeTrade.findUnique({
    where: { id: tradeId },
    include: {
      game: true,
      currency: true,
      region: true,
      deliveryMethod: true,
      escrow: true,
      discordRoom: true,
    },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  const client = getGlobalDiscordClient();
  const publicUrl = getPublicWebUrl();

  // 3. Idempotency Check: if room exists in DB, check Discord channel validity
  if (trade.discordRoom) {
    const existingRoom = trade.discordRoom;
    if (client) {
      try {
        const chan =
          client.channels?.cache?.get(existingRoom.channelId) ||
          (await client.channels?.fetch?.(existingRoom.channelId).catch(() => null));
        if (chan) {
          return existingRoom;
        }
      } catch {
        // Missing in Discord, proceed to recreate
      }
    } else {
      return existingRoom;
    }
  }

  // 4. Resolve Guild
  let guild: any = null;
  if (client?.guilds?.cache) {
    const configuredGuildId = process.env.DISCORD_GUILD_ID;
    guild = configuredGuildId
      ? client.guilds.cache.get(configuredGuildId)
      : client.guilds.cache.first();
  }

  const slug = `exchange-${trade.tradeCode.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
  const guildId = guild?.id || process.env.DISCORD_GUILD_ID || 'mock_guild';
  let categoryId: string | null = null;
  let createdChannel: any = null;
  let welcomeMessageId: string | null = null;

  if (guild) {
    categoryId = await resolveExchangeCategory(guild);
    const everyoneRole = guild.roles?.everyone?.id || guild.id;
    const botUserId = client.user?.id;

    const permissionOverwrites: any[] = [
      {
        id: everyoneRole,
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      },
      {
        id: trade.buyerDiscordId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: trade.sellerDiscordId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
    ];

    if (botUserId) {
      permissionOverwrites.push({
        id: botUserId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }

    const staffRoleIds = [
      process.env.ROLE_ADMIN,
      process.env.ROLE_OWNER,
      process.env.ROLE_STAFF,
      process.env.ROLE_MANAGER,
    ].filter(Boolean) as string[];

    for (const rId of staffRoleIds) {
      permissionOverwrites.push({
        id: rId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }

    if (guild.channels?.create) {
      createdChannel = await guild.channels.create({
        name: slug,
        type: ChannelType.GuildText,
        parent: categoryId || undefined,
        permissionOverwrites,
        topic: `G4X Trade Room — ${trade.tradeCode} | Buyer: <@${trade.buyerDiscordId}> | Seller: <@${trade.sellerDiscordId}>`,
      });
    }
  }

  const channelId = createdChannel?.id || `chan_${trade.id}`;
  const channelName = createdChannel?.name || slug;
  const channelUrl = `https://discord.com/channels/${guildId}/${channelId}`;

  // 5. Send Welcome Embed with 13 required fields (Pinned)
  const welcomeEmbed = buildTradeWelcomeEmbed(trade, publicUrl);
  if (createdChannel?.send) {
    try {
      const msg = await createdChannel.send({
        content: `👋 <@${trade.buyerDiscordId}> <@${trade.sellerDiscordId}> Welcome to your private G4X Exchange trade room!`,
        embeds: [welcomeEmbed],
      });
      welcomeMessageId = msg?.id || null;
      if (typeof msg?.pin === 'function') {
        await msg.pin().catch(() => {});
      }
    } catch (err: any) {
      console.warn('[ExchangeDiscord] Failed to send/pin welcome message:', err.message);
    }
  }

  // 6. DB Upsert
  const room = await prisma.exchangeDiscordRoom.upsert({
    where: { tradeId: trade.id },
    create: {
      tradeId: trade.id,
      guildId,
      channelId,
      channelName,
      channelUrl,
      categoryId,
      welcomeMessageId,
      status: 'ACTIVE',
      buyerDiscordId: trade.buyerDiscordId,
      sellerDiscordId: trade.sellerDiscordId,
    },
    update: {
      channelId,
      channelName,
      channelUrl,
      categoryId,
      welcomeMessageId,
      status: 'ACTIVE',
      archivedAt: null,
      archivedByDiscordId: null,
      archiveReason: null,
    },
  });

  // 7. Update Trade Status to DELIVERY_IN_PROGRESS if currently PAYMENT_CONFIRMED
  if (trade.status === 'PAYMENT_CONFIRMED') {
    await prisma.exchangeTrade.update({
      where: { id: trade.id },
      data: { status: 'DELIVERY_IN_PROGRESS' },
    });
  }

  // 8. Event Timeline
  await prisma.exchangeTradeEvent.create({
    data: {
      tradeId: trade.id,
      eventType: 'DISCORD_ROOM_CREATED',
      actorDiscordId,
      actorRole: 'SYSTEM',
      fromStatus: trade.status,
      toStatus: trade.status === 'PAYMENT_CONFIRMED' ? 'DELIVERY_IN_PROGRESS' : trade.status,
      note: `Discord trade room created: #${channelName}`,
      metadataJson: JSON.stringify({
        channelId,
        channelName,
        channelUrl,
        guildId,
      }),
    },
  });

  // 9. Audit Log
  await logExchangeAudit({
    actorId: actorDiscordId,
    action: 'DISCORD_ROOM_CREATED',
    entityType: 'ExchangeDiscordRoom',
    entityId: room.id,
    newValues: {
      channelId,
      channelName,
      status: 'ACTIVE',
      tradeId: trade.id,
    },
    reason: 'Escrow funded; created private Discord trade coordination room.',
  });

  return room;
}

/**
 * Archives an Exchange Discord Room.
 * CRITICAL RULE 4: NEVER delete the channel. Locks permissions, moves to Archive category, and logs ARCHIVED.
 */
export async function archiveExchangeDiscordRoom(
  tradeId: string,
  actorDiscordId: string,
  reason: string
): Promise<ExchangeDiscordRoom> {
  const room = await prisma.exchangeDiscordRoom.findUnique({
    where: { tradeId },
    include: { trade: true },
  });

  if (!room) {
    throw new TradeValidationError('Exchange Discord room not found for this trade', 404);
  }

  if (room.status === 'ARCHIVED') {
    return room;
  }

  const client = getGlobalDiscordClient();
  const publicUrl = getPublicWebUrl();
  let archiveCategoryId = room.archiveCategoryId;

  if (client) {
    try {
      const channel =
        client.channels?.cache?.get(room.channelId) ||
        (await client.channels?.fetch?.(room.channelId).catch(() => null));

      if (channel) {
        const guild = channel.guild;
        if (guild) {
          archiveCategoryId = await resolveExchangeArchiveCategory(guild);
        }

        // Lock permissions for buyer & seller
        if (typeof channel.permissionOverwrites?.edit === 'function') {
          await channel.permissionOverwrites
            .edit(room.buyerDiscordId, {
              SendMessages: false,
              AddReactions: false,
            })
            .catch(() => {});
          await channel.permissionOverwrites
            .edit(room.sellerDiscordId, {
              SendMessages: false,
              AddReactions: false,
            })
            .catch(() => {});
        }

        // Move to archive category
        if (archiveCategoryId && typeof channel.setParent === 'function') {
          await channel.setParent(archiveCategoryId, { lockPermissions: false }).catch(() => {});
        }

        // Rename channel with archived- prefix (max 100 chars)
        const currentName = channel.name.replace(/^archived-/, '');
        const newSlug = `archived-${currentName}`.slice(0, 100);
        if (typeof channel.setName === 'function') {
          await channel.setName(newSlug).catch(() => {});
        }

        // Send archival notification embed (NEVER delete channel)
        if (typeof channel.send === 'function') {
          const archiveEmbed = buildTradeArchivedEmbed(
            room.trade,
            reason,
            actorDiscordId,
            publicUrl
          );
          await channel.send({ embeds: [archiveEmbed] }).catch(() => {});
        }
      }
    } catch (err: any) {
      console.warn(`[ExchangeDiscord] Archival Discord API error for trade ${tradeId}:`, err.message);
    }
  }

  // Update DB
  const updatedRoom = await prisma.exchangeDiscordRoom.update({
    where: { id: room.id },
    data: {
      status: 'ARCHIVED',
      archiveCategoryId,
      archivedAt: new Date(),
      archivedByDiscordId: actorDiscordId,
      archiveReason: reason,
    },
  });

  // Append Trade Event
  await prisma.exchangeTradeEvent.create({
    data: {
      tradeId,
      eventType: 'DISCORD_ROOM_ARCHIVED',
      actorDiscordId,
      actorRole: 'STAFF',
      fromStatus: room.trade?.status,
      toStatus: room.trade?.status,
      note: `Discord trade room archived: ${reason}`,
      metadataJson: JSON.stringify({
        channelId: room.channelId,
        archiveCategoryId,
        reason,
      }),
    },
  });

  // Audit Log
  await logExchangeAudit({
    actorId: actorDiscordId,
    action: 'DISCORD_ROOM_ARCHIVED',
    entityType: 'ExchangeDiscordRoom',
    entityId: room.id,
    previousValues: { status: room.status },
    newValues: { status: 'ARCHIVED', archiveReason: reason },
    reason,
  });

  return updatedRoom;
}

/**
 * Retrieves Discord Portal Settings from system settings.
 */
export async function getExchangeDiscordConfig(): Promise<{
  exchangeCategoryId: string;
  exchangeArchiveCategoryId: string;
  exchangeAlertChannelId: string;
}> {
  const [exchangeCategoryId, exchangeArchiveCategoryId, exchangeAlertChannelId] =
    await Promise.all([
      getSystemSetting('exchange_category_id', process.env.DISCORD_EXCHANGE_CATEGORY_ID || ''),
      getSystemSetting('exchange_archive_category_id', process.env.DISCORD_EXCHANGE_ARCHIVE_CATEGORY_ID || ''),
      getSystemSetting('exchange_alert_channel_id', process.env.DISCORD_EXCHANGE_ALERT_CHANNEL_ID || ''),
    ]);

  return {
    exchangeCategoryId,
    exchangeArchiveCategoryId,
    exchangeAlertChannelId,
  };
}

/**
 * Updates Discord Portal Settings (Owner only).
 */
export async function updateExchangeDiscordConfig(params: {
  exchangeCategoryId?: string;
  exchangeArchiveCategoryId?: string;
  exchangeAlertChannelId?: string;
  actorId?: string;
  reason?: string;
}): Promise<{
  exchangeCategoryId: string;
  exchangeArchiveCategoryId: string;
  exchangeAlertChannelId: string;
}> {
  const {
    exchangeCategoryId,
    exchangeArchiveCategoryId,
    exchangeAlertChannelId,
    actorId = 'SYSTEM',
    reason = 'Owner updated Exchange Discord Settings',
  } = params;

  const current = await getExchangeDiscordConfig();

  if (exchangeCategoryId !== undefined) {
    await setSystemSetting(
      'exchange_category_id',
      exchangeCategoryId.trim(),
      actorId,
      'Active Exchange Trade Category ID'
    );
  }

  if (exchangeArchiveCategoryId !== undefined) {
    await setSystemSetting(
      'exchange_archive_category_id',
      exchangeArchiveCategoryId.trim(),
      actorId,
      'Archive Exchange Trade Category ID'
    );
  }

  if (exchangeAlertChannelId !== undefined) {
    await setSystemSetting(
      'exchange_alert_channel_id',
      exchangeAlertChannelId.trim(),
      actorId,
      'Exchange Staff & Dispute Alert Channel ID'
    );
  }

  const updated = await getExchangeDiscordConfig();

  await logExchangeAudit({
    actorId,
    action: 'DISCORD_SETTINGS_UPDATED',
    entityType: 'ExchangeDiscordConfig',
    entityId: 'global',
    previousValues: current,
    newValues: updated,
    reason,
  });

  return updated;
}
