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

export async function submitRoleApplication(data: {
  category: 'booster' | 'pilot' | 'advertiser' | 'exchanger';
  gameSlug?: string;
  experience?: string;
  raiderioUrl?: string;
  vpnAvailability?: boolean;
  notes?: string;
  introduction?: string;
}): Promise<{ success: boolean; application: any }> {
  return apiRequest('/api/applications', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export interface UserKycStatusResponse {
  success: boolean;
  isVerified: boolean;
  status: 'verified' | 'pending' | 'rejected' | 'none';
  verifiedAt: string | null;
  pilotVerification?: {
    id: number;
    status: string;
    gameSlug: string;
    submittedAt: string;
    reviewedAt?: string | null;
    reviewNote?: string | null;
  } | null;
  latestApplication?: {
    id: number;
    category: string;
    status: string;
    identityStatus: string;
    submittedAt: string;
    reviewedAt?: string | null;
    reviewNotes?: string | null;
  } | null;
  documents?: {
    identity?: string | null;
    passport?: string | null;
    selfie?: string | null;
  };
  profileData?: {
    legalName?: string;
    country?: string;
    idNumber?: string;
    phoneNumber?: string;
    vpnConfirmed?: boolean;
    adminNotes?: string;
  };
  message?: string;
}

export interface UserKycSubmitRequest {
  legalName: string;
  country: string;
  idType?: string;
  idNumber: string;
  phoneNumber?: string;
  vpnConfirmed?: boolean;
  notes?: string;
  identityDocData?: string;
  identityDocName?: string;
  selfieDocData?: string;
  selfieDocName?: string;
}

export async function fetchMyKyc(): Promise<UserKycStatusResponse> {
  return apiRequest<UserKycStatusResponse>('/api/profile/kyc');
}

export async function submitMyKyc(data: UserKycSubmitRequest): Promise<{ success: boolean; result?: any; isVerified?: boolean; message?: string }> {
  return apiRequest<{ success: boolean; result?: any; isVerified?: boolean; message?: string }>('/api/profile/kyc', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
