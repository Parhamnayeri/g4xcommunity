/**
 * profile.ts — دستورات مدیریت پروفایل بوستر
 * 
 * دستورات:
 *  G4!profile             — نمایش پروفایل خود کاربر
 *  G4!profile add-char    — افزودن کاراکتر WoW
 *  G4!profile sync        — همگام‌سازی اطلاعات Raider.IO
 *  G4!profile set-main    — تنظیم کاراکتر اصلی
 */

import { Message } from 'discord.js';

export async function handleProfileCommand(message: Message, args: string[]): Promise<void> {
  const subCommand = args[0]?.toLowerCase();

  switch (subCommand) {
    case 'add-char':
      // TODO: پیاده‌سازی افزودن کاراکتر
      await message.reply('🚧 `add-char` — Coming soon!');
      break;
    case 'sync':
      // TODO: پیاده‌سازی همگام‌سازی Raider.IO
      await message.reply('🚧 `sync` — Coming soon!');
      break;
    case 'set-main':
      // TODO: پیاده‌سازی تنظیم کاراکتر اصلی
      await message.reply('🚧 `set-main` — Coming soon!');
      break;
    default:
      // TODO: نمایش پروفایل کامل با Embed
      await message.reply('🚧 `profile` — Coming soon!');
  }
}
