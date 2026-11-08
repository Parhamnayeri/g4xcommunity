/* Read-only preflight for PR #1 + PR #2. --combined checks the actual future integrated tree. */
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const combined = process.argv.includes('--combined');
const refArg = process.argv.find(a => a.startsWith('--pr1-ref='));
const pr1 = refArg ? refArg.slice('--pr1-ref='.length) : '02337ae4ee8f36593abd07964549aa2bd465b18b';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
const base = git('merge-base', pr1, 'HEAD');
const one = file => git('show', `${pr1}:${file}`);
const two = file => fs.readFileSync(file, 'utf8').trimEnd();
const ancestor = file => git('show', `${base}:${file}`);
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
function parse(file, code) { return ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS); }
function routes(code) {
  const found = new Map();
  function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText() === 'Route') {
      const attr = node.attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText() === 'path');
      if (attr && attr.initializer && ts.isStringLiteral(attr.initializer)) {
        const route = attr.initializer.text;
        assert(!found.has(route), `Duplicate React route ${route}`);
        found.set(route, node.getText());
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parse('App.tsx', code)); return found;
}
function endpoints(code) {
  const found = new Map();
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText() === 'operationsRouter' && node.arguments.length && ts.isStringLiteral(node.arguments[0])) {
      const method = node.expression.name.text;
      if (['get','post','put','patch','delete'].includes(method)) {
        const key = `${method.toUpperCase()} ${node.arguments[0].text}`;
        assert(!found.has(key), `Duplicate Express endpoint ${key}`);
        found.set(key, node.getText());
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parse('operationsRoutes.ts',code)); return found;
}
const app1 = routes(one('frontend/src/App.tsx')), app2 = routes(two('frontend/src/App.tsx')), original = routes(ancestor('frontend/src/App.tsx'));
const expectedOrderRoutes = ['/orders','/management/orders','/admin/orders','/owner/orders'];
const expectedAdminRoutes = ['/management/applications','/admin/applications','/admin/games','/admin/discord'];
check('both React route tables have unique paths and preserve existing routes', () => {
  for (const route of original.keys()) { assert(app1.has(route)); assert(app2.has(route)); }
});
check('new order and admin routes are disjoint and all have error boundaries', () => {
  for (const route of expectedOrderRoutes) assert(app1.get(route)?.includes('RouteErrorBoundary'), route);
  for (const route of expectedAdminRoutes) assert(app2.get(route)?.includes('RouteErrorBoundary'), route);
  const added1 = [...app1.keys()].filter(p => !original.has(p));
  const added2 = [...app2.keys()].filter(p => !original.has(p));
  if (!combined) assert(!added1.some(p => added2.includes(p)), 'New route paths collide');
});
check('order deep links retain defaultTab-aware Admin and Owner portals', () => {
  assert(app1.get('/admin/orders').includes('defaultTab="orders"'));
  assert(app1.get('/owner/orders').includes('defaultTab="orders"'));
  assert(one('frontend/src/pages/AdminPage.tsx').includes('setActiveTab(defaultTab)'));
});
check('native modules reuse shared navigation and application workspace', () => {
  assert(two('frontend/src/pages/AdminPage.tsx').includes('<AdminModuleNavigation />'));
  assert(two('frontend/src/pages/ManagementPage.tsx').includes('<ApplicationsWorkspace />'));
  assert(!two('frontend/src/pages/ManagementPage.tsx').includes('const [selectedApp,'));
});
const api1 = endpoints(one('src/web/operationsRoutes.ts')), api2 = endpoints(two('src/web/operationsRoutes.ts')), api0 = endpoints(ancestor('src/web/operationsRoutes.ts'));
check('new Express endpoint paths do not shadow each other', () => {
  if (!combined) for (const key of api1.keys()) if (!api0.has(key)) assert(!api2.has(key), `Endpoint collision ${key}`);
});
check('PR1 order detail, assignment, approval and Discord guards remain authoritative', () => {
  assert(api1.get('GET /management/orders/:id').includes('Permission.ORDER_VIEW_PRIVATE'));
  for (const [name, permission] of [['assign','ORDER_ASSIGN'],['approve','ORDER_FINAL_APPROVE'],['refresh-discord','ORDER_PUBLISH']]) {
    const source = api1.get(`POST /management/orders/:id/${name}`);
    assert(source?.includes(`Permission.${permission}`)); assert(source.includes('requireCsrf'));
  }
});
check('PR2 application and configuration guards remain authoritative', () => {
  assert(api2.get('GET /management/applications').includes('applicationPermissions'));
  assert(api2.get('POST /management/applications/:id/review').includes('CANNOT_REVIEW_OWN_APPLICATION'));
  const source = two('src/web/operationsRoutes.ts');
  assert(source.replace(/\s+/g, '').includes("operationsRouter[method]('/management/channel-mappings/:key',requireAuth,requireLivePermission(Permission.SERVICE_CONFIG_MANAGE),requireCsrf"));
  assert(two('src/services/channelMappingConfigurationService.ts').includes('ACTIVE_ORDER_WORKFLOW'));
});
check('order and application API response contracts occupy separate namespaces', () => {
  assert(one('frontend/src/services/operations.ts').includes('return apiRequest(`/api/management/orders/${orderId}`)'));
  assert(two('src/web/operationsRoutes.ts').includes('applications: applications.map(applicationSummary)'));
  assert(two('frontend/src/components/admin/NativeAdminModules.tsx').includes('submittedAt'));
  assert(one('frontend/src/types/operations.ts').includes('label: string; colorClass: string; rawStatus: string'));
});
check('shared HTTP error handling and dependency contracts are preserved', () => {
  assert.equal(one('frontend/src/services/api.ts'), two('frontend/src/services/api.ts'));
  if (!combined) assert.equal(one('package-lock.json'), two('package-lock.json'));
  else {
    // Post-integration security remediation deliberately updates the router/uuid
    // and transitive patches. Preserve every other direct production contract,
    // and require the manifest to agree with the committed lockfile.
    const before = JSON.parse(one('package.json')).dependencies;
    const after = JSON.parse(two('package.json')).dependencies;
    for (const [name, version] of Object.entries(before)) {
      if (!['react-router-dom', 'uuid'].includes(name)) assert.equal(after[name], version, name);
    }
    assert.deepEqual(JSON.parse(two('package-lock.json')).packages[''].dependencies, after);
  }
  assert.equal(JSON.parse(one('package.json')).devDependencies['react-test-renderer'], JSON.parse(two('package.json')).devDependencies['react-test-renderer']);
});
const orderScripts = ['test:order-workspace','test:order-workspace:api'];
const adminScripts = ['test:native-admin','test:native-admin:react'];
check('both sets of independent regression entry points are present', () => {
  for (const key of orderScripts) assert(JSON.parse(one('package.json')).scripts[key]);
  for (const key of adminScripts) assert(JSON.parse(two('package.json')).scripts[key]);
});
check('OwnerGate, schema and finance gate definitions are unchanged by PR2', () => {
  for (const file of ['src/web/ownerGate.ts','prisma/schema.prisma','src/services/financeV2/financeV2Types.ts']) assert.equal(two(file), ancestor(file), file);
});
if (!combined) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'g4x-conflict-preflight-'));
  const files = [...new Set([...git('diff','--name-only',base,pr1).split('\n')])].filter(f => git('diff','--name-only',base,'HEAD').split('\n').includes(f));
  try {
    const conflicts = [];
    for (const file of files) {
      const paths = ['one','base','two'].map(name => path.join(directory,name));
      [one(file),ancestor(file),two(file)].forEach((content,i) => fs.writeFileSync(paths[i],content));
      const result = spawnSync('git',['merge-file','-p',...paths],{encoding:'utf8'});
      if (result.status > 0 && result.status < 128) conflicts.push(file);
      else assert.equal(result.status,0,result.stderr);
    }
    console.log(JSON.stringify({mode:'pre-merge-preflight',base,pr1:git('rev-parse',pr1),pr2:git('rev-parse','HEAD'),overlap:files,textConflicts:conflicts},null,2));
    console.log('No integration was performed. Actual combined-tree checks remain pending owner merge of PR #1.');
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
} else {
  check('actual combined route table contains both feature families exactly once', () => {
    for (const route of [...expectedOrderRoutes,...expectedAdminRoutes]) assert(app2.get(route)?.includes('RouteErrorBoundary'),route);
  });
  check('combined Management page preserves dispute deep link and removes both obsolete loaders', () => {
    const source=two('frontend/src/pages/ManagementPage.tsx');
    assert(source.includes('useSearchParams'));assert(source.includes("tab === 'disputes'"));
    assert(source.includes('<ApplicationsWorkspace />'));assert(source.includes('<OrderManagementWorkspace'));
    assert(!source.includes('const loadOrders ='));assert(!source.includes('const loadApplications ='));
  });
  check('combined Admin page retains order tab initialization and native navigation', () => {
    const source=two('frontend/src/pages/AdminPage.tsx');assert(source.includes('setActiveTab(defaultTab)'));assert(source.includes('<AdminModuleNavigation />'));
  });
  check('actual combined order endpoint guards and bodies remain identical to merged PR1', () => {
    for (const key of ['GET /management/orders/:id', 'POST /management/orders/:id/assign', 'POST /management/orders/:id/refresh-discord', 'POST /management/orders/:id/approve', 'POST /management/orders/:id/publish']) assert.equal(api2.get(key), api1.get(key), key);
  });
  check('combined tree retains PR1 order client, renderer, types and corrected KYC fixture', () => {
    for (const file of ['frontend/src/components/orders/OrderManagementWorkspace.tsx', 'frontend/src/services/operations.ts', 'frontend/src/types/operations.ts', 'src/test/website_phase7_operations_suite.ts']) assert.equal(two(file), one(file), file);
  });
  check('combined tree retains all four test scripts and both guarded API families', () => {
    const scripts=JSON.parse(two('package.json')).scripts;for(const name of [...orderScripts,...adminScripts])assert(scripts[name]);
    for(const key of ['GET /management/orders/:id','POST /management/orders/:id/assign','POST /management/orders/:id/refresh-discord','GET /management/applications/:id'])assert(api2.has(key),key);
  });
}
console.log(`${passed} compatibility contract checks passed (${combined?'combined tree':'independent heads only'}).`);
