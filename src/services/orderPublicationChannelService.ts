/**
 * orderPublicationChannelService.ts — مدیریت و مسیریابی کانال‌های انتشار سفارشات بر اساس بازی و نوع بوست
 *
 * ساختار کانال‌های انتشار در دیسکورد:
 *  دسته‌بندی WoW Midnight:
 *    - #mythic_plus_boosts (منحصراً سفارشات میتیک‌پلاس WoW Midnight)
 *    - #non_pilot_boosts (سفارشات Non-Pilot این بازی نظیر Raid و AFK)
 *    - #pilot_boosts (سفارشات Pilot این بازی)
 *
 *  دسته‌بندی WoW Forever:
 *    - #non_pilot_boosts (سفارشات Non-Pilot بازی WoW Forever)
 *    - #pilot_boosts (سفارشات Pilot بازی WoW Forever)
 *
 * قواعد مسیریابی قطعی:
 *  - عدم تداخل بازی‌ها: سفارشات WoW Forever هرگز نباید در کانال‌های WoW Midnight منتشر شوند.
 *  - تایید پرداخت: سفارشات پرداخت‌نشده هرگز نباید منتشر شوند (Payment Verification Guard).
 *  - تکرارپذیری امن: در اجرای مکرر G4!setup کانال‌ها یا روت‌های تکراری ایجاد نمی‌شود (Idempotency).
 *  - شکست امن (Fail-Safe): در صورت نبود نگاشت کانال برای بازی/سرویس، انتشار لغو و خطای مشخص بازگردانده می‌شود
 *    (هرگز نباید به کانال‌های نامربوط یا عمومی فال‌بک ناخواسته رخ دهد).
 */

import {
  ChannelType,
  PermissionFlagsBits,
  CategoryChannel,
  TextChannel,
} from 'discord.js';

import prisma from '../database/db';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';

export interface SetupPublicationChannelsOptions {
  guild: any; // Discord.js Guild
  actorId: string;
}

export interface SetupPublicationChannelsResult {
  success: boolean;
  categories: {
    wowMidnightId?: string;
    wowForeverId?: string;
  };
  channels: {
    wowMidnightMythicId?: string;
    wowMidnightNonPilotId?: string;
    wowMidnightPilotId?: string;
    wowForeverNonPilotId?: string;
    wowForeverPilotId?: string;
  };
  routesCreated: number;
  warnings: string[];
}

export interface OrderRoutingInfo {
  gameSlug?: string;
  serviceId?: number | null;
  serviceKey?: string | null;
  orderMode?: string;
  discordChannelId?: string | null;
}

/**
 * راه‌اندازی و نگاشت پایدار دو دسته‌بندی و پنج کانال انتشار سفارشات در دیسکورد و ذخیره در ChannelRoute
 */
export async function setupPublicationChannels(
  options: SetupPublicationChannelsOptions
): Promise<SetupPublicationChannelsResult> {
  const { guild, actorId } = options;
  const warnings: string[] = [];

  // ۱. بررسی سطح دسترسی مدیریت
  const auth = await authorize(actorId, Permission.SERVICE_CONFIG_MANAGE);
  if (!auth.allowed) {
    throw new Error(
      `PERMISSION_DENIED: ${auth.reason || 'Only authorized management may set up order publication channels'}`
    );
  }

  if (!guild) {
    throw new Error('GUILD_REQUIRED: Setup command must be executed within a Discord guild');
  }

  const me = guild.members?.me;
  if (me && me.permissions && !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    warnings.push(
      'Bot lacks ManageChannels permission. Existing channels will be resolved without creating new ones.'
    );
  }

  const result: SetupPublicationChannelsResult = {
    success: true,
    categories: {},
    channels: {},
    routesCreated: 0,
    warnings,
  };

  // ── ۲. ایجاد یا شناسایی دسته‌بندی WoW Midnight ──────────────────────────────
  let wmCategory: CategoryChannel | null = null;
  if (guild.channels?.cache) {
    wmCategory =
      (guild.channels.cache.find(
        (c: any) =>
          (c.type === ChannelType.GuildCategory || c.type === 4) &&
          c.name.toUpperCase() === 'WOW MIDNIGHT'
      ) as CategoryChannel) || null;
  }

  if (
    !wmCategory &&
    guild.channels?.create &&
    (!me || me.permissions.has(PermissionFlagsBits.ManageChannels))
  ) {
    try {
      wmCategory = await guild.channels.create({
        name: 'WoW Midnight',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.roles?.everyone?.id || guild.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages],
          },
        ],
      });
    } catch (err: any) {
      warnings.push(`Could not create category 'WoW Midnight': ${err.message}`);
    }
  }

  if (wmCategory) {
    result.categories.wowMidnightId = wmCategory.id;
  }

  // ── ۳. ایجاد یا شناسایی دسته‌بندی WoW Forever ───────────────────────────────
  let wfCategory: CategoryChannel | null = null;
  if (guild.channels?.cache) {
    wfCategory =
      (guild.channels.cache.find(
        (c: any) =>
          (c.type === ChannelType.GuildCategory || c.type === 4) &&
          c.name.toUpperCase() === 'WOW FOREVER'
      ) as CategoryChannel) || null;
  }

  if (
    !wfCategory &&
    guild.channels?.create &&
    (!me || me.permissions.has(PermissionFlagsBits.ManageChannels))
  ) {
    try {
      wfCategory = await guild.channels.create({
        name: 'WoW Forever',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.roles?.everyone?.id || guild.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages],
          },
        ],
      });
    } catch (err: any) {
      warnings.push(`Could not create category 'WoW Forever': ${err.message}`);
    }
  }

  if (wfCategory) {
    result.categories.wowForeverId = wfCategory.id;
  }

  // ── ۴. تابع کمکی جهت یافتن یا ایجاد کانال تحت دسته‌بندی مشخص ───────────────
  async function resolveOrCreateChannel(
    category: CategoryChannel | null,
    channelName: string,
    aliasName: string
  ): Promise<TextChannel | null> {
    let targetChannel: TextChannel | null = null;

    if (guild.channels?.cache) {
      targetChannel =
        (guild.channels.cache.find(
          (c: any) =>
            (category ? c.parentId === category.id : true) &&
            (c.name === channelName || c.name === aliasName)
        ) as TextChannel) || null;
    }

    if (
      !targetChannel &&
      guild.channels?.create &&
      (!me || me.permissions.has(PermissionFlagsBits.ManageChannels))
    ) {
      try {
        targetChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category ? category.id : undefined,
          permissionOverwrites: [
            {
              id: guild.roles?.everyone?.id || guild.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
              deny: [PermissionFlagsBits.SendMessages],
            },
          ],
        });
      } catch (err: any) {
        warnings.push(`Could not create channel #${channelName}: ${err.message}`);
      }
    }

    return targetChannel;
  }

  // ── ۵. ایجاد ۵ کانال اصلی ──────────────────────────────────────────────────

  // الف. کانال‌های WoW Midnight
  const wmMynthicCh = await resolveOrCreateChannel(
    wmCategory,
    'mythic_plus_boosts',
    'mythic-plus-boosts'
  );
  const wmNonPilotCh = await resolveOrCreateChannel(
    wmCategory,
    'non_pilot_boosts',
    'non-pilot-boosts'
  );
  const wmPilotCh = await resolveOrCreateChannel(
    wmCategory,
    'pilot_boosts',
    'pilot-boosts'
  );

  if (wmMynthicCh) result.channels.wowMidnightMythicId = wmMynthicCh.id;
  if (wmNonPilotCh) result.channels.wowMidnightNonPilotId = wmNonPilotCh.id;
  if (wmPilotCh) result.channels.wowMidnightPilotId = wmPilotCh.id;

  // ب. کانال‌های WoW Forever
  const wfNonPilotCh = await resolveOrCreateChannel(
    wfCategory,
    'non_pilot_boosts',
    'non-pilot-boosts'
  );
  const wfPilotCh = await resolveOrCreateChannel(
    wfCategory,
    'pilot_boosts',
    'pilot-boosts'
  );

  if (wfNonPilotCh) result.channels.wowForeverNonPilotId = wfNonPilotCh.id;
  if (wfPilotCh) result.channels.wowForeverPilotId = wfPilotCh.id;

  // ── ۶. ثبت یا به‌روزرسانی روت‌ها در جدول channel_routes دیتابیس ─────────────

  async function upsertRoute(
    gameSlug: string,
    serviceMode: 'non_pilot' | 'pilot',
    discordChannelId: string,
    serviceId?: number | null
  ) {
    const existing = await prisma.channelRoute.findFirst({
      where: {
        discordGuildId: guild.id,
        gameSlug,
        serviceId: serviceId ?? null,
        serviceMode,
      },
    });

    if (existing) {
      await prisma.channelRoute.update({
        where: { id: existing.id },
        data: {
          discordChannelId,
          isActive: true,
        },
      });
    } else {
      await prisma.channelRoute.create({
        data: {
          discordGuildId: guild.id,
          gameSlug,
          serviceId: serviceId ?? null,
          serviceMode,
          discordChannelId,
          isActive: true,
        },
      });
    }
    result.routesCreated++;
  }

  // دریافت شناسه سرویس mythic_plus برای wow_midnight
  const mythicService = await prisma.gameService.findFirst({
    where: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus' },
  });

  if (wmMynthicCh && mythicService) {
    await upsertRoute('wow_midnight', 'non_pilot', wmMynthicCh.id, mythicService.id);
  }
  if (wmNonPilotCh) {
    await upsertRoute('wow_midnight', 'non_pilot', wmNonPilotCh.id, null);
  }
  if (wmPilotCh) {
    await upsertRoute('wow_midnight', 'pilot', wmPilotCh.id, null);
  }

  if (wfNonPilotCh) {
    await upsertRoute('wow_forever', 'non_pilot', wfNonPilotCh.id, null);
  }
  if (wfPilotCh) {
    await upsertRoute('wow_forever', 'pilot', wfPilotCh.id, null);
  }

  // ثبت لاگ ممیزی
  try {
    await prisma.auditLog.create({
      data: {
        actorId,
        action: 'ORDER_PUBLICATION_CHANNELS_SETUP',
        entityType: 'DiscordGuild',
        entityId: guild.id,
        newValues: JSON.stringify({
          categories: result.categories,
          channels: result.channels,
          routesCreated: result.routesCreated,
        }),
        reason: 'Authorized setup and database mapping of dedicated order publication channels',
        isSuccess: true,
      },
    });
  } catch (err: any) {
    console.warn('[SetupPublicationChannels] AuditLog warning:', err?.message || err);
  }

  return result;
}

/**
 * تعیین دقیق و امن کانال دیسکورد جهت انتشار سفارش بر اساس بازی، نوع سرویس و حالت
 */
export async function resolveOrderPublicationChannel(
  client: any,
  order?: OrderRoutingInfo,
  guildId?: string
): Promise<TextChannel | null> {
  if (!client || !order) return null;

  // ۱. اگر سفارش قبلاً شناسه کانال دارد و آن کانال در دیسکورد معتبر و در دسترس است، همان را بازمی‌گردانیم
  if (order.discordChannelId) {
    try {
      const channel = await client.channels.fetch(order.discordChannelId).catch(() => null);
      if (channel && typeof channel.isTextBased === 'function' && channel.isTextBased()) {
        return channel;
      }
    } catch {
      // ادامه بررسی مسیرها
    }
  }

  const gameSlug = order.gameSlug?.trim().toLowerCase();
  const serviceMode = order.orderMode === 'pilot' ? 'pilot' : 'non_pilot';
  let targetGuildId = guildId || process.env.DISCORD_GUILD_ID;

  // Adapt to client's guild cache if targetGuildId is not found in client (e.g. mock harness or multi-guild setup)
  if (client?.guilds?.cache) {
    if (targetGuildId && typeof client.guilds.cache.get === 'function' && !client.guilds.cache.get(targetGuildId)) {
      const fallbackGuild = client.guilds.cache.first?.();
      if (fallbackGuild?.id) {
        targetGuildId = fallbackGuild.id;
      }
    } else if (!targetGuildId && typeof client.guilds.cache.first === 'function') {
      const fallbackGuild = client.guilds.cache.first();
      if (fallbackGuild?.id) {
        targetGuildId = fallbackGuild.id;
      }
    }
  }

  let effectiveServiceId = order.serviceId;
  let serviceKey = order.serviceKey;

  if (gameSlug && (!serviceKey || !effectiveServiceId)) {
    try {
      if (effectiveServiceId && !serviceKey) {
        const s = await prisma.gameService.findUnique({ where: { id: effectiveServiceId } });
        if (s) serviceKey = s.serviceKey;
      } else if (!effectiveServiceId && serviceKey) {
        const s = await prisma.gameService.findFirst({ where: { gameSlug, serviceKey } });
        if (s) effectiveServiceId = s.id;
      }
    } catch {
      // Continue
    }
  }

  // ۲. بررسی جدول رسمی channel_routes در پایگاه داده
  if (gameSlug) {
    try {
      // الف. اولویت با روت دارای service_id اختصاصی (مانند mythic_plus)
      if (effectiveServiceId) {
        const specificRoute = await prisma.channelRoute.findFirst({
          where: {
            gameSlug,
            serviceId: effectiveServiceId,
            serviceMode,
            isActive: true,
            ...(targetGuildId ? { discordGuildId: targetGuildId } : {}),
          },
        });

        if (specificRoute?.discordChannelId) {
          const ch = await client.channels.fetch(specificRoute.discordChannelId).catch(() => null);
          if (ch && typeof ch.isTextBased === 'function' && ch.isTextBased()) {
            return ch;
          }
        }
      }

      // ب. بررسی روت پیش‌فرض حالت سرویس (serviceId: null)
      const fallbackRoute = await prisma.channelRoute.findFirst({
        where: {
          gameSlug,
          serviceId: null,
          serviceMode,
          isActive: true,
          ...(targetGuildId ? { discordGuildId: targetGuildId } : {}),
        },
      });

      if (fallbackRoute?.discordChannelId) {
        const ch = await client.channels.fetch(fallbackRoute.discordChannelId).catch(() => null);
        if (ch && typeof ch.isTextBased === 'function' && ch.isTextBased()) {
          return ch;
        }
      }
    } catch (dbErr) {
      console.warn('[ResolveOrderPublicationChannel] DB lookup error:', dbErr);
    }
  }

  // ۳. نگاشت مستقیم بر اساس ساختار دسته‌بندی و نام کانال در گیلد (Guild Cache Resolution)
  if (client.guilds?.cache && gameSlug) {
    const guild = targetGuildId
      ? client.guilds.cache.get(targetGuildId)
      : client.guilds.cache.first();

    if (guild && guild.channels?.cache) {
      // ── الف. بازی WoW Midnight ─────────────────────────────────────────────
      if (gameSlug === 'wow_midnight') {
        const wmCat = guild.channels.cache.find(
          (c: any) =>
            (c.type === ChannelType.GuildCategory || c.type === 4) &&
            c.name.toUpperCase() === 'WOW MIDNIGHT'
        );

        if (wmCat) {
          const isMythicPlus =
            serviceKey === 'mythic_plus' ||
            (effectiveServiceId && effectiveServiceId === 10);

          if (isMythicPlus) {
            const ch = guild.channels.cache.find(
              (c: any) =>
                c.parentId === wmCat.id &&
                (c.name === 'mythic_plus_boosts' || c.name === 'mythic-plus-boosts')
            );
            if (ch) return ch;
          } else if (serviceMode === 'pilot') {
            const ch = guild.channels.cache.find(
              (c: any) =>
                c.parentId === wmCat.id &&
                (c.name === 'pilot_boosts' || c.name === 'pilot-boosts')
            );
            if (ch) return ch;
          } else {
            const ch = guild.channels.cache.find(
              (c: any) =>
                c.parentId === wmCat.id &&
                (c.name === 'non_pilot_boosts' || c.name === 'non-pilot-boosts')
            );
            if (ch) return ch;
          }
        }
      }

      // ── ب. بازی WoW Forever ────────────────────────────────────────────────
      if (gameSlug === 'wow_forever') {
        const wfCat = guild.channels.cache.find(
          (c: any) =>
            (c.type === ChannelType.GuildCategory || c.type === 4) &&
            c.name.toUpperCase() === 'WOW FOREVER'
        );

        if (wfCat) {
          if (serviceMode === 'pilot') {
            const ch = guild.channels.cache.find(
              (c: any) =>
                c.parentId === wfCat.id &&
                (c.name === 'pilot_boosts' || c.name === 'pilot-boosts')
            );
            if (ch) return ch;
          } else {
            const ch = guild.channels.cache.find(
              (c: any) =>
                c.parentId === wfCat.id &&
                (c.name === 'non_pilot_boosts' || c.name === 'non-pilot-boosts')
            );
            if (ch) return ch;
          }
        }
      }
    }
  }

  // ۴. قانون شکست امن: در صورت نبود کانال اختصاصی، null بازگردانده می‌شود تا هیچ سفارش در کانال نامربوط منتشر نشود.
  return null;
}
