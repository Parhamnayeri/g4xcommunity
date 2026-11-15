/**
 * src/web/financialLedgerRoutes.ts — G4X Financial Ledger, Audit Trail & Reconciliation API (Phase 4)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, AuthenticatedRequest } from './middleware/auth';
import { requireAdminPortalAccess } from './adminPortalRoutes';
import {
  recordDoubleEntryJournalEntry,
  listDoubleEntryJournalEntries,
  calculateTrialBalance,
  recordFinancialAuditLog,
  listFinancialAuditLogs,
  performBalanceReconciliation,
  resolveReconciliationDiscrepancy,
  listBalanceReconciliations,
  reverseFinancialTransaction,
  generateJournalCsv,
  generateAuditLogsCsv,
  resolveUserFinancialRole,
  hasFinancialPermission,
  FinancialRoleTier,
  DoubleEntryTransactionType,
} from '../services/financialLedgerAndAuditService';

export const financialLedgerRouter = Router();

/**
 * Middleware ensuring user has at least the required Financial Role Tier.
 */
export function requireFinancialTier(requiredTier: FinancialRoleTier) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
      return;
    }
    const roles = (user.userRoles || []).map((r) => r.roleKey as string);
    if (!hasFinancialPermission(roles, requiredTier)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `Requires ${requiredTier} tier or higher to perform this financial operation`,
      });
      return;
    }
    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CALLER ROLE & PERMISSION TIER
// ─────────────────────────────────────────────────────────────────────────────

financialLedgerRouter.get(
  ['/admin/financial-ledger/role-tier', '/api/admin/financial-ledger/role-tier'],
  requireAuth,
  (req: Request, res: Response): void => {
    const user = (req as AuthenticatedRequest).user;
    const roles = (user?.userRoles || []).map((r) => r.roleKey as string);
    const tier = resolveUserFinancialRole(roles);

    res.json({
      success: true,
      userId: user?.discordId,
      username: user?.username,
      roles,
      financialTier: tier,
      canView: hasFinancialPermission(roles, 'FINANCIAL_VIEWER'),
      canManage: hasFinancialPermission(roles, 'FINANCIAL_MANAGER'),
      canAdmin: hasFinancialPermission(roles, 'FINANCIAL_ADMIN'),
      isSuperAdmin: hasFinancialPermission(roles, 'SUPER_ADMIN'),
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. DOUBLE-ENTRY JOURNAL & TRIAL BALANCE
// ─────────────────────────────────────────────────────────────────────────────

financialLedgerRouter.get(
  ['/admin/financial-ledger/journal', '/api/admin/financial-ledger/journal'],
  requireAuth,
  requireAdminPortalAccess,
  requireFinancialTier('FINANCIAL_VIEWER'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { transactionType, currency, accountId, referenceId, search, startDate, endDate, page, limit } = req.query;

      const result = await listDoubleEntryJournalEntries({
        transactionType: transactionType ? String(transactionType) : undefined,
        currency: currency ? String(currency) : undefined,
        accountId: accountId ? String(accountId) : undefined,
        referenceId: referenceId ? String(referenceId) : undefined,
        search: search ? String(search) : undefined,
        startDate: startDate ? String(startDate) : undefined,
        endDate: endDate ? String(endDate) : undefined,
        page: page ? parseInt(String(page), 10) : 1,
        limit: limit ? parseInt(String(limit), 10) : 20,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[FinancialLedger] List journal entries error:', err);
      res.status(500).json({ success: false, error: 'FETCH_JOURNAL_FAILED', message: err.message });
    }
  }
);

financialLedgerRouter.get(
  ['/admin/financial-ledger/trial-balance', '/api/admin/financial-ledger/trial-balance'],
  requireAuth,
  requireAdminPortalAccess,
  requireFinancialTier('FINANCIAL_VIEWER'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currency = (req.query.currency ? String(req.query.currency).toUpperCase() : 'USD') as 'USD' | 'IRR';
      const result = await calculateTrialBalance(currency);
      res.json({ success: true, trialBalance: result });
    } catch (err: any) {
      console.error('[FinancialLedger] Trial balance error:', err);
      res.status(500).json({ success: false, error: 'TRIAL_BALANCE_FAILED', message: err.message });
    }
  }
);

financialLedgerRouter.post(
  ['/admin/financial-ledger/journal', '/api/admin/financial-ledger/journal'],
  requireAuth,
  requireAdminPortalAccess,
  requireFinancialTier('FINANCIAL_ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { transactionType, debitAccountId, creditAccountId, amountMinor, currency, referenceId, description, metadata } = req.body;
      const adminId = (req as AuthenticatedRequest).user?.discordId;

      if (!transactionType || !debitAccountId || !creditAccountId || !amountMinor || !currency) {
        res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'transactionType, debitAccountId, creditAccountId, amountMinor, and currency are required',
        });
        return;
      }

      const record = await recordDoubleEntryJournalEntry({
        transactionType: transactionType as DoubleEntryTransactionType,
        debitAccountId,
        creditAccountId,
        amountMinor,
        currency,
        referenceId,
        description,
        metadata,
        adminId,
      });

      res.status(201).json({
        success: true,
        message: 'Double-entry journal record posted successfully',
        journalRecord: record,
      });
    } catch (err: any) {
      console.error('[FinancialLedger] Record journal entry error:', err);
      res.status(400).json({ success: false, error: 'RECORD_JOURNAL_FAILED', message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. FINANCIAL AUDIT TRAIL
// ─────────────────────────────────────────────────────────────────────────────

financialLedgerRouter.get(
  ['/admin/financial-ledger/audit-logs', '/api/admin/financial-ledger/audit-logs'],
  requireAuth,
  requireAdminPortalAccess,
  requireFinancialTier('FINANCIAL_VIEWER'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { actionType, adminId, relatedAccountId, search, startDate, endDate, page, limit } = req.query;

      const result = await listFinancialAuditLogs({
        actionType: actionType ? String(actionType) : undefined,
        adminId: adminId ? String(adminId) : undefined,
        relatedAccountId: relatedAccountId ? String(relatedAccountId) : undefined,
        search: search ? String(search) : undefined,
        startDate: startDate ? String(startDate) : undefined,
        endDate: endDate ? String(endDate) : undefined,
        page: page ? parseInt(String(page), 10) : 1,
        limit: limit ? parseInt(String(limit), 10) : 20,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[FinancialLedger] List audit logs error:', err);
      res.status(500).json({ success: false, error: 'FETCH_AUDIT_LOGS_FAILED', message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. BALANCE RECONCILIATION
// ─────────────────────────────────────────────────────────────────────────────

financialLedgerRouter.get(
  ['/admin/financial-ledger/reconciliations', '/api/admin/financial-ledger/reconciliations'],
  requireAuth,
  requireAdminPortalAccess,
  requireFinancialTier('FINANCIAL_VIEWER'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { accountId, status, startDate, endDate, page, limit } = req.query;

      const result = await listBalanceReconciliations({
        accountId: accountId ? String(accountId) : undefined,
        status: status ? String(status) : undefined,
        startDate: startDate ? String(startDate) : undefined,
        endDate: endDate ? String(endDate) : undefined,
        page: page ? parseInt(String(page), 10) : 1,
        limit: limit ? parseInt(String(limit), 10) : 20,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[FinancialLedger] List reconciliations error:', err);
      res.status(500).json({ success: false, error: 'FETCH_RECONCILIATIONS_FAILED', message: err.message });
    }
  }
);

financialLedgerRouter.post(
  ['/admin/financial-ledger/reconciliations', '/api/admin/financial-ledger/reconciliations'],
  requireAuth,
  requireAdminPortalAccess,
  requireFinancialTier('FINANCIAL_MANAGER'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { accountId, actualBalanceMinor, notes, attachmentUrl } = req.body;
      const adminId = (req as AuthenticatedRequest).user?.discordId;

      if (!accountId || actualBalanceMinor === undefined) {
        res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'accountId and actualBalanceMinor are required',
        });
        return;
      }

      const record = await performBalanceReconciliation({
        accountId,
        actualBalanceMinor,
        adminId,
        notes,
        attachmentUrl,
      });

      res.status(201).json({
        success: true,
        message: 'Balance reconciliation performed successfully',
        reconciliation: record,
      });
    } catch (err: any) {
      console.error('[FinancialLedger] Perform reconciliation error:', err);
      res.status(400).json({ success: false, error: 'RECONCILIATION_FAILED', message: err.message });
    }
  }
);

financialLedgerRouter.post(
  ['/admin/financial-ledger/reconciliations/:id/resolve', '/api/admin/financial-ledger/reconciliations/:id/resolve'],
  requireAuth,
  requireAdminPortalAccess,
  requireFinancialTier('FINANCIAL_ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { reason, notes, attachmentUrl } = req.body;
      const adminId = (req as AuthenticatedRequest).user?.discordId || 'system_admin';

      if (!reason || !reason.trim()) {
        res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'An explicit justification/reason is required to resolve discrepancy',
        });
        return;
      }

      const result = await resolveReconciliationDiscrepancy({
        reconciliationId: id,
        adminId,
        reason,
        notes,
        attachmentUrl,
      });

      res.json({
        success: true,
        message: 'Discrepancy resolved via balancing adjustment transaction',
        reconciliation: result,
      });
    } catch (err: any) {
      console.error('[FinancialLedger] Resolve discrepancy error:', err);
      res.status(400).json({ success: false, error: 'RESOLVE_DISCREPANCY_FAILED', message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. TRANSACTION REVERSALS
// ─────────────────────────────────────────────────────────────────────────────

financialLedgerRouter.post(
  ['/admin/financial-ledger/transactions/:id/reverse', '/api/admin/financial-ledger/transactions/:id/reverse'],
  requireAuth,
  requireAdminPortalAccess,
  requireFinancialTier('FINANCIAL_ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const adminId = (req as AuthenticatedRequest).user?.discordId || 'system_admin';
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || undefined;

      if (!reason || !reason.trim()) {
        res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'A clear reason is strictly required to reverse a transaction',
        });
        return;
      }

      const result = await reverseFinancialTransaction({
        transactionIdOrRef: id,
        adminId,
        reason,
        ipAddress,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[FinancialLedger] Reverse transaction error:', err);
      res.status(400).json({ success: false, error: 'REVERSAL_FAILED', message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. CSV EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

financialLedgerRouter.get(
  ['/admin/financial-ledger/export-csv', '/api/admin/financial-ledger/export-csv'],
  requireAuth,
  requireAdminPortalAccess,
  requireFinancialTier('FINANCIAL_VIEWER'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const type = (req.query.type ? String(req.query.type).toLowerCase() : 'journal');

      let csvContent = '';
      let filename = '';

      if (type === 'audit') {
        csvContent = await generateAuditLogsCsv(req.query);
        filename = `g4x-financial-audit-logs-${Date.now()}.csv`;
      } else {
        csvContent = await generateJournalCsv(req.query);
        filename = `g4x-double-entry-journal-${Date.now()}.csv`;
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (err: any) {
      console.error('[FinancialLedger] CSV export error:', err);
      res.status(500).json({ success: false, error: 'EXPORT_FAILED', message: err.message });
    }
  }
);
