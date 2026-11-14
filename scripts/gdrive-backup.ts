#!/usr/bin/env tsx
/**
 * scripts/gdrive-backup.ts
 *
 * Manual CLI Trigger for Production-Grade Hybrid Google Drive Backup
 *
 * Usage:
 *   npx tsx scripts/gdrive-backup.ts
 *   npm run backup:gdrive
 */

import {
  checkRcloneHealth,
  runFullHybridBackup,
  formatBytes,
  getBackupConfig,
  resolveActiveDatabasePath,
} from '../src/services/googleDriveBackupService';

async function main() {
  console.log('================================================================');
  console.log('  G4X Production Google Drive Backup & Integrity Engine');
  console.log('================================================================');

  const config = getBackupConfig();
  const dbPath = resolveActiveDatabasePath();

  console.log(`\n[1/4] Inspecting Active System Configuration...`);
  console.log(`  - Target SQLite DB: ${dbPath}`);
  console.log(`  - Target Remote:    ${config.rcloneRemote}:${config.backupFolder}`);
  console.log(`  - Local Mirror:     ${config.localBackupDir}`);
  console.log(`  - Storage Dir:      ${config.storageDir}`);
  console.log(`  - Retention Policy: ${config.retentionDays} days`);

  console.log(`\n[2/4] Verifying rclone Connection & Remote Health...`);
  const health = checkRcloneHealth();
  if (health.rcloneInstalled && health.remoteConfigured && health.remoteReachable) {
    console.log(`  ✅ rclone binary detected: ${health.rcloneVersion}`);
    console.log(`  ✅ Google Drive remote '${health.remoteName}' is authenticated & reachable.`);
    if (health.totalSpaceBytes && health.freeSpaceBytes) {
      console.log(`  📊 Google Drive Capacity: ${formatBytes(health.freeSpaceBytes)} free of ${formatBytes(health.totalSpaceBytes)}`);
    }
  } else {
    console.warn(`  ⚠️  rclone Status:`);
    if (!health.rcloneInstalled) {
      console.warn(`      rclone executable is NOT found on PATH.`);
    } else if (!health.remoteConfigured) {
      console.warn(`      Remote '${health.remoteName}' is not configured in rclone.`);
    } else if (!health.remoteReachable) {
      console.warn(`      Remote '${health.remoteName}' is not reachable: ${health.error}`);
    }
    console.warn(`      Backup will still produce a verified atomic local snapshot in ./backups/database/.`);
  }

  console.log(`\n[3/4] Executing Online Atomic Snapshot (VACUUM INTO + gzip + manifest)...`);
  const result = await runFullHybridBackup('manual', 'CLI_OPERATOR');

  console.log(`\n[4/4] Backup Completed Successfully!`);
  console.log('----------------------------------------------------------------');
  console.log(`  Snapshot Archive:   ${result.snapshotFilename}`);
  console.log(`  Manifest File:      ${result.manifestFilename}`);
  console.log(`  Original Size:      ${formatBytes(result.originalSizeBytes)} (${result.originalSizeBytes} bytes)`);
  console.log(`  Compressed Size:    ${formatBytes(result.compressedSizeBytes)} (${result.compressedSizeBytes} bytes)`);
  console.log(`  Compression Ratio:  ${((1 - result.compressedSizeBytes / result.originalSizeBytes) * 100).toFixed(1)}% savings`);
  console.log(`  SHA-256 (Original): ${result.sha256Original}`);
  console.log(`  SHA-256 (Archive):  ${result.sha256Compressed}`);
  console.log(`  Integrity Check:    ${result.integrityOk ? 'PASSED (PRAGMA integrity_check == OK)' : 'FAILED'}`);
  console.log(`  FK Violations:      ${result.fkViolationCount}`);
  console.log(`  Google Drive Sync:  ${result.uploadedToRemote ? `✅ Uploaded to ${result.remoteDatabasePath}` : '⚠️ Staged locally in ./backups/database/'}`);
  console.log(`  Storage Sync:       ${result.storageSynced ? '✅ Synced ./storage incrementally' : 'N/A or Skipped'}`);
  console.log(`  Execution Time:     ${(result.durationMs / 1000).toFixed(2)}s`);
  console.log('----------------------------------------------------------------\n');
}

main().catch((err) => {
  console.error('\n❌ Backup Execution Failed:');
  console.error(err.message || err);
  process.exit(1);
});
