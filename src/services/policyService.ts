/**
 * policyService.ts — Authoritative Dynamic Rules & Policies Management & Discord Sync
 *
 * G4X Community — Rules & Policies CMS
 * Stack: Node.js, TypeScript, Prisma, Discord.js v14
 *
 * Responsibilities:
 *  - Authoritative database-backed storage of versioned community rules
 *  - Verbatim initial seed with 6 primary sections & commission tables
 *  - Immutable version snapshots (DRAFT -> PUBLISHED -> ARCHIVED)
 *  - Diff comparison and section management
 *  - Safe markdown sanitization
 *  - Discord channel synchronization with persistent message editing (chunking <= 2000 chars)
 *  - Audit logging of all policy actions
 */

import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import { authorize } from './authorizationService';
import { Permission } from './permissionTypes';
import {
  INITIAL_POLICY_RAW_TEXT,
  INITIAL_SECTIONS_SEED,
  buildMarkdownFromSections,
  PolicySectionSeed,
} from './policyContentConstants';
import { getPolicyDiscrepancyWarnings, PolicyDiscrepancyWarning } from './policyDiscrepancies';

export interface PolicyVersionDTO {
  id: number;
  documentId: number;
  versionNumber: number;
  status: string;
  title: string;
  effectiveDate: string | null;
  publishedAt: string | null;
  authorDiscordId: string;
  publisherDiscordId: string | null;
  lastEditorDiscordId: string | null;
  changelog: string | null;
  discordSyncStatus: string;
  discordSyncResult: string | null;
  discordSyncedAt: string | null;
  rawContentMarkdown: string;
  sections: Array<{
    id: number;
    sectionNumber: number;
    sectionKey: string;
    title: string;
    sortOrder: number;
    isActive: boolean;
    content: string | null;
    subsections: Array<{
      id: number;
      subsectionKey: string | null;
      title: string;
      sortOrder: number;
      content: string;
      contentType: string;
      tableDataJson: string | null;
      isActive: boolean;
    }>;
  }>;
}

/**
 * Strips potentially dangerous executable tags / script injections from markdown.
 */
export function sanitizePolicyMarkdown(content: string): string {
  if (!content) return '';
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')
    .replace(/javascript:/gi, 'blocked:')
    .replace(/data:text\/html/gi, 'blocked:')
    .replace(/onload\s*=/gi, 'blocked=')
    .replace(/onerror\s*=/gi, 'blocked=')
    .replace(/onclick\s*=/gi, 'blocked=');
}

/**
 * Authoritative RBAC check: Policy editing and publishing is restricted to Admin and Owner only.
 */
export async function requirePolicyAdmin(actorId: string): Promise<void> {
  if (!actorId) {
    throw new DomainError(DomainErrorCode.PERMISSION_DENIED, 'Permission Denied: Actor ID is required.');
  }
  const user = await prisma.user.findUnique({
    where: { discordId: actorId },
    include: { userRoles: true },
  });
  if (!user || !user.isActive) {
    throw new DomainError(DomainErrorCode.PERMISSION_DENIED, 'Permission Denied: User not found or inactive.');
  }
  const roles = user.userRoles.map((r) => r.roleKey);
  if (!roles.includes('admin') && !roles.includes('owner')) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      'Permission Denied: Policy management is strictly restricted to Admin and Owner roles.'
    );
  }
}

/**
 * Idempotently seeds the initial policy draft from the exact user-supplied text.
 * Never overwrites already modified or published policies.
 */
export async function seedInitialPolicyDraft(actorId = 'system'): Promise<any> {
  let doc = await prisma.policyDocument.findUnique({
    where: { slug: 'community-rules' },
    include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
  });

  if (!doc) {
    doc = await prisma.policyDocument.create({
      data: {
        slug: 'community-rules',
        title: 'G4X Community Official Policy & Rules',
        description: 'Authoritative rules and operating guidelines for G4X Community members, boosters, advertisers, and exchangers.',
      },
      include: { versions: true },
    });
  }

  // If versions exist, do not overwrite!
  if (doc.versions && doc.versions.length > 0) {
    return doc.versions[0];
  }

  // Create Version 1 as DRAFT
  const rawMarkdown = buildMarkdownFromSections(
    'G4X Community Official Policy & Rules',
    INITIAL_SECTIONS_SEED
  );

  const initialVersion = await prisma.policyVersion.create({
    data: {
      documentId: doc.id,
      versionNumber: 1,
      status: 'DRAFT',
      title: 'G4X Community Official Policy & Rules',
      effectiveDate: new Date(),
      authorDiscordId: actorId,
      lastEditorDiscordId: actorId,
      changelog: 'Initial official policy draft imported from canonical community policy.',
      discordSyncStatus: 'NOT_CONFIGURED',
      rawContentMarkdown: rawMarkdown,
      sections: {
        create: INITIAL_SECTIONS_SEED.map((sec) => ({
          sectionNumber: sec.sectionNumber,
          sectionKey: sec.sectionKey,
          title: sec.title,
          sortOrder: sec.sortOrder,
          content: sec.content || null,
          subsections: {
            create: sec.subsections.map((sub) => ({
              subsectionKey: sub.subsectionKey || null,
              title: sub.title,
              sortOrder: sub.sortOrder,
              content: sub.content,
              contentType: sub.contentType,
              tableDataJson: sub.tableDataJson || null,
            })),
          },
        })),
      },
    },
    include: {
      sections: {
        include: { subsections: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  // Record audit log
  await prisma.auditLog.create({
    data: {
      action: 'ACTION_POLICY_INITIALIZED',
      entityType: 'PolicyVersion',
      entityId: `policy_ver_${initialVersion.id}`,
      actorId: actorId !== 'system' ? actorId : null,
      reason: 'Initial G4X Official Policy & Rules document seeded as DRAFT.',
      newValues: JSON.stringify({
        versionId: initialVersion.id,
        versionNumber: 1,
        status: 'DRAFT',
        sectionCount: INITIAL_SECTIONS_SEED.length,
      }),
    },
  });

  return initialVersion;
}

/**
 * Returns the currently active PUBLISHED policy. Public access.
 * Returns null if no version has been published yet.
 */
export async function getPublishedPolicy(slug = 'community-rules'): Promise<PolicyVersionDTO | null> {
  const doc = await prisma.policyDocument.findUnique({
    where: { slug },
  });

  if (!doc || !doc.currentPublishedVersionId) {
    return null;
  }

  const ver = await prisma.policyVersion.findFirst({
    where: {
      id: doc.currentPublishedVersionId,
      documentId: doc.id,
      status: 'PUBLISHED',
    },
    include: {
      sections: {
        where: { isActive: true },
        include: {
          subsections: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!ver) return null;

  return {
    id: ver.id,
    documentId: ver.documentId,
    versionNumber: ver.versionNumber,
    status: ver.status,
    title: ver.title,
    effectiveDate: ver.effectiveDate ? ver.effectiveDate.toISOString() : null,
    publishedAt: ver.publishedAt ? ver.publishedAt.toISOString() : null,
    authorDiscordId: ver.authorDiscordId,
    publisherDiscordId: ver.publisherDiscordId,
    lastEditorDiscordId: ver.lastEditorDiscordId,
    changelog: ver.changelog,
    discordSyncStatus: ver.discordSyncStatus,
    discordSyncResult: ver.discordSyncResult,
    discordSyncedAt: ver.discordSyncedAt ? ver.discordSyncedAt.toISOString() : null,
    rawContentMarkdown: ver.rawContentMarkdown,
    sections: ver.sections.map((s) => ({
      id: s.id,
      sectionNumber: s.sectionNumber,
      sectionKey: s.sectionKey,
      title: s.title,
      sortOrder: s.sortOrder,
      isActive: s.isActive,
      content: s.content,
      subsections: s.subsections.map((sub) => ({
        id: sub.id,
        subsectionKey: sub.subsectionKey,
        title: sub.title,
        sortOrder: sub.sortOrder,
        content: sub.content,
        contentType: sub.contentType,
        tableDataJson: sub.tableDataJson,
        isActive: sub.isActive,
      })),
    })),
  };
}

/**
 * Returns the current DRAFT policy or creates a new draft version for editing. Admin/Owner only.
 */
export async function getDraftOrActivePolicy(
  slug = 'community-rules',
  actorId: string
): Promise<{
  document: any;
  draftVersion: PolicyVersionDTO;
  publishedVersion: PolicyVersionDTO | null;
  discrepancies: PolicyDiscrepancyWarning[];
}> {
  let doc = await prisma.policyDocument.findUnique({
    where: { slug },
  });

  if (!doc) {
    await seedInitialPolicyDraft(actorId);
    doc = await prisma.policyDocument.findUniqueOrThrow({ where: { slug } });
  }

  // Look for existing DRAFT
  let draft = await prisma.policyVersion.findFirst({
    where: { documentId: doc.id, status: 'DRAFT' },
    include: {
      sections: {
        include: { subsections: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { versionNumber: 'desc' },
  });

  // If no draft exists, fork from latest published version or seed
  if (!draft) {
    const latest = await prisma.policyVersion.findFirst({
      where: { documentId: doc.id },
      include: {
        sections: {
          include: { subsections: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { versionNumber: 'desc' },
    });

    if (latest) {
      const nextVerNum = latest.versionNumber + 1;
      draft = await prisma.policyVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: nextVerNum,
          status: 'DRAFT',
          title: latest.title,
          effectiveDate: new Date(),
          authorDiscordId: actorId,
          lastEditorDiscordId: actorId,
          changelog: `Draft version ${nextVerNum} created for edits.`,
          discordSyncStatus: 'NOT_CONFIGURED',
          rawContentMarkdown: latest.rawContentMarkdown,
          sections: {
            create: latest.sections.map((s) => ({
              sectionNumber: s.sectionNumber,
              sectionKey: s.sectionKey,
              title: s.title,
              sortOrder: s.sortOrder,
              isActive: s.isActive,
              content: s.content,
              subsections: {
                create: s.subsections.map((sub) => ({
                  subsectionKey: sub.subsectionKey,
                  title: sub.title,
                  sortOrder: sub.sortOrder,
                  content: sub.content,
                  contentType: sub.contentType,
                  tableDataJson: sub.tableDataJson,
                  isActive: sub.isActive,
                })),
              },
            })),
          },
        },
        include: {
          sections: {
            include: { subsections: { orderBy: { sortOrder: 'asc' } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
      });
    } else {
      draft = await seedInitialPolicyDraft(actorId);
    }
  }

  const published = await getPublishedPolicy(slug);
  const discrepancies = getPolicyDiscrepancyWarnings();

  const formatDTO = (ver: any): PolicyVersionDTO => ({
    id: ver.id,
    documentId: ver.documentId,
    versionNumber: ver.versionNumber,
    status: ver.status,
    title: ver.title,
    effectiveDate: ver.effectiveDate ? ver.effectiveDate.toISOString() : null,
    publishedAt: ver.publishedAt ? ver.publishedAt.toISOString() : null,
    authorDiscordId: ver.authorDiscordId,
    publisherDiscordId: ver.publisherDiscordId,
    lastEditorDiscordId: ver.lastEditorDiscordId,
    changelog: ver.changelog,
    discordSyncStatus: ver.discordSyncStatus,
    discordSyncResult: ver.discordSyncResult,
    discordSyncedAt: ver.discordSyncedAt ? ver.discordSyncedAt.toISOString() : null,
    rawContentMarkdown: ver.rawContentMarkdown,
    sections: ver.sections.map((s: any) => ({
      id: s.id,
      sectionNumber: s.sectionNumber,
      sectionKey: s.sectionKey,
      title: s.title,
      sortOrder: s.sortOrder,
      isActive: s.isActive,
      content: s.content,
      subsections: s.subsections.map((sub: any) => ({
        id: sub.id,
        subsectionKey: sub.subsectionKey,
        title: sub.title,
        sortOrder: sub.sortOrder,
        content: sub.content,
        contentType: sub.contentType,
        tableDataJson: sub.tableDataJson,
        isActive: sub.isActive,
      })),
    })),
  });

  return {
    document: {
      id: doc.id,
      slug: doc.slug,
      title: doc.title,
      currentPublishedVersionId: doc.currentPublishedVersionId,
    },
    draftVersion: formatDTO(draft),
    publishedVersion: published,
    discrepancies,
  };
}

/**
 * Saves modifications to an existing DRAFT version. Admin/Owner only.
 */
export async function saveDraftPolicy(params: {
  versionId: number;
  title: string;
  effectiveDate?: string | Date | null;
  changelog?: string;
  sections: Array<{
    id?: number;
    sectionNumber: number;
    sectionKey: string;
    title: string;
    sortOrder: number;
    isActive?: boolean;
    content?: string | null;
    subsections: Array<{
      id?: number;
      subsectionKey?: string | null;
      title: string;
      sortOrder: number;
      content: string;
      contentType?: string;
      tableDataJson?: string | null;
      isActive?: boolean;
    }>;
  }>;
  actorId: string;
}): Promise<PolicyVersionDTO> {
  const { versionId, title, effectiveDate, changelog, sections, actorId } = params;

  // Authorization check: Admin or Owner required
  await requirePolicyAdmin(actorId);

  const ver = await prisma.policyVersion.findUnique({
    where: { id: versionId },
    include: { sections: { include: { subsections: true } } },
  });

  if (!ver) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, `Policy version #${versionId} not found.`);
  }

  if (ver.status !== 'DRAFT') {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Cannot edit version #${ver.versionNumber} because it is ${ver.status}. Edits are permitted on DRAFT only.`
    );
  }

  // Sanitize all contents
  const sanitizedSections: PolicySectionSeed[] = sections.map((s, sIdx) => ({
    sectionNumber: s.sectionNumber || sIdx + 1,
    sectionKey: s.sectionKey || `sec_${sIdx + 1}`,
    title: sanitizePolicyMarkdown(s.title),
    sortOrder: s.sortOrder ?? sIdx,
    content: s.content ? sanitizePolicyMarkdown(s.content) : undefined,
    subsections: s.subsections.map((sub, subIdx) => ({
      subsectionKey: sub.subsectionKey || `sub_${sIdx + 1}_${subIdx + 1}`,
      title: sanitizePolicyMarkdown(sub.title),
      sortOrder: sub.sortOrder ?? subIdx,
      content: sanitizePolicyMarkdown(sub.content),
      contentType: (sub.contentType as any) || 'MARKDOWN',
      tableDataJson: sub.tableDataJson || undefined,
    })),
  }));

  const compiledMarkdown = buildMarkdownFromSections(sanitizePolicyMarkdown(title), sanitizedSections);

  // Atomic database update using transaction
  await prisma.$transaction(async (tx) => {
    // Delete existing sections & subsections for clean replacement
    await tx.policySubsection.deleteMany({
      where: { section: { versionId } },
    });
    await tx.policySection.deleteMany({
      where: { versionId },
    });

    // Recreate sections
    for (const sec of sanitizedSections) {
      await tx.policySection.create({
        data: {
          versionId,
          sectionNumber: sec.sectionNumber,
          sectionKey: sec.sectionKey,
          title: sec.title,
          sortOrder: sec.sortOrder,
          content: sec.content || null,
          subsections: {
            create: sec.subsections.map((sub) => ({
              subsectionKey: sub.subsectionKey || null,
              title: sub.title,
              sortOrder: sub.sortOrder,
              content: sub.content,
              contentType: sub.contentType,
              tableDataJson: sub.tableDataJson || null,
            })),
          },
        },
      });
    }

    // Update version metadata
    await tx.policyVersion.update({
      where: { id: versionId },
      data: {
        title: sanitizePolicyMarkdown(title),
        effectiveDate: effectiveDate ? new Date(effectiveDate) : ver.effectiveDate,
        changelog: changelog !== undefined ? changelog : ver.changelog,
        lastEditorDiscordId: actorId,
        rawContentMarkdown: compiledMarkdown,
      },
    });
  });

  // Record audit log
  await prisma.auditLog.create({
    data: {
      action: 'ACTION_POLICY_DRAFT_SAVED',
      entityType: 'PolicyVersion',
      entityId: `policy_ver_${versionId}`,
      actorId,
      reason: `Saved changes to Policy Draft #${versionId} (v${ver.versionNumber}).`,
      newValues: JSON.stringify({
        versionId,
        title,
        sectionCount: sanitizedSections.length,
      }),
    },
  });

  const updated = await prisma.policyVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: {
      sections: {
        include: { subsections: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  return {
    id: updated.id,
    documentId: updated.documentId,
    versionNumber: updated.versionNumber,
    status: updated.status,
    title: updated.title,
    effectiveDate: updated.effectiveDate ? updated.effectiveDate.toISOString() : null,
    publishedAt: updated.publishedAt ? updated.publishedAt.toISOString() : null,
    authorDiscordId: updated.authorDiscordId,
    publisherDiscordId: updated.publisherDiscordId,
    lastEditorDiscordId: updated.lastEditorDiscordId,
    changelog: updated.changelog,
    discordSyncStatus: updated.discordSyncStatus,
    discordSyncResult: updated.discordSyncResult,
    discordSyncedAt: updated.discordSyncedAt ? updated.discordSyncedAt.toISOString() : null,
    rawContentMarkdown: updated.rawContentMarkdown,
    sections: updated.sections.map((s) => ({
      id: s.id,
      sectionNumber: s.sectionNumber,
      sectionKey: s.sectionKey,
      title: s.title,
      sortOrder: s.sortOrder,
      isActive: s.isActive,
      content: s.content,
      subsections: s.subsections.map((sub) => ({
        id: sub.id,
        subsectionKey: sub.subsectionKey,
        title: sub.title,
        sortOrder: sub.sortOrder,
        content: sub.content,
        contentType: sub.contentType,
        tableDataJson: sub.tableDataJson,
        isActive: sub.isActive,
      })),
    })),
  };
}

/**
 * Publishes a DRAFT version. Sets previous published version to ARCHIVED.
 * Atomically marks target version as PUBLISHED and updates document pointer.
 * Triggers Discord synchronization.
 */
export async function publishPolicyVersion(params: {
  versionId: number;
  actorId: string;
  changelog?: string;
  acknowledgedDiscrepancies?: string[];
  discordClient?: any;
}): Promise<PolicyVersionDTO> {
  const { versionId, actorId, changelog, acknowledgedDiscrepancies, discordClient } = params;

  // Authorization check: Admin or Owner required
  await requirePolicyAdmin(actorId);

  const ver = await prisma.policyVersion.findUnique({
    where: { id: versionId },
    include: { document: true, sections: { include: { subsections: true } } },
  });

  if (!ver) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, `Policy version #${versionId} not found.`);
  }

  if (ver.status !== 'DRAFT') {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Version #${ver.versionNumber} is already ${ver.status}. Only DRAFT versions can be published.`
    );
  }

  // Require explicit confirmation of discrepancy warnings
  const warnings = getPolicyDiscrepancyWarnings();
  if (warnings.length > 0 && (!acknowledgedDiscrepancies || acknowledgedDiscrepancies.length === 0)) {
    // Ensure the publisher acknowledged the operational warnings
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      'Policy publication requires acknowledging the operational discrepancy warnings.'
    );
  }

  const now = new Date();

  // Atomically archive previous published versions and publish target version
  await prisma.$transaction(async (tx) => {
    // Archive any currently published versions for this document
    await tx.policyVersion.updateMany({
      where: {
        documentId: ver.documentId,
        status: 'PUBLISHED',
      },
      data: {
        status: 'ARCHIVED',
      },
    });

    // Mark current version as PUBLISHED
    await tx.policyVersion.update({
      where: { id: versionId },
      data: {
        status: 'PUBLISHED',
        publishedAt: now,
        publisherDiscordId: actorId,
        changelog: changelog || ver.changelog,
        discordSyncStatus: 'PENDING',
      },
    });

    // Update document pointer
    await tx.policyDocument.update({
      where: { id: ver.documentId },
      data: {
        currentPublishedVersionId: versionId,
      },
    });
  });

  // Record audit log
  await prisma.auditLog.create({
    data: {
      action: 'ACTION_POLICY_PUBLISHED',
      entityType: 'PolicyVersion',
      entityId: `policy_ver_${versionId}`,
      actorId,
      reason: `Published Policy Version ${ver.versionNumber} ("${ver.title}").`,
      newValues: JSON.stringify({
        versionId,
        versionNumber: ver.versionNumber,
        publishedAt: now.toISOString(),
        acknowledgedCount: acknowledgedDiscrepancies?.length || 0,
      }),
    },
  });

  // Trigger Discord sync (non-blocking for website publication authority)
  try {
    await syncPolicyToDiscord(versionId, discordClient);
  } catch (err: any) {
    console.error('[PolicyService] Discord sync error upon publication:', err);
    // Website publication remains authoritative; sync error recorded in DB
  }

  const published = await getPublishedPolicy(ver.document.slug);
  return published!;
}

/**
 * Restores an older version as a NEW draft version.
 */
export async function restoreVersionAsDraft(params: {
  sourceVersionId: number;
  actorId: string;
}): Promise<PolicyVersionDTO> {
  const { sourceVersionId, actorId } = params;

  await requirePolicyAdmin(actorId);

  const source = await prisma.policyVersion.findUnique({
    where: { id: sourceVersionId },
    include: {
      sections: {
        include: { subsections: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!source) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, `Source version #${sourceVersionId} not found.`);
  }

  // Find max version number
  const maxVer = await prisma.policyVersion.findFirst({
    where: { documentId: source.documentId },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  });

  const nextVerNum = (maxVer?.versionNumber || 1) + 1;

  const newDraft = await prisma.policyVersion.create({
    data: {
      documentId: source.documentId,
      versionNumber: nextVerNum,
      status: 'DRAFT',
      title: source.title,
      effectiveDate: new Date(),
      authorDiscordId: actorId,
      lastEditorDiscordId: actorId,
      changelog: `Restored from version ${source.versionNumber}.`,
      discordSyncStatus: 'NOT_CONFIGURED',
      rawContentMarkdown: source.rawContentMarkdown,
      sections: {
        create: source.sections.map((s) => ({
          sectionNumber: s.sectionNumber,
          sectionKey: s.sectionKey,
          title: s.title,
          sortOrder: s.sortOrder,
          isActive: s.isActive,
          content: s.content,
          subsections: {
            create: s.subsections.map((sub) => ({
              subsectionKey: sub.subsectionKey,
              title: sub.title,
              sortOrder: sub.sortOrder,
              content: sub.content,
              contentType: sub.contentType,
              tableDataJson: sub.tableDataJson,
              isActive: sub.isActive,
            })),
          },
        })),
      },
    },
    include: {
      sections: {
        include: { subsections: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'ACTION_POLICY_RESTORED_TO_DRAFT',
      entityType: 'PolicyVersion',
      entityId: `policy_ver_${newDraft.id}`,
      actorId,
      reason: `Restored Policy Version ${source.versionNumber} as new DRAFT v${nextVerNum}.`,
      newValues: JSON.stringify({
        sourceVersionId,
        newDraftVersionId: newDraft.id,
        versionNumber: nextVerNum,
      }),
    },
  });

  return {
    id: newDraft.id,
    documentId: newDraft.documentId,
    versionNumber: newDraft.versionNumber,
    status: newDraft.status,
    title: newDraft.title,
    effectiveDate: newDraft.effectiveDate ? newDraft.effectiveDate.toISOString() : null,
    publishedAt: null,
    authorDiscordId: newDraft.authorDiscordId,
    publisherDiscordId: null,
    lastEditorDiscordId: newDraft.lastEditorDiscordId,
    changelog: newDraft.changelog,
    discordSyncStatus: newDraft.discordSyncStatus,
    discordSyncResult: null,
    discordSyncedAt: null,
    rawContentMarkdown: newDraft.rawContentMarkdown,
    sections: newDraft.sections.map((s) => ({
      id: s.id,
      sectionNumber: s.sectionNumber,
      sectionKey: s.sectionKey,
      title: s.title,
      sortOrder: s.sortOrder,
      isActive: s.isActive,
      content: s.content,
      subsections: s.subsections.map((sub) => ({
        id: sub.id,
        subsectionKey: sub.subsectionKey,
        title: sub.title,
        sortOrder: sub.sortOrder,
        content: sub.content,
        contentType: sub.contentType,
        tableDataJson: sub.tableDataJson,
        isActive: sub.isActive,
      })),
    })),
  };
}

/**
 * Lists all historical and current versions of a policy document.
 */
export async function listPolicyVersions(slug = 'community-rules'): Promise<any[]> {
  const doc = await prisma.policyDocument.findUnique({
    where: { slug },
  });

  if (!doc) return [];

  const versions = await prisma.policyVersion.findMany({
    where: { documentId: doc.id },
    orderBy: { versionNumber: 'desc' },
    select: {
      id: true,
      versionNumber: true,
      status: true,
      title: true,
      effectiveDate: true,
      publishedAt: true,
      authorDiscordId: true,
      publisherDiscordId: true,
      lastEditorDiscordId: true,
      changelog: true,
      discordSyncStatus: true,
      discordSyncResult: true,
      discordSyncedAt: true,
      createdAt: true,
    },
  });

  return versions.map((v) => ({
    ...v,
    isCurrentPublished: doc.currentPublishedVersionId === v.id,
    effectiveDate: v.effectiveDate ? v.effectiveDate.toISOString() : null,
    publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
  }));
}

/**
 * Splits raw content into chunks that respect Discord's 2,000 character limit.
 */
export function chunkDiscordMessage(content: string, maxLen = 1950): string[] {
  if (content.length <= maxLen) return [content];

  const lines = content.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLen) {
      if (current.trim()) chunks.push(current.trim());
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Synchronizes the published policy to Discord channel `#rules-and-policies`.
 * Formats message chunks <= 2000 characters and updates managed messages.
 */
export async function syncPolicyToDiscord(versionId: number, client?: any): Promise<{
  success: boolean;
  channelId: string | null;
  syncedCount: number;
  error?: string;
}> {
  const ver = await prisma.policyVersion.findUnique({
    where: { id: versionId },
    include: {
      sections: {
        where: { isActive: true },
        include: {
          subsections: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
      discordMessages: true,
    },
  });

  if (!ver || ver.status !== 'PUBLISHED') {
    return {
      success: false,
      channelId: null,
      syncedCount: 0,
      error: 'Only PUBLISHED policy versions can be synchronized to Discord.',
    };
  }

  // Look up channel mapping
  const mapping = await prisma.discordChannelMapping.findUnique({
    where: { channelKey: 'rules:channel:official' },
  });

  const channelId = mapping?.discordChannelId;
  if (!channelId) {
    await prisma.policyVersion.update({
      where: { id: versionId },
      data: {
        discordSyncStatus: 'NOT_CONFIGURED',
        discordSyncResult: 'No Discord channel mapped for rules:channel:official. Run Discord Setup.',
      },
    });
    return {
      success: false,
      channelId: null,
      syncedCount: 0,
      error: 'Rules channel not mapped in discord_channel_mappings.',
    };
  }

  // If no live Discord client provided, check global client or mock
  const activeClient = client || (global as any).discordClient;
  if (!activeClient) {
    // Save pending state
    await prisma.policyVersion.update({
      where: { id: versionId },
      data: {
        discordSyncStatus: 'FAILED',
        discordSyncResult: 'Discord bot client is not connected.',
      },
    });
    return {
      success: false,
      channelId,
      syncedCount: 0,
      error: 'Discord bot client not connected.',
    };
  }

  try {
    const channel = await activeClient.channels.fetch(channelId);
    const isText = channel && (typeof channel.isTextBased === 'function' ? channel.isTextBased() : typeof channel.send === 'function');
    if (!isText) {
      throw new Error(`Channel ID ${channelId} could not be resolved or is not text-based.`);
    }

    // Format policy sections into managed chunks
    const messageBlocks: Array<{ sectionKey: string; content: string }> = [];

    // Header block
    const dateFormatted = ver.effectiveDate ? new Date(ver.effectiveDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Immediate';
    messageBlocks.push({
      sectionKey: 'header',
      content: `# 📜 G4X Community Official Policy & Rules\n**Version:** ${ver.versionNumber}.0 | **Effective Date:** ${dateFormatted}\n🔗 **Authoritative Web Document:** https://g4x.online/rules\n\n> *By operating within the G4X platform, all community members, Boosters, Advertisers, and Exchangers agree to follow these official rules.*`,
    });

    for (const sec of ver.sections) {
      let secText = `## ${sec.title}\n`;
      if (sec.content) secText += `${sec.content}\n\n`;

      for (const sub of sec.subsections) {
        secText += `### ${sub.title}\n${sub.content}\n\n`;
      }

      // Chunk section if it exceeds limit
      const chunks = chunkDiscordMessage(secText.trim(), 1950);
      chunks.forEach((chunk, idx) => {
        messageBlocks.push({
          sectionKey: `${sec.sectionKey}_${idx}`,
          content: chunk,
        });
      });
    }

    // Update existing managed messages or send new ones
    const existingManaged = ver.discordMessages || [];
    let syncedCount = 0;

    for (let i = 0; i < messageBlocks.length; i++) {
      const block = messageBlocks[i];
      const existing = existingManaged.find((m) => m.messageIndex === i);

      let msgId: string | null = null;
      if (existing) {
        try {
          const msg = await channel.messages.fetch(existing.messageId);
          if (msg) {
            await msg.edit(block.content);
            msgId = msg.id;
          }
        } catch {
          // If edit fails (e.g. deleted message), send fresh
        }
      }

      if (!msgId) {
        const sent = await channel.send(block.content);
        msgId = sent?.id || null;
      }

      if (msgId) {
        // Upsert PolicyDiscordMessage record
        if (existing) {
          await prisma.policyDiscordMessage.update({
            where: { id: existing.id },
            data: {
              messageId: msgId,
              channelId,
              sectionKey: block.sectionKey,
              updatedAt: new Date(),
            },
          });
        } else {
          await prisma.policyDiscordMessage.create({
            data: {
              versionId,
              channelId,
              messageId: msgId,
              messageIndex: i,
              sectionKey: block.sectionKey,
            },
          });
        }
        syncedCount++;
      }
    }

    // Mark version as SYNCED
    await prisma.policyVersion.update({
      where: { id: versionId },
      data: {
        discordSyncStatus: 'SYNCED',
        discordSyncResult: `Successfully synchronized ${syncedCount} managed messages to #${channel.name || 'rules-and-policies'}.`,
        discordSyncedAt: new Date(),
      },
    });

    return {
      success: true,
      channelId,
      syncedCount,
    };
  } catch (err: any) {
    console.error('[PolicyService] Failed to sync policy to Discord:', err);
    await prisma.policyVersion.update({
      where: { id: versionId },
      data: {
        discordSyncStatus: 'FAILED',
        discordSyncResult: `Sync error: ${err.message || 'Unknown Discord API error'}`,
      },
    });

    return {
      success: false,
      channelId,
      syncedCount: 0,
      error: err.message || 'Failed to sync to Discord',
    };
  }
}

/**
 * Retries synchronization for a published policy version. Admin/Owner only.
 */
export async function retryDiscordSync(versionId: number, actorId: string, client?: any): Promise<any> {
  await requirePolicyAdmin(actorId);

  const ver = await prisma.policyVersion.findUnique({
    where: { id: versionId },
  });

  if (!ver) {
    throw new DomainError(DomainErrorCode.VALIDATION_ERROR, `Policy version #${versionId} not found.`);
  }

  if (ver.status !== 'PUBLISHED') {
    throw new DomainError(
      DomainErrorCode.VALIDATION_ERROR,
      `Cannot synchronize version #${ver.versionNumber} because it is ${ver.status}. Only PUBLISHED versions can sync to Discord.`
    );
  }

  await prisma.auditLog.create({
    data: {
      action: 'ACTION_POLICY_DISCORD_SYNC_RETRY',
      entityType: 'PolicyVersion',
      entityId: `policy_ver_${versionId}`,
      actorId,
      reason: `Triggered manual Discord sync retry for Policy Version ${ver.versionNumber}.`,
    },
  });

  return await syncPolicyToDiscord(versionId, client);
}
