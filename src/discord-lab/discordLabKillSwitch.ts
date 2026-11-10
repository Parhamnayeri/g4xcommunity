/**
 * src/discord-lab/discordLabKillSwitch.ts
 *
 * Emergency Kill Switch Mechanism for Safe Discord Lab Integration.
 *
 * Capabilities:
 *  1. Immediate halt upon file creation (.discord-lab.kill in repo or parent).
 *  2. Immediate halt upon environment flag DISCORD_LAB_KILL_SWITCH=true.
 *  3. Programmatic trigger function to abort runner and disconnect client.
 *  4. Active poller to react within 1 second during live testing.
 */

import path from 'path';
import fs from 'fs';

export interface KillSwitchStatus {
  active: boolean;
  reason?: string;
  source?: 'env' | 'file' | 'manual';
  filePath?: string;
}

export function getKillSwitchFileCandidates(): string[] {
  const repoRoot = path.resolve(__dirname, '../../');
  return [
    path.resolve(repoRoot, '.discord-lab.kill'),
    path.resolve(repoRoot, '.discord-lab-kill'),
    path.resolve(repoRoot, '..', '.discord-lab.kill'),
  ];
}

export function checkKillSwitch(): KillSwitchStatus {
  // 1. Kill switch files
  const files = getKillSwitchFileCandidates();
  for (const f of files) {
    if (fs.existsSync(f)) {
      let content = '';
      try {
        content = fs.readFileSync(f, 'utf8').trim();
      } catch {}
      return {
        active: true,
        reason: content || `Kill switch file detected at ${f}`,
        source: 'file',
        filePath: f,
      };
    }
  }

  // 2. Environment variable
  if (process.env.DISCORD_LAB_KILL_SWITCH === 'true') {
    return {
      active: true,
      reason: 'Environment variable DISCORD_LAB_KILL_SWITCH is set to true',
      source: 'env',
    };
  }

  return { active: false };
}

export function triggerKillSwitch(reason: string = 'Operator manual kill'): string {
  const repoRoot = path.resolve(__dirname, '../../');
  const targetFile = path.resolve(repoRoot, '.discord-lab.kill');
  fs.writeFileSync(targetFile, `${new Date().toISOString()}: ${reason}\n`, 'utf8');
  process.env.DISCORD_LAB_KILL_SWITCH = 'true';
  return targetFile;
}

export function resetKillSwitch(): void {
  delete process.env.DISCORD_LAB_KILL_SWITCH;
  const files = getKillSwitchFileCandidates();
  for (const f of files) {
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
      } catch {}
    }
  }
}

/**
 * Arms a background watcher that checks the kill switch every intervalMs (default 1000ms).
 * Returns an unarm function.
 */
export function armKillSwitchWatcher(
  onTrigger: (status: KillSwitchStatus) => void,
  intervalMs: number = 1000
): () => void {
  const timer = setInterval(() => {
    const status = checkKillSwitch();
    if (status.active) {
      clearInterval(timer);
      onTrigger(status);
    }
  }, intervalMs);

  // Unref timer so it doesn't prevent process from exiting
  if (timer.unref) {
    timer.unref();
  }

  return () => clearInterval(timer);
}
