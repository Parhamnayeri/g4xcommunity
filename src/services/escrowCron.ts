/**
 * escrowCron.ts — جاب زمان‌بندی‌شده آزادسازی امن اسکرو با استفاده از escrowService
 *
 * قابلیت‌ها:
 *  - بررسی فعال بودن آزادسازی اسکرو (ESCROW_RELEASE_ENABLED)
 *  - ایزوله‌سازی تراکنش‌ها در پردازش دسته‌ای
 *  - ثبت گزارش ساختاریافته از وضعیت‌های skipped, blocked, released, failed
 *  - قابلیت توقف تمیز جاب (stopEscrowCron)
 */

import cron from 'node-cron';
import { processAllPendingEscrows, isEscrowReleaseEnabled } from './escrowService';

let scheduledTask: cron.ScheduledTask | null = null;

/**
 * متد پردازش دوره‌ای اسکروها
 */
export async function processEscrowReleases(): Promise<void> {
  const enabled = isEscrowReleaseEnabled();
  if (!enabled) {
    console.log(
      '[EscrowCron] 🔒 Escrow release cycle executed: Feature is DISABLED (ESCROW_RELEASE_ENABLED != true). Settlement skipped.',
    );
    return;
  }

  console.log('[EscrowCron] 🔄 Starting scheduled safe escrow release cycle...');
  try {
    const summary = await processAllPendingEscrows(50);
    console.log(
      `[EscrowCron] 📊 Cycle complete: Candidates=${summary.totalCandidates}, Released=${summary.releasedCount}, Blocked=${summary.blockedCount}, Failed=${summary.failedCount}`,
    );
  } catch (error) {
    console.error('[EscrowCron] ❌ Unhandled error in escrow processing cycle:', error);
  }
}

/**
 * راه‌اندازی زمان‌بند کران اسکرو
 */
export function startEscrowCron(): void {
  const enabled = isEscrowReleaseEnabled();
  console.log(
    `[EscrowCron] Initializing Escrow Cron (ESCROW_RELEASE_ENABLED=${enabled ? 'true' : 'false'}).`,
  );

  // اجرای اولیه در زمان بوت
  processEscrowReleases().catch((err) =>
    console.error('[EscrowCron] Initial run error:', err),
  );

  // زمان‌بندی: هر ۵ دقیقه
  scheduledTask = cron.schedule('*/5 * * * *', () => {
    processEscrowReleases().catch((err) =>
      console.error('[EscrowCron] Scheduled cycle error:', err),
    );
  });

  console.log('[EscrowCron] ✅ Escrow release cron scheduled (every 5 minutes).');
}

/**
 * توقف زمان‌بند کران اسکرو
 */
export function stopEscrowCron(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[EscrowCron] 🛑 Escrow release cron stopped.');
  }
}
