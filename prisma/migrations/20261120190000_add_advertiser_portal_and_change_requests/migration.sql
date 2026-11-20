-- CreateTable
CREATE TABLE IF NOT EXISTS "order_change_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_id" INTEGER NOT NULL,
    "requester_discord_id" TEXT NOT NULL,
    "request_type" TEXT NOT NULL,
    "proposed_changes_json" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_by_discord_id" TEXT,
    "review_note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" DATETIME,
    CONSTRAINT "order_change_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_change_requests_requester_discord_id_fkey" FOREIGN KEY ("requester_discord_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_change_requests_reviewed_by_discord_id_fkey" FOREIGN KEY ("reviewed_by_discord_id") REFERENCES "users" ("discord_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "deposit_intents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "intent_ref" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'NOWPAYMENTS',
    "amount_usd" REAL NOT NULL,
    "pay_currency" TEXT NOT NULL,
    "payment_id" TEXT,
    "invoice_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "confirmed_at" DATETIME,
    CONSTRAINT "deposit_intents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_change_requests_order_id_idx" ON "order_change_requests"("order_id");
CREATE INDEX IF NOT EXISTS "order_change_requests_requester_discord_id_idx" ON "order_change_requests"("requester_discord_id");
CREATE INDEX IF NOT EXISTS "order_change_requests_status_idx" ON "order_change_requests"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "deposit_intents_intent_ref_key" ON "deposit_intents"("intent_ref");
CREATE UNIQUE INDEX IF NOT EXISTS "deposit_intents_payment_id_key" ON "deposit_intents"("payment_id");
CREATE INDEX IF NOT EXISTS "deposit_intents_user_id_idx" ON "deposit_intents"("user_id");
CREATE INDEX IF NOT EXISTS "deposit_intents_status_idx" ON "deposit_intents"("status");
