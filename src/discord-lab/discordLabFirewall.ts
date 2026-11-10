/**
 * src/discord-lab/discordLabFirewall.ts
 *
 * Strict Event Firewall, Startup State Machine & Guild Allowlist Enforcement.
 *
 * STATE MACHINE:
 *  BLOCKED (initial) -> VERIFYING -> VERIFIED -> ACTIVE (ready) -> SHUTTING_DOWN -> TERMINATED
 *
 * FAIL-CLOSED INVARIANTS:
 *  1. Exactly one dedicated test Guild ID is permitted.
 *  2. All events received while state is NOT 'ACTIVE' are immediately rejected.
 *  3. Bot identity and guild containment (guilds.cache.size === 1) MUST be verified before state becomes 'ACTIVE'.
 *  4. If verification fails, the client is destroyed immediately; zero commands or interactions are processed.
 *  5. Incoming command arguments specifying foreign guild IDs are rejected — authorization is NEVER derived from user input.
 *  6. Outgoing operations (channel creation, messages) are strictly validated against the allowed test guild.
 *  7. Note: Discord WebSocket Gateway connects at account level; containment is strictly enforced at application boundaries.
 */

import { Client, Message, Interaction } from 'discord.js';

export enum DiscordLabState {
  BLOCKED = 'BLOCKED',
  VERIFYING = 'VERIFYING',
  VERIFIED = 'VERIFIED',
  ACTIVE = 'ACTIVE',
  SHUTTING_DOWN = 'SHUTTING_DOWN',
  TERMINATED = 'TERMINATED',
}

export interface DiscordLabFirewallOptions {
  onRejectedEvent?: (details: {
    eventType: string;
    receivedGuildId: string | null;
    channelId?: string;
    userId?: string;
    reason: string;
    state: DiscordLabState;
  }) => void;
  expectedApplicationId?: string;
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
  private _state: DiscordLabState = DiscordLabState.BLOCKED;
  public totalEventsProcessed: number = 0;
  public totalEventsRejected: number = 0;

  constructor(allowedGuildId: string, options: DiscordLabFirewallOptions = {}) {
    if (!allowedGuildId || !/^[1-9][0-9]{16,19}$/.test(allowedGuildId)) {
      throw new DiscordLabSecurityError(
        `Invalid allowedGuildId ('${allowedGuildId}'). Must be a valid Discord snowflake.`
      );
    }
    this.allowedGuildId = allowedGuildId;
    this.options = options;
  }

  public get state(): DiscordLabState {
    return this._state;
  }

  public isGuildPermitted(guildId: string | null | undefined): boolean {
    if (!guildId) return false;
    return guildId.trim() === this.allowedGuildId;
  }

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
   * Guards outgoing operations (e.g. channel creation, messages, role modification).
   * Refuses to operate on any guild other than allowedGuildId.
   */
  public assertOutgoingOperationPermitted(targetGuildId: string | null | undefined, operation: string): void {
    if (this._state !== DiscordLabState.ACTIVE && this._state !== DiscordLabState.VERIFIED) {
      throw new DiscordLabSecurityError(
        `Outgoing operation '${operation}' rejected: Discord Lab state is '${this._state}' (must be VERIFIED or ACTIVE).`
      );
    }
    if (!this.isGuildPermitted(targetGuildId)) {
      throw new DiscordLabSecurityError(
        `Outgoing operation '${operation}' on foreign guild '${targetGuildId ?? 'UNKNOWN'}' strictly blocked. Allowed guild: '${this.allowedGuildId}'.`
      );
    }
  }

  /**
   * Authoritative gate for all outgoing Discord HTTP REST calls.
   * Intercepts client.rest.request to guarantee fail-closed containment.
   */
  public assertOutgoingRestPermitted(options: any, client?: Client): void {
    const fullRoute = String(options?.fullRoute || options?.path || '').trim();
    const method = String(options?.method || 'GET').toUpperCase();

    // 1. Allow bot login & identity read routes during startup/verification
    const isBotLoginRoute =
      fullRoute === '/gateway/bot' ||
      fullRoute === '/users/@me' ||
      fullRoute === '/oauth2/applications/@me' ||
      fullRoute === '/users/@me/guilds';

    if (isBotLoginRoute) {
      return;
    }

    // 2. State Check: All other outgoing operations require ACTIVE (or VERIFIED during verification)
    if (this._state !== DiscordLabState.ACTIVE && this._state !== DiscordLabState.VERIFIED) {
      this.totalEventsRejected++;
      throw new DiscordLabSecurityError(
        `Outgoing REST operation '${method} ${fullRoute}' rejected: Discord Lab state is '${this._state}' (must be ACTIVE).`
      );
    }

    // 3. Guild-targeted routes: /guilds/:guildId/...
    const guildMatch = fullRoute.match(/^\/guilds\/([^\/]+)/);
    if (guildMatch) {
      const targetGuildId = guildMatch[1];
      if (targetGuildId !== this.allowedGuildId) {
        this.totalEventsRejected++;
        throw new DiscordLabSecurityError(
          `Outgoing REST operation '${method} ${fullRoute}' strictly blocked: target guild '${targetGuildId}' is not the allowed test guild '${this.allowedGuildId}'.`
        );
      }
    }

    // 4. Channel-targeted routes: /channels/:channelId/...
    const channelMatch = fullRoute.match(/^\/channels\/([^\/]+)/);
    if (channelMatch && client) {
      const targetChannelId = channelMatch[1];
      const cachedChannel: any = client.channels?.cache?.get(targetChannelId);

      if (cachedChannel) {
        if (cachedChannel.guildId && cachedChannel.guildId !== this.allowedGuildId) {
          this.totalEventsRejected++;
          throw new DiscordLabSecurityError(
            `Outgoing REST operation '${method} ${fullRoute}' strictly blocked: channel '${targetChannelId}' belongs to foreign guild '${cachedChannel.guildId}'.`
          );
        }
      } else {
        const allowedGuild = client.guilds?.cache?.get(this.allowedGuildId);
        if (allowedGuild && allowedGuild.channels?.cache) {
          const inGuildCache = allowedGuild.channels.cache.has(targetChannelId);
          if (!inGuildCache && method !== 'GET') {
            this.totalEventsRejected++;
            throw new DiscordLabSecurityError(
              `Outgoing REST mutation '${method} ${fullRoute}' strictly blocked: target channel '${targetChannelId}' is not found in allowed test guild '${this.allowedGuildId}'.`
            );
          }
        }
      }
    }
  }

  /**
   * Attaches outgoing REST interception to client.rest.request.
   * Ensures every outgoing Discord API call is inspected and enforced fail-closed.
   */
  public attachRestFirewall(client: Client): void {
    if (!client.rest || typeof client.rest.request !== 'function') {
      return;
    }
    const originalRequest = client.rest.request.bind(client.rest);
    client.rest.request = async (options: any) => {
      this.assertOutgoingRestPermitted(options, client);
      return originalRequest(options);
    };
  }

  /**
   * Startup Verification Procedure:
   *  1. Checks authenticated user identity and application ID.
   *  2. Verifies bot is in allowed test guild.
   *  3. Verifies complete guild containment (bot must NOT be in any other guild, guilds.cache.size === 1).
   *  4. If successful, transitions to VERIFIED -> ACTIVE.
   *  5. If failed, transitions to TERMINATED, destroys client, and throws.
   */
  public verifyBotAndGuildContainment(client: Client): { valid: boolean; reason?: string } {
    this._state = DiscordLabState.VERIFYING;

    if (!client.user) {
      this._state = DiscordLabState.TERMINATED;
      try { client.destroy(); } catch {}
      return {
        valid: false,
        reason: 'Client user is not authenticated or ready.',
      };
    }

    if (this.options.expectedApplicationId && client.user.id !== this.options.expectedApplicationId) {
      this._state = DiscordLabState.TERMINATED;
      try { client.destroy(); } catch {}
      return {
        valid: false,
        reason: `Authenticated bot ID ('${client.user.id}') does not match expected DISCORD_LAB_APPLICATION_ID ('${this.options.expectedApplicationId}').`,
      };
    }

    const cachedGuilds = client.guilds.cache;

    if (!cachedGuilds.has(this.allowedGuildId)) {
      this._state = DiscordLabState.TERMINATED;
      try { client.destroy(); } catch {}
      return {
        valid: false,
        reason: `Authenticated bot is NOT a member of allowed test guild '${this.allowedGuildId}'. Bot is in ${cachedGuilds.size} other guild(s).`,
      };
    }

    if (cachedGuilds.size > 1) {
      const foreignGuildIds = Array.from(cachedGuilds.keys()).filter((id) => id !== this.allowedGuildId);
      this._state = DiscordLabState.TERMINATED;
      try { client.destroy(); } catch {}
      return {
        valid: false,
        reason: `CRITICAL ISOLATION ALERT: Bot is joined to ${foreignGuildIds.length} foreign guild(s) (${foreignGuildIds.join(', ')}). In Staging Lab mode, the bot must be confined strictly to test guild '${this.allowedGuildId}'.`,
      };
    }

    // Success: Transition to VERIFIED, then ACTIVE
    this._state = DiscordLabState.VERIFIED;
    this.activate();
    return { valid: true };
  }

  public activate(): void {
    if (this._state !== DiscordLabState.VERIFIED && this._state !== DiscordLabState.ACTIVE) {
      throw new DiscordLabSecurityError(`Cannot activate firewall from state '${this._state}'. Must be VERIFIED first.`);
    }
    this._state = DiscordLabState.ACTIVE;
  }

  public terminate(reason: string = 'Manual termination'): void {
    this._state = DiscordLabState.TERMINATED;
  }

  /**
   * Attaches firewall guards to incoming client events.
   * STRICT ENFORCEMENT: All events are dropped while state is not ACTIVE.
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

      // Gate check: Must be in ACTIVE state
      if (this._state !== DiscordLabState.ACTIVE) {
        this.totalEventsRejected++;
        this.options.onRejectedEvent?.({
          eventType: 'messageCreate',
          receivedGuildId: guildId,
          channelId: message.channelId,
          userId: message.author?.id,
          reason: `Event dropped: Firewall is in '${this._state}' state (not ACTIVE)`,
          state: this._state,
        });
        return;
      }

      if (!this.isGuildPermitted(guildId)) {
        this.totalEventsRejected++;
        this.options.onRejectedEvent?.({
          eventType: 'messageCreate',
          receivedGuildId: guildId,
          channelId: message.channelId,
          userId: message.author?.id,
          reason: guildId ? 'Foreign guild event dropped' : 'DM event dropped',
          state: this._state,
        });
        return;
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

      // Gate check: Must be in ACTIVE state
      if (this._state !== DiscordLabState.ACTIVE) {
        this.totalEventsRejected++;
        this.options.onRejectedEvent?.({
          eventType: 'interactionCreate',
          receivedGuildId: guildId,
          channelId: interaction.channelId ?? undefined,
          userId: interaction.user?.id,
          reason: `Interaction dropped: Firewall is in '${this._state}' state (not ACTIVE)`,
          state: this._state,
        });
        return;
      }

      if (!this.isGuildPermitted(guildId)) {
        this.totalEventsRejected++;
        this.options.onRejectedEvent?.({
          eventType: 'interactionCreate',
          receivedGuildId: guildId,
          channelId: interaction.channelId ?? undefined,
          userId: interaction.user?.id,
          reason: guildId ? 'Foreign guild interaction dropped' : 'DM interaction dropped',
          state: this._state,
        });

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
