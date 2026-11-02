import React, { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { fetchPublicData } from '../services/auth';
import { Game, PublicConfig } from '../types/games';
import { useAuth } from '../hooks/useAuth';

export const LandingPage: React.FC = () => {
  const { user } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [config, setConfig] = useState<PublicConfig>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchPublicData()
      .then((data) => {
        if (mounted) {
          setGames(data.games || []);
          setConfig(data.config || {});
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const bookingUrl = config.bookingDestination || '/legacy';
  const discordUrl = config.discordInviteUrl || '/auth/discord';

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Background Decorative Radial Glows */}
      <div
        style={{
          position: 'absolute',
          top: '-150px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '800px',
          height: '500px',
          background: 'radial-gradient(ellipse, rgba(124, 58, 237, 0.22) 0%, rgba(13, 11, 18, 0) 70%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* ─── Hero Section ──────────────────────────────────────────────────────── */}
      <section
        style={{
          position: 'relative',
          padding: '5rem 0 4.5rem 0',
          textAlign: 'center',
          zIndex: 1,
        }}
      >
        <div className="container" style={{ maxWidth: '920px' }}>
          {/* Badge */}
          <div style={{ display: 'inline-flex', marginBottom: '1.5rem' }}>
            <span className="badge badge-purple" style={{ padding: '0.4rem 1rem', fontSize: '0.82rem' }}>
              ✦ High-Performance Gaming Services &amp; Marketplace
            </span>
          </div>

          {/* Premium Headline */}
          <h1
            style={{
              fontSize: 'clamp(2.5rem, 5vw, 4rem)',
              fontWeight: 900,
              letterSpacing: '-0.03em',
              lineHeight: 1.15,
              marginBottom: '1.5rem',
            }}
          >
            Level Up Your Game with <br />
            <span
              style={{
                color: 'var(--accent-lime)',
                textShadow: '0 0 25px var(--accent-lime-glow)',
              }}
            >
              G4X Community
            </span>
          </h1>

          {/* Short Supporting Description */}
          <p
            style={{
              fontSize: '1.15rem',
              color: 'var(--text-muted)',
              lineHeight: 1.6,
              maxWidth: '720px',
              margin: '0 auto 1.75rem auto',
            }}
          >
            The verified gaming boost ecosystem. Connect directly with high-tier mythic boosters, vetted pilots and certified exchangers with double-entry ledger security.
          </p>

          {/* Space for Owner/CEO-approved introduction text */}
          <div
            style={{
              backgroundColor: 'rgba(24, 21, 36, 0.6)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.75rem 1.25rem',
              margin: '0 auto 2.5rem auto',
              maxWidth: '680px',
              fontSize: '0.88rem',
              color: '#c4b5fd',
              fontStyle: 'italic',
            }}
          >
            &ldquo;Building a transparent, secure, and competitive gaming infrastructure for boosters and players worldwide.&rdquo;
            <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', fontStyle: 'normal' }}>
              — G4X Leadership Core
            </span>
          </div>

          {/* CTAs */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '1.25rem',
            }}
          >
            <a href={bookingUrl} style={{ textDecoration: 'none' }}>
              <Button variant="cta" size="lg">
                Book a Boost
              </Button>
            </a>
            <a href={discordUrl} style={{ textDecoration: 'none' }}>
              <Button variant="purple" size="lg">
                Join Our Discord
              </Button>
            </a>
          </div>

          {/* Trust Metric Highlights */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '1.25rem',
              marginTop: '4rem',
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: '2.5rem',
            }}
          >
            <div>
              <div style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--accent-lime)' }}>100%</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Double-Entry Accounting
              </div>
            </div>
            <div>
              <div style={{ fontSize: '1.9rem', fontWeight: 800, color: '#ffffff' }}>Verified</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Discord Auth &amp; Pilots
              </div>
            </div>
            <div>
              <div style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--accent-lime)' }}>24/7</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Escrow Protected Payouts
              </div>
            </div>
            <div>
              <div style={{ fontSize: '1.9rem', fontWeight: 800, color: '#ffffff' }}>Multi-Game</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Live Catalog
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Supported Services Section ────────────────────────────────────────── */}
      <section
        id="services"
        style={{
          padding: '5rem 0',
          backgroundColor: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <span className="badge badge-lime" style={{ marginBottom: '0.75rem' }}>
              Service Catalog
            </span>
            <h2 style={{ fontSize: '2.2rem', marginBottom: '0.75rem' }}>Supported Games &amp; Services</h2>
            <p style={{ maxWidth: '600px', margin: '0 auto', fontSize: '0.98rem' }}>
              Explore our verified booster services. All services operate under strict quality guidelines and escrow safety rules.
            </p>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
              Loading supported games catalog...
            </div>
          ) : games.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
              No games currently enabled. Check back shortly.
            </div>
          ) : (
            <div className="grid-3">
              {games.map((game) => (
                <Card key={game.slug} interactive highlight="none">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                    <span className="badge badge-purple" style={{ textTransform: 'capitalize' }}>
                      {game.serviceCategory.replace('_', ' ')}
                    </span>
                    <span className="badge badge-lime" style={{ fontSize: '0.7rem' }}>
                      Active
                    </span>
                  </div>

                  <h3 style={{ fontSize: '1.25rem', marginBottom: '0.6rem', color: '#fff' }}>
                    {game.displayName}
                  </h3>

                  <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '1.25rem', minHeight: '44px' }}>
                    {game.description || `High-tier boosting, keystone runs and professional coaching for ${game.displayName}.`}
                  </p>

                  {/* Services under this game */}
                  {game.services && game.services.length > 0 && (
                    <div style={{ marginBottom: '1.5rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
                      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 700 }}>
                        Featured Categories:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                        {game.services.filter((s) => s.isActive).map((service) => (
                          <span
                            key={service.serviceKey}
                            style={{
                              backgroundColor: 'rgba(45, 38, 69, 0.6)',
                              padding: '0.2rem 0.5rem',
                              borderRadius: 'var(--radius-xs)',
                              fontSize: '0.75rem',
                              color: 'var(--text-primary)',
                            }}
                          >
                            {service.displayName}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 'auto' }}>
                    <a href={bookingUrl} style={{ textDecoration: 'none' }}>
                      <Button variant="outline" size="sm" style={{ width: '100%' }}>
                        Inquire &amp; Book &rarr;
                      </Button>
                    </a>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ─── Become a Booster / Join the Team ─────────────────────────────────── */}
      <section
        id="recruitment"
        style={{
          padding: '5.5rem 0',
          position: 'relative',
        }}
      >
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <span className="badge badge-lime" style={{ marginBottom: '0.75rem' }}>
              Careers &amp; Guild
            </span>
            <h2 style={{ fontSize: '2.2rem', marginBottom: '0.75rem' }}>Join the G4X Community Team</h2>
            <p style={{ maxWidth: '650px', margin: '0 auto', fontSize: '0.98rem' }}>
              Whether you are an elite booster, a community advertiser, or a licensed gold exchanger, G4X provides an institutional platform for your operations.
            </p>
          </div>

          <div className="grid-3">
            {/* 1. Become a Booster */}
            <Card interactive highlight="lime">
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(204, 255, 0, 0.12)',
                  color: 'var(--accent-lime)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.4rem',
                  marginBottom: '1.25rem',
                }}
              >
                ⚔️
              </div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Become a Booster</h3>
              <p style={{ fontSize: '0.88rem', marginBottom: '1.5rem', color: 'var(--text-muted)' }}>
                Demonstrate your high-tier in-game rating, mythic raiding logs or competitive rank. Earn reliable, automated payouts with transparent allocations.
              </p>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.75rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                <li>✓ Direct order claims on Discord</li>
                <li>✓ Fair booster pool split algorithms</li>
                <li>✓ USDT &amp; Banking withdrawal methods</li>
              </ul>
              <a
                href={user ? '/legacy' : '/auth/discord'}
                style={{ textDecoration: 'none' }}
              >
                <Button variant="cta" size="sm" style={{ width: '100%' }}>
                  Apply as Booster
                </Button>
              </a>
            </Card>

            {/* 2. Become an Advertiser */}
            <Card interactive highlight="purple">
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(124, 58, 237, 0.2)',
                  color: '#c4b5fd',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.4rem',
                  marginBottom: '1.25rem',
                }}
              >
                📢
              </div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Become an Advertiser</h3>
              <p style={{ fontSize: '0.88rem', marginBottom: '1.5rem', color: 'var(--text-muted)' }}>
                Bring boost clients into the G4X network. Enjoy structured rank progression (Bronze to Founding Partner) with escalating commission basis points.
              </p>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.75rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                <li>✓ Tiered commission structures</li>
                <li>✓ Instant customer order routing</li>
                <li>✓ Automated balance accounting</li>
              </ul>
              <a
                href={user ? '/legacy' : '/auth/discord'}
                style={{ textDecoration: 'none' }}
              >
                <Button variant="purple" size="sm" style={{ width: '100%' }}>
                  Apply as Advertiser
                </Button>
              </a>
            </Card>

            {/* 3. Become an Exchanger */}
            <Card interactive highlight="none">
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.4rem',
                  marginBottom: '1.25rem',
                }}
              >
                💎
              </div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Become an Exchanger</h3>
              <p style={{ fontSize: '0.88rem', marginBottom: '1.5rem', color: 'var(--text-muted)' }}>
                Facilitate in-game gold and currency settlement across multiple realms. Provide liquidity and trade safely in our protected escrow marketplace.
              </p>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.75rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                <li>✓ P2P gold market verification</li>
                <li>✓ Guaranteed payment escrow</li>
                <li>✓ Multi-realm trading opportunities</li>
              </ul>
              <a
                href={user ? '/legacy' : '/auth/discord'}
                style={{ textDecoration: 'none' }}
              >
                <Button variant="outline" size="sm" style={{ width: '100%' }}>
                  Apply as Exchanger
                </Button>
              </a>
            </Card>
          </div>
        </div>
      </section>

      {/* ─── Security & Double-Entry Ledger Callout ────────────────────────────── */}
      <section
        style={{
          padding: '4rem 0',
          backgroundColor: 'rgba(24, 21, 36, 0.4)',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <div className="container" style={{ maxWidth: '800px', textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-flex',
              padding: '0.4rem 0.9rem',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'rgba(204, 255, 0, 0.1)',
              color: 'var(--accent-lime)',
              fontSize: '0.82rem',
              fontWeight: 700,
              marginBottom: '1rem',
              border: '1px solid rgba(204, 255, 0, 0.25)',
            }}
          >
            🛡️ Institutional Financial Integrity
          </div>
          <h2 style={{ fontSize: '1.8rem', marginBottom: '0.75rem' }}>
            Zero Compromise Security
          </h2>
          <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '2rem' }}>
            All operations are backed by immutable double-entry ledger bookkeeping, 24-hour escrow release holding periods, and timing-safe OwnerGate authentication.
          </p>
          <a href="/legacy" className="btn btn-outline btn-sm">
            Explore Member Platform &rarr;
          </a>
        </div>
      </section>
    </div>
  );
};
