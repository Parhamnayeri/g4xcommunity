-- AlterTable
ALTER TABLE "exchange_trades" ADD COLUMN "buyer_confirmed_at" DATETIME;
ALTER TABLE "exchange_trades" ADD COLUMN "final_approved_at" DATETIME;
ALTER TABLE "exchange_trades" ADD COLUMN "completed_at" DATETIME;
ALTER TABLE "exchange_trades" ADD COLUMN "internal_admin_notes" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_proofs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trade_id" TEXT NOT NULL,
    "submitted_by_user_id" TEXT NOT NULL,
    "submitted_by_discord_id" TEXT NOT NULL,
    "submitter_role" TEXT NOT NULL,
    "proof_type" TEXT NOT NULL DEFAULT 'DELIVERY_PROOF',
    "file_url" TEXT,
    "evidence_links_json" TEXT NOT NULL DEFAULT '[]',
    "in_game_details" TEXT,
    "note" TEXT,
    "review_status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_by_discord_id" TEXT,
    "review_note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchange_proofs_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "exchange_trades" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_proofs_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_settlements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlement_code" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "escrow_id" TEXT NOT NULL,
    "buyer_user_id" TEXT NOT NULL,
    "seller_user_id" TEXT NOT NULL,
    "settlement_type" TEXT NOT NULL DEFAULT 'STANDARD_RELEASE',
    "gross_value_cents" INTEGER NOT NULL,
    "buyer_commission_cents" INTEGER NOT NULL,
    "seller_commission_cents" INTEGER NOT NULL,
    "g4x_total_revenue_cents" INTEGER NOT NULL,
    "seller_net_payout_cents" INTEGER NOT NULL,
    "buyer_refund_cents" INTEGER NOT NULL DEFAULT 0,
    "buyer_escrow_debit_ledger_id" TEXT,
    "seller_credit_ledger_id" TEXT,
    "buyer_refund_ledger_id" TEXT,
    "approved_by_discord_id" TEXT NOT NULL,
    "approval_note" TEXT,
    "settled_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exchange_settlements_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "exchange_trades" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_settlements_escrow_id_fkey" FOREIGN KEY ("escrow_id") REFERENCES "exchange_escrow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_disputes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dispute_code" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "opened_by_user_id" TEXT NOT NULL,
    "opened_by_discord_id" TEXT NOT NULL,
    "opened_by_role" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution_outcome" TEXT,
    "resolution_buyer_refund_cents" INTEGER,
    "resolution_seller_payout_cents" INTEGER,
    "resolution_note" TEXT,
    "resolved_by_discord_id" TEXT,
    "resolved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exchange_disputes_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "exchange_trades" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchange_disputes_opened_by_user_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipient_discord_id" TEXT,
    "recipient_role" TEXT,
    "trade_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_proofs_trade_id_created_at_idx" ON "exchange_proofs"("trade_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_settlements_settlement_code_key" ON "exchange_settlements"("settlement_code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_settlements_trade_id_key" ON "exchange_settlements"("trade_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_settlements_escrow_id_key" ON "exchange_settlements"("escrow_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_settlements_seller_user_id_settled_at_idx" ON "exchange_settlements"("seller_user_id", "settled_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_settlements_buyer_user_id_settled_at_idx" ON "exchange_settlements"("buyer_user_id", "settled_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_disputes_dispute_code_key" ON "exchange_disputes"("dispute_code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_disputes_trade_id_status_idx" ON "exchange_disputes"("trade_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_disputes_status_created_at_idx" ON "exchange_disputes"("status", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_notifications_recipient_discord_id_is_read_idx" ON "exchange_notifications"("recipient_discord_id", "is_read");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_notifications_recipient_role_is_read_idx" ON "exchange_notifications"("recipient_role", "is_read");
