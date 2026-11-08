-- CreateTable
CREATE TABLE "platform_accounts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "account_ref" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "sales_credited_minor" INTEGER NOT NULL DEFAULT 0,
    "pending_release_minor" INTEGER NOT NULL DEFAULT 0,
    "eligible_balance_minor" INTEGER NOT NULL DEFAULT 0,
    "reserved_batch_minor" INTEGER NOT NULL DEFAULT 0,
    "withdrawn_total_minor" INTEGER NOT NULL DEFAULT 0,
    "received_total_minor" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "platform_account_transactions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "transaction_ref" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "entry_type" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "order_id" INTEGER,
    "order_ref" TEXT,
    "batch_id" INTEGER,
    "external_tx_ref" TEXT,
    "reason" TEXT,
    "balance_snapshot_minor" INTEGER,
    "created_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_account_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "platform_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "platform_account_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "platform_account_transactions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "platform_withdrawal_batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "platform_account_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "platform_withdrawal_batches" ADD COLUMN "platform_account_id" INTEGER;
ALTER TABLE "platform_withdrawal_batches" ADD COLUMN "account_ref" TEXT;
ALTER TABLE "platform_withdrawal_batches" ADD COLUMN "expected_net_minor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "platform_withdrawal_batches" ADD COLUMN "actual_received_minor" INTEGER;
ALTER TABLE "platform_withdrawal_batches" ADD COLUMN "destination_account_ref" TEXT;
ALTER TABLE "platform_withdrawal_batches" ADD COLUMN "safe_evidence_ref" TEXT;
ALTER TABLE "platform_withdrawal_batches" ADD COLUMN "failure_reason" TEXT;
ALTER TABLE "platform_withdrawal_batches" ADD COLUMN "review_notes" TEXT;
ALTER TABLE "platform_withdrawal_batches" ADD COLUMN "submitted_at" DATETIME;
ALTER TABLE "platform_withdrawal_batches" ADD COLUMN "submitted_by" TEXT;
ALTER TABLE "platform_withdrawal_batches" ADD COLUMN "receipt_confirmed_at" DATETIME;
ALTER TABLE "platform_withdrawal_batches" ADD COLUMN "receipt_confirmed_by" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "platform_accounts_account_ref_key" ON "platform_accounts"("account_ref");

-- CreateIndex
CREATE INDEX "platform_accounts_platform_is_active_idx" ON "platform_accounts"("platform", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "platform_account_transactions_transaction_ref_key" ON "platform_account_transactions"("transaction_ref");

-- CreateIndex
CREATE INDEX "platform_account_transactions_account_id_entry_type_idx" ON "platform_account_transactions"("account_id", "entry_type");

-- CreateIndex
CREATE INDEX "platform_account_transactions_order_id_idx" ON "platform_account_transactions"("order_id");

-- CreateIndex
CREATE INDEX "platform_account_transactions_batch_id_idx" ON "platform_account_transactions"("batch_id");

-- CreateIndex
CREATE INDEX "platform_account_transactions_created_at_idx" ON "platform_account_transactions"("created_at");

-- CreateIndex
CREATE INDEX "platform_withdrawal_batches_platform_account_id_idx" ON "platform_withdrawal_batches"("platform_account_id");
