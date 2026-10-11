/**
 * raiderio.ts — سرویس استعلام از Raider.IO API با استفاده از Prisma
 * 
 * مستندات API: https://raider.io/api
 * 
 * ویژگی‌ها:
 *  - دریافت اطلاعات کامل کاراکتر (کلاس، اسپک، آیتم‌لول، اسکور M+)
 *  - دریافت اسکور تفکیکی (Tank / Healer / DPS)
 *  - کشینگ نتایج برای جلوگیری از درخواست‌های اضافه
 *  - مدیریت خطاهای شبکه و کاراکتر یافت‌نشده
 */

import axios, { AxiosError } from 'axios';
import prisma from '../database/db';

// ─── انواع داده ───────────────────────────────────────────────────────────

export interface RaiderIOCharacter {
  name: string;
  race: string;
  class: string;
  active_spec_name: string;
  active_spec_role: string;
  gender: string;
  faction: string;
  achievement_points: number;
  honorable_kills: number;
  thumbnail_url: string;
  region: string;
  realm: string;
  profile_url: string;
  last_crawled_at: string;
  gear: {
    item_level_equipped: number;
    item_level_total: number;
  };
  mythic_plus_scores_by_season?: Array<{
    season: string;
    scores: {
      all: number;
      dps: number;
      healer: number;
      tank: number;
      spec_0: number;
      spec_1: number;
      spec_2: number;
      spec_3: number;
    };
  }>;
  raid_progression?: Record<string, {
    summary: string;
    total_bosses: number;
    normal_bosses_killed: number;
    heroic_bosses_killed: number;
    mythic_bosses_killed: number;
  }>;
}

export interface SyncedCharacterData {
  character_class: string;
  active_spec: string;
  item_level: number;
  mythic_score: number;
  tank_score: number;
  healer_score: number;
  dps_score: number;
  raid_progression: string;
  raiderio_url: string;
}

// ─── ثابت‌ها ────────────────────────────────────────────────────────────────
const BASE_URL = 'https://raider.io/api/v1';
const FIELDS = [
  'gear',
  'mythic_plus_scores_by_season:current',
  'raid_progression',
].join(',');

/**
 * دریافت اطلاعات کامل یک کاراکتر از Raider.IO
 */
export async function fetchCharacterData(
  characterName: string,
  realm: string,
  region: string,
): Promise<RaiderIOCharacter | null> {
  try {
    const response = await axios.get<RaiderIOCharacter>(`${BASE_URL}/characters/profile`, {
      params: {
        region,
        realm,
        name: characterName,
        fields: FIELDS,
      },
      timeout: 10_000, // 10 ثانیه
    });

    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError;

    if (axiosError.response?.status === 400 || axiosError.response?.status === 404) {
      // کاراکتر پیدا نشد
      return null;
    }

    console.error(`[RaiderIO] Failed to fetch ${characterName}-${realm} (${region}):`, error);
    throw error;
  }
}

/**
 * همگام‌سازی داده‌های یک کاراکتر در دیتابیس با استفاده از Prisma
 */
export async function syncCharacter(characterId: number): Promise<'synced' | 'not_found' | 'failed'> {
  const character = await prisma.wowCharacter.findUnique({
    where: { id: characterId },
  });

  if (!character) {
    console.error(`[RaiderIO] Character ID ${characterId} not found in database.`);
    return 'failed';
  }

  try {
    const data = await fetchCharacterData(character.characterName, character.realm, character.region);

    if (!data) {
      await prisma.wowCharacter.update({
        where: { id: characterId },
        data: {
          syncStatus: 'not_found',
          lastSyncedAt: new Date(),
        },
      });
      return 'not_found';
    }

    // استخراج اسکورهای M+
    const currentSeason = data.mythic_plus_scores_by_season?.[0];
    const scores = currentSeason?.scores ?? { all: 0, dps: 0, healer: 0, tank: 0 };

    // خلاصه پیشرفت ریدها
    const raidSummary = data.raid_progression
      ? Object.entries(data.raid_progression)
          .map(([raid, prog]) => `${raid}:${prog.summary}`)
          .join(' | ')
      : '';

    await prisma.wowCharacter.update({
      where: { id: characterId },
      data: {
        characterClass: data.class,
        activeSpec: data.active_spec_name,
        itemLevel: data.gear.item_level_equipped,
        mythicScore: scores.all,
        tankScore: scores.tank,
        healerScore: scores.healer,
        dpsScore: scores.dps,
        raidProgression: raidSummary,
        raiderioUrl: data.profile_url,
        syncStatus: 'synced',
        lastSyncedAt: new Date(),
      },
    });

    console.log(`[RaiderIO] ✅ Synced ${character.characterName}-${character.realm} | Score: ${scores.all}`);
    return 'synced';

  } catch {
    await prisma.wowCharacter.update({
      where: { id: characterId },
      data: {
        syncStatus: 'failed',
        lastSyncedAt: new Date(),
      },
    });
    return 'failed';
  }
}
