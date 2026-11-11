/**
 * scripts/beta-backup.ts
 *
 * Automated SQLite backup and integrity verification CLI for G4X Operational Beta v0.001.
 * Usage: npx ts-node scripts/beta-backup.ts [--db=<path>] [--out=<backupDir>] [--label=<name>]
 */

import {
  createBetaDatabaseBackup,
  resolveDefaultBetaDatabasePath,
} from '../src/beta/betaDatabase';
import { loadBetaEnvFile, validateBetaDatabaseUrl } from '../src/beta/validateBetaEnv';

async function main() {
  loadBetaEnvFile();
  const args = process.argv.slice(2);
  const dbArg = args.find((a) => a.startsWith('--db='));
  const outArg = args.find((a) => a.startsWith('--out='));
  const labelArg = args.find((a) => a.startsWith('--label='));

  let dbPath: string;
  if (dbArg) {
    dbPath = dbArg.slice('--db='.length);
  } else if (process.env.DATABASE_URL) {
    const check = validateBetaDatabaseUrl(process.env.DATABASE_URL);
    if (!check.valid || !check.resolvedPath) {
      throw new Error(check.error || 'Invalid DATABASE_URL for beta backup.');
    }
    dbPath = check.resolvedPath;
  } else {
    dbPath = resolveDefaultBetaDatabasePath();
  }

  const result = await createBetaDatabaseBackup(dbPath, {
    backupDir: outArg ? outArg.slice('--out='.length) : undefined,
    label: labelArg ? labelArg.slice('--label='.length) : 'manual',
  });

  console.log('[BetaBackup] Verified SQLite backup created:');
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[BetaBackup] Backup failed:', err?.message || err);
    process.exit(1);
  });
}
