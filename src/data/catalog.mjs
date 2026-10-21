// ─────────────────────────────────────────────────────────────────────────────
// COMMERCE CATALOG — single source of truth for every PAID product sold via Paddle.
//
// Free tools live in src/data/tools.ts. THIS file is the commerce layer: product
// type, display price, and the Paddle ids. The Paddle PRICE ID is the join key
// between the site (here) and the server bouncer (paddle-server/kc-data/assessments
// for pdf-assessment packs). Keep them in sync — validate with:  npm run catalog:check
//
// Adding a product: `node scripts/provision.mjs ...` scaffolds an entry + pack, then
// the agent creates the Paddle product/price via the live MCP and fills the ids here.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'pdf-assessment'|'download'|'media-pack'|'tool-license'|'bundle'} ProductType
 *
 * @typedef {Object} CatalogProduct
 * @property {string} id          Stable slug. For pdf-assessment it MUST equal the bouncer pack id (assessments/<id>/).
 * @property {ProductType} type
 * @property {string} name        Buyer-facing product name.
 * @property {number} priceUsd    Display price AND the expected Paddle unit price (59 => $59.00). 0 = not applicable.
 * @property {string} cta         Where the buy flow lives (trailing-slash path).
 * @property {boolean} live       On sale to the public.
 * @property {{env:'production'|'sandbox', productId:(string|null), priceId:(string|null)}} paddle
 * @property {string} [envPriceVar]  If the page reads the price id from .env, the var name (kept in sync by the check).
 * @property {string} [notes]
 */

/** @type {CatalogProduct[]} */
export const catalog = [
  {
    id: 'smb-ai-readiness',
    type: 'pdf-assessment',
    name: 'SMB AI & Digital Readiness Report',
    priceUsd: 59,
    cta: '/knowledge-center/smb-ai-readiness/',
    live: true,
    paddle: {
      env: 'production',
      productId: 'pro_01kv8fsg9xam3wxr9vdkhnbcwv',
      priceId: 'pri_01kv8fsgchd6v7kb6gdqnwdpj5',
    },
    envPriceVar: 'PUBLIC_PADDLE_SMB_PRICE',
    notes: 'Phase-1 proving product. 4 buckets → 4 PDFs via the bouncer pack.',
  },
  {
    id: 'ai-knowledge-test',
    type: 'pdf-assessment',
    name: 'AI Knowledge Test: Level-Up Playbook',
    priceUsd: 29,
    cta: '/knowledge-center/ai-knowledge-test/',
    live: true, // LIVE on real $29 payments (go-live 2026-06-23, after $1 real-card test passed)
    paddle: {
      env: 'production',
      productId: 'pro_01kvt4rgjwd5dgs32s6z2v8qwa',
      priceId: 'pri_01kvtchjvy0zdfve1e5z9mrjq8',
    },
    envPriceVar: 'PUBLIC_PADDLE_AITEST_PRICE',
    notes: 'Assessment #2 (Coaching Workbook). 3 levels → 3 PDFs. Spec-driven stamping (domains/4 bands).',
  },
  {
    id: 'career-strengths',
    type: 'pdf-assessment',
    name: 'Career Path & Strengths Map: Work Signature Report',
    priceUsd: 29,
    cta: '/knowledge-center/career-strengths/',
    live: true, // 🟢 LIVE at the real $29 price (2026-07-19). Smoke-tested on real cards at $1 first:
    // 2 purchases proved routing (Builder + Navigator editions delivered correctly), webhook, download
    // and stamping end to end. The $1 price is archived; two layout defects that surfaced on those real
    // PDFs are fixed and redeployed.
    paddle: {
      env: 'production',
      productId: 'pro_01kxwrxw4fk58gj1ekd9dwja2x',
      priceId: 'pri_01kxx17qzhpgsjkch263tm93p0',
    },
    envPriceVar: 'PUBLIC_PADDLE_CAREER_PRICE',
    notes:
      'Assessment #3 (Indigo Atlas). 8 buckets → 8 PDFs by top-theme slug. Builder, Navigator & Investigator built, stamped & gated; editions 4-8 pending Desktop. ' +
      'The page only offers checkout for buckets whose template PDF exists (BUILT_BUCKETS is derived at build time in career-strengths.astro, guarded by test_cs_buy_gate.mjs) — ' +
      'without that gate a buyer in an unbuilt bucket pays and then hits the 503 in download_handler.php, because the template check runs after the money moves. ' +
      'priceUsd stays 29 (the real price); the live price is temporarily $1 for the smoke test. Derivation in handlers/career-strengths.js.',
  },
  {
    id: 'vibe-coder',
    type: 'pdf-assessment',
    name: "The Vibe Coder's Owner's Manual",
    priceUsd: 39,
    cta: '/knowledge-center/vibe-coder/',
    live: true,
    paddle: {
      env: 'production',
      productId: 'pro_01m05m1ce9pj3kgrdv6kct60vs',
      // 🟢 REAL $39 one-time price, live since 2026-08-17. The $1 smoke-test price
      // (pri_01m05m1cfqaexj02mmta1w3wc6) was proven on a real card and is now archived.
      priceId: 'pri_01m08f7fy6yk5khrhsxnkd3srq',
    },
    envPriceVar: 'PUBLIC_PADDLE_VIBE_PRICE',
    notes:
      'Assessment #4. ONE template for every buyer (no bucket routing) plus a static agent instruction ' +
      'file served via the pack manifest\'s `extras` entry, the first product to ship two deliverables. ' +
      'The page gates checkout on VIBE_BUILT, derived at build time from the template that actually ' +
      'deploys, so a missing template can never take money. Go-live 2026-08-17 at the real $39 price ' +
      'after the $1 smoke test passed on a real card; page price and charged price now agree.',
  },
  {
    id: 'ai-video-voiceover',
    type: 'download',
    name: 'AI Video & Voice-Over Skill Pack',
    priceUsd: 99,
    cta: '/ai-agent-skills/video-voiceover/',
    live: true, // 🟢 LIVE at $99 (2026-08-29). First `download` product on the commerce spine.
    paddle: {
      env: 'production',
      productId: 'pro_01m16gvwegw18z1jgq4y01cya4',
      priceId: 'pri_01m16gvwprvmkysrhnj479b4d2',
      // The $1 smoke-test price proved fulfillment on a real card and was archived 2026-08-29.
    },
    envPriceVar: 'PUBLIC_PADDLE_SKILLPACK_VIDEO_PRICE',
    notes:
      'FIRST `download` product (Phase 3 of the commerce spine). No stamping, no buckets, no ' +
      'template: the buyer gets a static archive served through the same entitlement gate as every ' +
      'PDF. Pack manifest lives at kc-data/products/ai-video-voiceover/manifest.php (NOT assessments/). ' +
      'The archive is built by `node scripts/build-pack.mjs ai-video-voiceover` from ' +
      'paddle-server/packs/ai-video-voiceover.pack.json and lands in kc-data/extras/. ' +
      '⚠ Unlike an assessment there is no quiz, so no trustworthy browser-side product identity: ' +
      'fulfillment ROUTES on the manifest price_id, which must be filled before go-live.',
  },
];

/** Products currently on sale. */
export const liveProducts = () => catalog.filter((p) => p.live);
/** Look up a product by id. */
export const productById = (id) => catalog.find((p) => p.id === id) || null;
