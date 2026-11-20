import React, { useState, useEffect } from 'react';
import { fetchPublicGames, createAdvertiserOrder } from '../../services/advertiser';
import { PublicGame, AdvertiserRankData, AdvertiserWallet, DiscordIntegrationInfo, CreateOrderRequest } from '../../types/advertiser';
import { extractExternalOrderIdAndCleanNotes } from '../../utils/orderParsers';
import { DynamicServiceFormRenderer } from '../orders/DynamicServiceFormRenderer';
import { BoostCategoryKey } from '../../types/boostSpecs';
import { DiscordWelcomeMessagePreview } from '../orders/DiscordWelcomeMessagePreview';

interface CreateOrderModalProps {
  rankData: AdvertiserRankData;
  wallet: AdvertiserWallet;
  discordInfo: DiscordIntegrationInfo;
  createOrder?: (orderData: CreateOrderRequest) => Promise<{ success: boolean; order: { orderRef: string }; isFunded?: boolean }>;
  title?: string;
  onClose: () => void;
  onSuccess: (orderRef: string) => void;
}

export const CreateOrderModal: React.FC<CreateOrderModalProps> = ({
  rankData,
  wallet,
  discordInfo,
  createOrder = createAdvertiserOrder,
  title = 'Create New G4X Order',
  onClose,
  onSuccess,
}) => {
  const [games, setGames] = useState<PublicGame[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [activeCategory, setActiveCategory] = useState<BoostCategoryKey>('mythic_plus');
  const [boostSpecs, setBoostSpecs] = useState<Record<string, any>>({
    regionFaction: 'EU - Cross-Faction',
    keystoneLevel: '+10',
    runsCount: 1,
    dungeonSelection: '',
    timerGuarantee: 'Timed (In-Time)',
    armorStack: 'No Loot Traders',
  });
  const [orderTitle, setOrderTitle] = useState('Mythic+ 10-20 Timed Bundle');
  const [boostModel, setBoostModel] = useState('Mythic+ Keystone');
  const [vpnRequirement, setVpnRequirement] = useState('No VPN Required (Self-Play)');
  const [selectedGameSlug, setSelectedGameSlug] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState<number | ''>('');
  const [orderMode, setOrderMode] = useState<'non_pilot' | 'pilot'>('non_pilot');
  const [runsCount, setRunsCount] = useState<number>(1);
  const [keyLevel, _setKeyLevel] = useState('');
  const [vpnLocation, setVpnLocation] = useState('');
  const [customerInfo, setCustomerInfo] = useState('');
  const [customerDiscord, setCustomerDiscord] = useState('');
  const [customerDetails, setCustomerDetails] = useState('');
  const [directBooster, setDirectBooster] = useState('');
  const [currency, setCurrency] = useState('USD');
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
          const firstGame = res.games[0];
          setSelectedGameSlug(firstGame.slug);
          if (firstGame.services && firstGame.services.length > 0) {
            const firstSvc = firstGame.services[0];
            setSelectedServiceId(firstSvc.id);
            if (firstSvc.serviceMode === 'pilot') {
              setOrderMode('pilot');
            } else {
              setOrderMode('non_pilot');
            }
          }
        }
      } catch {
        setError('Failed to load active games and services.');
      } finally {
        setLoadingGames(false);
      }
    }
    loadGames();
  }, []);

  const selectedGame = games.find((g) => g.slug === selectedGameSlug);
  const availableServices = selectedGame?.services || [];
  const selectedService = availableServices.find((s) => s.id === Number(selectedServiceId));

  const handleGameChange = (slug: string) => {
    setSelectedGameSlug(slug);
    const game = games.find((g) => g.slug === slug);
    if (game && game.services && game.services.length > 0) {
      const firstSvc = game.services[0];
      setSelectedServiceId(firstSvc.id);
      if (firstSvc.serviceMode === 'pilot') {
        setOrderMode('pilot');
      } else {
        setOrderMode('non_pilot');
      }
    } else {
      setSelectedServiceId('');
    }
  };

  const handleServiceChange = (serviceId: number) => {
    setSelectedServiceId(serviceId);
    const svc = availableServices.find((s) => s.id === serviceId);
    if (svc) {
      if (svc.serviceMode === 'pilot') {
        setOrderMode('pilot');
      } else if (svc.serviceMode === 'non_pilot') {
        setOrderMode('non_pilot');
      }
    }
  };

  const isMythicPlus = Boolean(
    selectedService &&
      (selectedService.serviceKey === 'mythic_plus' ||
        selectedService.displayName.toLowerCase().includes('mythic'))
  );

  const allowsModeSelection = selectedService?.serviceMode === 'both';

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
    if (activeCategory === 'mythic_plus' && !boostSpecs?.keystoneLevel && !keyLevel.trim()) {
      setError('Target dungeon and key level is required for Mythic+ orders (e.g. "+10 Ara-Kara").');
      return;
    }
    if (orderMode === 'pilot' && !vpnLocation.trim() && (!vpnRequirement || vpnRequirement.includes('No VPN'))) {
      setError('Required VPN location or VPN requirement is strictly required for Pilot orders.');
      return;
    }
    const effectiveRuns = boostSpecs?.runsCount ? Number(boostSpecs.runsCount) : runsCount;
    if (effectiveRuns < 1) {
      setError('Number of runs must be at least 1.');
      return;
    }
    if (parsedGross <= 0 || grossCents < 100) {
      setError('Minimum order amount is $1.00 USD.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const customerParts = [customerInfo.trim(), customerDetails.trim(), customerDiscord.trim() ? `Discord: ${customerDiscord.trim()}` : '']
        .filter(Boolean)
        .join(' | ');
      const orderNotes = [notes.trim(), directBooster.trim() ? `Requested booster assignment: ${directBooster.trim()}` : '']
        .filter(Boolean)
        .join('\n');
      const { title: parsedTitle, cleanNotes } = extractExternalOrderIdAndCleanNotes(
        orderNotes,
        null,
        orderTitle
      );
      const effectiveVpn = vpnRequirement || (orderMode === 'pilot' && vpnLocation.trim() ? `VPN Required — ${vpnLocation.trim()}` : undefined);
      const res = await createOrder({
        title: parsedTitle || undefined,
        boostModel: boostModel || undefined,
        vpnRequirement: effectiveVpn,
        boostSpecs,
        gameSlug: selectedGameSlug,
        serviceId: Number(selectedServiceId),
        grossAmountUsd: parsedGross.toFixed(2),
        orderMode,
        runsCount: effectiveRuns,
        keyLevel: boostSpecs?.keystoneLevel || (isMythicPlus ? keyLevel.trim() : undefined),
        vpnLocation: orderMode === 'pilot' ? (vpnLocation.trim() || effectiveVpn) : undefined,
        customerInfo: customerParts || undefined,
        notes: cleanNotes || undefined,
      });

      onSuccess(res.order.orderRef);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to place order.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="studio-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="studio-modal-card studio-modal-card-lg"
        style={{ width: 'min(1080px, 94vw)', maxWidth: '1080px', maxHeight: '92vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div className="studio-modal-header">
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              {title}
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Commercial Rank Tier: <strong style={{ color: 'var(--accent-yellow)' }}>{rankData.rankLabel}</strong> ({rankData.commissionPercent})
            </span>
          </div>
          <button
            type="button"
            className="studio-modal-close"
            onClick={onClose}
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
            {/* 1. Game & Service Selector (Top Level) */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(168, 85, 247, 0.25)',
                borderRadius: '10px',
                padding: '0.85rem 1rem',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.85rem',
              }}
            >
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.8rem',
                    color: 'var(--text-muted, #9490a6)',
                    marginBottom: '0.35rem',
                    fontWeight: 700,
                  }}
                >
                  🎮 Select Game:
                </label>
                <select
                  value={selectedGameSlug}
                  onChange={(e) => handleGameChange(e.target.value)}
                  style={{
                    width: '100%',
                    backgroundColor: 'rgba(13, 11, 18, 0.9)',
                    border: '1px solid rgba(124, 58, 237, 0.4)',
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

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.8rem',
                    color: 'var(--text-muted, #9490a6)',
                    marginBottom: '0.35rem',
                    fontWeight: 700,
                  }}
                >
                  ⚡ Select Game Service:
                </label>
                <select
                  value={selectedServiceId}
                  onChange={(e) => handleServiceChange(Number(e.target.value))}
                  style={{
                    width: '100%',
                    backgroundColor: 'rgba(13, 11, 18, 0.9)',
                    border: '1px solid rgba(124, 58, 237, 0.4)',
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
            </div>

            {/* 2. Order Title */}
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
                Order Title (Descriptive Name):
              </label>
              <input
                type="text"
                value={orderTitle}
                onChange={(e) => setOrderTitle(e.target.value)}
                placeholder="e.g. Mythic+ 10-20 Timed Bundle (4 Runs)"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  backgroundColor: 'rgba(13, 11, 18, 0.8)',
                  border: '1px solid rgba(124, 58, 237, 0.3)',
                  borderRadius: '8px',
                  padding: '0.65rem 0.75rem',
                  color: 'var(--text-primary, #f4f4f6)',
                  fontSize: '0.9rem',
                  outline: 'none',
                }}
              />
            </div>

            {/* 3. Dynamic Service Form Specifications */}
            <div style={{ marginBottom: '0.4rem' }}>
              <DynamicServiceFormRenderer
                selectedService={selectedService}
                activeCategory={activeCategory}
                onSelectCategory={(key, model, defTitle) => {
                  setActiveCategory(key);
                  setBoostModel(model);
                  if (!orderTitle || orderTitle.includes('Bundle') || orderTitle.includes('Clear') || orderTitle.includes('Boost') || orderTitle.includes('Package') || orderTitle.includes('Leveling') || orderTitle.includes('Raid') || orderTitle.includes('Arena') || orderTitle.includes('Delves')) {
                    setOrderTitle(defTitle);
                  }
                }}
                specs={boostSpecs}
                onUpdateSpecs={setBoostSpecs}
              />
            </div>

            {/* Boost Model & VPN Requirement */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
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
                  Boost Model:
                </label>
                <select
                  value={boostModel}
                  onChange={(e) => setBoostModel(e.target.value)}
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
                  <option value="">— Select Boost Model —</option>
                  <option value="Mythic+ Keystone">Mythic+ Keystone</option>
                  <option value="Raid Run (Normal/Heroic/Mythic)">Raid Run (Normal/Heroic/Mythic)</option>
                  <option value="Leveling / Campaign">Leveling / Campaign</option>
                  <option value="PvP / Arena / RBG">PvP / Arena / RBG</option>
                  <option value="Delves / Farming">Delves / Farming</option>
                  <option value="Custom">Custom</option>
                </select>
              </div>

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
                  VPN Requirement:
                </label>
                <select
                  value={vpnRequirement}
                  onChange={(e) => setVpnRequirement(e.target.value)}
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
                  <option value="">— Select VPN Requirement —</option>
                  <option value="No VPN Required (Self-Play)">No VPN Required (Self-Play)</option>
                  <option value="VPN Required — Client Country (Match IP)">VPN Required — Client Country (Match IP)</option>
                  <option value="VPN Required — EU Region">VPN Required — EU Region</option>
                  <option value="VPN Required — US Region">VPN Required — US Region</option>
                  <option value="ExitLag / Gaming VPN Recommended">ExitLag / Gaming VPN Recommended</option>
                </select>
              </div>
            </div>

            {/* Execution Mode (Pilot vs Non-Pilot) */}
            {allowsModeSelection && (
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
                  Execution Mode:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setOrderMode('non_pilot')}
                    style={{
                      padding: '0.5rem',
                      borderRadius: '8px',
                      border: orderMode === 'non_pilot' ? '1px solid var(--accent-lime, #ccff00)' : '1px solid rgba(124, 58, 237, 0.3)',
                      backgroundColor: orderMode === 'non_pilot' ? 'rgba(204, 255, 0, 0.1)' : 'rgba(13, 11, 18, 0.6)',
                      color: orderMode === 'non_pilot' ? 'var(--accent-lime, #ccff00)' : 'var(--text-muted, #9490a6)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    Selfplay
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderMode('pilot')}
                    style={{
                      padding: '0.5rem',
                      borderRadius: '8px',
                      border: orderMode === 'pilot' ? '1px solid var(--primary-purple, #7c3aed)' : '1px solid rgba(124, 58, 237, 0.3)',
                      backgroundColor: orderMode === 'pilot' ? 'rgba(124, 58, 237, 0.2)' : 'rgba(13, 11, 18, 0.6)',
                      color: orderMode === 'pilot' ? '#c4b5fd' : 'var(--text-muted, #9490a6)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    Pilot (Account-Play)
                  </button>
                </div>
              </div>
            )}

            {/* Pilot VPN Location Field */}
            {orderMode === 'pilot' && (
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
                  Required Booster VPN Location (required if no VPN Requirement selected):
                </label>
                <input
                  type="text"
                  value={vpnLocation}
                  onChange={(e) => setVpnLocation(e.target.value)}
                  placeholder="e.g. US - Chicago or Germany - Frankfurt"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: 'rgba(13, 11, 18, 0.8)',
                    border: '1px solid rgba(124, 58, 237, 0.3)',
                    borderRadius: '8px',
                    padding: '0.65rem 0.75rem',
                    color: 'var(--text-primary, #f4f4f6)',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                />
              </div>
            )}

            {/* Runs Count & Customer Info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
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
                  Runs:
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={runsCount}
                  onChange={(e) => setRunsCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: 'rgba(13, 11, 18, 0.8)',
                    border: '1px solid rgba(124, 58, 237, 0.3)',
                    borderRadius: '8px',
                    padding: '0.65rem 0.75rem',
                    color: 'var(--text-primary, #f4f4f6)',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)', marginBottom: '0.35rem', fontWeight: 600 }}>
                    Customer Discord tag:
                  </label>
                  <input
                    type="text"
                    value={customerDiscord}
                    onChange={(e) => setCustomerDiscord(e.target.value)}
                    placeholder="name or name#0000"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)', marginBottom: '0.35rem', fontWeight: 600 }}>
                    Region / Faction / Realm:
                  </label>
                  <input
                    type="text"
                    value={customerDetails}
                    onChange={(e) => setCustomerDetails(e.target.value)}
                    placeholder="EU / Horde / Tarren Mill"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)', marginBottom: '0.35rem', fontWeight: 600 }}>
                    Currency:
                  </label>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)', marginBottom: '0.35rem', fontWeight: 600 }}>
                    Direct booster assignment (optional):
                  </label>
                  <input
                    type="text"
                    value={directBooster}
                    onChange={(e) => setDirectBooster(e.target.value)}
                    placeholder="Booster Discord tag, or leave empty for open pool"
                  />
                </div>
              </div>
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
                  Customer / Character:
                </label>
                <input
                  type="text"
                  value={customerInfo}
                  onChange={(e) => setCustomerInfo(e.target.value)}
                  placeholder="Character name & realm"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: 'rgba(13, 11, 18, 0.8)',
                    border: '1px solid rgba(124, 58, 237, 0.3)',
                    borderRadius: '8px',
                    padding: '0.65rem 0.75rem',
                    color: 'var(--text-primary, #f4f4f6)',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                />
              </div>
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

                <div
                  style={{
                    marginTop: '0.3rem',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    backgroundColor: hasSufficientBalance ? 'rgba(204, 255, 0, 0.1)' : 'rgba(234, 179, 8, 0.1)',
                    color: hasSufficientBalance ? 'var(--accent-lime, #ccff00)' : '#facc15',
                    border: hasSufficientBalance ? '1px solid rgba(204, 255, 0, 0.25)' : '1px solid rgba(234, 179, 8, 0.25)',
                  }}
                >
                  {hasSufficientBalance
                    ? `✓ Available funds ($${wallet.availableUsd}) cover order. Funds will be atomically reserved in WalletV2.`
                    : `⚠️ Available balance ($${wallet.availableUsd}) is less than order cost. Order will be created in payment_pending status until funded.`}
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
                Order Notes / Additional Instructions (optional):
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Specific key level, character name, or scheduling instructions... (e.g. <t=&quot;Fast 10-20&quot;> <#JC100> fast)"
                rows={2}
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
              <p style={{ color: 'var(--text-muted, #9490a6)', fontSize: '0.76rem', marginTop: '0.25rem', marginBottom: 0 }}>
                Tip: You can also use &lt;t="Order Title"&gt; and &lt;#EXT_ID&gt; tags inside Notes.
              </p>
              {notes.match(/<t=(?:"([^"]*)"|'([^']*)'|([^>]+))>/i) && (
                <p style={{ color: 'var(--accent-lime, #ccff00)', fontSize: '0.78rem', marginTop: '0.2rem', marginBottom: 0 }}>
                  💡 Auto-detected Order Title: <strong>{notes.match(/<t=(?:"([^"]*)"|'([^']*)'|([^>]+))>/i)?.[1] || notes.match(/<t=(?:"([^"]*)"|'([^']*)'|([^>]+))>/i)?.[2] || notes.match(/<t=(?:"([^"]*)"|'([^']*)'|([^>]+))>/i)?.[3]}</strong> (will be automatically extracted and stripped from notes).
                </p>
              )}
              {notes.match(/<#([^>]+)>/) && (
                <p style={{ color: 'var(--accent-lime, #ccff00)', fontSize: '0.78rem', marginTop: '0.2rem', marginBottom: 0 }}>
                  💡 Auto-detected External Order ID: <strong>{notes.match(/<#([^>]+)>/)?.[1]}</strong> (will be automatically extracted and stripped from notes).
                </p>
              )}
            </div>

            {/* Discord Temporary Channel Welcome Message Live Preview */}
            <div style={{ marginTop: '0.4rem', marginBottom: '0.4rem' }}>
              <DiscordWelcomeMessagePreview
                orderTitle={orderTitle}
                orderIdPlaceholder="NEW"
                boostModel={boostModel}
                vpnRequirement={vpnRequirement}
                specs={boostSpecs}
                notes={notes}
                grossAmount={totalCostUsd}
                boosterPool={boosterPoolUsd}
                serviceTemplate={selectedService?.tempChannelTemplate}
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
            <div className="studio-modal-footer" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="btn btn-secondary"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={submitting}
                className="btn btn-cta"
              >
                {submitting ? 'Placing Order...' : hasSufficientBalance ? 'Place & Fund Boost Order' : 'Place Order (Payment Pending)'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
