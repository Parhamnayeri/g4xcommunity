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
  OrderDiagnosticsData,
} from '../types/operations';

/**
 * Universal pagination normalizer
 * Defensively extracts pagination metadata regardless of whether the API
 * returns flat fields (page, limit, total, totalPages) or a nested pagination object.
 */
export function normalizePagination(raw: any, defaultLimit: number = 10): PaginationMeta {
  if (!raw || typeof raw !== 'object') {
    return { page: 1, limit: defaultLimit, total: 0, totalPages: 1 };
  }
  if (raw.pagination && typeof raw.pagination === 'object') {
    const p = raw.pagination;
    const total = Number(p.total ?? p.totalCount ?? 0) || 0;
    const limit = Number(p.limit) || defaultLimit;
    const page = Number(p.page) || 1;
    const totalPages = Number(p.totalPages) || (total > 0 ? Math.ceil(total / limit) : 1);
    return { page, limit, total, totalPages: Math.max(1, totalPages) };
  }
  const total = Number(raw.total ?? raw.totalCount ?? 0) || 0;
  const limit = Number(raw.limit) || defaultLimit;
  const page = Number(raw.page) || 1;
  const totalPages = Number(raw.totalPages) || (total > 0 ? Math.ceil(total / limit) : 1);
  return { page, limit, total, totalPages: Math.max(1, totalPages) };
}

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

  const res = await apiRequest<any>(`/api/staff/pending-proofs?${query.toString()}`);
  const rawProofs = Array.isArray(res?.proofs) ? res.proofs : [];
  const proofs: PendingProofItem[] = rawProofs.map((p: any) => ({
    ...p,
    game: p.game || p.gameSlug || 'WoW',
    service: p.service || 'Boost Run',
    createdAt: p.createdAt || p.submittedAt || new Date().toISOString(),
    submittedBy: {
      id: p.submittedBy?.id || p.submittedBy?.discordId || '',
      discordId: p.submittedBy?.discordId || p.submittedBy?.id || '',
      username: p.submittedBy?.username || 'Unknown',
      displayName: p.submittedBy?.displayName || null,
    },
  }));

  return {
    proofs,
    pagination: normalizePagination(res, params?.limit || 15),
  };
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

  const res = await apiRequest<any>(`/api/staff/disputes?${query.toString()}`);
  const rawDisputes = Array.isArray(res?.disputes) ? res.disputes : [];
  const disputes: DisputeItem[] = rawDisputes.map((d: any) => ({
    ...d,
    evidenceUrls: Array.isArray(d.evidenceUrls) ? d.evidenceUrls : [],
    createdAt: d.createdAt || new Date().toISOString(),
    openedBy: {
      id: d.openedBy?.id || d.openedBy?.discordId || '',
      discordId: d.openedBy?.discordId || d.openedBy?.id || '',
      username: d.openedBy?.username || 'Unknown',
      displayName: d.openedBy?.displayName || null,
    },
  }));

  return {
    disputes,
    pagination: normalizePagination(res, params?.limit || 10),
  };
}

// ==========================================
// Management Operations APIs
// ==========================================

export async function fetchManagementOverview(): Promise<ManagementOverviewResponse> {
  return apiRequest<ManagementOverviewResponse>('/api/management/overview');
}

export async function fetchManagementOrders(params?: {
  tab?: 'g4x' | 'advertiser';
  source?: 'advertiser' | 'external_g4x';
  status?: string;
  paymentStatus?: string;
  gameSlug?: string;
  sourceWebsite?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}): Promise<{
  orders: OrderItem[];
  pagination: PaginationMeta;
  counts?: { g4x: number; advertiser: number; needsReview: number };
  tab?: string;
}> {
  const query = new URLSearchParams();
  if (params?.tab) query.set('tab', params.tab);
  if (params?.source) query.set('source', params.source);
  if (params?.status) query.set('status', params.status);
  if (params?.paymentStatus) query.set('paymentStatus', params.paymentStatus);
  if (params?.gameSlug) query.set('gameSlug', params.gameSlug);
  if (params?.sourceWebsite) query.set('source', params.sourceWebsite);
  if (params?.search) query.set('search', params.search);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  const res = await apiRequest<any>(`/api/management/orders?${query.toString()}`);
  return {
    orders: Array.isArray(res?.orders) ? res.orders : [],
    pagination: normalizePagination(res, params?.limit || 15),
    counts: res?.counts,
    tab: res?.tab,
  };
}

export async function fetchOrderDiagnostics(
  orderId: number
): Promise<{ success: boolean; order: OrderDiagnosticsData }> {
  return apiRequest(`/api/management/orders/${orderId}`);
}

export async function fetchOrderAuditHistory(
  orderId: number
): Promise<{ success: boolean; auditLogs: any[] }> {
  return apiRequest(`/api/admin/orders/${orderId}/audit-history`);
}

export async function cancelOrder(
  orderId: number,
  reason: string
): Promise<{ success: boolean; message?: string }> {
  return apiRequest(`/api/orders/${orderId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function payOrderFromWallet(
  orderId: number
): Promise<{ success: boolean; message?: string }> {
  return apiRequest(`/api/orders/${orderId}/pay-from-wallet`, {
    method: 'POST',
  });
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

  const res = await apiRequest<any>(`/api/management/applications?${query.toString()}`);
  return {
    applications: Array.isArray(res?.applications) ? res.applications : [],
    pagination: normalizePagination(res, params?.limit || 15),
  };
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

  const res = await apiRequest<any>(`/api/management/disputes?${query.toString()}`);
  const rawDisputes = Array.isArray(res?.disputes) ? res.disputes : [];
  const disputes: DisputeItem[] = rawDisputes.map((d: any) => ({
    ...d,
    evidenceUrls: Array.isArray(d.evidenceUrls) ? d.evidenceUrls : [],
    createdAt: d.createdAt || new Date().toISOString(),
    openedBy: {
      id: d.openedBy?.id || d.openedBy?.discordId || '',
      discordId: d.openedBy?.discordId || d.openedBy?.id || '',
      username: d.openedBy?.username || 'Unknown',
      displayName: d.openedBy?.displayName || null,
    },
  }));

  return {
    disputes,
    pagination: normalizePagination(res, params?.limit || 15),
  };
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

  const res = await apiRequest<any>(`/api/management/kyc/applications?${query.toString()}`);
  return {
    applications: Array.isArray(res?.applications) ? res.applications : [],
    pagination: normalizePagination(res, params?.limit || 15),
  };
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

export async function assignOrderRoster(orderId: number, candidates: Array<{ claimId: number; assignedRole: string }>): Promise<{ success: boolean; message: string }> {
  return apiRequest(`/api/management/orders/${orderId}/assign`, { method: 'POST', body: JSON.stringify({ candidates }) });
}

export async function verifyOrderPayment(orderId: number, receiptRef: string): Promise<{ success: boolean; message: string }> {
  return apiRequest(`/api/orders/${orderId}/verify-payment`, { method: 'POST', body: JSON.stringify({ receiptRef }) });
}

export async function refreshOrderDiscord(orderId: number): Promise<{ success: boolean; message: string }> {
  return apiRequest(`/api/management/orders/${orderId}/refresh-discord`, { method: 'POST' });
}

export async function updateOrderOperational(
  orderId: number,
  data: { notes?: string; externalOrderId?: string; reason: string }
): Promise<{ success: boolean; order: any }> {
  return apiRequest(`/api/management/orders/${orderId}/operational`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
