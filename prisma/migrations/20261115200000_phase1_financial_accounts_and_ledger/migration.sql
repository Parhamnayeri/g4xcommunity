-- Migration: 20261115200000_phase1_financial_accounts_and_ledger
-- Objective: Phase 1 — Financial Accounts, Transactions & Ledger Foundation (D1 / SQLite)

-- CreateTable: financial_accounts
CREATE TABLE IF NOT EXISTS "financial_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "opening_balance" BIGINT NOT NULL DEFAULT 0,
    "current_balance" BIGINT NOT NULL DEFAULT 0,
    "reserved_balance" BIGINT NOT NULL DEFAULT 0,
    "available_balance" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "bank_name" TEXT,
    "account_number" TEXT,
    "iban" TEXT,
    "card_number" TEXT,
    "notes" TEXT,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "financial_accounts_account_ref_key" ON "financial_accounts"("account_ref");
CREATE INDEX IF NOT EXISTS "financial_accounts_category_account_type_idx" ON "financial_accounts"("category", "account_type");
CREATE INDEX IF NOT EXISTS "financial_accounts_currency_status_idx" ON "financial_accounts"("currency", "status");

-- CreateTable: financial_transactions
CREATE TABLE IF NOT EXISTS "financial_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transaction_ref" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "attachment_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "admin_id" TEXT,
    "order_id" INTEGER,
    "order_ref" TEXT,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "financial_transactions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "financial_transactions_transaction_ref_key" ON "financial_transactions"("transaction_ref");
CREATE UNIQUE INDEX IF NOT EXISTS "financial_transactions_idempotency_key_key" ON "financial_transactions"("idempotency_key");
CREATE INDEX IF NOT EXISTS "financial_transactions_account_id_created_at_idx" ON "financial_transactions"("account_id", "created_at");
CREATE INDEX IF NOT EXISTS "financial_transactions_type_direction_idx" ON "financial_transactions"("type", "direction");
CREATE INDEX IF NOT EXISTS "financial_transactions_admin_id_idx" ON "financial_transactions"("admin_id");

-- CreateTable: financial_ledger_entries
CREATE TABLE IF NOT EXISTS "financial_ledger_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entry_ref" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "entry_type" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "balance_before" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "financial_transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "financial_ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "financial_ledger_entries_entry_ref_key" ON "financial_ledger_entries"("entry_ref");
CREATE INDEX IF NOT EXISTS "financial_ledger_entries_account_id_created_at_idx" ON "financial_ledger_entries"("account_id", "created_at");
CREATE INDEX IF NOT EXISTS "financial_ledger_entries_transaction_id_idx" ON "financial_ledger_entries"("transaction_id");
