require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { jsx: 'react', module: 'CommonJS', moduleResolution: 'node' },
});
const React = require('react'),
  assert = require('node:assert/strict'),
  { act, create } = require('react-test-renderer'),
  { MemoryRouter } = require('react-router-dom');
const auth = require('../frontend/src/hooks/useAuth');
let roles = ['manager'];
auth.useAuth = () => ({ hasRole: (...r) => r.some((x) => roles.includes(x)) });
const api = require('../frontend/src/services/api');
const {
  ApplicationsWorkspace,
  GamesWorkspace,
  ChannelsWorkspace,
} = require('../frontend/src/components/admin/NativeAdminModules');
global.window = { confirm: () => true };
let passed = 0,
  calls = [];
const app = {
  id: 1,
  userId: '123456789012345678',
  username: 'Alice',
  category: 'booster',
  status: 'pending',
  submittedAt: '2026-11-05T12:00:00Z',
  identityStatus: 'none',
};
let respond = async (url) =>
  url.includes('/applications?')
    ? { applications: [app], pagination: { page: 1, totalPages: 2, total: 16, limit: 15 } }
    : url.endsWith('/applications/1')
      ? {
          application: {
            ...app,
            actions: ['request_info', 'approve', 'reject'],
            qualifications: { experience: 'Experienced' },
          },
          history: [],
        }
      : url === '/api/admin/games'
        ? { games: [] }
        : url === '/api/management/channel-mappings'
          ? { mappings: [] }
          : {};
api.apiRequest = async (url, options) => {
  calls.push({ url, options });
  return respond(url, options);
};
const text = (r) => JSON.stringify(r.toJSON());
const buttons = (r, label) => r.root.findAllByType('button').filter((b) => b.children.join('') === label);
const check = (name, fn) => {
  fn();
  passed++;
  console.log('PASS ' + name);
};
async function mount(component) {
  let r;
  await act(async () => {
    r = create(React.createElement(MemoryRouter, null, React.createElement(component)));
  });
  return r;
}
async function main() {
  let r = await mount(ApplicationsWorkspace);
  check('native admin navigation links exist', () => {
    const hrefs = r.root.findAllByType('a').map((a) => a.props.href);
    for (const path of ['/management/applications', '/admin/games', '/admin/discord'])
      assert(hrefs.includes(path));
  });
  check('application API username and submitted date render', () => {
    assert(text(r).includes('Alice'));
    assert(text(r).includes('123456789012345678'));
    assert(!text(r).includes('Invalid Date'));
  });
  await act(async () => {
    buttons(r, 'View #1')[0].props.onClick();
  });
  check('details expose supported review actions and protected KYC navigation', () => {
    assert(text(r).includes('Experienced'));
    assert(text(r).includes('/management/kyc'));
    assert(text(r).includes('Reviewer notes'));
  });
  await act(async () => {
    r.root.findByType('textarea').props.onChange({ target: { value: 'Please provide experience' } });
  });
  await act(async () => {
    await r.root
      .findAllByType('form')
      .at(-1)
      .props.onSubmit({ preventDefault() {} });
  });
  check('review sends existing supported decision with notes', () => {
    const review = calls.find((c) => c.url.endsWith('/1/review'));
    assert.equal(review.options.method, 'POST');
    assert.equal(JSON.parse(review.options.body).decision, 'request_info');
    assert.equal(JSON.parse(review.options.body).reviewerNotes, 'Please provide experience');
  });
  await act(async () => r.unmount());
  respond = async (url) => (url === '/api/admin/games' ? { games: [] } : { mappings: [] });
  r = await mount(GamesWorkspace);
  check('empty game registry remains usable', () => {
    assert(text(r).includes('No matching games'));
    assert(text(r).includes('Create game'));
  });
  await act(async () => r.unmount());
  respond = async () => ({ games: [null] });
  r = await mount(GamesWorkspace);
  check('malformed game API response produces an error instead of an exception', () =>
    assert(text(r).includes('Malformed API response')),
  );
  await act(async () => r.unmount());
  respond = async () => {
    const e = new Error('Forbidden');
    e.status = 403;
    throw e;
  };
  r = await mount(ApplicationsWorkspace);
  check('403 produces explicit forbidden state', () => assert(text(r).includes('do not have permission')));
  await act(async () => r.unmount());
  respond = async () => {
    const e = new Error('Unauthorized');
    e.status = 401;
    throw e;
  };
  r = await mount(ChannelsWorkspace);
  check('401 produces explicit sign-in state', () => assert(text(r).includes('Sign in to continue')));
  await act(async () => r.unmount());
  respond = async (url) => (url === '/api/admin/games' ? { games: [] } : { mappings: [] });
  r = await mount(ChannelsWorkspace);
  check('channel IDs have frontend snowflake validation and saved/live distinction', () => {
    const inputs = r.root.findAllByType('input');
    assert(inputs.filter((i) => i.props.pattern === '[1-9][0-9]{16,19}').length === 2);
    assert(text(r).includes('Saved configuration is separate'));
    assert(text(r).includes('No matching channel mappings'));
  });
  await act(async () => r.unmount());
  roles = ['admin'];
  r = await mount(ChannelsWorkspace);
  check('admin sees read-only mapping configuration', () => {
    assert(text(r).includes('Read-only'));
    assert(!text(r).includes('Save configuration (unverified)'));
  });
  await act(async () => r.unmount());
  roles = ['staff'];
  r = await mount(GamesWorkspace);
  check('staff cannot render privileged registry forms', () => {
    assert(text(r).includes('access required'));
    assert(!text(r).includes('Save game'));
  });
  await act(async () => r.unmount());
  roles = ['manager'];
  let resolve;
  respond = () =>
    new Promise((r) => {
      resolve = r;
    });
  let loading;
  await act(async () => {
    loading = create(React.createElement(MemoryRouter, null, React.createElement(GamesWorkspace)));
  });
  check('pending requests show loading', () => assert(text(loading).includes('Loading registry')));
  await act(async () => {
    resolve({ games: [] });
  });
  await act(async () => loading.unmount());
  console.log(`${passed} React migration checks passed`);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
