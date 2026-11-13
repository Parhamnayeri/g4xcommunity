import React from 'react';
import { AdvertiserProfile, AdvertiserRankData, AdvertiserWallet } from '../../types/advertiser';

interface AdvertiserProfileHeaderProps {
  profile: AdvertiserProfile;
  rank: AdvertiserRankData;
  wallet: AdvertiserWallet;
  onCreateOrderClick: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const AdvertiserProfileHeader: React.FC<AdvertiserProfileHeaderProps> = ({
  profile,
  rank,
  wallet,
  onCreateOrderClick,
  onRefresh,
  isRefreshing,
}) => {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface, #181524)',
        borderRadius: '16px',
        border: '1px solid rgba(124, 58, 237, 0.25)',
        padding: '1.75rem 2rem',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1.5rem',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle Glow Overlay */}
      <div
        style={{
          position: 'absolute',
          top: '-40px',
          right: '-40px',
          width: '180px',
          height: '180px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124, 58, 237, 0.15) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Left: User Avatar & Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', zIndex: 1 }}>
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: 'rgba(124, 58, 237, 0.3)',
            border: '2px solid var(--primary-purple, #7c3aed)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.75rem',
            color: 'var(--accent-lime, #ccff00)',
            fontWeight: 800,
            textTransform: 'uppercase',
            boxShadow: '0 0 15px rgba(124, 58, 237, 0.3)',
          }}
        >
          {profile.displayName ? profile.displayName[0] : profile.username[0]}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 800,
                color: 'var(--text-primary, #f4f4f6)',
                margin: 0,
                letterSpacing: '-0.02em',
              }}
            >
              {profile.displayName || profile.username}
            </h1>
            <span
              style={{
                fontSize: '0.85rem',
                color: 'var(--text-muted, #9490a6)',
                fontFamily: 'monospace',
              }}
            >
              @{profile.username}
            </span>

            {profile.isApprovedAdvertiser ? (
              <span
                style={{
                  backgroundColor: 'rgba(204, 255, 0, 0.12)',
                  color: 'var(--accent-lime, #ccff00)',
                  border: '1px solid rgba(204, 255, 0, 0.3)',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                ✓ Approved Partner
              </span>
            ) : profile.applicationStatus === 'pending' ? (
              <span
                style={{
                  backgroundColor: 'rgba(234, 179, 8, 0.15)',
                  color: '#eab308',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                }}
              >
                ⏳ Application Pending
              </span>
            ) : (
              <span
                style={{
                  backgroundColor: 'rgba(148, 144, 166, 0.15)',
                  color: 'var(--text-muted, #9490a6)',
                  border: '1px solid rgba(148, 144, 166, 0.3)',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                }}
              >
                Member
              </span>
            )}

            {profile.isStaffOversight && (
              <span
                style={{
                  backgroundColor: 'rgba(124, 58, 237, 0.2)',
                  color: '#c4b5fd',
                  border: '1px solid rgba(124, 58, 237, 0.4)',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                }}
              >
                🛡️ Staff Oversight
              </span>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              marginTop: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            {/* Active Rank Badge */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                backgroundColor: 'rgba(124, 58, 237, 0.2)',
                border: '1px solid rgba(124, 58, 237, 0.4)',
                padding: '0.25rem 0.75rem',
                borderRadius: '8px',
                fontSize: '0.85rem',
                fontWeight: 700,
                color: '#ddd6fe',
              }}
            >
              <span style={{ color: 'var(--accent-lime, #ccff00)' }}>⭐</span>
              Rank: <strong style={{ color: '#fff' }}>{rank.rankLabel}</strong>
              <span style={{ opacity: 0.75 }}>({rank.commissionPercent} Platform Fee)</span>
            </div>

            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)' }}>
              Discord ID: <code style={{ color: '#e2e8f0' }}>{profile.discordId}</code>
            </span>
          </div>
        </div>
      </div>

      {/* Right: Wallet Chips & Create Order CTA */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
          zIndex: 1,
        }}
      >
        {/* Spendable Available Balance Chip */}
        <div
          style={{
            backgroundColor: 'rgba(13, 11, 18, 0.8)',
            border: '1px solid rgba(204, 255, 0, 0.25)',
            borderRadius: '12px',
            padding: '0.6rem 1.1rem',
            textAlign: 'right',
          }}
        >
          <div
            style={{
              fontSize: '0.7rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--text-muted, #9490a6)',
            }}
          >
            Spendable Wallet
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              color: 'var(--accent-lime, #ccff00)',
              fontFamily: 'monospace',
            }}
          >
            ${wallet.availableUsd}
          </div>
        </div>

        {/* Reserved in Escrow Chip */}
        <div
          style={{
            backgroundColor: 'rgba(13, 11, 18, 0.8)',
            border: '1px solid rgba(124, 58, 237, 0.2)',
            borderRadius: '12px',
            padding: '0.6rem 1.1rem',
            textAlign: 'right',
          }}
        >
          <div
            style={{
              fontSize: '0.7rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--text-muted, #9490a6)',
            }}
          >
            Reserved in Boosts
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: '#c4b5fd',
              fontFamily: 'monospace',
            }}
          >
            ${wallet.reservedUsd}
          </div>
        </div>

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh portal overview and order statuses"
          style={{
            backgroundColor: 'rgba(35, 30, 52, 0.8)',
            border: '1px solid rgba(124, 58, 237, 0.3)',
            borderRadius: '10px',
            padding: '0.75rem',
            color: 'var(--text-primary, #f4f4f6)',
            cursor: isRefreshing ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
          }}
        >
          <span style={{ display: 'inline-block', transform: isRefreshing ? 'rotate(360deg)' : 'none', transition: 'transform 0.8s ease' }}>
            🔄
          </span>
        </button>

        {/* New Order CTA */}
        <button
          onClick={onCreateOrderClick}
          style={{
            backgroundColor: 'var(--primary-purple, #7c3aed)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '10px',
            padding: '0.75rem 1.5rem',
            fontSize: '0.95rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            boxShadow: '0 4px 14px rgba(124, 58, 237, 0.4)',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--primary-purple-hover, #6d28d9)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--primary-purple, #7c3aed)')}
        >
          <span>➕</span>
          <span>Create New Order</span>
        </button>
      </div>
    </div>
  );
};
