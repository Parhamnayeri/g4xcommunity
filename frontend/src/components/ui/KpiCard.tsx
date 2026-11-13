import React from 'react';

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  subtext?: string;
  icon?: React.ReactNode;
  highlight?: 'lime' | 'purple' | 'none';
  className?: string;
  style?: React.CSSProperties;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  subtext,
  icon,
  highlight = 'none',
  className = '',
  style,
}) => {
  const highlightClass =
    highlight === 'lime' ? 'highlight-lime' : highlight === 'purple' ? 'highlight-purple' : '';

  return (
    <div className={`kpi-metric-card ${className}`.trim()} style={style}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="kpi-label">{label}</span>
        {icon && <span style={{ color: 'var(--text-muted)' }}>{icon}</span>}
      </div>
      <div className={`kpi-value ${highlightClass}`.trim()}>{value}</div>
      {subtext && <div className="kpi-subtext">{subtext}</div>}
    </div>
  );
};
