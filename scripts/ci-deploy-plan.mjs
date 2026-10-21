/**
 * ci-deploy-plan.mjs — read-only preview of what a deploy would do.
 *
 * Prints how many dist/ files differ from the deploy cache (would be uploaded) and
 * which pages' HTML changed since the IndexNow baseline (would be pinged). Sends
 * nothing, connects to nothing, needs no credentials.
 *
 * Mirrors deploy.mjs planUploads(). deploy.mjs itself cannot be imported here: it
 * exits at load time when FTP credentials are absent.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { computeManifest, readManifest, diffManifest } from '../indexnow.mjs';

const DIST = path.resolve('dist');

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, base, out);
    else if (e.isFile()) out.push({ abs, rel: path.relative(base, abs).split(path.sep).join('/') });
  }
  return out;
}

const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');

let cache = {};
try {
  cache = JSON.parse(fs.readFileSync('.deploy-cache.json', 'utf8'));
} catch {}

const files = walk(DIST);
const pending = files.filter((f) => cache[f.rel] !== md5(f.abs));
console.log(`📦 ${files.length} files in dist — ${pending.length} would upload, ${files.length - pending.length} unchanged.`);
pending.slice(0, 40).forEach((f) => console.log('   ↑ ' + f.rel));
if (pending.length > 40) console.log(`   … and ${pending.length - 40} more`);

const prev = readManifest();
const changed = prev ? diffManifest(prev, computeManifest()) : null;
if (changed === null) console.log('\n🔔 IndexNow: no baseline — the deploy will seed one and submit nothing.');
else {
  console.log(`\n🔔 IndexNow: ${changed.length} page(s) would be submitted.`);
  changed.slice(0, 40).forEach((u) => console.log('   • ' + u));
  if (changed.length > 40) console.log(`   … and ${changed.length - 40} more`);
}
