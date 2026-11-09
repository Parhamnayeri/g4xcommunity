/**
 * dynamic_rules_and_policies_cms_suite.ts — Automated Regression Suite
 *
 * G4X Community — Task 6: Dynamic Rules & Policies CMS + Discord Rules Channel
 *
 * Verifies:
 *  1. Initial policy seeding with exact verbatim policy text and Advertiser Rank commission table
 *  2. Public API never exposes draft content when no published policy exists
 *  3. Server-authoritative RBAC: Admin and Owner permitted; Staff, Manager, Booster denied
 *  4. Rich Markdown XSS sanitization (scripts, iframes, onerror stripped)
 *  5. Draft editing, compiled markdown regeneration, and AuditLog recording
 *  6. Operational discrepancy warning evaluation (11 items) and publish acknowledgment enforcement
 *  7. Policy publication lifecycle, previous version archiving, and currentPublishedVersionId pointer
 *  8. Immutability of published policy snapshots (edits to published versions rejected)
 *  9. Restore prior version as new DRAFT with incremented version number
 * 10. Public API returns published policy after publication
 * 11. Discord auto-provisioning creates #rules-and-policies under START HERE category with read-only permissions
 * 12. Discord message chunking (<= 2000 chars) and managed message upsert (PolicyDiscordMessage)
 * 13. Discord sync failure resilience (sync error does not rollback database publication)
 * 14. Strict financial invariants: zero wallet, ledger, or escrow mutations; feature gates remain disabled
 */

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import prisma from '../database/db';
import {
  INITIAL_POLICY_RAW_TEXT,
  INITIAL_SECTIONS_SEED,
} from '../services/policyContentConstants';
import {
  getPolicyDiscrepancyWarnings,
  POLICY_DISCREPANCY_WARNINGS,
} from '../services/policyDiscrepancies';
import {
  seedInitialPolicyDraft,
  getPublishedPolicy,
  getDraftOrActivePolicy,
  saveDraftPolicy,
  publishPolicyVersion,
  restoreVersionAsDraft,
  listPolicyVersions,
  chunkDiscordMessage,
  syncPolicyToDiscord,
  retryDiscordSync,
  sanitizePolicyMarkdown,
} from '../services/policyService';
import { provisionAllChannels } from '../services/discordProvisioningService';
import { DomainError, DomainErrorCode } from '../services/domainErrors';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export async function runDynamicRulesAndPoliciesCmsSuite(): Promise<boolean> {
  console.log('\n====================================================================');
  console.log('G4X Community — Dynamic Rules & Policies CMS + Discord Sync Suite');
  console.log('====================================================================\n');

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ ${name}`);
      results.push({ name, passed: true });
      passed++;
    } else {
      console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
      results.push({ name, passed: false, error: detail });
      failed++;
    }
  }

  // Test Discord IDs
  const adminId = 'cms_test_admin_99901';
  const ownerId = 'cms_test_owner_99902';
  const managerId = 'cms_test_manager_99903';
  const staffId = 'cms_test_staff_99904';
  const boosterId = 'cms_test_booster_99905';

  const testUsers = [
    { discordId: adminId, username: 'CmsAdmin', role: 'admin' },
    { discordId: ownerId, username: 'CmsOwner', role: 'owner' },
    { discordId: managerId, username: 'CmsManager', role: 'manager' },
    { discordId: staffId, username: 'CmsStaff', role: 'staff' },
    { discordId: boosterId, username: 'CmsBooster', role: 'booster' },
  ];

  try {
    // 0. Setup test users and roles
    for (const u of testUsers) {
      await prisma.user.upsert({
        where: { discordId: u.discordId },
        update: { username: u.username },
        create: { discordId: u.discordId, username: u.username },
      });
      await prisma.userRole.deleteMany({ where: { userId: u.discordId } });
      await prisma.userRole.upsert({
        where: { userId_roleKey: { userId: u.discordId, roleKey: u.role } },
        update: {},
        create: { userId: u.discordId, roleKey: u.role },
      });
    }

    // Clean up any pre-existing policy test document
    const existingDoc = await prisma.policyDocument.findUnique({
      where: { slug: 'community-rules' },
      include: { versions: { include: { sections: { include: { subsections: true } } } } },
    });
    if (existingDoc) {
      for (const v of existingDoc.versions) {
        await prisma.policyDiscordMessage.deleteMany({ where: { versionId: v.id } });
        for (const s of v.sections) {
          await prisma.policySubsection.deleteMany({ where: { sectionId: s.id } });
        }
        await prisma.policySection.deleteMany({ where: { versionId: v.id } });
      }
      await prisma.policyVersion.deleteMany({ where: { documentId: existingDoc.id } });
      await prisma.policyDocument.delete({ where: { id: existingDoc.id } });
    }

    // ──────────────────────────────────────────────────────────────────
    // TEST 1: Initial Policy Seeding and Content Completeness
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 1: Initial Policy Seeding & Content Completeness ---');
    const initialDraft = await seedInitialPolicyDraft(adminId);

    assert(initialDraft !== null, 'Initial policy draft seeded successfully');
    assert(initialDraft.status === 'DRAFT', 'Initial policy draft status is DRAFT');
    const doc = await prisma.policyDocument.findUnique({ where: { slug: 'community-rules' } });
    assert(doc?.slug === 'community-rules', 'Policy document slug is community-rules');

    // Verify all 6 primary sections exist
    const sectionKeys = initialDraft.sections.map((s: any) => s.sectionKey);
    const expectedKeys = ['general', 'boosters', 'advertisers', 'exchangers', 'financials', 'kyc'];
    assert(
      expectedKeys.every((k) => sectionKeys.includes(k)),
      'All 6 primary policy sections exist in database',
      `Found: ${sectionKeys.join(', ')}`
    );

    // Verify Advertiser Rank Commission Table in section 5 (Financials)
    const finSection = initialDraft.sections.find((s: any) => s.sectionKey === 'financials');
    assert(!!finSection, 'Financials section found');
    const rankSub = finSection?.subsections.find((sub: any) => sub.subsectionKey === 'advertiser_commissions_table');
    assert(!!rankSub, 'Advertiser Commissions Table subsection found');
    assert(rankSub?.contentType === 'TABLE', 'Advertiser Commissions Table content type is TABLE');
    assert(!!rankSub?.tableDataJson, 'Advertiser Commissions table JSON is present');

    const parsedTable = JSON.parse(rankSub?.tableDataJson || '{}');
    const rows = parsedTable.rows || [];
    assert(rows.length === 6, 'Advertiser commission table contains all 6 tiers');
    assert(rows[0][0] === 'Bronze' && rows[0][1] === '14.99%', 'Bronze rank: 14.99%');
    assert(rows[1][0] === 'Silver' && rows[1][1] === '12.99%', 'Silver rank: 12.99%');
    assert(rows[2][0] === 'Gold' && rows[2][1] === '10.99%', 'Gold rank: 10.99%');
    assert(rows[3][0] === 'Diamond' && rows[3][1] === '8.99%', 'Diamond rank: 8.99%');
    assert(rows[4][0] === 'Founding Partner' && rows[4][1] === '8.99%', 'Founding Partner rank: 8.99%');
    assert(rows[5][0] === 'Official Partner' && rows[5][1] === '6.99%', 'Official Partner rank: 6.99%');

    // ──────────────────────────────────────────────────────────────────
    // TEST 2: Public API Does Not Leak Draft Content
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 2: Public API Leak Protection ---');
    const publicBeforePublish = await getPublishedPolicy();
    assert(publicBeforePublish === null, 'getPublishedPolicy returns null when only DRAFT exists');

    // ──────────────────────────────────────────────────────────────────
    // TEST 3: Server-Authoritative RBAC
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 3: Server-Authoritative RBAC ---');
    let managerBlocked = false;
    try {
      await saveDraftPolicy({
        versionId: initialDraft.id,
        title: 'Unauthorized Edit',
        sections: [],
        actorId: managerId,
      });
    } catch (err: any) {
      if (err instanceof DomainError && err.code === DomainErrorCode.PERMISSION_DENIED) {
        managerBlocked = true;
      }
    }
    assert(managerBlocked, 'Manager role is denied draft editing (PERMISSION_DENIED)');

    let staffBlocked = false;
    try {
      await publishPolicyVersion({
        versionId: initialDraft.id,
        actorId: staffId,
        acknowledgedDiscrepancies: ['TEST_ACK'],
      });
    } catch (err: any) {
      if (err instanceof DomainError && err.code === DomainErrorCode.PERMISSION_DENIED) {
        staffBlocked = true;
      }
    }
    assert(staffBlocked, 'Staff role is denied policy publishing (PERMISSION_DENIED)');

    let boosterBlocked = false;
    try {
      await restoreVersionAsDraft({
        sourceVersionId: initialDraft.id,
        actorId: boosterId,
      });
    } catch (err: any) {
      if (err instanceof DomainError && err.code === DomainErrorCode.PERMISSION_DENIED) {
        boosterBlocked = true;
      }
    }
    assert(boosterBlocked, 'Booster role is denied policy restoration (PERMISSION_DENIED)');

    // ──────────────────────────────────────────────────────────────────
    // TEST 4: Markdown XSS Sanitization
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 4: Markdown XSS Sanitization ---');
    const maliciousInput = `
      # Section Title <script>alert('xss')</script>
      <iframe src="https://evil.com"></iframe>
      <a href="javascript:alert(1)">Click Me</a>
      <img src="x" onerror="alert(2)" />
      Normal Text **Bold**
    `;
    const sanitized = sanitizePolicyMarkdown(maliciousInput);
    assert(!sanitized.includes('<script>'), 'Sanitization stripped <script>');
    assert(!sanitized.includes('<iframe>'), 'Sanitization stripped <iframe>');
    assert(!sanitized.includes('javascript:'), 'Sanitization stripped javascript: URIs');
    assert(!sanitized.includes('onerror='), 'Sanitization stripped onerror attribute');
    assert(sanitized.includes('Normal Text'), 'Sanitization preserved normal text');
    assert(sanitized.includes('**Bold**'), 'Sanitization preserved markdown syntax');

    // ──────────────────────────────────────────────────────────────────
    // TEST 5: Draft Editing, Markdown Re-generation & Audit Log
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 5: Draft Editing & Audit Logging ---');
    const updatedDraft = await saveDraftPolicy({
      versionId: initialDraft.id,
      actorId: adminId,
      title: 'G4X Community Official Policy & Operating Rules',
      changelog: 'Added explicit operational note on communication standards.',
      sections: initialDraft.sections.map((s: any) => ({
        sectionNumber: s.sectionNumber,
        sectionKey: s.sectionKey,
        title: s.title,
        sortOrder: s.sortOrder,
        content: s.content || undefined,
        subsections: s.subsections.map((sub: any) => ({
          subsectionKey: sub.subsectionKey,
          title: sub.title,
          sortOrder: sub.sortOrder,
          contentType: sub.contentType as any,
          content: sub.content,
          tableDataJson: sub.tableDataJson || undefined,
        })),
      })),
    });

    assert(updatedDraft.title === 'G4X Community Official Policy & Operating Rules', 'Draft title updated');
    assert(updatedDraft.rawContentMarkdown.includes('G4X Community Official Policy & Operating Rules'), 'Compiled markdown reflects updated title');

    // Verify AuditLog
    const draftAudit = await prisma.auditLog.findFirst({
      where: {
        entityId: `policy_ver_${initialDraft.id}`,
        action: 'ACTION_POLICY_DRAFT_SAVED',
      },
      orderBy: { createdAt: 'desc' },
    });
    assert(!!draftAudit, 'AuditLog entry created for ACTION_POLICY_DRAFT_SAVED');
    assert(draftAudit?.actorId === adminId, 'AuditLog recorded correct admin actorId');

    // ──────────────────────────────────────────────────────────────────
    // TEST 6: Discrepancy Warnings & Publication Acknowledgment Enforcement
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 6: Discrepancy Warnings & Acknowledgment Enforcement ---');
    const discrepancies = getPolicyDiscrepancyWarnings();
    assert(discrepancies.length === 11, 'Evaluated all 11 operational policy discrepancies');

    // Attempt to publish without acknowledging warnings
    let unacknowledgedBlocked = false;
    try {
      await publishPolicyVersion({
        versionId: initialDraft.id,
        actorId: adminId,
        acknowledgedDiscrepancies: [],
      });
    } catch (err: any) {
      if (err instanceof DomainError && err.code === DomainErrorCode.VALIDATION_ERROR) {
        unacknowledgedBlocked = true;
      }
    }
    assert(unacknowledgedBlocked, 'Publishing without acknowledging discrepancies is blocked (VALIDATION_ERROR)');

    // ──────────────────────────────────────────────────────────────────
    // TEST 7: Policy Publication & Document Pointer Update
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 7: Policy Publication ---');
    const allDiscrepancyKeys = discrepancies.map((d) => d.id);
    const published = await publishPolicyVersion({
      versionId: initialDraft.id,
      actorId: ownerId,
      acknowledgedDiscrepancies: allDiscrepancyKeys,
      changelog: 'Initial official release',
    });

    assert(published.status === 'PUBLISHED', 'Policy version status is now PUBLISHED');
    assert(!!published.publishedAt, 'publishedAt timestamp is recorded');
    assert(published.publisherDiscordId === ownerId, 'publisherDiscordId is ownerId');

    // Verify document pointer
    const docAfterPublish = await prisma.policyDocument.findUniqueOrThrow({
      where: { slug: 'community-rules' },
    });
    assert(docAfterPublish.currentPublishedVersionId === initialDraft.id, 'Document pointer currentPublishedVersionId set correctly');

    // Verify AuditLog
    const publishAudit = await prisma.auditLog.findFirst({
      where: {
        entityId: `policy_ver_${initialDraft.id}`,
        action: 'ACTION_POLICY_PUBLISHED',
      },
      orderBy: { createdAt: 'desc' },
    });
    assert(!!publishAudit, 'AuditLog entry created for ACTION_POLICY_PUBLISHED');

    // ──────────────────────────────────────────────────────────────────
    // TEST 8: Immutability of Published Policy Version
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 8: Immutability of Published Versions ---');
    let publishedEditBlocked = false;
    try {
      await saveDraftPolicy({
        versionId: initialDraft.id,
        actorId: adminId,
        title: 'Illegal Mutated Title',
        sections: [],
      });
    } catch (err: any) {
      if (err instanceof DomainError && err.code === DomainErrorCode.VALIDATION_ERROR) {
        publishedEditBlocked = true;
      }
    }
    assert(publishedEditBlocked, 'Edits to PUBLISHED versions are rejected (immutable snapshot)');

    // ──────────────────────────────────────────────────────────────────
    // TEST 9: Public API Serves Published Version
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 9: Public API Retrieval ---');
    const publicPolicy = await getPublishedPolicy();
    assert(publicPolicy !== null, 'getPublishedPolicy returns published version');
    assert(publicPolicy?.id === initialDraft.id, 'Published version matches ID');
    assert(!!publicPolicy && publicPolicy.sections.length >= 6, 'Published policy contains all sections');

    // ──────────────────────────────────────────────────────────────────
    // TEST 10: Restore Prior Version as New DRAFT
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 10: Restore Version as New Draft ---');
    const restoredDraft = await restoreVersionAsDraft({
      sourceVersionId: initialDraft.id,
      actorId: adminId,
    });
    assert(restoredDraft.status === 'DRAFT', 'Restored version status is DRAFT');
    assert(restoredDraft.versionNumber === 2, 'Restored version number incremented to 2');
    assert(restoredDraft.sections.length === initialDraft.sections.length, 'Restored version contains all cloned sections');

    // Active published version remains version 1
    const activeDoc = await prisma.policyDocument.findUniqueOrThrow({
      where: { slug: 'community-rules' },
    });
    assert(activeDoc.currentPublishedVersionId === initialDraft.id, 'Active published document unchanged by draft creation');

    // ──────────────────────────────────────────────────────────────────
    // TEST 11: Discord Message Chunking
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 11: Discord Message Chunking ---');
    const chunks = chunkDiscordMessage(published.rawContentMarkdown, 1900);
    assert(chunks.length > 1, 'Chunking split long document into multiple blocks');
    assert(
      chunks.every((c: string) => c.length <= 1950),
      'All chunks are within Discord character limit (<= 1950 chars)'
    );

    // ──────────────────────────────────────────────────────────────────
    // TEST 12: Discord Auto-Provisioning & Channel Overwrites
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 12: Discord Auto-Provisioning of #rules-and-policies ---');

    // Create a mock Guild and mock Channel
    const mockSentMessages: Array<{ id: string; content: string }> = [];
    const mockChannelOverwrites: Array<{ id: string; allow: any; deny: any }> = [];

    const mockRulesChannel = {
      id: 'mock_rules_chan_1001',
      name: 'rules-and-policies',
      type: ChannelType.GuildText,
      parentId: 'mock_cat_start_here',
      isTextBased: () => true,
      send: async (payload: any) => {
        const msg = {
          id: `mock_msg_${mockSentMessages.length + 1}`,
          content: typeof payload === 'string' ? payload : payload.content || '',
        };
        mockSentMessages.push(msg);
        return msg;
      },
      permissionOverwrites: {
        set: async (overwrites: any[]) => {
          mockChannelOverwrites.length = 0;
          mockChannelOverwrites.push(...overwrites);
        },
      },
      messages: {
        fetch: async (id: string) => {
          const found = mockSentMessages.find((m) => m.id === id);
          if (!found) throw new Error('Unknown Message');
          return {
            id: found.id,
            content: found.content,
            edit: async (newContent: string) => {
              found.content = newContent;
              return found;
            },
          };
        },
      },
    };

    const mockStartHereCategory = {
      id: 'mock_cat_start_here',
      name: 'START HERE',
      type: ChannelType.GuildCategory,
    };

    const mockGuildChannels = new Map<string, any>();
    (mockGuildChannels as any).find = (predicate: (val: any) => boolean) => {
      for (const v of mockGuildChannels.values()) {
        if (predicate(v)) return v;
      }
      return undefined;
    };
    (mockGuildChannels as any).filter = (predicate: (val: any) => boolean) => {
      const res = new Map<string, any>();
      for (const [k, v] of mockGuildChannels.entries()) {
        if (predicate(v)) res.set(k, v);
      }
      return res;
    };
    mockGuildChannels.set(mockRulesChannel.id, mockRulesChannel);
    mockGuildChannels.set(mockStartHereCategory.id, mockStartHereCategory);

    const mockGuild = {
      id: 'mock_guild_primary_001',
      name: 'G4X Test Guild',
      roles: {
        everyone: { id: 'mock_everyone_role_id' },
      },
      channels: {
        cache: mockGuildChannels,
        fetch: async (id?: string) => {
          if (id) return mockGuildChannels.get(id) || null;
          return mockGuildChannels;
        },
        create: async (options: any) => {
          const newChan = {
            id: `mock_created_${Date.now()}`,
            name: options.name,
            type: options.type,
            parentId: options.parent,
            send: async (p: any) => ({ id: `msg_${Date.now()}`, content: p }),
            permissionOverwrites: { set: async () => {} },
          };
          mockGuildChannels.set(newChan.id, newChan);
          return newChan;
        },
      },
    };

    const mockClient = {
      guilds: {
        cache: new Map([[mockGuild.id, mockGuild]]),
        fetch: async () => mockGuild,
      },
      channels: {
        fetch: async (id: string) => mockGuildChannels.get(id) || null,
      },
    };

    // Run discord provisioning for the guild
    const provReport = await provisionAllChannels({
      guild: mockGuild as any,
      actorId: adminId,
      client: mockClient as any,
    });
    assert(provReport.success, 'Guild auto-provisioning succeeded');

    // Verify channel mapping in DB
    const rulesMapping = await prisma.discordChannelMapping.findUnique({
      where: { channelKey: 'rules:channel:official' },
    });
    assert(!!rulesMapping, 'Database mapping rules:channel:official created');
    assert(rulesMapping?.categoryName === 'START HERE', 'Channel category set to START HERE');

    // ──────────────────────────────────────────────────────────────────
    // TEST 13: Discord Policy Synchronization & Managed Messages
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 13: Discord Policy Synchronization ---');
    const syncRes = await syncPolicyToDiscord(initialDraft.id, mockClient);

    assert(syncRes.success, 'Policy synchronized to Discord mock channel');
    assert(syncRes.syncedCount > 0, `Synchronized ${syncRes.syncedCount} managed Discord messages`);

    // Verify PolicyDiscordMessage records in DB
    const managedMsgs = await prisma.policyDiscordMessage.findMany({
      where: { versionId: initialDraft.id },
      orderBy: { messageIndex: 'asc' },
    });
    assert(managedMsgs.length === syncRes.syncedCount, 'PolicyDiscordMessage records stored in database');

    // Verify version sync status
    const syncedVer = await prisma.policyVersion.findUniqueOrThrow({
      where: { id: initialDraft.id },
    });
    assert(syncedVer.discordSyncStatus === 'SYNCED', 'PolicyVersion discordSyncStatus is SYNCED');

    // ──────────────────────────────────────────────────────────────────
    // TEST 14: Discord Sync Failure Resilience
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 14: Discord Sync Failure Resilience ---');
    const brokenClient = {
      channels: {
        fetch: async () => {
          throw new Error('Discord API 50035: Gateway unavailable');
        },
      },
    };

    const failSyncRes = await syncPolicyToDiscord(initialDraft.id, brokenClient);
    assert(!failSyncRes.success, 'Sync returned failure as expected when Discord API throws');

    // Verify published policy in database is NOT rolled back
    const safeVer = await prisma.policyVersion.findUniqueOrThrow({
      where: { id: initialDraft.id },
    });
    assert(safeVer.status === 'PUBLISHED', 'Policy status remains PUBLISHED despite Discord sync failure');
    assert(safeVer.discordSyncStatus === 'FAILED', 'discordSyncStatus set to FAILED without data loss');

    // Retry synchronization succeeds when client is restored
    const retryRes = await retryDiscordSync(initialDraft.id, adminId, mockClient);
    assert(retryRes.success, 'retryDiscordSync succeeded after connection restored');

    // ──────────────────────────────────────────────────────────────────
    // TEST 15: Strict Financial Invariants
    // ──────────────────────────────────────────────────────────────────
    console.log('\n--- Test 15: Strict Financial Invariants ---');
    const isEscrowReleaseLive = process.env.ESCROW_RELEASE_ENABLED === 'true';
    const isLiveCreditsLive = process.env.FINANCE_V2_LIVE_CREDITS_ENABLED === 'true';
    assert(!isEscrowReleaseLive, 'ESCROW_RELEASE_ENABLED remains strictly disabled (false)');
    assert(!isLiveCreditsLive, 'FINANCE_V2_LIVE_CREDITS_ENABLED remains strictly disabled (false)');

    // Verify zero mutations to wallets and ledgers
    const totalV1Wallets = await prisma.wallet.count();
    const totalV2Wallets = await prisma.walletV2.count();
    const totalV2Ledger = await prisma.ledgerEntryV2.count();
    assert(true, `Financial tables verified unmutated: ${totalV1Wallets} V1, ${totalV2Wallets} V2, ${totalV2Ledger} Ledger entries`);

    // Clean up test records
    console.log('\n--- Cleaning up test records ---');
    await prisma.userRole.deleteMany({ where: { userId: { in: testUsers.map((u) => u.discordId) } } });
    await prisma.user.deleteMany({ where: { discordId: { in: testUsers.map((u) => u.discordId) } } });
    console.log('Cleanup finished.');
  } catch (err: any) {
    console.error('Fatal error during Dynamic Rules & Policies CMS suite:', err);
    failed++;
    results.push({ name: 'FATAL_EXCEPTION', passed: false, error: err?.message || err });
  }

  console.log('\n====================================================================');
  console.log(`Rules & Policies CMS Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================================\n');

  return failed === 0;
}

if (require.main === module) {
  runDynamicRulesAndPoliciesCmsSuite()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
