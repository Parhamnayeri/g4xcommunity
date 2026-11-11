/**
 * src/beta/betaApp.ts
 *
 * Dedicated Express Application Factory for G4X Operational Closed Beta v0.001.
 *
 * Isolation & Auth Design:
 *  - Completely separate from `stagingApp.ts` (never mounts `stagingAuthRouter` synthetic bypass).
 *  - Uses isolated session cookie `'g4x_beta.sid'` backed by `PrismaSessionStore(prisma)`.
 *  - Enforces strict invite-only access on Discord OAuth2 callbacks AND active sessions via
 *    `BETA_INVITE_ALLOWLIST_IDS` / `OWNER_DISCORD_ID`.
 *  - Preserves all existing G4X routes, RBAC checks, ADV, Exchanger, NowPayments (locked disabled),
 *    and Owner approval controls while serving React SPA + `/legacy`.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import express, { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import prisma from '../database/db';
import { PrismaSessionStore } from '../web/sessionStore';
import { router } from '../web/routes';
import { ensureCsrfToken } from '../web/middleware/auth';

const DISCORD_API = 'https://discord.com/api/v10';

export interface BetaAppOptions {
  inviteAllowlistIds: string[];
  sessionSecret?: string;
  cookieSecure?: boolean;
  oauthHttpClient?: {
    post: typeof axios.post;
    get: typeof axios.get;
  };
}

export function createBetaApp(options: BetaAppOptions): Express {
  const inviteAllowlistSet = new Set(
    (options.inviteAllowlistIds || []).map((id) => id.trim()).filter(Boolean)
  );
  if (inviteAllowlistSet.size === 0) {
    throw new Error('[BetaApp] Cannot start without at least one Discord ID in inviteAllowlistIds.');
  }

  const secret =
    options.sessionSecret ||
    process.env.SESSION_SECRET ||
    '';
  if (!secret || secret.trim().length < 24) {
    throw new Error('[BetaApp] SESSION_SECRET must be >= 24 characters.');
  }

  const httpClient = options.oauthHttpClient || axios;
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('X-G4X-Environment', 'operational-beta-v0.001');
    next();
  });

  const sessionStore = new PrismaSessionStore(prisma);
  const cookieSecure =
    options.cookieSecure ??
    (process.env.COOKIE_SECURE === 'true');

  app.use(
    session({
      name: 'g4x_beta.sid',
      secret,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  app.use(ensureCsrfToken);

  // Safe non-secret operational beta health check
  app.get(['/api/beta/health', '/beta/health'], (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      mode: 'operational-beta',
      version: 'v0.001',
      liveFinanceGatesLocked: true,
    });
  });

  // Strict invite-only gate across any active session before dispatching API/routes
  app.use((req: Request, res: Response, next: NextFunction) => {
    const sessionUserId = req.session?.userId;
    if (!sessionUserId) {
      return next();
    }

    if (req.path === '/auth/logout' || req.path === '/api/auth/logout') {
      return next();
    }

    if (!inviteAllowlistSet.has(sessionUserId)) {
      req.session.destroy(() => {
        res.clearCookie('g4x_beta.sid');
        res.status(403).json({
          error: 'CLOSED_BETA_INVITE_REQUIRED',
          message: 'Access restricted to invited closed-beta participants.',
        });
      });
      return;
    }

    next();
  });

  // Guarded Invite-Only Discord OAuth2 callback (runs BEFORE shared router)
  app.get(['/auth/callback', '/api/auth/callback'], async (req: Request, res: Response): Promise<void> => {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing or invalid authorization code' });
      return;
    }

    if (!state || typeof state !== 'string') {
      res.status(403).json({ error: 'Missing OAuth state parameter' });
      return;
    }

    const sessionState = req.session?.oauthState;
    const stateExpires = req.session?.oauthStateExpires;

    if (!sessionState || sessionState !== state) {
      res.status(403).json({ error: 'Invalid or mismatched OAuth state' });
      return;
    }

    if (stateExpires && Date.now() > stateExpires) {
      res.status(403).json({ error: 'OAuth state parameter has expired' });
      return;
    }

    delete req.session.oauthState;
    delete req.session.oauthStateExpires;

    try {
      const tokenRes = await httpClient.post(
        `${DISCORD_API}/oauth2/token`,
        new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID ?? '',
          client_secret: process.env.DISCORD_CLIENT_SECRET ?? '',
          grant_type: 'authorization_code',
          code,
          redirect_uri: process.env.DISCORD_REDIRECT_URI ?? '',
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const { access_token } = tokenRes.data as { access_token: string };
      const userRes = await httpClient.get(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const discordUser = userRes.data as {
        id: string;
        username: string;
        global_name?: string;
      };

      // Reject uninvited Discord users BEFORE touching database User/Wallet or creating a session
      if (!inviteAllowlistSet.has(discordUser.id)) {
        try {
          await prisma.auditLog.create({
            data: {
              actorId: null,
              action: 'BETA_INVITE_DENIED',
              entityType: 'AuthSession',
              entityId: discordUser.id,
              newValues: JSON.stringify({
                rejectedDiscordId: discordUser.id,
                username: discordUser.username,
              }),
              reason: 'Uninvited Discord user attempted Closed Beta OAuth login',
              isSuccess: false,
            },
          });
        } catch {
          // Non-fatal if audit log write cannot complete
        }

        res.status(403).json({
          error: 'CLOSED_BETA_INVITE_REQUIRED',
          message: 'Your Discord account is not on the invite list for G4X Closed Beta v0.001.',
        });
        return;
      }

      const existing = await prisma.user.findUnique({
        where: { discordId: discordUser.id },
        select: { isActive: true },
      });

      if (existing && existing.isActive === false) {
        res.status(403).json({
          error: 'ACCOUNT_DISABLED',
          message: 'This beta account has been deactivated.',
        });
        return;
      }

      await prisma.user.upsert({
        where: { discordId: discordUser.id },
        update: {
          username: discordUser.username,
          displayName: discordUser.global_name ?? discordUser.username,
        },
        create: {
          discordId: discordUser.id,
          username: discordUser.username,
          displayName: discordUser.global_name ?? discordUser.username,
        },
      });

      await prisma.wallet.upsert({
        where: { userId: discordUser.id },
        update: {},
        create: { userId: discordUser.id },
      });

      req.session.regenerate((err) => {
        if (err) {
          console.error('[BetaAuth] Session regeneration error:', err);
          res.status(500).json({ error: 'Session creation failed' });
          return;
        }

        req.session.userId = discordUser.id;
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');

        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('[BetaAuth] Session save error after regeneration:', saveErr);
            res.status(500).json({ error: 'Failed to finalize login' });
            return;
          }

          res.redirect('/');
        });
      });
    } catch (error) {
      console.error('[BetaAuth] OAuth callback authentication error:', error);
      res.status(500).json({ error: 'Discord authentication failed' });
    }
  });

  // Static frontend assets
  const frontendDist = path.join(process.cwd(), 'frontend', 'dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
  }
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.get(['/legacy', '/legacy/*'], (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'legacy.html'));
  });

  app.use('/api', router);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  function sendReactEntry(_req: Request, res: Response): void {
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

  app.use('/', router);

  app.get('*', (req, res, next) => {
    if (
      /^\/(api|auth)(\/|$)/i.test(req.path) ||
      req.path.toLowerCase().startsWith('/ownergate')
    ) {
      return next();
    }
    sendReactEntry(req, res);
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[BetaWeb] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
