/* Exercises the real React workspace and HTTP client contracts without a browser or live services. */
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { jsx: 'react', module: 'CommonJS', moduleResolution: 'node' },
});
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { MemoryRouter } = require('react-router-dom');
const { orderWorkspaceActions } = require('../src/services/orderWorkspacePolicy');
const { Permission: P, ROLE_PERMISSIONS } = require('../src/services/permissionTypes');
const auth = require('../frontend/src/hooks/useAuth');
let roles = ['admin'];
auth.useAuth = () => ({ hasRole: (...requested) => requested.some((r) => roles.includes(r)) });
const api = require('../frontend/src/services/api');
const operations = require('../frontend/src/services/operations');
const { OrderManagementWorkspace } = require('../frontend/src/components/orders/OrderManagementWorkspace');
global.document = { activeElement: null, addEventListener() {}, removeEventListener() {} };
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}
const base = {
  status: 'open_presign',
  paymentStatus: 'verified',
  creatorType: 'g4x',
  discordMessageId: null,
};
for (const role of ['manager', 'admin', 'owner']) {
  check(`${role} receives authorized publication and assignment`, () => {
    const actions = orderWorkspaceActions(base, new Set(ROLE_PERMISSIONS[role]), true);
    assert(actions.includes('publish'));
    assert(actions.includes('assign'));
    assert(!actions.includes('pay_wallet'));
  });
}
check('staff cannot publish, cancel, pay or finally approve', () => {
  const actions = orderWorkspaceActions(
    { ...base, boostReleaseTracker: { stage: 'STAFF_REVIEW' } },
    new Set(ROLE_PERMISSIONS.staff),
    true,
  );
  assert.deepEqual(actions, ['view_diagnostics']);
});
check('unpaid, assigned and terminal orders do not expose publication shortcuts', () => {
  for (const order of [
    { ...base, paymentStatus: 'pending' },
    { ...base, status: 'assigned' },
    { ...base, status: 'cancelled' },
    { ...base, status: 'completed' },
  ]) {
    const actions = orderWorkspaceActions(order, new Set(ROLE_PERMISSIONS.admin), false);
    assert(!actions.includes('publish'));
    assert(!actions.includes('refresh_card'));
  }
});
check('disputes and holds block approval; advertiser never gets G4X release stages', () => {
  for (const extra of [
    { disputes: [{ status: 'under_review' }] },
    { escrowHolds: [{ status: 'active' }] },
    { creatorType: 'advertiser' },
  ]) {
    const actions = orderWorkspaceActions(
      { ...base, boostReleaseTracker: { stage: 'STAFF_REVIEW' }, ...extra },
      new Set(ROLE_PERMISSIONS.admin),
      true,
    );
    assert(!actions.includes('final_approve'));
  }
});
check('already approved clock cannot be restarted and absent permissions fail closed', () => {
  assert(
    !orderWorkspaceActions(
      { ...base, boostReleaseTracker: { stage: 'STAFF_REVIEW', adminFinalApprovedAt: new Date() } },
      new Set(ROLE_PERMISSIONS.admin),
      true,
    ).includes('final_approve'),
  );
  assert.deepEqual(orderWorkspaceActions(base, new Set(), true), ['view_diagnostics']);
});
const order = {
  id: 42,
  orderRef: 'TASK2-42',
  gameName: 'WoW',
  serviceName: 'Mythic+',
  status: 'open_presign',
  paymentStatus: 'verified',
  simplifiedStatus: { label: 'Open Pre-sign', colorClass: 'badge-green', rawStatus: 'open_presign' },
  authorizedActions: [],
};
const detail = {
  orderId: 42,
  orderRef: order.orderRef,
  gameName: 'WoW',
  serviceName: 'Mythic+',
  status: 'open_presign',
  paymentStatus: 'verified',
  authorizedActions: [],
  auditAvailable: true,
  auditLogs: [
    {
      id: 1,
      action: 'ORDER_CREATED',
      actor: { username: 'Operator' },
      createdAt: new Date().toISOString(),
      isSuccess: true,
    },
  ],
  publicationBlockReasons: [],
  assignments: [],
  presigns: [],
  requiredRoles: [],
  runs: [],
  disputes: [],
  escrowHolds: [],
  creatorWalletAvailableCents: 0,
};
let listCalls = [];
operations.fetchManagementOrders = async (params) => {
  listCalls.push(params);
  return {
    orders: [order],
    pagination: { page: params.page, limit: params.limit, total: 31, totalPages: 3 },
  };
};
operations.fetchOrderDiagnostics = async () => ({ order: detail });
api.apiRequest = async () => ({
  games: [{ slug: 'wow_midnight', displayName: 'World of Warcraft Midnight' }],
});
const text = (node) => JSON.stringify(node.toJSON());
const buttons = (node, label) =>
  node.root.findAllByType('button').filter((b) => b.children.join('') === label);
async function click(node, label) {
  await act(async () => {
    buttons(node, label)[0].props.onClick();
  });
}
async function main() {
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(MemoryRouter, null, React.createElement(OrderManagementWorkspace)));
  });
  check('real backend status object renders safely and game registry slug appears', () => {
    assert(text(renderer).includes('Open Pre-sign'));
    assert(text(renderer).includes('wow_midnight'));
  });
  const search = renderer.root.findAllByType('input').find((i) => i.props.placeholder);
  await act(async () => {
    search.props.onChange({ target: { value: 'TASK2' } });
  });
  check('typing does not fetch until filters are applied', () => assert.equal(listCalls.length, 1));
  await act(async () => {
    renderer.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} });
  });
  check('applying filters resets page and sends search', () => {
    assert.equal(listCalls.at(-1).search, 'TASK2');
    assert.equal(listCalls.at(-1).page, 1);
  });
  await click(renderer, 'Next');
  check('next page retains filters', () => {
    assert.equal(listCalls.at(-1).page, 2);
    assert.equal(listCalls.at(-1).search, 'TASK2');
  });
  await click(renderer, 'Details & actions');
  check('details use real audit actor and fail closed for unavailable actions', () => {
    assert(text(renderer).includes('Operator'));
    assert.equal(buttons(renderer, 'Publish to Discord').length, 0);
    assert.equal(buttons(renderer, 'Final operational approval').length, 0);
  });
  await click(renderer, 'Close');
  operations.fetchOrderDiagnostics = async () => {
    throw new Error('DETAILS_DENIED');
  };
  await click(renderer, 'Details & actions');
  check('details failures show an accessible error and retry', () => {
    assert(text(renderer).includes('DETAILS_DENIED'));
    assert.equal(buttons(renderer, 'Retry details').length, 1);
  });
  await click(renderer, 'Close');
  detail.authorizedActions = ['publish'];
  operations.fetchOrderDiagnostics = async () => ({ order: detail });
  let publishCalls = 0,
    finishPublish;
  operations.publishOrderCard = () => {
    publishCalls++;
    return new Promise((resolve) => {
      finishPublish = resolve;
    });
  };
  await click(renderer, 'Details & actions');
  await click(renderer, 'Publish to Discord');
  const actionForm = renderer.root.findAllByType('form').at(-1);
  await act(async () => {
    actionForm.props.onSubmit({ preventDefault() {} });
    actionForm.props.onSubmit({ preventDefault() {} });
  });
  check('double submission sends a single authorized mutation', () => assert.equal(publishCalls, 1));
  await act(async () => {
    finishPublish({ success: true });
  });
  check('completed mutations refresh the visible lifecycle and show feedback', () => {
    assert(text(renderer).includes('completed for TASK2-42'));
    assert.equal(buttons(renderer, 'Confirm action').length, 0);
  });
  await act(async () => renderer.unmount());
  roles = ['staff'];
  const before = listCalls.length;
  await act(async () => {
    renderer = create(React.createElement(MemoryRouter, null, React.createElement(OrderManagementWorkspace)));
  });
  check('staff cannot load the management workspace', () => {
    assert(text(renderer).includes('access is required'));
    assert.equal(listCalls.length, before);
  });
  await act(async () => renderer.unmount());
  console.log(`${passed} regression checks passed`);
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
