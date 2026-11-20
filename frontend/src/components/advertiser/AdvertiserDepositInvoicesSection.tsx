import React, { useState } from 'react';
import { DepositIntent } from '../../types/advertiser';
import { cancelAdvertiserDeposit } from '../../services/advertiser';

interface AdvertiserDepositInvoicesSectionProps {
  deposits?: DepositIntent[];
  onRefresh: () => void;
  onNotification: (message: string, type?: 'success' | 'info') => void;
  onDepositClick?: () => void;
  refreshing?: boolean;
}

export const AdvertiserDepositInvoicesSection: React.FC<AdvertiserDepositInvoicesSectionProps> = ({
  deposits = [],
  onRefresh,
  onNotification,
  onDepositClick,
  refreshing = false,
}) => {
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const handleCancel = async (deposit: DepositIntent) => {
    if (!window.confirm(`Are you sure you want to cancel deposit invoice #${deposit.intentRef} ($${deposit.amountUsd.toFixed(2)})?`)) {
      return;
    }

    setCancellingId(deposit.id);
    try {
      const res = await cancelAdvertiserDeposit(deposit.id);
      if (res.success) {
        onNotification(`Deposit invoice #${deposit.intentRef} cancelled successfully.`, 'info');
        onRefresh();
      } else {
        onNotification(res.message || 'Failed to cancel deposit invoice', 'info');
      }
    } catch (err: any) {
      onNotification(err?.message || 'Error occurred while cancelling deposit invoice', 'info');
    } finally {
      setCancellingId(null);
    }
  };

  const waitingCount = deposits.filter((d) => d.status === 'WAITING').length;
  const confirmedCount = deposits.filter((d) => d.status === 'CONFIRMED').length;

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface, #181524)',
        borderRadius: '16px',
        border: '1px solid rgba(124, 58, 237, 0.25)',
        padding: '1.75rem',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h3
            style={{
              fontSize: '1.2rem',
              fontWeight: 800,
              color: 'var(--text-primary, #f4f4f6)',
              margin: '0 0 0.25rem 0',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>📥</span> Deposit Invoices &amp; Top-Up History
          </h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted, #9490a6)' }}>
            Track cryptocurrency deposit invoices, execute hosted gateway payments, or cancel pending requests.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            style={{
              backgroundColor: 'rgba(124, 58, 237, 0.15)',
              border: '1px solid rgba(124, 58, 237, 0.35)',
              borderRadius: '8px',
              color: '#c4b5fd',
              padding: '0.5rem 0.9rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            <span>🔄</span> {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>

          {onDepositClick && (
            <button
              type="button"
              onClick={onDepositClick}
              style={{
                backgroundColor: 'var(--accent-lime, #ccff00)',
                color: '#0d0b12',
                border: 'none',
                borderRadius: '8px',
                padding: '0.5rem 1rem',
                fontSize: '0.85rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <span>+</span> New Crypto Deposit
            </button>
          )}
        </div>
      </div>

      {/* Summary Badges */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '0.35rem 0.75rem',
            borderRadius: '8px',
            fontSize: '0.8rem',
            color: '#e2e8f0',
          }}
        >
          Total Invoices: <strong>{deposits.length}</strong>
        </span>
        <span
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            padding: '0.35rem 0.75rem',
            borderRadius: '8px',
            fontSize: '0.8rem',
            color: '#fbbf24',
          }}
        >
          Awaiting Payment: <strong>{waitingCount}</strong>
        </span>
        <span
          style={{
            backgroundColor: 'rgba(204, 255, 0, 0.12)',
            border: '1px solid rgba(204, 255, 0, 0.35)',
            padding: '0.35rem 0.75rem',
            borderRadius: '8px',
            fontSize: '0.8rem',
            color: 'var(--accent-lime, #ccff00)',
          }}
        >
          Confirmed Top-Ups: <strong>{confirmedCount}</strong>
        </span>
      </div>

      {/* Invoices List / Table */}
      {deposits.length === 0 ? (
        <div
          style={{
            backgroundColor: 'rgba(13, 11, 18, 0.5)',
            border: '1px dashed rgba(124, 58, 237, 0.3)',
            borderRadius: '12px',
            padding: '2.5rem',
            textAlign: 'center',
            color: 'var(--text-muted, #9490a6)',
          }}
        >
          <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.75rem' }}>💳</span>
          <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600, color: '#f4f4f6' }}>
            No Deposit Invoices Found
          </p>
          <p style={{ margin: 0, fontSize: '0.85rem' }}>
            Click &quot;New Crypto Deposit&quot; to generate your first NOWPayments top-up invoice.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.875rem',
              color: 'var(--text-primary, #f4f4f6)',
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid rgba(124, 58, 237, 0.25)',
                  color: 'var(--text-muted, #9490a6)',
                  textAlign: 'left',
                }}
              >
                <th style={{ padding: '0.75rem 0.5rem' }}>Invoice Ref</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Amount</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Pay Currency</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Status</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Date Created</th>
                <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((dep) => {
                const hasValidUrl =
                  Boolean(dep.invoiceUrl) &&
                  (dep.invoiceUrl!.startsWith('http://') || dep.invoiceUrl!.startsWith('https://'));

                let statusBadge = (
                  <span
                    style={{
                      padding: '0.2rem 0.6rem',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      backgroundColor: 'rgba(148, 144, 166, 0.15)',
                      color: '#9490a6',
                    }}
                  >
                    {dep.status}
                  </span>
                );

                if (dep.status === 'WAITING') {
                  statusBadge = (
                    <span
                      style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        backgroundColor: 'rgba(245, 158, 11, 0.15)',
                        border: '1px solid rgba(245, 158, 11, 0.35)',
                        color: '#fbbf24',
                      }}
                    >
                      ⏳ Awaiting Payment
                    </span>
                  );
                } else if (dep.status === 'CONFIRMED') {
                  statusBadge = (
                    <span
                      style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        backgroundColor: 'rgba(204, 255, 0, 0.15)',
                        border: '1px solid rgba(204, 255, 0, 0.35)',
                        color: 'var(--accent-lime, #ccff00)',
                      }}
                    >
                      ✓ Confirmed &amp; Credited
                    </span>
                  );
                } else if (dep.status === 'CANCELLED') {
                  statusBadge = (
                    <span
                      style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        backgroundColor: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.35)',
                        color: '#f87171',
                      }}
                    >
                      ✕ Cancelled
                    </span>
                  );
                }

                return (
                  <tr
                    key={dep.id}
                    style={{
                      borderBottom: '1px solid rgba(124, 58, 237, 0.12)',
                    }}
                  >
                    <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace', fontWeight: 600 }}>
                      {dep.intentRef}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: 'var(--accent-lime, #ccff00)' }}>
                      ${Number(dep.amountUsd).toFixed(2)} USD
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <span
                        style={{
                          backgroundColor: 'rgba(124, 58, 237, 0.15)',
                          border: '1px solid rgba(124, 58, 237, 0.3)',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontFamily: 'monospace',
                          textTransform: 'uppercase',
                          color: '#c4b5fd',
                        }}
                      >
                        {dep.payCurrency}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>{statusBadge}</td>
                    <td style={{ padding: '0.75rem 0.5rem', color: '#9490a6', fontSize: '0.8rem' }}>
                      {new Date(dep.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: '0.5rem',
                        }}
                      >
                        {dep.status === 'WAITING' && (
                          <>
                            {hasValidUrl ? (
                              <a
                                href={dep.invoiceUrl!}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  backgroundColor: 'var(--accent-lime, #ccff00)',
                                  color: '#0d0b12',
                                  padding: '0.35rem 0.75rem',
                                  borderRadius: '6px',
                                  fontSize: '0.75rem',
                                  fontWeight: 800,
                                  textDecoration: 'none',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                }}
                              >
                                Pay via NOWPayments ↗
                              </a>
                            ) : (
                              <span
                                style={{
                                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                                  border: '1px solid rgba(245, 158, 11, 0.35)',
                                  color: '#fbbf24',
                                  padding: '0.3rem 0.6rem',
                                  borderRadius: '6px',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                }}
                                title="Live payment gateway is in setup mode. Once confirmed by administration, funds are credited automatically."
                              >
                                ⏳ Gateway Pending Setup
                              </span>
                            )}

                            <button
                              type="button"
                              onClick={() => handleCancel(dep)}
                              disabled={cancellingId === dep.id}
                              style={{
                                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                border: '1px solid rgba(239, 68, 68, 0.35)',
                                color: '#f87171',
                                padding: '0.3rem 0.65rem',
                                borderRadius: '6px',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {cancellingId === dep.id ? 'Cancelling...' : 'Cancel'}
                            </button>
                          </>
                        )}

                        {dep.status === 'CONFIRMED' && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--accent-lime, #ccff00)', fontWeight: 600 }}>
                            ✓ Credited
                          </span>
                        )}

                        {dep.status === 'CANCELLED' && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9490a6)' }}>
                            Cancelled
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
