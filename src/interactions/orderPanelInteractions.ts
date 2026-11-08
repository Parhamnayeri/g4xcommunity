/**
 * orderPanelInteractions.ts — Embeds, Buttons, Modals and Handlers for Dedicated Order Creation Panels
 *
 * Supports two distinct categories:
 *  1. G4X Direct Orders (Authorized Management/Staff, Permission.ORDER_CREATE_INTERNAL)
 *  2. Advertiser Orders (Approved Commercial Advertisers, Permission.ORDER_CREATE_ADVERTISER)
 *
 * Supported Panel Types in each category:
 *  - wow_midnight_mythic (WoW Midnight Mythic+ Boosting, preserves 4-Booster requirement)
 *  - non_pilot (Self-play carry services across supported games)
 *  - pilot (Account-play services with identity and pilot qualification validation)
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
} from 'discord.js';

import prisma from '../database/db';
import { authorize } from '../services/authorizationService';
import { Permission } from '../services/permissionTypes';
import { validateGameAndService } from '../services/orderValidationService';
import {
  AdvertiserRank,
  isValidAdvertiserRank,
  calculateRankCommission,
  ADVERTISER_RANK_POLICY_VERSION,
} from '../services/advertiserRankService';

export type OrderPanelCategory = 'g4x' | 'adv';
export type OrderPanelType = 'mythic' | 'non_pilot' | 'pilot' | 'wizard';

// ─── ۱. ساخت Embed های اختصاصی هر پنل (Panel Embeds) ────────────────────────

export function buildMythicPanelEmbed(category: OrderPanelCategory): EmbedBuilder {
  const isAdv = category === 'adv';
  return new EmbedBuilder()
    .setTitle(
      isAdv
        ? '📢 Advertiser Orders — WoW Midnight Mythic+ Panel'
        : '⚔️ G4X Direct Orders — WoW Midnight Mythic+ Panel'
    )
    .setDescription(
      isAdv
        ? 'Dedicated order creation gateway for **Approved G4X Advertisers** to submit World of Warcraft: Midnight Mythic+ carry orders.\n\n' +
          '• **Order Type:** World of Warcraft: Midnight — Mythic+ Boosting (`mythic_plus`).\n' +
          '• **Eligibility:** Approved Advertisers with an active commercial rank (`ORDER_CREATE_ADVERTISER`).\n' +
          '• **Squad Rule:** Enforces the mandatory **four-Booster squad** composition (1 Tank, 1 Healer, 2 DPS).\n' +
          '• **Commercial Accounting:** Instant commission snapshot from your approved rank (Bronze 14.99% to Official Partners 6.99%).\n' +
          '• **Payment & Verification:** Orders require backed funding (wallet balance or management verification) before public listing.\n' +
          '• **After Submission:** Order is created in draft/payment_pending, roles are attached, and audit records are sealed.'
        : 'Dedicated order creation gateway for **G4X Management & Operations** to submit direct World of Warcraft: Midnight Mythic+ carry orders.\n\n' +
          '• **Order Type:** Direct G4X World of Warcraft: Midnight — Mythic+ Boosting (`mythic_plus`).\n' +
          '• **Eligibility:** Authorized G4X Management and Operations Staff (`ORDER_CREATE_INTERNAL`).\n' +
          '• **Squad Rule:** Enforces the mandatory **four-Booster squad** composition (1 Tank, 1 Healer, 2 DPS).\n' +
          '• **Accounting Policy:** Direct G4X order without external platform seller fees. 100% of the allocated pool is reserved for eligible boosters.\n' +
          '• **Payment & Verification:** Orders require verified backed funding. Unpaid drafts remain unpublished.\n' +
          '• **After Submission:** Authoritative order is created and prepared for coordination and booster claiming.'
    )
    .setColor(isAdv ? 0xe67e22 : 0x5865f2)
    .addFields(
      {
        name: '📋 Required Information',
        value:
          '• Dungeon Target & Key Level (e.g. `+10 Ara-Kara`)\n' +
          '• Total Order Amount ($ USD)\n' +
          '• Number of Runs (Default: 1)\n' +
          '• Customer Tag / Realm (Optional)\n' +
          '• Timer or Armor Stack Notes (Optional)',
        inline: false,
      },
      {
        name: '🔒 Payment & Security',
        value:
          'Unpaid orders stay in `payment_pending` and are **never** published to the public board until authoritatively verified.',
        inline: false,
      }
    )
    .setFooter({
      text: isAdv ? 'G4X Community • Advertiser Mythic+ Gateway' : 'G4X Community • Management Mythic+ Gateway',
    })
    .setTimestamp();
}

export function buildNonPilotPanelEmbed(category: OrderPanelCategory): EmbedBuilder {
  const isAdv = category === 'adv';
  return new EmbedBuilder()
    .setTitle(
      isAdv
        ? '📢 Advertiser Orders — Non-Pilot Boost Panel'
        : '🛡️ G4X Direct Orders — Non-Pilot Boost Panel'
    )
    .setDescription(
      isAdv
        ? 'Dedicated order creation gateway for **Approved G4X Advertisers** to submit Non-Pilot / Self-Play carry orders.\n\n' +
          '• **Order Type:** Non-Pilot (Self-play) boost across supported games (WoW Midnight Raid/AFK, R6 Siege, etc.).\n' +
          '• **Eligibility:** Approved Advertisers with an active commercial rank (`ORDER_CREATE_ADVERTISER`).\n' +
          '• **Commercial Accounting:** Automatic rank commission snapshot (no G2G seller deductions applied).\n' +
          '• **Payment Policy:** Backed funding must be verified before release to pre-signing.\n' +
          '• **After Submission:** Order is securely stored with complete advertiser metadata and audit trail.'
        : 'Dedicated order creation gateway for **G4X Management & Operations** to submit direct Non-Pilot carry orders.\n\n' +
          '• **Order Type:** Direct G4X Non-Pilot boost across supported games.\n' +
          '• **Eligibility:** Authorized G4X Management and Operations Staff (`ORDER_CREATE_INTERNAL`).\n' +
          '• **Accounting Policy:** 100% direct community order with zero platform seller deductions.\n' +
          '• **Payment Policy:** Verified payment required prior to card release.\n' +
          '• **After Submission:** Non-pilot order is created in draft/payment_pending awaiting funding verification.'
    )
    .setColor(isAdv ? 0xe67e22 : 0x2ecc71)
    .addFields(
      {
        name: '📋 Required Information',
        value:
          '• Game Slug (e.g. `wow_midnight`, `rainbow_six_siege`)\n' +
          '• Service ID or Service Key (e.g. `raid_boost`, `afk_leveling`, `non_pilot_boost`)\n' +
          '• Total Order Amount ($ USD)\n' +
          '• Runs / Quantity\n' +
          '• Customer Instructions & Scheduling Notes',
        inline: false,
      },
      {
        name: '🔒 Payment & Security',
        value: 'All orders fail closed. No unverified or unfunded order is published to boosters.',
        inline: false,
      }
    )
    .setFooter({
      text: isAdv ? 'G4X Community • Advertiser Non-Pilot Gateway' : 'G4X Community • Management Non-Pilot Gateway',
    })
    .setTimestamp();
}

export function buildPilotPanelEmbed(category: OrderPanelCategory): EmbedBuilder {
  const isAdv = category === 'adv';
  return new EmbedBuilder()
    .setTitle(
      isAdv
        ? '📢 Advertiser Orders — Pilot Boost Panel'
        : '✈️ G4X Direct Orders — Pilot Boost Panel'
    )
    .setDescription(
      isAdv
        ? 'Dedicated order creation gateway for **Approved G4X Advertisers** to submit Account-Play (Piloted) orders.\n\n' +
          '• **Order Type:** Pilot (Account-play) boost for approved titles (WoW Midnight, Classic WoW, PoE2, Tarkov, Aion 2).\n' +
          '• **Eligibility:** Approved Advertisers with an active commercial rank (`ORDER_CREATE_ADVERTISER`).\n' +
          '• **Pilot Safety:** Assigned exclusively to identity-verified pilots with approved game credentials.\n' +
          '• **Commercial Accounting:** Authoritative advertiser rank commission snapshot.\n' +
          '• **Payment Policy:** Backed funding must be verified before pilot assignment.\n' +
          '• **After Submission:** Order is recorded with security guidelines and strict VPN directives.'
        : 'Dedicated order creation gateway for **G4X Management & Operations** to submit direct Pilot carry orders.\n\n' +
          '• **Order Type:** Direct G4X Pilot (Account-play) boost for approved titles.\n' +
          '• **Eligibility:** Authorized G4X Management and Operations Staff (`ORDER_CREATE_INTERNAL`).\n' +
          '• **Pilot Safety:** Strictly restricted to identity-verified and background-checked pilots.\n' +
          '• **Accounting Policy:** Direct G4X order with full booster pool preservation.\n' +
          '• **Payment Policy:** Verified payment required prior to assignment.\n' +
          '• **After Submission:** Pilot order is registered with security and VPN requirements.'
    )
    .setColor(isAdv ? 0xe67e22 : 0x9b59b6)
    .addFields(
      {
        name: '📋 Required Information',
        value:
          '• Game Slug (e.g. `wow_midnight`, `wow_classic_era`, `poe2`, `escape_from_tarkov`)\n' +
          '• Service ID or Service Key (`pilot_boost`)\n' +
          '• Total Order Amount ($ USD)\n' +
          '• Required VPN Location (Country & City)\n' +
          '• Platform & Security Directives (No in-game chatting, stream on Discord, etc.)',
        inline: false,
      },
      {
        name: '🔒 Pilot Safety & Verification',
        value: 'Only boosters with active `PilotVerification` approval can claim or execute piloted orders.',
        inline: false,
      }
    )
    .setFooter({
      text: isAdv ? 'G4X Community • Advertiser Pilot Gateway' : 'G4X Community • Management Pilot Gateway',
    })
    .setTimestamp();
}

// ─── ۲. ساخت دکمه‌های پنل (Panel Buttons) ────────────────────────────────────

export function buildOrderPanelButtons(
  category: OrderPanelCategory,
  panelType: OrderPanelType
): ActionRowBuilder<ButtonBuilder> {
  let label = 'Create Order';
  let emoji = '➕';
  let style = ButtonStyle.Primary;

  if (panelType === 'mythic') {
    label = 'Create Mythic+ Order';
    emoji = '⚔️';
    style = ButtonStyle.Primary;
  } else if (panelType === 'non_pilot') {
    label = 'Create Non-Pilot Order';
    emoji = '🛡️';
    style = ButtonStyle.Success;
  } else if (panelType === 'pilot') {
    label = 'Create Pilot Order';
    emoji = '✈️';
    style = ButtonStyle.Danger;
  }

  const customId = `ord_create:${category}:${panelType}`;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setEmoji(emoji)
      .setStyle(style)
  );
}

// ─── ۳. ساخت فرم‌های مودال (Modal Builders) ──────────────────────────────────

export function buildMythicOrderModal(category: OrderPanelCategory): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`modal_ord:${category}:mythic`)
    .setTitle('WoW Midnight Mythic+ Order');

  const keyLevelInput = new TextInputBuilder()
    .setCustomId('key_level')
    .setLabel('Dungeon Target & Key Level')
    .setPlaceholder('e.g. +10 Ara-Kara or Any +10')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const amountInput = new TextInputBuilder()
    .setCustomId('amount_usd')
    .setLabel('Total Amount in USD ($)')
    .setPlaceholder('e.g. 45.00')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  const runsInput = new TextInputBuilder()
    .setCustomId('runs_count')
    .setLabel('Number of Runs (Default: 1)')
    .setPlaceholder('1')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  const customerInput = new TextInputBuilder()
    .setCustomId('customer_info')
    .setLabel('Customer Tag / Character / Realm')
    .setPlaceholder('e.g. Player#1234 - Silvermoon EU')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Special Directives / Armor Stack / Timer')
    .setPlaceholder('e.g. Beat timer (+2), Cloth armor stack preferred')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(keyLevelInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(runsInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(customerInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
  );

  return modal;
}

export function buildNonPilotOrderModal(category: OrderPanelCategory): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`modal_ord:${category}:non_pilot`)
    .setTitle('Non-Pilot Boost Order');

  const gameSlugInput = new TextInputBuilder()
    .setCustomId('game_slug')
    .setLabel('Game Slug')
    .setPlaceholder('e.g. wow_midnight or rainbow_six_siege')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);

  const serviceIdInput = new TextInputBuilder()
    .setCustomId('service_id')
    .setLabel('Service ID or Key')
    .setPlaceholder('e.g. raid_boost, afk_leveling, non_pilot_boost')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);

  const amountInput = new TextInputBuilder()
    .setCustomId('amount_usd')
    .setLabel('Total Amount in USD ($)')
    .setPlaceholder('e.g. 50.00')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  const runsInput = new TextInputBuilder()
    .setCustomId('runs_count')
    .setLabel('Runs / Matches / Quantity (Default: 1)')
    .setPlaceholder('1')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Order Details & Customer Notes')
    .setPlaceholder('e.g. Heroic Raid Full Clear, Friday 8 PM CET')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(gameSlugInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(serviceIdInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(runsInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
  );

  return modal;
}

export function buildPilotOrderModal(category: OrderPanelCategory): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`modal_ord:${category}:pilot`)
    .setTitle('Pilot Boost Order');

  const gameSlugInput = new TextInputBuilder()
    .setCustomId('game_slug')
    .setLabel('Game Slug')
    .setPlaceholder('e.g. wow_classic_era, poe2, escape_from_tarkov')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);

  const serviceIdInput = new TextInputBuilder()
    .setCustomId('service_id')
    .setLabel('Service ID or Key')
    .setPlaceholder('e.g. pilot_boost')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);

  const amountInput = new TextInputBuilder()
    .setCustomId('amount_usd')
    .setLabel('Total Amount in USD ($)')
    .setPlaceholder('e.g. 75.00')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  const vpnLocationInput = new TextInputBuilder()
    .setCustomId('vpn_location')
    .setLabel('Required VPN Location (Country & City)')
    .setPlaceholder('e.g. Germany / Frankfurt')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Platform & Pilot Directives')
    .setPlaceholder('e.g. PC Battle.net, do not chat in-game, stream on Discord')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(gameSlugInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(serviceIdInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(vpnLocationInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
  );

  return modal;
}

// ─── ۴. مدیریت کلیک روی دکمه‌های پنل (Button Interaction Handler) ─────────────

export async function handleOrderPanelButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  const category = parts[1] as OrderPanelCategory;
  const panelType = parts[2] as OrderPanelType;
  const actorId = interaction.user.id;

  // ۱. اعتبارسنجی سطح دسترسی سرور-ساید
  if (category === 'g4x') {
    const auth = await authorize(actorId, Permission.ORDER_CREATE_INTERNAL);
    if (!auth.allowed) {
      await interaction.reply({
        content:
          '❌ **Permission Denied**: You do not have permission to create G4X Direct orders. Only authorized G4X Management and Staff may create orders here.',
        ephemeral: true,
      });
      return;
    }
  } else if (category === 'adv') {
    const auth = await authorize(actorId, Permission.ORDER_CREATE_ADVERTISER);
    if (!auth.allowed) {
      await interaction.reply({
        content:
          '❌ **Permission Denied**: You do not have permission to create Advertiser orders. Only approved Commercial Advertisers may create orders here.',
        ephemeral: true,
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { discordId: actorId },
    });
    if (!user?.advertiserRank || !isValidAdvertiserRank(user.advertiserRank)) {
      await interaction.reply({
        content:
          '❌ **Unresolved Commercial Rank**: Your account does not have an approved commercial Advertiser rank configured by management. Order creation is blocked until an administrator assigns an approved rank.',
        ephemeral: true,
      });
      return;
    }
  } else {
    await interaction.reply({
      content: '❌ Invalid order category parameter.',
      ephemeral: true,
    });
    return;
  }

  // ۲. همه دکمه‌های پنل‌ها (میتیک، نان‌پایلوت، پایلوت و جنرال) وارد ویزارد هدایت‌شده می‌شوند
  const { startOrderWizard } = await import('./orderWizardInteractions');
  await startOrderWizard(interaction, category, panelType);
}

// Helper function to safely read TextInput values without throwing DiscordjsTypeError
export function safeGetModalTextInput(
  interaction: ModalSubmitInteraction,
  customId: string
): string | null {
  try {
    const val = interaction.fields.getTextInputValue(customId);
    return typeof val === 'string' ? val : null;
  } catch {
    return null;
  }
}

// ─── ۵. مدیریت سابمیت فرم‌های مودال (Modal Submit Interaction Handler) ─────────

export async function handleOrderPanelModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  const category = parts[1] as OrderPanelCategory;
  const actorId = interaction.user.id;

  // ۱. اعتبارسنجی سطح دسترسی سرور-ساید
  if (category === 'adv') {
    const auth = await authorize(actorId, Permission.ORDER_CREATE_ADVERTISER);
    if (!auth.allowed) {
      await interaction.reply({
        content: '❌ **Permission Denied**: You do not have permission to create Advertiser orders.',
        ephemeral: true,
      });
      return;
    }
  } else if (category === 'g4x') {
    const auth = await authorize(actorId, Permission.ORDER_CREATE_INTERNAL);
    if (!auth.allowed) {
      await interaction.reply({
        content: '❌ **Permission Denied**: You do not have permission to create G4X Direct orders.',
        ephemeral: true,
      });
      return;
    }
  }

  // ۲. اطلاع‌رسانی بازنشستگی مودال‌های مستقیم و الزام ورود از طریق ویزارد
  await interaction.reply({
    content:
      '⚠️ **Legacy Order Modal Retired**: Direct order creation modals have been upgraded to the G4X Guided Order Wizard.\n\nPlease click the **Create Order** button on the panel to proceed with the guided wizard.',
    ephemeral: true,
  });
}
/*

    if (isAdv) {
      if (!user?.advertiserRank || !isValidAdvertiserRank(user.advertiserRank)) {
        await interaction.reply({
          content:
            '❌ **Unresolved Commercial Rank**: Advertiser does not have an approved commercial rank configured by management.',
          ephemeral: true,
        });
        return;
      }
      advRank = user.advertiserRank as AdvertiserRank;
    }

    // ۳. استخراج و اعتبارسنجی مقادیر فرم
    const rawAmount = safeGetModalTextInput(interaction, 'amount_usd')?.trim();
    if (!rawAmount || !/^\d+(\.\d{1,2})?$/.test(rawAmount)) {
      await interaction.reply({
        content: '❌ **Invalid Order Amount**: Total amount must be a positive number in USD (e.g. `45.00`).',
        ephemeral: true,
      });
      return;
    }

    const amountUsd = parseFloat(rawAmount);
    if (isNaN(amountUsd) || amountUsd <= 0) {
      await interaction.reply({
        content: '❌ **Invalid Order Amount**: Total amount must be a positive number in USD (e.g. `45.00`).',
        ephemeral: true,
      });
      return;
    }

    const grossCents = Math.round(amountUsd * 100);
    if (!Number.isSafeInteger(grossCents) || grossCents <= 0) {
      await interaction.reply({
        content: '❌ **Invalid Order Amount**: Order gross amount cannot be processed.',
        ephemeral: true,
      });
      return;
    }

    let gameSlug = '';
    let serviceIdOrKey = '';
    let orderMode: 'non_pilot' | 'pilot' = 'non_pilot';
    let orderType = 'group';
    let runsCount = 1;
    let assembledNotes = '';

    if (panelType === 'mythic') {
      gameSlug = 'wow_midnight';
      serviceIdOrKey = 'mythic_plus';
      orderMode = 'non_pilot';
      orderType = 'group';

      const keyLevel = safeGetModalTextInput(interaction, 'key_level')?.trim();
      if (!keyLevel) {
        await interaction.reply({
          content: '❌ **Missing Key Level**: Target dungeon and key level are required (e.g. `+10 Ara-Kara`).',
          ephemeral: true,
        });
        return;
      }

      const rawRuns = safeGetModalTextInput(interaction, 'runs_count')?.trim();
      if (rawRuns && rawRuns.length > 0) {
        const parsedRuns = parseInt(rawRuns, 10);
        if (!/^\d+$/.test(rawRuns) || isNaN(parsedRuns) || parsedRuns < 1) {
          await interaction.reply({
            content: '❌ **Invalid Runs Count**: Number of runs must be a positive integer (e.g. `1`, `5`).',
            ephemeral: true,
          });
          return;
        }
        runsCount = parsedRuns;
      } else {
        runsCount = 1;
      }

      const customerInfo = safeGetModalTextInput(interaction, 'customer_info')?.trim() || '';
      const notes = safeGetModalTextInput(interaction, 'notes')?.trim() || '';

      assembledNotes = `[Mythic+ Target: ${keyLevel}]`;
      if (customerInfo) assembledNotes += ` [Customer: ${customerInfo}]`;
      if (notes) assembledNotes += ` ${notes}`;
    } else if (panelType === 'non_pilot') {
      const rawGameSlug = safeGetModalTextInput(interaction, 'game_slug')?.trim();
      if (!rawGameSlug) {
        await interaction.reply({
          content: '❌ **Missing Game Slug**: Please specify a valid game slug (e.g. `wow_midnight`, `rainbow_six_siege`).',
          ephemeral: true,
        });
        return;
      }
      gameSlug = rawGameSlug.toLowerCase();

      const rawServiceId = safeGetModalTextInput(interaction, 'service_id')?.trim();
      if (!rawServiceId) {
        await interaction.reply({
          content: '❌ **Missing Service ID**: Please specify a valid service ID or key (e.g. `raid_boost`, `afk_leveling`).',
          ephemeral: true,
        });
        return;
      }
      serviceIdOrKey = rawServiceId.toLowerCase();

      const rawRuns = safeGetModalTextInput(interaction, 'runs_count')?.trim();
      if (rawRuns && rawRuns.length > 0) {
        const parsedRuns = parseInt(rawRuns, 10);
        if (!/^\d+$/.test(rawRuns) || isNaN(parsedRuns) || parsedRuns < 1) {
          await interaction.reply({
            content: '❌ **Invalid Runs Count**: Runs / matches / quantity must be a positive integer (e.g. `1`, `5`).',
            ephemeral: true,
          });
          return;
        }
        runsCount = parsedRuns;
      } else {
        runsCount = 1;
      }

      orderMode = 'non_pilot';
      orderType = 'solo';

      const notes = safeGetModalTextInput(interaction, 'notes')?.trim() || '';
      assembledNotes = notes;
    } else if (panelType === 'pilot') {
      const rawGameSlug = safeGetModalTextInput(interaction, 'game_slug')?.trim();
      if (!rawGameSlug) {
        await interaction.reply({
          content: '❌ **Missing Game Slug**: Please specify a valid game slug (e.g. `wow_classic_era`, `poe2`).',
          ephemeral: true,
        });
        return;
      }
      gameSlug = rawGameSlug.toLowerCase();

      const rawServiceId = safeGetModalTextInput(interaction, 'service_id')?.trim();
      if (!rawServiceId) {
        await interaction.reply({
          content: '❌ **Missing Service ID**: Please specify a valid service ID or key (e.g. `pilot_boost`).',
          ephemeral: true,
        });
        return;
      }
      serviceIdOrKey = rawServiceId.toLowerCase();

      const rawVpnLocation = safeGetModalTextInput(interaction, 'vpn_location')?.trim();
      if (!rawVpnLocation) {
        await interaction.reply({
          content: '❌ **Missing VPN Location**: Pilot orders strictly require specifying the desired VPN Country & City for account security.',
          ephemeral: true,
        });
        return;
      }

      orderMode = 'pilot';
      orderType = 'pilot';
      runsCount = 1;

      const notes = safeGetModalTextInput(interaction, 'notes')?.trim() || '';
      assembledNotes = `[Required VPN: ${rawVpnLocation}]`;
      if (notes) assembledNotes += ` ${notes}`;
    } else {
      await interaction.reply({
        content: `❌ **Unknown Order Panel Type**: \`${panelType}\``,
        ephemeral: true,
      });
      return;
    }

    // ۴. تطبیق بازی و سرویس در پایگاه داده
    const game = await prisma.game.findUnique({
      where: { slug: gameSlug },
    });
    if (!game || !game.isActive) {
      await interaction.reply({
        content: `❌ **Game Not Found or Inactive**: Game \`${gameSlug}\` is not recognized or not active.`,
        ephemeral: true,
      });
      return;
    }

    // جستجوی سرویس با شناسه عددی یا کلید متنی در آن بازی
    const numericServiceId = parseInt(serviceIdOrKey, 10);
    let service = !isNaN(numericServiceId)
      ? await prisma.gameService.findFirst({
          where: { id: numericServiceId, gameSlug },
        })
      : await prisma.gameService.findFirst({
          where: { serviceKey: serviceIdOrKey, gameSlug },
        });

    // فال‌بک برای mythic_plus در صورت عدم تطابق دقیق
    if (!service && panelType === 'mythic') {
      service = await prisma.gameService.findFirst({
        where: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus' },
      });
    }

    if (!service || !service.isActive) {
      await interaction.reply({
        content: `❌ **Service Not Found or Inactive**: Service \`${serviceIdOrKey}\` was not found for game \`${gameSlug}\`.`,
        ephemeral: true,
      });
      return;
    }

    // اعتبارسنجی تطابق مود انتخابی با سرویس
    if (orderMode === 'pilot' && service.serviceMode !== 'pilot' && !service.requiresPilotApproval) {
      await interaction.reply({
        content: `❌ **Service Mode Mismatch**: Service \`${service.displayName}\` does not support pilot mode.`,
        ephemeral: true,
      });
      return;
    }
    if (orderMode === 'non_pilot' && service.serviceMode === 'pilot') {
      await interaction.reply({
        content: `❌ **Service Mode Mismatch**: Service \`${service.displayName}\` is a pilot-only service.`,
        ephemeral: true,
      });
      return;
    }

    // ۵. محاسبه کمیسیون و اسنپ‌شات مالی
    let platformFeeMinor = 0;
    let boosterPoolMinor = grossCents;
    let rankCommissionBps: number | null = null;

    if (isAdv && advRank) {
      const calc = calculateRankCommission(grossCents, advRank);
      platformFeeMinor = calc.g4xFeeMinor;
      boosterPoolMinor = calc.remainingMinor;
      rankCommissionBps = calc.rankCommissionBasisPoints;
    }

    const orderRef = `ORD_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // ۶. ایجاد سفارش در تراکنش اتمیک
    const createdOrder = await prisma.$transaction(async (tx) => {
      // بررسی موجودی کیف پول سازنده جهت رزرو وجوه معتبر
      const wallet = await tx.walletV2.findUnique({
        where: { userId: actorId },
      });

      const hasSufficientWalletFunds = Boolean(wallet && wallet.availableCents >= grossCents);
      let paymentStatus = 'pending';
      let orderStatus = 'payment_pending';
      let paymentVerifiedBy: string | null = null;
      let paymentVerifiedAt: Date | null = null;

      if (hasSufficientWalletFunds && wallet) {
        const newAvailable = wallet.availableCents - grossCents;
        const newReserved = wallet.reservedCents + grossCents;

        await tx.walletV2.update({
          where: { userId: actorId },
          data: {
            availableCents: newAvailable,
            reservedCents: newReserved,
          },
        });

        await tx.ledgerEntryV2.create({
          data: {
            entryRef: `LEDGER_ORD_RES_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
            userId: actorId,
            amountCents: grossCents,
            entryType: 'ORDER_RESERVE',
            direction: 'DEBIT',
            balanceAfterAvailableCents: newAvailable,
            balanceAfterReservedCents: newReserved,
            description: `Authoritative funds reserved from available USD balance for Order #${orderRef}`,
            createdBy: actorId,
          },
        });

        paymentStatus = 'verified';
        orderStatus = 'open_presign';
        paymentVerifiedBy = actorId;
        paymentVerifiedAt = new Date();
      }

      // ایجاد رول‌های پیش‌فرض Mythic+ (الزام ۴ بوستر: ۱ تانک، ۱ هیلر، ۲ دی‌پی‌اس)
      const isMythicPlusOrder = service.serviceKey === 'mythic_plus' || panelType === 'mythic';

      const ord = await tx.order.create({
        data: {
          orderRef,
          gameSlug,
          serviceId: service.id,
          creatorId: actorId,
          creatorType: isAdv ? 'advertiser' : 'g4x',
          advertiserId: isAdv ? actorId : null,
          advertiserRank: advRank,
          rankCommissionBps,
          orderType,
          orderMode,
          quantity: runsCount,
          currency: 'USD',
          grossAmountMinor: grossCents,
          platformFeeMinor,
          advertiserFeeMinor: 0,
          boosterPoolMinor,
          paymentStatus,
          status: orderStatus,
          paymentVerifiedBy,
          paymentVerifiedAt,
          notes: assembledNotes || null,
          sourceType: 'direct',
          sourceWebsite: null,
          runs: {
            create: Array.from({ length: runsCount }, (_, i) => ({
              runNumber: i + 1,
              status: 'pending',
            })),
          },
          ...(isMythicPlusOrder
            ? {
                requiredRoles: {
                  create: [
                    { roleName: 'tank', quantity: 1 },
                    { roleName: 'healer', quantity: 1 },
                    { roleName: 'dps', quantity: 2 },
                  ],
                },
              }
            : {}),
        },
        include: {
          game: true,
          service: true,
          requiredRoles: true,
        },
      });

      // ثبت اسنپ‌شات مالی سفارشات ادورتایزر (بدون اعمال هزینه فروشنده G2G)
      if (isAdv && advRank && rankCommissionBps !== null) {
        await tx.orderFinancialSnapshot.create({
          data: {
            orderId: ord.id,
            sourcePlatform: 'advertiser',
            sourceAmountType: 'gross_sale',
            sourceAmountMinor: grossCents,
            grossSaleMinor: grossCents,
            platformOrderNetMinor: grossCents,
            externalNetBaseMinor: grossCents,
            g4xFeeRate: rankCommissionBps / 10000,
            g4xFeeMinor: platformFeeMinor,
            advertiserFeeMinor: 0,
            boosterPoolMinor,
            currency: 'USD',
            calculationStatus: 'provisional',
            policyVersion: ADVERTISER_RANK_POLICY_VERSION,
            advertiserId: actorId,
            advertiserRank: advRank,
            rankFeeBasisPoints: rankCommissionBps,
            remainingAmountMinor: boosterPoolMinor,
            snapshotTimestamp: new Date(),
          },
        });
      }

      // ثبت لاگ ممیزی در AuditLog
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'ORDER_CREATED_DISCORD_PANEL',
          entityType: 'Order',
          entityId: String(ord.id),
          newValues: JSON.stringify({
            orderId: ord.id,
            orderRef: ord.orderRef,
            category,
            panelType,
            creatorType: ord.creatorType,
            advertiserId: ord.advertiserId,
            advertiserRank: ord.advertiserRank,
            gameSlug: ord.gameSlug,
            serviceId: ord.serviceId,
            grossAmountMinor: ord.grossAmountMinor,
            paymentStatus: ord.paymentStatus,
            status: ord.status,
            runsCount,
            isMythicPlusFourBoosterEnforced: isMythicPlusOrder,
          }),
          reason: `Order created via Discord ${category.toUpperCase()} ${panelType} panel`,
          isSuccess: true,
        },
      });

      return ord;
    });

    // ۷. انتشار سفارش به کانال مربوطه در صورت تأیید مالی
    let pubResult: any = null;
    if (createdOrder.paymentStatus === 'verified') {
      try {
        const { publishOrRefreshOrderCard } = await import('../services/orderDiscordService');
        pubResult = await publishOrRefreshOrderCard(interaction.client, createdOrder.id, {
          guildId: interaction.guild?.id,
        });
      } catch (pubErr) {
        console.warn('[OrderPanelModalSubmit] Auto-publish warning:', pubErr);
      }
    }

    // ۸. پاسخ نهایی کاربر به صورت محرمانه (Ephemeral)
    if (createdOrder.paymentStatus === 'verified') {
      let content =
        `✅ **Order Created and Backed Successfully!**\n` +
        `• **Order ID:** \`#${createdOrder.id}\`\n` +
        `• **Reference:** \`${createdOrder.orderRef}\`\n` +
        `• **Game & Service:** ${game.displayName} — ${service.displayName}\n` +
        `• **Category:** ${category === 'adv' ? 'Advertiser' : 'G4X Direct'}\n` +
        `• **Mode:** \`${createdOrder.orderMode.toUpperCase()}\` (${createdOrder.orderType})\n` +
        `• **Gross Amount:** **$${(grossCents / 100).toFixed(2)}**\n` +
        (isAdv && advRank ? `• **Advertiser Rank:** ${advRank} (${((rankCommissionBps || 0) / 100).toFixed(2)}% fee)\n` : '') +
        `• **Booster Pool:** **$${(boosterPoolMinor / 100).toFixed(2)}**\n` +
        `• **Payment Status:** \`verified (wallet reserved)\`\n` +
        `• **Order Status:** \`${createdOrder.status}\`\n` +
        (panelType === 'mythic' ? `• **Squad Requirement:** 4 Boosters (1 Tank, 1 Healer, 2 DPS)\n` : '');

      if (pubResult?.success) {
        content += `\n📢 **Published to Boost Orders Board** (Message ID: \`${pubResult.messageId}\`)`;
      } else if (pubResult?.error) {
        content += `\n⚠️ **Publication Note**: ${pubResult.error}`;
      } else {
        content += `\nℹ️ *Order is funded and queued for booster pre-signing.*`;
      }

      await interaction.reply({
        content,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content:
          `✅ **Order Created Successfully (Payment Pending)**\n` +
          `• **Order ID:** \`#${createdOrder.id}\`\n` +
          `• **Reference:** \`${createdOrder.orderRef}\`\n` +
          `• **Game & Service:** ${game.displayName} — ${service.displayName}\n` +
          `• **Category:** ${category === 'adv' ? 'Advertiser' : 'G4X Direct'}\n` +
          `• **Mode:** \`${createdOrder.orderMode.toUpperCase()}\`\n` +
          `• **Gross Amount:** **$${(grossCents / 100).toFixed(2)}**\n` +
          (isAdv && advRank ? `• **Advertiser Rank:** ${advRank} (${((rankCommissionBps || 0) / 100).toFixed(2)}% fee)\n` : '') +
          `• **Booster Pool:** **$${(boosterPoolMinor / 100).toFixed(2)}**\n` +
          `• **Payment Status:** \`pending\`\n` +
          `• **Order Status:** \`payment_pending\` (Draft)\n` +
          (panelType === 'mythic' ? `• **Squad Requirement:** 4 Boosters (1 Tank, 1 Healer, 2 DPS)\n` : '') +
          `\n🔒 *Order is strictly kept unpublished until backed funding is verified by management.*`,
        ephemeral: true,
      });
    }
  } catch (err: any) {
    console.error('[OrderPanelModalSubmit] Failed to process order submission:', err);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: `❌ **Order Creation Error**: ${err?.message || err}`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `❌ **Order Creation Error**: ${err?.message || err}`,
        ephemeral: true,
      });
    }
  }
}
*/

