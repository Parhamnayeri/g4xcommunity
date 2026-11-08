-- CreateTable
CREATE TABLE "platform_fee_policies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "platform" TEXT NOT NULL,
    "game_slug" TEXT,
    "listing_category" TEXT,
    "fee_type" TEXT NOT NULL,
    "charging_event" TEXT NOT NULL,
    "percentage_rate" REAL,
    "fixed_minor" INTEGER,
    "fee_basis" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "min_threshold_minor" INTEGER,
    "payout_route_scope" TEXT,
    "effective_from" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_approved" BOOLEAN NOT NULL DEFAULT true,
    "approved_by" TEXT,
    "change_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "platform_withdrawal_batches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batch_ref" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "total_contributions_minor" INTEGER NOT NULL,
    "actual_batch_fee_minor" INTEGER NOT NULL,
    "actual_transfer_fee_minor" INTEGER NOT NULL DEFAULT 0,
    "net_received_minor" INTEGER NOT NULL,
    "external_receipt_ref" TEXT,
    "external_receipt_notes" TEXT,
    "withdrawn_at" DATETIME,
    "reconciled_at" DATETIME,
    "reconciled_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_withdrawal_batches_reconciled_by_fkey" FOREIGN KEY ("reconciled_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_withdrawal_allocations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batch_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "contribution_amount_minor" INTEGER NOT NULL,
    "allocated_batch_fee_minor" INTEGER NOT NULL,
    "allocated_transfer_fee_minor" INTEGER NOT NULL DEFAULT 0,
    "net_contribution_minor" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_withdrawal_allocations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "platform_withdrawal_batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_withdrawal_allocations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_financial_snapshots" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "source_platform" TEXT NOT NULL,
    "source_amount_type" TEXT NOT NULL,
    "source_amount_minor" INTEGER NOT NULL,
    "gross_sale_minor" INTEGER,
    "platform_sale_commission_minor" INTEGER NOT NULL DEFAULT 0,
    "platform_order_net_minor" INTEGER NOT NULL,
    "allocated_withdrawal_fee_minor" INTEGER NOT NULL DEFAULT 0,
    "allocated_transfer_fee_minor" INTEGER NOT NULL DEFAULT 0,
    "other_external_fees_minor" INTEGER NOT NULL DEFAULT 0,
    "external_net_base_minor" INTEGER NOT NULL,
    "g4x_fee_rate" REAL,
    "g4x_fee_minor" INTEGER NOT NULL DEFAULT 0,
    "advertiser_fee_minor" INTEGER NOT NULL DEFAULT 0,
    "booster_pool_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "calculation_status" TEXT NOT NULL DEFAULT 'provisional',
    "policy_version" INTEGER,
    "listing_category" TEXT,
    "finalized_by" TEXT,
    "finalized_at" DATETIME,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_financial_snapshots_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_financial_snapshots_finalized_by_fkey" FOREIGN KEY ("finalized_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "booster_payout_allocations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "booster_id" TEXT NOT NULL,
    "run_id" INTEGER,
    "allocated_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payout_role" TEXT DEFAULT 'team_member',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booster_payout_allocations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "booster_payout_allocations_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "booster_payout_allocations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "order_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "platform_fee_policies_platform_game_slug_listing_category_idx" ON "platform_fee_policies"("platform", "game_slug", "listing_category");

-- CreateIndex
CREATE INDEX "platform_fee_policies_platform_fee_type_is_approved_idx" ON "platform_fee_policies"("platform", "fee_type", "is_approved");

-- CreateIndex
CREATE UNIQUE INDEX "platform_withdrawal_batches_batch_ref_key" ON "platform_withdrawal_batches"("batch_ref");

-- CreateIndex
CREATE INDEX "platform_withdrawal_batches_platform_status_idx" ON "platform_withdrawal_batches"("platform", "status");

-- CreateIndex
CREATE INDEX "order_withdrawal_allocations_order_id_idx" ON "order_withdrawal_allocations"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_withdrawal_allocations_batch_id_order_id_key" ON "order_withdrawal_allocations"("batch_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_financial_snapshots_order_id_key" ON "order_financial_snapshots"("order_id");

-- CreateIndex
CREATE INDEX "order_financial_snapshots_source_platform_calculation_status_idx" ON "order_financial_snapshots"("source_platform", "calculation_status");

-- CreateIndex
CREATE INDEX "booster_payout_allocations_booster_id_idx" ON "booster_payout_allocations"("booster_id");

-- CreateIndex
CREATE UNIQUE INDEX "booster_payout_allocations_order_id_booster_id_key" ON "booster_payout_allocations"("order_id", "booster_id");
