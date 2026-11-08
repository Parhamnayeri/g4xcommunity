-- Migration: 20261025180000_payment_verification_and_nowpayments
-- Additive payment verification and NOWPayments integration models

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "request_ref" TEXT NOT NULL,
    "business_type" TEXT NOT NULL,
    "order_id" INTEGER,
    "funding_request_id" INTEGER,
    "user_id" TEXT NOT NULL,
    "amount_usd_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "active_receipt_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "payment_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "payment_requests_funding_request_id_fkey" FOREIGN KEY ("funding_request_id") REFERENCES "advertiser_funding_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "payment_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "attempt_ref" TEXT NOT NULL,
    "payment_request_id" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider_payment_id" TEXT,
    "provider_purchase_id" TEXT,
    "provider_parent_payment_id" TEXT,
    "pay_currency" TEXT,
    "pay_network" TEXT,
    "pay_address" TEXT,
    "pay_extra_id" TEXT,
    "expected_amount" TEXT NOT NULL,
    "expected_currency" TEXT NOT NULL,
    "exchange_rate" REAL,
    "quote_expires_at" DATETIME,
    "quote_snapshot" TEXT,
    "tracking_number" TEXT,
    "paid_amount_irt" TEXT,
    "sender_card_last4" TEXT,
    "receipt_screenshot_url" TEXT,
    "actual_amount_received" TEXT,
    "actual_currency_received" TEXT,
    "outcome_amount" TEXT,
    "outcome_currency" TEXT,
    "is_wrong_asset" BOOLEAN NOT NULL DEFAULT false,
    "is_re_deposit" BOOLEAN NOT NULL DEFAULT false,
    "review_reason" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" DATETIME,
    "reconciled_at" DATETIME,
    "reconciliation_notes" TEXT,
    "raw_callback_payload" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "payment_attempts_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "payment_attempts_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payment_receipts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receipt_ref" TEXT NOT NULL,
    "payment_request_id" INTEGER NOT NULL,
    "payment_attempt_id" INTEGER NOT NULL,
    "amount_usd_cents" INTEGER NOT NULL,
    "payment_method" TEXT NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "verified_by" TEXT NOT NULL,
    "verified_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "consumed_action" TEXT,
    "consumed_reference_id" TEXT,
    "consumed_at" DATETIME,
    "audit_log_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_receipts_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "payment_receipts_payment_attempt_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_request_ref_key" ON "payment_requests"("request_ref");
CREATE INDEX "payment_requests_user_id_idx" ON "payment_requests"("user_id");
CREATE INDEX "payment_requests_order_id_idx" ON "payment_requests"("order_id");
CREATE INDEX "payment_requests_funding_request_id_idx" ON "payment_requests"("funding_request_id");
CREATE INDEX "payment_requests_status_idx" ON "payment_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_attempt_ref_key" ON "payment_attempts"("attempt_ref");
CREATE UNIQUE INDEX "payment_attempts_provider_payment_id_key" ON "payment_attempts"("provider_payment_id");
CREATE INDEX "payment_attempts_payment_request_id_status_idx" ON "payment_attempts"("payment_request_id", "status");
CREATE INDEX "payment_attempts_tracking_number_idx" ON "payment_attempts"("tracking_number");
CREATE INDEX "payment_attempts_provider_payment_id_idx" ON "payment_attempts"("provider_payment_id");
CREATE INDEX "payment_attempts_status_idx" ON "payment_attempts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_receipt_ref_key" ON "payment_receipts"("receipt_ref");
CREATE INDEX "payment_receipts_payment_request_id_idx" ON "payment_receipts"("payment_request_id");
CREATE INDEX "payment_receipts_payment_attempt_id_idx" ON "payment_receipts"("payment_attempt_id");
CREATE INDEX "payment_receipts_provider_reference_idx" ON "payment_receipts"("provider_reference");
CREATE INDEX "payment_receipts_status_idx" ON "payment_receipts"("status");
