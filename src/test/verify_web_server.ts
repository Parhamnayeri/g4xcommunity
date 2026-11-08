import request from 'supertest';
import { app } from '../web/server';

async function verifyWebServer() {
  console.log('Testing Express web server integration...');

  // 1. GET / should return React HTML
  const resHome = await request(app).get('/');
  console.log('GET / status:', resHome.status);
  if (!resHome.text.includes('id="root"') && !resHome.text.includes('G4X Community')) {
    throw new Error('GET / did not return the React entry HTML!');
  }
  console.log('✅ GET / serves React SPA');

  // 2. GET /legacy should return Legacy Portal HTML
  const resLegacy = await request(app).get('/legacy');
  console.log('GET /legacy status:', resLegacy.status);
  if (!resLegacy.text.includes('MARKETPLACE &amp; FINANCE') && !resLegacy.text.includes('main-content')) {
    throw new Error('GET /legacy did not return legacy portal HTML!');
  }
  console.log('✅ GET /legacy serves Legacy Portal');

  // 3. GET /api/public/games should return JSON
  const resGames = await request(app).get('/api/public/games');
  console.log('GET /api/public/games status:', resGames.status);
  if (resGames.status !== 200 || !resGames.body.success) {
    throw new Error('GET /api/public/games failed!');
  }
  console.log('✅ GET /api/public/games returned games count:', resGames.body.games?.length);

  // 4. GET /OwnerGate should return OwnerGate HTML
  const resOwnerGate = await request(app).get('/OwnerGate');
  console.log('GET /OwnerGate status:', resOwnerGate.status);
  if (!resOwnerGate.text.includes('OwnerGate') && !resOwnerGate.text.includes('G4X')) {
    throw new Error('GET /OwnerGate did not return OwnerGate portal!');
  }
  console.log('✅ GET /OwnerGate serves OwnerGate');

  // 5. GET /api/me without auth should return 401 JSON, NOT HTML
  const resMe = await request(app).get('/api/me');
  console.log('GET /api/me status:', resMe.status);
  if (resMe.status !== 401 || resMe.headers['content-type']?.includes('html')) {
    throw new Error('GET /api/me was swallowed by SPA fallback!');
  }
  console.log('✅ GET /api/me returns 401 JSON and is NOT swallowed by SPA fallback');

  // 6. SPA deep link /rules and /dashboard should return React HTML
  const resRules = await request(app).get('/rules');
  if (!resRules.text.includes('id="root"')) {
    throw new Error('SPA deep link /rules failed to return React HTML!');
  }
  console.log('✅ SPA deep links return React HTML');

  console.log('\n=== ALL WEB SERVER INTEGRATION CHECKS PASSED ===');
}

verifyWebServer().catch((e) => {
  console.error('❌ Verification failed:', e);
  process.exit(1);
});
