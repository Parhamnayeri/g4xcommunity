-- AlterTable
ALTER TABLE "deposit_intents" ADD COLUMN "is_sandbox" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "deposit_intents" ADD COLUMN "invoice_id" TEXT;
ALTER TABLE "deposit_intents" ADD COLUMN "purchase_id" TEXT;
ALTER TABLE "deposit_intents" ADD COLUMN "pay_address" TEXT;
ALTER TABLE "deposit_intents" ADD COLUMN "price_amount" REAL;
ALTER TABLE "deposit_intents" ADD COLUMN "pay_amount" REAL;
ALTER TABLE "deposit_intents" ADD COLUMN "actually_paid" REAL;
ALTER TABLE "deposit_intents" ADD COLUMN "outcome_amount" REAL;
ALTER TABLE "deposit_intents" ADD COLUMN "outcome_currency" TEXT;
ALTER TABLE "deposit_intents" ADD COLUMN "gateway_status" TEXT NOT NULL DEFAULT 'waiting';
ALTER TABLE "deposit_intents" ADD COLUMN "ipn_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "deposit_intents" ADD COLUMN "last_ipn_at" DATETIME;
ALTER TABLE "deposit_intents" ADD COLUMN "ipn_history_json" TEXT;
ALTER TABLE "deposit_intents" ADD COLUMN "credited_at" DATETIME;
ALTER TABLE "deposit_intents" ADD COLUMN "credited_ledger_id" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deposit_intents_gateway_status_idx" ON "deposit_intents"("gateway_status");
CREATE INDEX IF NOT EXISTS "deposit_intents_invoice_id_idx" ON "deposit_intents"("invoice_id");
