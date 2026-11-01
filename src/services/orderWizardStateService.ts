/**
 * orderWizardStateService.ts — Secure, Restart-Safe Wizard Session Management
 *
 * Implements:
 *  1. Ephemeral wizard state binding to initiating user, guild, and origin (G4X vs. Advertiser).
 *  2. Short-lived 15-minute TTL with automatic pruning.
 *  3. File-backed write-through cache (data/wizard_sessions.json) for restart recovery.
 *  4. Strict cross-user and forged interaction rejection.
 *  5. Double-click and duplicate submission prevention.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type WizardOrigin = 'g4x' | 'adv';
export type WizardStep = 'platform' | 'game' | 'service' | 'mode' | 'modal' | 'submitted';

export interface OrderWizardSession {
  sessionId: string;
  userId: string;
  guildId: string | null;
  origin: WizardOrigin;
  platform?: 'g2g' | 'skycoach' | 'eldorado';
  platformAccountId?: number;
  platformAccountRef?: string;
  gameSlug?: string;
  gameName?: string;
  serviceId?: number;
  serviceKey?: string;
  serviceName?: string;
  serviceMode?: 'pilot' | 'non_pilot';
  orderMode?: 'pilot' | 'non_pilot';
  prefilterPanel?: 'mythic' | 'non_pilot' | 'pilot';
  step: WizardStep;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DATA_DIR = path.join(process.cwd(), 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'wizard_sessions.json');

// In-memory cache
const memorySessions = new Map<string, OrderWizardSession>();

// Initialize and load persisted sessions on startup
export function initWizardSessions(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
      const parsed: Record<string, OrderWizardSession> = JSON.parse(raw);
      const now = Date.now();
      for (const [id, session] of Object.entries(parsed)) {
        if (session.expiresAt > now && session.step !== 'submitted') {
          memorySessions.set(id, session);
        }
      }
    }
  } catch (err) {
    console.error('[OrderWizardState] Error loading persisted sessions:', err);
  }
}

// Flush active unexpired sessions to disk
function persistSessionsToDisk(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const now = Date.now();
    const activeObj: Record<string, OrderWizardSession> = {};
    for (const [id, session] of memorySessions.entries()) {
      if (session.expiresAt > now && session.step !== 'submitted') {
        activeObj[id] = session;
      }
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(activeObj, null, 2), 'utf-8');
  } catch (err) {
    console.error('[OrderWizardState] Error persisting sessions to disk:', err);
  }
}

// Prune expired sessions
export function pruneExpiredSessions(): void {
  const now = Date.now();
  let changed = false;
  for (const [id, session] of memorySessions.entries()) {
    if (session.expiresAt <= now) {
      memorySessions.delete(id);
      changed = true;
    }
  }
  if (changed) {
    persistSessionsToDisk();
  }
}

// Initialize on module load
initWizardSessions();

/**
 * Creates a new secure wizard session bound to the user, guild, and origin.
 */
export async function createWizardSession(input: {
  userId: string;
  guildId: string | null;
  origin: WizardOrigin;
  prefilterPanel?: 'mythic' | 'non_pilot' | 'pilot';
}): Promise<OrderWizardSession> {
  pruneExpiredSessions();

  const sessionId = crypto.randomBytes(8).toString('hex');
  const now = Date.now();

  const session: OrderWizardSession = {
    sessionId,
    userId: input.userId,
    guildId: input.guildId,
    origin: input.origin,
    prefilterPanel: input.prefilterPanel,
    step: input.origin === 'g4x' ? 'platform' : 'game',
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };

  memorySessions.set(sessionId, session);
  persistSessionsToDisk();
  return session;
}

/**
 * Retrieves a wizard session by ID without validation.
 */
export async function getWizardSession(sessionId: string): Promise<OrderWizardSession | null> {
  const session = memorySessions.get(sessionId);
  if (!session) {
    // Attempt reload from disk in case another process/instance wrote it
    initWizardSessions();
    return memorySessions.get(sessionId) || null;
  }
  if (Date.now() > session.expiresAt) {
    memorySessions.delete(sessionId);
    persistSessionsToDisk();
    return null;
  }
  return session;
}

/**
 * Updates an active wizard session.
 */
export async function updateWizardSession(
  sessionId: string,
  updates: Partial<OrderWizardSession>
): Promise<OrderWizardSession> {
  const session = await getWizardSession(sessionId);
  if (!session) {
    throw new Error('WIZARD_SESSION_EXPIRED: The order creation wizard session has expired.');
  }

  const updated: OrderWizardSession = {
    ...session,
    ...updates,
    sessionId: session.sessionId, // immutable
    userId: session.userId,       // immutable
    origin: session.origin,       // immutable
    expiresAt: updates.expiresAt !== undefined ? updates.expiresAt : (Date.now() + SESSION_TTL_MS), // refresh TTL on active interaction unless explicitly overridden
  };

  memorySessions.set(sessionId, updated);
  persistSessionsToDisk();
  return updated;
}

/**
 * Validates session existence, TTL, user ownership, guild binding, and double-submit protection.
 */
export async function validateWizardSession(
  sessionId: string,
  actor: { id: string },
  guildId?: string | null
): Promise<OrderWizardSession> {
  const session = await getWizardSession(sessionId);

  if (!session) {
    throw new Error(
      'EXPIRED_OR_INVALID_SESSION: This order wizard session has expired or does not exist. Please click Create Order again.'
    );
  }

  if (Date.now() > session.expiresAt) {
    memorySessions.delete(sessionId);
    persistSessionsToDisk();
    throw new Error(
      'EXPIRED_SESSION: This order wizard session has expired (sessions last 15 minutes). Please click Create Order again.'
    );
  }

  // Cross-user interaction security check
  if (session.userId !== actor.id) {
    throw new Error(
      'UNAUTHORIZED_USER: You cannot interact with an order creation wizard initiated by another user.'
    );
  }

  // Guild binding check
  if (session.guildId && guildId && session.guildId !== guildId) {
    throw new Error(
      'GUILD_MISMATCH: This wizard session was created in a different Discord server.'
    );
  }

  // Double submission check
  if (session.step === 'submitted') {
    throw new Error(
      'DUPLICATE_SUBMISSION: This order has already been submitted and is being processed.'
    );
  }

  return session;
}

/**
 * Marks session as submitted (CAS) to prevent duplicate submissions on double-clicks.
 */
export async function markWizardSubmitted(sessionId: string): Promise<void> {
  const session = await getWizardSession(sessionId);
  if (session) {
    session.step = 'submitted';
    memorySessions.set(sessionId, session);
    persistSessionsToDisk();
  }
}

/**
 * Deletes a session upon cancellation or cleanup.
 */
export async function deleteWizardSession(sessionId: string): Promise<void> {
  memorySessions.delete(sessionId);
  persistSessionsToDisk();
}

/**
 * Exposes internal memory map for test introspection.
 */
export function _getInternalMemorySessions(): Map<string, OrderWizardSession> {
  return memorySessions;
}
