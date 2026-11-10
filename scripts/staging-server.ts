/**
 * scripts/staging-server.ts
 *
 * Isolated Local Staging Server Runner with Mock Discord Adapter for G4X Community.
 *
 * FEATURES:
 *  1. Enforces STAGING_MODE=true and loopback binding (127.0.0.1:3001).
 *  2. Evaluates `validateStagingEnvironment()`.
 *  3. Injects Mock Discord Client into `setGlobalDiscordClient()`.
 *  4. Starts Express HTTP server cleanly on configured HOST and PORT.
 *  5. Provides programmatic export `startStagingServer()` for automated integration test suites.
 *
 * Usage:
 *   npx ts-node scripts/staging-server.ts [--env-file .env.staging]
 *   npm run staging:start
 */

import path from 'path';
import fs from 'fs';
import http from 'http';
import dotenv from 'dotenv';

// Load .env.staging before imports that read process.env
const envFileArgIdx = process.argv.indexOf('--env-file');
if (envFileArgIdx !== -1 && process.argv[envFileArgIdx + 1]) {
  const envFilePath = path.resolve(process.cwd(), process.argv[envFileArgIdx + 1]);
  if (fs.existsSync(envFilePath)) {
    dotenv.config({ path: envFilePath, override: true });
  }
} else {
  const stagingEnv = path.resolve(process.cwd(), '.env.staging');
  if (fs.existsSync(stagingEnv)) {
    dotenv.config({ path: stagingEnv, override: true });
  } else {
    dotenv.config();
  }
}

// Ensure STAGING_MODE is active
process.env.STAGING_MODE = 'true';
process.env.MOCK_DISCORD = 'true';

import { validateStagingEnvironment } from './validate-staging-env';
import { setGlobalDiscordClient } from '../src/services/orderDiscordService';
import { createStagingApp } from '../src/web/staging/stagingApp';
import prisma from '../src/database/db';
import { createRealisticMockDiscordClient, MockDiscordClient } from '../src/test/mockDiscordAdapter';

export function createMockDiscordClient(): MockDiscordClient {
  return createRealisticMockDiscordClient();
}

export interface RunningStagingServer {
  server: http.Server;
  port: number;
  host: string;
  url: string;
  close: () => Promise<void>;
}

export async function startStagingServer(portOverride?: number): Promise<RunningStagingServer> {
  const envValidation = validateStagingEnvironment();
  if (!envValidation.valid) {
    throw new Error(
      `[StagingServer] Cannot start server — invalid staging environment:\n${envValidation.errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }

  // Inject Mock Discord Adapter
  const mockClient = createMockDiscordClient();
  setGlobalDiscordClient(mockClient);

  const host = process.env.HOST || '127.0.0.1';
  const port = portOverride || Number(process.env.PORT || 3001);

  const app = createStagingApp();

  const server = await new Promise<http.Server>((resolve, reject) => {
    const s = app.listen(port, host, () => {
      resolve(s);
    });
    s.on('error', reject);
  });

  const url = `http://${host}:${port}`;
  console.log(`[StagingServer] 🧪 Staging server listening at ${url}`);

  return {
    server,
    port,
    host,
    url,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
    },
  };
}

// CLI Execution
if (require.main === module) {
  startStagingServer()
    .then((running) => {
      console.log(`[StagingServer] 🚀 Server running. Press Ctrl+C to stop.`);

      const shutdown = async () => {
        console.log('\n[StagingServer] Shutting down...');
        await running.close();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('[StagingServer] ❌ Failed to start:', err.message);
      process.exit(1);
    });
}
