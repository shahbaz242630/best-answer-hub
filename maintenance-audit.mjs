#!/usr/bin/env node
/**
 * maintenance-audit.mjs — READ-ONLY site health & compliance audit.
 *
 * Reads dist/ (built output) + src/ and prints a prioritized to-do list.
 * It NEVER writes, edits, deploys, or bumps dates. Safe to run any time.
 *
 * Usage:
 *   npm run build        # produce a fresh dist/ first
 *   node maintenance-audit.mjs
 *
 * Exit code: 0 if no 🔴 errors, 1 if any 🔴 errors (so it can gate a deploy later).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src');
let kcAvailability = {};
try { kcAvailability = JSON.parse(readFileSync(join(SRC, 'data', 'kc-availability.json'), 'utf8')); } catch {}

const errors = [];   // 🔴 must fix
const warns = [];    // 🟡 should review
const infos = [];    // ℹ️ informational
const err = (cat, msg) => errors.push({ cat, msg });
const warn = (cat, msg) => warns.push({ cat, msg });
const info = (cat, msg) => infos.push({ cat, msg });

// ── helpers ──────────────────────────────────────────────────────────────
function walk(dir, filterExt = null, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, filterExt, out);
    else if (!filterExt || filterExt.includes(extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ');
const stripScripts = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
const headOf = (html) => html.match(/<head[\s\S]*?<\/head>/i)?.[0] || html;
const routeOf = (htmlPath) => {
  // dist/tools/foo/index.html -> /tools/foo/   ;  dist/index.html -> /
  let r = '/' + relative(DIST, htmlPath).replace(/\\/g, '/');
  r = r.replace(/index\.html$/, '');
  if (r !== '/' && !r.endsWith('/')) r += '/';
  return r;
};

if (!existsSync(DIST)) {
  console.error('✗ dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

const htmlFiles = walk(DIST, ['.html']);
const allDistFiles = walk(DIST);

console.log(`\nAuditing ${htmlFiles.length} built pages...\n`);

// ── valid-route set (for internal link resolution) ─────────────────────────
const resolves = (linkPath) => {
  let p = linkPath.split('#')[0].split('?')[0];
  if (p === '') return true;            // pure anchor
  if (p === '/') return existsSync(join(DIST, 'index.html'));

  // `/kc/…` is the Paddle bouncer. It is never in dist/ — it ships from paddle-server/kc-web
  // via `node _deploy_bouncer.mjs`, a completely separate deploy. Skipping the whole prefix
  // would mean a typo in a checkout or download link never gets caught, so resolve it against
  // its real source tree instead: same check, different root.
  if (p === '/kc' || p.startsWith('/kc/')) {
    const kcWeb = join(process.cwd(), 'paddle-server', 'kc-web');
    const rel = p.slice('/kc/'.length);
    if (existsSync(kcWeb)) {
      const kcBase = join(kcWeb, rel);
      return [kcBase, kcBase + '.html', join(kcBase, 'index.html')].some(existsSync);
    }
    // CI / public checkout: paddle-server/ is private. Same check against the route list
    // scripts/kc-availability.mjs snapshots from the real tree.
    const routes = new Set(kcAvailability.kcRoutes || []);
    const r = rel.replace(/\/$/, '');
    return r === '' || [r, r + '.html', r + '/index.html'].some((c) => routes.has(c));
  }

  const base = join(DIST, p);
  const candidates = [
    base,                               // /pdf-lib.min.js
    base + '.html',                     // /foo -> foo.html
    join(base, 'index.html'),           // /tools/foo/ -> tools/foo/index.html
  ];
  return candidates.some(existsSync);
};

// ── per-page checks ─────────────────────────────────────────────────────────
const faqCounts = [];
const staleData = [];
const SECURITY_CLAIMS = [/\buncrackable\b/i, /\bunhackable\b/i, /\b100%\s+secure\b/i, /\bcompletely\s+secure\b/i, /\bfully\s+secure\b/i];

const LEGAL_ROUTES = new Set(['/privacy-policy/', '/cookie-policy/', '/terms/', '/refund-policy/', '/affiliate-disclosure/']);

for (const f of htmlFiles) {
  const html = read(f);
  const route = routeOf(f);
  const noScript = stripScripts(html);
  const head = headOf(html);

  // --- internal links (scripts stripped so JS string-concat isn't mistaken for links;
  //     anchored to real <a>/<link>/<area> tags so HTML-escaped code examples like
  //     "&lt;link href=..." in article snippets aren't counted as links) ---
  const hrefs = [...noScript.matchAll(/<(?:a|link|area)\b[^>]*?href="(\/[^"]*)"/g)].map(m => m[1]);
  for (const h of hrefs) {
    if (h.startsWith('//')) continue;                  // protocol-relative external
    if (/[ '"+{}]/.test(h)) continue;                  // template/expression leftovers, never a real path
    if (!resolves(h)) err('broken-link', `${route} → links to missing ${h}`);
  }

  // --- canonical / title / description (entities decoded for true rendered length) ---
  if (!/rel="canonical"/.test(head)) warn('seo-tags', `${route} → no canonical link`);
  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() ?? '');
  if (!title) err('seo-tags', `${route} → missing <title>`);
  else if (title.length > 60) warn('seo-tags', `${route} → title ${title.length} chars (>60): "${title}"`);
  const desc = decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '');
  if (!desc) warn('seo-tags', `${route} → missing meta description`);
  else if (desc.length > 160) warn('seo-tags', `${route} → meta description ${desc.length} chars (>160)`);

  // --- JSON-LD schema (head only — avoids tools that render demo JSON-LD in their body) ---
  const ld = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const types = new Set();
  let faqCount = 0;
  for (const block of ld) {
    let parsed;
    try { parsed = JSON.parse(block); } catch { warn('schema', `${route} → malformed JSON-LD block`); continue; }
    const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
    for (const n of nodes) {
      if (!n || !n['@type']) continue;
      const t = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
      t.forEach(x => types.add(x));
      if (t.includes('FAQPage') && Array.isArray(n.mainEntity)) faqCount = Math.max(faqCount, n.mainEntity.length);
    }
  }
  // tool/calculator pages should carry FAQ schema
  const isToolPage = /^\/(tools|calculators|developer-toolbox|career-toolkit|pdf-toolkit)\//.test(route) && route.split('/').filter(Boolean).length >= 2;
  if (isToolPage) {
    if (!types.has('FAQPage')) warn('schema', `${route} → tool page has no FAQPage schema`);
    else { faqCounts.push({ route, faqCount }); if (faqCount > 0 && faqCount < 8) warn('faq', `${route} → only ${faqCount} FAQs (target 8+, ideally 15)`); }
  }

  // --- compliance: absolute security claims (legal pages excluded — they carry "no system is 100% secure" disclaimers) ---
  if (!LEGAL_ROUTES.has(route)) {
    const text = decode(noScript.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    for (const re of SECURITY_CLAIMS) {
      const m = text.match(re);
      if (m) {
        const i = m.index;
        const ctx = text.slice(Math.max(0, i - 45), i + m[0].length + 45).trim();
        warn('compliance', `${route} → "${m[0]}" — context: …${ctx}…`);
      }
    }
  }
}

// ── required legal pages present ────────────────────────────────────────────
const REQUIRED_PAGES = ['/privacy-policy/', '/cookie-policy/', '/terms/', '/affiliate-disclosure/', '/refund-policy/'];
for (const p of REQUIRED_PAGES) {
  if (!resolves(p)) err('compliance', `Required legal page missing from build: ${p}`);
}

// ── stray / risky artifacts in dist (feeds the 404-cleanup task) ────────────
const RISKY = [
  { re: /\.map$/i, label: 'source map' },
  { re: /\.(env|pem|key)$/i, label: 'secret-like file' },
  { re: /screenshot.*\.png$/i, label: 'debug screenshot' },
  { re: /-debug-?\d*\.(png|jpg|txt|json)$/i, label: 'debug artifact' },
  { re: /^_.*\.mjs$/i, label: 'throwaway test script' },
  { re: /\/(test|tmp|temp|paddle-test)\//i, label: 'test/temp page' },
];
for (const f of allDistFiles) {
  const rel = '/' + relative(DIST, f).replace(/\\/g, '/');
  for (const r of RISKY) {
    if (r.re.test(rel)) err('artifact', `Stray ${r.label} in dist: ${rel}`);
  }
}

// ── tools.ts ↔ built-page coverage ──────────────────────────────────────────
const toolsSrc = read(join(SRC, 'data', 'tools.ts'));
const liveHrefs = [];
{
  const arrText = toolsSrc.slice(toolsSrc.indexOf('export const allTools'), toolsSrc.indexOf('];'));
  for (const block of arrText.split(/\},\s*\r?\n/)) {
    const href = block.match(/href:\s*'([^']+)'/)?.[1];
    const live = /live:\s*true/.test(block);
    const suiteOnly = /suiteOnly:\s*true/.test(block);
    if (href && live && !suiteOnly) liveHrefs.push(href);
  }
}
for (const h of liveHrefs) {
  if (!resolves(h)) err('coverage', `tools.ts marks ${h} live: true but no built page exists`);
}

// ── freshness: source pages untouched > 12 months ──────────────────────────
const NOW = statSync(join(SRC, 'data', 'tools.ts')).mtimeMs; // anchor to a real file mtime (no Date.now → deterministic-ish)
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const pageFiles = walk(join(SRC, 'pages'), ['.astro']);
let stalePages = 0;
for (const f of pageFiles) {
  const age = NOW - statSync(f).mtimeMs;
  if (age > YEAR_MS) { stalePages++; info('freshness', `${relative(ROOT, f)} untouched ~${(age / YEAR_MS).toFixed(1)}y — review for a genuine refresh`); }
}

// ── freshness: volatile data files ─────────────────────────────────────────
const DATA_FILES = ['src/data/ai-pricing.json'];
for (const d of DATA_FILES) {
  const full = join(ROOT, d);
  if (!existsSync(full)) continue;
  const age = NOW - statSync(full).mtimeMs;
  if (age > 180 * 24 * 60 * 60 * 1000) warn('freshness', `${d} not updated in ~${Math.round(age / (30 * 24 * 60 * 60 * 1000))} months — verify pricing is current`);
}

// ── report ──────────────────────────────────────────────────────────────────
const dedupe = (items) => {
  const seen = new Set();
  return items.filter(({ cat, msg }) => { const k = cat + '|' + msg; if (seen.has(k)) return false; seen.add(k); return true; });
};
const errorsU = dedupe(errors), warnsU = dedupe(warns), infosU = dedupe(infos);

const group = (items) => {
  const by = {};
  for (const { cat, msg } of items) (by[cat] ??= []).push(msg);
  return by;
};
const printGroup = (label, items) => {
  if (!items.length) return;
  console.log(`\n${label} (${items.length})`);
  const by = group(items);
  for (const cat of Object.keys(by).sort()) {
    console.log(`  [${cat}]`);
    for (const m of by[cat]) console.log(`    • ${m}`);
  }
};

printGroup('🔴 ERRORS — fix before deploy', errorsU);
printGroup('🟡 WARNINGS — review', warnsU);
printGroup('ℹ️  INFO', infosU);

if (faqCounts.length) {
  const low = faqCounts.filter(x => x.faqCount && x.faqCount < 15).length;
  console.log(`\nFAQ coverage: ${faqCounts.length} tool pages with FAQ schema, ${low} below the 15 target.`);
}

console.log(`\n──────────────────────────────────────────`);
console.log(`Summary:  🔴 ${errorsU.length} errors   🟡 ${warnsU.length} warnings   ℹ️ ${infosU.length} info`);
console.log(`Read-only audit — nothing was modified.\n`);

process.exit(errorsU.length ? 1 : 0);
