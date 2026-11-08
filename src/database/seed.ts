/**
 * src/database/seed.ts — مقداردهی اولیه داده‌های پایه سیستم G4X (Canonical Seed Script)
 *
 * فاز ۲.۲: رجیستری بازی‌ها و پیکربندی سرویس‌ها
 */

import prisma from './db';

export const SYSTEM_ROLES = [
  { roleKey: 'owner', name: 'Owner' },
  { roleKey: 'manager', name: 'Manager' },
  { roleKey: 'admin', name: 'Admin' },
  { roleKey: 'staff', name: 'Staff' },
  { roleKey: 'advertiser', name: 'Advertiser' },
  { roleKey: 'booster', name: 'Booster' },
  { roleKey: 'pilot', name: 'Pilot' },
  { roleKey: 'exchanger', name: 'Exchanger' },
];

export const SUPPORTED_GAMES = [
  // Non-Pilot & Pilot
  {
    slug: 'wow_midnight',
    displayName: 'World of Warcraft Midnight',
    serviceCategory: 'both',
    isActive: true,
  },
  // Non-Pilot Only
  {
    slug: 'rainbow_six_siege',
    displayName: 'Rainbow Six Siege',
    serviceCategory: 'non_pilot',
    isActive: true,
  },
  // Pilot Only
  {
    slug: 'wow_classic_tbc',
    displayName: 'WoW Classic TBC',
    serviceCategory: 'pilot',
    isActive: true,
  },
  {
    slug: 'wow_classic_era',
    displayName: 'WoW Classic Era',
    serviceCategory: 'pilot',
    isActive: true,
  },
  {
    slug: 'wow_classic_pandaria',
    displayName: 'WoW Classic Pandaria',
    serviceCategory: 'pilot',
    isActive: true,
  },
  {
    slug: 'wow_forever',
    displayName: 'WoW Forever',
    serviceCategory: 'pilot',
    isActive: true,
  },
  {
    slug: 'aion_2',
    displayName: 'Aion 2',
    serviceCategory: 'pilot',
    isActive: true,
  },
  {
    slug: 'poe2',
    displayName: 'Path of Exile 2',
    serviceCategory: 'pilot',
    isActive: true,
  },
  {
    slug: 'escape_from_tarkov',
    displayName: 'Escape from Tarkov',
    serviceCategory: 'pilot',
    isActive: true,
  },
];

export const GAME_SERVICES = [
  // ─── World of Warcraft Midnight ──────────────────────────────────────────
  // Non-Pilot Services (Raider.IO auto-check for character boost services)
  {
    gameSlug: 'wow_midnight',
    serviceKey: 'mythic_plus',
    displayName: 'Mythic+ Boosting',
    serviceMode: 'non_pilot',
    profileMode: 'raiderio',
    requiresPilotApproval: false,
    isActive: true,
  },
  {
    gameSlug: 'wow_midnight',
    serviceKey: 'raid_boost',
    displayName: 'Raid Boosting',
    serviceMode: 'non_pilot',
    profileMode: 'raiderio',
    requiresPilotApproval: false,
    isActive: true,
  },
  {
    gameSlug: 'wow_midnight',
    serviceKey: 'afk_leveling',
    displayName: 'AFK Leveling',
    serviceMode: 'non_pilot',
    profileMode: 'manual',
    requiresPilotApproval: false,
    isActive: true,
  },
  // Pilot Service (Separated from Non-Pilot)
  {
    gameSlug: 'wow_midnight',
    serviceKey: 'pilot_boost',
    displayName: 'Pilot Boosting',
    serviceMode: 'pilot',
    profileMode: 'manual',
    requiresPilotApproval: true,
    isActive: true,
  },

  // ─── Rainbow Six Siege (Non-Pilot) ─────────────────────────────────────────
  {
    gameSlug: 'rainbow_six_siege',
    serviceKey: 'non_pilot_boost',
    displayName: 'Non-Pilot Boosting',
    serviceMode: 'non_pilot',
    profileMode: 'manual',
    requiresPilotApproval: false,
    isActive: true,
  },

  // ─── Pilot Only Games (Generic Pilot Services with Manual Verification) ───
  {
    gameSlug: 'wow_classic_tbc',
    serviceKey: 'pilot_boost',
    displayName: 'Pilot Boosting',
    serviceMode: 'pilot',
    profileMode: 'manual',
    requiresPilotApproval: true,
    isActive: true,
  },
  {
    gameSlug: 'wow_classic_era',
    serviceKey: 'pilot_boost',
    displayName: 'Pilot Boosting',
    serviceMode: 'pilot',
    profileMode: 'manual',
    requiresPilotApproval: true,
    isActive: true,
  },
  {
    gameSlug: 'wow_classic_pandaria',
    serviceKey: 'pilot_boost',
    displayName: 'Pilot Boosting',
    serviceMode: 'pilot',
    profileMode: 'manual',
    requiresPilotApproval: true,
    isActive: true,
  },
  {
    gameSlug: 'wow_forever',
    serviceKey: 'pilot_boost',
    displayName: 'Pilot Boosting',
    serviceMode: 'pilot',
    profileMode: 'manual',
    requiresPilotApproval: true,
    isActive: true,
  },
  {
    gameSlug: 'aion_2',
    serviceKey: 'pilot_boost',
    displayName: 'Pilot Boosting',
    serviceMode: 'pilot',
    profileMode: 'manual',
    requiresPilotApproval: true,
    isActive: true,
  },
  {
    gameSlug: 'poe2',
    serviceKey: 'pilot_boost',
    displayName: 'Pilot Boosting',
    serviceMode: 'pilot',
    profileMode: 'manual',
    requiresPilotApproval: true,
    isActive: true,
  },
  {
    gameSlug: 'escape_from_tarkov',
    serviceKey: 'pilot_boost',
    displayName: 'Pilot Boosting',
    serviceMode: 'pilot',
    profileMode: 'manual',
    requiresPilotApproval: true,
    isActive: true,
  },
];

/** Explicit fresh-install bootstrap: create missing defaults, never synchronize existing data. */
export async function seed(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const role of SYSTEM_ROLES) {
      if (!(await tx.role.findUnique({ where: { roleKey: role.roleKey } }))) {
        await tx.role.create({ data: role });
      }
    }
    for (const game of SUPPORTED_GAMES) {
      if (!(await tx.game.findUnique({ where: { slug: game.slug } }))) {
        await tx.game.create({ data: game });
      }
    }
    for (const service of GAME_SERVICES) {
      const where = { gameSlug_serviceKey: { gameSlug: service.gameSlug, serviceKey: service.serviceKey } };
      if (!(await tx.gameService.findUnique({ where }))) {
        await tx.gameService.create({ data: service });
      }
    }
  });
  console.log('[Seed] ✅ Missing defaults initialized; existing configuration preserved.');
}

if (require.main === module) {
  seed()
    .catch((e) => {
      console.error('[Seed] Error seeding database:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

