/**
 * walletRoutes.ts — Express routes for Website Phase 5 React Wallet & Deposit Requests
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireCsrf, requireRole, AuthenticatedRequest } from './middleware/auth';
import {
  getWalletOverview,
  getAuthoritativeIrtQuote,
  saveReceiptEvidence,
  getReceiptEvidence,
  submitIrtDeposit,
  getUserDepositHistory,
  getUserLedgerActivity,
  adminReviewFunding,
} from '../services/financeV2/walletPageService';
import prisma from '../database/db';
import { getNowPaymentsService } from '../services/nowPaymentsService';
import { getNowpaymentsConfig } from '../services/payment/paymentTypes';

export const walletRouter = Router();

// Allowed roles for wallet access: Advertisers, Exchangers, Boosters, Pilots, Staff, Management, Admin, Owner
export const WALLET_ALLOWED_ROLES = ['advertiser', 'exchanger', 'booster', 'pilot', 'staff', 'manager', 'admin', 'owner'];

export function requireWalletAccess(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return;
  }

  const userRoleKeys = (user.userRoles || []).map((r: { roleKey: string }) => r.roleKey);
  const isOwner = userRoleKeys.includes('owner') || (Boolean(process.env.OWNER_DISCORD_ID) && process.env.OWNER_DISCORD_ID === user.discordId);
  const hasAccess = isOwner || WALLET_ALLOWED_ROLES.some((role) => userRoleKeys.includes(role));

  if (!hasAccess) {
    res.status(403).json({
      error: 'ACCESS_DENIED',
      message: 'Access Denied: The Unified Wallet & Deposit Center is reserved for Advertisers, Exchangers, Staff, and Administrators.',
    });
    return;
  }

  next();
}

/**
 * Guard to lock manual/crypto deposits for pure booster accounts.
 * Advertisers, Admins, and Owners are eligible to deposit funds.
 */
export function requireDepositEligibility(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return;
  }

  const userRoleKeys = (user.userRoles || []).map((r: { roleKey: string }) => r.roleKey.toLowerCase());
  const isOwner = userRoleKeys.includes('owner') || (Boolean(process.env.OWNER_DISCORD_ID) && process.env.OWNER_DISCORD_ID === user.discordId);
  const canDeposit = isOwner || userRoleKeys.some((role) => ['advertiser', 'admin', 'owner'].includes(role));

  if (!canDeposit) {
    res.status(403).json({
      error: 'DEPOSIT_LOCKED_FOR_BOOSTER',
      message: 'Wallet deposits are locked for Booster accounts. Booster balances are credited automatically from completed orders and bonuses.',
    });
    return;
  }

  next();
}

// ─── 1. خلاصه وضعیت والت (Wallet Overview) ──────────────────────────────────
const handleWalletOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const data = await getWalletOverview(user);
    res.json({ success: true, ...data });
  } catch (err: any) {
    console.error('[Wallet API] Overview retrieval error:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve wallet overview' });
  }
};

walletRouter.get('/wallet/overview', requireAuth, requireWalletAccess, handleWalletOverview);
walletRouter.get('/api/wallet/overview', requireAuth, requireWalletAccess, handleWalletOverview);

// ─── 2. استعلام پیش‌فاکتور تومانی (Authoritative IRT Quote) ────────────────
const handleIrtQuote = async (req: Request, res: Response): Promise<void> => {
  try {
    const amountCents = req.query.amountCents ? Number(req.query.amountCents) : undefined;
    const amountToman = req.query.amountToman ? Number(req.query.amountToman) : undefined;

    if (!amountCents && !amountToman) {
      res.status(400).json({ error: 'INVALID_PARAMETERS: Either amountCents or amountToman query parameter is required' });
      return;
    }

    const result = await getAuthoritativeIrtQuote({
      targetUsdCents: amountCents,
      amountToman,
    });

    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to calculate IRT deposit quote' });
  }
};

walletRouter.get('/wallet/quote/irt', requireAuth, requireWalletAccess, handleIrtQuote);
walletRouter.get('/api/wallet/quote/irt', requireAuth, requireWalletAccess, handleIrtQuote);

// ─── 3. آپلود امن تصویر فیش بانکی (Secure Receipt Upload) ───────────────────
const handleReceiptUpload = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const { fileData, fileName } = req.body;

    if (!fileData) {
      res.status(400).json({ error: 'MISSING_FILE_PAYLOAD: fileData (base64 string) is required' });
      return;
    }

    const result = await saveReceiptEvidence(fileData, fileName || 'receipt', user.discordId);
    res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Receipt upload rejected' });
  }
};

walletRouter.post('/wallet/receipts/upload', requireAuth, requireCsrf, handleReceiptUpload);
walletRouter.post('/api/wallet/receipts/upload', requireAuth, requireCsrf, handleReceiptUpload);

// ─── 4. واکشی امن تصویر فیش بانکی (View Receipt Evidence) ───────────────────
const handleViewReceipt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const fileKey = req.params.fileKey;

    const { filePath, mimeType } = await getReceiptEvidence(fileKey, user);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath);
  } catch (err: any) {
    const msg = err.message || '';
    if (msg.includes('UNAUTHORIZED_RECEIPT_ACCESS') || msg.includes('PATH_TRAVERSAL_DETECTED') || msg.includes('INVALID_RECEIPT_METADATA')) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied: receipt evidence not authorized.' });
      return;
    }
    if (msg.includes('RECEIPT_NOT_FOUND')) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Receipt not found.' });
      return;
    }
    if (msg.includes('INVALID_FILE_KEY')) {
      res.status(400).json({ error: 'INVALID_REQUEST', message: 'Invalid receipt identifier format.' });
      return;
    }
    res.status(400).json({ error: 'BAD_REQUEST', message: err.message || 'Failed to fetch receipt.' });
  }
};

walletRouter.get('/wallet/receipts/:fileKey', requireAuth, handleViewReceipt);
walletRouter.get('/api/wallet/receipts/:fileKey', requireAuth, handleViewReceipt);

// ─── 5. ثبت درخواست واریز تومانی (Submit IRT Deposit Request) ──────────────
const handleSubmitIrtDeposit = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const {
      targetUsdCents,
      evidenceRef,
      payerIdentifier,
      senderCardLast4,
      receiptFileKey,
      paymentDate,
      adminNotes,
      expectedExchangeRate,
      expectedTotalIrt,
      quoteExpiresAt,
      quoteHash,
    } = req.body;

    const result = await submitIrtDeposit({
      userId: user.discordId,
      targetUsdCents: Number(targetUsdCents),
      evidenceRef,
      payerIdentifier,
      senderCardLast4,
      receiptFileKey,
      paymentDate,
      adminNotes,
      expectedExchangeRate: expectedExchangeRate !== undefined ? Number(expectedExchangeRate) : undefined,
      expectedTotalIrt: expectedTotalIrt !== undefined ? Number(expectedTotalIrt) : undefined,
      quoteExpiresAt,
      quoteHash,
    });

    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to submit IRT deposit request' });
  }
};

walletRouter.post('/wallet/deposits/irt', requireAuth, requireWalletAccess, requireDepositEligibility, requireCsrf, handleSubmitIrtDeposit);
walletRouter.post('/api/wallet/deposits/irt', requireAuth, requireWalletAccess, requireDepositEligibility, requireCsrf, handleSubmitIrtDeposit);

// ─── 6. درخواست واریز کریپتو (Crypto Deposit Intent via NOWPayments) ─────────
const handleCryptoDepositIntent = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const { amountUsd, payCurrency } = req.body;

    const parsedAmount = parseFloat(String(amountUsd));
    if (isNaN(parsedAmount) || parsedAmount < 1) {
      res.status(400).json({ error: 'Deposit amount must be at least $1.00 USD' });
      return;
    }

    const selectedCurrency = (payCurrency || 'USDTTRC20').trim().toUpperCase();
    const intentRef = `DEP_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const nowPaymentsService = getNowPaymentsService();
    const gatewayHealth = nowPaymentsService.getGatewayHealth();
    const config = getNowpaymentsConfig();

    if (!config.liveCollectionEnabled || !gatewayHealth.configured) {
      res.status(403).json({
        error: 'CRYPTO_COLLECTION_DISABLED',
        message: 'Cryptocurrency deposits via NOWPayments are currently disabled by financial policy (NOWPAYMENTS_LIVE_COLLECTION_ENABLED=false).',
      });
      return;
    }

    let depositIntent = await prisma.depositIntent.create({
      data: {
        intentRef,
        userId: user.discordId,
        provider: 'NOWPAYMENTS',
        isSandbox: gatewayHealth.isSandbox,
        amountUsd: parsedAmount,
        priceAmount: parsedAmount,
        payCurrency: selectedCurrency,
        status: 'WAITING',
        gatewayStatus: 'waiting',
        metadata: JSON.stringify({
          isSandbox: gatewayHealth.isSandbox,
          source: 'WALLET_PORTAL',
          createdAt: new Date().toISOString(),
        }),
      },
    });

    const publicUrl = (process.env.PUBLIC_URL || process.env.APP_URL || '').replace(/\/+$/, '') || 'https://g4xcommunity.com';

    let invoiceUrl: string | null = null;
    let paymentId: string | null = null;

    try {
      const invoiceResult = await nowPaymentsService.createInvoice({
        amountUsd: parsedAmount,
        payCurrency: selectedCurrency.toLowerCase(),
        orderId: String(depositIntent.id),
        description: `G4X Deposit #${depositIntent.id} ($${parsedAmount.toFixed(2)}) - ${user.username}`,
        ipnCallbackUrl: `${publicUrl}/api/webhooks/nowpayments`,
        successUrl: `${publicUrl}/wallet?deposit=success`,
        cancelUrl: `${publicUrl}/wallet?deposit=cancelled`,
      });

      if (invoiceResult && invoiceResult.invoice_url && (invoiceResult.invoice_url.startsWith('http://') || invoiceResult.invoice_url.startsWith('https://'))) {
        paymentId = String(invoiceResult.id || '');
        invoiceUrl = invoiceResult.invoice_url;

        depositIntent = await prisma.depositIntent.update({
          where: { id: depositIntent.id },
          data: {
            isSandbox: gatewayHealth.isSandbox,
            invoiceId: String(invoiceResult.id || ''),
            paymentId,
            invoiceUrl,
            priceAmount: parsedAmount,
            gatewayStatus: 'waiting',
            metadata: JSON.stringify({
              nowpaymentsConfigured: true,
              invoiceId: invoiceResult.id,
              isSandbox: gatewayHealth.isSandbox,
              source: 'WALLET_PORTAL',
              createdAt: new Date().toISOString(),
            }),
          },
        });

        res.status(201).json({
          success: true,
          configured: true,
          invoiceUrl,
          deposit: depositIntent,
        });
        return;
      }
    } catch (npErr: any) {
      console.warn('[NOWPayments] Live invoice creation call failed:', npErr?.message || npErr);
    }

    res.status(502).json({
      error: 'FAILED_TO_GENERATE_INVOICE',
      message: 'Could not generate a live NOWPayments hosted invoice. Please verify provider connectivity.',
      deposit: depositIntent,
    });
  } catch (err: any) {
    console.error('[Wallet API] Crypto deposit intent error:', err);
    res.status(500).json({ error: err.message || 'Failed to process crypto deposit intent' });
  }
};

const handleCancelDepositIntent = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const depositId = parseInt(req.params.id, 10);

    if (isNaN(depositId)) {
      res.status(400).json({ error: 'Valid numeric deposit ID required' });
      return;
    }

    const deposit = await prisma.depositIntent.findUnique({
      where: { id: depositId },
    });

    if (!deposit || deposit.userId !== user.discordId) {
      res.status(404).json({ error: 'Deposit invoice not found' });
      return;
    }

    if (deposit.status === 'CONFIRMED') {
      res.status(400).json({ error: 'Cannot cancel a confirmed and credited deposit invoice' });
      return;
    }

    const updated = await prisma.depositIntent.update({
      where: { id: depositId },
      data: {
        status: 'CANCELLED',
        gatewayStatus: 'cancelled',
      },
    });

    res.json({
      success: true,
      message: 'Deposit invoice cancelled successfully',
      deposit: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to cancel deposit invoice' });
  }
};

walletRouter.post('/wallet/deposits/intent', requireAuth, requireWalletAccess, requireDepositEligibility, requireCsrf, handleCryptoDepositIntent);
walletRouter.post('/api/wallet/deposits/intent', requireAuth, requireWalletAccess, requireDepositEligibility, requireCsrf, handleCryptoDepositIntent);

walletRouter.post('/wallet/deposits/intent/:id/cancel', requireAuth, requireWalletAccess, requireCsrf, handleCancelDepositIntent);
walletRouter.post('/api/wallet/deposits/intent/:id/cancel', requireAuth, requireWalletAccess, requireCsrf, handleCancelDepositIntent);

const handleCryptoDeposit = async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = getNowpaymentsConfig();
    if (!config.isCollectionActive) {
      res.status(403).json({
        error: 'CRYPTO_COLLECTION_DISABLED',
        message: 'Cryptocurrency deposits via NOWPayments are currently disabled by financial policy (NOWPAYMENTS_LIVE_COLLECTION_ENABLED=false).',
      });
      return;
    }

    res.status(400).json({ error: 'CRYPTO_INITIATION_DISABLED: Please use the hosted invoice intent endpoint (/api/wallet/deposits/intent).' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to process crypto deposit request' });
  }
};

walletRouter.post('/wallet/deposits/crypto', requireAuth, requireWalletAccess, requireDepositEligibility, requireCsrf, handleCryptoDeposit);
walletRouter.post('/api/wallet/deposits/crypto', requireAuth, requireWalletAccess, requireDepositEligibility, requireCsrf, handleCryptoDeposit);

// ─── 7. تاریخچه واریزهای کاربر (User Deposit History) ───────────────────────
const handleDepositHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);

    const data = await getUserDepositHistory(user.discordId, page, limit);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve deposit history' });
  }
};

walletRouter.get('/wallet/deposits', requireAuth, requireWalletAccess, handleDepositHistory);
walletRouter.get('/api/wallet/deposits', requireAuth, requireWalletAccess, handleDepositHistory);

// ─── 8. تاریخچه تراکنش‌های دفتر کل والت کاربر (Ledger Activity) ─────────────
const handleLedgerActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);

    const data = await getUserLedgerActivity(user.discordId, page, limit);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve ledger activity' });
  }
};

walletRouter.get('/wallet/ledger', requireAuth, requireWalletAccess, handleLedgerActivity);
walletRouter.get('/api/wallet/ledger', requireAuth, requireWalletAccess, handleLedgerActivity);

// ─── 9. ممیزی و تایید/رد درخواست شارژ توسط ادمین ────────────────────────────
const handleAdminDepositReview = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const fundingId = Number(req.params.id);
    const { action, notes } = req.body;

    if (!action || !['APPROVE', 'REJECT'].includes(action)) {
      res.status(400).json({ error: 'INVALID_ACTION: action must be either APPROVE or REJECT' });
      return;
    }

    const result = await adminReviewFunding(fundingId, user.discordId, action, notes);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to review deposit request' });
  }
};

walletRouter.post(
  '/wallet/admin/deposits/:id/review',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  handleAdminDepositReview
);
walletRouter.post(
  '/api/wallet/admin/deposits/:id/review',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  handleAdminDepositReview
);

// ─── 10. ثبت درخواست برداشت و تسویه وجه والت (Unified Wallet Withdrawal) ─────
const handleWalletWithdrawal = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const { amountUsd, payoutMethod, payoutAddress, notes } = req.body;

    const withdrawAmount = parseFloat(String(amountUsd));
    if (isNaN(withdrawAmount) || withdrawAmount < 1) {
      res.status(400).json({ error: 'Minimum withdrawal amount is $1.00 USD' });
      return;
    }

    const destinationAddress = (payoutAddress || '').trim();
    if (!destinationAddress) {
      res.status(400).json({ error: 'A payout destination address or bank IBAN is required for withdrawal' });
      return;
    }

    const amountCents = Math.round(withdrawAmount * 100);
    const normMethod = (payoutMethod || 'USDT_BEP20').trim();

    // Execute inside atomic prisma transaction
    const result = await prisma.$transaction(async (tx) => {
      const walletV2 = await tx.walletV2.findUnique({ where: { userId: user.discordId } });
      if (!walletV2) {
        throw new Error('WALLET_NOT_FOUND: User wallet account does not exist');
      }

      if (walletV2.isFrozen) {
        throw new Error('WALLET_FROZEN: Your wallet is currently frozen or under administrative hold. Withdrawals are disabled.');
      }

      const legacyWallet = await tx.wallet.findUnique({ where: { userId: user.discordId } });
      if (legacyWallet && legacyWallet.isFrozen) {
        throw new Error('WALLET_FROZEN: Your wallet is currently frozen or under administrative hold. Withdrawals are disabled.');
      }

      if (walletV2.availableCents < amountCents) {
        throw new Error(
          `INSUFFICIENT_FUNDS: Requested amount ($${withdrawAmount.toFixed(2)}) exceeds available liquid balance ($${(walletV2.availableCents / 100).toFixed(2)})`
        );
      }

      // Atomically reserve funds
      await tx.walletV2.update({
        where: { userId: user.discordId },
        data: {
          availableCents: { decrement: amountCents },
          reservedCents: { increment: amountCents },
        },
      });

      if (legacyWallet) {
        await tx.wallet.update({
          where: { userId: user.discordId },
          data: {
            balanceUsd: { decrement: amountCents },
            escrowUsd: { increment: amountCents },
          },
        });
      }

      const withdrawalRef = `WTH_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      const feeCents = normMethod.includes('IRT') ? 100 : 30; // 30 cents fixed fee for USDT, 100 for IRT
      const netCents = Math.max(0, amountCents - feeCents);

      const withdrawal = await tx.boosterWithdrawalRequest.create({
        data: {
          withdrawalRef,
          boosterId: user.discordId,
          requestedUsdCents: amountCents,
          fixedFeeUsdCents: feeCents,
          netUsdCents: netCents,
          quotedNetPayoutAmount: (netCents / 100).toFixed(2),
          quotedCurrency: normMethod.includes('IRT') ? 'IRT' : 'USDT',
          payoutMethod: normMethod,
          destinationAddress,
          status: 'REQUESTED',
        },
      });

      // Record double-entry ledger entry
      await tx.ledgerEntryV2.create({
        data: {
          entryRef: `LED_${withdrawalRef}`,
          accountType: 'USER_WALLET',
          userId: user.discordId,
          amountCents,
          entryType: 'WITHDRAWAL_RESERVE',
          direction: 'DEBIT',
          balanceAfterAvailableCents: walletV2.availableCents - amountCents,
          balanceAfterReservedCents: walletV2.reservedCents + amountCents,
          withdrawalRequestId: withdrawal.id,
          description: `Wallet withdrawal request #${withdrawalRef} ($${withdrawAmount.toFixed(2)}) [${normMethod}]`,
          createdBy: user.discordId,
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          actorId: user.discordId,
          action: 'WALLET_WITHDRAWAL_REQUESTED',
          entityType: 'BoosterWithdrawalRequest',
          entityId: String(withdrawal.id),
          newValues: JSON.stringify({
            withdrawalRef,
            amountUsd: withdrawAmount,
            payoutMethod: normMethod,
            destinationAddress,
            notes: notes || undefined,
          }),
        },
      });

      return withdrawal;
    });

    res.status(201).json({
      success: true,
      withdrawal: {
        id: result.id,
        ref: result.withdrawalRef,
        amountUsd: withdrawAmount,
        payoutMethod: result.payoutMethod,
        destinationAddress: result.destinationAddress,
        status: result.status,
        createdAt: result.createdAt,
      },
      message: `Withdrawal of $${withdrawAmount.toFixed(2)} requested successfully (Ref: ${result.withdrawalRef}).`,
    });
  } catch (err: any) {
    console.error('[Wallet API] Withdrawal error:', err);
    res.status(400).json({ error: err.message || 'Failed to submit withdrawal request' });
  }
};

walletRouter.post('/wallet/withdrawals', requireAuth, requireWalletAccess, requireCsrf, handleWalletWithdrawal);
walletRouter.post('/api/wallet/withdrawals', requireAuth, requireWalletAccess, requireCsrf, handleWalletWithdrawal);

// ─── 11. تاریخچه درخواست‌های برداشت کاربر (User Withdrawal Requests History) ─
const handleUserWithdrawals = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '10'), 10)));
    const offset = (page - 1) * limit;

    const [withdrawals, total] = await Promise.all([
      prisma.boosterWithdrawalRequest.findMany({
        where: { boosterId: user.discordId },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.boosterWithdrawalRequest.count({
        where: { boosterId: user.discordId },
      }),
    ]);

    res.json({
      success: true,
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        withdrawalRef: w.withdrawalRef,
        payoutMethod: w.payoutMethod,
        status: w.status,
        requestedUsd: (w.requestedUsdCents / 100).toFixed(2),
        netUsd: (w.netUsdCents / 100).toFixed(2),
        destinationAddress: w.destinationAddress,
        externalTxHash: w.externalTxHash,
        bankReceiptRef: w.bankReceiptRef,
        rejectionReason: w.rejectionReason,
        createdAt: w.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch withdrawal history' });
  }
};

walletRouter.get('/wallet/withdrawals', requireAuth, requireWalletAccess, handleUserWithdrawals);
walletRouter.get('/api/wallet/withdrawals', requireAuth, requireWalletAccess, handleUserWithdrawals);

