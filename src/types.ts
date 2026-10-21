export interface SEOProps {
  title: string;
  description: string;
  url: string;
  type: 'WebPage' | 'Article' | 'FAQPage';
  datePublished?: string;
  dateModified?: string;
  ogImage?: string;
  article?: {
    author?: string;
    tags?: string[];
  };
  breadcrumbs?: Array<{
    name: string;
    url: string;
  }>;
  faq?: Array<{
    question: string;
    answer: string;
  }>;
}

export interface NavItem {
  label: string;
  href: string;
  external?: boolean;
}

export interface FooterColumn {
  title: string;
  links: NavItem[];
}

export interface CookieCategory {
  id: string;
  label: string;
  description: string;
  required?: boolean;
  default?: boolean;
}
