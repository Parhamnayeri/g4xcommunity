-- CreateTable: advertiser_order_metadata
CREATE TABLE IF NOT EXISTS "advertiser_order_metadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_id" INTEGER NOT NULL,
    "advertiser_order_id" TEXT,
    "additional_costs_minor" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "advertiser_order_metadata_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "advertiser_order_metadata_order_id_key" ON "advertiser_order_metadata"("order_id");
CREATE INDEX IF NOT EXISTS "advertiser_order_metadata_advertiser_order_id_idx" ON "advertiser_order_metadata"("advertiser_order_id");

-- CreateTable: financial_report_snapshots
CREATE TABLE IF NOT EXISTS "financial_report_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshot_ref" TEXT NOT NULL,
    "report_type" TEXT NOT NULL,
    "platform" TEXT,
    "period_type" TEXT NOT NULL,
    "start_date" DATETIME NOT NULL,
    "end_date" DATETIME NOT NULL,
    "metrics_json" TEXT NOT NULL,
    "generated_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "financial_report_snapshots_snapshot_ref_key" ON "financial_report_snapshots"("snapshot_ref");
CREATE INDEX IF NOT EXISTS "financial_report_snapshots_report_type_platform_period_type_idx" ON "financial_report_snapshots"("report_type", "platform", "period_type");
CREATE INDEX IF NOT EXISTS "financial_report_snapshots_start_date_end_date_idx" ON "financial_report_snapshots"("start_date", "end_date");
