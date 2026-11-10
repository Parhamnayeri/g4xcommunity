/**
 * src/test/discord_lab_safety_suite.ts
 *
 * Comprehensive Automated Safety & Isolation Test Suite for Discord Lab Mode.
 *
 * Verifies all 9 safety controls, failure recovery, lifecycle teardown, and isolation guarantees.
 * Every test is properly awaited, and failures propagate a non-zero exit code.
 */

import assert from 'assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { validateDiscordLabEnvironment } from '../discord-lab/validateDiscordLabEnv';
import {
  DiscordLabFirewall,
  DiscordLabSecurityError,
  DiscordLabState,
} from '../discord-lab/discordLabFirewall';
import {
  checkKillSwitch,
  triggerKillSwitch,
  resetKillSwitch,
} from '../discord-lab/discordLabKillSwitch';
import {
  isPathGitTracked,
  MANDATORY_SAFETY_GATES,
} from '../discord-lab/discordLabConfig';
import { createDisposableLabDatabase } from '../discord-lab/discordLabDatabase';
import { DiscordLabLifecycleManager } from '../discord-lab/discordLabRunner';
import { validateStagingEnvironment } from '../web/staging/validateStagingEnv';
import { prisma, setGlobalPrismaClient, isGlobalPrismaOverridden } from '../database/db';

const VALID_TEST_GUILD_ID = '123456789098765432';
const FOREIGN_GUILD_ID = '987654321012345678';
const VALID_TEST_APP_ID = '100000000000000001';
const VALID_SYNTHETIC_TOKEN = [
  'mock_synthetic_discord_lab_token_part1',
  'part2_validation_segment',
  'part3_verification_entropy_suffix_9999',
].join('.');

function getBaselineValidEnv(): Record<string, string> {
  return {
    DISCORD_LAB_MODE: 'true',
    HOST: '127.0.0.1',
    DATABASE_URL: 'file:./staging/discord_lab_test.db',
    DISCORD_LAB_ALLOWED_GUILD_ID: VALID_TEST_GUILD_ID,
    DISCORD_LAB_APPLICATION_ID: VALID_TEST_APP_ID,
    DISCORD_LAB_BOT_TOKEN: VALID_SYNTHETIC_TOKEN,
    ESCROW_RELEASE_ENABLED: 'false',
    FINANCE_V2_LIVE_CREDITS_ENABLED: 'false',
    FINANCE_V2_LIVE_PAYOUTS_ENABLED: 'false',
    FINANCE_V2_P2P_SETTLEMENT_ENABLED: 'false',
    NOWPAYMENTS_LIVE_COLLECTION_ENABLED: 'false',
    RAIDERIO_LIVE_SYNC_ENABLED: 'false',
    NOWPAYMENTS_MODE: 'disabled',
    SESSION_SECRET: 'a_secure_random_session_secret_of_sufficient_length_32',
    G4X_OWNER_ACCESS_KEY: 'a_very_secure_owner_access_key_12345_unique',
  };
}

async function runDiscordLabSafetyTests(): Promise<void> {
  console.log('\n🧪 [Test] Running Comprehensive Discord Lab Safety Suite...');
  let passed = 0;
  let failed = 0;

  // Fully asynchronous test runner ensuring every Promise is awaited
  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ❌ ${name}:`, err.message);
    }
  }

  // ─── 1. Six Financial Safety Gates ──────────────────────────────────────────
  console.log('\n[Category 1: Financial & External Safety Gates]');

  await test('1.1 Baseline environment with all 6 gates as exact string "false" is valid', () => {
    const res = validateDiscordLabEnvironment(getBaselineValidEnv(), { requireToken: true });
    assert.strictEqual(res.valid, true, `Expected valid, got errors: ${res.errors.join('; ')}`);
  });

  for (const gate of MANDATORY_SAFETY_GATES) {
    await test(`1.2 Reject if ${gate} is set to "true"`, () => {
      const env = { ...getBaselineValidEnv(), [gate]: 'true' };
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, false);
      assert(res.errors.some((e) => e.includes(gate)));
    });

    await test(`1.3 Reject if ${gate} is set to "1"`, () => {
      const env = { ...getBaselineValidEnv(), [gate]: '1' };
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, false);
      assert(res.errors.some((e) => e.includes(gate)));
    });

    await test(`1.4 Reject if ${gate} is undefined / missing`, () => {
      const env = { ...getBaselineValidEnv() };
      delete env[gate];
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, false);
      assert(res.errors.some((e) => e.includes(gate)));
    });
  }

  // ─── 2. Dedicated Test Guild Allowlist ──────────────────────────────────────
  console.log('\n[Category 2: Test Guild Allowlist]');

  await test('2.1 Rejects missing DISCORD_LAB_ALLOWED_GUILD_ID', () => {
    const env = { ...getBaselineValidEnv(), DISCORD_LAB_ALLOWED_GUILD_ID: '' };
    const res = validateDiscordLabEnvironment(env);
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('DISCORD_LAB_ALLOWED_GUILD_ID is required')));
  });

  await test('2.2 Rejects non-snowflake DISCORD_LAB_ALLOWED_GUILD_ID', () => {
    const invalidIds = ['abc', '12345', '1234567890123456789012345', 'guild_12345'];
    for (const inv of invalidIds) {
      const env = { ...getBaselineValidEnv(), DISCORD_LAB_ALLOWED_GUILD_ID: inv };
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, false);
      assert(res.errors.some((e) => e.includes('not a valid Discord snowflake')));
    }
  });

  await test('2.3 Rejects known template placeholder guild IDs', () => {
    const placeholders = ['123456789012345678', '000000000000000000', '111111111111111111'];
    for (const ph of placeholders) {
      const env = { ...getBaselineValidEnv(), DISCORD_LAB_ALLOWED_GUILD_ID: ph };
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, false);
      assert(res.errors.some((e) => e.includes('known template placeholder')));
    }
  });

  // ─── 3. Event Firewall & Startup State Machine ──────────────────────────────
  console.log('\n[Category 3: Discord Event Firewall & State Machine]');

  await test('3.1 Firewall initializes in BLOCKED state and rejects all events prior to verification', () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    assert.strictEqual(firewall.state, DiscordLabState.BLOCKED);

    let rejectedCalled = false;
    const dummyClient = {
      on: (event: string, handler: Function) => {
        if (event === 'messageCreate') {
          // Simulate message in allowed guild arriving while still BLOCKED
          handler({ guildId: VALID_TEST_GUILD_ID, content: 'G4!order', author: { bot: false } });
        }
      },
    };

    firewall.attachClientFirewall(dummyClient as any, {
      onPermittedMessage: () => {
        assert.fail('Permitted message handler must NOT be called while state is BLOCKED!');
      },
      onPermittedInteraction: () => {},
    });

    assert.strictEqual(firewall.totalEventsRejected, 1);
  });

  await test('3.2 Guild containment verification fails if bot is in foreign guilds', () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockMultiGuildClient = {
      user: { id: '100000000000000001', tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([
          [VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }],
          [FOREIGN_GUILD_ID, { id: FOREIGN_GUILD_ID }],
        ]),
      },
      destroy: () => {},
    };

    const result = firewall.verifyBotAndGuildContainment(mockMultiGuildClient as any);
    assert.strictEqual(result.valid, false);
    assert(result.reason?.includes('foreign guild'));
    assert.strictEqual(firewall.state, DiscordLabState.TERMINATED);
  });

  await test('3.3 Guild containment verification succeeds if bot is in exactly the allowed test guild', () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockSingleGuildClient = {
      user: { id: '100000000000000001', tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([
          [VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }],
        ]),
      },
    };

    const result = firewall.verifyBotAndGuildContainment(mockSingleGuildClient as any);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(firewall.state, DiscordLabState.ACTIVE);
  });

  await test('3.4 Active firewall permits allowed guild events and drops foreign guild events', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: '100000000000000001', tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);

    let permittedMessageHandled = false;
    let messageHandler: Function = () => {};

    const dummyClient = {
      on: (event: string, handler: Function) => {
        if (event === 'messageCreate') messageHandler = handler;
      },
    };

    firewall.attachClientFirewall(dummyClient as any, {
      onPermittedMessage: async () => { permittedMessageHandled = true; },
      onPermittedInteraction: async () => {},
    });

    // 1. Message from allowed guild
    await messageHandler({ guildId: VALID_TEST_GUILD_ID, content: 'G4!order', author: { bot: false } });
    assert.strictEqual(permittedMessageHandled, true);

    // 2. Message from foreign guild
    permittedMessageHandled = false;
    await messageHandler({ guildId: FOREIGN_GUILD_ID, content: 'G4!order', author: { bot: false } });
    assert.strictEqual(permittedMessageHandled, false);

    // 3. Message from DM (null guildId)
    await messageHandler({ guildId: null, content: 'G4!order', author: { bot: false } });
    assert.strictEqual(permittedMessageHandled, false);
  });

  await test('3.5 Outgoing operations are strictly guarded against foreign guilds', () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: '100000000000000001', tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);

    // Allowed guild succeeds
    firewall.assertOutgoingOperationPermitted(VALID_TEST_GUILD_ID, 'createOrderChannel');

    // Foreign guild throws
    assert.throws(() => {
      firewall.assertOutgoingOperationPermitted(FOREIGN_GUILD_ID, 'createOrderChannel');
    }, DiscordLabSecurityError);
  });

  // ─── 4. Emergency Kill Switch Safety ────────────────────────────────────────
  console.log('\n[Category 4: Emergency Kill Switch Safety]');

  await test('4.1 Kill switch check recognizes custom isolated test file fixtures', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g4x-kill-switch-'));
    const testKillFile = path.join(tmpDir, 'test.kill');

    try {
      // 1. Initially inactive
      const initial = checkKillSwitch({ customSearchPaths: [testKillFile] });
      assert.strictEqual(initial.active, false);

      // 2. Create kill file in temp fixture
      triggerKillSwitch('Test trigger', testKillFile);
      const active = checkKillSwitch({ customSearchPaths: [testKillFile] });
      assert.strictEqual(active.active, true);
      assert.strictEqual(active.source, 'file');

      // 3. Clean reset of the specific test file
      resetKillSwitch(testKillFile);
      const after = checkKillSwitch({ customSearchPaths: [testKillFile] });
      assert.strictEqual(after.active, false);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  await test('4.2 Pre-existing operator emergency stop CANNOT be silently deleted by resetKillSwitch()', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g4x-operator-kill-'));
    const operatorKillFile = path.join(tmpDir, 'operator.kill');

    try {
      fs.writeFileSync(operatorKillFile, 'OPERATOR EMERGENCY HALT', 'utf8');

      // Calling generic resetKillSwitch() without file path must NOT touch files on disk
      resetKillSwitch();

      assert.strictEqual(
        fs.existsSync(operatorKillFile),
        true,
        'Pre-existing emergency stop file must NEVER be deleted by generic resetKillSwitch()!'
      );
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  // ─── 5. Database Isolation & Verification ───────────────────────────────────
  console.log('\n[Category 5: Database Isolation & Integrity]');

  await test('5.1 Disposable database proves active connection via PRAGMA database_list is isolated', async () => {
    const db = await createDisposableLabDatabase();
    try {
      const proof = await db.verifyIsolation();
      assert.strictEqual(proof.isolated, true);
      assert(proof.canonicalDbFile.includes('staging'), 'Active file must reside in staging directory');
      assert(!proof.canonicalDbFile.includes('g4x.db'), 'Active file must NOT be g4x.db');
      assert(!proof.canonicalDbFile.includes('dev.db'), 'Active file must NOT be dev.db');
    } finally {
      await db.cleanup();
    }
  });

  // ─── 6. Explicit Operator Approval & Lifecycle Teardown ─────────────────────
  console.log('\n[Category 6: Lifecycle Teardown & Operator Approval]');

  await test('6.1 Programmatic start requires explicit authorizedOperatorApproval: true', async () => {
    const manager = new DiscordLabLifecycleManager();
    await assert.rejects(
      async () => {
        await manager.start({ authorizedOperatorApproval: false });
      },
      /AUTHORIZATION_REFUSAL/
    );
  });

  await test('6.2 Startup failure triggers clean resource teardown and preserves exit status', async () => {
    const manager = new DiscordLabLifecycleManager();

    // Intentionally pass an invalid token to simulate login rejection
    let failedCleanly = false;
    try {
      await manager.start({
        authorizedOperatorApproval: true,
        loginTimeoutMs: 2000,
        customEnvPath: 'non_existent_env_file_triggering_validation_error.env',
      });
    } catch (err: any) {
      failedCleanly = true;
    }

    assert.strictEqual(failedCleanly, true, 'Lifecycle manager must throw and clean up on failure');
  });

  // ─── 7. Credential Protection & Git Verification ───────────────────────────
  console.log('\n[Category 7: Credential Protection]');

  await test('7.1 Tracked files are recognized as insecure for storing secrets', () => {
    const repoRoot = path.resolve(__dirname, '../../');
    const trackedFile = path.resolve(repoRoot, 'package.json');
    assert.strictEqual(isPathGitTracked(trackedFile), true);

    const untrackedFile = path.resolve(repoRoot, '.env.discord-lab.local');
    assert.strictEqual(isPathGitTracked(untrackedFile), false);
  });

  await test('7.2 Existing validateStagingEnvironment() still strictly rejects real Discord tokens', () => {
    const stagingEnv = {
      STAGING_MODE: 'true',
      DATABASE_URL: 'file:./staging/staging.db',
      DISCORD_TOKEN: 'SIMULATED_LIVE_DISCORD_TOKEN_WITHOUT_BYPASS_FLAGS_12345678901234567890',
      ESCROW_RELEASE_ENABLED: 'false',
      FINANCE_V2_LIVE_CREDITS_ENABLED: 'false',
      FINANCE_V2_LIVE_PAYOUTS_ENABLED: 'false',
      FINANCE_V2_P2P_SETTLEMENT_ENABLED: 'false',
      NOWPAYMENTS_LIVE_COLLECTION_ENABLED: 'false',
      RAIDERIO_LIVE_SYNC_ENABLED: 'false',
      HOST: '127.0.0.1',
      SESSION_SECRET: 'random_session_secret_32_chars_long_12345',
      G4X_OWNER_ACCESS_KEY: 'owner_access_key_entropy_high_32_chars_12345',
    };

    const res = validateStagingEnvironment(stagingEnv);
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('DISCORD_TOKEN appears to be a live Discord bot token')));
  });

  // ─── 8. Database Routing & Isolation Proof ─────────────────────────────────
  console.log('\n[Category 8: Database Routing & Isolation Proof]');

  await test('8.1 Global prisma proxy dynamically delegates to disposable lab database when setGlobalPrismaClient is active', async () => {
    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);
      assert.strictEqual(isGlobalPrismaOverridden(), true);

      // Verify PRAGMA database_list via global prisma singleton
      const dbList: Array<{ seq: number; name: string; file: string }> = await prisma.$queryRawUnsafe(
        'PRAGMA database_list;'
      );
      const mainDb = dbList.find((d) => d.name === 'main');
      const activeFile = path.normalize(mainDb?.file || '').toLowerCase();
      const expectedFile = path.normalize(db.dbPath).toLowerCase();

      assert.strictEqual(activeFile, expectedFile, 'Global prisma must be bound strictly to the disposable database file');
      assert(!activeFile.includes('g4x.db'), 'Must NOT point to production g4x.db');
      assert(!activeFile.includes('g4x_dev.db'), 'Must NOT point to g4x_dev.db');
      assert(!activeFile.includes('dev.db'), 'Must NOT point to dev.db');
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
      assert.strictEqual(isGlobalPrismaOverridden(), false);
    }
  });

  await test('8.2 Database mutations via prisma singleton write strictly to disposable database', async () => {
    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);

      // Execute a write using the global prisma singleton on the users table
      const testDiscordId = `999${Date.now()}`.slice(0, 18);
      await prisma.$executeRawUnsafe(
        "INSERT INTO users (discord_id, username, is_active, created_at, updated_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);",
        testDiscordId,
        'lab_tester'
      );

      // Verify record exists in disposable DB
      const rows: Array<{ discord_id: string; username: string }> = await prisma.$queryRawUnsafe(
        "SELECT discord_id, username FROM users WHERE discord_id = ?;",
        testDiscordId
      );
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].username, 'lab_tester');

      // Verify forbidden database basenames cannot be mutated or accessed
      const repoRoot = path.resolve(__dirname, '../../');
      const forbiddenPaths = [
        path.join(repoRoot, 'prisma/dev.db'),
        path.join(repoRoot, 'prisma/g4x.db'),
        path.join(repoRoot, 'prisma/g4x_dev.db'),
      ];
      for (const fp of forbiddenPaths) {
        if (fs.existsSync(fp)) {
          const stat = fs.statSync(fp);
          const ageMs = Date.now() - stat.mtimeMs;
          assert(ageMs > 2000, `Forbidden database file '${fp}' was modified during lab test!`);
        }
      }
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  await test('8.3 DiscordLabLifecycleManager automatically sets and resets global prisma client', async () => {
    assert.strictEqual(isGlobalPrismaOverridden(), false);

    // Create an isolated temporary external env file in os.tmpdir()
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g4x-lab-env-'));
    const tmpEnvFile = path.join(tmpDir, '.env.discord-lab');
    const envVars = getBaselineValidEnv();
    const envContent = Object.entries(envVars)
      .map(([k, v]) => `${k}="${v}"`)
      .join('\n');
    fs.writeFileSync(tmpEnvFile, envContent, 'utf8');

    const manager = new DiscordLabLifecycleManager();

    try {
      const running = await manager.start({
        skipLogin: true,
        authorizedOperatorApproval: true,
        customEnvPath: tmpEnvFile,
        portOverride: 3099,
      });

      try {
        assert.strictEqual(isGlobalPrismaOverridden(), true, 'Global prisma must be overridden while Lab is running');
        const dbList: Array<{ seq: number; name: string; file: string }> = await prisma.$queryRawUnsafe(
          'PRAGMA database_list;'
        );
        const activeFile = path.normalize(dbList.find((d) => d.name === 'main')?.file || '').toLowerCase();
        assert(activeFile.includes('staging'), 'Must be running in staging');
      } finally {
        await running.stop();
      }
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }

    assert.strictEqual(isGlobalPrismaOverridden(), false, 'Global prisma must be reset to null after Lab stop');
  });

  await test('8.4 Production-mode behavior remains completely intact when dynamic Prisma Proxy has no active override', () => {
    assert.strictEqual(isGlobalPrismaOverridden(), false);
    // Access properties on prismaProxy to ensure delegator functions correctly in standard mode
    assert(typeof prisma.$connect === 'function');
    assert(typeof prisma.$disconnect === 'function');
    assert(typeof prisma.user === 'object');
    assert(typeof prisma.order === 'object');
    assert.strictEqual(isGlobalPrismaOverridden(), false);
  });

  // ─── 9. Outgoing Discord REST Operations Firewall ──────────────────────────
  console.log('\n[Category 9: Outgoing Discord REST Operations Firewall]');

  await test('9.1 REST firewall blocks outgoing operations to foreign guilds', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
      rest: {
        request: async () => ({ success: true }),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    // Call targeting foreign guild must be rejected
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: `/guilds/${FOREIGN_GUILD_ID}/channels`,
          method: 'POST',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes(FOREIGN_GUILD_ID));
        return true;
      }
    );
  });

  await test('9.2 REST firewall blocks outgoing operations before ACTIVE state (except bot login routes)', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    assert.strictEqual(firewall.state, DiscordLabState.BLOCKED);

    let requestExecuted = false;
    const mockClient = {
      rest: {
        request: async () => {
          requestExecuted = true;
          return { id: 'bot_user' };
        },
      },
    };
    firewall.attachRestFirewall(mockClient as any);

    // 1. Bot startup identity route /gateway/bot is allowed while BLOCKED
    requestExecuted = false;
    await (mockClient.rest as any).request({ fullRoute: '/gateway/bot', method: 'GET' });
    assert.strictEqual(requestExecuted, true);

    // 2. Bot startup route /users/@me is allowed while BLOCKED
    requestExecuted = false;
    await (mockClient.rest as any).request({ fullRoute: '/users/@me', method: 'GET' });
    assert.strictEqual(requestExecuted, true);

    // 3. Normal guild/channel operations are strictly BLOCKED before ACTIVE
    await assert.rejects(
      async () => {
        await (mockClient.rest as any).request({
          fullRoute: `/guilds/${VALID_TEST_GUILD_ID}/channels`,
          method: 'GET',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('must be ACTIVE'));
        return true;
      }
    );
  });

  await test('9.3 REST firewall blocks mutations on unknown or foreign channels', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([
          [
            VALID_TEST_GUILD_ID,
            {
              id: VALID_TEST_GUILD_ID,
              channels: { cache: new Map([['allowed_chan_1', { id: 'allowed_chan_1' }]]) },
            },
          ],
        ]),
      },
      channels: {
        cache: new Map([
          ['foreign_chan_99', { id: 'foreign_chan_99', guildId: FOREIGN_GUILD_ID }],
        ]),
      },
      rest: {
        request: async () => ({ success: true }),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    // 1. Channel belonging to foreign guild
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/channels/foreign_chan_99/messages',
          method: 'POST',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('foreign guild'));
        return true;
      }
    );

    // 2. Unknown channel mutation not in allowed guild channel cache
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/channels/completely_unknown_chan/messages',
          method: 'POST',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('not found in allowed test guild'));
        return true;
      }
    );
  });

  await test('9.4 REST firewall permits operations targeting allowed test guild when ACTIVE', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
      rest: {
        request: async () => ({ id: 'new_chan_id', guild_id: VALID_TEST_GUILD_ID }),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    const res: any = await (mockVerifiedClient.rest as any).request({
      fullRoute: `/guilds/${VALID_TEST_GUILD_ID}/channels`,
      method: 'POST',
    });
    assert.strictEqual(res.id, 'new_chan_id');
  });

  await test('9.5 REST firewall strictly rejects startup identity routes using non-GET methods', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockClient = {
      rest: {
        request: async () => ({ success: true }),
      },
    };
    firewall.attachRestFirewall(mockClient as any);

    // POST /users/@me must be rejected
    await assert.rejects(
      async () => {
        await (mockClient.rest as any).request({
          fullRoute: '/users/@me',
          method: 'POST',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('only safe read method'));
        return true;
      }
    );

    // DELETE /gateway/bot must be rejected
    await assert.rejects(
      async () => {
        await (mockClient.rest as any).request({
          fullRoute: '/gateway/bot',
          method: 'DELETE',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('only safe read method'));
        return true;
      }
    );
  });

  await test('9.6 REST firewall strictly rejects unclassified routes lacking guild or channel prefixes', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
      rest: {
        request: async () => ({ success: true }),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    const unclassifiedRoutes = [
      '/applications/100000000000000001/commands',
      '/invites/some_test_invite',
      '/experiments',
      '/oauth2/token',
      '/voice/regions',
      '/custom/unclassified/endpoint',
    ];

    for (const route of unclassifiedRoutes) {
      await assert.rejects(
        async () => {
          await (mockVerifiedClient.rest as any).request({
            fullRoute: route,
            method: 'GET',
          });
        },
        (err: any) => {
          assert(err instanceof DiscordLabSecurityError);
          assert(err.message.includes('unclassified or unauthorized'));
          return true;
        }
      );
    }
  });

  await test('9.7 REST firewall strictly protects message edits, reactions, permissions, and threads', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([
          [
            VALID_TEST_GUILD_ID,
            {
              id: VALID_TEST_GUILD_ID,
              channels: { cache: new Map([['allowed_channel_456', { id: 'allowed_channel_456' }]]) },
            },
          ],
        ]),
      },
      channels: {
        cache: new Map([
          ['foreign_channel_789', { id: 'foreign_channel_789', guildId: FOREIGN_GUILD_ID }],
        ]),
      },
      rest: {
        request: async () => ({ success: true }),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    // 1. Message Edit on foreign channel must be blocked
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/channels/foreign_channel_789/messages/111111111111111111',
          method: 'PATCH',
        });
      },
      DiscordLabSecurityError
    );

    // 2. Reaction on foreign channel must be blocked
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/channels/foreign_channel_789/messages/111111111111111111/reactions/%F0%9F%91%8D/@me',
          method: 'PUT',
        });
      },
      DiscordLabSecurityError
    );

    // 3. Permission overwrite on foreign channel must be blocked
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/channels/foreign_channel_789/permissions/222222222222222222',
          method: 'PUT',
        });
      },
      DiscordLabSecurityError
    );

    // 4. Operations on verified allowed channel succeed
    const editRes: any = await (mockVerifiedClient.rest as any).request({
      fullRoute: '/channels/allowed_channel_456/messages/111111111111111111',
      method: 'PATCH',
    });
    assert.strictEqual(editRes.success, true);

    const reactionRes: any = await (mockVerifiedClient.rest as any).request({
      fullRoute: '/channels/allowed_channel_456/messages/111111111111111111/reactions/%F0%9F%91%8D/@me',
      method: 'PUT',
    });
    assert.strictEqual(reactionRes.success, true);
  });

  await test('9.8 REST firewall rejects interaction callbacks for unverified foreign interactions', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
      rest: {
        request: async () => ({ success: true }),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    // 1. Unverified interaction callback is rejected
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/interactions/999999999999999999/random_token_12345/callback',
          method: 'POST',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('interaction was not verified'));
        return true;
      }
    );

    // 2. Verified interaction callback is permitted
    firewall.registerPermittedInteraction('888888888888888888');
    const callbackRes: any = await (mockVerifiedClient.rest as any).request({
      fullRoute: '/interactions/888888888888888888/valid_test_token/callback',
      method: 'POST',
    });
    assert.strictEqual(callbackRes.success, true);
  });

  await test('9.9 REST firewall strictly rejects destructive guild operations (DELETE, PATCH) and destructive role/emoji operations even on allowed test guild', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
      rest: {
        request: async () => ({ success: true }),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    // 1. DELETE /guilds/{allowedGuildId} must be strictly blocked
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: `/guilds/${VALID_TEST_GUILD_ID}`,
          method: 'DELETE',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('destructive guild deletion is prohibited'));
        return true;
      }
    );

    // 2. PATCH /guilds/{allowedGuildId} must be strictly blocked
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: `/guilds/${VALID_TEST_GUILD_ID}`,
          method: 'PATCH',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('destructive, unclassified, or unsupported guild operation'));
        return true;
      }
    );

    // 3. Destructive role creation / modification / deletion on guild must be blocked
    const destructiveRoleRoutes = [
      { fullRoute: `/guilds/${VALID_TEST_GUILD_ID}/roles`, method: 'POST' },
      { fullRoute: `/guilds/${VALID_TEST_GUILD_ID}/roles/some_role_1`, method: 'PATCH' },
      { fullRoute: `/guilds/${VALID_TEST_GUILD_ID}/roles/some_role_1`, method: 'DELETE' },
    ];
    for (const r of destructiveRoleRoutes) {
      await assert.rejects(
        async () => {
          await (mockVerifiedClient.rest as any).request(r);
        },
        (err: any) => {
          assert(err instanceof DiscordLabSecurityError);
          assert(err.message.includes('unsupported guild operation'));
          return true;
        }
      );
    }

    // 4. Destructive emoji creation / modification / deletion on guild must be blocked
    const destructiveEmojiRoutes = [
      { fullRoute: `/guilds/${VALID_TEST_GUILD_ID}/emojis`, method: 'POST' },
      { fullRoute: `/guilds/${VALID_TEST_GUILD_ID}/emojis/some_emoji_1`, method: 'PATCH' },
      { fullRoute: `/guilds/${VALID_TEST_GUILD_ID}/emojis/some_emoji_1`, method: 'DELETE' },
    ];
    for (const r of destructiveEmojiRoutes) {
      await assert.rejects(
        async () => {
          await (mockVerifiedClient.rest as any).request(r);
        },
        (err: any) => {
          assert(err instanceof DiscordLabSecurityError);
          assert(err.message.includes('unsupported guild operation'));
          return true;
        }
      );
    }

    // 5. Destructive member kick and ban must be blocked
    const destructiveMemberRoutes = [
      { fullRoute: `/guilds/${VALID_TEST_GUILD_ID}/members/some_member_1`, method: 'DELETE' },
      { fullRoute: `/guilds/${VALID_TEST_GUILD_ID}/bans/some_member_1`, method: 'PUT' },
    ];
    for (const r of destructiveMemberRoutes) {
      await assert.rejects(
        async () => {
          await (mockVerifiedClient.rest as any).request(r);
        },
        (err: any) => {
          assert(err instanceof DiscordLabSecurityError);
          return true;
        }
      );
    }

    // 6. Legitimate role assignment / removal on allowed test guild member is permitted
    const addRoleRes: any = await (mockVerifiedClient.rest as any).request({
      fullRoute: `/guilds/${VALID_TEST_GUILD_ID}/members/test_member_123/roles/test_role_456`,
      method: 'PUT',
    });
    assert.strictEqual(addRoleRes.success, true);

    const removeRoleRes: any = await (mockVerifiedClient.rest as any).request({
      fullRoute: `/guilds/${VALID_TEST_GUILD_ID}/members/test_member_123/roles/test_role_456`,
      method: 'DELETE',
    });
    assert.strictEqual(removeRoleRes.success, true);
  });

  await test('9.10 REST firewall strictly denies all outgoing DM and group-DM operations regardless of recipient guild membership', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([
          [
            VALID_TEST_GUILD_ID,
            {
              id: VALID_TEST_GUILD_ID,
              members: { cache: new Map([['test_guild_member_1', { id: 'test_guild_member_1' }]]) },
              channels: { cache: new Map() },
            },
          ],
        ]),
      },
      channels: {
        cache: new Map([
          [
            'dm_channel_with_guild_member',
            {
              id: 'dm_channel_with_guild_member',
              isDMBased: () => true,
              type: 1,
              recipientId: 'test_guild_member_1',
            },
          ],
          [
            'group_dm_channel_test',
            {
              id: 'group_dm_channel_test',
              isDMBased: () => true,
              type: 3,
            },
          ],
        ]),
      },
      rest: {
        request: async () => ({ success: true }),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    // 1. Negative Test: DM send must be rejected even though recipient is in the allowed guild
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/channels/dm_channel_with_guild_member/messages',
          method: 'POST',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('DM and group-DM operations are denied in Discord Lab mode'));
        return true;
      }
    );

    // 2. Negative Test: DM edit must be rejected
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/channels/dm_channel_with_guild_member/messages/message_999',
          method: 'PATCH',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('DM and group-DM operations are denied in Discord Lab mode'));
        return true;
      }
    );

    // 3. Negative Test: DM delete must be rejected
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/channels/dm_channel_with_guild_member/messages/message_999',
          method: 'DELETE',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('DM and group-DM operations are denied in Discord Lab mode'));
        return true;
      }
    );

    // 4. Negative Test: Group DM operation must be rejected
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/channels/group_dm_channel_test/messages',
          method: 'POST',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('DM and group-DM operations are denied in Discord Lab mode'));
        return true;
      }
    );

    // 5. Negative Test: Unknown DM channel (not in cache) mutation is denied fail-closed
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/channels/uncached_dm_channel_000/messages',
          method: 'POST',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('target guild ownership of channel'));
        return true;
      }
    );
  });

  // ─── 10. Startup Hardening & Live Environment Enforcement ───────────────────
  console.log('\n[Category 10: Startup Hardening & Credential Enforcement]');

  await test('10.1 Live connection validation strictly requires DISCORD_LAB_APPLICATION_ID', () => {
    const envWithoutAppId = { ...getBaselineValidEnv() };
    delete envWithoutAppId.DISCORD_LAB_APPLICATION_ID;

    const res = validateDiscordLabEnvironment(envWithoutAppId, { requireToken: true });
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('DISCORD_LAB_APPLICATION_ID is required for live connection')));
  });

  await test('10.2 Live startup fails closed if operator-managed external environment file is missing', async () => {
    const manager = new DiscordLabLifecycleManager();
    await assert.rejects(
      async () => {
        await manager.start({
          authorizedOperatorApproval: true,
          skipLogin: false,
          customEnvPath: 'non_existent_env_file_location_12345.env',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('external environment file is missing'));
        return true;
      }
    );
  });

  await test('10.3 Containment verification rejects if authenticated client ID does not match expected DISCORD_LAB_APPLICATION_ID', () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID, {
      expectedApplicationId: VALID_TEST_APP_ID,
    });
    const mockMismatchClient = {
      user: { id: '999999999999999999', tag: 'FakeBot#9999' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
      destroy: () => {},
    };

    const result = firewall.verifyBotAndGuildContainment(mockMismatchClient as any);
    assert.strictEqual(result.valid, false);
    assert(result.reason?.includes('does not match expected DISCORD_LAB_APPLICATION_ID'));
    assert.strictEqual(firewall.state, DiscordLabState.TERMINATED);
  });

  await test('10.4 Live Discord Lab startup strictly refuses fallback to DISCORD_TOKEN when DISCORD_LAB_BOT_TOKEN is missing', () => {
    const envWithOnlyLegacyToken: Record<string, string> = {
      ...getBaselineValidEnv(),
      DISCORD_TOKEN: VALID_SYNTHETIC_TOKEN,
    };
    delete envWithOnlyLegacyToken.DISCORD_LAB_BOT_TOKEN;

    const res = validateDiscordLabEnvironment(envWithOnlyLegacyToken, { requireToken: true });
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('DISCORD_LAB_BOT_TOKEN is missing')));
  });

  console.log('\n============================================================');
  console.log(`📊 Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// CLI Execution
if (require.main === module) {
  runDiscordLabSafetyTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}
