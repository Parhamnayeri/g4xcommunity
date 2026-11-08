/* Compatibility checks for scoped security overrides; no database or live network access. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const { deepmerge } = await import('deepmerge-ts');
  assert.deepEqual(deepmerge({ nested: { first: 1 } }, { nested: { second: 2 } }), { nested: { first: 1, second: 2 } });
  console.log('PASS patched deepmerge keeps Prisma nested-configuration merge contract');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'g4x-prisma-config-'));
  try {
    const schema = path.resolve('prisma/schema.prisma');
    fs.writeFileSync(path.join(directory, 'prisma.config.js'), `module.exports = { schema: ${JSON.stringify(schema)} };\n`);
    const result = await require('@prisma/config').loadConfigFromFile({ configRoot: directory });
    assert(!result.error, JSON.stringify(result.error));
    assert.equal(result.config.schema, schema);
    console.log('PASS Prisma 6 loads explicit configuration with deepmerge 8');
  } finally { fs.rmSync(directory, { recursive: true }); }
  // node-cron 3 uses only uuid.v4(). Keep its scheduler major and callback API unchanged.
  const cron = require('node-cron');
  assert(cron.validate('*/5 * * * *'));
  let callbacks = 0;
  const task = cron.schedule('*/5 * * * *', () => { callbacks++; }, { scheduled: false });
  assert(require('uuid').validate(task.options.name));
  task.start(); task.stop();
  assert.equal(callbacks, 0);
  console.log('PASS node-cron 3 creates a v4 task ID and retains start/stop without executing a financial callback');
})().catch(error => { console.error(error); process.exitCode = 1; });
