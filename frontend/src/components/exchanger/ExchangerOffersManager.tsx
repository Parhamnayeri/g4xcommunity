import React, { useState, useMemo } from 'react';
import { ExchangerOffer } from '../../types/exchange';
import { createExchangerOffer, updateExchangerOffer } from '../../services/exchange';
import {
  Card,
  Button,
  DataTable,
  Column,
  StatusBadge,
  Modal,
  Input,
  Select,
  Textarea,
} from '../ui';

interface ExchangerOffersManagerProps {
  offers: ExchangerOffer[];
  onRefresh: () => void;
}

export const ExchangerOffersManager: React.FC<ExchangerOffersManagerProps> = ({ offers, onRefresh }) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [serviceType, setServiceType] = useState<string>('GOLD_TRADE');
  const [settlementCurrency, setSettlementCurrency] = useState<string>('IRT');
  const [commissionPercentage, setCommissionPercentage] = useState<number>(3.0);
  const [minAmount, setMinAmount] = useState<number>(10);
  const [maxAmount, setMaxAmount] = useState<number>(1000);
  const [terms, setTerms] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [actionOfferId, setActionOfferId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleToggleOffer = async (offer: ExchangerOffer) => {
    setActionOfferId(offer.id);
    setErrorMsg(null);
    try {
      const nextStatus = offer.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      await updateExchangerOffer(offer.id, { status: nextStatus });
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to update offer status');
    } finally {
      setActionOfferId(null);
    }
  };

  const handleCreateOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await createExchangerOffer({
        serviceType,
        settlementCurrency,
        commissionPercentage: Number(commissionPercentage),
        minAmount: minAmount ? Number(minAmount) : undefined,
        maxAmount: maxAmount ? Number(maxAmount) : undefined,
        terms: terms.trim() || undefined,
      });

      setSuccessMsg('Offer created and published successfully!');
      setTimeout(() => {
        setShowCreateModal(false);
        setSuccessMsg(null);
        onRefresh();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to create offer');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: Column<ExchangerOffer>[] = useMemo(
    () => [
      {
        key: 'offerRef',
        header: 'Offer Ref',
        render: (offer) => (
          <div>
            <strong>#{offer.id}</strong>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {offer.offerRef}
            </div>
          </div>
        ),
      },
      {
        key: 'serviceType',
        header: 'Service Type',
        render: (offer) => (
          <span style={{ fontWeight: 600 }}>
            {offer.serviceType === 'GOLD_TRADE' ? 'Gold Trade' : 'P2P Funding'}
          </span>
        ),
      },
      {
        key: 'settlementCurrency',
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
        header: 'Min / Max Limit',
        render: (offer) => (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            ${offer.minAmount || 0} - ${offer.maxAmount ? `$${offer.maxAmount}` : 'No Limit'}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (offer) => <StatusBadge status={offer.status.toLowerCase()} />,
      },
      {
        key: 'actions',
        header: 'Action',
        align: 'right',
        render: (offer) => (
          <Button
            size="sm"
            variant="outline"
            disabled={actionOfferId === offer.id}
            onClick={() => handleToggleOffer(offer)}
            style={{
              color: offer.status === 'ACTIVE' ? 'var(--status-danger)' : 'var(--status-success)',
              borderColor: offer.status === 'ACTIVE' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)',
              fontSize: '0.75rem',
            }}
          >
            {actionOfferId === offer.id ? '...' : offer.status === 'ACTIVE' ? 'Pause' : 'Activate'}
          </Button>
        ),
      },
    ],
    [actionOfferId]
  );

  return (
    <Card style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: 800 }}>
            My Marketplace Offers
          </h3>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Configure your exchange fee tiers and liquidity limits available to the community.
          </p>
        </div>
        <Button
          onClick={() => setShowCreateModal(true)}
          variant="primary"
          size="sm"
        >
          + Create New Offer
        </Button>
      </div>

      {errorMsg && (
        <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', borderRadius: 'var(--radius-sm)', marginBottom: '16px', fontSize: '0.85rem' }}>
          {errorMsg}
        </div>
      )}

      <DataTable
        columns={columns}
        data={offers}
        keyField="id"
        emptyMessage="You have not published any offers yet. Click '+ Create New Offer' to list your liquidity."
      />

      {/* Create Offer Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Publish New Offer"
        size="md"
      >
        {errorMsg && (
          <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', borderRadius: 'var(--radius-sm)', marginBottom: '16px', fontSize: '0.85rem' }}>
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div style={{ padding: '10px 14px', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', borderRadius: 'var(--radius-sm)', marginBottom: '16px', fontSize: '0.85rem' }}>
            {successMsg}
          </div>
        )}

        <form onSubmit={handleCreateOffer} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Select
            label="Service Type"
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            options={[
              { label: 'Gold Trade (Buy/Sell In-Game Gold)', value: 'GOLD_TRADE' },
              { label: 'P2P Funding (Wallet Top-Up Rail)', value: 'P2P_FUNDING' },
            ]}
          />

          <Select
            label="Settlement Currency"
            value={settlementCurrency}
            onChange={(e) => setSettlementCurrency(e.target.value)}
            options={[
              { label: 'IRT (Card-to-Card Iranian Toman)', value: 'IRT' },
              { label: 'USDT (Tether BEP-20)', value: 'USDT' },
              { label: 'USD_WALLET (Internal G4X Balance)', value: 'USD_WALLET' },
            ]}
          />

          <Input
            label="Commission Fee (%)"
            type="number"
            step="0.1"
            min="0"
            max="50"
            value={commissionPercentage}
            onChange={(e) => setCommissionPercentage(Number(e.target.value))}
            helperText="e.g. 3.0 = 3.00% fee"
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Input
              label="Min Amount (USD)"
              type="number"
              min="1"
              value={minAmount}
              onChange={(e) => setMinAmount(Number(e.target.value))}
            />
            <Input
              label="Max Amount (USD)"
              type="number"
              min="1"
              value={maxAmount}
              onChange={(e) => setMaxAmount(Number(e.target.value))}
            />
          </div>

          <Textarea
            label="Terms & Settlement Details (Optional)"
            placeholder="e.g. Instant card transfer via Iranian bank. Include payment instructions or limits."
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            rows={3}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowCreateModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={submitting}
            >
              {submitting ? 'Publishing...' : 'Publish Offer'}
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
};

export default ExchangerOffersManager;
