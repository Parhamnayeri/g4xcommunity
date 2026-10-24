-- Migration: 20261024230000_advertiser_rank_system
-- Add minimal additive Advertiser Rank System fields and indexes

-- 1. Add advertiser_rank to users
ALTER TABLE "users" ADD COLUMN "advertiser_rank" TEXT;
CREATE INDEX "users_advertiser_rank_idx" ON "users"("advertiser_rank");

-- 2. Add advertiser_rank and rank_commission_bps to orders
ALTER TABLE "orders" ADD COLUMN "advertiser_rank" TEXT;
ALTER TABLE "orders" ADD COLUMN "rank_commission_bps" INTEGER;
CREATE INDEX "orders_advertiser_rank_idx" ON "orders"("advertiser_rank");

-- 3. Add rank snapshot fields to order_financial_snapshots
ALTER TABLE "order_financial_snapshots" ADD COLUMN "advertiser_id" TEXT;
ALTER TABLE "order_financial_snapshots" ADD COLUMN "advertiser_rank" TEXT;
ALTER TABLE "order_financial_snapshots" ADD COLUMN "rank_fee_basis_points" INTEGER;
ALTER TABLE "order_financial_snapshots" ADD COLUMN "remaining_amount_minor" INTEGER;
ALTER TABLE "order_financial_snapshots" ADD COLUMN "snapshot_timestamp" DATETIME;
CREATE INDEX "order_financial_snapshots_advertiser_rank_idx" ON "order_financial_snapshots"("advertiser_rank");
