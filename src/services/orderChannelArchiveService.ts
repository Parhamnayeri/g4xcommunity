/**
 * orderChannelArchiveService.ts — Order Execution Channel Image Archiving & Deletion Service
 *
 * G4X Community
 *
 * Responsibilities:
 *  1. When an order transitions to waiting_for_confirm or higher (done, warranty, completed):
 *     - Fetches all messages from the order's execution channel.
 *     - Gathers all image attachments and screenshot proofs.
 *     - Compresses them into a valid, standard PKZIP archive (.zip).
 *     - Saves the archive to `storage/order-archives/order-<id>-archive-<timestamp>.zip`.
 *     - Attaches the archive URL to `order.notes` and creates an approved `RunProof` record.
 *     - Completely deletes the execution channel from Discord.
 *     - Updates the DB `OrderChannel` record to status: 'deleted'.
 *  2. Server-authoritative role verification for Discord command `G4!order <id> wfc`.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import axios from 'axios';
import { GuildMember, PermissionFlagsBits } from 'discord.js';
import prisma from '../database/db';
import { getGlobalDiscordClient } from './orderDiscordService';

export interface ArchiveCleanupResult {
  success: boolean;
  orderId: number;
  channelId?: string;
  channelName?: string;
  imageCount: number;
  zipUrl?: string;
  archiveFilePath?: string;
  message: string;
  error?: string;
}

// ─── CRC32 Table for standard PKZIP Generation ─────────────────────────────
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

export function computeCrc32(buf: Buffer): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Creates a standard PKZIP archive buffer from a list of named files.
 * Zero external dependencies. Uses Node.js built-in zlib.
 */
export function createZipBuffer(files: { name: string; data: Buffer }[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const data = file.data;
    const crc = computeCrc32(data);

    // Compress using DEFLATE; if compressed is smaller, use method 8 (deflate), else 0 (store)
    const compressed = zlib.deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? compressed : data;

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed: 2.0
    localHeader.writeUInt16LE(0, 6);          // General purpose bit flag
    localHeader.writeUInt16LE(method, 8);      // Compression method
    localHeader.writeUInt16LE(0, 10);         // Last mod file time
    localHeader.writeUInt16LE(0, 12);         // Last mod file date
    localHeader.writeUInt32LE(crc, 14);       // CRC-32
    localHeader.writeUInt32LE(payload.length, 18); // Compressed size
    localHeader.writeUInt32LE(data.length, 22);    // Uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28);              // Extra field length
    nameBuf.copy(localHeader, 30);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central header signature
    centralHeader.writeUInt16LE(20, 4);         // Version made by: 2.0
    centralHeader.writeUInt16LE(20, 6);         // Version needed: 2.0
    centralHeader.writeUInt16LE(0, 8);          // General purpose bit flag
    centralHeader.writeUInt16LE(method, 10);     // Compression method
    centralHeader.writeUInt16LE(0, 12);         // Last mod file time
    centralHeader.writeUInt16LE(0, 14);         // Last mod file date
    centralHeader.writeUInt32LE(crc, 16);       // CRC-32
    centralHeader.writeUInt32LE(payload.length, 20); // Compressed size
    centralHeader.writeUInt32LE(data.length, 24);    // Uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28); // File name length
    centralHeader.writeUInt16LE(0, 30);              // Extra field length
    centralHeader.writeUInt16LE(0, 32);              // File comment length
    centralHeader.writeUInt16LE(0, 34);              // Disk number start
    centralHeader.writeUInt16LE(0, 36);              // Internal file attributes
    centralHeader.writeUInt32LE(0, 38);              // External file attributes
    centralHeader.writeUInt32LE(offset, 42);         // Relative offset of local header
    nameBuf.copy(centralHeader, 46);

    localHeaders.push(localHeader, payload);
    centralHeaders.push(centralHeader);
    offset += localHeader.length + payload.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) {
    centralDirSize += ch.length;
  }

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);       // EOCD signature
  eocd.writeUInt16LE(0, 4);                // Number of this disk
  eocd.writeUInt16LE(0, 6);                // Disk where central directory starts
  eocd.writeUInt16LE(files.length, 8);     // Number of central directory records on this disk
  eocd.writeUInt16LE(files.length, 10);    // Total number of central directory records
  eocd.writeUInt32LE(centralDirSize, 12);  // Size of central directory
  eocd.writeUInt32LE(centralDirOffset, 16);// Offset of start of central directory
  eocd.writeUInt16LE(0, 20);               // Comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

/**
 * Checks if the caller has staff, manager, admin, or owner permissions.
 * Evaluates DB roles, Discord guild permissions, and environment overrides.
 */
export async function isActorStaffOrHigher(
  actorId: string,
  member?: GuildMember | any | null
): Promise<boolean> {
  if (!actorId) return false;

  // 1. Check Owner override
  if (process.env.DISCORD_OWNER_ID && actorId === process.env.DISCORD_OWNER_ID) {
    return true;
  }

  // 2. Check Database roles
  try {
    const user = await prisma.user.findUnique({
      where: { discordId: actorId },
      include: { userRoles: true },
    });

    if (user && user.isActive) {
      const allowedRoles = new Set(['owner', 'admin', 'manager', 'staff']);
      const hasDbRole = user.userRoles.some((r) =>
        allowedRoles.has((r.roleKey || '').toLowerCase())
      );
      if (hasDbRole) return true;
    }
  } catch (dbErr) {
    console.warn(`[orderChannelArchiveService] DB role check error for ${actorId}:`, dbErr);
  }

  // 3. Check Discord Member permissions and guild roles
  if (member) {
    // Administrator permission
    if (typeof member.permissions?.has === 'function') {
      if (member.permissions.has(PermissionFlagsBits.Administrator)) {
        return true;
      }
    }

    // Role names or configured IDs
    const allowedRoleNames = ['owner', 'admin', 'administrator', 'manager', 'staff'];
    const envRoleIds = [
      process.env.ROLE_OWNER,
      process.env.ROLE_ADMIN,
      process.env.ROLE_MANAGER,
      process.env.ROLE_STAFF,
    ].filter(Boolean);

    if (member.roles?.cache) {
      for (const role of member.roles.cache.values()) {
        const nameLower = (role.name || '').toLowerCase();
        if (allowedRoleNames.some((r) => nameLower.includes(r))) {
          return true;
        }
        if (envRoleIds.includes(role.id)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Archives all images in the order's execution channel into a ZIP archive,
 * saves the archive link to the order, and deletes the Discord channel.
 *
 * Idempotent: If no active channel exists or already deleted, returns gracefully.
 */
export async function archiveAndCleanupExecutionChannel(
  orderId: number,
  client?: any,
  actorId?: string
): Promise<ArchiveCleanupResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderChannels: {
        where: {
          channelType: 'execution',
        },
      },
      runs: {
        orderBy: { runNumber: 'desc' },
        take: 1,
      },
    },
  });

  if (!order) {
    return {
      success: false,
      orderId,
      imageCount: 0,
      message: 'ORDER_NOT_FOUND',
      error: `Order #${orderId} does not exist`,
    };
  }

  // 1. Identify active/locked channel mapping
  const activeMapping = order.orderChannels.find((c) =>
    ['active', 'locked'].includes(c.status)
  );

  const discordChannelId = activeMapping?.discordChannelId || order.executionChannelId;

  if (!discordChannelId) {
    return {
      success: true,
      orderId,
      imageCount: 0,
      message: 'NO_ACTIVE_EXECUTION_CHANNEL',
    };
  }

  // 2. Resolve Discord Client & Channel
  const discordClient = client || getGlobalDiscordClient();
  let discordChannel: any = null;

  if (discordClient && typeof discordClient.channels?.fetch === 'function') {
    try {
      discordChannel = await discordClient.channels.fetch(discordChannelId).catch(() => null);
    } catch {
      discordChannel = null;
    }
  }

  const now = new Date();

  // If channel does not exist on Discord (already deleted manually or invalid snowflake)
  if (!discordChannel) {
    await prisma.orderChannel.updateMany({
      where: {
        orderId,
        channelType: 'execution',
        status: { not: 'deleted' },
      },
      data: {
        status: 'deleted',
        archivedAt: now,
      },
    });

    await prisma.order.update({
      where: { id: orderId },
      data: { executionChannelId: null },
    });

    return {
      success: true,
      orderId,
      channelId: discordChannelId,
      imageCount: 0,
      message: 'CHANNEL_ALREADY_REMOVED_ON_DISCORD',
    };
  }

  const channelName = discordChannel.name || `order-${orderId}`;

  // 3. Fetch messages from Discord channel (paginating up to 1000 messages)
  const messages: any[] = [];
  let lastMessageId: string | undefined = undefined;
  const maxMessages = 1000;

  try {
    if (discordChannel.messages && typeof discordChannel.messages.fetch === 'function') {
      while (messages.length < maxMessages) {
        const fetchLimit = Math.min(100, maxMessages - messages.length);
        const options: any = { limit: fetchLimit };
        if (lastMessageId) {
          options.before = lastMessageId;
        }

        const batch = await discordChannel.messages.fetch(options).catch(() => null);
        if (!batch || batch.size === 0) break;

        const batchValues = Array.from(batch.values());
        for (const msg of batchValues) {
          messages.push(msg);
        }

        const lastItem: any = typeof batch.last === 'function' ? batch.last() : batchValues[batchValues.length - 1];
        lastMessageId = lastItem?.id;
        if (batch.size < fetchLimit) break;
      }
    }
  } catch (fetchErr: any) {
    console.warn(`[orderChannelArchiveService] Message fetch warning for #${channelName}:`, fetchErr.message);
  }

  // 4. Extract image attachments
  interface ImageCandidate {
    url: string;
    filename: string;
    author: string;
    messageId: string;
    createdAt: Date;
  }

  const imageCandidates: ImageCandidate[] = [];
  let imageCounter = 1;

  for (const msg of messages) {
    if (msg.attachments && msg.attachments.size > 0) {
      for (const att of msg.attachments.values()) {
        const isImage =
          (att.contentType && att.contentType.startsWith('image/')) ||
          /\.(png|jpe?g|webp|gif|bmp)(\?.*)?$/i.test(att.name || att.url || '');

        if (isImage && att.url) {
          const rawName = (att.name || `screenshot_${imageCounter}.png`)
            .replace(/[^a-zA-Z0-9._-]/g, '_');
          const extMatch = rawName.match(/\.(png|jpe?g|webp|gif|bmp)$/i);
          const ext = extMatch ? extMatch[1].toLowerCase() : 'png';
          const baseName = rawName.replace(/\.[^.]+$/, '');
          const filename = `${String(imageCounter).padStart(3, '0')}_${baseName}.${ext}`;

          imageCandidates.push({
            url: att.url,
            filename,
            author: msg.author?.tag || msg.author?.username || 'unknown',
            messageId: msg.id,
            createdAt: msg.createdAt || new Date(),
          });
          imageCounter++;
        }
      }
    }
  }

  // 5. Download images & prepare files for ZIP archive
  const filesToZip: { name: string; data: Buffer }[] = [];
  const summaryLines: string[] = [
    `================================================================`,
    `G4X ORDER #${order.id} EXECUTION ARCHIVE`,
    `Order Reference: ${order.orderRef}`,
    `Archive Timestamp: ${now.toISOString()}`,
    `Discord Channel ID: ${discordChannelId}`,
    `Discord Channel Name: #${channelName}`,
    `Total Channel Messages Inspected: ${messages.length}`,
    `Total Image Proofs Detected: ${imageCandidates.length}`,
    `================================================================\n`,
  ];

  for (const candidate of imageCandidates) {
    try {
      let dataBuf: Buffer;
      if (candidate.url.startsWith('data:')) {
        const commaIdx = candidate.url.indexOf(',');
        dataBuf = Buffer.from(candidate.url.slice(commaIdx + 1), 'base64');
      } else {
        const resp = await axios.get(candidate.url, {
          responseType: 'arraybuffer',
          timeout: 15000,
          headers: { 'User-Agent': 'G4X-Community-Bot/1.0' },
        });
        dataBuf = Buffer.from(resp.data);
      }
      filesToZip.push({
        name: candidate.filename,
        data: dataBuf,
      });
      summaryLines.push(
        `[SAVED] ${candidate.filename} (${dataBuf.length} bytes) | Author: ${candidate.author} | MsgID: ${candidate.messageId} | Time: ${candidate.createdAt.toISOString()}`
      );
    } catch (dlErr: any) {
      console.warn(`[orderChannelArchiveService] Could not download image ${candidate.url}:`, dlErr.message);
      summaryLines.push(
        `[DOWNLOAD_FAILED] ${candidate.filename} | URL: ${candidate.url} | Error: ${dlErr.message}`
      );
    }
  }

  // Always include archive-summary.txt
  filesToZip.unshift({
    name: 'archive-summary.txt',
    data: Buffer.from(summaryLines.join('\n'), 'utf8'),
  });

  // 6. Build ZIP archive & save to disk
  const zipBuffer = createZipBuffer(filesToZip);
  const storageDir = path.join(process.cwd(), 'storage', 'order-archives');
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  const archiveFileName = `order-${order.id}-proofs-${Date.now()}.zip`;
  const archiveFilePath = path.join(storageDir, archiveFileName);
  fs.writeFileSync(archiveFilePath, zipBuffer);

  const baseUrl = (process.env.WEB_BASE_URL || 'https://g4x.online').replace(/\/+$/, '');
  const zipUrl = `${baseUrl}/storage/order-archives/${archiveFileName}`;

  // 7. Store archive link on Order & create RunProof
  const currentNotes = order.notes || '';
  const updatedNotes = currentNotes
    ? `${currentNotes}\n[Archive ZIP]: ${zipUrl}`
    : `[Archive ZIP]: ${zipUrl}`;

  await prisma.order.update({
    where: { id: order.id },
    data: {
      notes: updatedNotes,
      executionChannelId: null,
    },
  });

  const latestRun = order.runs[0];
  if (latestRun) {
    try {
      await prisma.runProof.create({
        data: {
          runId: latestRun.id,
          submittedById: actorId || order.creatorId || 'system',
          proofType: 'screenshot',
          evidenceUrl: zipUrl,
          description: `Auto-archived execution channel images (${filesToZip.length - 1} images)`,
          status: 'approved',
          reviewedById: actorId || null,
          reviewNotes: 'Archived automatically upon channel closure',
          reviewedAt: now,
        },
      });
    } catch (proofErr: any) {
      console.warn(`[orderChannelArchiveService] RunProof creation notice for #${order.id}:`, proofErr.message);
    }
  }

  // 8. Update DB OrderChannel status to 'deleted'
  await prisma.orderChannel.updateMany({
    where: {
      orderId: order.id,
      channelType: 'execution',
      status: { not: 'deleted' },
    },
    data: {
      status: 'deleted',
      archivedAt: now,
    },
  });

  // 9. Completely delete Discord channel
  try {
    if (typeof discordChannel.delete === 'function') {
      await discordChannel.delete(
        `Order #${order.id} transitioned to WFC/Done; ${filesToZip.length - 1} images archived to ZIP`
      );
    }
  } catch (delErr: any) {
    console.warn(`[orderChannelArchiveService] Failed to delete Discord channel ${discordChannelId}:`, delErr.message);
  }

  return {
    success: true,
    orderId: order.id,
    channelId: discordChannelId,
    channelName,
    imageCount: filesToZip.length - 1,
    zipUrl,
    archiveFilePath,
    message: `Archived ${filesToZip.length - 1} image(s) to ZIP and deleted channel #${channelName}.`,
  };
}
