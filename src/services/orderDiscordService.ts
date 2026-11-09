/**
 * orderDiscordService.ts — Discord Order Card Publication, Role Pre-sign & Claim Management
 *
 * Phase 2 Completion, Milestone 1
 * Stack: Discord.js v14, Prisma, TypeScript
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Client,
  TextChannel,
  ButtonInteraction,
} from 'discord.js';
import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import { ensureOrderAcceptsOperations } from './orderValidationService';
import { ensureUserExists } from './registrationService';
import { formatBoosterShareDisplay } from './financialCalculationEngine';
import {
  formatRolesDisplay,
  isMythicPlusOrder,
  parsePresignRoles,
  publishOrUpdateOrderReviewDashboard,
  toggleBoosterKeyOwner,
  toggleBoosterRolePresign,
} from './presignReviewService';

let _globalDiscordClient: any = null;
export function setGlobalDiscordClient(c: any): void {
  _globalDiscordClient = c;
}
export function getGlobalDiscordClient(): any {
  return _globalDiscordClient;
}

export interface PublishOrderResult {
  success: boolean;
  messageId?: string;
  channelId?: string;
  isNew?: boolean;
  error?: string;
}

import {
  resolveOrderPublicationChannel,
  validateBotChannelPermissions,
  OrderRoutingInfo,
} from './orderPublicationChannelService';

export interface PublishCardOptions {
  targetChannelId?: string;
  guildId?: string;
}

/**
 * Resolves the Discord orders publication channel using the dedicated publication routing system:
 * 1. Explicit targetChannelId or order.discordChannelId if valid
 * 2. Database ChannelRoute mapping by gameSlug, serviceId, and serviceMode
 * 3. Guild Category/Channel hierarchy (WoW Midnight / WoW Forever)
 * 4. Fails safely by returning null if unmapped (no arbitrary fallback leaking)
 */
export async function resolveOrdersChannel(
  client: any,
  order?: OrderRoutingInfo,
  guildId?: string
): Promise<any> {
  if (!client) return null;

  return await resolveOrderPublicationChannel(client, order, guildId);
}

/**
 * Builds the public Discord Embed for an order card.
 * EXCLUDES financial secrets, private customer info, and sensitive trade details.
 * Contains English status, game & service, boost type, requirements, and roster information.
 */
export function buildOrderEmbed(order: any, presigns: any[] = [], assignments: any[] = []): EmbedBuilder {
  const embed = new EmbedBuilder();

  // Status mapping and styling
  let statusColor = 0x5865f2; // Default blurple
  let statusEmoji = '⚪';
  let statusText = order.status;

  switch (order.status) {
    case 'open_presign':
      statusColor = 0x57f287; // Green
      statusEmoji = '🟢';
      statusText = 'Open for Pre-sign';
      break;
    case 'presign_closed':
      statusColor = 0xfee75c; // Yellow
      statusEmoji = '🟡';
      statusText = 'Pre-sign Closed (Reviewing)';
      break;
    case 'assigned':
      statusColor = 0x3498db; // Blue
      statusEmoji = '🔵';
      statusText = 'Assigned (Squad Formed)';
      break;
    case 'in_progress':
      statusColor = 0x9b59b6; // Purple
      statusEmoji = '⚔️';
      statusText = 'In Progress';
      break;
    case 'pending_review':
      statusColor = 0xe67e22; // Orange
      statusEmoji = '📋';
      statusText = 'Pending Final Review';
      break;
    case 'completed':
      statusColor = 0x2ecc71; // Emerald Green
      statusEmoji = '🏁';
      statusText = 'Completed';
      break;
    case 'cancelled':
      statusColor = 0xed4245; // Red
      statusEmoji = '🔴';
      statusText = 'Cancelled';
      break;
    case 'disputed':
      statusColor = 0xe67e22; // Orange
      statusEmoji = '⚠️';
      statusText = 'Under Dispute';
      break;
  }

  embed.setColor(statusColor);
  embed.setTitle(`🎮 Boost Order #${order.id} • ${order.orderRef}`);

  const gameTitle = order.game?.displayName || order.gameSlug || 'Unknown Game';
  const serviceTitle = order.service?.displayName || `Service #${order.serviceId}`;
  const modeText =
    order.orderMode === 'pilot'
      ? 'Pilot (Account Play)'
      : `Selfpay / Self-Play (${order.orderType?.toUpperCase() || 'GROUP'})`;

  embed.setDescription(
    `**Game:** ${gameTitle}\n` +
      `**Service:** ${serviceTitle}\n` +
      `**Boost Type:** ${modeText}\n` +
      `**Status:** ${statusEmoji} **${statusText}**`
  );

  // Requirements & Qualification Eligibility
  const requirementsList: string[] = [];
  const requiredQualification = order.orderMode === 'pilot' ? 'Pilot' : 'Booster';
  requirementsList.push(`• **Eligibility:** Approved G4X ${requiredQualification} qualification required.`);

  if (order.keyRequirements && order.keyRequirements.length > 0) {
    for (const kr of order.keyRequirements) {
      requirementsList.push(`• **${kr.requirementKey || 'Requirement'}:** ${kr.requirementValue || 'Required'}`);
    }
  }

  embed.addFields({
    name: '📋 Requirements & Eligibility',
    value: requirementsList.join('\n'),
    inline: false,
  });

  // Role slots & presigns calculation
  const activePresigns = presigns.filter((p) => p.status === 'registered');
  const activeAssignments = assignments.filter((a) => a.status === 'assigned');

  if (order.requiredRoles && order.requiredRoles.length > 0) {
    const roleLines = order.requiredRoles.map((req: any) => {
      const rName = req.roleName.toLowerCase();
      const currentPresigned = activePresigns.filter((p) => p.registeredRole.toLowerCase() === rName).length;
      const currentAssigned = activeAssignments.filter((a) => a.assignedRole.toLowerCase() === rName).length;
      const totalOccupied = currentPresigned + currentAssigned;

      let roleIcon = '👤';
      if (rName === 'tank') roleIcon = '🛡️';
      else if (rName === 'healer') roleIcon = '💚';
      else if (rName === 'dps') roleIcon = '⚔️';

      const isFull = totalOccupied >= req.quantity;
      return `${roleIcon} **${req.roleName.toUpperCase()}:** ${totalOccupied}/${req.quantity} ${isFull ? '*(Full)*' : '*(Available)*'}`;
    });

    embed.addFields({
      name: '👥 Required Booster Slots',
      value: roleLines.join('\n'),
      inline: false,
    });
  } else {
    // Default group overview if requiredRoles is not explicitly populated
    const totalPresigned = activePresigns.length;
    embed.addFields({
      name: '👥 Available Booster Slots',
      value: `Total Registered Pre-signs: **${totalPresigned}**`,
      inline: true,
    });
  }

  // Active roster / candidate information
  if (activeAssignments.length > 0) {
    const rosterLines = activeAssignments.map((a: any) => {
      const uName = a.user?.displayName || a.user?.username || a.userId;
      let rIcon = '👤';
      const r = (a.assignedRole || '').toLowerCase();
      if (r === 'tank') rIcon = '🛡️';
      else if (r === 'healer') rIcon = '💚';
      else if (r === 'dps') rIcon = '⚔️';
      return `• ${rIcon} **${(a.assignedRole || 'Booster').toUpperCase()}:** ${uName} (<@${a.userId}>)`;
    });
    embed.addFields({
      name: '✅ Assigned Squad Roster',
      value: rosterLines.join('\n'),
      inline: false,
    });
  } else if (activePresigns.length > 0 && order.status === 'open_presign') {
    embed.addFields({
      name: '👥 Registered Candidates',
      value: `**${activePresigns.length}** booster(s) registered for pre-sign selection.`,
      inline: true,
    });
  }

  // Pre-sign deadline if open
  if (order.presignDeadline && order.status === 'open_presign') {
    const deadlineUnix = Math.floor(new Date(order.presignDeadline).getTime() / 1000);
    embed.addFields({
      name: '⏳ Pre-sign Window',
      value: `Closes <t:${deadlineUnix}:R>`,
      inline: true,
    });
  }

  // Safe requirements & notes (excluding financial secrets & private customer data)
  if (order.notes && typeof order.notes === 'string' && order.notes.trim().length > 0) {
    // Strip sensitive customer information and financial terms against leakage
    const sanitizedNotes = order.notes
      .replace(/\[Customer[^\]]*\]/gi, '')
      .replace(/\[Required VPN[^\]]*\]/gi, '')
      .replace(/fee|price|commission|wallet|gross|payout/gi, '***')
      .trim()
      .slice(0, 300);
    if (sanitizedNotes.length > 0) {
      embed.addFields({
        name: '📝 Run Notes',
        value: sanitizedNotes,
        inline: false,
      });
    }
  }

  // Authoritative Booster Pool & Share Compensation Display
  if (order.boosterPoolMinor && order.boosterPoolMinor > 0) {
    const poolUsd = `$${(order.boosterPoolMinor / 100).toFixed(2)} USD`;
    const isMythic =
      order.orderType === 'group' ||
      (order.service?.displayName || '').toLowerCase().includes('mythic') ||
      (order.service?.slug || '').toLowerCase().includes('mythic');

    if (isMythic) {
      const shareInfo = formatBoosterShareDisplay(order.boosterPoolMinor, 4);
      embed.addFields({
        name: '💰 Booster Reward',
        value: `• **Total Booster Pool:** **${poolUsd}**\n• **Per Booster Share (4 Boosters):** **${shareInfo.displayText}** *(${shareInfo.breakdownText})*`,
        inline: false,
      });
    } else {
      embed.addFields({
        name: '💰 Booster Reward',
        value: `• **Total Booster Pool:** **${poolUsd}**`,
        inline: true,
      });
    }
  }

  embed.setFooter({
    text: `G4X Community • Real Order Card | ID: #${order.id}`,
  });
  embed.setTimestamp(order.publishedAt || order.createdAt || new Date());

  return embed;
}

/**
 * Builds the interactive components (buttons) for the order card.
 * In open_presign: Tank, Healer, DPS, Withdraw, and View Details buttons.
 * In other states: Status indicator badge and View Details buttons.
 */
export function buildOrderComponents(
  order: any,
  presigns: any[] = []
): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>();
  const isOpen = order.status === 'open_presign';

  const activePresigns = presigns.filter((p) => p.status === 'registered');

  if (isOpen) {
    const isMythic = isMythicPlusOrder(order);

    if (isMythic) {
      // Exactly FIVE buttons for Mythic+ orders: Tank, Healer, DPS, Key Owner, Premade
      const tankCount = activePresigns.filter((p) =>
        parsePresignRoles(p.registeredRole).includes('tank')
      ).length;
      const healerCount = activePresigns.filter((p) =>
        parsePresignRoles(p.registeredRole).includes('healer')
      ).length;
      const dpsCount = activePresigns.filter((p) =>
        parsePresignRoles(p.registeredRole).includes('dps')
      ).length;
      const keyCount = activePresigns.filter((p) => p.hasKey === 'yes').length;

      const reqTank = order.requiredRoles?.find((r: any) => r.roleName.toLowerCase() === 'tank');
      const isTankFull = reqTank ? tankCount >= reqTank.quantity : tankCount >= 1;

      const reqHealer = order.requiredRoles?.find((r: any) => r.roleName.toLowerCase() === 'healer');
      const isHealerFull = reqHealer ? healerCount >= reqHealer.quantity : healerCount >= 1;

      const reqDps = order.requiredRoles?.find((r: any) => r.roleName.toLowerCase() === 'dps');
      const isDpsFull = reqDps ? dpsCount >= reqDps.quantity : dpsCount >= 2;

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`presign_tank:${order.id}`)
          .setLabel(`Tank (${tankCount}/1)`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🛡️')
          .setDisabled(isTankFull),
        new ButtonBuilder()
          .setCustomId(`presign_healer:${order.id}`)
          .setLabel(`Healer (${healerCount}/1)`)
          .setStyle(ButtonStyle.Success)
          .setEmoji('💚')
          .setDisabled(isHealerFull),
        new ButtonBuilder()
          .setCustomId(`presign_dps:${order.id}`)
          .setLabel(`DPS (${dpsCount}/2)`)
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⚔️')
          .setDisabled(isDpsFull),
        new ButtonBuilder()
          .setCustomId(`presign_key:${order.id}`)
          .setLabel(`Key Owner${keyCount > 0 ? ` (${keyCount})` : ''}`)
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔑'),
        new ButtonBuilder()
          .setCustomId(`presign_premade:${order.id}`)
          .setLabel('Premade')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🛡️')
      );

      return [row];
    }

    // Pilot and Non-Pilot orders: Show Pre-sign, Premade (if team permitted), and Withdraw.
    // Do not show Mythic+ execution-role buttons (Tank, Healer, DPS).
    const allowsPremade =
      order.orderType === 'group' ||
      (order.service?.serviceMode || '').toLowerCase() === 'group';

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`presign_dps:${order.id}`)
        .setLabel(`Pre-sign (${activePresigns.length})`)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✋')
    );

    if (allowsPremade) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`presign_premade:${order.id}`)
          .setLabel('Premade')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🛡️')
      );
    }

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`presign_withdraw:${order.id}`)
        .setLabel('Withdraw')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('↩️')
    );
  } else {
    // Non-open lifecycle status indicator badge
    let badgeLabel = 'Unavailable';
    let badgeEmoji = '🔒';
    let badgeStyle = ButtonStyle.Secondary;

    switch (order.status) {
      case 'assigned':
        badgeLabel = 'Assigned to Squad';
        badgeEmoji = '🔵';
        badgeStyle = ButtonStyle.Primary;
        break;
      case 'in_progress':
        badgeLabel = 'In Progress';
        badgeEmoji = '⚔️';
        badgeStyle = ButtonStyle.Primary;
        break;
      case 'pending_review':
        badgeLabel = 'Pending Review';
        badgeEmoji = '📋';
        badgeStyle = ButtonStyle.Secondary;
        break;
      case 'completed':
        badgeLabel = 'Completed';
        badgeEmoji = '🏁';
        badgeStyle = ButtonStyle.Success;
        break;
      case 'cancelled':
        badgeLabel = 'Cancelled';
        badgeEmoji = '🔴';
        badgeStyle = ButtonStyle.Danger;
        break;
      case 'disputed':
        badgeLabel = 'Under Dispute';
        badgeEmoji = '⚠️';
        badgeStyle = ButtonStyle.Danger;
        break;
      case 'presign_closed':
        badgeLabel = 'Pre-sign Closed';
        badgeEmoji = '🟡';
        badgeStyle = ButtonStyle.Secondary;
        break;
      default:
        badgeLabel = `Status: ${order.status}`;
        badgeEmoji = 'ℹ️';
        break;
    }

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`order_status_badge:${order.id}`)
        .setLabel(badgeLabel)
        .setStyle(badgeStyle)
        .setEmoji(badgeEmoji)
        .setDisabled(true)
    );
  }

  // Details button (Always present)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`order_view:${order.id}`)
      .setLabel('View Details')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📋')
  );

  return [row];
}

/**
 * Publishes a real order card to Discord, or refreshes an existing one.
 * Fully idempotent: Retries or restarts never produce duplicate cards.
 */
export async function publishOrRefreshOrderCard(
  client: any,
  orderId: number,
  optionsOrChannelId?: string | PublishCardOptions
): Promise<PublishOrderResult> {
  const activeClient = client || _globalDiscordClient;
  if (!activeClient) {
    return {
      success: false,
      error: 'DISCORD_CLIENT_NOT_INITIALIZED: Discord client is not available',
    };
  }

  let explicitChannelId: string | undefined;
  let targetGuildId: string | undefined;

  if (typeof optionsOrChannelId === 'string') {
    // If caller passed a guild ID (e.g. from message.guild?.id), adapt cleanly
    if (activeClient.guilds?.cache && activeClient.guilds.cache.has(optionsOrChannelId)) {
      targetGuildId = optionsOrChannelId;
    } else {
      explicitChannelId = optionsOrChannelId;
    }
  } else if (optionsOrChannelId && typeof optionsOrChannelId === 'object') {
    explicitChannelId = optionsOrChannelId.targetChannelId;
    targetGuildId = optionsOrChannelId.guildId;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      game: true,
      service: true,
      requiredRoles: true,
      keyRequirements: true,
      presigns: {
        include: { user: true },
      },
      assignments: {
        include: { user: true },
      },
    },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} not found`);
  }

  // Payment verification guard: Unfunded/unverified orders must not be published for public claims
  if (order.paymentStatus !== 'verified' && order.paymentStatus !== 'unneeded') {
    return {
      success: false,
      error: `PAYMENT_NOT_VERIFIED: Order #${order.id} cannot be published for public claims. Payment status is '${order.paymentStatus}'`,
    };
  }

  // Approved External Platform Order Policy validation
  if (order.paymentStatus === 'unneeded') {
    if (
      order.creatorType !== 'g4x' ||
      !order.sourceWebsite ||
      !['g2g', 'skycoach', 'eldorado'].includes(order.sourceWebsite.toLowerCase()) ||
      !order.externalOrderId
    ) {
      return {
        success: false,
        error: `EXTERNAL_POLICY_VIOLATION: Order #${order.id} does not qualify for external-order publication policy. Valid source platform and Site Order ID are required.`,
      };
    }
    if (!order.game?.isActive || !order.service?.isActive) {
      return {
        success: false,
        error: `INACTIVE_GAME_OR_SERVICE: Order #${order.id} cannot be published because the game or service is inactive.`,
      };
    }
  }

  // Advertiser Order Guard: Must be genuine funded verified
  if (order.creatorType === 'advertiser' && order.paymentStatus !== 'verified') {
    return {
      success: false,
      error: `ADVERTISER_UNFUNDED: Advertiser Order #${order.id} cannot be published until payment is verified.`,
    };
  }

  const channel = await resolveOrdersChannel(
    activeClient,
    {
      gameSlug: order.gameSlug,
      serviceId: order.serviceId,
      serviceKey: order.service?.serviceKey,
      orderMode: order.orderMode,
      discordChannelId: explicitChannelId || order.discordChannelId,
    },
    targetGuildId || process.env.DISCORD_GUILD_ID
  );

  if (!channel) {
    return {
      success: false,
      error: 'NO_ORDERS_CHANNEL_RESOLVED: Could not find configured orders channel for this game/service',
    };
  }

  // Validate bot channel permissions
  const permCheck = validateBotChannelPermissions(channel);
  if (!permCheck.valid) {
    return {
      success: false,
      error: `MISSING_PERMISSIONS: Bot lacks required permission(s) [${permCheck.missing.join(', ')}] in channel #${channel.name || channel.id}`,
    };
  }

  const embed = buildOrderEmbed(order, order.presigns, order.assignments);
  const components = buildOrderComponents(order, order.presigns);

  // Check if an existing published message exists to update
  if (order.discordChannelId && order.discordMessageId) {
    try {
      const targetCh =
        channel.id === order.discordChannelId
          ? channel
          : await activeClient.channels.fetch(order.discordChannelId).catch(() => null);

      if (targetCh && typeof targetCh.isTextBased === 'function' && targetCh.isTextBased()) {
        const existingMsg = await targetCh.messages.fetch(order.discordMessageId).catch(() => null);
        if (existingMsg) {
          await existingMsg.edit({ embeds: [embed], components });
          return {
            success: true,
            messageId: existingMsg.id,
            channelId: targetCh.id,
            isNew: false,
          };
        }
      }
    } catch (err: any) {
      console.warn(`[OrderDiscord] Could not edit existing message #${order.discordMessageId}:`, err?.message || err);
      // If error is transient (not 10008 Unknown Message or 404), retry editing once before republishing
      if (err?.code !== 10008 && err?.status !== 404) {
        try {
          await new Promise((res) => setTimeout(res, 500));
          const targetCh =
            channel.id === order.discordChannelId
              ? channel
              : await activeClient.channels.fetch(order.discordChannelId).catch(() => null);
          if (targetCh) {
            const existingMsg = await targetCh.messages.fetch(order.discordMessageId).catch(() => null);
            if (existingMsg) {
              await existingMsg.edit({ embeds: [embed], components });
              return {
                success: true,
                messageId: existingMsg.id,
                channelId: targetCh.id,
                isNew: false,
              };
            }
          }
        } catch (retryErr) {
          console.warn(`[OrderDiscord] Retry edit failed, proceeding to republish:`, retryErr);
        }
      }
    }
  }

  // Publish new message with retry on transient Discord failures
  let sentMsg: any = null;
  try {
    sentMsg = await channel.send({ embeds: [embed], components });
  } catch (apiErr: any) {
    try {
      await new Promise((res) => setTimeout(res, 500));
      sentMsg = await channel.send({ embeds: [embed], components });
    } catch (retryApiErr: any) {
      console.error(`[OrderDiscord] Discord API error while sending order #${order.id} card:`, retryApiErr);
      return {
        success: false,
        error: `DISCORD_API_ERROR: ${retryApiErr?.message || retryApiErr}`,
      };
    }
  }

  // Persist references with safe retry reconciliation
  try {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        discordChannelId: channel.id,
        discordMessageId: sentMsg.id,
        publishedAt: order.publishedAt ?? new Date(),
      },
    });
  } catch (dbErr) {
    console.error(`[OrderDiscord] DB save failed after Discord message send for order #${order.id}:`, dbErr);
    // Safe retry
    try {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          discordChannelId: channel.id,
          discordMessageId: sentMsg.id,
          publishedAt: order.publishedAt ?? new Date(),
        },
      });
    } catch (retryErr) {
      console.error(`[OrderDiscord] Retry DB save also failed for order #${order.id}:`, retryErr);
    }
  }

  return {
    success: true,
    messageId: sentMsg.id,
    channelId: channel.id,
    isNew: true,
  };
}

/**
 * Handles role pre-sign button clicks (presign_tank, presign_healer, presign_dps).
 * Ensures applicant is an approved Booster, order is open, role capacity is preserved,
 * duplicate clicks are idempotent, and concurrent clicks cannot overfill slots.
 */
export async function handlePresignButton(
  interaction: ButtonInteraction,
  role: string,
  orderId: number
): Promise<void> {
  const userId = interaction.user.id;
  await ensureUserExists(userId, interaction.user.username);

  try {
    const result = await toggleBoosterRolePresign(orderId, userId, role);
    let messageText = `✅ **Pre-sign Confirmed**: You are registered as **${role.toUpperCase()}** for Order #${orderId}. (Roles: ${formatRolesDisplay(result.activeRoles)})`;
    if (result.outcome === 'already_registered') {
      messageText = `ℹ️ You are already registered as **${role.toUpperCase()}** for Order #${orderId}.`;
    } else if (result.outcome === 'role_added') {
      messageText = `✅ **Role Added**: Added **${role.toUpperCase()}** to your available roles for Order #${orderId}. (Active: ${formatRolesDisplay(result.activeRoles)})`;
    } else if (result.outcome === 'role_removed') {
      messageText = `↩️ **Role Removed**: Unregistered as **${role.toUpperCase()}** for Order #${orderId}. (Remaining: ${formatRolesDisplay(result.activeRoles)})`;
    } else if (result.outcome === 'role_removed_key_retained') {
      messageText = `ℹ️ **Role Removed**: You have removed all execution roles for Order #${orderId}, but your Key Owner declaration remains active.`;
    } else if (result.outcome === 'withdrawn') {
      messageText = `↩️ **Application Withdrawn**: All role preferences removed for Order #${orderId}.`;
    }

    await interaction.reply({ content: messageText, ephemeral: true });

    publishOrRefreshOrderCard(interaction.client, orderId).catch((err) =>
      console.warn('[OrderDiscord] Card refresh error after presign:', err)
    );
    publishOrUpdateOrderReviewDashboard(interaction.client, orderId).catch((err) =>
      console.warn('[OrderDiscord] Review dashboard refresh error after presign:', err)
    );
    return;
  } catch (err: any) {
    if (err instanceof DomainError && err.code === DomainErrorCode.ROLE_CAPACITY_EXCEEDED) {
      await interaction.reply({ content: `❌ **Slot Full**: ${err.message}`, ephemeral: true });
      return;
    }
    if (err instanceof DomainError && err.code === DomainErrorCode.ORDER_ALREADY_CLOSED) {
      await interaction.reply({ content: `❌ **Order Closed**: Order #${orderId} has been closed or cancelled and cannot accept pre-signs.`, ephemeral: true });
      return;
    }
    if (err instanceof DomainError && err.code === DomainErrorCode.BOOSTER_NOT_APPROVED) {
      await interaction.reply({ content: `❌ **Booster Approval Required**: ${err.message}`, ephemeral: true });
      return;
    }
    console.error(`[OrderDiscord] Error during presign for order #${orderId}:`, err);
    await interaction.reply({
      content: `❌ **Pre-sign Failed**: ${err?.message || 'An unexpected error occurred.'}`,
      ephemeral: true,
    });
    return;
  }
}

/**
 * Handles Mythic+ Key Owner button clicks (presign_key).
 */
export async function handleKeyOwnerButton(
  interaction: ButtonInteraction,
  orderId: number
): Promise<void> {
  const userId = interaction.user.id;
  await ensureUserExists(userId, interaction.user.username);

  try {
    const result = await toggleBoosterKeyOwner(orderId, userId);
    let msg = `🔑 **Key Owner Declared**: Registered your Mythic+ key declaration (${result.keyDetails || '+10 Key'}) for Order #${orderId}.`;
    if (result.outcome === 'key_revoked') {
      msg = `↩️ **Key Declaration Revoked**: Removed your Key Owner declaration for Order #${orderId}.`;
    } else if (result.outcome === 'key_updated') {
      msg = `🔑 **Key Declaration Updated**: Updated your Mythic+ key declaration for Order #${orderId}.`;
    }

    await interaction.reply({ content: msg, ephemeral: true });

    publishOrRefreshOrderCard(interaction.client, orderId).catch((err) =>
      console.warn('[OrderDiscord] Card refresh error after key declare:', err)
    );
    publishOrUpdateOrderReviewDashboard(interaction.client, orderId).catch((err) =>
      console.warn('[OrderDiscord] Review dashboard refresh error after key declare:', err)
    );
  } catch (err: any) {
    await interaction.reply({
      content: `❌ **Key Declaration Failed**: ${err?.message || 'An unexpected error occurred.'}`,
      ephemeral: true,
    });
  }
}

/**
 * Handles pre-sign withdrawal button clicks (presign_withdraw).
 */
export async function handlePresignWithdrawButton(
  interaction: ButtonInteraction,
  orderId: number
): Promise<void> {
  const userId = interaction.user.id;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    await interaction.reply({
      content: `❌ **Order Not Found**: Order #${orderId} does not exist.`,
      ephemeral: true,
    });
    return;
  }

  if (order.status === 'completed' || order.status === 'cancelled') {
    await interaction.reply({
      content: `❌ **Order Closed**: Order #${orderId} is closed.`,
      ephemeral: true,
    });
    return;
  }

  const activePresign = await prisma.orderPresign.findFirst({
    where: {
      orderId,
      userId,
      status: 'registered',
    },
  });

  if (!activePresign) {
    await interaction.reply({
      content: `ℹ️ You do not have an active pre-sign on Order #${orderId}.`,
      ephemeral: true,
    });
    return;
  }

  await prisma.orderPresign.update({
    where: { id: activePresign.id },
    data: { status: 'withdrawn', registeredRole: 'withdrawn', hasKey: 'no' },
  });

  await interaction.reply({
    content: `↩️ **Pre-sign Withdrawn**: Your application on Order #${orderId} has been withdrawn.`,
    ephemeral: true,
  });

  // Refresh Discord card & review dashboard to reflect updated counts
  publishOrRefreshOrderCard(interaction.client, orderId).catch((err) =>
    console.warn('[OrderDiscord] Card refresh error after withdrawal:', err)
  );
  publishOrUpdateOrderReviewDashboard(interaction.client, orderId).catch((err) =>
    console.warn('[OrderDiscord] Review dashboard refresh error after withdrawal:', err)
  );
}

/**
 * Handles the 'View Details' button click (order_view).
 */
export async function handleOrderViewButton(
  interaction: ButtonInteraction,
  orderId: number
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
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
    await interaction.reply({
      content: `❌ Order #${orderId} not found.`,
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📋 Details for Order #${order.id} • ${order.orderRef}`)
    .setDescription(
      `**Game:** ${order.game.displayName}\n` +
        `**Service:** ${order.service.displayName}\n` +
        `**Status:** \`${order.status}\`\n` +
        `**Mode:** ${order.orderMode} (${order.orderType})\n` +
        `**Total Runs:** ${order.runs.length} / ${order.quantity}`
    );

  if (order.presigns.length > 0) {
    const list = order.presigns
      .map((p) => `• **${p.registeredRole.toUpperCase()}:** ${p.user.displayName || p.user.username} (<@${p.userId}>)`)
      .join('\n');
    embed.addFields({ name: 'Active Pre-signs', value: list, inline: false });
  } else {
    embed.addFields({ name: 'Active Pre-signs', value: '*None registered yet.*', inline: false });
  }

  if (order.assignments.length > 0) {
    const list = order.assignments
      .map((a) => `• **${a.assignedRole.toUpperCase()}:** ${a.user.displayName || a.user.username} (<@${a.userId}>)`)
      .join('\n');
    embed.addFields({ name: 'Confirmed Assignments', value: list, inline: false });
  }

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}
