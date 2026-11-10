/**
 * src/discord-lab/discordLabFirewall.ts
 *
 * Strict Event Firewall & Guild Allowlist Enforcement for Discord Lab Mode.
 *
 * FAIL-CLOSED INVARIANTS:
 *  1. Exactly one dedicated test Guild ID is permitted.
 *  2. All events (messages, interactions, member updates) with missing or foreign guild IDs are dropped immediately.
 *  3. Direct messages (DMs) are rejected.
 *  4. Incoming command arguments specifying foreign guild IDs are rejected/ignored — authorization is NEVER derived from user input.
 *  5. Bot connection fails closed if the authenticated bot is not in the permitted guild or is joined to unauthorized guilds.
 */

import { Client, Message, Interaction } from 'discord.js';

export interface DiscordLabFirewallOptions {
  onRejectedEvent?: (details: {
    eventType: string;
    receivedGuildId: string | null;
    channelId?: string;
    userId?: string;
    reason: string;
  }) => void;
  strictSingleGuildCheck?: boolean;
}

export class DiscordLabSecurityError extends Error {
  public readonly code = 'DISCORD_LAB_SECURITY_VIOLATION';
  constructor(message: string) {
    super(`[DiscordLabSecurity] ${message}`);
    this.name = 'DiscordLabSecurityError';
  }
}

export class DiscordLabFirewall {
  public readonly allowedGuildId: string;
  private readonly options: DiscordLabFirewallOptions;
  public totalEventsProcessed: number = 0;
  public totalEventsRejected: number = 0;

  constructor(allowedGuildId: string, options: DiscordLabFirewallOptions = {}) {
    if (!allowedGuildId || !/^[1-9][0-9]{16,19}$/.test(allowedGuildId)) {
      throw new DiscordLabSecurityError(
        `Invalid allowedGuildId ('${allowedGuildId}'). Must be a valid Discord snowflake.`
      );
    }
    this.allowedGuildId = allowedGuildId;
    this.options = {
      strictSingleGuildCheck: true,
      ...options,
    };
  }

  /**
   * Checks whether a guildId matches the single permitted test guild.
   */
  public isGuildPermitted(guildId: string | null | undefined): boolean {
    if (!guildId) return false;
    return guildId.trim() === this.allowedGuildId;
  }

  /**
   * Asserts that a guildId is permitted, throwing DiscordLabSecurityError otherwise.
   */
  public assertGuildPermitted(guildId: string | null | undefined, context?: string): void {
    if (!this.isGuildPermitted(guildId)) {
      this.totalEventsRejected++;
      const ctx = context ? ` during ${context}` : '';
      throw new DiscordLabSecurityError(
        `Guild '${guildId ?? 'DIRECT_MESSAGE'}' is NOT permitted${ctx}. Allowed Guild ID is strictly '${this.allowedGuildId}'.`
      );
    }
  }

  /**
   * Enforces that incoming command authorization uses ONLY the verified allowlisted test guild.
   * Never accepts user-supplied guild parameters as authorization.
   */
  public resolveAuthorizedGuildId(untrustedUserSuppliedGuildId?: string): string {
    if (untrustedUserSuppliedGuildId && untrustedUserSuppliedGuildId !== this.allowedGuildId) {
      throw new DiscordLabSecurityError(
        `Incoming command requested foreign guild ID ('${untrustedUserSuppliedGuildId}'). Authorization override rejected.`
      );
    }
    return this.allowedGuildId;
  }

  /**
   * Verifies that the connected Discord client is in the allowed guild,
   * and optionally confirms it is NOT in any unauthorized guild.
   */
  public verifyConnectedGuilds(client: Client): { valid: boolean; reason?: string } {
    const cachedGuilds = client.guilds.cache;

    if (!cachedGuilds.has(this.allowedGuildId)) {
      return {
        valid: false,
        reason: `Authenticated bot is NOT a member of allowed test guild '${this.allowedGuildId}'. Bot is in ${cachedGuilds.size} other guild(s).`,
      };
    }

    if (this.options.strictSingleGuildCheck && cachedGuilds.size > 1) {
      const foreignGuildIds = Array.from(cachedGuilds.keys()).filter((id) => id !== this.allowedGuildId);
      return {
        valid: false,
        reason: `CRITICAL ISOLATION ALERT: Bot is joined to ${foreignGuildIds.length} foreign guild(s) (${foreignGuildIds.join(', ')}). In Staging Lab mode, the bot must be confined strictly to test guild '${this.allowedGuildId}'.`,
      };
    }

    return { valid: true };
  }

  /**
   * Attaches firewall guards to incoming client events.
   */
  public attachClientFirewall(
    client: Client,
    handlers: {
      onPermittedMessage: (message: Message) => Promise<void> | void;
      onPermittedInteraction: (interaction: Interaction) => Promise<void> | void;
    }
  ): void {
    // 1. Message Guard
    client.on('messageCreate', async (message: Message) => {
      this.totalEventsProcessed++;
      const guildId = message.guildId;

      if (!this.isGuildPermitted(guildId)) {
        this.totalEventsRejected++;
        this.options.onRejectedEvent?.({
          eventType: 'messageCreate',
          receivedGuildId: guildId,
          channelId: message.channelId,
          userId: message.author?.id,
          reason: guildId ? 'Foreign guild event dropped' : 'DM event dropped',
        });
        return; // Silent drop of unauthorized event
      }

      try {
        await handlers.onPermittedMessage(message);
      } catch (err: any) {
        console.error('[DiscordLabFirewall] Error in permitted message handler:', err);
      }
    });

    // 2. Interaction Guard
    client.on('interactionCreate', async (interaction: Interaction) => {
      this.totalEventsProcessed++;
      const guildId = interaction.guildId;

      if (!this.isGuildPermitted(guildId)) {
        this.totalEventsRejected++;
        this.options.onRejectedEvent?.({
          eventType: 'interactionCreate',
          receivedGuildId: guildId,
          channelId: interaction.channelId ?? undefined,
          userId: interaction.user?.id,
          reason: guildId ? 'Foreign guild interaction dropped' : 'DM interaction dropped',
        });

        // Fail-safe response if interaction supports reply
        if ('reply' in interaction && typeof (interaction as any).reply === 'function') {
          try {
            await (interaction as any).reply({
              content: '⛔ [G4X Staging Lab] Interaction rejected: unauthorized server.',
              ephemeral: true,
            });
          } catch {}
        }
        return;
      }

      try {
        await handlers.onPermittedInteraction(interaction);
      } catch (err: any) {
        console.error('[DiscordLabFirewall] Error in permitted interaction handler:', err);
      }
    });
  }
}
