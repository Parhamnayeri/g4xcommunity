/**
 * src/web/financialAnalyticsRoutes.ts — Phase 5 REST API Routes:
 * Financial Snapshots, Advanced Analytics, Cash Flow vs. P&L, and Automated Exports.
 */

import { Router, Request, Response } from 'express';
import prisma from '../database/db';
import {
  captureFinancialSnapshot,
  listFinancialSnapshots,
  getFinancialSnapshotById,
  compareHistoricalSnapshots,
  getAdvancedFinancialAnalytics,
  getProfitAndLossReport,
  getCashFlowReport,
  exportFinancialStatement,
  listAutomatedSchedules,
  updateAutomatedSchedule,
  executeReportSchedule,
  listGeneratedFinancialReports,
  getGeneratedReportFile,
  SnapshotType,
  ReportExportType,
  ReportExportFormat,
} from '../services/financialSnapshotsAndAnalyticsService';
import { hasFinancialPermission } from '../services/financialLedgerAndAuditService';
import { ReportPeriodType } from '../services/financialReportingService';

export const financialAnalyticsRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION & RBAC MIDDLEWARE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function resolveSessionUser(req: Request) {
  const userId = req.session?.userId;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { discordId: userId },
    include: {
      userRoles: { select: { roleKey: true } },
    },
  });

  if (!user) return null;

  const roles = user.userRoles.map((r) => r.roleKey);
  return { user, roles, userId: user.discordId, username: user.username };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. FINANCIAL SNAPSHOTS ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/financial-analytics/snapshots
 * Query historical snapshots with pagination and filters.
 */
financialAnalyticsRouter.get(
  ['/admin/financial-analytics/snapshots', '/api/admin/financial-analytics/snapshots', '/financial-analytics/snapshots'],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await resolveSessionUser(req);
      if (!auth) {
        res.status(401).json({ error: 'UNAUTHORIZED: Authentication session required' });
        return;
      }
      if (!hasFinancialPermission(auth.roles, 'FINANCIAL_VIEWER')) {
        res.status(403).json({ error: 'FORBIDDEN: Insufficient financial permissions' });
        return;
      }

      const result = await listFinancialSnapshots({
        snapshotType: (req.query.snapshotType || req.query.type) as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      });

      res.json({
        success: true,
        snapshots: result.snapshots,
        total: result.total,
        page: result.page,
        limit: result.limit,
      });
    } catch (error: any) {
      console.error('[FinancialAnalyticsAPI] Failed to list snapshots:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
);

/**
 * GET /api/admin/financial-analytics/snapshots/compare
 * Compare two historical snapshots.
 */
financialAnalyticsRouter.get(
  ['/admin/financial-analytics/snapshots/compare', '/api/admin/financial-analytics/snapshots/compare', '/financial-analytics/snapshots/compare'],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await resolveSessionUser(req);
      if (!auth) {
        res.status(401).json({ error: 'UNAUTHORIZED: Authentication session required' });
        return;
      }
      if (!hasFinancialPermission(auth.roles, 'FINANCIAL_VIEWER')) {
        res.status(403).json({ error: 'FORBIDDEN: Insufficient financial permissions' });
        return;
      }

      const baseId = req.query.baseId as string;
      const comparisonId = req.query.comparisonId as string;

      if (!baseId || !comparisonId) {
        res.status(400).json({ error: 'VALIDATION_ERROR: baseId and comparisonId are required query parameters' });
        return;
      }

      const comparison = await compareHistoricalSnapshots(baseId, comparisonId);
      res.json({ success: true, comparison });
    } catch (error: any) {
      console.error('[FinancialAnalyticsAPI] Failed to compare snapshots:', error);
      res.status(400).json({ error: error.message || 'Comparison failed' });
    }
  }
);

/**
 * POST /api/admin/financial-analytics/snapshots/capture or /snapshots
 * Manually trigger and capture an on-demand financial snapshot.
 */
financialAnalyticsRouter.post(
  [
    '/admin/financial-analytics/snapshots/capture',
    '/api/admin/financial-analytics/snapshots/capture',
    '/financial-analytics/snapshots/capture',
    '/admin/financial-analytics/snapshots',
    '/api/admin/financial-analytics/snapshots',
    '/financial-analytics/snapshots',
  ],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await resolveSessionUser(req);
      if (!auth) {
        res.status(401).json({ error: 'UNAUTHORIZED: Authentication session required' });
        return;
      }
      if (!hasFinancialPermission(auth.roles, 'FINANCIAL_ADMIN')) {
        res.status(403).json({ error: 'FORBIDDEN: Financial Admin permissions required to capture snapshots' });
        return;
      }

      const { snapshotType, notes } = req.body || {};
      const snapshot = await captureFinancialSnapshot({
        snapshotType: (snapshotType as SnapshotType) || 'MANUAL',
        adminId: auth.userId,
        notes: notes?.trim() || undefined,
      });

      res.status(200).json({
        success: true,
        message: `Financial snapshot '${snapshot.snapshotRef}' captured successfully`,
        snapshot,
      });
    } catch (error: any) {
      console.error('[FinancialAnalyticsAPI] Failed to capture snapshot:', error);
      res.status(400).json({ error: error.message || 'Failed to capture snapshot' });
    }
  }
);

/**
 * GET /api/admin/financial-analytics/snapshots/:id
 * Fetch a specific snapshot.
 */
financialAnalyticsRouter.get(
  ['/admin/financial-analytics/snapshots/:id', '/api/admin/financial-analytics/snapshots/:id', '/financial-analytics/snapshots/:id'],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await resolveSessionUser(req);
      if (!auth) {
        res.status(401).json({ error: 'UNAUTHORIZED: Authentication session required' });
        return;
      }
      if (!hasFinancialPermission(auth.roles, 'FINANCIAL_VIEWER')) {
        res.status(403).json({ error: 'FORBIDDEN: Insufficient financial permissions' });
        return;
      }

      const snapshot = await getFinancialSnapshotById(req.params.id);
      res.json({ success: true, snapshot });
    } catch (error: any) {
      console.error('[FinancialAnalyticsAPI] Failed to get snapshot:', error);
      res.status(404).json({ error: error.message || 'Snapshot not found' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. ADVANCED FINANCIAL ANALYTICS & P&L / CASH FLOW ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/financial-analytics/advanced
 * Retrieve advanced financial analytics indicators.
 */
financialAnalyticsRouter.get(
  ['/admin/financial-analytics/advanced', '/api/admin/financial-analytics/advanced', '/financial-analytics/advanced'],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await resolveSessionUser(req);
      if (!auth) {
        res.status(401).json({ error: 'UNAUTHORIZED: Authentication session required' });
        return;
      }
      if (!hasFinancialPermission(auth.roles, 'FINANCIAL_VIEWER')) {
        res.status(403).json({ error: 'FORBIDDEN: Insufficient financial permissions' });
        return;
      }

      const analytics = await getAdvancedFinancialAnalytics({
        periodType: req.query.periodType as ReportPeriodType,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        platform: req.query.platform as string,
      });

      res.json({ success: true, analytics });
    } catch (error: any) {
      console.error('[FinancialAnalyticsAPI] Failed to fetch advanced analytics:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
);

/**
 * GET /api/admin/financial-analytics/p-and-l or /pnl
 * Retrieve dedicated Profit & Loss (P&L) report.
 */
financialAnalyticsRouter.get(
  [
    '/admin/financial-analytics/p-and-l',
    '/api/admin/financial-analytics/p-and-l',
    '/financial-analytics/p-and-l',
    '/admin/financial-analytics/pnl',
    '/api/admin/financial-analytics/pnl',
    '/financial-analytics/pnl',
  ],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await resolveSessionUser(req);
      if (!auth) {
        res.status(401).json({ error: 'UNAUTHORIZED: Authentication session required' });
        return;
      }
      if (!hasFinancialPermission(auth.roles, 'FINANCIAL_VIEWER')) {
        res.status(403).json({ error: 'FORBIDDEN: Insufficient financial permissions' });
        return;
      }

      const pnl = await getProfitAndLossReport({
        periodType: req.query.periodType as ReportPeriodType,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        platform: req.query.platform as string,
      });

      res.json({ success: true, report: pnl, pnl });
    } catch (error: any) {
      console.error('[FinancialAnalyticsAPI] Failed to fetch P&L report:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
);

/**
 * GET /api/admin/financial-analytics/cash-flow
 * Retrieve dedicated Cash Flow statement.
 */
financialAnalyticsRouter.get(
  ['/admin/financial-analytics/cash-flow', '/api/admin/financial-analytics/cash-flow', '/financial-analytics/cash-flow'],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await resolveSessionUser(req);
      if (!auth) {
        res.status(401).json({ error: 'UNAUTHORIZED: Authentication session required' });
        return;
      }
      if (!hasFinancialPermission(auth.roles, 'FINANCIAL_VIEWER')) {
        res.status(403).json({ error: 'FORBIDDEN: Insufficient financial permissions' });
        return;
      }

      const cashFlow = await getCashFlowReport({
        periodType: req.query.periodType as ReportPeriodType,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      });

      res.json({ success: true, report: cashFlow, cashFlow });
    } catch (error: any) {
      console.error('[FinancialAnalyticsAPI] Failed to fetch cash flow statement:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. FINANCIAL EXPORT & DOWNLOAD ENDPOINTS (CSV, XLSX, PDF/HTML, JSON)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/financial-analytics/export
 * Download on-demand financial export.
 */
financialAnalyticsRouter.get(
  ['/admin/financial-analytics/export', '/api/admin/financial-analytics/export', '/financial-analytics/export'],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await resolveSessionUser(req);
      if (!auth) {
        res.status(401).json({ error: 'UNAUTHORIZED: Authentication session required' });
        return;
      }
      if (!hasFinancialPermission(auth.roles, 'FINANCIAL_VIEWER')) {
        res.status(403).json({ error: 'FORBIDDEN: Insufficient financial permissions' });
        return;
      }

      const reportType = (req.query.reportType as ReportExportType) || 'MONTHLY';
      const format = (req.query.format as ReportExportFormat) || 'CSV';

      const result = await exportFinancialStatement({
        reportType,
        format,
        periodType: req.query.periodType as ReportPeriodType,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        platform: req.query.platform as string,
      });

      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
      res.send(result.content);
    } catch (error: any) {
      console.error('[FinancialAnalyticsAPI] Failed to generate export:', error);
      res.status(500).json({ error: error.message || 'Export failed' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. AUTOMATED REPORTING SCHEDULES & ARCHIVE ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/financial-analytics/schedules
 * List automated reporting schedules.
 */
financialAnalyticsRouter.get(
  ['/admin/financial-analytics/schedules', '/api/admin/financial-analytics/schedules', '/financial-analytics/schedules'],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await resolveSessionUser(req);
      if (!auth) {
        res.status(401).json({ error: 'UNAUTHORIZED: Authentication session required' });
        return;
      }
      if (!hasFinancialPermission(auth.roles, 'FINANCIAL_VIEWER')) {
        res.status(403).json({ error: 'FORBIDDEN: Insufficient financial permissions' });
        return;
      }

      const schedules = await listAutomatedSchedules();
      res.json({ success: true, schedules });
    } catch (error: any) {
      console.error('[FinancialAnalyticsAPI] Failed to list schedules:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/admin/financial-analytics/schedules/:id
 * Toggle or configure an automated schedule.
 */
financialAnalyticsRouter.patch(
  ['/admin/financial-analytics/schedules/:id', '/api/admin/financial-analytics/schedules/:id', '/financial-analytics/schedules/:id'],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await resolveSessionUser(req);
      if (!auth) {
        res.status(401).json({ error: 'UNAUTHORIZED: Authentication session required' });
        return;
      }
      if (!hasFinancialPermission(auth.roles, 'FINANCIAL_ADMIN')) {
        res.status(403).json({ error: 'FORBIDDEN: Financial Admin permissions required to configure schedules' });
        return;
      }

      const schedule = await updateAutomatedSchedule(req.params.id, req.body);
      res.json({ success: true, schedule });
    } catch (error: any) {
      console.error('[FinancialAnalyticsAPI] Failed to update schedule:', error);
      res.status(400).json({ error: error.message || 'Failed to update schedule' });
    }
  }
);

/**
 * POST /api/admin/financial-analytics/schedules/:id/run
 * Trigger manual execution of a report schedule.
 */
financialAnalyticsRouter.post(
  ['/admin/financial-analytics/schedules/:id/run', '/api/admin/financial-analytics/schedules/:id/run', '/financial-analytics/schedules/:id/run'],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await resolveSessionUser(req);
      if (!auth) {
        res.status(401).json({ error: 'UNAUTHORIZED: Authentication session required' });
        return;
      }
      if (!hasFinancialPermission(auth.roles, 'FINANCIAL_ADMIN')) {
        res.status(403).json({ error: 'FORBIDDEN: Financial Admin permissions required to run schedules' });
        return;
      }

      const report = await executeReportSchedule(req.params.id, auth.userId);
      res.json({
        success: true,
        message: 'Report schedule executed successfully',
        report,
      });
    } catch (error: any) {
      console.error('[FinancialAnalyticsAPI] Failed to execute schedule:', error);
      res.status(400).json({ error: error.message || 'Schedule execution failed' });
    }
  }
);

/**
 * GET /api/admin/financial-analytics/reports or /generated-reports
 * List generated report archive.
 */
financialAnalyticsRouter.get(
  [
    '/admin/financial-analytics/reports',
    '/api/admin/financial-analytics/reports',
    '/financial-analytics/reports',
    '/admin/financial-analytics/generated-reports',
    '/api/admin/financial-analytics/generated-reports',
    '/financial-analytics/generated-reports',
  ],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await resolveSessionUser(req);
      if (!auth) {
        res.status(401).json({ error: 'UNAUTHORIZED: Authentication session required' });
        return;
      }
      if (!hasFinancialPermission(auth.roles, 'FINANCIAL_VIEWER')) {
        res.status(403).json({ error: 'FORBIDDEN: Insufficient financial permissions' });
        return;
      }

      const reports = await listGeneratedFinancialReports({
        reportType: req.query.reportType as string,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      });

      res.json({ success: true, reports });
    } catch (error: any) {
      console.error('[FinancialAnalyticsAPI] Failed to list generated reports:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
);

/**
 * GET /api/admin/financial-analytics/reports/:id/download or /generated-reports/:id/download
 * Download a generated report file.
 */
financialAnalyticsRouter.get(
  [
    '/admin/financial-analytics/reports/:id/download',
    '/api/admin/financial-analytics/reports/:id/download',
    '/financial-analytics/reports/:id/download',
    '/admin/financial-analytics/generated-reports/:id/download',
    '/api/admin/financial-analytics/generated-reports/:id/download',
    '/financial-analytics/generated-reports/:id/download',
  ],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await resolveSessionUser(req);
      if (!auth) {
        res.status(401).json({ error: 'UNAUTHORIZED: Authentication session required' });
        return;
      }
      if (!hasFinancialPermission(auth.roles, 'FINANCIAL_VIEWER')) {
        res.status(403).json({ error: 'FORBIDDEN: Insufficient financial permissions' });
        return;
      }

      const file = await getGeneratedReportFile(req.params.id);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.send(file.content);
    } catch (error: any) {
      console.error('[FinancialAnalyticsAPI] Failed to download generated report:', error);
      res.status(404).json({ error: error.message || 'Report not found' });
    }
  }
);
