/**
 * src/services/exchangePaymentService.ts
 *
 * G4X In-Game Currency & Items Exchange — Phase 5:
 * Payment Engine, Escrow & Reservation, Unified Central Wallet & Buyer Checkout Integration.
 *
 * Financial & Safety Invariants:
 *  - ZERO Float for financial calculations & fees (all cents are exact Int).
 *  - Unified Central G4X Wallet & Ledger: all balance locks, debits, and refunds
 *    execute atomically against central Wallet/WalletV2 & LedgerTransaction.
 *  - Double-spending and overselling prevention inside atomic prisma.$transaction blocks.
 *  - Fail-closed IPN verification with HMAC-SHA512 constant-time check.
 *  - Mandatory assertTradeEscrowFunded guard to ensure no trade progresses to delivery
 *    without verified escrow reservation.
 */

import prisma from '../database/db';
import crypto from 'crypto';
import {
  ExchangeTrade,
  ExchangePayment,
  ExchangeEscrow,
  ExchangeBuyOrder,
  ExchangeTradeEvent,
} from '@prisma/client';
import {
  TradeValidationError,
  cancelUnpaidTrade,
} from './exchangeTradeService';
import {
  logExchangeAudit,
} from './exchangeConfigService';
import {
  getNowPaymentsService,
  getNowPaymentsConfig,
} from './nowPaymentsService';
import {
  getOfficialReceivingBankDetails,
  calculateIncomingIrtQuote,
} from './payment/irtPaymentService';

/**
 * Generates human-friendly sequential payment code: EXP-1001, EXP-1002, etc.
 */
export async function generateNextPaymentCode(tx: any = prisma): Promise<string> {
  const count = await tx.exchangePayment.count();
  const candidate = `EXP-${1000 + count + 1}`;
  const exists = await tx.exchangePayment.findUnique({
    where: { paymentCode: candidate },
  });
  if (!exists) return candidate;

  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `EXP-${1000 + count + 1}-${randomSuffix}`;
}

/**
 * Invariant Guard: Verifies that a trade has fully reserved escrow funding.
 * Delivery cannot start without this passing.
 */
export async function assertTradeEscrowFunded(tradeId: string, tx: any = prisma): Promise<ExchangeEscrow> {
  const trade = await tx.exchangeTrade.findUnique({
    where: { id: tradeId },
    include: { escrow: true },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  if (trade.status === 'AWAITING_PAYMENT') {
    throw new TradeValidationError(
      'TRADE_ESCROW_NOT_FUNDED: Trade is awaiting buyer payment. Escrow has not been funded.',
      400
    );
  }

  if (trade.status === 'CANCELLED') {
    throw new TradeValidationError(
      'TRADE_ESCROW_NOT_FUNDED: Trade is cancelled.',
      400
    );
  }

  if (!trade.escrow || (trade.escrow.status !== 'RESERVED' && trade.escrow.status !== 'FROZEN_DISPUTE')) {
    throw new TradeValidationError(
      'TRADE_ESCROW_NOT_FUNDED: No active RESERVED or FROZEN_DISPUTE escrow record found for this trade.',
      400
    );
  }

  if (trade.escrow.reservedAmountCents < trade.buyerTotalPayableCents) {
    throw new TradeValidationError(
      `TRADE_ESCROW_NOT_FUNDED: Escrow amount ($${(trade.escrow.reservedAmountCents / 100).toFixed(2)}) is less than payable ($${(trade.buyerTotalPayableCents / 100).toFixed(2)}).`,
      400
    );
  }

  return trade.escrow;
}

export interface TradeCheckoutSummary {
  trade: {
    id: string;
    tradeCode: string;
    status: string;
    quantityBaseUnits: string;
    unitLabelSnapshot: string;
    unitMultiplierSnapshot: string;
    pricePerUnitCentsSnapshot: number;
    pricePerUnitUsd: string;
    buyerTotalPayableCents: number;
    buyerTotalPayableUsd: string;
    grossValueCents: number;
    grossValueUsd: string;
    buyerFeeCents: number;
    buyerFeeUsd: string;
    sellerFeeCents: number;
    netSellerCents: number;
    netSellerUsd: string;
    buyerUserId: string;
    sellerUserId: string;
    gameDisplayName: string;
    currencyDisplayName: string;
    deliveryMethodName: string;
  };
  pricingBreakdown: {
    baseAmountCents: number;
    baseAmountUsd: string;
    buyerFeeCents: number;
    buyerFeeUsd: string;
    paymentProcessingFeeCents: number;
    paymentProcessingFeeUsd: string;
    networkFeeCents: number;
    networkFeeUsd: string;
    totalPayableCents: number;
    totalPayableUsd: string;
  };
  wallet: {
    balanceUsdCents: number;
    balanceUsd: string;
    reservedCents: number;
    reservedUsd: string;
    frozenCents: number;
    isFrozen: boolean;
    availableCents: number;
    availableUsd: string;
    hasSufficientBalance: boolean;
    insufficientReason: string | null;
  };
  gateways: {
    wallet: {
      enabled: boolean;
      available: boolean;
      canPay: boolean;
    };
    nowpayments: {
      enabled: boolean;
      configured: boolean;
      isSandbox: boolean;
    };
    bankTransfer: {
      enabled: boolean;
      bankDetails: {
        bankName: string;
        cardNumber: string;
        accountHolder: string;
        iban?: string;
      };
      note: string;
      irtQuote?: {
        totalIrtAmount: number;
        adminUsdIrtRate: number;
      };
    };
  };
  activePayment: ExchangePayment | null;
  escrow: ExchangeEscrow | null;
  discordRoom?: any | null;
}

/**
 * Returns comprehensive checkout summary for a trade (pricing, wallet balances, gateways, existing payment)
 */
export async function getTradeCheckoutSummary(
  tradeId: string,
  actorUserId: string,
  actorRoles: string[] = []
): Promise<TradeCheckoutSummary> {
  const trade = await prisma.exchangeTrade.findUnique({
    where: { id: tradeId },
    include: {
      buyOrder: true,
      game: true,
      currency: true,
      region: true,
      deliveryMethod: true,
      payments: {
        orderBy: { createdAt: 'desc' },
      },
      escrow: true,
      discordRoom: true,
    },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  const isStaffOrOwner =
    actorRoles.includes('admin') ||
    actorRoles.includes('owner') ||
    actorRoles.includes('staff');
  const isParticipant =
    trade.buyerUserId === actorUserId || trade.sellerUserId === actorUserId;

  if (!isParticipant && !isStaffOrOwner) {
    throw new TradeValidationError('Unauthorized: You cannot access checkout for this trade.', 403);
  }

  // Fetch Buyer Central Wallet
  const [legacyWallet, walletV2] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId: trade.buyerUserId } }),
    prisma.walletV2.findUnique({ where: { userId: trade.buyerUserId } }),
  ]);

  const balanceUsdCents = legacyWallet?.balanceUsd ?? walletV2?.availableCents ?? 0;
  const reservedCents = legacyWallet?.reservedBalance ?? walletV2?.reservedCents ?? 0;
  const frozenCents = Math.max(legacyWallet?.frozenBalance || 0, walletV2?.frozenCents || 0);
  const isFrozen = Boolean(legacyWallet?.isFrozen || walletV2?.isFrozen);

  // Available balance is WalletV2.availableCents or (balanceUsd - reserved - frozen)
  let availableCents = walletV2 ? walletV2.availableCents : Math.max(0, balanceUsdCents - reservedCents - frozenCents);
  if (isFrozen) {
    availableCents = 0;
  }

  const totalPayableCents = trade.buyerTotalPayableCents;
  const hasSufficientBalance = !isFrozen && availableCents >= totalPayableCents;
  let insufficientReason: string | null = null;
  if (isFrozen) {
    insufficientReason = 'Your central wallet is currently frozen by administration.';
  } else if (!hasSufficientBalance) {
    insufficientReason = `Insufficient wallet balance. You need $${(totalPayableCents / 100).toFixed(2)} USD, but have $${(availableCents / 100).toFixed(2)} USD available.`;
  }

  // NOWPayments Config
  const npConfig = getNowPaymentsConfig();
  const isNpConfigured = Boolean(npConfig.apiKey);

  // Bank Details & IRT Quote
  let bankDetails = {
    bankName: 'G4X Central Treasury',
    cardNumber: '---- ---- ---- ----',
    accountHolder: 'G4X Financial Operations',
    iban: '',
  };
  let irtQuoteResult: { totalIrtAmount: number; adminUsdIrtRate: number } | undefined;

  try {
    const officialDetails = await getOfficialReceivingBankDetails();
    bankDetails = {
      bankName: officialDetails.bankName || 'G4X Central Treasury',
      cardNumber: officialDetails.cardNumber || '---- ---- ---- ----',
      accountHolder: officialDetails.accountHolder || 'G4X Financial Operations',
      iban: officialDetails.iban || '',
    };
  } catch (err) {
    // Fallback if not configured in DB yet
  }

  try {
    const quote = await calculateIncomingIrtQuote(totalPayableCents);
    irtQuoteResult = {
      totalIrtAmount: quote.totalIrtAmount,
      adminUsdIrtRate: quote.adminUsdIrtRate,
    };
  } catch (err) {
    // Exchange rate might not be set in test environment
  }

  // Check active payment attempt
  const activePayment = trade.payments.find(
    (p) => p.status === 'INITIATED' || p.status === 'PENDING_REVIEW'
  ) || null;

  return {
    trade: {
      id: trade.id,
      tradeCode: trade.tradeCode,
      status: trade.status,
      quantityBaseUnits: trade.quantityBaseUnits,
      unitLabelSnapshot: trade.unitLabelSnapshot,
      unitMultiplierSnapshot: trade.unitMultiplierSnapshot,
      pricePerUnitCentsSnapshot: trade.pricePerUnitCentsSnapshot,
      pricePerUnitUsd: `$${(trade.pricePerUnitCentsSnapshot / 100).toFixed(2)}`,
      buyerTotalPayableCents: trade.buyerTotalPayableCents,
      buyerTotalPayableUsd: `$${(trade.buyerTotalPayableCents / 100).toFixed(2)}`,
      grossValueCents: trade.grossValueCents,
      grossValueUsd: `$${(trade.grossValueCents / 100).toFixed(2)}`,
      buyerFeeCents: trade.buyerFeeCents,
      buyerFeeUsd: `$${(trade.buyerFeeCents / 100).toFixed(2)}`,
      sellerFeeCents: trade.sellerFeeCents,
      netSellerCents: trade.netSellerCents,
      netSellerUsd: `$${(trade.netSellerCents / 100).toFixed(2)}`,
      buyerUserId: trade.buyerUserId,
      sellerUserId: trade.sellerUserId,
      gameDisplayName: trade.game.name,
      currencyDisplayName: trade.currency.name,
      deliveryMethodName: trade.deliveryMethod.name,
    },
    pricingBreakdown: {
      baseAmountCents: trade.grossValueCents,
      baseAmountUsd: `$${(trade.grossValueCents / 100).toFixed(2)}`,
      buyerFeeCents: trade.buyerFeeCents,
      buyerFeeUsd: `$${(trade.buyerFeeCents / 100).toFixed(2)}`,
      paymentProcessingFeeCents: 0,
      paymentProcessingFeeUsd: '$0.00',
      networkFeeCents: 0,
      networkFeeUsd: '$0.00',
      totalPayableCents: trade.buyerTotalPayableCents,
      totalPayableUsd: `$${(trade.buyerTotalPayableCents / 100).toFixed(2)}`,
    },
    wallet: {
      balanceUsdCents,
      balanceUsd: `$${(balanceUsdCents / 100).toFixed(2)}`,
      reservedCents,
      reservedUsd: `$${(reservedCents / 100).toFixed(2)}`,
      frozenCents,
      isFrozen,
      availableCents,
      availableUsd: `$${(availableCents / 100).toFixed(2)}`,
      hasSufficientBalance,
      insufficientReason,
    },
    gateways: {
      wallet: {
        enabled: true,
        available: true,
        canPay: hasSufficientBalance,
      },
      nowpayments: {
        enabled: isNpConfigured,
        configured: isNpConfigured,
        isSandbox: npConfig.isSandbox,
      },
      bankTransfer: {
        enabled: true,
        bankDetails,
        note: 'SLA: 15–45 minutes verification window during active business hours.',
        irtQuote: irtQuoteResult,
      },
    },
    activePayment,
    escrow: trade.escrow,
    discordRoom: trade.discordRoom || null,
  };
}

/**
 * METHOD A: Pay trade directly using central G4X Wallet.
 * Atomically locks funds from available balance into reserved balance and creates escrow.
 */
export async function payTradeWithWallet(
  tradeId: string,
  buyerUserId: string
): Promise<{ payment: ExchangePayment; escrow: ExchangeEscrow; trade: ExchangeTrade }> {
  // 1. Interactive Transaction for Balance Locking & Escrow Creation
  const result = await prisma.$transaction(
    async (tx) => {
      const trade = await tx.exchangeTrade.findUnique({
        where: { id: tradeId },
      });

      if (!trade) {
        throw new TradeValidationError('Trade not found', 404);
      }

      if (trade.buyerUserId !== buyerUserId) {
        throw new TradeValidationError('Unauthorized: You are not the buyer of this trade', 403);
      }

      if (trade.status !== 'AWAITING_PAYMENT') {
        throw new TradeValidationError(
          `Trade is not awaiting payment. Current status: ${trade.status}`,
          400
        );
      }

      const totalPayableCents = trade.buyerTotalPayableCents;

      // Check existing buyer wallet
      const [wallet, walletV2] = await Promise.all([
        tx.wallet.findUnique({ where: { userId: buyerUserId } }),
        tx.walletV2.findUnique({ where: { userId: buyerUserId } }),
      ]);

      if (!wallet) {
        throw new TradeValidationError('Buyer wallet not found', 400);
      }

      if (wallet.isFrozen || (walletV2 && walletV2.isFrozen)) {
        throw new TradeValidationError('WALLET_FROZEN: Your wallet is frozen. Payment cannot proceed.', 403);
      }

      const availableBalance = walletV2
        ? walletV2.availableCents
        : wallet.balanceUsd - (wallet.reservedBalance || 0) - (wallet.frozenBalance || 0);

      if (availableBalance < totalPayableCents) {
        throw new TradeValidationError(
          `INSUFFICIENT_FUNDS: Available balance ($${(availableBalance / 100).toFixed(2)}) is less than total payable ($${(totalPayableCents / 100).toFixed(2)})`,
          400
        );
      }

      // 2. Atomic Wallet Mutation: Decrement available, increment reserved
      await tx.wallet.update({
        where: { userId: buyerUserId },
        data: {
          balanceUsd: { decrement: totalPayableCents },
          reservedBalance: { increment: totalPayableCents },
        },
      });

      if (walletV2) {
        await tx.walletV2.update({
          where: { userId: buyerUserId },
          data: {
            availableCents: { decrement: totalPayableCents },
            reservedCents: { increment: totalPayableCents },
          },
        });
      }

      // 3. Immutable Ledger Entry
      const txRef = `TX_EXCHANGE_ESCROW_RESERVE_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      await tx.ledgerTransaction.create({
        data: {
          transactionRef: txRef,
          userId: buyerUserId,
          currency: 'USD',
          amountMinor: totalPayableCents,
          entryType: 'escrow_lock',
          status: 'posted',
          createdBy: buyerUserId,
        },
      });

      // 4. Create Confirmed ExchangePayment
      const paymentCode = await generateNextPaymentCode(tx);
      const payment = await tx.exchangePayment.create({
        data: {
          paymentCode,
          tradeId: trade.id,
          buyerUserId: trade.buyerUserId,
          buyerDiscordId: trade.buyerDiscordId,
          method: 'WALLET',
          baseAmountCents: trade.grossValueCents,
          buyerFeeCents: trade.buyerFeeCents,
          paymentProcessingFeeCents: 0,
          networkFeeCents: 0,
          totalPayableCents,
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedByDiscordId: buyerUserId,
          ledgerTransactionId: txRef,
        },
      });

      // 5. Create Active Escrow Record
      const escrow = await tx.exchangeEscrow.create({
        data: {
          tradeId: trade.id,
          paymentId: payment.id,
          buyerUserId: trade.buyerUserId,
          sellerUserId: trade.sellerUserId,
          fundingSource: 'WALLET',
          reservedAmountCents: totalPayableCents,
          tradeGrossCents: trade.grossValueCents,
          buyerFeeCents: trade.buyerFeeCents,
          sellerFeeCents: trade.sellerFeeCents,
          netSellerCents: trade.netSellerCents,
          status: 'RESERVED',
          reserveLedgerId: txRef,
        },
      });

      // 6. Transition Trade Status -> PAYMENT_CONFIRMED
      const updatedTrade = await tx.exchangeTrade.update({
        where: { id: trade.id },
        data: {
          status: 'PAYMENT_CONFIRMED',
        },
      });

      // 7. Record Trade Event
      await tx.exchangeTradeEvent.create({
        data: {
          tradeId: trade.id,
          eventType: 'STATUS_CHANGED',
          actorUserId: buyerUserId,
          actorDiscordId: trade.buyerDiscordId,
          actorRole: 'BUYER',
          fromStatus: 'AWAITING_PAYMENT',
          toStatus: 'PAYMENT_CONFIRMED',
          note: `Payment confirmed via G4X Wallet ($${(totalPayableCents / 100).toFixed(2)} USD). Funds secured in Escrow.`,
          metadataJson: JSON.stringify({
            paymentCode,
            paymentId: payment.id,
            method: 'WALLET',
            totalPayableCents,
            ledgerRef: txRef,
          }),
        },
      });

      return { payment, escrow, trade: updatedTrade };
    },
    { timeout: 15000, maxWait: 10000 }
  );

  // Outside interactive transaction: log audit entry
  try {
    await logExchangeAudit({
      actorId: buyerUserId,
      action: 'EXCHANGE_PAYMENT_WALLET_CONFIRMED',
      entityType: 'EXCHANGE_PAYMENT',
      entityId: result.payment.id,
      newValues: {
        paymentCode: result.payment.paymentCode,
        tradeCode: result.trade.tradeCode,
        totalPayableCents: result.payment.totalPayableCents,
        escrowId: result.escrow.id,
      },
    });
  } catch (err) {
    console.error('[ExchangePayment] Audit logging warning:', err);
  }

  // Automatic Phase 6 Hook: Ensure private Discord room for trade
  try {
    const { ensureExchangeDiscordRoom } = await import('./exchangeDiscordService');
    await ensureExchangeDiscordRoom(result.trade.id, buyerUserId);
  } catch (err: any) {
    console.warn(`[ExchangePayment] Discord room auto-creation deferred for trade ${result.trade.id}:`, err.message || err);
  }

  return result;
}

/**
 * METHOD B: Initiate Hosted NOWPayments Invoice for crypto payment.
 */
export async function initiateTradeNowPayments(
  tradeId: string,
  buyerUserId: string,
  payCurrency?: string
): Promise<{ payment: ExchangePayment; invoiceUrl: string }> {
  const trade = await prisma.exchangeTrade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  if (trade.buyerUserId !== buyerUserId) {
    throw new TradeValidationError('Unauthorized: You are not the buyer of this trade', 403);
  }

  if (trade.status !== 'AWAITING_PAYMENT') {
    throw new TradeValidationError(
      `Trade is not awaiting payment. Current status: ${trade.status}`,
      400
    );
  }

  // Cancel any prior initiated NOWPayments payments for this trade
  await prisma.exchangePayment.updateMany({
    where: {
      tradeId: trade.id,
      status: 'INITIATED',
      method: 'NOWPAYMENTS',
    },
    data: {
      status: 'CANCELLED',
    },
  });

  const paymentCode = await generateNextPaymentCode();
  const totalPayableCents = trade.buyerTotalPayableCents;
  const amountUsd = parseFloat((totalPayableCents / 100).toFixed(2));

  // Create INITIATED payment record first
  const payment = await prisma.exchangePayment.create({
    data: {
      paymentCode,
      tradeId: trade.id,
      buyerUserId: trade.buyerUserId,
      buyerDiscordId: trade.buyerDiscordId,
      method: 'NOWPAYMENTS',
      baseAmountCents: trade.grossValueCents,
      buyerFeeCents: trade.buyerFeeCents,
      paymentProcessingFeeCents: 0,
      networkFeeCents: 0,
      totalPayableCents,
      status: 'INITIATED',
      payCurrency: payCurrency?.toLowerCase() || undefined,
    },
  });

  const providerOrderId = `EXTPAY_${payment.id}`;

  // Call NOWPayments API
  const nowPaymentsService = getNowPaymentsService();
  try {
    const invoiceResult = await nowPaymentsService.createInvoice({
      orderId: providerOrderId,
      amountUsd,
      payCurrency,
      description: `G4X Exchange Trade ${trade.tradeCode} Payment`,
    });

    const updatedPayment = await prisma.exchangePayment.update({
      where: { id: payment.id },
      data: {
        providerOrderId,
        invoiceId: invoiceResult.id,
        invoiceUrl: invoiceResult.invoice_url,
        gatewayStatus: 'waiting',
      },
    });

    return { payment: updatedPayment, invoiceUrl: invoiceResult.invoice_url };
  } catch (err: any) {
    await prisma.exchangePayment.update({
      where: { id: payment.id },
      data: { status: 'FAILED' },
    });
    throw new TradeValidationError(`NOWPayments invoice creation failed: ${err.message}`, 502);
  }
}

/**
 * Webhook handler for NOWPayments IPN routed for Exchange Payments (order_id starting with EXTPAY_)
 */
export async function handleExchangeNowPaymentsIpn(
  payload: any,
  signatureHeader?: string
): Promise<{ ok: boolean; message: string; paymentId?: string }> {
  const nowPaymentsService = getNowPaymentsService();

  // 1. Verify HMAC Signature
  const isValid = nowPaymentsService.verifyIpnSignature(payload, signatureHeader);
  if (!isValid) {
    throw new Error('INVALID_IPN_SIGNATURE: HMAC-SHA512 verification failed');
  }

  const orderId = String(payload.order_id || '');
  if (!orderId.startsWith('EXTPAY_')) {
    throw new Error(`INVALID_EXCHANGE_ORDER_ID: Order ID '${orderId}' does not belong to Exchange.`);
  }

  const paymentId = orderId.replace('EXTPAY_', '').trim();
  const payment = await prisma.exchangePayment.findUnique({
    where: { id: paymentId },
    include: { trade: true },
  });

  if (!payment) {
    throw new Error(`PAYMENT_NOT_FOUND: ExchangePayment ${paymentId} not found.`);
  }

  // 2. Idempotency Check: if already CONFIRMED, return success
  if (payment.status === 'CONFIRMED') {
    return { ok: true, message: 'Payment already confirmed and in escrow.', paymentId: payment.id };
  }

  const gatewayStatus = String(payload.payment_status || 'waiting').toLowerCase().trim();
  const actuallyPaid = payload.actually_paid != null ? String(payload.actually_paid) : null;
  const outcomeAmount = payload.outcome_amount != null ? String(payload.outcome_amount) : null;
  const outcomeCurrency = payload.outcome_currency || null;
  const payAddress = payload.pay_address || null;
  const payCurrency = payload.pay_currency || null;
  const payAmount = payload.pay_amount != null ? String(payload.pay_amount) : null;
  const providerPaymentId = payload.payment_id != null ? String(payload.payment_id) : null;

  // Append to IPN history
  const history = payment.ipnHistoryJson ? JSON.parse(payment.ipnHistoryJson) : [];
  history.push({
    timestamp: new Date().toISOString(),
    gatewayStatus,
    actuallyPaid,
    outcomeAmount,
    providerPaymentId,
  });

  // 3. Process Status Transitions
  if (gatewayStatus === 'finished') {
    // Payment Successful -> Confirm Payment, Fund Escrow & Transition Trade
    await prisma.$transaction(
      async (tx) => {
        // Double-check inside lock
        const curr = await tx.exchangePayment.findUnique({ where: { id: payment.id } });
        if (curr?.status === 'CONFIRMED') return;

        const txRef = `TX_NOWPAYMENTS_EXCHANGE_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

        let validCreator: string | null = null;
        if (payment.buyerUserId) {
          const u = await tx.user.findUnique({ where: { discordId: payment.buyerUserId } });
          if (u) validCreator = payment.buyerUserId;
        }

        // Create Ledger Transaction for crypto backing
        await tx.ledgerTransaction.create({
          data: {
            transactionRef: txRef,
            userId: payment.buyerUserId,
            currency: 'USD',
            amountMinor: payment.totalPayableCents,
            entryType: 'escrow_lock',
            status: 'posted',
            createdBy: validCreator,
          },
        });

        // Update Payment
        await tx.exchangePayment.update({
          where: { id: payment.id },
          data: {
            status: 'CONFIRMED',
            gatewayStatus: 'finished',
            confirmedAt: new Date(),
            confirmedByDiscordId: 'NOWPAYMENTS_IPN',
            actuallyPaid,
            outcomeAmount,
            outcomeCurrency,
            payAddress,
            payCurrency,
            payAmount,
            providerPaymentId,
            ipnVerified: true,
            ipnHistoryJson: JSON.stringify(history),
            ledgerTransactionId: txRef,
          },
        });

        // Create Escrow Record
        await tx.exchangeEscrow.create({
          data: {
            tradeId: payment.tradeId,
            paymentId: payment.id,
            buyerUserId: payment.buyerUserId,
            sellerUserId: payment.trade.sellerUserId,
            fundingSource: 'NOWPAYMENTS',
            reservedAmountCents: payment.totalPayableCents,
            tradeGrossCents: payment.trade.grossValueCents,
            buyerFeeCents: payment.trade.buyerFeeCents,
            sellerFeeCents: payment.trade.sellerFeeCents,
            netSellerCents: payment.trade.netSellerCents,
            status: 'RESERVED',
            reserveLedgerId: txRef,
          },
        });

        // Transition Trade Status
        await tx.exchangeTrade.update({
          where: { id: payment.tradeId },
          data: {
            status: 'PAYMENT_CONFIRMED',
          },
        });

        // Record Event
        await tx.exchangeTradeEvent.create({
          data: {
            tradeId: payment.tradeId,
            eventType: 'STATUS_CHANGED',
            actorUserId: null,
            actorDiscordId: 'SYSTEM',
            actorRole: 'SYSTEM',
            fromStatus: 'AWAITING_PAYMENT',
            toStatus: 'PAYMENT_CONFIRMED',
            note: `Payment confirmed via NOWPayments Crypto IPN. Gateway status: finished. Escrow secured.`,
            metadataJson: JSON.stringify({
              paymentCode: payment.paymentCode,
              paymentId: payment.id,
              method: 'NOWPAYMENTS',
              providerPaymentId,
              gatewayStatus: 'finished',
            }),
          },
        });
      },
      { timeout: 15000, maxWait: 10000 }
    );

    // Automatic Phase 6 Hook: Ensure private Discord room for trade
    try {
      const { ensureExchangeDiscordRoom } = await import('./exchangeDiscordService');
      await ensureExchangeDiscordRoom(payment.tradeId, 'SYSTEM_NOWPAYMENTS_IPN');
    } catch (err: any) {
      console.warn(`[ExchangePayment] Discord room auto-creation deferred for trade ${payment.tradeId}:`, err.message || err);
    }

    return { ok: true, message: 'Payment confirmed and escrow funded', paymentId: payment.id };
  } else if (gatewayStatus === 'partially_paid') {
    await prisma.exchangePayment.update({
      where: { id: payment.id },
      data: {
        status: 'PARTIALLY_PAID',
        gatewayStatus,
        actuallyPaid,
        outcomeAmount,
        providerPaymentId,
        ipnHistoryJson: JSON.stringify(history),
      },
    });
    return { ok: true, message: 'Marked partially paid', paymentId: payment.id };
  } else if (gatewayStatus === 'failed' || gatewayStatus === 'expired') {
    await prisma.exchangePayment.update({
      where: { id: payment.id },
      data: {
        status: gatewayStatus === 'expired' ? 'EXPIRED' : 'FAILED',
        gatewayStatus,
        providerPaymentId,
        ipnHistoryJson: JSON.stringify(history),
      },
    });
    return { ok: true, message: `Payment marked ${gatewayStatus}`, paymentId: payment.id };
  } else {
    // waiting, confirming, sending, etc.
    await prisma.exchangePayment.update({
      where: { id: payment.id },
      data: {
        gatewayStatus,
        providerPaymentId,
        actuallyPaid,
        ipnHistoryJson: JSON.stringify(history),
      },
    });
    return { ok: true, message: `Status updated to ${gatewayStatus}`, paymentId: payment.id };
  }
}

/**
 * METHOD C: Initiate Bank Transfer (کارت به کارت)
 */
export async function initiateTradeBankTransfer(
  tradeId: string,
  buyerUserId: string
): Promise<{ payment: ExchangePayment; bankDetails: any; instructions: string }> {
  const trade = await prisma.exchangeTrade.findUnique({
    where: { id: tradeId },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  if (trade.buyerUserId !== buyerUserId) {
    throw new TradeValidationError('Unauthorized: You are not the buyer of this trade', 403);
  }

  if (trade.status !== 'AWAITING_PAYMENT') {
    throw new TradeValidationError(
      `Trade is not awaiting payment. Current status: ${trade.status}`,
      400
    );
  }

  // Cancel prior initiated bank transfers for this trade
  await prisma.exchangePayment.updateMany({
    where: {
      tradeId: trade.id,
      status: 'INITIATED',
      method: 'BANK_TRANSFER',
    },
    data: {
      status: 'CANCELLED',
    },
  });

  const paymentCode = await generateNextPaymentCode();
  const totalPayableCents = trade.buyerTotalPayableCents;

  const payment = await prisma.exchangePayment.create({
    data: {
      paymentCode,
      tradeId: trade.id,
      buyerUserId: trade.buyerUserId,
      buyerDiscordId: trade.buyerDiscordId,
      method: 'BANK_TRANSFER',
      baseAmountCents: trade.grossValueCents,
      buyerFeeCents: trade.buyerFeeCents,
      paymentProcessingFeeCents: 0,
      networkFeeCents: 0,
      totalPayableCents,
      status: 'INITIATED',
    },
  });

  let bankDetails: any = {
    bankName: 'G4X Central Treasury',
    cardNumber: '---- ---- ---- ----',
    accountHolder: 'G4X Financial Operations',
  };

  try {
    const details = await getOfficialReceivingBankDetails();
    bankDetails = details;
  } catch (err) {
    // Fallback
  }

  return {
    payment,
    bankDetails,
    instructions: `Please transfer the exact IRT equivalent amount to the official G4X card and submit your receipt reference or screenshot.`,
  };
}

/**
 * Submits receipt evidence for Bank Transfer payment, moving status to PENDING_REVIEW.
 */
export async function submitBankReceipt(
  paymentId: string,
  buyerUserId: string,
  data: {
    bankReference?: string;
    receiptUrl: string;
    senderNote?: string;
  }
): Promise<ExchangePayment> {
  const payment = await prisma.exchangePayment.findUnique({
    where: { id: paymentId },
    include: { trade: true },
  });

  if (!payment) {
    throw new TradeValidationError('Payment not found', 404);
  }

  if (payment.buyerUserId !== buyerUserId) {
    throw new TradeValidationError('Unauthorized: You are not the owner of this payment', 403);
  }

  if (payment.method !== 'BANK_TRANSFER') {
    throw new TradeValidationError('Receipt submission only supported for Bank Transfer payments', 400);
  }

  if (payment.status !== 'INITIATED' && payment.status !== 'PENDING_REVIEW') {
    throw new TradeValidationError(`Cannot submit receipt for payment in status ${payment.status}`, 400);
  }

  if (!data.receiptUrl || !data.receiptUrl.trim()) {
    throw new TradeValidationError('Receipt URL or image proof is required', 400);
  }

  const updatedPayment = await prisma.exchangePayment.update({
    where: { id: payment.id },
    data: {
      status: 'PENDING_REVIEW',
      receiptUrl: data.receiptUrl.trim(),
      bankReference: data.bankReference?.trim() || null,
      senderNote: data.senderNote?.trim() || null,
    },
  });

  // Record trade event
  await prisma.exchangeTradeEvent.create({
    data: {
      tradeId: payment.tradeId,
      eventType: 'BANK_RECEIPT_SUBMITTED',
      actorUserId: buyerUserId,
      actorDiscordId: payment.buyerDiscordId,
      actorRole: 'BUYER',
      fromStatus: payment.trade.status,
      toStatus: payment.trade.status,
      note: `Buyer submitted bank transfer receipt (Ref: ${data.bankReference || 'N/A'}). Awaiting admin verification.`,
      metadataJson: JSON.stringify({
        paymentId: payment.id,
        paymentCode: payment.paymentCode,
        bankReference: data.bankReference,
        receiptUrl: data.receiptUrl,
      }),
    },
  });

  return updatedPayment;
}

/**
 * Admin/Owner reviews & approves Bank Transfer payment: funds Escrow and confirms Trade.
 */
export async function approveBankTransferPayment(
  paymentId: string,
  adminDiscordId: string,
  reviewNote?: string
): Promise<{ payment: ExchangePayment; escrow: ExchangeEscrow; trade: ExchangeTrade }> {
  const payment = await prisma.exchangePayment.findUnique({
    where: { id: paymentId },
    include: { trade: true },
  });

  if (!payment) {
    throw new TradeValidationError('Payment not found', 404);
  }

  if (payment.method !== 'BANK_TRANSFER') {
    throw new TradeValidationError('Only Bank Transfer payments can be manually reviewed and approved', 400);
  }

  if (payment.status !== 'PENDING_REVIEW' && payment.status !== 'INITIATED') {
    throw new TradeValidationError(`Payment is not pending review. Current status: ${payment.status}`, 400);
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const txRef = `TX_BANK_TRANSFER_EXCHANGE_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      // 1. Create Ledger Transaction for bank deposit backing
      await tx.ledgerTransaction.create({
        data: {
          transactionRef: txRef,
          userId: payment.buyerUserId,
          currency: 'USD',
          amountMinor: payment.totalPayableCents,
          entryType: 'escrow_lock',
          status: 'posted',
          createdBy: adminDiscordId,
        },
      });

      // 2. Mark Payment CONFIRMED
      const confirmedPayment = await tx.exchangePayment.update({
        where: { id: payment.id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedByDiscordId: adminDiscordId,
          reviewedByDiscordId: adminDiscordId,
          reviewedAt: new Date(),
          reviewNote: reviewNote?.trim() || 'Verified and approved by administration.',
          ledgerTransactionId: txRef,
        },
      });

      // 3. Create Escrow Record
      const escrow = await tx.exchangeEscrow.create({
        data: {
          tradeId: payment.tradeId,
          paymentId: payment.id,
          buyerUserId: payment.buyerUserId,
          sellerUserId: payment.trade.sellerUserId,
          fundingSource: 'BANK_TRANSFER',
          reservedAmountCents: payment.totalPayableCents,
          tradeGrossCents: payment.trade.grossValueCents,
          buyerFeeCents: payment.trade.buyerFeeCents,
          sellerFeeCents: payment.trade.sellerFeeCents,
          netSellerCents: payment.trade.netSellerCents,
          status: 'RESERVED',
          reserveLedgerId: txRef,
        },
      });

      // 4. Transition Trade Status -> PAYMENT_CONFIRMED
      const updatedTrade = await tx.exchangeTrade.update({
        where: { id: payment.tradeId },
        data: {
          status: 'PAYMENT_CONFIRMED',
        },
      });

      // 5. Record Event
      await tx.exchangeTradeEvent.create({
        data: {
          tradeId: payment.tradeId,
          eventType: 'STATUS_CHANGED',
          actorUserId: null,
          actorDiscordId: adminDiscordId,
          actorRole: 'ADMIN',
          fromStatus: 'AWAITING_PAYMENT',
          toStatus: 'PAYMENT_CONFIRMED',
          note: `Bank transfer approved by admin (${adminDiscordId}). Escrow secured.`,
          metadataJson: JSON.stringify({
            paymentCode: payment.paymentCode,
            paymentId: payment.id,
            method: 'BANK_TRANSFER',
            adminDiscordId,
            reviewNote,
          }),
        },
      });

      return { payment: confirmedPayment, escrow, trade: updatedTrade };
    },
    { timeout: 15000, maxWait: 10000 }
  );

  // Outside transaction audit log
  try {
    await logExchangeAudit({
      actorId: adminDiscordId,
      action: 'EXCHANGE_PAYMENT_BANK_APPROVED',
      entityType: 'EXCHANGE_PAYMENT',
      entityId: result.payment.id,
      newValues: {
        paymentCode: result.payment.paymentCode,
        tradeCode: result.trade.tradeCode,
        adminDiscordId,
        reviewNote,
      },
    });
  } catch (err) {
    console.error('[ExchangePayment] Audit logging warning:', err);
  }

  // Automatic Phase 6 Hook: Ensure private Discord room for trade
  try {
    const { ensureExchangeDiscordRoom } = await import('./exchangeDiscordService');
    await ensureExchangeDiscordRoom(result.trade.id, adminDiscordId);
  } catch (err: any) {
    console.warn(`[ExchangePayment] Discord room auto-creation deferred for trade ${result.trade.id}:`, err.message || err);
  }

  return result;
}

/**
 * Admin rejects a Bank Transfer payment.
 */
export async function rejectBankTransferPayment(
  paymentId: string,
  adminDiscordId: string,
  rejectionReason: string
): Promise<ExchangePayment> {
  const payment = await prisma.exchangePayment.findUnique({
    where: { id: paymentId },
    include: { trade: true },
  });

  if (!payment) {
    throw new TradeValidationError('Payment not found', 404);
  }

  if (payment.method !== 'BANK_TRANSFER') {
    throw new TradeValidationError('Only Bank Transfer payments can be reviewed', 400);
  }

  if (!rejectionReason || !rejectionReason.trim()) {
    throw new TradeValidationError('Rejection reason is required', 400);
  }

  const updatedPayment = await prisma.exchangePayment.update({
    where: { id: payment.id },
    data: {
      status: 'FAILED',
      reviewedByDiscordId: adminDiscordId,
      reviewedAt: new Date(),
      reviewNote: rejectionReason.trim(),
    },
  });

  // Record trade event
  await prisma.exchangeTradeEvent.create({
    data: {
      tradeId: payment.tradeId,
      eventType: 'BANK_RECEIPT_REJECTED',
      actorUserId: null,
      actorDiscordId: adminDiscordId,
      actorRole: 'ADMIN',
      fromStatus: payment.trade.status,
      toStatus: payment.trade.status,
      note: `Bank transfer rejected by admin (${adminDiscordId}): ${rejectionReason.trim()}`,
      metadataJson: JSON.stringify({
        paymentId: payment.id,
        paymentCode: payment.paymentCode,
        rejectionReason: rejectionReason.trim(),
      }),
    },
  });

  return updatedPayment;
}

/**
 * Manually syncs live NOWPayments status for an active payment.
 */
export async function syncTradeNowPaymentsStatus(
  paymentId: string
): Promise<{ status: string; payment: ExchangePayment }> {
  const payment = await prisma.exchangePayment.findUnique({
    where: { id: paymentId },
    include: { trade: true },
  });

  if (!payment) {
    throw new TradeValidationError('Payment not found', 404);
  }

  if (!payment.providerPaymentId && !payment.invoiceId) {
    throw new TradeValidationError('No NOWPayments payment ID or invoice ID associated with this record', 400);
  }

  const np = getNowPaymentsService();
  if (payment.providerPaymentId) {
    const liveStatus = await np.getPaymentStatus(payment.providerPaymentId);
    if (liveStatus.payment_status === 'finished' && payment.status !== 'CONFIRMED') {
      await handleExchangeNowPaymentsIpn({
        payment_id: liveStatus.payment_id,
        order_id: payment.providerOrderId || `EXTPAY_${payment.id}`,
        payment_status: 'finished',
        actually_paid: liveStatus.actually_paid,
        outcome_amount: liveStatus.outcome_amount,
      }, undefined); // internal direct sync
    }
  }

  const fresh = await prisma.exchangePayment.findUnique({ where: { id: payment.id } });
  return { status: fresh?.status || payment.status, payment: fresh || payment };
}

/**
 * Upgraded Trade Cancellation with Escrow & Central Wallet Refund Check:
 *  - If AWAITING_PAYMENT: cancels unpaid payments and calls cancelUnpaidTrade (releasing buy order capacity).
 *  - If PAYMENT_CONFIRMED: ONLY Admin or Owner can cancel!
 *    Atomically refunds buyer's wallet, records immutable refund ledger, sets escrow REFUNDED,
 *    marks trade CANCELLED, and releases buy order capacity.
 */
export async function cancelExchangeTradeWithEscrowCheck(params: {
  tradeId: string;
  actorUserId: string;
  actorRoles: string[];
  reason?: string;
}): Promise<ExchangeTrade> {
  const { tradeId, actorUserId, actorRoles, reason } = params;

  const trade = await prisma.exchangeTrade.findUnique({
    where: { id: tradeId },
    include: { escrow: true, payments: true, buyOrder: true },
  });

  if (!trade) {
    throw new TradeValidationError('Trade not found', 404);
  }

  const isStaffOrOwner =
    actorRoles.includes('admin') ||
    actorRoles.includes('owner') ||
    actorRoles.includes('staff');
  const isParticipant =
    trade.buyerUserId === actorUserId || trade.sellerUserId === actorUserId;

  if (!isParticipant && !isStaffOrOwner) {
    throw new TradeValidationError('Unauthorized: You cannot cancel this trade.', 403);
  }

  // Case 1: Unpaid Trade (AWAITING_PAYMENT)
  if (trade.status === 'AWAITING_PAYMENT') {
    // Cancel any initiated/pending payments
    await prisma.exchangePayment.updateMany({
      where: {
        tradeId: trade.id,
        status: { in: ['INITIATED', 'PENDING_REVIEW'] },
      },
      data: {
        status: 'CANCELLED',
      },
    });

    return cancelUnpaidTrade({ tradeId, actorUserId, actorRoles, reason });
  }

  // Case 2: Paid Trade with Secured Escrow (PAYMENT_CONFIRMED or DELIVERY_IN_PROGRESS)
  if (trade.status === 'PAYMENT_CONFIRMED' || trade.status === 'DELIVERY_IN_PROGRESS') {
    if (!isStaffOrOwner) {
      throw new TradeValidationError(
        'Unauthorized: Only Admin or Owner can cancel and refund a trade with secured escrow.',
        403
      );
    }

    const escrow = trade.escrow;
    if (!escrow || escrow.status !== 'RESERVED') {
      throw new TradeValidationError('No active reserved escrow found to refund.', 400);
    }

    const refundAmountCents = escrow.reservedAmountCents;

    const updatedTrade = await prisma.$transaction(
      async (tx) => {
        const txRef = `TX_EXCHANGE_ESCROW_REFUND_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

        // 1. Refund Central Wallet
        if (escrow.fundingSource === 'WALLET') {
          // Revert: increment balanceUsd, decrement reservedBalance
          await tx.wallet.update({
            where: { userId: trade.buyerUserId },
            data: {
              balanceUsd: { increment: refundAmountCents },
              reservedBalance: { decrement: refundAmountCents },
            },
          });

          const w2 = await tx.walletV2.findUnique({ where: { userId: trade.buyerUserId } });
          if (w2) {
            await tx.walletV2.update({
              where: { userId: trade.buyerUserId },
              data: {
                availableCents: { increment: refundAmountCents },
                reservedCents: { decrement: refundAmountCents },
              },
            });
          }
        } else {
          // Funding came from Crypto / Bank: credit buyer's central wallet available balance
          await tx.wallet.update({
            where: { userId: trade.buyerUserId },
            data: {
              balanceUsd: { increment: refundAmountCents },
            },
          });

          const w2 = await tx.walletV2.findUnique({ where: { userId: trade.buyerUserId } });
          if (w2) {
            await tx.walletV2.update({
              where: { userId: trade.buyerUserId },
              data: {
                availableCents: { increment: refundAmountCents },
              },
            });
          }
        }

        // 2. Ledger Transaction for refund
        await tx.ledgerTransaction.create({
          data: {
            transactionRef: txRef,
            userId: trade.buyerUserId,
            currency: 'USD',
            amountMinor: refundAmountCents,
            entryType: 'refund',
            status: 'posted',
            createdBy: actorUserId,
          },
        });

        // 3. Mark Escrow REFUNDED
        await tx.exchangeEscrow.update({
          where: { id: escrow.id },
          data: {
            status: 'REFUNDED',
            refundedAt: new Date(),
            refundedAmountCents: refundAmountCents,
            resolutionLedgerId: txRef,
            resolutionNote: reason?.trim() || 'Trade cancelled by administration; funds refunded.',
          },
        });

        // 4. Mark Payment REFUNDED
        await tx.exchangePayment.updateMany({
          where: { tradeId: trade.id, status: 'CONFIRMED' },
          data: { status: 'REFUNDED' },
        });

        // 5. Update Trade -> CANCELLED
        const resTrade = await tx.exchangeTrade.update({
          where: { id: trade.id },
          data: {
            status: 'CANCELLED',
            capacityReserved: false,
            cancelledByDiscordId: actorUserId,
            cancelReason: reason?.trim() || 'Cancelled and refunded by administration.',
          },
        });

        // 6. Release Capacity back to Buy Order
        if (trade.buyOrder) {
          const tradeQtyBig = BigInt(trade.quantityBaseUnits);
          const currReservedBig = BigInt(trade.buyOrder.reservedCapacityBaseUnits);
          const currRemainingBig = BigInt(trade.buyOrder.remainingCapacityBaseUnits);
          const totalCapacityBig = BigInt(trade.buyOrder.totalCapacityBaseUnits);

          const newReservedBig = currReservedBig >= tradeQtyBig ? currReservedBig - tradeQtyBig : 0n;
          const newRemainingBig = currRemainingBig + tradeQtyBig;

          let nextOrderStatus = trade.buyOrder.status;
          if (trade.buyOrder.status === 'FULLY_RESERVED' || trade.buyOrder.status === 'PARTIALLY_FILLED') {
            nextOrderStatus = newRemainingBig >= totalCapacityBig ? 'ACTIVE' : 'PARTIALLY_FILLED';
          }

          await tx.exchangeBuyOrder.update({
            where: { id: trade.buyOrder.id },
            data: {
              reservedCapacityBaseUnits: newReservedBig.toString(),
              remainingCapacityBaseUnits: newRemainingBig.toString(),
              status: nextOrderStatus,
              version: { increment: 1 },
            },
          });
        }

        // 7. Record Trade Event
        await tx.exchangeTradeEvent.create({
          data: {
            tradeId: trade.id,
            eventType: 'TRADE_CANCELLED',
            actorUserId: isStaffOrOwner ? null : actorUserId,
            actorDiscordId: actorUserId,
            actorRole: 'ADMIN',
            fromStatus: trade.status,
            toStatus: 'CANCELLED',
            note: `Trade cancelled & escrow refunded ($${(refundAmountCents / 100).toFixed(2)} USD). Reason: ${reason || 'Admin cancellation'}`,
            metadataJson: JSON.stringify({
              refundAmountCents,
              escrowId: escrow.id,
              ledgerRef: txRef,
            }),
          },
        });

        return resTrade;
      },
      { timeout: 15000, maxWait: 10000 }
    );

    // Outside transaction audit log
    try {
      await logExchangeAudit({
        actorId: isStaffOrOwner ? null : actorUserId,
        action: 'EXCHANGE_TRADE_CANCEL_AND_REFUND',
        entityType: 'EXCHANGE_TRADE',
        entityId: trade.id,
        previousValues: { status: trade.status },
        newValues: { status: 'CANCELLED', refundAmountCents },
      });
    } catch (err) {
      console.error('[ExchangePayment] Audit logging warning:', err);
    }

    return updatedTrade;
  }

  throw new TradeValidationError(
    `Trade in status ${trade.status} cannot be cancelled through this flow.`,
    400
  );
}
