/**
 * index.ts — نقطه ورود اصلی ربات G4X و وب‌سرور Express
 * 
 * ترتیب راه‌اندازی:
 *  1. بارگذاری متغیرهای محیطی (.env)
 *  2. مقداردهی اولیه و مایگریشن دیتابیس
 *  3. راه‌اندازی کرانجاب اسکرو ۷۲ ساعته
 *  4. راه‌اندازی وب‌سرور Express
 *  5. لاگین ربات به دیسکورد
 */

import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';

import { initializeDatabase } from './database/schema';
import { startEscrowCron }    from './services/escrowCron';
import { startWebServer }     from './web/server';
import { handleSetupCommand } from './commands/setup';
import { handleButtonInteraction } from './interactions/buttons';
import { handleModalSubmit } from './interactions/modals';
import { handleRegistrationSelectMenu } from './interactions/registrationInteractions';

// ─── ایجاد کلاینت دیسکورد ────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ─── رویداد آماده بودن ربات ───────────────────────────────────────────────
client.once('ready', (c) => {
  console.log(`[Bot] ✅ Logged in as ${c.user.tag}`);
  console.log(`[Bot] Serving ${c.guilds.cache.size} guild(s)`);
});

// ─── مدیریت پیام‌ها (دستورات با پیشوند G4!) ──────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('G4!')) return;

  const rawArgs = message.content.slice(3).trim().split(/\s+/);
  const command = rawArgs.shift()?.toLowerCase();

  try {
    if (command === 'setup') {
      await handleSetupCommand(message, rawArgs);
    }
  } catch (error) {
    console.error(`[Command] Error executing ${command}:`, error);
  }
});

// ─── مدیریت تعاملات (دکمه‌ها، مودال‌ها، منوها) ───────────────────────────
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleRegistrationSelectMenu(interaction);
    }
  } catch (error) {
    console.error(`[Interaction] Error handling interaction:`, error);
  }
});

// ─── مدیریت خطاهای کنترل‌نشده ────────────────────────────────────────────
process.on('unhandledRejection', (error) => {
  console.error('[Process] Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('[Process] Uncaught exception:', error);
  process.exit(1);
});

// ─── توالی راه‌اندازی ────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  try {
    // ۱. مقداردهی دیتابیس (async)
    await initializeDatabase();

    // ۲. شروع کرانجاب اسکرو
    startEscrowCron();

    // ۳. راه‌اندازی وب‌سرور
    const port = Number(process.env.PORT ?? 3000);
    startWebServer(port);

    // ۴. لاگین به دیسکورد
    const token = process.env.DISCORD_TOKEN;
    if (!token) throw new Error('DISCORD_TOKEN is not set in .env');
    await client.login(token);

  } catch (error) {
    console.error('[Bootstrap] ❌ Fatal error during startup:', error);
    process.exit(1);
  }
}

bootstrap();

export { client };
