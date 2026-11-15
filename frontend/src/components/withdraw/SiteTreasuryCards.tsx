import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { SiteTreasuryData } from '../../types/withdraw';
import { adjustOwnerTreasury } from '../../services/withdraw';

interface SiteTreasuryCardsProps {
  treasury: SiteTreasuryData;
  onRefresh?: () => void;
}

export const SiteTreasuryCards: React.FC<SiteTreasuryCardsProps> = ({ treasury, onRefresh }) => {
  const [showModal, setShowModal] = useState(false);
  const [currency, setCurrency] = useState<'USDT' | 'IRT'>('USDT');
  const [action, setAction] = useState<'DEPOSIT' | 'WITHDRAW'>('DEPOSIT');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setFeedback({ text: 'Please enter a valid amount greater than zero.', type: 'error' });
      return;
    }

    if (!description.trim() || description.trim().length < 3) {
      setFeedback({ text: 'A description/reason (at least 3 characters) is required.', type: 'error' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await adjustOwnerTreasury({
        currency,
        action,
        amount: numAmount,
        description: description.trim(),
      });

      if (res.success) {
        setFeedback({
          text: `✓ ${res.message || 'Treasury adjusted successfully.'} New balance: ${res.newBalance} ${currency}`,
          type: 'success',
        });
        setAmount('');
        setDescription('');
        if (onRefresh) onRefresh();
        setTimeout(() => {
          setShowModal(false);
          setFeedback(null);
        }, 1500);
      } else {
        setFeedback({ text: res.error || 'Failed to adjust treasury balance.', type: 'error' });
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Error communicating with server.', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginBottom: '1.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.1rem' }}>🏛️</span>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            Site Treasury &amp; Settlement Balances
          </h3>
        </div>

        {treasury.isOwner && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setShowModal(true);
              setFeedback(null);
            }}
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.8rem' }}
          >
            ⚙️ Manage Treasury (Owner)
          </button>
        )}
      </div>

      {/* 4 Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
        }}
      >
        {/* Card 1: Site Order Revenue */}
        <Card highlight="none" style={{ padding: '1.15rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Site Revenue from Orders
            </span>
            <span style={{ fontSize: '1.1rem' }}>🛒</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--accent-lime)', fontFamily: 'monospace' }}>
            ${treasury.siteOrderRevenueUsd}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            Platform fee revenue from orders (Gross volume: ${treasury.siteGrossVolumeUsd})
          </div>
        </Card>

        {/* Card 2: Site Toman Treasury */}
        <Card highlight="none" style={{ padding: '1.15rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Site Toman Treasury
            </span>
            <span style={{ fontSize: '1.1rem' }}>🏦</span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--status-info)', fontFamily: 'monospace' }}>
            {Number(treasury.siteIrtBalance).toLocaleString()} <span style={{ fontSize: '0.85rem' }}>Toman</span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            Liquid bank balance reserved for Toman disbursements
          </div>
        </Card>

        {/* Card 3: Site USDT Treasury */}
        <Card highlight="none" style={{ padding: '1.15rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Site USDT Treasury
            </span>
            <span style={{ fontSize: '1.1rem' }}>💎</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#A78BFA', fontFamily: 'monospace' }}>
            {treasury.siteUsdtBalance} <span style={{ fontSize: '0.85rem' }}>USDT</span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            BSC BEP-20 crypto wallet liquid balance
          </div>
        </Card>

        {/* Card 4: Required for Settlement */}
        <Card highlight="none" style={{ padding: '1.15rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Required for Settlement
            </span>
            <span style={{ fontSize: '1.1rem' }}>⚖️</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--status-warning)', fontFamily: 'monospace' }}>
            ${treasury.settlementNeeded.totalUsd}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            Needs: {treasury.settlementNeeded.usdtNeeded} USDT + ~ {Number(treasury.settlementNeeded.irtNeeded).toLocaleString()} Toman ({treasury.settlementNeeded.pendingCount} pending in queue)
          </div>
        </Card>
      </div>

      {/* Owner Treasury Adjustment Modal */}
      {showModal && (
        <div className="studio-modal-backdrop" onClick={() => setShowModal(false)}>
          <div
            className="studio-modal-card"
            style={{ maxWidth: '480px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="studio-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                Platform Treasury Management (Owner)
              </h3>
              <button
                type="button"
                className="studio-modal-close"
                onClick={() => setShowModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAdjustSubmit}>
              <div className="studio-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Current balances info */}
                <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.04)', padding: '0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', display: 'flex', justifyContent: 'space-around' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>USDT Balance: </span>
                    <strong style={{ color: '#A78BFA' }}>{treasury.siteUsdtBalance} USDT</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Toman Balance: </span>
                    <strong style={{ color: 'var(--status-info)' }}>{Number(treasury.siteIrtBalance).toLocaleString()} Toman</strong>
                  </div>
                </div>

                {/* Currency Selection */}
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.35rem' }}>
                    Select Currency:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${currency === 'USDT' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setCurrency('USDT')}
                    >
                      💎 USDT (BEP-20)
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${currency === 'IRT' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setCurrency('IRT')}
                    >
                      🏦 Toman (IRT)
                    </button>
                  </div>
                </div>

                {/* Action Selection */}
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.35rem' }}>
                    Action Type:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${action === 'DEPOSIT' ? 'btn-success' : 'btn-outline'}`}
                      onClick={() => setAction('DEPOSIT')}
                    >
                      ➕ Deposit / Add Funds
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${action === 'WITHDRAW' ? 'btn-danger' : 'btn-outline'}`}
                      onClick={() => setAction('WITHDRAW')}
                    >
                      ➖ Withdraw Funds
                    </button>
                  </div>
                </div>

                {/* Amount input */}
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.35rem' }}>
                    Amount ({currency === 'USDT' ? 'USDT' : 'Toman'}):
                  </label>
                  <input
                    type="number"
                    step={currency === 'USDT' ? '0.01' : '1000'}
                    min="0"
                    className="input"
                    placeholder={currency === 'USDT' ? 'e.g. 500.00' : 'e.g. 25000000'}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    style={{ width: '100%', padding: '0.6rem 0.8rem', fontSize: '0.88rem' }}
                    required
                  />
                </div>

                {/* Description input */}
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.35rem' }}>
                    Reason / Description (Required):
                  </label>
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="e.g. Weekly liquidity injection for booster disbursements"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    style={{ width: '100%', padding: '0.6rem 0.8rem', fontSize: '0.85rem' }}
                    required
                  />
                </div>

                {feedback && (
                  <div
                    style={{
                      padding: '0.65rem 0.85rem',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.82rem',
                      backgroundColor: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: feedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                      border: `1px solid ${feedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    }}
                  >
                    {feedback.text}
                  </div>
                )}
              </div>

              <div className="studio-modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`btn ${action === 'DEPOSIT' ? 'btn-success' : 'btn-danger'} btn-sm`}
                >
                  {submitting ? 'Processing...' : action === 'DEPOSIT' ? 'Confirm Deposit' : 'Confirm Withdrawal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
