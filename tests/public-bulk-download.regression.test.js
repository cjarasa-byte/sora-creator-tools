const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

function loadInjectPublicHelpers() {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const normalizeIdStart = src.indexOf('  const normalizeId = (s) => s?.toString().split(/[?#]/)[0].trim();');
  const normalizeIdEnd = src.indexOf('  const getUniqueViews =', normalizeIdStart);
  const extractHrefStart = src.indexOf('  function extractPostIdFromHref(href) {');
  const extractHrefEnd = src.indexOf('  const extractIdFromCard = (el) => {', extractHrefStart);
  const resolveStart = src.indexOf('  function resolvePublicDownloadUrl(item) {');
  const resolveEnd = src.indexOf('  function buildPublicDownloadPath(postId) {', resolveStart);

  assert.notEqual(normalizeIdStart, -1, 'normalizeId start not found');
  assert.notEqual(normalizeIdEnd, -1, 'normalizeId end not found');
  assert.notEqual(extractHrefStart, -1, 'extractPostIdFromHref start not found');
  assert.notEqual(extractHrefEnd, -1, 'extractPostIdFromHref end not found');
  assert.notEqual(resolveStart, -1, 'resolvePublicDownloadUrl start not found');
  assert.notEqual(resolveEnd, -1, 'resolvePublicDownloadUrl end not found');

  const snippet = [
    src.slice(normalizeIdStart, normalizeIdEnd),
    src.slice(extractHrefStart, extractHrefEnd),
    src.slice(resolveStart, resolveEnd),
  ].join('\n');

  const context = vm.createContext({});
  vm.runInContext(`${snippet}\nglobalThis.__api = { extractPostIdFromHref, resolvePublicDownloadUrl };`, context, {
    filename: 'inject-public-bulk-download.harness.js',
  });
  return context.__api;
}

test('extractPostIdFromHref supports relative and absolute public post links', () => {
  const api = loadInjectPublicHelpers();
  assert.equal(api.extractPostIdFromHref('/p/s_abc123?foo=1'), 's_abc123');
  assert.equal(api.extractPostIdFromHref('https://sora.chatgpt.com/p/s_999xyz#frag'), 's_999xyz');
});

test('resolvePublicDownloadUrl falls back to attachment encoding source path', () => {
  const api = loadInjectPublicHelpers();
  const sample = {
    post: {
      attachments: [
        {
          encodings: {
            source: {
              path: 'https://videos.openai.com/example/source.mp4',
            },
          },
        },
      ],
    },
  };
  assert.equal(api.resolvePublicDownloadUrl(sample), 'https://videos.openai.com/example/source.mp4');
});
