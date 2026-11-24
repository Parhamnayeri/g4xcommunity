/**
 * frontend/src/pages/ExchangeTransactionDetailsPage.tsx
 *
 * G4X In-Game Currency & Items Exchange — Phase 8 (Final):
 * Independent Transaction Details Page (Dossier View).
 *
 * Displays ALL 16 Mandatory PRD §12 Fields:
 *  1. Trade ID & Trade Code
 *  2. Order ID & Order Code
 *  3. Counterparties (Buyer & Seller) with Live Reputation & Zero PII Leakage
 *  4. Game, Currency & Region
 *  5. Quantity (Base Units, Unit Label, Multiplier, Formatted Display)
 *  6. Unit Price ($ / cents)
 *  7. Gross Value ($ / cents)
 *  8. Buyer Fee & BPS Snapshot
 *  9. Seller Fee & BPS Snapshot (+ Net Seller Payout)
 * 10. Payment Method (G4X Wallet, NOWPayments Crypto, Bank Transfer)
 * 11. Payment Status, Gateway Reference & Confirmation Timestamp
 * 12. Delivery Status, Method & Discord Room / Archive Link
 * 13. Delivery Proofs Gallery & Evidence Links
 * 14. Approval Status, Buyer Confirmation, Waiting Minutes & Dispute Info
 * 15. Settlement Details & Central Ledger Transaction IDs
 * 16. Complete Vertical Event Timeline Stepper
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  ExchangeTransactionDetailsItem,
  UserReputationSummary,
} from '../types/exchange';
import { getExchangeTransactionDetails } from '../services/exchangeMarketplace';

export const ExchangeTransactionDetailsPage: React.FC = () => {
  const { tradeId } = useParams<{ tradeId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [transaction, setTransaction] = useState<ExchangeTransactionDetailsItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTransaction = useCallback(async () => {
    if (!tradeId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getExchangeTransactionDetails(tradeId);
      if (res && res.transaction) {
        setTransaction(res.transaction);
      } else {
        setError('Transaction details could not be retrieved.');
      }
    } catch (err: any) {
      setError(err?.message || 'Access Denied: You are not authorized to view this transaction.');
    } finally {
      setLoading(false);
    }
  }, [tradeId]);

  useEffect(() => {
    loadTransaction();
  }, [loadTransaction]);

  const handlePrint = () => {
    window.print();
  };

  const renderReputationBadge = (rep: UserReputationSummary) => {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.2rem 0.5rem',
          borderRadius: '9999px',
          backgroundColor: `${rep.tierColor}1A`,
          border: `1px solid ${rep.tierColor}4D`,
          color: rep.tierColor,
          fontWeight: 700,
          fontSize: '0.72rem',
        }}
      >
        <span>★</span>
        <span>{rep.tier}</span>
        <span style={{ opacity: 0.8 }}>({rep.rating.toFixed(1)})</span>
      </span>
    );
  };

  const renderStatusPill = (status: string) => {
    let bg = 'rgba(156, 163, 175, 0.15)';
    let color = '#9CA3AF';
    let border = '1px solid rgba(156, 163, 175, 0.3)';

    if (['COMPLETED', 'RELEASED', 'APPROVED', 'VERIFIED'].includes(status)) {
      bg = 'rgba(16, 185, 129, 0.15)';
      color = '#10B981';
      border = '1px solid rgba(16, 185, 129, 0.4)';
    } else if (['AWAITING_PAYMENT', 'PENDING', 'AWAITING_PROOF'].includes(status)) {
      bg = 'rgba(245, 158, 11, 0.15)';
      color = '#F59E0B';
      border = '1px solid rgba(245, 158, 11, 0.4)';
    } else if (['PAYMENT_CONFIRMED', 'DELIVERY_IN_PROGRESS', 'PROOF_SUBMITTED', 'ACTIVE'].includes(status)) {
      bg = 'rgba(59, 130, 246, 0.15)';
      color = '#3B82F6';
      border = '1px solid rgba(59, 130, 246, 0.4)';
    } else if (status === 'AWAITING_FINAL_APPROVAL') {
      bg = 'rgba(139, 92, 246, 0.2)';
      color = '#A78BFA';
      border = '1px solid rgba(139, 92, 246, 0.5)';
    } else if (['DISPUTED', 'CANCELLED', 'FROZEN_DISPUTE', 'REJECTED'].includes(status)) {
      bg = 'rgba(239, 68, 68, 0.15)';
      color = '#EF4444';
      border = '1px solid rgba(239, 68, 68, 0.4)';
    }

    return (
      <span
        style={{
          display: 'inline-block',
          padding: '0.25rem 0.65rem',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: 700,
          letterSpacing: '0.04em',
          backgroundColor: bg,
          color,
          border,
        }}
      >
        {status.replace(/_/g, ' ')}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* ─── Top Bar / Breadcrumb ─── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => navigate('/exchange/dashboard')}
            style={{
              background: '#27272A',
              color: '#F4F4F5',
              border: 'none',
              borderRadius: '6px',
              padding: '0.4rem 0.8rem',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ← Back to Dashboard
          </button>
          <span style={{ color: '#71717A' }}>/</span>
          <span style={{ fontSize: '0.85rem', color: '#A1A1AA' }}>Transaction Dossier</span>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={handlePrint}
            style={{
              backgroundColor: '#18181B',
              border: '1px solid #3F3F46',
              color: '#F4F4F5',
              borderRadius: '6px',
              padding: '0.4rem 0.9rem',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            🖨 Print / Export PDF
          </button>
          {transaction && (
            <Link
              to={`/exchange/trades/${transaction.tradeId}`}
              style={{
                backgroundColor: '#3B82F6',
                color: '#FFFFFF',
                borderRadius: '6px',
                padding: '0.4rem 0.9rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Open Trade Room →
            </Link>
          )}
        </div>
      </div>

      {/* ─── Error Alert ─── */}
      {error && (
        <div
          style={{
            padding: '1.25rem',
            borderRadius: '8px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#F87171',
            marginBottom: '1.5rem',
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Unauthorized or Not Found</h3>
          <p style={{ margin: 0, fontSize: '0.88rem' }}>{error}</p>
        </div>
      )}

      {/* ─── Loading State ─── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: '#A1A1AA' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              border: '3px solid #27272A',
              borderTopColor: '#3B82F6',
              borderRadius: '50%',
              margin: '0 auto 1rem',
              animation: 'spin 1s linear infinite',
            }}
          />
          <p style={{ margin: 0, fontSize: '0.9rem' }}>Loading immutable transaction dossier...</p>
        </div>
      )}

      {/* ─── 16 Mandatory PRD §12 Fields Dossier ─── */}
      {!loading && transaction && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Header Card: Field 1, 2, 4, 12 */}
          <div
            style={{
              backgroundColor: '#18181B',
              borderRadius: '10px',
              padding: '1.5rem',
              border: '1px solid #27272A',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, color: '#F4F4F5' }}>
                    {transaction.tradeCode}
                  </h2>
                  {renderStatusPill(transaction.deliveryStatus.tradeStatus)}
                </div>
                <div style={{ fontSize: '0.82rem', color: '#71717A' }}>
                  Trade ID: <code style={{ color: '#A1A1AA' }}>{transaction.tradeId}</code> • Buy Order:{' '}
                  <Link
                    to={`/exchange/orders/${transaction.orderId}`}
                    style={{ color: '#3B82F6', textDecoration: 'none', fontWeight: 600 }}
                  >
                    {transaction.orderCode}
                  </Link>
                </div>
              </div>

              {/* Game, Currency & Discord Room Badges */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                <span
                  style={{
                    backgroundColor: '#27272A',
                    color: '#E4E4E7',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                  }}
                >
                  🎮 {transaction.game.name}
                </span>
                <span
                  style={{
                    backgroundColor: '#27272A',
                    color: '#FACC15',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                  }}
                >
                  🪙 {transaction.currency.name}
                </span>
                {transaction.region && (
                  <span
                    style={{
                      backgroundColor: '#27272A',
                      color: '#A1A1AA',
                      padding: '0.3rem 0.65rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                    }}
                  >
                    🌐 {transaction.region.name}
                  </span>
                )}
                {transaction.deliveryStatus.discordRoom && (
                  <a
                    href={transaction.deliveryStatus.discordRoom.channelUrl || '#'}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      backgroundColor: 'rgba(88, 101, 242, 0.15)',
                      color: '#5865F2',
                      border: '1px solid rgba(88, 101, 242, 0.4)',
                      padding: '0.3rem 0.65rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    💬 #{transaction.deliveryStatus.discordRoom.channelName}
                    {transaction.deliveryStatus.discordRoom.isArchived && ' (Archived)'}
                  </a>
                )}
              </div>
            </div>

            {/* Created / Updated Timestamps */}
            <div style={{ fontSize: '0.75rem', color: '#71717A', borderTop: '1px solid #27272A', paddingTop: '0.75rem' }}>
              Initiated: {new Date(transaction.createdAt).toLocaleString()} • Last Updated:{' '}
              {new Date(transaction.updatedAt).toLocaleString()}
            </div>
          </div>

          {/* Field 3: Verified Counterparties Card (Zero PII, Live Reputation) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '1rem',
            }}
          >
            {/* Buyer Profile */}
            <div
              style={{
                backgroundColor: '#18181B',
                borderRadius: '8px',
                padding: '1.25rem',
                border: '1px solid #27272A',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#A1A1AA', fontWeight: 600 }}>BUYER PROFILE</span>
                {renderReputationBadge(transaction.buyer.reputation)}
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#F4F4F5', marginBottom: '0.25rem' }}>
                {transaction.buyer.displayName}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#71717A', marginBottom: '0.75rem' }}>
                Discord: <code style={{ color: '#A1A1AA' }}>{transaction.buyer.username}</code>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#A1A1AA', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div>Score: <strong style={{ color: '#F4F4F5' }}>{transaction.buyer.reputation.score}/100</strong></div>
                <div>Completion Rate: <strong style={{ color: '#10B981' }}>{transaction.buyer.reputation.completionRatePercent}%</strong></div>
                <div>Completed Trades: <strong style={{ color: '#F4F4F5' }}>{transaction.buyer.reputation.completedTradesCount}</strong></div>
              </div>
            </div>

            {/* Seller Profile */}
            <div
              style={{
                backgroundColor: '#18181B',
                borderRadius: '8px',
                padding: '1.25rem',
                border: '1px solid #27272A',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#A1A1AA', fontWeight: 600 }}>SELLER PROFILE</span>
                {renderReputationBadge(transaction.seller.reputation)}
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#F4F4F5', marginBottom: '0.25rem' }}>
                {transaction.seller.displayName}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#71717A', marginBottom: '0.75rem' }}>
                Discord: <code style={{ color: '#A1A1AA' }}>{transaction.seller.username}</code>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#A1A1AA', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div>Score: <strong style={{ color: '#F4F4F5' }}>{transaction.seller.reputation.score}/100</strong></div>
                <div>Completion Rate: <strong style={{ color: '#10B981' }}>{transaction.seller.reputation.completionRatePercent}%</strong></div>
                <div>Completed Trades: <strong style={{ color: '#F4F4F5' }}>{transaction.seller.reputation.completedTradesCount}</strong></div>
              </div>
            </div>
          </div>

          {/* Field 5–9: Financial & Commercial Breakdown Card */}
          <div
            style={{
              backgroundColor: '#18181B',
              borderRadius: '8px',
              padding: '1.5rem',
              border: '1px solid #27272A',
            }}
          >
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#F4F4F5', margin: '0 0 1rem' }}>
              Financial Breakdown & Exact Snapshots
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
                marginBottom: '1.25rem',
              }}
            >
              <div>
                <span style={{ fontSize: '0.75rem', color: '#71717A' }}>Trade Quantity (Field 5)</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#FACC15' }}>
                  {transaction.quantity.formattedDisplay}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#71717A' }}>
                  Base: {transaction.quantity.quantityBaseUnits} units
                </div>
              </div>

              <div>
                <span style={{ fontSize: '0.75rem', color: '#71717A' }}>Unit Price (Field 6)</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#F4F4F5' }}>
                  {transaction.unitPriceUsd}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#71717A' }}>
                  {transaction.unitPriceCents} cents / unit
                </div>
              </div>

              <div>
                <span style={{ fontSize: '0.75rem', color: '#71717A' }}>Gross Trade Value (Field 7)</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#F4F4F5' }}>
                  {transaction.grossValueUsd}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#71717A' }}>
                  {transaction.grossValueCents} cents
                </div>
              </div>

              <div>
                <span style={{ fontSize: '0.75rem', color: '#71717A' }}>Buyer Fee (Field 8)</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#A1A1AA' }}>
                  {transaction.buyerFeeUsd}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#71717A' }}>
                  {transaction.buyerCommissionBpsSnapshot / 100}% fee snapshot
                </div>
              </div>

              <div>
                <span style={{ fontSize: '0.75rem', color: '#71717A' }}>Seller Fee (Field 9)</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#A1A1AA' }}>
                  {transaction.sellerFeeUsd}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#71717A' }}>
                  {transaction.sellerCommissionBpsSnapshot / 100}% fee snapshot
                </div>
              </div>

              <div>
                <span style={{ fontSize: '0.75rem', color: '#71717A' }}>Net Seller Payout</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#10B981' }}>
                  {transaction.netSellerUsd}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#71717A' }}>
                  {transaction.netSellerCents} cents net credited
                </div>
              </div>
            </div>

            {/* Total Payable Summary Bar */}
            <div
              style={{
                backgroundColor: '#27272A',
                padding: '0.9rem 1.25rem',
                borderRadius: '6px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <span style={{ fontSize: '0.75rem', color: '#A1A1AA' }}>Total Buyer Payable:</span>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#3B82F6' }}>
                  {transaction.buyerTotalPayableUsd}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.75rem', color: '#A1A1AA' }}>Payment Method (Field 10):</span>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#F4F4F5' }}>
                  {transaction.paymentMethod}
                </div>
              </div>
            </div>
          </div>

          {/* Field 10, 11: Payment & Escrow Status */}
          <div
            style={{
              backgroundColor: '#18181B',
              borderRadius: '8px',
              padding: '1.25rem',
              border: '1px solid #27272A',
            }}
          >
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#F4F4F5', margin: '0 0 0.75rem' }}>
              Payment & Escrow Lifecycle (Field 10 & 11)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', fontSize: '0.82rem' }}>
              <div>
                <span style={{ color: '#71717A' }}>Payment Status:</span>
                <div>{renderStatusPill(transaction.paymentStatus.status)}</div>
              </div>
              <div>
                <span style={{ color: '#71717A' }}>Payment Code:</span>
                <div style={{ fontWeight: 600, color: '#F4F4F5' }}>{transaction.paymentStatus.paymentCode || 'N/A'}</div>
              </div>
              <div>
                <span style={{ color: '#71717A' }}>Confirmed At:</span>
                <div style={{ color: '#D4D4D8' }}>
                  {transaction.paymentStatus.confirmedAt ? new Date(transaction.paymentStatus.confirmedAt).toLocaleString() : 'Pending Confirmation'}
                </div>
              </div>
              <div>
                <span style={{ color: '#71717A' }}>Gateway Status:</span>
                <div style={{ color: '#D4D4D8' }}>{transaction.paymentStatus.gatewayStatus || 'G4X Central Wallet Escrow'}</div>
              </div>
            </div>
          </div>

          {/* Field 13: Delivery Proofs Gallery */}
          <div
            style={{
              backgroundColor: '#18181B',
              borderRadius: '8px',
              padding: '1.25rem',
              border: '1px solid #27272A',
            }}
          >
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#F4F4F5', margin: '0 0 0.75rem' }}>
              Delivery Proofs & Evidence Gallery (Field 13)
            </h3>
            {transaction.proofs.length === 0 ? (
              <p style={{ color: '#71717A', fontSize: '0.85rem', margin: 0 }}>No delivery proofs submitted yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {transaction.proofs.map((proof) => (
                  <div
                    key={proof.id}
                    style={{
                      backgroundColor: '#27272A',
                      borderRadius: '6px',
                      padding: '0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem',
                      fontSize: '0.82rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, color: '#10B981' }}>
                        {proof.submitterRole} Proof ({proof.proofType})
                      </span>
                      <span style={{ color: '#71717A', fontSize: '0.75rem' }}>
                        {new Date(proof.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {proof.inGameDetails && (
                      <div style={{ color: '#D4D4D8' }}>
                        In-Game Target: <strong>{proof.inGameDetails}</strong>
                      </div>
                    )}
                    {proof.note && <div style={{ color: '#A1A1AA' }}>Note: {proof.note}</div>}
                    {proof.fileUrl && (
                      <div>
                        <a
                          href={proof.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#3B82F6', textDecoration: 'none', fontWeight: 600 }}
                        >
                          📎 View Uploaded File / Screenshot →
                        </a>
                      </div>
                    )}
                    {proof.evidenceLinks.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {proof.evidenceLinks.map((link, idx) => (
                          <a
                            key={idx}
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: '#3B82F6', textDecoration: 'none', fontSize: '0.75rem' }}
                          >
                            🔗 External Link {idx + 1}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Field 14: Approval & Dispute Information */}
          <div
            style={{
              backgroundColor: '#18181B',
              borderRadius: '8px',
              padding: '1.25rem',
              border: '1px solid #27272A',
            }}
          >
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#F4F4F5', margin: '0 0 0.75rem' }}>
              Approval & Dispute Verification (Field 14)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', fontSize: '0.82rem' }}>
              <div>
                <span style={{ color: '#71717A' }}>Buyer Confirmed:</span>
                <div style={{ color: '#D4D4D8' }}>
                  {transaction.approvalStatus.buyerConfirmedAt
                    ? new Date(transaction.approvalStatus.buyerConfirmedAt).toLocaleString()
                    : 'Awaiting Buyer Confirmation'}
                </div>
              </div>
              <div>
                <span style={{ color: '#71717A' }}>Staff Final Approved:</span>
                <div style={{ color: '#D4D4D8' }}>
                  {transaction.approvalStatus.finalApprovedAt
                    ? new Date(transaction.approvalStatus.finalApprovedAt).toLocaleString()
                    : 'Awaiting Staff Review'}
                </div>
              </div>
              {transaction.approvalStatus.waitingMinutes !== null && transaction.approvalStatus.waitingMinutes !== undefined && (
                <div>
                  <span style={{ color: '#71717A' }}>Waiting Duration:</span>
                  <div style={{ color: '#A78BFA', fontWeight: 700 }}>
                    ⏱ {transaction.approvalStatus.waitingMinutes} minutes
                  </div>
                </div>
              )}
            </div>

            {/* Dispute Card if present */}
            {transaction.approvalStatus.dispute && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '0.85rem',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 700, color: '#EF4444' }}>
                    Dispute: {transaction.approvalStatus.dispute.disputeCode} ({transaction.approvalStatus.dispute.category})
                  </span>
                  {renderStatusPill(transaction.approvalStatus.dispute.status)}
                </div>
                <p style={{ margin: '0.25rem 0', fontSize: '0.82rem', color: '#D4D4D8' }}>
                  {transaction.approvalStatus.dispute.description}
                </p>
                {transaction.approvalStatus.dispute.outcome && (
                  <div style={{ fontSize: '0.78rem', color: '#10B981', fontWeight: 600 }}>
                    Outcome: {transaction.approvalStatus.dispute.outcome}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Field 15: Settlement & Central Ledger IDs */}
          {transaction.settlementDetails && (
            <div
              style={{
                backgroundColor: '#18181B',
                borderRadius: '8px',
                padding: '1.25rem',
                border: '1px solid #10B981',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#10B981', margin: 0 }}>
                  Immutable Settlement Record (Field 15)
                </h3>
                <span
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    color: '#10B981',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '4px',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                  }}
                >
                  {transaction.settlementDetails.settlementCode}
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem',
                  fontSize: '0.82rem',
                  marginBottom: '1rem',
                }}
              >
                <div>
                  <span style={{ color: '#71717A' }}>Seller Net Payout:</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#10B981' }}>
                    {transaction.settlementDetails.sellerNetPayoutUsd}
                  </div>
                </div>
                {transaction.settlementDetails.buyerRefundCents > 0 && (
                  <div>
                    <span style={{ color: '#71717A' }}>Buyer Refund:</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#3B82F6' }}>
                      {transaction.settlementDetails.buyerRefundUsd}
                    </div>
                  </div>
                )}
                {transaction.settlementDetails.g4xTotalRevenueUsd && (
                  <div>
                    <span style={{ color: '#71717A' }}>Platform Revenue (Staff Only):</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#FACC15' }}>
                      {transaction.settlementDetails.g4xTotalRevenueUsd}
                    </div>
                  </div>
                )}
                <div>
                  <span style={{ color: '#71717A' }}>Settled At:</span>
                  <div style={{ color: '#D4D4D8' }}>
                    {new Date(transaction.settlementDetails.settledAt).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Central Ledger Transaction Traceability */}
              <div
                style={{
                  backgroundColor: '#27272A',
                  borderRadius: '6px',
                  padding: '0.75rem',
                  fontSize: '0.75rem',
                  color: '#A1A1AA',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.3rem',
                }}
              >
                <div style={{ fontWeight: 700, color: '#F4F4F5' }}>Central G4X Ledger Audit Trails:</div>
                {transaction.settlementDetails.buyerEscrowDebitLedgerId && (
                  <div>
                    Buyer Escrow Debit ID:{' '}
                    <code style={{ color: '#3B82F6' }}>{transaction.settlementDetails.buyerEscrowDebitLedgerId}</code>
                  </div>
                )}
                {transaction.settlementDetails.sellerCreditLedgerId && (
                  <div>
                    Seller Payout Credit ID:{' '}
                    <code style={{ color: '#10B981' }}>{transaction.settlementDetails.sellerCreditLedgerId}</code>
                  </div>
                )}
                {transaction.settlementDetails.buyerRefundLedgerId && (
                  <div>
                    Buyer Refund Ledger ID:{' '}
                    <code style={{ color: '#F59E0B' }}>{transaction.settlementDetails.buyerRefundLedgerId}</code>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Field 16: Complete Vertical Event Timeline Stepper */}
          <div
            style={{
              backgroundColor: '#18181B',
              borderRadius: '8px',
              padding: '1.5rem',
              border: '1px solid #27272A',
            }}
          >
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#F4F4F5', margin: '0 0 1rem' }}>
              Vertical Event Timeline & Audit Trail (Field 16)
            </h3>
            {transaction.timeline.length === 0 ? (
              <p style={{ color: '#71717A', fontSize: '0.85rem', margin: 0 }}>No audit events logged.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderLeft: '2px solid #27272A', paddingLeft: '1rem' }}>
                {transaction.timeline.map((event, idx) => (
                  <div key={event.id || idx} style={{ position: 'relative' }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: '-1.45rem',
                        top: '0.2rem',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: '#3B82F6',
                      }}
                    />
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#F4F4F5' }}>
                        {event.eventType}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: '#71717A' }}>
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#A1A1AA', marginTop: '0.15rem' }}>
                      Actor: <strong style={{ color: '#D4D4D8' }}>{event.actorRole}</strong>
                      {event.fromStatus && event.toStatus && (
                        <span>
                          {' '}(Transition: <code>{event.fromStatus}</code> → <code>{event.toStatus}</code>)
                        </span>
                      )}
                    </div>
                    {event.note && (
                      <div style={{ fontSize: '0.75rem', color: '#71717A', marginTop: '0.2rem' }}>
                        {event.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
