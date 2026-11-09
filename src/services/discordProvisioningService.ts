/**
 * discordProvisioningService.ts — Automatic Discord Channel Provisioning & Admin Mapping
 *
 * G4X Community — Production Auto-Provisioning & Reconciliation Service
 * Stack: Node.js, TypeScript, Discord.js v14, Prisma, SQLite
 *
 * Features:
 *  - Automatic idempotent creation and discovery of ALL required categories and channels:
 *      * Registration and staff review channels (START HERE, APPLICATION MANAGEMENT)
 *      * G4X Orders creation panels (G4X ORDERS)
 *      * Advertiser Orders creation panels (ADVERTISER ORDERS)
 *      * Game-specific order publication channels (WoW Midnight, WoW Forever, and dynamic enabled games)
 *      * Private order execution category infrastructure (ACTIVE ORDERS)
 *  - Reuses valid existing channels by ID or name without creating duplicates on restarts
 *  - Never deletes unrelated or manually created channels
 *  - Persists actual Discord IDs in `discord_channel_mappings` and synchronizes `channel_routes`
 *  - Reconciles state against Discord guild cache/fetch
 *  - Allows Admins to view mappings, trigger auto-provisioning, edit channel IDs with guild validation,
 *    repair broken/missing channels, and toggle optional mappings
 *  - Editing channel IDs NEVER automatically deletes the old Discord channel
 *  - Audits all mutations in `audit_logs` without leaking sensitive execution channels
 */

import {
  ChannelType,
  PermissionFlagsBits,
  CategoryChannel,
  TextChannel,
  Guild,
  Client,
} from 'discord.js';
import prisma from '../database/db';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';
import { DomainError, DomainErrorCode } from './domainErrors';
import { setupRegistrationChannels } from './registrationChannelSetup';
import { setupOrderPanels } from './orderChannelSetup';
import { setupPublicationChannels } from './orderPublicationChannelService';
import { resolveOrCreateExecutionCategory } from './orderExecutionChannelService';

export interface ProvisioningOptions {
  guild: any; // Discord.js Guild
  actorId: string;
  client?: any;
}

export interface ChannelMappingRecord {
  id: number;
  guildId: string;
  channelKey: string;
  categoryName: string;
  channelName: string;
  purpose: string;
  channelType: string;
  gameSlug: string | null;
  serviceId: number | null;
  serviceMode: string | null;
  discordChannelId: string | null;
  parentCategoryId: string | null;
  isOptional: boolean;
  isActive: boolean;
  syncStatus: string;
  lastSyncResult: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  game?: { slug: string; displayName: string } | null;
  service?: { id: number; displayName: string; serviceMode: string } | null;
}

export interface ProvisioningResult {
  success: boolean;
  totalConfigured: number;
  synced: number;
  created: number;
  reused: number;
  warnings: string[];
  mappings: ChannelMappingRecord[];
}

export interface ReconciliationResult {
  total: number;
  synced: number;
  missing: number;
  invalid: number;
  disabled: number;
  warnings: string[];
  mappings: ChannelMappingRecord[];
}

/**
 * Helper to record safe audit logs without leaking private order information.
 */
async function logAudit(
  actorId: string | null,
  action: string,
  entityId: string,
  previousValues: any,
  newValues: any,
  reason?: string
): Promise<void> {
  try {
    let validActorId: string | null = null;
    if (actorId) {
      const userExists = await prisma.user.findUnique({
        where: { discordId: actorId },
        select: { discordId: true },
      });
      if (userExists) {
        validActorId = userExists.discordId;
      }
    }

    const finalReason = validActorId ? reason : `[Actor: ${actorId}] ${reason || ''}`.trim();

    await prisma.auditLog.create({
      data: {
        actorId: validActorId,
        action,
        entityType: 'DiscordChannelMapping',
        entityId,
        previousValues: previousValues ? JSON.stringify(previousValues) : null,
        newValues: newValues ? JSON.stringify(newValues) : null,
        reason: finalReason,
        isSuccess: true,
      },
    });
  } catch (err) {
    console.error('[DiscordProvisioning] Failed to write audit log:', err);
  }
}

/**
 * Finds or creates a Category channel idempotently.
 */
async function getOrCreateCategory(
  guild: any,
  categoryName: string,
  options?: {
    permissionOverwrites?: any[];
  }
): Promise<{ category: any; isNew: boolean }> {
  if (!guild) throw new Error('Guild is required');

  // Search by exact or case-insensitive name
  let category: any = null;
  if (guild.channels?.cache) {
    category = guild.channels.cache.find(
      (c: any) =>
        (c.type === ChannelType.GuildCategory || c.type === 4) &&
        c.name.trim().toUpperCase() === categoryName.trim().toUpperCase()
    );
  }

  if (category) {
    return { category, isNew: false };
  }

  // Create category if bot has permission
  const me = guild.members?.me;
  if (me && me.permissions && !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Bot lacks ManageChannels permission to create category "${categoryName}".`
    );
  }

  if (typeof guild.channels?.create === 'function') {
    const created = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: options?.permissionOverwrites || [],
    });
    return { category: created, isNew: true };
  }

  throw new DomainError(DomainErrorCode.VALIDATION_ERROR, `Unable to create category "${categoryName}".`);
}

/**
 * Finds or creates a Text channel within a category idempotently.
 */
async function getOrCreateTextChannel(
  guild: any,
  channelName: string,
  parentCategory: any,
  options?: {
    topic?: string;
    aliases?: string[];
    permissionOverwrites?: any[];
  }
): Promise<{ channel: any; isNew: boolean }> {
  if (!guild) throw new Error('Guild is required');

  const normalized = channelName.trim().toLowerCase();
  const allAliases = [normalized, ...(options?.aliases?.map((a) => a.trim().toLowerCase()) || [])];

  let channel: any = null;

  // Search by name within parent category
  if (guild.channels?.cache) {
    if (parentCategory) {
      channel = guild.channels.cache.find(
        (c: any) =>
          (c.type === ChannelType.GuildText || c.type === 0) &&
          c.parentId === parentCategory.id &&
          allAliases.includes(c.name.trim().toLowerCase())
      );
    } else {
      channel = guild.channels.cache.find(
        (c: any) =>
          (c.type === ChannelType.GuildText || c.type === 0) &&
          !c.parentId &&
          allAliases.includes(c.name.trim().toLowerCase())
      );
    }
  }

  if (channel) {
    return { channel, isNew: false };
  }

  // Create channel if bot has permission
  const me = guild.members?.me;
  if (me && me.permissions && !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Bot lacks ManageChannels permission to create channel "#${channelName}".`
    );
  }

  if (typeof guild.channels?.create === 'function') {
    const created = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: parentCategory ? parentCategory.id : undefined,
      topic: options?.topic,
      permissionOverwrites: options?.permissionOverwrites || [],
    });
    return { channel: created, isNew: true };
  }

  throw new DomainError(DomainErrorCode.VALIDATION_ERROR, `Unable to create channel "#${channelName}".`);
}

/**
 * Upserts a mapping into discord_channel_mappings and returns the record.
 */
async function upsertMapping(data: {
  guildId: string;
  channelKey: string;
  categoryName: string;
  channelName: string;
  purpose: string;
  channelType?: string;
  gameSlug?: string | null;
  serviceId?: number | null;
  serviceMode?: string | null;
  discordChannelId?: string | null;
  parentCategoryId?: string | null;
  isOptional?: boolean;
  isActive?: boolean;
  syncStatus: string;
  lastSyncResult: string;
}): Promise<any> {
  const now = new Date();
  const existing = await prisma.discordChannelMapping.findUnique({
    where: { channelKey: data.channelKey },
    select: { syncStatus: true, discordChannelId: true },
  });

  const isManual = existing?.syncStatus === 'MANUAL';
  const targetSyncStatus = isManual ? 'MANUAL' : data.syncStatus;
  const targetChannelId = isManual && existing?.discordChannelId ? existing.discordChannelId : data.discordChannelId;

  return await prisma.discordChannelMapping.upsert({
    where: { channelKey: data.channelKey },
    create: {
      guildId: data.guildId,
      channelKey: data.channelKey,
      categoryName: data.categoryName,
      channelName: data.channelName,
      purpose: data.purpose,
      channelType: data.channelType || 'GUILD_TEXT',
      gameSlug: data.gameSlug || null,
      serviceId: data.serviceId || null,
      serviceMode: data.serviceMode || null,
      discordChannelId: targetChannelId || null,
      parentCategoryId: data.parentCategoryId || null,
      isOptional: data.isOptional ?? false,
      isActive: data.isActive ?? true,
      syncStatus: targetSyncStatus,
      lastSyncResult: data.lastSyncResult,
      lastSyncedAt: now,
    },
    update: {
      guildId: data.guildId,
      categoryName: data.categoryName,
      channelName: data.channelName,
      purpose: data.purpose,
      channelType: data.channelType || 'GUILD_TEXT',
      gameSlug: data.gameSlug !== undefined ? data.gameSlug : undefined,
      serviceId: data.serviceId !== undefined ? data.serviceId : undefined,
      serviceMode: data.serviceMode !== undefined ? data.serviceMode : undefined,
      discordChannelId: targetChannelId !== undefined ? targetChannelId : undefined,
      parentCategoryId: data.parentCategoryId !== undefined ? data.parentCategoryId : undefined,
      syncStatus: targetSyncStatus,
      lastSyncResult: data.lastSyncResult,
      lastSyncedAt: now,
    },
  });
}

/**
 * Provisions ALL required G4X Discord categories and channels idempotently.
 */
export async function provisionAllChannels(
  options: ProvisioningOptions
): Promise<ProvisioningResult> {
  const { guild, actorId } = options;

  // ۱. بررسی دسترسی مدیر
  const auth = await authorize(actorId, Permission.SERVICE_CONFIG_MANAGE);
  if (!auth.allowed) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      `Permission Denied: ${auth.reason || 'Only authorized management may provision Discord channels.'}`
    );
  }

  if (!guild) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, 'Guild is required for channel provisioning.');
  }

  const guildId = guild.id || 'default_guild';
  const warnings: string[] = [];
  let totalConfigured = 0;
  let synced = 0;
  let created = 0;
  let reused = 0;

  const me = guild.members?.me;
  if (me && me.permissions && !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    warnings.push('Bot lacks ManageChannels permission. Existing channels will be resolved without creating new ones.');
  }

  // ── ۲. Registration & Staff Review Channels ─────────────────────────────────
  try {
    const regResult = await setupRegistrationChannels({ guild, actorId });
    if (regResult.warnings?.length) {
      warnings.push(...regResult.warnings);
    }

    // Save Category START HERE
    if (regResult.categories.startHereId) {
      totalConfigured++;
      await upsertMapping({
        guildId,
        channelKey: 'reg:cat:start_here',
        categoryName: 'START HERE',
        channelName: 'START HERE',
        purpose: 'Public registration panels parent category',
        channelType: 'GUILD_CATEGORY',
        discordChannelId: regResult.categories.startHereId,
        syncStatus: 'SYNCED',
        lastSyncResult: 'Category verified and mapped',
      });
      synced++;
    }

    // Save Category APPLICATION MANAGEMENT
    if (regResult.categories.managementId) {
      totalConfigured++;
      await upsertMapping({
        guildId,
        channelKey: 'reg:cat:app_mgmt',
        categoryName: 'APPLICATION MANAGEMENT',
        channelName: 'APPLICATION MANAGEMENT',
        purpose: 'Private staff application review parent category',
        channelType: 'GUILD_CATEGORY',
        discordChannelId: regResult.categories.managementId,
        syncStatus: 'SYNCED',
        lastSyncResult: 'Category verified and mapped',
      });
      synced++;
    }

    // Public Registration Channels
    const publicDef = [
      { key: 'booster', name: 'become-booster', purpose: 'Public Booster registration workflow panel' },
      { key: 'advertiser', name: 'become-adv', purpose: 'Public Advertiser registration workflow panel' },
      { key: 'pilot', name: 'become-pilot-booster', purpose: 'Public Pilot Booster registration workflow panel' },
      { key: 'exchanger', name: 'become-exchanger', purpose: 'Public Exchanger registration workflow panel' },
    ];
    for (const def of publicDef) {
      totalConfigured++;
      const info = regResult.publicChannels[def.key];
      if (info?.channelId) {
        await upsertMapping({
          guildId,
          channelKey: `reg:public:${def.key}`,
          categoryName: 'START HERE',
          channelName: def.name,
          purpose: def.purpose,
          discordChannelId: info.channelId,
          parentCategoryId: regResult.categories.startHereId || null,
          syncStatus: 'SYNCED',
          lastSyncResult: `Channel verified and panel deployed (${info.panelDeployed ? 'active' : 'ready'})`,
        });
        synced++;
        reused++;
      } else {
        await upsertMapping({
          guildId,
          channelKey: `reg:public:${def.key}`,
          categoryName: 'START HERE',
          channelName: def.name,
          purpose: def.purpose,
          syncStatus: 'MISSING',
          lastSyncResult: 'Channel not found or bot lacks permissions',
        });
      }
    }

    // Official Rules & Policies Channel (#rules-and-policies) under START HERE
    totalConfigured++;
    try {
      const startHereCat = guild.channels?.cache?.get(regResult.categories.startHereId);
      const existingRulesMapping = await prisma.discordChannelMapping.findUnique({
        where: { channelKey: 'rules:channel:official' },
      });

      let rulesChannel: any = null;
      if (existingRulesMapping?.discordChannelId && guild.channels?.cache) {
        rulesChannel = guild.channels.cache.get(existingRulesMapping.discordChannelId);
      }

      if (!rulesChannel) {
        const { channel: foundOrCreated, isNew } = await getOrCreateTextChannel(
          guild,
          'rules-and-policies',
          startHereCat,
          {
            topic: 'Official G4X Community Rules, Guidelines & Policy Documents — https://g4x.online/rules',
            aliases: ['rules', 'rules-policies', 'official-rules', 'rules-and-guidelines'],
            permissionOverwrites: [
              {
                id: guild.roles.everyone.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                deny: [
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.CreatePublicThreads,
                  PermissionFlagsBits.CreatePrivateThreads,
                  PermissionFlagsBits.AddReactions,
                ],
              },
            ],
          }
        );
        rulesChannel = foundOrCreated;
        if (isNew) created++;
        else reused++;
      } else {
        reused++;
      }

      if (rulesChannel?.id) {
        await upsertMapping({
          guildId,
          channelKey: 'rules:channel:official',
          categoryName: 'START HERE',
          channelName: rulesChannel.name || 'rules-and-policies',
          purpose: 'Official community rules and policies document channel',
          discordChannelId: rulesChannel.id,
          parentCategoryId: startHereCat?.id || regResult.categories.startHereId || null,
          syncStatus: 'SYNCED',
          lastSyncResult: 'Official rules channel verified and mapped in START HERE',
        });
        synced++;

        // If a published policy already exists, check if it needs sync or placeholder
        const { getPublishedPolicy, syncPolicyToDiscord } = await import('./policyService');
        const publishedVer = await getPublishedPolicy('community-rules');
        if (publishedVer) {
          if (options.client || (global as any).discordClient) {
            await syncPolicyToDiscord(publishedVer.id, options.client || (global as any).discordClient);
          }
        } else {
          // No published policy: send safe placeholder if channel is empty, without exposing draft
          try {
            if (typeof rulesChannel.messages?.fetch === 'function') {
              const msgs = await rulesChannel.messages.fetch({ limit: 1 });
              if (msgs.size === 0 && typeof rulesChannel.send === 'function') {
                await rulesChannel.send(
                  '# 📜 G4X Community Rules & Policies\nOfficial community policies and platform standards are available at: https://g4x.online/rules'
                );
              }
            }
          } catch {
            // Ignore placeholder send error in mock environments
          }
        }
      } else {
        await upsertMapping({
          guildId,
          channelKey: 'rules:channel:official',
          categoryName: 'START HERE',
          channelName: 'rules-and-policies',
          purpose: 'Official community rules and policies document channel',
          syncStatus: 'MISSING',
          lastSyncResult: 'Rules channel not found or bot lacks permissions',
        });
      }
    } catch (rulesErr: any) {
      warnings.push(`Rules channel provisioning warning: ${rulesErr.message}`);
      await upsertMapping({
        guildId,
        channelKey: 'rules:channel:official',
        categoryName: 'START HERE',
        channelName: 'rules-and-policies',
        purpose: 'Official community rules and policies document channel',
        syncStatus: 'MISSING',
        lastSyncResult: rulesErr.message || 'Provisioning error',
      });
    }

    // Staff Review Channels
    const mgmtDef = [
      { key: 'booster', name: 'app-boosters', purpose: 'Staff review channel for Booster applications' },
      { key: 'advertiser', name: 'app-adv', purpose: 'Staff review channel for Advertiser applications' },
      { key: 'pilot', name: 'app-pilots', purpose: 'Staff review channel for Pilot applications' },
      { key: 'exchanger', name: 'app-exchangers', purpose: 'Staff review channel for Exchanger applications' },
    ];
    for (const def of mgmtDef) {
      totalConfigured++;
      const info = regResult.managementChannels[def.key];
      if (info?.channelId) {
        await upsertMapping({
          guildId,
          channelKey: `reg:mgmt:${def.key}`,
          categoryName: 'APPLICATION MANAGEMENT',
          channelName: def.name,
          purpose: def.purpose,
          discordChannelId: info.channelId,
          parentCategoryId: regResult.categories.managementId || null,
          syncStatus: 'SYNCED',
          lastSyncResult: 'Channel verified and private staff access configured',
        });
        synced++;
        reused++;
      } else {
        await upsertMapping({
          guildId,
          channelKey: `reg:mgmt:${def.key}`,
          categoryName: 'APPLICATION MANAGEMENT',
          channelName: def.name,
          purpose: def.purpose,
          syncStatus: 'MISSING',
          lastSyncResult: 'Channel not found or bot lacks permissions',
        });
      }
    }
  } catch (err: any) {
    warnings.push(`Registration setup warning: ${err?.message || err}`);
  }

  // ── ۳. G4X & Advertiser Orders Creation Panels ──────────────────────────────
  try {
    const orderResult = await setupOrderPanels({ guild, actorId });
    if (orderResult.warnings?.length) {
      warnings.push(...orderResult.warnings);
    }

    // Category G4X ORDERS
    if (orderResult.categories.g4xOrdersId) {
      totalConfigured++;
      await upsertMapping({
        guildId,
        channelKey: 'order_panel:cat:g4x_orders',
        categoryName: 'G4X ORDERS',
        channelName: 'G4X ORDERS',
        purpose: 'Direct community carry panels parent category',
        channelType: 'GUILD_CATEGORY',
        discordChannelId: orderResult.categories.g4xOrdersId,
        syncStatus: 'SYNCED',
        lastSyncResult: 'Category verified and mapped',
      });
      synced++;
    }

    // Category ADVERTISER ORDERS
    if (orderResult.categories.advertiserOrdersId) {
      totalConfigured++;
      await upsertMapping({
        guildId,
        channelKey: 'order_panel:cat:advertiser_orders',
        categoryName: 'ADVERTISER ORDERS',
        channelName: 'ADVERTISER ORDERS',
        purpose: 'Commercial advertiser panels parent category',
        channelType: 'GUILD_CATEGORY',
        discordChannelId: orderResult.categories.advertiserOrdersId,
        syncStatus: 'SYNCED',
        lastSyncResult: 'Category verified and mapped',
      });
      synced++;
    }

    // Order panel channels
    const panelDef = [
      {
        key: 'mythic',
        name: 'wow_midnight_mythic',
        purposeG4x: 'G4X community Mythic+ order creation panel',
        purposeAdv: 'Advertiser commercial Mythic+ order creation panel',
        gameSlug: 'wow_midnight',
        mode: 'non_pilot',
      },
      {
        key: 'non_pilot',
        name: 'non_pilot',
        purposeG4x: 'G4X community Non-Pilot general order creation panel',
        purposeAdv: 'Advertiser commercial Non-Pilot order creation panel',
        mode: 'non_pilot',
      },
      {
        key: 'pilot',
        name: 'pilot',
        purposeG4x: 'G4X community Pilot general order creation panel',
        purposeAdv: 'Advertiser commercial Pilot order creation panel',
        mode: 'pilot',
      },
    ];

    for (const def of panelDef) {
      // G4X Panel
      totalConfigured++;
      const g4xInfo = orderResult.g4xChannels[def.key];
      if (g4xInfo?.channelId) {
        await upsertMapping({
          guildId,
          channelKey: `order_panel:g4x:${def.key}`,
          categoryName: 'G4X ORDERS',
          channelName: def.name,
          purpose: def.purposeG4x,
          gameSlug: def.gameSlug || null,
          serviceMode: def.mode,
          discordChannelId: g4xInfo.channelId,
          parentCategoryId: orderResult.categories.g4xOrdersId || null,
          syncStatus: 'SYNCED',
          lastSyncResult: `Channel verified and panel deployed (${g4xInfo.panelDeployed ? 'active' : 'ready'})`,
        });
        synced++;
        reused++;
      } else {
        await upsertMapping({
          guildId,
          channelKey: `order_panel:g4x:${def.key}`,
          categoryName: 'G4X ORDERS',
          channelName: def.name,
          purpose: def.purposeG4x,
          gameSlug: def.gameSlug || null,
          serviceMode: def.mode,
          syncStatus: 'MISSING',
          lastSyncResult: 'Channel not found or bot lacks permissions',
        });
      }

      // Advertiser Panel
      totalConfigured++;
      const advInfo = orderResult.advertiserChannels[def.key];
      if (advInfo?.channelId) {
        await upsertMapping({
          guildId,
          channelKey: `order_panel:adv:${def.key}`,
          categoryName: 'ADVERTISER ORDERS',
          channelName: def.name,
          purpose: def.purposeAdv,
          gameSlug: def.gameSlug || null,
          serviceMode: def.mode,
          discordChannelId: advInfo.channelId,
          parentCategoryId: orderResult.categories.advertiserOrdersId || null,
          syncStatus: 'SYNCED',
          lastSyncResult: `Channel verified and panel deployed (${advInfo.panelDeployed ? 'active' : 'ready'})`,
        });
        synced++;
        reused++;
      } else {
        await upsertMapping({
          guildId,
          channelKey: `order_panel:adv:${def.key}`,
          categoryName: 'ADVERTISER ORDERS',
          channelName: def.name,
          purpose: def.purposeAdv,
          gameSlug: def.gameSlug || null,
          serviceMode: def.mode,
          syncStatus: 'MISSING',
          lastSyncResult: 'Channel not found or bot lacks permissions',
        });
      }
    }
  } catch (err: any) {
    warnings.push(`Order panels setup warning: ${err?.message || err}`);
  }

  // ── ۴. Game-Specific Order Publication Channels ─────────────────────────────
  try {
    const pubResult = await setupPublicationChannels({ guild, actorId });
    if (pubResult.warnings?.length) {
      warnings.push(...pubResult.warnings);
    }

    // WoW Midnight Category
    if (pubResult.categories.wowMidnightId) {
      totalConfigured++;
      await upsertMapping({
        guildId,
        channelKey: 'publication:cat:wow_midnight',
        categoryName: 'WoW Midnight',
        channelName: 'WoW Midnight',
        purpose: 'WoW Midnight verified order publication parent category',
        channelType: 'GUILD_CATEGORY',
        gameSlug: 'wow_midnight',
        discordChannelId: pubResult.categories.wowMidnightId,
        syncStatus: 'SYNCED',
        lastSyncResult: 'Category verified and mapped',
      });
      synced++;
    }

    // WoW Forever Category
    if (pubResult.categories.wowForeverId) {
      totalConfigured++;
      await upsertMapping({
        guildId,
        channelKey: 'publication:cat:wow_forever',
        categoryName: 'WoW Forever',
        channelName: 'WoW Forever',
        purpose: 'WoW Forever verified order publication parent category',
        channelType: 'GUILD_CATEGORY',
        gameSlug: 'wow_forever',
        discordChannelId: pubResult.categories.wowForeverId,
        syncStatus: 'SYNCED',
        lastSyncResult: 'Category verified and mapped',
      });
      synced++;
    }

    // WoW Midnight Publication Channels
    const wmChannels = [
      {
        id: pubResult.channels.wowMidnightMythicId,
        name: 'mythic_plus_boosts',
        key: 'mythic_plus_boosts',
        purpose: 'WoW Midnight Mythic+ verified order publication channel',
        mode: 'non_pilot',
      },
      {
        id: pubResult.channels.wowMidnightNonPilotId,
        name: 'non_pilot_boosts',
        key: 'non_pilot_boosts',
        purpose: 'WoW Midnight Non-Pilot verified order publication channel',
        mode: 'non_pilot',
      },
      {
        id: pubResult.channels.wowMidnightPilotId,
        name: 'pilot_boosts',
        key: 'pilot_boosts',
        purpose: 'WoW Midnight Pilot verified order publication channel',
        mode: 'pilot',
      },
    ];

    for (const c of wmChannels) {
      totalConfigured++;
      if (c.id) {
        await upsertMapping({
          guildId,
          channelKey: `publication:wow_midnight:${c.key}`,
          categoryName: 'WoW Midnight',
          channelName: c.name,
          purpose: c.purpose,
          gameSlug: 'wow_midnight',
          serviceMode: c.mode,
          discordChannelId: c.id,
          parentCategoryId: pubResult.categories.wowMidnightId || null,
          syncStatus: 'SYNCED',
          lastSyncResult: 'Channel verified and ChannelRoute updated',
        });
        synced++;
        reused++;
      } else {
        await upsertMapping({
          guildId,
          channelKey: `publication:wow_midnight:${c.key}`,
          categoryName: 'WoW Midnight',
          channelName: c.name,
          purpose: c.purpose,
          gameSlug: 'wow_midnight',
          serviceMode: c.mode,
          syncStatus: 'MISSING',
          lastSyncResult: 'Channel not found or bot lacks permissions',
        });
      }
    }

    // WoW Forever Publication Channels
    const wfChannels = [
      {
        id: pubResult.channels.wowForeverNonPilotId,
        name: 'non_pilot_boosts',
        key: 'non_pilot_boosts',
        purpose: 'WoW Forever Non-Pilot verified order publication channel',
        mode: 'non_pilot',
      },
      {
        id: pubResult.channels.wowForeverPilotId,
        name: 'pilot_boosts',
        key: 'pilot_boosts',
        purpose: 'WoW Forever Pilot verified order publication channel',
        mode: 'pilot',
      },
    ];

    for (const c of wfChannels) {
      totalConfigured++;
      if (c.id) {
        await upsertMapping({
          guildId,
          channelKey: `publication:wow_forever:${c.key}`,
          categoryName: 'WoW Forever',
          channelName: c.name,
          purpose: c.purpose,
          gameSlug: 'wow_forever',
          serviceMode: c.mode,
          discordChannelId: c.id,
          parentCategoryId: pubResult.categories.wowForeverId || null,
          syncStatus: 'SYNCED',
          lastSyncResult: 'Channel verified and ChannelRoute updated',
        });
        synced++;
        reused++;
      } else {
        await upsertMapping({
          guildId,
          channelKey: `publication:wow_forever:${c.key}`,
          categoryName: 'WoW Forever',
          channelName: c.name,
          purpose: c.purpose,
          gameSlug: 'wow_forever',
          serviceMode: c.mode,
          syncStatus: 'MISSING',
          lastSyncResult: 'Channel not found or bot lacks permissions',
        });
      }
    }
  } catch (err: any) {
    warnings.push(`Publication setup warning: ${err?.message || err}`);
  }

  // ── ۵. Dynamic Games from Admin Catalog ─────────────────────────────────────
  try {
    const allGames = await prisma.game.findMany({
      include: {
        services: true,
      },
    });

    for (const game of allGames) {
      // Skip WoW Midnight and WoW Forever as they are standard core structures
      if (game.slug === 'wow_midnight' || game.slug === 'wow_forever') {
        continue;
      }

      if (!game.isActive) {
        // For disabled games: mark mappings as DISABLED
        await prisma.discordChannelMapping.updateMany({
          where: { gameSlug: game.slug },
          data: {
            isActive: false,
            syncStatus: 'DISABLED',
            lastSyncResult: 'Game is currently disabled in catalog',
          },
        });
        continue;
      }

      // Game is enabled: determine supported order types
      const supportsNonPilot =
        game.serviceCategory === 'non_pilot' ||
        game.serviceCategory === 'both' ||
        game.services.some((s) => s.isActive && s.serviceMode === 'non_pilot');

      const supportsPilot =
        game.serviceCategory === 'pilot' ||
        game.serviceCategory === 'both' ||
        game.services.some((s) => s.isActive && s.serviceMode === 'pilot');

      // Resolve or create category for this game
      let gameCategory: any = null;
      try {
        const { category, isNew } = await getOrCreateCategory(guild, game.displayName);
        gameCategory = category;
        if (isNew) created++;
        else reused++;

        totalConfigured++;
        await upsertMapping({
          guildId,
          channelKey: `publication:cat:${game.slug}`,
          categoryName: game.displayName,
          channelName: game.displayName,
          purpose: `${game.displayName} verified order publication parent category`,
          channelType: 'GUILD_CATEGORY',
          gameSlug: game.slug,
          discordChannelId: gameCategory.id,
          syncStatus: 'SYNCED',
          lastSyncResult: 'Category verified and mapped',
        });
        synced++;
      } catch (catErr: any) {
        warnings.push(`Failed to resolve category for game "${game.displayName}": ${catErr.message}`);
      }

      if (supportsNonPilot) {
        totalConfigured++;
        try {
          const { channel, isNew } = await getOrCreateTextChannel(
            guild,
            'non_pilot_boosts',
            gameCategory,
            {
              topic: `${game.displayName} verified Non-Pilot boost orders`,
              aliases: ['non-pilot-boosts'],
            }
          );
          if (isNew) created++;
          else reused++;

          await upsertMapping({
            guildId,
            channelKey: `publication:${game.slug}:non_pilot_boosts`,
            categoryName: game.displayName,
            channelName: 'non_pilot_boosts',
            purpose: `${game.displayName} Non-Pilot verified order publication channel`,
            gameSlug: game.slug,
            serviceMode: 'non_pilot',
            discordChannelId: channel.id,
            parentCategoryId: gameCategory?.id || null,
            syncStatus: 'SYNCED',
            lastSyncResult: 'Channel verified and mapped',
          });
          synced++;

          // Synchronize ChannelRoute
          const existingRoute = await prisma.channelRoute.findFirst({
            where: {
              discordGuildId: guildId,
              gameSlug: game.slug,
              serviceMode: 'non_pilot',
            },
          });
          if (existingRoute) {
            await prisma.channelRoute.update({
              where: { id: existingRoute.id },
              data: { discordChannelId: channel.id, isActive: true },
            });
          } else {
            await prisma.channelRoute.create({
              data: {
                discordGuildId: guildId,
                gameSlug: game.slug,
                serviceMode: 'non_pilot',
                discordChannelId: channel.id,
                isActive: true,
              },
            });
          }
        } catch (chErr: any) {
          warnings.push(`Failed to provision non_pilot_boosts for "${game.displayName}": ${chErr.message}`);
        }
      }

      if (supportsPilot) {
        totalConfigured++;
        try {
          const { channel, isNew } = await getOrCreateTextChannel(
            guild,
            'pilot_boosts',
            gameCategory,
            {
              topic: `${game.displayName} verified Pilot boost orders`,
              aliases: ['pilot-boosts'],
            }
          );
          if (isNew) created++;
          else reused++;

          await upsertMapping({
            guildId,
            channelKey: `publication:${game.slug}:pilot_boosts`,
            categoryName: game.displayName,
            channelName: 'pilot_boosts',
            purpose: `${game.displayName} Pilot verified order publication channel`,
            gameSlug: game.slug,
            serviceMode: 'pilot',
            discordChannelId: channel.id,
            parentCategoryId: gameCategory?.id || null,
            syncStatus: 'SYNCED',
            lastSyncResult: 'Channel verified and mapped',
          });
          synced++;

          // Synchronize ChannelRoute
          const existingRoute = await prisma.channelRoute.findFirst({
            where: {
              discordGuildId: guildId,
              gameSlug: game.slug,
              serviceMode: 'pilot',
            },
          });
          if (existingRoute) {
            await prisma.channelRoute.update({
              where: { id: existingRoute.id },
              data: { discordChannelId: channel.id, isActive: true },
            });
          } else {
            await prisma.channelRoute.create({
              data: {
                discordGuildId: guildId,
                gameSlug: game.slug,
                serviceMode: 'pilot',
                discordChannelId: channel.id,
                isActive: true,
              },
            });
          }
        } catch (chErr: any) {
          warnings.push(`Failed to provision pilot_boosts for "${game.displayName}": ${chErr.message}`);
        }
      }
    }
  } catch (err: any) {
    warnings.push(`Dynamic games provisioning warning: ${err?.message || err}`);
  }

  // ── ۶. Private Order Execution Category Infrastructure ─────────────────────
  try {
    const execCategory = await resolveOrCreateExecutionCategory(guild);
    totalConfigured++;
    if (execCategory?.id) {
      await upsertMapping({
        guildId,
        channelKey: 'execution:cat:active_orders',
        categoryName: 'ACTIVE ORDERS',
        channelName: 'ACTIVE ORDERS',
        purpose: 'Parent category for dynamic order-<id> coordination channels',
        channelType: 'GUILD_CATEGORY',
        discordChannelId: execCategory.id,
        syncStatus: 'SYNCED',
        lastSyncResult: 'Category verified and ready for execution channels',
      });
      synced++;
      reused++;
    } else {
      await upsertMapping({
        guildId,
        channelKey: 'execution:cat:active_orders',
        categoryName: 'ACTIVE ORDERS',
        channelName: 'ACTIVE ORDERS',
        purpose: 'Parent category for dynamic order-<id> coordination channels',
        channelType: 'GUILD_CATEGORY',
        syncStatus: 'MISSING',
        lastSyncResult: 'Category could not be created or bot lacks permissions',
      });
    }
  } catch (err: any) {
    warnings.push(`Execution category provisioning warning: ${err?.message || err}`);
  }

  // ۷. ثبت لاگ حسابرسی
  await logAudit(
    actorId,
    'DISCORD_CHANNELS_AUTO_PROVISIONED',
    guildId,
    null,
    { totalConfigured, synced, created, reused },
    'Automatic Discord channel provisioning and reconciliation executed'
  );

  const mappings = await listChannelMappings({ guildId });

  return {
    success: true,
    totalConfigured,
    synced,
    created,
    reused,
    warnings,
    mappings,
  };
}

/**
 * Reconciles existing database mappings against the actual Discord guild channels.
 */
export async function reconcileChannelMappings(options: {
  guild: any;
  actorId?: string;
}): Promise<ReconciliationResult> {
  const { guild, actorId } = options;
  if (!guild) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, 'Guild is required for reconciliation.');
  }

  const guildId = guild.id || 'default_guild';
  const mappings = await prisma.discordChannelMapping.findMany({
    where: { guildId },
    include: { game: true, service: true },
  });

  let synced = 0;
  let missing = 0;
  let invalid = 0;
  let disabled = 0;
  const warnings: string[] = [];

  for (const m of mappings) {
    if (!m.isActive) {
      disabled++;
      await prisma.discordChannelMapping.update({
        where: { id: m.id },
        data: {
          syncStatus: 'DISABLED',
          lastSyncResult: 'Mapping is marked inactive by admin',
          lastSyncedAt: new Date(),
        },
      });
      continue;
    }

    if (!m.discordChannelId) {
      missing++;
      await prisma.discordChannelMapping.update({
        where: { id: m.id },
        data: {
          syncStatus: 'MISSING',
          lastSyncResult: 'No Discord Channel ID assigned',
          lastSyncedAt: new Date(),
        },
      });
      continue;
    }

    // Lookup channel in guild
    let actualChannel: any = null;
    if (guild.channels?.cache) {
      actualChannel = guild.channels.cache.get(m.discordChannelId);
    }

    if (!actualChannel) {
      missing++;
      await prisma.discordChannelMapping.update({
        where: { id: m.id },
        data: {
          syncStatus: 'MISSING',
          lastSyncResult: `Channel ID ${m.discordChannelId} not found in guild`,
          lastSyncedAt: new Date(),
        },
      });
      continue;
    }

    // Verify channel type
    const isCategory = actualChannel.type === ChannelType.GuildCategory || actualChannel.type === 4;
    const isText = actualChannel.type === ChannelType.GuildText || actualChannel.type === 0;

    if (m.channelType === 'GUILD_CATEGORY' && !isCategory) {
      invalid++;
      await prisma.discordChannelMapping.update({
        where: { id: m.id },
        data: {
          syncStatus: 'INVALID',
          lastSyncResult: `Expected category but found channel type ${actualChannel.type}`,
          lastSyncedAt: new Date(),
        },
      });
      continue;
    }

    if (m.channelType === 'GUILD_TEXT' && !isText) {
      invalid++;
      await prisma.discordChannelMapping.update({
        where: { id: m.id },
        data: {
          syncStatus: 'INVALID',
          lastSyncResult: `Expected text channel but found channel type ${actualChannel.type}`,
          lastSyncedAt: new Date(),
        },
      });
      continue;
    }

    synced++;
    await prisma.discordChannelMapping.update({
      where: { id: m.id },
      data: {
        syncStatus: m.syncStatus === 'MANUAL' ? 'MANUAL' : 'SYNCED',
        lastSyncResult: 'Channel actively verified in guild',
        lastSyncedAt: new Date(),
      },
    });
  }

  if (actorId) {
    await logAudit(
      actorId,
      'DISCORD_CHANNELS_RECONCILED',
      guildId,
      null,
      { total: mappings.length, synced, missing, invalid, disabled },
      'Discord channel reconciliation completed'
    );
  }

  const updatedMappings = await listChannelMappings({ guildId });

  return {
    total: mappings.length,
    synced,
    missing,
    invalid,
    disabled,
    warnings,
    mappings: updatedMappings,
  };
}

/**
 * Validates a manual Channel ID against a Discord Guild.
 */
export async function validateDiscordChannel(
  channelId: string,
  guild: any,
  expectedType?: 'GUILD_CATEGORY' | 'GUILD_TEXT'
): Promise<{
  valid: boolean;
  channelName?: string;
  channelType?: string;
  error?: string;
}> {
  if (!channelId || typeof channelId !== 'string') {
    return { valid: false, error: 'Channel ID must be a valid non-empty string' };
  }

  if (!guild) {
    return { valid: false, error: 'Discord Guild is not available for validation' };
  }

  let channel: any = null;
  if (guild.channels?.cache) {
    channel = guild.channels.cache.get(channelId.trim());
  }

  if (!channel && typeof guild.channels?.fetch === 'function') {
    try {
      channel = await guild.channels.fetch(channelId.trim());
    } catch {
      channel = null;
    }
  }

  if (!channel) {
    return {
      valid: false,
      error: `Channel with ID "${channelId}" was not found in guild "${guild.name || guild.id}".`,
    };
  }

  const isCategory = channel.type === ChannelType.GuildCategory || channel.type === 4;
  const isText = channel.type === ChannelType.GuildText || channel.type === 0;

  if (expectedType === 'GUILD_CATEGORY' && !isCategory) {
    return {
      valid: false,
      channelName: channel.name,
      channelType: String(channel.type),
      error: `Channel "${channel.name}" is not a Category (type: ${channel.type}).`,
    };
  }

  if (expectedType === 'GUILD_TEXT' && !isText) {
    return {
      valid: false,
      channelName: channel.name,
      channelType: String(channel.type),
      error: `Channel "#${channel.name}" is not a Text Channel (type: ${channel.type}).`,
    };
  }

  return {
    valid: true,
    channelName: channel.name,
    channelType: isCategory ? 'GUILD_CATEGORY' : isText ? 'GUILD_TEXT' : String(channel.type),
  };
}

/**
 * Manually updates a channel mapping's Discord Channel ID.
 * CRITICAL RULE: Editing Channel ID NEVER causes the bot to delete the old channel!
 */
export async function updateChannelMapping(options: {
  channelKey: string;
  newChannelId: string;
  actorId: string;
  guild?: any;
}): Promise<ChannelMappingRecord> {
  const { channelKey, newChannelId, actorId, guild } = options;

  // ۱. بررسی دسترسی مدیر
  const auth = await authorize(actorId, Permission.SERVICE_CONFIG_MANAGE);
  if (!auth.allowed) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      `Permission Denied: ${auth.reason || 'Only authorized management may edit Discord channel mappings.'}`
    );
  }

  const existing = await prisma.discordChannelMapping.findUnique({
    where: { channelKey },
    include: { game: true, service: true },
  });

  if (!existing) {
    throw new DomainError(DomainErrorCode.CHANNEL_NOT_FOUND, `Channel mapping with key "${channelKey}" not found.`);
  }

  const cleanNewId = newChannelId.trim();

  // ۲. اعتبارسنجی در گیلد (در صورت وجود گیلد)
  if (guild) {
    const valResult = await validateDiscordChannel(
      cleanNewId,
      guild,
      existing.channelType as any
    );
    if (!valResult.valid) {
      throw new DomainError(
        DomainErrorCode.VALIDATION_ERROR,
        `Channel validation failed: ${valResult.error}`
      );
    }
  }

  // ۳. به‌روزرسانی در دیتابیس بدون حذف کانال قدیمی دیسکورد (Zero Deletion Rule)
  const previousValues = {
    discordChannelId: existing.discordChannelId,
    syncStatus: existing.syncStatus,
    lastSyncResult: existing.lastSyncResult,
  };

  const updated = await prisma.discordChannelMapping.update({
    where: { channelKey },
    data: {
      discordChannelId: cleanNewId,
      syncStatus: 'MANUAL',
      lastSyncResult: `Manually assigned by admin at ${new Date().toISOString()}`,
      lastSyncedAt: new Date(),
    },
    include: { game: true, service: true },
  });

  // ۴. در صورت تعلق به Publication، کانال روت ChannelRoute نیز هماهنگ شود
  if (existing.gameSlug && existing.serviceMode) {
    await prisma.channelRoute.updateMany({
      where: {
        discordGuildId: existing.guildId,
        gameSlug: existing.gameSlug,
        serviceMode: existing.serviceMode,
      },
      data: {
        discordChannelId: cleanNewId,
        isActive: true,
      },
    });
  }

  // ۵. ثبت لاگ حسابرسی
  await logAudit(
    actorId,
    'DISCORD_CHANNEL_MAPPING_UPDATED',
    channelKey,
    previousValues,
    { discordChannelId: cleanNewId, syncStatus: 'MANUAL' },
    `Channel ID manually edited from "${existing.discordChannelId || 'none'}" to "${cleanNewId}"`
  );

  return updated;
}

/**
 * Repairs a missing or invalid channel mapping by re-finding or recreating it.
 */
export async function repairChannelMapping(options: {
  channelKey: string;
  guild: any;
  actorId: string;
}): Promise<ChannelMappingRecord> {
  const { channelKey, guild, actorId } = options;

  // ۱. بررسی دسترسی مدیر
  const auth = await authorize(actorId, Permission.SERVICE_CONFIG_MANAGE);
  if (!auth.allowed) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      `Permission Denied: ${auth.reason || 'Only authorized management may repair Discord channel mappings.'}`
    );
  }

  if (!guild) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, 'Guild is required to repair a mapping.');
  }

  const existing = await prisma.discordChannelMapping.findUnique({
    where: { channelKey },
    include: { game: true, service: true },
  });

  if (!existing) {
    throw new DomainError(DomainErrorCode.CHANNEL_NOT_FOUND, `Channel mapping with key "${channelKey}" not found.`);
  }

  // Resolve parent category if needed
  let parentCategory: any = null;
  if (existing.categoryName && existing.channelType === 'GUILD_TEXT') {
    const { category } = await getOrCreateCategory(guild, existing.categoryName);
    parentCategory = category;
  }

  let resolvedChannelId: string | null = null;
  let syncMsg = '';

  if (existing.channelType === 'GUILD_CATEGORY') {
    const { category, isNew } = await getOrCreateCategory(guild, existing.categoryName);
    resolvedChannelId = category.id;
    syncMsg = isNew ? 'Category created and repaired' : 'Existing category rediscovered and repaired';
  } else {
    const { channel, isNew } = await getOrCreateTextChannel(
      guild,
      existing.channelName,
      parentCategory,
      {
        topic: existing.purpose,
      }
    );
    resolvedChannelId = channel.id;
    syncMsg = isNew ? 'Text channel created and repaired' : 'Existing channel rediscovered and repaired';
  }

  const updated = await prisma.discordChannelMapping.update({
    where: { channelKey },
    data: {
      discordChannelId: resolvedChannelId,
      parentCategoryId: parentCategory?.id || existing.parentCategoryId,
      syncStatus: 'SYNCED',
      lastSyncResult: `${syncMsg} at ${new Date().toISOString()}`,
      lastSyncedAt: new Date(),
    },
    include: { game: true, service: true },
  });

  // Sync ChannelRoute if publication
  if (existing.gameSlug && existing.serviceMode && resolvedChannelId) {
    await prisma.channelRoute.updateMany({
      where: {
        discordGuildId: existing.guildId,
        gameSlug: existing.gameSlug,
        serviceMode: existing.serviceMode,
      },
      data: {
        discordChannelId: resolvedChannelId,
        isActive: true,
      },
    });
  }

  await logAudit(
    actorId,
    'DISCORD_CHANNEL_MAPPING_REPAIRED',
    channelKey,
    { oldChannelId: existing.discordChannelId, oldStatus: existing.syncStatus },
    { newChannelId: resolvedChannelId, newStatus: 'SYNCED' },
    `Channel mapping repaired and re-synced`
  );

  return updated;
}

/**
 * Enables or disables an optional channel mapping.
 */
export async function toggleChannelMappingStatus(options: {
  channelKey: string;
  isActive: boolean;
  actorId: string;
}): Promise<ChannelMappingRecord> {
  const { channelKey, isActive, actorId } = options;

  // ۱. بررسی دسترسی مدیر
  const auth = await authorize(actorId, Permission.SERVICE_CONFIG_MANAGE);
  if (!auth.allowed) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      `Permission Denied: ${auth.reason || 'Only authorized management may toggle channel mapping status.'}`
    );
  }

  const existing = await prisma.discordChannelMapping.findUnique({
    where: { channelKey },
  });

  if (!existing) {
    throw new DomainError(DomainErrorCode.CHANNEL_NOT_FOUND, `Channel mapping with key "${channelKey}" not found.`);
  }

  const updated = await prisma.discordChannelMapping.update({
    where: { channelKey },
    data: {
      isActive,
      syncStatus: isActive ? (existing.discordChannelId ? 'SYNCED' : 'PENDING') : 'DISABLED',
      lastSyncResult: isActive
        ? `Re-enabled by admin at ${new Date().toISOString()}`
        : `Disabled by admin at ${new Date().toISOString()}`,
      lastSyncedAt: new Date(),
    },
    include: { game: true, service: true },
  });

  await logAudit(
    actorId,
    'DISCORD_CHANNEL_MAPPING_STATUS_TOGGLED',
    channelKey,
    { isActive: existing.isActive, status: existing.syncStatus },
    { isActive: updated.isActive, status: updated.syncStatus },
    `Channel mapping status set to ${isActive ? 'active' : 'disabled'}`
  );

  return updated;
}

/**
 * Returns all channel mappings with filters.
 */
export async function listChannelMappings(filter?: {
  guildId?: string;
  categoryName?: string;
  syncStatus?: string;
  gameSlug?: string;
}): Promise<ChannelMappingRecord[]> {
  const where: any = {};
  if (filter?.guildId) where.guildId = filter.guildId;
  if (filter?.categoryName) where.categoryName = filter.categoryName;
  if (filter?.syncStatus) where.syncStatus = filter.syncStatus;
  if (filter?.gameSlug) where.gameSlug = filter.gameSlug;

  const records = await prisma.discordChannelMapping.findMany({
    where,
    include: {
      game: { select: { slug: true, displayName: true } },
      service: { select: { id: true, displayName: true, serviceMode: true } },
    },
    orderBy: [{ categoryName: 'asc' }, { channelName: 'asc' }],
  });

  return records;
}
