-- Migration: 20261115210000_phase2_transfers_exchange_withdrawals
-- Objective: Phase 2 — Internal Transfers, Platform Withdrawals, and Exchange Rates

-- CreateTable: exchange_rates
CREATE TABLE IF NOT EXISTS "exchange_rates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rate_ref" TEXT NOT NULL,
    "from_currency" TEXT NOT NULL,
    "to_currency" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "inverse_rate" REAL NOT NULL,
    "spread_percentage" REAL NOT NULL DEFAULT 0,
    "effective_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME,
    "is_active" BOOLEAN NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "admin_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exchange_rates_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "exchange_rates_rate_ref_key" ON "exchange_rates"("rate_ref");
CREATE INDEX IF NOT EXISTS "exchange_rates_from_currency_to_currency_is_active_idx" ON "exchange_rates"("from_currency", "to_currency", "is_active");
CREATE INDEX IF NOT EXISTS "exchange_rates_effective_at_idx" ON "exchange_rates"("effective_at");

-- CreateTable: internal_transfers
CREATE TABLE IF NOT EXISTS "internal_transfers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transfer_ref" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "source_account_id" TEXT NOT NULL,
    "destination_account_id" TEXT NOT NULL,
    "transfer_type" TEXT NOT NULL,
    "source_amount" BIGINT NOT NULL,
    "source_currency" TEXT NOT NULL,
    "destination_amount" BIGINT NOT NULL,
    "destination_currency" TEXT NOT NULL,
    "exchange_rate" REAL,
    "exchange_rate_id" TEXT,
    "fee_amount" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "description" TEXT,
    "attachment_url" TEXT,
    "admin_id" TEXT,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "internal_transfers_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "financial_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "internal_transfers_destination_account_id_fkey" FOREIGN KEY ("destination_account_id") REFERENCES "financial_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "internal_transfers_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "internal_transfers_exchange_rate_id_fkey" FOREIGN KEY ("exchange_rate_id") REFERENCES "exchange_rates" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "internal_transfers_transfer_ref_key" ON "internal_transfers"("transfer_ref");
CREATE UNIQUE INDEX IF NOT EXISTS "internal_transfers_idempotency_key_key" ON "internal_transfers"("idempotency_key");
CREATE INDEX IF NOT EXISTS "internal_transfers_source_account_id_created_at_idx" ON "internal_transfers"("source_account_id", "created_at");
CREATE INDEX IF NOT EXISTS "internal_transfers_destination_account_id_created_at_idx" ON "internal_transfers"("destination_account_id", "created_at");
CREATE INDEX IF NOT EXISTS "internal_transfers_transfer_type_status_idx" ON "internal_transfers"("transfer_type", "status");
CREATE INDEX IF NOT EXISTS "internal_transfers_admin_id_idx" ON "internal_transfers"("admin_id");

-- CreateTable: platform_withdrawals
CREATE TABLE IF NOT EXISTS "platform_withdrawals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawal_ref" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "source_account_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL DEFAULT 0,
    "net_amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "withdrawal_type" TEXT NOT NULL,
    "destination_type" TEXT NOT NULL,
    "destination_account_id" TEXT,
    "destination_details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" DATETIME,
    "admin_id" TEXT,
    "processed_by" TEXT,
    "reference_number" TEXT,
    "description" TEXT,
    "attachment_url" TEXT,
    "rejection_reason" TEXT,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_withdrawals_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "financial_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "platform_withdrawals_destination_account_id_fkey" FOREIGN KEY ("destination_account_id") REFERENCES "financial_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "platform_withdrawals_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "platform_withdrawals_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_withdrawals_withdrawal_ref_key" ON "platform_withdrawals"("withdrawal_ref");
CREATE UNIQUE INDEX IF NOT EXISTS "platform_withdrawals_idempotency_key_key" ON "platform_withdrawals"("idempotency_key");
CREATE INDEX IF NOT EXISTS "platform_withdrawals_source_account_id_status_idx" ON "platform_withdrawals"("source_account_id", "status");
CREATE INDEX IF NOT EXISTS "platform_withdrawals_status_created_at_idx" ON "platform_withdrawals"("status", "created_at");
CREATE INDEX IF NOT EXISTS "platform_withdrawals_admin_id_idx" ON "platform_withdrawals"("admin_id");
