import prisma from '../src/database/db';

async function main() {
  console.log('Re-applying Phase 5 migration with correct SQLite column names...');

  // Drop tables in reverse order to ensure clean foreign keys
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "generated_financial_reports";`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "automated_report_schedules";`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "financial_snapshots";`);

  const statements = [
    `CREATE TABLE IF NOT EXISTS "financial_snapshots" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "snapshot_ref" TEXT NOT NULL,
        "snapshot_type" TEXT NOT NULL,
        "snapshot_date" DATETIME NOT NULL,
        "captured_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "admin_id" TEXT,
        "notes" TEXT,
        "g4x_direct_balance" BIGINT NOT NULL DEFAULT 0,
        "eldorado_balance" BIGINT NOT NULL DEFAULT 0,
        "skycoach_balance" BIGINT NOT NULL DEFAULT 0,
        "overgear_balance" BIGINT NOT NULL DEFAULT 0,
        "kingboost_balance" BIGINT NOT NULL DEFAULT 0,
        "usd_wallet_balance" BIGINT NOT NULL DEFAULT 0,
        "toman_accounts_balance" BIGINT NOT NULL DEFAULT 0,
        "total_usd_assets" BIGINT NOT NULL DEFAULT 0,
        "total_toman_assets" BIGINT NOT NULL DEFAULT 0,
        "pending_withdrawals_usd" BIGINT NOT NULL DEFAULT 0,
        "reserved_balances_usd" BIGINT NOT NULL DEFAULT 0,
        "completed_order_earnings_usd" BIGINT NOT NULL DEFAULT 0,
        "total_withdrawals_usd" BIGINT NOT NULL DEFAULT 0,
        "total_business_revenue_usd" BIGINT NOT NULL DEFAULT 0,
        "net_profit_usd" BIGINT NOT NULL DEFAULT 0,
        "total_business_expenses_usd" BIGINT NOT NULL DEFAULT 0,
        "payload" TEXT,
        CONSTRAINT "financial_snapshots_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "financial_snapshots_snapshot_ref_key" ON "financial_snapshots"("snapshot_ref");`,
    `CREATE INDEX IF NOT EXISTS "financial_snapshots_snapshot_type_snapshot_date_idx" ON "financial_snapshots"("snapshot_type", "snapshot_date");`,
    `CREATE INDEX IF NOT EXISTS "financial_snapshots_captured_at_idx" ON "financial_snapshots"("captured_at");`,

    `CREATE TABLE IF NOT EXISTS "automated_report_schedules" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "schedule_ref" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "report_type" TEXT NOT NULL,
        "frequency" TEXT NOT NULL,
        "cron_expression" TEXT NOT NULL DEFAULT '0 0 * * *',
        "format" TEXT NOT NULL DEFAULT 'CSV',
        "target_platform" TEXT,
        "recipient_emails" TEXT,
        "is_enabled" BOOLEAN NOT NULL DEFAULT 1,
        "last_run_at" DATETIME,
        "next_run_at" DATETIME,
        "last_status" TEXT,
        "last_error" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "automated_report_schedules_schedule_ref_key" ON "automated_report_schedules"("schedule_ref");`,
    `CREATE INDEX IF NOT EXISTS "automated_report_schedules_frequency_is_enabled_idx" ON "automated_report_schedules"("frequency", "is_enabled");`,

    `CREATE TABLE IF NOT EXISTS "generated_financial_reports" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "report_ref" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "report_type" TEXT NOT NULL,
        "period_type" TEXT NOT NULL,
        "start_date" DATETIME NOT NULL,
        "end_date" DATETIME NOT NULL,
        "format" TEXT NOT NULL,
        "file_url" TEXT,
        "file_content" TEXT,
        "file_size_bytes" INTEGER NOT NULL DEFAULT 0,
        "schedule_id" TEXT,
        "generated_by_id" TEXT,
        "metadata" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "generated_financial_reports_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "automated_report_schedules" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "generated_financial_reports_generated_by_id_fkey" FOREIGN KEY ("generated_by_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "generated_financial_reports_report_ref_key" ON "generated_financial_reports"("report_ref");`,
    `CREATE INDEX IF NOT EXISTS "generated_financial_reports_report_type_created_at_idx" ON "generated_financial_reports"("report_type", "created_at");`,
    `CREATE INDEX IF NOT EXISTS "generated_financial_reports_schedule_id_idx" ON "generated_financial_reports"("schedule_id");`,
  ];

  for (const sql of statements) {
    await prisma.$executeRawUnsafe(sql);
  }

  console.log('✅ Phase 5 migration successfully applied with correct foreign keys!');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
