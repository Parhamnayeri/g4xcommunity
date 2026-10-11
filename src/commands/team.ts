/**
 * team.ts — دستورات مدیریت تیم‌های آماده (Premade Squads)
 * 
 * دستورات:
 *  G4!team create     — ایجاد تیم جدید
 *  G4!team invite     — دعوت عضو به تیم
 *  G4!team leave      — خروج از تیم
 *  G4!team disband    — انحلال تیم (Leader)
 *  G4!team info       — نمایش اطلاعات تیم
 */

import { Message } from 'discord.js';

export async function handleTeamCommand(message: Message, args: string[]): Promise<void> {
  const subCommand = args[0]?.toLowerCase();

  switch (subCommand) {
    case 'create':
      await message.reply('🚧 `team create` — Coming soon!');
      break;
    case 'invite':
      await message.reply('🚧 `team invite` — Coming soon!');
      break;
    case 'leave':
      await message.reply('🚧 `team leave` — Coming soon!');
      break;
    case 'disband':
      await message.reply('🚧 `team disband` — Coming soon!');
      break;
    case 'info':
      await message.reply('🚧 `team info` — Coming soon!');
      break;
    default:
      await message.reply('❌ Unknown team subcommand. Use: `create`, `invite`, `leave`, `disband`, `info`');
  }
}
