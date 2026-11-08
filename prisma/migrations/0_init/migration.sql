-- CreateTable
CREATE TABLE "users" (
    "discord_id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "display_name" TEXT,
    "phone_number" TEXT,
    "telegram_username" TEXT,
    "whatsapp_number" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "roles" (
    "role_key" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" TEXT NOT NULL,
    "role_key" TEXT NOT NULL,
    "granted_by" TEXT,
    "granted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("user_id", "role_key"),
    CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_roles_role_key_fkey" FOREIGN KEY ("role_key") REFERENCES "roles" ("role_key") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_roles_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "games" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "display_name" TEXT NOT NULL,
    "service_category" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "game_services" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "game_slug" TEXT NOT NULL,
    "service_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "profile_mode" TEXT NOT NULL,
    "requires_pilot_approval" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "game_services_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_game_approvals" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "game_slug" TEXT NOT NULL,
    "service_id" INTEGER,
    "approval_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by" TEXT,
    "review_note" TEXT,
    "reviewed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_game_approvals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_game_approvals_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_game_approvals_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "game_services" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "user_game_approvals_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "wow_characters" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "game_slug" TEXT NOT NULL DEFAULT 'wow',
    "character_name" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'eu',
    "character_class" TEXT,
    "active_spec" TEXT,
    "item_level" INTEGER,
    "mythic_score" REAL,
    "tank_score" REAL,
    "healer_score" REAL,
    "dps_score" REAL,
    "raid_progression" TEXT,
    "raiderio_url" TEXT,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "sync_status" TEXT NOT NULL DEFAULT 'pending',
    "last_synced_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "wow_characters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "wow_characters_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pilot_verifications" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "game_slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "identity_document_ref" TEXT,
    "passport_document_ref" TEXT,
    "selfie_document_ref" TEXT,
    "reviewed_by" TEXT,
    "review_note" TEXT,
    "submitted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" DATETIME,
    "expires_at" DATETIME,
    CONSTRAINT "pilot_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pilot_verifications_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pilot_verifications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "wallets" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "balance_usd" INTEGER NOT NULL DEFAULT 0,
    "escrow_usd" INTEGER NOT NULL DEFAULT 0,
    "balance_gold" INTEGER NOT NULL DEFAULT 0,
    "escrow_gold" INTEGER NOT NULL DEFAULT 0,
    "balance_usdt" INTEGER NOT NULL DEFAULT 0,
    "escrow_usdt" INTEGER NOT NULL DEFAULT 0,
    "balance_irt" INTEGER NOT NULL DEFAULT 0,
    "escrow_irt" INTEGER NOT NULL DEFAULT 0,
    "custom_commission_rate" REAL DEFAULT 0.15,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "transaction_ref" TEXT NOT NULL,
    "user_id" TEXT,
    "order_id" INTEGER,
    "currency" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "entry_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "release_at" DATETIME,
    "created_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ledger_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_ref" TEXT NOT NULL,
    "game_slug" TEXT NOT NULL,
    "service_id" INTEGER NOT NULL,
    "customer_id" TEXT,
    "advertiser_id" TEXT,
    "order_type" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "gross_amount_minor" INTEGER NOT NULL,
    "platform_fee_minor" INTEGER NOT NULL DEFAULT 0,
    "advertiser_fee_minor" INTEGER NOT NULL DEFAULT 0,
    "booster_pool_minor" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open_presign',
    "discord_channel_id" TEXT,
    "discord_message_id" TEXT,
    "execution_channel_id" TEXT,
    "presign_deadline" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orders_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "game_services" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "orders_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "premade_squads" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "game_slug" TEXT NOT NULL,
    "team_name" TEXT NOT NULL,
    "leader_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "premade_squads_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "premade_squads_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "users" ("discord_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "squad_members" (
    "squad_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("squad_id", "user_id"),
    CONSTRAINT "squad_members_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "premade_squads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "squad_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_presigns" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "character_id" INTEGER,
    "squad_id" INTEGER,
    "registered_role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "registered_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_presigns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_presigns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_presigns_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "wow_characters" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "order_presigns_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "premade_squads" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_assignments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "assigned_by" TEXT NOT NULL,
    "assigned_role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "assigned_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_assignments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users" ("discord_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "exchanger_offers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "exchanger_id" TEXT NOT NULL,
    "min_gold_amount" INTEGER NOT NULL,
    "max_gold_amount" INTEGER,
    "price_per_million_irt" INTEGER NOT NULL,
    "settlement_currency" TEXT NOT NULL,
    "settlement_method" TEXT NOT NULL,
    "settlement_time_hours" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchanger_offers_exchanger_id_fkey" FOREIGN KEY ("exchanger_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "gold_exchange_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "offer_id" INTEGER NOT NULL,
    "exchanger_id" TEXT NOT NULL,
    "seller_id" TEXT,
    "gold_amount" INTEGER NOT NULL,
    "agreed_price_per_million_irt" INTEGER NOT NULL,
    "total_amount_minor" INTEGER NOT NULL,
    "settlement_currency" TEXT NOT NULL,
    "tracking_code" TEXT,
    "proof_document_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verified_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" DATETIME,
    CONSTRAINT "gold_exchange_orders_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "exchanger_offers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "gold_exchange_orders_exchanger_id_fkey" FOREIGN KEY ("exchanger_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "gold_exchange_orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "gold_exchange_orders_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "game_services_game_slug_service_key_key" ON "game_services"("game_slug", "service_key");

-- CreateIndex
CREATE UNIQUE INDEX "user_game_approvals_user_id_game_slug_service_id_approval_type_key" ON "user_game_approvals"("user_id", "game_slug", "service_id", "approval_type");

-- CreateIndex
CREATE INDEX "wow_characters_user_id_idx" ON "wow_characters"("user_id");

-- CreateIndex
CREATE INDEX "wow_characters_game_slug_mythic_score_idx" ON "wow_characters"("game_slug", "mythic_score");

-- CreateIndex
CREATE UNIQUE INDEX "wow_characters_user_id_game_slug_region_realm_character_name_key" ON "wow_characters"("user_id", "game_slug", "region", "realm", "character_name");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_transaction_ref_key" ON "ledger_transactions"("transaction_ref");

-- CreateIndex
CREATE INDEX "ledger_transactions_user_id_idx" ON "ledger_transactions"("user_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_order_id_idx" ON "ledger_transactions"("order_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_status_release_at_idx" ON "ledger_transactions"("status", "release_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_ref_key" ON "orders"("order_ref");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_game_slug_status_idx" ON "orders"("game_slug", "status");

-- CreateIndex
CREATE INDEX "orders_advertiser_id_idx" ON "orders"("advertiser_id");

-- CreateIndex
CREATE UNIQUE INDEX "premade_squads_game_slug_team_name_key" ON "premade_squads"("game_slug", "team_name");

-- CreateIndex
CREATE INDEX "order_presigns_order_id_status_idx" ON "order_presigns"("order_id", "status");

-- CreateIndex
CREATE INDEX "order_presigns_user_id_idx" ON "order_presigns"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_presigns_order_id_user_id_registered_role_key" ON "order_presigns"("order_id", "user_id", "registered_role");

-- CreateIndex
CREATE INDEX "order_assignments_order_id_idx" ON "order_assignments"("order_id");

-- CreateIndex
CREATE INDEX "order_assignments_user_id_idx" ON "order_assignments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_assignments_order_id_user_id_assigned_role_key" ON "order_assignments"("order_id", "user_id", "assigned_role");

-- CreateIndex
CREATE INDEX "gold_exchange_orders_exchanger_id_idx" ON "gold_exchange_orders"("exchanger_id");

-- CreateIndex
CREATE INDEX "gold_exchange_orders_status_idx" ON "gold_exchange_orders"("status");

