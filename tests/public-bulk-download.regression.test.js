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
    currentPublicDownloadScopeKey: () => 'profile:test',
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

test('parseManualPublicDownloadList accepts profile inputs and ignores post urls', () => {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const sanitizeStart = src.indexOf('  function sanitizeDownloadPathPart(value, fallback = \'unknown\') {');
  const sanitizeEnd = src.indexOf('  function resolvePostedTimestampMs(id) {', sanitizeStart);
  const parseStart = src.indexOf('  function extractProfileHandleFromInput(input) {');
  const parseEnd = src.indexOf('  async function listProfileBulkDownloadCandidates(profileHandle) {', parseStart);
  assert.notEqual(sanitizeStart, -1, 'sanitizeDownloadPathPart start not found');
  assert.notEqual(sanitizeEnd, -1, 'sanitizeDownloadPathPart end not found');
  assert.notEqual(parseStart, -1, 'extractProfileHandleFromInput start not found');
  assert.notEqual(parseEnd, -1, 'parseManualPublicDownloadList end not found');
  const snippet = `${src.slice(sanitizeStart, sanitizeEnd)}\n${src.slice(parseStart, parseEnd)}`;
  const context = vm.createContext({ URL });
  vm.runInContext(`${snippet}\nglobalThis.__fn = parseManualPublicDownloadList;`, context, {
    filename: 'inject-public-profile-list-parse.harness.js',
  });
  const result = JSON.parse(JSON.stringify(context.__fn(`
    # comments are ignored
    https://sora.chatgpt.com/profile/Alpha
    /profile/username/Beta?foo=1
    @Gamma
    sora.chatgpt.com/p/s_ignore_me
    https://sora.chatgpt.com/p/s_ignore_too
    alpha
  `)));
  assert.deepEqual(result, [
    { raw: 'https://sora.chatgpt.com/profile/Alpha', profileHandle: 'Alpha' },
    { raw: '/profile/username/Beta?foo=1', profileHandle: 'Beta' },
    { raw: '@Gamma', profileHandle: 'Gamma' },
  ]);
});

test('listProfileBulkDownloadCandidates gathers profile feed entries and scopes history by profile handle', async () => {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const listStart = src.indexOf('  async function listProfileBulkDownloadCandidates(profileHandle) {');
  const listEnd = src.indexOf('  async function bulkDownloadFromManualList() {', listStart);
  assert.notEqual(listStart, -1, 'listProfileBulkDownloadCandidates start not found');
  assert.notEqual(listEnd, -1, 'listProfileBulkDownloadCandidates end not found');
  const snippet = src.slice(listStart, listEnd);
  const historyScopes = [];
  const context = vm.createContext({
    URL,
    location: { origin: 'https://sora.chatgpt.com' },
    idToPublicDownloadUrl: new Map(),
    resolveProfileUserIdByHandle: async (handle) => (String(handle).toLowerCase() === 'alpha' ? 'usr_alpha' : null),
    getPublicDownloadedIds: (scopeKey) => {
      historyScopes.push(scopeKey);
      return new Set(['s_seen']);
    },
    getPublicDownloadedAssetKeys: () => new Set(['https://videos.openai.com/already.mp4']),
    profileFeedCutForUserId: () => 'nf2',
    buildBackendJsonHeaders: () => ({}),
    processFeedJson: () => {},
    normalizeId: (v) => String(v || '').trim(),
    resolvePublicDownloadUrl: (item) => String(item?.downloadUrl || ''),
    normalizeDownloadAssetKey: (url) => String(url || '').split('?')[0].toLowerCase(),
    detectFeedNextCursor: (json) => json?.next_cursor || null,
    fetch: async (url) => {
      const parsed = new URL(String(url));
      const cursor = parsed.searchParams.get('cursor');
      const items = cursor
        ? [{ id: 's_seen', downloadUrl: 'https://videos.openai.com/skip.mp4' }]
        : [
            { id: 's_1', downloadUrl: 'https://videos.openai.com/a.mp4?token=123' },
            { id: 's_2', downloadUrl: 'https://videos.openai.com/already.mp4' },
          ];
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ items, next_cursor: cursor ? null : 'cursor_2' }),
      };
    },
    setTimeout,
  });
  vm.runInContext(`${snippet}\nglobalThis.__fn = listProfileBulkDownloadCandidates;`, context, {
    filename: 'inject-public-profile-list-candidates.harness.js',
  });
  const result = JSON.parse(JSON.stringify(await context.__fn('Alpha')));
  assert.deepEqual(result, [
    {
      postId: 's_1',
      url: 'https://videos.openai.com/a.mp4?token=123',
      assetKey: 'https://videos.openai.com/a.mp4',
      scopeKey: 'profile:alpha',
    },
  ]);
  assert.deepEqual(historyScopes, ['profile:alpha']);
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
  const buildStart = src.indexOf('  function buildPublicDownloadPaths(postId) {');
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

      ['s_self_profile', {
        userHandle: 'huasua',
        ownerHandle: 'huasua',
        profileRootHandle: 'huasua',
        createdAtMs: Date.UTC(2026, 2, 28, 12, 0, 0),
        cameoUsernames: ['cjarasa.desertvesp'],
      }],
    ]),
  });
  const snippet = `${src.slice(sanitizeStart, sanitizeEnd)}\n${src.slice(buildStart, buildEnd)}`;
  vm.runInContext(`${snippet}\nglobalThis.__fn = buildPublicDownloadPath; globalThis.__paths = buildPublicDownloadPaths;`, context, {
    filename: 'inject-public-bulk-download-path.harness.js',
  });
  assert.equal(context.__fn('s_char'), 'alice/2026-03-26/Hero_Prime/s_char.mp4');
  assert.equal(context.__fn('s_plain'), 'alice/2026-03-26/s_plain.mp4');
  assert.equal(context.__fn('s_multi'), 'alice/2026-03-26/Atlas__Hero_Prime__Nova/s_multi.mp4');
  assert.equal(context.__fn('s_profile'), 'buckleybunny/creatorz/2026-03-26/Night_Rider/s_profile.mp4');
  assert.deepEqual(JSON.parse(JSON.stringify(context.__paths('s_profile'))), [
    'buckleybunny/creatorz/2026-03-26/Night_Rider/s_profile.mp4',
  ]);

  assert.equal(context.__fn('s_self_profile'), 'huasua/2026-03-28/cjarasa.desertvesp/s_self_profile.mp4');
  assert.deepEqual(JSON.parse(JSON.stringify(context.__paths('s_self_profile'))), [
    'huasua/2026-03-28/cjarasa.desertvesp/s_self_profile.mp4',
  ]);
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
    currentPublicDownloadScopeKey: () => 'profile:creatorz',
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
    currentPublicDownloadScopeKey: () => 'profile:creatorz',
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

test('listPublicBulkDownloadCandidates scopes downloaded-history checks to the active page', () => {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const listCandidatesStart = src.indexOf('  function listPublicBulkDownloadCandidates() {');
  const listCandidatesEnd = src.indexOf('  async function bulkDownloadPublicPosts() {', listCandidatesStart);
  assert.notEqual(listCandidatesStart, -1, 'listPublicBulkDownloadCandidates start not found');
  assert.notEqual(listCandidatesEnd, -1, 'listPublicBulkDownloadCandidates end not found');
  const snippet = src.slice(listCandidatesStart, listCandidatesEnd);

  const scopesSeen = [];
  const context = vm.createContext({
    idToPublicDownloadUrl: new Map([
      ['s_shared', 'https://videos.openai.com/shared.mp4'],
      ['s_local', 'https://videos.openai.com/local.mp4'],
    ]),
    getPublicDownloadedIds: (scopeKey) => {
      scopesSeen.push(scopeKey);
      if (scopeKey === 'profile:wilson_weasel') return new Set(['s_local']);
      return new Set(['s_shared']);
    },
    getPublicDownloadedAssetKeys: () => new Set(),
    currentPublicDownloadScopeKey: () => 'profile:wilson_weasel',
    normalizeDownloadAssetKey: (url) => url,
    resolvePostedTimestampMs: () => 0,
  });
  vm.runInContext(`${snippet}\nglobalThis.__fn = listPublicBulkDownloadCandidates;`, context, {
    filename: 'inject-public-bulk-download-scope.harness.js',
  });
  const result = JSON.parse(JSON.stringify(context.__fn()));
  assert.deepEqual(result, [
    { postId: 's_shared', url: 'https://videos.openai.com/shared.mp4', assetKey: 'https://videos.openai.com/shared.mp4' },
  ]);
  assert.deepEqual(scopesSeen, ['profile:wilson_weasel']);
});

test('profileFeedCutForUserId uses appearances for character IDs and nf2 for user IDs', () => {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const cutStart = src.indexOf('  function profileFeedCutForUserId(userId) {');
  const cutEnd = src.indexOf('  async function requestBackgroundDownload(url, filename, timeoutMs = 15000) {', cutStart);
  assert.notEqual(cutStart, -1, 'profileFeedCutForUserId start not found');
  assert.notEqual(cutEnd, -1, 'profileFeedCutForUserId end not found');
  const snippet = src.slice(cutStart, cutEnd);

  const context = vm.createContext({});
  vm.runInContext(`${snippet}\nglobalThis.__fn = profileFeedCutForUserId;`, context, {
    filename: 'inject-profile-feed-cut.harness.js',
  });

  assert.equal(context.__fn('ch_692fba0fc1f8819181df844655140c99'), 'appearances');
  assert.equal(context.__fn(' user_123 '), 'nf2');
  assert.equal(context.__fn(''), 'nf2');
});

test('clearPublicDownloadedHistoryForScope removes only active scope entries', () => {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const readScopedStart = src.indexOf('  function readScopedPublicDownloads() {');
  const clearScopeStart = src.indexOf('  function clearPublicDownloadedHistoryForScope(scopeKey = null) {', readScopedStart);
  const clearScopeEnd = src.indexOf('  async function clearUVDraftsIndexedDBCache() {', clearScopeStart);
  assert.notEqual(readScopedStart, -1, 'readScopedPublicDownloads start not found');
  assert.notEqual(clearScopeStart, -1, 'clearPublicDownloadedHistoryForScope start not found');
  assert.notEqual(clearScopeEnd, -1, 'clearPublicDownloadedHistoryForScope end not found');

  const snippet = src.slice(readScopedStart, clearScopeEnd);
  const store = {
    SORA_UV_PUBLIC_DOWNLOADS_V2: JSON.stringify({
      scopes: {
        'profile:alpha': { ids: ['s_1'], assets: ['a_1'] },
        'profile:beta': { ids: ['s_2'], assets: ['a_2'] },
      },
    }),
  };
  const context = vm.createContext({
    PUBLIC_DOWNLOADS_SCOPED_KEY: 'SORA_UV_PUBLIC_DOWNLOADS_V2',
    currentPublicDownloadScopeKey: () => 'profile:alpha',
    localStorage: {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
      },
      setItem(key, value) {
        store[key] = String(value);
      },
    },
  });
  vm.runInContext(`${snippet}\nglobalThis.__fn = clearPublicDownloadedHistoryForScope;`, context, {
    filename: 'inject-clear-public-download-history.harness.js',
  });

  assert.equal(context.__fn('profile:alpha'), true);
  const parsed = JSON.parse(store.SORA_UV_PUBLIC_DOWNLOADS_V2);
  assert.equal(parsed.scopes['profile:alpha'], undefined);
  assert.deepEqual(parsed.scopes['profile:beta'], { ids: ['s_2'], assets: ['a_2'] });
  assert.equal(context.__fn('profile:missing'), false);
});
