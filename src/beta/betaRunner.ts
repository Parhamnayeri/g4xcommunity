/**
 * src/beta/betaRunner.ts
 *
 * Dedicated Persistent Operational Closed-Beta Lifecycle Runner (v0.001).
 *
 * Distinct from disposable `discordLabRunner.ts`:
 *  - Persistent SQLite database under `prisma/staging/` (retained cleanly across restarts).
 *  - Invite-only Discord OAuth2 web portal (`betaApp.ts`, isolated `g4x_beta.sid` cookie).
 *  - When Discord bot is enabled (`skipDiscordLogin` !== true), routes real G4X commands & interactions
 *    strictly through `DiscordLabFirewall` (guild allowlist + REST containment + webhook interaction token checks).
 *  - All six live financial/external gates stay hard-locked 'false'.
 */

import http from 'http';
import { Client, GatewayIntentBits, Partials, Message, Interaction } from 'discord.js';
import { setGlobalPrismaClient } from '../database/db';
import { setGlobalDiscordClient } from '../services/orderDiscordService';
import { handleSetupCommand } from '../commands/setup';
import { handleOrderCommand } from '../commands/order';
import { handleProfileCommand } from '../commands/profile';
import { handleTeamCommand } from '../commands/team';
import { handleAssignCommand } from '../commands/assign';
import { handleButtonInteraction } from '../interactions/buttons';
import { handleModalSubmit } from '../interactions/modals';
import { handleRegistrationSelectMenu } from '../interactions/registrationInteractions';
import {
  DiscordLabFirewall,
  DiscordLabSecurityError,
} from '../discord-lab/discordLabFirewall';
import {
  loadBetaEnvFile,
  validateBetaEnvironment,
  BetaEnvValidationResult,
} from './validateBetaEnv';
import {
  initializeBetaDatabase,
  BetaDatabaseHandle,
} from './betaDatabase';
import { createBetaApp } from './betaApp';

export interface BetaStartOptions {
  customEnvPath?: string;
  portOverride?: number;
  hostOverride?: string;
  skipDiscordLogin?: boolean;
  silentDb?: boolean;
  loginTimeoutMs?: number;
}

export interface RunningBetaInstance {
  server: http.Server;
  host: string;
  port: number;
  client: Client | null;
  firewall: DiscordLabFirewall | null;
  database: BetaDatabaseHandle;
  validation: BetaEnvValidationResult;
  stop: () => Promise<void>;
}

export class BetaLifecycleManager {
  private dbHandle: BetaDatabaseHandle | null = null;
  private httpServer: http.Server | null = null;
  private discordClient: Client | null = null;
  private firewall: DiscordLabFirewall | null = null;
  private isShuttingDown = false;
  private shutdownCompleted = false;

  public async start(options: BetaStartOptions = {}): Promise<RunningBetaInstance> {
    if (options.customEnvPath) {
      loadBetaEnvFile(options.customEnvPath);
    } else {
      loadBetaEnvFile();
    }

    const requireDiscordBotConfig = !options.skipDiscordLogin;
    const validation = validateBetaEnvironment(process.env, {
      requireDiscordBotConfig,
      strictBotTokenRequired: !options.skipDiscordLogin,
    });

    if (options.hostOverride) {
      const h = options.hostOverride.trim().toLowerCase();
      if (h === '0.0.0.0' || h === '::' || h === '[::]') {
        validation.valid = false;
        validation.errors.push(`Override host '${options.hostOverride}' cannot be a public wildcard bind.`);
      } else {
        validation.host = options.hostOverride.trim();
      }
    }

    if (options.portOverride !== undefined) {
      if (!Number.isInteger(options.portOverride) || options.portOverride < 0 || options.portOverride > 65535) {
        validation.valid = false;
        validation.errors.push(`Invalid portOverride '${options.portOverride}'.`);
      } else {
        validation.port = options.portOverride;
      }
    }

    if (!validation.valid || !validation.resolvedDatabaseUrl) {
      throw new Error(
        `[BetaRunner] Environment validation failed:\n - ${validation.errors.join('\n - ')}`
      );
    }

    try {
      this.dbHandle = await initializeBetaDatabase(validation.resolvedDatabaseUrl, {
        silent: options.silentDb,
        seed: true,
      });
      setGlobalPrismaClient(this.dbHandle.prismaClient);

      const app = createBetaApp({
        inviteAllowlistIds: validation.inviteAllowlistIds,
        sessionSecret: process.env.SESSION_SECRET,
      });

      this.httpServer = http.createServer(app);
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          this.httpServer?.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          this.httpServer?.off('error', onError);
          resolve();
        };
        this.httpServer!.once('error', onError);
        this.httpServer!.listen(validation.port, validation.host, onListening);
      });

      const addr = this.httpServer.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : validation.port;

      if (!options.skipDiscordLogin) {
        const firewall = new DiscordLabFirewall(validation.allowedGuildId!, {
          expectedApplicationId: validation.applicationId!,
          allowMemberDms: true,
          onRejectedEvent: (details) => {
            console.warn(
              `[BetaDiscordFirewall] REJECTED ${details.eventType} (${details.reason}) guild=${details.receivedGuildId ?? 'DM'}`
            );
          },
        });
        this.firewall = firewall;

        const client = new Client({
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMessageReactions,
          ],
          partials: [Partials.Message, Partials.Channel, Partials.Reaction],
        });
        this.discordClient = client;

        firewall.attachRestFirewall(client);
        firewall.attachClientFirewall(client, {
          onPermittedMessage: async (message: Message) => {
            if (message.author.bot || !message.content.startsWith('G4!')) return;
            const rawArgs = message.content.slice(3).trim().split(/\s+/);
            const command = rawArgs.shift()?.toLowerCase();
            if (!command) return;

            if (command === 'setup') {
              await handleSetupCommand(message, rawArgs);
            } else if (command === 'order') {
              await handleOrderCommand(message, rawArgs);
            } else if (command === 'profile') {
              await handleProfileCommand(message, rawArgs);
            } else if (command === 'team') {
              await handleTeamCommand(message, rawArgs);
            } else if (command === 'assign') {
              await handleAssignCommand(message, rawArgs);
            } else if (command === 'proof') {
              const { handleDiscordProofMessageUpload } = await import('../services/discordProofSubmissionService');
              await handleDiscordProofMessageUpload(message, rawArgs);
            }
          },
          onPermittedInteraction: async (interaction: Interaction) => {
            if (interaction.isButton()) {
              await handleButtonInteraction(interaction);
            } else if (interaction.isModalSubmit()) {
              await handleModalSubmit(interaction);
            } else if (interaction.isStringSelectMenu()) {
              if (interaction.customId.startsWith('ord_wiz:')) {
                const { handleOrderWizardSelectMenu } = await import('../interactions/orderWizardInteractions');
                await handleOrderWizardSelectMenu(interaction);
              } else if (interaction.customId.startsWith('presign_team:')) {
                const { handlePresignTeamSelectMenu } = await import('../interactions/presignReviewInteractions');
                await handlePresignTeamSelectMenu(interaction);
              } else {
                await handleRegistrationSelectMenu(interaction);
              }
            }
          },
        });

        await new Promise<void>((resolve, reject) => {
          const timeoutMs = options.loginTimeoutMs ?? 30000;
          const timeout = setTimeout(() => {
            reject(new DiscordLabSecurityError(`Beta Discord login timed out after ${timeoutMs}ms.`));
          }, timeoutMs);

          client.once('ready', async () => {
            clearTimeout(timeout);
            const check = firewall.verifyBotAndGuildContainment(client);
            if (!check.valid) {
              reject(new DiscordLabSecurityError(check.reason || 'Guild containment verification failed.'));
              return;
            }

            // ۱. ثبت اولیه‌ی کانال‌های موجود در دیتابیس در فایروال جهت مجاز بودن عملیات‌های دیسکورد
            try {
              const prismaClient = this.dbHandle?.prismaClient;
              if (prismaClient) {
                const mappings = await prismaClient.discordChannelMapping.findMany({
                  where: { guildId: validation.allowedGuildId!, isActive: true },
                  select: { discordChannelId: true },
                });
                for (const m of mappings) {
                  if (m.discordChannelId) {
                    firewall.registerPermittedChannel(m.discordChannelId);
                  }
                }
              }
            } catch (err: any) {
              console.warn('[BetaRunner] Could not preload channel mappings into firewall:', err?.message || err);
            }

            // ۲. راه‌اندازی و همگام‌سازی خودکار کانال‌ها، قوانین و پنل‌های ثبت‌نام در سرور دیسکورد
            try {
              const guild = client.guilds.cache.get(validation.allowedGuildId!) ||
                await client.guilds.fetch(validation.allowedGuildId!).catch(() => null);

              if (guild) {
                // کش و ثبت تمامی کانال‌های موجود در گیلد داخل فایروال پیش از ساخت کانال جدید
                await guild.channels.fetch().catch(() => null);
                if (guild.channels?.cache) {
                  for (const [chId] of guild.channels.cache) {
                    firewall.registerPermittedChannel(chId);
                  }
                }

                console.log(`[BetaRunner] Guild connected: ${guild.name} (${guild.id}). Running auto-provisioning & panel deployment...`);
                const { provisionAllChannels } = await import('../services/discordProvisioningService');
                const provActorId = process.env.OWNER_DISCORD_ID || '387583875066626069';
                const provResult = await provisionAllChannels({
                  guild,
                  actorId: provActorId,
                  client,
                });
                console.log(
                  `[BetaRunner] Auto-provisioning completed: ${provResult.synced} mapped, ${provResult.created} created, ${provResult.reused} reused.`
                );

                // ثبت کانال‌های نگاشت‌شده جدید در فایروال
                for (const m of provResult.mappings) {
                  if (m.discordChannelId) {
                    firewall.registerPermittedChannel(m.discordChannelId);
                  }
                }
              }
            } catch (provErr: any) {
              console.warn('[BetaRunner] Auto-provisioning notice:', provErr?.message || provErr);
            }

            setGlobalDiscordClient(client);
            (global as any).discordClient = client;

            // ۳. راه‌اندازی ورکر پس‌زمینه صف اعلانات (Outbox Worker) جهت تحویل پیام‌های KYC و ثبت‌نام در دیسکورد
            try {
              const { startNotificationWorker } = await import('../services/notificationWorker');
              startNotificationWorker(client);
              console.log('[BetaRunner] Background notification worker successfully started.');
            } catch (nwErr: any) {
              console.warn('[BetaRunner] Could not start notification worker:', nwErr?.message || nwErr);
            }

            resolve();
          });

          client.login(validation.botToken!).catch((err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
      }

      // Initialize Google Drive backup scheduler if configured
      try {
        const { startBackupScheduler } = await import('../services/backupScheduler');
        startBackupScheduler();
      } catch (err: any) {
        console.warn('[BetaRunner] Backup scheduler notice:', err?.message || err);
      }

      return {
        server: this.httpServer,
        host: validation.host,
        port: boundPort,
        client: this.discordClient,
        firewall: this.firewall,
        database: this.dbHandle,
        validation,
        stop: () => this.shutdown('MANUAL_STOP'),
      };
    } catch (startupError: any) {
      await this.shutdown(`STARTUP_FAILURE: ${startupError?.message || startupError}`);
      throw startupError;
    }
  }

  public async shutdown(reason: string): Promise<void> {
    if (this.isShuttingDown || this.shutdownCompleted) return;
    this.isShuttingDown = true;

    if (this.firewall) {
      try {
        this.firewall.terminate(reason);
      } catch {}
    }

    try {
      const { stopBackupScheduler } = await import('../services/backupScheduler');
      stopBackupScheduler();
    } catch {}

    if (this.discordClient) {
      try {
        this.discordClient.destroy();
      } catch {}
      this.discordClient = null;
    }

    if (this.httpServer) {
      try {
        (this.httpServer as any).closeAllConnections?.();
        await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
      } catch {}
      this.httpServer = null;
    }

    if (this.dbHandle) {
      try {
        // NOTE: Never delete persistent beta DB on shutdown; flush WAL & close cleanly.
        await this.dbHandle.disconnect();
      } catch {}
      this.dbHandle = null;
    }

    setGlobalPrismaClient(null);
    setGlobalDiscordClient(null);
    this.shutdownCompleted = true;
  }
}

export async function startBetaRunner(options: BetaStartOptions = {}): Promise<RunningBetaInstance> {
  const manager = new BetaLifecycleManager();
  return manager.start(options);
}
