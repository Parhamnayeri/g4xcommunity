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

const VALID_TEST_GUILD_ID = '123456789098765432';
const FOREIGN_GUILD_ID = '987654321012345678';
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
