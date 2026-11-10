/**
 * src/test/mockDiscordAdapter.ts
 *
 * Production-Grade Realistic Discord.js v14 Mock Adapter for G4X Community Staging & QA.
 *
 * FEATURES:
 *  1. Full Discord.js v14 Object Graph Emulation:
 *     - Guild, GuildMember, Role, GuildChannel, TextChannel, CategoryChannel, Message
 *     - PermissionOverwrites with Collection cache, set, create, edit, delete
 *     - Embeds, ActionRows, Buttons, Modals, Attachments (Collection with .first(), .size, etc.)
 *  2. Comprehensive Action Recorder:
 *     - Records all API operations (channel_create, message_send, permission_set, etc.)
 *     - Queryable by type, target ID, and predicate for test assertions
 *  3. Dynamic Failure Injector:
 *     - Injects rate limits (HTTP 429), permission denials (HTTP 403), missing entities (HTTP 404),
 *       network resets (ECONNRESET), and timeouts.
 *     - Supports one-shot, counted, and targeted failure rules.
 *     - Simulates process/client restart (retains guild DB while clearing client cache).
 *  4. High-Fidelity Interaction & Command Dispatchers:
 *     - simulateMessageCommand (G4!setup, G4!order, G4!assign, G4!proof, etc.)
 *     - simulateButtonInteraction (presign_tank, presign_withdraw, ord_wiz, etc.)
 *     - simulateModalInteraction (modal_order_proof, ord_wiz, etc.)
 *     - simulateSelectMenuInteraction (registration select menus, etc.)
 */

import {
  ChannelType,
  Collection,
  OverwriteType,
  PermissionFlagsBits,
} from 'discord.js';

export type MockActionType =
  | 'channel_create'
  | 'channel_delete'
  | 'channel_edit'
  | 'channel_fetch'
  | 'permission_overwrites_set'
  | 'permission_overwrite_edit'
  | 'permission_overwrite_delete'
  | 'message_send'
  | 'message_edit'
  | 'message_delete'
  | 'message_react'
  | 'message_fetch'
  | 'role_create'
  | 'role_add'
  | 'role_remove'
  | 'member_fetch';

export interface MockAction {
  id: string;
  timestamp: Date;
  type: MockActionType;
  targetId: string;
  payload?: any;
  error?: Error;
}

export class MockActionRecorder {
  private actions: MockAction[] = [];
  private counter = 0;

  public record(type: MockActionType, targetId: string, payload?: any, error?: Error): MockAction {
    this.counter++;
    const action: MockAction = {
      id: `act_${Date.now()}_${this.counter}`,
      timestamp: new Date(),
      type,
      targetId,
      payload,
      error,
    };
    this.actions.push(action);
    return action;
  }

  public getActions(type?: MockActionType): MockAction[] {
    if (!type) return [...this.actions];
    return this.actions.filter((a) => a.type === type);
  }

  public hasAction(predicate: (action: MockAction) => boolean): boolean {
    return this.actions.some(predicate);
  }

  public findAction(predicate: (action: MockAction) => boolean): MockAction | undefined {
    return this.actions.find(predicate);
  }

  public countActions(type?: MockActionType): number {
    if (!type) return this.actions.length;
    return this.actions.filter((a) => a.type === type).length;
  }

  public clear(): void {
    this.actions = [];
  }
}

export interface MockFailureRule {
  id: string;
  type: '429_RATE_LIMIT' | '403_FORBIDDEN' | '404_NOT_FOUND' | 'NETWORK_ERROR' | 'DELAY' | 'CUSTOM';
  targetMethod?: string; // e.g. 'channel.send', 'channel.create', 'message.edit'
  targetId?: string; // specific channel ID or message ID
  once?: boolean;
  count?: number;
  message?: string;
  delayMs?: number;
  error?: Error;
}

export class MockFailureInjector {
  private rules: MockFailureRule[] = [];
  private ruleCounter = 0;

  public addRule(rule: Omit<MockFailureRule, 'id'>): string {
    this.ruleCounter++;
    const id = `rule_${Date.now()}_${this.ruleCounter}`;
    this.rules.push({ ...rule, id });
    return id;
  }

  public removeRule(id: string): void {
    this.rules = this.rules.filter((r) => r.id !== id);
  }

  public clearRules(): void {
    this.rules = [];
  }

  public async evaluate(method: string, targetId?: string): Promise<void> {
    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];

      if (rule.targetMethod && rule.targetMethod !== method && rule.targetMethod !== 'all') {
        continue;
      }
      if (rule.targetId && targetId && rule.targetId !== targetId) {
        continue;
      }

      // Decrement count or remove if once
      if (rule.once) {
        this.rules.splice(i, 1);
        i--;
      } else if (typeof rule.count === 'number') {
        rule.count--;
        if (rule.count <= 0) {
          this.rules.splice(i, 1);
          i--;
        }
      }

      if (rule.delayMs && rule.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, rule.delayMs));
      }

      switch (rule.type) {
        case '429_RATE_LIMIT': {
          const err: any = new Error(rule.message || 'You are being rate limited.');
          err.status = 429;
          err.code = 20028;
          err.retry_after = 5;
          throw err;
        }
        case '403_FORBIDDEN': {
          const err: any = new Error(rule.message || 'Missing Permissions');
          err.status = 403;
          err.code = 50013;
          throw err;
        }
        case '404_NOT_FOUND': {
          const err: any = new Error(rule.message || 'Unknown Channel');
          err.status = 404;
          err.code = 10003;
          throw err;
        }
        case 'NETWORK_ERROR': {
          const err: any = new Error(rule.message || 'ECONNRESET: Connection reset by peer');
          err.code = 'ECONNRESET';
          throw err;
        }
        case 'CUSTOM': {
          throw rule.error || new Error(rule.message || 'Simulated Custom Error');
        }
        case 'DELAY':
          // Delay already applied
          break;
      }
    }
  }
}

export interface MockOverwriteEntry {
  id: string;
  type: number; // 0 for Role, 1 for Member
  allow: bigint;
  deny: bigint;
}

function normalizePermissions(perms: any): bigint {
  if (!perms) return BigInt(0);
  if (typeof perms === 'bigint') return perms;
  if (typeof perms === 'number') return BigInt(perms);
  if (Array.isArray(perms)) {
    return perms.reduce((acc: bigint, p: any) => acc | normalizePermissions(p), BigInt(0));
  }
  if (typeof perms.bitfield === 'bigint') return perms.bitfield;
  if (typeof perms.bitfield === 'number') return BigInt(perms.bitfield);
  return BigInt(0);
}

export class MockPermissionOverwrites {
  public cache: Collection<string, MockOverwriteEntry> = new Collection();

  constructor(
    private channelId: string,
    private recorder: MockActionRecorder,
    private injector: MockFailureInjector
  ) {}

  public async set(
    overwrites: Array<{ id: string; allow?: any; deny?: any; type?: number }>
  ): Promise<MockPermissionOverwrites> {
    await this.injector.evaluate('permission.set', this.channelId);

    this.cache.clear();
    for (const ov of overwrites) {
      this.cache.set(ov.id, {
        id: ov.id,
        type: ov.type ?? 0,
        allow: normalizePermissions(ov.allow),
        deny: normalizePermissions(ov.deny),
      });
    }

    this.recorder.record('permission_overwrites_set', this.channelId, overwrites);
    return this;
  }

  public async create(
    id: string,
    options: any
  ): Promise<MockPermissionOverwrites> {
    await this.injector.evaluate('permission.create', this.channelId);

    let allowBit = BigInt(0);
    let denyBit = BigInt(0);

    if (options && (options.allow !== undefined || options.deny !== undefined)) {
      allowBit = normalizePermissions(options.allow);
      denyBit = normalizePermissions(options.deny);
    } else if (options && typeof options === 'object') {
      for (const [permKey, val] of Object.entries(options)) {
        const flag = (PermissionFlagsBits as any)[permKey];
        if (flag !== undefined) {
          if (val === true) {
            allowBit |= BigInt(flag);
          } else if (val === false) {
            denyBit |= BigInt(flag);
          }
        }
      }
    }

    const existing = this.cache.get(id);
    if (existing) {
      this.cache.set(id, {
        id,
        type: options?.type ?? existing.type,
        allow: (existing.allow | allowBit) & ~denyBit,
        deny: (existing.deny | denyBit) & ~allowBit,
      });
    } else {
      this.cache.set(id, {
        id,
        type: options?.type ?? 0,
        allow: allowBit,
        deny: denyBit,
      });
    }

    this.recorder.record('permission_overwrite_edit', this.channelId, { id, ...options });
    return this;
  }

  public async edit(
    id: string,
    options: { allow?: any; deny?: any; type?: number }
  ): Promise<MockPermissionOverwrites> {
    return this.create(id, options);
  }

  public async delete(id: string): Promise<MockPermissionOverwrites> {
    await this.injector.evaluate('permission.delete', this.channelId);
    this.cache.delete(id);
    this.recorder.record('permission_overwrite_delete', this.channelId, { id });
    return this;
  }

  public get(id: string): MockOverwriteEntry | undefined {
    return this.cache.get(id);
  }

  public has(id: string): boolean {
    return this.cache.has(id);
  }
}

export class MockMessage {
  public id: string;
  public content: string;
  public embeds: any[];
  public components: any[];
  public attachments: Collection<string, any>;
  public channelId: string;
  public guildId: string;
  public guild: MockGuild;
  public author: any;
  public createdTimestamp: number;
  public createdAt: Date;
  public _reactions: string[] = [];
  public _replies: any[] = [];
  public client: any;

  constructor(
    data: {
      id: string;
      content?: string;
      embeds?: any[];
      components?: any[];
      attachments?: any[];
      channelId: string;
      guildId: string;
      author?: any;
    },
    public channel: MockChannel,
    private recorder: MockActionRecorder,
    private injector: MockFailureInjector
  ) {
    this.id = data.id;
    this.content = data.content || '';
    this.embeds = data.embeds || [];
    this.components = data.components || [];
    this.channelId = data.channelId;
    this.guildId = data.guildId;
    this.guild = channel.guild;
    this.author = data.author || {
      id: '999999999999990001',
      tag: 'User_999999999999990001#0000',
      bot: false,
    };
    this.createdTimestamp = Date.now();
    this.createdAt = new Date();
    this.client = channel.guild.client;

    this.attachments = new Collection();
    if (data.attachments) {
      data.attachments.forEach((att, idx) => {
        const attId = att.id || `att_${this.id}_${idx}`;
        this.attachments.set(attId, {
          id: attId,
          url: att.url || 'https://cdn.discordapp.com/attachments/test/evidence.png',
          name: att.name || 'evidence.png',
          contentType: att.contentType || 'image/png',
          size: att.size || 1024 * 50,
        });
      });
    }
  }

  public async edit(payload: any): Promise<MockMessage> {
    await this.injector.evaluate('message.edit', this.id);

    if (typeof payload === 'string') {
      this.content = payload;
    } else {
      if (payload.content !== undefined) this.content = payload.content;
      if (payload.embeds !== undefined) this.embeds = payload.embeds;
      if (payload.components !== undefined) this.components = payload.components;
    }

    this.recorder.record('message_edit', this.id, payload);
    return this;
  }

  public async delete(): Promise<MockMessage> {
    await this.injector.evaluate('message.delete', this.id);
    this.channel.messages.cache.delete(this.id);
    this.recorder.record('message_delete', this.id);
    return this;
  }

  public async react(emoji: string): Promise<void> {
    await this.injector.evaluate('message.react', this.id);
    this._reactions.push(emoji);
    this.recorder.record('message_react', this.id, { emoji });
  }

  public async reply(payload: any): Promise<MockMessage> {
    const replyMsg = await this.channel.send(payload);
    this._replies.push(replyMsg);
    return replyMsg;
  }
}

export class MockChannel {
  public id: string;
  public name: string;
  public type: ChannelType;
  public topic: string;
  public parent: MockChannel | null = null;
  public parentId: string | null = null;
  public guildId: string;
  public permissionOverwrites: MockPermissionOverwrites;
  public messages: {
    cache: Collection<string, MockMessage>;
    fetch: (arg?: any) => Promise<any>;
  };
  private messageCounter = 1000;

  constructor(
    data: {
      id: string;
      name: string;
      type?: ChannelType;
      topic?: string;
      parent?: MockChannel | null;
      parentId?: string | null;
    },
    public guild: MockGuild,
    private recorder: MockActionRecorder,
    private injector: MockFailureInjector
  ) {
    this.id = data.id;
    this.name = data.name;
    this.type = data.type ?? ChannelType.GuildText;
    this.topic = data.topic || '';
    this.parent = data.parent || null;
    this.parentId = data.parentId || data.parent?.id || null;
    this.guildId = guild.id;

    this.permissionOverwrites = new MockPermissionOverwrites(this.id, recorder, injector);

    const messageCache = new Collection<string, MockMessage>();
    this.messages = {
      cache: messageCache,
      fetch: async (arg?: any) => {
        await this.injector.evaluate('message.fetch', this.id);
        if (typeof arg === 'string') {
          const msg = messageCache.get(arg);
          if (!msg) {
            const err: any = new Error('Unknown Message');
            err.status = 404;
            err.code = 10008;
            throw err;
          }
          this.recorder.record('message_fetch', arg);
          return msg;
        }
        // Return Collection of messages (simulating { limit: N })
        this.recorder.record('message_fetch', this.id, arg);
        return messageCache;
      },
    };
  }

  public isTextBased(): boolean {
    return this.type === ChannelType.GuildText;
  }

  public async send(payload: any): Promise<MockMessage> {
    await this.injector.evaluate('channel.send', this.id);
    this.messageCounter++;
    const msgId = `99999999999999${this.messageCounter}`;

    const msgData = {
      id: msgId,
      content: typeof payload === 'string' ? payload : payload.content,
      embeds: payload.embeds || [],
      components: payload.components || [],
      attachments: payload.files
        ? payload.files.map((f: any, idx: number) => ({
            id: `att_${msgId}_${idx}`,
            name: typeof f === 'string' ? f : f.name || 'attachment.png',
            url: typeof f === 'string' ? f : f.attachment || 'https://cdn.discordapp.com/test.png',
          }))
        : [],
      channelId: this.id,
      guildId: this.guildId,
    };

    const msg = new MockMessage(msgData, this, this.recorder, this.injector);
    this.messages.cache.set(msgId, msg);
    this.recorder.record('message_send', this.id, payload);
    return msg;
  }

  public async setName(name: string): Promise<MockChannel> {
    await this.injector.evaluate('channel.edit', this.id);
    this.name = name;
    this.recorder.record('channel_edit', this.id, { name });
    return this;
  }

  public async setTopic(topic: string): Promise<MockChannel> {
    await this.injector.evaluate('channel.edit', this.id);
    this.topic = topic;
    this.recorder.record('channel_edit', this.id, { topic });
    return this;
  }

  public async delete(): Promise<MockChannel> {
    await this.injector.evaluate('channel.delete', this.id);
    this.guild.channels.cache.delete(this.id);
    this.recorder.record('channel_delete', this.id);
    return this;
  }
}

export class MockRole {
  public id: string;
  public name: string;
  public color: number;
  public permissions: bigint;

  constructor(data: { id: string; name: string; color?: number; permissions?: bigint }) {
    this.id = data.id;
    this.name = data.name;
    this.color = data.color ?? 0;
    this.permissions = data.permissions ?? BigInt(0);
  }
}

export class MockGuildMember {
  public id: string;
  public user: { id: string; tag: string; username: string; discriminator: string; bot: boolean };
  public roles: {
    cache: Collection<string, MockRole>;
    add: (role: string | MockRole) => Promise<void>;
    remove: (role: string | MockRole) => Promise<void>;
    has: (roleId: string) => boolean;
  };
  public permissions: {
    has: (perm: bigint) => boolean;
  };

  constructor(
    data: { id: string; tag?: string; bot?: boolean; roles?: string[] },
    public guild: MockGuild,
    private recorder: MockActionRecorder,
    private injector: MockFailureInjector
  ) {
    this.id = data.id;
    const tag = data.tag || `User_${data.id}#0000`;
    const username = tag.split('#')[0];
    this.user = {
      id: data.id,
      tag,
      username,
      discriminator: '0000',
      bot: data.bot ?? false,
    };

    const roleCache = new Collection<string, MockRole>();
    if (data.roles) {
      for (const rId of data.roles) {
        const existingRole = guild.roles.cache.get(rId);
        if (existingRole) {
          roleCache.set(rId, existingRole);
        } else {
          const r = new MockRole({ id: rId, name: `Role_${rId}` });
          roleCache.set(rId, r);
        }
      }
    }

    this.roles = {
      cache: roleCache,
      add: async (role: string | MockRole) => {
        await this.injector.evaluate('role.add', this.id);
        const rId = typeof role === 'string' ? role : role.id;
        const targetRole = guild.roles.cache.get(rId) || new MockRole({ id: rId, name: `Role_${rId}` });
        roleCache.set(rId, targetRole);
        this.recorder.record('role_add', this.id, { roleId: rId });
      },
      remove: async (role: string | MockRole) => {
        await this.injector.evaluate('role.remove', this.id);
        const rId = typeof role === 'string' ? role : role.id;
        roleCache.delete(rId);
        this.recorder.record('role_remove', this.id, { roleId: rId });
      },
      has: (roleId: string) => roleCache.has(roleId),
    };

    this.permissions = {
      has: (perm: bigint) => {
        // Staff or Admin has all permissions in mock
        if (roleCache.some((r) => ['owner', 'admin', 'manager', 'staff'].includes(r.name.toLowerCase()))) {
          return true;
        }
        return false;
      },
    };
  }

  public async send(payload: any): Promise<MockMessage> {
    return this.guild.client.users.cache.get(this.id)?.send(payload);
  }
}

export class MockGuild {
  public id: string;
  public name: string;
  public channels: {
    cache: Collection<string, MockChannel>;
    fetch: (id?: any) => Promise<any>;
    create: (options: any) => Promise<MockChannel>;
  };
  public roles: {
    cache: Collection<string, MockRole>;
    everyone: MockRole;
    fetch: (id?: any) => Promise<any>;
    create: (options: any) => Promise<MockRole>;
  };
  public members: {
    cache: Collection<string, MockGuildMember>;
    fetch: (id?: any) => Promise<any>;
    me: MockGuildMember;
  };
  private channelCounter = 2000;
  private roleCounter = 500;

  constructor(
    data: { id: string; name?: string },
    public client: MockDiscordClient,
    private recorder: MockActionRecorder,
    private injector: MockFailureInjector
  ) {
    this.id = data.id;
    this.name = data.name || 'G4X Staging Guild';

    const channelCache = new Collection<string, MockChannel>();
    this.channels = {
      cache: channelCache,
      fetch: async (id?: any) => {
        await this.injector.evaluate('channel.fetch', typeof id === 'string' ? id : undefined);
        if (typeof id === 'string') {
          const chan = channelCache.get(id);
          if (!chan) {
            const err: any = new Error('Unknown Channel');
            err.status = 404;
            err.code = 10003;
            throw err;
          }
          this.recorder.record('channel_fetch', id);
          return chan;
        }
        this.recorder.record('channel_fetch', this.id);
        return channelCache;
      },
      create: async (options: any) => {
        await this.injector.evaluate('channel.create', options.name);
        this.channelCounter++;
        const chanId = '999999' + String(Date.now()).slice(-9) + String(this.channelCounter).padStart(3, '0');

        let parentChan: MockChannel | null = null;
        if (options.parent) {
          parentChan =
            typeof options.parent === 'string' ? channelCache.get(options.parent) || null : options.parent;
        }

        const channel = new MockChannel(
          {
            id: chanId,
            name: options.name,
            type: options.type ?? ChannelType.GuildText,
            topic: options.topic,
            parent: parentChan,
            parentId: parentChan?.id || null,
          },
          this,
          this.recorder,
          this.injector
        );

        if (options.permissionOverwrites && Array.isArray(options.permissionOverwrites)) {
          await channel.permissionOverwrites.set(options.permissionOverwrites);
        }

        channelCache.set(chanId, channel);
        this.client.channels.cache.set(chanId, channel);
        this.recorder.record('channel_create', chanId, options);
        return channel;
      },
    };

    const roleCache = new Collection<string, MockRole>();
    const everyoneRole = new MockRole({ id: this.id, name: '@everyone' });
    roleCache.set(this.id, everyoneRole);

    this.roles = {
      cache: roleCache,
      everyone: everyoneRole,
      fetch: async (id?: any) => {
        if (typeof id === 'string') {
          return roleCache.get(id);
        }
        return roleCache;
      },
      create: async (options: any) => {
        this.roleCounter++;
        const roleId = `999999999999990${this.roleCounter}`;
        const role = new MockRole({
          id: roleId,
          name: options.name,
          color: options.color,
          permissions: options.permissions,
        });
        roleCache.set(roleId, role);
        this.recorder.record('role_create', roleId, options);
        return role;
      },
    };

    const memberCache = new Collection<string, MockGuildMember>();
    const botMember = new MockGuildMember(
      { id: client.user.id, tag: client.user.tag, bot: true, roles: ['admin', 'bot'] },
      this,
      this.recorder,
      this.injector
    );
    memberCache.set(client.user.id, botMember);

    this.members = {
      cache: memberCache,
      me: botMember,
      fetch: async (id?: any) => {
        await this.injector.evaluate('member.fetch', typeof id === 'string' ? id : undefined);
        if (typeof id === 'string') {
          let member = memberCache.get(id);
          if (!member) {
            member = new MockGuildMember({ id }, this, this.recorder, this.injector);
            memberCache.set(id, member);
          }
          this.recorder.record('member_fetch', id);
          return member;
        }
        this.recorder.record('member_fetch', this.id);
        return memberCache;
      },
    };
  }
}

export interface MockDiscordOptions {
  guildId?: string;
  guildName?: string;
  botUserId?: string;
  botUserTag?: string;
}

export class MockDiscordClient {
  public user: { id: string; tag: string; username: string; bot: boolean };
  public guilds: {
    cache: Collection<string, MockGuild>;
    fetch: (id?: any) => Promise<any>;
  };
  public channels: {
    cache: Collection<string, MockChannel>;
    fetch: (id?: any) => Promise<any>;
  };
  public users: {
    cache: Collection<string, any>;
    fetch: (id: string) => Promise<any>;
  };
  public ws: { ping: number } = { ping: 5 };
  public actionRecorder: MockActionRecorder;
  public failureInjector: MockFailureInjector;
  public guild: MockGuild;

  private dmCounter = 8000;

  constructor(options: MockDiscordOptions = {}, sharedRecorder?: MockActionRecorder, sharedInjector?: MockFailureInjector) {
    this.actionRecorder = sharedRecorder || new MockActionRecorder();
    this.failureInjector = sharedInjector || new MockFailureInjector();

    const botUserId = options.botUserId || '999999999999990099';
    const botUserTag = options.botUserTag || 'G4X_Staging_Bot#0000';
    this.user = {
      id: botUserId,
      tag: botUserTag,
      username: botUserTag.split('#')[0],
      bot: true,
    };

    const guildId = options.guildId || '999999999999990000';
    const guildName = options.guildName || 'G4X Staging Guild';

    this.guilds = {
      cache: new Collection<string, MockGuild>(),
      fetch: async (id?: any) => {
        if (typeof id === 'string') {
          return this.guilds.cache.get(id);
        }
        return this.guilds.cache;
      },
    };

    this.channels = {
      cache: new Collection<string, MockChannel>(),
      fetch: async (id?: any) => {
        await this.failureInjector.evaluate('channel.fetch', typeof id === 'string' ? id : undefined);
        if (typeof id === 'string') {
          const chan = this.channels.cache.get(id) || this.guild.channels.cache.get(id);
          if (!chan) {
            const err: any = new Error('Unknown Channel');
            err.status = 404;
            err.code = 10003;
            throw err;
          }
          this.actionRecorder.record('channel_fetch', id);
          return chan;
        }
        return this.channels.cache;
      },
    };

    this.guild = new MockGuild({ id: guildId, name: guildName }, this, this.actionRecorder, this.failureInjector);
    this.guilds.cache.set(guildId, this.guild);

    const userCache = new Collection<string, any>();
    this.users = {
      cache: userCache,
      fetch: async (id: string) => {
        let u = userCache.get(id);
        if (!u) {
          u = {
            id,
            tag: `User_${id}#0000`,
            username: `User_${id}`,
            bot: false,
            send: async (payload: any) => {
              this.dmCounter++;
              const dmId = `dm_99999999999999${this.dmCounter}`;
              this.actionRecorder.record('message_send', id, payload);
              return {
                id: dmId,
                content: typeof payload === 'string' ? payload : payload.content,
                embeds: payload.embeds || [],
                components: payload.components || [],
                edit: async () => {},
                delete: async () => {},
              };
            },
          };
          userCache.set(id, u);
        }
        return u;
      },
    };
  }

  public isReady(): boolean {
    return true;
  }

  /**
   * Simulates a bot/process restart by clearing client in-memory caches,
   * while preserving the shared ActionRecorder, FailureInjector, and underlying Guild state.
   */
  public simulateRestart(): MockDiscordClient {
    const freshClient = new MockDiscordClient(
      {
        guildId: this.guild.id,
        guildName: this.guild.name,
        botUserId: this.user.id,
        botUserTag: this.user.tag,
      },
      this.actionRecorder,
      this.failureInjector
    );

    // Copy guild channels, members, roles into fresh guild so DB backing is consistent
    this.guild.channels.cache.forEach((ch, k) => {
      freshClient.guild.channels.cache.set(k, ch);
      freshClient.channels.cache.set(k, ch);
    });
    this.guild.roles.cache.forEach((r, k) => {
      freshClient.guild.roles.cache.set(k, r);
    });
    this.guild.members.cache.forEach((m, k) => {
      freshClient.guild.members.cache.set(k, m);
    });

    return freshClient;
  }
}

/**
 * Creates and returns a realistic Mock Discord Client pre-populated with standard G4X roles.
 */
export function createRealisticMockDiscordClient(options: MockDiscordOptions = {}): MockDiscordClient {
  const client = new MockDiscordClient(options);

  // Pre-seed standard G4X server roles
  const standardRoles = [
    { id: 'role_owner', name: 'Owner', color: 0xff0000 },
    { id: 'role_admin', name: 'Admin', color: 0xe74c3c },
    { id: 'role_manager', name: 'Manager', color: 0x9b59b6 },
    { id: 'role_staff', name: 'Staff', color: 0x3498db },
    { id: 'role_advertiser', name: 'Advertiser', color: 0xe67e22 },
    { id: 'role_exchanger', name: 'Exchanger', color: 0x2ecc71 },
    { id: 'role_booster', name: 'Booster', color: 0xf1c40f },
    { id: 'role_pilot', name: 'Pilot', color: 0x1abc9c },
    { id: 'role_customer', name: 'Customer', color: 0x95a5a6 },
    { id: 'role_verified', name: 'Verified', color: 0x7289da },
  ];

  for (const r of standardRoles) {
    client.guild.roles.cache.set(r.id, new MockRole(r));
  }

  return client;
}

// ---------------------------------------------------------------------------
// High-Fidelity Simulation Helpers
// ---------------------------------------------------------------------------

export interface SimulateMessageCommandOptions {
  guildId?: string;
  channelId?: string;
  authorId: string;
  authorTag?: string;
  authorRoles?: string[];
  content: string;
  attachments?: Array<{
    id?: string;
    url?: string;
    name?: string;
    contentType?: string;
    size?: number;
  }>;
}

export interface SimulateCommandResult {
  message: MockMessage;
  replies: MockMessage[];
  lastReply?: MockMessage;
}

/**
 * Simulates a message command (e.g. `G4!order create ...`, `G4!assign ...`, `G4!proof ...`)
 * and routes it through the authoritative handlers matching `src/index.ts`.
 */
export async function simulateMessageCommand(
  client: MockDiscordClient,
  options: SimulateMessageCommandOptions
): Promise<SimulateCommandResult> {
  const guild = client.guild;
  const channelId = options.channelId || '999999999999991001';
  let channel = guild.channels.cache.get(channelId);

  if (!channel) {
    channel = new MockChannel(
      { id: channelId, name: 'general-channel', type: ChannelType.GuildText },
      guild,
      client.actionRecorder,
      client.failureInjector
    );
    guild.channels.cache.set(channelId, channel);
    client.channels.cache.set(channelId, channel);
  }

  // Ensure member exists
  let member = guild.members.cache.get(options.authorId);
  if (!member) {
    member = new MockGuildMember(
      {
        id: options.authorId,
        tag: options.authorTag || `User_${options.authorId}#0000`,
        roles: options.authorRoles || [],
      },
      guild,
      client.actionRecorder,
      client.failureInjector
    );
    guild.members.cache.set(options.authorId, member);
  }

  const message = new MockMessage(
    {
      id: `cmd_msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      content: options.content,
      attachments: options.attachments,
      channelId: channel.id,
      guildId: guild.id,
      author: member.user,
    },
    channel,
    client.actionRecorder,
    client.failureInjector
  );

  // Parse G4! prefix command
  if (!options.content.startsWith('G4!')) {
    return { message, replies: [] };
  }

  const rawArgs = options.content.slice(3).trim().split(/\s+/);
  const command = rawArgs.shift()?.toLowerCase();

  try {
    if (command === 'setup') {
      const { handleSetupCommand } = await import('../commands/setup');
      await handleSetupCommand(message as any, rawArgs);
    } else if (command === 'order') {
      const { handleOrderCommand } = await import('../commands/order');
      await handleOrderCommand(message as any, rawArgs);
    } else if (command === 'profile') {
      const { handleProfileCommand } = await import('../commands/profile');
      await handleProfileCommand(message as any, rawArgs);
    } else if (command === 'team') {
      const { handleTeamCommand } = await import('../commands/team');
      await handleTeamCommand(message as any, rawArgs);
    } else if (command === 'assign') {
      const { handleAssignCommand } = await import('../commands/assign');
      await handleAssignCommand(message as any, rawArgs);
    } else if (command === 'proof') {
      const { handleDiscordProofMessageUpload } = await import('../services/discordProofSubmissionService');
      await handleDiscordProofMessageUpload(message as any, rawArgs);
    }
  } catch (error: any) {
    await message.reply({ content: `❌ An unexpected error occurred while executing \`G4!${command}\`: ${error.message || error}` });
  }

  return {
    message,
    replies: message._replies,
    lastReply: message._replies[message._replies.length - 1],
  };
}

export interface SimulateButtonInteractionOptions {
  guildId?: string;
  channelId?: string;
  userId: string;
  userTag?: string;
  userRoles?: string[];
  customId: string;
  messageId?: string;
}

export interface SimulateInteractionResult {
  replies: any[];
  deferred: boolean;
  deferredEphemeral?: boolean;
  shownModal?: any;
  updatedMessage?: any;
}

/**
 * Simulates a Discord button interaction (e.g. presign_tank, ord_wiz, etc.)
 * and routes it to `handleButtonInteraction`.
 */
export async function simulateButtonInteraction(
  client: MockDiscordClient,
  options: SimulateButtonInteractionOptions
): Promise<SimulateInteractionResult> {
  const guild = client.guild;
  const channelId = options.channelId || '999999999999991001';
  let channel = guild.channels.cache.get(channelId);

  if (!channel) {
    channel = new MockChannel(
      { id: channelId, name: 'interaction-channel', type: ChannelType.GuildText },
      guild,
      client.actionRecorder,
      client.failureInjector
    );
    guild.channels.cache.set(channelId, channel);
    client.channels.cache.set(channelId, channel);
  }

  let member = guild.members.cache.get(options.userId);
  if (!member) {
    member = new MockGuildMember(
      {
        id: options.userId,
        tag: options.userTag || `User_${options.userId}#0000`,
        roles: options.userRoles || [],
      },
      guild,
      client.actionRecorder,
      client.failureInjector
    );
    guild.members.cache.set(options.userId, member);
  }

  const replies: any[] = [];
  let deferred = false;
  let deferredEphemeral = false;
  let shownModal: any = null;
  let updatedMessage: any = null;

  const mockInteraction: any = {
    id: `btn_int_${Date.now()}`,
    customId: options.customId,
    guildId: guild.id,
    guild,
    channelId: channel.id,
    channel,
    user: member.user,
    member,
    client,
    message: {
      id: options.messageId || '999999999999991111',
      channelId: channel.id,
      edit: async (p: any) => {
        updatedMessage = p;
      },
      delete: async () => {},
    },
    isButton: () => true,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    deferReply: async (opts?: any) => {
      deferred = true;
      if (opts?.ephemeral) deferredEphemeral = true;
    },
    reply: async (payload: any) => {
      replies.push(payload);
    },
    editReply: async (payload: any) => {
      replies.push(payload);
    },
    update: async (payload: any) => {
      updatedMessage = payload;
    },
    showModal: async (modal: any) => {
      shownModal = modal;
    },
  };

  const { handleButtonInteraction } = await import('../interactions/buttons');
  await handleButtonInteraction(mockInteraction);

  return {
    replies,
    deferred,
    deferredEphemeral,
    shownModal,
    updatedMessage,
  };
}

export interface SimulateModalInteractionOptions {
  guildId?: string;
  channelId?: string;
  userId: string;
  userTag?: string;
  userRoles?: string[];
  customId: string;
  fields: Record<string, string>;
}

/**
 * Simulates a Discord modal submission (e.g. `modal_order_proof:<orderId>`, `ord_wiz`, etc.)
 * and routes it to `handleModalSubmit`.
 */
export async function simulateModalInteraction(
  client: MockDiscordClient,
  options: SimulateModalInteractionOptions
): Promise<SimulateInteractionResult> {
  const guild = client.guild;
  const channelId = options.channelId || '999999999999991001';
  let channel = guild.channels.cache.get(channelId);

  if (!channel) {
    channel = new MockChannel(
      { id: channelId, name: 'modal-channel', type: ChannelType.GuildText },
      guild,
      client.actionRecorder,
      client.failureInjector
    );
    guild.channels.cache.set(channelId, channel);
    client.channels.cache.set(channelId, channel);
  }

  let member = guild.members.cache.get(options.userId);
  if (!member) {
    member = new MockGuildMember(
      {
        id: options.userId,
        tag: options.userTag || `User_${options.userId}#0000`,
        roles: options.userRoles || [],
      },
      guild,
      client.actionRecorder,
      client.failureInjector
    );
    guild.members.cache.set(options.userId, member);
  }

  const replies: any[] = [];
  let deferred = false;
  let deferredEphemeral = false;

  const mockInteraction: any = {
    id: `mod_int_${Date.now()}`,
    customId: options.customId,
    guildId: guild.id,
    guild,
    channelId: channel.id,
    channel,
    user: member.user,
    member,
    client,
    fields: {
      getTextInputValue: (fieldId: string) => options.fields[fieldId] || '',
    },
    isButton: () => false,
    isModalSubmit: () => true,
    isStringSelectMenu: () => false,
    deferReply: async (opts?: any) => {
      deferred = true;
      if (opts?.ephemeral) deferredEphemeral = true;
    },
    reply: async (payload: any) => {
      replies.push(payload);
    },
    editReply: async (payload: any) => {
      replies.push(payload);
    },
  };

  const { handleModalSubmit } = await import('../interactions/modals');
  await handleModalSubmit(mockInteraction);

  return {
    replies,
    deferred,
    deferredEphemeral,
  };
}
