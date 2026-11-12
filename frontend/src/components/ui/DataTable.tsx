import React from 'react';
import { Skeleton } from './Skeleton';
import { EmptyState } from './EmptyState';
import { Button } from './Button';

export interface Column<T> {
  id?: string;
  key: string;
  header: React.ReactNode;
  align?: 'left' | 'center' | 'right';
  numeric?: boolean;
  truncate?: boolean;
  width?: string | number;
  sortable?: boolean;
  render?: (item: T, index: number) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T, index: number) => string | number;
  isLoading?: boolean;
  error?: string | React.ReactNode;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: { label: string; onClick: () => void };
  onRowClick?: (item: T, index: number) => void;
  selectedRowKeys?: Array<string | number>;
  onSort?: (columnKey: string, direction: 'asc' | 'desc') => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  stackedOnMobile?: boolean;
  className?: string;
  skeletonRowCount?: number;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  error,
  onRetry,
  emptyTitle = 'No records found',
  emptyMessage = 'There is no data matching the current criteria.',
  emptyAction,
  onRowClick,
  selectedRowKeys = [],
  onSort,
  sortColumn,
  sortDirection = 'asc',
  stackedOnMobile = true,
  className = '',
  skeletonRowCount = 5,
}: DataTableProps<T>) {
  const handleHeaderClick = (col: Column<T>) => {
    if (!col.sortable || !onSort) return;
    const isCurrent = sortColumn === col.key;
    const nextDir = isCurrent && sortDirection === 'asc' ? 'desc' : 'asc';
    onSort(col.key, nextDir);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>, item: T, index: number) => {
    if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onRowClick(item, index);
    }
  };

  return (
    <div className={`data-table-wrapper ${className}`.trim()}>
      <div className="data-table-scroll">
        <table className={`data-table ${stackedOnMobile ? 'data-table-stacked' : ''}`.trim()} role="table">
          <thead>
            <tr>
              {columns.map((col) => {
                const isSorted = sortColumn === col.key;
                const alignClass =
                  col.align === 'right' || col.numeric
                    ? 'cell-numeric'
                    : col.align === 'center'
                    ? 'cell-center'
                    : '';

                return (
                  <th
                    key={col.id || col.key}
                    scope="col"
                    className={`${col.sortable ? 'sortable' : ''} ${alignClass}`.trim()}
                    style={{ width: col.width }}
                    onClick={() => handleHeaderClick(col)}
                    tabIndex={col.sortable ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (col.sortable && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        handleHeaderClick(col);
                      }
                    }}
                  >
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        justifyContent: col.align === 'right' || col.numeric ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <span>{col.header}</span>
                      {col.sortable && (
                        <span style={{ fontSize: '0.7rem', color: isSorted ? 'var(--accent-lime)' : 'var(--text-dim)' }}>
                          {isSorted ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {/* Error Row */}
            {error ? (
              <tr>
                <td colSpan={columns.length} style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                  <div style={{ color: 'var(--status-danger)', marginBottom: '0.75rem', fontWeight: 600 }}>
                    {typeof error === 'string' ? error : 'Failed to load records'}
                  </div>
                  {onRetry && (
                    <Button variant="purple" size="sm" onClick={onRetry}>
                      Retry
                    </Button>
                  )}
                </td>
              </tr>
            ) : isLoading ? (
              /* Loading Skeletons */
              Array.from({ length: skeletonRowCount }).map((_, rIdx) => (
                <tr key={`skel-row-${rIdx}`}>
                  {columns.map((col, cIdx) => (
                    <td key={`skel-cell-${rIdx}-${cIdx}`} className={col.numeric ? 'cell-numeric' : ''}>
                      <Skeleton height="1.4rem" width={cIdx === 0 ? '60%' : '80%'} />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              /* Empty Row */
              <tr>
                <td colSpan={columns.length} style={{ padding: 0 }}>
                  <EmptyState
                    title={emptyTitle}
                    message={emptyMessage}
                    actionLabel={emptyAction?.label}
                    onAction={emptyAction?.onClick}
                  />
                </td>
              </tr>
            ) : (
              /* Populated Rows */
              data.map((item, index) => {
                const rowKey = keyExtractor(item, index);
                const isSelected = selectedRowKeys.includes(rowKey);
                const isClickable = Boolean(onRowClick);

                return (
                  <tr
                    key={rowKey}
                    className={`${isClickable ? 'row-clickable' : ''} ${isSelected ? 'row-selected' : ''}`.trim()}
                    onClick={() => onRowClick && onRowClick(item, index)}
                    onKeyDown={(e) => handleKeyDown(e, item, index)}
                    tabIndex={isClickable ? 0 : undefined}
                    role={isClickable ? 'button' : undefined}
                  >
                    {columns.map((col) => {
                      const alignClass =
                        col.align === 'right' || col.numeric
                          ? 'cell-numeric'
                          : col.align === 'center'
                          ? 'cell-center'
                          : '';
                      const truncateClass = col.truncate ? 'cell-truncate' : '';

                      const rawVal = (item as any)[col.key];
                      const rendered = col.render ? col.render(item, index) : rawVal ?? '—';
                      const titleAttr = typeof rendered === 'string' ? rendered : undefined;

                      return (
                        <td
                          key={col.id || col.key}
                          className={`${alignClass} ${truncateClass}`.trim()}
                          data-label={typeof col.header === 'string' ? col.header : col.key}
                          title={col.truncate ? titleAttr : undefined}
                        >
                          {rendered}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
