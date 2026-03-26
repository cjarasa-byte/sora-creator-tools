#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const crypto = require('node:crypto');

const DEFAULT_STATE_DIR = '.state';
const DEFAULT_STATE_FILE = 'downloaded.json';
const MAX_REDIRECTS = 5;

function printHelp() {
  console.log(`sora-dl - local Sora downloader CLI

Usage:
  sora-dl --help
  sora-dl download --url <url> --out <path> [--allow-any-host]
  sora-dl batch --input <urls.txt> --dir <download_dir> [--concurrency <n>] [--allow-any-host]

Options:
  --allow-any-host   Disable host allowlist checks
  --concurrency <n>  Number of parallel downloads for batch (default: 3)
`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return { command, options };
}

function ensureAllowedHost(rawUrl, allowAnyHost) {
  if (allowAnyHost) return;
  const u = new URL(rawUrl);
  const host = u.hostname.toLowerCase();
  const allowed = host === 'sora.chatgpt.com' || host.endsWith('.openai.com') || host === 'openai.com';
  if (!allowed) {
    throw new Error(`Blocked host: ${host}. Use --allow-any-host to override.`);
  }
}

function sanitizeBasename(rawName) {
  return String(rawName || 'download.bin')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\.+/g, '.')
    .slice(0, 220);
}

function pickFilenameFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const name = path.basename(parsed.pathname || '') || 'download.bin';
    return sanitizeBasename(name);
  } catch {
    return 'download.bin';
  }
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function loadState(statePath) {
  try {
    const raw = await fsp.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.downloaded)) return new Set();
    return new Set(parsed.downloaded);
  } catch {
    return new Set();
  }
}

async function saveState(statePath, stateSet) {
  const payload = {
    downloaded: Array.from(stateSet).sort(),
    updatedAt: new Date().toISOString(),
  };
  await fsp.writeFile(statePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function hashUrl(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

function downloadToFile(rawUrl, outputPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      reject(new Error(`Invalid URL: ${rawUrl}`));
      return;
    }

    const client = parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : null;
    if (!client) {
      reject(new Error(`Unsupported protocol: ${parsed.protocol}`));
      return;
    }

    const req = client.get(parsed, (res) => {
      const status = Number(res.statusCode || 0);

      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = res.headers.location;
        if (!location) {
          reject(new Error(`Redirect without location: ${rawUrl}`));
          return;
        }
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error(`Too many redirects for: ${rawUrl}`));
          return;
        }
        const nextUrl = new URL(location, rawUrl).toString();
        resolve(downloadToFile(nextUrl, outputPath, redirectCount + 1));
        return;
      }

      if (status < 200 || status >= 300) {
        reject(new Error(`HTTP ${status} for ${rawUrl}`));
        return;
      }

      const stream = fs.createWriteStream(outputPath);
      res.pipe(stream);
      stream.on('finish', () => {
        stream.close(() => resolve({ ok: true, status }));
      });
      stream.on('error', (err) => reject(err));
    });

    req.on('error', (err) => reject(err));
  });
}

async function runDownload(options) {
  const url = String(options.url || '').trim();
  const out = String(options.out || '').trim();
  const allowAnyHost = options['allow-any-host'] === true;

  if (!url || !out) {
    throw new Error('download requires --url and --out');
  }

  ensureAllowedHost(url, allowAnyHost);
  await ensureDir(path.dirname(out));
  await downloadToFile(url, out);
  console.log(`Downloaded: ${url} -> ${out}`);
}

async function runBatch(options) {
  const input = String(options.input || '').trim();
  const dir = String(options.dir || '').trim();
  const allowAnyHost = options['allow-any-host'] === true;
  const concurrency = Math.max(1, Number.parseInt(String(options.concurrency || '3'), 10) || 3);

  if (!input || !dir) {
    throw new Error('batch requires --input and --dir');
  }

  const content = await fsp.readFile(input, 'utf8');
  const urls = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  await ensureDir(dir);
  const stateDir = path.join(dir, DEFAULT_STATE_DIR);
  await ensureDir(stateDir);
  const statePath = path.join(stateDir, DEFAULT_STATE_FILE);
  const downloadedSet = await loadState(statePath);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const queue = [...urls];

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift();
      if (!url) break;
      const key = hashUrl(url);
      if (downloadedSet.has(key)) {
        skipped += 1;
        continue;
      }
      try {
        ensureAllowedHost(url, allowAnyHost);
        const filename = pickFilenameFromUrl(url);
        const outPath = path.join(dir, filename);
        await downloadToFile(url, outPath);
        downloadedSet.add(key);
        ok += 1;
        console.log(`OK     ${filename}`);
      } catch (err) {
        failed += 1;
        console.error(`FAILED ${url} :: ${err.message}`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  await saveState(statePath, downloadedSet);

  console.log(`Done: ${ok} downloaded, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

(async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    return;
  }

  const { command, options } = parseArgs(argv);

  try {
    if (command === 'download') {
      await runDownload(options);
      return;
    }
    if (command === 'batch') {
      await runBatch(options);
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (err) {
    console.error(err.message || String(err));
    process.exitCode = 1;
  }
})();
