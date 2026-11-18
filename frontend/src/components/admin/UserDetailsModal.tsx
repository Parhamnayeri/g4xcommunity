import React, { useState, useEffect } from 'react';
import { AdminUserDetailsResponse } from '../../types/adminPortal';
import { fetchAdminUserDetails, sendUserKycDm } from '../../services/adminPortal';
import { LoadingState } from '../ui/LoadingState';

interface Props {
  discordId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onAssistKyc?: (user: { discordId: string; displayName: string | null; username: string }) => void;
}

export const UserDetailsModal: React.FC<Props> = ({
  discordId,
  isOpen,
  onClose,
  onAssistKyc,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminUserDetailsResponse['user'] | null>(null);

  // Navigation
  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'ledger' | 'audit'>('overview');
  const [orderSubTab, setOrderSubTab] = useState<'assigned' | 'created' | 'presigns'>('assigned');
  const [ledgerSubTab, setLedgerSubTab] = useState<'transactions' | 'withdrawals'>('transactions');

  // Copy feedback
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // KYC DM feedback
  const [sendingDm, setSendingDm] = useState(false);
  const [dmFeedback, setDmFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!isOpen || !discordId) return;

    setLoading(true);
    setError(null);
    setDmFeedback(null);
    setActiveTab('overview');
    setOrderSubTab('assigned');
    setLedgerSubTab('transactions');

    fetchAdminUserDetails(discordId)
      .then((res: any) => {
        if (res.success) {
          const rawUser = res.user || {};
          const rawProfile = rawUser.profile || (rawUser.username ? rawUser : res.profile) || {};
          const normalized: any = {
            profile: {
              id: rawProfile.id || rawProfile.discordId || discordId,
              discordId: rawProfile.discordId || discordId,
              username: rawProfile.username || '—',
              displayName: rawProfile.displayName || rawProfile.username || null,
              avatarUrl: rawProfile.avatarUrl || '',
              isActive: rawProfile.isActive ?? (rawProfile.status === 'Active' || rawProfile.status === 'active' || true),
              status: rawProfile.status || (rawProfile.isActive === false ? 'Suspended' : 'Active'),
              advertiserRank: rawProfile.advertiserRank || null,
              phoneNumber: rawProfile.phoneNumber || null,
              telegramUsername: rawProfile.telegramUsername || null,
              whatsappNumber: rawProfile.whatsappNumber || null,
              createdAt: rawProfile.createdAt || new Date().toISOString(),
              updatedAt: rawProfile.updatedAt || new Date().toISOString(),
            },
            roles: rawUser.roles || res.roles || [],
            gameApprovals: rawUser.gameApprovals || res.gameApprovals || [],
            wowCharacters: rawUser.wowCharacters || res.wowCharacters || [],
            kyc: rawUser.kyc || res.kyc || {
              status: 'none',
              isVerified: false,
              verifiedAt: null,
              legalName: null,
              country: null,
              idNumber: null,
              contactInfo: null,
              vpnConfirmed: false,
              adminNotes: null,
              documents: { identity: false, passport: false, selfie: false, totalUploaded: 0 },
              pilotVerifications: [],
            },
            financialSummary: rawUser.financialSummary || res.financialSummary || {
              availableBalance: 0,
              availableBalanceFormatted: '$0.00',
              pendingEscrowBalance: 0,
              pendingEscrowBalanceFormatted: '$0.00',
              reservedBalance: 0,
              reservedBalanceFormatted: '$0.00',
              totalLifetimeEarnings: 0,
              totalLifetimeEarningsFormatted: '$0.00',
              totalWithdrawn: 0,
              totalWithdrawnFormatted: '$0.00',
              totalOrdersCompleted: 0,
              activeAssignedOrdersCount: 0,
              currency: 'USD',
              payoutAddress: null,
              payoutNetwork: null,
              bankAccountHolder: null,
              bankIban: null,
              cryptoAddress: null,
              cryptoNetwork: null,
            },
            orders: rawUser.orders || res.orders || {
              assignedOrders: [],
              createdOrders: [],
              preSigns: [],
              totalAssigned: 0,
              totalCreated: 0,
              totalPreSigns: 0,
            },
            ledger: rawUser.ledger || {
              transactions: res.financialActivity?.ledgerTransactions || rawUser.financialActivity?.ledgerTransactions || [],
              totalTransactions: (res.financialActivity?.ledgerTransactions || []).length,
            },
            withdrawals: rawUser.withdrawals || {
              requests: res.financialActivity?.withdrawals || rawUser.financialActivity?.withdrawals || [],
              totalRequests: (res.financialActivity?.withdrawals || []).length,
            },
            auditTrail: rawUser.auditTrail || res.auditLogs || res.auditTrail || [],
          };
          setData(normalized);
        } else {
          setError('Failed to load user details: Malformed response.');
        }
      })
      .catch((err) => {
        setError(err.message || 'Error fetching aggregated user details');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, discordId]);

  if (!isOpen || !discordId) return null;

  const handleCopy = (text: string, fieldKey: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldKey);
    setTimeout(() => {
      setCopiedField(null);
    }, 2000);
  };

  const handleSendDm = async () => {
    if (!discordId) return;
    setSendingDm(true);
    setDmFeedback(null);
    try {
      const res = await sendUserKycDm(discordId);
      if (res.dmSent) {
        setDmFeedback({
          text: '✓ Direct verification link sent successfully to user’s Discord DM!',
          type: 'success',
        });
      } else {
        setDmFeedback({
          text: `⚠️ User DMs are blocked/closed (${res.error || 'DM blocked'}). Direct link: ${res.kycUrl}`,
          type: 'error',
        });
      }
    } catch (err: any) {
      setDmFeedback({
        text: err.message || 'Failed to dispatch verification DM.',
        type: 'error',
      });
    } finally {
      setSendingDm(false);
    }
  };

  const profile = data?.profile;
  const kyc = data?.kyc;
  const fin = data?.financialSummary;
  const orders = data?.orders;
  const ledger = data?.ledger;
  const withdrawals = data?.withdrawals;
  const auditTrail = data?.auditTrail;

  return (
    <div
      className="studio-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ zIndex: 1100 }}
    >
      <div
        className="studio-modal-card studio-modal-card-xl"
        style={{
          width: '100%',
          maxWidth: '1050px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0c0e14',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        }}
      >
        {/* Sticky Header */}
        <div
          className="studio-modal-header"
          style={{
            backgroundColor: '#12151f',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '1.25rem 1.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          {/* User Info & Identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.username}
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  border: '2px solid rgba(139, 92, 246, 0.4)',
                  objectFit: 'cover',
                  backgroundColor: '#1a1d29',
                }}
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(139, 92, 246, 0.15)',
                  border: '2px solid rgba(139, 92, 246, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.4rem',
                  fontWeight: 700,
                  color: '#c4b5fd',
                }}
              >
                {(profile?.displayName || profile?.username || 'U').charAt(0).toUpperCase()}
              </div>
            )}

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f3f4f6', margin: 0 }}>
                  {profile?.displayName || profile?.username || 'User Profile'}
                </h2>
                {profile && (
                  <span
                    className={`badge ${profile.isActive ? 'badge-green' : 'badge-danger'}`}
                    style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem' }}
                  >
                    {profile.status}
                  </span>
                )}
                {profile?.advertiserRank && (
                  <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                    Rank: {profile.advertiserRank}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>@{profile?.username || '—'}</span>
                <span style={{ color: 'rgba(255,255,255,0.2)' }}>•</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <code style={{ fontSize: '0.75rem', color: '#cbd5e1', backgroundColor: 'rgba(255,255,255,0.06)', padding: '0.15rem 0.45rem', borderRadius: '4px' }}>
                    {discordId}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(discordId, 'discordId')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: copiedField === 'discordId' ? '#4ade80' : '#9ca3af',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      padding: '2px 4px',
                    }}
                    title="Copy Discord ID"
                  >
                    {copiedField === 'discordId' ? '✓ Copied' : '📋'}
                  </button>
                </div>
              </div>

              {/* Roles */}
              <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.45rem', flexWrap: 'wrap' }}>
                {data?.roles && data.roles.length > 0 ? (
                  data.roles.map((r, i) => (
                    <span
                      key={`${r.roleKey}-${i}`}
                      className="badge badge-purple"
                      style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}
                      title={`Granted: ${new Date(r.grantedAt).toLocaleDateString()}`}
                    >
                      {r.roleKey}
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Regular User (No elevated roles)</span>
                )}
              </div>
            </div>
          </div>

          {/* Quick Actions & Close */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={sendingDm}
              onClick={handleSendDm}
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
              title="Send automated Discord DM with one-time KYC verification link"
            >
              {sendingDm ? 'Sending DM...' : '🪪 Send KYC DM'}
            </button>

            {onAssistKyc && profile && (
              <button
                type="button"
                className="btn btn-purple btn-sm"
                onClick={() => {
                  onAssistKyc({
                    discordId,
                    displayName: profile.displayName,
                    username: profile.username,
                  });
                }}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                title="Open Staff Assisted KYC inspector & approval panel"
              >
                ✏️ Assist KYC
              </button>
            )}

            <button
              type="button"
              className="studio-modal-close"
              onClick={onClose}
              aria-label="Close"
              style={{ marginLeft: '0.5rem' }}
            >
              &times;
            </button>
          </div>
        </div>

        {/* Feedback message banner */}
        {dmFeedback && (
          <div
            style={{
              padding: '0.65rem 1.75rem',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: dmFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
              borderBottom: `1px solid ${dmFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              color: dmFeedback.type === 'success' ? '#86efac' : '#fca5a5',
            }}
          >
            <span>{dmFeedback.text}</span>
            <button
              type="button"
              onClick={() => setDmFeedback(null)}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem' }}
            >
              &times;
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="studio-modal-body" style={{ padding: '1.5rem 1.75rem', overflowY: 'auto', flex: 1, gap: '1.25rem' }}>
          {loading ? (
            <div style={{ padding: '4rem 1rem', textAlign: 'center' }}>
              <LoadingState message="Aggregating user ledger, orders, KYC documents and audit trail..." />
            </div>
          ) : error ? (
            <div
              style={{
                padding: '2.5rem 1.5rem',
                textAlign: 'center',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '12px',
              }}
            >
              <div style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>⚠️</div>
              <h3 style={{ color: '#f87171', margin: '0 0 0.5rem 0' }}>Failed to Load User Details</h3>
              <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '1.25rem' }}>{error}</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  fetchAdminUserDetails(discordId)
                    .then((res) => setData(res.user))
                    .catch((err) => setError(err.message))
                    .finally(() => setLoading(false));
                }}
              >
                🔄 Retry Inspection
              </button>
            </div>
          ) : data ? (
            <>
              {/* 4-Card KPI Strip */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1rem',
                }}
              >
                {/* Available Balance */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1rem 1.25rem',
                    borderRadius: '10px',
                    border: '1px solid rgba(250, 204, 21, 0.25)',
                    backgroundColor: 'rgba(250, 204, 21, 0.03)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                    Available Balance
                  </div>
                  <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#facc15', margin: '0.35rem 0 0.2rem 0' }}>
                    {fin?.availableBalanceFormatted || '$0.00'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Liquid withdrawable balance</div>
                </div>

                {/* Pending Escrow */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1rem 1.25rem',
                    borderRadius: '10px',
                    border: '1px solid rgba(139, 92, 246, 0.25)',
                    backgroundColor: 'rgba(139, 92, 246, 0.03)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                    Pending Escrow
                  </div>
                  <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#c084fc', margin: '0.35rem 0 0.2rem 0' }}>
                    {fin?.pendingEscrowBalanceFormatted || '$0.00'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    {fin?.activeAssignedOrdersCount ?? 0} active orders in progress
                  </div>
                </div>

                {/* Lifetime Earnings */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1rem 1.25rem',
                    borderRadius: '10px',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                    backgroundColor: 'rgba(59, 130, 246, 0.03)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                    Lifetime Earnings
                  </div>
                  <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#60a5fa', margin: '0.35rem 0 0.2rem 0' }}>
                    {fin?.totalLifetimeEarningsFormatted || '$0.00'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Total credited earnings (V1 & V2)</div>
                </div>

                {/* Total Withdrawn & Completed */}
                <div
                  className="card-surface"
                  style={{
                    padding: '1rem 1.25rem',
                    borderRadius: '10px',
                    border: '1px solid rgba(34, 197, 94, 0.25)',
                    backgroundColor: 'rgba(34, 197, 94, 0.03)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                    Settled Withdrawals
                  </div>
                  <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#4ade80', margin: '0.35rem 0 0.2rem 0' }}>
                    {fin?.totalWithdrawnFormatted || '$0.00'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    {fin?.totalOrdersCompleted ?? 0} completed boost orders
                  </div>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div
                style={{
                  display: 'flex',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  gap: '0.5rem',
                  marginTop: '0.5rem',
                }}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab('overview')}
                  style={{
                    padding: '0.65rem 1.15rem',
                    border: 'none',
                    background: 'none',
                    color: activeTab === 'overview' ? '#facc15' : '#9ca3af',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    borderBottom: activeTab === 'overview' ? '2px solid #facc15' : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>🪪 Overview & KYC</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('orders')}
                  style={{
                    padding: '0.65rem 1.15rem',
                    border: 'none',
                    background: 'none',
                    color: activeTab === 'orders' ? '#facc15' : '#9ca3af',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    borderBottom: activeTab === 'orders' ? '2px solid #facc15' : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>⚔️ Orders & Boosts</span>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      padding: '0.1rem 0.45rem',
                      borderRadius: '10px',
                      color: '#cbd5e1',
                    }}
                  >
                    {(orders?.totalAssigned || 0) + (orders?.totalCreated || 0) + (orders?.totalPreSigns || 0)}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('ledger')}
                  style={{
                    padding: '0.65rem 1.15rem',
                    border: 'none',
                    background: 'none',
                    color: activeTab === 'ledger' ? '#facc15' : '#9ca3af',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    borderBottom: activeTab === 'ledger' ? '2px solid #facc15' : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>💰 Ledger & Payouts</span>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      padding: '0.1rem 0.45rem',
                      borderRadius: '10px',
                      color: '#cbd5e1',
                    }}
                  >
                    {(ledger?.totalTransactions || 0) + (withdrawals?.totalRequests || 0)}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('audit')}
                  style={{
                    padding: '0.65rem 1.15rem',
                    border: 'none',
                    background: 'none',
                    color: activeTab === 'audit' ? '#facc15' : '#9ca3af',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    borderBottom: activeTab === 'audit' ? '2px solid #facc15' : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>📜 Audit Logs</span>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      padding: '0.1rem 0.45rem',
                      borderRadius: '10px',
                      color: '#cbd5e1',
                    }}
                  >
                    {auditTrail?.length || 0}
                  </span>
                </button>
              </div>

              {/* Tab 1: Overview & KYC */}
              {activeTab === 'overview' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '1.25rem' }}>
                  {/* Left Column: Profile & KYC */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {/* User Profile & Account Identity Card */}
                    <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#f3f4f6', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span>👤</span> User Profile &amp; Contact
                        </h4>
                        <span className={`badge ${profile?.isActive ? 'badge-green' : 'badge-danger'}`} style={{ fontSize: '0.72rem' }}>
                          {profile?.status || (profile?.isActive ? 'Active' : 'Suspended')}
                        </span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', fontSize: '0.82rem' }}>
                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Display Name</div>
                          <div style={{ color: '#f3f4f6', fontWeight: 600, marginTop: '2px' }}>
                            {profile?.displayName || '—'}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Username</div>
                          <div style={{ color: '#facc15', fontWeight: 500, marginTop: '2px' }}>
                            @{profile?.username || '—'}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Discord ID</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '2px' }}>
                            <code style={{ fontSize: '0.76rem', color: '#cbd5e1', backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
                              {profile?.discordId || discordId}
                            </code>
                            <button
                              type="button"
                              onClick={() => handleCopy(profile?.discordId || discordId, 'profDiscordId')}
                              style={{ background: 'none', border: 'none', color: copiedField === 'profDiscordId' ? '#4ade80' : '#9ca3af', cursor: 'pointer', fontSize: '0.72rem' }}
                            >
                              {copiedField === 'profDiscordId' ? '✓' : '📋'}
                            </button>
                          </div>
                        </div>

                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Advertiser Rank</div>
                          <div style={{ color: '#c084fc', fontWeight: 600, marginTop: '2px' }}>
                            {profile?.advertiserRank || 'Standard'}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Phone Number</div>
                          <div style={{ color: '#f3f4f6', fontWeight: 500, marginTop: '2px' }}>
                            {profile?.phoneNumber || 'Not provided'}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Telegram</div>
                          <div style={{ color: '#60a5fa', fontWeight: 500, marginTop: '2px' }}>
                            {profile?.telegramUsername ? `@${profile.telegramUsername.replace(/^@/, '')}` : '—'}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>WhatsApp</div>
                          <div style={{ color: '#4ade80', fontWeight: 500, marginTop: '2px' }}>
                            {profile?.whatsappNumber || '—'}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Member Since</div>
                          <div style={{ color: '#9ca3af', marginTop: '2px' }}>
                            {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : '—'}
                          </div>
                        </div>
                      </div>

                      {/* Roles Strip */}
                      <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Assigned Roles:</span>
                        {data?.roles && data.roles.length > 0 ? (
                          data.roles.map((r) => (
                            <span key={r.roleKey} className="badge badge-purple" style={{ fontSize: '0.7rem' }}>
                              {r.roleKey}
                            </span>
                          ))
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Standard User</span>
                        )}
                      </div>
                    </div>

                    {/* KYC Verification Status Card */}
                    <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#f3f4f6', fontWeight: 600 }}>
                          Pilot KYC & Identity Status
                        </h4>
                        <span
                          className={`badge ${
                            kyc?.isVerified || kyc?.status === 'verified'
                              ? 'badge-green'
                              : kyc?.status === 'pending'
                              ? 'badge-yellow'
                              : 'badge-secondary'
                          }`}
                        >
                          {kyc?.status?.toUpperCase() || 'NONE'}
                        </span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', fontSize: '0.82rem' }}>
                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Legal Name</div>
                          <div style={{ color: '#f3f4f6', fontWeight: 500, marginTop: '2px' }}>
                            {kyc?.legalName || 'Not provided'}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Country</div>
                          <div style={{ color: '#f3f4f6', fontWeight: 500, marginTop: '2px' }}>
                            {kyc?.country ? `${kyc.country.toUpperCase()}` : '—'}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>National ID / Passport</div>
                          <div style={{ color: '#f3f4f6', fontWeight: 500, marginTop: '2px' }}>
                            {kyc?.idNumber || '—'}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Contact Phone</div>
                          <div style={{ color: '#f3f4f6', fontWeight: 500, marginTop: '2px' }}>
                            {kyc?.contactInfo || '—'}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>VPN / Remote Access</div>
                          <div style={{ color: kyc?.vpnConfirmed ? '#4ade80' : '#f87171', fontWeight: 500, marginTop: '2px' }}>
                            {kyc?.vpnConfirmed ? '✓ Confirmed Allowed' : '✗ Restricted / Unconfirmed'}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Verified At</div>
                          <div style={{ color: '#f3f4f6', fontWeight: 500, marginTop: '2px' }}>
                            {kyc?.verifiedAt ? new Date(kyc.verifiedAt).toLocaleDateString() : 'Unverified'}
                          </div>
                        </div>
                      </div>

                      {/* Documents Strip */}
                      <div
                        style={{
                          marginTop: '1rem',
                          paddingTop: '0.85rem',
                          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.6rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Uploaded Docs:</span>
                        <span className={`badge ${kyc?.documents?.identity ? 'badge-green' : 'badge-secondary'}`} style={{ fontSize: '0.7rem' }}>
                          {kyc?.documents?.identity ? '✓ National ID' : '✗ National ID'}
                        </span>
                        <span className={`badge ${kyc?.documents?.passport ? 'badge-green' : 'badge-secondary'}`} style={{ fontSize: '0.7rem' }}>
                          {kyc?.documents?.passport ? '✓ Passport' : '✗ Passport'}
                        </span>
                        <span className={`badge ${kyc?.documents?.selfie ? 'badge-green' : 'badge-secondary'}`} style={{ fontSize: '0.7rem' }}>
                          {kyc?.documents?.selfie ? '✓ Selfie' : '✗ Selfie'}
                        </span>
                      </div>

                      {kyc?.adminNotes && (
                        <div
                          style={{
                            marginTop: '0.85rem',
                            padding: '0.65rem 0.85rem',
                            borderRadius: '6px',
                            backgroundColor: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid rgba(255, 255, 255, 0.06)',
                            fontSize: '0.78rem',
                            color: '#cbd5e1',
                          }}
                        >
                          <span style={{ color: '#facc15', fontWeight: 600 }}>Staff Notes: </span>
                          {kyc.adminNotes}
                        </div>
                      )}
                    </div>

                    {/* Pilot Verifications by Game */}
                    <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '10px' }}>
                      <h4 style={{ margin: '0 0 0.85rem 0', fontSize: '0.95rem', color: '#f3f4f6', fontWeight: 600 }}>
                        Per-Game Pilot Verifications ({kyc?.pilotVerifications?.length || 0})
                      </h4>

                      {kyc?.pilotVerifications && kyc.pilotVerifications.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                          {kyc.pilotVerifications.map((pv) => (
                            <div
                              key={pv.id}
                              style={{
                                padding: '0.75rem',
                                borderRadius: '6px',
                                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                                border: '1px solid rgba(255, 255, 255, 0.06)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: '0.5rem',
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: 600, color: '#f3f4f6', fontSize: '0.82rem' }}>
                                  {pv.gameName} ({pv.gameSlug})
                                </div>
                                <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: '2px' }}>
                                  Submitted: {new Date(pv.submittedAt).toLocaleDateString()}
                                  {pv.reviewedBy ? ` • Reviewer: ${pv.reviewedBy}` : ''}
                                </div>
                                {pv.reviewNote && (
                                  <div style={{ fontSize: '0.72rem', color: '#fbbf24', marginTop: '3px' }}>
                                    Note: {pv.reviewNote}
                                  </div>
                                )}
                              </div>
                              <span
                                className={`badge ${
                                  pv.status === 'APPROVED' ? 'badge-green' : pv.status === 'REJECTED' ? 'badge-danger' : 'badge-yellow'
                                }`}
                                style={{ fontSize: '0.7rem' }}
                              >
                                {pv.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', fontStyle: 'italic' }}>
                          No specific game pilot submissions recorded.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Payout Preferences, Game Approvals & Characters */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {/* Payout Preferences */}
                    <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '10px' }}>
                      <h4 style={{ margin: '0 0 0.85rem 0', fontSize: '0.95rem', color: '#f3f4f6', fontWeight: 600 }}>
                        Registered Payout Destination
                      </h4>

                      {fin?.payoutAddress ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.82rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#9ca3af' }}>Method / Network:</span>
                            <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                              {fin.payoutNetwork || 'Direct Address'}
                            </span>
                          </div>

                          {fin.bankAccountHolder && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ color: '#9ca3af' }}>Account Holder:</span>
                              <span style={{ color: '#f3f4f6', fontWeight: 500 }}>{fin.bankAccountHolder}</span>
                            </div>
                          )}

                          <div>
                            <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginBottom: '3px' }}>
                              {fin.bankIban ? 'Bank IBAN / Shetab:' : 'Crypto Wallet Address:'}
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                                padding: '0.45rem 0.65rem',
                                borderRadius: '6px',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                              }}
                            >
                              <code style={{ fontSize: '0.76rem', color: '#facc15', wordBreak: 'break-all' }}>
                                {fin.payoutAddress}
                              </code>
                              <button
                                type="button"
                                onClick={() => handleCopy(fin.payoutAddress!, 'payoutAddr')}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: copiedField === 'payoutAddr' ? '#4ade80' : '#9ca3af',
                                  fontSize: '0.75rem',
                                  cursor: 'pointer',
                                  marginLeft: '0.5rem',
                                }}
                              >
                                {copiedField === 'payoutAddr' ? '✓' : '📋'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', fontStyle: 'italic' }}>
                          No payout destination configured by user.
                        </div>
                      )}
                    </div>

                    {/* Game Approvals */}
                    <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '10px' }}>
                      <h4 style={{ margin: '0 0 0.85rem 0', fontSize: '0.95rem', color: '#f3f4f6', fontWeight: 600 }}>
                        Game & Service Approvals ({data?.gameApprovals?.length || 0})
                      </h4>

                      {data?.gameApprovals && data.gameApprovals.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                          {data.gameApprovals.map((ga) => (
                            <div
                              key={ga.id}
                              style={{
                                padding: '0.6rem 0.75rem',
                                borderRadius: '6px',
                                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                                border: '1px solid rgba(255, 255, 255, 0.06)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                            >
                              <div>
                                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#f3f4f6' }}>
                                  {ga.gameName}
                                  {ga.serviceName ? ` • ${ga.serviceName}` : ''}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
                                  Type: {ga.approvalType}
                                </div>
                              </div>
                              <span
                                className={`badge ${
                                  ga.status === 'APPROVED' ? 'badge-green' : ga.status === 'REJECTED' ? 'badge-danger' : 'badge-yellow'
                                }`}
                                style={{ fontSize: '0.7rem' }}
                              >
                                {ga.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', fontStyle: 'italic' }}>
                          No game/service approvals found.
                        </div>
                      )}
                    </div>

                    {/* WoW Characters */}
                    <div className="card-surface" style={{ padding: '1.25rem', borderRadius: '10px' }}>
                      <h4 style={{ margin: '0 0 0.85rem 0', fontSize: '0.95rem', color: '#f3f4f6', fontWeight: 600 }}>
                        Registered WoW Characters ({data?.wowCharacters?.length || 0})
                      </h4>

                      {data?.wowCharacters && data.wowCharacters.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                          {data.wowCharacters.map((c) => (
                            <div
                              key={c.id}
                              style={{
                                padding: '0.6rem 0.75rem',
                                borderRadius: '6px',
                                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                                border: '1px solid rgba(255, 255, 255, 0.06)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: '0.35rem',
                              }}
                            >
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <span style={{ fontWeight: 600, color: '#f3f4f6', fontSize: '0.82rem' }}>
                                    {c.characterName}
                                  </span>
                                  <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
                                    ({c.realm} - {c.region.toUpperCase()})
                                  </span>
                                  {c.isMain && (
                                    <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>
                                      Main
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '2px' }}>
                                  {c.characterClass} • {c.activeSpec} • {c.faction}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '0.78rem', color: '#facc15', fontWeight: 600 }}>
                                  ilvl: {c.itemLevel}
                                </div>
                                <div style={{ fontSize: '0.7rem', color: '#c084fc' }}>
                                  M+ Score: {c.mythicScore}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', fontStyle: 'italic' }}>
                          No WoW characters synced.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Orders & Boosts */}
              {activeTab === 'orders' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Sub-Tabs */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className={`btn btn-xs ${orderSubTab === 'assigned' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setOrderSubTab('assigned')}
                    >
                      Assigned Boosts ({orders?.assignedOrders?.length || 0})
                    </button>
                    <button
                      type="button"
                      className={`btn btn-xs ${orderSubTab === 'created' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setOrderSubTab('created')}
                    >
                      Created Orders ({orders?.createdOrders?.length || 0})
                    </button>
                    <button
                      type="button"
                      className={`btn btn-xs ${orderSubTab === 'presigns' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setOrderSubTab('presigns')}
                    >
                      Pre-Signs ({orders?.preSigns?.length || 0})
                    </button>
                  </div>

                  {/* Sub-Tab 1: Assigned Boosts */}
                  {orderSubTab === 'assigned' && (
                    <div className="card-surface" style={{ padding: '0', borderRadius: '10px', overflowX: 'auto' }}>
                      <table className="data-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                        <thead>
                          <tr>
                            <th>Order Ref</th>
                            <th>Title / Game</th>
                            <th>Platform</th>
                            <th>Order Status</th>
                            <th>Booster Share</th>
                            <th>Assigned At</th>
                            <th>Completed At</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders?.assignedOrders && orders.assignedOrders.length > 0 ? (
                            orders.assignedOrders.map((ao) => (
                              <tr key={ao.assignmentId}>
                                <td style={{ fontFamily: 'monospace', fontWeight: 600, color: '#f3f4f6' }}>
                                  {ao.orderRef}
                                </td>
                                <td style={{ color: '#cbd5e1' }}>{ao.title}</td>
                                <td>
                                  <span className="badge badge-secondary" style={{ fontSize: '0.7rem' }}>
                                    {ao.platform}
                                  </span>
                                </td>
                                <td>
                                  <span
                                    className={`badge ${
                                      ao.status === 'completed'
                                        ? 'badge-green'
                                        : ao.status === 'cancelled'
                                        ? 'badge-danger'
                                        : 'badge-yellow'
                                    }`}
                                    style={{ fontSize: '0.7rem' }}
                                  >
                                    {ao.status}
                                  </span>
                                </td>
                                <td style={{ color: '#4ade80', fontWeight: 600 }}>
                                  {ao.boosterPayoutShareFormatted}
                                </td>
                                <td style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                                  {new Date(ao.assignedAt).toLocaleDateString()}
                                </td>
                                <td style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                                  {ao.completedAt ? new Date(ao.completedAt).toLocaleDateString() : '—'}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                                No assigned booster orders found for this user.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Sub-Tab 2: Created Orders */}
                  {orderSubTab === 'created' && (
                    <div className="card-surface" style={{ padding: '0', borderRadius: '10px', overflowX: 'auto' }}>
                      <table className="data-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                        <thead>
                          <tr>
                            <th>Order Ref</th>
                            <th>Title</th>
                            <th>Platform</th>
                            <th>Status</th>
                            <th>Gross Total</th>
                            <th>Created At</th>
                            <th>Completed At</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders?.createdOrders && orders.createdOrders.length > 0 ? (
                            orders.createdOrders.map((co) => (
                              <tr key={co.orderId}>
                                <td style={{ fontFamily: 'monospace', fontWeight: 600, color: '#f3f4f6' }}>
                                  {co.orderRef}
                                </td>
                                <td style={{ color: '#cbd5e1' }}>{co.title}</td>
                                <td>
                                  <span className="badge badge-secondary" style={{ fontSize: '0.7rem' }}>
                                    {co.platform}
                                  </span>
                                </td>
                                <td>
                                  <span
                                    className={`badge ${
                                      co.status === 'completed'
                                        ? 'badge-green'
                                        : co.status === 'cancelled'
                                        ? 'badge-danger'
                                        : 'badge-yellow'
                                    }`}
                                    style={{ fontSize: '0.7rem' }}
                                  >
                                    {co.status}
                                  </span>
                                </td>
                                <td style={{ color: '#facc15', fontWeight: 600 }}>
                                  {co.grossAmountFormatted}
                                </td>
                                <td style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                                  {new Date(co.createdAt).toLocaleDateString()}
                                </td>
                                <td style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                                  {co.completedAt ? new Date(co.completedAt).toLocaleDateString() : '—'}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                                No client or advertiser orders placed by this user.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Sub-Tab 3: Pre-Signs */}
                  {orderSubTab === 'presigns' && (
                    <div className="card-surface" style={{ padding: '0', borderRadius: '10px', overflowX: 'auto' }}>
                      <table className="data-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                        <thead>
                          <tr>
                            <th>Order Ref</th>
                            <th>Title</th>
                            <th>Role / Claim</th>
                            <th>Character</th>
                            <th>Key Level</th>
                            <th>Presign Status</th>
                            <th>Registered Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders?.preSigns && orders.preSigns.length > 0 ? (
                            orders.preSigns.map((ps) => (
                              <tr key={ps.id}>
                                <td style={{ fontFamily: 'monospace', fontWeight: 600, color: '#f3f4f6' }}>
                                  {ps.orderRef}
                                </td>
                                <td style={{ color: '#cbd5e1' }}>{ps.orderTitle}</td>
                                <td>
                                  <span className="badge badge-purple" style={{ fontSize: '0.7rem' }}>
                                    {ps.registeredRole} ({ps.claimType})
                                  </span>
                                </td>
                                <td style={{ color: '#cbd5e1' }}>{ps.characterName || '—'}</td>
                                <td style={{ color: '#facc15' }}>{ps.hasKey ? `+${ps.keyLevel || 0}` : 'No key'}</td>
                                <td>
                                  <span
                                    className={`badge ${
                                      ps.status === 'claimed'
                                        ? 'badge-green'
                                        : ps.status === 'withdrawn'
                                        ? 'badge-secondary'
                                        : 'badge-yellow'
                                    }`}
                                    style={{ fontSize: '0.7rem' }}
                                  >
                                    {ps.status}
                                  </span>
                                </td>
                                <td style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                                  {new Date(ps.registeredAt).toLocaleDateString()}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                                No presign queue applications found.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Wallet Ledger & Withdrawals */}
              {activeTab === 'ledger' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Sub-Tabs */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className={`btn btn-xs ${ledgerSubTab === 'transactions' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setLedgerSubTab('transactions')}
                    >
                      Ledger History ({ledger?.transactions?.length || 0})
                    </button>
                    <button
                      type="button"
                      className={`btn btn-xs ${ledgerSubTab === 'withdrawals' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setLedgerSubTab('withdrawals')}
                    >
                      Withdrawals ({withdrawals?.requests?.length || 0})
                    </button>
                  </div>

                  {/* Ledger Transactions */}
                  {ledgerSubTab === 'transactions' && (
                    <div className="card-surface" style={{ padding: '0', borderRadius: '10px', overflowX: 'auto' }}>
                      <table className="data-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                        <thead>
                          <tr>
                            <th>Entry Ref</th>
                            <th>Entry Type</th>
                            <th>Direction</th>
                            <th>Amount</th>
                            <th>Description</th>
                            <th>Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledger?.transactions && ledger.transactions.length > 0 ? (
                            ledger.transactions.map((t) => (
                              <tr key={t.id}>
                                <td style={{ fontFamily: 'monospace', fontWeight: 600, color: '#f3f4f6' }}>
                                  {t.entryRef}
                                </td>
                                <td>
                                  <span className="badge badge-purple" style={{ fontSize: '0.7rem' }}>
                                    {t.type}
                                  </span>
                                </td>
                                <td>
                                  <span
                                    className={`badge ${t.direction === 'CREDIT' ? 'badge-green' : 'badge-danger'}`}
                                    style={{ fontSize: '0.7rem' }}
                                  >
                                    {t.direction}
                                  </span>
                                </td>
                                <td
                                  style={{
                                    fontWeight: 700,
                                    color: t.direction === 'CREDIT' ? '#4ade80' : '#f87171',
                                  }}
                                >
                                  {t.direction === 'CREDIT' ? `+${t.amountFormatted}` : `-${t.amountFormatted}`}
                                </td>
                                <td style={{ color: '#cbd5e1' }}>{t.description || '—'}</td>
                                <td style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                                  {new Date(t.createdAt).toLocaleString()}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                                No ledger transactions found for this user account.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Withdrawals */}
                  {ledgerSubTab === 'withdrawals' && (
                    <div className="card-surface" style={{ padding: '0', borderRadius: '10px', overflowX: 'auto' }}>
                      <table className="data-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                        <thead>
                          <tr>
                            <th>Withdrawal Ref</th>
                            <th>Method</th>
                            <th>Status</th>
                            <th>Requested</th>
                            <th>Fee</th>
                            <th>Net Paid</th>
                            <th>Destination</th>
                            <th>Tx / Receipt</th>
                            <th>Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {withdrawals?.requests && withdrawals.requests.length > 0 ? (
                            withdrawals.requests.map((w) => (
                              <tr key={w.id}>
                                <td style={{ fontFamily: 'monospace', fontWeight: 600, color: '#f3f4f6' }}>
                                  {w.withdrawalRef}
                                </td>
                                <td>
                                  <span className="badge badge-secondary" style={{ fontSize: '0.7rem' }}>
                                    {w.payoutMethod}
                                  </span>
                                </td>
                                <td>
                                  <span
                                    className={`badge ${
                                      ['PAID', 'COMPLETED', 'SETTLED'].includes(w.status)
                                        ? 'badge-green'
                                        : ['REJECTED', 'CANCELLED'].includes(w.status)
                                        ? 'badge-danger'
                                        : 'badge-yellow'
                                    }`}
                                    style={{ fontSize: '0.7rem' }}
                                  >
                                    {w.status}
                                  </span>
                                </td>
                                <td style={{ color: '#cbd5e1' }}>{w.requestedFormatted}</td>
                                <td style={{ color: '#9ca3af' }}>${w.fixedFeeUsd.toFixed(2)}</td>
                                <td style={{ color: '#4ade80', fontWeight: 700 }}>{w.netFormatted}</td>
                                <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#cbd5e1' }} title={w.destinationAddress}>
                                  {w.destinationAddress ? `${w.destinationAddress.slice(0, 10)}...` : '—'}
                                </td>
                                <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                  {w.externalTxHash ? (
                                    <span style={{ color: '#facc15' }} title={w.externalTxHash}>
                                      {w.externalTxHash.slice(0, 12)}...
                                    </span>
                                  ) : (
                                    <span style={{ color: '#6b7280' }}>—</span>
                                  )}
                                </td>
                                <td style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                                  {new Date(w.createdAt).toLocaleDateString()}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                                No payout withdrawal requests on file.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 4: Audit Logs */}
              {activeTab === 'audit' && (
                <div className="card-surface" style={{ padding: '0', borderRadius: '10px', overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                    <thead>
                      <tr>
                        <th>Date & Time</th>
                        <th>Action</th>
                        <th>Actor / Moderator</th>
                        <th>Reason / Notes</th>
                        <th>Payload Summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditTrail && auditTrail.length > 0 ? (
                        auditTrail.map((log) => (
                          <tr key={log.id}>
                            <td style={{ color: '#9ca3af', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                              {new Date(log.createdAt).toLocaleString()}
                            </td>
                            <td>
                              <span className="badge badge-purple" style={{ fontSize: '0.7rem' }}>
                                {log.action}
                              </span>
                            </td>
                            <td>
                              <div style={{ fontWeight: 600, color: '#f3f4f6' }}>{log.actorName}</div>
                              <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>{log.actorId}</div>
                            </td>
                            <td style={{ color: '#cbd5e1' }}>{log.reason || 'No recorded note'}</td>
                            <td style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                              {log.newValues ? (
                                <details>
                                  <summary style={{ cursor: 'pointer', color: '#facc15' }}>View Changes</summary>
                                  <pre
                                    style={{
                                      margin: '4px 0 0 0',
                                      padding: '6px',
                                      backgroundColor: 'rgba(0,0,0,0.3)',
                                      borderRadius: '4px',
                                      fontSize: '0.7rem',
                                      maxHeight: '100px',
                                      overflowY: 'auto',
                                    }}
                                  >
                                    {JSON.stringify(log.newValues, null, 2)}
                                  </pre>
                                </details>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                            No audit log entries recorded for this user.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div
          className="studio-modal-footer"
          style={{
            backgroundColor: '#12151f',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '1rem 1.75rem',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
};
