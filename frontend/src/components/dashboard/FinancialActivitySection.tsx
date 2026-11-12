import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DashboardTransaction } from '../../types/dashboard';
import { fetchWalletTransactions } from '../../services/dashboard';
import { Card, DataTable, Column, Pagination } from '../ui';
import { normalizePagination, NormalizedPagination } from '../../utils/pagination';

export const FinancialActivitySection: React.FC = () => {
  const [transactions, setTransactions] = useState<DashboardTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<NormalizedPagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });

  const loadTransactions = useCallback(async (targetPage = 1) => {
    setLoading(true);
    try {
      const res = await fetchWalletTransactions({
        page: targetPage,
        limit: 10,
      });
      setTransactions(res.transactions || []);
      setPagination(normalizePagination(res.pagination || res, targetPage, 10));
    } catch (err) {
      console.warn('[FinancialActivity] Failed to load transactions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTransactions(1);
  }, [loadTransactions]);

  const formatEntryType = (type: string) => {
    switch (type) {
      case 'EARNING_PENDING':
        return 'Boost Run Completed (Pending)';
      case 'EARNING_CONFIRMED':
        return 'Boost Release Approved (Confirmed)';
      case 'AVAILABLE_RELEASE':
        return 'Escrow Released to Available';
      case 'WITHDRAWAL_RESERVE':
        return 'Withdrawal Request Reserved';
      case 'WITHDRAWAL_SETTLE':
        return 'Withdrawal Paid (Settled)';
      case 'WITHDRAWAL_REVERSE':
        return 'Withdrawal Reversed';
      case 'ADVERTISER_DEPOSIT':
        return 'Advertiser Balance Top-up';
      case 'GOLD_TRADE_SETTLE':
        return 'P2P Gold Trade Settlement';
      case 'P2P_FUNDING_SETTLE':
        return 'P2P Funding Settlement';
      default:
        return type.replace(/_/g, ' ');
    }
  };

  const columns: Column<DashboardTransaction>[] = useMemo(
    () => [
      {
        key: 'entryRef',
        header: 'Entry Ref',
        render: (t) => (
          <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: '#fff', fontWeight: 600 }}>
            {t.entryRef}
          </span>
        ),
      },
      {
        key: 'type',
        header: 'Transaction Type',
        render: (t) => {
          const isCredit = t.direction === 'CREDIT';
          return (
            <span
              className={`badge ${isCredit ? 'badge-lime' : 'badge-purple'}`}
              style={{ fontSize: '0.72rem', textTransform: 'none' }}
            >
              {formatEntryType(t.entryType)}
            </span>
          );
        },
      },
      {
        key: 'description',
        header: 'Description / Order',
        render: (t) => (
          <div style={{ color: 'var(--text-muted)' }}>
            <div>{t.description || '—'}</div>
            {t.orderRef && (
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-lime)', fontFamily: 'monospace' }}>
                Ref: #{t.orderRef}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        numeric: true,
        render: (t) => {
          const isCredit = t.direction === 'CREDIT';
          return (
            <span
              style={{
                fontWeight: 700,
                color: isCredit ? 'var(--accent-lime)' : 'var(--status-danger)',
              }}
            >
              {isCredit ? `+$${t.amountUsd}` : `-$${t.amountUsd}`} USD
            </span>
          );
        },
      },
      {
        key: 'balanceAfter',
        header: 'Available After',
        numeric: true,
        render: (t) => (
          <span style={{ color: '#fff', fontWeight: 600 }}>
            {t.balanceAfterAvailableUsd !== null ? `$${t.balanceAfterAvailableUsd}` : '—'}
          </span>
        ),
      },
      {
        key: 'date',
        header: 'Timestamp',
        render: (t) => (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            {new Date(t.createdAt).toLocaleString()}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <Card style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0 }}>Wallet &amp; Ledger Activity</h2>
            <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
              {pagination.total} Entries
            </span>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
            Immutable, double-entry audit records for all balance additions and allocations.
          </p>
        </div>
      </div>

      <DataTable<DashboardTransaction>
        columns={columns}
        data={transactions}
        keyField="id"
        loading={loading}
        emptyTitle="No financial activity found"
        emptyMessage="No financial activity recorded yet for this wallet."
      />

      <Pagination
        pagination={pagination}
        onPageChange={(nextPage) => loadTransactions(nextPage)}
      />
    </Card>
  );
};
