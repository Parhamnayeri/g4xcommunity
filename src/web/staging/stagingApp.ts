/**
 * src/web/staging/stagingApp.ts
 *
 * Dedicated Isolated Staging Express Application Factory.
 *
 * ISOLATION GUARANTEES:
 *  1. Completely segregated from production server setup (src/web/server.ts).
 *  2. Evaluates validateStagingEnvironment() on creation; fails closed immediately if invalid.
 *  3. Uses separate, isolated session cookie name: 'g4x_staging.sid'.
 *     Staging session cookies are never accepted by production (which expects 'g4x.sid').
 *  4. Dedicated stagingAuthRouter is mounted only here (never registered in production).
 *  5. Mounts production API router (src/web/routes.ts) which has zero knowledge of synthetic auth.
 */

import express from 'express';
import session from 'express-session';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import prisma from '../../database/db';
import { PrismaSessionStore } from '../sessionStore';
import { router } from '../routes';
import { ensureCsrfToken } from '../middleware/auth';
import { stagingAuthRouter } from './stagingAuthRouter';
import { validateStagingEnvironment } from './validateStagingEnv';

export function createStagingApp(): express.Application {
  const envValidation = validateStagingEnvironment();
  if (!envValidation.valid) {
    throw new Error(
      `[CRITICAL SECURITY ERROR] Cannot initialize staging app — invalid staging environment:\n${envValidation.errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }

  const app = express();

  // Basic security headers
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  // Staging Session Configuration (Dedicated Cookie name 'g4x_staging.sid')
  const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const sessionStore = new PrismaSessionStore(prisma);

  app.use(
    session({
      name: 'g4x_staging.sid',
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        secure: false, // Staging runs over HTTP on local loopback
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    })
  );

  app.use(ensureCsrfToken);

  // Static files
  const frontendDist = path.join(process.cwd(), 'frontend', 'dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
  }
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.get(['/legacy', '/legacy/*'], (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'legacy.html'));
  });

  // Mount dedicated staging authentication router ONLY on staging app
  app.use('/api/auth', stagingAuthRouter);
  app.use('/auth', stagingAuthRouter);

  // Mount standard API routes
  app.use('/api', router);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  function sendReactEntry(_req: express.Request, res: express.Response): void {
    const frontendIndex = path.join(frontendDist, 'index.html');
    res.sendFile(fs.existsSync(frontendIndex) ? frontendIndex : path.join(process.cwd(), 'public', 'index.html'));
  }

  const reactPages = [
    '/', '/rules', '/privacy', '/discord-commands', '/dashboard', '/wallet', '/withdraw', '/profile',
    '/booster/settings', '/settings', '/advertiser', '/exchange', '/exchanger',
    '/orders', '/staff', '/management', '/management/orders', '/management/kyc',
    '/admin', '/management/applications', '/admin/applications', '/admin/games',
    '/admin/discord', '/admin/orders', '/owner', '/owner/orders', '/owner/finance',
    '/owner/games', '/owner/discord', '/owner/users', '/owner/website',
  ];
  app.get(reactPages, (req, res, next) => {
    if (!req.accepts('html')) return next();
    sendReactEntry(req, res);
  });

  // Root aliases for OAuth callback compatibility
  app.use('/', router);

  // SPA fallback
  app.get('*', (req, res, next) => {
    if (
      /^\/(api|auth)(\/|$)/i.test(req.path) ||
      req.path.toLowerCase().startsWith('/ownergate')
    ) {
      return next();
    }
    sendReactEntry(req, res);
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[StagingWeb] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
