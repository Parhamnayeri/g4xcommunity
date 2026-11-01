/**
 * buttons.ts — مدیریت تعاملات دکمه‌ای (Button Interactions)
 * 
 * customId های تعریف‌شده:
 *  presign_tank:<orderId>       — پیش‌ثبت‌نام با رول Tank
 *  presign_healer:<orderId>     — پیش‌ثبت‌نام با رول Healer
 *  presign_dps:<orderId>        — پیش‌ثبت‌نام با رول DPS
 *  presign_withdraw:<orderId>   — انصراف از پیش‌ثبت‌نام
 *  order_accept:<orderId>       — پذیرش تخصیص توسط بوستر
 *  order_decline:<orderId>      — رد تخصیص توسط بوستر
 */

import { ButtonInteraction } from 'discord.js';
import {
  handleRegistrationButton,
  handleAdminReviewButton,
  handleProvideInfoButton,
} from './registrationInteractions';
import { handleOrderPanelButton } from './orderPanelInteractions';
import {
  handlePresignButton,
  handlePresignWithdrawButton,
  handleOrderViewButton,
} from '../services/orderDiscordService';

export async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const [action, ...params] = interaction.customId.split(':');

  if (action === 'ord_wiz') {
    const subAction = params[0];
    if (subAction === 'start') {
      const origin = params[1] as 'g4x' | 'adv';
      const { startOrderWizard } = await import('./orderWizardInteractions');
      await startOrderWizard(interaction, origin);
      return;
    }
    const { handleOrderWizardButton } = await import('./orderWizardInteractions');
    await handleOrderWizardButton(interaction);
    return;
  }

  if (action === 'ord_create') {
    if (params.length === 1 || params[1] === 'wizard') {
      const origin = params[0] as 'g4x' | 'adv';
      const { startOrderWizard } = await import('./orderWizardInteractions');
      await startOrderWizard(interaction, origin);
      return;
    }
    await handleOrderPanelButton(interaction);
    return;
  }

  if (action === 'reg_start') {
    await handleRegistrationButton(interaction);
    return;
  }

  if (action === 'app_review') {
    await handleAdminReviewButton(interaction);
    return;
  }

  if (action === 'app_provide_info') {
    await handleProvideInfoButton(interaction);
    return;
  }

  switch (action) {
    case 'presign_tank':
    case 'presign_healer':
    case 'presign_dps': {
      const role = action.replace('presign_', '');
      const orderId = Number(params[0]);
      if (isNaN(orderId) || orderId <= 0) {
        await interaction.reply({ content: '❌ Invalid order ID parameter.', ephemeral: true });
        return;
      }
      await handlePresignButton(interaction, role, orderId);
      break;
    }
    case 'presign_withdraw': {
      const orderId = Number(params[0]);
      if (isNaN(orderId) || orderId <= 0) {
        await interaction.reply({ content: '❌ Invalid order ID parameter.', ephemeral: true });
        return;
      }
      await handlePresignWithdrawButton(interaction, orderId);
      break;
    }
    case 'order_view': {
      const orderId = Number(params[0]);
      if (isNaN(orderId) || orderId <= 0) {
        await interaction.reply({ content: '❌ Invalid order ID parameter.', ephemeral: true });
        return;
      }
      await handleOrderViewButton(interaction, orderId);
      break;
    }
    case 'team_accept': {
      const teamIdentifier = params.join(':');
      try {
        const { acceptInvitation } = await import('../services/teamService');
        await acceptInvitation(teamIdentifier, interaction.user.id);
        await interaction.reply({
          content: `✅ You have accepted the invitation and joined team **${teamIdentifier}**!`,
          ephemeral: true,
        });
      } catch (error: any) {
        await interaction.reply({
          content: `❌ Could not accept invitation: ${error.message || error}`,
          ephemeral: true,
        });
      }
      break;
    }
    case 'team_decline': {
      const teamIdentifier = params.join(':');
      try {
        const { declineInvitation } = await import('../services/teamService');
        await declineInvitation(teamIdentifier, interaction.user.id);
        await interaction.reply({
          content: `❌ You have declined the invitation for team **${teamIdentifier}**.`,
          ephemeral: true,
        });
      } catch (error: any) {
        await interaction.reply({
          content: `❌ Could not decline invitation: ${error.message || error}`,
          ephemeral: true,
        });
      }
      break;
    }
    case 'profile_btn_refresh': {
      try {
        const { listUserCharacters, syncCharacterProfile } = await import('../services/characterService');
        const chars = await listUserCharacters(interaction.user.id);
        const mainChar = chars.find((c) => c.isMain) || chars[0];
        if (!mainChar) {
          await interaction.reply({
            content: '❌ No registered characters found to sync.',
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const { result, character } = await syncCharacterProfile(mainChar.id, interaction.user.id);
        await interaction.editReply({
          content: `🔄 **${character.characterName}** refreshed from Raider.IO: \`${result}\` (Mythic+ Score: ${character.mythicScore ?? 'N/A'}, iLvl: ${character.itemLevel ?? 'N/A'})`,
        });
      } catch (error: any) {
        if (interaction.deferred) {
          await interaction.editReply({ content: `❌ Sync error: ${error.message || error}` });
        } else {
          await interaction.reply({ content: `❌ Sync error: ${error.message || error}`, ephemeral: true });
        }
      }
      break;
    }
    case 'profile_btn_list': {
      try {
        const { listUserCharacters } = await import('../services/characterService');
        const chars = await listUserCharacters(interaction.user.id);
        if (chars.length === 0) {
          await interaction.reply({
            content: '❌ No active characters registered. Use `G4!profile add-char` to add one.',
            ephemeral: true,
          });
          return;
        }
        const listText = chars
          .map((c) => `• ${c.isMain ? '⭐ [MAIN] ' : ''}**${c.characterName}** — ${c.realm} (${c.region.toUpperCase()}) | ${c.characterClass || 'Class'} | Score: ${c.mythicScore ?? 'N/A'}`)
          .join('\n');
        await interaction.reply({
          content: `📜 **Your Registered Characters:**\n${listText}`,
          ephemeral: true,
        });
      } catch (error: any) {
        await interaction.reply({ content: `❌ Error: ${error.message || error}`, ephemeral: true });
      }
      break;
    }
    case 'order_chan_complete': {
      const orderId = Number(params[0]);
      if (isNaN(orderId) || orderId <= 0) {
        await interaction.reply({ content: '❌ Invalid order ID parameter.', ephemeral: true });
        return;
      }
      try {
        const { completeOrderRun } = await import('../services/runValidationService');
        const prismaClient = (await import('../database/db')).default;
        const run = await prismaClient.orderRun.findFirst({
          where: { orderId, status: { in: ['pending', 'in_progress'] } },
        });
        if (!run) {
          await interaction.reply({
            content: `ℹ️ All runs for Order #${orderId} are already marked as completed or not active.`,
            ephemeral: true,
          });
          return;
        }
        await completeOrderRun(run.id, interaction.user.id, 'Completed via Discord coordination channel', prismaClient, interaction.client);
        await interaction.reply({
          content: `✅ **Run #${run.runNumber} Marked Completed!** Please submit proof screenshots.`,
          ephemeral: true,
        });
      } catch (err: any) {
        await interaction.reply({
          content: `❌ Could not complete run: ${err?.message || err}`,
          ephemeral: true,
        });
      }
      break;
    }
    case 'order_chan_proof': {
      const orderId = Number(params[0]);
      const webBaseUrl = process.env.WEB_BASE_URL || 'https://g4x.online';
      await interaction.reply({
        content:
          `📸 **Submit Completion Evidence for Order #${orderId}**\n` +
          `• Option 1: Upload and verify screenshot directly on the [Web Dashboard](${webBaseUrl}/#booster).\n` +
          `• Option 2: Post your screenshot directly in this coordination channel for Staff review.`,
        ephemeral: true,
      });
      break;
    }
    case 'order_status_badge': {
      const orderId = Number(params[0]);
      await interaction.reply({
        content: `ℹ️ Order #${orderId} is currently not open for pre-signing. Click **View Details** for current squad and progress details.`,
        ephemeral: true,
      });
      break;
    }
    case 'order_accept': {
      const orderId = params[0];
      await interaction.reply({
        content: `🚧 Accepting assignment for order #${orderId} — Coming soon!`,
        ephemeral: true,
      });
      break;
    }
    case 'order_decline': {
      const orderId = params[0];
      await interaction.reply({
        content: `🚧 Declining assignment for order #${orderId} — Coming soon!`,
        ephemeral: true,
      });
      break;
    }
    default:
      await interaction.reply({
        content: `❌ Unknown button action: \`${action}\``,
        ephemeral: true,
      });
  }
}
