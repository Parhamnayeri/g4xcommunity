import React from 'react';
import { Button } from './Button';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title = 'No records found',
  message = 'There is currently no data to display for this view or filter criteria.',
  actionLabel,
  onAction,
  className = '',
}) => {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '3.5rem 1.5rem',
        textAlign: 'center',
        color: 'var(--text-muted)',
      }}
    >
      <div
        style={{
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          backgroundColor: 'var(--bg-surface-raised)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.5rem',
          marginBottom: '1rem',
          color: 'var(--text-dim)',
        }}
      >
        {icon || '∅'}
      </div>
      <h4
        style={{
          fontSize: 'var(--font-size-base)',
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: '0.4rem',
        }}
      >
        {title}
      </h4>
      <p
        style={{
          fontSize: 'var(--font-size-sm)',
          maxWidth: '420px',
          marginBottom: actionLabel && onAction ? '1.25rem' : 0,
        }}
      >
        {message}
      </p>
      {actionLabel && onAction && (
        <Button variant="purple" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
