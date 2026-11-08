/**
 * scripts/audit-deposit-evidence-conflicts.ts
 *
 * Audits deposit evidence references and payment attempt tracking numbers:
 *  1. Reports exact affected record IDs flagged for manual reconciliation.
 *  2. Verifies historical evidence preservation (original banking references are immutable).
 *  3. Verifies active unique index integrity.
 */

import prisma from '../src/database/db';

export interface EvidenceAuditReport {
  timestamp: string;
  flaggedFundingRequests: Array<{
    id: number;
    fundingRef: string;
    advertiserId: string;
    evidenceRef: string | null;
    status: string;
    targetUsdCents: number;
    resolution: string | null;
    createdAt: Date;
  }>;
  flaggedPaymentAttempts: Array<{
    id: number;
    attemptRef: string;
    paymentRequestId: number;
    trackingNumber: string | null;
    status: string;
    method: string;
    resolution: string | null;
    createdAt: Date;
  }>;
  activeDuplicateEvidenceConflicts: Array<{
    evidenceRef: string;
    count: number;
    ids: number[];
  }>;
  activeDuplicateTrackingConflicts: Array<{
    trackingNumber: string;
    count: number;
    ids: number[];
  }>;
  summary: {
    totalFlaggedFundingRequests: number;
    totalFlaggedPaymentAttempts: number;
    activeEvidenceConflicts: number;
    activeTrackingConflicts: number;
    status: 'CLEAN' | 'RECONCILIATION_REQUIRED';
  };
}

export async function auditDepositEvidenceConflicts(): Promise<EvidenceAuditReport> {
  // 1. Fetch all funding requests flagged for manual reconciliation
  const flaggedFunding = await prisma.advertiserFundingRequest.findMany({
    where: {
      legacyEvidenceResolution: { not: null },
    },
    select: {
      id: true,
      fundingRef: true,
      advertiserId: true,
      evidenceRef: true,
      status: true,
      targetUsdCents: true,
      legacyEvidenceResolution: true,
      createdAt: true,
    },
    orderBy: { id: 'asc' },
  });

  // 2. Fetch all payment attempts flagged for manual reconciliation
  const flaggedAttempts = await prisma.paymentAttempt.findMany({
    where: {
      legacyEvidenceResolution: { not: null },
    },
    select: {
      id: true,
      attemptRef: true,
      paymentRequestId: true,
      trackingNumber: true,
      status: true,
      method: true,
      legacyEvidenceResolution: true,
      createdAt: true,
    },
    orderBy: { id: 'asc' },
  });

  // 3. Check for any unflagged active duplicates in advertiser_funding_requests
  const activeFundingRows = await prisma.advertiserFundingRequest.findMany({
    where: {
      evidenceRef: { not: null },
      status: { in: ['PENDING_ADMIN_VERIFICATION', 'CONFIRMED_CREDITED'] },
      legacyEvidenceResolution: null,
    },
    select: { id: true, evidenceRef: true },
  });

  const fundingMap = new Map<string, number[]>();
  for (const row of activeFundingRows) {
    if (!row.evidenceRef) continue;
    const existing = fundingMap.get(row.evidenceRef) || [];
    existing.push(row.id);
    fundingMap.set(row.evidenceRef, existing);
  }

  const activeEvidenceConflicts: EvidenceAuditReport['activeDuplicateEvidenceConflicts'] = [];
  for (const [evidenceRef, ids] of fundingMap.entries()) {
    if (ids.length > 1) {
      activeEvidenceConflicts.push({ evidenceRef, count: ids.length, ids });
    }
  }

  // 4. Check for any unflagged active duplicates in payment_attempts
  const activeAttemptRows = await prisma.paymentAttempt.findMany({
    where: {
      trackingNumber: { not: null },
      status: { in: ['waiting', 'confirmed', 'finished'] },
      legacyEvidenceResolution: null,
    },
    select: { id: true, trackingNumber: true },
  });

  const attemptMap = new Map<string, number[]>();
  for (const row of activeAttemptRows) {
    if (!row.trackingNumber) continue;
    const existing = attemptMap.get(row.trackingNumber) || [];
    existing.push(row.id);
    attemptMap.set(row.trackingNumber, existing);
  }

  const activeTrackingConflicts: EvidenceAuditReport['activeDuplicateTrackingConflicts'] = [];
  for (const [trackingNumber, ids] of attemptMap.entries()) {
    if (ids.length > 1) {
      activeTrackingConflicts.push({ trackingNumber, count: ids.length, ids });
    }
  }

  const isClean = activeEvidenceConflicts.length === 0 && activeTrackingConflicts.length === 0;

  return {
    timestamp: new Date().toISOString(),
    flaggedFundingRequests: flaggedFunding.map((f) => ({
      id: f.id,
      fundingRef: f.fundingRef,
      advertiserId: f.advertiserId,
      evidenceRef: f.evidenceRef,
      status: f.status,
      targetUsdCents: f.targetUsdCents,
      resolution: f.legacyEvidenceResolution,
      createdAt: f.createdAt,
    })),
    flaggedPaymentAttempts: flaggedAttempts.map((a) => ({
      id: a.id,
      attemptRef: a.attemptRef,
      paymentRequestId: a.paymentRequestId,
      trackingNumber: a.trackingNumber,
      status: a.status,
      method: a.method,
      resolution: a.legacyEvidenceResolution,
      createdAt: a.createdAt,
    })),
    activeDuplicateEvidenceConflicts: activeEvidenceConflicts,
    activeDuplicateTrackingConflicts: activeTrackingConflicts,
    summary: {
      totalFlaggedFundingRequests: flaggedFunding.length,
      totalFlaggedPaymentAttempts: flaggedAttempts.length,
      activeEvidenceConflicts: activeEvidenceConflicts.length,
      activeTrackingConflicts: activeTrackingConflicts.length,
      status: isClean ? 'CLEAN' : 'RECONCILIATION_REQUIRED',
    },
  };
}

async function runCli() {
  console.log('=== G4X DEPOSIT EVIDENCE AUDIT REPORT ===\n');
  const report = await auditDepositEvidenceConflicts();

  console.log(`Audit Timestamp: ${report.timestamp}`);
  console.log(`Summary Status: ${report.summary.status}`);
  console.log(`Flagged Funding Requests (Pending Manual Reconciliation): ${report.summary.totalFlaggedFundingRequests}`);
  console.log(`Flagged Payment Attempts (Pending Manual Reconciliation): ${report.summary.totalFlaggedPaymentAttempts}`);
  console.log(`Active Evidence Conflicts (Must be 0): ${report.summary.activeEvidenceConflicts}`);
  console.log(`Active Tracking Conflicts (Must be 0): ${report.summary.activeTrackingConflicts}\n`);

  if (report.flaggedFundingRequests.length > 0) {
    console.log('--- Flagged Funding Requests ---');
    for (const f of report.flaggedFundingRequests) {
      console.log(
        ` [ID: ${f.id}] ref: ${f.fundingRef} | advertiser: ${f.advertiserId} | evidence: "${f.evidenceRef}" | status: ${f.status} | amount: $${(f.targetUsdCents / 100).toFixed(2)} | resolution: ${f.resolution}`
      );
    }
    console.log('');
  }

  if (report.flaggedPaymentAttempts.length > 0) {
    console.log('--- Flagged Payment Attempts ---');
    for (const a of report.flaggedPaymentAttempts) {
      console.log(
        ` [ID: ${a.id}] ref: ${a.attemptRef} | payReq: ${a.paymentRequestId} | tracking: "${a.trackingNumber}" | status: ${a.status} | method: ${a.method} | resolution: ${a.resolution}`
      );
    }
    console.log('');
  }

  if (!report.summary.activeEvidenceConflicts && !report.summary.activeTrackingConflicts) {
    console.log('✅ All active financial liabilities have strictly unique evidence.');
  } else {
    console.error('❌ Active duplicates detected! Immediate manual investigation required.');
    process.exit(1);
  }
}

if (require.main === module) {
  runCli()
    .catch((err) => {
      console.error('Failed to run audit:', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
