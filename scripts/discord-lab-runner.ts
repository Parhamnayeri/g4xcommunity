/**
 * scripts/discord-lab-runner.ts
 *
 * CLI Entrypoint for Safe Live Discord Lab Integration Test Mode.
 * Re-exports from src/discord-lab/discordLabRunner.ts.
 */

export * from '../src/discord-lab/discordLabRunner';
import { DiscordLabLifecycleManager } from '../src/discord-lab/discordLabRunner';

// CLI Execution with Explicit Two-Flag Confirmation
if (require.main === module) {
  const args = process.argv.slice(2);
  const hasStart = args.includes('--start');
  const hasConfirm = args.includes('--confirm');

  // Both flags are strictly required to start
  if (hasStart && !hasConfirm) {
    console.error('\n❌ CRITICAL SAFETY REFUSAL: Flag --start was provided without --confirm.');
    console.error('Both --start AND --confirm are strictly required to initiate a live connection.\n');
    process.exit(1);
  }

  if (!hasStart && hasConfirm) {
    console.error('\n❌ CRITICAL SAFETY REFUSAL: Flag --confirm was provided without --start.');
    console.error('Both --start AND --confirm are strictly required to initiate a live connection.\n');
    process.exit(1);
  }

  if (hasStart && hasConfirm) {
    // Both flags present: Explicit Operator Live Connection
    const manager = new DiscordLabLifecycleManager();

    process.on('SIGINT', () => {
      manager.shutdown('SIGINT').then(() => process.exit(0));
    });
    process.on('SIGTERM', () => {
      manager.shutdown('SIGTERM').then(() => process.exit(0));
    });

    manager
      .start({ authorizedOperatorApproval: true })
      .then(() => {
        console.log('[DiscordLabRunner] Running in safe live test mode. Press Ctrl+C to stop.');
      })
      .catch((err) => {
        console.error('[DiscordLabRunner] Fatal error:', err.message);
        process.exit(1);
      });
  } else {
    // Neither flag present, or --dry-run: Run preflight checks only
    console.log('\n[DiscordLabRunner] 🛡️ DRY-RUN MODE: Running preflight checks only.');
    console.log('To initiate live connection, the operator must explicitly supply BOTH flags:');
    console.log('  npm run discord-lab:start -- --start --confirm\n');
    const { runDiscordLabPreflight } = require('./discord-lab-preflight');
    const result = runDiscordLabPreflight();
    process.exit(result.success ? 0 : 1);
  }
}
