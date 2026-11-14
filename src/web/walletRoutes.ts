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

walletRouter.post('/wallet/deposits/irt', requireAuth, requireWalletAccess, requireCsrf, handleSubmitIrtDeposit);
walletRouter.post('/api/wallet/deposits/irt', requireAuth, requireWalletAccess, requireCsrf, handleSubmitIrtDeposit);

// ─── 6. درخواست واریز کریپتو (Crypto Deposit Request Gate) ──────────────────
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

    res.status(400).json({ error: 'CRYPTO_INITIATION_DISABLED: Direct cryptocurrency collection is not open.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to process crypto deposit request' });
  }
};

walletRouter.post('/wallet/deposits/crypto', requireAuth, requireWalletAccess, requireCsrf, handleCryptoDeposit);
walletRouter.post('/api/wallet/deposits/crypto', requireAuth, requireWalletAccess, requireCsrf, handleCryptoDeposit);

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
