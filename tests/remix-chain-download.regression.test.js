const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

test('remix relation helpers track parent/child remix links', () => {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const normalizeStart = src.indexOf('  const normalizeId = (s) => s?.toString().split(/[?#]/)[0].trim();');
  const normalizeEnd = src.indexOf('  const isExplore = () =>', normalizeStart);
  const edgeStart = src.indexOf('  function addRemixEdge(parentId, childId) {');
  const edgeEnd = src.indexOf('  const extractIdFromCard = (el) => {', edgeStart);
  assert.notEqual(normalizeStart, -1, 'normalizeId start not found');
  assert.notEqual(normalizeEnd, -1, 'normalizeId end not found');
  assert.notEqual(edgeStart, -1, 'addRemixEdge start not found');
  assert.notEqual(edgeEnd, -1, 'addRemixEdge end not found');

  const context = vm.createContext({
    remixParentByPostId: new Map(),
    remixChildrenByPostId: new Map(),
  });
  vm.runInContext(
    `${src.slice(normalizeStart, normalizeEnd)}\n${src.slice(edgeStart, edgeEnd)}\n` +
      'globalThis.__api = { addRemixEdge, getKnownRemixChildren, isKnownRemixPost };',
    context,
    { filename: 'inject-remix-chain-helpers.harness.js' }
  );

  const api = context.__api;
  api.addRemixEdge('s_parent', 's_child_a');
  api.addRemixEdge('s_parent', 's_child_b');

  assert.equal(api.isKnownRemixPost('s_parent'), true);
  assert.equal(api.isKnownRemixPost('s_child_a'), true);
  assert.equal(api.isKnownRemixPost('s_unrelated'), false);
  assert.deepEqual(Array.from(api.getKnownRemixChildren('s_parent')).sort(), ['s_child_a', 's_child_b']);
});

test('buildRemixChainDownloadCandidates follows parent and child remix graph', async () => {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const buildStart = src.indexOf('  async function buildRemixChainDownloadCandidates(originPostId) {');
  const buildEnd = src.indexOf('  async function bulkDownloadRemixChain(originPostId) {', buildStart);
  assert.notEqual(buildStart, -1, 'buildRemixChainDownloadCandidates start not found');
  assert.notEqual(buildEnd, -1, 'buildRemixChainDownloadCandidates end not found');

  const context = vm.createContext({
    remixParentByPostId: new Map(),
    idToPublicDownloadUrl: new Map([
      ['s_a', 'https://videos.openai.com/a.mp4'],
      ['s_b', 'https://videos.openai.com/b.mp4'],
      ['s_c', 'https://videos.openai.com/c.mp4'],
      ['s_d', 'https://videos.openai.com/d.mp4'],
    ]),
    normalizeId: (s) => String(s || '').split(/[?#]/)[0].trim(),
    getKnownRemixChildren: (id) => {
      const set = context.remixChildrenByPostId.get(id);
      return set ? Array.from(set) : [];
    },
    getPublicDownloadedIds: () => new Set(['s_d']),
    getPublicDownloadedAssetKeys: () => new Set(),
    normalizeDownloadAssetKey: (url) => url,
    resolvePostedTimestampMs: (id) => ({ s_a: 1, s_b: 2, s_c: 3, s_d: 4 }[id] || 0),
    setTimeout,
    remixChildrenByPostId: new Map(),
  });

  context.fetchPostDetailForChain = async (id) => {
    if (id === 's_b') {
      context.remixParentByPostId.set('s_b', 's_a');
      context.remixChildrenByPostId.set('s_b', new Set(['s_c']));
    }
    if (id === 's_c') {
      context.remixChildrenByPostId.set('s_c', new Set(['s_d']));
    }
    return true;
  };

  vm.runInContext(`${src.slice(buildStart, buildEnd)}\nglobalThis.__fn = buildRemixChainDownloadCandidates;`, context, {
    filename: 'inject-remix-chain-candidates.harness.js',
  });

  const rows = JSON.parse(JSON.stringify(await context.__fn('s_b')));
  assert.deepEqual(rows, [
    { postId: 's_a', url: 'https://videos.openai.com/a.mp4', assetKey: 'https://videos.openai.com/a.mp4' },
    { postId: 's_b', url: 'https://videos.openai.com/b.mp4', assetKey: 'https://videos.openai.com/b.mp4' },
    { postId: 's_c', url: 'https://videos.openai.com/c.mp4', assetKey: 'https://videos.openai.com/c.mp4' },
  ]);
});
