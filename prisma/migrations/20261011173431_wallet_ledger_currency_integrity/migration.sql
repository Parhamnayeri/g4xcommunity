-- AlterTable
ALTER TABLE "ledger_transactions" ADD COLUMN "escrow_start_at" DATETIME;

-- RedefineTables to enforce non-negative balances on wallets
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_wallets" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "balance_usd" INTEGER NOT NULL DEFAULT 0,
    "escrow_usd" INTEGER NOT NULL DEFAULT 0,
    "balance_gold" INTEGER NOT NULL DEFAULT 0,
    "escrow_gold" INTEGER NOT NULL DEFAULT 0,
    "balance_usdt" INTEGER NOT NULL DEFAULT 0,
    "escrow_usdt" INTEGER NOT NULL DEFAULT 0,
    "balance_irt" INTEGER NOT NULL DEFAULT 0,
    "escrow_irt" INTEGER NOT NULL DEFAULT 0,
    "custom_commission_rate" REAL DEFAULT 0.15,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("discord_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "wallets_positive_balances_check" CHECK (
        "balance_usd" >= 0 AND "escrow_usd" >= 0 AND
        "balance_gold" >= 0 AND "escrow_gold" >= 0 AND
        "balance_usdt" >= 0 AND "escrow_usdt" >= 0 AND
        "balance_irt" >= 0 AND "escrow_irt" >= 0
    )
);
INSERT INTO "new_wallets" ("balance_gold", "balance_irt", "balance_usd", "balance_usdt", "custom_commission_rate", "escrow_gold", "escrow_irt", "escrow_usd", "escrow_usdt", "updated_at", "user_id") SELECT "balance_gold", "balance_irt", "balance_usd", "balance_usdt", "custom_commission_rate", "escrow_gold", "escrow_irt", "escrow_usd", "escrow_usdt", "updated_at", "user_id" FROM "wallets";
DROP TABLE "wallets";
ALTER TABLE "new_wallets" RENAME TO "wallets";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
