/**
 * assign.ts — Command-Based Final Assignment for G4X Community Boost Orders
 *
 * Syntax:
 *  G4!assign <orderId> <participants...>
 *
 * Examples:
 *  G4!assign 1820 @Booster1 @Booster2 @Booster3 @Booster4
 *  G4!assign #1820 team:42
 *  G4!assign 1820 team:42 @Booster3 @Booster4
 *  G4!assign #1820 team:42 @Booster4
 *
 * Enforces:
 *  - Order creator or management RBAC authorization
 *  - Explicit team:ID expansion with accepted membership & consent
 *  - Authoritative Discord user ID deduplication
 *  - Rejection of duplicate slots, unapproved participants, unpresigned users, and active double-bookings
 *  - Exact 1 Tank, 1 Healer, 2 DPS Mythic+ role matching via flexible backtracking
 *  - Atomicity, AuditLog, and private execution channel provisioning
 */

import { Message, EmbedBuilder } from 'discord.js';
import prisma from '../database/db';
import { DomainError, DomainErrorCode } from '../services/domainErrors';
import {
  isMythicPlusOrder,
  flexibleMythicRoleMatch,
  verifyReviewActorPermissions,
  assignSelectedApplicants,
  getUserEligibleRoles,
  parsePresignRoles,
  formatRolesDisplay,
} from '../services/presignReviewService';
import { ensureOrderAcceptsOperations } from '../services/orderValidationService';

export interface ParsedParticipants {
  userIds: string[];
  squadIds: number[];
  userSquadMap: Map<string, number>;
}

/**
 * Parses participants from tokens, separating team:ID references from individual user mentions.
 */
export async function parseAssignmentParticipants(
  tokens: string[]
): Promise<ParsedParticipants> {
  const userIds: string[] = [];
  const squadIds: number[] = [];
  const userSquadMap = new Map<string, number>();

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    // 1. Check for team:<id> syntax
    const teamMatch = trimmed.match(/^#?team:\s*#?(\d+)$/i);
    if (teamMatch) {
      const squadId = Number(teamMatch[1]);
      if (isNaN(squadId) || squadId <= 0) {
        throw new DomainError(
          DomainErrorCode.SQUAD_NOT_FOUND,
          `Invalid team ID format: '${token}'. Expected format: 'team:42'`
        );
      }
      squadIds.push(squadId);

      const squad = await prisma.premadeSquad.findUnique({
        where: { id: squadId },
        include: {
          members: {
            include: { user: true },
          },
        },
      });

      if (!squad || squad.status === 'disbanded') {
        throw new DomainError(
          DomainErrorCode.SQUAD_NOT_FOUND,
          `Premade team 'team:${squadId}' does not exist or has been disbanded.`
        );
      }

      if (squad.status !== 'active') {
        throw new DomainError(
          DomainErrorCode.SQUAD_NOT_APPROVED,
          `Premade team '${squad.teamName}' (team:${squadId}) is not active/approved (status: '${squad.status}').`
        );
      }

      const unaccepted = squad.members.find((m) => m.status !== 'accepted');
      if (unaccepted) {
        throw new DomainError(
          DomainErrorCode.SQUAD_MEMBER_NOT_ACCEPTED,
          `Premade team '${squad.teamName}' (team:${squadId}) has members without confirmed consent (member: <@${unaccepted.userId}>, status: '${unaccepted.status}').`
        );
      }

      if (squad.members.length < 2) {
        throw new DomainError(
          DomainErrorCode.SQUAD_INVALID_SIZE,
          `Team '${squad.teamName}' (team:${squadId}) has fewer than 2 accepted members.`
        );
      }

      for (const m of squad.members) {
        userIds.push(m.userId);
        userSquadMap.set(m.userId, squad.id);
      }
      continue;
    }

    // 2. Check for individual user mention or snowflake ID
    const userMentionMatch = trimmed.match(/^<@!?([a-zA-Z0-9_\-\.]{3,64})>$/);
    const rawIdMatch = trimmed.match(/^(\d{17,20})$/);

    if (userMentionMatch) {
      userIds.push(userMentionMatch[1]);
      continue;
    }

    if (rawIdMatch) {
      userIds.push(rawIdMatch[1]);
      continue;
    }

    // 3. Unrecognized token
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Unrecognized participant token: '${token}'. Use '@User' mentions or 'team:<id>' syntax (e.g. 'team:42').`
    );
  }

  return { userIds, squadIds, userSquadMap };
}

/**
 * Handles the G4!assign command.
 */
export async function handleAssignCommand(
  message: Message,
  args: string[]
): Promise<void> {
  const actorId = message.author.id;

  // 1. Validate argument presence
  if (args.length < 2) {
    await message.reply({
      content:
        '❌ **Invalid Assignment Syntax**\n' +
        '**Usage:** `G4!assign <orderId> <participants...>`\n\n' +
        '**Examples:**\n' +
        '• Assign 4 individuals: `G4!assign 1820 @Booster1 @Booster2 @Booster3 @Booster4`\n' +
        '• Assign a premade squad: `G4!assign #1820 team:42`\n' +
        '• Assign team + individuals: `G4!assign 1820 team:42 @Booster3 @Booster4`\n' +
        '• Assign trio team + 1 booster: `G4!assign #1820 team:42 @Booster4`',
    });
    return;
  }

  const rawOrderId = args[0].replace(/^#/, '').trim();
  const participantTokens = args.slice(1);

  // 2. Resolve order
  const orderId = Number(rawOrderId);
  const order = await prisma.order.findFirst({
    where: {
      OR: [
        ...(isNaN(orderId) ? [] : [{ id: orderId }]),
        { orderRef: rawOrderId },
        { orderRef: `G4X-${rawOrderId}` },
      ],
    },
    include: {
      game: true,
      service: true,
      requiredRoles: true,
      keyRequirements: true,
      presigns: {
        include: { user: true, character: true },
      },
      assignments: {
        where: { status: 'assigned' },
      },
    },
  });

  if (!order) {
    await message.reply({
      content: `❌ **Order Not Found**: Could not find an active boost order matching \`${args[0]}\`.`,
    });
    return;
  }

  // 3. Ensure order is in valid state for assignment
  try {
    ensureOrderAcceptsOperations(order);
  } catch (err: any) {
    await message.reply({
      content: `❌ **Order Unavailable**: Order #${order.id} is currently \`${order.status.toUpperCase()}\` and cannot be assigned.`,
    });
    return;
  }

  if (order.status !== 'open_presign') {
    await message.reply({
      content: `❌ **Order Not Open for Assignment**: Order #${order.id} is in status \`${order.status.toUpperCase()}\`.`,
    });
    return;
  }

  // 4. Verify Actor Authorization (Order Creator or Management only)
  try {
    await verifyReviewActorPermissions(actorId, order);
  } catch (authErr: any) {
    await message.reply({
      content:
        `❌ **Permission Denied**: You are not authorized to assign participants to Order #${order.id}.\n` +
        `Only the legitimate order creator or authorized staff can assign orders.`,
    });
    return;
  }

  // 5. Parse participant tokens
  let parsed: ParsedParticipants;
  try {
    parsed = await parseAssignmentParticipants(participantTokens);
  } catch (parseErr: any) {
    await message.reply({
      content: `❌ **Participant Resolution Error**: ${parseErr.message}`,
    });
    return;
  }

  if (parsed.userIds.length === 0) {
    await message.reply({
      content: '❌ **No Participants Provided**: Please specify at least one valid booster or team:ID.',
    });
    return;
  }

  // 6. Deduplication Check
  const seenUserIds = new Set<string>();
  for (const uid of parsed.userIds) {
    if (seenUserIds.has(uid)) {
      await message.reply({
        content:
          `❌ **Duplicate Participant**: Booster <@${uid}> is specified more than once.\n` +
          `A booster cannot occupy multiple execution slots on the same order.`,
      });
      return;
    }
    seenUserIds.add(uid);
  }

  // 7. Validate each participant's status, approval, presign, and reservations
  for (const uid of parsed.userIds) {
    // a. User exists and is active
    const user = await prisma.user.findUnique({ where: { discordId: uid } });
    if (!user || !user.isActive) {
      await message.reply({
        content: `❌ **Ineligible Booster**: User <@${uid}> does not exist or has an inactive account.`,
      });
      return;
    }

    // b. Booster game approval
    const boosterApproval = await prisma.userGameApproval.findFirst({
      where: {
        userId: uid,
        gameSlug: { in: [order.gameSlug, 'wow_midnight', 'wow'] },
        approvalType: 'booster',
        status: 'approved',
      },
    });

    if (!boosterApproval) {
      await message.reply({
        content: `❌ **Unapproved Booster**: Booster <@${uid}> is not an approved booster for **${order.gameSlug}**.`,
      });
      return;
    }

    // c. Pilot approval if order is Pilot
    if (order.orderMode === 'pilot' || order.orderType === 'pilot') {
      const pilotApproval = await prisma.userGameApproval.findFirst({
        where: {
          userId: uid,
          gameSlug: { in: [order.gameSlug, 'wow_midnight', 'wow'] },
          approvalType: 'pilot',
          status: 'approved',
        },
      });

      if (!pilotApproval) {
        await message.reply({
          content: `❌ **Pilot Qualification Required**: Booster <@${uid}> lacks approved Pilot qualification for this order.`,
        });
        return;
      }
    }

    // d. Must have pre-signed for this order
    const presign = await prisma.orderPresign.findFirst({
      where: {
        orderId: order.id,
        userId: uid,
        status: 'registered',
      },
    });

    if (!presign) {
      await message.reply({
        content:
          `❌ **Unregistered Candidate**: Booster <@${uid}> has not pre-signed for Order #${order.id}.\n` +
          `All assigned boosters must express interest via pre-sign before assignment.`,
      });
      return;
    }

    // e. Active reservation check (Double-booking prevention)
    const activeRes = await prisma.boosterReservation.findFirst({
      where: { userId: uid, status: 'active' },
    });

    if (activeRes && activeRes.orderId !== order.id) {
      await message.reply({
        content:
          `❌ **Conflicting Reservation**: Booster <@${uid}> already has an active execution reservation on Order #${activeRes.orderId}.\n` +
          `Double-booking is strictly prohibited.`,
      });
      return;
    }
  }

  // 8. Role Matching & Composition
  const isMythic = isMythicPlusOrder(order);
  const assignmentPlan: Array<{ userId: string; assignedRole: string; squadId?: number | null }> = [];

  if (isMythic) {
    // Mythic+ requires exactly 4 distinct boosters
    if (parsed.userIds.length !== 4) {
      await message.reply({
        content:
          `❌ **Invalid Mythic+ Composition Count**: Mythic+ orders require exactly 4 boosters (1 Tank, 1 Healer, 2 DPS).\n` +
          `Received: **${parsed.userIds.length}** booster(s).`,
      });
      return;
    }

    // Gather candidate role profiles
    const memberRoleProfiles: Array<{ userId: string; roles: string[] }> = [];

    for (const uid of parsed.userIds) {
      const presign = order.presigns.find((p) => p.userId === uid && p.status === 'registered');
      const presignRoles = presign ? parsePresignRoles(presign.registeredRole) : [];
      const eligibleCharacterRoles = await getUserEligibleRoles(uid, order.gameSlug);

      // Candidate roles: union of presign roles and character approval roles, filtered to mythic execution roles
      const allRoles = Array.from(new Set([...presignRoles, ...eligibleCharacterRoles]))
        .map((r) => r.toLowerCase())
        .filter((r) => ['tank', 'healer', 'dps'].includes(r));

      if (allRoles.length === 0) {
        await message.reply({
          content: `❌ **Missing Execution Role**: Booster <@${uid}> has no valid Mythic+ execution role (Tank, Healer, DPS).`,
        });
        return;
      }

      memberRoleProfiles.push({ userId: uid, roles: allRoles });
    }

    // Solve 1 Tank, 1 Healer, 2 DPS matching
    const match = flexibleMythicRoleMatch(memberRoleProfiles);
    if (!match.success || !match.assignment) {
      const rolesSummary = memberRoleProfiles
        .map((m) => `• <@${m.userId}>: ${formatRolesDisplay(m.roles)}`)
        .join('\n');

      await message.reply({
        content:
          `❌ **Mythic+ Role Incompatibility**: The selected 4 boosters cannot form the required **1 Tank, 1 Healer, 2 DPS** composition.\n\n` +
          `**Available Roles:**\n${rolesSummary}`,
      });
      return;
    }

    for (const [uid, assignedRole] of Object.entries(match.assignment)) {
      assignmentPlan.push({
        userId: uid,
        assignedRole,
        squadId: parsed.userSquadMap.get(uid) ?? null,
      });
    }
  } else {
    // Non-Mythic orders (Pilot or Non-Pilot)
    let requiredSlots = 1;
    if (order.requiredRoles && order.requiredRoles.length > 0) {
      requiredSlots = order.requiredRoles.reduce((sum, r) => sum + r.quantity, 0);
    } else if (order.quantity && order.quantity > 0) {
      requiredSlots = order.quantity;
    }

    if (parsed.userIds.length !== requiredSlots) {
      await message.reply({
        content:
          `❌ **Booster Count Mismatch**: Order #${order.id} requires exactly **${requiredSlots}** booster(s).\n` +
          `Received: **${parsed.userIds.length}** participant(s).`,
      });
      return;
    }

    for (const uid of parsed.userIds) {
      assignmentPlan.push({
        userId: uid,
        assignedRole: 'booster',
        squadId: parsed.userSquadMap.get(uid) ?? null,
      });
    }
  }

  // 9. Execute Atomic Final Assignment Transaction
  try {
    const primarySquadId = parsed.squadIds.length === 1 ? parsed.squadIds[0] : undefined;

    const assignResult = await assignSelectedApplicants({
      orderId: order.id,
      actorId,
      assignments: assignmentPlan,
      squadId: primarySquadId,
      discordClient: message.client,
    });

    // 10. Build Success Confirmation Embed
    const embed = new EmbedBuilder()
      .setTitle(`✅ Order #${order.id} Assigned Successfully`)
      .setColor(0x2ecc71)
      .setDescription(
        `Order **${order.orderName || order.orderRef}** has been assigned and moved to \`ASSIGNED\` status.\n` +
        `🔒 A private execution channel has been provisioned with strict access controls.`
      )
      .addFields(
        {
          name: 'Order Reference',
          value: `\`${order.orderRef}\``,
          inline: true,
        },
        {
          name: 'Service',
          value: order.service?.displayName || order.gameSlug,
          inline: true,
        },
        {
          name: 'Assigned By',
          value: `<@${actorId}>`,
          inline: true,
        }
      );

    const rosterLines = assignResult.assignments.map((a: any) => {
      let icon = '👤';
      const role = a.assignedRole.toLowerCase();
      if (role === 'tank') icon = '🛡️';
      else if (role === 'healer') icon = '💚';
      else if (role === 'dps') icon = '⚔️';
      return `• ${icon} **${a.assignedRole.toUpperCase()}:** <@${a.userId}>`;
    });

    embed.addFields({
      name: `Assigned Execution Roster (${assignResult.assignments.length})`,
      value: rosterLines.join('\n'),
      inline: false,
    });

    if (parsed.squadIds.length > 0) {
      embed.addFields({
        name: 'Premade Squads Involved',
        value: parsed.squadIds.map((sid) => `• \`team:${sid}\``).join('\n'),
        inline: false,
      });
    }

    embed.setFooter({
      text: 'G4X Community • Execution Team Finalized • Safe Platform Policy Enforced',
    });
    embed.setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (assignErr: any) {
    console.error(`[AssignCommand] Error executing assignment for Order #${order.id}:`, assignErr);
    await message.reply({
      content: `❌ **Assignment Failed**: ${assignErr.message || 'An unexpected error occurred during assignment.'}`,
    });
  }
}
