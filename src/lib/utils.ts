export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function getAffiliateUrl(slug: string): string {
  return `/go/${slug}/`;
}

export function getCategoryUrl(slug: string): string {
  return `/categories/${slug}/`;
}

export function getArticleUrl(slug: string): string {
  return `/best/${slug}/`;
}

export function getProductUrl(slug: string): string {
  return `/tools/${slug}/`;
}

export function getComparisonUrl(slug: string): string {
  return `/compare/${slug}/`;
}
