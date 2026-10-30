-- Migration: 20261031000000_wow_characters_is_active
-- Additive column is_active to wow_characters table

ALTER TABLE "wow_characters" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
