const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS wallets_v2_pos_chk_ins
    BEFORE INSERT ON wallets_v2
    BEGIN
      SELECT CASE
        WHEN NEW.available_cents < 0 OR NEW.reserved_cents < 0 OR NEW.pending_earnings_cents < 0 OR NEW.confirmed_earnings_cents < 0 OR NEW.paid_cents < 0 OR NEW.refunded_cents < 0
        THEN RAISE(ABORT, 'CHECK constraint failed: wallets_v2_positive_balances_check')
      END;
    END;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS wallets_v2_pos_chk_upd
    BEFORE UPDATE ON wallets_v2
    BEGIN
      SELECT CASE
        WHEN NEW.available_cents < 0 OR NEW.reserved_cents < 0 OR NEW.pending_earnings_cents < 0 OR NEW.confirmed_earnings_cents < 0 OR NEW.paid_cents < 0 OR NEW.refunded_cents < 0
        THEN RAISE(ABORT, 'CHECK constraint failed: wallets_v2_positive_balances_check')
      END;
    END;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bwr_settled_tx_hash_unique
    ON booster_withdrawal_requests(external_tx_hash)
    WHERE external_tx_hash IS NOT NULL AND status IN ('PAID', 'PROCESSING');
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bwr_settled_bank_receipt_unique
    ON booster_withdrawal_requests(bank_receipt_ref)
    WHERE bank_receipt_ref IS NOT NULL AND status IN ('PAID', 'PROCESSING');
  `);

  console.log('WalletsV2 check triggers and withdrawal unique indexes created successfully.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
