/**
 * Node test for the AI Cost Calculator.
 *
 * Drift protection without eval: the page's cost expression is asserted to match an exact
 * canonical shape, and the buffer constant is read out of the source. If anyone edits the
 * maths in the page, the shape assertion fails and this test stops trusting its own copy.
 *
 * Also validates every model in src/data/ai-pricing.json — the file feeding both the pricing
 * reference table and the per-platform calculators.
 */
import fs from 'node:fs';

const SRC = 'src/pages/tools/ai-cost-calculator.astro';
const src = fs.readFileSync(SRC, 'utf8');
const pricing = JSON.parse(fs.readFileSync('src/data/ai-pricing.json', 'utf8'));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ── 1. The page's formula, asserted by shape ─────────────────────────────────
const sites = [...src.matchAll(/\(\(inputTokens \/ 1e6\) \* inputRate \+ \(outputTokens \/ 1e6\) \* outputRate\) \* ([\d.]+)/g)];
ok(sites.length >= 2, `found ${sites.length} API cost site(s) matching the canonical formula shape`);

const buffers = [...new Set(sites.map((m) => m[1]))];
ok(buffers.length === 1, `every cost site uses the SAME buffer (${buffers.join(', ')}) — a divergent one would price two panels differently`);

const BUFFER = parseFloat(buffers[0]);
ok(BUFFER === 1.15, 'buffer is 1.15, the 15% overage the page discloses');
ok(/15% (API )?buffer/i.test(src), 'the 15% buffer is disclosed in visible page copy, not applied silently');

// Local mirror of the asserted shape. Safe to trust only because the shape check above passed.
const cost = (inTok, outTok, rIn, rOut) => ((inTok / 1e6) * rIn + (outTok / 1e6) * rOut) * BUFFER;

// ── 2. Hand-computed cases, matching what the live page returned ─────────────
const cases = [
  ['Claude Opus 5',          1e6, 1e6, 5,    25,   34.5],
  ['Claude Sonnet 5',        2e6, 5e5, 2,    10,   10.35],
  ['GPT-5.6 Sol',            1e6, 1e6, 4,    20,   27.6],
  ['Gemini 3.7 Flash',       4e6, 1e6, 0.75, 3.75, 7.7625],
  ['Gemini 2.5 Flash-Lite',  1e6, 1e6, 0.1,  0.4,  0.575],
  ['zero usage',             0,   0,   5,    25,   0],
];
for (const [name, i, o, ri, ro, want] of cases) {
  ok(near(cost(i, o, ri, ro), want), `${name}: ${i / 1e6}M in + ${o / 1e6}M out = $${want}`);
}

// ── 3. Every model in the data file computes a sane number ───────────────────
let modelCount = 0; const bad = [];
for (const plat of pricing.apiPlatforms) {
  for (const m of plat.models) {
    modelCount++;
    const v = cost(1e6, 1e6, m.inputPer1M, m.outputPer1M);
    if (!Number.isFinite(v) || v <= 0) bad.push(`${plat.name}/${m.name} (bad cost)`);
    if (!(m.outputPer1M > m.inputPer1M)) bad.push(`${plat.name}/${m.name} (output <= input)`);
  }
}
ok(bad.length === 0, `all ${modelCount} models across ${pricing.apiPlatforms.length} platforms compute a positive finite cost` +
  (bad.length ? ` — ${bad.join('; ')}` : ''));

// ── 4. Data-file integrity ───────────────────────────────────────────────────
const ids = pricing.apiPlatforms.flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`));
ok(new Set(ids).size === ids.length, 'no duplicate model ids');
ok(pricing.apiPlatforms.every((p) => p.id && p.name && Array.isArray(p.models) && p.models.length),
  'every platform has an id, a name and at least one model');
ok(!JSON.stringify(pricing).includes('o4-mini'),
  'the mislabelled o4-mini is gone (OpenAI publishes o3-mini at those rates)');
ok(pricing.apiPlatforms.some((p) => p.id === 'gemini-api'), 'Gemini is present as a platform');
ok(/^\d{4}-\d{2}-\d{2}$/.test(pricing.lastUpdated), `lastUpdated is an ISO date (${pricing.lastUpdated})`);

// ── 5. The dropdown options agree with the data file ─────────────────────────
const block = src.match(/<select class="cursor-api-model[\s\S]*?<\/select>/)[0];
const opts = [...block.matchAll(/<option value="[^"]+"[^>]*data-provider="([a-z]+)"[^>]*data-input="([\d.]+)"[^>]*data-output="([\d.]+)"[^>]*>([^<]+)</g)]
  .map((m) => ({ provider: m[1], input: +m[2], output: +m[3], label: m[4] }));
ok(opts.length > 0, `${opts.length} models in the BYOK dropdown, all carrying data-provider`);
ok(opts.every((o) => o.output > o.input), 'no BYOK option has output priced at or below input');

// Any model named in BOTH places must agree — the two lists are maintained separately.
const byName = new Map(pricing.apiPlatforms.flatMap((p) => p.models.map((m) => [m.name, m])));
const mismatched = opts.filter((o) => byName.has(o.label) &&
  (byName.get(o.label).inputPer1M !== o.input || byName.get(o.label).outputPer1M !== o.output));
ok(mismatched.length === 0, 'dropdown prices agree with ai-pricing.json wherever a model appears in both' +
  (mismatched.length ? ` — ${mismatched.map((m) => m.label).join(', ')}` : ''));

// ── 6. No hardcoded freshness date may contradict the data ───────────────────
const stale = [...src.matchAll(/as of (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/g)].map((m) => m[0]);
const dataMonth = new Date(pricing.lastUpdated + 'T00:00:00Z')
  .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const drifted = stale.filter((s) => !s.includes(dataMonth));
ok(drifted.length === 0, drifted.length
  ? `hardcoded dates contradict lastUpdated (${dataMonth}): ${drifted.join(' | ')}`
  : `no hardcoded date contradicts lastUpdated (${dataMonth})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
