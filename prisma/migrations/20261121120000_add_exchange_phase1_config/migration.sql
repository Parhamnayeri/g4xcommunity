-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_games" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon_url" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_regions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "game_id" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchange_regions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "exchange_games" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_delivery_methods" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_currencies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "game_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon_url" TEXT,
    "unit_label" TEXT NOT NULL DEFAULT 'Unit',
    "unit_multiplier" TEXT NOT NULL DEFAULT '1',
    "decimal_precision" INTEGER NOT NULL DEFAULT 0,
    "min_trade_base_units" TEXT NOT NULL DEFAULT '1',
    "max_trade_base_units" TEXT NOT NULL DEFAULT '1000000000',
    "supported_region_ids_json" TEXT NOT NULL DEFAULT '[]',
    "delivery_method_ids_json" TEXT NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchange_currencies_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "exchange_games" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_fee_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "game_id" TEXT,
    "currency_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "buyer_commission_bps" INTEGER NOT NULL DEFAULT 100,
    "seller_commission_bps" INTEGER NOT NULL DEFAULT 200,
    "payment_processing_mode" TEXT NOT NULL DEFAULT 'ACTUAL_COST',
    "network_fee_mode" TEXT NOT NULL DEFAULT 'ACTUAL_COST',
    "min_commission_cents" INTEGER,
    "max_commission_cents" INTEGER,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_discord_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchange_fee_rules_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "exchange_games" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_fee_rules_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "exchange_currencies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_games_slug_key" ON "exchange_games"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_regions_game_id_idx" ON "exchange_regions"("game_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_delivery_methods_code_key" ON "exchange_delivery_methods"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_currencies_game_id_idx" ON "exchange_currencies"("game_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_currencies_game_id_slug_key" ON "exchange_currencies"("game_id", "slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_fee_rules_scope_idx" ON "exchange_fee_rules"("scope");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_fee_rules_game_id_idx" ON "exchange_fee_rules"("game_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_fee_rules_currency_id_idx" ON "exchange_fee_rules"("currency_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_fee_rules_effective_from_idx" ON "exchange_fee_rules"("effective_from");
