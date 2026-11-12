import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card,
  Button,
  DataTable,
  Column,
  Pagination,
} from '../ui';
import { normalizePagination } from '../../utils/pagination';
import { LedgerHistoryItem } from '../../types/wallet';
import { fetchLedgerActivity } from '../../services/wallet';

interface LedgerActivityTableProps {
  refreshTrigger?: number;
}

export const LedgerActivityTable: React.FC<LedgerActivityTableProps> = ({ refreshTrigger = 0 }) => {
  const [entries, setEntries] = useState<LedgerHistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });

  const loadLedger = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLedgerActivity(targetPage, 10);
      if (res.success) {
        setEntries(res.entries || []);
        setPage(res.page || targetPage);
        setPagination(normalizePagination(res, targetPage, 10));
      } else {
        setError(res.error || 'Failed to load ledger activity.');
      }
    } catch (err: any) {
      setError(err.message || 'Unable to fetch ledger entries from server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLedger(page);
  }, [loadLedger, page, refreshTrigger]);

  const columns: Column<LedgerHistoryItem>[] = useMemo(
    () => [
      {
        key: 'entryRef',
        header: 'Entry Ref',
        render: (item) => <strong>{item.entryRef}</strong>,
      },
      {
        key: 'direction',
        header: 'Direction',
        render: (item) => (
          <span
            style={{
              padding: '0.2rem 0.5rem',
              borderRadius: 'var(--radius-xs)',
              fontSize: '0.7rem',
              fontWeight: 800,
              backgroundColor: item.direction === 'CREDIT' ? 'rgba(204, 255, 0, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: item.direction === 'CREDIT' ? 'var(--accent-lime)' : 'var(--status-danger)',
            }}
          >
            {item.direction === 'CREDIT' ? '+ CREDIT' : '- DEBIT'}
          </span>
        ),
      },
      {
        key: 'entryType',
        header: 'Type',
        render: (item) => (
          <span className="badge badge-gray" style={{ fontSize: '0.68rem' }}>
            {item.entryType}
          </span>
        ),
      },
      {
        key: 'amountUsd',
        header: 'Amount USD',
        align: 'right',
        render: (item) => (
          <span
            style={{
              fontWeight: 800,
              color: item.direction === 'CREDIT' ? 'var(--accent-lime)' : 'var(--status-danger)',
            }}
          >
            {item.direction === 'CREDIT' ? `+$${item.amountUsd}` : `-$${item.amountUsd}`}
          </span>
        ),
      },
      {
        key: 'balanceAfterAvailableUsd',
        header: 'Available After',
        align: 'right',
        render: (item) => (
          <span>{item.balanceAfterAvailableUsd !== null ? `$${item.balanceAfterAvailableUsd}` : '—'}</span>
        ),
      },
      {
        key: 'balanceAfterReservedUsd',
        header: 'Reserved After',
        align: 'right',
        render: (item) => (
          <span style={{ color: 'var(--text-muted)' }}>
            {item.balanceAfterReservedUsd !== null ? `$${item.balanceAfterReservedUsd}` : '—'}
          </span>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        render: (item) => (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{item.description}</span>
        ),
      },
      {
        key: 'orderRef',
        header: 'Order Ref',
        render: (item) => (
          <span style={{ color: 'var(--accent-lime)', fontSize: '0.75rem' }}>{item.orderRef || '—'}</span>
        ),
      },
      {
        key: 'createdAt',
        header: 'Date',
        render: (item) => (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
            {new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <Card style={{ padding: '1.5rem', backgroundColor: 'var(--bg-surface)' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.25rem 0' }}>
            Ledger Activity &amp; Journal History
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            Immutable double-entry ledger postings recording all credit, debit, and escrow movements.
          </p>
        </div>

        <Button
          onClick={() => loadLedger(page)}
          disabled={loading}
          variant="outline"
          size="sm"
        >
          {loading ? 'Refreshing...' : '↻ Refresh'}
        </Button>
      </div>

      {error && (
        <div
          style={{
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #ef4444',
            borderRadius: 'var(--radius-sm)',
            color: '#ef4444',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Table Container */}
      <DataTable
        columns={columns}
        data={entries}
        keyField="id"
        loading={loading}
        emptyMessage="No ledger activity recorded yet."
      />

      {/* Pagination Controls */}
      <Pagination
        pagination={pagination}
        onPageChange={(p) => setPage(p)}
      />
    </Card>
  );
};

export default LedgerActivityTable;
