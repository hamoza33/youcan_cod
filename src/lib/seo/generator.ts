import slugify from 'slugify';
import { Category, CodProduct } from '@prisma/client';
import { AiProviderChain } from '@/lib/ai/provider-chain';
import { type AiChatClient } from '@/lib/ai/types';
import { countryLabel } from '@/lib/countries';
import { enforceArabicDescriptionLength } from '@/lib/products/arabic-content';
import { selectAccurateProductImages } from '@/lib/products/image-enrichment';
import { categorizeProductByRules } from '@/lib/categories/main-categories';

export type SeoGenerationResult = {
  productType: string;
  categorySlug: string;
  categoryConfidence: 'high' | 'medium' | 'low';
  useCase: string;
  title: string;
  description: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  safeSellingPoints: string[];
  complianceNotes: string;
  sourceSummary: string;
  selectedImageUrls?: string[];
};

export async function generateSeoMetadata(input: {
  product: CodProduct;
  categories: Category[];
  ai?: AiChatClient;
}): Promise<SeoGenerationResult & { aiProvider: string; aiModel: string; rawAiResponse: unknown }> {
  const ai = input.ai ?? await AiProviderChain.create();
  const searchResults: never[] = [];
  const ruleCategorySlug = categorizeProductByRules({
    name: input.product.name,
    rawName: input.product.rawName,
    description: input.product.description,
    rawDescription: input.product.rawDescription,
  });
  const categoryList = input.categories
    .filter((category) => category.youCanCategoryId)
    .map((category) => ({
      name: category.name,
      slug: category.slug,
      youCanCategoryId: category.youCanCategoryId,
      google: category.googleProductCategory,
    }));
  const originalImageUrls = input.product.imageUrls.slice(0, 6);
  const imageUrls = await selectAccurateProductImages({
    title: input.product.rawName ?? input.product.name,
    rawName: input.product.rawName,
    existingImageUrls: originalImageUrls,
    searchResults,
    ai,
  });

  const result = await ai.chatJson<SeoGenerationResult>(
    [
      {
        role: 'system',
        content:
          'أنت خبير تجارة إلكترونية وSEO ومتطلبات Google Merchant Center لمتجر COD في الخليج. اكتب كل العناوين والوصف والنقاط والكلمات المفتاحية باللغة العربية الفصحى السهلة والمناسبة للبيع. تجنب الادعاءات الطبية أو المبالغة أو الادعاءات غير المثبتة. الوصف يجب أن يكون HTML منسقًا ومناسبًا لـ YouCan بين 1000 و1500 حرف إجماليًا فقط. استخدم <h2><p><h3><ul><li><strong>. لا تستخدم CSS أو جداول. اختر categorySlug فقط من فئات YouCan الموجودة في availableCategories. إذا لم تكن واثقًا اجعل categoryConfidence منخفضة.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              country: input.product.country,
              countryArabic: countryLabel(input.product.country),
              rawName: input.product.rawName ?? input.product.name,
              description: input.product.rawDescription ?? input.product.description,
              price: input.product.price,
              currency: input.product.currency,
              imageUrls,
              ruleBasedCategorySlug: ruleCategorySlug,
              availableYouCanCategoriesOnly: categoryList,
              webSearchResults: searchResults,
              writingRules: [
                'العنوان عربي واضح ومناسب للبحث والبيع بدون مبالغة.',
                'الوصف HTML عربي منسق بين 1000 و1500 حرف فقط.',
                'ابدأ بـ <h2>وصف المنتج</h2> ثم مقدمة قصيرة جذابة.',
                'أضف <h3>أهم المميزات</h3> مع 3-5 نقاط <li> وفي كل نقطة <strong>عنوان ميزة</strong>.',
                'أضف <h3>طريقة الاستخدام</h3> وفقرة قصيرة.',
                'أضف <h3>لماذا تختار هذا المنتج؟</h3> وفقرة ختامية فيها كلمات مفتاحية طبيعية.',
                'اختم بضمان استرجاع خلال 15 يومًا.',
                'لا تذكر ادعاءات طبية أو نتائج مضمونة أو وعود مبالغ فيها.',
                'اختر categorySlug من availableYouCanCategoriesOnly فقط. استخدم ruleBasedCategorySlug إذا كان مناسبًا للمنتج، ولا تضع المنتج في التصنيف الافتراضي إلا إذا لم يوجد تصنيف أدق.',
                'اختر صورًا لنفس المنتج بالضبط فقط في selectedImageUrls، ويفضل 4-5 إن كانت متاحة ومؤكدة. ارفض أي لون أو شكل أو موديل أو مقاس أو حزمة مختلفة حتى لو كان المنتج مشابهًا.',
              ],
              requiredOutput: {
                productType: 'نوع المنتج بالعربية',
                categorySlug: 'one slug from availableYouCanCategoriesOnly',
                categoryConfidence: 'high | medium | low',
                useCase: 'استخدامات آمنة ومحتملة بالعربية',
                title: 'عنوان منتج عربي SEO',
                description: 'HTML Arabic description 1000-1500 chars total',
                slug: 'latin URL slug',
                metaTitle: 'عنوان ميتا عربي جذاب حتى 60 حرف تقريبًا',
                metaDescription: 'وصف ميتا عربي مفيد حتى 155 حرف تقريبًا',
                keywords: ['كلمات مفتاحية عربية مفيدة وليست قليلة'],
                safeSellingPoints: ['مميزات آمنة وفعلية بالعربية'],
                complianceNotes: 'ملاحظات سياسات وتجنب ادعاءات',
                sourceSummary: 'كيف تم التعرف على المنتج',
                selectedImageUrls: ['صور واضحة لنفس المنتج فقط'],
              },
            }),
          },
          ...imageUrls.slice(0, 6).map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        ],
      },
    ],
    'SeoGenerationResult object with Arabic productType, useCase, title, HTML Arabic description 1000-1500 chars, metaTitle, metaDescription, keywords, safeSellingPoints, complianceNotes, sourceSummary, categorySlug, categoryConfidence, latin slug, optional selectedImageUrls.',
  );

  const selectedCategorySlug = categoryList.some((category) => category.slug === result.categorySlug)
    ? result.categorySlug
    : categoryList.some((category) => category.slug === ruleCategorySlug)
      ? ruleCategorySlug
      : categoryList[0]?.slug ?? ruleCategorySlug;

  return {
    ...result,
    categorySlug: selectedCategorySlug,
    description: enforceArabicDescriptionLength(result.description),
    slug: normalizeSlug(result.slug || result.title),
    selectedImageUrls: result.selectedImageUrls?.length ? result.selectedImageUrls : imageUrls,
    aiProvider: ai.providerName,
    aiModel: ai.model,
    rawAiResponse: result,
  };
}

export function normalizeSlug(value: string) {
  return slugify(value, { lower: true, strict: true, trim: true }) || `product-${Date.now()}`;
}
