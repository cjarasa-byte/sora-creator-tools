const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BACKGROUND_PATH = path.join(__dirname, '..', 'background.js');

function loadDownloadFns(chromeMock) {
  const src = fs.readFileSync(BACKGROUND_PATH, 'utf8');
  const start = src.indexOf('function sanitizeString(value, maxLen = 4096) {');
  const end = src.indexOf('function broadcastPurgeDownloadHistory(sendResponse) {', start);
  assert.notEqual(start, -1, 'background sanitizeString not found');
  assert.notEqual(end, -1, 'background download handlers block not found');
  const snippet = src.slice(start, end);
  const context = vm.createContext({
    chrome: chromeMock,
    URL,
  });
  vm.runInContext(`const MAX_DOWNLOAD_FILENAME_LEN = 240;\n${snippet}\nglobalThis.__api = { startBackgroundDownload };`, context, {
    filename: 'background-download-dedupe.harness.js',
  });
  return context.__api;
}

test('startBackgroundDownload skips duplicate filename/url before creating another file', async () => {
  const searchCalls = [];
  const downloadCalls = [];
  const chromeMock = {
    runtime: { lastError: null },
    downloads: {
      search: (query, cb) => {
        searchCalls.push(query);
        if (query.filenameRegex) {
          cb([{ id: 999, filename: '/Users/test/Downloads/alice/2026-03-26/s_1.mp4' }]);
          return;
        }
        cb([]);
      },
      download: (options, cb) => {
        downloadCalls.push(options);
        cb(123);
      },
    },
  };

  const { startBackgroundDownload } = loadDownloadFns(chromeMock);
  const response = await new Promise((resolve) => {
    startBackgroundDownload(
      {
        url: 'https://videos.openai.com/asset.mp4?token=abc',
        filename: 'alice/2026-03-26/s_1.mp4',
      },
      resolve
    );
  });

  assert.equal(response.ok, true);
  assert.equal(response.skipped, true);
  assert.equal(response.reason, 'duplicate');
  assert.equal(searchCalls.length, 1, 'duplicate should short-circuit on filename match');
  assert.equal(downloadCalls.length, 0, 'duplicate should not trigger a new browser download');
});
