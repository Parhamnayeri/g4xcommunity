/**
 * auth.ts — میدل‌ویرهای متمرکز احراز هویت، کنترل دسترسی رول‌ها و حفاظت CSRF
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../../database/db';
import { User, UserRole } from '@prisma/client';

export type AuthenticatedUser = User & {
  userRoles: UserRole[];
};

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    oauthState?: string;
    oauthStateExpires?: number;
    csrfToken?: string;
  }
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

/**
 * اطمینان از وجود CSRF Token در نشست
 */
export function ensureCsrfToken(req: Request, _res: Response, next: NextFunction): void {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  next();
}

/**
 * میدل‌ویر اصلی احراز هویت مبتنی بر Session سرور
 * هرگز به x-discord-id، body یا query اعتماد نمی‌کند.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;

  if (!userId) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication session required',
    });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { discordId: userId },
      include: {
        userRoles: true,
      },
    });

    if (!user || !user.isActive) {
      if (req.session) {
        req.session.destroy(() => {});
      }
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Account not found or inactive',
      });
      return;
    }

    (req as AuthenticatedRequest).user = user;
    next();
  } catch (error) {
    console.error('[AuthMiddleware] Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
}

/**
 * گارد دسترسی بر مبنای رول‌های سیستم (RBAC)
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    const userRoleKeys = user.userRoles.map((r) => r.roleKey);
    const hasRole = allowedRoles.some((role) => userRoleKeys.includes(role));

    if (!hasRole) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient role permissions',
      });
      return;
    }

    next();
  };
}

/**
 * محافظت ضد CSRF برای متدهای تغییردهنده وضعیت (POST, PUT, DELETE, PATCH)
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // ۱. بررسی هدر Origin / Referer در صورت وجود
  const origin = req.headers.origin || req.headers.referer;
  const webBaseUrl = process.env.WEB_BASE_URL;

  if (origin && webBaseUrl) {
    try {
      const originHost = new URL(origin).host;
      const baseHost = new URL(webBaseUrl).host;
      if (originHost !== baseHost && originHost !== req.headers.host) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Cross-origin request rejected',
        });
        return;
      }
    } catch {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid origin header',
      });
      return;
    }
  }

  // ۲. بررسی توکن ضد CSRF
  const sessionCsrf = req.session?.csrfToken;
  const headerCsrf = req.headers['x-csrf-token'] as string;
  const bodyCsrf = (req.body && (req.body._csrf || req.body.csrfToken)) as string | undefined;
  const clientCsrf = headerCsrf || bodyCsrf;

  if (!sessionCsrf || !clientCsrf || sessionCsrf !== clientCsrf) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid or missing CSRF token',
    });
    return;
  }

  next();
}
