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

  public readonly permittedChannelIds: Set<string> = new Set();
  public readonly permittedInteractionIds: Set<string> = new Set();

  public registerPermittedChannel(channelId: string | null | undefined): void {
    if (channelId && /^[1-9][0-9]{16,19}$/.test(channelId)) {
      this.permittedChannelIds.add(channelId);
    }
  }

  public registerPermittedInteraction(interactionId: string | null | undefined): void {
    if (interactionId && /^[1-9][0-9]{16,19}$/.test(interactionId)) {
      this.permittedInteractionIds.add(interactionId);
    }
  }

  /**
   * Authoritative gate for all outgoing Discord HTTP REST calls.
   * Intercepts client.rest.request to guarantee fail-closed containment.
   *
   * FAIL-CLOSED INVARIANTS:
   *  1. Reject every unknown or unclassified REST route by default.
   *  2. Permit only explicitly documented, necessary routes.
   *  3. Permit startup identity routes ONLY with safe read methods (GET).
   *  4. Enforce that target guild is strictly allowedGuildId for all guild routes.
   *  5. Verify target guild ownership for every channel mutation (POST, PATCH, PUT, DELETE).
   *  6. Reject unclassified routes regardless of path structure.
   */
  public assertOutgoingRestPermitted(options: any, client?: Client): void {
    const rawRoute = String(options?.fullRoute || options?.path || '').trim();
    const pathOnly = rawRoute.split('?')[0].trim();
    const method = String(options?.method || 'GET').toUpperCase();

    // 1. Startup identity routes — safe read methods (GET) ONLY
    const isBotLoginRoute =
      pathOnly === '/gateway/bot' ||
      pathOnly === '/users/@me' ||
      pathOnly === '/oauth2/applications/@me' ||
      pathOnly === '/users/@me/guilds';

    if (isBotLoginRoute) {
      if (method !== 'GET') {
        this.totalEventsRejected++;
        throw new DiscordLabSecurityError(
          `Startup identity route '${method} ${pathOnly}' rejected: only safe read method 'GET' is permitted on identity routes.`
        );
      }
      return;
    }

    // 2. State Check: All other outgoing operations require ACTIVE (or VERIFIED during verification)
    if (this._state !== DiscordLabState.ACTIVE && this._state !== DiscordLabState.VERIFIED) {
      this.totalEventsRejected++;
      throw new DiscordLabSecurityError(
        `Outgoing REST operation '${method} ${pathOnly}' rejected: Discord Lab state is '${this._state}' (must be ACTIVE).`
      );
    }

    // 3. Guild-targeted routes: /guilds/:guildId/...
    const guildMatch = pathOnly.match(/^\/guilds\/([a-zA-Z0-9_\-]+)(\/.*)?$/);
    if (guildMatch) {
      const targetGuildId = guildMatch[1];
      if (targetGuildId !== this.allowedGuildId) {
        this.totalEventsRejected++;
        throw new DiscordLabSecurityError(
          `Outgoing REST operation '${method} ${pathOnly}' strictly blocked: target guild '${targetGuildId}' is not the allowed test guild '${this.allowedGuildId}'.`
        );
      }

      const guildSubPath = guildMatch[2] || '';

      // Explicitly reject destructive guild deletion
      if (guildSubPath === '' && method === 'DELETE') {
        this.totalEventsRejected++;
        throw new DiscordLabSecurityError(
          `Outgoing REST operation 'DELETE /guilds/${targetGuildId}' strictly blocked: destructive guild deletion is prohibited.`
        );
      }

      // Exact route + HTTP method allowlist for guild operations:
      // Permits only documented, necessary routes:
      // - GET /guilds/:guildId (safe guild metadata read)
      // - GET /guilds/:guildId/channels (safe channel listing)
      // - POST /guilds/:guildId/channels (create test channel in allowed lab guild)
      // - GET /guilds/:guildId/members (safe member listing)
      // - GET /guilds/:guildId/members/:memberId (safe member read)
      // - PUT /guilds/:guildId/members/:memberId/roles/:roleId (assign test role to member)
      // - DELETE /guilds/:guildId/members/:memberId/roles/:roleId (remove test role from member)
      // - GET /guilds/:guildId/roles (safe roles read)
      // - GET /guilds/:guildId/roles/:roleId (safe role details read)
      // - GET /guilds/:guildId/emojis (safe emojis read)
      // - GET /guilds/:guildId/emojis/:emojiId (safe emoji details read)

      let isAllowedGuildOp = false;

      if (guildSubPath === '') {
        if (method === 'GET') isAllowedGuildOp = true;
      } else if (guildSubPath === '/channels') {
        if (method === 'GET' || method === 'POST') isAllowedGuildOp = true;
      } else if (guildSubPath === '/members') {
        if (method === 'GET') isAllowedGuildOp = true;
      } else if (/^\/members\/[a-zA-Z0-9_\-]+$/.test(guildSubPath)) {
        if (method === 'GET') isAllowedGuildOp = true;
      } else if (/^\/members\/[a-zA-Z0-9_\-]+\/roles\/[a-zA-Z0-9_\-]+$/.test(guildSubPath)) {
        if (method === 'PUT' || method === 'DELETE') isAllowedGuildOp = true;
      } else if (guildSubPath === '/roles') {
        if (method === 'GET') isAllowedGuildOp = true;
      } else if (/^\/roles\/[a-zA-Z0-9_\-]+$/.test(guildSubPath)) {
        if (method === 'GET') isAllowedGuildOp = true;
      } else if (guildSubPath === '/emojis') {
        if (method === 'GET') isAllowedGuildOp = true;
      } else if (/^\/emojis\/[a-zA-Z0-9_\-]+$/.test(guildSubPath)) {
        if (method === 'GET') isAllowedGuildOp = true;
      }

      if (!isAllowedGuildOp) {
        this.totalEventsRejected++;
        throw new DiscordLabSecurityError(
          `Outgoing REST operation '${method} ${pathOnly}' on guild '${targetGuildId}' is strictly blocked: destructive, unclassified, or unsupported guild operation. Permitted guild operations require an exact route and method allowlist match.`
        );
      }

      return;
    }

    // 4. Channel-targeted routes: /channels/:channelId/...
    const channelMatch = pathOnly.match(/^\/channels\/([a-zA-Z0-9_\-]+)(\/.*)?$/);
    if (channelMatch) {
      const targetChannelId = channelMatch[1];
      const channelSubPath = channelMatch[2] || '';

      const isPermittedChannelRoute =
        channelSubPath === '' ||
        /^\/messages(\/[a-zA-Z0-9_\-]+(\/reactions(\/.*)?)?)?$/.test(channelSubPath) ||
        /^\/messages\/[a-zA-Z0-9_\-]+\/threads$/.test(channelSubPath) ||
        /^\/permissions\/[a-zA-Z0-9_\-]+$/.test(channelSubPath) ||
        /^\/pins(\/[a-zA-Z0-9_\-]+)?$/.test(channelSubPath) ||
        /^\/typing$/.test(channelSubPath) ||
        /^\/threads$/.test(channelSubPath);

      if (!isPermittedChannelRoute) {
        this.totalEventsRejected++;
        throw new DiscordLabSecurityError(
          `Outgoing REST route '${method} ${pathOnly}' on channel '${targetChannelId}' is unclassified or unauthorized. Fail-closed containment strictly rejects unknown routes.`
        );
      }

      // Check if target channel is a Direct Message (DM) or Group DM
      if (client) {
        const cachedChannel: any = client.channels?.cache?.get(targetChannelId);
        if (cachedChannel) {
          const isDm =
            cachedChannel.isDMBased?.() === true ||
            cachedChannel.type === 1 ||
            cachedChannel.type === 3 ||
            Boolean(cachedChannel.recipientId) ||
            Boolean(cachedChannel.recipient) ||
            (!cachedChannel.guildId && !cachedChannel.guild);

          if (isDm) {
            this.totalEventsRejected++;
            throw new DiscordLabSecurityError(
              `Outgoing REST operation '${method} ${pathOnly}' strictly blocked: DM and group-DM operations are denied in Discord Lab mode regardless of recipient membership. Permitted operations must target verified guild channels only.`
            );
          }
        }
      }

      // Verify target guild ownership for channel
      let isVerifiedInAllowedGuild = false;

      if (this.permittedChannelIds.has(targetChannelId)) {
        isVerifiedInAllowedGuild = true;
      }

      if (!isVerifiedInAllowedGuild && client) {
        const cachedChannel: any = client.channels?.cache?.get(targetChannelId);
        if (cachedChannel) {
          if (cachedChannel.guildId) {
            if (cachedChannel.guildId !== this.allowedGuildId) {
              this.totalEventsRejected++;
              throw new DiscordLabSecurityError(
                `Outgoing REST operation '${method} ${pathOnly}' strictly blocked: channel '${targetChannelId}' belongs to foreign guild '${cachedChannel.guildId}'.`
              );
            }
            isVerifiedInAllowedGuild = true;
          }
        }

        if (!isVerifiedInAllowedGuild) {
          const allowedGuild = client.guilds?.cache?.get(this.allowedGuildId);
          if (allowedGuild && allowedGuild.channels?.cache?.has(targetChannelId)) {
            isVerifiedInAllowedGuild = true;
          }
        }
      }

      // Do not trust client caches alone when target ownership is unknown.
      // Every mutation (POST, PATCH, PUT, DELETE) MUST have proven ownership in allowedGuildId.
      const isMutation = method !== 'GET';
      if (isMutation && !isVerifiedInAllowedGuild) {
        this.totalEventsRejected++;
        throw new DiscordLabSecurityError(
          `Outgoing REST mutation '${method} ${pathOnly}' strictly blocked: target guild ownership of channel '${targetChannelId}' is unverified or unknown (not found in allowed test guild '${this.allowedGuildId}'). Permitted operations must target verified guild channels only.`
        );
      }

      return;
    }

    // 5. Interaction callbacks: /interactions/:interactionId/:token/callback
    const interactionMatch = pathOnly.match(/^\/interactions\/([a-zA-Z0-9_\-]+)\/([a-zA-Z0-9_\-]+)\/callback$/);
    if (interactionMatch) {
      if (method !== 'POST') {
        this.totalEventsRejected++;
        throw new DiscordLabSecurityError(
          `Outgoing interaction callback '${method} ${pathOnly}' rejected: callbacks require POST method.`
        );
      }

      const interactionId = interactionMatch[1];
      if (!this.permittedInteractionIds.has(interactionId)) {
        this.totalEventsRejected++;
        throw new DiscordLabSecurityError(
          `Outgoing interaction callback for interaction '${interactionId}' strictly blocked: interaction was not verified from allowed test guild '${this.allowedGuildId}'.`
        );
      }

      return;
    }

    // 6. Strict Default Fail-Closed: Any unclassified route is immediately rejected
    this.totalEventsRejected++;
    throw new DiscordLabSecurityError(
      `Outgoing REST route '${method} ${pathOnly}' is unclassified or unauthorized. Fail-closed containment strictly rejects unknown routes by default.`
    );
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

      this.registerPermittedChannel(message.channelId);
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

      this.registerPermittedInteraction(interaction.id);
      if (interaction.channelId) {
        this.registerPermittedChannel(interaction.channelId);
      }

      try {
        await handlers.onPermittedInteraction(interaction);
      } catch (err: any) {
        console.error('[DiscordLabFirewall] Error in permitted interaction handler:', err);
      }
    });
  }
}
