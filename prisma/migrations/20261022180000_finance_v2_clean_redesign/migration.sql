-- CreateTable
CREATE TABLE "wallets_v2" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "available_cents" INTEGER NOT NULL DEFAULT 0,
    "reserved_cents" INTEGER NOT NULL DEFAULT 0,
    "pending_earnings_cents" INTEGER NOT NULL DEFAULT 0,
    "confirmed_earnings_cents" INTEGER NOT NULL DEFAULT 0,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "custom_commission_rate" REAL DEFAULT 0.15,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wallets_v2_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "wallets_v2_positive_balances_check" CHECK (
        "available_cents" >= 0 AND
        "reserved_cents" >= 0 AND
        "pending_earnings_cents" >= 0 AND
        "confirmed_earnings_cents" >= 0 AND
        "paid_cents" >= 0 AND
        "refunded_cents" >= 0
    )
);

-- CreateTable
CREATE TABLE "ledger_entries_v2" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entry_ref" TEXT NOT NULL,
    "user_id" TEXT,
    "order_id" INTEGER,
    "funding_request_id" INTEGER,
    "withdrawal_request_id" INTEGER,
    "amount_cents" INTEGER NOT NULL,
    "entry_type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "balance_after_available_cents" INTEGER,
    "balance_after_reserved_cents" INTEGER,
    "description" TEXT,
    "metadata" TEXT,
    "created_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_v2_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ledger_entries_v2_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ledger_entries_v2_funding_request_id_fkey" FOREIGN KEY ("funding_request_id") REFERENCES "advertiser_funding_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ledger_entries_v2_withdrawal_request_id_fkey" FOREIGN KEY ("withdrawal_request_id") REFERENCES "booster_withdrawal_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "advertiser_funding_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "funding_ref" TEXT NOT NULL,
    "advertiser_id" TEXT NOT NULL,
    "funding_method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "target_usd_cents" INTEGER NOT NULL,
    "external_currency" TEXT NOT NULL,
    "external_amount_units" TEXT NOT NULL,
    "network" TEXT,
    "exchange_rate" REAL,
    "currency_purchase_fee_rate" REAL,
    "fee_amount_units" TEXT,
    "evidence_ref" TEXT,
    "payer_identifier" TEXT,
    "admin_notes" TEXT,
    "verified_by" TEXT,
    "verified_at" DATETIME,
    "credited_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "advertiser_funding_requests_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "advertiser_funding_requests_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "gold_exchange_trade_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trade_ref" TEXT NOT NULL,
    "advertiser_id" TEXT NOT NULL,
    "exchanger_id" TEXT NOT NULL,
    "funding_request_id" INTEGER,
    "game_slug" TEXT NOT NULL DEFAULT 'wow_midnight',
    "gold_quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TRADE_PENDING',
    "trade_evidence_ref" TEXT,
    "external_payment_method" TEXT,
    "external_payment_amount" TEXT,
    "external_payment_ref" TEXT,
    "external_payment_confirmed_at" DATETIME,
    "resulting_usd_cents" INTEGER,
    "wallet_credit_status" TEXT NOT NULL DEFAULT 'BLOCKED_PENDING_DIRECTION_CONFIRMATION',
    "rejection_reason" TEXT,
    "verified_by" TEXT,
    "verified_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gold_exchange_trade_orders_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "gold_exchange_trade_orders_exchanger_id_fkey" FOREIGN KEY ("exchanger_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "gold_exchange_trade_orders_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "gold_exchange_trade_orders_funding_request_id_fkey" FOREIGN KEY ("funding_request_id") REFERENCES "advertiser_funding_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "booster_withdrawal_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "withdrawal_ref" TEXT NOT NULL,
    "booster_id" TEXT NOT NULL,
    "payout_method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requested_usd_cents" INTEGER NOT NULL,
    "fixed_fee_usd_cents" INTEGER NOT NULL,
    "net_usd_cents" INTEGER NOT NULL,
    "quote_rate" REAL,
    "effective_rate" REAL,
    "rate_discount" INTEGER DEFAULT 0,
    "quoted_net_payout_amount" TEXT NOT NULL,
    "quoted_currency" TEXT NOT NULL,
    "quote_expires_at" DATETIME,
    "user_confirmed_at" DATETIME,
    "destination_address" TEXT NOT NULL,
    "destination_account_holder" TEXT,
    "scheduled_cycle_day" TEXT,
    "scheduled_cycle_date" DATETIME,
    "scheduling_status" TEXT NOT NULL DEFAULT 'PENDING_SCHEDULE',
    "approved_by" TEXT,
    "approved_at" DATETIME,
    "processed_by" TEXT,
    "processed_at" DATETIME,
    "external_tx_hash" TEXT,
    "bank_receipt_ref" TEXT,
    "rejection_reason" TEXT,
    "cancel_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booster_withdrawal_requests_booster_id_fkey" FOREIGN KEY ("booster_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "booster_withdrawal_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "booster_withdrawal_requests_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "g4x_boost_release_trackers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'RUN_COMPLETED',
    "proof_submitted_at" DATETIME,
    "staff_reviewed_at" DATETIME,
    "staff_reviewed_by" TEXT,
    "admin_final_approved_at" DATETIME,
    "admin_final_approved_by" TEXT,
    "hold_duration_hours" INTEGER NOT NULL DEFAULT 24,
    "hold_expires_at" DATETIME,
    "is_funds_reconciled" BOOLEAN NOT NULL DEFAULT false,
    "is_calculation_finalized" BOOLEAN NOT NULL DEFAULT false,
    "has_active_dispute" BOOLEAN NOT NULL DEFAULT false,
    "has_active_hold" BOOLEAN NOT NULL DEFAULT false,
    "is_released" BOOLEAN NOT NULL DEFAULT false,
    "released_at" DATETIME,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "g4x_boost_release_trackers_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "g4x_boost_release_trackers_staff_reviewed_by_fkey" FOREIGN KEY ("staff_reviewed_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "g4x_boost_release_trackers_admin_final_approved_by_fkey" FOREIGN KEY ("admin_final_approved_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "system_financial_configs" (
    "config_key" TEXT NOT NULL PRIMARY KEY,
    "config_value" TEXT NOT NULL,
    "description" TEXT,
    "updated_by" TEXT,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_v2_entry_ref_key" ON "ledger_entries_v2"("entry_ref");
CREATE INDEX "ledger_entries_v2_user_id_idx" ON "ledger_entries_v2"("user_id");
CREATE INDEX "ledger_entries_v2_order_id_idx" ON "ledger_entries_v2"("order_id");
CREATE INDEX "ledger_entries_v2_entry_type_idx" ON "ledger_entries_v2"("entry_type");
CREATE INDEX "ledger_entries_v2_created_at_idx" ON "ledger_entries_v2"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "advertiser_funding_requests_funding_ref_key" ON "advertiser_funding_requests"("funding_ref");
CREATE INDEX "advertiser_funding_requests_advertiser_id_idx" ON "advertiser_funding_requests"("advertiser_id");
CREATE INDEX "advertiser_funding_requests_status_idx" ON "advertiser_funding_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "gold_exchange_trade_orders_trade_ref_key" ON "gold_exchange_trade_orders"("trade_ref");
CREATE INDEX "gold_exchange_trade_orders_advertiser_id_idx" ON "gold_exchange_trade_orders"("advertiser_id");
CREATE INDEX "gold_exchange_trade_orders_exchanger_id_idx" ON "gold_exchange_trade_orders"("exchanger_id");
CREATE INDEX "gold_exchange_trade_orders_status_idx" ON "gold_exchange_trade_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "booster_withdrawal_requests_withdrawal_ref_key" ON "booster_withdrawal_requests"("withdrawal_ref");
CREATE INDEX "booster_withdrawal_requests_booster_id_idx" ON "booster_withdrawal_requests"("booster_id");
CREATE INDEX "booster_withdrawal_requests_status_idx" ON "booster_withdrawal_requests"("status");
CREATE INDEX "booster_withdrawal_requests_scheduled_cycle_day_idx" ON "booster_withdrawal_requests"("scheduled_cycle_day");

-- CreateIndex
CREATE UNIQUE INDEX "g4x_boost_release_trackers_order_id_key" ON "g4x_boost_release_trackers"("order_id");
CREATE INDEX "g4x_boost_release_trackers_stage_idx" ON "g4x_boost_release_trackers"("stage");
