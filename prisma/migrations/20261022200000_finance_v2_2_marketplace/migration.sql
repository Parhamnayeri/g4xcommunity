-- Migration: 20261022200000_finance_v2_2_marketplace
-- Phase Finance V2.2: Exchanger Marketplace, Gold Trading & P2P Funding

-- 1. Create Table exchanger_fee_offers
CREATE TABLE "exchanger_fee_offers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "offer_ref" TEXT NOT NULL,
    "exchanger_id" TEXT NOT NULL,
    "service_type" TEXT NOT NULL,
    "settlement_currency" TEXT NOT NULL,
    "commission_percentage" REAL NOT NULL,
    "fee_calculation_basis" TEXT NOT NULL DEFAULT 'GROSS_INPUT',
    "fee_payer" TEXT NOT NULL DEFAULT 'ADVERTISER',
    "reference_fx_policy" TEXT DEFAULT 'ADMIN_USD_IRT_REFERENCE',
    "min_amount" REAL,
    "max_amount" REAL,
    "offer_version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "terms" TEXT,
    "effective_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspended_reason" TEXT,
    "suspended_by" TEXT,
    "suspended_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exchanger_fee_offers_exchanger_id_fkey" FOREIGN KEY ("exchanger_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 2. Create Unique and Performance Indexes for exchanger_fee_offers
CREATE UNIQUE INDEX "exchanger_fee_offers_offer_ref_key" ON "exchanger_fee_offers"("offer_ref");
CREATE INDEX "exchanger_fee_offers_exchanger_id_idx" ON "exchanger_fee_offers"("exchanger_id");
CREATE INDEX "exchanger_fee_offers_service_type_status_idx" ON "exchanger_fee_offers"("service_type", "status");

-- 3. Create Table gold_trades
CREATE TABLE "gold_trades" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trade_ref" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "game_slug" TEXT NOT NULL DEFAULT 'wow_midnight',
    "region" TEXT DEFAULT 'EU',
    "realm" TEXT,
    "faction" TEXT,
    "gold_quantity" INTEGER NOT NULL,
    "gold_unit" TEXT NOT NULL DEFAULT 'RAW_GOLD',
    "agreed_valuation_usd_cents" INTEGER NOT NULL,
    "settlement_method" TEXT NOT NULL,
    "commission_percentage" REAL,
    "commission_amount_units" TEXT,
    "fee_payer" TEXT,
    "reference_fx_rate" REAL,
    "quoted_payable_amount" TEXT,
    "quoted_payable_currency" TEXT,
    "accepted_offer_id" INTEGER,
    "accepted_offer_version" INTEGER,
    "quote_expires_at" DATETIME,
    "quote_hash" TEXT,
    "gold_delivery_status" TEXT NOT NULL DEFAULT 'PENDING',
    "payment_status" TEXT NOT NULL DEFAULT 'PENDING',
    "trade_status" TEXT NOT NULL DEFAULT 'DRAFT',
    "wallet_reservation_id" TEXT,
    "delivery_evidence_ref" TEXT,
    "delivery_reported_at" DATETIME,
    "delivery_verified_by" TEXT,
    "delivery_verified_at" DATETIME,
    "external_payment_method" TEXT,
    "external_payment_ref" TEXT,
    "external_payment_amount" TEXT,
    "payment_submitted_at" DATETIME,
    "payment_verified_by" TEXT,
    "payment_verified_at" DATETIME,
    "advertiser_confirmed_receipt_at" DATETIME,
    "actual_settlement_ref" TEXT,
    "settled_at" DATETIME,
    "settled_by" TEXT,
    "dispute_reason" TEXT,
    "disputed_by" TEXT,
    "disputed_at" DATETIME,
    "cancellation_reason" TEXT,
    "cancelled_by" TEXT,
    "cancelled_at" DATETIME,
    "legacy_order_id" INTEGER,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gold_trades_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "gold_trades_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "gold_trades_delivery_verified_by_fkey" FOREIGN KEY ("delivery_verified_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "gold_trades_accepted_offer_id_fkey" FOREIGN KEY ("accepted_offer_id") REFERENCES "exchanger_fee_offers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- 4. Create Indexes for gold_trades
CREATE UNIQUE INDEX "gold_trades_trade_ref_key" ON "gold_trades"("trade_ref");
CREATE INDEX "gold_trades_seller_id_idx" ON "gold_trades"("seller_id");
CREATE INDEX "gold_trades_buyer_id_idx" ON "gold_trades"("buyer_id");
CREATE INDEX "gold_trades_trade_status_idx" ON "gold_trades"("trade_status");
CREATE INDEX "gold_trades_settlement_method_idx" ON "gold_trades"("settlement_method");
CREATE INDEX "gold_trades_created_at_idx" ON "gold_trades"("created_at");

-- 5. Add gold_trade_id to ledger_entries_v2
ALTER TABLE "ledger_entries_v2" ADD COLUMN "gold_trade_id" INTEGER REFERENCES "gold_trades"("id") ON DELETE SET NULL;
CREATE INDEX "ledger_entries_v2_gold_trade_id_idx" ON "ledger_entries_v2"("gold_trade_id");
