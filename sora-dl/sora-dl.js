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
  sora-dl profile --url <profile_url> --dir <download_dir> [--concurrency <n>] [--allow-any-host] [--all-links]

Options:
  --allow-any-host   Disable host allowlist checks
  --concurrency <n>  Number of parallel downloads for batch (default: 3)
  --all-links        For profile mode, download all discovered links (not just media-like URLs)
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

  await downloadManyUrls(urls, dir, { concurrency, allowAnyHost });
}

function looksLikeMediaAsset(rawUrl) {
  const mediaExts = new Set([
    '.mp4',
    '.webm',
    '.mov',
    '.m4v',
    '.mkv',
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.mp3',
    '.wav',
    '.json',
  ]);
  try {
    const u = new URL(rawUrl);
    const pathname = u.pathname.toLowerCase();
    for (const ext of mediaExts) {
      if (pathname.endsWith(ext)) return true;
    }
    if (/[?&](format|ext|type)=(mp4|webm|mov|m4v|jpg|jpeg|png|gif|webp|mp3|wav)\b/i.test(u.search)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function extractUrlsFromProfileText(text, baseUrl) {
  const found = new Set();
  const absoluteUrlPattern = /https?:\/\/[^\s"'<>`]+/g;
  const srcHrefPattern = /(?:src|href)=["']([^"']+)["']/gi;
  const jsonPathPattern = /"(\/[^"\\]+\.(?:mp4|webm|mov|m4v|mkv|jpg|jpeg|png|gif|webp|mp3|wav|json)(?:\?[^"\\]*)?)"/gi;

  for (const match of text.matchAll(absoluteUrlPattern)) {
    found.add(match[0]);
  }

  for (const match of text.matchAll(srcHrefPattern)) {
    try {
      found.add(new URL(match[1], baseUrl).toString());
    } catch {
      // ignore malformed links
    }
  }

  for (const match of text.matchAll(jsonPathPattern)) {
    try {
      found.add(new URL(match[1], baseUrl).toString());
    } catch {
      // ignore malformed paths
    }
  }

  return Array.from(found);
}

function fetchText(rawUrl, redirectCount = 0) {
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
        resolve(fetchText(nextUrl, redirectCount + 1));
        return;
      }

      if (status < 200 || status >= 300) {
        reject(new Error(`HTTP ${status} for ${rawUrl}`));
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', (err) => reject(err));
    });

    req.on('error', (err) => reject(err));
  });
}

async function downloadManyUrls(urls, dir, { concurrency, allowAnyHost }) {
  const cleanUrls = urls.filter(Boolean);

  await ensureDir(dir);
  const stateDir = path.join(dir, DEFAULT_STATE_DIR);
  await ensureDir(stateDir);
  const statePath = path.join(stateDir, DEFAULT_STATE_FILE);
  const downloadedSet = await loadState(statePath);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const queue = [...cleanUrls];

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

async function runProfile(options) {
  const profileUrl = String(options.url || '').trim();
  const dir = String(options.dir || '').trim();
  const allowAnyHost = options['allow-any-host'] === true;
  const allLinks = options['all-links'] === true;
  const concurrency = Math.max(1, Number.parseInt(String(options.concurrency || '3'), 10) || 3);

  if (!profileUrl || !dir) {
    throw new Error('profile requires --url and --dir');
  }

  ensureAllowedHost(profileUrl, allowAnyHost);
  const body = await fetchText(profileUrl);
  const discovered = extractUrlsFromProfileText(body, profileUrl);
  const urls = allLinks ? discovered : discovered.filter((rawUrl) => looksLikeMediaAsset(rawUrl));

  if (urls.length === 0) {
    throw new Error('No downloadable links were found on that profile page. Try --all-links to inspect everything.');
  }

  console.log(`Discovered ${discovered.length} links; downloading ${urls.length}.`);
  await downloadManyUrls(urls, dir, { concurrency, allowAnyHost });
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
    if (command === 'profile') {
      await runProfile(options);
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (err) {
    console.error(err.message || String(err));
    process.exitCode = 1;
  }
})();
