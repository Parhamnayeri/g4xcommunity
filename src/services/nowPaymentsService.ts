/**
 * nowPaymentsService.ts — Production-Grade NOWPayments API v1 Service & Deposit Management Engine
 *
 * Implements:
 * 1. Gateway configuration & health status check (Live vs Sandbox)
 * 2. Hosted invoice creation (POST /v1/invoice)
 * 3. Payment status lookup & live synchronization (GET /v1/payment/:id)
 * 4. HMAC-SHA512 IPN signature verification with constant-time comparison
 * 5. Atomic, idempotent balance crediting inside prisma.$transaction
 * 6. IPN event history auditing & status transitions
 */

import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import prisma from '../database/db';

export interface NowPaymentsConfig {
  apiKey: string;
  ipnSecret: string;
  isSandbox: boolean;
  baseUrl: string;
}

export interface CreateInvoiceInput {
  orderId: string | number;
  amountUsd: number;
  payCurrency?: string;
  description?: string;
  ipnCallbackUrl?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface NowPaymentsInvoiceResult {
  id: string;
  token_id?: string;
  order_id: string;
  order_description?: string;
  price_amount: number;
  price_currency: string;
  pay_currency?: string;
  ipn_callback_url?: string;
  invoice_url: string;
  success_url?: string;
  cancel_url?: string;
  created_at?: string;
  updated_at?: string;
}

export interface NowPaymentsPaymentResult {
  payment_id: string | number;
  invoice_id?: string | number;
  payment_status: string;
  pay_address?: string;
  price_amount?: number;
  price_currency?: string;
  pay_amount?: number;
  actually_paid?: number;
  pay_currency?: string;
  order_id?: string;
  order_description?: string;
  purchase_id?: string;
  outcome_amount?: number;
  outcome_currency?: string;
  created_at?: string;
  updated_at?: string;
}

export interface GatewayHealthResult {
  configured: boolean;
  ipnSecretConfigured: boolean;
  isSandbox: boolean;
  baseUrl: string;
  apiConnected?: boolean;
  statusMessage?: string;
}

export interface IpnHistoryEntry {
  timestamp: string;
  source: 'IPN' | 'API_SYNC' | 'MANUAL_ADMIN';
  status: string;
  actuallyPaid?: number;
  payAmount?: number;
  outcomeAmount?: number;
  payCurrency?: string;
  paymentId?: string;
  invoiceId?: string;
  note?: string;
  raw?: Record<string, any>;
}

/**
 * Reads NOWPayments credentials and sandbox toggle from environment
 */
export function getNowPaymentsConfig(): NowPaymentsConfig {
  const apiKey = (process.env.NOWPAYMENTS_API_KEY || '').trim();
  const ipnSecret = (process.env.NOWPAYMENTS_IPN_SECRET || '').trim();
  const sandboxEnv = (process.env.NOWPAYMENTS_SANDBOX || '').toLowerCase().trim();
  const isSandbox = sandboxEnv === 'true' || sandboxEnv === '1' || sandboxEnv === 'yes';

  const baseUrl = isSandbox
    ? 'https://api-sandbox.nowpayments.io/v1'
    : 'https://api.nowpayments.io/v1';

  return {
    apiKey,
    ipnSecret,
    isSandbox,
    baseUrl,
  };
}

/**
 * Recursively sorts object keys alphabetically for deterministic canonical serialization
 */
export function sortObjectKeysRecursively(obj: any): any {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }
  return Object.keys(obj)
    .sort()
    .reduce((result: Record<string, any>, key: string) => {
      const val = obj[key];
      result[key] =
        val && typeof val === 'object' && !Array.isArray(val)
          ? sortObjectKeysRecursively(val)
          : val;
      return result;
    }, {});
}

/**
 * Maps NOWPayments gateway status string to normalized internal status
 */
export function mapGatewayStatusToInternal(gatewayStatus: string): string {
  const normalized = (gatewayStatus || '').toLowerCase().trim();
  switch (normalized) {
    case 'finished':
      return 'CONFIRMED';
    case 'partially_paid':
      return 'PARTIALLY_PAID';
    case 'confirming':
    case 'confirmed':
    case 'sending':
      return 'PROCESSING';
    case 'failed':
    case 'refunded':
      return 'FAILED';
    case 'expired':
      return 'EXPIRED';
    case 'cancelled':
      return 'CANCELLED';
    case 'waiting':
    default:
      return 'WAITING';
  }
}

export class NowPaymentsService {
  private axiosInstance: AxiosInstance;
  private config: NowPaymentsConfig;

  constructor(customConfig?: Partial<NowPaymentsConfig>) {
    this.config = { ...getNowPaymentsConfig(), ...customConfig };
    this.axiosInstance = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 15000,
      headers: {
        'x-api-key': this.config.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Returns current gateway configuration metadata
   */
  getGatewayHealth(): GatewayHealthResult {
    return {
      configured: Boolean(this.config.apiKey),
      ipnSecretConfigured: Boolean(this.config.ipnSecret),
      isSandbox: this.config.isSandbox,
      baseUrl: this.config.baseUrl,
    };
  }

  /**
   * 1. GET /v1/status — Checks live API availability
   */
  async checkApiStatus(): Promise<{ ok: boolean; message: string; isSandbox: boolean }> {
    if (!this.config.apiKey) {
      return { ok: false, message: 'NOWPAYMENTS_API_KEY not configured', isSandbox: this.config.isSandbox };
    }
    try {
      const response = await this.axiosInstance.get('/status');
      return {
        ok: true,
        message: response.data?.message || 'OK',
        isSandbox: this.config.isSandbox,
      };
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.message || 'API Unreachable';
      return {
        ok: false,
        message: errorMsg,
        isSandbox: this.config.isSandbox,
      };
    }
  }

  /**
   * 2. POST /v1/invoice — Generates a hosted payment invoice
   */
  async createInvoice(input: CreateInvoiceInput): Promise<NowPaymentsInvoiceResult> {
    if (!this.config.apiKey) {
      throw new Error('NOWPAYMENTS_NOT_CONFIGURED: NOWPAYMENTS_API_KEY is missing');
    }

    const payload: Record<string, any> = {
      price_amount: input.amountUsd,
      price_currency: 'usd',
      order_id: String(input.orderId),
      order_description: input.description || `G4X Deposit #${input.orderId}`,
    };

    if (input.payCurrency) {
      payload.pay_currency = input.payCurrency.toLowerCase();
    }
    if (input.ipnCallbackUrl) {
      payload.ipn_callback_url = input.ipnCallbackUrl;
    }
    if (input.successUrl) {
      payload.success_url = input.successUrl;
    }
    if (input.cancelUrl) {
      payload.cancel_url = input.cancelUrl;
    }

    try {
      const res = await this.axiosInstance.post('/invoice', payload);
      const data = res.data;

      if (!data || !data.invoice_url || typeof data.invoice_url !== 'string') {
        throw new Error('NOWPAYMENTS_INVALID_RESPONSE: Response missing valid invoice_url');
      }

      if (!data.invoice_url.startsWith('https://') && !data.invoice_url.startsWith('http://')) {
        throw new Error(`NOWPAYMENTS_INVALID_INVOICE_URL: URL '${data.invoice_url}' is not a valid absolute web URL`);
      }

      return {
        id: String(data.id),
        token_id: data.token_id ? String(data.token_id) : undefined,
        order_id: String(data.order_id || input.orderId),
        order_description: data.order_description,
        price_amount: Number(data.price_amount || input.amountUsd),
        price_currency: data.price_currency || 'usd',
        pay_currency: data.pay_currency,
        ipn_callback_url: data.ipn_callback_url,
        invoice_url: data.invoice_url,
        success_url: data.success_url,
        cancel_url: data.cancel_url,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };
    } catch (err: any) {
      if (err.response) {
        const errorMsg = err.response.data?.message || err.response.data?.error || JSON.stringify(err.response.data);
        throw new Error(`NOWPAYMENTS_INVOICE_ERROR (HTTP ${err.response.status}): ${errorMsg}`);
      }
      throw new Error(`NOWPAYMENTS_INVOICE_NETWORK_ERROR: ${err.message}`);
    }
  }

  /**
   * 3. GET /v1/payment/:payment_id — Queries live status from NOWPayments
   */
  async getPaymentStatus(paymentId: string | number): Promise<NowPaymentsPaymentResult> {
    if (!this.config.apiKey) {
      throw new Error('NOWPAYMENTS_NOT_CONFIGURED: NOWPAYMENTS_API_KEY is missing');
    }

    try {
      const res = await this.axiosInstance.get(`/payment/${paymentId}`);
      const d = res.data;
      return {
        payment_id: d.payment_id || paymentId,
        invoice_id: d.invoice_id,
        payment_status: String(d.payment_status || 'waiting').toLowerCase(),
        pay_address: d.pay_address,
        price_amount: d.price_amount != null ? Number(d.price_amount) : undefined,
        price_currency: d.price_currency,
        pay_amount: d.pay_amount != null ? Number(d.pay_amount) : undefined,
        actually_paid: d.actually_paid != null ? Number(d.actually_paid) : undefined,
        pay_currency: d.pay_currency,
        order_id: d.order_id ? String(d.order_id) : undefined,
        order_description: d.order_description,
        purchase_id: d.purchase_id ? String(d.purchase_id) : undefined,
        outcome_amount: d.outcome_amount != null ? Number(d.outcome_amount) : undefined,
        outcome_currency: d.outcome_currency,
        created_at: d.created_at,
        updated_at: d.updated_at,
      };
    } catch (err: any) {
      if (err.response) {
        const errorMsg = err.response.data?.message || err.response.data?.error || JSON.stringify(err.response.data);
        throw new Error(`NOWPAYMENTS_STATUS_ERROR (HTTP ${err.response.status}): ${errorMsg}`);
      }
      throw new Error(`NOWPAYMENTS_STATUS_NETWORK_ERROR: ${err.message}`);
    }
  }

  /**
   * 4. Verifies HMAC-SHA512 IPN signature using constant-time comparison
   */
  verifyIpnSignature(
    body: Record<string, unknown>,
    signatureHeader: string | undefined | null,
    customSecret?: string
  ): boolean {
    if (!signatureHeader || typeof signatureHeader !== 'string') {
      return false;
    }

    const secret = (customSecret || this.config.ipnSecret).trim();
    if (!secret) {
      console.warn('[NOWPayments] IPN signature verification failed: NOWPAYMENTS_IPN_SECRET not set');
      return false;
    }

    try {
      const sorted = sortObjectKeysRecursively(body);
      const serialized = JSON.stringify(sorted);

      const hmac = crypto.createHmac('sha512', secret);
      hmac.update(serialized);
      const expectedSignature = hmac.digest('hex');

      const expectedBuffer = Buffer.from(expectedSignature, 'hex');
      const receivedBuffer = Buffer.from(signatureHeader.trim().toLowerCase(), 'hex');

      if (expectedBuffer.length !== receivedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    } catch (err: any) {
      console.error('[NOWPayments] Error verifying IPN signature:', err?.message || err);
      return false;
    }
  }

  /**
   * 5. Atomically credits a deposit to user wallet and ledger inside a Prisma transaction
   */
  async creditDepositAtomic(
    depositId: number,
    customCreditAmountUsd?: number,
    actorId?: string,
    reason?: string
  ) {
    return await prisma.$transaction(async (tx) => {
      const deposit = await tx.depositIntent.findUnique({
        where: { id: depositId },
        include: {
          user: {
            include: {
              wallet: true,
              walletV2: true,
            },
          },
        },
      });

      if (!deposit) {
        throw new Error(`DEPOSIT_NOT_FOUND: Deposit #${depositId} does not exist`);
      }

      // Idempotency check: if already credited, return cleanly
      if (deposit.creditedAt !== null || deposit.status === 'CONFIRMED') {
        return {
          success: true,
          alreadyCredited: true,
          message: `Deposit #${depositId} is already confirmed and credited.`,
          deposit,
        };
      }

      const creditUsd =
        typeof customCreditAmountUsd === 'number' && customCreditAmountUsd > 0
          ? customCreditAmountUsd
          : deposit.amountUsd;
      const amountCents = Math.round(creditUsd * 100);
      const discordId = deposit.userId;

      // Auto-create Wallet v1 if missing
      let wallet = deposit.user.wallet;
      if (!wallet) {
        wallet = await tx.wallet.create({
          data: {
            userId: discordId,
            balanceUsd: 0,
            escrowUsd: 0,
            frozenBalance: 0,
            isFrozen: false,
          },
        });
      }

      // Auto-create WalletV2 if missing
      let walletV2 = deposit.user.walletV2;
      if (!walletV2) {
        walletV2 = await tx.walletV2.create({
          data: {
            userId: discordId,
            availableCents: 0,
            reservedCents: 0,
            frozenCents: 0,
            isFrozen: false,
          },
        });
      }

      const newBalanceUsd = wallet.balanceUsd + amountCents;
      const newAvailableCents = walletV2.availableCents + amountCents;

      // Update Wallet v1
      await tx.wallet.update({
        where: { userId: discordId },
        data: { balanceUsd: newBalanceUsd },
      });

      // Update WalletV2
      const updatedWalletV2 = await tx.walletV2.update({
        where: { userId: discordId },
        data: { availableCents: newAvailableCents },
      });

      // Verify actor exists in User if provided to satisfy creator foreign key
      let validActorId: string | null = null;
      if (actorId) {
        const actorUser = await tx.user.findUnique({ where: { discordId: actorId } });
        if (actorUser) {
          validActorId = actorId;
        }
      }

      // Immutable Ledger Transaction (v1)
      const txRef = `TX_NP_DEP_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      await tx.ledgerTransaction.create({
        data: {
          transactionRef: txRef,
          userId: discordId,
          currency: 'USD',
          amountMinor: amountCents,
          entryType: 'credit',
          status: 'posted',
          createdBy: validActorId,
        },
      });

      // Immutable Ledger Entry (v2)
      const entryRef = `L2_NP_DEP_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      await tx.ledgerEntryV2.create({
        data: {
          entryRef,
          accountType: 'USER_WALLET',
          userId: discordId,
          amountCents,
          entryType: 'DEPOSIT',
          direction: 'CREDIT',
          balanceAfterAvailableCents: newAvailableCents,
          balanceAfterReservedCents: walletV2.reservedCents,
          description: `[NOWPAYMENTS_DEPOSIT] Deposit Credited: $${creditUsd.toFixed(2)} (${deposit.payCurrency}) - Ref: ${deposit.intentRef}`,
          metadata: JSON.stringify({
            depositId: deposit.id,
            intentRef: deposit.intentRef,
            amountUsd: creditUsd,
            originalAmountUsd: deposit.amountUsd,
            payCurrency: deposit.payCurrency,
            paymentId: deposit.paymentId,
            invoiceId: deposit.invoiceId,
            source: actorId ? 'MANUAL_ADMIN_CONFIRM' : 'IPN_AUTO_CREDIT',
            actorId,
            reason: reason || 'NOWPayments deposit credited',
          }),
          createdBy: validActorId,
        },
      });

      // Existing metadata preserve
      let existingMeta: any = {};
      try {
        if (deposit.metadata) existingMeta = JSON.parse(deposit.metadata);
      } catch {}

      // Update DepositIntent
      const updatedDeposit = await tx.depositIntent.update({
        where: { id: deposit.id },
        data: {
          status: 'CONFIRMED',
          gatewayStatus: 'finished',
          confirmedAt: new Date(),
          creditedAt: new Date(),
          creditedLedgerId: txRef,
          metadata: JSON.stringify({
            ...existingMeta,
            creditedAmountUsd: creditUsd,
            creditedAt: new Date().toISOString(),
            creditedLedgerId: txRef,
            confirmedBy: actorId ?? null,
            reason: reason || 'NOWPayments deposit confirmed and credited',
          }),
        },
      });

      // Immutable Audit Log
      await tx.auditLog.create({
        data: {
          actorId: validActorId,
          action: 'NOWPAYMENTS_DEPOSIT_CREDITED',
          entityType: 'DepositIntent',
          entityId: String(deposit.id),
          previousValues: JSON.stringify({
            status: deposit.status,
            amountUsd: deposit.amountUsd,
            creditedAt: deposit.creditedAt,
          }),
          newValues: JSON.stringify({
            status: 'CONFIRMED',
            amountUsd: deposit.amountUsd,
            creditedAmountUsd: creditUsd,
            creditedLedgerId: txRef,
            newBalanceUsd,
            newAvailableCents,
            actorId,
          }),
          reason: reason || 'NOWPayments deposit confirmed and balance credited',
          isSuccess: true,
        },
      });

      return {
        success: true,
        alreadyCredited: false,
        message: `Deposit #${deposit.id} ($${creditUsd.toFixed(2)}) confirmed and credited to ${deposit.user.username}.`,
        deposit: updatedDeposit,
        wallet: {
          discordId,
          availableBalance: parseFloat((updatedWalletV2.availableCents / 100).toFixed(2)),
          pendingEscrowBalance: parseFloat((updatedWalletV2.reservedCents / 100).toFixed(2)),
        },
      };
    });
  }

  /**
   * 6. Processes incoming IPN webhook for DepositIntent
   */
  async processDepositIpn(
    payload: Record<string, any>,
    signatureHeader: string | undefined | null
  ) {
    // 1. Verify HMAC-SHA512 signature
    const isValid = this.verifyIpnSignature(payload, signatureHeader);
    if (!isValid) {
      await prisma.auditLog.create({
        data: {
          action: 'NOWPAYMENTS_IPN_SIGNATURE_REJECTED',
          entityType: 'DepositIntent',
          entityId: String(payload?.payment_id || payload?.order_id || 'unknown'),
          reason: 'HMAC-SHA512 signature mismatch or missing signature header',
          newValues: JSON.stringify({
            payment_id: payload?.payment_id,
            order_id: payload?.order_id,
            receivedSig: signatureHeader,
          }),
          isSuccess: false,
        },
      });
      throw new Error('INVALID_IPN_SIGNATURE: Webhook signature verification failed');
    }

    const orderIdStr = payload.order_id ? String(payload.order_id).trim() : null;
    const paymentIdStr = payload.payment_id ? String(payload.payment_id).trim() : null;
    const invoiceIdStr = payload.invoice_id ? String(payload.invoice_id).trim() : null;

    // 2. Find matching DepositIntent
    let deposit: any = null;
    if (orderIdStr && /^\d+$/.test(orderIdStr)) {
      deposit = await prisma.depositIntent.findUnique({
        where: { id: parseInt(orderIdStr, 10) },
        include: { user: true },
      });
    }

    if (!deposit && orderIdStr) {
      deposit = await prisma.depositIntent.findUnique({
        where: { intentRef: orderIdStr },
        include: { user: true },
      });
    }

    if (!deposit && paymentIdStr) {
      deposit = await prisma.depositIntent.findUnique({
        where: { paymentId: paymentIdStr },
        include: { user: true },
      });
    }

    if (!deposit && invoiceIdStr) {
      deposit = await prisma.depositIntent.findFirst({
        where: { invoiceId: invoiceIdStr },
        include: { user: true },
      });
    }

    if (!deposit) {
      return null; // Not a DepositIntent (allow caller to fall back to legacy payment attempt)
    }

    const gatewayStatus = String(payload.payment_status || 'waiting').toLowerCase().trim();
    const internalStatus = mapGatewayStatusToInternal(gatewayStatus);

    // Parse and append IPN history
    let history: IpnHistoryEntry[] = [];
    try {
      if (deposit.ipnHistoryJson) {
        history = JSON.parse(deposit.ipnHistoryJson);
        if (!Array.isArray(history)) history = [];
      }
    } catch {
      history = [];
    }

    const newHistoryEntry: IpnHistoryEntry = {
      timestamp: new Date().toISOString(),
      source: 'IPN',
      status: gatewayStatus,
      actuallyPaid: payload.actually_paid != null ? Number(payload.actually_paid) : undefined,
      payAmount: payload.pay_amount != null ? Number(payload.pay_amount) : undefined,
      outcomeAmount: payload.outcome_amount != null ? Number(payload.outcome_amount) : undefined,
      payCurrency: payload.pay_currency,
      paymentId: paymentIdStr || deposit.paymentId || undefined,
      invoiceId: invoiceIdStr || deposit.invoiceId || undefined,
      raw: payload,
    };
    history.unshift(newHistoryEntry);
    if (history.length > 25) {
      history = history.slice(0, 25);
    }

    // Update telemetry on DepositIntent
    deposit = await prisma.depositIntent.update({
      where: { id: deposit.id },
      data: {
        paymentId: paymentIdStr || deposit.paymentId,
        purchaseId: payload.purchase_id ? String(payload.purchase_id) : deposit.purchaseId,
        payAddress: payload.pay_address || deposit.payAddress,
        payCurrency: payload.pay_currency ? String(payload.pay_currency).toUpperCase() : deposit.payCurrency,
        priceAmount: payload.price_amount != null ? Number(payload.price_amount) : deposit.priceAmount,
        payAmount: payload.pay_amount != null ? Number(payload.pay_amount) : deposit.payAmount,
        actuallyPaid: payload.actually_paid != null ? Number(payload.actually_paid) : deposit.actuallyPaid,
        outcomeAmount: payload.outcome_amount != null ? Number(payload.outcome_amount) : deposit.outcomeAmount,
        outcomeCurrency: payload.outcome_currency || deposit.outcomeCurrency,
        gatewayStatus,
        status: deposit.status === 'CONFIRMED' ? 'CONFIRMED' : internalStatus,
        ipnVerified: true,
        lastIpnAt: new Date(),
        ipnHistoryJson: JSON.stringify(history),
      },
      include: { user: true },
    });

    // If finished, check live credits flag before triggering atomic credit
    if (gatewayStatus === 'finished') {
      const liveCreditsEnabled = String(process.env.FINANCE_V2_LIVE_CREDITS_ENABLED || '').trim().toLowerCase() === 'true';
      if (liveCreditsEnabled) {
        const creditRes = await this.creditDepositAtomic(deposit.id, undefined, undefined, 'NOWPayments IPN auto-credit (finished)');
        return {
          success: true,
          type: 'DEPOSIT_INTENT',
          depositId: deposit.id,
          gatewayStatus,
          internalStatus: 'CONFIRMED',
          credited: !creditRes.alreadyCredited,
          deposit: creditRes.deposit,
        };
      } else {
        console.info(`[NOWPayments IPN] Payment ${deposit.id} finished, but FINANCE_V2_LIVE_CREDITS_ENABLED=false. Telemetry recorded without automatic wallet credit.`);
      }
    }

    return {
      success: true,
      type: 'DEPOSIT_INTENT',
      depositId: deposit.id,
      gatewayStatus,
      internalStatus,
      credited: false,
      deposit,
    };
  }

  /**
   * 7. Live Sync: Queries NOWPayments API for a deposit and updates telemetry / credits if finished
   */
  async syncDepositLiveStatus(depositId: number, actorId?: string) {
    const deposit = await prisma.depositIntent.findUnique({
      where: { id: depositId },
      include: { user: true },
    });

    if (!deposit) {
      throw new Error(`DEPOSIT_NOT_FOUND: Deposit #${depositId} not found`);
    }

    const queryId = deposit.paymentId || deposit.invoiceId;
    if (!queryId) {
      throw new Error(`NO_GATEWAY_ID: Deposit #${depositId} has no paymentId or invoiceId to sync`);
    }

    const remote = await this.getPaymentStatus(queryId);
    const gatewayStatus = String(remote.payment_status || 'waiting').toLowerCase().trim();
    const internalStatus = mapGatewayStatusToInternal(gatewayStatus);

    let history: IpnHistoryEntry[] = [];
    try {
      if (deposit.ipnHistoryJson) {
        history = JSON.parse(deposit.ipnHistoryJson);
        if (!Array.isArray(history)) history = [];
      }
    } catch {
      history = [];
    }

    const syncEntry: IpnHistoryEntry = {
      timestamp: new Date().toISOString(),
      source: 'API_SYNC',
      status: gatewayStatus,
      actuallyPaid: remote.actually_paid,
      payAmount: remote.pay_amount,
      outcomeAmount: remote.outcome_amount,
      payCurrency: remote.pay_currency,
      paymentId: String(remote.payment_id || queryId),
      invoiceId: remote.invoice_id ? String(remote.invoice_id) : undefined,
      note: `Synced by admin ${actorId || 'system'}`,
      raw: remote as any,
    };
    history.unshift(syncEntry);
    if (history.length > 25) {
      history = history.slice(0, 25);
    }

    let updated = await prisma.depositIntent.update({
      where: { id: depositId },
      data: {
        paymentId: String(remote.payment_id || deposit.paymentId || queryId),
        purchaseId: remote.purchase_id ? String(remote.purchase_id) : deposit.purchaseId,
        payAddress: remote.pay_address || deposit.payAddress,
        priceAmount: remote.price_amount != null ? remote.price_amount : deposit.priceAmount,
        payAmount: remote.pay_amount != null ? remote.pay_amount : deposit.payAmount,
        actuallyPaid: remote.actually_paid != null ? remote.actually_paid : deposit.actuallyPaid,
        outcomeAmount: remote.outcome_amount != null ? remote.outcome_amount : deposit.outcomeAmount,
        outcomeCurrency: remote.outcome_currency || deposit.outcomeCurrency,
        gatewayStatus,
        status: deposit.status === 'CONFIRMED' ? 'CONFIRMED' : internalStatus,
        lastIpnAt: new Date(),
        ipnHistoryJson: JSON.stringify(history),
      },
      include: {
        user: {
          select: {
            discordId: true,
            username: true,
            displayName: true,
            advertiserRank: true,
          },
        },
      },
    });

    let credited = false;
    if (gatewayStatus === 'finished' && deposit.creditedAt === null && deposit.status !== 'CONFIRMED') {
      const creditRes = await this.creditDepositAtomic(deposit.id, undefined, actorId, 'Live sync auto-credit (status: finished)');
      credited = !creditRes.alreadyCredited;
      if (creditRes.deposit) {
        updated = { ...updated, ...creditRes.deposit };
      }
    }

    return {
      success: true,
      message: `Deposit #${depositId} synced successfully with NOWPayments API. Gateway status: ${gatewayStatus}.`,
      deposit: updated,
      gatewayStatus,
      internalStatus: updated.status,
      credited,
    };
  }
}

// Global default singleton
let defaultServiceInstance: NowPaymentsService | null = null;

export function getNowPaymentsService(): NowPaymentsService {
  if (!defaultServiceInstance) {
    defaultServiceInstance = new NowPaymentsService();
  }
  return defaultServiceInstance;
}

export function setCustomNowPaymentsService(service: NowPaymentsService | null): void {
  defaultServiceInstance = service;
}
