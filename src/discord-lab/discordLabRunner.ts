/**
 * src/discord-lab/discordLabRunner.ts
 *
 * Dedicated Safe Opt-In Live Discord Integration Test Runner for G4X Community.
 *
 * STRICT SAFETY ARCHITECTURE:
 *  1. Explicit Operator Approval:
 *     - Requires options.authorizedOperatorApproval === true.
 *  2. Privileged Intents Minimized:
 *     - GuildMembers intent is REMOVED to avoid unverified gateway permissions crashes.
 *     - Only standard intents + MessageContent (privileged, required for prefix commands) are used.
 *  3. Comprehensive Failure-Safe Lifecycle:
 *     - Failure during any step (db provisioning, server bind, client init, login, verification)
 *       triggers clean, non-duplicate teardown of all allocated resources.
 *     - Kill switch watcher is stopped cleanly; no dangling intervals.
 *  4. Guild Verification & Event Firewall:
 *     - Startup state machine: BLOCKED -> VERIFYING -> VERIFIED -> ACTIVE.
 *     - Client verified for identity and 100% guild containment (guilds.cache.size === 1) before activation.
 *     - All incoming events during BLOCKED state are rejected.
 *  5. Local loopback binding only (127.0.0.1:3001).
 */

import http from 'http';
import { Client, GatewayIntentBits, Partials, Message, Interaction } from 'discord.js';
import {
  loadDiscordLabEnvironment,
  resolveDiscordLabEnvFile,
} from './discordLabConfig';
import { validateDiscordLabEnvironment } from './validateDiscordLabEnv';
import {
  DiscordLabFirewall,
  DiscordLabSecurityError,
  DiscordLabState,
} from './discordLabFirewall';
import {
  checkKillSwitch,
  armKillSwitchWatcher,
} from './discordLabKillSwitch';
import {
  createDisposableLabDatabase,
  DisposableLabDatabase,
} from './discordLabDatabase';
import { setGlobalPrismaClient } from '../database/db';
import { setGlobalDiscordClient } from '../services/orderDiscordService';
import { createStagingApp } from '../web/staging/stagingApp';

export interface RunningDiscordLab {
  server: http.Server;
  client: Client;
  firewall: DiscordLabFirewall;
  database: DisposableLabDatabase;
  stop: () => Promise<void>;
}

export interface DiscordLabStartOptions {
  customEnvPath?: string;
  portOverride?: number;
  skipLogin?: boolean;
  authorizedOperatorApproval?: boolean; // MANDATORY for live connection
  loginTimeoutMs?: number;
}

export class DiscordLabLifecycleManager {
  private disposableDb: DisposableLabDatabase | null = null;
  private httpServer: http.Server | null = null;
  private discordClient: Client | null = null;
  private stopWatcher: (() => void) | null = null;
  private isShuttingDown: boolean = false;
  private shutdownCompleted: boolean = false;

  public async start(options: DiscordLabStartOptions = {}): Promise<RunningDiscordLab> {
    console.log('\n[DiscordLabRunner] 🚀 Initializing safe Discord Lab runner...');

    // 1. Check explicit approval if login is requested
    if (!options.skipLogin && !options.authorizedOperatorApproval) {
      throw new DiscordLabSecurityError(
        'AUTHORIZATION_REFUSAL: startDiscordLab requires explicit operator approval (options.authorizedOperatorApproval: true).'
      );
    }

    try {
      // 2. Resolve environment file
      const envResolution = resolveDiscordLabEnvFile(options.customEnvPath);
      if (envResolution.isGitTracked) {
        throw new DiscordLabSecurityError(
          `Environment file '${envResolution.filePath}' is tracked by Git. Secrets must never be stored in tracked files.`
        );
      }

      // For live startup (skipLogin is false), operator-managed external file MUST exist
      if (!options.skipLogin) {
        if (!envResolution.exists || !envResolution.filePath) {
          throw new DiscordLabSecurityError(
            `Refusing live Discord startup: operator-managed external environment file is missing. Looked in: ${envResolution.error || 'default locations'}. Live credentials must never be loaded from unintended fallback environments.`
          );
        }
      }

      loadDiscordLabEnvironment(options.customEnvPath);
      process.env.DISCORD_LAB_MODE = 'true';

      // 3. Preflight Safety Invariants Check
      const killStatus = checkKillSwitch();
      if (killStatus.active) {
        throw new DiscordLabSecurityError(
          `Refusing to start: Emergency kill switch is active (${killStatus.reason}).`
        );
      }

      const validation = validateDiscordLabEnvironment(process.env, {
        requireToken: !options.skipLogin,
      });

      if (!validation.valid) {
        throw new DiscordLabSecurityError(
          `Environment validation FAILED:\n${validation.errors.map((e) => `  - ${e}`).join('\n')}`
        );
      }

      const allowedGuildId = validation.sanitizedSummary.allowedGuildId;
      const firewall = new DiscordLabFirewall(allowedGuildId, {
        expectedApplicationId: validation.sanitizedSummary.applicationId ?? undefined,
        onRejectedEvent: (details) => {
          console.warn(`[DiscordLabFirewall] ⛔ Event rejected:`, details);
        },
      });

      // 4. Provision Disposable Database
      console.log('[DiscordLabRunner] 📦 Provisioning disposable staging database...');
      this.disposableDb = await createDisposableLabDatabase();
      const isolationProof = await this.disposableDb.verifyIsolation();
      if (!isolationProof.isolated) {
        throw new DiscordLabSecurityError('Disposable database failed isolation verification!');
      }
      setGlobalPrismaClient(this.disposableDb.prismaClient);
      console.log(`[DiscordLabRunner] ✅ Database isolated & verified at: ${this.disposableDb.databaseUrl}`);

      // 5. Start Local Loopback HTTP Web Server
      const host = process.env.HOST || '127.0.0.1';
      const port = options.portOverride || Number(process.env.PORT || 3001);
      const app = createStagingApp();

      this.httpServer = await new Promise<http.Server>((resolve, reject) => {
        const s = app.listen(port, host, () => resolve(s));
        s.on('error', reject);
      });

      console.log(`[DiscordLabRunner] 🧪 Loopback API server listening at http://${host}:${port}`);

      // 6. Create Discord Client with Privileged Intents Minimized
      this.discordClient = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.GuildMessageReactions,
        ],
        partials: [Partials.Message, Partials.Channel, Partials.Reaction],
      });

      // Intercept all outgoing REST requests to enforce fail-closed containment
      firewall.attachRestFirewall(this.discordClient);

      // Attach Firewall to incoming events (starts in BLOCKED state)
      firewall.attachClientFirewall(this.discordClient, {
        onPermittedMessage: async (message: Message) => {
          if (message.author.bot) return;
          if (!message.content.startsWith('G4!')) return;

          const rawArgs = message.content.slice(3).trim().split(/\s+/);
          const command = rawArgs.shift()?.toLowerCase();

          try {
            if (command === 'setup') {
              const { handleSetupCommand } = await import('../commands/setup');
              await handleSetupCommand(message, rawArgs);
            } else if (command === 'order') {
              const { handleOrderCommand } = await import('../commands/order');
              await handleOrderCommand(message, rawArgs);
            } else if (command === 'profile') {
              const { handleProfileCommand } = await import('../commands/profile');
              await handleProfileCommand(message, rawArgs);
            } else if (command === 'team') {
              const { handleTeamCommand } = await import('../commands/team');
              await handleTeamCommand(message, rawArgs);
            } else if (command === 'assign') {
              const { handleAssignCommand } = await import('../commands/assign');
              await handleAssignCommand(message, rawArgs);
            } else if (command === 'proof') {
              const { handleDiscordProofMessageUpload } = await import('../services/discordProofSubmissionService');
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
              const { handleButtonInteraction } = await import('../interactions/buttons');
              await handleButtonInteraction(interaction);
            } else if (interaction.isModalSubmit()) {
              const { handleModalSubmit } = await import('../interactions/modals');
              await handleModalSubmit(interaction);
            } else if (interaction.isStringSelectMenu()) {
              if (interaction.customId.startsWith('ord_wiz:')) {
                const { handleOrderWizardSelectMenu } = await import('../interactions/orderWizardInteractions');
                await handleOrderWizardSelectMenu(interaction);
              } else if (interaction.customId.startsWith('presign_team:')) {
                const { handlePresignTeamSelectMenu } = await import('../interactions/presignReviewInteractions');
                await handlePresignTeamSelectMenu(interaction);
              } else {
                const { handleRegistrationSelectMenu } = await import('../interactions/registrationInteractions');
                await handleRegistrationSelectMenu(interaction);
              }
            }
          } catch (err: any) {
            console.error('[DiscordLabRunner] Error processing interaction:', err);
          }
        },
      });

      setGlobalDiscordClient(this.discordClient);

      // 7. Arm background kill switch watcher
      this.stopWatcher = armKillSwitchWatcher((status) => {
        console.error(`[DiscordLabRunner] 🚨 EMERGENCY KILL SWITCH TRIGGERED: ${status.reason}`);
        this.shutdown('KILL_SWITCH_TRIGGERED').then(() => process.exit(1));
      });

      if (options.skipLogin) {
        console.log('[DiscordLabRunner] ℹ️ skipLogin=true. Bot client created and guarded; login deferred.');
        return {
          server: this.httpServer,
          client: this.discordClient,
          firewall,
          database: this.disposableDb,
          stop: () => this.shutdown('MANUAL_STOP'),
        };
      }

      // 8. Connect with Timeout & Strict Containment Verification
      const loginTimeoutMs = options.loginTimeoutMs || 15000;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new DiscordLabSecurityError(`Discord login timed out after ${loginTimeoutMs}ms`));
        }, loginTimeoutMs);

        this.discordClient!.once('ready', async (c) => {
          clearTimeout(timeout);
          console.log(`[DiscordLabRunner] Authenticated as ${c.user.tag}. Running guild containment verification...`);

          const verification = firewall.verifyBotAndGuildContainment(this.discordClient!);
          if (!verification.valid) {
            reject(new DiscordLabSecurityError(`Guild containment verification FAILED: ${verification.reason}`));
            return;
          }

          console.log(`[DiscordLabRunner] ✅ Confined strictly to test guild '${allowedGuildId}'. Firewall ACTIVE.`);
          resolve();
        });

        const token = (process.env.DISCORD_LAB_BOT_TOKEN || process.env.DISCORD_TOKEN || '').trim();
        this.discordClient!.login(token).catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      return {
        server: this.httpServer,
        client: this.discordClient,
        firewall,
        database: this.disposableDb,
        stop: () => this.shutdown('MANUAL_STOP'),
      };
    } catch (startupError: any) {
      console.error('[DiscordLabRunner] ❌ Startup failure detected. Initiating clean resource teardown...');
      await this.shutdown(`STARTUP_FAILURE: ${startupError.message}`);
      throw startupError;
    }
  }

  public async shutdown(reason: string): Promise<void> {
    if (this.isShuttingDown || this.shutdownCompleted) return;
    this.isShuttingDown = true;
    console.log(`[DiscordLabRunner] 🛑 Shutting down Discord Lab (${reason})...`);

    if (this.stopWatcher) {
      try { this.stopWatcher(); } catch {}
      this.stopWatcher = null;
    }

    if (this.discordClient) {
      try { this.discordClient.destroy(); } catch {}
      this.discordClient = null;
    }

    if (this.httpServer) {
      try {
        await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
      } catch {}
      this.httpServer = null;
    }

    if (this.disposableDb) {
      try {
        await this.disposableDb.cleanup();
      } catch {}
      this.disposableDb = null;
    }

    setGlobalPrismaClient(null);
    setGlobalDiscordClient(null);
    this.shutdownCompleted = true;
    console.log('[DiscordLabRunner] Clean shutdown complete.');
  }
}

export async function startDiscordLab(options: DiscordLabStartOptions = {}): Promise<RunningDiscordLab> {
  const manager = new DiscordLabLifecycleManager();
  return manager.start(options);
}
