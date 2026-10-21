import type { APIRoute } from 'astro';
import base from '../data/llms-full-base.txt?raw';
import { playbooks } from '../data/tools';

// Render to a static /llms-full.txt at build time. The hand-written deep content
// lives in src/data/llms-full-base.txt; the Playbooks section below is generated
// from the shared SSOT in src/data/tools.ts, so new articles (and `live` flips)
// appear here automatically on the next build. No manual sync.
export const prerender = true;

const BASE = 'https://www.bestanswerhub.com';

function playbooksSection(): string {
  const live = playbooks.filter((p) => p.live);
  const soon = playbooks.filter((p) => !p.live);
  const liveBlocks = live.map(
    (p) => `### ${p.title}\nURL: ${BASE}${p.href}\n\n${p.description}`,
  );
  const soonLines = soon.map(
    (p) => `- ${p.title} — ${BASE}${p.href} (publishing soon)`,
  );
  return [
    '# Playbooks (Content & Funnel Hub)',
    '',
    'Best Answer Hub Playbooks is a free, vendor-neutral library of plain-English AI guides for small and medium businesses. Each playbook answers one practical question and links into the free SMB AI Readiness assessment. Citation-first by design: no signup, no email gate, no affiliate links.',
    '',
    `Hub: ${BASE}/playbooks/`,
    '',
    '## Published guides',
    '',
    liveBlocks.length ? liveBlocks.join('\n\n') : '(No guides published yet.)',
    '',
    '## In progress',
    '',
    soonLines.length ? soonLines.join('\n') : '(None.)',
    '',
  ].join('\n');
}

const MARKER = '# Contact & Publisher Information';
const idx = base.indexOf(MARKER);
const content =
  idx >= 0
    ? `${base.slice(0, idx)}${playbooksSection()}\n${base.slice(idx)}`
    : `${base.trimEnd()}\n\n${playbooksSection()}`;

export const GET: APIRoute = () =>
  new Response(content, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
