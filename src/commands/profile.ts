/**
 * profile.ts — دستورات مدیریت پروفایل و کاراکترهای بوستر در دیسکورد (Phase 2)
 *
 * دستورات:
 *  G4!profile                          — نمایش پروفایل بوستر و کاراکتر اصلی
 *  G4!profile add-char [region] <realm> <name> — افزودن کاراکتر WoW
 *  G4!profile characters               — نمایش لیست تمام کاراکترهای کاربر
 *  G4!profile set-main <id | name>     — تنظیم کاراکتر اصلی
 *  G4!profile sync [id | name]         — همگام‌سازی اطلاعات با Raider.IO
 *  G4!profile remove-char <id | name>  — حذف یا غیرفعال‌سازی کاراکتر
 */

import {
  Message,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import prisma from '../database/db';
import {
  addCharacter,
  listUserCharacters,
  setMainCharacter,
  syncCharacterProfile,
  removeCharacter,
  SUPPORTED_REGIONS,
} from '../services/characterService';
import { listTeams } from '../services/teamService';
import { ensureUserExists } from '../services/registrationService';

export async function handleProfileCommand(message: Message, args: string[]): Promise<void> {
  const subCommand = args[0]?.toLowerCase();
  const subArgs = args.slice(1);

  await ensureUserExists(message.author.id, message.author.username);

  switch (subCommand) {
    case 'add-char':
      await handleAddChar(message, subArgs);
      break;
    case 'characters':
    case 'chars':
    case 'list':
      await handleListCharacters(message);
      break;
    case 'set-main':
      await handleSetMain(message, subArgs);
      break;
    case 'sync':
      await handleSync(message, subArgs);
      break;
    case 'remove-char':
    case 'del-char':
      await handleRemoveChar(message, subArgs);
      break;
    default:
      await handleViewProfile(message, args);
      break;
  }
}

/**
 * نمایش پروفایل کاربر
 */
async function handleViewProfile(message: Message, args: string[]): Promise<void> {
  const targetUser = message.mentions.users.first() || message.author;
  const userId = targetUser.id;

  const user = await prisma.user.findUnique({
    where: { discordId: userId },
    include: {
      userRoles: true,
      gameApprovals: {
        where: { status: 'approved' },
      },
    },
  });

  if (!user) {
    await message.reply('❌ User profile not found in database.');
    return;
  }

  const characters = await listUserCharacters(userId);
  const mainChar = characters.find((c) => c.isMain) || characters[0];
  const teams = await listTeams(userId);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🛡️ Booster Profile: ${user.displayName || user.username}`)
    .setThumbnail(targetUser.displayAvatarURL())
    .setDescription(
      user.userRoles.length > 0
        ? `**Roles:** ${user.userRoles.map((r) => `\`${r.roleKey}\``).join(', ')}`
        : 'No roles assigned yet.'
    );

  // وضعیت تاییدیه بوستر
  const isBoosterApproved = user.gameApprovals.some((a) => a.approvalType === 'booster');
  embed.addFields({
    name: '🌟 Qualification Status',
    value: isBoosterApproved
      ? '✅ **Approved Booster** (Eligible for orders & squads)'
      : '⚠️ **Unapproved / Pending** (Apply in registration channel)',
    inline: false,
  });

  // اطلاعات کاراکتر اصلی
  if (mainChar) {
    const mythicBreakdown = `Score: **${mainChar.mythicScore ?? 'N/A'}** (T: ${mainChar.tankScore ?? '-'} | H: ${mainChar.healerScore ?? '-'} | DPS: ${mainChar.dpsScore ?? '-'})`;
    embed.addFields({
      name: `⭐ Main Character: ${mainChar.characterName}`,
      value:
        `• **Realm & Region:** ${mainChar.realm} (${mainChar.region.toUpperCase()})\n` +
        `• **Class & Spec:** ${mainChar.characterClass || 'Unknown'} - ${mainChar.activeSpec || 'Unknown'}\n` +
        `• **Item Level:** ${mainChar.itemLevel ?? 'N/A'}\n` +
        `• **Mythic+:** ${mythicBreakdown}\n` +
        `• **Raider.IO:** [View Profile](${mainChar.raiderioUrl || '#'})\n` +
        `• **Sync Status:** \`${mainChar.syncStatus}\` (${mainChar.lastSyncedAt ? `<t:${Math.floor(mainChar.lastSyncedAt.getTime() / 1000)}:R>` : 'Never'})`,
      inline: false,
    });
  } else {
    embed.addFields({
      name: '⭐ Main Character',
      value: 'No WoW characters registered yet. Use `G4!profile add-char` to add one.',
      inline: false,
    });
  }

  // خلاصه کاراکترها و تیم‌ها
  embed.addFields(
    {
      name: '📜 Registered Characters',
      value: `Total Active: **${characters.length}** character(s). Use \`G4!profile characters\` for list.`,
      inline: true,
    },
    {
      name: '👥 Premade Teams',
      value: `Participating in **${teams.length}** squad(s). Use \`G4!team list\` for details.`,
      inline: true,
    }
  );

  embed.setFooter({
    text: 'G4X Booster Character Management • Commands: add-char, characters, set-main, sync, remove-char',
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('profile_btn_refresh')
      .setLabel('Refresh Raider.IO')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔄'),
    new ButtonBuilder()
      .setCustomId('profile_btn_list')
      .setLabel('View All Characters')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📋')
  );

  await message.reply({ embeds: [embed], components: [row] });
}

/**
 * افزودن کاراکتر
 */
async function handleAddChar(message: Message, args: string[]): Promise<void> {
  // فرمت‌ها:
  // G4!profile add-char <realm> <name> (با ریجن پیش‌فرض eu)
  // G4!profile add-char <region> <realm> <name>
  if (args.length < 2) {
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('ℹ️ How to Register a WoW Character')
      .setDescription(
        '**Usage:**\n' +
        '`G4!profile add-char <realm> <characterName>`\n' +
        '`G4!profile add-char <region> <realm> <characterName>`\n\n' +
        '**Supported Regions:** `eu` (default), `us`, `kr`, `tw`, `cn`\n\n' +
        '**Examples:**\n' +
        '• `G4!profile add-char tarren-mill Arthas`\n' +
        '• `G4!profile add-char us illidan Illidari`'
      );
    await message.reply({ embeds: [embed] });
    return;
  }

  let region = 'eu';
  let realm = '';
  let characterName = '';

  const firstArg = args[0].toLowerCase();
  if (SUPPORTED_REGIONS.includes(firstArg as any)) {
    region = firstArg;
    realm = args[1];
    characterName = args.slice(2).join(' ');
  } else {
    realm = args[0];
    characterName = args.slice(1).join(' ');
  }

  if (!realm || !characterName) {
    await message.reply('❌ Please provide both realm and character name.');
    return;
  }

  try {
    const loadingMsg = await message.reply('🔍 Verifying character with Raider.IO...');

    const character = await addCharacter({
      userId: message.author.id,
      characterName,
      realm,
      region,
      actorId: message.author.id,
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`✅ Character Registered: ${character.characterName}`)
      .setDescription(
        `Successfully registered and verified on Raider.IO!\n\n` +
        `• **Realm:** ${character.realm} (${character.region.toUpperCase()})\n` +
        `• **Class:** ${character.characterClass || 'Unknown'} (${character.activeSpec || 'N/A'})\n` +
        `• **Item Level:** ${character.itemLevel ?? 'N/A'}\n` +
        `• **Mythic+ Score:** **${character.mythicScore ?? 'N/A'}**\n` +
        `• **Status:** ${character.isMain ? '⭐ **Main Character**' : 'Alt Character'}\n` +
        `• **Raider.IO:** [Profile Link](${character.raiderioUrl})`
      );

    await loadingMsg.edit({ content: '', embeds: [embed] });
  } catch (error: any) {
    await message.reply(`❌ **Failed to add character:** ${error.message || error}`);
  }
}

/**
 * مشاهده لیست تمام کاراکترها
 */
async function handleListCharacters(message: Message): Promise<void> {
  const characters = await listUserCharacters(message.author.id);

  if (characters.length === 0) {
    await message.reply(
      '❌ You do not have any registered WoW characters.\nUse `G4!profile add-char <realm> <name>` to add your first character!'
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📜 Your WoW Characters (${characters.length})`)
    .setDescription('List of all active characters associated with your booster profile:');

  for (const c of characters) {
    const title = `${c.isMain ? '⭐ [MAIN] ' : ''}#${c.id} • **${c.characterName}** — ${c.realm} (${c.region.toUpperCase()})`;
    const details =
      `• Class: **${c.characterClass || 'Unknown'}** (${c.activeSpec || '-'})\n` +
      `• iLvl: **${c.itemLevel ?? '-'}** | M+ Score: **${c.mythicScore ?? '-'}** (T: ${c.tankScore ?? '-'} | H: ${c.healerScore ?? '-'} | D: ${c.dpsScore ?? '-'})\n` +
      `• Raider.IO: [View Profile](${c.raiderioUrl || '#'}) • Sync: \`${c.syncStatus}\``;

    embed.addFields({ name: title, value: details, inline: false });
  }

  embed.setFooter({
    text: 'To change main: G4!profile set-main <id|name> • To refresh: G4!profile sync <id|name>',
  });

  await message.reply({ embeds: [embed] });
}

/**
 * تنظیم کاراکتر اصلی
 */
async function handleSetMain(message: Message, args: string[]): Promise<void> {
  if (args.length === 0) {
    await message.reply('❌ Please specify the character ID or name. Example: `G4!profile set-main Arthas`');
    return;
  }

  const identifier = args.join(' ');
  try {
    const updated = await setMainCharacter(message.author.id, identifier, message.author.id);
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('⭐ Main Character Updated')
      .setDescription(
        `**${updated.characterName}** (${updated.realm} - ${updated.region.toUpperCase()}) is now set as your **Main Character**!`
      );
    await message.reply({ embeds: [embed] });
  } catch (error: any) {
    await message.reply(`❌ **Error:** ${error.message || error}`);
  }
}

/**
 * همگام‌سازی از Raider.IO
 */
async function handleSync(message: Message, args: string[]): Promise<void> {
  let identifier: string | number | undefined = args.join(' ');

  if (!identifier) {
    // اگر کاراکتری مشخص نشده، کاراکتر اصلی را همگام‌سازی می‌کنیم
    const chars = await listUserCharacters(message.author.id);
    const mainChar = chars.find((c) => c.isMain) || chars[0];
    if (!mainChar) {
      await message.reply('❌ No registered characters found to sync.');
      return;
    }
    identifier = mainChar.id;
  }

  try {
    const loadingMsg = await message.reply('🔄 Refreshing character profile from Raider.IO API...');
    const { result, character } = await syncCharacterProfile(identifier, message.author.id, message.author.id);

    const embed = new EmbedBuilder()
      .setColor(result === 'synced' ? 0x57f287 : 0xfee75c)
      .setTitle(`🔄 Raider.IO Sync: ${character.characterName}`)
      .setDescription(
        `• **Sync Result:** \`${result}\`\n` +
        `• **Class & Spec:** ${character.characterClass || 'Unknown'} - ${character.activeSpec || '-'}\n` +
        `• **Item Level:** ${character.itemLevel ?? '-'}\n` +
        `• **Mythic+ Score:** **${character.mythicScore ?? 'N/A'}** (T: ${character.tankScore ?? '-'} | H: ${character.healerScore ?? '-'} | D: ${character.dpsScore ?? '-'})\n` +
        `• **Raid Progression:** ${character.raidProgression || 'No recent kills'}\n` +
        `• **Last Synced:** <t:${Math.floor(Date.now() / 1000)}:R>`
      );

    await loadingMsg.edit({ content: '', embeds: [embed] });
  } catch (error: any) {
    await message.reply(`❌ **Sync Failed:** ${error.message || error}`);
  }
}

/**
 * حذف کاراکتر
 */
async function handleRemoveChar(message: Message, args: string[]): Promise<void> {
  if (args.length === 0) {
    await message.reply('❌ Please specify the character ID or name to remove. Example: `G4!profile remove-char Arthas`');
    return;
  }

  const identifier = args.join(' ');
  try {
    const removed = await removeCharacter(identifier, message.author.id, message.author.id);
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🗑️ Character Removed')
      .setDescription(
        `Character **${removed.characterName}** (${removed.realm}) has been removed/deactivated from your active roster.`
      );
    await message.reply({ embeds: [embed] });
  } catch (error: any) {
    await message.reply(`❌ **Error:** ${error.message || error}`);
  }
}
