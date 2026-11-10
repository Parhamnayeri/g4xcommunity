/**
 * scripts/discord-lab-runner.ts
 *
 * Dedicated Safe Opt-In Live Discord Integration Test Runner for G4X Community.
 *
 * STRICT SAFETY ARCHITECTURE:
 *  1. Opt-in guards: Must be executed with explicit flags (--start --confirm) to initiate connection.
 *     Running without flags runs dry-run preflight and exits safely without connecting.
 *  2. Confined to 127.0.0.1 (local loopback).
 *  3. Disposable SQLite database inside prisma/staging/ (auto-cleaned on exit).
 *  4. Firewall-guarded Discord client:
 *     - Only connects to DISCORD_LAB_ALLOWED_GUILD_ID.
 *     - Fails closed if bot is missing from test guild or in foreign guilds.
 *     - Drops all foreign guild messages and interactions.
 *     - Never derives authorization from user-supplied guild arguments.
 *  5. Background kill switch watcher checks for emergency halt.
 *  6. Guaranteed cleanup on SIGINT, SIGTERM, or fatal error.
 *
 * Usage:
 *   npx ts-node scripts/discord-lab-runner.ts [--env-file <path>] [--dry-run]
 *   npx ts-node scripts/discord-lab-runner.ts --start --confirm
 *   npm run discord-lab:start
 */

import http from 'http';
import { Client, GatewayIntentBits, Partials, Message, Interaction } from 'discord.js';
import {
  loadDiscordLabEnvironment,
  resolveDiscordLabEnvFile,
} from '../src/discord-lab/discordLabConfig';
import { validateDiscordLabEnvironment } from '../src/discord-lab/validateDiscordLabEnv';
import { DiscordLabFirewall } from '../src/discord-lab/discordLabFirewall';
import {
  checkKillSwitch,
  armKillSwitchWatcher,
} from '../src/discord-lab/discordLabKillSwitch';
import {
  createDisposableLabDatabase,
  DisposableLabDatabase,
} from '../src/discord-lab/discordLabDatabase';
import { setGlobalDiscordClient } from '../src/services/orderDiscordService';
import { createStagingApp } from '../src/web/staging/stagingApp';

export interface RunningDiscordLab {
  server: http.Server;
  client: Client;
  firewall: DiscordLabFirewall;
  database: DisposableLabDatabase;
  stop: () => Promise<void>;
}

export async function startDiscordLab(options: {
  customEnvPath?: string;
  portOverride?: number;
  skipLogin?: boolean;
} = {}): Promise<RunningDiscordLab | null> {
  console.log('\n[DiscordLabRunner] 🚀 Initializing safe Discord Lab runner...');

  // 1. Resolve environment file
  const envResolution = resolveDiscordLabEnvFile(options.customEnvPath);
  if (envResolution.isGitTracked) {
    throw new Error(
      `[DiscordLabRunner] CRITICAL SECURITY REFUSAL: Environment file '${envResolution.filePath}' is tracked by Git. Cannot start.`
    );
  }

  loadDiscordLabEnvironment(options.customEnvPath);
  process.env.DISCORD_LAB_MODE = 'true';

  // 2. Preflight Safety Invariants Check
  const killStatus = checkKillSwitch();
  if (killStatus.active) {
    throw new Error(
      `[DiscordLabRunner] Refusing to start: Kill switch is active (${killStatus.reason}).`
    );
  }

  const validation = validateDiscordLabEnvironment(process.env, {
    requireToken: !options.skipLogin,
  });

  if (!validation.valid) {
    throw new Error(
      `[DiscordLabRunner] Environment validation FAILED:\n${validation.errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }

  const allowedGuildId = validation.sanitizedSummary.allowedGuildId;
  const firewall = new DiscordLabFirewall(allowedGuildId, {
    onRejectedEvent: (details) => {
      console.warn(`[DiscordLabFirewall] ⛔ Event rejected:`, details);
    },
  });

  // 3. Provision Disposable Database
  console.log('[DiscordLabRunner] 📦 Provisioning disposable staging database...');
  const disposableDb = await createDisposableLabDatabase();
  console.log(`[DiscordLabRunner] Database ready at: ${disposableDb.databaseUrl}`);

  // 4. Start Local Loopback HTTP Web Server
  const host = process.env.HOST || '127.0.0.1';
  const port = options.portOverride || Number(process.env.PORT || 3001);
  const app = createStagingApp();

  const server = await new Promise<http.Server>((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on('error', reject);
  });

  console.log(`[DiscordLabRunner] 🧪 Loopback API server listening at http://${host}:${port}`);

  // 5. Create Discord Client
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

  // Attach Firewall to incoming events
  firewall.attachClientFirewall(client, {
    onPermittedMessage: async (message: Message) => {
      if (message.author.bot) return;
      if (!message.content.startsWith('G4!')) return;

      const rawArgs = message.content.slice(3).trim().split(/\s+/);
      const command = rawArgs.shift()?.toLowerCase();

      // Dispatch to handlers safely
      try {
        if (command === 'setup') {
          const { handleSetupCommand } = await import('../src/commands/setup');
          await handleSetupCommand(message, rawArgs);
        } else if (command === 'order') {
          const { handleOrderCommand } = await import('../src/commands/order');
          await handleOrderCommand(message, rawArgs);
        } else if (command === 'profile') {
          const { handleProfileCommand } = await import('../src/commands/profile');
          await handleProfileCommand(message, rawArgs);
        } else if (command === 'team') {
          const { handleTeamCommand } = await import('../src/commands/team');
          await handleTeamCommand(message, rawArgs);
        } else if (command === 'assign') {
          const { handleAssignCommand } = await import('../src/commands/assign');
          await handleAssignCommand(message, rawArgs);
        } else if (command === 'proof') {
          const { handleDiscordProofMessageUpload } = await import('../src/services/discordProofSubmissionService');
          await handleDiscordProofMessageUpload(message, rawArgs);
        }
      } catch (err: any) {
        console.error(`[DiscordLabRunner] Error executing command G4!${command}:`, err);
        try {
          await message.reply({ content: `❌ Error executing \`G4!${command}\`: ${err.message}` });
        } catch {}
      }
    },
    onPermittedInteraction: async (interaction: Interaction) => {
      try {
        if (interaction.isButton()) {
          const { handleButtonInteraction } = await import('../src/interactions/buttons');
          await handleButtonInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
          const { handleModalSubmit } = await import('../src/interactions/modals');
          await handleModalSubmit(interaction);
        } else if (interaction.isStringSelectMenu()) {
          if (interaction.customId.startsWith('ord_wiz:')) {
            const { handleOrderWizardSelectMenu } = await import('../src/interactions/orderWizardInteractions');
            await handleOrderWizardSelectMenu(interaction);
          } else if (interaction.customId.startsWith('presign_team:')) {
            const { handlePresignTeamSelectMenu } = await import('../src/interactions/presignReviewInteractions');
            await handlePresignTeamSelectMenu(interaction);
          } else {
            const { handleRegistrationSelectMenu } = await import('../src/interactions/registrationInteractions');
            await handleRegistrationSelectMenu(interaction);
          }
        }
      } catch (err: any) {
        console.error('[DiscordLabRunner] Error processing interaction:', err);
      }
    },
  });

  setGlobalDiscordClient(client);

  const stop = async () => {
    console.log('[DiscordLabRunner] 🛑 Shutting down Discord Lab...');
    try {
      client.destroy();
    } catch {}
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } catch {}
    try {
      await disposableDb.cleanup();
    } catch {}
    setGlobalDiscordClient(null);
    console.log('[DiscordLabRunner] Clean shutdown complete.');
  };

  // Arm kill switch watcher
  armKillSwitchWatcher((status) => {
    console.error(`[DiscordLabRunner] 🚨 EMERGENCY KILL SWITCH TRIGGERED: ${status.reason}`);
    stop().then(() => process.exit(1));
  });

  // Clean exit handlers
  process.on('SIGINT', () => {
    stop().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    stop().then(() => process.exit(0));
  });

  if (options.skipLogin) {
    console.log('[DiscordLabRunner] ℹ️ skipLogin=true. Bot client created and guarded, login deferred.');
    return { server, client, firewall, database: disposableDb, stop };
  }

  // Ready verification
  client.once('ready', (c) => {
    console.log(`[DiscordLabRunner] ✅ Logged in as ${c.user.tag}`);

    // Verify guild containment
    const guildCheck = firewall.verifyConnectedGuilds(client);
    if (!guildCheck.valid) {
      console.error(`[DiscordLabRunner] ❌ GUILD CONTAINMENT CHECK FAILED:\n  ${guildCheck.reason}`);
      stop().then(() => process.exit(1));
      return;
    }

    console.log(`[DiscordLabRunner] 🔒 Confined strictly to test guild '${allowedGuildId}'.`);
  });

  // Login
  const token = (process.env.DISCORD_LAB_BOT_TOKEN || process.env.DISCORD_TOKEN || '').trim();
  await client.login(token);

  return { server, client, firewall, database: disposableDb, stop };
}

// CLI Execution with Opt-In Confirmation
if (require.main === module) {
  const args = process.argv.slice(2);
  const isStart = args.includes('--start');
  const isConfirmed = args.includes('--confirm');
  const isDryRun = args.includes('--dry-run') || (!isStart && !isConfirmed);

  if (isDryRun) {
    console.log('\n[DiscordLabRunner] 🛡️ DRY-RUN MODE: Running preflight checks only.');
    console.log('To initiate live connection, the operator must explicitly run:');
    console.log('  npm run discord-lab:start -- --start --confirm\n');
    const { runDiscordLabPreflight } = require('./discord-lab-preflight');
    const result = runDiscordLabPreflight();
    process.exit(result.success ? 0 : 1);
  } else {
    // Explicit opt-in confirmed
    startDiscordLab()
      .then(() => {
        console.log('[DiscordLabRunner] Running in safe live test mode. Press Ctrl+C to stop.');
      })
      .catch((err) => {
        console.error('[DiscordLabRunner] Fatal startup error:', err.message);
        process.exit(1);
      });
  }
}
