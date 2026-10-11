/**
 * modals.ts — مدیریت تعاملات مودال (Modal Submit Interactions)
 * 
 * مودال‌های تعریف‌شده:
 *  modal_add_character     — فرم افزودن کاراکتر WoW
 *  modal_apply_booster     — فرم درخواست عضویت بوستر
 *  modal_create_order      — فرم ایجاد سفارش
 *  modal_pilot_verify      — فرم ارسال مدارک احراز هویت
 */

import { ModalSubmitInteraction } from 'discord.js';
import { handleRegistrationModalSubmit } from './registrationInteractions';

export async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const { customId } = interaction;

  if (
    customId.startsWith('reg_modal:') ||
    customId.startsWith('app_modal_reject:') ||
    customId.startsWith('app_modal_info:')
  ) {
    await handleRegistrationModalSubmit(interaction);
    return;
  }

  switch (customId) {
    case 'modal_add_character': {
      // const charName = interaction.fields.getTextInputValue('character_name');
      // const realm    = interaction.fields.getTextInputValue('realm');
      // const region   = interaction.fields.getTextInputValue('region');
      // TODO: افزودن کاراکتر به دیتابیس و همگام‌سازی Raider.IO
      await interaction.reply({
        content: '🚧 **Add Character** modal — Coming soon!',
        ephemeral: true,
      });
      break;
    }
    case 'modal_apply_booster': {
      // TODO: ثبت درخواست عضویت و ارسال به کانال #apply-requests
      await interaction.reply({
        content: '🚧 **Apply as Booster** modal — Coming soon!',
        ephemeral: true,
      });
      break;
    }
    case 'modal_create_order': {
      // TODO: ایجاد سفارش و انتشار در کانال سفارشات
      await interaction.reply({
        content: '🚧 **Create Order** modal — Coming soon!',
        ephemeral: true,
      });
      break;
    }
    case 'modal_pilot_verify': {
      // TODO: ثبت درخواست احراز هویت پایلوت
      await interaction.reply({
        content: '🚧 **Pilot Verification** modal — Coming soon!',
        ephemeral: true,
      });
      break;
    }
    default:
      await interaction.reply({
        content: `❌ Unknown modal: \`${customId}\``,
        ephemeral: true,
      });
  }
}
