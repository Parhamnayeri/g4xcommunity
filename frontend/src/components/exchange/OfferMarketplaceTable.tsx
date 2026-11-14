import React, { useState, useEffect, useCallback } from 'react';
import { ExchangerOffer, PaginationMeta } from '../../types/exchange';
import { fetchActiveOffers } from '../../services/exchange';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

interface OfferMarketplaceTableProps {
  onSelectForSell: (offer: ExchangerOffer) => void;
  onSelectForP2p: (offer: ExchangerOffer) => void;
}

export const OfferMarketplaceTable: React.FC<OfferMarketplaceTableProps> = ({
  onSelectForSell,
  onSelectForP2p,
}) => {
  const [offers, setOffers] = useState<ExchangerOffer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [serviceType, setServiceType] = useState<string>('ALL');
  const [currency, setCurrency] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<string>('asc');
  const [page, setPage] = useState<number>(1);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });

  const loadOffers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchActiveOffers({
        serviceType: serviceType === 'ALL' ? undefined : serviceType,
        currency: currency === 'ALL' ? undefined : currency,
        sortOrder,
        page,
        limit: 10,
      });
      if (res.success) {
        setOffers(res.offers || []);
        if (res.pagination) {
          setPagination(res.pagination);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load exchange offers.');
    } finally {
      setLoading(false);
    }
  }, [serviceType, currency, sortOrder, page]);

  useEffect(() => {
    loadOffers();
  }, [loadOffers]);

  const handleFilterChange = (setter: (val: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(1);
  };

  const formatServiceLabel = (type: string) => {
    switch (type) {
      case 'IRT_TO_USD_FUNDING':
        return 'P2P IRT-to-USD';
      case 'GOLD_PURCHASE_IRT':
        return 'Gold Purchase (IRT Direct)';
      case 'GOLD_PURCHASE_USDT':
        return 'Gold Purchase (USDT Direct)';
      case 'GOLD_PURCHASE_WALLET':
        return 'Gold Purchase (Prepaid Wallet)';
      default:
        return type;
    }
  };

  return (
    <Card style={{ backgroundColor: 'var(--bg-surface)', padding: '1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            Active Exchanger Published Offers
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem', margin: 0 }}>
            Browse verified Exchangers offering liquidity and gold settlement with transparent commissions.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span className="badge badge-purple" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>
            {pagination.total} Active Offers
          </span>
          <button
            onClick={() => loadOffers()}
            className="btn btn-outline btn-sm"
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
            title="Refresh offers list"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          padding: '1rem',
          backgroundColor: 'rgba(13, 11, 18, 0.6)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: '1.25rem',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
            Service Type
          </label>
          <select
            value={serviceType}
            onChange={handleFilterChange(setServiceType)}
            className="form-control"
            style={{ width: '100%', fontSize: '0.85rem' }}
          >
            <option value="ALL">All Service Types</option>
            <option value="IRT_TO_USD_FUNDING">P2P IRT-to-USD Funding</option>
            <option value="GOLD_PURCHASE_IRT">Gold Purchase (IRT Direct)</option>
            <option value="GOLD_PURCHASE_USDT">Gold Purchase (USDT Direct)</option>
            <option value="GOLD_PURCHASE_WALLET">Gold Purchase (Prepaid Wallet)</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
            Settlement Currency
          </label>
          <select
            value={currency}
            onChange={handleFilterChange(setCurrency)}
            className="form-control"
            style={{ width: '100%', fontSize: '0.85rem' }}
          >
            <option value="ALL">All Currencies</option>
            <option value="IRT">IRT (Toman Card/Bank)</option>
            <option value="USDT">USDT (BEP-20)</option>
            <option value="USD">USD (Prepaid Wallet)</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
            Sort by Commission
          </label>
          <select
            value={sortOrder}
            onChange={handleFilterChange(setSortOrder)}
            className="form-control"
            style={{ width: '100%', fontSize: '0.85rem' }}
          >
            <option value="asc">Lowest Commission First</option>
            <option value="desc">Highest Commission First</option>
          </select>
        </div>
      </div>

      {/* Offers Table */}
      {error && (
        <div style={{ padding: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--status-danger)', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: '0.85rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              border: '2px solid var(--border-subtle)',
              borderTopColor: 'var(--accent-yellow)',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 1rem',
            }}
          />
          Loading verified marketplace offers...
        </div>
      ) : offers.length === 0 ? (
        <div className="empty-state-box" style={{ padding: '3rem 1rem' }}>
          <span className="empty-state-icon">📭</span>
          <p style={{ margin: 0, fontWeight: 600 }}>No active exchanger offers matching your filters.</p>
          <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Try clearing filters or check back later as certified exchangers publish liquidity.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Offer Ref</th>
                <th>Exchanger</th>
                <th>Service Type</th>
                <th>Currency</th>
                <th>Commission</th>
                <th>Limits / Terms</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => {
                const isP2p = offer.serviceType === 'IRT_TO_USD_FUNDING';
                return (
                  <tr key={offer.id}>
                    <td>
                      <code style={{ fontSize: '0.8rem', color: 'var(--accent-yellow)' }}>{offer.offerRef}</code>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div
                          style={{
                            width: '26px',
                            height: '26px',
                            borderRadius: '50%',
                            backgroundColor: 'var(--primary-purple)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: '#fff',
                          }}
                        >
                          {(offer.exchanger?.displayName || offer.exchanger?.username || 'EX').substring(0, 2).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {offer.exchanger?.displayName || offer.exchanger?.username || offer.exchangerId}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={isP2p ? 'badge badge-amber' : 'badge badge-purple'}
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                      >
                        {formatServiceLabel(offer.serviceType)}
                      </span>
                    </td>
                    <td>
                      <strong style={{ color: 'var(--text-primary)' }}>{offer.settlementCurrency}</strong>
                    </td>
                    <td>
                      <span style={{ color: 'var(--accent-yellow)', fontWeight: 800 }}>
                        {(offer.commissionPercentage * 100).toFixed(2)}%
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem', maxWidth: '240px' }}>
                      {offer.minAmount || offer.maxAmount ? (
                        <div style={{ marginBottom: '0.15rem' }}>
                          Limits: {offer.minAmount ? `${offer.minAmount.toLocaleString()}` : '0'} - {offer.maxAmount ? `${offer.maxAmount.toLocaleString()}` : '∞'}
                        </div>
                      ) : null}
                      <span style={{ fontStyle: offer.terms ? 'normal' : 'italic' }}>
                        {offer.terms || 'Standard terms'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {isP2p ? (
                        <Button
                          variant="cta"
                          size="sm"
                          onClick={() => onSelectForP2p(offer)}
                          style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                        >
                          P2P Fund
                        </Button>
                      ) : (
                        <Button
                          variant="purple"
                          size="sm"
                          onClick={() => onSelectForSell(offer)}
                          style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                        >
                          Sell Gold
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Footer */}
      {pagination.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          <div>
            Showing Page <strong style={{ color: 'var(--text-primary)' }}>{pagination.page}</strong> of <strong style={{ color: 'var(--text-primary)' }}>{pagination.totalPages}</strong> ({pagination.total} total offers)
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page <= 1}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.78rem', opacity: pagination.page <= 1 ? 0.4 : 1 }}
            >
              &larr; Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={pagination.page >= pagination.totalPages}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.78rem', opacity: pagination.page >= pagination.totalPages ? 0.4 : 1 }}
            >
              Next &rarr;
            </button>
          </div>
        </div>
      )}
    </Card>
  );
};
