import React, { useState } from 'react';
import { UserProfileData } from '../../types/dashboard';
import { Card } from '../ui/Card';
import { Link } from 'react-router-dom';

export interface UserProfileCardProps {
  profile: UserProfileData;
}

export const UserProfileCard: React.FC<UserProfileCardProps> = ({ profile }) => {
  const [copied, setCopied] = useState(false);

  const handleCopyId = () => {
    navigator.clipboard.writeText(profile.discordId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusLabel =
    profile.registrationStatus === 'approved'
      ? 'Approved Member'
      : profile.registrationStatus === 'under_review'
      ? 'Under Review'
      : profile.registrationStatus === 'info_requested'
      ? 'Action Required'
      : profile.registrationStatus === 'pending'
      ? 'Application Pending'
      : 'Active Member';

  const statusBadgeClass =
    profile.registrationStatus === 'approved'
      ? 'badge-lime'
      : profile.registrationStatus === 'under_review'
      ? 'badge-purple'
      : 'badge-muted';

  return (
    <Card highlight="none" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Profile Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
        {/* Avatar */}
        <div
          style={{
            position: 'relative',
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: 'var(--primary-purple)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.6rem',
            fontWeight: 800,
            border: '2px solid rgba(124, 58, 237, 0.6)',
            boxShadow: '0 0 15px var(--purple-glow)',
            flexShrink: 0,
          }}
        >
          {(profile.displayName || profile.username).substring(0, 2).toUpperCase()}
          {/* Active online indicator */}
          <div
            style={{
              position: 'absolute',
              bottom: '2px',
              right: '2px',
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              backgroundColor: 'var(--accent-lime)',
              border: '2px solid var(--bg-surface)',
              boxShadow: '0 0 6px var(--accent-lime)',
            }}
            title="Authenticated Session"
          />
        </div>

        {/* User Titles */}
        <div style={{ overflow: 'hidden' }}>
          <h2
            style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              color: '#ffffff',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.2,
            }}
          >
            {profile.displayName || profile.username}
          </h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
            @{profile.username}
          </div>
          <span className={`badge ${statusBadgeClass}`} style={{ fontSize: '0.7rem' }}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Discord User ID */}
      <div
        style={{
          backgroundColor: 'rgba(13, 11, 18, 0.7)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.6rem 0.85rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.25rem',
          fontSize: '0.82rem',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Discord ID
          </span>
          <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)', fontWeight: 600 }}>
            {profile.discordId}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopyId}
          style={{
            background: 'none',
            border: 'none',
            color: copied ? 'var(--accent-lime)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '0.78rem',
            fontWeight: 600,
            padding: '0.3rem 0.5rem',
            borderRadius: 'var(--radius-xs)',
            transition: 'color var(--transition-fast)',
          }}
          title="Copy Discord ID"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      {/* Assigned Roles */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
            marginBottom: '0.5rem',
          }}
        >
          Platform Roles &amp; Tier
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {profile.roles.length > 0 ? (
            profile.roles.map((r) => {
              const isLead = ['owner', 'admin', 'manager'].includes(r);
              const isPartner = ['advertiser', 'booster', 'exchanger'].includes(r);
              return (
                <span
                  key={r}
                  className={`badge ${isLead ? 'badge-purple' : isPartner ? 'badge-lime' : 'badge-muted'}`}
                  style={{ textTransform: 'uppercase', fontSize: '0.72rem' }}
                >
                  {r}
                </span>
              );
            })
          ) : (
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Standard Member</span>
          )}

          {profile.advertiserRank && (
            <span className="badge badge-lime" style={{ fontSize: '0.72rem' }}>
              Rank: {profile.advertiserRank.replace('_', ' ')}
            </span>
          )}
        </div>
      </div>

      {/* Approved Game Certifications */}
      {profile.approvedGames && profile.approvedGames.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text-muted)',
              marginBottom: '0.5rem',
            }}
          >
            Approved Game Certifications
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {profile.approvedGames.map((g) => (
              <div
                key={g.gameSlug}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.82rem',
                  padding: '0.3rem 0.5rem',
                  backgroundColor: 'rgba(24, 21, 36, 0.4)',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <span>{g.gameName}</span>
                <span style={{ color: 'var(--accent-lime)', fontWeight: 600, fontSize: '0.75rem' }}>
                  {g.approvalType}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <Link
          to="/profile"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.85rem',
            color: 'var(--text-primary)',
            padding: '0.4rem 0.6rem',
            borderRadius: 'var(--radius-xs)',
            transition: 'background var(--transition-fast)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <span>WoW Characters &amp; Scores</span>
          <span style={{ color: 'var(--accent-lime)' }}>&rarr;</span>
        </Link>
        <Link
          to="/booster/settings"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.85rem',
            color: 'var(--text-primary)',
            padding: '0.4rem 0.6rem',
            borderRadius: 'var(--radius-xs)',
            transition: 'background var(--transition-fast)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <span>Availability &amp; Preferences</span>
          <span style={{ color: 'var(--accent-lime)' }}>&rarr;</span>
        </Link>
        <a
          href="/legacy"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            padding: '0.4rem 0.6rem',
            borderRadius: 'var(--radius-xs)',
            transition: 'background var(--transition-fast)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <span>Legacy Portal &amp; Modals</span>
          <span>&rarr;</span>
        </a>
      </div>
    </Card>
  );
};
