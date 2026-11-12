import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ExchangerOffer, PaginationMeta } from '../../types/exchange';
import { fetchActiveOffers } from '../../services/exchange';
import {
  Card,
  Button,
  DataTable,
  Column,
  Pagination,
  Select,
} from '../ui';
import { normalizePagination } from '../../utils/pagination';

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
        setPagination(normalizePagination(res.pagination || res, page, 10));
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

  const columns: Column<ExchangerOffer>[] = useMemo(
    () => [
      {
        key: 'offerRef',
        header: 'Offer Ref',
        render: (offer) => (
          <code style={{ fontSize: '0.8rem', color: 'var(--accent-lime)' }}>{offer.offerRef}</code>
        ),
      },
      {
        key: 'exchanger',
        header: 'Exchanger',
        render: (offer) => (
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
        ),
      },
      {
        key: 'serviceType',
        header: 'Service Type',
        render: (offer) => {
          const isP2p = offer.serviceType === 'IRT_TO_USD_FUNDING' || offer.serviceType === 'P2P_FUNDING';
          return (
            <span style={{ fontWeight: 600 }}>
              {isP2p ? 'P2P USD Funding' : 'Gold Trade Liquidity'}
            </span>
          );
        },
      },
      {
        key: 'currency',
        header: 'Currency',
        render: (offer) => (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 'var(--radius-xs)',
              fontSize: '0.75rem',
              fontWeight: 700,
              backgroundColor:
                offer.settlementCurrency === 'IRT'
                  ? 'rgba(204, 255, 0, 0.15)'
                  : offer.settlementCurrency === 'USD_WALLET'
                  ? 'rgba(124, 58, 237, 0.2)'
                  : 'rgba(56, 189, 248, 0.2)',
              color:
                offer.settlementCurrency === 'IRT'
                  ? 'var(--accent-lime)'
                  : offer.settlementCurrency === 'USD_WALLET'
                  ? 'var(--primary-purple)'
                  : '#38bdf8',
            }}
          >
            {offer.settlementCurrency}
          </span>
        ),
      },
      {
        key: 'commission',
        header: 'Commission',
        align: 'right',
        render: (offer) => (
          <span style={{ fontWeight: 700, color: 'var(--accent-lime)' }}>
            {offer.commissionPercentage}%
          </span>
        ),
      },
      {
        key: 'limits',
        header: 'Limits / Terms',
        render: (offer) => (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {offer.minAmount || offer.maxAmount
              ? `$${offer.minAmount || 0} - $${offer.maxAmount || '∞'}`
              : 'Flexible limits'}
            {offer.terms && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {offer.terms}
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        render: (offer) => {
          const isP2p = offer.serviceType === 'IRT_TO_USD_FUNDING' || offer.serviceType === 'P2P_FUNDING';
          return (
            <Button
              size="sm"
              variant={isP2p ? 'outline' : 'primary'}
              onClick={() => (isP2p ? onSelectForP2p(offer) : onSelectForSell(offer))}
              style={{
                fontSize: '0.78rem',
                backgroundColor: isP2p ? undefined : 'var(--accent-lime)',
                color: isP2p ? undefined : '#0d0b12',
              }}
            >
              {isP2p ? 'Request Funding' : 'Trade Gold'}
            </Button>
          );
        },
      },
    ],
    [onSelectForP2p, onSelectForSell]
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
          gap: '0.75rem',
        }}
      >
        <div>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.25rem 0' }}>
            Active Exchanger Fee Tiers
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            Browse certified community exchangers, evaluate commissions, and request direct liquidity trades.
          </p>
        </div>

        <Button
          onClick={loadOffers}
          disabled={loading}
          variant="outline"
          size="sm"
        >
          {loading ? 'Refreshing...' : '↻ Refresh'}
        </Button>
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
        <Select
          label="Service Type"
          value={serviceType}
          onChange={(e) => {
            setServiceType(e.target.value);
            setPage(1);
          }}
          options={[
            { label: 'All Service Types', value: 'ALL' },
            { label: 'P2P IRT-to-USD Funding', value: 'IRT_TO_USD_FUNDING' },
            { label: 'Gold Purchase (IRT Direct)', value: 'GOLD_PURCHASE_IRT' },
            { label: 'Gold Purchase (USDT Direct)', value: 'GOLD_PURCHASE_USDT' },
            { label: 'Gold Purchase (Prepaid Wallet)', value: 'GOLD_PURCHASE_WALLET' },
          ]}
        />

        <Select
          label="Settlement Currency"
          value={currency}
          onChange={(e) => {
            setCurrency(e.target.value);
            setPage(1);
          }}
          options={[
            { label: 'All Currencies', value: 'ALL' },
            { label: 'IRT (Toman Card/Bank)', value: 'IRT' },
            { label: 'USDT (BEP-20)', value: 'USDT' },
            { label: 'USD (Prepaid Wallet)', value: 'USD' },
          ]}
        />

        <Select
          label="Sort by Commission"
          value={sortOrder}
          onChange={(e) => {
            setSortOrder(e.target.value);
            setPage(1);
          }}
          options={[
            { label: 'Lowest Commission First', value: 'asc' },
            { label: 'Highest Commission First', value: 'desc' },
          ]}
        />
      </div>

      {error && (
        <div style={{ padding: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--status-danger)', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: '0.85rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={offers}
        keyField="id"
        loading={loading}
        emptyMessage="No active exchanger offers matching your filters. Try clearing filters or check back later as certified exchangers publish liquidity."
      />

      <Pagination
        pagination={pagination}
        onPageChange={(p) => setPage(p)}
      />
    </Card>
  );
};

export default OfferMarketplaceTable;
