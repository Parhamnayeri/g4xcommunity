import { apiRequest, clearCsrfTokenCache } from './api';
import { User } from '../types/auth';
import { Game, PublicConfig } from '../types/games';

export async function fetchCurrentUser(): Promise<User | null> {
  try {
    const user = await apiRequest<User>('/api/me');
    return user;
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) {
      return null;
    }
    console.warn('[Auth] Failed to retrieve session user:', err.message);
    return null;
  }
}

export async function logoutUser(): Promise<void> {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } catch {
    // Fallback: window navigation to GET logout
    window.location.href = '/auth/logout';
    return;
  }
  clearCsrfTokenCache();
  window.location.href = '/';
}

export async function fetchPublicData(): Promise<{ games: Game[]; config: PublicConfig }> {
  try {
    const res = await apiRequest<{ games: Game[]; config: PublicConfig }>('/api/public/games');
    return res;
  } catch (err) {
    console.warn('[PublicData] Failed to fetch public games catalog:', err);
    // Safe canonical fallback based on supported games
    return {
      games: [
        {
          slug: 'wow_midnight',
          displayName: 'World of Warcraft Midnight',
          serviceCategory: 'both',
          isActive: true,
          description: 'High-end Mythic+ Keystone pushing and Raid Clears with verified top-tier raiders.',
          services: [
            { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus', displayName: 'Mythic+ Dungeons', serviceMode: 'non_pilot', isActive: true },
            { gameSlug: 'wow_midnight', serviceKey: 'raid_boost', displayName: 'Raid Clears', serviceMode: 'non_pilot', isActive: true },
          ],
        },
        {
          slug: 'rainbow_six_siege',
          displayName: 'Rainbow Six Siege',
          serviceCategory: 'non_pilot',
          isActive: true,
          description: 'Ranked queue duo/squad matches with verified high-ELO tactical operators.',
          services: [
            { gameSlug: 'rainbow_six_siege', serviceKey: 'ranked_boost', displayName: 'Ranked Placement & Push', serviceMode: 'non_pilot', isActive: true },
          ],
        },
        {
          slug: 'escape_from_tarkov',
          displayName: 'Escape from Tarkov',
          serviceCategory: 'pilot',
          isActive: true,
          description: 'High-stake extraction survival, quest progression and key collection.',
          services: [
            { gameSlug: 'escape_from_tarkov', serviceKey: 'raid_pilot', displayName: 'Survival & Raid Pilot', serviceMode: 'pilot', isActive: true },
          ],
        },
        {
          slug: 'poe2',
          displayName: 'Path of Exile 2',
          serviceCategory: 'pilot',
          isActive: true,
          description: 'Campaign leveling, endgame boss encounters and build optimization.',
          services: [
            { gameSlug: 'poe2', serviceKey: 'boss_kills', displayName: 'Endgame Boss Services', serviceMode: 'pilot', isActive: true },
          ],
        },
      ],
      config: {
        bookingDestination: '/legacy',
      },
    };
  }
}
