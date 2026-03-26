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
  const listCandidatesStart = src.indexOf('  function listPublicBulkDownloadCandidates() {');
  const listCandidatesEnd = src.indexOf('  async function bulkDownloadPublicPosts() {', listCandidatesStart);

  assert.notEqual(normalizeIdStart, -1, 'normalizeId start not found');
  assert.notEqual(normalizeIdEnd, -1, 'normalizeId end not found');
  assert.notEqual(extractHrefStart, -1, 'extractPostIdFromHref start not found');
  assert.notEqual(extractHrefEnd, -1, 'extractPostIdFromHref end not found');
  assert.notEqual(resolveStart, -1, 'resolvePublicDownloadUrl start not found');
  assert.notEqual(resolveEnd, -1, 'resolvePublicDownloadUrl end not found');
  assert.notEqual(listCandidatesStart, -1, 'listPublicBulkDownloadCandidates start not found');
  assert.notEqual(listCandidatesEnd, -1, 'listPublicBulkDownloadCandidates end not found');

  const snippet = [
    src.slice(normalizeIdStart, normalizeIdEnd),
    src.slice(extractHrefStart, extractHrefEnd),
    src.slice(resolveStart, resolveEnd),
    src.slice(listCandidatesStart, listCandidatesEnd),
  ].join('\n');

  const context = vm.createContext({
    idToPublicDownloadUrl: new Map(),
    idToMeta: new Map(),
    getPublicDownloadedIds: () => new Set(),
  });
  vm.runInContext(`${snippet}\nglobalThis.__api = { extractPostIdFromHref, resolvePublicDownloadUrl, listPublicBulkDownloadCandidates };`, context, {
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

test('listPublicBulkDownloadCandidates includes indexed posts beyond currently visible cards', () => {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const listCandidatesStart = src.indexOf('  function listPublicBulkDownloadCandidates() {');
  const listCandidatesEnd = src.indexOf('  async function bulkDownloadPublicPosts() {', listCandidatesStart);
  assert.notEqual(listCandidatesStart, -1, 'listPublicBulkDownloadCandidates start not found');
  assert.notEqual(listCandidatesEnd, -1, 'listPublicBulkDownloadCandidates end not found');
  const snippet = src.slice(listCandidatesStart, listCandidatesEnd);

  const context = vm.createContext({
    idToPublicDownloadUrl: new Map([
      ['s_z', 'https://videos.openai.com/z.mp4'],
      ['s_a', 'https://videos.openai.com/a.mp4'],
      ['s_b', 'https://videos.openai.com/b.mp4'],
    ]),
    idToMeta: new Map([
      ['s_z', { createdAtMs: 3000 }],
      ['s_a', { createdAtMs: 1000 }],
      ['s_b', { createdAtMs: 2000 }],
    ]),
    getPublicDownloadedIds: () => new Set(['s_b']),
    resolvePostedTimestampMs: (id) => {
      const meta = context.idToMeta.get(id);
      return Number.isFinite(meta?.createdAtMs) ? meta.createdAtMs : null;
    },
  });
  vm.runInContext(`${snippet}\nglobalThis.__fn = listPublicBulkDownloadCandidates;`, context, {
    filename: 'inject-public-bulk-download-candidates.harness.js',
  });
  const result = JSON.parse(JSON.stringify(context.__fn()));
  assert.deepEqual(result, [
    { postId: 's_a', url: 'https://videos.openai.com/a.mp4' },
    { postId: 's_z', url: 'https://videos.openai.com/z.mp4' },
  ]);
});
