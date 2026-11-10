/**
 * src/test/discord_lab_safety_suite.ts
 *
 * Comprehensive Automated Safety & Isolation Test Suite for Discord Lab Mode.
 *
 * Verifies all 9 safety controls and isolation guarantees without connecting to live Discord.
 */

import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { validateDiscordLabEnvironment } from '../discord-lab/validateDiscordLabEnv';
import {
  DiscordLabFirewall,
  DiscordLabSecurityError,
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
import { validateStagingEnvironment } from '../web/staging/validateStagingEnv';

const VALID_TEST_GUILD_ID = '123456789098765432';
const FOREIGN_GUILD_ID = '987654321012345678';
const VALID_TOKEN = ['mock_synthetic_discord_lab_token_part1', 'part2_validation_segment', 'part3_verification_entropy_suffix_9999'].join('.');

function getBaselineValidEnv(): Record<string, string> {
  return {
    DISCORD_LAB_MODE: 'true',
    HOST: '127.0.0.1',
    DATABASE_URL: 'file:./staging/discord_lab_test.db',
    DISCORD_LAB_ALLOWED_GUILD_ID: VALID_TEST_GUILD_ID,
    DISCORD_LAB_BOT_TOKEN: VALID_TOKEN,
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
  resetKillSwitch();
  console.log('\n🧪 [Test] Running Discord Lab Safety & Isolation Suite...');
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ❌ ${name}:`, err.message);
    }
  }

  // ─── 1. Six Financial Safety Gates ──────────────────────────────────────────
  console.log('\n[Category 1: Financial & External Safety Gates]');

  test('1.1 Baseline environment with all 6 gates as exact string "false" is valid', () => {
    const res = validateDiscordLabEnvironment(getBaselineValidEnv(), { requireToken: true });
    assert.strictEqual(res.valid, true, `Expected valid, got errors: ${res.errors.join('; ')}`);
  });

  for (const gate of MANDATORY_SAFETY_GATES) {
    test(`1.2 Reject if ${gate} is set to "true"`, () => {
      const env = { ...getBaselineValidEnv(), [gate]: 'true' };
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, false);
      assert(res.errors.some((e) => e.includes(gate)));
    });

    test(`1.3 Reject if ${gate} is set to "1"`, () => {
      const env = { ...getBaselineValidEnv(), [gate]: '1' };
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, false);
      assert(res.errors.some((e) => e.includes(gate)));
    });

    test(`1.4 Reject if ${gate} is undefined / missing`, () => {
      const env = { ...getBaselineValidEnv() };
      delete env[gate];
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, false);
      assert(res.errors.some((e) => e.includes(gate)));
    });
  }

  // ─── 2. Dedicated Test Guild Allowlist ──────────────────────────────────────
  console.log('\n[Category 2: Test Guild Allowlist]');

  test('2.1 Rejects missing DISCORD_LAB_ALLOWED_GUILD_ID', () => {
    const env = { ...getBaselineValidEnv(), DISCORD_LAB_ALLOWED_GUILD_ID: '' };
    const res = validateDiscordLabEnvironment(env);
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('DISCORD_LAB_ALLOWED_GUILD_ID is required')));
  });

  test('2.2 Rejects non-snowflake DISCORD_LAB_ALLOWED_GUILD_ID', () => {
    const invalidIds = ['abc', '12345', '1234567890123456789012345', 'guild_12345'];
    for (const inv of invalidIds) {
      const env = { ...getBaselineValidEnv(), DISCORD_LAB_ALLOWED_GUILD_ID: inv };
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, false);
      assert(res.errors.some((e) => e.includes('not a valid Discord snowflake')));
    }
  });

  test('2.3 Rejects known template placeholder guild IDs', () => {
    const placeholders = ['123456789012345678', '000000000000000000', '111111111111111111'];
    for (const ph of placeholders) {
      const env = { ...getBaselineValidEnv(), DISCORD_LAB_ALLOWED_GUILD_ID: ph };
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, false);
      assert(res.errors.some((e) => e.includes('known template placeholder')));
    }
  });

  // ─── 3. Event Firewall & Guild Confinement ──────────────────────────────────
  console.log('\n[Category 3: Discord Event Firewall]');

  test('3.1 Permits events matching allowed test guild', () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    assert.strictEqual(firewall.isGuildPermitted(VALID_TEST_GUILD_ID), true);
  });

  test('3.2 Drops events from foreign guilds', () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    assert.strictEqual(firewall.isGuildPermitted(FOREIGN_GUILD_ID), false);
    assert.throws(() => {
      firewall.assertGuildPermitted(FOREIGN_GUILD_ID, 'test-message');
    }, DiscordLabSecurityError);
  });

  test('3.3 Drops events from Direct Messages (guildId is null/undefined)', () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    assert.strictEqual(firewall.isGuildPermitted(null), false);
    assert.strictEqual(firewall.isGuildPermitted(undefined), false);
    assert.throws(() => {
      firewall.assertGuildPermitted(null, 'test-dm');
    }, DiscordLabSecurityError);
  });

  test('3.4 Rejects user-supplied guild arguments attempting to override authorization', () => {
    const firewall = new DiscordLabFirewall(VALID_TEST_GUILD_ID);
    assert.throws(() => {
      firewall.resolveAuthorizedGuildId(FOREIGN_GUILD_ID);
    }, DiscordLabSecurityError);

    // Calling without foreign override returns the allowed test guild
    const authorized = firewall.resolveAuthorizedGuildId();
    assert.strictEqual(authorized, VALID_TEST_GUILD_ID);
  });

  // ─── 4. Host Binding & Network Isolation ───────────────────────────────────
  console.log('\n[Category 4: Network Loopback Binding]');

  test('4.1 Rejects public HOST binding (0.0.0.0 or ::)', () => {
    const publicHosts = ['0.0.0.0', '::', '192.168.1.100', 'g4x.community'];
    for (const h of publicHosts) {
      const env = { ...getBaselineValidEnv(), HOST: h };
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, false);
      assert(res.errors.some((e) => e.includes('Public interfaces are strictly forbidden')));
    }
  });

  test('4.2 Accepts loopback HOST (127.0.0.1 or ::1)', () => {
    const loopbacks = ['127.0.0.1', '::1', 'localhost'];
    for (const h of loopbacks) {
      const env = { ...getBaselineValidEnv(), HOST: h };
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, true);
    }
  });

  // ─── 5. Database Confinement ───────────────────────────────────────────────
  console.log('\n[Category 5: Database Confinement]');

  test('5.1 Rejects production database names (g4x.db, dev.db)', () => {
    const forbidden = ['file:./staging/g4x.db', 'file:./staging/dev.db', 'file:./staging/production.db'];
    for (const db of forbidden) {
      const env = { ...getBaselineValidEnv(), DATABASE_URL: db };
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, false);
      assert(res.errors.some((e) => e.includes('forbidden database file name')));
    }
  });

  test('5.2 Rejects directory escape attempts', () => {
    const escapes = ['file:../../data/g4x.db', 'file:../dev.db', 'file:/tmp/test.db'];
    for (const db of escapes) {
      const env = { ...getBaselineValidEnv(), DATABASE_URL: db };
      const res = validateDiscordLabEnvironment(env);
      assert.strictEqual(res.valid, false);
    }
  });

  // ─── 6. Kill Switch Mechanism ──────────────────────────────────────────────
  console.log('\n[Category 6: Emergency Kill Switch]');

  test('6.1 Kill switch activates via DISCORD_LAB_KILL_SWITCH=true', () => {
    resetKillSwitch();
    process.env.DISCORD_LAB_KILL_SWITCH = 'true';
    const status = checkKillSwitch();
    assert.strictEqual(status.active, true);
    assert.strictEqual(status.source, 'env');

    const env = { ...getBaselineValidEnv(), DISCORD_LAB_KILL_SWITCH: 'true' };
    const res = validateDiscordLabEnvironment(env);
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('Kill switch is ACTIVE')));
    resetKillSwitch();
  });

  test('6.2 Kill switch activates via file creation and resets cleanly', () => {
    resetKillSwitch();
    const createdFile = triggerKillSwitch('Automated test emergency halt');
    assert(fs.existsSync(createdFile), 'Kill switch file must exist');

    const status = checkKillSwitch();
    assert.strictEqual(status.active, true);
    assert.strictEqual(status.source, 'file');

    resetKillSwitch();
    assert.strictEqual(checkKillSwitch().active, false);
  });

  // ─── 7. Credential Protection & Git Verification ───────────────────────────
  console.log('\n[Category 7: Credential Protection]');

  test('7.1 Tracked files are recognized as insecure for storing secrets', () => {
    // package.json is tracked by Git
    const repoRoot = path.resolve(__dirname, '../../');
    const trackedFile = path.resolve(repoRoot, 'package.json');
    assert.strictEqual(isPathGitTracked(trackedFile), true);

    // .env.discord-lab (which is ignored) is not tracked
    const untrackedFile = path.resolve(repoRoot, '.env.discord-lab');
    assert.strictEqual(isPathGitTracked(untrackedFile), false);
  });

  test('7.2 Sanitized summary masks secret values and never prints raw token', () => {
    const env = getBaselineValidEnv();
    const res = validateDiscordLabEnvironment(env);
    const summaryJson = JSON.stringify(res.sanitizedSummary);
    assert(!summaryJson.includes(VALID_TOKEN), 'Summary must not contain raw token');
    assert.strictEqual(res.sanitizedSummary.tokenConfigured, true);
  });

  // ─── 8. Existing Staging Safety Preservation ───────────────────────────────
  console.log('\n[Category 8: Existing Staging Safety Invariants]');

  test('8.1 Existing validateStagingEnvironment() still strictly rejects real Discord tokens', () => {
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
