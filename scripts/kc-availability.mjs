/**
 * kc-availability.mjs — runs before prebuild (see package.json "build").
 *
 * The buy buttons are gated on what actually deploys to the bouncer (paid PDF templates,
 * pack manifests and artifacts in paddle-server/). Those files are private and never in the
 * public repo, so CI cannot read them. This script derives the gate locally and writes
 * src/data/kc-availability.json — file NAMES, price ids and booleans only, never content.
 * Pages read that snapshot; CI builds from the committed copy.
 *
 * - paddle-server/ present (local)  -> regenerate the snapshot.
 * - paddle-server/ absent  (CI)     -> keep the committed snapshot untouched; fail if missing.
 *
 * Fail closed: an unreadable pack records no price ids and artifactsPresent:false.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const KC_DATA = path.join(ROOT, 'paddle-server', 'kc-data');
const OUT = path.join(ROOT, 'src', 'data', 'kc-availability.json');

if (!fs.existsSync(KC_DATA)) {
  if (!fs.existsSync(OUT)) {
    console.error('❌ kc-availability: no paddle-server/ and no committed src/data/kc-availability.json');
    process.exit(1);
  }
  console.log('ℹ️  kc-availability: paddle-server/ absent — using committed snapshot');
  process.exit(0);
}

const listDir = (dir) => {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
};

const templates = listDir(path.join(KC_DATA, 'templates')).filter((f) => /^[a-z0-9-]+-template\.pdf$/.test(f));

// Same parsing BuyPack.astro used to do inline: `price_id` may be a string or an array.
const packs = {};
for (const id of listDir(path.join(KC_DATA, 'products'))) {
  let priceIds = [];
  let artifactsPresent = false;
  try {
    const src = fs.readFileSync(path.join(KC_DATA, 'products', id, 'manifest.php'), 'utf8');
    const priceBlock = (src.match(/'price_id'\s*=>\s*(\[[^\]]*\]|'[^']*')/) || [])[1] || '';
    priceIds = [...priceBlock.matchAll(/'(pri_[a-z0-9]+)'/g)].map((m) => m[1]);
    const files = [...src.matchAll(/'file'\s*=>\s*'([^']+)'/g)].map((m) => m[1]);
    // An empty `files` list must NOT read as "all present" — a pack that promises nothing is broken.
    artifactsPresent = files.length > 0 && files.every((f) => fs.existsSync(path.join(KC_DATA, 'extras', f)));
  } catch {
    priceIds = [];
    artifactsPresent = false;
  }
  packs[id] = { priceIds, artifactsPresent };
}

// /kc/ routes that exist in the bouncer's web root, two levels deep (names only — these are
// already served publicly under /kc/). maintenance-audit.mjs resolves /kc/ links against this
// list in CI; a deeper link is reported broken there, failing closed until this depth grows.
const KC_WEB = path.join(ROOT, 'paddle-server', 'kc-web');
const kcRoutes = [];
for (const top of listDir(KC_WEB)) {
  kcRoutes.push(top);
  if (fs.statSync(path.join(KC_WEB, top)).isDirectory()) {
    for (const sub of listDir(path.join(KC_WEB, top))) kcRoutes.push(`${top}/${sub}`);
  }
}

const next = JSON.stringify({ templates, packs, kcRoutes }, null, 2) + '\n';
// Only write on change, so the file's bytes (and the build) stay deterministic.
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
if (prev !== next) fs.writeFileSync(OUT, next);
console.log(`✅  kc-availability: ${templates.length} templates, ${Object.keys(packs).length} pack(s)${prev === next ? ' (unchanged)' : ' (updated)'}`);
