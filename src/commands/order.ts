/**
 * order.ts — دستورات مدیریت سفارش‌های بوستینگ
 * 
 * دستورات:
 *  G4!order adv-create    — ایجاد سفارش جدید توسط Advertiser
 *  G4!order list          — لیست سفارشات باز
 *  G4!order assign        — تخصیص بوستر به سفارش (Admin)
 *  G4!order complete      — اتمام ران و ارسال به اسکرو (Admin)
 *  G4!order cancel        — لغو سفارش (Admin)
 */

import { Message } from 'discord.js';

export async function handleOrderCommand(message: Message, args: string[]): Promise<void> {
  const subCommand = args[0]?.toLowerCase();

  switch (subCommand) {
    case 'adv-create':
      await message.reply('🚧 `order adv-create` — Coming soon!');
      break;
    case 'list':
      await message.reply('🚧 `order list` — Coming soon!');
      break;
    case 'assign':
      await message.reply('🚧 `order assign` — Coming soon!');
      break;
    case 'complete':
      await message.reply('🚧 `order complete` — Coming soon!');
      break;
    case 'cancel':
      await message.reply('🚧 `order cancel` — Coming soon!');
      break;
    default:
      await message.reply('❌ Unknown order subcommand. Use: `adv-create`, `list`, `assign`, `complete`, `cancel`');
  }
}
