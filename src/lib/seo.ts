import type { SEOProps } from '../types';
import { hubCollections } from '../data/tools';
import { readFileSync } from 'fs';

// Load page-published registry (auto-managed by prebuild.mjs).
// Falls back to empty object if registry doesn't exist yet (first run).
let publishedDates: Record<string, string> = {};
try {
  publishedDates = JSON.parse(readFileSync('./page-published.json', 'utf-8'));
} catch {
  // Registry not created yet — pages will use their explicit datePublished or the hardcoded fallback
}

export function generateStructuredData(data: SEOProps) {
  const baseUrl = 'https://www.bestanswerhub.com';
  const founderPath = '/about/shahbaz-ali-malik/';
  const personId = `${baseUrl}${founderPath}#person`;
  const graph: any[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${baseUrl}/#website`,
      name: 'Best Answer Hub',
      url: baseUrl,
      description: 'Free browser-based tools and honest software recommendations. No signup, no uploads, no data stored.',
      publisher: { '@id': `${baseUrl}/#organization` },
      inLanguage: 'en-US',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${baseUrl}/#organization`,
      name: 'Best Answer Hub',
      url: baseUrl,
      logo: {
        '@type': 'ImageObject',
        url: `${baseUrl}/logo.png`,
        width: 512,
        height: 512,
      },
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'admin@bestanswerhub.com',
        availableLanguage: 'English',
      },
      // Official profiles removed 2026-06-18 (X, LinkedIn, Reddit brand accounts
      // blocked, restore once resolved). Re-add sameAs with the profile URLs then.
      // sameAs: [
      //   'https://x.com/BestAnswerHub',
      //   'https://www.linkedin.com/company/bestanswerhub/',
      // ],
    },
  ];

  if (data.type === 'WebPage') {
    // dateModified must be DETERMINISTIC across builds. Never fall back to
    // `new Date()` — a build-time timestamp changes the HTML on every build,
    // which (a) re-triggers IndexNow for unchanged pages and (b) lies to Google
    // about freshness. When a page supplies no explicit dateModified, fall back
    // to its publication date (stable + honest).
    const webPagePublished = data.datePublished || publishedDates[data.url] || '2026-01-15T00:00:00+00:00';

    // Hub pages (calculators, dev toolbox, etc.) are CollectionPages that gather
    // many tools in one place. Emitting CollectionPage + an ItemList of the
    // member tools is the machine-readable signal that wins "all the X tools in
    // one place, no signup" queries from Google, LLMs, and agents. Driven by the
    // hubCollections registry in tools.ts (single source of truth).
    const hub = hubCollections[data.url];
    const webPageNode: any = {
      '@context': 'https://schema.org',
      '@type': hub ? ['WebPage', 'CollectionPage'] : 'WebPage',
      '@id': `${baseUrl}${data.url.replace(/\/$/, '')}/#webpage`,
      url: `${baseUrl}${data.url}`,
      name: data.title,
      description: data.description,
      isPartOf: { '@id': `${baseUrl}/#website` },
      about: { '@id': `${baseUrl}/#organization` },
      author: { '@id': personId },
      inLanguage: 'en-US',
      datePublished: webPagePublished,
      dateModified: data.dateModified || webPagePublished,
    };
    if (hub) {
      webPageNode.mainEntity = {
        '@type': 'ItemList',
        name: hub.name,
        description: hub.description,
        numberOfItems: hub.tools.length,
        itemListElement: hub.tools.map((t, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'SoftwareApplication',
            name: t.title,
            description: t.description,
            url: `${baseUrl}${t.href}`,
            applicationCategory: 'UtilityApplication',
            operatingSystem: 'Any',
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          },
        })),
      };
    }
    graph.push(webPageNode);
  }

  if (data.type === 'Article' && data.article) {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'Article',
      '@id': `${baseUrl}${data.url.replace(/\/$/, '')}/#article`,
      headline: data.title,
      description: data.description,
      url: `${baseUrl}${data.url}`,
      author: { '@id': personId },
      publisher: { '@id': `${baseUrl}/#organization` },
      datePublished: data.datePublished || publishedDates[data.url],
      dateModified: data.dateModified,
      image: data.ogImage ? `${baseUrl}${data.ogImage}` : undefined,
      mainEntityOfPage: { '@id': `${baseUrl}${data.url.replace(/\/$/, '')}/#webpage` },
    });
  }

  if (data.breadcrumbs) {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: data.breadcrumbs.map((crumb, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: crumb.name,
        item: `${baseUrl}${crumb.url}`,
      })),
    });
  }

  if (data.faq && data.faq.length > 0) {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: data.faq.map((q) => ({
        '@type': 'Question',
        name: q.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: q.answer,
        },
      })),
    });
  }

  // SoftwareApplication schema — auto-generated for individual tool/calculator pages
  // Excludes hub index pages (/tools/, /calculators/, etc.) by checking URL is longer than the prefix
  const toolPaths = ['/tools/', '/calculators/', '/developer-toolbox/', '/career-toolkit/'];
  const isToolPage = toolPaths.some(p => data.url.startsWith(p) && data.url.length > p.length);
  if (isToolPage) {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      '@id': `${baseUrl}${data.url.replace(/\/$/, '')}/#tool`,
      name: data.title.replace(/\s*[|—–].*$/, '').trim(), // strip tagline, keep tool name
      description: data.description,
      url: `${baseUrl}${data.url}`,
      applicationCategory: 'UtilityApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript. Works in all modern browsers.',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      author: { '@id': personId },
      isPartOf: { '@id': `${baseUrl}/#website` },
    });
  }

  // Minimal named Person node so every page's graph attributes a human author.
  // Skipped on the founder page itself, which already defines the full Person node
  // (same @id) — avoids a duplicate-@id conflict.
  if (data.url !== founderPath) {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'Person',
      '@id': personId,
      name: 'Shahbaz Ali Malik',
      url: `${baseUrl}${founderPath}`,
    });
  }

  const json = JSON.stringify({ '@graph': graph }, null, 2);
  // Break </script> sequences to prevent closing the JSON-LD script tag prematurely
  return json.replace(/<\/script>/gi, '<\\/script>');
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function estimateReadTime(content: string): number {
  const wordsPerMinute = 200;
  const words = content.trim().split(/\s+/).length;
  return Math.ceil(words / wordsPerMinute);
}
