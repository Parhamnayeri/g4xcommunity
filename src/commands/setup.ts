/**
 * setup.ts — دستورات راه‌اندازی و کانفیگ پنل‌های دیسکورد (Setup Commands)
 * 
 * دستور:
 *  G4!setup registration — انتشار یا به‌روزرسانی پنل عمومی ثبت‌نام در کانال جاری
 */

import { Message, TextChannel } from 'discord.js';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';
import {
  buildRegistrationPanelEmbed,
  buildRegistrationPanelButtons,
} from '../interactions/registrationInteractions';

export async function handleSetupCommand(message: Message, args: string[]): Promise<void> {
  const subCommand = args[0]?.toLowerCase();

  if (subCommand === 'registration') {
    // اعتبارسنجی سطح دسترسی متمرکز: منحصراً مدیران مجاز (Manager / Owner)
    const authResult = await authorize(message.author.id, Permission.SERVICE_CONFIG_MANAGE);
    if (!authResult.allowed) {
      await message.reply({
        content: '❌ **Permission Denied**: Only authorized management may set up or update the registration panel.',
      });
      return;
    }

    const channel = message.channel as TextChannel;
    if (!channel.isTextBased()) {
      await message.reply({ content: '❌ This command can only be used in a text channel.' });
      return;
    }

    try {
      // جلوگیری از ایجاد پنل‌های تکراری نامحدود (Repeated setup must not create uncontrolled duplicate panels)
      const fetchedMessages = await channel.messages.fetch({ limit: 25 });
      const existingPanel = fetchedMessages.find(
        (m) =>
          m.author.id === message.client.user?.id &&
          m.embeds.length > 0 &&
          m.embeds[0].title === '🛡️ G4X Community — Member Registration'
      );

      const embed = buildRegistrationPanelEmbed();
      const buttons = buildRegistrationPanelButtons();

      if (existingPanel) {
        await existingPanel.edit({
          embeds: [embed],
          components: [buttons],
        });
        await message.reply({
          content: '✅ **Registration Panel Updated**: Existing persistent panel was refreshed in this channel.',
        });
      } else {
        await channel.send({
          embeds: [embed],
          components: [buttons],
        });
        await message.reply({
          content: '✅ **Registration Panel Deployed**: Persistent panel with 4 registration workflows has been created.',
        });
      }
    } catch (err: any) {
      console.error('[SetupCommand] Failed to deploy registration panel:', err);
      await message.reply({
        content: `❌ Failed to deploy registration panel: ${err?.message || err}`,
      });
    }
  } else {
    await message.reply({
      content: '❌ Unknown setup target. Usage: `G4!setup registration`',
    });
  }
}
