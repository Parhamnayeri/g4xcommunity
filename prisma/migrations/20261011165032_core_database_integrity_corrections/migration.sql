/*
  Warnings:

  - You are about to drop the column `filled_quantity` on the `order_required_roles` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "run_assignments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "run_id" INTEGER NOT NULL,
    "assignment_id" INTEGER NOT NULL,
    "role_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" DATETIME,
    CONSTRAINT "run_assignments_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "order_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "run_assignments_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "order_assignments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "booster_reservations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "order_id" INTEGER NOT NULL,
    "run_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reserved_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" DATETIME,
    "release_reason" TEXT,
    "expires_at" DATETIME,
    "created_by_id" TEXT,
    CONSTRAINT "booster_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "booster_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "booster_reservations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "order_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "booster_reservations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_exchanger_offers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "exchanger_id" TEXT NOT NULL,
    "game_slug" TEXT NOT NULL DEFAULT 'wow_midnight',
    "currency_type" TEXT NOT NULL DEFAULT 'gold',
    "min_amount" INTEGER NOT NULL DEFAULT 0,
    "max_amount" INTEGER,
    "unit_price_minor" INTEGER NOT NULL DEFAULT 0,
    "price_basis" INTEGER NOT NULL DEFAULT 1000000,
    "settlement_currency" TEXT NOT NULL,
    "settlement_method" TEXT NOT NULL,
    "settlement_time_min_hours" INTEGER NOT NULL DEFAULT 1,
    "settlement_time_max_hours" INTEGER NOT NULL DEFAULT 24,
    "min_gold_amount" INTEGER,
    "max_gold_amount" INTEGER,
    "price_per_million_irt" INTEGER,
    "settlement_time_hours" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchanger_offers_exchanger_id_fkey" FOREIGN KEY ("exchanger_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchanger_offers_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_exchanger_offers" ("exchanger_id", "id", "is_active", "max_gold_amount", "min_gold_amount", "price_per_million_irt", "settlement_currency", "settlement_method", "settlement_time_hours", "updated_at") SELECT "exchanger_id", "id", "is_active", "max_gold_amount", "min_gold_amount", "price_per_million_irt", "settlement_currency", "settlement_method", "settlement_time_hours", "updated_at" FROM "exchanger_offers";
DROP TABLE "exchanger_offers";
ALTER TABLE "new_exchanger_offers" RENAME TO "exchanger_offers";
CREATE INDEX "exchanger_offers_game_slug_currency_type_is_active_idx" ON "exchanger_offers"("game_slug", "currency_type", "is_active");
CREATE INDEX "exchanger_offers_exchanger_id_idx" ON "exchanger_offers"("exchanger_id");
CREATE TABLE "new_gold_exchange_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "offer_id" INTEGER NOT NULL,
    "exchanger_id" TEXT NOT NULL,
    "seller_id" TEXT,
    "game_slug" TEXT NOT NULL DEFAULT 'wow_midnight',
    "currency_type" TEXT NOT NULL DEFAULT 'gold',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "unit_price_minor" INTEGER NOT NULL DEFAULT 0,
    "price_basis" INTEGER NOT NULL DEFAULT 1000000,
    "total_amount_minor" INTEGER NOT NULL,
    "settlement_currency" TEXT NOT NULL,
    "settlement_method" TEXT,
    "gold_amount" INTEGER,
    "agreed_price_per_million_irt" INTEGER,
    "tracking_code" TEXT,
    "proof_document_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verified_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" DATETIME,
    CONSTRAINT "gold_exchange_orders_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "exchanger_offers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "gold_exchange_orders_exchanger_id_fkey" FOREIGN KEY ("exchanger_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "gold_exchange_orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "gold_exchange_orders_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "gold_exchange_orders_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_gold_exchange_orders" ("agreed_price_per_million_irt", "created_at", "exchanger_id", "gold_amount", "id", "offer_id", "proof_document_ref", "seller_id", "settled_at", "settlement_currency", "status", "total_amount_minor", "tracking_code", "verified_by") SELECT "agreed_price_per_million_irt", "created_at", "exchanger_id", "gold_amount", "id", "offer_id", "proof_document_ref", "seller_id", "settled_at", "settlement_currency", "status", "total_amount_minor", "tracking_code", "verified_by" FROM "gold_exchange_orders";
DROP TABLE "gold_exchange_orders";
ALTER TABLE "new_gold_exchange_orders" RENAME TO "gold_exchange_orders";
CREATE INDEX "gold_exchange_orders_exchanger_id_idx" ON "gold_exchange_orders"("exchanger_id");
CREATE INDEX "gold_exchange_orders_game_slug_currency_type_idx" ON "gold_exchange_orders"("game_slug", "currency_type");
CREATE INDEX "gold_exchange_orders_status_idx" ON "gold_exchange_orders"("status");
CREATE TABLE "new_order_presigns" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "character_id" INTEGER,
    "squad_id" INTEGER,
    "claim_type" TEXT NOT NULL DEFAULT 'individual',
    "registered_role" TEXT NOT NULL,
    "has_key" TEXT NOT NULL DEFAULT 'unknown',
    "key_dungeon" TEXT,
    "key_level" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "registered_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_presigns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_presigns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_presigns_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "wow_characters" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "order_presigns_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "premade_squads" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_order_presigns" ("character_id", "claim_type", "has_key", "id", "key_dungeon", "key_level", "order_id", "registered_at", "registered_role", "squad_id", "status", "updated_at", "user_id") SELECT "character_id", "claim_type", "has_key", "id", "key_dungeon", "key_level", "order_id", "registered_at", "registered_role", "squad_id", "status", "updated_at", "user_id" FROM "order_presigns";
DROP TABLE "order_presigns";
ALTER TABLE "new_order_presigns" RENAME TO "order_presigns";
CREATE INDEX "order_presigns_order_id_status_idx" ON "order_presigns"("order_id", "status");
CREATE INDEX "order_presigns_order_id_user_id_idx" ON "order_presigns"("order_id", "user_id");
CREATE INDEX "order_presigns_user_id_idx" ON "order_presigns"("user_id");
CREATE INDEX "order_presigns_squad_id_idx" ON "order_presigns"("squad_id");
CREATE TABLE "new_order_required_roles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "role_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "order_required_roles_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_order_required_roles" ("id", "order_id", "quantity", "role_name") SELECT "id", "order_id", "quantity", "role_name" FROM "order_required_roles";
DROP TABLE "order_required_roles";
ALTER TABLE "new_order_required_roles" RENAME TO "order_required_roles";
CREATE INDEX "order_required_roles_order_id_idx" ON "order_required_roles"("order_id");
CREATE UNIQUE INDEX "order_required_roles_order_id_role_name_key" ON "order_required_roles"("order_id", "role_name");
CREATE TABLE "new_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_ref" TEXT NOT NULL,
    "game_slug" TEXT NOT NULL,
    "service_id" INTEGER NOT NULL,
    "customer_id" TEXT,
    "advertiser_id" TEXT,
    "creator_id" TEXT,
    "creator_type" TEXT NOT NULL DEFAULT 'g4x',
    "order_name" TEXT,
    "order_type" TEXT NOT NULL,
    "order_mode" TEXT NOT NULL DEFAULT 'non_pilot',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'internal',
    "source_website" TEXT,
    "external_order_id" TEXT,
    "currency" TEXT NOT NULL,
    "gross_amount_minor" INTEGER NOT NULL,
    "platform_fee_minor" INTEGER NOT NULL DEFAULT 0,
    "advertiser_fee_minor" INTEGER NOT NULL DEFAULT 0,
    "booster_pool_minor" INTEGER NOT NULL DEFAULT 0,
    "payment_status" TEXT NOT NULL DEFAULT 'pending',
    "payment_verified_by" TEXT,
    "payment_verified_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "discord_channel_id" TEXT,
    "discord_message_id" TEXT,
    "execution_channel_id" TEXT,
    "presign_deadline" DATETIME,
    "published_at" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orders_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "game_services" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "orders_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "orders_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "orders_payment_verified_by_fkey" FOREIGN KEY ("payment_verified_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_orders" ("advertiser_fee_minor", "advertiser_id", "booster_pool_minor", "completed_at", "created_at", "creator_id", "creator_type", "currency", "customer_id", "discord_channel_id", "discord_message_id", "execution_channel_id", "external_order_id", "game_slug", "gross_amount_minor", "id", "notes", "order_mode", "order_name", "order_ref", "order_type", "payment_status", "payment_verified_at", "payment_verified_by", "platform_fee_minor", "presign_deadline", "quantity", "service_id", "source_type", "source_website", "status", "updated_at") SELECT "advertiser_fee_minor", "advertiser_id", "booster_pool_minor", "completed_at", "created_at", "creator_id", "creator_type", "currency", "customer_id", "discord_channel_id", "discord_message_id", "execution_channel_id", "external_order_id", "game_slug", "gross_amount_minor", "id", "notes", "order_mode", "order_name", "order_ref", "order_type", "payment_status", "payment_verified_at", "payment_verified_by", "platform_fee_minor", "presign_deadline", "quantity", "service_id", "source_type", "source_website", "status", "updated_at" FROM "orders";
DROP TABLE "orders";
ALTER TABLE "new_orders" RENAME TO "orders";
CREATE UNIQUE INDEX "orders_order_ref_key" ON "orders"("order_ref");
CREATE INDEX "orders_status_idx" ON "orders"("status");
CREATE INDEX "orders_game_slug_status_idx" ON "orders"("game_slug", "status");
CREATE INDEX "orders_advertiser_id_idx" ON "orders"("advertiser_id");
CREATE INDEX "orders_creator_id_idx" ON "orders"("creator_id");
CREATE INDEX "orders_payment_status_idx" ON "orders"("payment_status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "run_assignments_run_id_status_idx" ON "run_assignments"("run_id", "status");

-- CreateIndex
CREATE INDEX "run_assignments_assignment_id_idx" ON "run_assignments"("assignment_id");

-- CreateIndex
CREATE INDEX "booster_reservations_user_id_status_idx" ON "booster_reservations"("user_id", "status");

-- CreateIndex
CREATE INDEX "booster_reservations_order_id_idx" ON "booster_reservations"("order_id");

-- CreateIndex
CREATE INDEX "booster_reservations_run_id_idx" ON "booster_reservations"("run_id");

-- CreateIndex: Platform-wide Active Booster Reservation (Double-Booking Prevention)
CREATE UNIQUE INDEX "booster_reservations_active_user_unique" ON "booster_reservations"("user_id") WHERE "status" = 'active';

-- CreateIndex: Run Active Assignment Prevention
CREATE UNIQUE INDEX "run_assignments_active_unique" ON "run_assignments"("run_id", "assignment_id") WHERE "status" = 'assigned';
