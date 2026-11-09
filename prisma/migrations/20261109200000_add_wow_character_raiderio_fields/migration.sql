-- AlterTable: add optional Raider.IO fields to wow_characters
ALTER TABLE "wow_characters" ADD COLUMN "thumbnail_url" TEXT;
ALTER TABLE "wow_characters" ADD COLUMN "active_role" TEXT;
ALTER TABLE "wow_characters" ADD COLUMN "faction" TEXT;
ALTER TABLE "wow_characters" ADD COLUMN "sync_error" TEXT;
ALTER TABLE "wow_characters" ADD COLUMN "recent_runs_json" TEXT;
