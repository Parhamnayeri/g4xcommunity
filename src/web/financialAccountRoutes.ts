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
// 6. GET SINGLE ACCOUNT DETAILS
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

// ─────────────────────────────────────────────────────────────────────────────
// 7. EDIT ACCOUNT METADATA (NO DIRECT BALANCES EDIT)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// 8. SET ACCOUNT STATUS (ACTIVE / INACTIVE / SUSPENDED)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// 9. ACCOUNT TRANSACTION HISTORY
// ─────────────────────────────────────────────────────────────────────────────

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
