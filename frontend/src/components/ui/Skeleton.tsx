import React from 'react';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  circle?: boolean;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = '1rem',
  borderRadius,
  circle = false,
  className = '',
  style,
  ...props
}) => {
  const computedRadius = circle ? '50%' : (borderRadius ?? 'var(--radius-sm)');
  const computedWidth = circle ? (height ?? '40px') : width;

  return (
    <div
      className={`skeleton-box ${className}`.trim()}
      style={{
        width: typeof computedWidth === 'number' ? `${computedWidth}px` : computedWidth,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: computedRadius,
        ...style,
      }}
      aria-hidden="true"
      {...props}
    />
  );
};

export const SkeletonTable: React.FC<{ rows?: number; columns?: number }> = ({
  rows = 5,
  columns = 5,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', width: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '1rem' }}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={`header-${i}`} height="1.5rem" width="80%" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={`row-${r}`} style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '1rem' }}>
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={`cell-${r}-${c}`} height="2.2rem" />
          ))}
        </div>
      ))}
    </div>
  );
};
