/**
 * orderParsers.ts — Frontend utilities for parsing external order references and fee previews.
 */

export interface ParsedNotesAndOrderId {
  externalOrderId: string | null;
  title: string | null;
  cleanNotes: string | null;
}

/**
 * Extracts external Order ID embedded as <#ORDERID> and Title embedded as <t="..."> in notes and cleans the notes string.
 */
export function extractExternalOrderIdAndCleanNotes(
  rawNotes?: string | null,
  explicitOrderId?: string | null,
  explicitTitle?: string | null
): ParsedNotesAndOrderId {
  const trimmedExplicitOrder = explicitOrderId ? explicitOrderId.trim() : '';
  const trimmedExplicitTitle = explicitTitle ? explicitTitle.trim() : '';
  let foundOrderId: string | null = null;
  let foundTitle: string | null = null;
  let cleanNotes: string | null = null;

  if (rawNotes && typeof rawNotes === 'string') {
    let working = rawNotes;

    // 1. Extract <t="Title"> or <t='Title'> or <t=Title>
    const titleMatch = working.match(/<t=(?:"([^"]*)"|'([^']*)'|([^>]+))>/i);
    if (titleMatch) {
      foundTitle = (titleMatch[1] || titleMatch[2] || titleMatch[3] || '').trim();
      working = working.replace(/<t=(?:"[^"]*"|'[^']*'|[^>]+)>/gi, '');
    }

    // 2. Extract <#ORDERID>
    const orderMatch = working.match(/<#([^>]+)>/);
    if (orderMatch) {
      foundOrderId = orderMatch[1].trim();
      working = working.replace(/<#[^>]+>/g, '');
    }

    const stripped = working.replace(/[ \t]+/g, ' ').trim();
    cleanNotes = stripped.length > 0 ? stripped : null;
  }

  const effectiveOrderId = trimmedExplicitOrder.length > 0 ? trimmedExplicitOrder : (foundOrderId || null);
  const effectiveTitle = trimmedExplicitTitle.length > 0 ? trimmedExplicitTitle : (foundTitle || null);

  return {
    externalOrderId: effectiveOrderId,
    title: effectiveTitle,
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
