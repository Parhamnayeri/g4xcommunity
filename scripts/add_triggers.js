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

  console.log('WalletsV2 check triggers created successfully.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
