import React from 'react';
import { Link } from 'react-router-dom';

export interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ size = 'md', showSubtitle = true }) => {
  const iconSize = size === 'sm' ? 26 : size === 'lg' ? 44 : 34;
  const textSize = size === 'sm' ? '1.1rem' : size === 'lg' ? '1.75rem' : '1.35rem';

  return (
    <Link
      to="/"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.65rem',
        textDecoration: 'none',
      }}
      aria-label="G4X Community Home"
    >
      {/* Brand Icon SVG */}
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          filter: 'drop-shadow(0 0 10px rgba(124, 58, 237, 0.5))',
          flexShrink: 0,
        }}
      >
        <rect width="40" height="40" rx="10" fill="#181524" stroke="#2D2645" strokeWidth="1.5" />
        <path
          d="M12 28L18 12H23L17 28H12Z"
          fill="#7C3AED"
        />
        <path
          d="M20 28L28 12H23L15 28H20Z"
          fill="#CCFF00"
          style={{ filter: 'drop-shadow(0 0 6px rgba(204, 255, 0, 0.8))' }}
        />
        <circle cx="28" cy="25" r="3" fill="#CCFF00" />
      </svg>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: textSize,
            fontWeight: 800,
            letterSpacing: '0.02em',
            color: 'var(--text-primary)',
            lineHeight: 1.1,
          }}
        >
          G4X <span style={{ color: 'var(--accent-lime)' }}>COMMUNITY</span>
        </div>
        {showSubtitle && (
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: 'var(--text-muted)',
              marginTop: '0.1rem',
            }}
          >
            Gaming Marketplace
          </span>
        )}
      </div>
    </Link>
  );
};
