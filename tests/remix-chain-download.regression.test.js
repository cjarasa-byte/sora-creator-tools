const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

function loadRemixChainHelpers(contextOverrides = {}) {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const chainIdsStart = src.indexOf('  function listRemixChainPostIds(postId) {');
  const chainIdsEnd = src.indexOf('  function listRemixChainDownloadCandidates(postId) {', chainIdsStart);
  const chainCandidatesStart = src.indexOf('  function listRemixChainDownloadCandidates(postId) {');
  const chainCandidatesEnd = src.indexOf('  async function downloadCurrentRemixChain() {', chainCandidatesStart);

  assert.notEqual(chainIdsStart, -1, 'listRemixChainPostIds start not found');
  assert.notEqual(chainIdsEnd, -1, 'listRemixChainPostIds end not found');
  assert.notEqual(chainCandidatesStart, -1, 'listRemixChainDownloadCandidates start not found');
  assert.notEqual(chainCandidatesEnd, -1, 'listRemixChainDownloadCandidates end not found');

  const snippet = `${src.slice(chainIdsStart, chainIdsEnd)}\n${src.slice(chainCandidatesStart, chainCandidatesEnd)}`;

  const context = vm.createContext({
    idToParentPostId: new Map(),
    idToAncestorPostIds: new Map(),
    idToPublicDownloadUrl: new Map(),
    normalizeDownloadAssetKey: (url) => String(url || '').split('?')[0].toLowerCase(),
    ...contextOverrides,
  });
  vm.runInContext(`${snippet}\nglobalThis.__api = { listRemixChainPostIds, listRemixChainDownloadCandidates };`, context, {
    filename: 'inject-remix-chain-download.harness.js',
  });
  return context.__api;
}

test('listRemixChainPostIds uses ancestor payload order when available', () => {
  const api = loadRemixChainHelpers({
    idToAncestorPostIds: new Map([['s_leaf', ['s_root', 's_mid']]]),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(api.listRemixChainPostIds('s_leaf'))), ['s_root', 's_mid', 's_leaf']);
});

test('listRemixChainPostIds falls back to parent traversal and stops loops', () => {
  const api = loadRemixChainHelpers({
    idToParentPostId: new Map([
      ['s_leaf', 's_mid'],
      ['s_mid', 's_root'],
      ['s_root', 's_mid'],
    ]),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(api.listRemixChainPostIds('s_leaf'))), ['s_root', 's_mid', 's_leaf']);
});

test('listRemixChainDownloadCandidates keeps chain order and dedupes repeated assets', () => {
  const api = loadRemixChainHelpers({
    idToAncestorPostIds: new Map([['s_leaf', ['s_root', 's_mid']]]),
    idToPublicDownloadUrl: new Map([
      ['s_root', 'https://videos.openai.com/root.mp4?token=1'],
      ['s_mid', 'https://videos.openai.com/root.mp4?token=2'],
      ['s_leaf', 'https://videos.openai.com/leaf.mp4'],
    ]),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(api.listRemixChainDownloadCandidates('s_leaf'))), [
    {
      postId: 's_root',
      url: 'https://videos.openai.com/root.mp4?token=1',
      assetKey: 'https://videos.openai.com/root.mp4',
      index: 0,
    },
    {
      postId: 's_leaf',
      url: 'https://videos.openai.com/leaf.mp4',
      assetKey: 'https://videos.openai.com/leaf.mp4',
      index: 2,
    },
  ]);
});
