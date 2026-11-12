import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card,
  Button,
  DataTable,
  Column,
  Pagination,
  StatusBadge,
  Modal,
} from '../ui';
import { normalizePagination } from '../../utils/pagination';
import { DepositHistoryItem } from '../../types/wallet';
import { fetchDepositHistory } from '../../services/wallet';

interface DepositHistoryTableProps {
  refreshTrigger?: number;
}

export const DepositHistoryTable: React.FC<DepositHistoryTableProps> = ({ refreshTrigger = 0 }) => {
  const [deposits, setDeposits] = useState<DepositHistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [selectedDeposit, setSelectedDeposit] = useState<DepositHistoryItem | null>(null);

  const loadHistory = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDepositHistory(targetPage, 10);
      if (res.success) {
        setDeposits(res.deposits || []);
        setPage(res.page || targetPage);
        setPagination(normalizePagination(res, targetPage, 10));
      } else {
        setError(res.error || 'Failed to load deposit history.');
      }
    } catch (err: any) {
      setError(err.message || 'Unable to fetch deposit history from server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory(page);
  }, [loadHistory, page, refreshTrigger]);

  const columns: Column<DepositHistoryItem>[] = useMemo(
    () => [
      {
        key: 'fundingRef',
        header: 'Reference',
        render: (item) => <strong>{item.fundingRef}</strong>,
      },
      {
        key: 'fundingMethod',
        header: 'Method',
        render: (item) => (
          <span className="badge badge-gray" style={{ fontSize: '0.68rem' }}>
            {item.fundingMethod}
          </span>
        ),
      },
      {
        key: 'submittedAmount',
        header: 'Submitted Amount',
        render: (item) => (
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {item.submittedAmount}
          </span>
        ),
      },
      {
        key: 'exchangeRate',
        header: 'Exchange Rate',
        render: (item) => (
          <span style={{ color: 'var(--text-muted)' }}>
            {item.exchangeRate ? `${item.exchangeRate.toLocaleString()} Toman` : '1.0 (USDT)'}
          </span>
        ),
      },
      {
        key: 'expectedUsd',
        header: 'Expected USD',
        align: 'right',
        render: (item) => (
          <span style={{ color: 'var(--accent-lime)', fontWeight: 700 }}>
            ${item.expectedUsd}
          </span>
        ),
      },
      {
        key: 'creditedAmountUsd',
        header: 'Credited USD',
        align: 'right',
        render: (item) => (
          <span
            style={{
              fontWeight: 800,
              color: item.hasBackedCredit ? 'var(--accent-lime)' : 'var(--text-muted)',
            }}
          >
            {item.hasBackedCredit ? `$${item.creditedAmountUsd}` : '$0.00'}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (item) => <StatusBadge status={item.status} />,
      },
      {
        key: 'reviewOutcome',
        header: 'Review Outcome',
        render: (item) => (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {item.reviewOutcome}
          </span>
        ),
      },
      {
        key: 'date',
        header: 'Date',
        render: (item) => (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
            {new Date(item.date).toLocaleDateString()} {new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Action',
        align: 'right',
        render: (item) => (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelectedDeposit(item)}
            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
          >
            Details
          </Button>
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
            Deposit Requests &amp; Funding History
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            Audit trail of your submitted funding requests, verification outcomes, and ledger credits.
          </p>
        </div>

        <Button
          onClick={() => loadHistory(page)}
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
        data={deposits}
        keyField="id"
        loading={loading}
        emptyMessage="No deposit requests found. Submit an IRT bank transfer above to fund your wallet."
      />

      {/* Pagination Controls */}
      <Pagination
        pagination={pagination}
        onPageChange={(p) => setPage(p)}
      />

      {/* Detail Modal */}
      {selectedDeposit && (
        <Modal
          isOpen={!!selectedDeposit}
          onClose={() => setSelectedDeposit(null)}
          title="Deposit Record Details"
          subtitle={`Ref: ${selectedDeposit.fundingRef}`}
          size="md"
        >
          <div
            style={{
              backgroundColor: 'var(--bg-main)',
              padding: '1rem',
              borderRadius: 'var(--radius-xs)',
              border: '1px solid var(--border-subtle)',
              marginBottom: '1.25rem',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.75rem',
              fontSize: '0.85rem',
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Status:</span>
              <div style={{ marginTop: '0.2rem' }}>
                <StatusBadge status={selectedDeposit.status} />
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Funding Method:</span>
              <span>{selectedDeposit.fundingMethod}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Submitted Amount:</span>
              <strong style={{ color: 'var(--primary-purple)' }}>{selectedDeposit.submittedAmount}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Exchange Rate:</span>
              <span>{selectedDeposit.exchangeRate ? `${selectedDeposit.exchangeRate.toLocaleString()} Toman` : '1.0 (USDT)'}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Expected USD:</span>
              <strong style={{ color: 'var(--accent-lime)' }}>${selectedDeposit.expectedUsd}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Credited USD:</span>
              <strong style={{ color: selectedDeposit.hasBackedCredit ? 'var(--accent-lime)' : 'var(--text-muted)' }}>
                {selectedDeposit.hasBackedCredit ? `$${selectedDeposit.creditedAmountUsd}` : '$0.00'}
              </strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Bank Tracking Ref:</span>
              <span style={{ fontFamily: 'monospace' }}>{selectedDeposit.evidenceRef || 'None'}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Depositor / Card:</span>
              <span>{selectedDeposit.payerIdentifier || '—'}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Submitted Date:</span>
              <span>{new Date(selectedDeposit.date).toLocaleString()}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Verification Outcome:</span>
              <span>{selectedDeposit.reviewOutcome}</span>
            </div>
            {selectedDeposit.adminNotes && (
              <div style={{ gridColumn: '1 / -1', borderTop: '1px solid rgba(45, 38, 69, 0.4)', paddingTop: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Reviewer Notes / Reason:</span>
                <span>{selectedDeposit.adminNotes}</span>
              </div>
            )}
          </div>

          {/* Receipt Preview */}
          {selectedDeposit.receiptUrl ? (
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textAlign: 'left' }}>
                Uploaded Payment Receipt:
              </div>
              <img
                src={selectedDeposit.receiptUrl}
                alt="Deposit Receipt"
                style={{
                  maxWidth: '100%',
                  maxHeight: '300px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  objectFit: 'contain',
                }}
              />
            </div>
          ) : (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1rem' }}>
              No image receipt uploaded with this deposit request.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              onClick={() => setSelectedDeposit(null)}
              variant="outline"
              size="sm"
            >
              Close Details
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
};

export default DepositHistoryTable;
