/**
 * orderExecutionChannelService.ts — Private Discord Order Coordination Channels
 *
 * G4X Community — Phase 2 Completion: Private Discord Order Channels
 * Stack: Node.js, TypeScript, Discord.js v14, Prisma, SQLite
 *
 * Features:
 *  - Automated creation of private coordination channels (order-<id>) upon booster assignment
 *  - Strict role-based & user-level permission overwrites:
 *      * Deny @everyone
 *      * Allow assigned Boosters, Staff, Admin, Owner, and Order Advertiser/Customer
 *      * Exclude presign-only candidates who were not assigned
 *  - Persistent tracking in existing OrderChannel model (channelType: 'execution', status: 'active')
 *  - Idempotency & duplicate prevention backed by SQLite partial unique index
 *  - Missing / deleted Discord channel recovery
 *  - Safe participant replacement & roster permission updates
 *  - Lifecycle handling: run completion, proof submission, staff review, dispute preservation
 *  - Retention & archival blocking when unresolved disputes or evidence preservation is active
 *  - Zero financial wallet or ledger mutations
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
  CategoryChannel,
} from 'discord.js';
import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';

export interface OrderExecutionChannelResult {
  success: boolean;
  channelId?: string;
  guildId?: string;
  isNew?: boolean;
  channel?: any;
  error?: string;
}

export interface ArchiveResult {
  success: boolean;
  orderId: number;
  channelId?: string;
  archivedAt?: Date;
  error?: string;
}

/**
 * Derives the short mode slug for Discord order execution channel naming.
 * Rules:
 *  1. Service is Mythic+ (e.g. mythic_plus, mythicplus) -> mythicplus
 *  2. Order mode is Pilot -> pilot
 *  3. Otherwise -> selfplay
 */
export function deriveOrderChannelModeSlug(order: {
  service?: { serviceKey?: string; displayName?: string } | null;
  serviceKey?: string;
  orderMode?: string;
}): string {
  const serviceKey = (order.service?.serviceKey || order.serviceKey || '').toLowerCase();
  const serviceName = (order.service?.displayName || '').toLowerCase();

  if (
    serviceKey.includes('mythic_plus') ||
    serviceKey.includes('mythicplus') ||
    serviceKey.includes('mythic+') ||
    serviceName.includes('mythic+') ||
    serviceName.includes('mythic plus')
  ) {
    return 'mythicplus';
  }

  const mode = (order.orderMode || '').toLowerCase();
  if (mode === 'pilot') {
    return 'pilot';
  }

  return 'selfplay';
}

/**
 * Builds the canonical Discord execution channel name.
 * Format: order-${order.id}-${modeSlug}
 * Truncates safely if exceeds 100 characters while keeping prefix and slug.
 */
export function buildOrderExecutionChannelName(order: {
  id: number;
  service?: { serviceKey?: string; displayName?: string } | null;
  serviceKey?: string;
  orderMode?: string;
}): string {
  const modeSlug = deriveOrderChannelModeSlug(order);
  const rawName = `order-${order.id}-${modeSlug}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (rawName.length <= 100) {
    return rawName;
  }
  const prefix = `order-${order.id}-`;
  const maxSlugLen = 100 - prefix.length;
  return `${prefix}${modeSlug.slice(0, Math.max(0, maxSlugLen))}`.slice(0, 100);
}

/**
 * Resolves the Discord guild to use for order channels.
 */
export function resolveExecutionGuild(client: any, guildId?: string): any {
  if (!client) return null;
  const targetGuildId = guildId || process.env.DISCORD_GUILD_ID;
  if (targetGuildId && client.guilds?.cache) {
    const guild = client.guilds.cache.get(targetGuildId);
    if (guild) return guild;
  }
  if (client.guilds?.cache) {
    if (typeof client.guilds.cache.first === 'function') {
      return client.guilds.cache.first();
    }
    if (typeof client.guilds.cache.values === 'function') {
      return client.guilds.cache.values().next().value;
    }
  }
  return null;
}

/**
 * Resolves or creates the parent category for active coordination channels.
 */
export async function resolveOrCreateExecutionCategory(guild: any): Promise<any> {
  if (!guild) return null;

  const envCategoryId =
    process.env.CATEGORY_ACTIVE_ORDERS ||
    process.env.CATEGORY_ORDERS ||
    process.env.CATEGORY_EXECUTION_ORDERS;

  if (envCategoryId && guild.channels?.cache) {
    const category = guild.channels.cache.get(envCategoryId);
    if (category && category.type === ChannelType.GuildCategory) {
      return category;
    }
  }

  // Search by standard category name
  if (guild.channels?.cache) {
    let existing: any = null;
    if (typeof guild.channels.cache.find === 'function') {
      existing = guild.channels.cache.find(
        (c: any) =>
          c.type === ChannelType.GuildCategory &&
          (c.name === 'ACTIVE ORDERS' || c.name === 'ORDER COORDINATION' || c.name === 'ACTIVE BOOSTS')
      );
    } else if (typeof guild.channels.cache.values === 'function') {
      for (const c of guild.channels.cache.values()) {
        if (
          c.type === ChannelType.GuildCategory &&
          (c.name === 'ACTIVE ORDERS' || c.name === 'ORDER COORDINATION' || c.name === 'ACTIVE BOOSTS')
        ) {
          existing = c;
          break;
        }
      }
    }
    if (existing) return existing;
  }

  // Create category if bot has ManageChannels
  if (typeof guild.channels?.create === 'function') {
    try {
      const everyoneRole = guild.roles?.everyone?.id || guild.id;
      const category = await guild.channels.create({
        name: 'ACTIVE ORDERS',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: everyoneRole,
            deny: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      });
      return category;
    } catch (err: any) {
      console.warn('[OrderExecutionChannel] Could not create ACTIVE ORDERS category:', err?.message || err);
    }
  }

  return null;
}

/**
 * Constructs the standard permission overwrites for an order coordination channel.
 */
export function buildExecutionChannelOverwrites(
  guild: any,
  order: any,
  assignedUserIds: string[],
  botUserId?: string
): any[] {
  const everyoneId = guild.roles?.everyone?.id || guild.id;
  const overwrites: any[] = [
    // 1. Strictly deny @everyone
    {
      id: everyoneId,
      deny: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  // 2. Allow bot self
  if (botUserId) {
    overwrites.push({
      id: botUserId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageChannels,
      ],
    });
  }

  // 3. Allow Staff / Admin / Manager / Owner roles
  const staffRoleIds = [
    process.env.ROLE_STAFF,
    process.env.ROLE_ADMIN,
    process.env.ROLE_MANAGER,
    process.env.ROLE_OWNER,
  ].filter(Boolean) as string[];

  for (const roleId of staffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }

  // 4. Allow each actively assigned booster
  for (const userId of assignedUserIds) {
    overwrites.push({
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }

  // 5. Allow order advertiser if defined and distinct
  if (order.advertiserId && !assignedUserIds.includes(order.advertiserId)) {
    overwrites.push({
      id: order.advertiserId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }

  // 6. Allow order customer if defined and distinct
  if (
    order.customerId &&
    order.customerId !== order.advertiserId &&
    !assignedUserIds.includes(order.customerId)
  ) {
    overwrites.push({
      id: order.customerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }

  // 7. Allow order creator if defined, distinct and not platform
  if (
    order.creatorId &&
    order.creatorId !== order.advertiserId &&
    order.creatorId !== order.customerId &&
    !assignedUserIds.includes(order.creatorId) &&
    order.creatorType !== 'g4x'
  ) {
    overwrites.push({
      id: order.creatorId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }

  return overwrites;
}

/**
 * Generates the English coordination summary embed and action buttons for the channel.
 */
export function buildExecutionChannelSummary(order: any, activeAssignments: any[]): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const gameName = order.game?.displayName || order.gameSlug;
  const serviceName = order.service?.displayName || `Service #${order.serviceId}`;

  const boosterList =
    activeAssignments.length > 0
      ? activeAssignments
          .map((a) => `• <@${a.userId}> — **${(a.assignedRole || 'booster').toUpperCase()}**`)
          .join('\n')
      : '*No boosters currently assigned.*';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`⚔️ Boost Order Coordination — #${order.id} (${order.orderRef})`)
    .setDescription(
      `Welcome to the private coordination channel for **Order #${order.id}**.\n` +
        `This channel is accessible only to assigned Boosters, authorized Staff, and management.`
    )
    .addFields(
      { name: '🎮 Game', value: gameName, inline: true },
      { name: '🛡️ Service', value: serviceName, inline: true },
      { name: '📊 Status', value: `\`${order.status.toUpperCase()}\``, inline: true },
      { name: '👥 Assigned Boosters', value: boosterList, inline: false }
    );

  if (order.runs && order.runs.length > 0) {
    embed.addFields({
      name: '🏃 Runs Required',
      value: `${order.runs.length} Run(s) — Quantity: ${order.quantity || 1}`,
      inline: true,
    });
  }

  if (order.notes) {
    embed.addFields({ name: '📝 Operational Notes', value: order.notes, inline: false });
  }

  embed.addFields({
    name: '📌 Operational Guidelines',
    value:
      '1. Coordinate with team members before initiating the in-game session.\n' +
      '2. Complete all required runs and record valid evidence screenshots.\n' +
      '3. Submit proofs via the Web Portal or the action buttons below.\n' +
      '4. Sensitive banking, financial, or personal data must never be shared in chat.',
  });

  embed.setTimestamp();
  embed.setFooter({ text: 'G4X Community — Private Coordination System' });

  // Coordination action buttons
  const webBaseUrl = process.env.WEB_BASE_URL || 'https://g4x.online';
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`order_chan_complete:${order.id}`)
      .setLabel('Complete Run')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`order_chan_proof:${order.id}`)
      .setLabel('Submit Proof')
      .setStyle(ButtonStyle.Success)
      .setEmoji('📸'),
    new ButtonBuilder()
      .setLabel('Web Dashboard')
      .setStyle(ButtonStyle.Link)
      .setURL(`${webBaseUrl}/#booster`)
  );

  return { embed, components: [row] };
}

const inFlightCreations = new Map<number, Promise<OrderExecutionChannelResult>>();

/**
 * Creates or retrieves the single authoritative Discord coordination channel for an order.
 * Ensures robust idempotency across concurrent requests, process restarts, and network retries.
 */
export async function getOrCreateOrderExecutionChannel(
  orderId: number,
  client: any,
  options?: { guildId?: string; actorId?: string }
): Promise<OrderExecutionChannelResult> {
  const existingInFlight = inFlightCreations.get(orderId);
  if (existingInFlight) {
    return await existingInFlight;
  }

  const creationPromise = (async (): Promise<OrderExecutionChannelResult> => {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        game: true,
        service: true,
        assignments: true,
        orderChannels: true,
        runs: true,
        disputes: true,
      },
    });

    if (!order) {
      throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} not found`);
    }

    // 1. Authoritative Payment Check (Client-supplied status is strictly ignored)
    const isPaidOrUnneeded = order.paymentStatus === 'verified' || order.paymentStatus === 'unneeded';
    if (!isPaidOrUnneeded) {
      throw new DomainError(
        DomainErrorCode.PAYMENT_NOT_VERIFIED,
        `Cannot create execution channel for unpaid order #${orderId} (paymentStatus: '${order.paymentStatus}')`
      );
    }

    // 2. Lifecycle Status Check
    if (['draft', 'payment_pending', 'cancelled'].includes(order.status)) {
      throw new DomainError(
        DomainErrorCode.INVALID_ORDER_TRANSITION,
        `Cannot create execution channel for order #${orderId} in '${order.status}' status`
      );
    }

    // 3. Assigned Boosters Check (Presign-only does NOT qualify for private channels)
    const activeAssignments = order.assignments.filter((a) => a.status === 'assigned');
    if (activeAssignments.length === 0) {
      throw new DomainError(
        DomainErrorCode.ORDER_NOT_ASSIGNED,
        `Order #${orderId} has no assigned boosters. Private channels are not created for presign-only orders.`
      );
    }

    const assignedUserIds = activeAssignments.map((a) => a.userId);
    const guild = resolveExecutionGuild(client, options?.guildId);
    if (!guild) {
      throw new DomainError(
        DomainErrorCode.CHANNEL_CREATION_FAILED,
        'No valid Discord guild found for creating order channel'
      );
    }

    // 4. Idempotency Check: Existing active mapping in DB
    const existingMapping = await prisma.orderChannel.findFirst({
      where: {
        orderId: order.id,
        channelType: 'execution',
        status: 'active',
      },
    });

    if (existingMapping) {
      let existingChannel: any = null;
      try {
        if (typeof client?.channels?.fetch === 'function') {
          existingChannel = await client.channels.fetch(existingMapping.discordChannelId).catch(() => null);
        }
        if (!existingChannel && typeof guild.channels?.fetch === 'function') {
          existingChannel = await guild.channels.fetch(existingMapping.discordChannelId).catch(() => null);
        }
        if (!existingChannel && guild.channels?.cache) {
          existingChannel = guild.channels.cache.get(existingMapping.discordChannelId);
        }
      } catch {
        existingChannel = null;
      }

      if (existingChannel) {
        // Channel exists and is healthy; synchronize permissions to ensure fresh roster
        await syncOrderChannelPermissions(order.id, client, existingChannel);
        return {
          success: true,
          channelId: existingChannel.id,
          guildId: guild.id,
          isNew: false,
          channel: existingChannel,
        };
      }

      // Existing channel in DB was deleted in Discord -> mark old mapping as deleted to allow recovery
      // Note: Never call channel.delete() here; channel is already confirmed missing remotely.
      await prisma.orderChannel.update({
        where: { id: existingMapping.id },
        data: { status: 'deleted' },
      });
    }

    // 5. Recovery from legacy order.executionChannelId if DB mapping was missing
    if (order.executionChannelId) {
      let legacyChannel: any = null;
      try {
        if (typeof client?.channels?.fetch === 'function') {
          legacyChannel = await client.channels.fetch(order.executionChannelId).catch(() => null);
        }
        if (!legacyChannel && typeof guild.channels?.fetch === 'function') {
          legacyChannel = await guild.channels.fetch(order.executionChannelId).catch(() => null);
        }
      } catch {
        legacyChannel = null;
      }

      if (legacyChannel) {
        // Restore missing OrderChannel row
        try {
          await prisma.orderChannel.create({
            data: {
              orderId: order.id,
              discordGuildId: guild.id,
              discordChannelId: legacyChannel.id,
              channelType: 'execution',
              status: 'active',
            },
          });
        } catch (dbInsertErr: any) {
          if (dbInsertErr?.code !== 'P2002' && !dbInsertErr?.message?.includes('UNIQUE constraint failed')) {
            throw dbInsertErr;
          }
        }

        await syncOrderChannelPermissions(order.id, client, legacyChannel);
        return {
          success: true,
          channelId: legacyChannel.id,
          guildId: guild.id,
          isNew: false,
          channel: legacyChannel,
        };
      }
    }

    // 5b. Guard against duplicate Discord channels if creation previously succeeded in Discord but DB write failed
    // Fetch channels from Discord if cache is incomplete
    if (typeof guild.channels?.fetch === 'function' && (!guild.channels.cache || guild.channels.cache.size === 0)) {
      await guild.channels.fetch().catch(() => null);
    }

    const channelName = buildOrderExecutionChannelName(order);
    const legacyChannelName = `order-${order.id}`;
    const exactRegex = new RegExp(`^order-${order.id}(-(selfplay|pilot|mythicplus))?$`, 'i');

    let orphanChannel: any = null;
    if (guild.channels?.cache) {
      const isMatching = (c: any) => {
        if (c.type !== ChannelType.GuildText && !c.isTextBased?.()) return false;
        if (c.topic && (c.topic.includes(`Order #${order.id}`) || c.topic.includes(`Ref: ${order.orderRef}`))) {
          return true;
        }
        return exactRegex.test(c.name || '') || c.name === channelName || c.name === legacyChannelName;
      };

      if (typeof guild.channels.cache.find === 'function') {
        orphanChannel = guild.channels.cache.find(isMatching);
      } else if (typeof guild.channels.cache.values === 'function') {
        for (const c of guild.channels.cache.values()) {
          if (isMatching(c)) {
            orphanChannel = c;
            break;
          }
        }
      }
    }

    // Verify orphan channel does NOT belong to another order
    if (orphanChannel) {
      const usedByOtherMapping = await prisma.orderChannel.findFirst({
        where: { discordChannelId: orphanChannel.id, orderId: { not: order.id } },
      });
      const usedByOtherOrder = await prisma.order.findFirst({
        where: { executionChannelId: orphanChannel.id, id: { not: order.id } },
      });

      if (usedByOtherMapping || usedByOtherOrder) {
        // Channel belongs to a different order, do not adopt!
        orphanChannel = null;
      }
    }

    if (orphanChannel) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.orderChannel.create({
            data: {
              orderId: order.id,
              discordGuildId: guild.id,
              discordChannelId: orphanChannel.id,
              channelType: 'execution',
              status: 'active',
            },
          });
          await tx.order.update({
            where: { id: order.id },
            data: { executionChannelId: orphanChannel.id },
          });
        });
      } catch (txErr: any) {
        if (txErr?.code !== 'P2002' && !txErr?.message?.includes('UNIQUE constraint failed')) {
          throw txErr;
        }
      }

      await syncOrderChannelPermissions(order.id, client, orphanChannel);
      return {
        success: true,
        channelId: orphanChannel.id,
        guildId: guild.id,
        isNew: false,
        channel: orphanChannel,
      };
    }

    // 6. Create New Discord Channel
    const category = await resolveOrCreateExecutionCategory(guild);
    const botUserId = client?.user?.id || guild.members?.me?.id;
    const permissionOverwrites = buildExecutionChannelOverwrites(
      guild,
      order,
      assignedUserIds,
      botUserId
    );
    const topic = `G4X Order #${order.id} | Ref: ${order.orderRef} | Mode: ${deriveOrderChannelModeSlug(order)}`;

    let newChannel: any = null;

    try {
      if (typeof guild.channels?.create === 'function') {
        newChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          topic,
          parent: category ? category.id : undefined,
          permissionOverwrites,
        });
      } else {
        // Mocked channel fallback
        newChannel = {
          id: `mock_chan_ord_${order.id}`,
          name: channelName,
          topic,
          guild: { id: guild.id },
          isTextBased: () => true,
          permissionOverwrites: {
            cache: new Map(permissionOverwrites.map((o) => [o.id, o])),
            edit: async () => true,
            delete: async () => true,
          },
          send: async () => ({ id: `msg_mock_${Date.now()}` }),
        };
      }
    } catch (err: any) {
      throw new DomainError(
        DomainErrorCode.CHANNEL_CREATION_FAILED,
        `Discord API failed to create channel #${channelName}: ${err?.message || err}`
      );
    }

    // 7. Persist Mapping in Database Atomically with Uniqueness Guard
    try {
      await prisma.$transaction(async (tx) => {
        await tx.orderChannel.create({
          data: {
            orderId: order.id,
            discordGuildId: guild.id,
            discordChannelId: newChannel.id,
            channelType: 'execution',
            status: 'active',
          },
        });

        await tx.order.update({
          where: { id: order.id },
          data: { executionChannelId: newChannel.id },
        });
      });
    } catch (dbErr: any) {
      // Concurrency race: If another thread/process inserted the active row concurrently
      if (dbErr?.code === 'P2002' || dbErr?.message?.includes('UNIQUE constraint failed')) {
        const raceActive = await prisma.orderChannel.findFirst({
          where: { orderId: order.id, channelType: 'execution', status: 'active' },
        });
        if (raceActive) {
          let liveCh: any = null;
          try {
            if (typeof client?.channels?.fetch === 'function') {
              liveCh = await client.channels.fetch(raceActive.discordChannelId).catch(() => null);
            }
          } catch {
            liveCh = null;
          }
          return {
            success: true,
            channelId: raceActive.discordChannelId,
            guildId: guild.id,
            isNew: false,
            channel: liveCh || newChannel,
          };
        }
      }
      throw dbErr;
    }

    // 8. Post English Summary & Action Buttons
    try {
      const { embed, components } = buildExecutionChannelSummary(order, activeAssignments);
      if (typeof newChannel.send === 'function') {
        await newChannel.send({ embeds: [embed], components });
      }
    } catch (err) {
      console.warn('[OrderExecutionChannel] Failed to post initial summary embed:', err);
    }

    return {
      success: true,
      channelId: newChannel.id,
      guildId: guild.id,
      isNew: true,
      channel: newChannel,
    };
  })();

  inFlightCreations.set(orderId, creationPromise);
  try {
    return await creationPromise;
  } finally {
    inFlightCreations.delete(orderId);
  }
}

/**
 * Synchronizes channel permission overwrites when the order booster roster changes.
 * Preserves access for participants in active disputes and safely handles guild departures.
 */
export async function syncOrderChannelPermissions(
  orderId: number,
  client: any,
  providedChannel?: any
): Promise<{ success: boolean; updatedCount: number; removedCount: number; errors: string[] }> {
  const result = { success: true, updatedCount: 0, removedCount: 0, errors: [] as string[] };
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      assignments: true,
      disputes: true,
      orderChannels: {
        where: { channelType: 'execution', status: 'active' },
      },
    },
  });

  if (!order) return { ...result, success: false, errors: ['ORDER_NOT_FOUND'] };

  const activeMapping = order.orderChannels[0];
  const channelId = activeMapping?.discordChannelId || order.executionChannelId;
  if (!channelId) return { ...result, success: false, errors: ['NO_ACTIVE_CHANNEL'] };

  let channel = providedChannel;
  if (!channel && client) {
    channel = await client.channels?.fetch?.(channelId).catch(() => null);
  }

  if (!channel) return { ...result, success: false, errors: ['CHANNEL_NOT_FOUND'] };

  const activeAssignments = order.assignments.filter((a) => a.status === 'assigned');
  const assignedUserIds = activeAssignments.map((a) => a.userId);

  // Replaced / removed boosters who should lose access unless involved in an active dispute
  const removedAssignments = order.assignments.filter((a) =>
    ['replaced', 'cancelled', 'removed'].includes(a.status)
  );

  // Preserve access for participants in active disputes
  const activeDisputes = (order.disputes || []).filter((d) =>
    ['open', 'under_review', 'waiting_for_evidence'].includes(d.status)
  );
  const disputeParticipantIds = new Set<string>();
  for (const d of activeDisputes) {
    if ((d as any).openedById) disputeParticipantIds.add((d as any).openedById);
    if ((d as any).initiatorId) disputeParticipantIds.add((d as any).initiatorId);
    if ((d as any).respondentId) disputeParticipantIds.add((d as any).respondentId);
  }

  // Update active booster permissions
  for (const uid of assignedUserIds) {
    try {
      if (typeof channel.permissionOverwrites?.edit === 'function') {
        await channel.permissionOverwrites.edit(uid, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          EmbedLinks: true,
          AttachFiles: true,
        });
        result.updatedCount++;
      }
    } catch (e: any) {
      if (e?.code === 10007) {
        console.warn(`[OrderExecutionChannel] Member ${uid} left the guild; skipped permission grant.`);
      } else {
        console.warn(`[OrderExecutionChannel] Could not grant permissions for ${uid}:`, e);
        result.errors.push(`GRANT_FAILED_${uid}: ${e?.message || e}`);
      }
    }
  }

  // Revoke removed booster permissions (only if not participating in an unresolved dispute)
  for (const rem of removedAssignments) {
    if (!assignedUserIds.includes(rem.userId) && !disputeParticipantIds.has(rem.userId)) {
      try {
        if (typeof channel.permissionOverwrites?.delete === 'function') {
          await channel.permissionOverwrites.delete(rem.userId);
          result.removedCount++;
        } else if (typeof channel.permissionOverwrites?.edit === 'function') {
          await channel.permissionOverwrites.edit(rem.userId, {
            ViewChannel: false,
            SendMessages: false,
          });
          result.removedCount++;
        }
      } catch (e: any) {
        if (e?.code === 10007) {
          console.warn(`[OrderExecutionChannel] Member ${rem.userId} left the guild; permission delete skipped.`);
        } else {
          console.warn(`[OrderExecutionChannel] Could not revoke permissions for ${rem.userId}:`, e);
          result.errors.push(`REVOKE_FAILED_${rem.userId}: ${e?.message || e}`);
        }
      }
    }
  }

  result.success = result.errors.length === 0;
  return result;
}

/**
 * Handles coordination channel updates when an order is cancelled.
 */
export async function handleOrderCancellationChannel(
  orderId: number,
  reason: string,
  client: any
): Promise<void> {
  const mapping = await prisma.orderChannel.findFirst({
    where: { orderId, channelType: 'execution', status: 'active' },
  });

  if (!mapping || !client) return;

  const channel = await client.channels?.fetch?.(mapping.discordChannelId).catch(() => null);
  if (!channel) return;

  try {
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`🛑 Order #${orderId} Cancelled`)
      .setDescription(
        `This order has been cancelled by an authorized user.\n` +
          `• **Reason:** ${reason}\n` +
          `• Active booster reservations have been released.\n` +
          `• Messaging in this channel is now closed.`
      )
      .setTimestamp();

    if (typeof channel.send === 'function') {
      await channel.send({ embeds: [embed] });
    }

    // Lock channel: Deny SendMessages to @everyone
    if (typeof channel.permissionOverwrites?.edit === 'function') {
      const everyoneId = channel.guild?.roles?.everyone?.id || channel.guild?.id;
      if (everyoneId) {
        await channel.permissionOverwrites.edit(everyoneId, {
          SendMessages: false,
        });
      }
    }

    // Update database status to locked
    await prisma.orderChannel.update({
      where: { id: mapping.id },
      data: { status: 'locked' },
    });
  } catch (err) {
    console.warn(`[OrderExecutionChannel] Error locking cancelled channel for order #${orderId}:`, err);
  }
}

const recentExecutionMilestones = new Map<string, number>();

/**
 * Posts operational milestone updates in the private coordination channel.
 * Prevents redundant/duplicate consecutive notifications for the same milestone.
 */
export async function notifyExecutionChannelMilestone(
  orderId: number,
  client: any,
  milestone: 'RUN_COMPLETED' | 'PROOF_SUBMITTED' | 'STAFF_REVIEW' | 'ADMIN_FINAL_APPROVED',
  details?: { actorId?: string; notes?: string }
): Promise<void> {
  if (!client) return;

  const milestoneKey = `${orderId}:${milestone}`;
  const lastSent = recentExecutionMilestones.get(milestoneKey);
  const now = Date.now();
  if (lastSent && now - lastSent < 30000) {
    // Skip duplicate milestone notification within 30 seconds
    return;
  }
  recentExecutionMilestones.set(milestoneKey, now);

  const mapping = await prisma.orderChannel.findFirst({
    where: { orderId, channelType: 'execution', status: 'active' },
  });

  if (!mapping) return;

  const channel = await client.channels?.fetch?.(mapping.discordChannelId).catch(() => null);
  if (!channel || typeof channel.send !== 'function') return;

  let title = '';
  let color = 0x5865f2;
  let desc = '';

  switch (milestone) {
    case 'RUN_COMPLETED':
      title = `✅ Run Completed — Order #${orderId}`;
      color = 0x57f287;
      desc = `Run marked completed by ${details?.actorId ? `<@${details.actorId}>` : 'assigned booster'}. Please submit verification screenshots.`;
      break;
    case 'PROOF_SUBMITTED':
      title = `📸 Evidence Submitted — Order #${orderId}`;
      color = 0x3ba55d;
      desc = `Completion evidence has been submitted and is currently queued for Staff review.`;
      break;
    case 'STAFF_REVIEW':
      title = `🛡️ Staff Review Approved — Order #${orderId}`;
      color = 0xfaa81a;
      desc = `Staff has verified the completion proof. Awaiting final Admin sign-off.${details?.notes ? `\n*Notes: ${details.notes}*` : ''}`;
      break;
    case 'ADMIN_FINAL_APPROVED':
      title = `🎉 Final Admin Approval Granted — Order #${orderId}`;
      color = 0x5865f2;
      desc = `Order #${orderId} has received official Admin approval. Escrow holding period has commenced.`;
      break;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(desc)
    .setTimestamp();

  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.warn(`[OrderExecutionChannel] Could not send milestone ${milestone} update:`, err);
  }
}

/**
 * Archives an execution channel once an order is completely finished.
 * Strictly preserves channels that have open or unresolved disputes.
 */
export async function archiveOrderExecutionChannel(
  orderId: number,
  client: any,
  options?: { force?: boolean; retentionHours?: number }
): Promise<ArchiveResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      disputes: true,
      escrowHolds: true,
      orderChannels: {
        where: { channelType: 'execution', status: 'active' },
      },
    },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} not found`);
  }

  // 1. Evidence Preservation Check: Block archival if unresolved disputes exist
  const unresolvedDisputes = order.disputes.filter((d) =>
    ['open', 'under_review', 'waiting_for_evidence'].includes(d.status)
  );

  if (unresolvedDisputes.length > 0 && !options?.force) {
    throw new DomainError(
      DomainErrorCode.ORDER_DISPUTE_ACTIVE,
      `Cannot archive execution channel for Order #${orderId}: ${unresolvedDisputes.length} active dispute(s) require evidence preservation.`
    );
  }

  // 2. Active Escrow Hold Check
  const activeHolds = order.escrowHolds.filter((h) => ['active', 'pending', 'held'].includes(h.status));
  if (activeHolds.length > 0 && !options?.force) {
    throw new DomainError(
      DomainErrorCode.ORDER_DISPUTE_ACTIVE,
      `Cannot archive execution channel for Order #${orderId}: Active financial escrow hold requires channel retention.`
    );
  }

  const activeMapping = order.orderChannels[0];
  if (!activeMapping) {
    return {
      success: true,
      orderId,
      error: 'NO_ACTIVE_CHANNEL_TO_ARCHIVE',
    };
  }

  const channel = client
    ? await client.channels?.fetch?.(activeMapping.discordChannelId).catch(() => null)
    : null;

  const now = new Date();

  if (channel) {
    try {
      const embed = new EmbedBuilder()
        .setColor(0x747f8d)
        .setTitle(`📁 Order #${orderId} Coordination Archived`)
        .setDescription(
          `This coordination channel has been archived following order finalization.\n` +
            `Channel is now read-only.`
        )
        .setTimestamp();

      if (typeof channel.send === 'function') {
        await channel.send({ embeds: [embed] });
      }

      // Lock channel: Deny SendMessages to all non-staff
      const everyoneId = channel.guild?.roles?.everyone?.id || channel.guild?.id;
      if (typeof channel.permissionOverwrites?.edit === 'function' && everyoneId) {
        await channel.permissionOverwrites.edit(everyoneId, {
          SendMessages: false,
        });
      }
    } catch (err) {
      console.warn(`[OrderExecutionChannel] Archival Discord API error for #${orderId}:`, err);
    }
  }

  // Update DB Mapping
  await prisma.orderChannel.update({
    where: { id: activeMapping.id },
    data: {
      status: 'archived',
      archivedAt: now,
    },
  });

  return {
    success: true,
    orderId,
    channelId: activeMapping.discordChannelId,
    archivedAt: now,
  };
}

/**
 * Checks if a specific user is authorized to obtain the Discord channel link from the web portal.
 */
export async function getAuthorizedChannelAccess(
  orderId: number,
  userId: string
): Promise<{
  authorized: boolean;
  hasChannel: boolean;
  channelId?: string;
  channelUrl?: string;
  channelName?: string;
  reason?: string;
}> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      service: true,
      assignments: true,
      orderChannels: {
        where: { channelType: 'execution', status: 'active' },
      },
    },
  });

  if (!order) {
    return { authorized: false, hasChannel: false, reason: 'ORDER_NOT_FOUND' };
  }

  // Check roles in DB
  const userRoles = await prisma.userRole.findMany({
    where: { userId },
  });
  const roleKeys = userRoles.map((r) => r.roleKey.toLowerCase());
  const isManagementOrStaff = roleKeys.some((k) =>
    ['staff', 'admin', 'manager', 'owner'].includes(k)
  );

  const isAssignedBooster = order.assignments.some(
    (a) => a.userId === userId && a.status === 'assigned'
  );
  const isOrderAdvertiser = order.advertiserId === userId;
  const isOrderCustomer = order.customerId === userId;

  if (!isManagementOrStaff && !isAssignedBooster && !isOrderAdvertiser && !isOrderCustomer) {
    return {
      authorized: false,
      hasChannel: false,
      reason: 'PERMISSION_DENIED: User is not an assigned booster, order creator, or staff member',
    };
  }

  const activeChannel = order.orderChannels[0];
  if (!activeChannel) {
    const fallbackChannelId = order.executionChannelId || order.discordChannelId;
    if (fallbackChannelId) {
      const guildId = process.env.DISCORD_GUILD_ID || '1200000000000000000';
      return {
        authorized: true,
        hasChannel: true,
        channelId: fallbackChannelId,
        channelUrl: `https://discord.com/channels/${guildId}/${fallbackChannelId}`,
        channelName: buildOrderExecutionChannelName(order),
      };
    }
    return {
      authorized: true,
      hasChannel: false,
      reason: 'NO_CHANNEL_AVAILABLE: No active coordination channel exists for this order',
    };
  }

  const channelUrl = `https://discord.com/channels/${activeChannel.discordGuildId}/${activeChannel.discordChannelId}`;
  return {
    authorized: true,
    hasChannel: true,
    channelId: activeChannel.discordChannelId,
    channelUrl,
    channelName: buildOrderExecutionChannelName(order),
  };
}
