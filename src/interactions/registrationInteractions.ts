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
  submitSupplementalInfo,
  getUserActiveApplications,
  getReviewChannelForCategory,
  resolveReviewChannelForCategory,
  RegistrationCategory,
  SUPPORTED_PILOT_GAMES,
  SUPPORTED_EXCHANGER_GAME_CURRENCIES,
  SUPPORTED_EXCHANGER_SETTLEMENT_CURRENCIES,
} from '../services/registrationService';
import { parseRaiderIOProfileUrl } from '../services/raiderio';

/**
 * ایجاد امبد پنل عمومی ثبت‌نام (نگهداری جهت سازگاری)
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
      'Exchange in-game currencies (WoW Gold, POE2 Divine Orbs, Aion 2) and settle via IRT, USDT, or TRY.\n\n' +
      '📂 **My Applications**\n' +
      'View your submitted applications, check review statuses, or provide additional requested information.'
    )
    .setColor(0x2f3136)
    .setFooter({ text: 'G4X Community • Secure Platform' })
    .setTimestamp();
}

/**
 * ایجاد ردیف دکمه‌های پنل ثبت‌نام تجمیعی
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
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('reg_start:my_apps')
      .setLabel('My Applications')
      .setEmoji('📂')
      .setStyle(ButtonStyle.Secondary)
  );
}

// ─── پنل‌های ثبت‌نام تفکیک‌شده اختصاصی هر کانال (Phase 3.2.4) ─────────────────

/**
 * ۱. پنل اختصاصی بوستر (#become-booster)
 */
export function buildBoosterPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🗡️ Become a Booster — G4X Community')
    .setDescription(
      'Apply to join the elite boosting roster at **G4X Community**.\n\n' +
      '• **Supported Games:** World of Warcraft: Midnight, Rainbow Six Siege, and competitive titles.\n' +
      '• **Automated Raider.IO Verification:** Live score and progression capture for WoW Midnight applicants.\n' +
      '• **Fair Booster Payouts:** Fully transparent order accounting and equal team distributions.\n\n' +
      'Click **Register as Booster** below to submit your booster application.\n' +
      'Use **My Applications** to monitor review status or provide requested information.'
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'G4X Community • Booster Registration' })
    .setTimestamp();
}

export function buildBoosterPanelButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('reg_start:booster')
      .setLabel('Register as Booster')
      .setEmoji('🗡️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('reg_start:my_apps')
      .setLabel('My Applications')
      .setEmoji('📂')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * ۲. پنل اختصاصی ادورتایزر (#become-adv)
 */
export function buildAdvertiserPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('📢 Become an Advertiser — G4X Community')
    .setDescription(
      'Apply to become an authorized customer advertiser for **G4X Community**.\n\n' +
      '• **Create Orders:** Publish customer boost orders directly to our verified booster rosters.\n' +
      '• **Commission Transparency:** Admin-configured commission rates with audited tracking.\n' +
      '• **Dedicated Review:** Fast application processing by platform management.\n\n' +
      'Click **Become an Advertiser** below to submit your details.\n' +
      'Use **My Applications** to view your active submissions.'
    )
    .setColor(0x3ba55d)
    .setFooter({ text: 'G4X Community • Advertiser Registration' })
    .setTimestamp();
}

export function buildAdvertiserPanelButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('reg_start:advertiser')
      .setLabel('Become an Advertiser')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('reg_start:my_apps')
      .setLabel('My Applications')
      .setEmoji('📂')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * ۳. پنل اختصاصی پایلوت (#become-pilot-booster)
 */
export function buildPilotPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('✈️ Apply for Pilot Booster — G4X Community')
    .setDescription(
      'Apply for verified account-play pilot boosting at **G4X Community**.\n\n' +
      '• **Account-Play Services:** High-tier Mythic, raiding, and specialized services.\n' +
      '• **Confidential ID Verification:** Required before pilot approval. Handled strictly in private channels.\n' +
      '• **Supported Titles:** WoW Midnight, Classic Era/TBC/Pandaria, Aion 2, POE 2, Tarkov.\n\n' +
      'Click **Apply for Pilot** below to begin your application.\n' +
      'Use **My Applications** to monitor your verification status.'
    )
    .setColor(0x9b59b6)
    .setFooter({ text: 'G4X Community • Pilot Application' })
    .setTimestamp();
}

export function buildPilotPanelButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('reg_start:pilot')
      .setLabel('Apply for Pilot')
      .setEmoji('✈️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('reg_start:my_apps')
      .setLabel('My Applications')
      .setEmoji('📂')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * ۴. پنل اختصاصی صراف (#become-exchanger)
 */
export function buildExchangerPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('💱 Become an Exchanger — G4X Community')
    .setDescription(
      'Apply to become an authorized in-game currency exchanger for **G4X Community**.\n\n' +
      '• **Supported Currencies:** WoW Gold, POE2 Divine Orbs, Aion 2 Currency.\n' +
      '• **Settlement Options:** Iranian Rial (IRT), Tether (USDT), Turkish Lira (TRY).\n' +
      '• **Secure Escrow:** Integrated platform trading and settlement protection.\n\n' +
      'Click **Become an Exchanger** below to submit your exchange application.\n' +
      'Use **My Applications** to track review status.'
    )
    .setColor(0xf1c40f)
    .setFooter({ text: 'G4X Community • Exchanger Registration' })
    .setTimestamp();
}

export function buildExchangerPanelButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('reg_start:exchanger')
      .setLabel('Become an Exchanger')
      .setEmoji('💱')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('reg_start:my_apps')
      .setLabel('My Applications')
      .setEmoji('📂')
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
    case 'my_apps': {
      await handleMyApplications(interaction);
      break;
    }
    case 'booster': {
      // باز کردن مستقیم مودال ثبت‌نام بوستر سراسری بدون نیاز به انتخاب بازی جداگانه
      const modal = new ModalBuilder()
        .setCustomId('reg_modal:booster:global')
        .setTitle('Booster Registration — G4X');

      const gamesInput = new TextInputBuilder()
        .setCustomId('main_games')
        .setLabel('Primary Games You Boost')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. WoW, PoE 2, Rainbow Six, Aion 2')
        .setRequired(true);

      const roleInput = new TextInputBuilder()
        .setCustomId('role_spec')
        .setLabel('Main Roles & Specializations')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. Tank / Blood DK 3.3k RIO, Grandmaster, Top 500')
        .setRequired(true);

      const expInput = new TextInputBuilder()
        .setCustomId('experience')
        .setLabel('Relevant Boosting Experience')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Ranks achieved, tournament history or previous booster teams.')
        .setRequired(true);

      const proofInput = new TextInputBuilder()
        .setCustomId('raiderio_or_proof')
        .setLabel('Raider.IO or Proof URL (Optional)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://raider.io/characters/eu/... or tracker link')
        .setRequired(false);

      const langInput = new TextInputBuilder()
        .setCustomId('language')
        .setLabel('Preferred Language & Timezone')
        .setStyle(TextInputStyle.Short)
        .setValue('English')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(gamesInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(roleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(expInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(proofInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(langInput)
      );

      await interaction.showModal(modal);
      break;
    }

    case 'pilot': {
      // باز کردن مستقیم مودال پایلوت سراسری بدون نیاز به اپلای برای تک‌تک بازی‌ها
      const modal = new ModalBuilder()
        .setCustomId('reg_modal:pilot:global')
        .setTitle('Pilot Booster Application — G4X');

      const gamesInput = new TextInputBuilder()
        .setCustomId('main_games')
        .setLabel('Games You Can Pilot')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. WoW Midnight/Classic, PoE 2, Tarkov, Aion 2')
        .setRequired(true);

      const expInput = new TextInputBuilder()
        .setCustomId('experience')
        .setLabel('Relevant Pilot Experience')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Past pilot orders completed, games, security experience.')
        .setRequired(true);

      const phoneInput = new TextInputBuilder()
        .setCustomId('contact_phone')
        .setLabel('Phone Number (Confidential)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('+1 234 567 8900')
        .setRequired(true);

      const socialInput = new TextInputBuilder()
        .setCustomId('contact_social')
        .setLabel('WhatsApp or Telegram Handle')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('@username or number')
        .setRequired(true);

      const notesInput = new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('VPN Setup & Security (Mandatory for Pilot)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Mention VPN setups or available hours.')
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(gamesInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(expInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(phoneInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(socialInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
      );

      await interaction.showModal(modal);
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

      const raiderioUrlInput = new TextInputBuilder()
        .setCustomId('raiderio_url')
        .setLabel('Raider.IO Character Profile URL')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://raider.io/characters/eu/realm-name/character-name')
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

      const langInput = new TextInputBuilder()
        .setCustomId('language')
        .setLabel('Preferred Communication Language')
        .setStyle(TextInputStyle.Short)
        .setValue('English')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(raiderioUrlInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(roleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(expInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(langInput)
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

    if (selectedGame === 'wow_midnight') {
      const modal = new ModalBuilder()
        .setCustomId(`reg_modal:pilot:wow_midnight`)
        .setTitle('WoW Midnight Pilot Application');

      const raiderioUrlInput = new TextInputBuilder()
        .setCustomId('raiderio_url')
        .setLabel('Raider.IO Character Profile URL')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://raider.io/characters/eu/realm-name/character-name')
        .setRequired(true);

      const expInput = new TextInputBuilder()
        .setCustomId('experience')
        .setLabel('Relevant Pilot Experience')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Past pilot orders completed, games, security experience.')
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

      const langInput = new TextInputBuilder()
        .setCustomId('language')
        .setLabel('Preferred Language')
        .setStyle(TextInputStyle.Short)
        .setValue('English')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(raiderioUrlInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(expInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(phoneInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(socialInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(langInput)
      );

      await interaction.showModal(modal);
    } else {
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
    }
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
    if (customId.startsWith('reg_modal:booster')) {
      const isGlobal = customId === 'reg_modal:booster:global' || customId === 'reg_modal:booster';
      const gameSlug = isGlobal ? null : customId.replace('reg_modal:booster:', '');

      if (isGlobal) {
        const mainGames = interaction.fields.getTextInputValue('main_games');
        const roleSpec = interaction.fields.getTextInputValue('role_spec');
        const experience = interaction.fields.getTextInputValue('experience');
        let proofUrl: string | undefined;
        try {
          proofUrl = interaction.fields.getTextInputValue('raiderio_or_proof')?.trim() || undefined;
        } catch {}
        const language = interaction.fields.getTextInputValue('language') || 'English';

        let raiderioUrl: string | undefined;
        if (proofUrl && proofUrl.includes('raider.io')) {
          const parsed = parseRaiderIOProfileUrl(proofUrl);
          if (parsed) raiderioUrl = parsed.canonicalUrl;
        }

        const app = await registerBooster({
          userId,
          gameSlug: undefined,
          mainRole: roleSpec,
          experience: `[Games: ${mainGames}]\n${experience}${proofUrl ? `\n[Profile/Proof: ${proofUrl}]` : ''}`,
          raiderioUrl,
          preferredLanguage: language,
        });

        await interaction.reply({
          content: `✅ **Booster Application Submitted!**\nApplication ID: **#${app.id}**\nYour global booster application has been recorded and routed to **#app-boosters** for review by management.`,
          ephemeral: true,
        });

        await notifyStaffReview(interaction.client, app.id);
      } else if (gameSlug === 'wow_midnight') {
        const raiderioUrl = interaction.fields.getTextInputValue('raiderio_url');
        const roleSpec = interaction.fields.getTextInputValue('role_spec');
        const experience = interaction.fields.getTextInputValue('experience');
        const language = interaction.fields.getTextInputValue('language') || 'English';

        const parsed = parseRaiderIOProfileUrl(raiderioUrl);
        if (!parsed) {
          await interaction.reply({
            content: '❌ **Invalid Raider.IO URL**: Please provide a legitimate Raider.IO character profile URL (e.g. `https://raider.io/characters/eu/realm-name/character-name`).',
            ephemeral: true,
          });
          return;
        }

        const app = await registerBooster({
          userId,
          gameSlug,
          raiderioUrl,
          mainRole: roleSpec,
          experience,
          preferredLanguage: language,
        });

        await interaction.reply({
          content: `✅ **Booster Application Submitted!**\nApplication ID: **#${app.id}**\nYour application has been routed to **#app-boosters** for review. Raider.IO profile verification has been captured.`,
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
    } else if (customId.startsWith('reg_modal:pilot')) {
      const isGlobal = customId === 'reg_modal:pilot:global' || customId === 'reg_modal:pilot';
      const gameSlug = isGlobal ? null : customId.replace('reg_modal:pilot:', '');

      if (isGlobal) {
        const mainGames = interaction.fields.getTextInputValue('main_games');
        const experience = interaction.fields.getTextInputValue('experience');
        const phone = interaction.fields.getTextInputValue('contact_phone');
        const social = interaction.fields.getTextInputValue('contact_social');
        const notes = interaction.fields.getTextInputValue('notes') || '';
        const language = 'English';

        const rawBaseUrl = process.env.PUBLIC_WEB_URL || process.env.WEB_BASE_URL || 'http://localhost:3001';
        const kycUrl = `${rawBaseUrl.replace(/\/+$/, '')}/profile/kyc`;

        const app = await registerPilot({
          userId,
          gameSlug: undefined,
          preferredLanguage: language,
          experience: `[Games: ${mainGames}]\n${experience}`,
          contactPreferences: {
            phone,
            whatsapp: social,
            telegram: social,
          },
          notes,
          discordClient: interaction.client,
        });

        await interaction.reply({
          content: `✅ **Pilot Application Submitted!**\nApplication ID: **#${app.id}**\n\n🪪 **Mandatory Identity Verification (KYC):**\nPlease complete your identity verification here: <${kycUrl}>\n*(A direct link has also been dispatched to your Discord DMs)*\n\nYour pilot application is currently **Pending** and routed to **#app-pilots**. Authorized management will review your file and verify identity. Do not share identity documents in public channels.`,
          ephemeral: true,
        });

        await notifyStaffReview(interaction.client, app.id);
      } else {
        const experience = interaction.fields.getTextInputValue('experience');
        const language = interaction.fields.getTextInputValue('language') || 'English';
        const phone = interaction.fields.getTextInputValue('contact_phone');
        const social = interaction.fields.getTextInputValue('contact_social');
        const notes = interaction.fields.getTextInputValue('notes') || '';
        let raiderioUrl: string | undefined;

        if (gameSlug === 'wow_midnight') {
          raiderioUrl = interaction.fields.getTextInputValue('raiderio_url');
          const parsed = parseRaiderIOProfileUrl(raiderioUrl);
          if (!parsed) {
            await interaction.reply({
              content: '❌ **Invalid Raider.IO URL**: Please provide a legitimate Raider.IO character profile URL (e.g. `https://raider.io/characters/eu/realm-name/character-name`).',
              ephemeral: true,
            });
            return;
          }
        }

        const rawBaseUrl = process.env.PUBLIC_WEB_URL || process.env.WEB_BASE_URL || 'http://localhost:3001';
        const kycUrl = `${rawBaseUrl.replace(/\/+$/, '')}/profile/kyc`;

        const app = await registerPilot({
          userId,
          gameSlug,
          preferredLanguage: language,
          experience,
          raiderioUrl,
          contactPreferences: {
            phone,
            whatsapp: social,
            telegram: social,
          },
          notes,
          discordClient: interaction.client,
        });

        await interaction.reply({
          content: `✅ **Pilot Application Submitted!**\nApplication ID: **#${app.id}**\n\n🪪 **Mandatory Identity Verification (KYC):**\nPlease complete your identity verification here: <${kycUrl}>\n*(A direct link has also been dispatched to your Discord DMs)*\n\nYour pilot application is currently **Pending** and routed to **#app-pilots**. Authorized management will initiate private identity verification with you. Do not share identity documents in public channels.`,
          ephemeral: true,
        });

        await notifyStaffReview(interaction.client, app.id);
      }
    } else if (customId === 'reg_modal:advertiser') {
      const intro = interaction.fields.getTextInputValue('intro');
      const salesExp = interaction.fields.getTextInputValue('sales_exp');
      const language = interaction.fields.getTextInputValue('language') || 'English';
      const contactInfo = interaction.fields.getTextInputValue('contact_info');

      const rawBaseUrl = process.env.PUBLIC_WEB_URL || process.env.WEB_BASE_URL || 'http://localhost:3001';
      const kycUrl = `${rawBaseUrl.replace(/\/+$/, '')}/profile/kyc`;

      const app = await registerAdvertiser({
        userId,
        introduction: intro,
        priorExperience: salesExp,
        preferredLanguage: language,
        contactInfo,
        discordClient: interaction.client,
      });

      await interaction.reply({
        content: `✅ **Advertiser Application Submitted!**\nApplication ID: **#${app.id}**\n\n🪪 **Identity Verification (KYC):**\nPlease complete your identity verification here: <${kycUrl}>\n*(A direct link has also been dispatched to your Discord DMs)*\n\nYour application is in pending status and will be reviewed by platform managers.`,
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

      const rawBaseUrl = process.env.PUBLIC_WEB_URL || process.env.WEB_BASE_URL || 'http://localhost:3001';
      const kycUrl = `${rawBaseUrl.replace(/\/+$/, '')}/profile/kyc`;

      const app = await registerExchanger({
        userId,
        introduction: intro,
        experience,
        preferredLanguage: language,
        gameCurrencies,
        settlementCurrencies,
        contactInfo,
        discordClient: interaction.client,
      });

      await interaction.reply({
        content: `✅ **Exchanger Application Submitted!**\nApplication ID: **#${app.id}**\n\n🪪 **Identity Verification (KYC):**\nPlease complete your identity verification here: <${kycUrl}>\n*(A direct link has also been dispatched to your Discord DMs)*\n\nYour application has been received for administrative review and identity verification.`,
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

      await renderOrUpdateStaffReviewCard(interaction.client, appId);
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

      await renderOrUpdateStaffReviewCard(interaction.client, appId);
    } else if (customId.startsWith('modal_submit_supp_info:')) {
      const appId = Number(customId.replace('modal_submit_supp_info:', ''));
      const supplementalInfo = interaction.fields.getTextInputValue('supplemental_info');

      await submitSupplementalInfo(appId, userId, supplementalInfo, interaction.client);

      await interaction.reply({
        content: `✅ Supplemental information submitted for Application **#${appId}**! It has been moved back to the review queue.`,
        ephemeral: true,
      });

      await renderOrUpdateStaffReviewCard(interaction.client, appId);
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
        content: `✅ Application **#${appId}** has been successfully **Approved**! Database records updated and role sync processed.`,
        ephemeral: true,
      });

      await renderOrUpdateStaffReviewCard(interaction.client, appId);
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
        content: `🔒 Identity verification initiated for Application **#${appId}**. Marked as awaiting secure submission. Review controls remain active.`,
        ephemeral: true,
      });

      await renderOrUpdateStaffReviewCard(interaction.client, appId);
    } else if (action === 'refresh') {
      await renderOrUpdateStaffReviewCard(interaction.client, appId);

      await interaction.reply({
        content: `🔃 Review card for Application **#${appId}** has been refreshed from database state.`,
        ephemeral: true,
      });
    } else if (action === 'retry_sync') {
      await reviewApplication({
        reviewerId,
        applicationId: appId,
        decision: 'retry_role_sync',
        discordClient: interaction.client,
      });

      await renderOrUpdateStaffReviewCard(interaction.client, appId);

      await interaction.reply({
        content: `🔄 Role synchronization retried for Application **#${appId}**. Review card updated.`,
        ephemeral: true,
      });
    }
  } catch (err: any) {
    const errorMsg = err?.message || err;
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ Review action failed: ${errorMsg}`,
        ephemeral: true,
      });
    } else {
      await interaction.followUp({
        content: `❌ Review action failed: ${errorMsg}`,
        ephemeral: true,
      });
    }
  }
}

/**
 * مدیریت دکمه "ارسال مدارک تکمیلی" توسط متقاضی
 */
export async function handleProvideInfoButton(interaction: ButtonInteraction): Promise<void> {
  const [prefix, appIdStr] = interaction.customId.split(':');
  if (prefix !== 'app_provide_info') return;

  const appId = Number(appIdStr);
  const userId = interaction.user.id;

  const app = await prisma.registrationApplication.findUnique({
    where: { id: appId },
  });

  if (!app) {
    await interaction.reply({
      content: '❌ Application not found.',
      ephemeral: true,
    });
    return;
  }

  // بررسی امنیتی مالکیت درخواست (Security Guard)
  if (app.userId !== userId) {
    await interaction.reply({
      content: '❌ You are not authorized to submit information for this application.',
      ephemeral: true,
    });
    return;
  }

  if (app.status !== 'info_requested') {
    await interaction.reply({
      content: `❌ This application is currently \`${app.status.toUpperCase()}\` and is not awaiting supplemental information.`,
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal_submit_supp_info:${appId}`)
    .setTitle(`Provide Info for #${appId}`);

  const infoInput = new TextInputBuilder()
    .setCustomId('supplemental_info')
    .setLabel('Supplemental Information / Evidence')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Provide the details, links, or qualifications requested by the reviewer.')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(infoInput));
  await interaction.showModal(modal);
}

/**
 * نمایش درخواست‌های فعال کاربر در پاسخ خصوصی (My Applications fallback)
 */
export async function handleMyApplications(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  const apps = await getUserActiveApplications(userId);

  if (!apps || apps.length === 0) {
    await interaction.reply({
      content: '📁 You currently have no active registration applications.',
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('📁 Your Active Applications')
    .setDescription(
      `Found **${apps.length}** active application(s):\n\n` +
        apps
          .map((a) => {
            const statusDisplay = a.status.toUpperCase();
            let details = `• **#${a.id}** — \`${a.category.toUpperCase()}\` | Status: \`${statusDisplay}\``;
            if (a.gameSlug) details += ` | Game: \`${a.gameSlug}\``;
            if (a.status === 'info_requested') {
              details += `\n  ⚠️ **Action Required**: Additional information requested: *${a.reviewNotes || 'See details'}*`;
            }
            return details;
          })
          .join('\n\n')
    )
    .setColor(0x5865f2);

  const infoRequestedApps = apps.filter((a) => a.status === 'info_requested');
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (infoRequestedApps.length > 0) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const infoApp of infoRequestedApps.slice(0, 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`app_provide_info:${infoApp.id}`)
          .setLabel(`Provide Info for #${infoApp.id}`)
          .setEmoji('📝')
          .setStyle(ButtonStyle.Primary)
      );
    }
    rows.push(row);
  }

  await interaction.reply({
    embeds: [embed],
    components: rows,
    ephemeral: true,
  });
}

/**
 * ایجاد امبد کارت بازبینی از وضعیت موجود در دیتابیس
 */
export function buildReviewCardEmbed(app: any): EmbedBuilder {
  let parsedQualifications: any = {};
  try {
    parsedQualifications =
      typeof app.qualifications === 'string' ? JSON.parse(app.qualifications) : app.qualifications;
  } catch {}

  const colorMap: Record<string, number> = {
    pending: 0x5865f2,
    under_review: 0x3ba55d,
    info_requested: 0xfee75c,
    awaiting_identity_verification: 0x9b59b6,
    approved: 0x57f287,
    rejected: 0xed4245,
    cancelled: 0x747f8d,
  };

  const statusColor = colorMap[app.status] ?? 0x2f3136;

  const publicSummary =
    parsedQualifications.experience ||
    parsedQualifications.intro ||
    parsedQualifications.introduction ||
    parsedQualifications.priorExperience ||
    'N/A';

  const embed = new EmbedBuilder()
    .setTitle(`📋 Registration Application: #${app.id}`)
    .setColor(statusColor)
    .addFields(
      {
        name: 'Applicant',
        value: `<@${app.userId}> (${app.user?.username || app.userId})`,
        inline: true,
      },
      {
        name: 'Category',
        value: `\`${app.category.toUpperCase()}\``,
        inline: true,
      },
      {
        name: 'Game / Service',
        value: `\`${app.gameSlug || 'N/A'}\``,
        inline: true,
      },
      {
        name: 'Status',
        value: `\`${app.status.toUpperCase()}\``,
        inline: true,
      },
      {
        name: 'Identity Status',
        value: `\`${(app.identityStatus || 'NONE').toUpperCase()}\``,
        inline: true,
      },
      {
        name: 'Role Sync',
        value: `\`${(app.roleSyncStatus || 'PENDING').toUpperCase()}\`${
          app.roleSyncError ? `\n⚠️ *${app.roleSyncError}*` : ''
        }`,
        inline: true,
      }
    );

  if (app.reviewNotes || app.supplementalInfo || app.rejectionReason) {
    let reviewDetails = '';
    if (app.status === 'info_requested') {
      reviewDetails += `**Information Requested:** ${app.reviewNotes || 'N/A'}\n`;
      if (app.infoRequestedAt) {
        reviewDetails += `*Requested at: <t:${Math.floor(new Date(app.infoRequestedAt).getTime() / 1000)}:R>*\n`;
      }
    }
    if (app.supplementalInfo) {
      reviewDetails += `**Supplemental Response:** ${app.supplementalInfo}\n`;
      if (app.infoRespondedAt) {
        reviewDetails += `*Responded at: <t:${Math.floor(new Date(app.infoRespondedAt).getTime() / 1000)}:R>*\n`;
      }
    }
    if (app.status === 'rejected' && app.rejectionReason) {
      reviewDetails += `**Rejection Reason:** ${app.rejectionReason}\n`;
    }
    if (reviewDetails) {
      embed.addFields({ name: 'Review & Supplemental Details', value: reviewDetails.trim() });
    }
  }

  embed.addFields({
    name: 'Experience / Qualifications',
    value: publicSummary.length > 1024 ? publicSummary.slice(0, 1020) + '...' : publicSummary,
  });

  if (parsedQualifications.raiderioSnapshot) {
    const rio = parsedQualifications.raiderioSnapshot;
    let rioStatusText = '';
    if (rio.fetchStatus === 'success') {
      rioStatusText = '✅ Verified via Raider.IO API';
    } else if (rio.fetchStatus === 'not_found') {
      rioStatusText = '⚠️ Character not found on Raider.IO (Manual review required)';
    } else if (rio.fetchStatus === 'api_error') {
      rioStatusText = `⚠️ Raider.IO API error: ${rio.errorDetails || 'Temporary failure'}`;
    } else {
      rioStatusText = 'ℹ️ Stale data';
    }

    const rioLines = [
      `**Profile:** [${rio.characterName} - ${rio.realm} (${(rio.region || 'EU').toUpperCase()})](${rio.profileUrl})`,
      `**Class & Spec:** ${rio.characterClass || 'N/A'} • ${rio.activeSpec || 'N/A'} (${rio.activeRole || 'N/A'})`,
      `**Item Level:** Equipped: **${rio.itemLevelEquipped ?? 'N/A'}** (Total: ${rio.itemLevelTotal ?? 'N/A'})`,
      `**Mythic+ Score:** **${rio.mythicScore ?? 'N/A'}** (Tank: ${rio.tankScore ?? '-'}, Healer: ${rio.healerScore ?? '-'}, DPS: ${rio.dpsScore ?? '-'})`,
      `**Raid Progress:** ${rio.raidProgression || 'No recent raid progress recorded'}`,
      `**Status:** ${rioStatusText}`,
      `*Note: Raider.IO profile is for qualification assessment only. It does not verify account ownership or pilot identity.*`,
    ];

    embed.addFields({
      name: '🛡️ Raider.IO Character Profile (WoW Midnight)',
      value: rioLines.join('\n'),
    });
  }

  if (app.reviewedById) {
    embed.addFields({
      name: 'Last Reviewer',
      value: `<@${app.reviewedById}>${
        app.reviewedAt ? ` (<t:${Math.floor(new Date(app.reviewedAt).getTime() / 1000)}:R>)` : ''
      }`,
      inline: true,
    });
  }

  embed.setFooter({ text: `Application #${app.id} • Preferred Language: ${app.preferredLanguage}` });
  embed.setTimestamp(app.submittedAt ? new Date(app.submittedAt) : new Date());

  return embed;
}

/**
 * ایجاد دکمه‌های پایدار کارت بازبینی
 */
export function buildReviewCardButtons(app: any): ActionRowBuilder<ButtonBuilder>[] {
  const isTerminal = ['approved', 'rejected', 'cancelled'].includes(app.status);

  if (isTerminal) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    if (app.status === 'approved' && app.roleSyncStatus === 'failed') {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`app_review:retry_sync:${app.id}`)
          .setLabel('Retry Role Sync')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔄')
      );
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`app_review:refresh:${app.id}`)
        .setLabel('Refresh Review')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔃')
    );
    return [row];
  }

  // وضعیت‌های غیرنهایی: pending, under_review, info_requested, awaiting_identity_verification
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
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
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`app_review:id_verif:${app.id}`)
        .setLabel(app.identityStatus === 'verified' ? 'ID Verified' : 'Verify ID')
        .setStyle(app.identityStatus === 'verified' ? ButtonStyle.Success : ButtonStyle.Primary)
        .setDisabled(app.identityStatus === 'verified')
        .setEmoji('🔒')
    );
  }

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`app_review:refresh:${app.id}`)
      .setLabel('Refresh Review')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔃')
  );

  if (app.roleSyncStatus === 'failed') {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`app_review:retry_sync:${app.id}`)
        .setLabel('Retry Role Sync')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔄')
    );
  }

  return [row1, row2];
}

/**
 * رندر یا به‌روزرسانی کارت بازبینی در کانال استاف
 */
export async function renderOrUpdateStaffReviewCard(client: any, applicationId: number): Promise<void> {
  if (!client) return;

  const app = await prisma.registrationApplication.findUnique({
    where: { id: applicationId },
    include: { user: true },
  });

  if (!app) return;

  const embed = buildReviewCardEmbed(app);
  const components = buildReviewCardButtons(app);

  // اگر پیام بازبینی قبلاً در کانال ثبت شده بود، آن را به‌روزرسانی کن
  if (app.reviewChannelId && app.reviewMessageId) {
    try {
      const channel = (await client.channels.fetch(app.reviewChannelId).catch(() => null)) as TextChannel | null;
      if (channel) {
        const msg = await channel.messages.fetch(app.reviewMessageId).catch(() => null);
        if (msg) {
          await msg.edit({
            embeds: [embed],
            components,
          });
          return;
        }
      }
    } catch (err) {
      console.warn(`[ReviewCard] Could not edit existing review card for #${applicationId}:`, err);
    }
  }

  // هدایت پیام بازبینی به کانال اختصاصی همان دسته‌بندی
  const channelId = await resolveReviewChannelForCategory(app.category as RegistrationCategory, client);
  if (!channelId) {
    console.warn(`[ReviewCard] No review channel configured for category '${app.category}' (App #${applicationId})`);
    return;
  }

  try {
    const channel = (await client.channels.fetch(channelId).catch((fetchErr: any) => {
      console.error(`[ReviewCard] Failed to fetch channel ${channelId} for app #${applicationId}:`, fetchErr?.message || fetchErr);
      return null;
    })) as TextChannel | null;

    if (!channel) {
      console.error(`[ReviewCard] Channel ${channelId} not found/unreachable for app #${applicationId}`);
      return;
    }

    // اطمینان از دسترسی بات در کانال بازبینی
    const botUser = client.user;
    if (botUser && typeof channel.permissionOverwrites?.edit === 'function') {
      await channel.permissionOverwrites.edit(botUser.id, {
        ViewChannel: true,
        SendMessages: true,
        EmbedLinks: true,
        AttachFiles: true,
        ReadMessageHistory: true,
      }).catch((permErr: any) => {
        console.warn(`[ReviewCard] Could not ensure bot permissions in #${channel.name}:`, permErr?.message);
      });
    }

    const sentMsg = await channel.send({
      embeds: [embed],
      components,
    });

    console.log(`[ReviewCard] Successfully posted review card for app #${applicationId} (${app.category}) in #${channel.name} (${channel.id})`);

    await prisma.registrationApplication.update({
      where: { id: applicationId },
      data: {
        reviewChannelId: channel.id,
        reviewMessageId: sentMsg.id,
      },
    });
  } catch (err: any) {
    console.error(`[ReviewCard] Failed to post staff review card for #${applicationId}:`, err?.message || err);
  }
}

/**
 * ارسال کارت بازبینی به کانال خصوصی استاف/مدیریت (نگهدارنده سازگاری با کدهای پیشین)
 */
export async function notifyStaffReview(client: any, applicationId: number): Promise<void> {
  await renderOrUpdateStaffReviewCard(client, applicationId);
}
