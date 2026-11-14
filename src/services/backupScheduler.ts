/**
 * src/services/backupScheduler.ts
 *
 * Lightweight automated background scheduler for Google Drive hybrid backups.
 * Controlled strictly via environment variables:
 *  - GDRIVE_BACKUP_ENABLED=true|false (default: false)
 *  - GDRIVE_BACKUP_INTERVAL_HOURS=6 (default: 6)
 */

import {
  getBackupConfig,
  checkRcloneHealth,
  runFullHybridBackup,
  BackupResult,
} from './googleDriveBackupService';

export interface SchedulerStatus {
  enabled: boolean;
  intervalHours: number;
  isRunning: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  lastResult?: BackupResult | null;
  lastError?: string;
}

let timerHandle: NodeJS.Timeout | null = null;
let lastRunAt: string | undefined;
let nextRunAt: string | undefined;
let lastResult: BackupResult | null = null;
let lastError: string | undefined;

/**
 * Returns current scheduler state and execution metrics.
 */
export function getSchedulerStatus(): SchedulerStatus {
  const config = getBackupConfig();
  return {
    enabled: config.enabled,
    intervalHours: config.intervalHours,
    isRunning: timerHandle !== null,
    lastRunAt,
    nextRunAt,
    lastResult,
    lastError,
  };
}

/**
 * Executes a scheduled backup tick and schedules the next execution.
 */
async function executeScheduledTick(): Promise<void> {
  const config = getBackupConfig();
  try {
    lastRunAt = new Date().toISOString();
    console.log(`[BackupScheduler] Starting scheduled Google Drive hybrid backup at ${lastRunAt}...`);
    const result = await runFullHybridBackup('scheduled', 'SCHEDULER');
    lastResult = result;
    lastError = undefined;
    console.log(
      `[BackupScheduler] Scheduled backup completed: ${result.snapshotFilename} (${(result.compressedSizeBytes / 1024 / 1024).toFixed(2)} MB, remoteUploaded=${result.uploadedToRemote}, storageSynced=${result.storageSynced})`
    );
  } catch (err: any) {
    lastError = err.message;
    console.error(`[BackupScheduler] Scheduled backup tick failed:`, err);
  } finally {
    const intervalMs = config.intervalHours * 60 * 60 * 1000;
    nextRunAt = new Date(Date.now() + intervalMs).toISOString();
  }
}

/**
 * Starts the automated backup scheduler if enabled.
 */
export function startBackupScheduler(): void {
  const config = getBackupConfig();

  if (!config.enabled) {
    console.log(
      `[BackupScheduler] Automated Google Drive backup scheduler is DISABLED (GDRIVE_BACKUP_ENABLED=false).`
    );
    return;
  }

  if (timerHandle) {
    console.log(`[BackupScheduler] Scheduler is already active.`);
    return;
  }

  const intervalMs = config.intervalHours * 60 * 60 * 1000;
  nextRunAt = new Date(Date.now() + intervalMs).toISOString();

  console.log(
    `[BackupScheduler] Initializing automated backup scheduler (Interval: ${config.intervalHours}h, Remote: ${config.rcloneRemote}:${config.backupFolder}, Retention: ${config.retentionDays}d).`
  );

  const health = checkRcloneHealth();
  if (!health.rcloneInstalled || !health.remoteConfigured) {
    console.warn(
      `[BackupScheduler] Note: rclone is not fully configured (${health.error || 'unconfigured'}). Local snapshots will still be staged in ./backups/database/ awaiting remote upload.`
    );
  }

  timerHandle = setInterval(() => {
    void executeScheduledTick();
  }, intervalMs);

  // Unref timer so it does not block graceful Node process shutdown
  if (timerHandle && typeof timerHandle.unref === 'function') {
    timerHandle.unref();
  }
}

/**
 * Stops the automated backup scheduler.
 */
export function stopBackupScheduler(): void {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
    nextRunAt = undefined;
    console.log(`[BackupScheduler] Automated backup scheduler stopped.`);
  }
}
