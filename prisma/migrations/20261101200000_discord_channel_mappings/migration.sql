-- CreateTable
CREATE TABLE "discord_channel_mappings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guild_id" TEXT NOT NULL,
    "channel_key" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "channel_name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "channel_type" TEXT NOT NULL DEFAULT 'GUILD_TEXT',
    "game_slug" TEXT,
    "service_id" INTEGER,
    "service_mode" TEXT,
    "discord_channel_id" TEXT,
    "parent_category_id" TEXT,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sync_status" TEXT NOT NULL DEFAULT 'PENDING',
    "last_sync_result" TEXT,
    "last_synced_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "discord_channel_mappings_game_slug_fkey" FOREIGN KEY ("game_slug") REFERENCES "games" ("slug") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "discord_channel_mappings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "game_services" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "discord_channel_mappings_channel_key_key" ON "discord_channel_mappings"("channel_key");

-- CreateIndex
CREATE INDEX "discord_channel_mappings_guild_id_is_active_idx" ON "discord_channel_mappings"("guild_id", "is_active");

-- CreateIndex
CREATE INDEX "discord_channel_mappings_game_slug_service_mode_idx" ON "discord_channel_mappings"("game_slug", "service_mode");
