-- Migration: 20261115230000_phase4_ledger_audit_reconciliation
-- Phase 4: Double-Entry Financial Ledger, Audit Trail, and Balance Reconciliation

-- 1. Create Double-Entry Financial Journal Table
CREATE TABLE IF NOT EXISTS "double_entry_journal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entry_ref" TEXT NOT NULL,
    "transaction_id" TEXT,
    "transaction_type" TEXT NOT NULL,
    "reference_id" TEXT,
    "debit_account_id" TEXT NOT NULL,
    "credit_account_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "double_entry_journal_debit_account_id_fkey" FOREIGN KEY ("debit_account_id") REFERENCES "financial_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "double_entry_journal_credit_account_id_fkey" FOREIGN KEY ("credit_account_id") REFERENCES "financial_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "double_entry_journal_entry_ref_key" ON "double_entry_journal"("entry_ref");
CREATE INDEX IF NOT EXISTS "double_entry_journal_debit_account_id_created_at_idx" ON "double_entry_journal"("debit_account_id", "created_at");
CREATE INDEX IF NOT EXISTS "double_entry_journal_credit_account_id_created_at_idx" ON "double_entry_journal"("credit_account_id", "created_at");
CREATE INDEX IF NOT EXISTS "double_entry_journal_transaction_type_currency_idx" ON "double_entry_journal"("transaction_type", "currency");
CREATE INDEX IF NOT EXISTS "double_entry_journal_reference_id_idx" ON "double_entry_journal"("reference_id");

-- 2. Create Financial Audit Logs Table
CREATE TABLE IF NOT EXISTS "financial_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "log_ref" TEXT NOT NULL,
    "admin_id" TEXT,
    "action_type" TEXT NOT NULL,
    "related_account_id" TEXT,
    "transaction_id" TEXT,
    "previous_state" TEXT,
    "new_state" TEXT,
    "reason" TEXT,
    "ip_address" TEXT,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "financial_audit_logs_log_ref_key" ON "financial_audit_logs"("log_ref");
CREATE INDEX IF NOT EXISTS "financial_audit_logs_admin_id_created_at_idx" ON "financial_audit_logs"("admin_id", "created_at");
CREATE INDEX IF NOT EXISTS "financial_audit_logs_action_type_created_at_idx" ON "financial_audit_logs"("action_type", "created_at");
CREATE INDEX IF NOT EXISTS "financial_audit_logs_related_account_id_idx" ON "financial_audit_logs"("related_account_id");
CREATE INDEX IF NOT EXISTS "financial_audit_logs_transaction_id_idx" ON "financial_audit_logs"("transaction_id");

-- 3. Create Balance Reconciliations Table
CREATE TABLE IF NOT EXISTS "balance_reconciliations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reconciliation_ref" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "system_balance_minor" BIGINT NOT NULL,
    "actual_balance_minor" BIGINT NOT NULL,
    "difference_minor" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BALANCED',
    "admin_id" TEXT,
    "notes" TEXT,
    "attachment_url" TEXT,
    "adjustment_transaction_id" TEXT,
    "reconciliation_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "balance_reconciliations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "balance_reconciliations_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "balance_reconciliations_reconciliation_ref_key" ON "balance_reconciliations"("reconciliation_ref");
CREATE INDEX IF NOT EXISTS "balance_reconciliations_account_id_reconciliation_date_idx" ON "balance_reconciliations"("account_id", "reconciliation_date");
CREATE INDEX IF NOT EXISTS "balance_reconciliations_status_idx" ON "balance_reconciliations"("status");

-- 4. Add Reversal Columns to financial_transactions
-- SQLite allows ADD COLUMN if column doesn't exist
-- We run through migration script safely
