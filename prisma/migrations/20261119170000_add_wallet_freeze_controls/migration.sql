-- AlterTable
ALTER TABLE "wallets" ADD COLUMN "frozen_balance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "wallets" ADD COLUMN "is_frozen" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "wallets_v2" ADD COLUMN "frozen_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "wallets_v2" ADD COLUMN "is_frozen" BOOLEAN NOT NULL DEFAULT false;
