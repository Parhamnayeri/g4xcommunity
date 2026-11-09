import assert from 'assert';
import fs from 'fs';
import nodePath from 'path';
import request from 'supertest';
import prisma from '../database/db';
import { app, sessionStore } from '../web/server';
import { setGlobalDiscordClient } from '../services/orderDiscordService';
if (!/(task3|release_fixture)[^/]*\.db$/.test(process.env.DATABASE_URL || ''))
  throw Error('Use an isolated task3*.db or release_fixture.db database');
const prefix = `native_${Date.now()}`;
let passed = 0;
function check(name: string, value: unknown) {
  assert(value, name);
  passed++;
  console.log(`PASS ${name}`);
}
async function account(role: string) {
  const userId = `${prefix}_${role}`;
  await prisma.user.create({
    data: { discordId: userId, username: userId, userRoles: { create: { roleKey: role } } },
  });
  const agent = request.agent(app),
    init = await agent.get('/api/csrf-token');
  const sid = String(init.headers['set-cookie']?.[0]).match(/g4x\.sid=s%3A([^.]+)\./)?.[1];
  assert(sid);
  await new Promise<void>((resolve, reject) =>
    sessionStore.get(sid, (err, session) => {
      if (err || !session) return reject(err || Error('Missing session'));
      sessionStore.set(sid, { ...session, userId }, (error) => (error ? reject(error) : resolve()));
    }),
  );
  return { userId, agent, token: init.body.csrfToken };
}
async function main() {
  const manager = await account('manager'),
    admin = await account('admin'),
    staff = await account('staff'),
    booster = await account('booster');
  for (let i = 0; i < 28; i++)
    await prisma.platformWithdrawalBatch.create({
      data: {
        batchRef: `${prefix}_historical_${i}`,
        platform: 'g2g',
        status: 'review_required',
        totalContributionsMinor: 10000,
        reviewNotes: 'Synthetic historical reconciliation record; do not resolve automatically',
      },
    });
  const startWallets = await prisma.walletV2.findMany(),
    startLedger = await prisma.ledgerEntryV2.findMany(),
    startBatches = await prisma.platformWithdrawalBatch.findMany();
  check(
    'anonymous application list denied',
    (await request(app).get('/api/management/applications')).status === 401,
  );
  check(
    'staff application list denied',
    (await staff.agent.get('/api/management/applications')).status === 403,
  );
  const application = await prisma.registrationApplication.create({
    data: {
      userId: booster.userId,
      category: 'booster',
      qualifications: JSON.stringify({ experience: 'Mythic', identityDocumentRef: 'private.png' }),
    },
  });
  const pilot = await prisma.registrationApplication.create({
    data: { userId: booster.userId, category: 'pilot', gameSlug: 'wow_midnight', qualifications: '{}' },
  });
  const list = await manager.agent.get('/api/management/applications').query({
    search: booster.userId,
    category: 'booster',
    status: 'pending',
    limit: 1,
    startDate: new Date().toISOString().slice(0, 10),
  });
  check(
    'application search, type, date and pagination',
    list.status === 200 &&
      list.body.applications.length === 1 &&
      list.body.pagination.total === 1 &&
      list.body.applications[0].username === booster.userId &&
      list.body.applications[0].submittedAt,
  );
  check(
    'application invalid date rejected',
    (await manager.agent.get('/api/management/applications').query({ startDate: 'invalid' })).status === 400,
  );
  check(
    'admin cannot request advertiser queue',
    (await admin.agent.get('/api/management/applications').query({ category: 'advertiser' })).status === 403,
  );
  const detail = await admin.agent.get(`/api/management/applications/${application.id}`);
  check(
    'details exclude identity document references',
    detail.status === 200 && !JSON.stringify(detail.body).includes('private.png'),
  );
  check(
    'missing review CSRF denied',
    (
      await admin.agent
        .post(`/api/management/applications/${application.id}/review`)
        .send({ decision: 'approve' })
    ).status === 403,
  );
  check(
    'forged actor cannot grant review access',
    (
      await booster.agent
        .post(`/api/management/applications/${application.id}/review`)
        .set('x-csrf-token', booster.token)
        .send({ decision: 'approve', actorId: manager.userId })
    ).status === 403,
  );
  const own = await prisma.registrationApplication.create({
    data: { userId: admin.userId, category: 'booster', qualifications: '{}' },
  });
  check(
    'self approval forbidden',
    (
      await admin.agent
        .post(`/api/management/applications/${own.id}/review`)
        .set('x-csrf-token', admin.token)
        .send({ decision: 'approve' })
    ).status === 403,
  );
  check(
    'pilot approval cannot bypass KYC',
    (
      await manager.agent
        .post(`/api/management/applications/${pilot.id}/review`)
        .set('x-csrf-token', manager.token)
        .send({ decision: 'approve' })
    ).status === 400,
  );
  const docName = `${prefix}_identity.png`,
    docPath = nodePath.join(process.cwd(), 'storage/kyc_documents', docName);
  const outside = nodePath.join('/tmp', `${prefix}_outside.txt`);
  fs.writeFileSync(docPath, 'PRIVATE_TEST_DOCUMENT');
  fs.writeFileSync(outside, 'OUTSIDE_TEST_DOCUMENT');
  try {
    await prisma.registrationApplication.update({
      where: { id: pilot.id },
      data: { qualifications: JSON.stringify({ identityDocumentRef: docName }) },
    });
    const securePath = `/api/management/kyc/applications/${pilot.id}/documents/identityDoc`;
    check('staff cannot access KYC identity bytes', (await staff.agent.get(securePath)).status === 403);
    check('manager without admin role cannot access KYC identity bytes', (await manager.agent.get(securePath)).status === 403);
    check(
      'authorized KYC reviewer (admin) can access bound document',
      (await admin.agent.get(securePath)).status === 200,
    );
    fs.unlinkSync(docPath);
    let symlinkCreated = false;
    try {
      fs.symlinkSync(outside, docPath);
      symlinkCreated = true;
    } catch {
      // Windows without Developer Mode / admin cannot create symlinks
    }
    if (symlinkCreated) {
      check('effective KYC symlink is rejected', (await admin.agent.get(securePath)).status === 403);
      check(
        'direct application-bound KYC symlink is rejected',
        (await admin.agent.get(`/api/management/kyc/documents/${docName}`).query({ applicationId: pilot.id }))
          .status === 403,
      );
    }
  } finally {
    if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
    if (fs.existsSync(outside)) fs.unlinkSync(outside);
  }
  for (const decision of ['request_info', 'approve'])
    check(
      `authorized ${decision}`,
      (
        await admin.agent
          .post(`/api/management/applications/${application.id}/review`)
          .set('x-csrf-token', admin.token)
          .send({ decision, reviewerNotes: 'Reviewed application evidence', reason: 'Additional details' })
      ).status === 200,
    );
  const history = await admin.agent.get(`/api/management/applications/${application.id}`);
  check(
    'reviewer notes and decision history retained',
    history.body.application.reviewerNotes === 'Reviewed application evidence' &&
      history.body.history.some(
        (h: any) =>
          h.action === 'REGISTRATION_APPLICATION_APPROVED' && h.notes === 'Reviewed application evidence',
      ),
  );
  const reject = await prisma.registrationApplication.create({
    data: { userId: booster.userId, category: 'booster', qualifications: '{}' },
  });
  check(
    'authorized rejection',
    (
      await admin.agent
        .post(`/api/management/applications/${reject.id}/review`)
        .set('x-csrf-token', admin.token)
        .send({ decision: 'reject', reason: 'Insufficient experience' })
    ).status === 200,
  );
  const gameInput = { slug: prefix, displayName: 'Native Test Game', serviceCategory: 'both', sortOrder: 5 };
  check(
    'game create requires CSRF',
    (await admin.agent.post('/api/admin/games').send(gameInput)).status === 403,
  );
  check(
    'staff cannot create games',
    (await staff.agent.post('/api/admin/games').set('x-csrf-token', staff.token).send(gameInput)).status ===
      403,
  );
  check(
    'authorized game creation',
    (await admin.agent.post('/api/admin/games').set('x-csrf-token', admin.token).send(gameInput)).status ===
      201,
  );
  check(
    'duplicate slug rejected',
    (await admin.agent.post('/api/admin/games').set('x-csrf-token', admin.token).send(gameInput)).status ===
      400,
  );
  check(
    'invalid game category rejected',
    (
      await admin.agent
        .post('/api/admin/games')
        .set('x-csrf-token', admin.token)
        .send({ ...gameInput, slug: prefix + '_invalid', serviceCategory: 'invalid' })
    ).status === 400,
  );
  const service = await admin.agent
    .post(`/api/admin/games/${prefix}/services`)
    .set('x-csrf-token', admin.token)
    .send({
      serviceKey: 'boost',
      displayName: 'Boost',
      serviceMode: 'non_pilot',
      settings: { proofRequired: true },
    });
  check('service creation', service.status === 201);
  const serviceId = service.body.service.id;
  check(
    'duplicate service key rejected',
    (
      await admin.agent
        .post(`/api/admin/games/${prefix}/services`)
        .set('x-csrf-token', admin.token)
        .send({ serviceKey: 'boost', displayName: 'Duplicate' })
    ).status === 400,
  );
  check(
    'service config and display ordering',
    (
      await admin.agent
        .put(`/api/admin/services/${serviceId}`)
        .set('x-csrf-token', admin.token)
        .send({
          displayName: 'Updated Boost',
          sortOrder: 8,
          settings: { proofRequired: true, allowPause: true },
        })
    ).status === 200,
  );
  const mappingKey = `publication:${prefix}:non_pilot_boosts`;
  const mapping = {
    guildId: (100000000000000000n + BigInt(Date.now())).toString(),
    discordChannelId: '223456789012345678',
    purpose: 'Order publication',
    categoryName: 'Orders',
    channelName: 'boosts',
    channelType: 'GUILD_TEXT',
    gameSlug: prefix,
    serviceId,
    serviceMode: 'non_pilot',
    isActive: true,
  };
  const path = `/api/management/channel-mappings/${encodeURIComponent(mappingKey)}`;
  check('mapping requires CSRF', (await manager.agent.post(path).send(mapping)).status === 403);
  check(
    'staff cannot access channel routing permission',
    (
      await staff.agent
        .post(path)
        .set('x-csrf-token', staff.token)
        .send({ ...mapping, actorId: manager.userId })
    ).status === 403,
  );
  check(
    'invalid channel snowflake rejected',
    (
      await manager.agent
        .post(path)
        .set('x-csrf-token', manager.token)
        .send({ ...mapping, discordChannelId: '123' })
    ).status === 400,
  );
  check(
    'invalid guild snowflake rejected',
    (
      await manager.agent
        .post(path)
        .set('x-csrf-token', manager.token)
        .send({ ...mapping, guildId: 'wrong' })
    ).status === 400,
  );
  check(
    'create saved mapping',
    (await manager.agent.post(path).set('x-csrf-token', manager.token).send(mapping)).status === 200,
  );
  check(
    'duplicate mapping rejected',
    (await manager.agent.post(path).set('x-csrf-token', manager.token).send(mapping)).status === 400,
  );
  check(
    'conflicting channel rejected',
    (
      await manager.agent
        .post(`/api/management/channel-mappings/${encodeURIComponent(`publication:${prefix}:pilot_boosts`)}`)
        .set('x-csrf-token', manager.token)
        .send(mapping)
    ).status === 400,
  );
  check(
    'edit saved mapping',
    (
      await manager.agent
        .put(path)
        .set('x-csrf-token', manager.token)
        .send({ ...mapping, discordChannelId: '323456789012345678' })
    ).status === 200,
  );
  check(
    'saved mappings can be retrieved without a live Discord client',
    (await manager.agent.get('/api/management/channel-mappings')).body.mappings.some(
      (m: any) => m.channelKey === mappingKey && m.syncStatus === 'MANUAL',
    ),
  );
  const noClient = await manager.agent
    .post(path + '/verify')
    .set('x-csrf-token', manager.token)
    .send({});
  check(
    'no bot client does not claim live verification',
    noClient.status === 200 && noClient.body.valid === false,
  );
  const channel: any = {
    type: 0,
    name: 'boosts',
    guild: { members: { me: { id: 'bot' } } },
    permissionsFor: () => ({ has: () => true }),
  };
  const guild: any = { id: mapping.guildId, channels: { cache: { get: () => channel } } };
  setGlobalDiscordClient({ guilds: { cache: { get: () => guild } } } as any);
  check(
    'mock live connectivity success',
    (
      await manager.agent
        .post(path + '/verify')
        .set('x-csrf-token', manager.token)
        .send({})
    ).body.valid === true,
  );
  channel.permissionsFor = () => ({ has: () => false });
  check(
    'insufficient bot permissions detected',
    (
      await manager.agent
        .post(path + '/verify')
        .set('x-csrf-token', manager.token)
        .send({})
    ).body.valid === false,
  );
  guild.channels.cache.get = () => null;
  check(
    'missing Discord channel detected',
    (
      await manager.agent
        .post(path + '/verify')
        .set('x-csrf-token', manager.token)
        .send({})
    ).body.valid === false,
  );
  setGlobalDiscordClient(null);
  const order = await prisma.order.create({
    data: {
      orderRef: prefix,
      gameSlug: prefix,
      serviceId,
      creatorId: manager.userId,
      orderType: 'solo',
      currency: 'USD',
      grossAmountMinor: 10000,
      paymentStatus: 'verified',
      status: 'open_presign',
    },
  });
  const original = await prisma.order.findUnique({ where: { id: order.id } });
  check(
    'active order blocks mapping changes',
    (await manager.agent.put(path).set('x-csrf-token', manager.token).send(mapping)).status === 400,
  );
  check(
    'active order blocks mapping removal',
    (await manager.agent.delete(path).set('x-csrf-token', manager.token)).status === 400,
  );
  check(
    'referenced game slug cannot change',
    (
      await admin.agent
        .put(`/api/admin/games/${prefix}`)
        .set('x-csrf-token', admin.token)
        .send({ newSlug: prefix + '_renamed' })
    ).status === 400,
  );
  check(
    'referenced service identifier cannot change',
    (
      await admin.agent
        .put(`/api/admin/services/${serviceId}`)
        .set('x-csrf-token', admin.token)
        .send({ serviceKey: 'changed' })
    ).status === 400,
  );
  check(
    'referenced game cannot be deleted',
    (await admin.agent.delete(`/api/admin/games/${prefix}`).set('x-csrf-token', admin.token)).status === 400,
  );
  check(
    'referenced service cannot be deleted',
    (await admin.agent.delete(`/api/admin/services/${serviceId}`).set('x-csrf-token', admin.token)).status ===
      400,
  );
  check(
    'disable game preserves history',
    (
      await admin.agent
        .patch(`/api/admin/games/${prefix}/status`)
        .set('x-csrf-token', admin.token)
        .send({ isActive: false })
    ).status === 200,
  );
  check(
    'enable game',
    (
      await admin.agent
        .patch(`/api/admin/games/${prefix}/status`)
        .set('x-csrf-token', admin.token)
        .send({ isActive: true })
    ).status === 200,
  );
  check(
    'disable service preserves history',
    (
      await admin.agent
        .patch(`/api/admin/services/${serviceId}/status`)
        .set('x-csrf-token', admin.token)
        .send({ isActive: false })
    ).status === 200,
  );
  assert.deepStrictEqual(await prisma.order.findUnique({ where: { id: order.id } }), original);
  check('order historical fields unchanged', true);
  const removableKey = `reg:public:${prefix}`;
  check(
    'create removable mapping',
    (
      await manager.agent
        .post(`/api/management/channel-mappings/${removableKey}`)
        .set('x-csrf-token', manager.token)
        .send({
          ...mapping,
          gameSlug: null,
          serviceId: null,
          serviceMode: null,
          discordChannelId: '423456789012345678',
        })
    ).status === 200,
  );
  check(
    'remove unused mapping without deleting a Discord channel',
    (
      await manager.agent
        .delete(`/api/management/channel-mappings/${removableKey}`)
        .set('x-csrf-token', manager.token)
    ).status === 200,
  );
  const logs = await prisma.auditLog.findMany({
    where: { entityType: 'DiscordChannelMapping', entityId: removableKey },
  });
  check('mapping changes audited', logs.length === 2);
  assert.deepStrictEqual(await prisma.walletV2.findMany(), startWallets);
  assert.deepStrictEqual(await prisma.ledgerEntryV2.findMany(), startLedger);
  assert.deepStrictEqual(await prisma.platformWithdrawalBatch.findMany(), startBatches);
  check('wallet ledger and reconciliation batches unchanged', true);
  console.log(`${passed} native admin checks passed`);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    setGlobalDiscordClient(null);
    sessionStore.stopCleanup();
    await prisma.$disconnect();
  });
