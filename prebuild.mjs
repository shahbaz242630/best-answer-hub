/**
 * prebuild.mjs
 * Runs before `astro build`. Scans all static page files, auto-detects the
 * last meaningful edit date for each page (file mtime locally; in CI the
 * committed `const today` is used as-is),
 * updates `const today` in the source file if it has changed, and writes
 * sitemap-dates.json — a URL → ISO date map used by astro.config.mjs
 * to populate accurate <lastmod> values in the sitemap.
 *
 * Rule: Do NOT manually bump `today` dates. This script handles it.
 *
 * Usage: called automatically via `npm run build` (see package.json)
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const SITE_BASE     = 'https://www.bestanswerhub.com';
const PAGES_DIR     = './src/pages';
const OUTPUT_FILE   = './sitemap-dates.json';
const PUBLISHED_FILE = './page-published.json';

// Files/patterns to skip — not real pages or handled dynamically
const SKIP = ['404.astro', '[...slug].astro'];

function filePathToUrl(relPath) {
  // Normalise Windows backslashes
  let url = '/' + relPath.replace(/\\/g, '/').replace(/\.astro$/, '/');
  // tools/index/ → tools/   and   index/ → /
  url = url.replace(/\/index\/$/, '/');
  if (url === '/index/') url = '/';
  return url;
}

function formatDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T00:00:00+00:00`;
}

// CI (GitHub Actions sets CI=true) builds from a fresh checkout: every mtime
// is "now" and every git date is the commit date, so neither says when the
// page content last changed. In CI the committed `const today` values are the
// truth — they were derived locally from real edit times. Never derive there.
const IN_CI = process.env.CI === 'true';

function getMtimeDate(filePath) {
  try {
    const stat = statSync(filePath);
    return stat.mtime;
  } catch (e) {
    return null;
  }
}

// Local builds: the file's last save time (mtime) is the edit date.
// Git dates are deliberately NOT used — a commit is not an edit, and the
// initial commit would otherwise stamp every page with the same fake date.
function getAutoDate(filePath) {
  if (IN_CI) return null;
  return getMtimeDate(filePath);
}

function loadPublished() {
  if (!existsSync(PUBLISHED_FILE)) return null;
  try {
    return JSON.parse(readFileSync(PUBLISHED_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function savePublished(registry) {
  writeFileSync(PUBLISHED_FILE, JSON.stringify(registry, null, 2));
}

// Extract an explicit literal datePublished from a page's source.
// Returns null if datePublished uses a variable (e.g. `today`) or is absent.
function extractDatePublished(content) {
  const match = content.match(/datePublished\s*:\s*['"](\d{4}-\d{2}-\d{2}[T\d:+\-Z]*)['"]/);
  return match ? match[1] : null;
}

function scanDir(dir, dates = {}, registry = null) {
  const isFirstRun = registry === null;
  const published = isFirstRun ? {} : registry;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      scanDir(fullPath, dates, published);
      continue;
    }

    // Only .astro files; skip dynamic routes and special files
    if (!entry.endsWith('.astro')) continue;
    if (SKIP.includes(entry) || entry.startsWith('[')) continue;

    let content = readFileSync(fullPath, 'utf-8');

    // Match:  const today = '2026-05-24T00:00:00+00:00';
    const match = content.match(/const today\s*=\s*['"](\d{4}-\d{2}-\d{2}[T\d:+\-Z]*)['"]/);

    const autoDate = getAutoDate(fullPath);
    const autoDateStr = autoDate ? formatDateString(autoDate) : null;

    let date;
    if (match && autoDateStr) {
      const currentDate = match[1];
      if (currentDate !== autoDateStr) {
        // Update the source file automatically — no manual bump needed
        content = content.replace(
          /const today\s*=\s*['"][^'"]+['"]/,
          `const today = '${autoDateStr}'`
        );
        writeFileSync(fullPath, content, 'utf-8');
      }
      date = autoDateStr;
    } else if (match) {
      date = match[1];
    } else if (autoDateStr) {
      // Page has no today var but we detected a date — skip for sitemap
      // (dateModified on the page itself requires the today var)
      continue;
    } else {
      continue;
    }

    const rel  = relative(PAGES_DIR, fullPath);
    const url  = filePathToUrl(rel);

    dates[`${SITE_BASE}${url}`] = date;

    // --- datePublished registry ---
    // 1. If the page has an explicit literal datePublished, sync it to the registry.
    // 2. If this is NOT the first run and the page is NOT in the registry yet,
    //    treat it as a new page and lock in today's date as its publication date.
    // 3. On the first run, never auto-add pages without explicit datePublished
    //    (avoids backdating existing pages).
    const explicitPublished = extractDatePublished(content);
    if (explicitPublished) {
      published[url] = explicitPublished;
    } else if (!isFirstRun && !published[url]) {
      published[url] = autoDateStr || date;
    }
  }

  return { dates, published };
}

const published = loadPublished();
const { dates, published: updatedPublished } = scanDir(PAGES_DIR, {}, published);

writeFileSync(OUTPUT_FILE, JSON.stringify(dates, null, 2));
savePublished(updatedPublished);

const count = Object.keys(dates).length;
console.log(`✅  prebuild: sitemap-dates.json written — ${count} pages with lastmod dates`);
console.log(`📅  page-published.json written — ${Object.keys(updatedPublished).length} pages with publication dates`);
