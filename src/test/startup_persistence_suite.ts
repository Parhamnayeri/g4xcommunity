import assert from 'node:assert/strict';
import prisma from '../database/db';
import { initializeDatabase } from '../database/schema';
import { seed } from '../database/seed';

if (!/\/g4x-release-blockers-[^/]+\/release_fixture\.db$/.test(process.env.DATABASE_URL || '')) {
  throw new Error('Run through scripts/test-release-blockers.cjs; disposable database required');
}
let passed = 0;
function check(name: string, condition: unknown) {
  assert(condition, name); passed++; console.log(`PASS ${name}`);
}
async function main() {
  await initializeDatabase();
  check('startup on a fresh migrated installation does not implicitly seed',
    await prisma.game.count() === 0 && await prisma.role.count() === 0);
  await seed();
  check('explicit bootstrap initializes fresh games, services and roles',
    await prisma.game.count() > 0 && await prisma.gameService.count() > 0 && await prisma.role.count() > 0);
  const canonical = await prisma.gameService.findFirstOrThrow({ where: { gameSlug: 'wow_midnight' } });
  await prisma.game.update({ where: { slug: 'wow_midnight' }, data: {
    displayName: 'Admin title', serviceCategory: 'pilot', isActive: false, sortOrder: 73,
  } });
  await prisma.gameService.update({ where: { id: canonical.id }, data: {
    displayName: 'Admin service', isActive: false, sortOrder: 91, requiresPilotApproval: true,
  } });
  await prisma.role.update({ where: { roleKey: 'manager' }, data: { name: 'Configured role name' } });
  await prisma.game.create({ data: { slug: 'custom_game', displayName: 'Custom game', serviceCategory: 'both' } });
  const custom = await prisma.gameService.create({ data: {
    gameSlug: 'custom_game', serviceKey: 'custom_service', displayName: 'Custom service',
    serviceMode: 'non_pilot', profileMode: 'none', isActive: true,
  } });
  await prisma.gameService.create({ data: {
    gameSlug: 'wow_midnight', serviceKey: 'custom_on_canonical', displayName: 'Custom canonical service',
    serviceMode: 'non_pilot', profileMode: 'none', isActive: true,
  } });
  await prisma.user.create({ data: { discordId: 'release_fixture_user', username: 'Fixture' } });
  await prisma.order.create({ data: {
    orderRef: 'release_fixture_order', gameSlug: 'custom_game', serviceId: custom.id,
    orderType: 'solo', currency: 'USD', grossAmountMinor: 100,
  } });
  await prisma.registrationApplication.create({ data: {
    userId: 'release_fixture_user', category: 'booster', gameSlug: 'custom_game', qualifications: '{}',
  } });
  await prisma.serviceSetting.create({ data: { serviceId: custom.id, claimWindowSeconds: 77 } });
  await prisma.discordChannelMapping.create({ data: {
    channelKey: 'release_fixture', guildId: '123456789012345678', categoryName: 'Fixture',
    channelName: 'fixture', purpose: 'order_publication', gameSlug: 'custom_game', serviceId: custom.id,
  } });
  for (let i = 0; i < 28; i++) await prisma.platformWithdrawalBatch.create({ data: {
    batchRef: `release_history_${i}`, platform: 'g2g', status: 'review_required', totalContributionsMinor: 10000,
  } });
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name");
  const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
  await prisma.$executeRawUnsafe('CREATE TABLE audit_test_writes (count INTEGER NOT NULL)');
  await prisma.$executeRawUnsafe('INSERT INTO audit_test_writes VALUES (0)');
  for (const { name } of tables) for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${quote(`audit_${name}_${action}`)} AFTER ${action} ON ${quote(name)} BEGIN UPDATE audit_test_writes SET count = count + 1; END`);
  }
  async function snapshot() {
    const values = [];
    for (const { name } of tables) values.push([name, await prisma.$queryRawUnsafe(`SELECT * FROM ${quote(name)}`)]);
    return values;
  }
  const before = await snapshot();
  // Explicit bootstrap is additive even if an operator invokes it on an existing installation.
  await seed();
  check('repeated explicit bootstrap preserves all configuration and historical references',
    JSON.stringify(await snapshot(), (_, v) => typeof v === 'bigint' ? String(v) : v) ===
    JSON.stringify(before, (_, v) => typeof v === 'bigint' ? String(v) : v));
  for (let i = 0; i < 2; i++) { await prisma.$disconnect(); await initializeDatabase(); }
  assert.deepStrictEqual(await snapshot(), before);
  check('repeated reconnect/startup preserves every row including orders, mappings and 28 historical records', true);
  check('custom games and both custom services remain enabled',
    (await prisma.game.findUniqueOrThrow({ where: { slug: 'custom_game' } })).isActive &&
    await prisma.gameService.count({ where: { serviceKey: { in: ['custom_service', 'custom_on_canonical'] }, isActive: true } }) === 2);
  const writes = await prisma.$queryRawUnsafe<{ count: bigint }[]>('SELECT count FROM audit_test_writes');
  check('repeated bootstrap and startup perform zero INSERT/UPDATE/DELETE operations', Number(writes[0].count) === 0);
  console.log(`STARTUP: ${passed} passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
