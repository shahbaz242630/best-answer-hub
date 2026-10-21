# Best Answer Hub

Source for **[www.bestanswerhub.com](https://www.bestanswerhub.com)**: free, private, in-browser tools, calculators and plain-English playbooks. A static [Astro](https://astro.build) 5 + Tailwind CSS site.

## Privacy by design

Every tool runs 100% client-side. Files and text you load into a tool stay in your browser; there is no backend that receives them.

## Build

```bash
npm ci
npm run build   # snapshot buy-gate state, compute page dates, astro build -> dist/
npm run audit   # read-only audit of dist/ (links, SEO, schema, FAQ coverage)
```

Node 24. Copy `.env.example` to `.env` for local builds.

## How changes ship

1. Work on a branch and open a pull request into `main`.
2. CI builds the site, runs the audits, scans for secrets (gitleaks), reviews dependencies and workflow security, and runs CodeQL.
3. Merging to `main` deploys `dist/` to production and pings IndexNow for pages whose content changed.

Page `lastmod` / `dateModified` values come from real edit times, computed locally by `prebuild.mjs` and committed. CI never invents a date.

## Security

See [SECURITY.md](SECURITY.md).
