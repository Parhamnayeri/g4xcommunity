/**
 * scripts/beta-provision.ts
 *
 * Dedicated Discord Channel, Rules & Registration Panels Provisioning Script
 * for G4X Operational Closed Beta (v0.001).
 *
 * Automatically provisions, verifies and synchronizes:
 *  1. START HERE Category
 *     - #rules-and-policies (with official published community rules and policies)
 *     - #become-booster (with interactive Booster application panel)
 *     - #become-adv (with interactive Advertiser application panel)
 *     - #become-pilot-booster (with interactive Pilot Booster application panel)
 *     - #become-exchanger (with interactive Exchanger application panel)
 *  2. APPLICATION MANAGEMENT Category
 *     - #app-boosters (Staff review channel)
 *     - #app-adv (Staff review channel)
 *     - #app-pilots (Staff review channel)
 *     - #app-exchangers (Staff review channel)
 *  3. ORDERS & SERVICES Categories and channels
 *  4. Persists all mappings in discord_channel_mappings
 *
 * Usage:
 *   npx ts-node scripts/beta-provision.ts
 *   npm run beta:provision
 */

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { loadBetaEnvFile, validateBetaEnvironment } from '../src/beta/validateBetaEnv';
import { initializeBetaDatabase } from '../src/beta/betaDatabase';
import { provisionAllChannels } from '../src/services/discordProvisioningService';
import { setGlobalPrismaClient } from '../src/database/db';
import { setGlobalDiscordClient } from '../src/services/orderDiscordService';

async function main() {
  console.log('\n============================================================');
  console.log('⚡ G4X Beta — Discord Channels, Rules & Panels Provisioning');
  console.log('============================================================\n');

  const { loaded, filePath } = loadBetaEnvFile();
  console.log(`[Provision] Config File: ${loaded ? filePath : 'Default / process.env'}`);

  const validation = validateBetaEnvironment(process.env, {
    requireDiscordBotConfig: true,
    strictBotTokenRequired: true,
  });

  if (!validation.valid || !validation.botToken || !validation.allowedGuildId) {
    console.error('❌ Environment validation failed for Discord provisioning:');
    for (const err of validation.errors) {
      console.error(`   - ${err}`);
    }
    process.exit(1);
  }

  console.log(`[Provision] Target DB:    ${validation.resolvedDatabasePath}`);
  console.log(`[Provision] Target Guild: ${validation.allowedGuildId}`);

  // Initialize DB
  const dbHandle = await initializeBetaDatabase(validation.resolvedDatabaseUrl!, { silent: true });
  setGlobalPrismaClient(dbHandle.prismaClient);

  // Initialize Discord Client
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  console.log('[Provision] Connecting Discord bot client...');
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Discord connection timed out')), 25000);
    client.once('ready', () => {
      clearTimeout(timeout);
      resolve();
    });
    client.login(validation.botToken!).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  setGlobalDiscordClient(client);
  console.log(`[Provision] Logged in as: ${client.user?.tag} (${client.user?.id})`);

  const guild = client.guilds.cache.get(validation.allowedGuildId) ||
    await client.guilds.fetch(validation.allowedGuildId).catch(() => null);

  if (!guild) {
    console.error(`❌ Could not fetch target guild (${validation.allowedGuildId}). Ensure the bot is invited.`);
    await client.destroy();
    await dbHandle.disconnect();
    process.exit(1);
  }

  console.log(`[Provision] Guild connected: ${guild.name} (${guild.id})`);
  console.log('[Provision] Deploying categories, channels, rules, and registration panels...');

  const actorId = process.env.OWNER_DISCORD_ID || '387583875066626069';

  const result = await provisionAllChannels({
    guild,
    actorId,
    client,
  });

  console.log('\n============================================================');
  console.log('📊 PROVISIONING REPORT');
  console.log('============================================================');
  console.log(`  - Channels Created:  ${result.created}`);
  console.log(`  - Channels Reused:   ${result.reused}`);
  console.log(`  - Channels Mapped:   ${result.synced}`);
  console.log(`  - Total Configured:  ${result.totalConfigured}`);

  if (result.warnings.length > 0) {
    console.log('\n⚠️ Warnings & Notes:');
    for (const w of result.warnings) {
      console.log(`  - ${w}`);
    }
  }

  // Display key mappings
  const mappings = await dbHandle.prismaClient.discordChannelMapping.findMany({
    where: { guildId: validation.allowedGuildId, isActive: true },
    select: { channelKey: true, channelName: true, discordChannelId: true, syncStatus: true },
  });

  console.log('\n📌 Active Mapped Channels:');
  for (const m of mappings) {
    console.log(`  • [${m.channelKey}] -> #${m.channelName} (${m.discordChannelId}) [${m.syncStatus}]`);
  }

  console.log('\n[Provision] Gracefully disconnecting...');
  await client.destroy();
  await dbHandle.disconnect();

  console.log('\n============================================================');
  console.log('✅ ALL DISCORD CHANNELS, RULES & PANELS PROVISIONED SUCCESSFULLY');
  console.log('============================================================\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Provision] Fatal error during provisioning:', err?.message || err);
    process.exit(1);
  });
}
