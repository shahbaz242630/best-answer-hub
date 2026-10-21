// IndexNow submitter for Best Answer Hub.
//
// IndexNow lets us ping participating search engines (Bing, Yandex, Seznam,
// Naver, Yep, …) the moment a page is added or changed, instead of waiting for
// them to re-crawl. One submission is shared with all participating engines.
//
// The key is NOT a secret — it is published at the site root on purpose so the
// engines can verify we own the domain. Hardcoding it here is fine.
//
// This module is used two ways:
//   1. Imported by deploy.mjs, which auto-submits only the pages whose HTML
//      changed since the last deploy (content-hash diff via .indexnow-state.json).
//   2. Run directly from the CLI:
//        node indexnow.mjs <url> [<url> ...]   submit specific URLs
//        node indexnow.mjs --all                submit every sitemap URL
//        node indexnow.mjs --seed               write the hash baseline, send nothing
//        node indexnow.mjs --dry-run --all      show what would send, send nothing
//
// Run AFTER deploying, so the live pages (and the key file) are already up when
// the engines come to verify.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

export const HOST = 'www.bestanswerhub.com';
export const KEY = 'd9073cc1091bf80f36af829019760dc0';
export const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
export const ENDPOINT = 'https://api.indexnow.org/indexnow';
export const ORIGIN = `https://${HOST}`;
export const MAX_PER_POST = 10000; // protocol limit
export const MANIFEST_PATH = '.indexnow-state.json';
const DIST = path.resolve('./dist');

// --- URL discovery & file mapping -----------------------------------------

// Pull every <loc> out of the built sitemap(s) in dist/.
export function urlsFromSitemap() {
  if (!fs.existsSync(DIST)) {
    throw new Error('dist/ not found — run `npm run build` first.');
  }
  const files = fs
    .readdirSync(DIST)
    .filter((f) => /^sitemap.*\.xml$/i.test(f))
    .map((f) => path.join(DIST, f));
  const locs = new Set();
  for (const file of files) {
    const xml = fs.readFileSync(file, 'utf8');
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const u = m[1].trim();
      if (u.startsWith(ORIGIN) && !u.endsWith('.xml')) locs.add(u);
    }
  }
  return [...locs].sort();
}

// Map a canonical URL back to the built HTML file that produced it.
function urlToFile(url) {
  let p = url.slice(ORIGIN.length).replace(/^\//, '').replace(/\/$/, '');
  return p ? path.join(DIST, p, 'index.html') : path.join(DIST, 'index.html');
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

// Normalize HTML before hashing: strip the content-hash from /_astro/ asset
// filenames (e.g. "affiliate-disclosure.B-Kdkh6O.css" → "asset.css").
// Why: all ~90 pages link ONE shared Tailwind CSS bundle whose hashed filename
// changes whenever ANY page's styles change — without this, every styling edit
// made every page look "changed" and re-submitted the whole site to IndexNow
// (observed 2026-06-11: 4 deploys ≈ 450 submissions). Real content changes are
// still detected; a pure asset-rename no longer is.
const normalizeHtml = (buf) =>
  buf.toString('utf8').replace(/\/_astro\/[A-Za-z0-9._-]+\.(css|js)/g, '/_astro/asset.$1');

// Build { url: htmlHash } for every sitemap URL whose HTML file exists.
export function computeManifest() {
  const manifest = {};
  for (const url of urlsFromSitemap()) {
    const file = urlToFile(url);
    if (fs.existsSync(file)) manifest[url] = sha1(normalizeHtml(fs.readFileSync(file)));
  }
  return manifest;
}

export function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return null; // no baseline yet
  }
}

export function writeManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 0));
}

// URLs that are new or whose HTML hash changed vs the previous manifest.
export function diffManifest(prev, curr) {
  const changed = [];
  for (const url in curr) {
    if (!prev || prev[url] !== curr[url]) changed.push(url);
  }
  return changed.sort();
}

// --- Submission ------------------------------------------------------------

const STATUS_MEANING = {
  200: '✅ Accepted — URLs submitted.',
  202: '✅ Accepted — key validation pending.',
  400: '❌ Bad request — invalid JSON/format.',
  403: '❌ Forbidden — key not valid (is the key file live at the root?).',
  422: '❌ Unprocessable — a URL does not match the host, or key mismatch.',
  429: '⚠️  Too many requests — slow down (possible spam flag).',
};

// Submit URLs to IndexNow. Returns { ok, status } for the last chunk.
export async function submitUrls(urls, { dryRun = false, quiet = false } = {}) {
  const bad = urls.filter((u) => !u.startsWith(ORIGIN + '/') && u !== ORIGIN);
  if (bad.length) throw new Error('URLs not on ' + HOST + ': ' + bad.join(', '));

  if (dryRun) {
    if (!quiet) urls.forEach((u) => console.log('   • ' + u));
    return { ok: true, status: 0 };
  }

  // Chunk defensively, though we are far below the 10k limit.
  let last = { ok: true, status: 0 };
  for (let i = 0; i < urls.length; i += MAX_PER_POST) {
    const chunk = urls.slice(i, i + MAX_PER_POST);
    const body = { host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: chunk };
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    const meaning = STATUS_MEANING[res.status] || `Status ${res.status}`;
    if (!quiet) console.log(`Response: ${res.status} ${res.statusText} — ${meaning}`);
    last = { ok: res.status === 200 || res.status === 202, status: res.status };
  }
  return last;
}

// --- CLI -------------------------------------------------------------------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const wantAll = args.includes('--all');
  const seed = args.includes('--seed');
  const explicitUrls = args.filter((a) => !a.startsWith('--'));

  if (seed) {
    const manifest = computeManifest();
    writeManifest(manifest);
    console.log(`Seeded ${MANIFEST_PATH} with ${Object.keys(manifest).length} page hashes (nothing submitted).`);
    process.exit(0);
  }

  const urls = wantAll ? urlsFromSitemap() : explicitUrls;
  if (!urls.length) {
    console.error('Nothing to submit.\n');
    console.error('  node indexnow.mjs <url> [<url> ...]   submit specific URLs');
    console.error('  node indexnow.mjs --all                submit all sitemap URLs');
    console.error('  node indexnow.mjs --seed               write hash baseline, send nothing');
    process.exit(1);
  }

  console.log(`IndexNow → ${ENDPOINT}`);
  console.log(`Host: ${HOST}  |  Key file: ${KEY_LOCATION}`);
  console.log(`Submitting ${urls.length} URL(s):`);
  const { ok } = await submitUrls(urls, { dryRun });
  if (dryRun) console.log('\n(dry run — nothing sent)');
  process.exit(ok ? 0 : 1);
}
