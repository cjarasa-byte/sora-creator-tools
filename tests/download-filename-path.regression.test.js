const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CONTENT_PATH = path.join(__dirname, '..', 'content.js');
const BACKGROUND_PATH = path.join(__dirname, '..', 'background.js');

function loadContentSanitizer() {
  const src = fs.readFileSync(CONTENT_PATH, 'utf8');
  const sanitizeStringStart = src.indexOf('  function sanitizeString(value, maxLen = MAX_STR_LEN) {');
  const sanitizeStringEnd = src.indexOf('  function sanitizeNumber(value, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {', sanitizeStringStart);
  const sanitizeDownloadStart = src.indexOf('  function sanitizeDownloadFilename(value) {');
  const sanitizeDownloadEnd = src.indexOf('  function postMetricsResponse(req, metrics = { users: {} }, metricsUpdatedAt = 0) {', sanitizeDownloadStart);
  assert.notEqual(sanitizeStringStart, -1, 'content sanitizeString not found');
  assert.notEqual(sanitizeStringEnd, -1, 'content sanitizeString end not found');
  assert.notEqual(sanitizeDownloadStart, -1, 'content sanitizeDownloadFilename not found');
  assert.notEqual(sanitizeDownloadEnd, -1, 'content sanitizeDownloadFilename end not found');
  const snippet = `${src.slice(sanitizeStringStart, sanitizeStringEnd)}\n${src.slice(sanitizeDownloadStart, sanitizeDownloadEnd)}`;

  const context = vm.createContext({});
  const bootstrap = `
    const MAX_STR_LEN = 4096;
    const MAX_DOWNLOAD_FILENAME_LEN = 240;
${snippet}
    globalThis.__api = { sanitizeDownloadFilename };
  `;
  vm.runInContext(bootstrap, context, { filename: 'content-download-filename.harness.js' });
  return context.__api;
}

function loadBackgroundSanitizer() {
  const src = fs.readFileSync(BACKGROUND_PATH, 'utf8');
  const start = src.indexOf('function sanitizeString(value, maxLen = 4096) {');
  const end = src.indexOf('function isTrustedSender(sender) {', start);
  assert.notEqual(start, -1, 'background sanitizeString not found');
  assert.notEqual(end, -1, 'background sanitizer block not found');
  const snippet = src.slice(start, end);

  const context = vm.createContext({});
  const bootstrap = `
    const MAX_DOWNLOAD_FILENAME_LEN = 240;
${snippet}
    globalThis.__api = { sanitizeDownloadFilename };
  `;
  vm.runInContext(bootstrap, context, { filename: 'background-download-filename.harness.js' });
  return context.__api;
}

test('download filename sanitizers keep folder separators and strip traversal segments', () => {
  const content = loadContentSanitizer();
  const background = loadBackgroundSanitizer();

  const input = '/alice//2026-03-26/.././sora-draft-123.mp4';
  const expected = 'alice/2026-03-26/sora-draft-123.mp4';

  assert.equal(content.sanitizeDownloadFilename(input), expected);
  assert.equal(background.sanitizeDownloadFilename(input), expected);
});
