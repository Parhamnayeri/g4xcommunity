/**
 * team.ts — دستورات مدیریت تیم‌های آماده (Premade Squads) در دیسکورد (Phase 2)
 *
 * دستورات:
 *  G4!team create <teamName> [duo|trio|full] — ایجاد تیم جدید
 *  G4!team list                              — مشاهده لیست تیم‌ها
 *  G4!team invite <teamName> <@user> [role]  — دعوت بوستر به تیم
 *  G4!team accept <teamName>                 — پذیرش دعوت تیم
 *  G4!team decline <teamName>                — رد دعوت تیم
 *  G4!team leave <teamName>                  — خروج از تیم
 *  G4!team disband <teamName>                — انحلال تیم
 *  G4!team info <teamName>                   — نمایش جزئیات تیم
 */

import {
  Message,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import {
  createTeam,
  listTeams,
  inviteMember,
  acceptInvitation,
  declineInvitation,
  leaveTeam,
  disbandTeam,
  findSquad,
  SquadType,
} from '../services/teamService';
import { ensureUserExists } from '../services/registrationService';

export async function handleTeamCommand(message: Message, args: string[]): Promise<void> {
  const subCommand = args[0]?.toLowerCase();
  const subArgs = args.slice(1);

  await ensureUserExists(message.author.id, message.author.username);

  switch (subCommand) {
    case 'create':
      await handleTeamCreate(message, subArgs);
      break;
    case 'list':
      await handleTeamList(message);
      break;
    case 'invite':
      await handleTeamInvite(message, subArgs);
      break;
    case 'accept':
      await handleTeamAccept(message, subArgs);
      break;
    case 'decline':
      await handleTeamDecline(message, subArgs);
      break;
    case 'leave':
      await handleTeamLeave(message, subArgs);
      break;
    case 'disband':
      await handleTeamDisband(message, subArgs);
      break;
    case 'info':
    case 'view':
      await handleTeamInfo(message, subArgs);
      break;
    default:
      await sendTeamHelp(message);
      break;
  }
}

/**
 * ایجاد تیم جدید
 */
async function handleTeamCreate(message: Message, args: string[]): Promise<void> {
  if (args.length === 0) {
    await message.reply(
      '❌ Please provide a team name.\n**Usage:** `G4!team create <teamName> [duo|trio|full]`\n**Example:** `G4!team create ApexMythic full`'
    );
    return;
  }

  const teamName = args[0];
  const squadType = (args[1]?.toLowerCase() || 'full') as SquadType;

  if (!['duo', 'trio', 'full'].includes(squadType)) {
    await message.reply('❌ Invalid squad type. Allowed options: `duo` (2), `trio` (3), `full` (4 for Mythic+).');
    return;
  }

  try {
    const squad = await createTeam({
      leaderId: message.author.id,
      teamName,
      squadType,
      actorId: message.author.id,
    });

    if (!squad) {
      await message.reply('❌ Failed to create team.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`⚔️ Squad Created: ${squad.teamName}`)
      .setDescription(
        `Your premade squad has been successfully registered!\n\n` +
        `• **Leader:** <@${squad.leaderId}>\n` +
        `• **Squad Type:** \`${squad.squadType.toUpperCase()}\` (Capacity: ${squad.squadType === 'full' ? 4 : squad.squadType === 'trio' ? 3 : 2})\n` +
        `• **Game:** ${squad.gameSlug}\n` +
        `• **Status:** \`${squad.status}\`\n\n` +
        `Invite eligible boosters with: \`G4!team invite ${squad.teamName} @user [role]\``
      );

    await message.reply({ embeds: [embed] });
  } catch (error: any) {
    await message.reply(`❌ **Failed to create team:** ${error.message || error}`);
  }
}

/**
 * نمایش لیست تیم‌ها
 */
async function handleTeamList(message: Message): Promise<void> {
  const squads = await listTeams(message.author.id);

  if (squads.length === 0) {
    await message.reply(
      'ℹ️ You are not a member of any active teams.\nCreate a new team with: `G4!team create <teamName>`'
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`👥 Your Premade Teams (${squads.length})`)
    .setDescription('Teams where you are the leader or a registered member:');

  for (const s of squads) {
    const isLeader = s.leaderId === message.author.id;
    const acceptedMembers = s.members.filter((m) => m.status === 'accepted');
    const pendingMembers = s.members.filter((m) => m.status === 'pending');

    const memberListStr = acceptedMembers
      .map((m) => {
        const charStr = m.character ? ` (${m.character.characterName} - ${m.character.characterClass || ''})` : '';
        return `• <@${m.userId}> [${m.memberRole || 'member'}]${charStr}`;
      })
      .join('\n');

    let value = `• Leader: <@${s.leaderId}> ${isLeader ? '*(You)*' : ''}\n` +
      `• Type: \`${s.squadType}\` | Active Members: **${acceptedMembers.length}**\n` +
      (pendingMembers.length > 0 ? `• Pending Invites: **${pendingMembers.length}**\n` : '') +
      `\n**Members:**\n${memberListStr || 'No accepted members'}`;

    embed.addFields({
      name: `🛡️ ${s.teamName} (${s.status.toUpperCase()})`,
      value,
      inline: false,
    });
  }

  embed.setFooter({
    text: 'Manage teams: G4!team invite, accept, decline, leave, disband',
  });

  await message.reply({ embeds: [embed] });
}

/**
 * دعوت عضو به تیم
 */
async function handleTeamInvite(message: Message, args: string[]): Promise<void> {
  if (args.length < 2) {
    await message.reply(
      '❌ **Usage:** `G4!team invite <teamName> <@user | userId> [role]`\n**Roles:** `tank`, `healer`, `dps`, `flex`'
    );
    return;
  }

  const teamName = args[0];
  const targetUser = message.mentions.users.first();
  const targetUserId = targetUser ? targetUser.id : args[1].replace(/[<@!>]/g, '');
  const role = args[2]?.toLowerCase() || 'dps';

  try {
    await inviteMember({
      squadIdOrName: teamName,
      leaderId: message.author.id,
      targetUserId,
      memberRole: role,
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✉️ Team Invitation Sent')
      .setDescription(
        `Successfully invited <@${targetUserId}> to join team **${teamName}** as **${role.toUpperCase()}**!\n\n` +
        `The invited booster can accept via:\n` +
        `\`G4!team accept ${teamName}\``
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`team_accept:${teamName}`)
        .setLabel('Accept Invitation')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`team_decline:${teamName}`)
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger)
    );

    await message.reply({ embeds: [embed], components: [row] });
  } catch (error: any) {
    await message.reply(`❌ **Invitation Failed:** ${error.message || error}`);
  }
}

/**
 * پذیرش دعوت تیم
 */
async function handleTeamAccept(message: Message, args: string[]): Promise<void> {
  if (args.length === 0) {
    await message.reply('❌ Please specify the team name. Example: `G4!team accept ApexMythic`');
    return;
  }

  const teamName = args.join(' ');
  try {
    await acceptInvitation(teamName, message.author.id);
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Team Invitation Accepted')
      .setDescription(`You have officially joined team **${teamName}**! Welcome to the squad.`);
    await message.reply({ embeds: [embed] });
  } catch (error: any) {
    await message.reply(`❌ **Error:** ${error.message || error}`);
  }
}

/**
 * رد دعوت تیم
 */
async function handleTeamDecline(message: Message, args: string[]): Promise<void> {
  if (args.length === 0) {
    await message.reply('❌ Please specify the team name. Example: `G4!team decline ApexMythic`');
    return;
  }

  const teamName = args.join(' ');
  try {
    await declineInvitation(teamName, message.author.id);
    await message.reply(`❌ You have declined the invitation to join team **${teamName}**.`);
  } catch (error: any) {
    await message.reply(`❌ **Error:** ${error.message || error}`);
  }
}

/**
 * خروج از تیم
 */
async function handleTeamLeave(message: Message, args: string[]): Promise<void> {
  if (args.length === 0) {
    await message.reply('❌ Please specify the team name to leave. Example: `G4!team leave ApexMythic`');
    return;
  }

  const teamName = args.join(' ');
  try {
    const result = await leaveTeam(teamName, message.author.id);
    let desc = `You have left team **${teamName}**.`;
    if (result.action === 'leader_transferred') {
      desc += `\n👑 Leadership was safely transferred to <@${result.newLeaderId}>.`;
    } else if (result.action === 'disbanded') {
      desc += `\n💥 As the last member, the team has been safely disbanded.`;
    }

    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('👋 Left Squad')
      .setDescription(desc);

    await message.reply({ embeds: [embed] });
  } catch (error: any) {
    await message.reply(`❌ **Error:** ${error.message || error}`);
  }
}

/**
 * انحلال تیم
 */
async function handleTeamDisband(message: Message, args: string[]): Promise<void> {
  if (args.length === 0) {
    await message.reply('❌ Please specify the team name to disband. Example: `G4!team disband ApexMythic`');
    return;
  }

  const teamName = args.join(' ');
  try {
    const squad = await disbandTeam(teamName, message.author.id);
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('💥 Team Disbanded')
      .setDescription(`Team **${squad.teamName}** has been disbanded.`);
    await message.reply({ embeds: [embed] });
  } catch (error: any) {
    await message.reply(`❌ **Error:** ${error.message || error}`);
  }
}

/**
 * جزئیات تیم
 */
async function handleTeamInfo(message: Message, args: string[]): Promise<void> {
  if (args.length === 0) {
    await message.reply('❌ Please specify the team name. Example: `G4!team info ApexMythic`');
    return;
  }

  const teamName = args.join(' ');
  const squad = await findSquad(teamName, 'wow_midnight');
  if (!squad) {
    await message.reply(`❌ Team **${teamName}** not found.`);
    return;
  }

  const accepted = squad.members.filter((m) => m.status === 'accepted');
  const pending = squad.members.filter((m) => m.status === 'pending');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🛡️ Squad Details: ${squad.teamName}`)
    .setDescription(
      `• **Status:** \`${squad.status.toUpperCase()}\`\n` +
      `• **Leader:** <@${squad.leaderId}>\n` +
      `• **Squad Type:** \`${squad.squadType.toUpperCase()}\`\n` +
      `• **Game:** ${squad.gameSlug}\n` +
      `• **Created:** <t:${Math.floor(squad.createdAt.getTime() / 1000)}:R>`
    );

  const acceptedList = accepted
    .map((m) => {
      const char = m.character
        ? ` — **${m.character.characterName}** (${m.character.characterClass || 'Class'} / M+ ${m.character.mythicScore ?? '-'})`
        : '';
      return `• <@${m.userId}> [Role: \`${m.memberRole || 'booster'}\`]${char}`;
    })
    .join('\n');

  embed.addFields({
    name: `👥 Active Roster (${accepted.length})`,
    value: acceptedList || 'None',
    inline: false,
  });

  if (pending.length > 0) {
    embed.addFields({
      name: `⏳ Pending Invites (${pending.length})`,
      value: pending.map((m) => `• <@${m.userId}> [Role: \`${m.memberRole || 'booster'}\`]`).join('\n'),
      inline: false,
    });
  }

  await message.reply({ embeds: [embed] });
}

/**
 * راهنمای دستورات تیم
 */
async function sendTeamHelp(message: Message): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚔️ G4X Premade Squad Commands')
    .setDescription(
      '`G4!team create <teamName> [duo|trio|full]` — Create a new premade squad\n' +
      '`G4!team list` — List your active teams\n' +
      '`G4!team info <teamName>` — View squad details and roster\n' +
      '`G4!team invite <teamName> <@user> [role]` — Invite an approved booster\n' +
      '`G4!team accept <teamName>` — Accept a pending squad invitation\n' +
      '`G4!team decline <teamName>` — Decline a squad invitation\n' +
      '`G4!team leave <teamName>` — Leave a squad (safely transfers leadership)\n' +
      '`G4!team disband <teamName>` — Disband squad (Leader only)'
    );

  await message.reply({ embeds: [embed] });
}
