-- CreateTable
CREATE TABLE "user_payout_preferences" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "bank_account_holder" TEXT,
    "bank_iban" TEXT,
    "crypto_address" TEXT,
    "crypto_network" TEXT DEFAULT 'BNB_SMART_CHAIN_BEP20',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_payout_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "user_payout_preferences_user_id_key" ON "user_payout_preferences"("user_id");

-- CreateIndex
CREATE INDEX "user_payout_preferences_user_id_idx" ON "user_payout_preferences"("user_id");
