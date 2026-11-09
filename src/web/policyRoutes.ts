/**
 * src/web/policyRoutes.ts — Rules & Policies CMS API Routes
 *
 * G4X Community — Rules & Policies Content Management System
 * Stack: Express, TypeScript, Prisma, Discord.js
 *
 * Security:
 *  - Public read access for published rules only (/api/public/rules, /api/rules)
 *  - Strict server-authoritative Admin & Owner access for draft editing and publishing
 *  - Staff and Management roles are strictly denied policy mutations
 *  - CSRF validation on all state mutations
 *  - Immutable audit logging for all policy updates and publications
 */

import { Router, Request, Response } from 'express';
import { requireAuth, requireCsrf, AuthenticatedRequest } from './middleware/auth';
import {
  getPublishedPolicy,
  getDraftOrActivePolicy,
  saveDraftPolicy,
  publishPolicyVersion,
  restoreVersionAsDraft,
  listPolicyVersions,
  retryDiscordSync,
} from '../services/policyService';
import { getPolicyDiscrepancyWarnings } from '../services/policyDiscrepancies';

export const policyRouter = Router();

/**
 * Middleware: Strictly requires Admin or Owner role for policy authoring/publishing.
 * Staff and Management roles are strictly denied.
 */
function requirePolicyAdminAccess(req: Request, res: Response, next: () => void): void {
  const user = (req as AuthenticatedRequest).user;
  if (!user || !user.isActive) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication session required.' });
    return;
  }

  const userRoles = (user.userRoles || []).map((r) => r.roleKey as string);
  const isAuthorized = userRoles.some((r) => ['owner', 'admin'].includes(r));

  if (!isAuthorized) {
    res.status(403).json({
      error: 'POLICY_ADMIN_ACCESS_DENIED',
      message: 'Access restricted to authorized Admin or Owner personnel only.',
    });
    return;
  }

  next();
}

// ─── ۱. روت عمومی دریافت خط‌مشی منتشرشده (Public Rules API) ───────────────────

policyRouter.get(['/public/rules', '/rules'], async (_req: Request, res: Response): Promise<void> => {
  try {
    const published = await getPublishedPolicy('community-rules');
    res.json({
      success: true,
      policy: published,
      fallbackAvailable: !published,
    });
  } catch (err: any) {
    console.error('[PolicyAPI] Error fetching public rules:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve published rules.' });
  }
});

// ─── ۲. دریافت پیش‌نویس فعال و تنظیمات پنل ادمین (Admin Draft & Overview) ────

policyRouter.get(
  '/admin/policy',
  requireAuth,
  requirePolicyAdminAccess,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const data = await getDraftOrActivePolicy('community-rules', user.discordId);
      res.json({
        success: true,
        document: data.document,
        draftVersion: data.draftVersion,
        publishedVersion: data.publishedVersion,
        discrepancies: data.discrepancies,
      });
    } catch (err: any) {
      console.error('[PolicyAPI] Error fetching admin policy overview:', err);
      res.status(err.status || 500).json({
        error: err.code || 'INTERNAL_ERROR',
        message: err.message || 'Failed to fetch policy data.',
      });
    }
  }
);

// ─── ۳. ذخیره تغییرات پیش‌نویس (Save Draft) ──────────────────────────────────

policyRouter.put(
  '/admin/policy/draft',
  requireAuth,
  requirePolicyAdminAccess,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { versionId, title, effectiveDate, changelog, sections } = req.body;

      if (!versionId || !title || !Array.isArray(sections)) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'versionId, title, and sections array are required.',
        });
        return;
      }

      const updatedDraft = await saveDraftPolicy({
        versionId: Number(versionId),
        title: String(title).trim(),
        effectiveDate: effectiveDate || null,
        changelog: changelog || null,
        sections,
        actorId: user.discordId,
      });

      res.json({
        success: true,
        message: 'Policy draft saved successfully.',
        draftVersion: updatedDraft,
      });
    } catch (err: any) {
      console.error('[PolicyAPI] Error saving draft policy:', err);
      res.status(err.status || 400).json({
        error: err.code || 'VALIDATION_ERROR',
        message: err.message || 'Failed to save draft policy.',
      });
    }
  }
);

// ─── ۴. انتشار نسخه جدید خط‌مشی (Publish Policy Version) ─────────────────────

policyRouter.post(
  '/admin/policy/publish',
  requireAuth,
  requirePolicyAdminAccess,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { versionId, changelog, acknowledgedDiscrepancies } = req.body;

      if (!versionId) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'versionId is required.' });
        return;
      }

      const published = await publishPolicyVersion({
        versionId: Number(versionId),
        actorId: user.discordId,
        changelog,
        acknowledgedDiscrepancies: Array.isArray(acknowledgedDiscrepancies) ? acknowledgedDiscrepancies : [],
        discordClient: (global as any).discordClient,
      });

      res.json({
        success: true,
        message: `Policy version #${published.versionNumber} published successfully.`,
        publishedVersion: published,
      });
    } catch (err: any) {
      console.error('[PolicyAPI] Error publishing policy version:', err);
      res.status(err.status || 400).json({
        error: err.code || 'PUBLISH_ERROR',
        message: err.message || 'Failed to publish policy version.',
      });
    }
  }
);

// ─── ۵. بازیابی نسخه قبلی به عنوان پیش‌نویس جدید (Restore Version) ───────────

policyRouter.post(
  '/admin/policy/restore',
  requireAuth,
  requirePolicyAdminAccess,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { sourceVersionId } = req.body;

      if (!sourceVersionId) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'sourceVersionId is required.' });
        return;
      }

      const newDraft = await restoreVersionAsDraft({
        sourceVersionId: Number(sourceVersionId),
        actorId: user.discordId,
      });

      res.json({
        success: true,
        message: `Version restored as new Draft v${newDraft.versionNumber}.`,
        newDraftVersion: newDraft,
      });
    } catch (err: any) {
      console.error('[PolicyAPI] Error restoring policy version:', err);
      res.status(err.status || 400).json({
        error: err.code || 'RESTORE_ERROR',
        message: err.message || 'Failed to restore policy version.',
      });
    }
  }
);

// ─── ۶. تاریخچه نسخه‌های خط‌مشی (Version History) ─────────────────────────────

policyRouter.get(
  '/admin/policy/versions',
  requireAuth,
  requirePolicyAdminAccess,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const versions = await listPolicyVersions('community-rules');
      res.json({
        success: true,
        versions,
      });
    } catch (err: any) {
      console.error('[PolicyAPI] Error listing policy versions:', err);
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to list policy versions.' });
    }
  }
);

// ─── ۷. هشدارهای مغایرت خط‌مشی با عملکرد سیستم (Discrepancy Warnings) ───────

policyRouter.get(
  '/admin/policy/discrepancies',
  requireAuth,
  requirePolicyAdminAccess,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const discrepancies = getPolicyDiscrepancyWarnings();
      res.json({
        success: true,
        discrepancies,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to get discrepancy warnings.' });
    }
  }
);

// ─── ۸. تلاش مجدد همگام‌سازی با دیسکورد (Retry Discord Sync) ─────────────────

policyRouter.post(
  '/admin/policy/sync-discord',
  requireAuth,
  requirePolicyAdminAccess,
  requireCsrf,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { versionId } = req.body;

      if (!versionId) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'versionId is required.' });
        return;
      }

      const syncResult = await retryDiscordSync(
        Number(versionId),
        user.discordId,
        (global as any).discordClient
      );

      res.json({
        success: syncResult.success,
        syncResult,
      });
    } catch (err: any) {
      console.error('[PolicyAPI] Error retrying Discord sync:', err);
      res.status(err.status || 400).json({
        error: err.code || 'SYNC_ERROR',
        message: err.message || 'Failed to retry Discord sync.',
      });
    }
  }
);
