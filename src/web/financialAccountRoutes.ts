/**
 * src/web/financialAccountRoutes.ts — Financial Accounts & Balance Management API (Phase 1)
 *
 * Responsibilities:
 *  - Financial account listing & creation (Platform & Internal)
 *  - Account metadata updates (direct editing of calculated balances is blocked)
 *  - Account status management (ACTIVE / INACTIVE / SUSPENDED)
 *  - Unified Platform Balance Overview for 5 platform sources + consolidated summary cards
 *  - Local Currency (Toman) accounts overview & bank metrics
 *  - Manual Balance Adjustments with required reason, ledger entry & idempotency protection
 *  - Account-specific transaction history
 *  - Strict administrative access control
 */

import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from './middleware/auth';
import { requireAdminPortalAccess } from './adminPortalRoutes';
import {
  listFinancialAccounts,
  createFinancialAccount,
  getFinancialAccountDetails,
  updateFinancialAccountMetadata,
  setFinancialAccountStatus,
  recordManualBalanceAdjustment,
  getAccountTransactions,
  getPlatformBalanceOverview,
  getTomanAccountsOverview,
  FinancialAccountCategory,
  FinancialAccountType,
  FinancialCurrency,
  FinancialAccountStatus,
  TransactionDirection,
} from '../services/financialAccountService';
import {
  executeInternalTransfer,
  listInternalTransfers,
  requestPlatformWithdrawal,
  markWithdrawalProcessing,
  completePlatformWithdrawal,
  rejectPlatformWithdrawal,
  cancelPlatformWithdrawal,
  listPlatformWithdrawals,
  createExchangeRate,
  getActiveExchangeRate,
  getActiveExchangeRateRecord,
  listExchangeRates,
} from '../services/financialTransferAndWithdrawalService';

export const financialAccountRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// 1. PLATFORM BALANCE OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

financialAccountRouter.get(
  ['/admin/financial-accounts/platform-overview', '/api/admin/financial-accounts/platform-overview'],
  requireAuth,
  requireAdminPortalAccess,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const overview = await getPlatformBalanceOverview();
      res.json({
        success: true,
        ...overview,
      });
    } catch (err: any) {
      console.error('[FinancialAccounts] Failed to fetch platform overview:', err);
      res.status(500).json({
        success: false,
        error: 'FAILED_PLATFORM_OVERVIEW',
        message: err.message || 'Failed to aggregate platform balances',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. LOCAL CURRENCY (TOMAN) OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

financialAccountRouter.get(
  ['/admin/financial-accounts/toman-overview', '/api/admin/financial-accounts/toman-overview'],
  requireAuth,
  requireAdminPortalAccess,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const overview = await getTomanAccountsOverview();
      res.json({
        success: true,
        ...overview,
      });
    } catch (err: any) {
      console.error('[FinancialAccounts] Failed to fetch Toman overview:', err);
      res.status(500).json({
        success: false,
        error: 'FAILED_TOMAN_OVERVIEW',
        message: err.message || 'Failed to aggregate Toman accounts',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. MANUAL BALANCE ADJUSTMENT
// ─────────────────────────────────────────────────────────────────────────────

financialAccountRouter.post(
  ['/admin/financial-accounts/adjustments', '/api/admin/financial-accounts/adjustments'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { accountId, adjustmentType, amount, reason, description, attachmentUrl, idempotencyKey } = req.body;

      if (!accountId) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Target accountId is required' });
        return;
      }

      if (!adjustmentType || !['CREDIT', 'DEBIT'].includes(String(adjustmentType).toUpperCase())) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'adjustmentType must be CREDIT or DEBIT' });
        return;
      }

      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'amount must be a positive integer greater than zero' });
        return;
      }

      if (!reason || !String(reason).trim()) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'A reason is strictly required for all manual balance adjustments' });
        return;
      }

      const result = await recordManualBalanceAdjustment({
        accountId: String(accountId),
        adjustmentType: adjustmentType.toUpperCase() as TransactionDirection,
        amount: Math.floor(numAmount),
        reason: String(reason).trim(),
        description: description ? String(description).trim() : undefined,
        attachmentUrl: attachmentUrl ? String(attachmentUrl).trim() : undefined,
        adminId: user.discordId,
        idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : undefined,
      });

      res.status(201).json({
        success: true,
        message: `Successfully recorded ${adjustmentType.toUpperCase()} adjustment of ${result.formattedAmount}`,
        transaction: result,
      });
    } catch (err: any) {
      console.error('[FinancialAccounts] Adjustment failed:', err);
      const isNotFound = err.message?.includes('NOT_FOUND');
      const isInsufficient = err.message?.includes('INSUFFICIENT_FUNDS');
      const isInactive = err.message?.includes('ACCOUNT_INACTIVE');
      const isValidation = err.message?.includes('VALIDATION_ERROR');

      const statusCode = isNotFound ? 404 : isInsufficient ? 422 : isValidation || isInactive ? 400 : 500;
      const errorCode = isInsufficient
        ? 'INSUFFICIENT_FUNDS'
        : isNotFound
        ? 'ACCOUNT_NOT_FOUND'
        : isInactive
        ? 'ACCOUNT_INACTIVE'
        : isValidation
        ? 'VALIDATION_ERROR'
        : 'ADJUSTMENT_FAILED';

      res.status(statusCode).json({
        success: false,
        error: errorCode,
        message: err.message || 'Failed to execute balance adjustment',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. LIST FINANCIAL ACCOUNTS
// ─────────────────────────────────────────────────────────────────────────────

financialAccountRouter.get(
  ['/admin/financial-accounts', '/api/admin/financial-accounts'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { category, accountType, currency, status, search } = req.query;

      const accounts = await listFinancialAccounts({
        category: category ? (String(category).toUpperCase() as FinancialAccountCategory) : undefined,
        accountType: accountType ? (String(accountType).toUpperCase() as FinancialAccountType) : undefined,
        currency: currency ? (String(currency).toUpperCase() as FinancialCurrency) : undefined,
        status: status ? (String(status).toUpperCase() as FinancialAccountStatus) : undefined,
        search: search ? String(search) : undefined,
      });

      res.json({
        success: true,
        count: accounts.length,
        accounts,
      });
    } catch (err: any) {
      console.error('[FinancialAccounts] Failed to list accounts:', err);
      res.status(500).json({
        success: false,
        error: 'LIST_ACCOUNTS_FAILED',
        message: err.message || 'Failed to list financial accounts',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. CREATE FINANCIAL ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────

financialAccountRouter.post(
  ['/admin/financial-accounts', '/api/admin/financial-accounts'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const {
        accountRef,
        name,
        category,
        accountType,
        currency,
        openingBalance,
        bankName,
        accountNumber,
        iban,
        cardNumber,
        notes,
        metadata,
      } = req.body;

      if (!name || !String(name).trim()) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Account name is required' });
        return;
      }

      if (!category || !['PLATFORM', 'INTERNAL'].includes(String(category).toUpperCase())) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Category must be PLATFORM or INTERNAL' });
        return;
      }

      if (!currency || !['USD', 'IRR'].includes(String(currency).toUpperCase())) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Currency must be USD or IRR' });
        return;
      }

      const account = await createFinancialAccount({
        accountRef: accountRef ? String(accountRef).trim() : undefined,
        name: String(name).trim(),
        category: String(category).toUpperCase() as FinancialAccountCategory,
        accountType: String(accountType).toUpperCase() as FinancialAccountType,
        currency: String(currency).toUpperCase() as FinancialCurrency,
        openingBalance: openingBalance ? Math.max(0, Math.floor(Number(openingBalance))) : 0,
        bankName,
        accountNumber,
        iban,
        cardNumber,
        notes,
        metadata,
        adminId: user.discordId,
      });

      res.status(201).json({
        success: true,
        message: `Account '${account.name}' created successfully`,
        account,
      });
    } catch (err: any) {
      console.error('[FinancialAccounts] Failed to create account:', err);
      const isConflict = err.message?.includes('CONFLICT_ERROR');
      const isValidation = err.message?.includes('VALIDATION_ERROR');

      res.status(isConflict ? 409 : isValidation ? 400 : 500).json({
        success: false,
        error: isConflict ? 'ACCOUNT_EXISTS' : isValidation ? 'VALIDATION_ERROR' : 'CREATE_FAILED',
        message: err.message || 'Failed to create financial account',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. EXCHANGE RATE MANAGEMENT (PHASE 2)
// ─────────────────────────────────────────────────────────────────────────────

financialAccountRouter.get(
  ['/admin/financial-accounts/exchange-rates', '/api/admin/financial-accounts/exchange-rates'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to, isActive } = req.query;
      const rates = await listExchangeRates({
        fromCurrency: from ? String(from) : undefined,
        toCurrency: to ? String(to) : undefined,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
      });
      res.json({
        success: true,
        count: rates.length,
        rates,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'FETCH_RATES_FAILED',
        message: err.message || 'Failed to fetch exchange rates',
      });
    }
  }
);

financialAccountRouter.get(
  ['/admin/financial-accounts/exchange-rates/active', '/api/admin/financial-accounts/exchange-rates/active'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const from = String(req.query.from || 'USD').toUpperCase();
      const to = String(req.query.to || 'IRR').toUpperCase();
      const rateNum = await getActiveExchangeRate(from, to);
      const record = await getActiveExchangeRateRecord(from, to);

      res.json({
        success: true,
        fromCurrency: from,
        toCurrency: to,
        rate: record || {
          id: 'default',
          rateRef: `FX-${from}-${to}`,
          fromCurrency: from,
          toCurrency: to,
          rate: rateNum,
          inverseRate: 1 / rateNum,
          spreadPercentage: 0,
          effectiveAt: new Date().toISOString(),
          expiresAt: null,
          isActive: true,
          source: 'SYSTEM',
          notes: null,
          adminId: null,
          createdAt: new Date().toISOString(),
        },
        numericRate: rateNum,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'FETCH_ACTIVE_RATE_FAILED',
        message: err.message || 'Failed to get active exchange rate',
      });
    }
  }
);

financialAccountRouter.post(
  ['/admin/financial-accounts/exchange-rates', '/api/admin/financial-accounts/exchange-rates'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { fromCurrency, toCurrency, rate, effectiveAt, notes } = req.body;

      if (!fromCurrency || !toCurrency) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'fromCurrency and toCurrency are required' });
        return;
      }
      const numRate = Number(rate);
      if (isNaN(numRate) || numRate <= 0) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'rate must be a positive number' });
        return;
      }

      const created = await createExchangeRate({
        fromCurrency: String(fromCurrency),
        toCurrency: String(toCurrency),
        rate: numRate,
        effectiveAt: effectiveAt ? new Date(effectiveAt) : undefined,
        notes: notes ? String(notes).trim() : undefined,
        adminId: user.discordId,
      });

      res.status(201).json({
        success: true,
        message: `Exchange rate for ${created.fromCurrency}/${created.toCurrency} set to ${created.rate}`,
        rate: created,
      });
    } catch (err: any) {
      res.status(400).json({
        success: false,
        error: 'CREATE_RATE_FAILED',
        message: err.message || 'Failed to record exchange rate',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 11. INTERNAL TRANSFERS & CONVERSION (PHASE 2)
// ─────────────────────────────────────────────────────────────────────────────

financialAccountRouter.post(
  ['/admin/financial-accounts/transfers', '/api/admin/financial-accounts/transfers'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const {
        sourceAccountId,
        destinationAccountId,
        sourceAmount,
        feeAmount,
        exchangeRate,
        description,
        attachmentUrl,
        idempotencyKey,
      } = req.body;

      if (!sourceAccountId || !destinationAccountId) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Both sourceAccountId and destinationAccountId are required' });
        return;
      }
      const numAmount = Number(sourceAmount);
      if (isNaN(numAmount) || numAmount <= 0) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'sourceAmount must be a positive integer greater than zero' });
        return;
      }

      const transfer = await executeInternalTransfer({
        sourceAccountId: String(sourceAccountId),
        destinationAccountId: String(destinationAccountId),
        sourceAmount: Math.floor(numAmount),
        feeAmount: feeAmount !== undefined ? Math.floor(Number(feeAmount)) : 0,
        exchangeRate: exchangeRate !== undefined ? Number(exchangeRate) : undefined,
        description: description ? String(description).trim() : undefined,
        attachmentUrl: attachmentUrl ? String(attachmentUrl).trim() : undefined,
        adminId: user.discordId,
        idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : undefined,
      });

      res.status(201).json({
        success: true,
        message: `Successfully transferred ${transfer.formattedSourceAmount} -> ${transfer.formattedDestinationAmount}`,
        transfer,
      });
    } catch (err: any) {
      console.error('[FinancialTransfers] Transfer failed:', err);
      const isNotFound = err.message?.includes('NOT_FOUND');
      const isInsufficient = err.message?.includes('INSUFFICIENT_FUNDS');
      const isValidation = err.message?.includes('VALIDATION_ERROR') || err.message?.includes('ACCOUNT_INACTIVE');

      const statusCode = isNotFound ? 404 : isInsufficient ? 422 : isValidation ? 400 : 500;

      res.status(statusCode).json({
        success: false,
        error: isInsufficient ? 'INSUFFICIENT_FUNDS' : isNotFound ? 'ACCOUNT_NOT_FOUND' : 'TRANSFER_FAILED',
        message: err.message || 'Failed to execute internal transfer',
      });
    }
  }
);

financialAccountRouter.get(
  ['/admin/financial-accounts/transfers', '/api/admin/financial-accounts/transfers'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { sourceAccountId, destinationAccountId, transferType, currency, status, page, limit } = req.query;

      const result = await listInternalTransfers({
        sourceAccountId: sourceAccountId ? String(sourceAccountId) : undefined,
        destinationAccountId: destinationAccountId ? String(destinationAccountId) : undefined,
        transferType: transferType ? String(transferType) : undefined,
        currency: currency ? String(currency) : undefined,
        status: status ? String(status) : undefined,
        page: page ? parseInt(String(page), 10) : 1,
        limit: limit ? parseInt(String(limit), 10) : 20,
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'LIST_TRANSFERS_FAILED',
        message: err.message || 'Failed to list internal transfers',
      });
    }
  }
);

financialAccountRouter.get(
  ['/admin/financial-accounts/transfers/export-csv', '/api/admin/financial-accounts/transfers/export-csv'],
  requireAuth,
  requireAdminPortalAccess,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const { transfers } = await listInternalTransfers({ limit: 1000 });

      const headers = [
        'Transfer Ref',
        'Source Account',
        'Source Amount',
        'Source Currency',
        'Destination Account',
        'Destination Amount',
        'Destination Currency',
        'Exchange Rate',
        'Fee Amount',
        'Type',
        'Status',
        'Date',
        'Admin',
        'Description',
      ];

      const rows = transfers.map((t) => [
        `"${t.transferRef}"`,
        `"${t.sourceAccountName || t.sourceAccountId}"`,
        t.sourceAmount,
        `"${t.sourceCurrency}"`,
        `"${t.destinationAccountName || t.destinationAccountId}"`,
        t.destinationAmount,
        `"${t.destinationCurrency}"`,
        t.exchangeRate || 1.0,
        t.feeAmount,
        `"${t.transferType}"`,
        `"${t.status}"`,
        `"${t.createdAt}"`,
        `"${t.adminUsername || t.adminId || ''}"`,
        `"${(t.description || '').replace(/"/g, '""')}"`,
      ]);

      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="g4x-transfers-${Date.now()}.csv"`);
      res.send(csvContent);
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'EXPORT_FAILED',
        message: err.message || 'Failed to export transfers CSV',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 12. WITHDRAWAL MANAGEMENT & WORKFLOW (PHASE 2)
// ─────────────────────────────────────────────────────────────────────────────

financialAccountRouter.post(
  ['/admin/financial-accounts/withdrawals', '/api/admin/financial-accounts/withdrawals'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const {
        sourceAccountId,
        amount,
        fee,
        withdrawalType,
        destinationType,
        destinationAccountId,
        destinationDetails,
        description,
        attachmentUrl,
        idempotencyKey,
      } = req.body;

      if (!sourceAccountId) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'sourceAccountId is required' });
        return;
      }
      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'amount must be a positive integer greater than zero' });
        return;
      }

      const withdrawal = await requestPlatformWithdrawal({
        sourceAccountId: String(sourceAccountId),
        amount: Math.floor(numAmount),
        fee: fee !== undefined ? Math.floor(Number(fee)) : 0,
        withdrawalType: withdrawalType ? String(withdrawalType) : undefined,
        destinationType: destinationType ? String(destinationType) : undefined,
        destinationAccountId: destinationAccountId ? String(destinationAccountId) : undefined,
        destinationDetails: destinationDetails ? String(destinationDetails).trim() : undefined,
        description: description ? String(description).trim() : undefined,
        attachmentUrl: attachmentUrl ? String(attachmentUrl).trim() : undefined,
        adminId: user.discordId,
        idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : undefined,
      });

      res.status(201).json({
        success: true,
        message: `Withdrawal request ${withdrawal.withdrawalRef} created and funds reserved`,
        withdrawal,
      });
    } catch (err: any) {
      console.error('[FinancialWithdrawals] Request failed:', err);
      const isNotFound = err.message?.includes('NOT_FOUND');
      const isInsufficient = err.message?.includes('INSUFFICIENT_FUNDS');
      const isValidation = err.message?.includes('VALIDATION_ERROR') || err.message?.includes('ACCOUNT_INACTIVE');

      const statusCode = isNotFound ? 404 : isInsufficient ? 422 : isValidation ? 400 : 500;

      res.status(statusCode).json({
        success: false,
        error: isInsufficient ? 'INSUFFICIENT_FUNDS' : isNotFound ? 'ACCOUNT_NOT_FOUND' : 'WITHDRAWAL_FAILED',
        message: err.message || 'Failed to request withdrawal',
      });
    }
  }
);

financialAccountRouter.get(
  ['/admin/financial-accounts/withdrawals', '/api/admin/financial-accounts/withdrawals'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { sourceAccountId, currency, status, page, limit } = req.query;

      const result = await listPlatformWithdrawals({
        sourceAccountId: sourceAccountId ? String(sourceAccountId) : undefined,
        currency: currency ? String(currency) : undefined,
        status: status ? String(status) : undefined,
        page: page ? parseInt(String(page), 10) : 1,
        limit: limit ? parseInt(String(limit), 10) : 20,
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'LIST_WITHDRAWALS_FAILED',
        message: err.message || 'Failed to list withdrawals',
      });
    }
  }
);

financialAccountRouter.post(
  ['/admin/financial-accounts/withdrawals/:id/process', '/api/admin/financial-accounts/withdrawals/:id/process'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;

      const withdrawal = await markWithdrawalProcessing(id, user.discordId);
      res.json({
        success: true,
        message: `Withdrawal ${withdrawal.withdrawalRef} marked as PROCESSING`,
        withdrawal,
      });
    } catch (err: any) {
      res.status(400).json({
        success: false,
        error: 'PROCESS_FAILED',
        message: err.message || 'Failed to transition withdrawal to processing',
      });
    }
  }
);

financialAccountRouter.post(
  ['/admin/financial-accounts/withdrawals/:id/complete', '/api/admin/financial-accounts/withdrawals/:id/complete'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const { referenceNumber, attachmentUrl, notes } = req.body;

      const withdrawal = await completePlatformWithdrawal({
        withdrawalId: id,
        referenceNumber: referenceNumber ? String(referenceNumber).trim() : undefined,
        attachmentUrl: attachmentUrl ? String(attachmentUrl).trim() : undefined,
        processedBy: user.discordId,
        notes: notes ? String(notes).trim() : undefined,
      });

      res.json({
        success: true,
        message: `Withdrawal ${withdrawal.withdrawalRef} completed and settled successfully`,
        withdrawal,
      });
    } catch (err: any) {
      res.status(400).json({
        success: false,
        error: 'COMPLETE_FAILED',
        message: err.message || 'Failed to complete withdrawal',
      });
    }
  }
);

financialAccountRouter.post(
  ['/admin/financial-accounts/withdrawals/:id/reject', '/api/admin/financial-accounts/withdrawals/:id/reject'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason || !String(reason).trim()) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Rejection reason is required' });
        return;
      }

      const withdrawal = await rejectPlatformWithdrawal({
        withdrawalId: id,
        reason: String(reason).trim(),
        adminId: user.discordId,
      });

      res.json({
        success: true,
        message: `Withdrawal ${withdrawal.withdrawalRef} rejected and reserved funds released`,
        withdrawal,
      });
    } catch (err: any) {
      res.status(400).json({
        success: false,
        error: 'REJECT_FAILED',
        message: err.message || 'Failed to reject withdrawal',
      });
    }
  }
);

financialAccountRouter.post(
  ['/admin/financial-accounts/withdrawals/:id/cancel', '/api/admin/financial-accounts/withdrawals/:id/cancel'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const { reason } = req.body;

      const withdrawal = await cancelPlatformWithdrawal(id, String(reason || 'Cancelled by admin'), user.discordId);
      res.json({
        success: true,
        message: `Withdrawal ${withdrawal.withdrawalRef} cancelled and reserved funds released`,
        withdrawal,
      });
    } catch (err: any) {
      res.status(400).json({
        success: false,
        error: 'CANCEL_FAILED',
        message: err.message || 'Failed to cancel withdrawal',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 13. SINGLE ACCOUNT DETAILS & PARAMETERIZED ROUTES (MUST BE AFTER STATIC SUBROUTES)
// ─────────────────────────────────────────────────────────────────────────────

financialAccountRouter.get(
  ['/admin/financial-accounts/:id', '/api/admin/financial-accounts/:id'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const account = await getFinancialAccountDetails(id);
      res.json({
        success: true,
        account,
      });
    } catch (err: any) {
      const isNotFound = err.message?.includes('NOT_FOUND');
      res.status(isNotFound ? 404 : 500).json({
        success: false,
        error: isNotFound ? 'ACCOUNT_NOT_FOUND' : 'FETCH_FAILED',
        message: err.message || 'Failed to fetch financial account',
      });
    }
  }
);

financialAccountRouter.patch(
  ['/admin/financial-accounts/:id', '/api/admin/financial-accounts/:id'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { name, status, bankName, accountNumber, iban, cardNumber, notes, metadata } = req.body;

      // Reject any direct balance tampering attempts
      if (
        req.body.currentBalance !== undefined ||
        req.body.availableBalance !== undefined ||
        req.body.reservedBalance !== undefined ||
        req.body.openingBalance !== undefined
      ) {
        res.status(403).json({
          success: false,
          error: 'DIRECT_BALANCE_MUTATION_PROHIBITED',
          message: 'Direct editing of calculated balances is strictly prohibited. Use manual adjustments.',
        });
        return;
      }

      const account = await updateFinancialAccountMetadata(id, {
        name,
        status,
        bankName,
        accountNumber,
        iban,
        cardNumber,
        notes,
        metadata,
      });

      res.json({
        success: true,
        message: `Account '${account.name}' metadata updated successfully`,
        account,
      });
    } catch (err: any) {
      console.error('[FinancialAccounts] Failed to update account:', err);
      const isNotFound = err.message?.includes('NOT_FOUND');
      const isValidation = err.message?.includes('VALIDATION_ERROR');

      res.status(isNotFound ? 404 : isValidation ? 400 : 500).json({
        success: false,
        error: isNotFound ? 'ACCOUNT_NOT_FOUND' : isValidation ? 'VALIDATION_ERROR' : 'UPDATE_FAILED',
        message: err.message || 'Failed to update account metadata',
      });
    }
  }
);

financialAccountRouter.post(
  ['/admin/financial-accounts/:id/status', '/api/admin/financial-accounts/:id/status'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || !['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(String(status).toUpperCase())) {
        res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Status must be ACTIVE, INACTIVE, or SUSPENDED',
        });
        return;
      }

      const account = await setFinancialAccountStatus(id, String(status).toUpperCase() as FinancialAccountStatus);

      res.json({
        success: true,
        message: `Account '${account.name}' status set to ${account.status}`,
        account,
      });
    } catch (err: any) {
      const isNotFound = err.message?.includes('NOT_FOUND');
      res.status(isNotFound ? 404 : 500).json({
        success: false,
        error: isNotFound ? 'ACCOUNT_NOT_FOUND' : 'UPDATE_FAILED',
        message: err.message || 'Failed to update account status',
      });
    }
  }
);

financialAccountRouter.get(
  ['/admin/financial-accounts/:id/transactions', '/api/admin/financial-accounts/:id/transactions'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { page, limit, direction } = req.query;

      const history = await getAccountTransactions(id, {
        page: page ? parseInt(String(page), 10) : 1,
        limit: limit ? parseInt(String(limit), 10) : 20,
        direction: direction ? String(direction) : undefined,
      });

      res.json({
        success: true,
        ...history,
      });
    } catch (err: any) {
      const isNotFound = err.message?.includes('NOT_FOUND');
      res.status(isNotFound ? 404 : 500).json({
        success: false,
        error: isNotFound ? 'ACCOUNT_NOT_FOUND' : 'FETCH_FAILED',
        message: err.message || 'Failed to fetch account transactions',
      });
    }
  }
);


