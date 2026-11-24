-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_discord_rooms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trade_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "channel_name" TEXT NOT NULL,
    "channel_url" TEXT NOT NULL,
    "category_id" TEXT,
    "archive_category_id" TEXT,
    "welcome_message_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "buyer_discord_id" TEXT NOT NULL,
    "seller_discord_id" TEXT NOT NULL,
    "archived_by_discord_id" TEXT,
    "archived_at" DATETIME,
    "archive_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchange_discord_rooms_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "exchange_trades" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_discord_rooms_trade_id_key" ON "exchange_discord_rooms"("trade_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_discord_rooms_channel_id_key" ON "exchange_discord_rooms"("channel_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_discord_rooms_status_idx" ON "exchange_discord_rooms"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_discord_rooms_buyer_discord_id_idx" ON "exchange_discord_rooms"("buyer_discord_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_discord_rooms_seller_discord_id_idx" ON "exchange_discord_rooms"("seller_discord_id");
