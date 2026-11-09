/**
 * discordProofSubmissionService.ts — Authoritative Discord-First Proof Submission Service
 *
 * G4X Community — Task 3: Discord-First Booster Hub
 *
 * Rules:
 *  - Boosters submit completion proofs directly inside their assigned private execution channel.
 *  - Enforces channel verification (must be the authoritative active execution channel for the order).
 *  - Enforces booster assignment verification (Discord author must be an actively assigned booster).
 *  - Validates evidence attachment / URL (MIME, size, protocol).
 *  - Records Discord provenance (messageId, channelId, authorId, timestamp) into RunProof and AuditLog.
 *  - Integrates with the authoritative submitRunProof service and Staff review queue.
 *  - Zero financial ledger or wallet balance mutations.
 */

import { EmbedBuilder, Message, ModalSubmitInteraction } from 'discord.js';
import prisma from '../database/db';
import { DomainError, DomainErrorCode } from './domainErrors';
import { submitRunProof, validateEvidenceUrl } from './orderDisputeService';
import { notifyExecutionChannelMilestone } from './orderExecutionChannelService';

export interface DiscordProofSubmissionInput {
  orderId: number;
  runId?: number;
  channelId: string;
  authorDiscordId: string;
  evidenceUrl: string;
  description?: string;
  proofType?: string;
  discordMessageId?: string;
  client?: any;
}

export interface AttachmentValidationResult {
  valid: boolean;
  error?: string;
  sanitizedUrl?: string;
}

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Validates a Discord attachment for completion proof.
 */
export function validateDiscordAttachment(attachment: {
  url: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
}): AttachmentValidationResult {
  if (!attachment || !attachment.url) {
    return { valid: false, error: 'NO_ATTACHMENT: No evidence file or URL provided.' };
  }

  // Validate size if available
  if (typeof attachment.size === 'number' && attachment.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      valid: false,
      error: `FILE_TOO_LARGE: Evidence file exceeds the 10 MB limit (${(attachment.size / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }

  // Validate MIME type if available
  if (attachment.contentType) {
    const cleanType = attachment.contentType.toLowerCase().split(';')[0].trim();
    if (!ALLOWED_MIME_TYPES.includes(cleanType)) {
      return {
        valid: false,
        error: `INVALID_MIME_TYPE: File type '${cleanType}' is not supported. Allowed formats: PNG, JPEG, WEBP, GIF.`,
      };
    }
  } else if (attachment.name) {
    const extMatch = attachment.name.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/);
    if (!extMatch) {
      return {
        valid: false,
        error: `INVALID_FILE_EXTENSION: Allowed file extensions are .png, .jpg, .jpeg, .webp, .gif.`,
      };
    }
  }

  if (!validateEvidenceUrl(attachment.url)) {
    return { valid: false, error: 'INVALID_EVIDENCE_URL: The provided attachment URL failed safety checks.' };
  }

  return { valid: true, sanitizedUrl: attachment.url.trim() };
}

/**
 * Authoritatively processes and records proof submitted inside a private execution channel.
 */
export async function submitDiscordChannelProof(input: DiscordProofSubmissionInput) {
  const {
    orderId,
    channelId,
    authorDiscordId,
    evidenceUrl,
    description,
    proofType = 'screenshot',
    discordMessageId,
    client,
  } = input;

  // 1. Fetch order with active execution channels, assignments and runs
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderChannels: {
        where: { channelType: 'execution', status: 'active' },
      },
      assignments: {
        where: { status: 'assigned' },
      },
      runs: {
        orderBy: { runNumber: 'desc' },
      },
    },
  });

  if (!order) {
    throw new DomainError(DomainErrorCode.ORDER_NOT_FOUND, `Order #${orderId} does not exist.`);
  }

  // 2. Channel Verification: Must be the authoritative active execution channel for this order
  const activeChannel = order.orderChannels.find((c) => c.discordChannelId === channelId);
  if (!activeChannel) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      `INVALID_EXECUTION_CHANNEL: Channel '${channelId}' is not the active execution channel for Order #${orderId}.`
    );
  }

  // 3. Booster Assignment Verification: Author must be an active assigned booster
  const isAssigned = order.assignments.some((a) => a.userId === authorDiscordId);
  if (!isAssigned) {
    throw new DomainError(
      DomainErrorCode.PERMISSION_DENIED,
      `UNASSIGNED_BOOSTER: User <@${authorDiscordId}> is not currently assigned to Order #${orderId}.`
    );
  }

  // 4. Resolve Target Run
  let targetRun = input.runId ? order.runs.find((r) => r.id === input.runId) : null;
  if (!targetRun) {
    // Find active run (pending, in_progress, completed)
    targetRun = order.runs.find((r) => ['in_progress', 'completed', 'pending'].includes(r.status)) || order.runs[0];
  }

  if (!targetRun) {
    // Create run 1 if no runs exist yet
    targetRun = await prisma.orderRun.create({
      data: {
        orderId: order.id,
        runNumber: 1,
        status: 'in_progress',
      },
    });
  }

  // 5. Validate Evidence URL / Reference
  if (!validateEvidenceUrl(evidenceUrl)) {
    throw new DomainError(
      DomainErrorCode.INVALID_EVIDENCE_URL,
      'Invalid evidence URL format. Must be a valid HTTPS image or screenshot reference.'
    );
  }

  // 6. Format description with Discord provenance metadata
  const discordMetadata = {
    source: 'discord_execution_channel',
    channelId,
    messageId: discordMessageId || null,
    authorDiscordId,
    submittedAt: new Date().toISOString(),
  };

  const cleanUserNotes = (description || '').trim();
  const formattedDescription = cleanUserNotes
    ? `${cleanUserNotes} | [Discord Evidence: msg=${discordMessageId || 'N/A'}]`
    : `Submitted via Discord Channel #${channelId} by <@${authorDiscordId}>`;

  // 7. Authoritative Proof Creation via submitRunProof
  const proof = await submitRunProof({
    runId: targetRun.id,
    submittedById: authorDiscordId,
    proofType,
    evidenceUrl: evidenceUrl.trim(),
    description: formattedDescription,
    discordClient: client,
  });

  // 8. Update run status to completed if currently in_progress or pending
  if (['pending', 'in_progress'].includes(targetRun.status)) {
    await prisma.orderRun.update({
      where: { id: targetRun.id },
      data: { status: 'completed' },
    });
  }

  // 9. Notify Milestone (suppresses duplicates within 30s)
  if (client) {
    try {
      await notifyExecutionChannelMilestone(order.id, client, 'PROOF_SUBMITTED', {
        actorId: authorDiscordId,
        notes: `Run #${targetRun.runNumber} proof registered for Staff review.`,
      });
    } catch (milestoneErr) {
      console.warn('[DiscordProofSubmission] Milestone notification notice:', milestoneErr);
    }
  }

  return {
    success: true,
    proof,
    run: targetRun,
    order,
    metadata: discordMetadata,
  };
}

/**
 * Handles modal submit for proof submissions from Discord button clicks.
 */
export async function handleDiscordProofModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const customId = interaction.customId; // modal_order_proof:<orderId>:<runId?>
  const parts = customId.split(':');
  const orderId = Number(parts[1]);
  const runId = parts[2] ? Number(parts[2]) : undefined;

  if (isNaN(orderId) || orderId <= 0) {
    await interaction.reply({ content: '❌ Invalid order ID parameter.', ephemeral: true });
    return;
  }

  const evidenceUrl = interaction.fields.getTextInputValue('evidence_url');
  let description = '';
  try {
    description = interaction.fields.getTextInputValue('description') || '';
  } catch {}

  let proofType = 'screenshot';
  try {
    proofType = interaction.fields.getTextInputValue('proof_type') || 'screenshot';
  } catch {}

  if (!interaction.channelId) {
    await interaction.reply({ content: '❌ Channel context is unavailable.', ephemeral: true });
    return;
  }

  const channelId = interaction.channelId;

  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await submitDiscordChannelProof({
      orderId,
      runId,
      channelId,
      authorDiscordId: interaction.user.id,
      evidenceUrl,
      description,
      proofType,
      discordMessageId: interaction.id,
      client: interaction.client,
    });

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`📸 Completion Proof Submitted — Order #${orderId}`)
      .setDescription(
        `Thank you <@${interaction.user.id}>! Your completion proof for **Run #${result.run.runNumber}** has been registered in the G4X system.\n\n` +
          `• **Proof Status:** ⏳ \`Pending Staff Review\`\n` +
          `• **Evidence:** [View Attachment](${result.proof.evidenceUrl})\n` +
          (description ? `• **Notes:** ${description}\n` : '') +
          `\n*Staff reviewers have been notified. No further action is required.*`
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err: any) {
    await interaction.editReply({
      content: `❌ **Proof Submission Rejected:** ${err.message || err}`,
    });
  }
}

/**
 * Handles direct message attachment uploads in execution channels (e.g. `G4!proof` or image posts).
 */
export async function handleDiscordProofMessageUpload(
  message: Message,
  rawArgs: string[] = []
): Promise<boolean> {
  if (message.author.bot || !message.channelId) return false;

  // 1. Verify channel is an active order execution channel
  const orderChannel = await prisma.orderChannel.findFirst({
    where: {
      discordChannelId: message.channelId,
      channelType: 'execution',
      status: 'active',
    },
    include: { order: true },
  });

  if (!orderChannel) {
    return false; // Not an execution channel; ignore message
  }

  // 2. Check if message has attachments or an image URL in args
  const firstAttachment = message.attachments.first();
  let evidenceUrl: string | null = null;

  if (firstAttachment) {
    const validation = validateDiscordAttachment({
      url: firstAttachment.url,
      name: firstAttachment.name,
      contentType: firstAttachment.contentType,
      size: firstAttachment.size,
    });

    if (!validation.valid) {
      await message.reply(`❌ **Attachment Error:** ${validation.error}`);
      return true;
    }
    evidenceUrl = validation.sanitizedUrl || firstAttachment.url;
  } else if (rawArgs.length > 0 && validateEvidenceUrl(rawArgs[0])) {
    evidenceUrl = rawArgs[0];
    rawArgs.shift();
  }

  if (!evidenceUrl) {
    await message.reply(
      `ℹ️ **How to submit proof:** Post your completion screenshot attachment in this channel with \`G4!proof [optional notes]\`, or click the **Submit Proof** button.`
    );
    return true;
  }

  const userNotes = rawArgs.join(' ').trim();

  try {
    const result = await submitDiscordChannelProof({
      orderId: orderChannel.orderId,
      channelId: message.channelId,
      authorDiscordId: message.author.id,
      evidenceUrl,
      description: userNotes,
      proofType: 'screenshot',
      discordMessageId: message.id,
      client: message.client,
    });

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`📸 Completion Proof Registered: Order #${orderChannel.orderId}`)
      .setDescription(
        `Proof of completion for **Run #${result.run.runNumber}** has been registered by <@${message.author.id}>.\n\n` +
          `• **Status:** ⏳ \`Pending Staff Review\`\n` +
          `• **Evidence URL:** [View Screenshot](${result.proof.evidenceUrl})\n` +
          (userNotes ? `• **Notes:** ${userNotes}\n` : '') +
          `\n*Authorized Staff and reviewers have been alerted.*`
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    return true;
  } catch (err: any) {
    await message.reply(`❌ **Proof Submission Failed:** ${err.message || err}`);
    return true;
  }
}
