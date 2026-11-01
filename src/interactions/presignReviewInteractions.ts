/**
 * presignReviewInteractions.ts — Handlers for #pre-signs review dashboard interactions
 *
 * Enforces creator/advertiser privacy isolation:
 * Advertisers can only review and manage orders they own.
 * Cross-customer applicant leakage is strictly prevented via ephemeral views and authorization guards.
 */

import {
  ActionRowBuilder,
  ButtonInteraction,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';
import prisma from '../database/db';
import {
  formatRolesDisplay,
  isMythicPlusOrder,
  parsePresignRoles,
  publishOrUpdateOrderReviewDashboard,
  verifyReviewActorPermissions,
  assignSelectedApplicants,
} from '../services/presignReviewService';
import { DomainError } from '../services/domainErrors';

/**
 * Main dispatcher for review dashboard buttons (review_apps, review_premades, review_assign, review_refresh).
 */
export async function handleReviewDashboardButton(
  interaction: ButtonInteraction,
  action: string,
  orderId: number
): Promise<void> {
  const actorId = interaction.user.id;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      game: true,
      service: true,
      requiredRoles: true,
      keyRequirements: true,
      presigns: {
        include: { user: true, character: true },
      },
      assignments: {
        include: { user: true },
      },
    },
  });

  if (!order) {
    await interaction.reply({
      content: `❌ **Order Not Found**: Order #${orderId} does not exist.`,
      ephemeral: true,
    });
    return;
  }

  // Authorize Actor: Order Creator / Advertiser or Staff only!
  try {
    await verifyReviewActorPermissions(actorId, order);
  } catch (authErr: any) {
    await interaction.reply({
      content: `❌ **Access Denied**: You are not authorized to view applicants for Order #${orderId}. Advertisers may only review their own orders.`,
      ephemeral: true,
    });
    return;
  }

  switch (action) {
    case 'review_apps': {
      await handleInspectApplicantsEphemeral(interaction, order);
      break;
    }
    case 'review_premades': {
      await handleViewPremadesEphemeral(interaction, order);
      break;
    }
    case 'review_assign': {
      await handleAssignViewEphemeral(interaction, order);
      break;
    }
    case 'review_refresh': {
      await publishOrUpdateOrderReviewDashboard(interaction.client, order.id);
      await interaction.reply({
        content: `🔄 **Dashboard Refreshed**: Order #${order.id} review dashboard is up to date.`,
        ephemeral: true,
      });
      break;
    }
    default: {
      await interaction.reply({
        content: `❌ Unknown review action: ${action}`,
        ephemeral: true,
      });
    }
  }
}

/**
 * Ephemeral detailed applicant inspection view (private to the authorized creator).
 */
async function handleInspectApplicantsEphemeral(
  interaction: ButtonInteraction,
  order: any
): Promise<void> {
  const activePresigns = order.presigns.filter((p: any) => p.status === 'registered');
  const isMythic = isMythicPlusOrder(order);

  const embed = new EmbedBuilder()
    .setTitle(`👥 Applicant Inspection — Order #${order.id}`)
    .setDescription(`Authorized Creator Review for **${order.orderName || order.orderRef}**`)
    .setColor(0x5865f2)
    .setTimestamp();

  if (activePresigns.length === 0) {
    embed.addFields({
      name: 'No Active Applicants',
      value: 'There are currently no boosters registered for this order.',
    });
  } else {
    // Deduplicate by userId
    const unique = new Map<string, any>();
    for (const p of activePresigns) {
      if (!unique.has(p.userId)) unique.set(p.userId, p);
    }

    const lines: string[] = [];
    for (const [uid, p] of unique.entries()) {
      const username = p.user?.username || uid;
      const roles = parsePresignRoles(p.registeredRole);
      const hasKey = p.hasKey === 'yes';
      const keyVerified = p.keyVerified === true;
      const keyStr = hasKey
        ? ` | 🔑 Key +${p.keyLevel || 10} (${keyVerified ? 'Verified' : 'Self-declared'})`
        : '';

      const charInfo = p.character
        ? ` [${p.character.characterName}-${p.character.realm} (${p.character.itemLevel || '?'} ilvl)]`
        : '';

      if (isMythic) {
        if (roles.length > 0) {
          lines.push(`• **${username}** (<@${uid}>) — Roles: \`${formatRolesDisplay(roles)}\`${charInfo}${keyStr}`);
        } else if (hasKey) {
          lines.push(`• **${username}** (<@${uid}>) — 🔑 Key +${p.keyLevel || 10} [Key Available Only]`);
        } else {
          lines.push(`• **${username}** (<@${uid}>) — Registered`);
        }
      } else {
        lines.push(`• **${username}** (<@${uid}>)${charInfo}`);
      }
    }

    embed.addFields({
      name: `Unique Registered Boosters (${unique.size})`,
      value: lines.slice(0, 20).join('\n') + (lines.length > 20 ? `\n_...and ${lines.length - 20} more_` : ''),
    });
  }

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

/**
 * Ephemeral view of registered Premade Squads.
 */
async function handleViewPremadesEphemeral(
  interaction: ButtonInteraction,
  order: any
): Promise<void> {
  const squadIds: number[] = Array.from(
    new Set(
      order.presigns
        .filter((p: any) => p.squadId && p.status === 'registered')
        .map((p: any) => p.squadId as number)
    )
  );

  const premades: any[] = squadIds.length > 0
    ? await prisma.premadeSquad.findMany({
        where: { id: { in: squadIds } },
        include: {
          members: {
            where: { status: 'accepted' },
            include: { user: true, character: true },
          },
        },
      })
    : [];

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ Premade Squads — Order #${order.id}`)
    .setDescription(`Premade applications for **${order.orderName || order.orderRef}**`)
    .setColor(0x2ecc71)
    .setTimestamp();

  if (premades.length === 0) {
    embed.addFields({
      name: 'No Premade Applications',
      value: 'No Duo, Trio, or full Squad teams have applied for this order yet.',
    });
  } else {
    for (const sq of premades) {
      const memberList = sq.members
        .map((m: any) => `• <@${m.userId}> (${m.user?.username || m.userId}) — \`${m.memberRole || 'booster'}\``)
        .join('\n');

      embed.addFields({
        name: `Team: ${sq.teamName} [${sq.squadType.toUpperCase()} - ${sq.members.length} Members]`,
        value: memberList || 'No accepted members',
      });
    }
  }

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

/**
 * Ephemeral interactive assignment view.
 */
async function handleAssignViewEphemeral(
  interaction: ButtonInteraction,
  order: any
): Promise<void> {
  if (['assigned', 'in_progress', 'completed', 'cancelled'].includes(order.status)) {
    await interaction.reply({
      content: `ℹ️ **Order Closed**: Order #${order.id} is already in state **${order.status.toUpperCase()}**.`,
      ephemeral: true,
    });
    return;
  }

  const activePresigns = order.presigns.filter((p: any) => p.status === 'registered');
  const uniqueUsers = new Map<string, any>();
  for (const p of activePresigns) {
    if (!uniqueUsers.has(p.userId)) uniqueUsers.set(p.userId, p);
  }

  const squadIds: number[] = Array.from(
    new Set(
      order.presigns
        .filter((p: any) => p.squadId && p.status === 'registered')
        .map((p: any) => p.squadId as number)
    )
  );

  const premades: any[] = squadIds.length > 0
    ? await prisma.premadeSquad.findMany({
        where: { id: { in: squadIds } },
        include: { members: { where: { status: 'accepted' }, include: { user: true } } },
      })
    : [];

  const embed = new EmbedBuilder()
    .setTitle(`⚙️ Assign Applicants — Order #${order.id}`)
    .setDescription(
      `Select an eligible Premade Squad or Individual Boosters to assign to this order.\n` +
      `Mythic+ requires: **1 Tank, 1 Healer, 2 DPS**.`
    )
    .setColor(0xe67e22);

  // If a 4-man squad is available, provide one-click assignment button
  const fullSquad = premades.find((p) => p.members.length === 4);

  const rows: ActionRowBuilder<any>[] = [];

  if (fullSquad) {
    embed.addFields({
      name: 'Available Full Squad',
      value: `Team **${fullSquad.teamName}** is ready for full assignment.`,
    });
  }

  embed.addFields({
    name: 'Individual Candidates Available',
    value: `${uniqueUsers.size} boosters registered. Click assign or use management dashboard.`,
  });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}
