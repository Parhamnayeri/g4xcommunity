import React, { useState, useEffect, useMemo } from 'react';
import { EarningsOverviewChartData, EarningsChartPoint } from '../../types/dashboard';
import { fetchEarningsChart } from '../../services/dashboard';
import { Card } from '../ui/Card';

export interface EarningsOverviewChartProps {
  initialData?: EarningsOverviewChartData;
}

export const EarningsOverviewChart: React.FC<EarningsOverviewChartProps> = ({ initialData }) => {
  const [activeRange, setActiveRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [data, setData] = useState<EarningsOverviewChartData | null>(initialData || null);
  const [loading, setLoading] = useState<boolean>(false);
  const [hoveredPoint, setHoveredPoint] = useState<EarningsChartPoint | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Switch range handler
  const handleRangeChange = async (range: '7d' | '30d' | '90d' | 'all') => {
    if (range === activeRange && data) return;
    setActiveRange(range);
    setLoading(true);
    try {
      const res = await fetchEarningsChart(range);
      if (res && res.success) {
        setData(res);
      }
    } catch (err) {
      console.warn('[EarningsChart] Failed to load range data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialData && !data) {
      setData(initialData);
    }
  }, [initialData, data]);

  // Chart coordinate calculations
  const chartHeight = 180;
  const chartWidth = 720;
  const paddingLeft = 45;
  const paddingRight = 15;
  const paddingTop = 20;
  const paddingBottom = 30;

  const innerWidth = chartWidth - paddingLeft - paddingRight;
  const innerHeight = chartHeight - paddingTop - paddingBottom;

  const points = data?.points || [];

  // Determine max value for Y-axis scaling (minimum $100 baseline for aesthetic scaling)
  const maxValue = useMemo(() => {
    const rawMax = Math.max(...points.map((p) => p.amountCents / 100), 0);
    if (rawMax <= 0) return 100;
    if (rawMax <= 40) return 40;
    if (rawMax <= 80) return 80;
    if (rawMax <= 120) return 120;
    if (rawMax <= 160) return 160;
    return Math.ceil(rawMax / 50) * 50;
  }, [points]);

  // Y-axis tick steps (0, 25%, 50%, 75%, 100%)
  const yTicks = useMemo(() => {
    const steps = 4;
    const ticks: number[] = [];
    for (let i = 0; i <= steps; i++) {
      ticks.push(Math.round((maxValue / steps) * i));
    }
    return ticks;
  }, [maxValue]);

  // Bar dimensions
  const barCount = points.length || 1;
  const barSlotWidth = innerWidth / barCount;
  const barWidth = Math.max(4, Math.min(18, barSlotWidth * 0.65));

  // Determine previous period label
  const previousLabel = useMemo(() => {
    if (activeRange === '7d') return 'Previous week';
    if (activeRange === '30d') return 'Previous month';
    if (activeRange === '90d') return 'Previous 90 days';
    return 'Previous year';
  }, [activeRange]);

  const growthPercentage = data?.growthPercentage || '+0.0%';
  const isPositiveGrowth = !growthPercentage.startsWith('-');
  const growthColor = isPositiveGrowth ? '#34d399' : '#f87171';
  const growthBg = isPositiveGrowth ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';

  return (
    <Card
      style={{
        padding: '1.5rem',
        backgroundColor: 'rgba(20, 18, 30, 0.75)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* ─── Chart Top Header ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.25rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
              Earnings Overview
            </h3>
            <span
              style={{
                backgroundColor: growthBg,
                color: growthColor,
                border: `1px solid ${growthColor}33`,
                padding: '0.15rem 0.5rem',
                borderRadius: '9999px',
                fontSize: '0.72rem',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.2rem',
              }}
            >
              {isPositiveGrowth ? '↗' : '↘'} {growthPercentage}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <span
              style={{
                fontSize: '1.85rem',
                fontWeight: 900,
                color: '#ffffff',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}
            >
              ${data?.currentPeriodTotalUsd || '0.00'}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {data?.periodLabel || 'Net earnings this month'}
            </span>
          </div>
        </div>

        {/* Time Filter Buttons (7D, 30D, 90D, ALL) */}
        <div
          style={{
            display: 'inline-flex',
            backgroundColor: 'rgba(10, 10, 18, 0.8)',
            padding: '0.2rem',
            borderRadius: 'var(--radius-sm, 8px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            gap: '0.15rem',
          }}
        >
          {(['7d', '30d', '90d', 'all'] as const).map((r) => {
            const isActive = activeRange === r;
            const labels: Record<string, string> = {
              '7d': '7D',
              '30d': '30D',
              '90d': '90D',
              all: 'ALL',
            };
            return (
              <button
                key={r}
                type="button"
                onClick={() => handleRangeChange(r)}
                style={{
                  backgroundColor: isActive ? 'var(--accent-lime, #10b981)' : 'transparent',
                  color: isActive ? '#052e16' : 'var(--text-muted)',
                  border: 'none',
                  borderRadius: '5px',
                  padding: '0.3rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: isActive ? 800 : 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {labels[r]}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── SVG Interactive Bar Chart ─────────────────────────────────────── */}
      <div style={{ position: 'relative', width: '100%', minHeight: `${chartHeight}px` }}>
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(10, 10, 18, 0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              backdropFilter: 'blur(2px)',
              borderRadius: '8px',
            }}
          >
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading earnings trends...</span>
          </div>
        )}

        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id="barGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.25" />
            </linearGradient>
            <linearGradient id="barHoverGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#6ee7b7" stopOpacity="1" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0.6" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid lines & Y-axis labels */}
          {yTicks.map((val) => {
            const y = paddingTop + innerHeight - (val / maxValue) * innerHeight;
            return (
              <g key={`ytick-${val}`}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={chartWidth - paddingRight}
                  y2={y}
                  stroke="rgba(255, 255, 255, 0.06)"
                  strokeDasharray="3 3"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="rgba(255, 255, 255, 0.35)"
                  fontFamily="monospace"
                >
                  ${val}
                </text>
              </g>
            );
          })}

          {/* Render Bars */}
          {points.map((pt, index) => {
            const amt = pt.amountCents / 100;
            const barHeight = maxValue > 0 ? (amt / maxValue) * innerHeight : 0;
            const x = paddingLeft + index * barSlotWidth + (barSlotWidth - barWidth) / 2;
            const y = paddingTop + innerHeight - barHeight;
            const isHovered = hoveredPoint?.date === pt.date;

            // X-axis label display frequency
            const showLabel =
              activeRange === '7d' ||
              index === 0 ||
              index === points.length - 1 ||
              index % Math.ceil(points.length / 8) === 0;

            return (
              <g key={`bar-${pt.date}-${index}`}>
                {/* Background hit area for easier hover on touch/mouse */}
                <rect
                  x={paddingLeft + index * barSlotWidth}
                  y={paddingTop}
                  width={barSlotWidth}
                  height={innerHeight}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHoveredPoint(pt);
                    setTooltipPos({
                      x: rect.left + rect.width / 2,
                      y: rect.top,
                    });
                  }}
                  onMouseLeave={() => setHoveredPoint(null)}
                />

                {/* The actual colored bar (minimum 2px height if amt > 0) */}
                {amt > 0 && (
                  <rect
                    x={x}
                    y={Math.min(y, paddingTop + innerHeight - 2)}
                    width={barWidth}
                    height={Math.max(barHeight, 2)}
                    rx="3"
                    ry="3"
                    fill={isHovered ? 'url(#barHoverGradient)' : 'url(#barGradient)'}
                    style={{
                      transition: 'all 0.15s ease',
                      filter: isHovered ? 'drop-shadow(0 0 6px rgba(52, 211, 153, 0.8))' : 'none',
                    }}
                  />
                )}

                {/* X-axis label */}
                {showLabel && (
                  <text
                    x={x + barWidth / 2}
                    y={chartHeight - 8}
                    textAnchor="middle"
                    fontSize="9.5"
                    fill={isHovered ? '#34d399' : 'rgba(255, 255, 255, 0.4)'}
                    fontWeight={isHovered ? '700' : '500'}
                  >
                    {pt.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoveredPoint && tooltipPos && (
          <div
            style={{
              position: 'fixed',
              left: `${tooltipPos.x}px`,
              top: `${tooltipPos.y - 65}px`,
              transform: 'translateX(-50%)',
              backgroundColor: 'rgba(15, 17, 26, 0.95)',
              border: '1px solid rgba(52, 211, 153, 0.4)',
              borderRadius: '6px',
              padding: '0.4rem 0.65rem',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
              pointerEvents: 'none',
              zIndex: 100,
              fontSize: '0.75rem',
              whiteSpace: 'nowrap',
              textAlign: 'center',
            }}
          >
            <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginBottom: '0.15rem' }}>
              {hoveredPoint.date}
            </div>
            <div style={{ fontWeight: 800, color: 'var(--accent-lime, #10b981)', fontSize: '0.9rem' }}>
              ${hoveredPoint.amountUsd}
            </div>
            {hoveredPoint.orderCount > 0 && (
              <div style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.68rem' }}>
                {hoveredPoint.orderCount} order{hoveredPoint.orderCount > 1 ? 's' : ''}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Chart Bottom Comparison Footer ─────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginTop: '1rem',
          paddingTop: '0.75rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          fontSize: '0.8rem',
        }}
      >
        <div style={{ color: 'var(--text-muted)' }}>
          {previousLabel}:{' '}
          <strong style={{ color: '#ffffff', fontWeight: 700 }}>
            ${data?.previousPeriodTotalUsd || '0.00'}
          </strong>
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            color: growthColor,
            fontWeight: 700,
          }}
        >
          <span>{growthPercentage} Growth</span>
          <span style={{ fontSize: '0.9rem' }}>{isPositiveGrowth ? '↗' : '↘'}</span>
        </div>
      </div>
    </Card>
  );
};
export default EarningsOverviewChart;
