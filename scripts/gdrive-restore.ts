#!/usr/bin/env tsx
/**
 * scripts/gdrive-restore.ts
 *
 * Manual CLI Disaster Recovery & Restore Engine
 *
 * Usage:
 *   # List all available snapshots on Google Drive & local mirror:
 *   npm run restore:gdrive -- --list
 *
 *   # Restore a specific snapshot (with mandatory confirmation):
 *   npm run restore:gdrive -- --file g4x_db_2026-11-14_11-45-00_manual.db.gz --confirm
 *
 *   # Restore database and pull storage/ assets:
 *   npm run restore:gdrive -- --file g4x_db_2026-11-14_11-45-00_manual.db.gz --confirm --with-storage
 */

import {
  listRemoteBackups,
  restoreFromRemoteBackup,
  resolveActiveDatabasePath,
} from '../src/services/googleDriveBackupService';

async function main() {
  const args = process.argv.slice(2);
  const isList = args.includes('--list');
  const fileIndex = args.indexOf('--file');
  const targetFile = fileIndex !== -1 && args[fileIndex + 1] ? args[fileIndex + 1].trim() : '';
  const isConfirmed = args.includes('--confirm');
  const withStorage = args.includes('--with-storage');

  console.log('================================================================');
  console.log('  G4X Disaster Recovery & Database Restoration Engine');
  console.log('================================================================');

  if (isList || (!targetFile && !isConfirmed)) {
    console.log(`\nInspecting Available Remote & Local Snapshots...\n`);
    const snapshots = listRemoteBackups();

    if (snapshots.length === 0) {
      console.log('  No backup snapshots found in Google Drive or ./backups/database/.\n');
      return;
    }

    console.log('Index | Snapshot Filename                              | Size     | Location      | Modified Date');
    console.log('------+------------------------------------------------+----------+---------------+---------------------------');
    snapshots.forEach((s, idx) => {
      const idxStr = String(idx + 1).padStart(5, ' ');
      const nameStr = s.filename.padEnd(46, ' ');
      const sizeStr = s.sizeFormatted.padEnd(8, ' ');
      const locStr = (s.isRemote && s.isLocal ? 'Drive + Local' : s.isRemote ? 'Google Drive' : 'Local Mirror').padEnd(13, ' ');
      const dateStr = s.modifiedAt;
      console.log(`${idxStr} | ${nameStr} | ${sizeStr} | ${locStr} | ${dateStr}`);
    });

    console.log('\nTo restore a specific snapshot, run:');
    console.log(`  npx tsx scripts/gdrive-restore.ts --file <filename> --confirm [--with-storage]\n`);
    return;
  }

  if (!targetFile) {
    console.error('\n❌ Missing required argument: --file <snapshot_filename.db.gz>');
    console.error('Use --list to view all available snapshots.\n');
    process.exit(1);
  }

  if (!isConfirmed) {
    console.error('\n⚠️  SAFETY GUARD TRIGGERED: Explicit confirmation flag is REQUIRED!');
    console.error('----------------------------------------------------------------');
    console.error('Restoring a database will replace the currently active database.');
    console.error(`Target Snapshot: ${targetFile}`);
    console.error(`Active Database: ${resolveActiveDatabasePath()}`);
    console.error('\nTo proceed, rerun the command with the explicit --confirm flag:');
    console.error(`  npx tsx scripts/gdrive-restore.ts --file "${targetFile}" --confirm ${withStorage ? '--with-storage' : ''}`);
    console.error('----------------------------------------------------------------\n');
    process.exit(1);
  }

  console.log(`\n[1/3] Preparing restoration of snapshot '${targetFile}'...`);
  console.log(`  - Target DB Path:  ${resolveActiveDatabasePath()}`);
  console.log(`  - Restore Storage: ${withStorage ? 'YES' : 'NO'}`);

  console.log(`\n[2/3] Creating Pre-Restore Safety Snapshot & Verifying Integrity...`);
  const report = await restoreFromRemoteBackup(targetFile, {
    restoreStorage: withStorage,
    actorId: 'CLI_DISASTER_RECOVERY',
  });

  console.log(`\n[3/3] Database Restored Successfully!`);
  console.log('----------------------------------------------------------------');
  console.log(`  Restored Snapshot:     ${report.restoredSnapshot}`);
  console.log(`  Pre-Restore Safety DB: ${report.preRestoreSnapshot}`);
  console.log(`  Integrity Status:      ${report.integrityOk ? 'VERIFIED HEALTHY (PRAGMA integrity_check == OK)' : 'FAILED'}`);
  console.log(`  Storage Synchronized:  ${report.storageRestored ? 'YES (from Google Drive)' : 'NO'}`);
  console.log(`  Restored At:           ${report.restoredAt}`);
  console.log(`  Total Duration:        ${(report.durationMs / 1000).toFixed(2)}s`);
  console.log('----------------------------------------------------------------\n');
}

main().catch((err) => {
  console.error('\n❌ Restoration Failed:');
  console.error(err.message || err);
  process.exit(1);
});
