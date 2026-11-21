-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_kyc_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
    "documents_meta_json" TEXT,
    "notes" TEXT,
    "admin_review_notes" TEXT,
    "reviewed_by_discord_id" TEXT,
    "submitted_at" DATETIME,
    "reviewed_at" DATETIME,
    "approved_at" DATETIME,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchange_kyc_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_user_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "can_create_buy_order" BOOLEAN NOT NULL DEFAULT false,
    "can_submit_sell_offer" BOOLEAN NOT NULL DEFAULT true,
    "is_suspended" BOOLEAN NOT NULL DEFAULT false,
    "suspension_reason" TEXT,
    "suspended_at" DATETIME,
    "suspended_by_discord_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchange_user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_buy_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_code" TEXT NOT NULL,
    "buyer_user_id" TEXT NOT NULL,
    "buyer_discord_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "currency_id" TEXT NOT NULL,
    "region_id" TEXT,
    "price_per_unit_cents" INTEGER NOT NULL,
    "unit_label_snapshot" TEXT NOT NULL DEFAULT 'Unit',
    "unit_multiplier_snapshot" TEXT NOT NULL DEFAULT '1',
    "min_trade_base_units" TEXT NOT NULL DEFAULT '1',
    "max_trade_base_units" TEXT NOT NULL,
    "total_capacity_base_units" TEXT NOT NULL,
    "reserved_capacity_base_units" TEXT NOT NULL DEFAULT '0',
    "remaining_capacity_base_units" TEXT NOT NULL,
    "filled_capacity_base_units" TEXT NOT NULL DEFAULT '0',
    "accepted_delivery_method_ids_json" TEXT NOT NULL DEFAULT '[]',
    "instructions" TEXT,
    "expires_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchange_buy_orders_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_buy_orders_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "exchange_games" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_buy_orders_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "exchange_currencies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_buy_orders_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "exchange_regions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_kyc_requests_user_id_key" ON "exchange_kyc_requests"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_kyc_requests_status_idx" ON "exchange_kyc_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_user_permissions_user_id_key" ON "exchange_user_permissions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_buy_orders_order_code_key" ON "exchange_buy_orders"("order_code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_buy_orders_buyer_user_id_idx" ON "exchange_buy_orders"("buyer_user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_buy_orders_game_id_idx" ON "exchange_buy_orders"("game_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_buy_orders_currency_id_idx" ON "exchange_buy_orders"("currency_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_buy_orders_region_id_idx" ON "exchange_buy_orders"("region_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_buy_orders_status_idx" ON "exchange_buy_orders"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_buy_orders_price_per_unit_cents_idx" ON "exchange_buy_orders"("price_per_unit_cents");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_buy_orders_created_at_idx" ON "exchange_buy_orders"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_buy_orders_expires_at_idx" ON "exchange_buy_orders"("expires_at");
