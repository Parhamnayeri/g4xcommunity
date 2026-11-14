/**
 * src/services/notificationWorker.ts — پردازشگر صف اعلانات خروجی (Notification Outbox Worker)
 * 
 * ویژگی‌ها:
 *  - پردازش صف پایدار notification_outbox به صورت Idempotent
 *  - ارسال اعلان‌های دیسکورد با دکمه‌های تعاملی اقدام (مانند دکمه ارسال مدارک تکمیلی)
 *  - مدیریت هوشمند خطای بسته بودن DM (Discord 50007) بدون تلاش مجدد هرز
 *  - مکانیزم Exponential Backoff برای خطاهای موقت شبکه
 *  - قابلیت اجرا به صورت کران‌جاب پس‌زمینه و فراخوانی بلادرنگ (On-Demand Trigger)
 */

import prisma from '../database/db';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

let isWorkerRunning = false;
let workerInterval: NodeJS.Timeout | null = null;

export interface NotificationPayload {
  applicationId?: number;
  category?: string;
  status?: string;
  notes?: string;
  rejectionReason?: string;
  requestedInfo?: string;
  gameSlug?: string;
}

let pendingTrigger = false;

/**
 * پردازش یک نوبت از صف اعلانات با مکانیزم صف‌بندی همزمانی ایمن
 */
export async function processNotificationOutbox(client: any): Promise<number> {
  if (!client) return 0;

  if (isWorkerRunning) {
    pendingTrigger = true;
    while (isWorkerRunning) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  isWorkerRunning = true;
  let totalProcessed = 0;

  try {
    do {
      pendingTrigger = false;
      const count = await executeOutboxBatch(client);
      totalProcessed += count;
    } while (pendingTrigger);
  } finally {
    isWorkerRunning = false;
  }

  return totalProcessed;
}

async function executeOutboxBatch(client: any): Promise<number> {
  let processedCount = 0;

  try {
    const now = new Date();

    // واکشی اعلانات در وضعیت pending یا retry با زمان سررسید گذشته
    const pendingNotifications = await prisma.notificationOutbox.findMany({
      where: {
        OR: [
          { status: 'pending' },
          {
            status: 'failed',
            nextAttemptAt: { lte: now },
            attemptCount: { lt: 5 },
          },
        ],
      },
      take: 20,
      orderBy: { createdAt: 'asc' },
    });

    for (const notif of pendingNotifications) {
      try {
        let payload: NotificationPayload = {};
        try {
          payload = JSON.parse(notif.payload);
        } catch {
          payload = {};
        }

        if (notif.deliveryChannel === 'discord_dm') {
          const user = await client.users.fetch(notif.recipientId).catch(() => null);

          if (!user) {
            await prisma.notificationOutbox.updateMany({
              where: { id: notif.id },
              data: {
                status: 'failed',
                errorDetails: 'USER_NOT_FOUND',
                attemptCount: { increment: 1 },
                nextAttemptAt: new Date(Date.now() + 60000 * 5),
              },
            });
            continue;
          }

          const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTimestamp()
            .setFooter({ text: 'G4X Community • Notification' });

          const components: ActionRowBuilder<ButtonBuilder>[] = [];

          const rawBaseUrl =
            process.env.PUBLIC_WEB_URL ||
            process.env.WEB_BASE_URL ||
            'http://localhost:3001';
          const baseUrl = rawBaseUrl.replace(/\/+$/, '');
          const kycUrl = `${baseUrl}/profile/kyc`;
          let directMessageContent: string | undefined;

          switch (notif.notificationType) {
            case 'REGISTRATION_SUBMITTED': {
              const cat = payload.category?.toLowerCase();
              const requiresKyc = cat === 'pilot' || cat === 'advertiser' || cat === 'exchanger';
              embed
                .setTitle('🛡️ Application Submitted')
                .setDescription(
                  `Your application for **${payload.category?.toUpperCase() || 'ROLE'}** (ID: #${payload.applicationId || 'N/A'}) has been submitted for review.\n\n` +
                  (requiresKyc
                    ? `🪪 **Mandatory Identity Verification (KYC):**\nThis role requires identity verification. Please complete verification using the link below:\n🔗 **[Complete Identity Verification (KYC)](${kycUrl})**\n*(Verification status will be automatically synchronized with your application)*`
                    : `Our management team will review your application privately.`)
                );

              if (requiresKyc) {
                directMessageContent = `🔗 **Complete Identity Verification:** <${kycUrl}>`;
                if (kycUrl.startsWith('https://')) {
                  components.push(
                    new ActionRowBuilder<ButtonBuilder>().addComponents(
                      new ButtonBuilder()
                        .setLabel('Complete Identity Verification')
                        .setStyle(ButtonStyle.Link)
                        .setURL(kycUrl)
                        .setEmoji('🪪')
                    )
                  );
                }
              }
              break;
            }

            case 'APPLICATION_APPROVED':
              embed
                .setTitle('🎉 Application Approved!')
                .setColor(0x57f287)
                .setDescription(
                  `Congratulations! Your application for **${payload.category?.toUpperCase() || 'ROLE'}** (ID: #${payload.applicationId}) has been **Approved**!\n\n` +
                  `Your platform access and Discord role have been synchronized.${payload.notes ? `\n\n**Notes:** ${payload.notes}` : ''}`
                );
              break;

            case 'APPLICATION_REJECTED':
              embed
                .setTitle('🛡️ Application Decision')
                .setColor(0xed4245)
                .setDescription(
                  `Your application for **${payload.category?.toUpperCase() || 'ROLE'}** (ID: #${payload.applicationId}) was **Rejected**.\n\n` +
                  `**Reason:** ${payload.rejectionReason || 'Requirements not met'}\n\n` +
                  `You may reapply in the future following community guidelines.`
                );
              break;

            case 'APPLICATION_INFO_REQUESTED':
              embed
                .setTitle('ℹ️ Additional Information Required')
                .setColor(0xfee75c)
                .setDescription(
                  `Our team has reviewed your **${payload.category?.toUpperCase() || 'ROLE'}** application (ID: #${payload.applicationId}) and requested more information:\n\n` +
                  `> **${payload.requestedInfo || 'Please provide updated qualifications or documents.'}**\n\n` +
                  `Click the button below to submit the requested information directly to this application:`
                );

              if (payload.applicationId) {
                const provideInfoBtn = new ButtonBuilder()
                  .setCustomId(`app_provide_info:${payload.applicationId}`)
                  .setLabel('Provide Information')
                  .setEmoji('📝')
                  .setStyle(ButtonStyle.Primary);

                components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(provideInfoBtn));
              }
              break;

            case 'APPLICATION_SUPPLEMENTAL_RECEIVED':
              embed
                .setTitle('✅ Supplemental Information Received')
                .setColor(0x57f287)
                .setDescription(
                  `Your response for Application #${payload.applicationId} was received and is now **Under Review** by staff.`
                );
              break;

            case 'APPLICATION_IDENTITY_INITIATED': {
              embed
                .setTitle('🪪 Identity Verification (KYC) Required')
                .setColor(0x8b5cf6)
                .setDescription(
                  `Your application (ID: #${payload.applicationId}) requires private identity verification.\n\n` +
                  `Please complete your secure identity verification using the link below:\n` +
                  `🔗 **[Complete Identity Verification (KYC)](${kycUrl})**\n\n` +
                  `*Once verified, your status will be saved and reused across all platform applications.*`
                );

              directMessageContent = `🔗 **Complete Identity Verification:** <${kycUrl}>`;
              if (kycUrl.startsWith('https://')) {
                components.push(
                  new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                      .setLabel('Complete Identity Verification')
                      .setStyle(ButtonStyle.Link)
                      .setURL(kycUrl)
                      .setEmoji('🪪')
                  )
                );
              }
              break;
            }

            default:
              embed
                .setTitle('🛡️ G4X Notification')
                .setDescription(`Update regarding your application #${payload.applicationId || ''}.`);
              break;
          }

          // ارسال پیام خصوصی
          await user.send({
            content: directMessageContent,
            embeds: [embed],
            components,
          });

          // ثبت موفقیت
          await prisma.notificationOutbox.updateMany({
            where: { id: notif.id },
            data: {
              status: 'sent',
              sentAt: new Date(),
              errorDetails: null,
            },
          });

          processedCount++;
        }
      } catch (err: any) {
        const isClosedDm = err?.code === 50007 || err?.message?.includes('Cannot send messages to this user');

        await prisma.notificationOutbox.updateMany({
          where: { id: notif.id },
          data: {
            status: isClosedDm ? 'dms_closed' : 'failed',
            attemptCount: { increment: 1 },
            errorDetails: isClosedDm ? 'DMS_CLOSED: User DMs are closed' : err?.message || 'UNKNOWN_DELIVERY_ERROR',
            // در صورت بسته بودن DM، از تلاش‌های تکراری بیهوده جلوگیری می‌شود
            nextAttemptAt: isClosedDm
              ? null
              : new Date(Date.now() + 60000 * Math.pow(2, notif.attemptCount + 1)),
          },
        });
      }
    }
  } catch (globalErr) {
    console.error('[NotificationWorker] Unexpected loop error:', globalErr);
  }

  return processedCount;
}

/**
 * راه‌اندازی دوره پردازش پس‌زمینه صف اعلانات
 */
export function startNotificationWorker(client: any, intervalMs = 15000): void {
  if (workerInterval) {
    clearInterval(workerInterval);
  }

  workerInterval = setInterval(() => {
    processNotificationOutbox(client).catch((err) => {
      console.warn('[NotificationWorker] Background cycle failed:', err);
    });
  }, intervalMs);

  console.log(`[NotificationWorker] ✅ Started persistent notification delivery worker (${intervalMs}ms interval)`);
}

/**
 * توقف ورکر (جهت تست‌ها و خاموش شدن سرور)
 */
export function stopNotificationWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}
