/**
 * orderParsers.ts — Frontend utilities for parsing external order references and fee previews.
 */

export interface ParsedNotesAndOrderId {
  externalOrderId: string | null;
  cleanNotes: string | null;
}

/**
 * Extracts external Order ID embedded as <#ORDERID> in notes and cleans the notes string.
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
  const feeCents = Math.round(grossCents * 0.13);
  const netCents = grossCents - feeCents;
  return {
    platformFee: feeCents / 100,
    netAvailable: netCents / 100,
  };
}
