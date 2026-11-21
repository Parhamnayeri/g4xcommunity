-- AlterTable
ALTER TABLE "exchange_buy_orders" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_sell_offers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offer_code" TEXT NOT NULL,
    "buy_order_id" TEXT NOT NULL,
    "seller_user_id" TEXT NOT NULL,
    "seller_discord_id" TEXT NOT NULL,
    "currency_id" TEXT NOT NULL,
    "region_id" TEXT,
    "offered_amount_base_units" TEXT NOT NULL,
    "delivery_method_id" TEXT NOT NULL,
    "estimated_delivery_minutes" INTEGER NOT NULL DEFAULT 30,
    "additional_info" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "responded_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchange_sell_offers_buy_order_id_fkey" FOREIGN KEY ("buy_order_id") REFERENCES "exchange_buy_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_sell_offers_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_sell_offers_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "exchange_currencies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_sell_offers_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "exchange_regions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exchange_sell_offers_delivery_method_id_fkey" FOREIGN KEY ("delivery_method_id") REFERENCES "exchange_delivery_methods" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_trades" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trade_code" TEXT NOT NULL,
    "buy_order_id" TEXT NOT NULL,
    "sell_offer_id" TEXT NOT NULL,
    "buyer_user_id" TEXT NOT NULL,
    "buyer_discord_id" TEXT NOT NULL,
    "seller_user_id" TEXT NOT NULL,
    "seller_discord_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "currency_id" TEXT NOT NULL,
    "region_id" TEXT,
    "delivery_method_id" TEXT NOT NULL,
    "quantity_base_units" TEXT NOT NULL,
    "unit_label_snapshot" TEXT NOT NULL DEFAULT 'Unit',
    "unit_multiplier_snapshot" TEXT NOT NULL DEFAULT '1',
    "price_per_unit_cents_snapshot" INTEGER NOT NULL,
    "gross_value_cents" INTEGER NOT NULL,
    "fee_rule_id_snapshot" TEXT,
    "fee_rule_version_snapshot" INTEGER NOT NULL DEFAULT 1,
    "fee_rule_scope_snapshot" TEXT NOT NULL DEFAULT 'GLOBAL',
    "buyer_commission_bps_snapshot" INTEGER NOT NULL DEFAULT 100,
    "seller_commission_bps_snapshot" INTEGER NOT NULL DEFAULT 200,
    "payment_processing_mode_snapshot" TEXT NOT NULL DEFAULT 'ACTUAL_COST',
    "network_fee_mode_snapshot" TEXT NOT NULL DEFAULT 'ACTUAL_COST',
    "buyer_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "seller_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "net_seller_cents" INTEGER NOT NULL,
    "buyer_total_payable_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "capacity_reserved" BOOLEAN NOT NULL DEFAULT true,
    "estimated_delivery_minutes" INTEGER,
    "seller_notes" TEXT,
    "buyer_instructions_snapshot" TEXT,
    "cancelled_by_discord_id" TEXT,
    "cancel_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchange_trades_buy_order_id_fkey" FOREIGN KEY ("buy_order_id") REFERENCES "exchange_buy_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_trades_sell_offer_id_fkey" FOREIGN KEY ("sell_offer_id") REFERENCES "exchange_sell_offers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_trades_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_trades_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_trades_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "exchange_games" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_trades_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "exchange_currencies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_trades_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "exchange_regions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exchange_trades_delivery_method_id_fkey" FOREIGN KEY ("delivery_method_id") REFERENCES "exchange_delivery_methods" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_trade_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trade_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_discord_id" TEXT,
    "actor_role" TEXT,
    "from_status" TEXT,
    "to_status" TEXT,
    "note" TEXT,
    "metadata_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exchange_trade_events_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "exchange_trades" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_trade_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_sell_offers_offer_code_key" ON "exchange_sell_offers"("offer_code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_sell_offers_buy_order_id_status_idx" ON "exchange_sell_offers"("buy_order_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_sell_offers_seller_discord_id_status_idx" ON "exchange_sell_offers"("seller_discord_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_sell_offers_created_at_idx" ON "exchange_sell_offers"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_trades_trade_code_key" ON "exchange_trades"("trade_code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_trades_sell_offer_id_key" ON "exchange_trades"("sell_offer_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_trades_buyer_discord_id_status_idx" ON "exchange_trades"("buyer_discord_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_trades_seller_discord_id_status_idx" ON "exchange_trades"("seller_discord_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_trades_buy_order_id_status_idx" ON "exchange_trades"("buy_order_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_trades_created_at_idx" ON "exchange_trades"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_trade_events_trade_id_created_at_idx" ON "exchange_trade_events"("trade_id", "created_at");
