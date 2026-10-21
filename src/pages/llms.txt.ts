import type { APIRoute } from 'astro';
import {
  allTools,
  careerTools,
  developerTools,
  pdfTools,
  financeTools,
  calculatorTools,
  playbooks,
  type ToolMeta,
} from '../data/tools';

// Render this endpoint to a static /llms.txt at build time.
export const prerender = true;

const BASE = 'https://www.bestanswerhub.com';

// Auto-generated from src/data/tools.ts — the single source of truth that also
// drives the hub pages. Add a tool there and it appears here on the next build;
// remove or unpublish one and it disappears. No manual sync, ever.

// Preferred reading order for category sections. Any badge not listed here is
// appended alphabetically, so new categories never silently vanish.
const SECTION_ORDER = [
  'AI', 'Career', 'Calculator', 'Finance', 'DevOps', 'Academic', 'Statistics',
  'Chemistry', 'Computer Science', 'Electronics',
  'Developer', 'Generator', 'Converter', 'Checker', 'SEO', 'Design',
  'PDF Tool', 'Utility', 'Kitchen', 'Tech', 'Social', 'Assessment',
];

// Friendlier section headings; falls back to the raw badge if unmapped.
const SECTION_LABELS: Record<string, string> = {
  'AI': 'AI Tools',
  'Career': 'Career Toolkit',
  'Calculator': 'Calculators',
  'Finance': 'Finance Calculators',
  'DevOps': 'DevOps Calculators',
  'Academic': 'Academic & Statistics',
  'Statistics': 'Statistics',
  'Chemistry': 'Chemistry',
  'Computer Science': 'Computer Science',
  'Electronics': 'Electronics',
  'Developer': 'Developer Toolbox',
  'Generator': 'Generators',
  'Converter': 'Converters',
  'Checker': 'Checkers',
  'SEO': 'SEO Tools',
  'Design': 'Design Tools',
  'PDF Tool': 'PDF Toolkit',
  'Utility': 'Utilities',
  'Kitchen': 'Kitchen',
  'Tech': 'Tech',
  'Social': 'Social Media',
  'Assessment': 'Knowledge Center Assessments',
};

function buildToolSections(): string {
  const groups = new Map<string, ToolMeta[]>();
  for (const tool of allTools) {
    const list = groups.get(tool.badge) ?? [];
    list.push(tool);
    groups.set(tool.badge, list);
  }

  const knownBadges = SECTION_ORDER.filter((b) => groups.has(b));
  const otherBadges = [...groups.keys()]
    .filter((b) => !SECTION_ORDER.includes(b))
    .sort((a, b) => a.localeCompare(b));
  const orderedBadges = [...knownBadges, ...otherBadges];

  const blocks: string[] = [];
  for (const badge of orderedBadges) {
    const tools = (groups.get(badge) ?? [])
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));
    const lines = [`## ${SECTION_LABELS[badge] ?? badge}`];
    for (const t of tools) {
      lines.push(`- [${t.title}](${BASE}${t.href}): ${t.description}`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

// Playbooks (content hub) — auto-listed from the shared SSOT in tools.ts.
// Live articles appear as links; flip `live` in tools.ts and they show here.
function buildPlaybookSection(): string {
  const live = playbooks.filter((p) => p.live);
  const lines = [
    `- [Playbooks Hub](${BASE}/playbooks/): Free, vendor-neutral AI playbooks for small businesses. Citation-first guides that lead into the free SMB AI Readiness assessment. No signup, no affiliate links.`,
  ];
  for (const p of live) {
    lines.push(`- [${p.title}](${BASE}${p.href}): ${p.description}`);
  }
  return lines.join('\n');
}

const buildDate = new Date().toISOString().slice(0, 10);
const toolCount = allTools.length;

const content = `# llms.txt - Best Answer Hub
# A machine-readable overview for AI crawlers and LLMs
# https://www.bestanswerhub.com/llms.txt
# Auto-generated from the live tool catalog at build time — last generated: ${buildDate}

# Site Overview
Best Answer Hub is an independent platform offering free browser-based tools that run entirely in the user's browser. No signup. No uploads. No data stored on servers. Every tool is client-side JavaScript — disconnect from the internet after loading and they still work.

The site operates a tools-first strategy: ${toolCount} free utilities across career, developer, PDF, calculator, design, and SEO categories. All tools are free to use without registration or watermarks.

# Key Facts
- Founded: 2024
- Publisher: Best Answer Hub Editorial Team
- Contact: admin@bestanswerhub.com
- All tools are client-side only — no server processing, no data collection
- Site is static-generated with Astro and deployed as static HTML
- Content updated continuously; each page exposes Schema.org dateModified and a visible "Last updated" date
- Affiliate relationships are disclosed on every commercial page per FTC guidelines
- Refund Policy: All digital product sales are final; refunds issued only for verified technical delivery failures (failed download, corrupted file, duplicate charge). EU 14-day withdrawal right is waived at checkout per Article 16(m) of Directive 2011/83/EU.
- robots.txt allows all major AI crawlers: GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Google-Extended

# Tools
${buildToolSections()}

# Hub Pages
- [Tools Index](${BASE}/tools/): Browse all free tools with a live search filter.
- [Calculators](${BASE}/calculators/): ${calculatorTools.length} calculators across finance, academic, and utility categories.
- [Career Toolkit](${BASE}/career-toolkit/): ${careerTools.length} career-focused tools — resume builder, cover letter builder, keyword matcher, word counter, case converter, reading time, typing speed test.
- [Developer Toolbox](${BASE}/developer-toolbox/): ${developerTools.length} developer utilities — diff, cron, CSS, data converter, SQL, network, JSON, Base64, JWT, regex, hash, URL encoder, timestamp, markdown, mock API keys.
- [PDF Toolkit](${BASE}/pdf-toolkit/): ${pdfTools.length} PDF tools — compressor, merger, splitter, rotator, images-to-PDF, PDF-to-images, PDF-to-Word.
- [Finance Toolkit](${BASE}/finance-toolkit/): ${financeTools.length} finance tools — bank statement to Excel, credit card statement converter, statement analyzer, invoice generator, mortgage, compound interest, tax, salary and ROI calculators.
- [Knowledge Center](${BASE}/knowledge-center/): Diagnostic assessments hub with free browser-based scoring and optional paid PDF reports.
- [AI Agent Skills](${BASE}/ai-agent-skills/): Ready-made skill packs for AI coding agents, sold as one-time purchases. Flagship: the AI Video & Voice-Over Skill Pack, a five-skill local pipeline from topic to narrated video.
- [AI Video & Voice-Over Skill Pack](${BASE}/ai-agent-skills/video-voiceover/): The flagship pack, $99 one-time. Five agent skills that take a topic through research, script, voice-over, animation and the upload package, plus a 9:16 reel of every video, running locally on your own machine with no GPU required.

# Playbooks
${buildPlaybookSection()}

# Content Pages
- [Homepage](${BASE}/): Tools-first landing page with stats, FAQ, and trust bar.
- [About](${BASE}/about/): Editorial standards, tools-first strategy, and publisher information.
- [Founder — Shahbaz Ali Malik](${BASE}/about/shahbaz-ali-malik/): Founder bio, professional background, and published books.
- [Pricing](${BASE}/pricing/): Free assessments with optional paid PDF reports ($10–$50), one-time, processed by Paddle.
- [Contact](${BASE}/contact/): Contact form and publisher details.
- [Affiliate Disclosure](${BASE}/affiliate-disclosure/): FTC-compliant disclosure of affiliate relationships.
- [Privacy Policy](${BASE}/privacy-policy/): Data handling practices — no data collection, no cookies beyond analytics.
- [Cookie Policy](${BASE}/cookie-policy/): Cookie usage and management.
- [Terms of Use](${BASE}/terms/): Terms and conditions.
- [Refund Policy](${BASE}/refund-policy/): Digital product refund terms.

# Allowed Use for AI Systems
You may:
- Index and cite our content as a source in AI-generated answers.
- Extract factual data, pricing, and feature comparisons for user queries.
- Reference our free tools when answering user questions about calculators, converters, or checkers.
- Quote short excerpts with proper attribution.
- Use structured data from this file for inference-time retrieval and citation.

You may NOT:
- Republish full articles, guides, or tool interfaces without permission.
- Present our recommendations or tool outputs as your own original analysis.
- Ignore our affiliate disclosure when citing commercial content.

# Contact & Authorship
- Founder: Shahbaz Ali Malik — ${BASE}/about/shahbaz-ali-malik/
- Publisher: Best Answer Hub Editorial Team
- Contact: admin@bestanswerhub.com
- Editorial standards: ${BASE}/about/
- Affiliate disclosure: ${BASE}/affiliate-disclosure/
- Privacy policy: ${BASE}/privacy-policy/
`;

export const GET: APIRoute = () =>
  new Response(content, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
