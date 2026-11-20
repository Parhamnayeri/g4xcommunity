import React from 'react';
import { Link } from 'react-router-dom';
import { AdvertiserWallet } from '../../types/advertiser';

interface AdvertiserWalletCardProps {
  wallet: AdvertiserWallet;
  onDepositClick?: () => void;
  onWithdrawClick?: () => void;
}

export const AdvertiserWalletCard: React.FC<AdvertiserWalletCardProps> = ({
  wallet,
  onDepositClick,
  onWithdrawClick,
}) => {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
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
          <span>💳</span> Advertiser Wallet Balances
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {wallet?.isFrozen && (
            <span
              style={{
                fontSize: '0.75rem',
                color: '#f87171',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                padding: '0.2rem 0.6rem',
                borderRadius: '6px',
                fontWeight: 700,
              }}
            >
              ⚠️ Wallet Frozen
            </span>
          )}
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
            Double-Entry V2
          </span>
        </div>
      </div>

      {wallet?.isFrozen && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: '10px',
            padding: '0.75rem 1rem',
            color: '#fca5a5',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
          }}
        >
          <span>⚠️</span>
          <span>
            <strong>Account Balance Frozen:</strong> An administrative hold is active on your wallet. Order escrow deductions and withdrawals are restricted. Contact Support if you need assistance.
          </span>
        </div>
      )}

      {/* Grid of Balances */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
            ${wallet?.availableUsd ?? '0.00'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)', marginTop: '0.25rem' }}>
            {wallet?.canPlaceOrders
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
            ${wallet?.reservedUsd ?? '0.00'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)', marginTop: '0.25rem' }}>
            Locked until boost completion
          </div>
        </div>

        {/* Frozen / Hold Funds */}
        <div
          style={{
            backgroundColor: 'rgba(13, 11, 18, 0.7)',
            borderRadius: '12px',
            border: wallet?.frozenCents && wallet.frozenCents > 0
              ? '1px solid rgba(239, 68, 68, 0.35)'
              : '1px solid rgba(148, 144, 166, 0.2)',
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
            Frozen / Hold
          </div>
          <div
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: wallet?.frozenCents && wallet.frozenCents > 0 ? '#f87171' : 'var(--text-muted, #9490a6)',
              fontFamily: 'monospace',
            }}
          >
            ${wallet?.frozenUsd || '0.00'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)', marginTop: '0.25rem' }}>
            {wallet?.frozenCents && wallet.frozenCents > 0 ? 'Admin compliance hold' : 'No funds currently on hold'}
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
            ${wallet?.pendingEarningsUsd ?? '0.00'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9490a6)', marginTop: '0.25rem' }}>
            Awaiting 24h release clock
          </div>
        </div>
      </div>

      {/* Wallet Action Links */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
        {onDepositClick && (
          <button
            type="button"
            onClick={onDepositClick}
            style={{
              backgroundColor: 'var(--accent-lime, #ccff00)',
              color: '#0d0b12',
              border: 'none',
              borderRadius: '8px',
              padding: '0.65rem 1.25rem',
              fontSize: '0.85rem',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s ease',
            }}
          >
            <span>⚡</span> Top Up Wallet (Crypto / NOWPayments)
          </button>
        )}

        {onWithdrawClick ? (
          <button
            type="button"
            onClick={onWithdrawClick}
            disabled={wallet.isFrozen}
            style={{
              backgroundColor: 'rgba(124, 58, 237, 0.2)',
              border: '1px solid rgba(124, 58, 237, 0.4)',
              borderRadius: '8px',
              padding: '0.65rem 1.25rem',
              fontSize: '0.85rem',
              fontWeight: 700,
              color: wallet.isFrozen ? 'var(--text-muted)' : '#ddd6fe',
              cursor: wallet.isFrozen ? 'not-allowed' : 'pointer',
              opacity: wallet.isFrozen ? 0.6 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s ease',
            }}
          >
            <span>💸</span> Withdraw Funds
          </button>
        ) : (
          <Link
            to="/withdraw"
            style={{
              textDecoration: 'none',
              backgroundColor: 'rgba(124, 58, 237, 0.2)',
              border: '1px solid rgba(124, 58, 237, 0.4)',
              borderRadius: '8px',
              padding: '0.65rem 1.25rem',
              fontSize: '0.85rem',
              fontWeight: 700,
              color: '#ddd6fe',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>💸</span> Withdraw Funds
          </Link>
        )}

        <Link
          to="/wallet"
          style={{
            textDecoration: 'none',
            backgroundColor: 'rgba(35, 30, 52, 0.6)',
            border: '1px solid rgba(148, 144, 166, 0.3)',
            borderRadius: '8px',
            padding: '0.65rem 1.25rem',
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
