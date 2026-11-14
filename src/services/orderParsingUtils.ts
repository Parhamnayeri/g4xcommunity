/**
 * orderParsingUtils.ts — Utilities for parsing external order references and cleaning order notes.
 *
 * Supports auto-extracting <#ORDERID> tags from order notes across Web and Discord interfaces.
 */

export interface ParsedNotesAndOrderId {
  externalOrderId: string | null;
  cleanNotes: string | null;
}

/**
 * Parses raw notes to extract an external Order ID embedded as <#ORDERID> (e.g. <#JC100>, <#ord-9923>).
 * Strips the <#...> tag from notes, preserving remaining text cleanly.
 * If an explicit externalOrderId is provided, it takes precedence as the order ID, but any
 * embedded <#...> tag in notes is still cleanly removed.
 */
export function extractExternalOrderIdAndCleanNotes(
  rawNotes?: string | null,
  explicitOrderId?: string | null
): ParsedNotesAndOrderId {
  const trimmedExplicit = explicitOrderId ? explicitOrderId.trim() : '';
  let foundOrderId: string | null = null;
  let cleanNotes: string | null = null;

  if (rawNotes && typeof rawNotes === 'string') {
    const match = rawNotes.match(/<#([^>]+)>/);
    if (match) {
      foundOrderId = match[1].trim();
      const stripped = rawNotes.replace(/<#[^>]+>/g, '').replace(/[ \t]+/g, ' ').trim();
      cleanNotes = stripped.length > 0 ? stripped : null;
    } else {
      const trimmed = rawNotes.trim();
      cleanNotes = trimmed.length > 0 ? trimmed : null;
    }
  }

  const effectiveOrderId = trimmedExplicit.length > 0 ? trimmedExplicit : (foundOrderId || null);

  return {
    externalOrderId: effectiveOrderId,
    cleanNotes,
  };
}

/**
 * Platforms subject to the 13% platform deduction rule.
 */
export const THIRTEEN_PERCENT_FEE_PLATFORMS = ['skycoach', 'kingboost', 'overgear'] as const;

export function has13PercentFee(platform: string): boolean {
  return THIRTEEN_PERCENT_FEE_PLATFORMS.includes(platform.toLowerCase() as any);
}

/**
 * Calculates net available amount and platform fee for 13% fee platforms.
 */
export function calculate13PercentSplit(grossAmount: number): {
  platformFee: number;
  netAvailable: number;
} {
  if (grossAmount <= 0 || isNaN(grossAmount)) {
    return { platformFee: 0, netAvailable: 0 };
  }
  const grossCents = Math.round(grossAmount * 100);
  const platformFeeCents = Math.round(grossCents * 0.13);
  const netAvailableCents = grossCents - platformFeeCents;
  return {
    platformFee: platformFeeCents / 100,
    netAvailable: netAvailableCents / 100,
  };
}
