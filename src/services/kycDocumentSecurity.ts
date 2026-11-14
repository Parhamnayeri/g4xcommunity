/**
 * src/services/kycDocumentSecurity.ts — Secure KYC Document Validation & Canonical Storage Management
 * 
 * Hardened validation invariants:
 *  1. Never trust client-supplied filenames or document references alone.
 *  2. Validate canonical file paths, realpath containment within secure KYC storage.
 *  3. Strictly reject path traversal tokens (../, ..\, absolute paths, separator characters).
 *  4. Strictly reject symbolic links (symlinks) to prevent directory escape.
 *  5. Enforce safe alphanumeric and approved extension whitelist (.png, .jpg, .jpeg, .webp, .pdf).
 *  6. Verify document file actually exists on physical disk with non-zero size.
 *  7. Ensure document reference association to the specific application record.
 *  8. Never log, leak, or expose raw identity document bytes.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import prisma from '../database/db';
import { getGlobalDiscordClient } from './orderDiscordService';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const KYC_DOCS_DIR = path.join(process.cwd(), 'storage', 'kyc_documents');

// Ensure secure storage directory exists
if (!fs.existsSync(KYC_DOCS_DIR)) {
  fs.mkdirSync(KYC_DOCS_DIR, { recursive: true });
}

export interface KycValidationResult {
  valid: boolean;
  error?: string;
  baseName?: string;
  canonicalPath?: string;
}

const SAFE_DOC_REGEX = /^[a-zA-Z0-9_\-\.]+\.(png|jpg|jpeg|webp|pdf)$/i;

/**
 * Validates a KYC document reference string and confirms the underlying file's integrity on disk.
 */
export function validateKycDocumentReference(
  rawRef: string | null | undefined,
  kycDir: string = KYC_DOCS_DIR
): KycValidationResult {
  if (!rawRef || typeof rawRef !== 'string' || !rawRef.trim()) {
    return { valid: false, error: 'EMPTY_REFERENCE' };
  }

  const trimmed = rawRef.trim();

  // 1. Strict traversal and path injection defense
  if (
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    path.basename(trimmed) !== trimmed
  ) {
    return { valid: false, error: 'PATH_TRAVERSAL_DETECTED' };
  }

  // 2. Strict character and extension whitelist
  if (!SAFE_DOC_REGEX.test(trimmed)) {
    return { valid: false, error: 'DISALLOWED_DOC_TYPE' };
  }

  // 3. Confirm target directory existence
  if (!fs.existsSync(kycDir)) {
    return { valid: false, error: 'STORAGE_DIR_NOT_FOUND' };
  }

  const targetPath = path.resolve(kycDir, trimmed);

  // 4. File existence check
  if (!fs.existsSync(targetPath)) {
    return { valid: false, error: 'DOCUMENT_NOT_FOUND' };
  }

  // 5. Symbolic link defense
  try {
    const lstat = fs.lstatSync(targetPath);
    if (lstat.isSymbolicLink()) {
      return { valid: false, error: 'ILLEGAL_LINK_DETECTED' };
    }
  } catch {
    return { valid: false, error: 'FILE_INSPECTION_FAILED' };
  }

  // 6. Canonical realpath containment check
  try {
    const realKycDir = fs.realpathSync(kycDir);
    const canonicalPath = fs.realpathSync(targetPath);

    if (!canonicalPath.startsWith(realKycDir + path.sep)) {
      return { valid: false, error: 'PATH_TRAVERSAL_DETECTED' };
    }

    const stat = fs.statSync(canonicalPath);
    if (!stat.isFile()) {
      return { valid: false, error: 'INVALID_FILE_TYPE' };
    }

    if (stat.size <= 0) {
      return { valid: false, error: 'EMPTY_FILE' };
    }

    return {
      valid: true,
      baseName: trimmed,
      canonicalPath,
    };
  } catch {
    return { valid: false, error: 'CANONICAL_PATH_RESOLUTION_FAILED' };
  }
}

export interface ApplicationKycVerificationResult {
  valid: boolean;
  error?: string;
  registeredDocs: Record<string, string>;
}

/**
 * Validates that all required identity documents for an application physically exist on secure disk,
 * belong to the correct application, and meet category policy requirements.
 */
export function validateApplicationKycDocuments(
  application: {
    category: string;
    qualifications?: string | null;
    userId: string;
    gameSlug?: string | null;
  },
  pilotVerif?: {
    identityDocumentRef?: string | null;
    passportDocumentRef?: string | null;
    selfieDocumentRef?: string | null;
  } | null,
  kycDir: string = KYC_DOCS_DIR
): ApplicationKycVerificationResult {
  let qualDocs: any = {};
  try {
    qualDocs = JSON.parse(application.qualifications || '{}');
  } catch {
    qualDocs = {};
  }

  const registeredDocs: Record<string, string | null> = {
    identity: pilotVerif?.identityDocumentRef || qualDocs?.identityDocumentRef || null,
    passport: pilotVerif?.passportDocumentRef || qualDocs?.passportDocumentRef || null,
    selfie: pilotVerif?.selfieDocumentRef || qualDocs?.selfieDocumentRef || null,
  };

  // Inspect every provided reference for forgery, traversal, symlinks, or missing files
  const verifiedMap: Record<string, string> = {};
  for (const [key, ref] of Object.entries(registeredDocs)) {
    if (ref) {
      const valResult = validateKycDocumentReference(ref, kycDir);
      if (!valResult.valid) {
        return {
          valid: false,
          error: `INVALID_EVIDENCE_${key.toUpperCase()}: ${valResult.error || 'Document validation failed'}`,
          registeredDocs: {},
        };
      }
      verifiedMap[key] = valResult.baseName!;
    }
  }

  if (application.category === 'pilot') {
    const hasValidId = Boolean(verifiedMap.identity);
    const hasValidPassport = Boolean(verifiedMap.passport);
    const hasValidSelfie = Boolean(verifiedMap.selfie);

    if (!((hasValidId || hasValidPassport) && hasValidSelfie)) {
      return {
        valid: false,
        error: 'MANDATORY_EVIDENCE_MISSING: Pilot identity verification requires valid identity/passport and selfie documentation on disk',
        registeredDocs: {},
      };
    }
  } else if (application.category === 'exchanger') {
    const submittedCount = Object.keys(verifiedMap).length;
    if (submittedCount === 0) {
      return {
        valid: false,
        error: 'MANDATORY_EVIDENCE_MISSING: Exchanger identity verification requires valid submitted identity documentation on disk',
        registeredDocs: {},
      };
    }
  } else {
    return {
      valid: false,
      error: 'INELIGIBLE_FOR_IDENTITY_VERIFICATION: Only pilot and exchanger applications undergo KYC identity verification',
      registeredDocs: {},
    };
  }

  return {
    valid: true,
    registeredDocs: verifiedMap,
  };
}

/**
 * Safely writes a base64 encoded document to secure KYC storage.
 * Enforces extension whitelist, file size limit (max 15MB), and random filename.
 */
export async function saveKycDocument(
  fileData: string,
  originalName: string,
  userId: string
): Promise<{ documentRef: string; fileName: string; sizeBytes: number }> {
  if (!fileData || typeof fileData !== 'string') {
    throw new Error('INVALID_PAYLOAD: fileData must be a non-empty string');
  }

  // Strip data URL scheme if present (e.g. data:image/png;base64,...)
  let base64Payload = fileData;
  let detectedExt = '';
  const dataUriMatch = fileData.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9\-\+\.]+);base64,(.+)$/);
  if (dataUriMatch) {
    const mime = dataUriMatch[1].toLowerCase();
    base64Payload = dataUriMatch[2];
    if (mime === 'image/png') detectedExt = 'png';
    else if (mime === 'image/jpeg' || mime === 'image/jpg') detectedExt = 'jpg';
    else if (mime === 'image/webp') detectedExt = 'webp';
    else if (mime === 'application/pdf') detectedExt = 'pdf';
  }

  const rawExt = path.extname(originalName || '').replace(/^\./, '').toLowerCase();
  const ext = detectedExt || rawExt || 'jpg';
  if (!['png', 'jpg', 'jpeg', 'webp', 'pdf'].includes(ext)) {
    throw new Error(`DISALLOWED_EXT: File extension .${ext} is not allowed. Allowed: .png, .jpg, .jpeg, .webp, .pdf`);
  }

  const buffer = Buffer.from(base64Payload, 'base64');
  if (buffer.length === 0) {
    throw new Error('EMPTY_DOCUMENT: Decoded document payload is empty');
  }

  const maxBytes = 15 * 1024 * 1024; // 15MB
  if (buffer.length > maxBytes) {
    throw new Error('FILE_TOO_LARGE: Document exceeds 15MB limit');
  }

  if (!fs.existsSync(KYC_DOCS_DIR)) {
    fs.mkdirSync(KYC_DOCS_DIR, { recursive: true });
  }

  const cleanUserId = userId.replace(/[^a-zA-Z0-9]/g, '_');
  const safeRandom = crypto.randomBytes(6).toString('hex');
  const targetFilename = `kyc_${cleanUserId}_${Date.now()}_${safeRandom}.${ext}`;
  const targetPath = path.resolve(KYC_DOCS_DIR, targetFilename);

  fs.writeFileSync(targetPath, buffer);

  return {
    documentRef: targetFilename,
    fileName: targetFilename,
    sizeBytes: buffer.length,
  };
}

/**
 * Sends a Direct Message to a Discord user with a direct clickable link to /profile/kyc.
 * Gracefully handles closed DMs without throwing or crashing caller.
 */
export async function sendKycRequestDm(
  discordId: string,
  options?: {
    reason?: string;
    requestedBy?: string;
    category?: string;
    applicationId?: number | string;
    client?: any;
  }
): Promise<{ dmSent: boolean; kycUrl: string; error?: string }> {
  const rawBaseUrl =
    process.env.PUBLIC_WEB_URL ||
    process.env.WEB_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3001';
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');
  const kycUrl = `${baseUrl}/profile/kyc`;

  const client = options?.client || getGlobalDiscordClient();
  if (!client) {
    console.warn(`[KYC DM] Discord client unavailable; unable to send DM to ${discordId}. Link: ${kycUrl}`);
    return { dmSent: false, kycUrl, error: 'DISCORD_CLIENT_NOT_AVAILABLE' };
  }

  try {
    const user = await client.users.fetch(discordId).catch(() => null);
    if (!user) {
      console.warn(`[KYC DM] Discord user ${discordId} not found.`);
      return { dmSent: false, kycUrl, error: 'USER_NOT_FOUND' };
    }

    const requestedByText = options?.requestedBy ? ` by staff member **${options.requestedBy}**` : '';
    const reasonText = options?.reason ? `\n\n**Reason / Note:**\n${options.reason}` : '';
    const categoryText = options?.category ? ` for your **${options.category.toUpperCase()}** application` : '';

    const embed = {
      title: '🪪 G4X Identity Verification (KYC) Required',
      description:
        `Hello <@${discordId}>,\n\n` +
        `Identity verification (KYC) has been requested for your G4X Community account${categoryText}${requestedByText}.${reasonText}\n\n` +
        `Please complete your secure identity verification using the link below:\n` +
        `🔗 **[Complete Identity Verification (KYC)](${kycUrl})**\n\n` +
        `*Note: Once your identity is verified, your status will be automatically reused across all platform applications.*`,
      color: 0x8b5cf6,
      fields: [
        {
          name: 'Direct Portal Link',
          value: `[Open Verification Portal](${kycUrl})`,
          inline: true,
        },
        {
          name: 'Platform Status',
          value: '`AWAITING VERIFICATION`',
          inline: true,
        },
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: 'G4X Security & Compliance Team',
      },
    };

    let components: any[] = [];
    if (kycUrl.startsWith('https://')) {
      try {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('Complete Identity Verification')
            .setStyle(ButtonStyle.Link)
            .setURL(kycUrl)
            .setEmoji('🪪')
        );
        components = [row];
      } catch {
        components = [];
      }
    }

    await user.send({
      content: `🪪 **G4X Identity Verification Required**\nPlease visit your verification portal: <${kycUrl}>`,
      embeds: [embed],
      ...(components.length > 0 ? { components } : {}),
    });

    console.log(`[KYC DM] ✅ Successfully sent KYC request DM to user ${discordId} (${kycUrl})`);
    return { dmSent: true, kycUrl };
  } catch (err: any) {
    console.warn(`[KYC DM] ❌ Could not send KYC DM to user ${discordId}:`, err?.message || err);
    return { dmSent: false, kycUrl, error: err?.message || 'DM_DELIVERY_FAILED' };
  }
}

/**
 * Queries the authoritative KYC and identity verification status of a user.
 * Implements Single-Verification Reuse: if PilotVerification is approved or an application
 * has identityStatus === 'verified', user is considered globally KYC verified.
 */
export async function getUserKycStatus(userId: string): Promise<{
  isVerified: boolean;
  status: 'verified' | 'pending' | 'rejected' | 'none';
  verifiedAt: Date | null;
  pilotVerification: any | null;
  latestApplication: any | null;
  documents: {
    identity: string | null;
    passport: string | null;
    selfie: string | null;
  };
  profileData: {
    legalName?: string;
    country?: string;
    idNumber?: string;
    phoneNumber?: string;
    vpnConfirmed?: boolean;
    adminNotes?: string;
  };
}> {
  const [approvedVerif, anyVerif, latestApp, user] = await Promise.all([
    prisma.pilotVerification.findFirst({
      where: { userId, status: 'approved' },
      orderBy: { reviewedAt: 'desc' },
    }),
    prisma.pilotVerification.findFirst({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
    }),
    prisma.registrationApplication.findFirst({
      where: {
        userId,
        OR: [
          { identityStatus: { in: ['verified', 'awaiting_submission'] } },
          { category: { in: ['pilot', 'exchanger', 'advertiser'] } },
        ],
      },
      orderBy: { submittedAt: 'desc' },
    }),
    prisma.user.findUnique({
      where: { discordId: userId },
      select: { phoneNumber: true },
    }),
  ]);

  const activeVerif = approvedVerif || anyVerif;
  const isVerified = Boolean(
    approvedVerif ||
    (latestApp && latestApp.identityStatus === 'verified')
  );

  let status: 'verified' | 'pending' | 'rejected' | 'none' = 'none';
  if (isVerified) {
    status = 'verified';
  } else if (
    (activeVerif && activeVerif.status === 'pending') ||
    (latestApp && ['awaiting_submission', 'under_review'].includes(latestApp.identityStatus)) ||
    (latestApp && ['pending', 'awaiting_identity_verification', 'under_review'].includes(latestApp.status))
  ) {
    status = 'pending';
  } else if (
    (activeVerif && activeVerif.status === 'rejected') ||
    (latestApp && (latestApp.identityStatus === 'rejected' || latestApp.status === 'rejected'))
  ) {
    status = 'rejected';
  }

  let qualData: any = {};
  if (latestApp?.qualifications) {
    try {
      qualData = JSON.parse(latestApp.qualifications);
    } catch {
      qualData = {};
    }
  }

  return {
    isVerified,
    status,
    verifiedAt: approvedVerif?.reviewedAt || (latestApp?.identityStatus === 'verified' ? latestApp.reviewedAt : null),
    pilotVerification: activeVerif
      ? {
          id: activeVerif.id,
          status: activeVerif.status,
          gameSlug: activeVerif.gameSlug,
          submittedAt: activeVerif.submittedAt,
          reviewedAt: activeVerif.reviewedAt,
          reviewNote: activeVerif.reviewNote,
        }
      : null,
    latestApplication: latestApp
      ? {
          id: latestApp.id,
          category: latestApp.category,
          status: latestApp.status,
          identityStatus: latestApp.identityStatus,
          submittedAt: latestApp.submittedAt,
          reviewedAt: latestApp.reviewedAt,
          reviewNotes: latestApp.reviewNotes,
        }
      : null,
    documents: {
      identity: activeVerif?.identityDocumentRef || qualData?.identityDocumentRef || null,
      passport: activeVerif?.passportDocumentRef || qualData?.passportDocumentRef || null,
      selfie: activeVerif?.selfieDocumentRef || qualData?.selfieDocumentRef || null,
    },
    profileData: {
      legalName: qualData?.legalName || undefined,
      country: qualData?.country || undefined,
      idNumber: qualData?.idNumber || undefined,
      phoneNumber: qualData?.phoneNumber || user?.phoneNumber || undefined,
      vpnConfirmed: qualData?.vpnConfirmed ?? undefined,
      adminNotes: qualData?.adminNotes || activeVerif?.reviewNote || undefined,
    },
  };
}

/**
 * Allows authorized staff / admin / owner to complete, update, and optionally verify KYC on behalf of a user.
 */
export async function assistUserKyc(input: {
  targetUserId: string;
  actorId: string;
  legalName?: string;
  country?: string;
  idType?: string;
  idNumber?: string;
  phoneNumber?: string;
  vpnConfirmed?: boolean;
  adminNotes?: string;
  identityDocData?: string;
  identityDocName?: string;
  selfieDocData?: string;
  selfieDocName?: string;
  markAsVerified?: boolean;
}) {
  const { targetUserId, actorId, markAsVerified = false } = input;

  // Save documents if provided
  let identityDocRef: string | null = null;
  let selfieDocRef: string | null = null;

  if (input.identityDocData) {
    const saved = await saveKycDocument(input.identityDocData, input.identityDocName || 'identity_doc.jpg', targetUserId);
    identityDocRef = saved.documentRef;
  }
  if (input.selfieDocData) {
    const saved = await saveKycDocument(input.selfieDocData, input.selfieDocName || 'selfie_doc.jpg', targetUserId);
    selfieDocRef = saved.documentRef;
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Update User phone number if provided
    if (input.phoneNumber && input.phoneNumber.trim()) {
      await tx.user.update({
        where: { discordId: targetUserId },
        data: { phoneNumber: input.phoneNumber.trim() },
      }).catch(() => {});
    }

    // 2. Find or create PilotVerification record
    const existingVerif = await tx.pilotVerification.findFirst({
      where: { userId: targetUserId },
      orderBy: { submittedAt: 'desc' },
    });

    const newStatus = markAsVerified ? 'approved' : 'pending';
    const reviewNote = input.adminNotes || (markAsVerified ? 'KYC assisted and verified by staff' : 'Assisted KYC under review');

    let verifRecord;
    if (existingVerif) {
      verifRecord = await tx.pilotVerification.update({
        where: { id: existingVerif.id },
        data: {
          status: newStatus,
          reviewedBy: markAsVerified ? actorId : existingVerif.reviewedBy,
          reviewedAt: markAsVerified ? new Date() : existingVerif.reviewedAt,
          reviewNote,
          ...(identityDocRef ? { identityDocumentRef: identityDocRef } : {}),
          ...(selfieDocRef ? { selfieDocumentRef: selfieDocRef } : {}),
        },
      });
    } else {
      verifRecord = await tx.pilotVerification.create({
        data: {
          userId: targetUserId,
          gameSlug: 'wow_midnight',
          status: newStatus,
          identityDocumentRef: identityDocRef,
          selfieDocumentRef: selfieDocRef,
          reviewedBy: markAsVerified ? actorId : null,
          reviewedAt: markAsVerified ? new Date() : null,
          reviewNote,
        },
      });
    }

    // 3. Find active registration application or create one to maintain history
    const existingApp = await tx.registrationApplication.findFirst({
      where: {
        userId: targetUserId,
        status: { in: ['pending', 'under_review', 'awaiting_identity_verification', 'info_requested'] },
      },
      orderBy: { submittedAt: 'desc' },
    });

    let qualData: any = {};
    if (existingApp?.qualifications) {
      try { qualData = JSON.parse(existingApp.qualifications); } catch { qualData = {}; }
    }

    qualData = {
      ...qualData,
      legalName: input.legalName || qualData.legalName,
      country: input.country || qualData.country,
      idType: input.idType || qualData.idType,
      idNumber: input.idNumber || qualData.idNumber,
      phoneNumber: input.phoneNumber || qualData.phoneNumber,
      vpnConfirmed: input.vpnConfirmed !== undefined ? input.vpnConfirmed : qualData.vpnConfirmed,
      adminNotes: input.adminNotes || qualData.adminNotes,
      assistedBy: actorId,
      assistedAt: new Date().toISOString(),
      ...(identityDocRef ? { identityDocumentRef: identityDocRef } : {}),
      ...(selfieDocRef ? { selfieDocumentRef: selfieDocRef } : {}),
    };

    let appRecord;
    if (existingApp) {
      appRecord = await tx.registrationApplication.update({
        where: { id: existingApp.id },
        data: {
          qualifications: JSON.stringify(qualData),
          identityStatus: markAsVerified ? 'verified' : 'under_review',
          reviewedById: markAsVerified ? actorId : existingApp.reviewedById,
          reviewedAt: markAsVerified ? new Date() : existingApp.reviewedAt,
          reviewNotes: reviewNote,
        },
      });
    } else {
      appRecord = await tx.registrationApplication.create({
        data: {
          userId: targetUserId,
          category: 'pilot',
          gameSlug: 'wow_midnight',
          preferredLanguage: 'en',
          qualifications: JSON.stringify(qualData),
          status: markAsVerified ? 'under_review' : 'pending',
          identityStatus: markAsVerified ? 'verified' : 'under_review',
          roleSyncStatus: 'pending',
          reviewedById: markAsVerified ? actorId : null,
          reviewedAt: markAsVerified ? new Date() : null,
          reviewNotes: reviewNote,
        },
      });
    }

    // 4. Audit Log Entry
    let validActorId: string | null = null;
    if (actorId) {
      const userExists = await tx.user.findUnique({
        where: { discordId: actorId },
        select: { discordId: true },
      });
      if (userExists) validActorId = userExists.discordId;
    }

    await tx.auditLog.create({
      data: {
        actorId: validActorId,
        action: markAsVerified ? 'ADMIN_ASSISTED_KYC_VERIFIED' : 'ADMIN_ASSISTED_KYC_UPDATED',
        entityType: 'UserKyc',
        entityId: targetUserId,
        newValues: JSON.stringify({
          legalName: input.legalName,
          country: input.country,
          idType: input.idType,
          idNumber: input.idNumber,
          markAsVerified,
          adminNotes: input.adminNotes,
          verificationId: verifRecord.id,
          applicationId: appRecord.id,
        }),
        reason: input.adminNotes || (markAsVerified ? 'Assisted KYC marked as verified by staff' : 'Assisted KYC data updated by staff'),
        isSuccess: true,
      },
    });

    return {
      success: true,
      isVerified: markAsVerified,
      verification: verifRecord,
      application: appRecord,
    };
  });
}
