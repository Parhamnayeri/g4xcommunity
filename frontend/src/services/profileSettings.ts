/**
 * frontend/src/services/profileSettings.ts — API client for Profile, Settings & Booster Portal
 */

import { apiRequest } from './api';
import {
  UserProfileResponse,
  ProfileUpdateRequest,
  UserProfileData,
  UserSettingsResponse,
  UserSettingsUpdateRequest,
  UserSettings,
  BoosterPortalDataResponse,
  WowCharacter,
  RaiderIOPreviewData,
  CharacterDetailsResponse,
} from '../types/profileSettings';

export async function fetchUserProfile(): Promise<UserProfileResponse> {
  return apiRequest<UserProfileResponse>('/api/user/profile');
}

export async function updateUserProfile(
  data: ProfileUpdateRequest
): Promise<{ success: boolean; profile: UserProfileData }> {
  return apiRequest<{ success: boolean; profile: UserProfileData }>('/api/user/profile', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function fetchUserSettings(): Promise<UserSettingsResponse> {
  return apiRequest<UserSettingsResponse>('/api/user/settings');
}

export async function updateUserSettings(
  data: UserSettingsUpdateRequest
): Promise<{ success: boolean; settings: UserSettings }> {
  return apiRequest<{ success: boolean; settings: UserSettings }>('/api/user/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function fetchBoosterPortalData(): Promise<BoosterPortalDataResponse> {
  return apiRequest<BoosterPortalDataResponse>('/api/booster/portal-data');
}

export async function fetchUserCharacters(includeInactive = false): Promise<WowCharacter[]> {
  const query = includeInactive ? '?includeInactive=true' : '';
  return apiRequest<WowCharacter[]>(`/characters${query}`);
}

export async function fetchCharacterDetails(characterId: number | string): Promise<CharacterDetailsResponse> {
  return apiRequest<CharacterDetailsResponse>(`/characters/${characterId}`);
}

export async function previewRaiderIOCharacter(params: {
  url?: string;
  region?: string;
  realm?: string;
  characterName?: string;
}): Promise<{
  success: boolean;
  preview: RaiderIOPreviewData;
  attribution: { notice: string; poweredBy: string; apiTermsUrl: string; commercialNotice: string };
}> {
  return apiRequest('/characters/preview', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function addWowCharacter(characterData: {
  characterName?: string;
  name?: string;
  realm?: string;
  region?: string;
  raiderioUrl?: string;
  class?: string;
  spec?: string;
  role?: string;
}): Promise<{ success: boolean; character: WowCharacter }> {
  const payload = {
    characterName: characterData.characterName || characterData.name || '',
    realm: characterData.realm || '',
    region: characterData.region || 'eu',
    raiderioUrl: characterData.raiderioUrl,
  };
  return apiRequest<{ success: boolean; character: WowCharacter }>('/characters/add', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function setMainCharacter(characterId: number): Promise<{ success: boolean; character: WowCharacter }> {
  return apiRequest<{ success: boolean; character: WowCharacter }>('/characters/set-main', {
    method: 'POST',
    body: JSON.stringify({ characterId }),
  });
}

export async function syncWowCharacter(characterId: number): Promise<{
  success: boolean;
  result: any;
  character: WowCharacter;
}> {
  return apiRequest<{
    success: boolean;
    result: any;
    character: WowCharacter;
  }>('/characters/sync-request', {
    method: 'POST',
    body: JSON.stringify({ characterId }),
  });
}

export async function removeCharacter(characterId: number): Promise<{ success: boolean; character: WowCharacter }> {
  return apiRequest<{ success: boolean; character: WowCharacter }>('/characters/remove', {
    method: 'POST',
    body: JSON.stringify({ characterId }),
  });
}

export async function reactivateCharacter(characterId: number): Promise<{ success: boolean; character: WowCharacter }> {
  return apiRequest<{ success: boolean; character: WowCharacter }>('/characters/reactivate', {
    method: 'POST',
    body: JSON.stringify({ characterId }),
  });
}
