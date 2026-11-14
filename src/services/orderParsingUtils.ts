/**
 * orderParsingUtils.ts — Utilities for parsing external order references and cleaning order notes.
 *
 * Supports auto-extracting <#ORDERID> tags from order notes across Web and Discord interfaces.
 */

export interface ParsedNotesAndOrderId {
  externalOrderId: string | null;
  cleanNotes: string | null;
  title: string | null;
}

/**
 * Parses raw notes to extract:
 * 1. An external Order ID embedded as <#ORDERID> (e.g. <#JC100>, <#ord-9923>).
 * 2. An Order Title embedded as <t="Title"> (tolerating double quotes, single quotes, or unquoted: <t='...'>, <t=...>).
 * Strips both <#...> and <t=...> tags from notes, preserving remaining text cleanly.
 * If explicit parameters are provided, they take precedence, while tags are still cleanly stripped.
 */
export function extractExternalOrderIdAndCleanNotes(
  rawNotes?: string | null,
  explicitOrderId?: string | null,
  explicitTitle?: string | null
): ParsedNotesAndOrderId {
  const trimmedExplicitOrderId = explicitOrderId ? explicitOrderId.trim() : '';
  const trimmedExplicitTitle = explicitTitle ? explicitTitle.trim() : '';

  let foundOrderId: string | null = null;
  let foundTitle: string | null = null;
  let cleanNotes: string | null = null;

  if (rawNotes && typeof rawNotes === 'string') {
    // 1. Extract <t="..."> title
    const titleMatch = rawNotes.match(/<t=(?:"([^"]*)"|'([^']*)'|([^>]+))>/i);
    if (titleMatch) {
      const extractedTitle = (titleMatch[1] ?? titleMatch[2] ?? titleMatch[3] ?? '').trim();
      if (extractedTitle.length > 0) {
        foundTitle = extractedTitle;
      }
    }

    // 2. Extract <#ORDERID> external order ID
    const orderIdMatch = rawNotes.match(/<#([^>]+)>/);
    if (orderIdMatch) {
      const extractedId = orderIdMatch[1].trim();
      if (extractedId.length > 0) {
        foundOrderId = extractedId;
      }
    }

    // 3. Clean notes by stripping both tags
    const stripped = rawNotes
      .replace(/<t=(?:"[^"]*"|'[^']*'|[^>]+)>/gi, '')
      .replace(/<#[^>]+>/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim();

    cleanNotes = stripped.length > 0 ? stripped : null;
  }

  const effectiveOrderId = trimmedExplicitOrderId.length > 0 ? trimmedExplicitOrderId : (foundOrderId || null);
  const effectiveTitle = trimmedExplicitTitle.length > 0 ? trimmedExplicitTitle : (foundTitle || null);

  return {
    externalOrderId: effectiveOrderId,
    cleanNotes,
    title: effectiveTitle,
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
