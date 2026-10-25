/**
 * paymentRoutes.ts — روت‌های Express برای سیستم پرداخت و اعتبارسنجی G4X
 *
 * شامل:
 *  ۱. وب‌هوک عمومی دریافت اعلان‌های IPN از NOWPayments (بدون نشست و CSRF)
 *  ۲. پنل پرداخت مشتری (Customer Checkout & Evidence Submission)
 *  ۳. پنل بررسی و ممیزی پرداخت‌ها توسط ادمین (Admin Verification Hub)
 */

import { Router, Request, Response } from 'express';
import prisma from '../database/db';
import { requireAuth, requireCsrf, requireRole, AuthenticatedRequest } from './middleware/auth';
import {
  calculateIncomingIrtQuote,
  getOfficialReceivingBankDetails,
  createIrtPaymentAttempt,
  submitIrtPaymentEvidence,
  adminReviewIrtPayment,
} from '../services/payment/irtPaymentService';
import {
  getOrCreatePaymentRequestForOrder,
  getOrCreatePaymentRequestForFunding,
  createNowpaymentsPaymentAttempt,
} from '../services/payment/paymentReconciliationService';
import { handleNowPaymentsIpn } from '../services/payment/nowpaymentsWebhook';
import { getNowpaymentsConfig } from '../services/payment/paymentTypes';

export const paymentRouter = Router();

// ─── ۱. وب‌هوک عمومی دریافت IPN از NOWPayments ─────────────────────────────
// نکته حیاتی: این اندپوینت عمومی بوده و نباید نشست کاربر دیسکورد یا توکن CSRF مرورگر را الزامی کند
paymentRouter.post('/webhooks/nowpayments', async (req: Request, res: Response): Promise<void> => {
  try {
    const signatureHeader = req.headers['x-nowpayments-sig'] as string;
    const payload = req.body;

    if (!payload || !payload.payment_id) {
      res.status(400).json({ error: 'INVALID_PAYLOAD: Missing payment_id' });
      return;
    }

    const result = await handleNowPaymentsIpn(payload, signatureHeader);
    res.status(200).json(result);
  } catch (err: any) {
    console.error('[NOWPayments Webhook Error]:', err.message);
    if (err.message && err.message.includes('INVALID_IPN_SIGNATURE')) {
      res.status(401).json({ error: 'INVALID_IPN_SIGNATURE' });
      return;
    }
    res.status(400).json({ error: err.message || 'Webhook processing failed' });
  }
});

// ─── ۲. روت‌های پرداخت مشتری ──────────────────────────────────────────────

/**
 * دریافت یا ایجاد درخواست پرداخت برای یک سفارش
 */
paymentRouter.get(
  '/payments/orders/:orderId/request',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const orderId = Number(req.params.orderId);

      const request = await getOrCreatePaymentRequestForOrder(orderId, user.discordId);
      const config = getNowpaymentsConfig();

      res.json({
        success: true,
        request,
        cryptoActive: config.isCollectionActive,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to fetch payment request' });
    }
  }
);

/**
 * دریافت یا ایجاد درخواست پرداخت برای شارژ والت ادورتایزر
 */
paymentRouter.get(
  '/payments/funding/:fundingId/request',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const fundingId = Number(req.params.fundingId);

      const request = await getOrCreatePaymentRequestForFunding(fundingId, user.discordId);
      const config = getNowpaymentsConfig();

      res.json({
        success: true,
        request,
        cryptoActive: config.isCollectionActive,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to fetch funding payment request' });
    }
  }
);

/**
 * دریافت مشخصات یک درخواست پرداخت بر اساس شناسه مرجع (requestRef)
 */
paymentRouter.get(
  '/payments/requests/:ref',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const requestRef = req.params.ref;
      const request = await prisma.paymentRequest.findUnique({
        where: { requestRef },
        include: {
          order: true,
          fundingRequest: true,
          attempts: {
            orderBy: { createdAt: 'desc' },
          },
          receipts: true,
        },
      });

      if (!request) {
        res.status(404).json({ error: 'Payment request not found' });
        return;
      }

      const config = getNowpaymentsConfig();

      res.json({
        success: true,
        request,
        cryptoActive: config.isCollectionActive,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to load payment request' });
    }
  }
);

/**
 * استعلام زنده پیش‌فاکتور تومانی
 */
paymentRouter.get(
  '/payments/irt/quote',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const amountCents = Number(req.query.amountCents);
      if (!amountCents || isNaN(amountCents) || amountCents <= 0) {
        res.status(400).json({ error: 'INVALID_AMOUNT: amountCents must be a positive integer' });
        return;
      }

      const quote = await calculateIncomingIrtQuote(amountCents);
      res.json({ success: true, quote });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to calculate quote' });
    }
  }
);

/**
 * دریافت اطلاعات حساب بانکی رسمی G4X
 */
paymentRouter.get(
  '/payments/irt/bank-details',
  requireAuth,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const bankDetails = await getOfficialReceivingBankDetails();
      res.json({ success: true, bankDetails });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to fetch bank details' });
    }
  }
);

/**
 * ایجاد تلاش پرداخت کارت‌به‌کارت تومانی
 */
paymentRouter.post(
  '/payments/requests/:id/attempts/irt',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const paymentRequestId = Number(req.params.id);

      const result = await createIrtPaymentAttempt(paymentRequestId, user.discordId);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create IRT payment attempt' });
    }
  }
);

/**
 * ثبت مدارک واریز کارت‌به‌کارت توسط کاربر
 */
paymentRouter.post(
  '/payments/attempts/:ref/irt-evidence',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const attemptRef = req.params.ref;
      const { trackingNumber, paidAmountIrt, senderCardLast4, receiptScreenshotUrl } = req.body;

      const result = await submitIrtPaymentEvidence({
        attemptRef,
        trackingNumber,
        paidAmountIrt: Number(paidAmountIrt),
        senderCardLast4,
        receiptScreenshotUrl,
        actorId: user.discordId,
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to submit IRT payment evidence' });
    }
  }
);

/**
 * ایجاد تلاش پرداخت کریپتو با NOWPayments
 */
paymentRouter.post(
  '/payments/requests/:id/attempts/nowpayments',
  requireAuth,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const paymentRequestId = Number(req.params.id);
      const { payCurrency } = req.body;

      if (!payCurrency) {
        res.status(400).json({ error: 'MISSING_PAY_CURRENCY: Please specify crypto currency (e.g. usdtbsc, btc)' });
        return;
      }

      const result = await createNowpaymentsPaymentAttempt({
        paymentRequestId,
        payCurrency,
        actorId: user.discordId,
      });

      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create NOWPayments attempt' });
    }
  }
);

/**
 * استعلام وضعیت تلاش پرداخت
 */
paymentRouter.get(
  '/payments/attempts/:ref/status',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const attemptRef = req.params.ref;
      const attempt = await prisma.paymentAttempt.findUnique({
        where: { attemptRef },
        include: {
          paymentRequest: true,
          receipts: true,
        },
      });

      if (!attempt) {
        res.status(404).json({ error: 'Payment attempt not found' });
        return;
      }

      res.json({ success: true, attempt });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to load attempt status' });
    }
  }
);

// ─── ۳. روت‌های بررسی و ممیزی پرداخت‌ها توسط ادمین ────────────────────────

/**
 * دریافت لیست پرداخت‌های در انتظار بررسی ادمین (کارت‌به‌کارت و استثنائات کریپتو)
 */
paymentRouter.get(
  '/admin/payments/pending',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const attempts = await prisma.paymentAttempt.findMany({
        where: {
          status: {
            in: [
              'pending',
              'manual_review',
              'partially_paid',
              'confirming',
              'confirmed',
              'sending',
            ],
          },
        },
        include: {
          paymentRequest: {
            include: { order: true, fundingRequest: true, user: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, attempts });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to fetch pending payments' });
    }
  }
);

/**
 * بررسی و تایید یا رد پرداخت کارت‌به‌کارت توسط ادمین
 */
paymentRouter.post(
  '/admin/payments/attempts/:id/review',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { user } = req as AuthenticatedRequest;
      const attemptId = Number(req.params.id);
      const { action, reason, actualAmountReceivedIrt } = req.body;

      const result = await adminReviewIrtPayment({
        attemptId,
        action,
        reason,
        actualAmountReceivedIrt: actualAmountReceivedIrt ? Number(actualAmountReceivedIrt) : undefined,
        actorId: user.discordId,
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Admin payment review failed' });
    }
  }
);

/**
 * دریافت تاریخچه رسیدهای تاییدشده و ممیزی
 */
paymentRouter.get(
  '/admin/payments/receipts',
  requireAuth,
  requireRole('owner', 'manager', 'admin'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const receipts = await prisma.paymentReceipt.findMany({
        include: {
          paymentRequest: {
            include: { order: true, fundingRequest: true, user: true },
          },
          paymentAttempt: true,
        },
        orderBy: { verifiedAt: 'desc' },
        take: 50,
      });

      res.json({ success: true, receipts });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to fetch receipts' });
    }
  }
);
