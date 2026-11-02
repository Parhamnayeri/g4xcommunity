/**
 * presignReviewService.ts — Advanced Pre-sign, Premade Applications & Private Assignment Review
 *
 * G4X Community — Order Lifecycle & Pre-sign Review Engine
 * Stack: Node.js, TypeScript, Discord.js v14, Prisma, SQLite
 *
 * Core Features:
 *  1. Multi-role Booster Eligibility & Pre-sign (Tank, Healer, DPS, multi-role express)
 *  2. Deduplicated single logical applicant record per order
 *  3. Key Owner capability declaration (not a 5th role, separate capability)
 *  4. Premade Squad applications (Duo, Trio, Squad with consent validation & flexible matching)
 *  5. Private #pre-signs review channel with creator/advertiser access isolation
 *  6. Single clean, mobile-friendly applicant dashboard message updated in place
 *  7. Authorized applicant review, slot validation, double-booking protection & final assignment
 *  8. Zero premature financial side effects (no escrow release, no wallet updates)
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
} from 'discord.js';
import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import { ensureOrderAcceptsOperations } from './orderValidationService';
import { validatePremadeSquad } from './squadValidationService';
import { publishOrRefreshOrderCard } from './orderDiscordService';
import { getOrCreateOrderExecutionChannel } from './orderExecutionChannelService';
import { Prisma } from '@prisma/client';

// ─── HELPER: ROLE PARSING & FORMATTING ────────────────────────────────────────

const KNOWN_EXECUTION_ROLES = ['tank', 'healer', 'dps', 'booster', 'pilot'];

/**
 * Parses comma-separated registered roles into a normalized array.
 */
export function parsePresignRoles(registeredRole: string | null | undefined): string[] {
  if (!registeredRole) return [];
  const parts = registeredRole
    .toLowerCase()
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  // Filter out meta tags like 'withdrawn', 'key_available', 'solo', 'pilot', 'team'
  return parts.filter((r) => KNOWN_EXECUTION_ROLES.includes(r));
}

/**
 * Formats roles array into readable English string (e.g. "Tank, DPS").
 */
export function formatRolesDisplay(roles: string[]): string {
  if (!roles || roles.length === 0) return 'None';
  return roles
    .map((r) => {
      if (r === 'dps') return 'DPS';
      return r.charAt(0).toUpperCase() + r.slice(1);
    })
    .join(', ');
}

/**
 * Determines whether an order is a Mythic+ boost.
 */
export function isMythicPlusOrder(order: any): boolean {
  if (order.service?.serviceKey === 'mythic_plus') return true;
  if (typeof order.orderName === 'string' && order.orderName.toLowerCase().includes('mythic')) return true;
  if (
    order.requiredRoles &&
    order.requiredRoles.some((r: any) => ['tank', 'healer', 'dps'].includes(r.roleName?.toLowerCase()))
  ) {
    return true;
  }
  return false;
}

// ─── 1. AUTHORITATIVE BOOSTER ROLE ELIGIBILITY ───────────────────────────────

const WOW_TANK_SPECS = ['blood', 'protection', 'brewmaster', 'guardian', 'vengeance'];
const WOW_HEALER_SPECS = ['restoration', 'holy', 'discipline', 'mistweaver', 'preservation'];

/**
 * Validates which execution roles (tank, healer, dps) a booster authoritatively qualifies for.
 * Uses UserGameApproval, active WowCharacters, specs and RaiderIO scores.
 */
export async function getUserEligibleRoles(
  userId: string,
  gameSlug: string = 'wow_midnight',
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string[]> {
  const user = await client.user.findUnique({
    where: { discordId: userId },
    include: { userRoles: true },
  });

  if (!user || !user.isActive) return [];

  // Staff/Management are eligible for all roles in testing/management
  const isManagement = user.userRoles.some((r) =>
    ['owner', 'manager', 'admin', 'staff'].includes(r.roleKey)
  );

  // Check Game Booster Approval
  const approval = await client.userGameApproval.findFirst({
    where: {
      userId,
      gameSlug: { in: [gameSlug, 'wow', 'wow_midnight'] },
      approvalType: 'booster',
      status: 'approved',
    },
  });

  const hasBoosterRole = user.userRoles.some((r) => r.roleKey === 'booster');

  if (!isManagement && !approval && !hasBoosterRole) {
    return [];
  }

  // Check reviewNote on approval for explicit role constraints (e.g. "roles:tank" or "tank_only")
  if (approval?.reviewNote) {
    const lowerNotes = approval.reviewNote.toLowerCase();
    const explicitRoles: string[] = [];
    if (lowerNotes.includes('tank')) explicitRoles.push('tank');
    if (lowerNotes.includes('healer')) explicitRoles.push('healer');
    if (lowerNotes.includes('dps')) explicitRoles.push('dps');
    if (explicitRoles.length > 0) {
      return explicitRoles;
    }
  }

  // Check active WoW characters of the user
  const characters = await client.wowCharacter.findMany({
    where: { userId, isActive: true },
  });

  if (characters.length > 0) {
    const eligible = new Set<string>();

    for (const char of characters) {
      // 1. Tank qualification
      if (char.tankScore && char.tankScore > 0) {
        eligible.add('tank');
      } else if (char.activeSpec && WOW_TANK_SPECS.includes(char.activeSpec.toLowerCase())) {
        eligible.add('tank');
      }

      // 2. Healer qualification
      if (char.healerScore && char.healerScore > 0) {
        eligible.add('healer');
      } else if (char.activeSpec && WOW_HEALER_SPECS.includes(char.activeSpec.toLowerCase())) {
        eligible.add('healer');
      }

      // 3. DPS qualification
      if (char.dpsScore && char.dpsScore > 0) {
        eligible.add('dps');
      } else if (
        char.activeSpec &&
        !WOW_TANK_SPECS.includes(char.activeSpec.toLowerCase()) &&
        !WOW_HEALER_SPECS.includes(char.activeSpec.toLowerCase())
      ) {
        eligible.add('dps');
      }
    }

    const pilotApproval = await client.userGameApproval.findFirst({
      where: {
        userId,
        gameSlug: { in: [gameSlug, 'wow', 'wow_midnight'] },
        approvalType: 'pilot',
        status: 'approved',
      },
    });

    // If characters exist with designated roles/scores, return those roles
    if (eligible.size > 0) {
      eligible.add('booster');
      if (pilotApproval) eligible.add('pilot');
      return Array.from(eligible);
    }
  }

  const pilotApproval = await client.userGameApproval.findFirst({
    where: {
      userId,
      gameSlug: { in: [gameSlug, 'wow', 'wow_midnight'] },
      approvalType: 'pilot',
      status: 'approved',
    },
  });

  // Default fallback for approved boosters without character segregation: all roles + booster + pilot (if approved)
  return ['tank', 'healer', 'dps', 'booster', ...(pilotApproval ? ['pilot'] : [])];
}

// ─── 2. MULTI-ROLE PRE-SIGN & TOGGLE ─────────────────────────────────────────

export interface ToggleRoleResult {
  outcome: 'role_added' | 'role_removed' | 'role_removed_key_retained' | 'withdrawn' | 'registered' | 'already_registered';
  presign: any;
  activeRoles: string[];
}

/**
 * Toggles an execution role for a booster on a specific order.
 * Ensures ONE logical applicant record per order and updates preferences in place.
 */
export async function toggleBoosterRolePresign(
  orderId: number,
  userId: string,
  role: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<ToggleRoleResult> {
  const normRole = role.toLowerCase().trim();
  if (!KNOWN_EXECUTION_ROLES.includes(normRole)) {
    throw new DomainError(DomainErrorCode.INVALID_ASSIGNED_ROLE, `Unknown execution role: ${role}`);
  }

  const order = await client.order.findUnique({
    where: { id: orderId },
    include: { requiredRoles: true, service: true },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} not found`);
  }

  if (order.status === 'completed' || order.status === 'cancelled') {
    throw new DomainError(
      DomainErrorCode.ORDER_ALREADY_CLOSED,
      `❌ **Order Closed**: Order #${orderId} is closed.`
    );
  }

  ensureOrderAcceptsOperations(order);

  if (order.status !== 'open_presign') {
    throw new DomainError(
      DomainErrorCode.ORDER_NOT_OPEN_FOR_CLAIMS,
      `Order #${orderId} is not open for pre-sign (status: ${order.status})`
    );
  }

  // Payment verification guard
  if (order.paymentStatus !== 'verified' && order.paymentStatus !== 'unneeded') {
    throw new DomainError(
      DomainErrorCode.PAYMENT_NOT_VERIFIED,
      `Order #${orderId} cannot be claimed. Payment status is '${order.paymentStatus}'`
    );
  }

  // Presign deadline guard
  if (order.presignDeadline && new Date() > order.presignDeadline) {
    throw new DomainError(
      DomainErrorCode.PRESIGN_WINDOW_CLOSED,
      `Presign deadline for order #${orderId} has expired.`
    );
  }

  // Validate booster approval status
  const approval = await client.userGameApproval.findFirst({
    where: {
      userId,
      gameSlug: { in: [order.gameSlug, 'wow', 'wow_midnight'] },
      OR: [{ serviceId: null }, { serviceId: order.serviceId }],
      approvalType: order.orderMode === 'pilot' ? 'pilot' : 'booster',
      status: 'approved',
    },
  });

  const user = await client.user.findUnique({
    where: { discordId: userId },
    include: { userRoles: true },
  });

  const isStaff = user?.userRoles.some((r) => ['owner', 'manager', 'admin', 'staff'].includes(r.roleKey));

  if (!isStaff && !approval) {
    throw new DomainError(
      DomainErrorCode.BOOSTER_NOT_APPROVED,
      `Booster Approval Required: You do not have an approved ${order.orderMode === 'pilot' ? 'Pilot' : 'Booster'} qualification for ${order.gameSlug}.\nPlease apply in the registration channel first.`
    );
  }

  // Validate required roles if defined on order
  if (order.requiredRoles && order.requiredRoles.length > 0) {
    const validRoleNames = order.requiredRoles.map((r) => r.roleName.toLowerCase());
    if (!validRoleNames.includes(normRole)) {
      throw new DomainError(
        DomainErrorCode.INVALID_ASSIGNED_ROLE,
        `Role **${normRole.toUpperCase()}** is not needed for this order. Required: [${validRoleNames.join(', ')}].`
      );
    }
  }

  // Validate booster authoritative eligibility for requested role
  const eligibleRoles = await getUserEligibleRoles(userId, order.gameSlug, client);
  if (!eligibleRoles.includes(normRole)) {
    throw new DomainError(
      DomainErrorCode.INVALID_ASSIGNED_ROLE,
      `You are not eligible to apply as **${normRole.toUpperCase()}** for this order.`
    );
  }

  // Pre-sign applicant pool allows multiple candidates for review
  // (Final role capacity is strictly enforced during assignment)

  // Find existing applicant record
  const existing = await client.orderPresign.findFirst({
    where: { orderId, userId },
  });

  if (existing && existing.status === 'registered') {
    const currentRoles = parsePresignRoles(existing.registeredRole);

    if (currentRoles.includes(normRole)) {
      // Idempotent duplicate click
      return { outcome: 'already_registered', presign: existing, activeRoles: currentRoles };
    } else {
      // Multi-role addition
      const nextRoles = [...currentRoles, normRole].sort();
      const updated = await client.orderPresign.update({
        where: { id: existing.id },
        data: {
          registeredRole: nextRoles.join(','),
          status: 'registered',
        },
      });
      return { outcome: 'role_added', presign: updated, activeRoles: nextRoles };
    }
  }

  // New applicant or reactivating a previously withdrawn pre-sign
  if (existing) {
    const updated = await client.orderPresign.update({
      where: { id: existing.id },
      data: {
        registeredRole: normRole,
        status: 'registered',
      },
    });
    return { outcome: 'registered', presign: updated, activeRoles: [normRole] };
  }

  // Create brand new pre-sign
  const created = await client.orderPresign.create({
    data: {
      orderId,
      userId,
      claimType: 'individual',
      registeredRole: normRole,
      status: 'registered',
      hasKey: 'unknown',
    },
  });

  return { outcome: 'registered', presign: created, activeRoles: [normRole] };
}

// ─── 3. KEY OWNER CAPABILITY DECLARATION ─────────────────────────────────────

export interface KeyOwnerInput {
  keyLevel?: number;
  dungeonName?: string;
}

export interface KeyOwnerResult {
  outcome: 'key_declared' | 'key_revoked' | 'key_updated';
  presign: any;
  hasKey: boolean;
  keyDetails?: string;
}

/**
 * Toggles or updates Mythic+ Key Owner capability for a booster.
 * Associates key ownership directly with existing unique applicant identity.
 * Key Owner is NOT an extra execution slot or automatic assignment.
 */
export async function toggleBoosterKeyOwner(
  orderId: number,
  userId: string,
  keyData?: KeyOwnerInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<KeyOwnerResult> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: { keyRequirements: true, requiredRoles: true },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} not found`);
  }

  ensureOrderAcceptsOperations(order);

  if (order.status !== 'open_presign') {
    throw new DomainError(
      DomainErrorCode.ORDER_NOT_OPEN_FOR_CLAIMS,
      `Order #${orderId} is not open for pre-sign.`
    );
  }

  // Verify booster qualifications
  const eligibleRoles = await getUserEligibleRoles(userId, order.gameSlug, client);
  if (eligibleRoles.length === 0) {
    throw new DomainError(
      DomainErrorCode.BOOSTER_NOT_APPROVED,
      `User '${userId}' is not an approved Booster.`
    );
  }

  const existing = await client.orderPresign.findFirst({
    where: { orderId, userId },
  });

  // Default to order's requested key level if specified
  const targetLevel = keyData?.keyLevel ?? order.keyRequirements?.[0]?.keyLevel ?? 10;
  const targetDungeon = keyData?.dungeonName ?? order.keyRequirements?.[0]?.dungeonName ?? 'Requested Dungeon';

  // If already declared a key and no specific update payload provided, toggle OFF / revoke
  if (existing && existing.hasKey === 'yes' && (!keyData || keyData.keyLevel === undefined)) {
    const roles = parsePresignRoles(existing.registeredRole);

    if (roles.length === 0) {
      // Had no execution roles, so revoking key withdraws application completely
      const updated = await client.orderPresign.update({
        where: { id: existing.id },
        data: {
          hasKey: 'no',
          keyLevel: null,
          keyDungeon: null,
          registeredRole: 'withdrawn',
          status: 'withdrawn',
        },
      });
      return { outcome: 'key_revoked', presign: updated, hasKey: false };
    } else {
      // Retain execution roles, only revoke key
      const updated = await client.orderPresign.update({
        where: { id: existing.id },
        data: {
          hasKey: 'no',
          keyLevel: null,
          keyDungeon: null,
        },
      });
      return { outcome: 'key_revoked', presign: updated, hasKey: false };
    }
  }

  // Declare or update key
  if (existing) {
    const updated = await client.orderPresign.update({
      where: { id: existing.id },
      data: {
        hasKey: 'yes',
        keyLevel: targetLevel,
        keyDungeon: targetDungeon,
        status: 'registered',
      },
    });
    return {
      outcome: existing.hasKey === 'yes' ? 'key_updated' : 'key_declared',
      presign: updated,
      hasKey: true,
      keyDetails: `+${targetLevel} ${targetDungeon}`,
    };
  }

  // Create new applicant identity declaring key without executable role
  const created = await client.orderPresign.create({
    data: {
      orderId,
      userId,
      claimType: 'individual',
      registeredRole: 'key_available',
      hasKey: 'yes',
      keyLevel: targetLevel,
      keyDungeon: targetDungeon,
      status: 'registered',
    },
  });

  return {
    outcome: 'key_declared',
    presign: created,
    hasKey: true,
    keyDetails: `+${targetLevel} ${targetDungeon}`,
  };
}

// ─── 4. PREMADE SQUAD APPLICATIONS (DUO, TRIO, SQUAD) ────────────────────────

export interface PremadeApplicationResult {
  squad: any;
  memberCount: number;
  rolesSummary: string;
  presigns: any[];
}

/**
 * Flexible role matching for multi-role members to ensure a 4-person squad satisfies 1 Tank, 1 Healer, 2 DPS.
 */
export function flexibleMythicRoleMatch(
  members: Array<{ userId: string; roles: string[] }>
): { success: boolean; assignment?: Record<string, string> } {
  if (members.length !== 4) return { success: false };

  const targetSlots = ['tank', 'healer', 'dps', 'dps'];
  const assignment: Record<string, string> = {};

  function backtrack(memberIdx: number, availableSlots: string[]): boolean {
    if (memberIdx === members.length) {
      return availableSlots.length === 0;
    }

    const member = members[memberIdx];
    const candidateRoles = member.roles;

    for (let i = 0; i < availableSlots.length; i++) {
      const slot = availableSlots[i];
      if (candidateRoles.includes(slot)) {
        assignment[member.userId] = slot;
        const nextSlots = [...availableSlots.slice(0, i), ...availableSlots.slice(i + 1)];
        if (backtrack(memberIdx + 1, nextSlots)) {
          return true;
        }
        delete assignment[member.userId];
      }
    }

    return false;
  }

  const ok = backtrack(0, targetSlots);
  return { success: ok, assignment: ok ? assignment : undefined };
}

/**
 * Registers an approved Premade Squad (Duo, Trio, Squad) for an order.
 * Enforces explicit participation consent: all members must have status 'accepted'.
 */
export async function applyPremadeSquadPresign(
  orderId: number,
  squadId: number,
  leaderId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<PremadeApplicationResult> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: { requiredRoles: true, service: true },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} not found`);
  }

  ensureOrderAcceptsOperations(order);

  if (order.status !== 'open_presign') {
    throw new DomainError(
      DomainErrorCode.ORDER_NOT_OPEN_FOR_CLAIMS,
      `Order #${orderId} is not open for pre-sign.`
    );
  }

  // Validate squad with enforceMythicPlusSize: false to allow Duo & Trio
  const squad = await validatePremadeSquad(
    squadId,
    order.gameSlug,
    order.serviceId,
    leaderId,
    client,
    { enforceMythicPlusSize: false }
  );

  const acceptedMembers = squad.members.filter((m) => m.status === 'accepted');

  if (acceptedMembers.length < 2) {
    throw new DomainError(
      DomainErrorCode.SQUAD_INVALID_SIZE,
      `Premade application requires at least 2 accepted members.`
    );
  }

  // For 4-member Squad in Mythic+, verify they cover 1 Tank, 1 Healer, 2 DPS
  if (isMythicPlusOrder(order) && acceptedMembers.length === 4) {
    const memberRoleProfiles: Array<{ userId: string; roles: string[] }> = [];

    for (const m of acceptedMembers) {
      const eligible = await getUserEligibleRoles(m.userId, order.gameSlug, client);
      const squadMemberRole = m.memberRole?.toLowerCase();
      const effectiveRoles = squadMemberRole && eligible.includes(squadMemberRole)
        ? [squadMemberRole]
        : eligible;
      memberRoleProfiles.push({ userId: m.userId, roles: effectiveRoles });
    }

    const match = flexibleMythicRoleMatch(memberRoleProfiles);
    if (!match.success) {
      throw new DomainError(
        DomainErrorCode.INVALID_ASSIGNED_ROLE,
        `Squad '${squad.teamName}' cannot fulfill the required Mythic+ composition (1 Tank, 1 Healer, 2 DPS).`
      );
    }
  }

  // Create or link OrderPresign records for each squad member atomically
  const presigns = [];
  for (const m of acceptedMembers) {
    const existing = await client.orderPresign.findFirst({
      where: { orderId, userId: m.userId },
    });

    const assignedRole = m.memberRole || 'booster';

    if (existing) {
      const updated = await client.orderPresign.update({
        where: { id: existing.id },
        data: {
          squadId: squad.id,
          claimType: 'squad',
          registeredRole: assignedRole,
          status: 'registered',
        },
      });
      presigns.push(updated);
    } else {
      const created = await client.orderPresign.create({
        data: {
          orderId,
          userId: m.userId,
          squadId: squad.id,
          claimType: 'squad',
          registeredRole: assignedRole,
          status: 'registered',
          hasKey: 'unknown',
        },
      });
      presigns.push(created);
    }
  }

  return {
    squad,
    memberCount: acceptedMembers.length,
    rolesSummary: acceptedMembers.map((m) => `${m.user?.username || m.userId} (${m.memberRole || 'booster'})`).join(', '),
    presigns,
  };
}

// ─── 5. PRIVATE #PRE-SIGNS REVIEW CHANNEL & DASHBOARD MESSAGE ───────────────

/**
 * Ensures the private #pre-signs review text channel exists in the guild.
 */
export async function getOrCreatePresignsReviewChannel(
  client: any,
  guildId?: string
): Promise<any> {
  if (!client || !client.guilds) return null;

  const targetGuildId = guildId || process.env.DISCORD_GUILD_ID;
  const cache = client.guilds?.cache;
  let guild = null;
  if (cache) {
    if (targetGuildId && typeof cache.get === 'function') {
      guild = cache.get(targetGuildId);
    }
    if (!guild && typeof cache.first === 'function') {
      guild = cache.first();
    }
    if (!guild && cache instanceof Map) {
      guild = Array.from(cache.values())[0];
    }
  }
  if (!guild) return null;

  // Search existing channel named 'pre-signs'
  const existing = guild.channels.cache.find(
    (c: any) => c.name === 'pre-signs' && c.type === ChannelType.GuildText
  );
  if (existing) return existing;

  // Create private staff-only pre-signs channel
  try {
    const newChan = await guild.channels.create({
      name: 'pre-signs',
      type: ChannelType.GuildText,
      topic: 'G4X Booster Applications & Pre-sign Review Dashboard',
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageMessages,
          ],
        },
      ],
    });
    return newChan;
  } catch (err) {
    console.warn('[PresignReview] Could not auto-create #pre-signs channel:', err);
    return null;
  }
}

/**
 * Builds the concise, visually organized English embed for applicant review.
 */
export function buildReviewDashboardEmbed(
  order: any,
  presigns: any[] = [],
  premades: any[] = []
): EmbedBuilder {
  const isMythic = isMythicPlusOrder(order);
  const activePresigns = presigns.filter((p) => p.status === 'registered');

  // Deduplicate individual applicants by userId
  const uniqueUsers = new Map<string, any>();
  for (const p of activePresigns) {
    if (!uniqueUsers.has(p.userId)) {
      uniqueUsers.set(p.userId, p);
    }
  }

  const uniqueCount = uniqueUsers.size;
  const premadeCount = premades.length;
  const keyOwnerCount = activePresigns.filter((p) => p.hasKey === 'yes').length;

  const title = `📋 Pre-sign Applicant Review — ${order.orderName || order.orderRef}`;
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(order.status === 'open_presign' ? 0x5865f2 : 0x95a5a6)
    .setTimestamp(new Date());

  // Order Details
  const gameName = order.game?.displayName || order.gameSlug;
  const serviceName = order.service?.displayName || 'Boosting Service';
  embed.addFields({
    name: 'Order Reference',
    value: `\`${order.orderRef}\` • **${gameName}** • ${serviceName}`,
    inline: false,
  });

  // Required Booster Slots & Composition
  let requiredSlotsText = '1 Booster';
  let requiredCount = 1;
  if (isMythic) {
    requiredSlotsText = '🛡️ 1 Tank, 💚 1 Healer, ⚔️ 2 DPS';
    requiredCount = 4;
  } else if (order.orderMode === 'pilot' || order.orderType === 'pilot') {
    requiredSlotsText = '🎮 1 Pilot';
    requiredCount = 1;
  } else if (order.requiredRoles && order.requiredRoles.length > 0) {
    requiredSlotsText = order.requiredRoles.map((r: any) => `${r.quantity}x ${r.roleName}`).join(', ');
    requiredCount = order.requiredRoles.reduce((acc: number, r: any) => acc + r.quantity, 0);
  }

  const assignedCount = order.assignments?.filter((a: any) => a.status === 'assigned').length || 0;

  embed.addFields(
    { name: 'Required Slots', value: requiredSlotsText, inline: true },
    {
      name: 'Status & Progress',
      value: `\`${order.status.toUpperCase()}\` • **${assignedCount}/${requiredCount}** Assigned`,
      inline: true,
    },
    {
      name: 'Applicants Summary',
      value: `👥 **${uniqueCount}** Unique | 🛡️ **${premadeCount}** Premades | 🔑 **${keyOwnerCount}** Keys`,
      inline: true,
    }
  );

  // Individual Applicants Listing
  if (uniqueCount === 0) {
    embed.addFields({
      name: 'Individual Applicants',
      value: '_No individual applications registered yet._',
      inline: false,
    });
  } else {
    const lines: string[] = [];
    const keyOnlyLines: string[] = [];

    for (const [uid, presign] of uniqueUsers.entries()) {
      const roles = parsePresignRoles(presign.registeredRole);
      const hasKey = presign.hasKey === 'yes';
      const keyVerified = presign.keyVerified === true;
      const keyTag = hasKey
        ? ` | 🔑 Key +${presign.keyLevel || 10} (${keyVerified ? 'Verified' : 'Self-declared'})`
        : '';

      if (isMythic) {
        if (roles.length > 0) {
          lines.push(`• <@${uid}> — **${formatRolesDisplay(roles)}**${keyTag}`);
        } else if (hasKey) {
          keyOnlyLines.push(`• <@${uid}> — 🔑 Key +${presign.keyLevel || 10} [Key Available - No Execution Role]`);
        } else {
          lines.push(`• <@${uid}> — Registered`);
        }
      } else {
        // Pilot and Non-Pilot orders: do NOT show Tank, Healer, DPS classifications
        lines.push(`• <@${uid}>`);
      }
    }

    if (lines.length > 0) {
      embed.addFields({
        name: `Individual Applicants (${lines.length})`,
        value: lines.slice(0, 15).join('\n') + (lines.length > 15 ? `\n_...and ${lines.length - 15} more_` : ''),
        inline: false,
      });
    }

    if (keyOnlyLines.length > 0) {
      embed.addFields({
        name: `Key Available Only (${keyOnlyLines.length})`,
        value: keyOnlyLines.join('\n'),
        inline: false,
      });
    }
  }

  // Premade Applications Listing
  if (premadeCount > 0) {
    const premadeLines = premades.map((p) => {
      const membersText = p.members?.map((m: any) => `<@${m.userId}>`).join(', ') || '';
      return `• **${p.teamName}** (\`team:${p.id}\` • ${p.squadType?.toUpperCase() || 'SQUAD'}, ${p.members?.length || 0} members) — ${membersText}`;
    });

    embed.addFields({
      name: `Premade Squad Applications (${premadeCount})`,
      value: premadeLines.join('\n'),
      inline: false,
    });
  }

  // Command Reference for Authorized Assignment (No Assign buttons)
  embed.addFields({
    name: '📋 Assignment Command Reference',
    value:
      `Execute in chat to finalize assignment:\n` +
      `• **Assign individuals:** \`G4!assign ${order.id} @Booster1 @Booster2\`\n` +
      `• **Assign a team:** \`G4!assign ${order.id} team:<id>\`\n` +
      `• **Assign team + individuals:** \`G4!assign ${order.id} team:<id> @Booster3 @Booster4\``,
    inline: false,
  });

  embed.setFooter({
    text: `G4X Pre-sign Review • Order #${order.id} • Private Access Isolation Enforced`,
  });

  return embed;
}

/**
 * Builds the creator-facing review action buttons (No Assign buttons).
 */
export function buildReviewDashboardComponents(
  orderId: number,
  isClosed: boolean = false
): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`review_apps:${orderId}`)
      .setLabel('Review Applicants')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('👥'),
    new ButtonBuilder()
      .setCustomId(`review_premades:${orderId}`)
      .setLabel('View Premades')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🛡️'),
    new ButtonBuilder()
      .setCustomId(`review_refresh:${orderId}`)
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄')
  );

  return [row];
}

/**
 * Maintains ONE primary applicant-review message per order in #pre-signs, updated in place.
 */
export async function publishOrUpdateOrderReviewDashboard(
  client: any,
  orderId: number
): Promise<any> {
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
      assignments: true,
    },
  });

  if (!order) return null;

  // Retrieve distinct premades registered on this order
  const squadIds = Array.from(
    new Set(
      order.presigns
        .filter((p) => p.squadId && p.status === 'registered')
        .map((p) => p.squadId as number)
    )
  );

  const premades = squadIds.length > 0
    ? await prisma.premadeSquad.findMany({
        where: { id: { in: squadIds } },
        include: { members: { where: { status: 'accepted' }, include: { user: true } } },
      })
    : [];

  const embed = buildReviewDashboardEmbed(order, order.presigns, premades);
  const isClosed = ['assigned', 'in_progress', 'completed', 'cancelled'].includes(order.status);
  const components = buildReviewDashboardComponents(order.id, isClosed);

  const reviewChannel = await getOrCreatePresignsReviewChannel(client);
  if (!reviewChannel) return null;

  // If existing message ID is stored, update in place
  if (order.reviewChannelId && order.reviewMessageId) {
    try {
      const existingChannel = client.channels?.cache.get(order.reviewChannelId) || reviewChannel;
      const message = await existingChannel.messages.fetch(order.reviewMessageId);
      if (message) {
        await message.edit({
          embeds: [embed],
          components,
        });
        return message;
      }
    } catch (err) {
      // Message was deleted or unreachable; recreate cleanly
    }
  }

  // Otherwise post new primary message and record its IDs
  try {
    const newMessage = await reviewChannel.send({
      embeds: [embed],
      components,
    });

    await prisma.order.update({
      where: { id: order.id },
      data: {
        reviewChannelId: reviewChannel.id,
        reviewMessageId: newMessage.id,
      },
    });

    return newMessage;
  } catch (sendErr) {
    console.warn(`[PresignReview] Failed to post review dashboard for order #${orderId}:`, sendErr);
    return null;
  }
}

// ─── 6. ACCESS ISOLATION & AUTHORIZATION ─────────────────────────────────────

/**
 * Validates that an actor has permission to review or manage applicants for this specific order.
 * Strictly enforces:
 *  - Staff/Management (owner, manager, admin, staff) can manage all orders.
 *  - Order Creator / Advertiser can ONLY manage their OWN orders.
 *  - Advertisers CANNOT view other Advertisers' orders.
 */
export async function verifyReviewActorPermissions(
  actorId: string,
  order: { advertiserId?: string | null; creatorId?: string | null; id: number },
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<boolean> {
  const userRoles = await client.userRole.findMany({
    where: { userId: actorId },
  });
  const roleKeys = userRoles.map((r) => r.roleKey);

  const isManagement = roleKeys.some((k) => ['owner', 'manager', 'admin', 'staff'].includes(k));
  if (isManagement) return true;

  const isOwner =
    (order.advertiserId && order.advertiserId === actorId) ||
    (order.creatorId && order.creatorId === actorId);

  if (isOwner) return true;

  throw new DomainError(
    DomainErrorCode.PERMISSION_DENIED,
    `Access Denied: You are not authorized to view or manage applicants for Order #${order.id}. Advertisers may only review orders they own.`
  );
}

// ─── 7. FINAL ASSIGNMENT ENGINE & ATOMICITY ──────────────────────────────────

export interface CandidateAssignmentPlan {
  userId: string;
  assignedRole: string;
  claimId?: number | null;
  squadId?: number | null;
}

export interface FinalAssignmentInput {
  orderId: number;
  actorId: string;
  assignments?: CandidateAssignmentPlan[];
  squadId?: number | null;
  discordClient?: any;
}

/**
 * Atomically assigns selected individual boosters or an entire premade squad to an order.
 * Enforces:
 *  - Actor authorization (creator ownership or staff)
 *  - Slot limits (1 Tank, 1 Healer, 2 DPS for Mythic+)
 *  - Deduplication: same booster cannot occupy multiple slots
 *  - Double-booking prevention via platform BoosterReservation
 *  - Audit logging
 *  - ZERO financial mutations (no escrow release or premature payouts)
 */
export async function assignSelectedApplicants(
  input: FinalAssignmentInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<any> {
  const result = await (client as typeof prisma).$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        requiredRoles: true,
        assignments: { where: { status: 'assigned' } },
        service: true,
      },
    });

    if (!order) {
      throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${input.orderId} not found`);
    }

    ensureOrderAcceptsOperations(order);

    // 1. Authorize Actor
    await verifyReviewActorPermissions(input.actorId, order, tx);

    // 2. Resolve candidates
    const effectiveCandidates: CandidateAssignmentPlan[] = [];

    if (input.assignments && input.assignments.length > 0) {
      effectiveCandidates.push(...input.assignments);
    } else if (input.squadId) {
      const squad = await validatePremadeSquad(
        input.squadId,
        order.gameSlug,
        order.serviceId,
        undefined,
        tx,
        { enforceMythicPlusSize: false }
      );

      const accepted = squad.members.filter((m) => m.status === 'accepted');

      if (isMythicPlusOrder(order) && accepted.length === 4) {
        // Resolve 1 Tank, 1 Healer, 2 DPS
        const memberRoleProfiles: Array<{ userId: string; roles: string[] }> = [];
        for (const m of accepted) {
          const eligible = await getUserEligibleRoles(m.userId, order.gameSlug, tx);
          const memberRole = m.memberRole?.toLowerCase();
          const effectiveRoles = memberRole && eligible.includes(memberRole) ? [memberRole] : eligible;
          memberRoleProfiles.push({ userId: m.userId, roles: effectiveRoles });
        }

        const match = flexibleMythicRoleMatch(memberRoleProfiles);
        if (!match.success || !match.assignment) {
          throw new DomainError(
            DomainErrorCode.INVALID_ASSIGNED_ROLE,
            `Squad cannot form 1 Tank, 1 Healer, 2 DPS composition.`
          );
        }

        for (const [uid, role] of Object.entries(match.assignment)) {
          effectiveCandidates.push({ userId: uid, assignedRole: role });
        }
      } else {
        for (const m of accepted) {
          effectiveCandidates.push({
            userId: m.userId,
            assignedRole: m.memberRole || 'booster',
          });
        }
      }
    }

    if (effectiveCandidates.length === 0) {
      throw new DomainError(
        DomainErrorCode.ASSIGNMENT_CONFLICT,
        'No valid booster candidates or squad provided for assignment.'
      );
    }

    // 3. Deduplication Check: Same user cannot appear twice
    const candidateUserIds = effectiveCandidates.map((c) => c.userId);
    const uniqueCandidateUserIds = new Set(candidateUserIds);
    if (uniqueCandidateUserIds.size !== candidateUserIds.length) {
      throw new DomainError(
        DomainErrorCode.ASSIGNMENT_CONFLICT,
        'Duplicate booster detected: the same booster cannot occupy multiple execution slots.'
      );
    }

    // Check against already assigned users on this order
    const currentlyAssignedUserIds = order.assignments.map((a) => a.userId);
    for (const uid of candidateUserIds) {
      if (currentlyAssignedUserIds.includes(uid)) {
        throw new DomainError(
          DomainErrorCode.ASSIGNMENT_CONFLICT,
          `Booster '${uid}' is already assigned to this order.`
        );
      }
    }

    // 4. Role Capacity Validation (Mythic+ requires 1 Tank, 1 Healer, 2 DPS)
    if (isMythicPlusOrder(order)) {
      const targetRoleLimits: Record<string, number> = { tank: 1, healer: 1, dps: 2 };
      const currentRoleCounts: Record<string, number> = {};

      for (const a of order.assignments) {
        const r = a.assignedRole.toLowerCase();
        currentRoleCounts[r] = (currentRoleCounts[r] || 0) + 1;
      }

      for (const cand of effectiveCandidates) {
        const r = cand.assignedRole.toLowerCase();
        const limit = targetRoleLimits[r] ?? 1;
        const next = (currentRoleCounts[r] || 0) + 1;
        if (next > limit) {
          throw new DomainError(
            DomainErrorCode.ROLE_CAPACITY_EXCEEDED,
            `Role capacity exceeded for ${r.toUpperCase()} (Max: ${limit}).`
          );
        }
        currentRoleCounts[r] = next;
      }
    }

    // 5. Atomic Double-Booking Verification & Creation
    const createdAssignments = [];
    const createdReservations = [];

    for (const cand of effectiveCandidates) {
      // Platform double-booking check
      const existingReservation = await tx.boosterReservation.findFirst({
        where: { userId: cand.userId, status: 'active' },
      });

      if (existingReservation && existingReservation.orderId !== order.id) {
        throw new DomainError(
          DomainErrorCode.BOOSTER_ALREADY_RESERVED,
          `Booster '${cand.userId}' has an active reservation on Order #${existingReservation.orderId}.`
        );
      }

      // Create platform reservation
      const res = await tx.boosterReservation.create({
        data: {
          userId: cand.userId,
          orderId: order.id,
          status: 'active',
          createdById: input.actorId,
        },
      });
      createdReservations.push(res);

      // Create order assignment
      const asg = await tx.orderAssignment.create({
        data: {
          orderId: order.id,
          userId: cand.userId,
          assignedById: input.actorId,
          assignedRole: cand.assignedRole,
          claimId: cand.claimId ?? null,
          squadId: cand.squadId ?? input.squadId ?? null,
          status: 'assigned',
        },
      });
      createdAssignments.push(asg);

      // Update applicant presign record
      await tx.orderPresign.updateMany({
        where: { orderId: order.id, userId: cand.userId },
        data: { status: 'selected' },
      });
    }

    // 6. Check if order slots are fully filled
    const totalAssignedNow = order.assignments.length + createdAssignments.length;
    const requiredTotal = isMythicPlusOrder(order) ? 4 : 1;

    if (totalAssignedNow >= requiredTotal) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'assigned' },
      });
    }

    // 7. Audit Logging
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'ORDER_ASSIGNMENT_CREATED',
        entityType: 'order',
        entityId: String(order.id),
        newValues: JSON.stringify({
          assignedCount: createdAssignments.length,
          squadId: input.squadId ?? null,
          boosters: candidateUserIds,
        }),
      },
    });

    return {
      success: true,
      orderId: order.id,
      assignments: createdAssignments,
      reservations: createdReservations,
    };
  });

  // Post-transaction Discord updates
  if (input.discordClient) {
    try {
      await publishOrUpdateOrderReviewDashboard(input.discordClient, input.orderId);
    } catch (e) {
      console.warn('[PresignReview] Error updating review dashboard:', e);
    }

    try {
      await publishOrRefreshOrderCard(input.discordClient, input.orderId);
    } catch (e) {
      console.warn('[PresignReview] Error refreshing order publication card:', e);
    }

    try {
      await getOrCreateOrderExecutionChannel(input.orderId, input.discordClient, {
        actorId: input.actorId,
      });
    } catch (e: any) {
      console.warn('[PresignReview] Error initializing execution channel:', e?.code, e?.meta, e?.message);
    }
  }

  return result;
}
