import React from 'react';
import { normalizePagination, computePageRange, NormalizedPagination } from '../../utils/pagination';

export interface PaginationProps {
  // Supports either flat props, a NormalizedPagination object, or raw backend response
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  pagination?: unknown;
  onPageChange: (newPage: number) => void;
  onLimitChange?: (newLimit: number) => void;
  pageSizeOptions?: number[];
  showPageSizeSelector?: boolean;
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  page: propPage,
  limit: propLimit,
  total: propTotal,
  totalPages: propTotalPages,
  pagination: rawPagination,
  onPageChange,
  onLimitChange,
  pageSizeOptions = [10, 15, 25, 50],
  showPageSizeSelector = true,
  className = '',
}) => {
  // Normalize safely from either raw response or explicit props
  const normalized: NormalizedPagination = rawPagination
    ? normalizePagination(rawPagination, propLimit || 15)
    : normalizePagination({
        page: propPage,
        limit: propLimit,
        total: propTotal,
        totalPages: propTotalPages,
      }, propLimit || 15);

  const { page, limit, total, totalPages } = normalized;
  const { from, to } = computePageRange(page, limit, total);

  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <div className={`pagination-container ${className}`.trim()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span>
          Showing <strong style={{ color: 'var(--text-primary)' }}>{from}</strong> to{' '}
          <strong style={{ color: 'var(--text-primary)' }}>{to}</strong> of{' '}
          <strong style={{ color: 'var(--text-primary)' }}>{total}</strong> results
        </span>

        {showPageSizeSelector && onLimitChange && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--font-size-xs)' }}>
            <span>Per page:</span>
            <select
              className="pagination-size-select"
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
            >
              {pageSizeOptions.map((sz) => (
                <option key={sz} value={sz}>
                  {sz}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="pagination-controls">
        <button
          type="button"
          className="pagination-btn"
          disabled={!hasPrev}
          onClick={() => hasPrev && onPageChange(page - 1)}
          aria-label="Previous Page"
        >
          Previous
        </button>

        <span style={{ fontSize: 'var(--font-size-xs)', padding: '0 0.5rem', color: 'var(--text-primary)' }}>
          Page {page} of {Math.max(1, totalPages)}
        </span>

        <button
          type="button"
          className="pagination-btn"
          disabled={!hasNext}
          onClick={() => hasNext && onPageChange(page + 1)}
          aria-label="Next Page"
        >
          Next
        </button>
      </div>
    </div>
  );
};
