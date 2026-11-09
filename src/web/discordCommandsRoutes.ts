/**
 * src/web/discordCommandsRoutes.ts — Private Role-Based Discord Commands API Routes
 *
 * G4X Community — Task 7: Private Role-Based Discord Commands Guide
 *
 * Security & Access Rules:
 *  - Authentication required: 401 Unauthorized for unauthenticated visitors.
 *  - Role-gated: Only visible to and accessible by users holding at least one approved
 *    operational or administrative role: Advertiser, Exchanger, Staff, Management, Admin, Owner.
 *  - Boosters/Pilots who do NOT hold any authorized role are strictly denied (403 Forbidden).
 *  - Server-authoritative: Commands are filtered server-side against the caller's active roles.
 *  - No secret command documentation is leaked in the public response.
 *  - Supports multi-role unions (e.g. Booster + Staff, Advertiser + Staff).
 */

import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from './middleware/auth';
import {
  getPermittedCommandsForRoles,
  DiscordCommandItem,
  CategoryMetadata,
} from '../services/discordCommandRegistry';

export const discordCommandsRouter = Router();

/**
 * GET /api/discord-commands
 * Returns the list of Discord commands and interactive workflows permitted for the caller's session.
 */
discordCommandsRouter.get(
  '/discord-commands',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as AuthenticatedRequest).user;

      if (!user || !user.isActive) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'An active authenticated session is required to access the Discord Commands Guide.',
        });
        return;
      }

      const roleKeys = (user.userRoles || []).map((r) => r.roleKey as string);

      // Evaluate server-side role permissions
      const permittedResult = getPermittedCommandsForRoles(roleKeys);

      if (!permittedResult) {
        res.status(403).json({
          error: 'FORBIDDEN_BOOSTER_RESTRICTED',
          message:
            'Access restricted: The Discord Bot Commands Guide is reserved for operational and administrative roles (Advertiser, Exchanger, Staff, Management, Admin, and Owner). Booster-only accounts are not authorized to view this documentation.',
          userRoles: roleKeys,
        });
        return;
      }

      const { commands, categories } = permittedResult;

      // Optional server-side filtering via query params
      const categoryFilter = typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : null;
      const searchQuery = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : null;
      const typeFilter = typeof req.query.type === 'string' ? req.query.type.trim().toLowerCase() : null;

      let filteredCommands = commands;

      if (categoryFilter && categoryFilter !== 'all') {
        filteredCommands = filteredCommands.filter((c) => c.category === categoryFilter);
      }

      if (typeFilter && typeFilter !== 'all') {
        filteredCommands = filteredCommands.filter((c) => c.type === typeFilter);
      }

      if (searchQuery) {
        filteredCommands = filteredCommands.filter((c) => {
          const matchName = c.name.toLowerCase().includes(searchQuery);
          const matchSyntax = c.syntax.toLowerCase().includes(searchQuery);
          const matchSummary = c.summary.toLowerCase().includes(searchQuery);
          const matchDesc = c.description.toLowerCase().includes(searchQuery);
          const matchParam = c.parameters.some((p) =>
            p.name.toLowerCase().includes(searchQuery) || p.description.toLowerCase().includes(searchQuery)
          );
          const matchEx = c.examples.some((ex) =>
            ex.command.toLowerCase().includes(searchQuery) || ex.description.toLowerCase().includes(searchQuery)
          );
          return matchName || matchSyntax || matchSummary || matchDesc || matchParam || matchEx;
        });
      }

      res.json({
        success: true,
        userRoles: roleKeys,
        categories,
        totalPermitted: commands.length,
        commands: filteredCommands,
        meta: {
          isOwner: roleKeys.includes('owner'),
          isAdmin: roleKeys.includes('admin'),
          isManager: roleKeys.includes('manager'),
          isStaff: roleKeys.includes('staff'),
          isAdvertiser: roleKeys.includes('advertiser'),
          isExchanger: roleKeys.includes('exchanger'),
        },
      });
    } catch (err: any) {
      console.error('[DiscordCommandsAPI] Error retrieving commands:', err);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to retrieve Discord commands catalog.',
      });
    }
  }
);
