/**
 * admin.ts — دستورات مدیریتی سیستم (Admin/Manager/Owner)
 * 
 * دستورات:
 *  G4!admin approve <user> <game>       — تایید صلاحیت بوستر
 *  G4!admin reject  <user> <game>       — رد درخواست بوستر
 *  G4!admin wallet  <user>              — مشاهده والت کاربر
 *  G4!admin confirm-deposit <order>     — تایید واریز گلد Advertiser
 *  G4!admin set-commission <user> <rate>— تنظیم کمیسیون
 */

import { Message } from 'discord.js';

export async function handleAdminCommand(message: Message, args: string[]): Promise<void> {
  const subCommand = args[0]?.toLowerCase();

  switch (subCommand) {
    case 'approve':
      await message.reply('🚧 `admin approve` — Coming soon!');
      break;
    case 'reject':
      await message.reply('🚧 `admin reject` — Coming soon!');
      break;
    case 'wallet':
      await message.reply('🚧 `admin wallet` — Coming soon!');
      break;
    case 'confirm-deposit':
      await message.reply('🚧 `admin confirm-deposit` — Coming soon!');
      break;
    case 'set-commission':
      await message.reply('🚧 `admin set-commission` — Coming soon!');
      break;
    default:
      await message.reply('❌ Unknown admin subcommand. Use: `approve`, `reject`, `wallet`, `confirm-deposit`, `set-commission`');
  }
}
