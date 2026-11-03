import { apiRequest } from './api';
import {
  StaffOverviewResponse,
  PendingProofItem,
  DisputeItem,
  ManagementOverviewResponse,
  OrderItem,
  RegistrationApplicationItem,
  KycApplicationItem,
  KycDetailResponse,
  PaginationMeta,
} from '../types/operations';

// ==========================================
// Staff Operations APIs
// ==========================================

export async function fetchStaffOverview(): Promise<StaffOverviewResponse> {
  return apiRequest<StaffOverviewResponse>('/api/staff/overview');
}

export async function fetchPendingProofs(params?: {
  page?: number;
  limit?: number;
  status?: string;
  game?: string;
}): Promise<{ proofs: PendingProofItem[]; pagination: PaginationMeta }> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.status) query.set('status', params.status);
  if (params?.game) query.set('game', params.game);
  return apiRequest(`/api/staff/pending-proofs?${query.toString()}`);
}

export async function reviewProof(
  proofId: number,
  action: 'approved' | 'rejected',
  notes?: string
): Promise<{ success: boolean; proof: PendingProofItem }> {
  return apiRequest(`/api/staff/proofs/${proofId}/review`, {
    method: 'POST',
    body: JSON.stringify({ action, notes }),
  });
}

export async function reviewOrderStaff(
  orderId: number,
  notes?: string
): Promise<{ success: boolean; tracker: any }> {
  return apiRequest(`/api/staff/orders/${orderId}/review`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export async function fetchStaffDisputes(params?: {
  page?: number;
  limit?: number;
  status?: string;
}): Promise<{ disputes: DisputeItem[]; pagination: PaginationMeta }> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.status) query.set('status', params.status);
  return apiRequest(`/api/staff/disputes?${query.toString()}`);
}

// ==========================================
// Management Operations APIs
// ==========================================

export async function fetchManagementOverview(): Promise<ManagementOverviewResponse> {
  return apiRequest<ManagementOverviewResponse>('/api/management/overview');
}

export async function fetchManagementOrders(params?: {
  source?: 'advertiser' | 'external_g4x';
  status?: string;
  paymentStatus?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{ orders: OrderItem[]; pagination: PaginationMeta }> {
  const query = new URLSearchParams();
  if (params?.source) query.set('source', params.source);
  if (params?.status) query.set('status', params.status);
  if (params?.paymentStatus) query.set('paymentStatus', params.paymentStatus);
  if (params?.search) query.set('search', params.search);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  return apiRequest(`/api/management/orders?${query.toString()}`);
}

export async function approveOrderAdmin(
  orderId: number,
  notes?: string
): Promise<{ success: boolean; message: string }> {
  return apiRequest(`/api/management/orders/${orderId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export async function publishOrderCard(
  orderId: number
): Promise<{ success: boolean; message: string; channelId?: string; messageId?: string }> {
  return apiRequest(`/api/management/orders/${orderId}/publish`, {
    method: 'POST',
  });
}

export async function fetchRegistrationApplications(params?: {
  category?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{ applications: RegistrationApplicationItem[]; pagination: PaginationMeta }> {
  const query = new URLSearchParams();
  if (params?.category) query.set('category', params.category);
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  return apiRequest(`/api/management/applications?${query.toString()}`);
}

export async function reviewRegistrationApplication(
  applicationId: number,
  decision: 'approve' | 'reject' | 'request_info' | 'start_identity_verification' | 'verify_identity',
  reviewerNotes?: string
): Promise<{ success: boolean; application: RegistrationApplicationItem }> {
  return apiRequest(`/api/management/applications/${applicationId}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision, reviewerNotes }),
  });
}

export async function fetchManagementDisputes(params?: {
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{ disputes: DisputeItem[]; pagination: PaginationMeta }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  return apiRequest(`/api/management/disputes?${query.toString()}`);
}

export async function resolveManagementDispute(
  disputeId: number,
  decision: 'refund_customer' | 'release_booster' | 'split' | 'dismiss',
  notes: string
): Promise<{ success: boolean; dispute: DisputeItem }> {
  return apiRequest(`/api/management/disputes/${disputeId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ decision, notes }),
  });
}

// ==========================================
// KYC Management APIs
// ==========================================

export async function fetchKycApplications(params?: {
  category?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{ applications: KycApplicationItem[]; pagination: PaginationMeta }> {
  const query = new URLSearchParams();
  if (params?.category) query.set('category', params.category);
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  return apiRequest(`/api/management/kyc/applications?${query.toString()}`);
}

export async function fetchKycDetail(applicationId: number): Promise<KycDetailResponse> {
  return apiRequest<KycDetailResponse>(`/api/management/kyc/applications/${applicationId}`);
}

export async function submitKycDecision(
  applicationId: number,
  decision: 'verify_identity' | 'start_identity_verification' | 'request_info' | 'reject',
  reviewerNotes?: string
): Promise<{ success: boolean; application: any }> {
  return apiRequest(`/api/management/kyc/applications/${applicationId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, reviewerNotes }),
  });
}
