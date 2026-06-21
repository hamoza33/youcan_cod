import slugify from 'slugify';
import { LogLevel, LogSource } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logEvent } from '@/lib/logger';
import { YouCanCategory, YouCanClient } from '@/lib/integrations/youcan/client';
import { MAIN_CATEGORIES, mainCategoryBySlug } from '@/lib/categories/main-categories';
import { toJsonValue } from '@/lib/http/client';

export async function syncYouCanCategories() {
  const client = await YouCanClient.create();
  const categories = await client.listCategories({ limit: 100 });
  let synced = 0;

  for (const category of categories) {
    await upsertYouCanCategory(category);
    synced += 1;
  }

  await logEvent({ source: LogSource.YOUCAN, message: `Synced ${synced} YouCan categories`, context: { synced } });
  return { synced, categories };
}

export async function ensureMainYouCanCategories() {
  const client = await YouCanClient.create();
  let remoteCategories = await client.listCategories({ limit: 100, maxPages: 3 });
  let created = 0;
  let mapped = 0;
  let failed = 0;

  for (const category of MAIN_CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, googleProductCategory: category.googleProductCategory, sortOrder: category.sortOrder, isActive: true },
      create: { name: category.name, slug: category.slug, googleProductCategory: category.googleProductCategory, sortOrder: category.sortOrder, isActive: true },
    });

    const existingRemote = findMatchingRemoteCategory(remoteCategories, category.slug, category.name);
    if (existingRemote?.id) {
      await prisma.category.update({ where: { slug: category.slug }, data: { youCanCategoryId: existingRemote.id } });
      mapped += 1;
      continue;
    }

    try {
      const createdCategory = await client.createCategory({
        name: category.name,
        slug: category.slug,
        description: `${category.name} products`,
        show_on_collection: true,
        meta: { title: category.name, description: `${category.name} products` },
      });
      await prisma.category.update({ where: { slug: category.slug }, data: { youCanCategoryId: createdCategory.id } });
      remoteCategories = [...remoteCategories, createdCategory];
      created += 1;
    } catch (error) {
      failed += 1;
      await logEvent({
        source: LogSource.YOUCAN,
        level: LogLevel.WARN,
        message: `Could not create YouCan category ${category.slug}; will map to existing fallback if available.`,
        context: toJsonValue({ error: String(error), slug: category.slug }),
      });
    }
  }

  if (failed > 0) {
    await mapUnmappedMainCategoriesToFallback(remoteCategories);
  }

  await logEvent({ source: LogSource.YOUCAN, message: `Ensured main YouCan categories`, context: { created, mapped, failed } });
  return { created, mapped, failed };
}

export async function ensureMappedCategory(preferredSlug?: string | null) {
  const normalizedPreferred = preferredSlug ? mainCategoryBySlug(preferredSlug)?.slug ?? preferredSlug : null;
  const preferred = normalizedPreferred
    ? await prisma.category.findFirst({ where: { slug: normalizedPreferred, isActive: true, youCanCategoryId: { not: null } }, orderBy: { sortOrder: 'asc' } })
    : null;
  if (preferred) return preferred;

  if (normalizedPreferred) {
    await ensureMainYouCanCategories().catch(() => undefined);
    const afterEnsure = await prisma.category.findFirst({ where: { slug: normalizedPreferred, isActive: true, youCanCategoryId: { not: null } }, orderBy: { sortOrder: 'asc' } });
    if (afterEnsure) return afterEnsure;
  }

  const fallback = await prisma.category.findFirst({ where: { isActive: true, youCanCategoryId: { not: null } }, orderBy: { sortOrder: 'asc' } });
  if (fallback) return fallback;

  await logEvent({
    source: LogSource.YOUCAN,
    level: LogLevel.WARN,
    message: 'No YouCan category mapping is available. Attempting category sync before import.',
  });
  await syncYouCanCategories();
  return prisma.category.findFirst({ where: { isActive: true, youCanCategoryId: { not: null } }, orderBy: { sortOrder: 'asc' } });
}

async function upsertYouCanCategory(category: YouCanCategory) {
  const name = stringValue(category.name) ?? `YouCan Category ${category.id}`;
  const slug = stringValue(category.slug) ?? (slugify(name, { lower: true, strict: true, trim: true }) || `youcan-${category.id}`);
  const existingMain = mainCategoryBySlug(slug);
  await prisma.category.upsert({
    where: { slug },
    update: { name: existingMain?.name ?? name, youCanCategoryId: category.id, isActive: true },
    create: { name: existingMain?.name ?? name, slug, youCanCategoryId: category.id, isActive: true, googleProductCategory: existingMain?.googleProductCategory },
  });
}

async function mapUnmappedMainCategoriesToFallback(remoteCategories: YouCanCategory[]) {
  const fallbackRemote = remoteCategories[0];
  if (!fallbackRemote?.id) return;
  await prisma.category.updateMany({
    where: { slug: { in: MAIN_CATEGORIES.map((category) => category.slug) }, youCanCategoryId: null },
    data: { youCanCategoryId: fallbackRemote.id },
  });
}

function findMatchingRemoteCategory(categories: YouCanCategory[], slug: string, name: string) {
  const normalizedSlug = normalize(slug);
  const normalizedName = normalize(name);
  return categories.find((category) => normalize(category.slug) === normalizedSlug || normalize(category.name) === normalizedName);
}

function normalize(value: unknown) {
  return String(value ?? '').toLowerCase().replace(/\s*\/.*$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
