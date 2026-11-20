-- AlterTable
ALTER TABLE "game_services" ADD COLUMN "form_schema_json" TEXT;
ALTER TABLE "game_services" ADD COLUMN "temp_channel_template" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "system_settings" (
    "setting_key" TEXT NOT NULL PRIMARY KEY,
    "setting_value" TEXT NOT NULL,
    "description" TEXT,
    "updated_by" TEXT,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
