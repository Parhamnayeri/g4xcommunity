import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { SiteTreasuryData } from '../../types/withdraw';
import { adjustOwnerTreasury } from '../../services/withdraw';

interface SiteTreasuryCardsProps {
  treasury: SiteTreasuryData;
  onRefresh?: () => void;
}

export const SiteTreasuryCards: React.FC<SiteTreasuryCardsProps> = ({ treasury, onRefresh }) => {
  const [showModal, setShowModal] = useState(false);
  const [currency, setCurrency] = useState<'USDT' | 'IRT'>('USDT');
  const [action, setAction] = useState<'DEPOSIT' | 'WITHDRAW'>('DEPOSIT');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setFeedback({ text: 'لطفاً یک مبلغ معتبر و بزرگتر از صفر وارد نمایید.', type: 'error' });
      return;
    }

    if (!description.trim() || description.trim().length < 3) {
      setFeedback({ text: 'درج توضیحات و بابت تراکنش (حداقل ۳ کاراکتر) الزامی است.', type: 'error' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await adjustOwnerTreasury({
        currency,
        action,
        amount: numAmount,
        description: description.trim(),
      });

      if (res.success) {
        setFeedback({
          text: `✓ ${res.message || 'عملیات با موفقیت ثبت شد.'} موجودی جدید: ${res.newBalance} ${currency}`,
          type: 'success',
        });
        setAmount('');
        setDescription('');
        if (onRefresh) onRefresh();
        setTimeout(() => {
          setShowModal(false);
          setFeedback(null);
        }, 1500);
      } else {
        setFeedback({ text: res.error || 'خطا در ثبت تراکنش خزانه.', type: 'error' });
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'خطا در برقراری ارتباط با سرور.', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginBottom: '1.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.1rem' }}>🏛️</span>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            وضعیت نقدینگی و تسویه سایت (Site Treasury &amp; Balances)
          </h3>
        </div>

        {treasury.isOwner && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setShowModal(true);
              setFeedback(null);
            }}
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.8rem' }}
          >
            ⚙️ مدیریت موجودی خزانه (ویژه Owner)
          </button>
        )}
      </div>

      {/* 4 Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
        }}
      >
        {/* Card 1: موجودی سایت از اوردرها */}
        <Card highlight="none" style={{ padding: '1.15rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              موجودی سایت از اوردرها
            </span>
            <span style={{ fontSize: '1.1rem' }}>🛒</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--accent-lime)', fontFamily: 'monospace' }}>
            ${treasury.siteOrderRevenueUsd}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            سود کارمزد پلتفرم از سفارش‌ها (حجم کل: ${treasury.siteGrossVolumeUsd})
          </div>
        </Card>

        {/* Card 2: موجودی تومانی خزانه سایت */}
        <Card highlight="none" style={{ padding: '1.15rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              موجودی تومانی سایت
            </span>
            <span style={{ fontSize: '1.1rem' }}>🏦</span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--status-info)', fontFamily: 'monospace' }}>
            {Number(treasury.siteIrtBalance).toLocaleString()} <span style={{ fontSize: '0.85rem' }}>تومان</span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            موجودی نقدینگی بانکی سایت جهت تسویه ریالی
          </div>
        </Card>

        {/* Card 3: موجودی USDT خزانه سایت */}
        <Card highlight="none" style={{ padding: '1.15rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              موجودی USDT سایت
            </span>
            <span style={{ fontSize: '1.1rem' }}>💎</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#A78BFA', fontFamily: 'monospace' }}>
            {treasury.siteUsdtBalance} <span style={{ fontSize: '0.85rem' }}>USDT</span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            موجودی کیف‌پول شبکه BSC BEP-20 سایت
          </div>
        </Card>

        {/* Card 4: مقدار مورد نیاز برای تسویه */}
        <Card highlight="none" style={{ padding: '1.15rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              مقدار مورد نیاز برای تسویه
            </span>
            <span style={{ fontSize: '1.1rem' }}>⚖️</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--status-warning)', fontFamily: 'monospace' }}>
            ${treasury.settlementNeeded.totalUsd}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            نیاز: {treasury.settlementNeeded.usdtNeeded} USDT + ~ {Number(treasury.settlementNeeded.irtNeeded).toLocaleString()} ت ({treasury.settlementNeeded.pendingCount} درخواست در صف)
          </div>
        </Card>
      </div>

      {/* Owner Treasury Adjustment Modal */}
      {showModal && (
        <div className="studio-modal-backdrop" onClick={() => setShowModal(false)}>
          <div
            className="studio-modal-card"
            style={{ maxWidth: '480px', direction: 'rtl', textAlign: 'right' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="studio-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                مدیریت موجودی خزانه پلتفرم (ویژه Owner)
              </h3>
              <button
                type="button"
                className="studio-modal-close"
                onClick={() => setShowModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAdjustSubmit}>
              <div className="studio-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Current balances info */}
                <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.04)', padding: '0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', display: 'flex', justifyContent: 'space-around' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>موجودی USDT فعلی: </span>
                    <strong style={{ color: '#A78BFA' }}>{treasury.siteUsdtBalance} USDT</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>موجودی تومانی فعلی: </span>
                    <strong style={{ color: 'var(--status-info)' }}>{Number(treasury.siteIrtBalance).toLocaleString()} ت</strong>
                  </div>
                </div>

                {/* Currency Selection */}
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.35rem' }}>
                    انتخاب ارز خزانه:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${currency === 'USDT' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setCurrency('USDT')}
                    >
                      💎 USDT (کریپتو)
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${currency === 'IRT' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setCurrency('IRT')}
                    >
                      🏦 تومان (بانکی)
                    </button>
                  </div>
                </div>

                {/* Action Selection */}
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.35rem' }}>
                    نوع عملیات:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${action === 'DEPOSIT' ? 'btn-success' : 'btn-outline'}`}
                      onClick={() => setAction('DEPOSIT')}
                    >
                      ➕ افزودن / واریز به خزانه
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${action === 'WITHDRAW' ? 'btn-danger' : 'btn-outline'}`}
                      onClick={() => setAction('WITHDRAW')}
                    >
                      ➖ برداشت از خزانه
                    </button>
                  </div>
                </div>

                {/* Amount input */}
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.35rem' }}>
                    مبلغ تراکنش ({currency === 'USDT' ? 'USDT' : 'تومان'}):
                  </label>
                  <input
                    type="number"
                    step={currency === 'USDT' ? '0.01' : '1000'}
                    min="0"
                    className="input"
                    placeholder={currency === 'USDT' ? 'مثلاً: 500.00' : 'مثلاً: 25000000'}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    style={{ width: '100%', padding: '0.6rem 0.8rem', fontSize: '0.88rem' }}
                    required
                  />
                </div>

                {/* Description input */}
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.35rem' }}>
                    توضیحات و بابت تراکنش (اجباری):
                  </label>
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="مثلاً: تزریق نقدینگی هفتگی جهت تسویه بوسترها، یا برداشت سود"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    style={{ width: '100%', padding: '0.6rem 0.8rem', fontSize: '0.85rem' }}
                    required
                  />
                </div>

                {feedback && (
                  <div
                    style={{
                      padding: '0.65rem 0.85rem',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.82rem',
                      backgroundColor: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: feedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
                      border: `1px solid ${feedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    }}
                  >
                    {feedback.text}
                  </div>
                )}
              </div>

              <div className="studio-modal-footer" style={{ display: 'flex', justifyContent: 'flex-start', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`btn ${action === 'DEPOSIT' ? 'btn-success' : 'btn-danger'} btn-sm`}
                >
                  {submitting ? 'در حال ثبت...' : action === 'DEPOSIT' ? 'تأیید و افزایش موجودی خزانه' : 'تأیید و برداشت از خزانه'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowModal(false)}
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
