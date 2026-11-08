import assert from 'node:assert/strict';
import fs from 'node:fs';
import request from 'supertest';
import prisma from '../database/db';
import { seed } from '../database/seed';
import { app, sessionStore } from '../web/server';

if (!/\/g4x-release-blockers-[^/]+\/release_fixture\.db$/.test(process.env.DATABASE_URL || '')) {
  throw new Error('Run through scripts/test-release-blockers.cjs; disposable database required');
}
const server = app.listen(0, '127.0.0.1');
let passed = 0;
function check(name: string, condition: unknown) {
  assert(condition, name); passed++; console.log(`PASS ${name}`);
}
async function main() {
  await seed();
  assert(fs.existsSync('frontend/dist/index.html'), 'Run npm run build before production SPA tests');
  const entry = fs.readFileSync('frontend/dist/index.html', 'utf8');
  const source = fs.readFileSync('frontend/src/App.tsx', 'utf8');
  const pages = [...source.matchAll(/path\s*=\s*"([^"]+)"/g)].map(match => match[1]).filter(value => value !== '*');
  check('routing test covers every concrete React page', pages.length >= 30);
  for (const page of pages) {
    for (const accept of ['text/html', '*/*']) {
      const response = await request(server).get(page).set('Accept', accept);
      check(`direct navigation/refresh ${page} (${accept})`, response.status === 200 &&
        /text\/html/.test(response.headers['content-type'] || '') && response.text === entry);
    }
  }
  const asset = entry.match(/src="([^"]+\.js)"/)?.[1];
  assert(asset, 'production entry must reference a compiled JavaScript asset');
  const staticResponse = await request(server).get(asset);
  check('compiled static asset remains available', staticResponse.status === 200 &&
    !/text\/html/.test(staticResponse.headers['content-type'] || ''));
  for (const endpoint of ['/api/management/orders', '/api/management/applications', '/api/admin/games', '/api/management/channel-mappings']) {
    const response = await request(server).get(endpoint).set('Accept', 'text/html');
    check(`API still denies anonymous users ${endpoint}`, response.status === 401 && /json/.test(response.headers['content-type']));
  }
  const oldAlias = await request(server).get('/admin/orders').set('Accept', 'application/json');
  check('explicit JSON root alias keeps authentication', oldAlias.status === 401 && /json/.test(oldAlias.headers['content-type']));
  for (const endpoint of ['/api', '/api/not-a-real-route', '/api/admin/not-a-real-route']) {
    const response = await request(server).get(endpoint).set('Accept', 'text/html');
    check(`unknown API never receives SPA HTML ${endpoint}`, response.status === 404 && /json/.test(response.headers['content-type']));
  }
  for (const page of ['/legacy', '/legacy/orders']) {
    const response = await request(server).get(page);
    check(`legacy remains available ${page}`, response.status === 200 && /html/.test(response.headers['content-type']) && response.text !== entry);
  }
  const oauth = await request(server).get('/auth/discord');
  check('OAuth start still redirects to Discord without making a Discord request', oauth.status === 302 &&
    oauth.headers.location.startsWith('https://discord.com/api/oauth2/authorize?') && oauth.headers.location.includes('state='));
  const callback = await request(server).get('/auth/callback');
  check('OAuth callback validation still returns JSON', callback.status === 400 && /json/.test(callback.headers['content-type']));
  const invalidState = await request(server).get('/auth/callback?code=fixture&state=invalid');
  check('OAuth forged state remains denied', invalidState.status === 403);
  for (const gate of ['/OwnerGate', '/ownergate']) {
    const response = await request(server).get(gate);
    check(`OwnerGate remains its own HTML handler ${gate}`, response.status === 200 && /html/.test(response.headers['content-type']) && response.text !== entry);
  }
  for (const endpoint of ['/auth/missing-route', '/OwnerGate/missing-route']) {
    const response = await request(server).get(endpoint);
    check(`unknown authentication route never receives React entry ${endpoint}`, response.status === 404 && response.text !== entry);
  }
  await prisma.user.create({ data: { discordId: 'spa_manager', username: 'Fixture', userRoles: { create: { roleKey: 'manager' } } } });
  const agent = request.agent(server);
  const csrf = await agent.get('/api/csrf-token');
  const sid = String(csrf.headers['set-cookie']?.[0]).match(/g4x\.sid=s%3A([^.]+)\./)?.[1];
  assert(sid);
  await new Promise<void>((resolve, reject) => sessionStore.get(sid, (err, session) => {
    if (err || !session) return reject(err || Error('No session'));
    sessionStore.set(sid, { ...session, userId: 'spa_manager' }, error => error ? reject(error) : resolve());
  }));
  const authenticatedPage = await agent.get('/admin/orders').set('Accept', 'text/html');
  check('authenticated direct page navigation also receives React entry', authenticatedPage.status === 200 && authenticatedPage.text === entry);
  const api = await agent.get('/api/management/orders');
  check('authorized order API remains JSON', api.status === 200 && /json/.test(api.headers['content-type']));
  const alias = await agent.get('/admin/orders').set('Accept', 'application/json');
  check('authorized legacy JSON alias still works', alias.status === 200 && /json/.test(alias.headers['content-type']));
  const mutation = await agent.put('/api/management/channel-mappings/spa_fixture').send({ guildId: '123456789012345678' });
  check('authenticated mutation without CSRF remains denied', mutation.status === 403);
  console.log(`SPA ROUTING: ${passed} passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  sessionStore.stopCleanup();
  await prisma.$disconnect();
});
