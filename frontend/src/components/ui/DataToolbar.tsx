import React from 'react';
import { Button } from './Button';

export interface FilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

export interface DataToolbarProps {
  title?: React.ReactNode;
  count?: number | null;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  activeChips?: FilterChip[];
  onClearAll?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  actions?: React.ReactNode;
  className?: string;
}

export const DataToolbar: React.FC<DataToolbarProps> = ({
  title,
  count,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search records...',
  filters,
  activeChips = [],
  onClearAll,
  onRefresh,
  isRefreshing = false,
  actions,
  className = '',
}) => {
  return (
    <div className={`data-toolbar ${className}`.trim()}>
      <div className="data-toolbar-left">
        {title && (
          <div className="data-toolbar-title">
            <span>{title}</span>
            {count !== undefined && count !== null && (
              <span className="data-toolbar-count">{count}</span>
            )}
          </div>
        )}

        {onSearchChange && (
          <div className="data-toolbar-search">
            <input
              type="text"
              className="form-input"
              placeholder={searchPlaceholder}
              value={searchValue ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              style={{ paddingLeft: '2rem' }}
            />
            <span
              style={{
                position: 'absolute',
                left: '0.75rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-dim)',
                fontSize: '0.85rem',
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
          </div>
        )}

        {filters}
      </div>

      <div className="data-toolbar-right">
        {onRefresh && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            isLoading={isRefreshing}
            title="Refresh list"
          >
            ↻ Refresh
          </Button>
        )}

        {actions}
      </div>

      {activeChips.length > 0 && (
        <div className="data-toolbar-chips">
          {activeChips.map((chip) => (
            <span key={chip.id} className="filter-chip">
              <span>{chip.label}</span>
              <button
                type="button"
                className="filter-chip-remove"
                onClick={chip.onRemove}
                title="Remove filter"
                aria-label={`Remove filter ${chip.label}`}
              >
                ×
              </button>
            </span>
          ))}

          {onClearAll && (
            <button
              type="button"
              onClick={onClearAll}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--primary-purple-light)',
                fontSize: 'var(--font-size-xs)',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: '2px 6px',
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
};
