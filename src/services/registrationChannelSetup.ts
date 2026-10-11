/**
 * registrationChannelSetup.ts — راه‌اندازی و پیکربندی ساختار تفکیک‌شده کانال‌های ثبت‌نام (Phase 3.2.4)
 * 
 * ساختار کانال‌ها:
 *  دسته‌بندی START HERE (عمومی):
 *    - #become-booster
 *    - #become-adv
 *    - #become-pilot-booster
 *    - #become-exchanger
 * 
 *  دسته‌بندی APPLICATION MANAGEMENT (خصوصی و منحصراً ادمین/استاف):
 *    - #app-boosters
 *    - #app-adv
 *    - #app-pilots
 *    - #app-exchangers
 * 
 * ویژگی‌ها:
 *  - بررسی سطح دسترسی مدیریت (Permission.SERVICE_CONFIG_MANAGE)
 *  - ایجاد یا تطبیق کانال‌ها بر اساس شناسه‌های صریح در محیط (Environment Variables) یا نام استاندارد
 *  - ایجاد ایمن دسته‌بندی‌ها و کانال‌ها در صورت نبود با Permission Overwriteهای واقعی
 *  - عدم حذف یا دستکاری کانال‌های ساخته‌شده توسط کاربر و عدم بازنویسی خاموش دسترسی‌های اختصاصی
 *  - ارسال یا به‌روزرسانی پنل‌های ثبت‌نام اختصاصی در هر کانال بدون ایجاد پنل‌های تکراری (Idempotent)
 *  - بازنشستگی و ارجاع محترمانه پنل تجمیعی قدیم
 */

import {
  ChannelType,
  PermissionFlagsBits,
  Guild,
  TextChannel,
  CategoryChannel,
} from 'discord.js';
import prisma from '../database/db';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';
import {
  buildBoosterPanelEmbed,
  buildBoosterPanelButtons,
  buildAdvertiserPanelEmbed,
  buildAdvertiserPanelButtons,
  buildPilotPanelEmbed,
  buildPilotPanelButtons,
  buildExchangerPanelEmbed,
  buildExchangerPanelButtons,
} from '../interactions/registrationInteractions';

export interface SetupChannelsOptions {
  guild: any; // Discord.js Guild
  actorId: string;
}

export interface SetupChannelsResult {
  success: boolean;
  categories: {
    startHereId?: string;
    managementId?: string;
  };
  publicChannels: Record<string, { channelId: string; panelDeployed: boolean; messageId?: string }>;
  managementChannels: Record<string, { channelId: string }>;
  warnings: string[];
}

/**
 * پیکربندی و راه‌اندازی کامل دو دسته‌بندی و هشت کانال اختصاصی ثبت‌نام و بازبینی
 */
export async function setupRegistrationChannels(
  options: SetupChannelsOptions
): Promise<SetupChannelsResult> {
  const { guild, actorId } = options;
  const warnings: string[] = [];

  // ۱. بررسی دسترسی مدیر
  const auth = await authorize(actorId, Permission.SERVICE_CONFIG_MANAGE);
  if (!auth.allowed) {
    throw new Error(`PERMISSION_DENIED: ${auth.reason || 'Only authorized management may set up registration channels'}`);
  }

  if (!guild) {
    throw new Error('GUILD_REQUIRED: Setup command must be executed within a Discord guild');
  }

  // ۲. بررسی اختیارات بات در گیلد (در صورت وجود شیء عضو بات)
  const me = guild.members?.me;
  if (me && me.permissions && !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    warnings.push('Bot lacks ManageChannels permission. Existing channels will be resolved without creating new ones.');
  }

  const result: SetupChannelsResult = {
    success: true,
    categories: {},
    publicChannels: {},
    managementChannels: {},
    warnings,
  };

  // ۳. ایجاد یا شناسایی دسته‌بندی عمومی (START HERE)
  let startHereCategory: CategoryChannel | null = null;
  if (guild.channels?.cache) {
    startHereCategory = guild.channels.cache.find(
      (c: any) =>
        (c.type === ChannelType.GuildCategory || c.type === 4) &&
        c.name.toUpperCase() === 'START HERE'
    ) as CategoryChannel || null;
  }

  if (!startHereCategory && guild.channels?.create && (!me || me.permissions.has(PermissionFlagsBits.ManageChannels))) {
    try {
      startHereCategory = await guild.channels.create({
        name: 'START HERE',
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
      warnings.push(`Could not create category 'START HERE': ${err.message}`);
    }
  }

  if (startHereCategory) {
    result.categories.startHereId = startHereCategory.id;
  }

  // ۴. ایجاد یا شناسایی دسته‌بندی خصوصی (APPLICATION MANAGEMENT)
  let managementCategory: CategoryChannel | null = null;
  if (guild.channels?.cache) {
    managementCategory = guild.channels.cache.find(
      (c: any) =>
        (c.type === ChannelType.GuildCategory || c.type === 4) &&
        c.name.toUpperCase() === 'APPLICATION MANAGEMENT'
    ) as CategoryChannel || null;
  }

  if (!managementCategory && guild.channels?.create && (!me || me.permissions.has(PermissionFlagsBits.ManageChannels))) {
    try {
      managementCategory = await guild.channels.create({
        name: 'APPLICATION MANAGEMENT',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.roles?.everyone?.id || guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          ...(me ? [{
            id: me.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          }] : []),
        ],
      });
    } catch (err: any) {
      warnings.push(`Could not create category 'APPLICATION MANAGEMENT': ${err.message}`);
    }
  }

  if (managementCategory) {
    result.categories.managementId = managementCategory.id;
  }

  // ۵. پیکربندی ۴ کانال عمومی و انتشار پنل‌های اختصاصی
  const publicChannelConfigs = [
    {
      key: 'booster',
      name: 'become-booster',
      envId: process.env.CHANNEL_BECOME_BOOSTER,
      embedBuilder: buildBoosterPanelEmbed,
      buttonsBuilder: buildBoosterPanelButtons,
      expectedTitle: '🗡️ Become a Booster — G4X Community',
    },
    {
      key: 'advertiser',
      name: 'become-adv',
      alias: 'become-advertiser',
      envId: process.env.CHANNEL_BECOME_ADVERTISER || process.env.CHANNEL_BECOME_ADV,
      embedBuilder: buildAdvertiserPanelEmbed,
      buttonsBuilder: buildAdvertiserPanelButtons,
      expectedTitle: '📢 Become an Advertiser — G4X Community',
    },
    {
      key: 'pilot',
      name: 'become-pilot-booster',
      alias: 'become-pilot',
      envId: process.env.CHANNEL_BECOME_PILOT || process.env.CHANNEL_BECOME_PILOT_BOOSTER,
      embedBuilder: buildPilotPanelEmbed,
      buttonsBuilder: buildPilotPanelButtons,
      expectedTitle: '✈️ Apply for Pilot Booster — G4X Community',
    },
    {
      key: 'exchanger',
      name: 'become-exchanger',
      envId: process.env.CHANNEL_BECOME_EXCHANGER,
      embedBuilder: buildExchangerPanelEmbed,
      buttonsBuilder: buildExchangerPanelButtons,
      expectedTitle: '💱 Become an Exchanger — G4X Community',
    },
  ];

  for (const cfg of publicChannelConfigs) {
    let targetChannel: TextChannel | null = null;

    // الف. جستجو بر اساس شناسه متغیر محیطی
    if (cfg.envId && guild.channels?.cache) {
      targetChannel = guild.channels.cache.get(cfg.envId) as TextChannel || null;
    }

    // ب. جستجو بر اساس نام در گیلد
    if (!targetChannel && guild.channels?.cache) {
      targetChannel = guild.channels.cache.find(
        (c: any) => c.name === cfg.name || (cfg.alias && c.name === cfg.alias)
      ) as TextChannel || null;
    }

    // ج. ایجاد کانال در صورت عدم وجود
    if (!targetChannel && guild.channels?.create && (!me || me.permissions.has(PermissionFlagsBits.ManageChannels))) {
      try {
        targetChannel = await guild.channels.create({
          name: cfg.name,
          type: ChannelType.GuildText,
          parent: startHereCategory ? startHereCategory.id : undefined,
          permissionOverwrites: [
            {
              id: guild.roles?.everyone?.id || guild.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
              deny: [PermissionFlagsBits.SendMessages],
            },
          ],
        });
      } catch (err: any) {
        warnings.push(`Could not create channel #${cfg.name}: ${err.message}`);
      }
    }

    if (targetChannel) {
      let panelDeployed = false;
      let panelMessageId: string | undefined;

      // انتشار یا به‌روزرسانی پنل اختصاصی
      if (typeof targetChannel.messages?.fetch === 'function') {
        try {
          const messages = await targetChannel.messages.fetch({ limit: 15 });
          const existingPanel = messages.find(
            (m: any) =>
              m.embeds?.length > 0 &&
              (m.embeds[0].title === cfg.expectedTitle || m.author?.id === guild.client?.user?.id)
          );

          const embed = cfg.embedBuilder();
          const buttons = cfg.buttonsBuilder();

          if (existingPanel) {
            await existingPanel.edit({
              embeds: [embed],
              components: [buttons],
            });
            panelDeployed = true;
            panelMessageId = existingPanel.id;
          } else if (typeof targetChannel.send === 'function') {
            const sent = await targetChannel.send({
              embeds: [embed],
              components: [buttons],
            });
            panelDeployed = true;
            panelMessageId = sent.id;
          }
        } catch (msgErr: any) {
          warnings.push(`Could not deploy panel to #${cfg.name}: ${msgErr.message}`);
        }
      }

      result.publicChannels[cfg.key] = {
        channelId: targetChannel.id,
        panelDeployed,
        messageId: panelMessageId,
      };
    }
  }

  // ۶. پیکربندی ۴ کانال خصوصی بازبینی
  const managementChannelConfigs = [
    {
      key: 'booster',
      name: 'app-boosters',
      envId: process.env.CHANNEL_APP_BOOSTERS,
    },
    {
      key: 'advertiser',
      name: 'app-adv',
      alias: 'app-advertisers',
      envId: process.env.CHANNEL_APP_ADVERTISERS || process.env.CHANNEL_APP_ADV,
    },
    {
      key: 'pilot',
      name: 'app-pilots',
      envId: process.env.CHANNEL_APP_PILOTS,
    },
    {
      key: 'exchanger',
      name: 'app-exchangers',
      envId: process.env.CHANNEL_APP_EXCHANGERS,
    },
  ];

  for (const cfg of managementChannelConfigs) {
    let targetChannel: TextChannel | null = null;

    if (cfg.envId && guild.channels?.cache) {
      targetChannel = guild.channels.cache.get(cfg.envId) as TextChannel || null;
    }

    if (!targetChannel && guild.channels?.cache) {
      targetChannel = guild.channels.cache.find(
        (c: any) => c.name === cfg.name || (cfg.alias && c.name === cfg.alias)
      ) as TextChannel || null;
    }

    if (!targetChannel && guild.channels?.create && (!me || me.permissions.has(PermissionFlagsBits.ManageChannels))) {
      try {
        targetChannel = await guild.channels.create({
          name: cfg.name,
          type: ChannelType.GuildText,
          parent: managementCategory ? managementCategory.id : undefined,
          permissionOverwrites: [
            {
              id: guild.roles?.everyone?.id || guild.id,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            ...(me ? [{
              id: me.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            }] : []),
          ],
        });
      } catch (err: any) {
        warnings.push(`Could not create private channel #${cfg.name}: ${err.message}`);
      }
    }

    if (targetChannel) {
      result.managementChannels[cfg.key] = {
        channelId: targetChannel.id,
      };
    }
  }

  // ۷. ثبت ممیزی راه‌اندازی
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'REGISTRATION_CHANNELS_SETUP',
      entityType: 'DiscordGuild',
      entityId: guild.id,
      newValues: JSON.stringify({
        publicChannels: result.publicChannels,
        managementChannels: result.managementChannels,
        warnings,
      }),
    },
  });

  return result;
}
