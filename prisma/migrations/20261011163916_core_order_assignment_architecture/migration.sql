-- CreateTable
CREATE TABLE "order_required_roles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "role_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "filled_quantity" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "order_required_roles_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_key_requirements" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "dungeon_name" TEXT,
    "dungeon_slug" TEXT,
    "key_level" INTEGER,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    CONSTRAINT "order_key_requirements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "run_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" DATETIME,
    "finished_at" DATETIME,
    "completed_at" DATETIME,
    "completed_by" TEXT,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_runs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_runs_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_order_assignments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "assigned_by" TEXT NOT NULL,
    "assigned_role" TEXT NOT NULL,
    "claim_id" INTEGER,
    "squad_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "assigned_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replaced_by_id" INTEGER,
    "replaced_at" DATETIME,
    "replacement_reason" TEXT,
    CONSTRAINT "order_assignments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users" ("discord_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_assignments_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "order_presigns" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "order_assignments_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "premade_squads" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "order_assignments_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "order_assignments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_order_assignments" ("assigned_at", "assigned_by", "assigned_role", "id", "order_id", "status", "user_id") SELECT "assigned_at", "assigned_by", "assigned_role", "id", "order_id", "status", "user_id" FROM "order_assignments";
DROP TABLE "order_assignments";
ALTER TABLE "new_order_assignments" RENAME TO "order_assignments";
CREATE INDEX "order_assignments_order_id_status_idx" ON "order_assignments"("order_id", "status");
CREATE INDEX "order_assignments_order_id_user_id_idx" ON "order_assignments"("order_id", "user_id");
CREATE INDEX "order_assignments_user_id_idx" ON "order_assignments"("user_id");
CREATE INDEX "order_assignments_claim_id_idx" ON "order_assignments"("claim_id");
CREATE INDEX "order_assignments_squad_id_idx" ON "order_assignments"("squad_id");
CREATE UNIQUE INDEX "order_assignments_active_unique" ON "order_assignments"("order_id", "user_id") WHERE "status" IN ('assigned', 'accepted');
CREATE TABLE "new_order_presigns" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "character_id" INTEGER,
    "squad_id" INTEGER,
    "claim_type" TEXT NOT NULL DEFAULT 'individual',
    "registered_role" TEXT NOT NULL,
    "has_key" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_order_presigns" ("character_id", "id", "order_id", "registered_at", "registered_role", "squad_id", "status", "user_id") SELECT "character_id", "id", "order_id", "registered_at", "registered_role", "squad_id", "status", "user_id" FROM "order_presigns";
DROP TABLE "order_presigns";
ALTER TABLE "new_order_presigns" RENAME TO "order_presigns";
CREATE INDEX "order_presigns_order_id_status_idx" ON "order_presigns"("order_id", "status");
CREATE INDEX "order_presigns_order_id_user_id_idx" ON "order_presigns"("order_id", "user_id");
CREATE INDEX "order_presigns_user_id_idx" ON "order_presigns"("user_id");
CREATE INDEX "order_presigns_squad_id_idx" ON "order_presigns"("squad_id");
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
    "status" TEXT NOT NULL DEFAULT 'open_presign',
    "discord_channel_id" TEXT,
    "discord_message_id" TEXT,
    "execution_channel_id" TEXT,
    "presign_deadline" DATETIME,
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
INSERT INTO "new_orders" ("advertiser_fee_minor", "advertiser_id", "booster_pool_minor", "completed_at", "created_at", "currency", "customer_id", "discord_channel_id", "discord_message_id", "execution_channel_id", "game_slug", "gross_amount_minor", "id", "order_ref", "order_type", "platform_fee_minor", "presign_deadline", "service_id", "status") SELECT "advertiser_fee_minor", "advertiser_id", "booster_pool_minor", "completed_at", "created_at", "currency", "customer_id", "discord_channel_id", "discord_message_id", "execution_channel_id", "game_slug", "gross_amount_minor", "id", "order_ref", "order_type", "platform_fee_minor", "presign_deadline", "service_id", "status" FROM "orders";
DROP TABLE "orders";
ALTER TABLE "new_orders" RENAME TO "orders";
CREATE UNIQUE INDEX "orders_order_ref_key" ON "orders"("order_ref");
CREATE INDEX "orders_status_idx" ON "orders"("status");
CREATE INDEX "orders_game_slug_status_idx" ON "orders"("game_slug", "status");
CREATE INDEX "orders_advertiser_id_idx" ON "orders"("advertiser_id");
CREATE INDEX "orders_creator_id_idx" ON "orders"("creator_id");
CREATE INDEX "orders_payment_status_idx" ON "orders"("payment_status");
CREATE TABLE "new_premade_squads" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "game_slug" TEXT NOT NULL,
    "team_name" TEXT NOT NULL,
    "leader_id" TEXT NOT NULL,
    "squad_type" TEXT NOT NULL DEFAULT 'full',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "premade_squads_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "premade_squads_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "users" ("discord_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_premade_squads" ("created_at", "game_slug", "id", "leader_id", "status", "team_name") SELECT "created_at", "game_slug", "id", "leader_id", "status", "team_name" FROM "premade_squads";
DROP TABLE "premade_squads";
ALTER TABLE "new_premade_squads" RENAME TO "premade_squads";
CREATE INDEX "premade_squads_game_slug_status_idx" ON "premade_squads"("game_slug", "status");
CREATE UNIQUE INDEX "premade_squads_game_slug_team_name_key" ON "premade_squads"("game_slug", "team_name");
CREATE TABLE "new_squad_members" (
    "squad_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "member_role" TEXT,
    "character_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("squad_id", "user_id"),
    CONSTRAINT "squad_members_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "premade_squads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "squad_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "squad_members_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "wow_characters" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_squad_members" ("joined_at", "squad_id", "status", "user_id") SELECT "joined_at", "squad_id", "status", "user_id" FROM "squad_members";
DROP TABLE "squad_members";
ALTER TABLE "new_squad_members" RENAME TO "squad_members";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "order_required_roles_order_id_idx" ON "order_required_roles"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_required_roles_order_id_role_name_key" ON "order_required_roles"("order_id", "role_name");

-- CreateIndex
CREATE INDEX "order_key_requirements_order_id_idx" ON "order_key_requirements"("order_id");

-- CreateIndex
CREATE INDEX "order_runs_order_id_status_idx" ON "order_runs"("order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "order_runs_order_id_run_number_key" ON "order_runs"("order_id", "run_number");
