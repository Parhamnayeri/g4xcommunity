/**
 * raiderio.ts — سرویس اعتبارسنجی امن، استعلام و همگام‌سازی از Raider.IO API (Phase 3.2.4)
 * 
 * مستندات API: https://raider.io/api
 * مستندات پروفایل کاراکتر: GET https://raider.io/api/v1/characters/profile
 * 
 * ویژگی‌ها و تدابیر امنیتی:
 *  - اعتبارسنجی دقیق URL پروفایل کاراکتر Raider.IO (جلوگیری از SSRF، Localhost و شبکه‌های خصوصی)
 *  - استخراج خودکار Region, Realm و Character Name از آدرس پروفایل
 *  - استفاده از مبدا و اندپوینت ثابت API با پارامترهای کنترل‌شده
 *  - تایم‌اوت ۵ ثانیه‌ای و کشینگ درون‌حافظه‌ای با انقضای ۱۵ دقیقه (Bounded In-Memory Cache)
 *  - احترام به هدرهای ۴۲۹ (Rate Limit) و مدیریت خطاهای ۴۰۴ (یافت‌نشده) و خرابی API
 *  - اعتبارسنجی ساختار پاسخ بدون فرض وجود تمام فیلدها و بدون جعل اسکورها یا پیشرفت رید
 */

import axios, { AxiosError } from 'axios';
import prisma from '../database/db';

// ─── انواع داده و ساختارهای اسنپ‌شات ──────────────────────────────────────────

export interface ParsedRaiderIOUrl {
  region: 'us' | 'eu' | 'kr' | 'tw' | 'cn';
  realm: string;
  characterName: string;
  canonicalUrl: string;
}

export interface RaiderIOSnapshot {
  characterName: string;
  realm: string;
  region: string;
  characterClass?: string;
  activeSpec?: string;
  activeRole?: string;
  itemLevelEquipped?: number | null;
  itemLevelTotal?: number | null;
  mythicScore?: number | null;
  tankScore?: number | null;
  healerScore?: number | null;
  dpsScore?: number | null;
  currentSeason?: string | null;
  raidProgression?: string | null;
  profileUrl: string;
  fetchedAt: string;
  fetchStatus: 'success' | 'not_found' | 'api_error' | 'stale';
  errorDetails?: string;
}

export interface RaiderIOCharacter {
  name: string;
  race?: string;
  class?: string;
  active_spec_name?: string;
  active_spec_role?: string;
  gender?: string;
  faction?: string;
  achievement_points?: number;
  honorable_kills?: number;
  thumbnail_url?: string;
  region?: string;
  realm?: string;
  profile_url?: string;
  last_crawled_at?: string;
  gear?: {
    item_level_equipped?: number;
    item_level_total?: number;
  };
  mythic_plus_scores_by_season?: Array<{
    season?: string;
    scores?: {
      all?: number;
      dps?: number;
      healer?: number;
      tank?: number;
      spec_0?: number;
      spec_1?: number;
      spec_2?: number;
      spec_3?: number;
    };
  }>;
  raid_progression?: Record<string, {
    summary?: string;
    total_bosses?: number;
    normal_bosses_killed?: number;
    heroic_bosses_killed?: number;
    mythic_bosses_killed?: number;
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

// ─── ثابت‌ها و متغیرهای امنیت و کشینگ ──────────────────────────────────────────

const RAIDERIO_API_BASE = 'https://raider.io/api/v1';
const ALLOWED_REGIONS = ['us', 'eu', 'kr', 'tw', 'cn'] as const;
const REQUEST_TIMEOUT_MS = 5_000; // ۵ ثانیه تایم‌اوت سخت‌گیرانه
const CACHE_TTL_MS = 15 * 60 * 1_000; // ۱۵ دقیقه انقضای کش
const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  snapshot: RaiderIOSnapshot;
  expiresAt: number;
}

const profileCache = new Map<string, CacheEntry>();

/**
 * پاکسازی ورودی‌های قدیمی در صورت افزایش حجم کش
 */
function evictOldCacheEntries(): void {
  const now = Date.now();
  for (const [key, entry] of profileCache.entries()) {
    if (entry.expiresAt <= now) {
      profileCache.delete(key);
    }
  }
  if (profileCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = profileCache.keys().next().value;
    if (oldestKey) profileCache.delete(oldestKey);
  }
}

// ─── ۱. اعتبارسنجی و پارس امن URL کاراکتر Raider.IO (Security & Anti-SSRF) ─────

/**
 * پارس و اعتبارسنجی دقیق آدرس پروفایل Raider.IO با مسدودسازی SSRF و دامنه‌های غیرمجاز
 */
export function parseRaiderIOProfileUrl(urlStr: string): ParsedRaiderIOUrl | null {
  if (!urlStr || typeof urlStr !== 'string') return null;

  const trimmed = urlStr.trim();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return null;
  }

  // ۱. پروتکل الزاما باید HTTPS باشد
  if (parsedUrl.protocol !== 'https:') {
    return null;
  }

  // ۲. اعتبارسنجی دقیق Hostname: منحصراً raider.io یا www.raider.io
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname !== 'raider.io' && hostname !== 'www.raider.io') {
    return null;
  }

  // ۳. جلوگیری از تلاش برای دور زدن پورت یا آی‌پی محلی
  if (parsedUrl.port && parsedUrl.port !== '443') {
    return null;
  }

  // ۴. اعتبارسنجی مسیر (Path): ساختار /characters/<region>/<realm>/<character_name>
  // مثال: /characters/eu/twisting-nether/Arthas
  const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
  if (pathParts.length < 4 || pathParts[0].toLowerCase() !== 'characters') {
    return null;
  }

  const rawRegion = pathParts[1].toLowerCase();
  if (!ALLOWED_REGIONS.includes(rawRegion as any)) {
    return null;
  }

  let realm: string;
  let characterName: string;

  try {
    realm = decodeURIComponent(pathParts[2]).trim().toLowerCase();
    characterName = decodeURIComponent(pathParts[3]).trim();
  } catch {
    return null;
  }

  // نام ریلم و کاراکتر نباید خالی یا حاوی کاراکترهای خطرناک باشد
  if (!realm || !characterName) return null;
  if (/[\r\n\t<>]/.test(realm) || /[\r\n\t<>]/.test(characterName)) return null;

  const canonicalUrl = `https://raider.io/characters/${rawRegion}/${encodeURIComponent(realm)}/${encodeURIComponent(characterName)}`;

  return {
    region: rawRegion as ParsedRaiderIOUrl['region'],
    realm,
    characterName,
    canonicalUrl,
  };
}

// ─── ۲. استعلام امن از Raider.IO API با کشینگ و مدیریت خطا ───────────────────

/**
 * استعلام پروفایل کاراکتر با استفاده از اطلاعات استخراج‌شده یا URL پروفایل
 */
export async function fetchRaiderIOProfile(
  input: string | { region: string; realm: string; characterName: string }
): Promise<RaiderIOSnapshot> {
  let region: string;
  let realm: string;
  let characterName: string;
  let profileUrl: string;

  if (typeof input === 'string') {
    const parsed = parseRaiderIOProfileUrl(input);
    if (!parsed) {
      return {
        characterName: 'Unknown',
        realm: 'Unknown',
        region: 'Unknown',
        profileUrl: input,
        fetchedAt: new Date().toISOString(),
        fetchStatus: 'api_error',
        errorDetails: 'INVALID_RAIDERIO_URL: Supplied URL failed security validation or format requirements',
      };
    }
    region = parsed.region;
    realm = parsed.realm;
    characterName = parsed.characterName;
    profileUrl = parsed.canonicalUrl;
  } else {
    region = input.region.toLowerCase();
    realm = input.realm.toLowerCase();
    characterName = input.characterName.trim();
    profileUrl = `https://raider.io/characters/${region}/${encodeURIComponent(realm)}/${encodeURIComponent(characterName)}`;
  }

  const cacheKey = `${region}:${realm}:${characterName.toLowerCase()}`;
  const now = Date.now();
  const cached = profileCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.snapshot;
  }

  try {
    const response = await axios.get<RaiderIOCharacter>(`${RAIDERIO_API_BASE}/characters/profile`, {
      params: {
        region,
        realm,
        name: characterName,
        fields: 'gear,mythic_plus_scores_by_season:current,raid_progression',
      },
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'G4X-Community-Bot/1.0 (+https://g4x.online)',
      },
    });

    const data = response.data;
    if (!data || !data.name) {
      const notFoundSnapshot: RaiderIOSnapshot = {
        characterName,
        realm,
        region,
        profileUrl,
        fetchedAt: new Date().toISOString(),
        fetchStatus: 'not_found',
        errorDetails: 'Character profile returned empty body from Raider.IO',
      };
      return notFoundSnapshot;
    }

    // استخراج و اعتبارسنجی اسکور سیزن جاری
    const currentSeasonEntry = data.mythic_plus_scores_by_season?.[0];
    const scores = currentSeasonEntry?.scores;
    const mythicScore = typeof scores?.all === 'number' ? Math.round(scores.all) : null;
    const tankScore = typeof scores?.tank === 'number' ? Math.round(scores.tank) : null;
    const healerScore = typeof scores?.healer === 'number' ? Math.round(scores.healer) : null;
    const dpsScore = typeof scores?.dps === 'number' ? Math.round(scores.dps) : null;

    // استخراج پیشرفت رید
    let raidProgressionSummary: string | null = null;
    if (data.raid_progression && typeof data.raid_progression === 'object') {
      const summaries = Object.entries(data.raid_progression)
        .filter(([_, val]) => val && val.summary)
        .map(([raidKey, val]) => {
          const cleanKey = raidKey.replace(/-/g, ' ').toUpperCase();
          return `${cleanKey}: ${val.summary}`;
        });
      if (summaries.length > 0) {
        raidProgressionSummary = summaries.slice(0, 3).join(' | ');
      }
    }

    const snapshot: RaiderIOSnapshot = {
      characterName: data.name,
      realm: data.realm || realm,
      region: data.region || region,
      characterClass: data.class || undefined,
      activeSpec: data.active_spec_name || undefined,
      activeRole: data.active_spec_role || undefined,
      itemLevelEquipped: data.gear?.item_level_equipped ?? null,
      itemLevelTotal: data.gear?.item_level_total ?? null,
      mythicScore,
      tankScore,
      healerScore,
      dpsScore,
      currentSeason: currentSeasonEntry?.season || null,
      raidProgression: raidProgressionSummary,
      profileUrl: data.profile_url || profileUrl,
      fetchedAt: new Date().toISOString(),
      fetchStatus: 'success',
    };

    // ذخیره در کش درون‌حافظه‌ای
    evictOldCacheEntries();
    profileCache.set(cacheKey, {
      snapshot,
      expiresAt: now + CACHE_TTL_MS,
    });

    return snapshot;
  } catch (error: any) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;

    if (status === 400 || status === 404) {
      const notFoundSnapshot: RaiderIOSnapshot = {
        characterName,
        realm,
        region,
        profileUrl,
        fetchedAt: new Date().toISOString(),
        fetchStatus: 'not_found',
        errorDetails: 'Character not found on Raider.IO (404/400)',
      };
      return notFoundSnapshot;
    }

    if (status === 429) {
      const retryAfter = axiosError.response?.headers?.['retry-after'];
      console.warn(`[RaiderIO] Rate limited (429). Retry-After: ${retryAfter || 'unknown'}`);
      return {
        characterName,
        realm,
        region,
        profileUrl,
        fetchedAt: new Date().toISOString(),
        fetchStatus: 'api_error',
        errorDetails: `Rate limited by Raider.IO API (HTTP 429). Retry-After: ${retryAfter || 'N/A'}`,
      };
    }

    console.warn(`[RaiderIO] API error for ${characterName}-${realm} (${region}): ${error?.message || error}`);
    return {
      characterName,
      realm,
      region,
      profileUrl,
      fetchedAt: new Date().toISOString(),
      fetchStatus: 'api_error',
      errorDetails: `Raider.IO API communication failure: ${error?.message || 'Network/Server Error'}`,
    };
  }
}

// ─── ۳. توابع سازگاری گذشته (Legacy Compatibility Functions) ─────────────────

export async function fetchCharacterData(
  characterName: string,
  realm: string,
  region: string
): Promise<RaiderIOCharacter | null> {
  const snapshot = await fetchRaiderIOProfile({ region, realm, characterName });
  if (snapshot.fetchStatus !== 'success') {
    return null;
  }

  return {
    name: snapshot.characterName,
    region: snapshot.region,
    realm: snapshot.realm,
    class: snapshot.characterClass || 'Unknown',
    active_spec_name: snapshot.activeSpec || 'Unknown',
    active_spec_role: snapshot.activeRole || 'Unknown',
    profile_url: snapshot.profileUrl,
    gear: {
      item_level_equipped: snapshot.itemLevelEquipped ?? 0,
      item_level_total: snapshot.itemLevelTotal ?? 0,
    },
    mythic_plus_scores_by_season: snapshot.mythicScore !== null ? [
      {
        season: snapshot.currentSeason || 'current',
        scores: {
          all: snapshot.mythicScore ?? 0,
          tank: snapshot.tankScore ?? 0,
          healer: snapshot.healerScore ?? 0,
          dps: snapshot.dpsScore ?? 0,
          spec_0: 0,
          spec_1: 0,
          spec_2: 0,
          spec_3: 0,
        },
      },
    ] : undefined,
  } as RaiderIOCharacter;
}

export async function syncCharacter(characterId: number): Promise<'synced' | 'not_found' | 'failed'> {
  const character = await prisma.wowCharacter.findUnique({
    where: { id: characterId },
  });

  if (!character) {
    return 'failed';
  }

  const snapshot = await fetchRaiderIOProfile({
    characterName: character.characterName,
    realm: character.realm,
    region: character.region,
  });

  if (snapshot.fetchStatus === 'not_found') {
    await prisma.wowCharacter.update({
      where: { id: characterId },
      data: {
        syncStatus: 'not_found',
        lastSyncedAt: new Date(),
      },
    });
    return 'not_found';
  }

  if (snapshot.fetchStatus === 'api_error') {
    await prisma.wowCharacter.update({
      where: { id: characterId },
      data: {
        syncStatus: 'failed',
        lastSyncedAt: new Date(),
      },
    });
    return 'failed';
  }

  await prisma.wowCharacter.update({
    where: { id: characterId },
    data: {
      characterClass: snapshot.characterClass || 'Unknown',
      activeSpec: snapshot.activeSpec || 'Unknown',
      itemLevel: snapshot.itemLevelEquipped || 0,
      mythicScore: snapshot.mythicScore || 0,
      tankScore: snapshot.tankScore || 0,
      healerScore: snapshot.healerScore || 0,
      dpsScore: snapshot.dpsScore || 0,
      raidProgression: snapshot.raidProgression || '',
      raiderioUrl: snapshot.profileUrl,
      syncStatus: 'synced',
      lastSyncedAt: new Date(),
    },
  });

  return 'synced';
}
