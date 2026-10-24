/**
 * scripts/advertiser-rank-migration-report.ts — Read-Only Migration Impact Report CLI
 *
 * G4X Community — Advertiser Rank-Based Commission System
 *
 * Purpose:
 *  Provides Owner and Administrators with a clear, non-destructive audit report of:
 *  1. Advertisers with existing custom commission rates (WalletV2.customCommissionRate).
 *  2. Advertisers with no explicit rate or rank assigned.
 *  3. Current commercial rank assignments (BRONZE, SILVER, GOLD, DIAMOND, OFFICIAL_PARTNERS, FOUNDING_ADVERTISER).
 *  4. Open and pending orders relying on existing commission configurations.
 *  5. Financial snapshots already finalized with historical terms.
 *  6. Safe migration recommendations without automatic, unauthorized overrides.
 */

import prisma from '../src/database/db';
import { getAdvertiserMigrationImpactReport, ADVERTISER_RANK_RATES_BPS } from '../src/services/advertiserRankService';

async function main() {
  console.log('========================================================================================');
  console.log('   G4X COMMUNITY — ADVERTISER COMMERCIAL RANK MIGRATION & AUDIT IMPACT REPORT           ');
  console.log('========================================================================================\n');

  console.log('Generating read-only impact assessment...\n');
  const report = await getAdvertiserMigrationImpactReport();

  console.log(`Summary Statistics:`);
  console.log(` • Total Advertisers Identified:        ${report.totalAdvertisers}`);
  console.log(` • Advertisers with Assigned Rank:       ${report.advertisersWithAssignedRank}`);
  console.log(` • Advertisers with Legacy Custom Rates: ${report.advertisersWithLegacyCustomRates}`);
  console.log(` • Unassigned / No Explicit Rank:        ${report.advertisersWithNoExplicitRateOrRank}`);
  console.log(` • Unresolved Migration Count:           ${report.unresolvedAdvertisersCount}`);
  console.log(` • Open Orders at Potential Risk:        ${report.openOrdersAtRiskCount}`);
  console.log(` • Finalized Historical Snapshots:       ${report.finalizedHistoricalSnapshotsCount}\n`);

  console.log('Approved Advertiser Ranks and Rate Standard:');
  for (const [rank, bps] of Object.entries(ADVERTISER_RANK_RATES_BPS)) {
    console.log(` • ${rank.padEnd(20)}: ${(bps / 100).toFixed(2)}% (${bps} bps)`);
  }
  console.log('\n----------------------------------------------------------------------------------------------------------');
  console.log('| Discord ID         | Username        | Current Rank | Custom Rate (W1/W2) | Open Orders | Action Required');
  console.log('----------------------------------------------------------------------------------------------------------');

  for (const adv of report.advertisers) {
    const discordStr = adv.discordId.padEnd(18);
    const userStr = adv.username.slice(0, 15).padEnd(15);
    const rankStr = (adv.currentRank || 'NONE').padEnd(12);
    
    let customRateStr = 'NONE';
    if (adv.legacyW2CustomRate !== null) {
      customRateStr = `W2:${(adv.legacyW2CustomRate * 100).toFixed(2)}%`;
    } else if (adv.legacyW1CustomRate !== null) {
      customRateStr = `W1:${(adv.legacyW1CustomRate * 100).toFixed(2)}%`;
    }
    const customStr = customRateStr.padEnd(19);

    const openStr = String(adv.openOrdersCount).padEnd(11);
    const actionStr = adv.hasLegacyCustomRate && adv.isMigrationUnresolved
      ? '⚠️ OWNER MAP REQUIRED'
      : adv.isMigrationUnresolved
      ? 'DEFAULT BRONZE ON NEXT ORDER'
      : '✅ CONFIGURED';

    console.log(`| ${discordStr} | ${userStr} | ${rankStr} | ${customStr} | ${openStr} | ${actionStr}`);
  }

  console.log('----------------------------------------------------------------------------------------------------------\n');

  if (report.advertisers.some(a => a.hasLegacyCustomRate && a.isMigrationUnresolved)) {
    console.log('⚠️ ATTENTION OWNER / ADMIN:');
    console.log('Some Advertisers possess legacy custom rates (e.g. customCommissionRate). In accordance with policy:');
    console.log(' 1. No automatic assignment of FOUNDING or BRONZE will be silently performed.');
    console.log(' 2. Open orders will retain their snapshotted commercial rates.');
    console.log(' 3. An authorized Administrator must explicitly assign an approved rank via the Web Review Hub.');
    console.log(' 4. Ambiguous new order finalizations remain blocked until explicitly resolved.\n');
  } else {
    console.log('✅ All advertisers have consistent commercial rank configurations.\n');
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Migration impact report failed:', err);
  process.exit(1);
});
