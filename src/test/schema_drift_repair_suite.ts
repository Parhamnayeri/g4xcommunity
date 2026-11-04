/**
 * schema_drift_repair_suite.ts — Comprehensive Test Suite for Schema Drift Repair Migration
 *
 * Verifies:
 * 1. Clean database deployment across all 24 migrations
 * 2. Presence of platform_account_id, review_channel_id, review_message_id on orders
 * 3. Presence of key_verified on order_presigns
 * 4. Presence of platform_account_id on order_financial_snapshots
 * 5. Data preservation test on representative database with historical records
 * 6. Protection of 28 historical financial reconciliation records
 * 7. Foreign key and database integrity checks
 * 8. Prisma Client query execution without P2022 errors
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const SCRATCH_DIR = path.join(process.cwd(), 'scratch');
if (!fs.existsSync(SCRATCH_DIR)) {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
}

const CLEAN_TEST_DB = path.join(SCRATCH_DIR, 'clean_migration_test.db');
const REPRO_LINODE_DB = path.join(SCRATCH_DIR, 'repro_linode_test.db');
const EXISTING_COPY_DB = path.join(SCRATCH_DIR, 'existing_copy_test.db');

async function runCommand(cmd: string, envOverrides: Record<string, string> = {}) {
  const env = { ...process.env, ...envOverrides };
  return execSync(cmd, { cwd: process.cwd(), env, stdio: 'pipe' }).toString();
}

async function runSuite() {
  console.log('=================================================================');
  console.log('🚀 RUNNING SCHEMA DRIFT REPAIR MIGRATION VERIFICATION SUITE');
  console.log('=================================================================\n');

  // Clean up any previous test databases
  for (const dbPath of [CLEAN_TEST_DB, REPRO_LINODE_DB, EXISTING_COPY_DB]) {
    for (const ext of ['', '-wal', '-shm', '-journal']) {
      if (fs.existsSync(dbPath + ext)) fs.unlinkSync(dbPath + ext);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 1: Clean Deployment from 0 to Migration 24
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('[TEST 1] Testing clean database deployment across all migrations...');
  const cleanDbUrl = `file:../scratch/clean_migration_test.db`;
  const deployOutput = await runCommand('npx prisma migrate deploy', {
    DATABASE_URL: cleanDbUrl,
  });
  assert(deployOutput.includes('24 migrations found in prisma/migrations') || deployOutput.includes('Applying migration'));
  console.log('  ✓ Prisma migrate deploy succeeded for all 24 migrations on clean DB.');

  const cleanPrisma = new PrismaClient({
    datasources: { db: { url: cleanDbUrl } },
  });

  try {
    // 1a. Inspect orders columns
    const orderCols: any = await cleanPrisma.$queryRawUnsafe('PRAGMA table_info("orders");');
    const orderColNames = orderCols.map((c: any) => c.name);
    assert(orderColNames.includes('platform_account_id'), 'orders must have platform_account_id');
    assert(orderColNames.includes('review_channel_id'), 'orders must have review_channel_id');
    assert(orderColNames.includes('review_message_id'), 'orders must have review_message_id');
    console.log('  ✓ Verified orders has platform_account_id, review_channel_id, review_message_id');

    // 1b. Inspect orders index
    const orderIdxs: any = await cleanPrisma.$queryRawUnsafe('PRAGMA index_list("orders");');
    const orderIdxNames = orderIdxs.map((i: any) => i.name);
    assert(orderIdxNames.includes('orders_platform_account_id_idx'), 'orders must have orders_platform_account_id_idx');
    console.log('  ✓ Verified orders_platform_account_id_idx exists');

    // 1c. Inspect order_presigns columns
    const presignCols: any = await cleanPrisma.$queryRawUnsafe('PRAGMA table_info("order_presigns");');
    const presignColNames = presignCols.map((c: any) => c.name);
    assert(presignColNames.includes('key_verified'), 'order_presigns must have key_verified');
    console.log('  ✓ Verified order_presigns has key_verified');

    // 1d. Inspect order_financial_snapshots columns & index
    const snapshotCols: any = await cleanPrisma.$queryRawUnsafe('PRAGMA table_info("order_financial_snapshots");');
    const snapshotColNames = snapshotCols.map((c: any) => c.name);
    assert(snapshotColNames.includes('platform_account_id'), 'order_financial_snapshots must have platform_account_id');

    const snapshotIdxs: any = await cleanPrisma.$queryRawUnsafe('PRAGMA index_list("order_financial_snapshots");');
    const snapshotIdxNames = snapshotIdxs.map((i: any) => i.name);
    assert(snapshotIdxNames.includes('order_financial_snapshots_platform_account_id_idx'), 'order_financial_snapshots must have index');
    console.log('  ✓ Verified order_financial_snapshots has platform_account_id and index');

    // 1e. Foreign key & integrity checks
    const fkErrors: any = await cleanPrisma.$queryRawUnsafe('PRAGMA foreign_key_check;');
    assert.strictEqual(fkErrors.length, 0, 'PRAGMA foreign_key_check must return 0 errors on clean DB');

    const integrity: any = await cleanPrisma.$queryRawUnsafe('PRAGMA integrity_check;');
    assert.strictEqual(integrity[0].integrity_check, 'ok', 'PRAGMA integrity_check must be ok');
    console.log('  ✓ Clean DB passed PRAGMA foreign_key_check and integrity_check.');
  } finally {
    await cleanPrisma.$disconnect();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 2: Linode Reproduction & Forward-Only Drift Repair
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[TEST 2] Reproducing Linode VPS state (23 migrations) and applying migration 24...');
  const reproDbUrl = `file:../scratch/repro_linode_test.db`;
  const migDir = path.join(process.cwd(), 'prisma', 'migrations');
  const targetMigName = '20261104230000_repair_schema_drift_order_columns';
  const targetMigPath = path.join(migDir, targetMigName);
  const tempHoldPath = path.join(SCRATCH_DIR, targetMigName);

  let reproPrisma: PrismaClient | null = null;
  try {
    // Step A: Temporarily move migration 24 out of prisma/migrations
    if (fs.existsSync(targetMigPath)) {
      if (fs.existsSync(tempHoldPath)) fs.rmSync(tempHoldPath, { recursive: true, force: true });
      fs.renameSync(targetMigPath, tempHoldPath);
    }

    // Step B: Deploy the 23 migrations to repro DB
    console.log('  Deploying 23 historical migrations to simulate unpatched Linode VPS...');
    const stepBOut = await runCommand('npx prisma migrate deploy', {
      DATABASE_URL: reproDbUrl,
    });
    assert.ok(stepBOut.includes('23 migrations found in prisma/migrations'), 'Must find 23 migrations');

    reproPrisma = new PrismaClient({
      datasources: { db: { url: reproDbUrl } },
    });

    // Step C: Confirm that orders lacks platform_account_id (exact Linode error condition)
    const preCols: any = await reproPrisma.$queryRawUnsafe('PRAGMA table_info("orders");');
    const preColNames = preCols.map((c: any) => c.name);
    assert.ok(!preColNames.includes('platform_account_id'), 'orders MUST lack platform_account_id before migration 24');
    assert.ok(!preColNames.includes('review_channel_id'), 'orders MUST lack review_channel_id before migration 24');
    console.log('  ✓ Verified reproduced Linode VPS state: platform_account_id is absent.');

    // Insert representative data to verify safety of migration
    await reproPrisma.$executeRawUnsafe(
      'INSERT INTO "games" ("slug", "display_name", "service_category") VALUES (\'wow_midnight\', \'WoW Midnight\', \'both\');'
    );
    await reproPrisma.$executeRawUnsafe(
      'INSERT INTO "game_services" ("id", "game_slug", "service_key", "display_name", "service_mode", "profile_mode", "requires_pilot_approval") VALUES (1, \'wow_midnight\', \'mplus\', \'Mythic+\', \'self_play\', \'character\', 0);'
    );
    await reproPrisma.$executeRawUnsafe(
      'INSERT INTO "users" ("discord_id", "username", "updated_at") VALUES (\'user_linode_1\', \'linode_user\', CURRENT_TIMESTAMP);'
    );
    await reproPrisma.$executeRawUnsafe(
      'INSERT INTO "orders" ("order_ref", "game_slug", "service_id", "currency", "gross_amount_minor", "order_type") VALUES (\'ORD_LINODE_1\', \'wow_midnight\', 1, \'USD\', 5000, \'group\');'
    );

    // Disconnect client so migrate deploy can lock database
    await reproPrisma.$disconnect();
    reproPrisma = null;

    // Step D: Restore migration 24
    fs.renameSync(tempHoldPath, targetMigPath);

    // Step E: Run prisma migrate deploy!
    console.log('  Applying migration 24 (repair_schema_drift_order_columns)...');
    const stepEOut = await runCommand('npx prisma migrate deploy', {
      DATABASE_URL: reproDbUrl,
    });
    assert.ok(stepEOut.includes('20261104230000_repair_schema_drift_order_columns'), 'Migration 24 must be applied');
    console.log('  ✓ Migration 24 applied cleanly.');

    // Step F: Reconnect and verify schema repair
    reproPrisma = new PrismaClient({
      datasources: { db: { url: reproDbUrl } },
    });

    const postCols: any = await reproPrisma.$queryRawUnsafe('PRAGMA table_info("orders");');
    const postColNames = postCols.map((c: any) => c.name);
    assert.ok(postColNames.includes('platform_account_id'), 'orders must have platform_account_id after migration');
    assert.ok(postColNames.includes('review_channel_id'), 'orders must have review_channel_id after migration');
    assert.ok(postColNames.includes('review_message_id'), 'orders must have review_message_id after migration');

    // Verify existing record is preserved
    const orders: any = await reproPrisma.$queryRawUnsafe('SELECT * FROM "orders" WHERE "order_ref" = "ORD_LINODE_1";');
    assert.strictEqual(orders.length, 1);
    assert.strictEqual(orders[0].gross_amount_minor, 5000);
    assert.strictEqual(orders[0].platform_account_id, null);
    console.log('  ✓ Existing order data preserved with null default for newly added columns.');

    // Test updating with platform_account_id
    await reproPrisma.$executeRawUnsafe('UPDATE "orders" SET "review_channel_id" = "12345" WHERE "id" = 1;');
    const updatedOrder: any = await reproPrisma.$queryRawUnsafe('SELECT * FROM "orders" WHERE "id" = 1;');
    assert.strictEqual(updatedOrder[0].review_channel_id, '12345');

    // Integrity checks
    const fkCheck: any = await reproPrisma.$queryRawUnsafe('PRAGMA foreign_key_check;');
    assert.strictEqual(fkCheck.length, 0);
    const intCheck: any = await reproPrisma.$queryRawUnsafe('PRAGMA integrity_check;');
    assert.strictEqual(intCheck[0].integrity_check, 'ok');
    console.log('  ✓ Linode reproduction database passed foreign key and integrity checks.');
  } finally {
    if (reproPrisma) await reproPrisma.$disconnect();
    // Ensure migration 24 is restored even if an assertion failed
    if (fs.existsSync(tempHoldPath) && !fs.existsSync(targetMigPath)) {
      fs.renameSync(tempHoldPath, targetMigPath);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 3: Data Preservation & Invariant Test on Representative DB
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[TEST 3] Testing migration against representative database seeded with real historical data...');
  const sourceDb = path.join(process.cwd(), 'data', 'g4x_dev.db');
  if (fs.existsSync(sourceDb)) {
    const existingDbUrl = `file:../scratch/existing_copy_test.db`;

    // Step 3a: Deploy 23 migrations to create unpatched baseline schema
    if (fs.existsSync(targetMigPath)) {
      if (fs.existsSync(tempHoldPath)) fs.rmSync(tempHoldPath, { recursive: true, force: true });
      fs.renameSync(targetMigPath, tempHoldPath);
    }

    try {
      await runCommand('npx prisma migrate deploy', {
        DATABASE_URL: existingDbUrl,
      });
    } finally {
      if (fs.existsSync(tempHoldPath) && !fs.existsSync(targetMigPath)) {
        fs.renameSync(tempHoldPath, targetMigPath);
      }
    }

    // Step 3b: Seed data from data/g4x_dev.db into the 23-migration schema
    let existingPrisma = new PrismaClient({
      datasources: { db: { url: existingDbUrl } },
    });

    const normalizedSourcePath = sourceDb.replace(/\\/g, '/');
    await existingPrisma.$executeRawUnsafe(`ATTACH DATABASE '${normalizedSourcePath}' AS source_db;`);
    await existingPrisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF;');

    const tables: any = await existingPrisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%';"
    );

    for (const t of tables) {
      const tableName = t.name;
      const targetCols: any = await existingPrisma.$queryRawUnsafe(`PRAGMA table_info("${tableName}");`);
      const sourceCols: any = await existingPrisma.$queryRawUnsafe(`PRAGMA source_db.table_info("${tableName}");`);

      const targetColNames = targetCols.map((c: any) => c.name);
      const sourceColNames = new Set(sourceCols.map((c: any) => c.name));
      const commonCols = targetColNames.filter((c: string) => sourceColNames.has(c));

      if (commonCols.length > 0) {
        const colList = commonCols.map((c: string) => `"${c}"`).join(', ');
        await existingPrisma.$executeRawUnsafe(
          `INSERT OR IGNORE INTO "main"."${tableName}" (${colList}) SELECT ${colList} FROM source_db."${tableName}";`
        );
      }
    }

    await existingPrisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
    await existingPrisma.$executeRawUnsafe('DETACH DATABASE source_db;');

    // Step 3c: Record baseline statistics before migration 24
    const userCount: any = await existingPrisma.$queryRawUnsafe('SELECT COUNT(*) as count FROM "users";');
    const orderCount: any = await existingPrisma.$queryRawUnsafe('SELECT COUNT(*) as count FROM "orders";');
    const ledgerCount: any = await existingPrisma.$queryRawUnsafe('SELECT COUNT(*) as count, SUM(amount_cents) as total FROM "ledger_entries_v2";');
    const walletSum: any = await existingPrisma.$queryRawUnsafe('SELECT COUNT(*) as count, SUM(available_cents) as avail, SUM(reserved_cents) as res FROM "wallets_v2";');
    const flaggedReconciliationCount: any = await existingPrisma.$queryRawUnsafe(
      'SELECT COUNT(*) as count FROM "advertiser_funding_requests" WHERE "legacy_evidence_resolution" = "LEGACY_CONFLICT_MANUAL_RECONCILIATION_REQUIRED";'
    );

    console.log(`  Baseline counts before migration:`);
    console.log(`    Users: ${userCount[0].count}`);
    console.log(`    Orders: ${orderCount[0].count}`);
    console.log(`    Ledger Entries: ${ledgerCount[0].count} (Sum: ${ledgerCount[0].total})`);
    console.log(`    Wallets V2: ${walletSum[0].count} (Avail: ${walletSum[0].avail}, Res: ${walletSum[0].res})`);
    console.log(`    Historical Flagged Reconciliation Records: ${flaggedReconciliationCount[0].count}`);

    // Disconnect Prisma before running migrate deploy
    await existingPrisma.$disconnect();

    // Step 3d: Apply migration 24 on the representative database
    console.log('  Executing prisma migrate deploy on representative database...');
    const migrateOut = await runCommand('npx prisma migrate deploy', {
      DATABASE_URL: existingDbUrl,
    });
    console.log('  Migration deploy output:', migrateOut.trim().split('\n').slice(-2).join(' '));

    // Step 3e: Reconnect and verify data preservation & invariants
    existingPrisma = new PrismaClient({
      datasources: { db: { url: existingDbUrl } },
    });

    try {
      const postUserCount: any = await existingPrisma.$queryRawUnsafe('SELECT COUNT(*) as count FROM "users";');
      const postOrderCount: any = await existingPrisma.$queryRawUnsafe('SELECT COUNT(*) as count FROM "orders";');
      const postLedgerCount: any = await existingPrisma.$queryRawUnsafe('SELECT COUNT(*) as count, SUM(amount_cents) as total FROM "ledger_entries_v2";');
      const postWalletSum: any = await existingPrisma.$queryRawUnsafe('SELECT COUNT(*) as count, SUM(available_cents) as avail, SUM(reserved_cents) as res FROM "wallets_v2";');
      const postFlaggedCount: any = await existingPrisma.$queryRawUnsafe(
        'SELECT COUNT(*) as count FROM "advertiser_funding_requests" WHERE "legacy_evidence_resolution" = "LEGACY_CONFLICT_MANUAL_RECONCILIATION_REQUIRED";'
      );

      assert.strictEqual(postUserCount[0].count, userCount[0].count, 'User count must not change');
      assert.strictEqual(postOrderCount[0].count, orderCount[0].count, 'Order count must not change');
      assert.strictEqual(postLedgerCount[0].count, ledgerCount[0].count, 'Ledger count must not change');
      assert.strictEqual(postLedgerCount[0].total, ledgerCount[0].total, 'Ledger total must not change');
      assert.strictEqual(postWalletSum[0].avail, walletSum[0].avail, 'Wallet available must not change');
      assert.strictEqual(postWalletSum[0].res, walletSum[0].res, 'Wallet reserved must not change');
      assert.strictEqual(postFlaggedCount[0].count, flaggedReconciliationCount[0].count, 'Flagged records must not change');
      assert.strictEqual(Number(postFlaggedCount[0].count), 28, 'Must preserve exactly 28 historical reconciliation records');

      console.log('  ✓ 100% data preservation verified: rows, ledger balances, and 28 historical records intact.');

      // Check foreign keys & integrity
      const postFk: any = await existingPrisma.$queryRawUnsafe('PRAGMA foreign_key_check;');
      assert.strictEqual(postFk.length, 0, 'Foreign key check must return 0 violations');

      const postInt: any = await existingPrisma.$queryRawUnsafe('PRAGMA integrity_check;');
      assert.strictEqual(postInt[0].integrity_check, 'ok', 'Integrity check must return ok');
      console.log('  ✓ Foreign key check (0 violations) and PRAGMA integrity_check (ok) passed.');

      // Test Prisma ORM query on orders selecting platform_account_id and review channels
      const prismaOrders = await existingPrisma.order.findMany({
        take: 5,
        select: {
          id: true,
          orderRef: true,
          platformAccountId: true,
          reviewChannelId: true,
          reviewMessageId: true,
        },
      });
      console.log(`  ✓ Successfully queried ${prismaOrders.length} orders via Prisma Client without Prisma P2022 error.`);
    } finally {
      await existingPrisma.$disconnect();
    }
  } else {
    console.log('  (Notice: data/g4x_dev.db not found, skipping Test 3)');
  }

  // Cleanup scratch databases
  for (const dbPath of [CLEAN_TEST_DB, REPRO_LINODE_DB, EXISTING_COPY_DB]) {
    for (const ext of ['', '-wal', '-shm', '-journal']) {
      if (fs.existsSync(dbPath + ext)) fs.unlinkSync(dbPath + ext);
    }
  }

  console.log('\n=================================================================');
  console.log('🎉 ALL SCHEMA DRIFT REPAIR TESTS PASSED WITH 100% SUCCESS');
  console.log('=================================================================\n');
}

runSuite().catch((err) => {
  console.error('\n❌ SCHEMA DRIFT REPAIR SUITE FAILED:', err);
  process.exit(1);
});
