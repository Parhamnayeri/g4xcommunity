/**
 * orderChannelSetup.ts — راه‌اندازی و نگهداری دو دسته‌بندی و شش کانال اختصاصی ایجاد سفارش در دیسکورد
 *
 * ساختار معماری کانال‌ها:
 *  دسته‌بندی G4X ORDERS:
 *    - #wow_midnight_mythic (یا #wow-midnight-mythic)
 *    - #non_pilot (یا #non-pilot)
 *    - #pilot
 *
 *  دسته‌بندی ADVERTISER ORDERS:
 *    - #wow_midnight_mythic (یا #wow-midnight-mythic)
 *    - #non_pilot (یا #non-pilot)
 *    - #pilot
 *
 * ویژگی‌ها:
 *  - بررسی سطح دسترسی مدیریت (Permission.SERVICE_CONFIG_MANAGE)
 *  - ایجاد یا تطبیق امن دسته‌بندی‌ها و کانال‌ها بر اساس نام یا متغیرهای محیطی
 *  - اجرای کاملاً پایدار و تکرارپذیر (Idempotent) بدون ایجاد کانال یا پیام تکراری
 *  - ارسال یا ویرایش خودکار Embed و دکمه‌های متصل به Modal در هر ۶ کانال
 *  - کارکرد بدون وقفه و پایدار تعاملات پس از راه‌اندازی مجدد بات (Restart Recovery)
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
import {
  buildMythicPanelEmbed,
  buildNonPilotPanelEmbed,
  buildPilotPanelEmbed,
  buildOrderPanelButtons,
  OrderPanelCategory,
  OrderPanelType,
} from '../interactions/orderPanelInteractions';

export interface SetupOrderPanelsOptions {
  guild: any; // Discord.js Guild
  actorId: string;
}

export interface SetupOrderPanelsResult {
  success: boolean;
  categories: {
    g4xOrdersId?: string;
    advertiserOrdersId?: string;
  };
  g4xChannels: Record<string, { channelId: string; panelDeployed: boolean; messageId?: string }>;
  advertiserChannels: Record<string, { channelId: string; panelDeployed: boolean; messageId?: string }>;
  warnings: string[];
}

export interface OrderChannelDefinition {
  type: OrderPanelType;
  channelName: string;
  aliasName: string;
  embedBuilder: (cat: OrderPanelCategory) => any;
  titleSnippet: string;
}

export const ORDER_PANEL_DEFINITIONS: OrderChannelDefinition[] = [
  {
    type: 'mythic',
    channelName: 'wow_midnight_mythic',
    aliasName: 'wow-midnight-mythic',
    embedBuilder: buildMythicPanelEmbed,
    titleSnippet: 'WoW Midnight Mythic+',
  },
  {
    type: 'non_pilot',
    channelName: 'non_pilot',
    aliasName: 'non-pilot',
    embedBuilder: buildNonPilotPanelEmbed,
    titleSnippet: 'Non-Pilot Boost',
  },
  {
    type: 'pilot',
    channelName: 'pilot',
    aliasName: 'pilot',
    embedBuilder: buildPilotPanelEmbed,
    titleSnippet: 'Pilot Boost',
  },
];

/**
 * ایجاد یا بازیابی دو دسته‌بندی و شش کانال اختصاصی ایجاد سفارش
 */
export async function setupOrderPanels(
  options: SetupOrderPanelsOptions
): Promise<SetupOrderPanelsResult> {
  const { guild, actorId } = options;
  const warnings: string[] = [];

  // ۱. بررسی سطح دسترسی مدیریت
  const auth = await authorize(actorId, Permission.SERVICE_CONFIG_MANAGE);
  if (!auth.allowed) {
    throw new Error(
      `PERMISSION_DENIED: ${auth.reason || 'Only authorized management may set up order creation panels'}`
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

  const result: SetupOrderPanelsResult = {
    success: true,
    categories: {},
    g4xChannels: {},
    advertiserChannels: {},
    warnings,
  };

  // ── ۲. ایجاد یا شناسایی دسته‌بندی G4X ORDERS ────────────────────────────────
  let g4xCategory: CategoryChannel | null = null;
  if (guild.channels?.cache) {
    g4xCategory =
      (guild.channels.cache.find(
        (c: any) =>
          (c.type === ChannelType.GuildCategory || c.type === 4) &&
          (c.name.toUpperCase() === 'G4X ORDERS' || c.name.toUpperCase() === 'G4X-ORDERS')
      ) as CategoryChannel) || null;
  }

  if (
    !g4xCategory &&
    guild.channels?.create &&
    (!me || me.permissions.has(PermissionFlagsBits.ManageChannels))
  ) {
    try {
      g4xCategory = await guild.channels.create({
        name: 'G4X ORDERS',
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
      warnings.push(`Could not create category 'G4X ORDERS': ${err.message}`);
    }
  }

  if (g4xCategory) {
    result.categories.g4xOrdersId = g4xCategory.id;
  }

  // ── ۳. ایجاد یا شناسایی دسته‌بندی ADVERTISER ORDERS ──────────────────────────
  let advCategory: CategoryChannel | null = null;
  if (guild.channels?.cache) {
    advCategory =
      (guild.channels.cache.find(
        (c: any) =>
          (c.type === ChannelType.GuildCategory || c.type === 4) &&
          (c.name.toUpperCase() === 'ADVERTISER ORDERS' || c.name.toUpperCase() === 'ADVERTISER-ORDERS')
      ) as CategoryChannel) || null;
  }

  if (
    !advCategory &&
    guild.channels?.create &&
    (!me || me.permissions.has(PermissionFlagsBits.ManageChannels))
  ) {
    try {
      advCategory = await guild.channels.create({
        name: 'ADVERTISER ORDERS',
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
      warnings.push(`Could not create category 'ADVERTISER ORDERS': ${err.message}`);
    }
  }

  if (advCategory) {
    result.categories.advertiserOrdersId = advCategory.id;
  }

  // ── ۴. پردازش کانال‌های هر دو دسته‌بندی (Deploy/Update Panels) ───────────────

  async function deployPanelToCategory(
    category: CategoryChannel | null,
    categoryKey: OrderPanelCategory,
    channelMap: Record<string, { channelId: string; panelDeployed: boolean; messageId?: string }>
  ) {
    for (const def of ORDER_PANEL_DEFINITIONS) {
      let targetChannel: TextChannel | null = null;

      // الف. جستجو در کش کانال‌های گیلد متصل به این دسته‌بندی
      if (guild.channels?.cache) {
        targetChannel =
          (guild.channels.cache.find(
            (c: any) =>
              (category ? c.parentId === category.id : true) &&
              (c.name === def.channelName || c.name === def.aliasName)
          ) as TextChannel) || null;
      }

      // ب. ایجاد کانال در صورت نبود
      if (
        !targetChannel &&
        guild.channels?.create &&
        (!me || me.permissions.has(PermissionFlagsBits.ManageChannels))
      ) {
        try {
          targetChannel = await guild.channels.create({
            name: def.channelName,
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
          warnings.push(`Could not create channel #${def.channelName} in ${categoryKey}: ${err.message}`);
        }
      }

      if (targetChannel) {
        let panelDeployed = false;
        let panelMessageId: string | undefined;

        const embed = def.embedBuilder(categoryKey);
        const buttons = buildOrderPanelButtons(categoryKey, def.type);

        // ج. بررسی و به‌روزرسانی پنل موجود بدون ایجاد پیام تکراری
        if (typeof targetChannel.messages?.fetch === 'function') {
          try {
            const fetched = await targetChannel.messages.fetch({ limit: 15 });
            const messages = Array.isArray(fetched) ? fetched : Array.from(fetched?.values ? fetched.values() : []);
            const existingPanel = messages.find(
              (m: any) =>
                m.embeds?.length > 0 &&
                m.embeds[0]?.title &&
                m.embeds[0].title.includes(def.titleSnippet)
            );

            if (existingPanel && typeof existingPanel.edit === 'function') {
              await existingPanel.edit({ embeds: [embed], components: [buttons] });
              panelDeployed = true;
              panelMessageId = existingPanel.id;
            } else if (typeof targetChannel.send === 'function') {
              const sentMsg = await targetChannel.send({ embeds: [embed], components: [buttons] });
              panelDeployed = true;
              panelMessageId = sentMsg.id;
            }
          } catch (err: any) {
            warnings.push(
              `Failed to deploy/refresh panel in #${def.channelName} (${categoryKey}): ${err.message}`
            );
          }
        }

        channelMap[def.type] = {
          channelId: targetChannel.id,
          panelDeployed,
          messageId: panelMessageId,
        };
      }
    }
  }

  // اجرای دیپلوی برای G4X Orders
  await deployPanelToCategory(g4xCategory, 'g4x', result.g4xChannels);

  // اجرای دیپلوی برای Advertiser Orders
  await deployPanelToCategory(advCategory, 'adv', result.advertiserChannels);

  // ثبت لاگ ممیزی
  try {
    await prisma.auditLog.create({
      data: {
        actorId,
        action: 'ORDER_PANELS_SETUP',
        entityType: 'DiscordGuild',
        entityId: guild.id,
        newValues: JSON.stringify({
          g4xCategoryId: result.categories.g4xOrdersId,
          advertiserCategoryId: result.categories.advertiserOrdersId,
          g4xChannels: result.g4xChannels,
          advertiserChannels: result.advertiserChannels,
        }),
        reason: 'Authorized deployment of 2 categories and 6 order creation panels',
        isSuccess: true,
      },
    });
  } catch (err: any) {
    console.warn('[SetupOrderPanels] AuditLog warning:', err?.message || err);
  }

  return result;
}
