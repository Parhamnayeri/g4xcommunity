/**
 * prisma/seed.ts — اتصال به اسکریپت اصلی seed (src/database/seed.ts)
 */

import { seed } from '../src/database/seed';

export { seed };

if (require.main === module) {
  seed()
    .catch((e) => {
      console.error('[Seed] Error seeding database:', e);
      process.exit(1);
    });
}

