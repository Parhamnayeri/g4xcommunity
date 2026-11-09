-- Migration: 20261109150000_order_channel_active_execution_uniqueness
-- 1. Safely resolve any existing duplicate active execution channels before creating index
UPDATE "order_channels"
SET "status" = 'archived', "archived_at" = CURRENT_TIMESTAMP
WHERE "id" IN (
    SELECT "id" FROM (
        SELECT "id", ROW_NUMBER() OVER (PARTITION BY "order_id" ORDER BY "id" DESC) as rn
        FROM "order_channels"
        WHERE "channel_type" = 'execution' AND "status" = 'active'
    ) WHERE rn > 1
);

-- 2. Partial unique index on active execution channels per order
CREATE UNIQUE INDEX IF NOT EXISTS "idx_order_channels_active_execution"
ON "order_channels"("order_id")
WHERE "channel_type" = 'execution' AND "status" = 'active';
