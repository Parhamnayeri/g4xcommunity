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
import {
  handlePresignButton,
  handlePresignWithdrawButton,
  handleOrderViewButton,
} from '../services/orderDiscordService';

export async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const [action, ...params] = interaction.customId.split(':');

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
