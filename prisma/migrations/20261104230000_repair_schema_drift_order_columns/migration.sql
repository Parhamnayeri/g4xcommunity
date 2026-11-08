-- Migration: 20261104230000_repair_schema_drift_order_columns
-- Purpose: Forward-only, data-preserving repair of schema drift between committed migrations and prisma/schema.prisma.
-- Restores missing columns and foreign key index references without dropping, recreating, or truncating any tables.

-- 1. Table: orders
-- Add platform_account_id with foreign key reference to platform_accounts(id)
ALTER TABLE "orders" ADD COLUMN "platform_account_id" INTEGER REFERENCES "platform_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add review channel and message references
ALTER TABLE "orders" ADD COLUMN "review_channel_id" TEXT;
ALTER TABLE "orders" ADD COLUMN "review_message_id" TEXT;

-- Index for orders.platform_account_id
CREATE INDEX IF NOT EXISTS "orders_platform_account_id_idx" ON "orders"("platform_account_id");

-- 2. Table: order_presigns
-- Add key_verified boolean flag with default false
ALTER TABLE "order_presigns" ADD COLUMN "key_verified" BOOLEAN NOT NULL DEFAULT false;

-- 3. Table: order_financial_snapshots
-- Add platform_account_id with foreign key reference to platform_accounts(id)
ALTER TABLE "order_financial_snapshots" ADD COLUMN "platform_account_id" INTEGER REFERENCES "platform_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for order_financial_snapshots.platform_account_id
CREATE INDEX IF NOT EXISTS "order_financial_snapshots_platform_account_id_idx" ON "order_financial_snapshots"("platform_account_id");
