const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

function loadBuildBackendJsonHeaders(capturedAuthToken) {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const start = src.indexOf('  function buildBackendJsonHeaders(extraHeaders = null) {');
  const end = src.indexOf('\n\n  async function fetchProfilePostCountEstimate()', start);
  assert.notEqual(start, -1, 'buildBackendJsonHeaders start not found');
  assert.notEqual(end, -1, 'buildBackendJsonHeaders end not found');

  const snippet = src.slice(start, end);
  const context = vm.createContext({ capturedAuthToken });
  vm.runInContext(`${snippet}\nglobalThis.__fn = buildBackendJsonHeaders;`, context, {
    filename: 'inject-backend-auth-header.harness.js',
  });
  return context.__fn;
}

test('buildBackendJsonHeaders includes bearer auth when captured token exists', () => {
  const fn = loadBuildBackendJsonHeaders('Bearer abc123');
  const headers = JSON.parse(JSON.stringify(fn()));
  assert.deepEqual(headers, {
    Accept: 'application/json',
    Authorization: 'Bearer abc123',
  });
});

test('buildBackendJsonHeaders omits auth for non-bearer token and merges extra headers', () => {
  const fn = loadBuildBackendJsonHeaders('Basic not-supported');
  const headers = JSON.parse(JSON.stringify(fn({ 'X-Test': 'ok' })));
  assert.deepEqual(headers, {
    Accept: 'application/json',
    'X-Test': 'ok',
  });
});
