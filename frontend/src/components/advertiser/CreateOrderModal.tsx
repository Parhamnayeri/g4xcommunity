import React, { useState, useEffect } from 'react';
import { fetchPublicGames, createAdvertiserOrder } from '../../services/advertiser';
import { PublicGame, AdvertiserRankData, AdvertiserWallet, DiscordIntegrationInfo } from '../../types/advertiser';

interface CreateOrderModalProps {
  rankData: AdvertiserRankData;
  wallet: AdvertiserWallet;
  discordInfo: DiscordIntegrationInfo;
  onClose: () => void;
  onSuccess: (orderRef: string) => void;
}

export const CreateOrderModal: React.FC<CreateOrderModalProps> = ({
  rankData,
  wallet,
  discordInfo,
  onClose,
  onSuccess,
}) => {
  const [games, setGames] = useState<PublicGame[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [selectedGameSlug, setSelectedGameSlug] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState<number | ''>('');
  const [grossAmountUsd, setGrossAmountUsd] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadGames() {
      try {
        const res = await fetchPublicGames();
        setGames(res.games || []);
        if (res.games && res.games.length > 0) {
          setSelectedGameSlug(res.games[0].slug);
          if (res.games[0].services && res.games[0].services.length > 0) {
            setSelectedServiceId(res.games[0].services[0].id);
          }
        }
      } catch (err: any) {
        setError('Failed to load active games and services.');
      } finally {
        setLoadingGames(false);
      }
    }
    loadGames();
  }, []);

  const selectedGame = games.find((g) => g.slug === selectedGameSlug);
  const availableServices = selectedGame?.services || [];

  const handleGameChange = (slug: string) => {
    setSelectedGameSlug(slug);
    const game = games.find((g) => g.slug === slug);
    if (game && game.services && game.services.length > 0) {
      setSelectedServiceId(game.services[0].id);
    } else {
      setSelectedServiceId('');
    }
  };

  // Real-time calculation based on authoritative rank basis points
  const parsedGross = parseFloat(grossAmountUsd) || 0;
  const grossCents = Math.round(parsedGross * 100);
  const bps = rankData.basisPoints || 1499;
  const platformFeeCents = Math.round((grossCents * bps) / 10000);
  const boosterPoolCents = Math.max(0, grossCents - platformFeeCents);
  const platformFeeUsd = (platformFeeCents / 100).toFixed(2);
  const boosterPoolUsd = (boosterPoolCents / 100).toFixed(2);

  const hasSufficientBalance = wallet.availableCents >= grossCents && grossCents > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGameSlug) {
      setError('Please select a game.');
      return;
    }
    if (!selectedServiceId) {
      setError('Please select a service.');
      return;
    }
    if (parsedGross <= 0 || grossCents < 100) {
      setError('Minimum order amount is $1.00 USD.');
      return;
    }
    if (!hasSufficientBalance) {
      setError(`Insufficient spendable wallet funds. You have $${wallet.availableUsd} available but order requires $${parsedGross.toFixed(2)}.`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await createAdvertiserOrder({
        gameSlug: selectedGameSlug,
        serviceId: Number(selectedServiceId),
        grossAmountUsd: parsedGross.toFixed(2),
        orderType: 'group',
        notes: notes.trim() || undefined,
      });

      onSuccess(res.order.orderRef);
    } catch (err: any) {
      setError(err.message || 'Failed to place order.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-surface, #181524)',
          border: '1px solid rgba(124, 58, 237, 0.4)',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '560px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '1.75rem',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary, #f4f4f6)' }}>
              Create Direct Boost Order
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)' }}>
              Commercial Rank Tier: <strong style={{ color: 'var(--accent-lime, #ccff00)' }}>{rankData.rankLabel}</strong> ({rankData.commissionPercent})
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted, #9490a6)',
              fontSize: '1.25rem',
              cursor: 'pointer',
              padding: '0.25rem',
            }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              padding: '0.75rem',
              color: '#f87171',
              fontSize: '0.85rem',
            }}
          >
            {error}
          </div>
        )}

        {loadingGames ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted, #9490a6)' }}>
            Loading active games and services...
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
            {/* Game Selector */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  color: 'var(--text-muted, #9490a6)',
                  marginBottom: '0.35rem',
                  fontWeight: 600,
                }}
              >
                Game:
              </label>
              <select
                value={selectedGameSlug}
                onChange={(e) => handleGameChange(e.target.value)}
                style={{
                  width: '100%',
                  backgroundColor: 'rgba(13, 11, 18, 0.8)',
                  border: '1px solid rgba(124, 58, 237, 0.3)',
                  borderRadius: '8px',
                  padding: '0.65rem 0.75rem',
                  color: 'var(--text-primary, #f4f4f6)',
                  fontSize: '0.9rem',
                  outline: 'none',
                }}
              >
                {games.map((g) => (
                  <option key={g.slug} value={g.slug}>
                    {g.displayName}
                  </option>
                ))}
              </select>
            </div>

            {/* Service Selector */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  color: 'var(--text-muted, #9490a6)',
                  marginBottom: '0.35rem',
                  fontWeight: 600,
                }}
              >
                Service Category:
              </label>
              <select
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(Number(e.target.value))}
                style={{
                  width: '100%',
                  backgroundColor: 'rgba(13, 11, 18, 0.8)',
                  border: '1px solid rgba(124, 58, 237, 0.3)',
                  borderRadius: '8px',
                  padding: '0.65rem 0.75rem',
                  color: 'var(--text-primary, #f4f4f6)',
                  fontSize: '0.9rem',
                  outline: 'none',
                }}
              >
                {availableServices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName} ({s.serviceMode})
                  </option>
                ))}
              </select>
            </div>

            {/* Gross USD Amount */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)', fontWeight: 600 }}>
                  Gross Customer Price (USD):
                </label>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)' }}>
                  Available in Wallet:{' '}
                  <strong style={{ color: 'var(--accent-lime, #ccff00)', fontFamily: 'monospace' }}>
                    ${wallet.availableUsd}
                  </strong>
                </span>
              </div>
              <input
                type="number"
                step="0.01"
                min="1.00"
                value={grossAmountUsd}
                onChange={(e) => setGrossAmountUsd(e.target.value)}
                placeholder="25.00"
                required
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  backgroundColor: 'rgba(13, 11, 18, 0.8)',
                  border: '1px solid rgba(124, 58, 237, 0.3)',
                  borderRadius: '8px',
                  padding: '0.65rem 0.75rem',
                  color: 'var(--accent-lime, #ccff00)',
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  outline: 'none',
                }}
              />
            </div>

            {/* Live Financial Breakdown Box */}
            {parsedGross > 0 && (
              <div
                style={{
                  backgroundColor: 'rgba(13, 11, 18, 0.9)',
                  border: '1px solid rgba(124, 58, 237, 0.25)',
                  borderRadius: '10px',
                  padding: '0.85rem 1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted, #9490a6)' }}>Gross Boost Amount:</span>
                  <span style={{ fontFamily: 'monospace', color: '#ffffff', fontWeight: 700 }}>
                    ${parsedGross.toFixed(2)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted, #9490a6)' }}>
                    G4X Fee ({rankData.commissionPercent}):
                  </span>
                  <span style={{ fontFamily: 'monospace', color: '#c4b5fd' }}>
                    -${platformFeeUsd}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    borderTop: '1px solid rgba(124, 58, 237, 0.2)',
                    paddingTop: '0.4rem',
                    marginTop: '0.2rem',
                  }}
                >
                  <span style={{ color: 'var(--accent-lime, #ccff00)', fontWeight: 700 }}>
                    Booster Pool Remaining:
                  </span>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      color: 'var(--accent-lime, #ccff00)',
                      fontWeight: 800,
                    }}
                  >
                    ${boosterPoolUsd}
                  </span>
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  color: 'var(--text-muted, #9490a6)',
                  marginBottom: '0.35rem',
                  fontWeight: 600,
                }}
              >
                Order Notes / Specific Requirements (optional):
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Specific key level, character name, or scheduling instructions..."
                rows={3}
                maxLength={400}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  backgroundColor: 'rgba(13, 11, 18, 0.8)',
                  border: '1px solid rgba(124, 58, 237, 0.3)',
                  borderRadius: '8px',
                  padding: '0.65rem 0.75rem',
                  color: 'var(--text-primary, #f4f4f6)',
                  fontSize: '0.85rem',
                  outline: 'none',
                  resize: 'none',
                }}
              />
            </div>

            {/* Discord Order Channel Alternative */}
            {discordInfo.orderEntryUrl && (
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted, #9490a6)',
                  backgroundColor: 'rgba(35, 30, 52, 0.5)',
                  borderRadius: '8px',
                  padding: '0.6rem 0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>Prefer creating in Discord?</span>
                <a
                  href={discordInfo.orderEntryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#a78bfa', textDecoration: 'underline', fontWeight: 600 }}
                >
                  Open #orders channel ↗
                </a>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid rgba(148, 144, 166, 0.3)',
                  borderRadius: '8px',
                  padding: '0.6rem 1.2rem',
                  color: 'var(--text-muted, #9490a6)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={submitting || !hasSufficientBalance}
                style={{
                  backgroundColor: hasSufficientBalance ? 'var(--primary-purple, #7c3aed)' : 'rgba(124, 58, 237, 0.3)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.6rem 1.5rem',
                  color: '#ffffff',
                  fontWeight: 700,
                  cursor: submitting || !hasSufficientBalance ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  boxShadow: hasSufficientBalance ? '0 4px 14px rgba(124, 58, 237, 0.4)' : 'none',
                }}
              >
                {submitting ? 'Placing Order...' : 'Place & Fund Boost Order'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
