/**
 * src/web/profileSettingsRoutes.ts — User Profile, Booster Experience & Discord Settings API (Website Phase 9)
 * 
 * Strict Invariants:
 *  1. Authenticated session required for all routes (requireAuth).
 *  2. CSRF token required for all mutations (requireCsrf).
 *  3. Users can inspect and mutate ONLY their own profile and settings (Session-derived user.discordId).
 *  4. Authoritative Discord IDs, roles, permissions, wallet balances, approval statuses and financial records
 *     are strictly server-immutable through user-facing profile endpoints.
 *  5. Inputs are strictly validated and sanitized (phone format, telegram handle, length bounds).
 *  6. No Discord passwords, bot tokens, or unnecessary OAuth scopes are requested or stored.
 *  7. All 5 live financial feature gates remain strictly disabled.
 *  8. Audit logging is recorded for profile and settings updates.
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../database/db';
import { requireAuth, requireCsrf, AuthenticatedRequest } from './middleware/auth';
import { serializeUser } from './serializers';
import { maskIban, maskCryptoAddress } from '../services/financeV2/iranianIbanValidator';

export const profileSettingsRouter = Router();

// Secure user settings directory
const USER_SETTINGS_DIR = path.join(process.cwd(), 'storage', 'user_settings');
if (!fs.existsSync(USER_SETTINGS_DIR)) {
  fs.mkdirSync(USER_SETTINGS_DIR, { recursive: true });
}

export interface UserSettingsData {
  orderAssignedDm: boolean;
  orderCompletedDm: boolean;
  payoutAlertsDm: boolean;
  announcementDm: boolean;
  rosterRole: 'TANK' | 'HEALER' | 'DPS' | 'ANY';
  availability: 'AVAILABLE' | 'BUSY' | 'AWAY';
  rosterVisibility: boolean;
  preferredContact: 'DISCORD' | 'TELEGRAM' | 'WHATSAPP';
  // Aliases for compatibility
  payoutAlerts?: boolean;
  announcementDms?: boolean;
  preferredRosterRole?: 'TANK' | 'HEALER' | 'DPS' | 'ANY';
  availabilityStatus?: 'AVAILABLE' | 'BUSY' | 'AWAY';
  showOnRoster?: boolean;
  preferredContactMethod?: string;
  updatedAt?: string;
}

const DEFAULT_SETTINGS: UserSettingsData = {
  orderAssignedDm: true,
  orderCompletedDm: true,
  payoutAlertsDm: true,
  announcementDm: false,
  rosterRole: 'DPS',
  availability: 'AVAILABLE',
  rosterVisibility: true,
  preferredContact: 'DISCORD',
  payoutAlerts: true,
  announcementDms: false,
  preferredRosterRole: 'DPS',
  availabilityStatus: 'AVAILABLE',
  showOnRoster: true,
  preferredContactMethod: 'discord',
};

function getUserSettingsPath(userId: string): string {
  // Sanitize filename to prevent directory traversal
  const safeId = userId.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return path.join(USER_SETTINGS_DIR, `${safeId}.json`);
}

function loadUserSettings(userId: string): UserSettingsData {
  const filePath = getUserSettingsPath(userId);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const role = parsed.rosterRole || parsed.preferredRosterRole || 'DPS';
      const avail = parsed.availability || parsed.availabilityStatus || 'AVAILABLE';
      const orderAssignedDm = parsed.orderAssignedDm ?? true;
      const orderCompletedDm = parsed.orderCompletedDm ?? true;
      const payoutAlertsDm = parsed.payoutAlertsDm ?? parsed.payoutAlerts ?? true;
      const announcementDm = parsed.announcementDm ?? parsed.announcementDms ?? false;
      const rosterVisibility = parsed.rosterVisibility ?? parsed.showOnRoster ?? true;
      const preferredContact = parsed.preferredContact || (parsed.preferredContactMethod ? (parsed.preferredContactMethod.toUpperCase() as any) : 'DISCORD');

      return {
        orderAssignedDm,
        orderCompletedDm,
        payoutAlertsDm,
        announcementDm,
        rosterRole: role,
        availability: avail,
        rosterVisibility,
        preferredContact,
        // Aliases
        payoutAlerts: payoutAlertsDm,
        announcementDms: announcementDm,
        preferredRosterRole: role,
        availabilityStatus: avail,
        showOnRoster: rosterVisibility,
        preferredContactMethod: String(preferredContact).toLowerCase(),
        updatedAt: parsed.updatedAt,
      };
    }
  } catch (err) {
    console.error(`[Settings] Failed to read settings for ${userId}:`, err);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveUserSettings(userId: string, settings: UserSettingsData): void {
  const filePath = getUserSettingsPath(userId);
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET USER PROFILE (/api/user/profile & /user/profile)
// ─────────────────────────────────────────────────────────────────────────────

async function handleGetUserProfile(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user;
    const userId = user.discordId;

    const [
      dbUser,
      approvals,
      pilotVerif,
      latestApp,
      characters,
      activeAssignments,
      completedRunsCount,
      activeOrdersCount,
      payoutPref,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { discordId: userId },
        include: {
          userRoles: { select: { roleKey: true, grantedAt: true } },
        },
      }),
      prisma.userGameApproval.findMany({
        where: { userId },
        include: {
          game: { select: { slug: true, displayName: true } },
          service: { select: { id: true, displayName: true, serviceMode: true } },
        },
      }),
      prisma.pilotVerification.findFirst({
        where: { userId },
        orderBy: { submittedAt: 'desc' },
      }),
      prisma.registrationApplication.findFirst({
        where: { userId },
        orderBy: { submittedAt: 'desc' },
      }),
      prisma.wowCharacter.findMany({
        where: { userId, isActive: true },
        orderBy: [{ isMain: 'desc' }, { mythicScore: 'desc' }],
      }),
      prisma.orderAssignment.count({
        where: {
          userId,
          status: 'assigned',
          order: { status: { in: ['assigned', 'in_progress'] } },
        },
      }),
      prisma.orderRun.count({
        where: {
          completedBy: userId,
          status: { in: ['completed', 'verified'] },
        },
      }),
      prisma.order.count({
        where: {
          OR: [
            { customerId: userId },
            { advertiserId: userId },
            { creatorId: userId },
          ],
          status: { in: ['open_presign', 'pending', 'assigned', 'in_progress', 'disputed'] },
        },
      }),
      prisma.userPayoutPreference.findUnique({
        where: { userId },
      }),
    ]);

    if (!dbUser) {
      res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User record not found' });
      return;
    }

    const settings = loadUserSettings(userId);
    const roles = dbUser.userRoles.map((r) => r.roleKey);

    // Discord client guild membership check
    let isGuildMember = true;
    const discordClient = req.app.get('discordClient');
    if (discordClient && process.env.DISCORD_GUILD_ID) {
      try {
        const guild = discordClient.guilds.cache.get(process.env.DISCORD_GUILD_ID);
        if (guild) {
          const member = guild.members.cache.get(userId);
          isGuildMember = Boolean(member);
        }
      } catch {
        // Fallback gracefully without throwing
      }
    }

    let defaultAvatarIndex = 0;
    try {
      if (dbUser.discordId && /^\d+$/.test(dbUser.discordId)) {
        defaultAvatarIndex = Number((BigInt(dbUser.discordId) >> 22n) % 6n);
      }
    } catch {
      defaultAvatarIndex = 0;
    }
    const avatarUrl = `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`;
    const avatar = null;

    const joinedDaysAgo = Math.max(
      0,
      Math.floor((Date.now() - new Date(dbUser.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    );

    const activitySummary = {
      activeAssignmentsCount: activeAssignments,
      completedRunsCount,
      ordersCount: activeOrdersCount,
      joinedDaysAgo,
    };

    const discordLinkage = {
      discordId: dbUser.discordId,
      username: dbUser.username,
      connected: true,
      serverName: 'G4X Community Guild',
      rolesInGuild: roles,
    };

    const approvedGames = approvals.map((a) => ({
      gameSlug: a.gameSlug,
      displayName: a.game.displayName,
      status: a.status,
      approvedAt: a.reviewedAt?.toISOString() || null,
    }));

    const payoutPreference = {
      hasIban: Boolean(payoutPref?.bankIban),
      maskedIban: payoutPref?.bankIban ? maskIban(payoutPref.bankIban) : null,
      hasCryptoAddress: Boolean(payoutPref?.cryptoAddress),
      maskedCryptoAddress: payoutPref?.cryptoAddress ? maskCryptoAddress(payoutPref.cryptoAddress) : null,
    };

    res.json({
      success: true,
      profile: {
        discordId: dbUser.discordId,
        username: dbUser.username,
        displayName: dbUser.displayName,
        avatar,
        avatarUrl,
        phoneNumber: dbUser.phoneNumber,
        telegramUsername: dbUser.telegramUsername,
        whatsappNumber: dbUser.whatsappNumber,
        isActive: dbUser.isActive,
        advertiserRank: dbUser.advertiserRank,
        roles,
        createdAt: dbUser.createdAt,
        updatedAt: dbUser.updatedAt,
      },
      approvals: approvals.map((a) => ({
        id: a.id,
        gameSlug: a.gameSlug,
        gameName: a.game.displayName,
        serviceId: a.serviceId,
        serviceName: a.service?.displayName || null,
        serviceMode: a.service?.serviceMode || null,
        approvalType: a.approvalType,
        status: a.status,
        reviewedAt: a.reviewedAt,
      })),
      approvedGames,
      pilotVerification: pilotVerif
        ? {
            status: pilotVerif.status,
            gameSlug: pilotVerif.gameSlug,
            submittedAt: pilotVerif.submittedAt,
            reviewedAt: pilotVerif.reviewedAt,
            expiresAt: pilotVerif.expiresAt,
          }
        : null,
      latestApplication: latestApp
        ? {
            id: latestApp.id,
            category: latestApp.category,
            status: latestApp.status,
            identityStatus: latestApp.identityStatus,
            roleSyncStatus: latestApp.roleSyncStatus,
            submittedAt: latestApp.submittedAt,
            reviewedAt: latestApp.reviewedAt,
          }
        : null,
      characters: characters.map((c) => ({
        id: c.id,
        characterName: c.characterName,
        realm: c.realm,
        region: c.region,
        characterClass: c.characterClass,
        activeSpec: c.activeSpec,
        itemLevel: c.itemLevel,
        mythicScore: c.mythicScore,
        tankScore: c.tankScore,
        healerScore: c.healerScore,
        dpsScore: c.dpsScore,
        isMain: c.isMain,
        syncStatus: c.syncStatus,
        raiderioUrl: c.raiderioUrl,
      })),
      activity: {
        completedRuns: completedRunsCount,
        activeOrders: activeOrdersCount,
        activeAssignments,
      },
      activitySummary,
      payoutPreference,
      payoutPreferenceSet: Boolean(payoutPref?.bankIban || payoutPref?.cryptoAddress),
      settings,
      discord: {
        discordId: dbUser.discordId,
        username: dbUser.username,
        isLinked: true,
        guildId: process.env.DISCORD_GUILD_ID || null,
        isGuildMember,
        roleSyncStatus: latestApp?.roleSyncStatus || 'synced',
      },
      discordLinkage,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'PROFILE_FETCH_FAILED', message: err.message || 'Failed to fetch user profile' });
  }
}

profileSettingsRouter.get('/user/profile', requireAuth, handleGetUserProfile);
profileSettingsRouter.get('/api/user/profile', requireAuth, handleGetUserProfile);

// ─────────────────────────────────────────────────────────────────────────────
// 2. UPDATE USER PROFILE (/api/user/profile & /user/profile)
// ─────────────────────────────────────────────────────────────────────────────

async function handleUpdateUserProfile(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user;
    const userId = user.discordId;

    const { displayName, phoneNumber, telegramUsername, whatsappNumber } = req.body;

    const updateData: {
      displayName?: string | null;
      phoneNumber?: string | null;
      telegramUsername?: string | null;
      whatsappNumber?: string | null;
    } = {};

    // 1. Display name validation
    if (displayName !== undefined) {
      if (displayName === null || displayName === '') {
        updateData.displayName = null;
      } else {
        const trimmed = String(displayName).trim();
        if (trimmed.length > 50) {
          res.status(400).json({ error: 'INVALID_DISPLAY_NAME', message: 'Display name cannot exceed 50 characters.' });
          return;
        }
        updateData.displayName = trimmed;
      }
    }

    // 2. Phone number validation
    if (phoneNumber !== undefined) {
      if (phoneNumber === null || phoneNumber === '') {
        updateData.phoneNumber = null;
      } else {
        const cleanPhone = String(phoneNumber).trim();
        // Allow digits, +, spaces, hyphens, parentheses (7 to 20 chars)
        if (!/^[+]?[0-9\s\-()]{7,20}$/.test(cleanPhone)) {
          res.status(400).json({
            error: 'INVALID_PHONE_NUMBER',
            message: 'Phone number must be a valid international or local number (7-20 digits).',
          });
          return;
        }
        updateData.phoneNumber = cleanPhone;
      }
    }

    // 3. Telegram username validation
    if (telegramUsername !== undefined) {
      if (telegramUsername === null || telegramUsername === '') {
        updateData.telegramUsername = null;
      } else {
        // Strip leading @ if user typed it
        let cleanTg = String(telegramUsername).trim();
        if (cleanTg.startsWith('@')) {
          cleanTg = cleanTg.substring(1);
        }
        if (!/^[a-zA-Z0-9_]{3,32}$/.test(cleanTg)) {
          res.status(400).json({
            error: 'INVALID_TELEGRAM_HANDLE',
            message: 'Telegram handle must be 3-32 characters and contain only letters, numbers, and underscores.',
          });
          return;
        }
        updateData.telegramUsername = cleanTg;
      }
    }

    // 4. WhatsApp number validation
    if (whatsappNumber !== undefined) {
      if (whatsappNumber === null || whatsappNumber === '') {
        updateData.whatsappNumber = null;
      } else {
        const cleanWa = String(whatsappNumber).trim();
        if (!/^[+]?[0-9\s\-()]{7,20}$/.test(cleanWa)) {
          res.status(400).json({
            error: 'INVALID_WHATSAPP_NUMBER',
            message: 'WhatsApp number must be a valid phone number (7-20 digits).',
          });
          return;
        }
        updateData.whatsappNumber = cleanWa;
      }
    }

    // Enforce that only editable fields were provided
    const forbiddenKeys = ['discordId', 'username', 'roles', 'isActive', 'advertiserRank', 'balance', 'wallet', 'permissions'];
    const suppliedKeys = Object.keys(req.body);
    for (const k of suppliedKeys) {
      if (forbiddenKeys.includes(k)) {
        res.status(400).json({
          error: 'IMMUTABLE_FIELD_MODIFICATION',
          message: `Modifying security field '${k}' is prohibited.`,
        });
        return;
      }
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: 'NO_UPDATES_PROVIDED', message: 'No valid profile fields provided for update.' });
      return;
    }

    const previousUser = await prisma.user.findUnique({
      where: { discordId: userId },
      select: { displayName: true, phoneNumber: true, telegramUsername: true, whatsappNumber: true },
    });

    const updatedUser = await prisma.user.update({
      where: { discordId: userId },
      data: updateData,
    });

    // Audit log emission
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'USER_PROFILE_UPDATED',
        entityType: 'User',
        entityId: userId,
        previousValues: JSON.stringify(previousUser || {}),
        newValues: JSON.stringify(updateData),
        reason: 'User self-profile update',
        isSuccess: true,
      },
    });

    res.json({
      success: true,
      message: 'Profile successfully updated.',
      profile: {
        discordId: updatedUser.discordId,
        username: updatedUser.username,
        displayName: updatedUser.displayName,
        phoneNumber: updatedUser.phoneNumber,
        telegramUsername: updatedUser.telegramUsername,
        whatsappNumber: updatedUser.whatsappNumber,
        isActive: updatedUser.isActive,
        advertiserRank: updatedUser.advertiserRank,
        updatedAt: updatedUser.updatedAt,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'PROFILE_UPDATE_FAILED', message: err.message || 'Failed to update profile' });
  }
}

profileSettingsRouter.put('/user/profile', requireAuth, requireCsrf, handleUpdateUserProfile);
profileSettingsRouter.put('/api/user/profile', requireAuth, requireCsrf, handleUpdateUserProfile);

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET USER SETTINGS & NOTIFICATION PREFERENCES (/api/user/settings)
// ─────────────────────────────────────────────────────────────────────────────

async function handleGetUserSettings(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user;
    const settings = loadUserSettings(user.discordId);

    res.json({
      success: true,
      settings,
      discordLinkage: {
        discordId: user.discordId,
        username: user.username,
        connected: true,
        guildId: process.env.DISCORD_GUILD_ID || null,
        serverName: 'G4X Community Guild',
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'SETTINGS_FETCH_FAILED', message: err.message });
  }
}

profileSettingsRouter.get('/user/settings', requireAuth, handleGetUserSettings);
profileSettingsRouter.get('/api/user/settings', requireAuth, handleGetUserSettings);
profileSettingsRouter.get('/booster/settings', requireAuth, handleGetUserSettings);
profileSettingsRouter.get('/api/booster/settings', requireAuth, handleGetUserSettings);

// ─────────────────────────────────────────────────────────────────────────────
// 4. UPDATE USER SETTINGS & PREFERENCES (/api/user/settings)
// ─────────────────────────────────────────────────────────────────────────────

async function handleUpdateUserSettings(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user;
    const userId = user.discordId;
    const current = loadUserSettings(userId);

    const {
      orderAssignedDm,
      orderCompletedDm,
      payoutAlertsDm,
      payoutAlerts,
      announcementDm,
      announcementDms,
      rosterRole,
      preferredRosterRole,
      availability,
      availabilityStatus,
      rosterVisibility,
      showOnRoster,
      preferredContact,
      preferredContactMethod,
    } = req.body;

    const updated: UserSettingsData = { ...current };

    if (typeof orderAssignedDm === 'boolean') updated.orderAssignedDm = orderAssignedDm;
    if (typeof orderCompletedDm === 'boolean') updated.orderCompletedDm = orderCompletedDm;

    const payoutVal =
      typeof payoutAlertsDm === 'boolean'
        ? payoutAlertsDm
        : typeof payoutAlerts === 'boolean'
        ? payoutAlerts
        : undefined;
    if (payoutVal !== undefined) {
      updated.payoutAlertsDm = payoutVal;
      updated.payoutAlerts = payoutVal;
    }

    const annVal =
      typeof announcementDm === 'boolean'
        ? announcementDm
        : typeof announcementDms === 'boolean'
        ? announcementDms
        : undefined;
    if (annVal !== undefined) {
      updated.announcementDm = annVal;
      updated.announcementDms = annVal;
    }

    const visVal =
      typeof rosterVisibility === 'boolean'
        ? rosterVisibility
        : typeof showOnRoster === 'boolean'
        ? showOnRoster
        : undefined;
    if (visVal !== undefined) {
      updated.rosterVisibility = visVal;
      updated.showOnRoster = visVal;
    }

    const roleVal = rosterRole || preferredRosterRole;
    if (roleVal !== undefined) {
      if (!['TANK', 'HEALER', 'DPS', 'ANY'].includes(roleVal)) {
        res.status(400).json({
          error: 'INVALID_ROSTER_ROLE',
          message: "rosterRole must be 'TANK', 'HEALER', 'DPS', or 'ANY'.",
        });
        return;
      }
      updated.rosterRole = roleVal;
      updated.preferredRosterRole = roleVal;
    }

    const availVal = availability || availabilityStatus;
    if (availVal !== undefined) {
      if (!['AVAILABLE', 'BUSY', 'AWAY'].includes(availVal)) {
        res.status(400).json({
          error: 'INVALID_AVAILABILITY_STATUS',
          message: "availability must be 'AVAILABLE', 'BUSY', or 'AWAY'.",
        });
        return;
      }
      updated.availability = availVal;
      updated.availabilityStatus = availVal;
    }

    const contactVal = preferredContact || preferredContactMethod;
    if (contactVal !== undefined) {
      const upper = String(contactVal).toUpperCase();
      if (!['DISCORD', 'TELEGRAM', 'WHATSAPP'].includes(upper)) {
        res.status(400).json({
          error: 'INVALID_CONTACT_METHOD',
          message: "preferredContact must be 'DISCORD', 'TELEGRAM', or 'WHATSAPP'.",
        });
        return;
      }
      updated.preferredContact = upper as any;
      updated.preferredContactMethod = String(contactVal).toLowerCase();
    }

    updated.updatedAt = new Date().toISOString();
    saveUserSettings(userId, updated);

    // Audit log emission
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'USER_SETTINGS_UPDATED',
        entityType: 'UserSettings',
        entityId: userId,
        previousValues: JSON.stringify(current),
        newValues: JSON.stringify(updated),
        reason: 'User preferences and notification settings update',
        isSuccess: true,
      },
    });

    res.json({
      success: true,
      message: 'Preferences successfully saved.',
      settings: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'SETTINGS_UPDATE_FAILED', message: err.message });
  }
}

profileSettingsRouter.put('/user/settings', requireAuth, requireCsrf, handleUpdateUserSettings);
profileSettingsRouter.put('/api/user/settings', requireAuth, requireCsrf, handleUpdateUserSettings);
profileSettingsRouter.put('/booster/settings', requireAuth, requireCsrf, handleUpdateUserSettings);
profileSettingsRouter.put('/api/booster/settings', requireAuth, requireCsrf, handleUpdateUserSettings);

// ─────────────────────────────────────────────────────────────────────────────
// 5. BOOSTER PORTAL DATA & AVAILABLE QUEUE (/api/booster/portal-data)
// ─────────────────────────────────────────────────────────────────────────────

async function handleGetBoosterPortalData(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as AuthenticatedRequest).user;
    const userId = user.discordId;

    const dbUser = await prisma.user.findUnique({
      where: { discordId: userId },
      include: { userRoles: true },
    });

    if (!dbUser) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'User record not found.' });
      return;
    }

    // Check account status: suspended/inactive boosters are strictly blocked
    if (!dbUser.isActive) {
      res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        message: 'Your account is suspended or inactive. Access to booster portal is revoked.',
      });
      return;
    }

    const userRoles = (dbUser.userRoles || []).map((r) => r.roleKey);
    const isBooster = userRoles.includes('booster');
    const isStaffOrAdmin = userRoles.some((r) => ['admin', 'manager', 'owner', 'staff'].includes(r));

    // Check if booster is suspended at the game approval level
    const suspendedApproval = await prisma.userGameApproval.findFirst({
      where: { userId, status: 'suspended' },
    });

    if (suspendedApproval && !isStaffOrAdmin) {
      res.status(403).json({
        error: 'BOOSTER_SUSPENDED',
        message: 'Your booster credentials are suspended. Access to booster portal is revoked.',
      });
      return;
    }

    // Server-authoritative Booster check: return 403 for unauthorized users
    if (!isBooster && !isStaffOrAdmin) {
      res.status(403).json({
        error: 'BOOSTER_ROLE_REQUIRED',
        message: 'Access restricted to authorized community boosters.',
      });
      return;
    }

    const [approvals, myAssignments, pilotVerif] = await Promise.all([
      prisma.userGameApproval.findMany({
        where: { userId, status: 'approved' },
        include: { game: { select: { slug: true, displayName: true } } },
      }),
      prisma.orderAssignment.findMany({
        where: { userId },
        include: {
          order: {
            include: {
              game: { select: { slug: true, displayName: true } },
              service: { select: { displayName: true } },
              runs: true,
            },
          },
        },
        orderBy: { assignedAt: 'desc' },
        take: 15,
      }),
      prisma.pilotVerification.findFirst({
        where: { userId },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);

    const approvedGameSlugs = approvals.map((a) => a.gameSlug);

    // Apply game eligibility: regular boosters only see queues for cleared games
    const availableOrdersWhere: any = {
      status: { in: ['open_presign', 'pending', 'assigned'] },
      paymentStatus: { in: ['verified', 'unneeded'] },
    };

    if (!isStaffOrAdmin) {
      if (approvedGameSlugs.length === 0) {
        availableOrdersWhere.gameSlug = '__NO_GAMES_APPROVED__';
      } else {
        availableOrdersWhere.gameSlug = { in: approvedGameSlugs };
      }
    }

    const availableOrdersRaw = await prisma.order.findMany({
      where: availableOrdersWhere,
      include: {
        game: { select: { slug: true, displayName: true } },
        service: { select: { displayName: true } },
        assignments: { select: { assignedRole: true, userId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const settings = loadUserSettings(userId);

    const avatarIndex = (() => {
      try {
        if (dbUser?.discordId && /^\d+$/.test(dbUser.discordId)) {
          return Number((BigInt(dbUser.discordId) >> 22n) % 6n);
        }
      } catch {}
      return 0;
    })();
    const avatarUrl = `https://cdn.discordapp.com/embed/avatars/${avatarIndex}.png`;

    const boosterInfo = {
      discordId: dbUser?.discordId || userId,
      username: dbUser?.username || 'booster',
      displayName: dbUser?.displayName || null,
      avatarUrl,
      roles: (dbUser?.userRoles || []).map((r) => r.roleKey),
      pilotVerified: Boolean(pilotVerif && pilotVerif.status === 'approved'),
      rosterRole: settings.rosterRole,
      availability: settings.availability,
      approvedGames: approvals.map((a) => a.gameSlug),
    };

    const assignedOrders = myAssignments.map((a) => ({
      assignmentId: a.id,
      orderId: a.orderId,
      assignedRole: a.assignedRole,
      assignedAt: a.assignedAt.toISOString(),
      orderTitle: `${a.order.game.displayName} - ${a.order.service.displayName}`,
      gameSlug: a.order.game.slug,
      status: a.order.status,
      totalAmountUsdCents: a.order.boosterPoolMinor,
    }));

    // Map Mythic+ roster requirements (1 Tank, 1 Healer, 2 DPS, 1 Key Owner)
    const availableQueue = availableOrdersRaw.map((o) => {
      const assignedRoles = o.assignments.map((a) => a.assignedRole);
      const tankFilled = assignedRoles.includes('TANK');
      const healerFilled = assignedRoles.includes('HEALER');
      const dpsCount = assignedRoles.filter((r) => r === 'DPS').length;
      const totalFilled = (tankFilled ? 1 : 0) + (healerFilled ? 1 : 0) + dpsCount;

      return {
        id: o.id,
        title: `${o.game.displayName} - ${o.service.displayName}`,
        gameSlug: o.game.slug,
        status: o.status,
        totalAmountUsdCents: o.boosterPoolMinor,
        rosterSlotsNeeded: {
          tanks: 1,
          healers: 1,
          dps: 2,
        },
        rosterFulfillment: {
          hasKeyOwner: Boolean(o.assignments.length > 0),
          filledTanks: tankFilled ? 1 : 0,
          filledHealers: healerFilled ? 1 : 0,
          filledDps: dpsCount,
          totalFilled,
          isFull: tankFilled && healerFilled && dpsCount >= 2,
        },
        createdAt: o.createdAt.toISOString(),
      };
    });

    res.json({
      success: true,
      boosterInfo,
      assignedOrders,
      availableQueue,
      booster: {
        isBooster,
        qualifications: pilotVerif ? pilotVerif.status : 'STANDARD',
        availabilityStatus: settings.availability,
        preferredRosterRole: settings.rosterRole,
        approvedGames: approvals.map((a) => ({
          gameSlug: a.gameSlug,
          gameName: a.game.displayName,
          approvalType: a.approvalType,
        })),
        myAssignments: myAssignments.map((a) => ({
          id: a.id,
          orderId: a.orderId,
          orderRef: a.order.orderRef,
          gameName: a.order.game.displayName,
          serviceName: a.order.service.displayName,
          assignedRole: a.assignedRole,
          status: a.status,
          orderStatus: a.order.status,
          boosterPoolUsd: (a.order.boosterPoolMinor / 100).toFixed(2),
          assignedAt: a.assignedAt,
          runsCount: a.order.runs.length,
        })),
        availableQueue,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'BOOSTER_PORTAL_FAILED', message: err.message });
  }
}

profileSettingsRouter.get('/booster/portal-data', requireAuth, handleGetBoosterPortalData);
profileSettingsRouter.get('/api/booster/portal-data', requireAuth, handleGetBoosterPortalData);
