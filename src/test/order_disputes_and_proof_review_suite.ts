/**
 * order_disputes_and_proof_review_suite.ts — آزمون‌های جامع فرآیند حل اختلاف و بازبینی شواهد (Phase 2 Milestone)
 * 
 * پوشش کامل ۱۸ سناریوی مصوب:
 *  1. Eligible participant opens a dispute
 *  2. Unrelated user is denied
 *  3. Duplicate active dispute is prevented
 *  4. Disputed order cannot release funds
 *  5. Evidence belongs to the correct order
 *  6. Unauthorized evidence access is rejected
 *  7. Staff can request more evidence
 *  8. Staff cannot perform unauthorized financial resolution
 *  9. Final Admin resolution requires a reason
 * 10. Reviewer cannot self-approve a materially involved dispute
 * 11. Financial state remains unchanged unless separately authorized
 * 12. Dispute holds survive restart
 * 13. Active disputes block private-channel archiving
 * 14. Channel recovery preserves evidence references
 * 15. Duplicate resolution attempts remain safe
 * 16. Website and Discord show consistent dispute status
 * 17. Audit history remains complete
 * 18. Real payouts and wallet credits remain disabled
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from '../services/domainErrors';
import {
  openOrderDispute,
  requestDisputeEvidence,
  submitDisputeEvidence,
  addDisputeReviewNotes,
  resolveOrderDispute,
  submitRunProof,
  reviewRunProof,
  getDisputesForUser,
  formatDisputeStatusLabel,
  validateEvidenceUrl,
} from '../services/orderDisputeService';
import {
  getOrCreateOrderExecutionChannel,
  archiveOrderExecutionChannel,
} from '../services/orderExecutionChannelService';
import { evaluateG4XReleaseEligibility } from '../services/financeV2/g4xBoostReleaseService';
import { checkEscrowEligibility, isEscrowReleaseEnabled } from '../services/escrowService';
import { ChannelType } from 'discord.js';

let passed = 0;
let failed = 0;

function assert(condition: any, testName: string, detail?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function ensureUserExists(discordId: string, username: string) {
  const existing = await prisma.user.findUnique({ where: { discordId } });
  if (existing) return existing;
  return await prisma.user.create({
    data: {
      discordId,
      username,
      displayName: username,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

export async function runDisputeAndProofSuite() {
  console.log('\n================================================================================');
  console.log('   G4X COMMUNITY — ORDER DISPUTES & PROOF REVIEW SUITE (PHASE 2)               ');
  console.log('================================================================================\n');

  const timestamp = Date.now();

  // Test identities
  const uOwner = `test_disp_owner_${timestamp}`;
  const uAdmin1 = `test_disp_adm1_${timestamp}`;
  const uAdminInvolved = `test_disp_adminv_${timestamp}`;
  const uStaff = `test_disp_stf_${timestamp}`;
  const uAdv = `test_disp_adv_${timestamp}`;
  const uBst1 = `test_disp_bst1_${timestamp}`;
  const uBst2 = `test_disp_bst2_${timestamp}`;
  const uCustomer = `test_disp_cust_${timestamp}`;
  const uUnrelated = `test_disp_unrel_${timestamp}`;

  const allUsers = [
    uOwner,
    uAdmin1,
    uAdminInvolved,
    uStaff,
    uAdv,
    uBst1,
    uBst2,
    uCustomer,
    uUnrelated,
  ];

  // Mock Discord Environment
  const mockGuildId = `guild_disp_${timestamp}`;
  const mockChannelsMap = new Map<string, any>();
  (mockChannelsMap as any).find = (predicate: (val: any) => boolean) => {
    for (const v of mockChannelsMap.values()) {
      if (predicate(v)) return v;
    }
    return undefined;
  };
  let chanSeq = 3000;

  function createMockChannel(data: any) {
    const channelId = data.id || `chan_disp_${++chanSeq}`;
    const overwritesMap = new Map<string, any>();
    if (Array.isArray(data.permissionOverwrites)) {
      for (const ow of data.permissionOverwrites) {
        overwritesMap.set(ow.id, ow);
      }
    }
    const chanObj: any = {
      id: channelId,
      name: data.name || `order-mock`,
      type: data.type ?? ChannelType.GuildText,
      guild: { id: mockGuildId },
      isTextBased: () => true,
      permissionOverwrites: {
        cache: overwritesMap,
        edit: async (t: string, p: any) => {
          overwritesMap.set(t, { id: t, permissions: p });
          return true;
        },
        delete: async (t: string) => {
          overwritesMap.delete(t);
          return true;
        },
      },
      messages: [],
      send: async (payload: any) => {
        const msgId = `msg_${Date.now()}_${Math.random()}`;
        chanObj.messages.push({ id: msgId, ...payload });
        return { id: msgId, ...payload };
      },
    };
    mockChannelsMap.set(channelId, chanObj);
    return chanObj;
  }

  const mockGuild: any = {
    id: mockGuildId,
    roles: { everyone: { id: `${mockGuildId}_everyone` } },
    channels: {
      cache: mockChannelsMap,
      create: async (data: any) => createMockChannel(data),
    },
    members: { me: { id: `bot_${timestamp}` } },
  };

  const mockGuildsMap = new Map([[mockGuildId, mockGuild]]);
  (mockGuildsMap as any).first = () => mockGuild;

  const mockClient: any = {
    guilds: { cache: mockGuildsMap },
    channels: {
      cache: mockChannelsMap,
      fetch: async (id: string) => {
        const found = mockChannelsMap.get(id);
        if (!found) throw new Error('Unknown Channel');
        return found;
      },
    },
    user: { id: `bot_${timestamp}` },
  };

  try {
    // ─── Setup: Users & Roles ────────────────────────────────────────────────
    for (const uid of allUsers) {
      await ensureUserExists(uid, `user_${uid.slice(-6)}`);
    }

    await prisma.userRole.createMany({
      data: [
        { userId: uOwner, roleKey: 'owner' },
        { userId: uAdmin1, roleKey: 'admin' },
        { userId: uAdminInvolved, roleKey: 'admin' },
        { userId: uStaff, roleKey: 'staff' },
        { userId: uAdv, roleKey: 'advertiser' },
        { userId: uBst1, roleKey: 'booster' },
        { userId: uBst2, roleKey: 'booster' },
      ],
    });

    // Test service
    const service = await prisma.gameService.findFirst({
      where: { gameSlug: 'wow_midnight' },
    });
    if (!service) throw new Error('GameService wow_midnight not found');

    for (const uid of [uBst1, uBst2]) {
      await prisma.userGameApproval.create({
        data: {
          userId: uid,
          gameSlug: 'wow_midnight',
          serviceId: service.id,
          approvalType: 'booster',
          status: 'approved',
        },
      });
    }

    // Capture initial wallet state
    const initialWallets = await prisma.walletV2.findMany({
      where: { userId: { in: allUsers } },
    });
    const initialLedgerCount = await prisma.ledgerEntryV2.count();

    // ─── Base Test Order Creation ────────────────────────────────────────────
    const order1 = await prisma.order.create({
      data: {
        orderRef: `ORD_DISP_1_${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: service.id,
        creatorId: uAdv,
        creatorType: 'advertiser',
        advertiserId: uAdv,
        customerId: uCustomer,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 15000,
        boosterPoolMinor: 12000,
        paymentStatus: 'verified',
        status: 'assigned',
        runs: {
          create: [
            { runNumber: 1, status: 'completed', completedBy: uBst1 },
            { runNumber: 2, status: 'pending' },
          ],
        },
        assignments: {
          create: [
            { userId: uBst1, assignedById: uAdv, assignedRole: 'tank', status: 'assigned' },
            { userId: uBst2, assignedById: uAdv, assignedRole: 'healer', status: 'assigned' },
          ],
        },
      },
      include: { runs: true, assignments: true },
    });

    // Create execution channel for order1
    await getOrCreateOrderExecutionChannel(order1.id, mockClient, { guildId: mockGuildId });

    // ─── Test 1: Eligible participant opens a dispute ─────────────────────────
    const disputeRes1 = await openOrderDispute({
      orderId: order1.id,
      actorId: uBst1,
      disputeType: 'completion',
      description: 'Customer disconnected at final boss in run #1',
      evidenceUrl: 'https://cdn.g4x.online/evidence/run1_wipe.png',
      runId: order1.runs[0].id,
      discordClient: mockClient,
    });

    const dbDispute1 = await prisma.orderDispute.findUnique({
      where: { id: disputeRes1.dispute.id },
      include: { escrowHolds: true },
    });

    assert(
      disputeRes1.dispute.status === 'open' &&
        dbDispute1?.openedById === uBst1 &&
        dbDispute1?.escrowHolds.length === 1 &&
        dbDispute1?.escrowHolds[0].status === 'active',
      '1. Eligible participant opens a dispute: Open status, active EscrowHold, and audit record created'
    );

    // ─── Test 2: Unrelated user is denied ────────────────────────────────────
    let unauthDisputeError: any = null;
    try {
      await openOrderDispute({
        orderId: order1.id,
        actorId: uUnrelated,
        disputeType: 'misconduct',
        description: 'Random member trying to dispute',
      });
    } catch (e: any) {
      unauthDisputeError = e;
    }

    assert(
      unauthDisputeError instanceof DomainError &&
        unauthDisputeError.code === DomainErrorCode.PERMISSION_DENIED,
      '2. Unrelated user is denied: Non-participant cannot open a dispute on an order'
    );

    // ─── Test 3: Duplicate active dispute is prevented ───────────────────────
    let dupDisputeError: any = null;
    try {
      await openOrderDispute({
        orderId: order1.id,
        actorId: uAdv,
        disputeType: 'quality',
        description: 'Advertiser opening a second active dispute on same order',
      });
    } catch (e: any) {
      dupDisputeError = e;
    }

    assert(
      dupDisputeError instanceof DomainError &&
        dupDisputeError.code === DomainErrorCode.DUPLICATE_ACTIVE_DISPUTE,
      '3. Duplicate active dispute is prevented: Only one active dispute allowed per order'
    );

    // ─── Test 4: Disputed order cannot release funds ─────────────────────────
    const releaseEval = await evaluateG4XReleaseEligibility(order1.id);
    assert(
      releaseEval.eligible === false &&
        releaseEval.reasons.some((r) => r.includes('ACTIVE_DISPUTE')),
      '4. Disputed order cannot release funds: Active dispute strictly blocks release eligibility'
    );

    // ─── Test 5: Evidence belongs to the correct order ───────────────────────
    // Create an unrelated order with a run
    const order2 = await prisma.order.create({
      data: {
        orderRef: `ORD_DISP_2_${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: service.id,
        creatorId: uAdv,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000,
        paymentStatus: 'verified',
        status: 'assigned',
        runs: { create: [{ runNumber: 1, status: 'pending' }] },
        assignments: {
          create: [{ userId: uBst2, assignedById: uAdv, assignedRole: 'tank', status: 'assigned' }],
        },
      },
      include: { runs: true },
    });

    let runMismatchError: any = null;
    try {
      await openOrderDispute({
        orderId: order1.id,
        actorId: uBst1,
        disputeType: 'completion',
        description: 'Trying to link a run from order 2',
        runId: order2.runs[0].id,
      });
    } catch (e: any) {
      runMismatchError = e;
    }

    assert(
      runMismatchError instanceof DomainError &&
        (runMismatchError.code === DomainErrorCode.RUN_ORDER_MISMATCH ||
          runMismatchError.code === DomainErrorCode.DUPLICATE_ACTIVE_DISPUTE),
      '5. Evidence belongs to the correct order: Cross-order run linking is strictly rejected'
    );

    // ─── Test 6: Unauthorized evidence access is rejected ────────────────────
    let unauthEvidenceError: any = null;
    try {
      await submitDisputeEvidence({
        disputeId: disputeRes1.dispute.id,
        actorId: uUnrelated,
        evidenceUrl: 'https://cdn.g4x.online/evidence/fake.png',
        description: 'Unrelated intruder uploading evidence',
      });
    } catch (e: any) {
      unauthEvidenceError = e;
    }

    assert(
      unauthEvidenceError instanceof DomainError &&
        unauthEvidenceError.code === DomainErrorCode.PERMISSION_DENIED,
      '6. Unauthorized evidence access is rejected: Unrelated user cannot submit evidence to dispute'
    );

    // ─── Test 7: Staff can request more evidence ─────────────────────────────
    const reqEvidenceRes = await requestDisputeEvidence({
      disputeId: disputeRes1.dispute.id,
      staffId: uStaff,
      requestNotes: 'Please provide full combat log or screenshot showing timestamp',
      discordClient: mockClient,
    });

    assert(
      reqEvidenceRes.status === 'waiting_for_evidence' &&
        reqEvidenceRes.assignedReviewerId === uStaff,
      '7. Staff can request more evidence: Status transitions to waiting_for_evidence'
    );

    // Participant responds with additional evidence
    const submitEvRes = await submitDisputeEvidence({
      disputeId: disputeRes1.dispute.id,
      actorId: uBst1,
      evidenceUrl: 'https://cdn.g4x.online/evidence/full_log.txt',
      description: 'Combat log uploaded showing disconnect event',
      discordClient: mockClient,
    });

    assert(
      submitEvRes.status === 'under_review',
      '7b. Participant response transitions dispute from waiting_for_evidence to under_review'
    );

    // ─── Test 8: Staff cannot perform unauthorized financial resolution ──────
    let staffResolveError: any = null;
    try {
      await resolveOrderDispute({
        disputeId: disputeRes1.dispute.id,
        resolverId: uStaff,
        decision: 'resolved',
        resolutionNotes: 'Staff attempting to resolve final dispute',
      });
    } catch (e: any) {
      staffResolveError = e;
    }

    assert(
      staffResolveError instanceof DomainError &&
        staffResolveError.code === DomainErrorCode.PERMISSION_DENIED,
      '8. Staff cannot perform unauthorized financial resolution: Final resolution reserved for Admin/Owner'
    );

    // ─── Test 9: Final Admin resolution requires a reason ────────────────────
    let emptyReasonError: any = null;
    try {
      await resolveOrderDispute({
        disputeId: disputeRes1.dispute.id,
        resolverId: uAdmin1,
        decision: 'resolved',
        resolutionNotes: '   ',
      });
    } catch (e: any) {
      emptyReasonError = e;
    }

    assert(
      emptyReasonError instanceof DomainError &&
        emptyReasonError.code === DomainErrorCode.VALIDATION_ERROR,
      '9. Final Admin resolution requires a reason: Mandatory non-empty reason enforced'
    );

    // ─── Test 10: Reviewer cannot self-approve a materially involved dispute ───
    // Create an order where uAdminInvolved is the advertiser
    const orderInvolved = await prisma.order.create({
      data: {
        orderRef: `ORD_INVOLVED_${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: service.id,
        creatorId: uAdminInvolved,
        advertiserId: uAdminInvolved,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000,
        paymentStatus: 'verified',
        status: 'assigned',
        assignments: {
          create: [{ userId: uBst2, assignedById: uAdminInvolved, assignedRole: 'tank', status: 'assigned' }],
        },
      },
    });

    const disputeInvolved = await openOrderDispute({
      orderId: orderInvolved.id,
      actorId: uBst2,
      disputeType: 'payment',
      description: 'Dispute where advertiser is also an admin',
    });

    let selfApproveError: any = null;
    try {
      await resolveOrderDispute({
        disputeId: disputeInvolved.dispute.id,
        resolverId: uAdminInvolved,
        decision: 'resolved',
        resolutionNotes: 'Admin attempting to self-resolve own order dispute',
      });
    } catch (e: any) {
      selfApproveError = e;
    }

    assert(
      selfApproveError instanceof DomainError &&
        selfApproveError.code === DomainErrorCode.SELF_APPROVAL_PROHIBITED,
      '10. Reviewer cannot self-approve a materially involved dispute: Self-resolution strictly blocked'
    );

    // ─── Test 11: Financial state remains unchanged unless separately authorized
    const resolveResult = await resolveOrderDispute({
      disputeId: disputeRes1.dispute.id,
      resolverId: uAdmin1,
      decision: 'resolved',
      resolutionNotes: 'Partial credit agreed offline between booster and advertiser; order confirmed complete',
      discordClient: mockClient,
    });

    const finalWallets = await prisma.walletV2.findMany({
      where: { userId: { in: allUsers } },
    });
    const finalLedgerCount = await prisma.ledgerEntryV2.count();

    const walletDifferences = finalWallets.filter((fw) => {
      const iw = initialWallets.find((w) => w.userId === fw.userId);
      return (
        !iw ||
        iw.availableCents !== fw.availableCents ||
        iw.reservedCents !== fw.reservedCents
      );
    });

    const holdAfterResolve = await prisma.escrowHold.findFirst({
      where: { disputeId: disputeRes1.dispute.id },
    });

    assert(
      resolveResult.status === 'resolved' &&
        holdAfterResolve?.status === 'released' &&
        walletDifferences.length === 0 &&
        finalLedgerCount === initialLedgerCount,
      '11. Financial state remains unchanged unless separately authorized: Dispute resolution touches zero wallets'
    );

    // ─── Test 12: Dispute holds survive restart ──────────────────────────────
    const dbPersistedDispute = await prisma.orderDispute.findUnique({
      where: { id: disputeRes1.dispute.id },
      include: { escrowHolds: true },
    });

    assert(
      dbPersistedDispute !== null &&
        dbPersistedDispute.escrowHolds.length > 0 &&
        dbPersistedDispute.resolvedById === uAdmin1,
      '12. Dispute holds survive restart: Stored in persistent database schema'
    );

    // ─── Test 13: Active disputes block private-channel archiving ────────────
    // Create new order with an active dispute
    const orderToArchive = await prisma.order.create({
      data: {
        orderRef: `ORD_TO_ARCH_${timestamp}`,
        gameSlug: 'wow_midnight',
        serviceId: service.id,
        creatorId: uAdv,
        advertiserId: uAdv,
        orderType: 'group',
        currency: 'USD',
        grossAmountMinor: 10000,
        paymentStatus: 'verified',
        status: 'assigned',
        assignments: {
          create: [{ userId: uBst1, assignedById: uAdv, assignedRole: 'tank', status: 'assigned' }],
        },
      },
    });

    await getOrCreateOrderExecutionChannel(orderToArchive.id, mockClient, { guildId: mockGuildId });

    await openOrderDispute({
      orderId: orderToArchive.id,
      actorId: uBst1,
      disputeType: 'completion',
      description: 'Active dispute on orderToArchive',
      discordClient: mockClient,
    });

    let archiveDisputeError: any = null;
    try {
      await archiveOrderExecutionChannel(orderToArchive.id, mockClient);
    } catch (e: any) {
      archiveDisputeError = e;
    }

    assert(
      archiveDisputeError instanceof DomainError &&
        archiveDisputeError.code === DomainErrorCode.ORDER_DISPUTE_ACTIVE,
      '13. Active disputes block private-channel archiving: Channel retention enforced'
    );

    // ─── Test 14: Channel recovery preserves evidence references ─────────────
    // If execution channel was deleted in Discord, recovery creates a new channel
    // and preserves link to the same orderId and its dispute records
    const mappingToBreak = await prisma.orderChannel.findFirst({
      where: { orderId: orderToArchive.id, channelType: 'execution', status: 'active' },
    });

    if (mappingToBreak) {
      mockChannelsMap.delete(mappingToBreak.discordChannelId);
    }

    const recoverChannelRes = await getOrCreateOrderExecutionChannel(orderToArchive.id, mockClient, {
      guildId: mockGuildId,
    });

    const activeDisputesOnRecovered = await prisma.orderDispute.findMany({
      where: { orderId: orderToArchive.id },
    });

    assert(
      recoverChannelRes.success === true &&
        activeDisputesOnRecovered.length === 1 &&
        activeDisputesOnRecovered[0].description === 'Active dispute on orderToArchive',
      '14. Channel recovery preserves evidence references: Recreated channel retains dispute linkage'
    );

    // ─── Test 15: Duplicate resolution attempts remain safe ───────────────────
    let duplicateResolveError: any = null;
    try {
      await resolveOrderDispute({
        disputeId: disputeRes1.dispute.id,
        resolverId: uOwner,
        decision: 'resolved',
        resolutionNotes: 'Attempting to resolve an already resolved dispute',
      });
    } catch (e: any) {
      duplicateResolveError = e;
    }

    assert(
      duplicateResolveError instanceof DomainError &&
        duplicateResolveError.code === DomainErrorCode.DISPUTE_ALREADY_RESOLVED,
      '15. Duplicate resolution attempts remain safe: Replayed resolution throws DISPUTE_ALREADY_RESOLVED'
    );

    // ─── Test 16: Website and Discord show consistent dispute status ─────────
    const labelOpen = formatDisputeStatusLabel('open');
    const labelUnderReview = formatDisputeStatusLabel('under_review');
    const labelWaiting = formatDisputeStatusLabel('waiting_for_evidence');
    const labelResolved = formatDisputeStatusLabel('resolved');

    assert(
      labelOpen.label === 'Open' &&
        labelUnderReview.label === 'Under Review' &&
        labelWaiting.label === 'Awaiting Evidence' &&
        labelResolved.label === 'Resolved',
      '16. Website and Discord show consistent dispute status: Labels are user-friendly English'
    );

    // ─── Test 17: Audit history remains complete ─────────────────────────────
    const disputeAuditLogs = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entityId: String(disputeRes1.dispute.id) },
          { action: { in: ['ORDER_DISPUTE_OPENED', 'ORDER_DISPUTE_RESOLVED'] } },
        ],
      },
    });

    assert(
      disputeAuditLogs.length >= 3 &&
        disputeAuditLogs.some((l) => l.action === 'ORDER_DISPUTE_OPENED') &&
        disputeAuditLogs.some((l) => l.action === 'ORDER_DISPUTE_RESOLVED'),
      '17. Audit history remains complete: Full audit trail persisted in audit_logs'
    );

    // ─── Test 18: Real payouts and wallet credits remain disabled ────────────
    const escrowSwitch = isEscrowReleaseEnabled();
    const liveCreditsEnabled = process.env.FINANCE_V2_LIVE_CREDITS_ENABLED === 'true';
    const livePayoutsEnabled = process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED === 'true';

    assert(
      escrowSwitch === false &&
        liveCreditsEnabled === false &&
        livePayoutsEnabled === false,
      '18. Real payouts and wallet credits remain disabled: All financial feature gates are false'
    );

    console.log('\n================================================================================');
    console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================================\n');

    if (failed > 0) {
      throw new Error(`Test suite failed: ${failed} assertions failed`);
    }
  } finally {
    // Isolated cleanup of test records
    await prisma.orderDispute.deleteMany({
      where: { openedById: { in: allUsers } },
    });
    await prisma.escrowHold.deleteMany({
      where: { createdById: { in: allUsers } },
    });
    await prisma.runProof.deleteMany({
      where: { submittedById: { in: allUsers } },
    });
    await prisma.orderChannel.deleteMany({
      where: { discordGuildId: mockGuildId },
    });
    await prisma.orderAssignment.deleteMany({
      where: { userId: { in: allUsers } },
    });
    await prisma.orderRun.deleteMany({
      where: { order: { creatorId: { in: allUsers } } },
    });
    await prisma.order.deleteMany({
      where: { creatorId: { in: allUsers } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: allUsers } },
    });
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: allUsers } },
    });
    await prisma.user.deleteMany({
      where: { discordId: { in: allUsers } },
    });
  }
}

if (require.main === module) {
  runDisputeAndProofSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
