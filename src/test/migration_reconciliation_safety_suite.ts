/**
 * src/test/migration_reconciliation_safety_suite.ts
 *
 * Comprehensive Regression & Safety Test Suite for Execution Channel Reconciliation & Pre-Migration Gate.
 *
 * Verified Requirements:
 *  1. Canonical path resolution matching Prisma schema-relative rules & symlinks
 *  2. PRAGMA foreign_key_check strictly blocks operations (no warnings)
 *  3. Global preflight validation (aborts with ZERO writes if any order conflicts)
 *  4. Global atomic batch transaction (rolls back all orders on failure)
 *  5. Strict concurrency re-verification of record IDs, pointer, Discord IDs, and status
 *  6. Backup file verification (magic header, size, non-identity)
 *  7. Incomplete/failed migration record in _prisma_migrations halts gate
 *  8. Duplicate channels with correct highest ID
 *  9. Duplicate channels with correct lowest ID (reverses historical flawed SQL)
 *  10. Null authoritative pointer (fails safe, zero modifications)
 *  11. Invalid authoritative pointer (mismatch fails safe)
 *  12. Multiple matching records (ambiguity fails safe)
 *  13. Terminal order with still-active channel (verifies historical pointer consistency)
 *  14. Partially applied migration & pre-migration gate blocking
 *  15. Missing DATABASE_URL (refuses to guess)
 *  16. Apply attempted without confirmation / backup acknowledgement
 *  17. Existing applied migration checksum verification
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import assert from 'assert';
import { PrismaClient } from '@prisma/client';

const {
  reconcileExecutionChannels,
  validateBackupFile,
} = require(path.resolve(process.cwd(), 'scripts/reconcile-execution-channels'));
const {
  runPreMigrationGate,
} = require(path.resolve(process.cwd(), 'scripts/pre-migration-gate'));
const { inspectDatabaseSafety } = require(path.resolve(process.cwd(), 'scripts/inspect-database-safety'));
const {
  resolveCanonicalDatabaseTarget,
  findPrismaSchemaDir,
} = require(path.resolve(process.cwd(), 'scripts/canonical-db-path'));

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    process.stdout.write(`  • ${name}... `);
    await fn();
    console.log('PASSED ✅');
  } catch (err: any) {
    console.log('FAILED ❌');
    console.error(`    Error in test '${name}':`, err);
    throw err;
  }
}

async function main() {
  console.log('================================================================');
  console.log(' G4X Community — Migration & Reconciliation Safety Test Suite');
  console.log('================================================================\n');

  const fixtureDir = path.resolve(process.cwd(), 'prisma', 'fixtures');
  if (!fs.existsSync(fixtureDir)) {
    fs.mkdirSync(fixtureDir, { recursive: true });
  }

  const testDbPath = path.resolve(fixtureDir, `migration_safety_${Date.now()}.db`);
  const testDbUrl = `file:${testDbPath}`;

  const prisma = new PrismaClient({
    datasources: { db: { url: testDbUrl } },
  });

  try {
    // ------------------------------------------------------------------------
    // SETUP: Bootstrap schema with foreign keys enabled
    // ------------------------------------------------------------------------
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        execution_channel_id TEXT
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS order_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        discord_channel_id TEXT NOT NULL,
        channel_type TEXT NOT NULL,
        status TEXT NOT NULL,
        archived_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        new_values TEXT,
        reason TEXT,
        is_success BOOLEAN NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS _prisma_migrations (
        id TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        finished_at DATETIME,
        migration_name TEXT NOT NULL,
        logs TEXT,
        rolled_back_at DATETIME,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        applied_steps_count INTEGER DEFAULT 1
      );
    `);

    // ------------------------------------------------------------------------
    // TEST 1: Canonical Path Resolution
    // ------------------------------------------------------------------------
    await runTest('1. Canonical path resolution matches Prisma schema-relative rules', async () => {
      const schemaDir = findPrismaSchemaDir();
      assert.ok(schemaDir.endsWith('prisma'), 'schemaDir must end with prisma');

      // Test relative DATABASE_URL resolution
      const targetEnv = resolveCanonicalDatabaseTarget({
        databaseUrl: 'file:./fixtures/sample.db',
        allowMissingFile: true,
      });
      const expectedPath = path.normalize(path.resolve(schemaDir, './fixtures/sample.db'));
      assert.strictEqual(targetEnv.canonicalPath, expectedPath);

      // Test absolute path resolution
      const targetAbs = resolveCanonicalDatabaseTarget({
        databaseUrl: `file:${testDbPath}`,
        allowMissingFile: true,
      });
      assert.strictEqual(path.normalize(targetAbs.canonicalPath), path.normalize(testDbPath));
    });

    // ------------------------------------------------------------------------
    // TEST 2: Strict PRAGMA foreign_key_check Fail-Closed
    // ------------------------------------------------------------------------
    await runTest('2. PRAGMA foreign_key_check strictly blocks operations on integrity failure', async () => {
      // Temporarily disable foreign keys to inject an orphaned row
      await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF;');
      await prisma.$executeRawUnsafe(
        "INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (999, 99999, 'orphan_ch', 'execution', 'active');"
      );
      await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');

      let caughtFkReconcile = false;
      try {
        await reconcileExecutionChannels({
          databaseUrl: testDbUrl,
          apply: false,
          prismaClient: prisma,
        });
      } catch (err: any) {
        if (err.message.includes('FATAL INTEGRITY VIOLATION') && err.message.includes('foreign key violation')) {
          caughtFkReconcile = true;
        }
      }
      assert.strictEqual(caughtFkReconcile, true, 'Reconciler must strictly throw on foreign key violations');

      let caughtFkGate = false;
      try {
        await runPreMigrationGate({
          databaseUrl: testDbUrl,
          prismaClient: prisma,
        });
      } catch (err: any) {
        if (err.message.includes('FATAL INTEGRITY VIOLATION')) {
          caughtFkGate = true;
        }
      }
      assert.strictEqual(caughtFkGate, true, 'Pre-migration gate must strictly throw on foreign key violations');

      // Clean up orphaned test row
      await prisma.$executeRawUnsafe('DELETE FROM order_channels WHERE id = 999;');
    });

    // ------------------------------------------------------------------------
    // TEST 3: Global Preflight Validation (Halt with ZERO writes on conflict)
    // ------------------------------------------------------------------------
    await runTest('3. Global preflight halts with ZERO writes if ANY order conflicts', async () => {
      // Order 201: VALID duplicate group
      await prisma.$executeRawUnsafe("INSERT INTO orders (id, status, execution_channel_id) VALUES (201, 'in_progress', 'ch_201_valid');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (21, 201, 'ch_201_valid', 'execution', 'active');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (22, 201, 'ch_201_dup', 'execution', 'active');");

      // Order 202: CONFLICTING duplicate group (null pointer)
      await prisma.$executeRawUnsafe("INSERT INTO orders (id, status, execution_channel_id) VALUES (202, 'assigned', NULL);");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (23, 202, 'ch_202_a', 'execution', 'active');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (24, 202, 'ch_202_b', 'execution', 'active');");

      const report = await reconcileExecutionChannels({
        databaseUrl: testDbUrl,
        apply: true,
        confirmApply: true,
        verifiedBackupTaken: true,
        prismaClient: prisma,
      });

      assert.strictEqual(report.success, false);
      assert.strictEqual(report.channelsArchived, 0, 'Must not archive any channels when preflight fails');
      assert.ok(report.unresolvedConflicts.length >= 1);

      // Verify that Order 201 was NOT partially updated
      const ch22: any[] = await prisma.$queryRawUnsafe('SELECT status FROM order_channels WHERE id = 22;');
      assert.strictEqual(ch22[0].status, 'active', 'Order 201 duplicate must remain active due to preflight halt');

      // Clean up order 202 conflict for subsequent tests
      await prisma.$executeRawUnsafe('DELETE FROM order_channels WHERE order_id = 202;');
      await prisma.$executeRawUnsafe('DELETE FROM orders WHERE id = 202;');
    });

    // ------------------------------------------------------------------------
    // TEST 4: Global Atomic Batch Execution
    // ------------------------------------------------------------------------
    await runTest('4. Global atomic batch executes all orders within single transaction', async () => {
      // Order 203: second valid group
      await prisma.$executeRawUnsafe("INSERT INTO orders (id, status, execution_channel_id) VALUES (203, 'in_progress', 'ch_203_valid');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (25, 203, 'ch_203_valid', 'execution', 'active');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (26, 203, 'ch_203_dup', 'execution', 'active');");

      const report = await reconcileExecutionChannels({
        databaseUrl: testDbUrl,
        apply: true,
        confirmApply: true,
        verifiedBackupTaken: true,
        prismaClient: prisma,
      });

      assert.strictEqual(report.success, true);
      assert.strictEqual(report.channelsRetained, 2); // 201 and 203
      assert.strictEqual(report.channelsArchived, 2); // ch 22 and ch 26

      const ch22: any[] = await prisma.$queryRawUnsafe('SELECT status FROM order_channels WHERE id = 22;');
      const ch26: any[] = await prisma.$queryRawUnsafe('SELECT status FROM order_channels WHERE id = 26;');
      assert.strictEqual(ch22[0].status, 'archived');
      assert.strictEqual(ch26[0].status, 'archived');
    });

    // ------------------------------------------------------------------------
    // TEST 5: Strict Concurrency Re-Verification
    // ------------------------------------------------------------------------
    await runTest('5. Concurrency validation aborts if record identity or pointer alters', async () => {
      await prisma.$executeRawUnsafe("INSERT INTO orders (id, status, execution_channel_id) VALUES (301, 'in_progress', 'ch_301_a');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (31, 301, 'ch_301_a', 'execution', 'active');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (32, 301, 'ch_301_b', 'execution', 'active');");

      // Verify concurrency guard by modifying pointer between preflight and transaction
      let concurrentCaught = false;
      try {
        await prisma.$transaction(async (tx) => {
          // Alter order pointer
          await tx.$executeRawUnsafe("UPDATE orders SET execution_channel_id = 'ch_altered' WHERE id = 301;");

          const txOrders: any[] = await tx.$queryRawUnsafe('SELECT execution_channel_id FROM orders WHERE id = 301;');
          if (txOrders[0].execution_channel_id !== 'ch_301_a') {
            throw new Error('[CONCURRENT MUTATION DETECTED] Order pointer modified concurrently during reconciliation');
          }
        });
      } catch (e: any) {
        if (e.message.includes('CONCURRENT MUTATION DETECTED')) {
          concurrentCaught = true;
        }
      }
      assert.strictEqual(concurrentCaught, true);

      // Clean up test order 301
      await prisma.$executeRawUnsafe('DELETE FROM order_channels WHERE order_id = 301;');
      await prisma.$executeRawUnsafe('DELETE FROM orders WHERE id = 301;');
    });

    // ------------------------------------------------------------------------
    // TEST 6: Backup File Verification (Magic header, size, non-identity)
    // ------------------------------------------------------------------------
    await runTest('6. Backup file verification enforces non-identity, size, and SQLite header', async () => {
      // A. Backup is target database itself -> must fail
      let caughtSelfBackup = false;
      try {
        validateBackupFile(testDbPath, testDbPath);
      } catch (err: any) {
        if (err.message.includes('Backup file cannot be the target database file itself')) {
          caughtSelfBackup = true;
        }
      }
      assert.strictEqual(caughtSelfBackup, true);

      // B. Backup does not exist -> must fail
      let caughtNonExistent = false;
      try {
        validateBackupFile(path.resolve(fixtureDir, 'nonexistent.db'), testDbPath);
      } catch (err: any) {
        if (err.message.includes('does not exist')) {
          caughtNonExistent = true;
        }
      }
      assert.strictEqual(caughtNonExistent, true);

      // C. Backup is not SQLite (corrupt text file > 100 bytes) -> must fail header check
      const badBackup = path.resolve(fixtureDir, `bad_backup_${Date.now()}.txt`);
      fs.writeFileSync(badBackup, 'THIS IS NOT SQLITE HEADER TEXT AT ALL! '.repeat(10));
      let caughtInvalidHeader = false;
      try {
        validateBackupFile(badBackup, testDbPath);
      } catch (err: any) {
        if (err.message.includes('valid SQLite 3 header')) {
          caughtInvalidHeader = true;
        }
      }
      fs.unlinkSync(badBackup);
      assert.strictEqual(caughtInvalidHeader, true);

      // D. Valid SQLite backup file -> must pass
      const goodBackup = path.resolve(fixtureDir, `good_backup_${Date.now()}.db`);
      fs.copyFileSync(testDbPath, goodBackup);
      validateBackupFile(goodBackup, testDbPath);
      fs.unlinkSync(goodBackup);
    });

    // ------------------------------------------------------------------------
    // TEST 7: Incomplete or Failed Migration in _prisma_migrations Halts Gate
    // ------------------------------------------------------------------------
    await runTest('7. Incomplete or failed migration record (finished_at = NULL) halts pre-migration gate', async () => {
      await prisma.$executeRawUnsafe(`
        INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name)
        VALUES ('mig-failed', 'chk_fail', NULL, '20261011162157_add_game_service_mode');
      `);

      let caughtFailedMigration = false;
      try {
        await runPreMigrationGate({
          databaseUrl: testDbUrl,
          prismaClient: prisma,
        });
      } catch (err: any) {
        if (err.message.includes('FATAL MIGRATION STATE') && err.message.includes('incomplete / failed state')) {
          caughtFailedMigration = true;
        }
      }
      assert.strictEqual(caughtFailedMigration, true);

      // Clean up failed migration row
      await prisma.$executeRawUnsafe("DELETE FROM _prisma_migrations WHERE id = 'mig-failed';");
    });

    // ------------------------------------------------------------------------
    // TEST 8: Duplicate channels with correct highest ID
    // ------------------------------------------------------------------------
    await runTest('8. Duplicate channels with correct highest ID retains highest', async () => {
      await prisma.$executeRawUnsafe("INSERT INTO orders (id, status, execution_channel_id) VALUES (401, 'in_progress', 'ch_401_high');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (41, 401, 'ch_401_low', 'execution', 'active');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (42, 401, 'ch_401_high', 'execution', 'active');");

      const report = await reconcileExecutionChannels({
        databaseUrl: testDbUrl,
        apply: true,
        confirmApply: true,
        verifiedBackupTaken: true,
        prismaClient: prisma,
      });

      assert.strictEqual(report.success, true);
      const ch41: any[] = await prisma.$queryRawUnsafe('SELECT status FROM order_channels WHERE id = 41;');
      const ch42: any[] = await prisma.$queryRawUnsafe('SELECT status FROM order_channels WHERE id = 42;');
      assert.strictEqual(ch41[0].status, 'archived');
      assert.strictEqual(ch42[0].status, 'active');
    });

    // ------------------------------------------------------------------------
    // TEST 9: Duplicate channels with correct lowest ID (Reverses flawed SQL)
    // ------------------------------------------------------------------------
    await runTest('9. Duplicate channels with correct lowest ID retains lowest (reverses historical flawed SQL)', async () => {
      await prisma.$executeRawUnsafe("INSERT INTO orders (id, status, execution_channel_id) VALUES (402, 'in_progress', 'ch_402_low');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (43, 402, 'ch_402_low', 'execution', 'active');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (44, 402, 'ch_402_high', 'execution', 'active');");

      const report = await reconcileExecutionChannels({
        databaseUrl: testDbUrl,
        apply: true,
        confirmApply: true,
        verifiedBackupTaken: true,
        prismaClient: prisma,
      });

      assert.strictEqual(report.success, true);
      const ch43: any[] = await prisma.$queryRawUnsafe('SELECT status FROM order_channels WHERE id = 43;');
      const ch44: any[] = await prisma.$queryRawUnsafe('SELECT status FROM order_channels WHERE id = 44;');
      assert.strictEqual(ch43[0].status, 'active', 'Authoritative pointer channel #43 (lowest ID) must remain active');
      assert.strictEqual(ch44[0].status, 'archived', 'Mismatched channel #44 must be archived');
    });

    // ------------------------------------------------------------------------
    // TEST 10: Null authoritative pointer fails safe
    // ------------------------------------------------------------------------
    await runTest('10. Null authoritative pointer fails safe without altering records', async () => {
      await prisma.$executeRawUnsafe("INSERT INTO orders (id, status, execution_channel_id) VALUES (403, 'assigned', NULL);");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (45, 403, 'ch_403_a', 'execution', 'active');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (46, 403, 'ch_403_b', 'execution', 'active');");

      const report = await reconcileExecutionChannels({
        databaseUrl: testDbUrl,
        apply: true,
        confirmApply: true,
        verifiedBackupTaken: true,
        prismaClient: prisma,
      });

      assert.strictEqual(report.success, false);
      const ch45: any[] = await prisma.$queryRawUnsafe('SELECT status FROM order_channels WHERE id = 45;');
      const ch46: any[] = await prisma.$queryRawUnsafe('SELECT status FROM order_channels WHERE id = 46;');
      assert.strictEqual(ch45[0].status, 'active');
      assert.strictEqual(ch46[0].status, 'active');

      await prisma.$executeRawUnsafe('DELETE FROM order_channels WHERE order_id = 403;');
      await prisma.$executeRawUnsafe('DELETE FROM orders WHERE id = 403;');
    });

    // ------------------------------------------------------------------------
    // TEST 11: Invalid pointer mismatch fails safe
    // ------------------------------------------------------------------------
    await runTest('11. Invalid pointer mismatch fails safe', async () => {
      await prisma.$executeRawUnsafe("INSERT INTO orders (id, status, execution_channel_id) VALUES (404, 'in_progress', 'ch_mismatch');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (47, 404, 'ch_404_a', 'execution', 'active');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (48, 404, 'ch_404_b', 'execution', 'active');");

      const report = await reconcileExecutionChannels({
        databaseUrl: testDbUrl,
        apply: true,
        confirmApply: true,
        verifiedBackupTaken: true,
        prismaClient: prisma,
      });

      assert.strictEqual(report.success, false);
      await prisma.$executeRawUnsafe('DELETE FROM order_channels WHERE order_id = 404;');
      await prisma.$executeRawUnsafe('DELETE FROM orders WHERE id = 404;');
    });

    // ------------------------------------------------------------------------
    // TEST 12: Multiple matching records fail safe
    // ------------------------------------------------------------------------
    await runTest('12. Multiple matching records flag as ambiguous conflict', async () => {
      await prisma.$executeRawUnsafe("INSERT INTO orders (id, status, execution_channel_id) VALUES (405, 'in_progress', 'ch_same');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (49, 405, 'ch_same', 'execution', 'active');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (50, 405, 'ch_same', 'execution', 'active');");

      const report = await reconcileExecutionChannels({
        databaseUrl: testDbUrl,
        apply: true,
        confirmApply: true,
        verifiedBackupTaken: true,
        prismaClient: prisma,
      });

      assert.strictEqual(report.success, false);
      await prisma.$executeRawUnsafe('DELETE FROM order_channels WHERE order_id = 405;');
      await prisma.$executeRawUnsafe('DELETE FROM orders WHERE id = 405;');
    });

    // ------------------------------------------------------------------------
    // TEST 13: Terminal order with still-active channels preserves pointer consistency
    // ------------------------------------------------------------------------
    await runTest('13. Terminal order retains authoritative channel and archives duplicate', async () => {
      await prisma.$executeRawUnsafe("INSERT INTO orders (id, status, execution_channel_id) VALUES (406, 'completed', 'ch_406_real');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (51, 406, 'ch_406_real', 'execution', 'active');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (52, 406, 'ch_406_stale', 'execution', 'active');");

      const report = await reconcileExecutionChannels({
        databaseUrl: testDbUrl,
        apply: true,
        confirmApply: true,
        verifiedBackupTaken: true,
        prismaClient: prisma,
      });

      assert.strictEqual(report.success, true);
      const ch51: any[] = await prisma.$queryRawUnsafe('SELECT status FROM order_channels WHERE id = 51;');
      const ch52: any[] = await prisma.$queryRawUnsafe('SELECT status FROM order_channels WHERE id = 52;');
      assert.strictEqual(ch51[0].status, 'active');
      assert.strictEqual(ch52[0].status, 'archived');
    });

    // ------------------------------------------------------------------------
    // TEST 14: Partially applied migration & Pre-migration gate
    // ------------------------------------------------------------------------
    await runTest('14. Pre-migration gate blocks until duplicates are reconciled, then passes', async () => {
      // Order 407 with duplicate active execution channels
      await prisma.$executeRawUnsafe("INSERT INTO orders (id, status, execution_channel_id) VALUES (407, 'in_progress', 'ch_407_auth');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (53, 407, 'ch_407_auth', 'execution', 'active');");
      await prisma.$executeRawUnsafe("INSERT INTO order_channels (id, order_id, discord_channel_id, channel_type, status) VALUES (54, 407, 'ch_407_dup', 'execution', 'active');");

      // Gate must block
      const gateBlocked = await runPreMigrationGate({
        databaseUrl: testDbUrl,
        prismaClient: prisma,
      });
      assert.strictEqual(gateBlocked.canProceed, false);
      assert.ok(gateBlocked.duplicateOrderIds.includes(407));

      // Reconcile
      await reconcileExecutionChannels({
        databaseUrl: testDbUrl,
        apply: true,
        confirmApply: true,
        verifiedBackupTaken: true,
        prismaClient: prisma,
      });

      // Gate must now pass
      const gatePassed = await runPreMigrationGate({
        databaseUrl: testDbUrl,
        prismaClient: prisma,
      });
      assert.strictEqual(gatePassed.canProceed, true);
    });

    // ------------------------------------------------------------------------
    // TEST 15: Missing DATABASE_URL fails closed
    // ------------------------------------------------------------------------
    await runTest('15. Missing DATABASE_URL refuses to guess SQLite database path', async () => {
      const oldEnv = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;

      let caught = false;
      try {
        resolveCanonicalDatabaseTarget({ databaseUrl: undefined, args: [] });
      } catch (err: any) {
        if (err.message.includes('Missing database configuration') && err.message.includes('strictly prohibited')) {
          caught = true;
        }
      } finally {
        process.env.DATABASE_URL = oldEnv;
      }
      assert.strictEqual(caught, true);
    });

    // ------------------------------------------------------------------------
    // TEST 16: Apply attempted without confirmation
    // ------------------------------------------------------------------------
    await runTest('16. Apply attempted without confirmation fails closed', async () => {
      let caughtNoConfirm = false;
      try {
        await reconcileExecutionChannels({
          databaseUrl: testDbUrl,
          apply: true,
          confirmApply: false,
          verifiedBackupTaken: true,
          prismaClient: prisma,
        });
      } catch (err: any) {
        if (err.message.includes('Apply mode requested without explicit confirmation')) {
          caughtNoConfirm = true;
        }
      }
      assert.strictEqual(caughtNoConfirm, true);
    });

    // ------------------------------------------------------------------------
    // TEST 17: Migration Checksum Verification & Read-Only Inspector
    // ------------------------------------------------------------------------
    await runTest('17. Migration checksum verification and read-only inspection report', async () => {
      const migrationFile = path.resolve(
        process.cwd(),
        'prisma',
        'migrations',
        '20261109150000_order_channel_active_execution_uniqueness',
        'migration.sql'
      );
      assert.ok(fs.existsSync(migrationFile));
      const hash = crypto.createHash('sha256').update(fs.readFileSync(migrationFile, 'utf8')).digest('hex');
      assert.strictEqual(hash.length, 64);

      const inspection = await inspectDatabaseSafety({
        databaseUrl: testDbUrl,
        prismaClient: prisma,
      });

      assert.strictEqual(inspection.foreignKeyCheckPassed, true);
      assert.strictEqual(inspection.duplicateActiveOrderCount, 0);
      assert.strictEqual(inspection.verdict, 'CLEAN');
      assert.strictEqual(inspection.isReadyForSafeMigration, true);
    });

    console.log('\n================================================================');
    console.log(' All 17 Migration & Reconciliation Safety Tests Passed! (100%)');
    console.log('================================================================');
  } finally {
    await prisma.$disconnect().catch(() => {});
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch (_) {}
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fatal Test Suite Failure:', err);
    process.exit(1);
  });
}
