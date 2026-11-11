/**
 * scripts/beta-restore.ts
 *
 * Verified SQLite restore CLI for G4X Operational Beta v0.001.
 * Usage: npx ts-node scripts/beta-restore.ts --from=<backupFile> [--db=<targetDbPath>] --confirm-restore
 */

import {
  restoreBetaDatabaseFromBackup,
  resolveDefaultBetaDatabasePath,
} from '../src/beta/betaDatabase';
import { loadBetaEnvFile, validateBetaDatabaseUrl } from '../src/beta/validateBetaEnv';

async function main() {
  loadBetaEnvFile();
  const args = process.argv.slice(2);
  const fromArg = args.find((a) => a.startsWith('--from='));
  const dbArg = args.find((a) => a.startsWith('--db='));
  const confirmed = args.includes('--confirm-restore');

  if (!fromArg) {
    throw new Error('Missing required --from=<backupFile> argument.');
  }
  if (!confirmed) {
    throw new Error(
      'Safety guard: pass explicit --confirm-restore flag to overwrite target beta database.'
    );
  }

  let targetDbPath: string;
  if (dbArg) {
    targetDbPath = dbArg.slice('--db='.length);
  } else if (process.env.DATABASE_URL) {
    const check = validateBetaDatabaseUrl(process.env.DATABASE_URL);
    if (!check.valid || !check.resolvedPath) {
      throw new Error(check.error || 'Invalid DATABASE_URL for beta restore.');
    }
    targetDbPath = check.resolvedPath;
  } else {
    targetDbPath = resolveDefaultBetaDatabasePath();
  }

  const result = await restoreBetaDatabaseFromBackup(
    fromArg.slice('--from='.length),
    targetDbPath
  );

  console.log('[BetaRestore] Verified database restore completed:');
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[BetaRestore] Restore failed:', err?.message || err);
    process.exit(1);
  });
}
