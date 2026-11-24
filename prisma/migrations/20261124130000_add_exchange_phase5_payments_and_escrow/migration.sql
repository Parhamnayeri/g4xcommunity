-- AlterTable
ALTER TABLE "wallets" ADD COLUMN "reserved_balance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payment_code" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "buyer_user_id" TEXT NOT NULL,
    "buyer_discord_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "base_amount_cents" INTEGER NOT NULL,
    "buyer_fee_cents" INTEGER NOT NULL,
    "payment_processing_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "network_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "total_payable_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "confirmed_at" DATETIME,
    "confirmed_by_discord_id" TEXT,
    "provider_order_id" TEXT,
    "invoice_id" TEXT,
    "invoice_url" TEXT,
    "provider_payment_id" TEXT,
    "pay_address" TEXT,
    "pay_currency" TEXT,
    "pay_amount" TEXT,
    "actually_paid" TEXT,
    "outcome_amount" TEXT,
    "outcome_currency" TEXT,
    "gateway_status" TEXT,
    "ipn_verified" BOOLEAN NOT NULL DEFAULT false,
    "ipn_history_json" TEXT,
    "bank_reference" TEXT,
    "receipt_url" TEXT,
    "sender_note" TEXT,
    "reviewed_by_discord_id" TEXT,
    "review_note" TEXT,
    "reviewed_at" DATETIME,
    "ledger_transaction_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchange_payments_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "exchange_trades" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_payments_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_escrow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trade_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "buyer_user_id" TEXT NOT NULL,
    "seller_user_id" TEXT NOT NULL,
    "funding_source" TEXT NOT NULL,
    "reserved_amount_cents" INTEGER NOT NULL,
    "trade_gross_cents" INTEGER NOT NULL,
    "buyer_fee_cents" INTEGER NOT NULL,
    "seller_fee_cents" INTEGER NOT NULL,
    "net_seller_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "reserved_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" DATETIME,
    "refunded_at" DATETIME,
    "refunded_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "reserve_ledger_id" TEXT,
    "resolution_ledger_id" TEXT,
    "resolution_note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchange_escrow_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "exchange_trades" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_escrow_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "exchange_payments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_escrow_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_escrow_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_payments_payment_code_key" ON "exchange_payments"("payment_code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_payments_provider_order_id_key" ON "exchange_payments"("provider_order_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_payments_trade_id_status_idx" ON "exchange_payments"("trade_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_payments_buyer_discord_id_status_idx" ON "exchange_payments"("buyer_discord_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_payments_method_status_idx" ON "exchange_payments"("method", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_escrow_trade_id_key" ON "exchange_escrow"("trade_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_escrow_payment_id_key" ON "exchange_escrow"("payment_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_escrow_status_idx" ON "exchange_escrow"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_escrow_buyer_user_id_status_idx" ON "exchange_escrow"("buyer_user_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_escrow_seller_user_id_status_idx" ON "exchange_escrow"("seller_user_id", "status");
