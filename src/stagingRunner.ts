/**
 * stagingRunner.ts — Staging web server runner for MVP acceptance & browser testing
 * Runs independently on port 26190 with safe disposable database (data/g4x_staging.db).
 */

process.env.DATABASE_URL = 'file:../data/g4x_staging.db';
process.env.PORT = '26190';
process.env.STAGING_TEST_AUTH = 'true';
process.env.NODE_ENV = 'staging';
process.env.ESCROW_RELEASE_ENABLED = 'false';
process.env.FINANCE_V2_LIVE_CREDITS_ENABLED = 'false';
process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED = 'false';
process.env.FINANCE_V2_P2P_SETTLEMENT_ENABLED = 'false';

import 'dotenv/config';
// Overwrite any dotenv settings for staging isolation
process.env.DATABASE_URL = 'file:../data/g4x_staging.db';
process.env.PORT = '26190';
process.env.STAGING_TEST_AUTH = 'true';
process.env.NODE_ENV = 'staging';

import { startWebServer } from './web/server';

const port = 26190;
startWebServer(port);
console.log(`[Staging] G4X Web Staging Server listening on http://localhost:${port}`);
console.log(`[Staging] Database URL: ${process.env.DATABASE_URL}`);
console.log(`[Staging] Financial Gates: ESCROW_RELEASE_ENABLED=${process.env.ESCROW_RELEASE_ENABLED}, LIVE_PAYOUTS=${process.env.FINANCE_V2_LIVE_PAYOUTS_ENABLED}`);
