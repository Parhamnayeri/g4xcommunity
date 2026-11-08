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

export async function addWowCharacter(characterData: {
  name: string;
  realm: string;
  region: string;
  class: string;
  spec?: string;
  role?: string;
}): Promise<any> {
  return apiRequest('/characters/add', {
    method: 'POST',
    body: JSON.stringify(characterData),
  });
}

export async function setMainCharacter(characterId: number): Promise<any> {
  return apiRequest('/characters/set-main', {
    method: 'POST',
    body: JSON.stringify({ characterId }),
  });
}

export async function removeCharacter(characterId: number): Promise<any> {
  return apiRequest('/characters/remove', {
    method: 'POST',
    body: JSON.stringify({ characterId }),
  });
}
