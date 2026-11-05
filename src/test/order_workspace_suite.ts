/** Run only against a separately migrated/seeded disposable task2 database. No live Discord calls. */
import assert from 'assert';
import request from 'supertest';
import prisma from '../database/db';
import { setGlobalDiscordClient } from '../services/orderDiscordService';
import { app, sessionStore } from '../web/server';

const database = process.env.DATABASE_URL || '';
if (!/task2[^/]*\.db$/.test(database)) throw new Error('Use a dedicated task2*.db SQLite test database');
const prefix = `workspace_${Date.now()}_`;
const id = (role: string) => `${prefix}${role}`;
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}
async function session(role: string) {
  const agent = request.agent(app);
  const initial = await agent.get('/api/csrf-token');
  const sid = String(initial.headers['set-cookie']?.[0]).match(/g4x\.sid=s%3A([^.]+)\./)?.[1];
  assert(sid);
  await new Promise<void>((resolve, reject) =>
    sessionStore.get(sid, (err, value) => {
      if (err || !value) return reject(err || new Error('Missing session'));
      sessionStore.set(sid, { ...value, userId: id(role) }, (err) => (err ? reject(err) : resolve()));
    }),
  );
  return { agent, csrf: initial.body.csrfToken as string };
}
async function main() {
  for (const role of ['owner', 'manager', 'admin', 'staff', 'booster', 'advertiser']) {
    await prisma.user.create({
      data: { discordId: id(role), username: role, userRoles: { create: { roleKey: role } } },
    });
  }
  const service = await prisma.gameService.findFirstOrThrow({
    where: { gameSlug: 'wow_midnight', serviceKey: 'mythic_plus' },
  });
  const common = {
    gameSlug: 'wow_midnight',
    serviceId: service.id,
    creatorId: id('admin'),
    creatorType: 'g4x',
    orderType: 'group',
    orderMode: 'non_pilot',
    currency: 'USD',
    grossAmountMinor: 10000,
    boosterPoolMinor: 8000,
  };
  const order = await prisma.order.create({
    data: {
      ...common,
      orderRef: `${prefix}paid`,
      orderName: `${prefix}search-name`,
      status: 'open_presign',
      paymentStatus: 'verified',
    },
  });
  const unpaid = await prisma.order.create({
    data: { ...common, orderRef: `${prefix}unpaid`, status: 'payment_pending', paymentStatus: 'pending' },
  });
  const run = await prisma.orderRun.create({
    data: { orderId: order.id, runNumber: 1, status: 'completed' },
  });
  await prisma.runProof.create({
    data: {
      runId: run.id,
      submittedById: id('booster'),
      evidenceUrl: 'https://example.com/proof.png',
      description: 'Task 2 proof',
    },
  });
  const dispute = await prisma.orderDispute.create({
    data: {
      orderId: order.id,
      openedById: id('booster'),
      disputeType: 'quality',
      description: 'Task 2 dispute',
      status: 'open',
    },
  });
  for (const entityType of ['Order', 'order'])
    await prisma.auditLog.create({
      data: {
        actorId: id('admin'),
        entityType,
        entityId: String(order.id),
        action: `WORKSPACE_${entityType}`,
        reason: 'Historical audit fixture',
      },
    });
  const admin = await session('admin');
  const unauth = await request(app).get('/api/management/orders');
  check('unauthenticated management list rejected', () => assert.equal(unauth.status, 401));
  for (const role of ['staff', 'booster', 'advertiser']) {
    const account = await session(role);
    const list = await account.agent.get('/api/management/orders');
    const details = await account.agent.get(`/api/management/orders/${order.id}`);
    check(`${role} denied private list and details`, () => {
      assert.equal(list.status, 403);
      assert.equal(details.status, 403);
    });
  }
  for (const role of ['admin', 'manager', 'owner']) {
    const account = await session(role);
    const result = await account.agent.get(`/api/management/orders/${order.id}`);
    check(`${role} sees assignments, proof, disputes and both audit casings`, () => {
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.equal(result.body.order.runs[0].proofs[0].description, 'Task 2 proof');
      assert.equal(result.body.order.disputes[0].id, dispute.id);
      assert.equal(result.body.order.auditLogs.length, 2);
      assert.equal(result.body.order.auditLogs[0].actor.username, 'admin');
      assert(!('email' in result.body.order.auditLogs[0].actor));
      assert(!result.body.order.authorizedActions.includes('final_approve'));
    });
  }
  const search = await admin.agent
    .get('/api/management/orders')
    .query({ search: `${prefix}search-name`, limit: 1, page: 1 });
  check('name search returns consistent server pagination', () => {
    assert.equal(search.status, 200);
    assert.equal(search.body.orders[0].id, order.id);
    assert.equal(search.body.pagination.page, 1);
    assert.equal(search.body.pagination.totalCount, 1);
    assert.equal(typeof search.body.orders[0].simplifiedStatus.label, 'string');
  });
  const filtered = await admin.agent
    .get('/api/management/orders')
    .query({
      search: prefix,
      paymentStatus: 'pending',
      gameSlug: 'wow_midnight',
      limit: 1,
      page: 'Infinity',
    });
  check('combined payment/game filters and non-finite pagination work', () => {
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.orders[0].id, unpaid.id);
    assert.equal(filtered.body.pagination.page, 1);
    assert(!filtered.body.orders[0].authorizedActions.includes('publish'));
  });
  const invalid = await admin.agent.get('/api/management/orders/NaN');
  check('invalid order detail ID rejected', () => assert.equal(invalid.status, 400));
  const csrf = await admin.agent
    .post(`/api/management/orders/${order.id}/assign`)
    .send({ candidates: [{ claimId: 1, assignedRole: 'tank' }] });
  check('roster mutations require CSRF', () => assert.equal(csrf.status, 403));
  const receipt = await admin.agent
    .post(`/api/orders/${unpaid.id}/verify-payment`)
    .set('x-csrf-token', admin.csrf)
    .send({});
  check('payment cannot be marked paid without a verified receipt', () => assert.equal(receipt.status, 400));
  const pay = await admin.agent
    .post(`/api/orders/${unpaid.id}/pay-from-wallet`)
    .set('x-csrf-token', admin.csrf)
    .send({});
  check('wallet funding rejects insufficient backing', () => {
    assert.equal(pay.status, 400);
    assert.match(pay.body.error, /INSUFFICIENT_FUNDS/);
  });
  const publish = await admin.agent
    .post(`/api/management/orders/${unpaid.id}/publish`)
    .set('x-csrf-token', admin.csrf)
    .send({});
  check('unpaid order cannot publish to Discord', () => {
    assert.equal(publish.status, 400);
    assert.match(publish.body.message, /CANNOT_PUBLISH_ORDER/);
  });
  let sends = 0,
    edits = 0;
  const message = {
    id: `${prefix}message`,
    edit: async () => {
      edits++;
      return message;
    },
  };
  const channel = {
    id: `${prefix}channel`,
    isTextBased: () => true,
    send: async () => {
      sends++;
      return message;
    },
    messages: { fetch: async () => message },
  };
  setGlobalDiscordClient({ channels: { fetch: async () => channel } } as any);
  await prisma.order.update({ where: { id: order.id }, data: { discordChannelId: channel.id } });
  const firstPublish = await admin.agent
    .post(`/api/management/orders/${order.id}/publish`)
    .set('x-csrf-token', admin.csrf)
    .send({});
  const refresh = await admin.agent
    .post(`/api/management/orders/${order.id}/publish`)
    .set('x-csrf-token', admin.csrf)
    .send({});
  check('Discord publish and refresh reuse the existing card without duplicate messages', () => {
    assert.equal(firstPublish.status, 200, JSON.stringify(firstPublish.body));
    assert.equal(refresh.status, 200);
    assert.equal(sends, 1);
    assert.equal(edits, 1);
  });
  const published = await admin.agent.get(`/api/management/orders/${order.id}`);
  check('Discord references and refresh capability are reflected in order details', () => {
    assert.equal(published.body.order.discordMessageId, message.id);
    assert(published.body.order.authorizedActions.includes('refresh_card'));
    assert(!published.body.order.authorizedActions.includes('publish'));
  });
  setGlobalDiscordClient(null);
  const candidates = [];
  for (const [index, assignedRole] of ['tank', 'healer', 'dps', 'dps'].entries()) {
    const userId = id(`candidate${index}`);
    await prisma.user.create({ data: { discordId: userId, username: `Candidate${index}` } });
    const claim = await prisma.orderPresign.create({
      data: { orderId: order.id, userId, registeredRole: assignedRole },
    });
    candidates.push({ claimId: claim.id, assignedRole });
  }
  const partial = await admin.agent
    .post(`/api/management/orders/${order.id}/assign`)
    .set('x-csrf-token', admin.csrf)
    .send({ candidates: candidates.slice(0, 1) });
  check('partial Mythic+ roster rejected without reservations', () => {
    assert.equal(partial.status, 400);
    assert.match(partial.body.message, /COMPLETE_ROSTER_REQUIRED/);
  });
  const duplicate = await admin.agent
    .post(`/api/management/orders/${order.id}/assign`)
    .set('x-csrf-token', admin.csrf)
    .send({ candidates: [candidates[0], candidates[0], candidates[2], candidates[3]] });
  check('duplicate booster cannot occupy multiple slots', () => {
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.body.message, /DUPLICATE_BOOSTER/);
  });
  const unapproved = await admin.agent
    .post(`/api/management/orders/${order.id}/assign`)
    .set('x-csrf-token', admin.csrf)
    .send({ candidates });
  check('unapproved boosters cannot be assigned', () => {
    assert.equal(unapproved.status, 400);
    assert.match(unapproved.body.message, /approval/);
  });
  for (let index = 0; index < 4; index++)
    await prisma.userGameApproval.create({
      data: {
        userId: id(`candidate${index}`),
        gameSlug: 'wow_midnight',
        serviceId: service.id,
        approvalType: 'booster',
        status: 'approved',
        reviewedBy: id('admin'),
      },
    });
  // No live client is initialized; assignment still persists using the existing engine.
  const assigned = await admin.agent
    .post(`/api/management/orders/${order.id}/assign`)
    .set('x-csrf-token', admin.csrf)
    .send({ candidates });
  check('approved complete roster is assigned via existing engine', () => {
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    assert.equal(assigned.body.assignments.length, 4);
  });
  const state = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { assignments: true, reservations: true },
  });
  check('assignment creates four reservations and preserves proof and dispute history', () => {
    assert.equal(state.status, 'assigned');
    assert.equal(state.assignments.length, 4);
    assert.equal(state.reservations.length, 4);
  });
  const after = await admin.agent.get(`/api/management/orders/${order.id}`);
  check('details include persisted assignment and audit history after mutation', () => {
    assert.equal(after.body.order.assignments.length, 4);
    assert.equal(after.body.order.runs[0].proofs.length, 1);
    assert.equal(after.body.order.disputes.length, 1);
    assert(after.body.order.auditLogs.some((a: any) => a.action === 'ORDER_ASSIGNMENT_CREATED'));
  });
  setGlobalDiscordClient({ channels: { fetch: async () => channel } } as any);
  const assignedRefresh = await admin.agent
    .post(`/api/management/orders/${order.id}/refresh-discord`)
    .set('x-csrf-token', admin.csrf)
    .send({});
  check(
    'assigned order can synchronize its existing card without reopening claims or duplicate messages',
    () => {
      assert.equal(assignedRefresh.status, 200, JSON.stringify(assignedRefresh.body));
      assert.equal(sends, 1);
      assert.equal(edits, 2);
    },
  );
  const unfundedRefresh = await admin.agent
    .post(`/api/management/orders/${unpaid.id}/refresh-discord`)
    .set('x-csrf-token', admin.csrf)
    .send({});
  check('Discord refresh cannot bypass initial publication or funding', () =>
    assert.equal(unfundedRefresh.status, 400),
  );
  setGlobalDiscordClient(null);
  await prisma.userRole.deleteMany({ where: { userId: id('admin') } });
  const stale = await admin.agent.get(`/api/management/orders/${order.id}`);
  check('revoked role in an existing session immediately loses access', () =>
    assert.equal(stale.status, 403),
  );
  check('financial gates remain disabled', () => {
    for (const name of [
      'ESCROW_RELEASE_ENABLED',
      'FINANCE_V2_LIVE_CREDITS_ENABLED',
      'FINANCE_V2_LIVE_PAYOUTS_ENABLED',
      'FINANCE_V2_P2P_SETTLEMENT_ENABLED',
    ])
      assert.notEqual(process.env[name], 'true');
  });
  console.log(`${passed} API regression checks passed`);
}
main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    sessionStore.stopCleanup();
  });
