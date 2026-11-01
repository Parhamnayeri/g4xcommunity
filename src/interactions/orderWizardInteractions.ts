/**
 * orderWizardInteractions.ts — Discord Dropdown-Based Order Creation Wizard
 *
 * Implements:
 *  - FLOW A: G4X Orders (Platform -> Game -> Service -> Mode -> Modal -> Submit)
 *  - FLOW B: Advertiser Orders (Game -> Service -> Mode -> Modal -> Submit)
 *  - Dynamic database-driven Game and Service selection.
 *  - Service-specific modals (Mythic+, Pilot, Non-Pilot) with strictly tailored inputs.
 *  - Full integration with financial calculation engine, PlatformAccounts, and Advertiser ranks.
 *  - Complete protection against cross-user forgery, session expiry, and duplicate submissions.
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
import {
  OrderWizardSession,
  createWizardSession,
  updateWizardSession,
  validateWizardSession,
  markWizardSubmitted,
  deleteWizardSession,
} from '../services/orderWizardStateService';
import { calculateOrderFinancialSnapshot } from '../services/financialCalculationEngine';
import { creditOrderSalesProceeds } from '../services/platformBalanceService';
import { publishOrRefreshOrderCard } from '../services/orderDiscordService';

/**
 * Safely reads modal text input without throwing DiscordjsTypeError.
 */
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

/**
 * Starts the order creation wizard when a user clicks Create Order on any panel.
 */
export async function startOrderWizard(
  interaction: ButtonInteraction,
  origin: 'g4x' | 'adv',
  panelType?: 'mythic' | 'non_pilot' | 'pilot' | 'wizard'
): Promise<void> {
  const actorId = interaction.user.id;

  // 1. Authorize user based on origin
  if (origin === 'g4x') {
    const auth = await authorize(actorId, Permission.ORDER_CREATE_INTERNAL);
    if (!auth.allowed) {
      await interaction.reply({
        content:
          '❌ **Permission Denied**: You do not have permission to create G4X Orders. Only authorized G4X Management and Staff may create orders here.',
        ephemeral: true,
      });
      return;
    }
  } else {
    // Advertiser flow
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
  }

  // 2. Create wizard session bound to user, guild, origin, and panel prefilter
  const session = await createWizardSession({
    userId: actorId,
    guildId: interaction.guildId,
    origin,
    prefilterPanel: panelType && panelType !== 'wizard' ? panelType : undefined,
  });

  // 3. Render initial step based on Flow
  if (origin === 'g4x') {
    // Flow A: Step 1 is Source Platform Selection (G2G, SkyCoach, Eldorado)
    const platformRow = await buildPlatformSelectRow(session.sessionId);
    const embed = new EmbedBuilder()
      .setTitle('🛡️ G4X Order Creation Wizard — Step 1: Source Platform')
      .setDescription(
        'Select the external marketplace platform or sales source for this G4X order.\n' +
        'Platform fees and account balances will be recorded authoritatively.'
      )
      .setColor(0x5865f2)
      .setFooter({ text: 'G4X Community • Step 1 of 4: Select Source Platform' })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      components: [platformRow],
      ephemeral: true,
    });
  } else {
    // Flow B: Step 1 is Game Selection
    const gameRow = await buildGameSelectRow(session.sessionId, session.prefilterPanel);
    if (!gameRow) {
      await interaction.reply({
        content: '⚠️ **No Active Games**: There are currently no active games enabled for boosting. Please contact management.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📢 Advertiser Order Creation Wizard — Step 1: Select Game')
      .setDescription(
        'Select the game title for your boost order from the list of enabled games below.'
      )
      .setColor(0xe67e22)
      .setFooter({ text: 'G4X Community • Step 1 of 3: Select Game' })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      components: [gameRow],
      ephemeral: true,
    });
  }
}

/**
 * Builds the Source Platform select menu row (G2G, SkyCoach, Eldorado).
 */
export async function buildPlatformSelectRow(
  sessionId: string
): Promise<ActionRowBuilder<StringSelectMenuBuilder>> {
  // Query active platform accounts to show real configured account names
  const accounts = await prisma.platformAccount.findMany({
    where: { isActive: true },
    orderBy: { id: 'asc' },
  });

  const g2gAcc = accounts.find((a) => a.platform.toLowerCase() === 'g2g');
  const skyAcc = accounts.find((a) => a.platform.toLowerCase() === 'skycoach');
  const eldAcc = accounts.find((a) => a.platform.toLowerCase() === 'eldorado');

  const select = new StringSelectMenuBuilder()
    .setCustomId(`ord_wiz:platform:${sessionId}`)
    .setPlaceholder('Select Source Platform (G2G, SkyCoach, Eldorado)...')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('G2G Marketplace')
        .setValue('g2g')
        .setDescription(g2gAcc ? `Active Account: ${g2gAcc.displayName}` : 'Externally sourced from G2G (8.99% fee policy)')
        .setEmoji('🟣'),
      new StringSelectMenuOptionBuilder()
        .setLabel('SkyCoach Platform')
        .setValue('skycoach')
        .setDescription(skyAcc ? `Active Account: ${skyAcc.displayName}` : 'Externally sourced from SkyCoach (10% fee policy)')
        .setEmoji('🔵'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Eldorado Platform')
        .setValue('eldorado')
        .setDescription(eldAcc ? `Active Account: ${eldAcc.displayName}` : 'Externally sourced from Eldorado (category fee policy)')
        .setEmoji('🟡')
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

/**
 * Builds the Game select menu row from active database games.
 */
export async function buildGameSelectRow(
  sessionId: string,
  prefilterPanel?: 'mythic' | 'non_pilot' | 'pilot'
): Promise<ActionRowBuilder<StringSelectMenuBuilder> | null> {
  const whereClause: any = { isActive: true };

  if (prefilterPanel === 'mythic') {
    whereClause.services = {
      some: {
        isActive: true,
        OR: [
          { serviceKey: 'mythic_plus' },
          { displayName: { contains: 'mythic' } },
        ],
      },
    };
  } else if (prefilterPanel === 'pilot') {
    whereClause.services = {
      some: {
        isActive: true,
        OR: [
          { serviceMode: 'pilot' },
          { requiresPilotApproval: true },
          { serviceMode: 'both' },
        ],
      },
    };
  } else if (prefilterPanel === 'non_pilot') {
    whereClause.services = {
      some: {
        isActive: true,
        serviceMode: { not: 'pilot' },
      },
    };
  }

  let games = await prisma.game.findMany({
    where: whereClause,
    orderBy: { sortOrder: 'asc' },
    take: 25, // Discord select menu item limit
  });

  if (games.length === 0) {
    games = await prisma.game.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      take: 25,
    });
  }

  if (games.length === 0) return null;

  const select = new StringSelectMenuBuilder()
    .setCustomId(`ord_wiz:game:${sessionId}`)
    .setPlaceholder('Choose a Game...');

  for (const g of games) {
    const desc = g.description ? g.description.slice(0, 95) : `Select to view ${g.displayName} services`;
    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(g.displayName.slice(0, 100))
        .setValue(g.slug)
        .setDescription(desc)
    );
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

/**
 * Builds the Service select menu row for a selected game from active database services.
 */
export async function buildServiceSelectRow(
  sessionId: string,
  gameSlug: string,
  prefilterPanel?: 'mythic' | 'non_pilot' | 'pilot'
): Promise<ActionRowBuilder<StringSelectMenuBuilder> | null> {
  const whereClause: any = { gameSlug, isActive: true };

  if (prefilterPanel === 'mythic') {
    whereClause.OR = [
      { serviceKey: 'mythic_plus' },
      { displayName: { contains: 'mythic' } },
    ];
  } else if (prefilterPanel === 'pilot') {
    whereClause.OR = [
      { serviceMode: 'pilot' },
      { requiresPilotApproval: true },
      { serviceMode: 'both' },
    ];
  } else if (prefilterPanel === 'non_pilot') {
    whereClause.serviceMode = { not: 'pilot' };
  }

  let services = await prisma.gameService.findMany({
    where: whereClause,
    orderBy: { sortOrder: 'asc' },
    take: 25,
  });

  if (services.length === 0) {
    services = await prisma.gameService.findMany({
      where: { gameSlug, isActive: true },
      orderBy: { sortOrder: 'asc' },
      take: 25,
    });
  }

  if (services.length === 0) return null;

  const select = new StringSelectMenuBuilder()
    .setCustomId(`ord_wiz:service:${sessionId}`)
    .setPlaceholder('Choose a Boost Service...');

  for (const s of services) {
    let modeTag = s.serviceMode === 'pilot' ? '✈️ Pilot' : '🛡️ Non-Pilot';
    if (s.requiresPilotApproval && s.serviceMode !== 'pilot') {
      modeTag = '⚖️ Pilot / Non-Pilot';
    }
    const desc = s.description ? `${modeTag} • ${s.description}`.slice(0, 95) : `${modeTag} carry service`;

    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(s.displayName.slice(0, 100))
        .setValue(String(s.id))
        .setDescription(desc)
    );
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

/**
 * Builds Mode Select Menu (Pilot vs. Non-Pilot) when a service supports both.
 */
export function buildModeSelectRow(
  sessionId: string
): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`ord_wiz:mode:${sessionId}`)
    .setPlaceholder('Select Service Execution Mode...')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('🛡️ Non-Pilot (Self-Play)')
        .setValue('non_pilot')
        .setDescription('Customer plays their own character alongside the boosters.')
        .setEmoji('🛡️'),
      new StringSelectMenuOptionBuilder()
        .setLabel('✈️ Pilot (Account-Play)')
        .setValue('pilot')
        .setDescription('An identity-verified booster logs in using a secure VPN.')
        .setEmoji('✈️')
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

/**
 * Constructs dynamic, service-specific Modal for free-text order details.
 */
export function buildWizardOrderModal(session: OrderWizardSession): ModalBuilder {
  const isG4x = session.origin === 'g4x';
  const isMythic =
    session.serviceKey === 'mythic_plus' ||
    Boolean(session.serviceName && session.serviceName.toLowerCase().includes('mythic'));
  const isPilot = session.orderMode === 'pilot';

  const modal = new ModalBuilder()
    .setCustomId(`ord_wiz:modal:${session.sessionId}`)
    .setTitle(`${session.serviceName?.slice(0, 30) || 'Order'} Details`);

  // Sourcing marketplace Site Order ID (Required for G4X external orders)
  const siteOrderIdInput = new TextInputBuilder()
    .setCustomId('site_order_id')
    .setLabel('Site Order ID (External Marketplace)')
    .setPlaceholder('e.g. G2G-123456 or 987654321')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  // Amount in USD ($) — Common to all services
  const amountInput = new TextInputBuilder()
    .setCustomId('amount_usd')
    .setLabel('Total Order Amount ($ USD)')
    .setPlaceholder('e.g. 50.00')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  if (isMythic) {
    // ─── Mythic+ Modal (Max 5 rows) ───
    const keyLevelInput = new TextInputBuilder()
      .setCustomId('key_level')
      .setLabel('Dungeon Target & Key Level')
      .setPlaceholder('e.g. +10 Ara-Kara or Any +10')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const runsInput = new TextInputBuilder()
      .setCustomId('runs_count')
      .setLabel('Number of Runs (Default: 1)')
      .setPlaceholder('1')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
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
      .setLabel('Directives / Armor Stack / Timer')
      .setPlaceholder('e.g. Beat timer (+2), Cloth armor stack preferred')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500);

    if (isG4x) {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(siteOrderIdInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(keyLevelInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(runsInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
      );
    } else {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(keyLevelInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(runsInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(customerInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
      );
    }
  } else if (isPilot) {
    // ─── Pilot Modal (Max 5 rows) ───
    const vpnInput = new TextInputBuilder()
      .setCustomId('vpn_location')
      .setLabel('Required VPN Location (Country & City)')
      .setPlaceholder('e.g. Germany / Frankfurt')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const customerInput = new TextInputBuilder()
      .setCustomId('customer_info')
      .setLabel('Platform / Account / Realm')
      .setPlaceholder('e.g. PC Battle.net - Ravencrest EU')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100);

    const notesInput = new TextInputBuilder()
      .setCustomId('notes')
      .setLabel('Platform & Pilot Directives')
      .setPlaceholder('e.g. Stream on Discord, do not chat in-game, verify IP')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500);

    if (isG4x) {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(siteOrderIdInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(vpnInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(customerInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
      );
    } else {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(vpnInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(customerInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
      );
    }
  } else {
    // ─── Standard Non-Pilot Modal (Max 5 rows) ───
    const runsInput = new TextInputBuilder()
      .setCustomId('runs_count')
      .setLabel('Runs / Matches / Quantity (Default: 1)')
      .setPlaceholder('1')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(10);

    const customerInput = new TextInputBuilder()
      .setCustomId('customer_info')
      .setLabel('Customer Tag / Character / Realm')
      .setPlaceholder('e.g. Player#1234')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100);

    const notesInput = new TextInputBuilder()
      .setCustomId('notes')
      .setLabel('Order Details & Scheduling Notes')
      .setPlaceholder('e.g. Heroic Raid Full Clear, Friday 8 PM CET')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500);

    if (isG4x) {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(siteOrderIdInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(runsInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(customerInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
      );
    } else {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(runsInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(customerInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
      );
    }
  }

  return modal;
}

/**
 * Handles all StringSelectMenu dropdown interactions of the Order Wizard.
 */
export async function handleOrderWizardSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const parts = interaction.customId.split(':');
  const step = parts[1];
  const sessionId = parts[2];

  try {
    // Validate session existence, TTL, user ownership, and double-submission
    const session = await validateWizardSession(sessionId, interaction.user, interaction.guildId);

    if (step === 'platform') {
      const selectedPlatform = interaction.values[0] as 'g2g' | 'skycoach' | 'eldorado';

      // Find active PlatformAccount for selected platform
      const account = await prisma.platformAccount.findFirst({
        where: {
          platform: selectedPlatform,
          isActive: true,
        },
        orderBy: { id: 'asc' },
      });

      await updateWizardSession(sessionId, {
        platform: selectedPlatform,
        platformAccountId: account?.id,
        platformAccountRef: account?.accountRef,
        step: 'game',
      });

      const gameRow = await buildGameSelectRow(sessionId, session.prefilterPanel);
      if (!gameRow) {
        await interaction.update({
          content: '⚠️ **No Active Games**: There are currently no active games enabled. Please contact management.',
          embeds: [],
          components: [],
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🛡️ G4X Order Creation Wizard — Step 2: Select Game')
        .setDescription(
          `• **Source Platform:** \`${selectedPlatform.toUpperCase()}\` ${account ? `(${account.displayName})` : ''}\n\n` +
          'Now select the target game from the enabled games below.'
        )
        .setColor(0x5865f2)
        .setFooter({ text: 'G4X Community • Step 2 of 4: Select Game' })
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: [gameRow],
      });
      return;
    }

    if (step === 'game') {
      const selectedGameSlug = interaction.values[0];
      const game = await prisma.game.findUnique({
        where: { slug: selectedGameSlug },
      });

      if (!game || !game.isActive) {
        await interaction.update({
          content: `❌ **Game Inactive**: Game \`${selectedGameSlug}\` is no longer active.`,
          embeds: [],
          components: [],
        });
        return;
      }

      await updateWizardSession(sessionId, {
        gameSlug: game.slug,
        gameName: game.displayName,
        step: 'service',
      });

      const serviceRow = await buildServiceSelectRow(sessionId, game.slug, session.prefilterPanel);
      if (!serviceRow) {
        await interaction.update({
          content: `⚠️ **No Active Services**: No active boost services are currently configured for **${game.displayName}**.`,
          embeds: [],
          components: [],
        });
        return;
      }

      const isAdv = session.origin === 'adv';
      const embed = new EmbedBuilder()
        .setTitle(`${isAdv ? '📢 Advertiser' : '🛡️ G4X'} Wizard — Select Boost Service`)
        .setDescription(
          `• **Selected Game:** **${game.displayName}**\n` +
          (session.platform ? `• **Source Platform:** \`${session.platform.toUpperCase()}\`\n\n` : '\n') +
          'Select the specific boost service from the dropdown below.'
        )
        .setColor(isAdv ? 0xe67e22 : 0x5865f2)
        .setFooter({ text: `G4X Community • ${isAdv ? 'Step 2 of 3: Select Service' : 'Step 3 of 4: Select Service'}` })
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: [serviceRow],
      });
      return;
    }

    if (step === 'service') {
      const serviceId = parseInt(interaction.values[0], 10);
      const service = await prisma.gameService.findUnique({
        where: { id: serviceId },
      });

      if (!service || !service.isActive) {
        await interaction.update({
          content: '❌ **Service Inactive**: Selected service is no longer active.',
          embeds: [],
          components: [],
        });
        return;
      }

      const updatedSession = await updateWizardSession(sessionId, {
        serviceId: service.id,
        serviceKey: service.serviceKey,
        serviceName: service.displayName,
        serviceMode: service.serviceMode as any,
      });

      // Determine mode from prefilter or service config
      let determinedMode: 'pilot' | 'non_pilot' | null = null;
      if (session.prefilterPanel === 'pilot') {
        determinedMode = 'pilot';
      } else if (session.prefilterPanel === 'non_pilot' || session.prefilterPanel === 'mythic') {
        determinedMode = 'non_pilot';
      }

      // Check if Mode Selection is required (e.g. service allows both pilot and non-pilot and no prefilter)
      const requiresModeChoice =
        !determinedMode &&
        (service.serviceMode === 'both' ||
          (service.serviceMode === 'non_pilot' && service.requiresPilotApproval === true));

      if (requiresModeChoice) {
        await updateWizardSession(sessionId, { step: 'mode' });
        const modeRow = buildModeSelectRow(sessionId);

        const embed = new EmbedBuilder()
          .setTitle('⚖️ Select Execution Mode (Self-Play vs. Account-Play)')
          .setDescription(
            `• **Service:** **${service.displayName}**\n\n` +
            'This service supports both execution modes. Please select:\n' +
            '• **Non-Pilot (Self-Play):** Customer plays on their own account.\n' +
            '• **Pilot (Account-Play):** Verified booster logs into the customer account via VPN.'
          )
          .setColor(0x9b59b6)
          .setFooter({ text: 'G4X Community • Execution Mode Selection' })
          .setTimestamp();

        await interaction.update({
          embeds: [embed],
          components: [modeRow],
        });
        return;
      }

      // Automatic mode: deterministic from prefilter or service configuration
      const finalMode = determinedMode || (service.serviceMode === 'pilot' ? 'pilot' : 'non_pilot');
      await updateWizardSession(sessionId, {
        orderMode: finalMode,
        step: 'modal',
      });

      const modal = buildWizardOrderModal({
        ...updatedSession,
        orderMode: finalMode,
      });

      // Open the modal directly on the interaction
      await interaction.showModal(modal);
      return;
    }

    if (step === 'mode') {
      const selectedMode = interaction.values[0] as 'pilot' | 'non_pilot';
      const updatedSession = await updateWizardSession(sessionId, {
        orderMode: selectedMode,
        step: 'modal',
      });

      const modal = buildWizardOrderModal(updatedSession);
      await interaction.showModal(modal);
      return;
    }
  } catch (err: any) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ ${err.message || 'An error occurred during wizard interaction.'}`,
        ephemeral: true,
      });
    } else {
      await interaction.followUp({
        content: `❌ ${err.message || 'An error occurred during wizard interaction.'}`,
        ephemeral: true,
      });
    }
  }
}

/**
 * Handles Button interactions within the order creation wizard (e.g. Re-open Modal, Cancel).
 */
export async function handleOrderWizardButton(
  interaction: ButtonInteraction
): Promise<void> {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const sessionId = parts[2];

  try {
    const session = await validateWizardSession(sessionId, interaction.user, interaction.guildId);

    if (action === 'open_modal') {
      const modal = buildWizardOrderModal(session);
      await interaction.showModal(modal);
      return;
    }

    if (action === 'cancel') {
      await deleteWizardSession(sessionId);
      await interaction.update({
        content: '❌ **Order Creation Cancelled**: Wizard session has been safely discarded.',
        embeds: [],
        components: [],
      });
      return;
    }
  } catch (err: any) {
    await interaction.reply({
      content: `❌ ${err.message || 'Wizard button interaction error.'}`,
      ephemeral: true,
    });
  }
}

/**
 * Handles Order Wizard Modal Submissions.
 * Reuses existing authoritative financial snapshots, wallet reservations, and order entities.
 */
export async function handleOrderWizardModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const parts = interaction.customId.split(':');
  const sessionId = parts[2];
  const actorId = interaction.user.id;

  try {
    // 1. Authoritative session validation (checks TTL, ownership, double-submit protection)
    const session = await validateWizardSession(sessionId, interaction.user, interaction.guildId);

    // 2. Mark session submitted atomically to block double-click duplicates (Requirement 13)
    await markWizardSubmitted(sessionId);

    // 3. Extract and validate common amount input
    const rawAmount = safeGetModalTextInput(interaction, 'amount_usd')?.trim();
    if (!rawAmount || !/^\d+(\.\d{1,2})?$/.test(rawAmount)) {
      await interaction.reply({
        content: '❌ **Invalid Amount**: Total order amount must be a positive number in USD (e.g. `45.00`).',
        ephemeral: true,
      });
      return;
    }

    const amountUsd = parseFloat(rawAmount);
    if (isNaN(amountUsd) || amountUsd <= 0) {
      await interaction.reply({
        content: '❌ **Invalid Amount**: Total order amount must be greater than zero.',
        ephemeral: true,
      });
      return;
    }

    const grossCents = Math.round(amountUsd * 100);
    if (!Number.isSafeInteger(grossCents) || grossCents <= 0) {
      await interaction.reply({
        content: '❌ **Invalid Amount**: Order gross amount is not a valid integer.',
        ephemeral: true,
      });
      return;
    }

    // 4. Validate domain game & service from session
    if (!session.gameSlug || !session.serviceId) {
      await interaction.reply({
        content: '❌ **Session Error**: Game or service missing from wizard session.',
        ephemeral: true,
      });
      return;
    }

    const { game, service } = await validateGameAndService(session.gameSlug, session.serviceId);

    const isMythic =
      session.serviceKey === 'mythic_plus' ||
      Boolean(session.serviceName && session.serviceName.toLowerCase().includes('mythic'));
    const isPilot = session.orderMode === 'pilot';

    let runsCount = 1;
    let assembledNotes = '';

    const isAdv = session.origin === 'adv';
    let siteOrderId: string | null = null;

    if (!isAdv) {
      siteOrderId = safeGetModalTextInput(interaction, 'site_order_id')?.trim() || null;
      if (!siteOrderId) {
        await interaction.reply({
          content: '❌ **Missing Site Order ID**: External marketplace Order ID is required for G4X orders (e.g. `G2G-123456`).',
          ephemeral: true,
        });
        return;
      }

      // Enforce uniqueness within the source platform and platform account scope
      const existingExternalOrder = await prisma.order.findFirst({
        where: {
          externalOrderId: siteOrderId,
          sourceWebsite: session.platform || undefined,
          ...(session.platformAccountId ? { platformAccountId: session.platformAccountId } : {}),
        },
      });

      if (existingExternalOrder) {
        await interaction.reply({
          content: `❌ **Duplicate Site Order ID**: An order with Site Order ID \`${siteOrderId}\` already exists on \`${(session.platform || 'platform').toUpperCase()}\` (Order #${existingExternalOrder.orderRef}).`,
          ephemeral: true,
        });
        return;
      }
    }

    // 5. Extract fields tailored exclusively to the rendered modal type (Requirement 8 & 9)
    if (isMythic) {
      const keyLevel = safeGetModalTextInput(interaction, 'key_level')?.trim();
      if (!keyLevel) {
        await interaction.reply({
          content: '❌ **Missing Key Level**: Target dungeon and key level are required for Mythic+ orders (e.g. `+10 Ara-Kara`).',
          ephemeral: true,
        });
        return;
      }

      const rawRuns = safeGetModalTextInput(interaction, 'runs_count')?.trim();
      if (!rawRuns || !/^\d+$/.test(rawRuns) || parseInt(rawRuns, 10) < 1) {
        await interaction.reply({
          content: '❌ **Invalid Runs Count**: Number of runs is required for Mythic+ and must be a positive integer (e.g. `1`, `3`).',
          ephemeral: true,
        });
        return;
      }
      runsCount = parseInt(rawRuns, 10);

      const customerInfo = safeGetModalTextInput(interaction, 'customer_info')?.trim() || '';
      const notes = safeGetModalTextInput(interaction, 'notes')?.trim() || '';

      assembledNotes = `[Mythic+ Target: ${keyLevel}]`;
      if (customerInfo) assembledNotes += ` [Customer: ${customerInfo}]`;
      if (notes) assembledNotes += ` ${notes}`;
    } else if (isPilot) {
      const vpnLocation = safeGetModalTextInput(interaction, 'vpn_location')?.trim();
      if (!vpnLocation) {
        await interaction.reply({
          content: '❌ **Missing VPN Location**: Pilot orders strictly require a required VPN Location (Country & City).',
          ephemeral: true,
        });
        return;
      }

      const customerInfo = safeGetModalTextInput(interaction, 'customer_info')?.trim() || '';
      const notes = safeGetModalTextInput(interaction, 'notes')?.trim() || '';

      assembledNotes = `[Required VPN: ${vpnLocation}]`;
      if (customerInfo) assembledNotes += ` [Customer/Platform: ${customerInfo}]`;
      if (notes) assembledNotes += ` ${notes}`;
    } else {
      // Standard Non-Pilot carry service
      const rawRuns = safeGetModalTextInput(interaction, 'runs_count')?.trim();
      if (rawRuns && /^\d+$/.test(rawRuns)) {
        runsCount = Math.max(1, parseInt(rawRuns, 10));
      }

      const customerInfo = safeGetModalTextInput(interaction, 'customer_info')?.trim() || '';
      const notes = safeGetModalTextInput(interaction, 'notes')?.trim() || '';

      assembledNotes = notes;
      if (customerInfo) assembledNotes = `[Customer: ${customerInfo}] ${assembledNotes}`.trim();
    }

    const orderRef = `ORD_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // 6. User and Commercial Rank validation for Advertisers
    let advRank: AdvertiserRank | null = null;
    let rankCommissionBps: number | null = null;
    let platformFeeMinor = 0;
    let boosterPoolMinor = grossCents;

    if (isAdv) {
      const user = await prisma.user.findUnique({ where: { discordId: actorId } });
      if (!user?.advertiserRank || !isValidAdvertiserRank(user.advertiserRank)) {
        await interaction.reply({
          content: '❌ **Unresolved Commercial Rank**: Advertiser does not have an approved commercial rank configured.',
          ephemeral: true,
        });
        return;
      }
      advRank = user.advertiserRank as AdvertiserRank;
      const calc = calculateRankCommission(grossCents, advRank);
      platformFeeMinor = calc.g4xFeeMinor;
      boosterPoolMinor = calc.remainingMinor;
      rankCommissionBps = calc.rankCommissionBasisPoints;
    }

    // 7. Atomic Database Transaction: Order creation, Wallet Check, Financial Snapshots & Platform Credits
    const createdOrder = await prisma.$transaction(async (tx) => {
      let paymentStatus = 'pending';
      let orderStatus = 'payment_pending';
      let paymentVerifiedBy: string | null = null;
      let paymentVerifiedAt: Date | null = null;

      if (!isAdv) {
        // G4X External Operational Order Policy:
        // Do NOT require manager wallet funding, do NOT reserve from creator wallet, do NOT debit ORDER_RESERVE.
        // Sets paymentStatus to 'unneeded' (supported by schema and web routes for external orders).
        // External cash remains unverified / pending settlement until reconciled.
        paymentStatus = 'unneeded';
        orderStatus = 'open_presign';
        paymentVerifiedBy = actorId;
        paymentVerifiedAt = new Date();
      } else {
        // Advertiser Order Flow: Requires backed WalletV2 funds or stays in payment_pending
        const wallet = await tx.walletV2.findUnique({ where: { userId: actorId } });
        const hasSufficientFunds = Boolean(wallet && wallet.availableCents >= grossCents);

        if (hasSufficientFunds && wallet) {
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
              description: `Authoritative funds reserved from available balance for Order #${orderRef}`,
              createdBy: actorId,
            },
          });

          paymentStatus = 'verified';
          orderStatus = 'open_presign';
          paymentVerifiedBy = actorId;
          paymentVerifiedAt = new Date();
        }
      }

      // B. Create Order Entity with explicit source platform, account & external order id
      const ord = await tx.order.create({
        data: {
          orderRef,
          gameSlug: game.slug,
          serviceId: service.id,
          creatorId: actorId,
          creatorType: isAdv ? 'advertiser' : 'g4x',
          advertiserId: isAdv ? actorId : null,
          advertiserRank: advRank,
          rankCommissionBps,
          orderType: isMythic ? 'group' : (isPilot ? 'pilot' : 'solo'),
          orderMode: session.orderMode || 'non_pilot',
          quantity: runsCount,
          currency: 'USD',
          grossAmountMinor: grossCents,
          platformFeeMinor,
          advertiserFeeMinor: isAdv ? platformFeeMinor : 0,
          boosterPoolMinor,
          paymentStatus,
          status: orderStatus,
          paymentVerifiedBy,
          paymentVerifiedAt,
          notes: assembledNotes || null,
          sourceType: isAdv ? 'direct' : 'external',
          sourceWebsite: isAdv ? null : (session.platform || null),
          platformAccountId: isAdv ? null : (session.platformAccountId || null),
          externalOrderId: siteOrderId,
          runs: {
            create: Array.from({ length: runsCount }, (_, i) => ({
              runNumber: i + 1,
              status: 'pending',
            })),
          },
          ...(isMythic
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
          platformAccount: true,
        },
      });

      // C. Financial Calculation Engine Integration
      if (!isAdv && session.platform) {
        // G4X External order financial snapshot
        const snapshot = await calculateOrderFinancialSnapshot(
          {
            orderId: ord.id,
            sourcePlatform: session.platform as any,
            sourceAmountType: 'gross_sale',
            sourceAmountMinor: grossCents,
            platformAccountId: session.platformAccountId,
            currency: 'USD',
            gameSlug: game.slug,
            actorId,
            allowProvisional: true,
          },
          tx
        );

        await tx.order.update({
          where: { id: ord.id },
          data: {
            platformFeeMinor: snapshot.platformSaleCommissionMinor,
            boosterPoolMinor: snapshot.boosterPoolMinor,
          },
        });

        // Credit platform account pending proceeds (isPendingRelease: true, NOT available received cash)
        if (session.platformAccountRef && snapshot.platformOrderNetMinor > 0) {
          await creditOrderSalesProceeds(
            {
              accountRef: session.platformAccountRef,
              orderId: ord.id,
              orderRef: ord.orderRef,
              amountMinor: snapshot.platformOrderNetMinor,
              currency: 'USD',
              isPendingRelease: true,
              actorId,
            },
            tx
          );
        }
      } else if (isAdv && advRank && rankCommissionBps !== null) {
        // Advertiser order financial snapshot
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

      // D. Record immutable AuditLog
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'ORDER_CREATED_DISCORD_WIZARD',
          entityType: 'Order',
          entityId: String(ord.id),
          newValues: JSON.stringify({
            orderId: ord.id,
            orderRef: ord.orderRef,
            origin: session.origin,
            platform: session.platform || null,
            platformAccountId: session.platformAccountId || null,
            siteOrderId: siteOrderId || null,
            gameSlug: ord.gameSlug,
            serviceId: ord.serviceId,
            serviceName: service.displayName,
            orderMode: ord.orderMode,
            grossAmountUsd: (grossCents / 100).toFixed(2),
            paymentStatus,
            status: orderStatus,
            runsCount,
          }),
          reason: `Order created via Discord Dropdown Wizard (${session.origin.toUpperCase()})`,
          isSuccess: true,
        },
      });

      return ord;
    });

    // 8. Ephemeral Confirmation in English
    const isPublishable = createdOrder.paymentStatus === 'verified' || createdOrder.paymentStatus === 'unneeded';

    let confirmEmbed: EmbedBuilder;
    if (!isAdv) {
      // G4X External Operational Order Confirmation
      confirmEmbed = new EmbedBuilder()
        .setTitle(`✅ Order #${createdOrder.orderRef} Created Successfully`)
        .setDescription(
          `G4X operational order sourced from external marketplace has been recorded and approved for publication.\n\n` +
          `• **Internal Order ID:** \`#${createdOrder.id}\`\n` +
          `• **Order Reference:** \`#${createdOrder.orderRef}\`\n` +
          `• **Source Platform:** \`${(session.platform || 'G4X').toUpperCase()}\`\n` +
          `• **Site Order ID:** \`${siteOrderId || 'N/A'}\`\n` +
          `• **Game:** **${game.displayName}**\n` +
          `• **Service:** **${service.displayName}**\n` +
          `• **Mode:** \`${createdOrder.orderMode === 'pilot' ? '✈️ Pilot' : '🛡️ Non-Pilot'}\`\n` +
          `• **Order Amount:** **$${(createdOrder.grossAmountMinor / 100).toFixed(2)} USD**\n` +
          `• **Booster Pool:** **$${(createdOrder.boosterPoolMinor / 100).toFixed(2)} USD**\n` +
          `• **External Settlement:** \`Pending\` (Awaiting platform reconciliation)\n` +
          `• **Publication Status:** \`Approved & Published for Booster Presign\``
        )
        .setColor(0x2ecc71)
        .setFooter({ text: 'G4X External Platform Order • Zero Manager Wallet Deduction' })
        .setTimestamp();
    } else {
      // Advertiser Order Confirmation
      const isFunded = createdOrder.paymentStatus === 'verified';
      confirmEmbed = new EmbedBuilder()
        .setTitle(`✅ Order #${createdOrder.orderRef} Created Successfully`)
        .setDescription(
          `Your order has been submitted to the G4X system via the Guided Dropdown Wizard.\n\n` +
          `• **Internal Order ID:** \`#${createdOrder.id}\`\n` +
          `• **Order Reference:** \`#${createdOrder.orderRef}\`\n` +
          `• **Game:** **${game.displayName}**\n` +
          `• **Service:** **${service.displayName}**\n` +
          `• **Mode:** \`${createdOrder.orderMode === 'pilot' ? '✈️ Pilot' : '🛡️ Non-Pilot'}\`\n` +
          (advRank ? `• **Advertiser Rank:** \`${advRank}\`\n` : '') +
          `• **Total Amount:** **$${(createdOrder.grossAmountMinor / 100).toFixed(2)} USD**\n` +
          `• **Booster Pool:** **$${(createdOrder.boosterPoolMinor / 100).toFixed(2)} USD**\n` +
          `• **Runs / Quantity:** \`${runsCount}\`\n` +
          `• **Payment Status:** **${isFunded ? '✅ VERIFIED (Funded via Wallet V2)' : '⏳ PENDING (Awaiting Funding)'}**\n` +
          `• **Publication Status:** \`${isFunded ? 'Published for Booster Presign' : 'Blocked — Awaiting Verified Payment'}\``
        )
        .setColor(isFunded ? 0x2ecc71 : 0xf39c12)
        .setFooter({
          text: isFunded
            ? 'Order is verified and eligible for publication'
            : 'Payment pending — backed funds or receipt verification required',
        })
        .setTimestamp();
    }

    await interaction.reply({
      embeds: [confirmEmbed],
      ephemeral: true,
    });

    // 9. If publishable (verified or unneeded for external orders), automatically publish card
    if (isPublishable) {
      publishOrRefreshOrderCard(interaction.client, createdOrder.id, {
        guildId: interaction.guild?.id,
      }).catch((err) => {
        console.error('[OrderWizard] Failed to auto-publish order card:', err);
      });
    }

    // 10. Clean up session
    await deleteWizardSession(sessionId);
  } catch (err: any) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ **Order Creation Failed**: ${err.message || 'An unexpected error occurred.'}`,
        ephemeral: true,
      });
    } else {
      await interaction.followUp({
        content: `❌ **Order Creation Failed**: ${err.message || 'An unexpected error occurred.'}`,
        ephemeral: true,
      });
    }
  }
}
