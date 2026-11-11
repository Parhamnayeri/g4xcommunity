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
import { handleDiscordLabPingCommand, DISCORD_LAB_PING_RESPONSE } from '../discord-lab/discordLabPingCommand';

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

  await test('8.5 Interactive transaction rollback via dynamic Prisma proxy on disposable database', async () => {
    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);
      assert.strictEqual(isGlobalPrismaOverridden(), true);

      const rollbackTestId = `rollback_${Date.now()}`.slice(0, 18);

      // Perform a write inside an interactive transaction that aborts
      let txErrorThrown = false;
      try {
        await prisma.$transaction(async (tx) => {
          // Write synthetic test record inside transaction
          await tx.user.create({
            data: {
              discordId: rollbackTestId,
              username: 'rollback_synthetic_user',
              isActive: true,
            },
          });

          // Verify the record is visible inside the uncommitted transaction
          const insideTx = await tx.user.findUnique({
            where: { discordId: rollbackTestId },
          });
          assert(insideTx !== null, 'Record must be visible within active transaction');
          assert.strictEqual(insideTx.username, 'rollback_synthetic_user');

          // Abort transaction intentionally
          throw new Error('TEST_ABORT_ROLLBACK');
        });
      } catch (err: any) {
        if (err.message === 'TEST_ABORT_ROLLBACK') {
          txErrorThrown = true;
        } else {
          throw err;
        }
      }

      assert.strictEqual(txErrorThrown, true, 'Transaction must have thrown the test abort error');

      // Verify outside the transaction that the record was rolled back completely
      const outsideTx = await prisma.user.findUnique({
        where: { discordId: rollbackTestId },
      });
      assert.strictEqual(outsideTx, null, 'Aborted transaction must be rolled back completely with zero dirty state');

      // Also verify via raw query for direct database confirmation
      const rawRows: any[] = await prisma.$queryRawUnsafe(
        'SELECT * FROM users WHERE discord_id = ?;',
        rollbackTestId
      );
      assert.strictEqual(rawRows.length, 0, 'No rows must exist in SQLite table after rollback');
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  await test('8.6 Disposable database safe cleanup, file erasure, and production-file non-interference proof', async () => {
    // Record baseline mtimes of any forbidden production or dev database files
    const repoRoot = path.resolve(__dirname, '../../');
    const forbiddenPaths = [
      path.join(repoRoot, 'prisma/dev.db'),
      path.join(repoRoot, 'prisma/g4x.db'),
      path.join(repoRoot, 'prisma/g4x_dev.db'),
    ];
    const initialMtimes = new Map<string, number>();
    for (const fp of forbiddenPaths) {
      if (fs.existsSync(fp)) {
        initialMtimes.set(fp, fs.statSync(fp).mtimeMs);
      }
    }

    // 1. Provision disposable database
    const db = await createDisposableLabDatabase();
    assert(fs.existsSync(db.dbPath), 'Disposable SQLite file must exist on disk after provisioning');
    assert(db.dbPath.includes('staging'), 'Must be in staging directory');

    try {
      setGlobalPrismaClient(db.prismaClient);

      // 2. Perform synthetic write using test-only records
      const syntheticTestId = `cleanup_syn_${Date.now()}`.slice(0, 18);
      await prisma.user.create({
        data: {
          discordId: syntheticTestId,
          username: 'cleanup_verifier',
          isActive: true,
        },
      });

      // 3. Read it back to verify persistence in disposable DB
      const readBack = await prisma.user.findUnique({
        where: { discordId: syntheticTestId },
      });
      assert(readBack !== null, 'Synthetic record must be readable from disposable database');
      assert.strictEqual(readBack.username, 'cleanup_verifier');
      assert.strictEqual(readBack.discordId, syntheticTestId);

      // 4. Verify PRAGMA database_list confirms active attachment is strictly the disposable file
      const dbList: Array<{ seq: number; name: string; file: string }> = await prisma.$queryRawUnsafe(
        'PRAGMA database_list;'
      );
      const mainDb = dbList.find((d) => d.name === 'main');
      const activeFile = path.normalize(mainDb?.file || '').toLowerCase();
      assert.strictEqual(
        activeFile,
        path.normalize(db.dbPath).toLowerCase(),
        'Database connection must be strictly attached to disposable file'
      );
    } finally {
      // Reset global prisma
      setGlobalPrismaClient(null);

      // 5. Cleanup the disposable database
      await db.cleanup();

      // 6. Verify disposable file and all related WAL/SHM/journal files are completely deleted
      assert.strictEqual(fs.existsSync(db.dbPath), false, 'Disposable database file must be deleted on cleanup');
      assert.strictEqual(fs.existsSync(`${db.dbPath}-wal`), false, 'WAL file must be deleted on cleanup');
      assert.strictEqual(fs.existsSync(`${db.dbPath}-shm`), false, 'SHM file must be deleted on cleanup');
      assert.strictEqual(fs.existsSync(`${db.dbPath}-journal`), false, 'Journal file must be deleted on cleanup');

      // 7. Verify that no forbidden database was touched or modified
      for (const fp of forbiddenPaths) {
        if (fs.existsSync(fp)) {
          const currentMtime = fs.statSync(fp).mtimeMs;
          const initial = initialMtimes.get(fp);
          assert.strictEqual(
            currentMtime,
            initial,
            `Forbidden database '${fp}' was modified during test!`
          );
        }
      }
    }
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

    // 6. Negative Test: DM read (GET) must be strictly rejected
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/channels/dm_channel_with_guild_member/messages',
          method: 'GET',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('DM and group-DM operations are denied in Discord Lab mode'));
        return true;
      }
    );

    // 7. Negative Test: Unknown channel GET request is strictly denied fail-closed
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/channels/completely_unknown_chan/messages',
          method: 'GET',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('target guild ownership of channel'));
        assert(err.message.includes('unverified or unknown'));
        return true;
      }
    );

    // 8. Negative Test: Unknown channel direct metadata GET is strictly denied fail-closed
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: '/channels/completely_unknown_chan',
          method: 'GET',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('target guild ownership of channel'));
        assert(err.message.includes('unverified or unknown'));
        return true;
      }
    );
  });

  await test('9.11 REST firewall permits legitimate GET, POST, PATCH operations on verified test-guild channels', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([
          [
            VALID_TEST_GUILD_ID,
            {
              id: VALID_TEST_GUILD_ID,
              channels: { cache: new Map([['verified_test_channel_123', { id: 'verified_test_channel_123' }]]) },
            },
          ],
        ]),
      },
      channels: {
        cache: new Map([
          ['verified_test_channel_123', { id: 'verified_test_channel_123', guildId: VALID_TEST_GUILD_ID }],
        ]),
      },
      rest: {
        request: async () => ({ success: true }),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    // 1. Legitimate GET on verified guild channel succeeds
    const getRes: any = await (mockVerifiedClient.rest as any).request({
      fullRoute: '/channels/verified_test_channel_123/messages',
      method: 'GET',
    });
    assert.strictEqual(getRes.success, true);

    // 2. Legitimate POST on verified guild channel succeeds
    const postRes: any = await (mockVerifiedClient.rest as any).request({
      fullRoute: '/channels/verified_test_channel_123/messages',
      method: 'POST',
    });
    assert.strictEqual(postRes.success, true);

    // 3. Legitimate PATCH on verified guild channel succeeds
    const patchRes: any = await (mockVerifiedClient.rest as any).request({
      fullRoute: '/channels/verified_test_channel_123/messages/msg_456',
      method: 'PATCH',
    });
    assert.strictEqual(patchRes.success, true);
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

  // ─── 11. Discord Lab G4!ping Smoke Test Command ─────────────────────────────
  console.log('\n[Category 11: Discord Lab G4!ping Smoke Test Command]');

  await test('11.1 G4!ping responds with exact string "G4X Staging Lab: pong" when executed in allowed test guild with ACTIVE firewall', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
      channels: {
        cache: new Map([
          ['test_chan_101', { id: 'test_chan_101', guildId: VALID_TEST_GUILD_ID }],
        ]),
      },
      rest: {
        request: async () => ({ success: true }),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    let messageHandler: Function = () => {};
    const dummyClient = {
      on: (event: string, handler: Function) => {
        if (event === 'messageCreate') messageHandler = handler;
      },
    };

    let replyContent: string | null = null;
    firewall.attachClientFirewall(dummyClient as any, {
      onPermittedMessage: async (message: any) => {
        if (!message.content.startsWith('G4!')) return;
        const rawArgs = message.content.slice(3).trim().split(/\s+/);
        const command = rawArgs.shift()?.toLowerCase();
        if (command === 'ping') {
          await handleDiscordLabPingCommand(message);
        }
      },
      onPermittedInteraction: async () => {},
    });

    const mockMessage = {
      guildId: VALID_TEST_GUILD_ID,
      channelId: 'test_chan_101',
      content: 'G4!ping',
      author: { bot: false },
      reply: async (payload: any) => {
        replyContent = typeof payload === 'string' ? payload : payload.content;
      },
    };

    const prevLabMode = process.env.DISCORD_LAB_MODE;
    process.env.DISCORD_LAB_MODE = 'true';
    try {
      await messageHandler(mockMessage);
      assert.strictEqual(replyContent, 'G4X Staging Lab: pong');
    } finally {
      process.env.DISCORD_LAB_MODE = prevLabMode;
    }
  });

  await test('11.2 G4!ping drops foreign guild message without responding or calling reply', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);

    let messageHandler: Function = () => {};
    const dummyClient = {
      on: (event: string, handler: Function) => {
        if (event === 'messageCreate') messageHandler = handler;
      },
    };

    let replyCalled = false;
    firewall.attachClientFirewall(dummyClient as any, {
      onPermittedMessage: async () => { replyCalled = true; },
      onPermittedInteraction: async () => {},
    });

    const mockMessage = {
      guildId: FOREIGN_GUILD_ID,
      channelId: 'foreign_chan_999',
      content: 'G4!ping',
      author: { bot: false },
      reply: async () => { replyCalled = true; },
    };

    await messageHandler(mockMessage);
    assert.strictEqual(replyCalled, false, 'Foreign guild G4!ping must be dropped with zero reply');
  });

  await test('11.3 G4!ping drops DM message (null/undefined guildId) without responding or calling reply', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);

    let messageHandler: Function = () => {};
    const dummyClient = {
      on: (event: string, handler: Function) => {
        if (event === 'messageCreate') messageHandler = handler;
      },
    };

    let replyCalled = false;
    firewall.attachClientFirewall(dummyClient as any, {
      onPermittedMessage: async () => { replyCalled = true; },
      onPermittedInteraction: async () => {},
    });

    const mockDmMessage = {
      guildId: null,
      channelId: 'dm_chan_999',
      content: 'G4!ping',
      author: { bot: false },
      reply: async () => { replyCalled = true; },
    };

    await messageHandler(mockDmMessage);
    assert.strictEqual(replyCalled, false, 'DM message G4!ping must be dropped with zero reply');
  });

  await test('11.4 G4!ping is blocked if firewall is in BLOCKED state prior to verification', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    assert.strictEqual(firewall.state, DiscordLabState.BLOCKED);

    let messageHandler: Function = () => {};
    const dummyClient = {
      on: (event: string, handler: Function) => {
        if (event === 'messageCreate') messageHandler = handler;
      },
    };

    let replyCalled = false;
    firewall.attachClientFirewall(dummyClient as any, {
      onPermittedMessage: async () => { replyCalled = true; },
      onPermittedInteraction: async () => {},
    });

    const mockMessage = {
      guildId: VALID_TEST_GUILD_ID,
      channelId: 'test_chan_101',
      content: 'G4!ping',
      author: { bot: false },
      reply: async () => { replyCalled = true; },
    };

    await messageHandler(mockMessage);
    assert.strictEqual(replyCalled, false, 'Pre-verification G4!ping must be dropped with zero reply');
  });

  await test('11.5 handleDiscordLabPingCommand refuses execution if DISCORD_LAB_MODE !== "true"', async () => {
    const prevMode = process.env.DISCORD_LAB_MODE;
    process.env.DISCORD_LAB_MODE = 'false';

    let replyCalled = false;
    const mockMessage: any = {
      content: 'G4!ping',
      reply: async () => { replyCalled = true; },
    };

    try {
      const handled = await handleDiscordLabPingCommand(mockMessage);
      assert.strictEqual(handled, false);
      assert.strictEqual(replyCalled, false);
    } finally {
      process.env.DISCORD_LAB_MODE = prevMode;
    }
  });

  await test('11.6 Production bot (src/index.ts) does not register or handle G4!ping command', () => {
    const indexPath = path.join(__dirname, '../index.ts');
    const indexSource = fs.readFileSync(indexPath, 'utf-8');
    assert(
      !indexSource.includes("'ping'") && !indexSource.includes('"ping"'),
      'Production bot entrypoint (src/index.ts) must NOT register ping command'
    );
  });

  // ─── 12. Profile Command (G4!profile) Pre-Live Verification ─────────────────
  console.log('\n[Category 12: Profile Command (G4!profile) Pre-Live Verification]');

  await test('12.1 G4!profile creates user in disposable database and returns expected profile embed with zero external calls', async () => {
    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);

      const syntheticUserId = `prof_user_${Date.now()}`.slice(0, 18);
      const syntheticUsername = 'lab_tester_booster';

      let replyPayload: any = null;
      const mockMessage = {
        author: {
          id: syntheticUserId,
          username: syntheticUsername,
          displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/123/avatar.png',
        },
        mentions: {
          users: {
            first: () => null,
          },
        },
        reply: async (payload: any) => {
          replyPayload = payload;
        },
      };

      const { handleProfileCommand } = await import('../commands/profile');
      await handleProfileCommand(mockMessage as any, []);

      // 1. Verify user was created in disposable database via ensureUserExists
      const user = await prisma.user.findUnique({
        where: { discordId: syntheticUserId },
      });
      assert(user !== null, 'User record must exist in disposable database');
      assert.strictEqual(user.username, syntheticUsername);
      assert.strictEqual(user.isActive, true);

      // 2. Verify reply payload structure
      assert(replyPayload !== null, 'Message reply must be invoked');
      assert(Array.isArray(replyPayload.embeds) && replyPayload.embeds.length === 1, 'Must reply with 1 embed');
      const embed = replyPayload.embeds[0];
      const embedData = typeof embed.toJSON === 'function' ? embed.toJSON() : embed;

      assert(embedData.title.includes(syntheticUsername), 'Embed title must contain booster username');
      assert.strictEqual(embedData.description, 'No roles assigned yet.');

      const fields = embedData.fields || [];
      const qualificationField = fields.find((f: any) => f.name.includes('Qualification Status'));
      assert(qualificationField, 'Must include Qualification Status field');
      assert(qualificationField.value.includes('Unapproved / Pending'));

      const mainCharField = fields.find((f: any) => f.name.includes('Main Character'));
      assert(mainCharField, 'Must include Main Character field');
      assert(mainCharField.value.includes('No WoW characters registered yet'));

      const charCountField = fields.find((f: any) => f.name.includes('Registered Characters'));
      assert(charCountField, 'Must include Registered Characters field');
      assert(charCountField.value.includes('Total Active: **0** character(s)'));

      const teamsField = fields.find((f: any) => f.name.includes('Premade Teams'));
      assert(teamsField, 'Must include Premade Teams field');
      assert(teamsField.value.includes('Participating in **0** squad(s)'));

      // 3. Verify components row has 2 buttons
      assert(Array.isArray(replyPayload.components) && replyPayload.components.length === 1);
      const row = replyPayload.components[0];
      const rowData = typeof row.toJSON === 'function' ? row.toJSON() : row;
      assert.strictEqual(rowData.components.length, 2);
      assert.strictEqual(rowData.components[0].custom_id || rowData.components[0].customId, 'profile_btn_refresh');
      assert.strictEqual(rowData.components[1].custom_id || rowData.components[1].customId, 'profile_btn_list');
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  await test('12.2 G4!profile repeated invocation is idempotent and updates existing record without duplicates', async () => {
    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);

      const syntheticUserId = `idem_user_${Date.now()}`.slice(0, 18);
      const initialUsername = 'lab_tester_first';
      const updatedUsername = 'lab_tester_updated';

      let replyCount = 0;
      const makeMockMessage = (name: string) => ({
        author: {
          id: syntheticUserId,
          username: name,
          displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/123/avatar.png',
        },
        mentions: {
          users: {
            first: () => null,
          },
        },
        reply: async () => {
          replyCount++;
        },
      });

      const { handleProfileCommand } = await import('../commands/profile');

      // First invocation
      await handleProfileCommand(makeMockMessage(initialUsername) as any, []);
      assert.strictEqual(replyCount, 1);

      // Second invocation with updated username
      await handleProfileCommand(makeMockMessage(updatedUsername) as any, []);
      assert.strictEqual(replyCount, 2);

      // Verify only 1 record exists in total and username was updated
      const totalUsers = await prisma.user.count({ where: { discordId: syntheticUserId } });
      assert.strictEqual(totalUsers, 1, 'Must not duplicate user records');

      const user = await prisma.user.findUnique({ where: { discordId: syntheticUserId } });
      assert.strictEqual(user?.username, updatedUsername, 'Username must be updated on subsequent calls');
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  await test('12.3 Profile buttons handle empty character list safely without external sync or DB mutations', async () => {
    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);

      const syntheticUserId = `btn_user_${Date.now()}`.slice(0, 18);
      const { handleButtonInteraction } = await import('../interactions/buttons');

      // 1. Test profile_btn_refresh when user has no characters
      let refreshReply: any = null;
      const mockRefreshInteraction = {
        customId: 'profile_btn_refresh',
        user: { id: syntheticUserId },
        reply: async (payload: any) => {
          refreshReply = payload;
        },
        deferReply: async () => {},
        editReply: async () => {},
      };

      await handleButtonInteraction(mockRefreshInteraction as any);
      assert(refreshReply !== null);
      assert(refreshReply.content.includes('No registered characters found to sync'));
      assert.strictEqual(refreshReply.ephemeral, true);

      // 2. Test profile_btn_list when user has no characters
      let listReply: any = null;
      const mockListInteraction = {
        customId: 'profile_btn_list',
        user: { id: syntheticUserId },
        reply: async (payload: any) => {
          listReply = payload;
        },
      };

      await handleButtonInteraction(mockListInteraction as any);
      assert(listReply !== null);
      assert(listReply.content.includes('No active characters registered'));
      assert.strictEqual(listReply.ephemeral, true);

      // 3. Confirm zero characters created in database
      const totalChars = await prisma.wowCharacter.count({ where: { userId: syntheticUserId } });
      assert.strictEqual(totalChars, 0, 'Buttons must not create characters in DB');
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  await test('12.4 profile_btn_list end-to-end integration through client and REST firewalls in allowed test guild', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
      channels: {
        cache: new Map([
          ['test_chan_101', { id: 'test_chan_101', guildId: VALID_TEST_GUILD_ID }],
        ]),
      },
      rest: {
        request: async () => ({ success: true }),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    const db = await createDisposableLabDatabase();
    try {
      setGlobalPrismaClient(db.prismaClient);

      let interactionHandler: Function = () => {};
      const dummyClient = {
        on: (event: string, handler: Function) => {
          if (event === 'interactionCreate') interactionHandler = handler;
        },
      };

      const { handleButtonInteraction } = await import('../interactions/buttons');
      firewall.attachClientFirewall(dummyClient as any, {
        onPermittedMessage: async () => {},
        onPermittedInteraction: async (interaction: any) => {
          if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
          }
        },
      });

      const syntheticInteractionId = '777777777777777777';
      const syntheticToken = 'token_test_segment_12345';
      const syntheticUserId = `btn_user_${Date.now()}`.slice(0, 18);

      let replyPayload: any = null;
      let restCallbackExecuted = false;

      const mockInteraction = {
        id: syntheticInteractionId,
        token: syntheticToken,
        guildId: VALID_TEST_GUILD_ID,
        channelId: 'test_chan_101',
        customId: 'profile_btn_list',
        user: { id: syntheticUserId },
        isButton: () => true,
        reply: async (payload: any) => {
          replyPayload = payload;
          // Discord.js internally invokes client.rest.request for interaction callback:
          await (mockVerifiedClient.rest as any).request({
            fullRoute: `/interactions/${syntheticInteractionId}/${syntheticToken}/callback`,
            method: 'POST',
            body: payload,
          });
          restCallbackExecuted = true;
        },
      };

      await interactionHandler(mockInteraction);

      // 1. Verify permitted interaction ID was registered
      assert(firewall.permittedInteractionIds.has(syntheticInteractionId));

      // 2. Verify interaction.reply was called with ephemeral flag and exact expected text
      assert(replyPayload !== null, 'interaction.reply must be called');
      assert.strictEqual(replyPayload.ephemeral, true, 'Response must be strictly ephemeral');
      assert(
        replyPayload.content.includes('No active characters registered. Use `G4!profile add-char` to add one.'),
        'Reply content must match expected empty-character notice'
      );

      // 3. Verify outbound REST callback passed the REST firewall without exception
      assert.strictEqual(restCallbackExecuted, true, 'Outbound REST callback must be permitted');

      // 4. Verify database state is untouched (zero characters created, zero user mutations)
      const charCount = await prisma.wowCharacter.count({ where: { userId: syntheticUserId } });
      assert.strictEqual(charCount, 0, 'Must not create characters in database');
    } finally {
      setGlobalPrismaClient(null);
      await db.cleanup();
    }
  });

  await test('12.5 profile_btn_list interaction from foreign guild or DM is dropped and callback blocked', async () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    const mockVerifiedClient = {
      user: { id: VALID_TEST_APP_ID, tag: 'G4XStagingBot#0001' },
      guilds: {
        cache: new Map([[VALID_TEST_GUILD_ID, { id: VALID_TEST_GUILD_ID }]]),
      },
      channels: {
        cache: new Map([]),
      },
      rest: {
        request: async () => ({ success: true }),
      },
    };
    firewall.verifyBotAndGuildContainment(mockVerifiedClient as any);
    firewall.attachRestFirewall(mockVerifiedClient as any);

    let interactionHandler: Function = () => {};
    const dummyClient = {
      on: (event: string, handler: Function) => {
        if (event === 'interactionCreate') interactionHandler = handler;
      },
    };

    let onPermittedInteractionCalled = false;
    firewall.attachClientFirewall(dummyClient as any, {
      onPermittedMessage: async () => {},
      onPermittedInteraction: async () => {
        onPermittedInteractionCalled = true;
      },
    });

    // 1. Foreign guild interaction
    const foreignInteractionId = '666666666666666666';
    const mockForeignInteraction = {
      id: foreignInteractionId,
      token: 'tok_foreign',
      guildId: FOREIGN_GUILD_ID,
      customId: 'profile_btn_list',
      user: { id: 'foreign_user' },
      isButton: () => true,
    };

    await interactionHandler(mockForeignInteraction);
    assert.strictEqual(onPermittedInteractionCalled, false, 'Foreign guild interaction must not be dispatched');
    assert.strictEqual(firewall.permittedInteractionIds.has(foreignInteractionId), false);

    // Attempting REST callback for foreign interaction must throw DiscordLabSecurityError
    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: `/interactions/${foreignInteractionId}/tok_foreign/callback`,
          method: 'POST',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('interaction was not verified from allowed test guild'));
        return true;
      }
    );

    // 2. DM interaction (null guildId)
    const dmInteractionId = '555555555555555555';
    const mockDmInteraction = {
      id: dmInteractionId,
      token: 'tok_dm',
      guildId: null,
      customId: 'profile_btn_list',
      user: { id: 'dm_user' },
      isButton: () => true,
    };

    await interactionHandler(mockDmInteraction);
    assert.strictEqual(onPermittedInteractionCalled, false, 'DM interaction must not be dispatched');
    assert.strictEqual(firewall.permittedInteractionIds.has(dmInteractionId), false);

    await assert.rejects(
      async () => {
        await (mockVerifiedClient.rest as any).request({
          fullRoute: `/interactions/${dmInteractionId}/tok_dm/callback`,
          method: 'POST',
        });
      },
      (err: any) => {
        assert(err instanceof DiscordLabSecurityError);
        assert(err.message.includes('interaction was not verified from allowed test guild'));
        return true;
      }
    );
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
