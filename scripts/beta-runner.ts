/**
 * scripts/beta-runner.ts
 *
 * Dedicated CLI entrypoint for G4X Operational Closed Beta v0.001.
 * Separate from disposable Discord Lab (`npm run discord-lab:start`) and production (`src/index.ts`).
 * Supports `--no-discord` for web-only / maintenance mode and graceful SIGINT/SIGTERM shutdown
 * while persisting the SQLite database in `prisma/staging/`.
 */

import { startBetaRunner } from '../src/beta/betaRunner';

async function main() {
  const args = process.argv.slice(2);
  const skipDiscordLogin =
    args.includes('--no-discord') || process.env.BETA_DISCORD_ENABLED === 'false';
  const envArg = args.find((a) => a.startsWith('--env='));
  const customEnvPath = envArg ? envArg.slice('--env='.length) : undefined;

  const instance = await startBetaRunner({
    customEnvPath,
    skipDiscordLogin,
  });

  console.log(
    `[BetaCLI] G4X Operational Closed Beta v0.001 running at http://${instance.host}:${instance.port}`
  );
  console.log(`[BetaCLI] Persistent DB: ${instance.database.dbPath}`);
  console.log(
    `[BetaCLI] Discord Bot: ${instance.client ? `ACTIVE (guild ${instance.validation.allowedGuildId})` : 'OFFLINE (--no-discord / disabled)'}`
  );

  let shuttingDown = false;
  const handleSignal = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[BetaCLI] Received ${sig}; flushing persistent database and shutting down...`);
    await instance.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[BetaCLI] Fatal startup error:', err?.message || err);
    process.exit(1);
  });
}
