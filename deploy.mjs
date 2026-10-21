import 'dotenv/config';
import { Client } from 'basic-ftp';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import tls from 'tls';
import { pathToFileURL } from 'url';
import {
  computeManifest,
  readManifest,
  writeManifest,
  diffManifest,
  submitUrls,
  MANIFEST_PATH,
} from './indexnow.mjs';

// Credentials MUST come from environment variables only.
// Never commit credentials to files. Rotate passwords regularly.
const config = {
  host: process.env.FTP_HOST,
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  port: Number(process.env.FTP_PORT) || 21,
  remoteDir: process.env.FTP_REMOTE_DIR || '/',
  localDir: process.env.FTP_LOCAL_DIR || './dist',
};

if (!config.host || !config.user || !config.password) {
  console.error('❌ No deployment credentials found. Set FTP_HOST, FTP_USER, and FTP_PASSWORD environment variables.');
  process.exit(1);
}

const FORBIDDEN_FILES = ['.env', '.env.local', '.env.production', 'deploy-config.json'];
const FORBIDDEN_PATTERNS = [/\.(pem|key|cert|p12)$/i, /\.map$/i];

// Hostinger shared FTP resets the control socket once a single session opens
// too many passive data connections (~200 observed). We upload one file per
// data connection, so a full dist/ (200+ files) always trips it. Two defenses:
//   1. Skip files already uploaded unchanged (content-hash cache) — a normal
//      deploy then touches only the handful of pages that actually changed.
//   2. Proactively reconnect every RECONNECT_EVERY files to reset the server's
//      per-session connection counter, and retry-with-reconnect on any drop.
const CACHE_PATH = path.resolve('.deploy-cache.json');
const RECONNECT_EVERY = 100; // stay well under Hostinger's ~200/session ceiling
const MAX_RETRIES = 5;       // per-file, across fresh reconnects
const FULL = process.argv.includes('--full'); // ignore cache, re-upload everything

function scanForSecrets(localDir) {
  const files = fs.readdirSync(localDir, { recursive: true });
  const forbidden = [];
  for (const file of files) {
    const base = path.basename(file);
    if (FORBIDDEN_FILES.includes(base)) forbidden.push(file);
    if (FORBIDDEN_PATTERNS.some(p => p.test(base))) forbidden.push(file);
  }
  if (forbidden.length > 0) {
    console.error('❌ Pre-deploy scan failed: forbidden files detected in dist/:');
    forbidden.forEach(f => console.error('   - ' + f));
    console.error('   Aborting deployment to prevent secret exposure.');
    process.exit(1);
  }
}

// Flat list of every file under dir, each with its POSIX path relative to dir.
export function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, base));
    } else if (entry.isFile()) {
      const rel = path.relative(base, abs).split(path.sep).join('/');
      out.push({ local: abs, rel });
    }
  }
  return out;
}

export function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

function loadCache() {
  if (FULL) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// Decide which files need uploading: everything whose content hash differs
// from the cache (or all of them under --full). Pure — no network.
export function planUploads(localDir, cache, full = FULL) {
  const files = walkFiles(localDir);
  const pending = files.filter(f => full || cache[f.rel] !== md5(f.local));
  return { files, pending };
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 0));
}

const accessOptions = {
  host: config.host,
  user: config.user,
  password: config.password,
  port: config.port || 21,
  secure: true,
  secureOptions: {
    // Hostinger shared hosting serves a wildcard cert for *.hstgr.io
    // that does not match the custom domain ftp.bestanswerhub.com.
    // We verify the cert chain but allow the known Hostinger wildcard
    // to prevent MITM while still working with shared hosting SSL.
    checkServerIdentity: (host, cert) => {
      const altNames = cert.subjectaltname || '';
      if (altNames.includes('*.hstgr.io') || altNames.includes('hstgr.io')) {
        return undefined; // Hostinger wildcard cert — accept
      }
      return tls.checkServerIdentity(host, cert);
    },
  },
};

async function connect() {
  const client = new Client();
  client.ftp.verbose = process.env.DEBUG === 'true';
  await client.access(accessOptions);
  await client.cd(config.remoteDir);
  return client;
}

// Upload every file in dist/, resilient to Hostinger's connection ceiling.
// Reconnects proactively and on error, resumes via the content-hash cache.
async function uploadResilient(localDir) {
  const cache = loadCache();
  const { files, pending } = planUploads(localDir, cache);
  const skipped = files.length - pending.length;
  console.log(`📦 ${files.length} files in dist — ${skipped} unchanged (skipped), ${pending.length} to upload.\n`);

  if (!pending.length) {
    console.log('✅ Nothing changed — server already up to date.');
    return;
  }

  let client = await connect();
  let sinceConnect = 0;
  let lastDir = null;
  let done = 0;

  const reconnect = async () => {
    try { client.close(); } catch {}
    client = await connect();
    sinceConnect = 0;
    lastDir = null;
  };

  try {
    for (const f of pending) {
      const remotePath = path.posix.join(config.remoteDir, f.rel);
      const remoteDir = path.posix.dirname(remotePath);
      const base = path.posix.basename(remotePath);

      for (let attempt = 1; ; attempt++) {
        try {
          if (sinceConnect >= RECONNECT_EVERY) await reconnect();
          if (remoteDir !== lastDir) {
            await client.ensureDir(remoteDir); // also cds into it
            lastDir = remoteDir;
          }
          await client.uploadFrom(fs.createReadStream(f.local), base);
          sinceConnect++;
          done++;
          cache[f.rel] = md5(f.local);
          saveCache(cache); // persist per file so a crash resumes cleanly
          if (done % 25 === 0) console.log(`   … ${done}/${pending.length} uploaded`);
          break;
        } catch (err) {
          if (attempt > MAX_RETRIES) {
            throw new Error(`Failed to upload ${f.rel} after ${MAX_RETRIES} retries: ${err.message}`);
          }
          console.log(`   ⚠️  ${f.rel} — ${err.message}; reconnecting (retry ${attempt}/${MAX_RETRIES})…`);
          await reconnect();
        }
      }
    }
    console.log(`\n✅ Uploaded ${done} file(s).`);
  } finally {
    try { client.close(); } catch {}
  }
}

// After a successful upload, notify IndexNow about the pages whose HTML
// actually changed since the last deploy (content-hash diff). Never throws —
// a search-ping failure must not fail an otherwise-good deploy.
async function pingIndexNow() {
  if (process.argv.includes('--no-indexnow') || process.env.INDEXNOW === 'false') {
    console.log('⏭️  IndexNow skipped (--no-indexnow).');
    return;
  }
  try {
    const curr = computeManifest();
    const prev = readManifest();
    const changed = diffManifest(prev, curr);

    if (!prev) {
      // First wired deploy: set the baseline without blasting every URL
      // (the initial full submission was already done manually).
      writeManifest(curr);
      console.log(`\n🔔 IndexNow: baseline saved (${Object.keys(curr).length} pages). No submission this run.`);
      return;
    }
    if (!changed.length) {
      console.log('\n🔔 IndexNow: no page content changed — nothing to submit.');
      return;
    }

    console.log(`\n🔔 IndexNow: ${changed.length} changed page(s):`);
    changed.forEach((u) => console.log('   • ' + u));
    const { ok, status } = await submitUrls(changed, { quiet: true });
    console.log(ok
      ? `   ✅ Submitted (HTTP ${status}).`
      : `   ⚠️  IndexNow returned HTTP ${status} — pages still deployed; will retry next change.`);
    if (ok) writeManifest(curr); // only advance baseline on success
  } catch (err) {
    console.log('⚠️  IndexNow step skipped: ' + err.message);
  }
}

async function deploy() {
  const localDir = path.resolve(config.localDir);

  console.log(`\n🔍 Scanning ${localDir} for forbidden files...`);
  scanForSecrets(localDir);

  console.log(`\n🔌 Connecting to ${config.host}...`);
  console.log(`📤 Uploading from ${localDir} to ${config.remoteDir}`);
  console.log('(Overwrites existing files, never deletes; unchanged files skipped)\n');

  try {
    await uploadResilient(localDir);
    console.log('\n✅ Deployment complete!');
    await pingIndexNow();
  } catch (err) {
    console.error('\n❌ Deployment failed:', err.message);
    console.error('   Progress was saved — re-run `node deploy.mjs` to resume from where it stopped.');
    process.exit(1);
  }
}

// Only run when invoked directly (node deploy.mjs), not when imported for tests.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  deploy();
}
