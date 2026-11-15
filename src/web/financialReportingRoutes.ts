/**
 * src/web/financialReportingRoutes.ts — G4X Financial Reports & Advertiser Boosts API (Phase 3)
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from './middleware/auth';
import { requireAdminPortalAccess } from './adminPortalRoutes';
import {
  getConsolidatedFinancialReport,
  getPlatformFinancialReport,
  getAdvertiserBoostsFinancialReport,
  generateChartDataPoints,
  listReportOrders,
  generateOrdersReportCsv,
  calculateDateRanges,
  ReportPeriodType,
  CANONICAL_PLATFORMS,
} from '../services/financialReportingService';

export const financialReportingRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// 1. CONSOLIDATED FINANCIAL REPORT (ALL PLATFORMS + CHARTS + COMPARISONS)
// ─────────────────────────────────────────────────────────────────────────────

financialReportingRouter.get(
  ['/admin/financial-reports/consolidated', '/api/admin/financial-reports/consolidated'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { period, from, to } = req.query;
      const periodType = (String(period || 'MONTHLY').toUpperCase()) as ReportPeriodType;

      const report = await getConsolidatedFinancialReport(
        periodType,
        from ? String(from) : undefined,
        to ? String(to) : undefined
      );

      res.json(report);
    } catch (err: any) {
      console.error('[FinancialReports] Consolidated report error:', err);
      res.status(500).json({
        success: false,
        error: 'REPORT_GENERATION_FAILED',
        message: err.message || 'Failed to generate consolidated financial report',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. SPECIFIC PLATFORM FINANCIAL REPORT
// ─────────────────────────────────────────────────────────────────────────────

financialReportingRouter.get(
  ['/admin/financial-reports/platform/:platform', '/api/admin/financial-reports/platform/:platform'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { platform } = req.params;
      const { period, from, to } = req.query;
      const periodType = (String(period || 'MONTHLY').toUpperCase()) as ReportPeriodType;

      const platKey = platform.toLowerCase().trim();
      const platConfig = CANONICAL_PLATFORMS.find((p) => p.key === platKey);
      if (!platConfig) {
        res.status(404).json({
          success: false,
          error: 'PLATFORM_NOT_FOUND',
          message: `Unknown platform '${platform}'. Supported platforms: ${CANONICAL_PLATFORMS.map((p) => p.key).join(', ')}`,
        });
        return;
      }

      const range = calculateDateRanges(
        periodType,
        from ? String(from) : undefined,
        to ? String(to) : undefined
      );

      const summary = await getPlatformFinancialReport(platKey, range);
      const revenueOverTime = await generateChartDataPoints(range, platKey);

      res.json({
        success: true,
        platformKey: platKey,
        platformName: platConfig.name,
        periodType,
        dateRange: {
          startDate: range.startDate.toISOString(),
          endDate: range.endDate.toISOString(),
          periodLabel: range.periodLabel,
          previousPeriodLabel: range.previousPeriodLabel,
        },
        summary,
        charts: {
          revenueOverTime,
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[FinancialReports] Platform report error:', err);
      res.status(500).json({
        success: false,
        error: 'REPORT_GENERATION_FAILED',
        message: err.message || 'Failed to generate platform financial report',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. ADVERTISER BOOSTS DEDICATED REPORT
// ─────────────────────────────────────────────────────────────────────────────

financialReportingRouter.get(
  ['/admin/financial-reports/advertiser-boosts', '/api/admin/financial-reports/advertiser-boosts'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { period, from, to } = req.query;
      const periodType = (String(period || 'MONTHLY').toUpperCase()) as ReportPeriodType;

      const range = calculateDateRanges(
        periodType,
        from ? String(from) : undefined,
        to ? String(to) : undefined
      );

      const summary = await getAdvertiserBoostsFinancialReport(range);
      const performanceOverTime = await generateChartDataPoints(range, 'advertiser');

      res.json({
        success: true,
        periodType,
        dateRange: {
          startDate: range.startDate.toISOString(),
          endDate: range.endDate.toISOString(),
          periodLabel: range.periodLabel,
          previousPeriodLabel: range.previousPeriodLabel,
        },
        summary,
        charts: {
          performanceOverTime,
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[FinancialReports] Advertiser report error:', err);
      res.status(500).json({
        success: false,
        error: 'REPORT_GENERATION_FAILED',
        message: err.message || 'Failed to generate advertiser boosts report',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. REPORT ORDERS DATA TABLE
// ─────────────────────────────────────────────────────────────────────────────

financialReportingRouter.get(
  ['/admin/financial-reports/orders', '/api/admin/financial-reports/orders'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { platform, status, search, startDate, endDate, page, limit, sortBy, sortDirection } = req.query;

      const result = await listReportOrders({
        platform: platform ? String(platform) : undefined,
        status: status ? String(status) : undefined,
        search: search ? String(search) : undefined,
        startDate: startDate ? String(startDate) : undefined,
        endDate: endDate ? String(endDate) : undefined,
        page: page ? parseInt(String(page), 10) : 1,
        limit: limit ? parseInt(String(limit), 10) : 20,
        sortBy: sortBy ? String(sortBy) : undefined,
        sortDirection: sortDirection === 'asc' ? 'asc' : 'desc',
      });

      res.json(result);
    } catch (err: any) {
      console.error('[FinancialReports] List report orders error:', err);
      res.status(500).json({
        success: false,
        error: 'FETCH_ORDERS_FAILED',
        message: err.message || 'Failed to fetch reporting orders',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. CSV EXPORT FOR REPORTS
// ─────────────────────────────────────────────────────────────────────────────

financialReportingRouter.get(
  ['/admin/financial-reports/export-csv', '/api/admin/financial-reports/export-csv'],
  requireAuth,
  requireAdminPortalAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { platform, status, startDate, endDate } = req.query;

      const csvContent = await generateOrdersReportCsv({
        platform: platform ? String(platform) : undefined,
        status: status ? String(status) : undefined,
        startDate: startDate ? String(startDate) : undefined,
        endDate: endDate ? String(endDate) : undefined,
      });

      const filename = `g4x-financial-report-${platform || 'all'}-${Date.now()}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (err: any) {
      console.error('[FinancialReports] CSV export error:', err);
      res.status(500).json({
        success: false,
        error: 'EXPORT_FAILED',
        message: err.message || 'Failed to export reports CSV',
      });
    }
  }
);
