/**
 * G4X Pagination Contract Normalization Helper
 *
 * CRITICAL REGRESSION DEFENSE:
 * Some G4X backend endpoints return a flat pagination structure:
 *   { page, limit, total, totalPages, data: [...] }
 * While others return a nested structure:
 *   { pagination: { page, limit, total, totalPages }, data: [...] }
 *
 * Missing or malformed responses must NEVER assign undefined into state,
 * which previously caused a production black screen.
 */

export interface NormalizedPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function normalizePagination(raw: unknown, defaultLimit = 15): NormalizedPagination {
  if (!raw || typeof raw !== 'object') {
    return {
      page: 1,
      limit: defaultLimit,
      total: 0,
      totalPages: 1,
    };
  }

  const obj = raw as Record<string, unknown>;
  const nested = (obj.pagination && typeof obj.pagination === 'object')
    ? (obj.pagination as Record<string, unknown>)
    : null;

  const source = nested ?? obj;

  const rawPage = Number(source.page);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const rawLimit = Number(source.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.floor(rawLimit) : defaultLimit;

  const rawTotal = Number(source.total);
  const total = Number.isFinite(rawTotal) && rawTotal >= 0 ? Math.floor(rawTotal) : 0;

  const calculatedTotalPages = Math.max(1, Math.ceil(total / limit));
  const rawTotalPages = Number(source.totalPages);
  const totalPages = Number.isFinite(rawTotalPages) && rawTotalPages >= 1
    ? Math.floor(rawTotalPages)
    : calculatedTotalPages;

  return {
    page,
    limit,
    total,
    totalPages,
  };
}

export function computePageRange(page: number, limit: number, total: number): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return { from, to };
}
