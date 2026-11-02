import React from 'react';
import { Link } from 'react-router-dom';
import { AdvertiserWallet } from '../../types/advertiser';

interface AdvertiserWalletCardProps {
  wallet: AdvertiserWallet;
}

export const AdvertiserWalletCard: React.FC<AdvertiserWalletCardProps> = ({ wallet }) => {
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
      {/* Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2
          style={{
            fontSize: '1.2rem',
            fontWeight: 800,
            color: 'var(--text-primary, #f4f4f6)',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span>💳</span> Advertiser WalletV2 Balances
        </h2>
        <span
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted, #9490a6)',
            backgroundColor: 'rgba(124, 58, 237, 0.15)',
            border: '1px solid rgba(124, 58, 237, 0.3)',
            padding: '0.2rem 0.5rem',
            borderRadius: '6px',
            fontFamily: 'monospace',
          }}
        >
          Double-Entry Accounting
        </span>
      </div>

      {/* Grid of Balances */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
        }}
      >
        {/* Spendable Available Balance */}
        <div
          style={{
            backgroundColor: 'rgba(13, 11, 18, 0.7)',
            borderRadius: '12px',
            border: '1px solid rgba(204, 255, 0, 0.25)',
            padding: '1.1rem',
          }}
        >
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted, #9490a6)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.4rem',
            }}
          >
            Available for Boosts
          </div>
          <div
            style={{
              fontSize: '1.5rem',
              fontWeight: 800,
              color: 'var(--accent-lime, #ccff00)',
              fontFamily: 'monospace',
            }}
          >
            ${wallet.availableUsd}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)', marginTop: '0.25rem' }}>
            {wallet.canPlaceOrders
              ? 'Ready to instantly fund orders'
              : 'Add funds to place boost orders'}
          </div>
        </div>

        {/* Reserved in Active Orders */}
        <div
          style={{
            backgroundColor: 'rgba(13, 11, 18, 0.7)',
            borderRadius: '12px',
            border: '1px solid rgba(124, 58, 237, 0.25)',
            padding: '1.1rem',
          }}
        >
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted, #9490a6)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.4rem',
            }}
          >
            Reserved in Escrow
          </div>
          <div
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: '#c4b5fd',
              fontFamily: 'monospace',
            }}
          >
            ${wallet.reservedUsd}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)', marginTop: '0.25rem' }}>
            Locked until boost completion
          </div>
        </div>

        {/* Pending Boost Earnings */}
        <div
          style={{
            backgroundColor: 'rgba(13, 11, 18, 0.7)',
            borderRadius: '12px',
            border: '1px solid rgba(148, 144, 166, 0.2)',
            padding: '1.1rem',
          }}
        >
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted, #9490a6)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.4rem',
            }}
          >
            Pending Earnings
          </div>
          <div
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: 'var(--text-primary, #f4f4f6)',
              fontFamily: 'monospace',
            }}
          >
            ${wallet.pendingEarningsUsd}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)', marginTop: '0.25rem' }}>
            Awaiting 24h release clock
          </div>
        </div>

        {/* Total Settled & Paid */}
        <div
          style={{
            backgroundColor: 'rgba(13, 11, 18, 0.7)',
            borderRadius: '12px',
            border: '1px solid rgba(148, 144, 166, 0.2)',
            padding: '1.1rem',
          }}
        >
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted, #9490a6)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.4rem',
            }}
          >
            Historical Disbursements
          </div>
          <div
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: 'var(--text-muted, #9490a6)',
              fontFamily: 'monospace',
            }}
          >
            ${wallet.paidUsd}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)', marginTop: '0.25rem' }}>
            Paid to USDT / Bank IBAN
          </div>
        </div>
      </div>

      {/* Wallet Action Links */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
        <Link
          to="/withdraw"
          style={{
            textDecoration: 'none',
            backgroundColor: 'rgba(124, 58, 237, 0.2)',
            border: '1px solid rgba(124, 58, 237, 0.4)',
            borderRadius: '8px',
            padding: '0.6rem 1.2rem',
            fontSize: '0.85rem',
            fontWeight: 700,
            color: '#ddd6fe',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'all 0.2s ease',
          }}
        >
          <span>💸</span> Request Withdrawal (USDT / IRT)
        </Link>

        <Link
          to="/wallet"
          style={{
            textDecoration: 'none',
            backgroundColor: 'rgba(35, 30, 52, 0.6)',
            border: '1px solid rgba(148, 144, 166, 0.3)',
            borderRadius: '8px',
            padding: '0.6rem 1.2rem',
            fontSize: '0.85rem',
            fontWeight: 600,
            color: 'var(--text-primary, #f4f4f6)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'all 0.2s ease',
          }}
        >
          <span>📑</span> View Full Ledger Activity
        </Link>
      </div>
    </div>
  );
};
