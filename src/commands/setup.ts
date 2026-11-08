/**
 * setup.ts — دستورات راه‌اندازی و کانفیگ پنل‌های دیسکورد (Setup Commands - Phase 3.2.4)
 * 
 * دستور:
 *  G4!setup registration — راه‌اندازی ساختار تفکیک‌شده دو دسته‌بندی و هشت کانال اختصاصی ثبت‌نام
 */

import { Message, TextChannel } from 'discord.js';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';
import { setupRegistrationChannels } from '../services/registrationChannelSetup';
import { setupOrderPanels } from '../services/orderChannelSetup';
import { setupPublicationChannels } from '../services/orderPublicationChannelService';

import {
  buildRegistrationPanelEmbed,
  buildRegistrationPanelButtons,
} from '../interactions/registrationInteractions';

export async function handleSetupCommand(message: Message, args: string[]): Promise<void> {
  const subCommand = args[0]?.toLowerCase();

  if (subCommand === 'registration') {
    // ۱. اعتبارسنجی سطح دسترسی متمرکز: منحصراً مدیران مجاز (Manager / Owner)
    const authResult = await authorize(message.author.id, Permission.SERVICE_CONFIG_MANAGE);
    if (!authResult.allowed) {
      await message.reply({
        content: '❌ **Permission Denied**: Only authorized management may set up or update registration channels.',
      });
      return;
    }

    if (!message.guild) {
      const channel = message.channel as TextChannel;
      if (channel && typeof channel.isTextBased === 'function' && channel.isTextBased()) {
        const fetchedMessages: any = await channel.messages?.fetch?.({ limit: 25 }).catch(() => []);
        const existingPanel = fetchedMessages && typeof fetchedMessages.find === 'function'
          ? fetchedMessages.find(
              (m: any) =>
                m.author?.id === message.client?.user?.id &&
                m.embeds?.length > 0 &&
                m.embeds[0]?.title?.includes('Registration')
            )
          : null;
        const embed = buildRegistrationPanelEmbed();
        const buttons = buildRegistrationPanelButtons();
        if (existingPanel) {
          await existingPanel.edit({ embeds: [embed], components: [buttons] });
          await message.reply({ content: '✅ **Registration Panel Updated**: Existing persistent panel was refreshed in this channel.' });
        } else {
          await channel.send({ embeds: [embed], components: [buttons] });
          await message.reply({ content: '✅ **Registration Panel Deployed**: Persistent panel with 4 registration workflows has been created.' });
        }
        return;
      }
      await message.reply({ content: '❌ This command must be executed within a Discord server (guild).' });
      return;
    }

    try {
      // ۲. راه‌اندازی ساختار تفکیک‌شده کانال‌ها
      const result = await setupRegistrationChannels({
        guild: message.guild,
        actorId: message.author.id,
      });

      let responseText = '✅ **Registration Channel Architecture Setup Completed Successfully!**\n\n';

      responseText += '📁 **Category: `START HERE` (Public Registration Panels):**\n';
      const publicMap: Record<string, string> = {
        booster: 'become-booster',
        advertiser: 'become-adv',
        pilot: 'become-pilot-booster',
        exchanger: 'become-exchanger',
      };
      for (const [key, label] of Object.entries(publicMap)) {
        const info = result.publicChannels[key];
        if (info) {
          responseText += `• **#${label}**: <#${info.channelId}> ${info.panelDeployed ? '*(Panel Active)*' : ''}\n`;
        }
      }

      responseText += '\n🔒 **Category: `APPLICATION MANAGEMENT` (Private Review Channels):**\n';
      const mgmtMap: Record<string, string> = {
        booster: 'app-boosters',
        advertiser: 'app-adv',
        pilot: 'app-pilots',
        exchanger: 'app-exchangers',
      };
      for (const [key, label] of Object.entries(mgmtMap)) {
        const info = result.managementChannels[key];
        if (info) {
          responseText += `• **#${label}**: <#${info.channelId}>\n`;
        }
      }

      if (result.warnings.length > 0) {
        responseText += '\n⚠️ **Notes & Warnings:**\n' + result.warnings.map((w) => `• ${w}`).join('\n');
      }

      await message.reply({ content: responseText });
    } catch (err: any) {
      console.error('[SetupCommand] Failed to deploy registration architecture:', err);
      await message.reply({
        content: `❌ Failed to set up registration channels: ${err?.message || err}`,
      });
    }
  } else if (subCommand === 'orders' || subCommand === 'order-panels' || subCommand === 'order_panels') {
    // ۱. اعتبارسنجی سطح دسترسی متمرکز: منحصراً مدیران مجاز (Manager / Owner)
    const authResult = await authorize(message.author.id, Permission.SERVICE_CONFIG_MANAGE);
    if (!authResult.allowed) {
      await message.reply({
        content: '❌ **Permission Denied**: Only authorized management may set up or update order creation panels.',
      });
      return;
    }

    if (!message.guild) {
      await message.reply({ content: '❌ This command must be executed within a Discord server (guild).' });
      return;
    }

    try {
      // ۲. راه‌اندازی دو دسته‌بندی و شش کانال اختصاصی پنل‌های سفارش
      const result = await setupOrderPanels({
        guild: message.guild,
        actorId: message.author.id,
      });

      let responseText = '✅ **Order Creation Panel Architecture Setup Completed Successfully!**\n\n';

      responseText += '📁 **Category: `G4X ORDERS` (Direct Community Carry Panels):**\n';
      const panelNames: Record<string, string> = {
        mythic: 'wow_midnight_mythic',
        non_pilot: 'non_pilot',
        pilot: 'pilot',
      };
      for (const [key, label] of Object.entries(panelNames)) {
        const info = result.g4xChannels[key];
        if (info) {
          responseText += `• **#${label}**: <#${info.channelId}> ${info.panelDeployed ? '*(Panel Active)*' : ''}\n`;
        }
      }

      responseText += '\n📁 **Category: `ADVERTISER ORDERS` (Commercial Advertiser Panels):**\n';
      for (const [key, label] of Object.entries(panelNames)) {
        const info = result.advertiserChannels[key];
        if (info) {
          responseText += `• **#${label}**: <#${info.channelId}> ${info.panelDeployed ? '*(Panel Active)*' : ''}\n`;
        }
      }

      if (result.warnings.length > 0) {
        responseText += '\n⚠️ **Notes & Warnings:**\n' + result.warnings.map((w) => `• ${w}`).join('\n');
      }

      await message.reply({ content: responseText });
    } catch (err: any) {
      console.error('[SetupCommand] Failed to deploy order panel architecture:', err);
      await message.reply({
        content: `❌ Failed to set up order creation panels: ${err?.message || err}`,
      });
    }
  } else if (
    subCommand === 'publications' ||
    subCommand === 'pub-channels' ||
    subCommand === 'routing' ||
    subCommand === 'publication-channels'
  ) {
    // ۱. اعتبارسنجی سطح دسترسی متمرکز: منحصراً مدیران مجاز (Manager / Owner)
    const authResult = await authorize(message.author.id, Permission.SERVICE_CONFIG_MANAGE);
    if (!authResult.allowed) {
      await message.reply({
        content: '❌ **Permission Denied**: Only authorized management may set up or update order publication channels.',
      });
      return;
    }

    if (!message.guild) {
      await message.reply({ content: '❌ This command must be executed within a Discord server (guild).' });
      return;
    }

    try {
      // ۲. راه‌اندازی دو دسته‌بندی و پنج کانال اختصاصی انتشار سفارشات
      const result = await setupPublicationChannels({
        guild: message.guild,
        actorId: message.author.id,
      });

      let responseText = '✅ **Order Publication Channel Architecture Setup Completed Successfully!**\n\n';

      responseText += '📁 **Category: `WoW Midnight` (Dedicated Boost Channels):**\n';
      if (result.channels.wowMidnightMythicId) {
        responseText += `• **#mythic_plus_boosts**: <#${result.channels.wowMidnightMythicId}>\n`;
      }
      if (result.channels.wowMidnightNonPilotId) {
        responseText += `• **#non_pilot_boosts**: <#${result.channels.wowMidnightNonPilotId}>\n`;
      }
      if (result.channels.wowMidnightPilotId) {
        responseText += `• **#pilot_boosts**: <#${result.channels.wowMidnightPilotId}>\n`;
      }

      responseText += '\n📁 **Category: `WoW Forever` (Dedicated Boost Channels):**\n';
      if (result.channels.wowForeverNonPilotId) {
        responseText += `• **#non_pilot_boosts**: <#${result.channels.wowForeverNonPilotId}>\n`;
      }
      if (result.channels.wowForeverPilotId) {
        responseText += `• **#pilot_boosts**: <#${result.channels.wowForeverPilotId}>\n`;
      }

      responseText += `\n🔗 **Database Routes Configured:** \`${result.routesCreated}\` active channel routes recorded.`;

      if (result.warnings.length > 0) {
        responseText += '\n⚠️ **Notes & Warnings:**\n' + result.warnings.map((w) => `• ${w}`).join('\n');
      }

      await message.reply({ content: responseText });
    } catch (err: any) {
      console.error('[SetupCommand] Failed to deploy order publication channels:', err);
      await message.reply({
        content: `❌ Failed to set up order publication channels: ${err?.message || err}`,
      });
    }
  } else if (subCommand === 'all' || subCommand === 'channels' || subCommand === 'sync') {
    // ۱. اعتبارسنجی سطح دسترسی متمرکز
    const authResult = await authorize(message.author.id, Permission.SERVICE_CONFIG_MANAGE);
    if (!authResult.allowed) {
      await message.reply({
        content: '❌ **Permission Denied**: Only authorized management may provision or synchronize Discord channels.',
      });
      return;
    }

    if (!message.guild) {
      await message.reply({ content: '❌ This command must be executed within a Discord server (guild).' });
      return;
    }

    try {
      const { provisionAllChannels } = await import('../services/discordProvisioningService');
      const result = await provisionAllChannels({
        guild: message.guild,
        actorId: message.author.id,
        client: message.client,
      });

      let responseText = '✅ **Automatic Discord Channel Provisioning Completed!**\n\n';
      responseText += `📊 **Summary:**\n`;
      responseText += `• Total Channels Configured: **${result.totalConfigured}**\n`;
      responseText += `• Successfully Synced: **${result.synced}**\n`;
      responseText += `• Newly Created: **${result.created}**\n`;
      responseText += `• Reused Existing: **${result.reused}**\n\n`;

      // Group mappings by category
      const categories = [...new Set(result.mappings.map((m) => m.categoryName))];
      for (const cat of categories) {
        const catMappings = result.mappings.filter((m) => m.categoryName === cat && m.channelType !== 'GUILD_CATEGORY');
        responseText += `📁 **${cat}:**\n`;
        for (const m of catMappings) {
          const statusIcon = m.syncStatus === 'SYNCED' || m.syncStatus === 'MANUAL' ? '🟢' : '🔴';
          const link = m.discordChannelId ? `<#${m.discordChannelId}>` : '*(missing)*';
          responseText += `  ${statusIcon} #${m.channelName} — ${link}\n`;
        }
        responseText += '\n';
      }

      if (result.warnings.length > 0) {
        responseText += '⚠️ **Notes & Warnings:**\n' + result.warnings.map((w) => `• ${w}`).join('\n');
      }

      await message.reply({ content: responseText });
    } catch (err: any) {
      console.error('[SetupCommand] Failed to provision all channels:', err);
      await message.reply({
        content: `❌ Failed to auto-provision Discord channels: ${err?.message || err}`,
      });
    }
  } else {
    await message.reply({
      content:
        '❌ Unknown setup target. Usage:\n' +
        '• `G4!setup all` — Automatically create, reuse & sync ALL categories and channels\n' +
        '• `G4!setup registration` — Deploy or refresh 8 registration & review channels\n' +
        '• `G4!setup orders` — Deploy or refresh 2 categories & 6 order creation panels\n' +
        '• `G4!setup publications` — Deploy or refresh dedicated game & service order publication channels',
    });
  }
}

