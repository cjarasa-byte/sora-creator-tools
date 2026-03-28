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
  const normalizeAssetStart = src.indexOf('  function normalizeDownloadAssetKey(url) {');
  const normalizeAssetEnd = src.indexOf('  function buildPublicDownloadPath(postId) {', normalizeAssetStart);
  const listCandidatesStart = src.indexOf('  function listPublicBulkDownloadCandidates() {');
  const listCandidatesEnd = src.indexOf('  async function bulkDownloadPublicPosts() {', listCandidatesStart);

  assert.notEqual(normalizeIdStart, -1, 'normalizeId start not found');
  assert.notEqual(normalizeIdEnd, -1, 'normalizeId end not found');
  assert.notEqual(extractHrefStart, -1, 'extractPostIdFromHref start not found');
  assert.notEqual(extractHrefEnd, -1, 'extractPostIdFromHref end not found');
  assert.notEqual(resolveStart, -1, 'resolvePublicDownloadUrl start not found');
  assert.notEqual(resolveEnd, -1, 'resolvePublicDownloadUrl end not found');
  assert.notEqual(normalizeAssetStart, -1, 'normalizeDownloadAssetKey start not found');
  assert.notEqual(normalizeAssetEnd, -1, 'normalizeDownloadAssetKey end not found');
  assert.notEqual(listCandidatesStart, -1, 'listPublicBulkDownloadCandidates start not found');
  assert.notEqual(listCandidatesEnd, -1, 'listPublicBulkDownloadCandidates end not found');

  const snippet = [
    src.slice(normalizeIdStart, normalizeIdEnd),
    src.slice(extractHrefStart, extractHrefEnd),
    src.slice(resolveStart, resolveEnd),
    src.slice(normalizeAssetStart, normalizeAssetEnd),
    src.slice(listCandidatesStart, listCandidatesEnd),
  ].join('\n');

  const context = vm.createContext({
    idToPublicDownloadUrl: new Map(),
    idToMeta: new Map(),
    getPublicDownloadedIds: () => new Set(),
    getPublicDownloadedAssetKeys: () => new Set(),
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

test('buildPublicDownloadPath uses username/date/character/post-id.mp4 structure', () => {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const sanitizeStart = src.indexOf('  function sanitizeDownloadPathPart(value, fallback = \'unknown\') {');
  const sanitizeEnd = src.indexOf('  function resolvePostedTimestampMs(id) {', sanitizeStart);
  const buildStart = src.indexOf('  function buildPublicDownloadPath(postId) {');
  const buildEnd = src.indexOf('  async function requestBackgroundDownload(url, filename, timeoutMs = 15000) {', buildStart);
  assert.notEqual(sanitizeStart, -1, 'sanitizeDownloadPathPart start not found');
  assert.notEqual(sanitizeEnd, -1, 'sanitizeDownloadPathPart end not found');
  assert.notEqual(buildStart, -1, 'buildPublicDownloadPath start not found');
  assert.notEqual(buildEnd, -1, 'buildPublicDownloadPath end not found');

  const context = vm.createContext({
    idToMeta: new Map([
      ['s_char', { userHandle: 'alice', createdAtMs: Date.UTC(2026, 2, 26, 12, 0, 0), specialCharacter: 'Hero Prime' }],
      ['s_plain', { userHandle: 'alice', createdAtMs: Date.UTC(2026, 2, 26, 12, 0, 0) }],
      ['s_multi', {
        userHandle: 'alice',
        createdAtMs: Date.UTC(2026, 2, 26, 12, 0, 0),
        specialCharacter: 'Hero Prime',
        cameoUsernames: ['Nova', 'hero prime', 'Atlas'],
      }],
      ['s_profile', {
        userHandle: 'creatorz',
        ownerHandle: 'creatorz',
        profileRootHandle: 'buckleybunny',
        createdAtMs: Date.UTC(2026, 2, 26, 12, 0, 0),
        cameoUsernames: ['Night Rider'],
      }],
    ]),
  });
  const snippet = `${src.slice(sanitizeStart, sanitizeEnd)}\n${src.slice(buildStart, buildEnd)}`;
  vm.runInContext(`${snippet}\nglobalThis.__fn = buildPublicDownloadPath;`, context, {
    filename: 'inject-public-bulk-download-path.harness.js',
  });
  assert.equal(context.__fn('s_char'), 'alice/2026-03-26/Hero_Prime/s_char.mp4');
  assert.equal(context.__fn('s_plain'), 'alice/2026-03-26/s_plain.mp4');
  assert.equal(context.__fn('s_multi'), 'alice/2026-03-26/Atlas__Hero_Prime__Nova/s_multi.mp4');
  assert.equal(context.__fn('s_profile'), 'buckleybunny/creatorz/2026-03-26/Night_Rider/s_profile.mp4');
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
    getPublicDownloadedAssetKeys: () => new Set(),
    resolvePostedTimestampMs: (id) => {
      const meta = context.idToMeta.get(id);
      return Number.isFinite(meta?.createdAtMs) ? meta.createdAtMs : null;
    },
    normalizeDownloadAssetKey: (url) => url,
  });
  vm.runInContext(`${snippet}\nglobalThis.__fn = listPublicBulkDownloadCandidates;`, context, {
    filename: 'inject-public-bulk-download-candidates.harness.js',
  });
  const result = JSON.parse(JSON.stringify(context.__fn()));
  assert.deepEqual(result, [
    { postId: 's_a', url: 'https://videos.openai.com/a.mp4', assetKey: 'https://videos.openai.com/a.mp4' },
    { postId: 's_z', url: 'https://videos.openai.com/z.mp4', assetKey: 'https://videos.openai.com/z.mp4' },
  ]);
});

test('listPublicBulkDownloadCandidates deduplicates by canonical asset URL', () => {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const listCandidatesStart = src.indexOf('  function listPublicBulkDownloadCandidates() {');
  const listCandidatesEnd = src.indexOf('  async function bulkDownloadPublicPosts() {', listCandidatesStart);
  assert.notEqual(listCandidatesStart, -1, 'listPublicBulkDownloadCandidates start not found');
  assert.notEqual(listCandidatesEnd, -1, 'listPublicBulkDownloadCandidates end not found');
  const snippet = src.slice(listCandidatesStart, listCandidatesEnd);

  const context = vm.createContext({
    idToPublicDownloadUrl: new Map([
      ['s_1', 'https://videos.openai.com/shared.mp4?token=aaa'],
      ['s_2', 'https://videos.openai.com/shared.mp4?token=bbb'],
      ['s_3', 'https://videos.openai.com/other.mp4'],
    ]),
    getPublicDownloadedIds: () => new Set(),
    getPublicDownloadedAssetKeys: () => new Set(),
    normalizeDownloadAssetKey: (url) => String(url).split('?')[0].toLowerCase(),
    resolvePostedTimestampMs: () => 0,
  });
  vm.runInContext(`${snippet}\nglobalThis.__fn = listPublicBulkDownloadCandidates;`, context, {
    filename: 'inject-public-bulk-download-dedupe.harness.js',
  });
  const result = JSON.parse(JSON.stringify(context.__fn()));
  assert.deepEqual(result, [
    { postId: 's_1', url: 'https://videos.openai.com/shared.mp4?token=aaa', assetKey: 'https://videos.openai.com/shared.mp4' },
    { postId: 's_3', url: 'https://videos.openai.com/other.mp4', assetKey: 'https://videos.openai.com/other.mp4' },
  ]);
});
