/**
 * scripts/import-beta-orders.ts
 *
 * Safe CLI tool for importing existing Discord orders into the persistent Operational Beta DB.
 * Defaults to `--dry-run`; database writes occur ONLY with explicit `--confirm-import`.
 *
 * Usage:
 *   npx ts-node scripts/import-beta-orders.ts --file=./orders.json [--dry-run] [--confirm-import] [--actor=<discordId>] [--db=<path>]
 */

import { initializeBetaDatabase, resolveDefaultBetaDatabasePath } from '../src/beta/betaDatabase';
import { loadBetaEnvFile, validateBetaDatabaseUrl } from '../src/beta/validateBetaEnv';
import { importLegacyBetaOrders, parseLegacyOrdersFile } from '../src/beta/legacyOrderImport';

async function main() {
  loadBetaEnvFile();
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => a.startsWith('--file='));
  const dbArg = args.find((a) => a.startsWith('--db='));
  const actorArg = args.find((a) => a.startsWith('--actor='));
  const confirmImport = args.includes('--confirm-import');
  const dryRun = args.includes('--dry-run') || !confirmImport;

  if (!fileArg) {
    throw new Error('Missing required --file=<path-to-json-or-csv> argument.');
  }

  let dbUrl: string;
  if (dbArg) {
    const raw = dbArg.slice('--db='.length);
    dbUrl = raw.startsWith('file:') ? raw : `file:${raw}`;
  } else if (process.env.DATABASE_URL) {
    dbUrl = process.env.DATABASE_URL;
  } else {
    dbUrl = `file:${resolveDefaultBetaDatabasePath().replace(/\\/g, '/')}`;
  }

  const check = validateBetaDatabaseUrl(dbUrl);
  if (!check.valid || !check.canonicalUrl) {
    throw new Error(check.error || 'Target DB must be confined inside prisma/staging/.');
  }

  const records = parseLegacyOrdersFile(fileArg.slice('--file='.length));
  const db = await initializeBetaDatabase(check.canonicalUrl, { silent: true });

  try {
    const report = await importLegacyBetaOrders(db.prismaClient, records, {
      dryRun,
      confirmImport,
      actorDiscordId: actorArg ? actorArg.slice('--actor='.length) : process.env.OWNER_DISCORD_ID,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.rejectedInvalid > 0 && dryRun) {
      process.exitCode = 1;
    }
  } finally {
    await db.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[LegacyOrderImport] Fatal error:', err?.message || err);
    process.exit(1);
  });
}
