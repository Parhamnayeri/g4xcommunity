-- Migration: 20261022190000_finance_v2_1_hardening
-- Phase Finance V2.1: Accounting Hardening, Quote Security & Balanced Ledger Fields

-- Add balanced journal fields to ledger_entries_v2
ALTER TABLE "ledger_entries_v2" ADD COLUMN "posting_group_id" TEXT;
ALTER TABLE "ledger_entries_v2" ADD COLUMN "account_type" TEXT DEFAULT 'USER_WALLET';
ALTER TABLE "ledger_entries_v2" ADD COLUMN "reversal_of_entry_ref" TEXT;
ALTER TABLE "ledger_entries_v2" ADD COLUMN "idempotency_key" TEXT;

-- Create indexes for ledger_entries_v2
CREATE UNIQUE INDEX "ledger_entries_v2_idempotency_key_key" ON "ledger_entries_v2"("idempotency_key");
CREATE INDEX "ledger_entries_v2_posting_group_id_idx" ON "ledger_entries_v2"("posting_group_id");

-- Add quote security fields to booster_withdrawal_requests
ALTER TABLE "booster_withdrawal_requests" ADD COLUMN "quote_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "booster_withdrawal_requests" ADD COLUMN "quote_hash" TEXT;
ALTER TABLE "booster_withdrawal_requests" ADD COLUMN "policy_version" INTEGER;
ALTER TABLE "booster_withdrawal_requests" ADD COLUMN "revalidated_at" DATETIME;
