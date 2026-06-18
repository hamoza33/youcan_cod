import { Category } from '@prisma/client';

export type MainCategorySeed = {
  name: string;
  slug: string;
  googleProductCategory: string;
  sortOrder: number;
  keywords: string[];
};

export const MAIN_CATEGORIES: MainCategorySeed[] = [
  {
    name: 'Home & Kitchen / المنزل والمطبخ',
    slug: 'home-kitchen',
    googleProductCategory: 'Home & Garden > Kitchen & Dining',
    sortOrder: 10,
    keywords: ['home', 'kitchen', 'cook', 'cooking', 'utensil', 'storage', 'organizer', 'cleaning', 'mop', 'lamp', 'light', 'bed', 'bath', 'منزل', 'مطبخ', 'تنظيف', 'منظم', 'إضاءة'],
  },
  {
    name: 'Beauty & Personal Care / الجمال والعناية',
    slug: 'beauty-personal-care',
    googleProductCategory: 'Health & Beauty > Personal Care',
    sortOrder: 20,
    keywords: ['beauty', 'makeup', 'cosmetic', 'skincare', 'skin care', 'face', 'facial', 'lift tape', 'v-shaped', 'v face', 'jaw', 'eyebrow', 'hair', 'nail', 'shaver', 'trimmer', 'جمال', 'مكياج', 'عناية', 'بشرة', 'وجه', 'شد الوجه', 'لاصقات', 'شعر', 'أظافر'],
  },
  {
    name: 'Electronics Accessories / ملحقات الإلكترونيات',
    slug: 'electronics-accessories',
    googleProductCategory: 'Electronics > Electronics Accessories',
    sortOrder: 30,
    keywords: ['electronics', 'usb', 'charger', 'cable', 'adapter', 'power bank', 'bluetooth', 'speaker', 'earbuds', 'headphone', 'camera', 'led', 'إلكترونيات', 'شاحن', 'كيبل', 'سماعة', 'بلوتوث'],
  },
  {
    name: 'Fashion Accessories / إكسسوارات الموضة',
    slug: 'fashion-accessories',
    googleProductCategory: 'Apparel & Accessories',
    sortOrder: 40,
    keywords: ['fashion', 'watch', 'sunglasses', 'glasses', 'belt', 'wallet', 'jewelry', 'bracelet', 'necklace', 'ring', 'cap', 'scarf', 'موضة', 'نظارة', 'ساعة', 'محفظة', 'حزام', 'إكسسوار'],
  },
  {
    name: 'Health & Wellness / الصحة والراحة',
    slug: 'health-wellness',
    googleProductCategory: 'Health & Beauty > Health Care',
    sortOrder: 50,
    keywords: ['health', 'wellness', 'massage', 'posture', 'support', 'brace', 'relief', 'therapy', 'hearing', 'medical', 'صحة', 'راحة', 'مساج', 'دعامة', 'طبي'],
  },
  {
    name: 'Sports & Outdoors / الرياضة والرحلات',
    slug: 'sports-outdoors',
    googleProductCategory: 'Sporting Goods',
    sortOrder: 60,
    keywords: ['sport', 'fitness', 'gym', 'outdoor', 'camping', 'hiking', 'bike', 'bicycle', 'exercise', 'yoga', 'رياضة', 'تمارين', 'رحلات', 'تخييم'],
  },
  {
    name: 'Automotive / السيارات',
    slug: 'automotive',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories',
    sortOrder: 70,
    keywords: ['car', 'auto', 'automotive', 'vehicle', 'motorcycle', 'dashboard', 'mirror', 'tire', 'السيارة', 'سيارات', 'دراجة', 'مرآة'],
  },
  {
    name: 'Kids & Baby / الأطفال والرضع',
    slug: 'kids-baby',
    googleProductCategory: 'Baby & Toddler',
    sortOrder: 80,
    keywords: ['baby', 'kid', 'kids', 'child', 'children', 'toy', 'school', 'طفل', 'أطفال', 'رضيع', 'لعبة', 'مدرسة'],
  },
  {
    name: 'Pet Supplies / مستلزمات الحيوانات',
    slug: 'pet-supplies',
    googleProductCategory: 'Animals & Pet Supplies',
    sortOrder: 90,
    keywords: ['pet', 'cat', 'dog', 'bird', 'fish', 'حيوان', 'قط', 'كلب', 'طائر', 'سمك'],
  },
  {
    name: 'Tools & DIY / الأدوات والصيانة',
    slug: 'tools-diy',
    googleProductCategory: 'Hardware > Tools',
    sortOrder: 100,
    keywords: ['tool', 'tools', 'diy', 'repair', 'drill', 'screw', 'wrench', 'adhesive', 'tape measure', 'أداة', 'أدوات', 'صيانة', 'إصلاح', 'مثقاب'],
  },
  {
    name: 'Travel & Bags / السفر والحقائب',
    slug: 'travel-bags',
    googleProductCategory: 'Luggage & Bags',
    sortOrder: 110,
    keywords: ['travel', 'bag', 'backpack', 'luggage', 'suitcase', 'passport', 'سفر', 'حقيبة', 'شنطة', 'أمتعة'],
  },
  {
    name: 'Office & Stationery / المكتب والقرطاسية',
    slug: 'office-stationery',
    googleProductCategory: 'Office Supplies',
    sortOrder: 120,
    keywords: ['office', 'stationery', 'pen', 'paper', 'desk', 'notebook', 'printer', 'مكتب', 'قرطاسية', 'قلم', 'ورق', 'دفتر'],
  },
  {
    name: 'Phone Accessories / ملحقات الجوال',
    slug: 'phone-accessories',
    googleProductCategory: 'Electronics > Communications > Telephony > Mobile Phone Accessories',
    sortOrder: 130,
    keywords: ['phone', 'mobile', 'iphone', 'samsung', 'case', 'screen protector', 'holder', 'stand', 'جوال', 'هاتف', 'آيفون', 'سامسونج', 'كفر', 'حامل'],
  },
  {
    name: 'Smart Gadgets / الأجهزة الذكية',
    slug: 'smart-gadgets',
    googleProductCategory: 'Electronics',
    sortOrder: 140,
    keywords: ['smart', 'gadget', 'device', 'sensor', 'remote', 'wireless', 'mini', 'portable', 'ذكي', 'جهاز', 'لاسلكي', 'محمول'],
  },
  {
    name: 'General Deals / عروض متنوعة',
    slug: 'general-deals',
    googleProductCategory: 'General Merchandise',
    sortOrder: 150,
    keywords: ['deal', 'general', 'multi', 'misc', 'various', 'عام', 'متنوع', 'عرض'],
  },
];

export function mainCategoryBySlug(slug?: string | null) {
  return MAIN_CATEGORIES.find((category) => category.slug === slug) ?? null;
}

export function categorizeProductByRules(input: {
  name?: string | null;
  rawName?: string | null;
  description?: string | null;
  rawDescription?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
}) {
  const text = [input.name, input.rawName, input.description, input.rawDescription, input.seoTitle, input.seoDescription]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!text.trim()) return 'general-deals';

  let best = { slug: 'general-deals', score: 0 };
  for (const category of MAIN_CATEGORIES) {
    const score = category.keywords.reduce((total, keyword) => total + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0);
    if (score > best.score) best = { slug: category.slug, score };
  }

  return best.slug;
}

export function categorySeedData() {
  return MAIN_CATEGORIES.map((category) => ({
    name: category.name,
    slug: category.slug,
    googleProductCategory: category.googleProductCategory,
    sortOrder: category.sortOrder,
  }));
}

export function isMainCategory(category: Pick<Category, 'slug'>) {
  return MAIN_CATEGORIES.some((item) => item.slug === category.slug);
}
