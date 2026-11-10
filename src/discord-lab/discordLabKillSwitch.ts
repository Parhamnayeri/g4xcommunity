/**
 * src/discord-lab/discordLabKillSwitch.ts
 *
 * Emergency Kill Switch Mechanism for Safe Discord Lab Integration.
 *
 * SAFETY INVARIANTS:
 *  1. Immediate halt upon file creation (.discord-lab.kill in repo or parent).
 *  2. Immediate halt upon environment flag DISCORD_LAB_KILL_SWITCH=true.
 *  3. Test suites and programmatic resets MUST NEVER silently delete operator-controlled kill-switch files.
 *  4. Supports custom search paths / fixtures for safe test isolation.
 *  5. Active poller to react within 1 second during live testing.
 */

import path from 'path';
import fs from 'fs';

export interface KillSwitchStatus {
  active: boolean;
  reason?: string;
  source?: 'env' | 'file' | 'manual';
  filePath?: string;
}

export function getCanonicalKillSwitchFileCandidates(): string[] {
  const repoRoot = path.resolve(__dirname, '../../');
  return [
    path.resolve(repoRoot, '.discord-lab.kill'),
    path.resolve(repoRoot, '.discord-lab-kill'),
    path.resolve(repoRoot, '..', '.discord-lab.kill'),
  ];
}

export function checkKillSwitch(options?: {
  customSearchPaths?: string[];
  overrideEnv?: Record<string, string | undefined>;
}): KillSwitchStatus {
  const env = options?.overrideEnv || process.env;

  // 1. Check kill switch files (custom search paths or canonical candidates)
  const files = options?.customSearchPaths || getCanonicalKillSwitchFileCandidates();
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

  // 2. Check environment variable
  if (env.DISCORD_LAB_KILL_SWITCH === 'true') {
    return {
      active: true,
      reason: 'Environment variable DISCORD_LAB_KILL_SWITCH is set to true',
      source: 'env',
    };
  }

  return { active: false };
}

/**
 * Triggers the kill switch.
 * If targetFilePath is specified, writes to that specific path (useful for isolated tests).
 * Otherwise writes to repoRoot/.discord-lab.kill and sets env flag.
 */
export function triggerKillSwitch(
  reason: string = 'Operator manual kill',
  targetFilePath?: string
): string {
  const repoRoot = path.resolve(__dirname, '../../');
  const target = targetFilePath ? path.resolve(targetFilePath) : path.resolve(repoRoot, '.discord-lab.kill');
  fs.writeFileSync(target, `${new Date().toISOString()}: ${reason}\n`, 'utf8');
  process.env.DISCORD_LAB_KILL_SWITCH = 'true';
  return target;
}

/**
 * Resets the kill switch safely.
 *
 * CRITICAL SAFETY GUARD:
 * - If targetFilePath is provided, deletes ONLY that specific temporary test file.
 * - If targetFilePath is NOT provided, it ONLY deletes the DISCORD_LAB_KILL_SWITCH environment flag.
 * - It NEVER removes or deletes operator-controlled emergency files (.discord-lab.kill) on disk!
 */
export function resetKillSwitch(targetFilePath?: string): void {
  delete process.env.DISCORD_LAB_KILL_SWITCH;

  if (targetFilePath) {
    try {
      if (fs.existsSync(targetFilePath)) {
        fs.unlinkSync(targetFilePath);
      }
    } catch {}
  }
}

/**
 * Arms a background watcher that checks the kill switch every intervalMs (default 1000ms).
 * Returns an unarm function.
 */
export function armKillSwitchWatcher(
  onTrigger: (status: KillSwitchStatus) => void,
  intervalMs: number = 1000,
  customSearchPaths?: string[]
): () => void {
  const timer = setInterval(() => {
    const status = checkKillSwitch({ customSearchPaths });
    if (status.active) {
      clearInterval(timer);
      onTrigger(status);
    }
  }, intervalMs);

  if (timer.unref) {
    timer.unref();
  }

  return () => clearInterval(timer);
}
