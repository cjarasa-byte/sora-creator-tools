const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

function loadResolver(metaById = {}) {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const start = src.indexOf('  function resolvePostedTimestampMs(id) {');
  const end = src.indexOf('  function resolvePublicDownloadUrl(item) {', start);
  assert.notEqual(start, -1, 'resolvePostedTimestampMs start not found');
  assert.notEqual(end, -1, 'resolvePostedTimestampMs end not found');
  const snippet = src.slice(start, end);

  const context = vm.createContext({ metaById });
  const bootstrap = `
    const idToMeta = new Map(Object.entries(metaById));
${snippet}
    globalThis.__api = { resolvePostedTimestampMs };
  `;
  vm.runInContext(bootstrap, context, { filename: 'inject-download-posted-timestamp.harness.js' });
  return context.__api;
}

test('resolvePostedTimestampMs returns posting timestamp when available', () => {
  const api = loadResolver({
    d_123: { createdAtMs: 1711584000000 },
  });
  assert.equal(api.resolvePostedTimestampMs('d_123'), 1711584000000);
});

test('resolvePostedTimestampMs returns null when posting timestamp is missing or invalid', () => {
  const api = loadResolver({
    d_missing: {},
    d_invalid: { createdAtMs: 'not-a-number' },
    d_zero: { createdAtMs: 0 },
  });
  assert.equal(api.resolvePostedTimestampMs('d_missing'), null);
  assert.equal(api.resolvePostedTimestampMs('d_invalid'), null);
  assert.equal(api.resolvePostedTimestampMs('d_zero'), null);
});
