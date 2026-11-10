/**
 * src/web/staging/stagingAuthRouter.ts
 *
 * Dedicated Isolated Staging Synthetic Authentication Router.
 *
 * SECURITY INVARIANTS:
 *  1. NEVER imported or registered by production router (src/web/routes.ts or src/web/server.ts).
 *  2. Strictly requires loopback peer execution (req.socket.remoteAddress must be 127.0.0.1 or ::1).
 *     Rejects all remote peers with 403 Forbidden. NEVER trusts Host or X-Forwarded-For headers.
 *  3. Requires STAGING_MODE === 'true'.
 *  4. Evaluates database isolation at runtime; refuses to operate against non-staging databases.
 *  5. Restricts authentication to an explicit allowlist of seeded synthetic identities (range 999999999999990001 - 999999999999990010).
 *     Production user IDs, arbitrary Discord snowflakes, or unseeded roles are strictly rejected (403/400).
 *  6. Employs session regeneration and dedicated CSRF generation.
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../../database/db';
import { findPrismaSchemaDir } from '../../database/canonicalDbPath';
import path from 'path';
import fs from 'fs';
import { ALLOWED_SYNTHETIC_IDS, SYNTHETIC_ROLE_MAP } from './syntheticUsers';

export { ALLOWED_SYNTHETIC_IDS, SYNTHETIC_ROLE_MAP };

export const stagingAuthRouter = Router();

export function isLoopbackPeer(req: Request): boolean {
  const remoteIp = (req.socket?.remoteAddress || (req.connection as any)?.remoteAddress || '').trim();
  return (
    remoteIp === '127.0.0.1' ||
    remoteIp === '::1' ||
    remoteIp === '::ffff:127.0.0.1'
  );
}

export function verifyStagingDatabaseTarget(): { valid: boolean; reason?: string } {
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl) {
    return { valid: false, reason: 'DATABASE_URL not configured' };
  }

  try {
    let rawPath = dbUrl.startsWith('file:') ? dbUrl.slice(5) : dbUrl;
    const schemaDir = findPrismaSchemaDir();
    const stagingDir = path.resolve(schemaDir, 'staging');

    let resolvedTarget = path.isAbsolute(rawPath)
      ? path.normalize(rawPath)
      : path.normalize(path.resolve(schemaDir, rawPath));

    const baseFilename = path.basename(resolvedTarget).toLowerCase();
    if (
      baseFilename === 'g4x.db' ||
      baseFilename === 'g4x_dev.db' ||
      baseFilename === 'dev.db' ||
      baseFilename.includes('production')
    ) {
      return { valid: false, reason: `Targeting forbidden production/dev database '${baseFilename}'` };
    }

    let canonicalStagingDir = stagingDir;
    if (fs.existsSync(stagingDir)) {
      canonicalStagingDir = fs.realpathSync(stagingDir);
    }

    let canonicalTarget = resolvedTarget;
    if (fs.existsSync(resolvedTarget)) {
      canonicalTarget = fs.realpathSync(resolvedTarget);
    } else {
      const parentDir = path.dirname(resolvedTarget);
      if (fs.existsSync(parentDir)) {
        canonicalTarget = path.join(fs.realpathSync(parentDir), path.basename(resolvedTarget));
      }
    }

    const requiredPrefix = canonicalStagingDir.toLowerCase() + path.sep;
    if (!canonicalTarget.toLowerCase().startsWith(requiredPrefix)) {
      return { valid: false, reason: `Database not confined to ${canonicalStagingDir}` };
    }

    return { valid: true };
  } catch (err: any) {
    return { valid: false, reason: err.message };
  }
}

// ─── Middleware: Loopback Verification ──────────────────────────────────────────
stagingAuthRouter.use((req: Request, res: Response, next) => {
  // Reject remote non-loopback calls immediately
  if (!isLoopbackPeer(req)) {
    res.status(403).json({
      error: 'FORBIDDEN_REMOTE_ACCESS',
      message: 'Staging synthetic authentication is only accessible via local loopback (127.0.0.1 / ::1).',
    });
    return;
  }
  next();
});

// ─── POST /staging-login (Mounted under /api/auth or /auth) ─────────────────────
stagingAuthRouter.post('/staging-login', async (req: Request, res: Response): Promise<void> => {
  // 1. Verify STAGING_MODE
  if (process.env.STAGING_MODE !== 'true') {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }

  // 2. Verify Database Isolation
  const dbCheck = verifyStagingDatabaseTarget();
  if (!dbCheck.valid) {
    res.status(500).json({
      error: 'STAGING_DATABASE_MISCONFIGURED',
      message: `Refusing to execute staging login: ${dbCheck.reason}`,
    });
    return;
  }

  const { userId, role } = req.body;
  if (!userId && !role) {
    res.status(400).json({ error: 'Missing userId or role parameter' });
    return;
  }

  // 3. Resolve and Enforce Strict Synthetic Allowlist
  let targetDiscordId: string;

  if (userId) {
    const rawId = String(userId).trim();
    if (!ALLOWED_SYNTHETIC_IDS.has(rawId)) {
      res.status(403).json({
        error: 'FORBIDDEN_SYNTHETIC_IDENTITY',
        message: `ID '${rawId}' is not an authorized synthetic test identity. Production IDs are strictly rejected.`,
      });
      return;
    }
    targetDiscordId = rawId;
  } else {
    const normalizedRole = String(role).trim().toLowerCase();
    const mappedId = SYNTHETIC_ROLE_MAP[normalizedRole];
    if (!mappedId) {
      res.status(400).json({
        error: 'INVALID_SYNTHETIC_ROLE',
        message: `Role '${role}' is not a valid synthetic role identifier.`,
      });
      return;
    }
    targetDiscordId = mappedId;
  }

  // 4. Authenticate Against Staging Database
  try {
    const targetUser = await prisma.user.findUnique({
      where: { discordId: targetDiscordId },
      include: { userRoles: true },
    });

    if (!targetUser || !targetUser.isActive) {
      res.status(404).json({ error: 'Synthetic user not found or inactive in staging database' });
      return;
    }

    req.session.regenerate((err) => {
      if (err) {
        console.error('[StagingLogin] Session regeneration error:', err);
        res.status(500).json({ error: 'Session creation failed' });
        return;
      }

      req.session.userId = targetUser.discordId;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[StagingLogin] Session save error:', saveErr);
          res.status(500).json({ error: 'Failed to finalize staging login' });
          return;
        }

        res.json({
          success: true,
          user: {
            discordId: targetUser.discordId,
            username: targetUser.username,
            displayName: targetUser.displayName,
            roles: targetUser.userRoles.map((r: any) => r.roleKey),
          },
          csrfToken: req.session.csrfToken,
        });
      });
    });
  } catch (err: any) {
    console.error('[StagingLogin] Error during synthetic login:', err);
    res.status(500).json({ error: 'Internal server error during staging login' });
  }
});
