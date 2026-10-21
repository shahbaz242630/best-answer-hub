import { defineCollection, z } from 'astro:content';

const articles = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string().min(10).max(120),
    category: z.string(),
    description: z.string().min(50).max(300),
    lastUpdated: z.string().date(),
    publishedDate: z.string().date(),
    author: z.string().default('Best Answer Hub Editorial Team'),
    affiliateDisclosure: z.boolean().default(true),
    primaryKeyword: z.string(),
    secondaryKeywords: z.array(z.string()).default([]),
    topPick: z.string(),
    budgetPick: z.string().optional(),
    beginnerPick: z.string().optional(),
    premiumPick: z.string().optional(),
    products: z.array(z.string()).default([]),
    status: z.enum(['draft', 'published', 'archived']).default('draft'),
    readTime: z.number().optional(),
    featured: z.boolean().default(false),
    ogImage: z.string().optional(),
    canonical: z.string().optional(),
  }),
});

const affiliatePrograms = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    category: z.string(),
    programUrl: z.string().url(),
    commissionRate: z.string(),
    commissionType: z.enum(['recurring', 'one-time', 'pay-per-lead', 'hybrid']),
    cookieDuration: z.string(),
    payoutThreshold: z.string().optional(),
    region: z.string().default('Global'),
    restrictions: z.array(z.string()).default([]),
    approvalDifficulty: z.enum(['easy', 'moderate', 'hard']).default('moderate'),
    active: z.boolean().default(true),
    notes: z.string().optional(),
    lastVerified: z.string().date(),
  }),
});

export const collections = { articles, 'affiliate-programs': affiliatePrograms };
