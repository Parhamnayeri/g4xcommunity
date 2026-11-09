/**
 * raiderio.ts — Authoritative Raider.IO API Integration & Character Synchronization Service
 * 
 * API Documentation: https://raider.io/api
 * Profile Endpoint: GET https://raider.io/api/v1/characters/profile
 * 
 * Strict Reliability & Security Invariants:
 *  - Server-side requests only with strict HTTPS and trusted-host enforcement.
 *  - Anti-SSRF: rejects non-raider.io domains, ports, private IPs, and control characters.
 *  - 5-second request timeout with bounded in-memory cache (15-min TTL, max 500 entries).
 *  - Rate-limit handling: respects HTTP 429 and Retry-After headers with global backoff.
 *  - Safe cooldowns: 60-second cooldown on manual character refreshes to prevent abuse.
 *  - Data preservation: never overwrites or wipes valid historical scores on temporary API failure or downtime.
 *  - Current-season rollover: queries mythic_plus_scores_by_season:current, never presenting old scores as current.
 *  - Commercial-use compliance: exports mandatory Raider.IO attribution and terms notices.
 */

import axios, { AxiosError } from 'axios';
import prisma from '../database/db';

// ─── Types and Interfaces ───────────────────────────────────────────────────

export interface ParsedRaiderIOUrl {
  region: 'us' | 'eu' | 'kr' | 'tw' | 'cn';
  realm: string;
  characterName: string;
  canonicalUrl: string;
}

export interface RecentMythicRun {
  dungeon: string;
  shortName?: string;
  mythicLevel: number;
  completedAt: string;
  clearTimeMs?: number;
  parTimeMs?: number;
  numKeystoneUpgrades?: number;
  score?: number;
  url?: string;
}

export interface RaiderIOSnapshot {
  characterName: string;
  realm: string;
  region: string;
  characterClass?: string;
  activeSpec?: string;
  activeRole?: string;
  faction?: string;
  thumbnailUrl?: string | null;
  itemLevelEquipped?: number | null;
  itemLevelTotal?: number | null;
  mythicScore?: number | null;
  tankScore?: number | null;
  healerScore?: number | null;
  dpsScore?: number | null;
  currentSeason?: string | null;
  raidProgression?: string | null;
  recentRuns?: RecentMythicRun[];
  bestRuns?: RecentMythicRun[];
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
  raid_progression?: Record<
    string,
    {
      summary?: string;
      total_bosses?: number;
      normal_bosses_killed?: number;
      heroic_bosses_killed?: number;
      mythic_bosses_killed?: number;
    }
  >;
  mythic_plus_recent_runs?: Array<{
    dungeon?: string;
    short_name?: string;
    mythic_level?: number;
    completed_at?: string;
    clear_time_ms?: number;
    par_time_ms?: number;
    num_keystone_upgrades?: number;
    score?: number;
    url?: string;
  }>;
  mythic_plus_best_runs?: Array<{
    dungeon?: string;
    short_name?: string;
    mythic_level?: number;
    completed_at?: string;
    clear_time_ms?: number;
    par_time_ms?: number;
    num_keystone_upgrades?: number;
    score?: number;
    url?: string;
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

// ─── Attribution & Commercial Use Terms ──────────────────────────────────────

export const RAIDERIO_ATTRIBUTION = {
  text: 'Data provided by Raider.IO',
  url: 'https://raider.io',
  licenseNotice:
    'Raider.IO is a registered trademark. Commercial use of the Raider.IO API for paid boosting platforms requires an official commercial license or written authorization from Raider.IO.',
} as const;

/**
 * Commercial Licensing Safety Gate Indicator.
 * Raider.IO terms prohibit automated commercial use (such as monetized boosting platforms)
 * without an explicit commercial licensing agreement.
 * Returns true only when RAIDERIO_LIVE_SYNC_ENABLED is explicitly set to 'true'.
 */
export function isRaiderIOLiveSyncEnabled(): boolean {
  return process.env.RAIDERIO_LIVE_SYNC_ENABLED === 'true';
}

// ─── Cache & Cooldown Configurations ─────────────────────────────────────────

const RAIDERIO_API_BASE = 'https://raider.io/api/v1';
const ALLOWED_REGIONS = ['us', 'eu', 'kr', 'tw', 'cn'] as const;
const REQUEST_TIMEOUT_MS = 5_000; // 5 seconds strict timeout
const CACHE_TTL_MS = 15 * 60 * 1_000; // 15 minutes cache TTL
const MAX_CACHE_ENTRIES = 500;
const MANUAL_REFRESH_COOLDOWN_SEC = 60; // 60 seconds between manual refreshes

interface CacheEntry {
  snapshot: RaiderIOSnapshot;
  expiresAt: number;
}

const profileCache = new Map<string, CacheEntry>();
const refreshCooldowns = new Map<number, number>(); // characterId -> expiresAt timestamp
let globalRateLimitedUntil = 0; // timestamp when HTTP 429 backoff expires

/**
 * Clear in-memory cache (primarily for deterministic unit/integration testing)
 */
export function clearRaiderIOCache(): void {
  profileCache.clear();
  refreshCooldowns.clear();
  globalRateLimitedUntil = 0;
}

/**
 * Check if manual refresh is on cooldown for a character
 */
export function checkRefreshCooldown(characterId: number): { allowed: boolean; remainingSeconds: number } {
  const now = Date.now();
  const expiresAt = refreshCooldowns.get(characterId) || 0;
  if (expiresAt > now) {
    const remainingSeconds = Math.ceil((expiresAt - now) / 1000);
    return { allowed: false, remainingSeconds };
  }
  return { allowed: true, remainingSeconds: 0 };
}

/**
 * Set manual refresh cooldown for a character
 */
export function setRefreshCooldown(characterId: number, seconds: number = MANUAL_REFRESH_COOLDOWN_SEC): void {
  refreshCooldowns.set(characterId, Date.now() + seconds * 1000);
}

/**
 * Evict expired entries to prevent memory leaks
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

// ─── 1. SSRF & Security Validation for Raider.IO URLs ─────────────────────────

/**
 * Validates and safely parses a Raider.IO character profile URL.
 * Strictly prevents SSRF, private network requests, protocol tricks, and parameter pollution.
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

  // 1. Enforce HTTPS only
  if (parsedUrl.protocol !== 'https:') {
    return null;
  }

  // 2. Strict Hostname Whitelist
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname !== 'raider.io' && hostname !== 'www.raider.io') {
    return null;
  }

  // 3. Port check (must be empty or 443)
  if (parsedUrl.port && parsedUrl.port !== '443') {
    return null;
  }

  // 4. Validate Path: /characters/<region>/<realm>/<character_name>
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
    realm = decodeURIComponent(pathParts[2]).trim().toLowerCase().replace(/\s+/g, '-');
    characterName = decodeURIComponent(pathParts[3]).trim();
  } catch {
    return null;
  }

  // Security bounds: no control characters, newlines, HTML tags
  if (!realm || !characterName) return null;
  if (/[\r\n\t<>]/.test(realm) || /[\r\n\t<>]/.test(characterName)) return null;
  if (realm.length < 2 || realm.length > 50 || characterName.length < 2 || characterName.length > 30) {
    return null;
  }

  const canonicalUrl = `https://raider.io/characters/${rawRegion}/${encodeURIComponent(realm)}/${encodeURIComponent(characterName)}`;

  return {
    region: rawRegion as ParsedRaiderIOUrl['region'],
    realm,
    characterName,
    canonicalUrl,
  };
}

// ─── 2. Fetch Raider.IO Profile (with Rate-Limiting, Caching & Rollover Guard) ──

/**
 * Authoritatively retrieves character profile from Raider.IO.
 * Respects cache TTL, rate limits, current season rollover, and bounded errors.
 */
export async function fetchRaiderIOProfile(
  input: string | { region: string; realm: string; characterName: string },
  options: { bypassCache?: boolean } = {}
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
    region = input.region.trim().toLowerCase();
    realm = input.realm.trim().toLowerCase().replace(/\s+/g, '-');
    characterName = input.characterName.trim();
    profileUrl = `https://raider.io/characters/${region}/${encodeURIComponent(realm)}/${encodeURIComponent(characterName)}`;
  }

  const cacheKey = `${region}:${realm}:${characterName.toLowerCase()}`;
  const now = Date.now();
  const cached = profileCache.get(cacheKey);

  // Return cached result if valid and bypass not requested
  if (!options.bypassCache && cached && cached.expiresAt > now) {
    return cached.snapshot;
  }

  // ── Commercial Licensing Safety Gate ───────────────────────────────────────
  // Raider.IO API terms prohibit automated commercial / boosting use without a
  // formal commercial agreement. When RAIDERIO_LIVE_SYNC_ENABLED is false (default),
  // no outbound HTTP requests are dispatched and no scores are fabricated.
  if (!isRaiderIOLiveSyncEnabled()) {
    if (cached) {
      return { ...cached.snapshot, fetchStatus: 'stale' };
    }
    return {
      characterName,
      realm,
      region,
      profileUrl,
      fetchedAt: new Date().toISOString(),
      fetchStatus: 'api_error',
      errorDetails: 'COMMERCIAL_LICENSE_GATE_DISABLED: Raider.IO live synchronization is gated pending formal commercial licensing approval.',
    };
  }

  // Check global 429 rate limit backoff
  if (globalRateLimitedUntil > now) {
    const waitSec = Math.ceil((globalRateLimitedUntil - now) / 1000);
    // If we have stale cache, serve it
    if (cached) {
      return { ...cached.snapshot, fetchStatus: 'stale' };
    }
    return {
      characterName,
      realm,
      region,
      profileUrl,
      fetchedAt: new Date().toISOString(),
      fetchStatus: 'api_error',
      errorDetails: `RATE_LIMITED: Raider.IO API is currently rate limited (429). Retry in ${waitSec}s.`,
    };
  }

  try {
    const response = await axios.get<RaiderIOCharacter>(`${RAIDERIO_API_BASE}/characters/profile`, {
      params: {
        region,
        realm,
        name: characterName,
        fields: 'gear,mythic_plus_scores_by_season:current,raid_progression,mythic_plus_recent_runs,mythic_plus_best_runs',
      },
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'G4X-Community-Booster-Platform/2.0 (+https://g4x.online; contact@g4x.online)',
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

    // ─── Current Season Score Extraction ─────────────────────────────────────
    // Querying mythic_plus_scores_by_season:current ensures entry [0] is the current active season.
    const currentSeasonEntry = data.mythic_plus_scores_by_season?.[0];
    const scores = currentSeasonEntry?.scores;

    // Rollover Guard: if season has no scores recorded yet, return null (never old seasons)
    const mythicScore = typeof scores?.all === 'number' ? Math.round(scores.all) : null;
    const tankScore = typeof scores?.tank === 'number' ? Math.round(scores.tank) : null;
    const healerScore = typeof scores?.healer === 'number' ? Math.round(scores.healer) : null;
    const dpsScore = typeof scores?.dps === 'number' ? Math.round(scores.dps) : null;

    // ─── Raid Progression Summary ────────────────────────────────────────────
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

    // ─── Recent & Best Mythic+ Runs ──────────────────────────────────────────
    const recentRuns: RecentMythicRun[] = [];
    if (Array.isArray(data.mythic_plus_recent_runs)) {
      for (const run of data.mythic_plus_recent_runs.slice(0, 5)) {
        if (run && run.dungeon && typeof run.mythic_level === 'number') {
          recentRuns.push({
            dungeon: run.dungeon,
            shortName: run.short_name,
            mythicLevel: run.mythic_level,
            completedAt: run.completed_at || new Date().toISOString(),
            clearTimeMs: run.clear_time_ms,
            parTimeMs: run.par_time_ms,
            numKeystoneUpgrades: run.num_keystone_upgrades,
            score: run.score,
            url: run.url,
          });
        }
      }
    }

    const bestRuns: RecentMythicRun[] = [];
    if (Array.isArray(data.mythic_plus_best_runs)) {
      for (const run of data.mythic_plus_best_runs.slice(0, 5)) {
        if (run && run.dungeon && typeof run.mythic_level === 'number') {
          bestRuns.push({
            dungeon: run.dungeon,
            shortName: run.short_name,
            mythicLevel: run.mythic_level,
            completedAt: run.completed_at || new Date().toISOString(),
            clearTimeMs: run.clear_time_ms,
            parTimeMs: run.par_time_ms,
            numKeystoneUpgrades: run.num_keystone_upgrades,
            score: run.score,
            url: run.url,
          });
        }
      }
    }

    const snapshot: RaiderIOSnapshot = {
      characterName: data.name,
      realm: data.realm || realm,
      region: data.region || region,
      characterClass: data.class || undefined,
      activeSpec: data.active_spec_name || undefined,
      activeRole: data.active_spec_role || undefined,
      faction: data.faction || undefined,
      thumbnailUrl: data.thumbnail_url || null,
      itemLevelEquipped: data.gear?.item_level_equipped ?? null,
      itemLevelTotal: data.gear?.item_level_total ?? null,
      mythicScore,
      tankScore,
      healerScore,
      dpsScore,
      currentSeason: currentSeasonEntry?.season || null,
      raidProgression: raidProgressionSummary,
      recentRuns,
      bestRuns,
      profileUrl: data.profile_url || profileUrl,
      fetchedAt: new Date().toISOString(),
      fetchStatus: 'success',
    };

    // Store in bounded in-memory cache
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
      const retryHeader = axiosError.response?.headers?.['retry-after'];
      const retrySec = retryHeader ? Math.min(300, Math.max(10, parseInt(String(retryHeader), 10) || 60)) : 60;
      globalRateLimitedUntil = Date.now() + retrySec * 1000;
      console.warn(`[RaiderIO] Rate limited (429). Backing off for ${retrySec}s.`);

      if (cached) {
        return { ...cached.snapshot, fetchStatus: 'stale' };
      }

      return {
        characterName,
        realm,
        region,
        profileUrl,
        fetchedAt: new Date().toISOString(),
        fetchStatus: 'api_error',
        errorDetails: `Rate limited by Raider.IO API (HTTP 429). Retry in ${retrySec}s.`,
      };
    }

    console.warn(`[RaiderIO] API communication error for ${characterName}-${realm} (${region}):`, error?.message || error);

    // If cache is present even if expired, serve it with stale status on temporary network failures
    if (cached) {
      return { ...cached.snapshot, fetchStatus: 'stale', errorDetails: error?.message };
    }

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

/**
 * Preview Raider.IO character data before registering (stateless)
 */
export async function previewRaiderIOProfile(
  input: string | { url?: string; region?: string; realm?: string; characterName?: string }
): Promise<RaiderIOSnapshot> {
  if (typeof input === 'string') {
    return fetchRaiderIOProfile(input, { bypassCache: false });
  }
  if (input.url) {
    return fetchRaiderIOProfile(input.url, { bypassCache: false });
  }
  return fetchRaiderIOProfile(
    {
      region: input.region || 'eu',
      realm: input.realm || '',
      characterName: input.characterName || '',
    },
    { bypassCache: false }
  );
}

// ─── 3. Database Synchronization & Data Preservation ─────────────────────────

/**
 * Synchronizes character record with Raider.IO data.
 * CRITICAL: If Raider.IO is down or fails temporarily, preserves all previously valid data
 * and records the failure in syncStatus/syncError without wiping character attributes!
 */
export async function syncCharacter(characterId: number): Promise<'synced' | 'not_found' | 'failed'> {
  const character = await prisma.wowCharacter.findUnique({
    where: { id: characterId },
  });

  if (!character) {
    return 'failed';
  }

  // Enforce manual refresh cooldown
  const cooldown = checkRefreshCooldown(characterId);
  if (!cooldown.allowed) {
    console.info(`[RaiderIO] Cooldown active for character #${characterId} (${cooldown.remainingSeconds}s remaining).`);
    return character.syncStatus === 'synced' ? 'synced' : 'failed';
  }

  const snapshot = await fetchRaiderIOProfile(
    {
      characterName: character.characterName,
      realm: character.realm,
      region: character.region,
    },
    { bypassCache: true }
  );

  // Set cooldown on successful API hit or definitive 404
  setRefreshCooldown(characterId);

  if (snapshot.fetchStatus === 'not_found') {
    await prisma.wowCharacter.update({
      where: { id: characterId },
      data: {
        syncStatus: 'not_found',
        syncError: snapshot.errorDetails || 'Character not found on Raider.IO',
        lastSyncedAt: new Date(),
      },
    });
    return 'not_found';
  }

  if (snapshot.fetchStatus === 'api_error') {
    // PRESERVATION GUARD: Never overwrite valid scores, class, or itemLevel on temporary API failure!
    await prisma.wowCharacter.update({
      where: { id: characterId },
      data: {
        syncStatus: 'failed',
        syncError: snapshot.errorDetails || 'Temporary Raider.IO API communication failure',
        // Do NOT update lastSyncedAt so stale timestamp is transparent
      },
    });
    return 'failed';
  }

  // Successful sync: update all attributes and clear errors
  const recentRunsJson =
    snapshot.recentRuns && snapshot.recentRuns.length > 0 ? JSON.stringify(snapshot.recentRuns) : null;

  await prisma.wowCharacter.update({
    where: { id: characterId },
    data: {
      characterClass: snapshot.characterClass || character.characterClass || 'Unknown',
      activeSpec: snapshot.activeSpec || character.activeSpec || 'Unknown',
      activeRole: snapshot.activeRole || character.activeRole || null,
      faction: snapshot.faction || character.faction || null,
      thumbnailUrl: snapshot.thumbnailUrl || character.thumbnailUrl || null,
      itemLevel: snapshot.itemLevelEquipped ?? character.itemLevel ?? 0,
      mythicScore: snapshot.mythicScore !== null ? snapshot.mythicScore : character.mythicScore,
      tankScore: snapshot.tankScore !== null ? snapshot.tankScore : character.tankScore,
      healerScore: snapshot.healerScore !== null ? snapshot.healerScore : character.healerScore,
      dpsScore: snapshot.dpsScore !== null ? snapshot.dpsScore : character.dpsScore,
      raidProgression: snapshot.raidProgression || character.raidProgression || '',
      recentRunsJson: recentRunsJson || character.recentRunsJson || null,
      raiderioUrl: snapshot.profileUrl,
      syncStatus: 'synced',
      syncError: null,
      lastSyncedAt: new Date(),
    },
  });

  return 'synced';
}

// ─── 4. Legacy Compatibility Helper ──────────────────────────────────────────

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
    faction: snapshot.faction,
    thumbnail_url: snapshot.thumbnailUrl || undefined,
    profile_url: snapshot.profileUrl,
    gear: {
      item_level_equipped: snapshot.itemLevelEquipped ?? 0,
      item_level_total: snapshot.itemLevelTotal ?? 0,
    },
    mythic_plus_scores_by_season:
      snapshot.mythicScore !== null
        ? [
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
          ]
        : undefined,
  } as RaiderIOCharacter;
}
