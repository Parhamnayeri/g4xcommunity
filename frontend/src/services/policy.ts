import { apiRequest } from './api';
import {
  PublicPolicyResponse,
  PolicyOverviewResponse,
  PolicyVersionItem,
  PolicyVersion,
} from '../types/policy';

/**
 * Fetch the public published rules and policies document.
 */
export async function fetchPublicPolicy(): Promise<PublicPolicyResponse> {
  return await apiRequest<PublicPolicyResponse>('/api/public/rules');
}

/**
 * Fetch the admin policy overview (document, draft, published, discrepancies).
 */
export async function fetchAdminPolicyOverview(): Promise<PolicyOverviewResponse> {
  return await apiRequest<PolicyOverviewResponse>('/api/admin/policy');
}

/**
 * Save draft policy changes.
 */
export async function saveDraftPolicyApi(payload: {
  versionId: number;
  title: string;
  effectiveDate?: string | null;
  changelog?: string;
  sections: any[];
}): Promise<{ success: boolean; draftVersion: PolicyVersion; message: string }> {
  return await apiRequest('/api/admin/policy/draft', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/**
 * Publish a draft policy version.
 */
export async function publishPolicyVersionApi(payload: {
  versionId: number;
  changelog?: string;
  acknowledgedDiscrepancies: string[];
}): Promise<{ success: boolean; publishedVersion: PolicyVersion; message: string }> {
  return await apiRequest('/api/admin/policy/publish', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Restore an older version as a new draft.
 */
export async function restorePolicyVersionApi(payload: {
  sourceVersionId: number;
}): Promise<{ success: boolean; newDraftVersion: PolicyVersion; message: string }> {
  return await apiRequest('/api/admin/policy/restore', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Fetch historical version list.
 */
export async function fetchPolicyVersions(): Promise<{ success: boolean; versions: PolicyVersionItem[] }> {
  return await apiRequest('/api/admin/policy/versions');
}

/**
 * Retry Discord sync for published version.
 */
export async function retryDiscordSyncApi(payload: {
  versionId: number;
}): Promise<{ success: boolean; syncResult: any }> {
  return await apiRequest('/api/admin/policy/sync-discord', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
