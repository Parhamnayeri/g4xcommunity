/**
 * registrationInteractions.ts — مدیریت تعاملات پنل ثبت‌نام، فرم‌ها، منوها و بازبینی ادمین
 * 
 * فاز ۳.۲: سیستم ثبت‌نام دیسکورد (Discord.js v14)
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';

import prisma from '../database/db';
import {
  registerBooster,
  registerPilot,
  registerAdvertiser,
  registerExchanger,
  reviewApplication,
  SUPPORTED_PILOT_GAMES,
  SUPPORTED_EXCHANGER_GAME_CURRENCIES,
  SUPPORTED_EXCHANGER_SETTLEMENT_CURRENCIES,
} from '../services/registrationService';

/**
 * ایجاد امبد پنل عمومی ثبت‌نام
 */
export function buildRegistrationPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🛡️ G4X Community — Member Registration')
    .setDescription(
      'Welcome to **G4X Community**.\n' +
      'Please select the role you wish to apply for below.\n\n' +
      '🗡️ **Register as Booster**\n' +
      'Join our elite roster across supported games (WoW Midnight, R6 Siege, etc.). Automatic Raider.IO sync is supported for WoW Midnight.\n\n' +
      '✈️ **Apply for Pilot**\n' +
      'Account-play boosting for verified members. Requires game qualification and secure identity verification.\n\n' +
      '📢 **Become an Advertiser**\n' +
      'Create and manage boost orders for customers on our platform.\n\n' +
      '💱 **Become an Exchanger**\n' +
      'Exchange in-game currencies (WoW Gold, POE2 Divine Orbs, Aion 2) and settle via IRT, USDT, or TRY.'
    )
    .setColor(0x2f3136)
    .setFooter({ text: 'G4X Community • Secure Platform' })
    .setTimestamp();
}

/**
 * ایجاد ردیف دکمه‌های پنل ثبت‌نام
 */
export function buildRegistrationPanelButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('reg_start:booster')
      .setLabel('Register as Booster')
      .setEmoji('🗡️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('reg_start:pilot')
      .setLabel('Apply for Pilot')
      .setEmoji('✈️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('reg_start:advertiser')
      .setLabel('Become an Advertiser')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('reg_start:exchanger')
      .setLabel('Become an Exchanger')
      .setEmoji('💱')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * مدیریت کلیک روی دکمه‌های شروع ثبت‌نام
 */
export async function handleRegistrationButton(interaction: ButtonInteraction): Promise<void> {
  const [prefix, track] = interaction.customId.split(':');

  if (prefix !== 'reg_start') return;

  switch (track) {
    case 'booster': {
      // ارسال منوی انتخاب بازی برای بوستر
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('reg_select:game:booster')
        .setPlaceholder('Select the game you want to boost in')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('World of Warcraft Midnight')
            .setDescription('Supports Raider.IO profile verification')
            .setValue('wow_midnight')
            .setEmoji('⚔️'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Rainbow Six Siege')
            .setDescription('Manual qualification review')
            .setValue('rainbow_six_siege')
            .setEmoji('🎯')
        );

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

      await interaction.reply({
        content: 'Please select the game for your booster application:',
        components: [row],
        ephemeral: true,
      });
      break;
    }

    case 'pilot': {
      // ارسال منوی ۸ بازی پشتیبانی‌شده پایلوت
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('reg_select:game:pilot')
        .setPlaceholder('Select the game for Pilot service')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('World of Warcraft Midnight')
            .setValue('wow_midnight')
            .setEmoji('⚔️'),
          new StringSelectMenuOptionBuilder()
            .setLabel('WoW Classic TBC')
            .setValue('wow_classic_tbc')
            .setEmoji('🛡️'),
          new StringSelectMenuOptionBuilder()
            .setLabel('WoW Classic Era')
            .setValue('wow_classic_era')
            .setEmoji('📜'),
          new StringSelectMenuOptionBuilder()
            .setLabel('WoW Classic Pandaria')
            .setValue('wow_classic_pandaria')
            .setEmoji('🐼'),
          new StringSelectMenuOptionBuilder()
            .setLabel('WoW Forever')
            .setValue('wow_forever')
            .setEmoji('⏳'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Aion 2')
            .setValue('aion_2')
            .setEmoji('🏹'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Path of Exile 2')
            .setValue('poe2')
            .setEmoji('💎'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Escape from Tarkov')
            .setValue('escape_from_tarkov')
            .setEmoji('🔫')
        );

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

      await interaction.reply({
        content: 'Please select the supported game for your Pilot application:',
        components: [row],
        ephemeral: true,
      });
      break;
    }

    case 'advertiser': {
      // باز کردن مودال ادورتایزر مستقیماً
      const modal = new ModalBuilder()
        .setCustomId('reg_modal:advertiser')
        .setTitle('Advertiser Application');

      const introInput = new TextInputBuilder()
        .setCustomId('intro')
        .setLabel('Introduction & Background')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Briefly tell us about yourself and your activity in the boosting scene.')
        .setRequired(true);

      const expInput = new TextInputBuilder()
        .setCustomId('sales_exp')
        .setLabel('Prior Advertising / Sales Experience')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Describe any sales, community, or boosting advertising experience.')
        .setRequired(true);

      const langInput = new TextInputBuilder()
        .setCustomId('language')
        .setLabel('Preferred Communication Language')
        .setStyle(TextInputStyle.Short)
        .setValue('English')
        .setRequired(true);

      const contactInput = new TextInputBuilder()
        .setCustomId('contact_info')
        .setLabel('Contact Info (Telegram / WhatsApp / Discord)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. @telegram_handle or phone')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(introInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(expInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(langInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(contactInput)
      );

      await interaction.showModal(modal);
      break;
    }

    case 'exchanger': {
      // مرحله ۱ صراف: انتخاب ارزهای بازی و تسویه
      const gameCurrSelect = new StringSelectMenuBuilder()
        .setCustomId('reg_select:exchanger:currencies')
        .setPlaceholder('Select in-game currencies you handle (1 to 3)')
        .setMinValues(1)
        .setMaxValues(3)
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('World of Warcraft Gold')
            .setValue('wow_gold')
            .setEmoji('💰'),
          new StringSelectMenuOptionBuilder()
            .setLabel('POE2 Divine Orbs')
            .setValue('poe2_divine')
            .setEmoji('🔮'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Aion 2 Currency')
            .setValue('aion2_currency')
            .setEmoji('🪙')
        );

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(gameCurrSelect);

      await interaction.reply({
        content: 'Step 1/2: Select the in-game currencies you want to exchange:',
        components: [row],
        ephemeral: true,
      });
      break;
    }
  }
}

/**
 * مدیریت تغییرات منوهای کشویی ثبت‌نام
 */
export async function handleRegistrationSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const customId = interaction.customId;

  if (customId === 'reg_select:game:booster') {
    const selectedGame = interaction.values[0];

    if (selectedGame === 'wow_midnight') {
      const modal = new ModalBuilder()
        .setCustomId(`reg_modal:booster:wow_midnight`)
        .setTitle('WoW Midnight Booster Registration');

      const charNameInput = new TextInputBuilder()
        .setCustomId('char_name')
        .setLabel('Character Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. Arthas')
        .setRequired(true);

      const realmInput = new TextInputBuilder()
        .setCustomId('realm')
        .setLabel('Realm Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. Twisting Nether')
        .setRequired(true);

      const regionInput = new TextInputBuilder()
        .setCustomId('region')
        .setLabel('Region (eu / us)')
        .setStyle(TextInputStyle.Short)
        .setValue('eu')
        .setRequired(true);

      const roleInput = new TextInputBuilder()
        .setCustomId('role_spec')
        .setLabel('Main Role & Specialization')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. Tank / Blood Death Knight')
        .setRequired(true);

      const expInput = new TextInputBuilder()
        .setCustomId('experience')
        .setLabel('Relevant Boosting Experience')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('M+ score history, CE raids, or previous teams.')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(charNameInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(realmInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(regionInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(roleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(expInput)
      );

      await interaction.showModal(modal);
    } else {
      const modal = new ModalBuilder()
        .setCustomId(`reg_modal:booster:${selectedGame}`)
        .setTitle('Booster Registration');

      const roleInput = new TextInputBuilder()
        .setCustomId('role_spec')
        .setLabel('Main Role & Specialization')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. Entry Fragger, Support')
        .setRequired(true);

      const expInput = new TextInputBuilder()
        .setCustomId('experience')
        .setLabel('Relevant Boosting Experience')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Ranks achieved, tournament or boost experience.')
        .setRequired(true);

      const langInput = new TextInputBuilder()
        .setCustomId('language')
        .setLabel('Preferred Communication Language')
        .setStyle(TextInputStyle.Short)
        .setValue('English')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(roleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(expInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(langInput)
      );

      await interaction.showModal(modal);
    }
  } else if (customId === 'reg_select:game:pilot') {
    const selectedGame = interaction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`reg_modal:pilot:${selectedGame}`)
      .setTitle('Pilot Booster Application');

    const expInput = new TextInputBuilder()
      .setCustomId('experience')
      .setLabel('Relevant Pilot Experience')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Past pilot orders completed, games, security experience.')
      .setRequired(true);

    const langInput = new TextInputBuilder()
      .setCustomId('language')
      .setLabel('Preferred Language')
      .setStyle(TextInputStyle.Short)
      .setValue('English')
      .setRequired(true);

    const phoneInput = new TextInputBuilder()
      .setCustomId('contact_phone')
      .setLabel('Phone Number (Confidential)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('+1 234 567 8900')
      .setRequired(true);

    const socialInput = new TextInputBuilder()
      .setCustomId('contact_social')
      .setLabel('WhatsApp or Telegram')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. @telegram_user')
      .setRequired(true);

    const notesInput = new TextInputBuilder()
      .setCustomId('notes')
      .setLabel('Availability & VPN / Security Details')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Mention VPN setups or available hours.')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(expInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(langInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(phoneInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(socialInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
    );

    await interaction.showModal(modal);
  } else if (customId === 'reg_select:exchanger:currencies') {
    const selectedGameCurrencies = interaction.values.join(',');

    // مرحله ۲: انتخاب ارزهای تسویه و دکمه ورود مودال
    const settleSelect = new StringSelectMenuBuilder()
      .setCustomId(`reg_select:exchanger:settle:${selectedGameCurrencies}`)
      .setPlaceholder('Select external settlement currencies (1 to 3)')
      .setMinValues(1)
      .setMaxValues(3)
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Iranian Rial (IRT)')
          .setValue('IRT')
          .setEmoji('🇮🇷'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Tether USD (USDT)')
          .setValue('USDT')
          .setEmoji('💵'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Turkish Lira (TRY)')
          .setValue('TRY')
          .setEmoji('🇹🇷')
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(settleSelect);

    await interaction.reply({
      content: 'Step 2/2: Select the settlement currencies you support (e.g. IRT, USDT, TRY):',
      components: [row],
      ephemeral: true,
    });
  } else if (customId.startsWith('reg_select:exchanger:settle:')) {
    const gameCurrencies = customId.replace('reg_select:exchanger:settle:', '');
    const settlementCurrencies = interaction.values.join(',');

    const modal = new ModalBuilder()
      .setCustomId(`reg_modal:exchanger:${gameCurrencies}:${settlementCurrencies}`)
      .setTitle('Exchanger Application');

    const introInput = new TextInputBuilder()
      .setCustomId('intro')
      .setLabel('User Introduction & Background')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Introduce yourself and your experience with currency exchange.')
      .setRequired(true);

    const expInput = new TextInputBuilder()
      .setCustomId('experience')
      .setLabel('Trading & Exchange Experience')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Volume handled, past trade platforms, references.')
      .setRequired(true);

    const langInput = new TextInputBuilder()
      .setCustomId('language')
      .setLabel('Preferred Language')
      .setStyle(TextInputStyle.Short)
      .setValue('English')
      .setRequired(true);

    const contactInput = new TextInputBuilder()
      .setCustomId('contact_info')
      .setLabel('Contact Info')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Telegram, WhatsApp or Discord')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(introInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(expInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(langInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(contactInput)
    );

    await interaction.showModal(modal);
  }
}

/**
 * مدیریت سابمیت مودال‌های ثبت‌نام
 */
export async function handleRegistrationModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const customId = interaction.customId;
  const userId = interaction.user.id;

  try {
    if (customId.startsWith('reg_modal:booster:')) {
      const gameSlug = customId.replace('reg_modal:booster:', '');

      if (gameSlug === 'wow_midnight') {
        const characterName = interaction.fields.getTextInputValue('char_name');
        const realm = interaction.fields.getTextInputValue('realm');
        const region = interaction.fields.getTextInputValue('region');
        const roleSpec = interaction.fields.getTextInputValue('role_spec');
        const experience = interaction.fields.getTextInputValue('experience');

        const app = await registerBooster({
          userId,
          gameSlug,
          characterName,
          realm,
          region,
          mainRole: roleSpec,
          experience,
        });

        await interaction.reply({
          content: `✅ **Booster Application Submitted!**\nApplication ID: **#${app.id}**\nYour application has been submitted for review. Raider.IO profile sync has been processed.`,
          ephemeral: true,
        });

        await notifyStaffReview(interaction.client, app.id);
      } else {
        const roleSpec = interaction.fields.getTextInputValue('role_spec');
        const experience = interaction.fields.getTextInputValue('experience');
        const language = interaction.fields.getTextInputValue('language') || 'English';

        const app = await registerBooster({
          userId,
          gameSlug,
          mainRole: roleSpec,
          experience,
          preferredLanguage: language,
        });

        await interaction.reply({
          content: `✅ **Booster Application Submitted!**\nApplication ID: **#${app.id}**\nYour qualifications have been recorded and will be reviewed by management.`,
          ephemeral: true,
        });

        await notifyStaffReview(interaction.client, app.id);
      }
    } else if (customId.startsWith('reg_modal:pilot:')) {
      const gameSlug = customId.replace('reg_modal:pilot:', '');
      const experience = interaction.fields.getTextInputValue('experience');
      const language = interaction.fields.getTextInputValue('language') || 'English';
      const phone = interaction.fields.getTextInputValue('contact_phone');
      const social = interaction.fields.getTextInputValue('contact_social');
      const notes = interaction.fields.getTextInputValue('notes') || '';

      const app = await registerPilot({
        userId,
        gameSlug,
        preferredLanguage: language,
        experience,
        contactPreferences: {
          phone,
          whatsapp: social,
          telegram: social,
        },
        notes,
      });

      await interaction.reply({
        content: `✅ **Pilot Application Submitted!**\nApplication ID: **#${app.id}**\nYour pilot application is currently **Pending**. Authorized management will initiate private identity verification with you. Do not share identity documents in public channels.`,
        ephemeral: true,
      });

      await notifyStaffReview(interaction.client, app.id);
    } else if (customId === 'reg_modal:advertiser') {
      const intro = interaction.fields.getTextInputValue('intro');
      const salesExp = interaction.fields.getTextInputValue('sales_exp');
      const language = interaction.fields.getTextInputValue('language') || 'English';
      const contactInfo = interaction.fields.getTextInputValue('contact_info');

      const app = await registerAdvertiser({
        userId,
        introduction: intro,
        priorExperience: salesExp,
        preferredLanguage: language,
        contactInfo,
      });

      await interaction.reply({
        content: `✅ **Advertiser Application Submitted!**\nApplication ID: **#${app.id}**\nYour application is in pending status and will be reviewed by platform managers.`,
        ephemeral: true,
      });

      await notifyStaffReview(interaction.client, app.id);
    } else if (customId.startsWith('reg_modal:exchanger:')) {
      const parts = customId.replace('reg_modal:exchanger:', '').split(':');
      const gameCurrencies = parts[0]?.split(',') || ['wow_gold'];
      const settlementCurrencies = parts[1]?.split(',') || ['IRT', 'USDT', 'TRY'];

      const intro = interaction.fields.getTextInputValue('intro');
      const experience = interaction.fields.getTextInputValue('experience');
      const language = interaction.fields.getTextInputValue('language') || 'English';
      const contactInfo = interaction.fields.getTextInputValue('contact_info');

      const app = await registerExchanger({
        userId,
        introduction: intro,
        experience,
        preferredLanguage: language,
        gameCurrencies,
        settlementCurrencies,
        contactInfo,
      });

      await interaction.reply({
        content: `✅ **Exchanger Application Submitted!**\nApplication ID: **#${app.id}**\nYour application has been received for administrative review and identity verification.`,
        ephemeral: true,
      });

      await notifyStaffReview(interaction.client, app.id);
    } else if (customId.startsWith('app_modal_reject:')) {
      const appId = Number(customId.replace('app_modal_reject:', ''));
      const reason = interaction.fields.getTextInputValue('reject_reason');

      await reviewApplication({
        reviewerId: userId,
        applicationId: appId,
        decision: 'reject',
        reason,
        discordClient: interaction.client,
      });

      await interaction.reply({
        content: `✅ Application **#${appId}** has been **Rejected** with reason: "${reason}". Applicant notified.`,
        ephemeral: true,
      });

      // به‌روزرسانی پیام بازبینی
      if (interaction.message) {
        await updateReviewCard(interaction.message, appId, 'rejected', userId, reason);
      }
    } else if (customId.startsWith('app_modal_info:')) {
      const appId = Number(customId.replace('app_modal_info:', ''));
      const notes = interaction.fields.getTextInputValue('info_notes');

      await reviewApplication({
        reviewerId: userId,
        applicationId: appId,
        decision: 'request_info',
        reason: notes,
        discordClient: interaction.client,
      });

      await interaction.reply({
        content: `ℹ️ Requested additional information for Application **#${appId}**. Applicant notified.`,
        ephemeral: true,
      });

      if (interaction.message) {
        await updateReviewCard(interaction.message, appId, 'info_requested', userId, notes);
      }
    }
  } catch (err: any) {
    const errorMsg = err?.message || 'An unexpected error occurred';
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ Error: ${errorMsg}`,
        ephemeral: true,
      });
    } else {
      await interaction.followUp({
        content: `❌ Error: ${errorMsg}`,
        ephemeral: true,
      });
    }
  }
}

/**
 * مدیریت کلیک روی دکمه‌های بازبینی ادمین (Admin Review Interaction)
 */
export async function handleAdminReviewButton(interaction: ButtonInteraction): Promise<void> {
  const [prefix, action, appIdStr] = interaction.customId.split(':');

  if (prefix !== 'app_review') return;
  const appId = Number(appIdStr);
  const reviewerId = interaction.user.id;

  try {
    if (action === 'approve') {
      await reviewApplication({
        reviewerId,
        applicationId: appId,
        decision: 'approve',
        discordClient: interaction.client,
      });

      await interaction.reply({
        content: `✅ Application **#${appId}** has been successfully **Approved**! Database records updated and roles synchronized.`,
        ephemeral: true,
      });

      if (interaction.message) {
        await updateReviewCard(interaction.message, appId, 'approved', reviewerId);
      }
    } else if (action === 'reject') {
      const modal = new ModalBuilder()
        .setCustomId(`app_modal_reject:${appId}`)
        .setTitle(`Reject Application #${appId}`);

      const reasonInput = new TextInputBuilder()
        .setCustomId('reject_reason')
        .setLabel('Rejection Reason')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Enter the explicit reason for rejection (sent to applicant).')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
      await interaction.showModal(modal);
    } else if (action === 'info') {
      const modal = new ModalBuilder()
        .setCustomId(`app_modal_info:${appId}`)
        .setTitle(`Request Info for #${appId}`);

      const notesInput = new TextInputBuilder()
        .setCustomId('info_notes')
        .setLabel('Information Details Required')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Specify what additional documents or experience are needed.')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput));
      await interaction.showModal(modal);
    } else if (action === 'id_verif') {
      await reviewApplication({
        reviewerId,
        applicationId: appId,
        decision: 'start_identity_verification',
        discordClient: interaction.client,
      });

      await interaction.reply({
        content: `🔒 Identity verification initiated for Application **#${appId}**. Marked as awaiting secure submission.`,
        ephemeral: true,
      });

      if (interaction.message) {
        await updateReviewCard(interaction.message, appId, 'awaiting_secure_submission', reviewerId);
      }
    }
  } catch (err: any) {
    await interaction.reply({
      content: `❌ Review action failed: ${err?.message || err}`,
      ephemeral: true,
    });
  }
}

/**
 * ارسال کارت بازبینی به کانال خصوصی استاف/مدیریت
 */
export async function notifyStaffReview(client: any, applicationId: number): Promise<void> {
  if (!client) return;

  const channelId = process.env.CHANNEL_APPLY_REQUESTS;
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
    if (!channel) return;

    const app = await prisma.registrationApplication.findUnique({
      where: { id: applicationId },
      include: { user: true },
    });

    if (!app) return;

    let parsedQualifications: any = {};
    try {
      parsedQualifications = JSON.parse(app.qualifications);
    } catch {}

    const embed = new EmbedBuilder()
      .setTitle(`📋 New Registration Application: #${app.id}`)
      .setDescription(
        `**Applicant:** <@${app.userId}> (${app.user?.username || app.userId})\n` +
        `**Track:** \`${app.category.toUpperCase()}\`\n` +
        `**Game:** \`${app.gameSlug || 'N/A'}\`\n` +
        `**Language:** \`${app.preferredLanguage}\`\n` +
        `**Submitted At:** <t:${Math.floor(app.submittedAt.getTime() / 1000)}:R>\n` +
        `**Status:** \`PENDING\`\n\n` +
        `**Summary / Experience:**\n${parsedQualifications.experience || parsedQualifications.intro || parsedQualifications.priorExperience || 'N/A'}`
      )
      .setColor(0x5865f2)
      .setTimestamp();

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`app_review:approve:${app.id}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`app_review:reject:${app.id}`)
        .setLabel('Reject')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌'),
      new ButtonBuilder()
        .setCustomId(`app_review:info:${app.id}`)
        .setLabel('Request Info')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('ℹ️')
    );

    if (app.category === 'pilot' || app.category === 'exchanger') {
      buttons.addComponents(
        new ButtonBuilder()
          .setCustomId(`app_review:id_verif:${app.id}`)
          .setLabel('Verify ID')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔒')
      );
    }

    await channel.send({
      embeds: [embed],
      components: [buttons],
    });
  } catch (err) {
    console.warn(`[RegistrationInteractions] Failed to notify staff review channel:`, err);
  }
}

/**
 * به‌روزرسانی کارت بازبینی پس از تصمیم‌گیری
 */
async function updateReviewCard(message: any, appId: number, decision: string, reviewerId: string, notes?: string) {
  try {
    const existingEmbed = message.embeds[0];
    if (!existingEmbed) return;

    const updatedEmbed = EmbedBuilder.from(existingEmbed)
      .setColor(decision === 'approved' ? 0x57f287 : decision === 'rejected' ? 0xed4245 : 0xfee75c)
      .addFields({
        name: 'Review Decision',
        value: `**Decision:** \`${decision.toUpperCase()}\`\n**Reviewer:** <@${reviewerId}>\n**Timestamp:** <t:${Math.floor(Date.now() / 1000)}:R>${notes ? `\n**Notes:** ${notes}` : ''}`,
      });

    await message.edit({
      embeds: [updatedEmbed],
      components: [], // غیرفعال‌سازی دکمه‌ها برای جلوگیری از کلیک‌های بعدی
    });
  } catch (err) {
    console.warn(`[RegistrationInteractions] Failed to edit review card message:`, err);
  }
}
