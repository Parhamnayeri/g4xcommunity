-- Migration: 20261101180000_game_service_description_and_sort_order
-- Add description and sort_order columns to games and game_services

ALTER TABLE "games" ADD COLUMN "description" TEXT;
ALTER TABLE "games" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "game_services" ADD COLUMN "description" TEXT;
ALTER TABLE "game_services" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
