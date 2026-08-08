import { getConfig } from '@/lib/settings/config';

type PageUpdate = {
  id: string;
  name: string;
  slug: string;
  content: string;
  meta: { title: string; description: string };
};

const updates: PageUpdate[] = [
  {
    id: '1697cff9-8bc0-48e3-a06f-dcdbdfaa6099',
    name: 'سياسة الشحن والتوصيل',
    slug: 'shipping-policy',
    content: '<h1>سياسة الشحن والتوصيل</h1><p>توفر ShopaGlow خدمة توصيل مجانية لجميع الطلبات داخل المملكة العربية السعودية من خلال شركات شحن محلية حسب المدينة والتوفر.</p><ul><li><strong>مدة التوصيل المتوقعة:</strong> من 3 إلى 9 أيام عمل من تاريخ تأكيد الطلب، وتشمل تجهيز الطلب وتسليمه لشركة الشحن.</li><li><strong>رسوم الشحن:</strong> التوصيل مجاني لجميع المنتجات والطلبات داخل المملكة العربية السعودية، ولا تضاف رسوم شحن عند تأكيد الطلب.</li><li><strong>الدفع عند الاستلام:</strong> متاح للطلبات المؤهلة داخل السعودية، ويتم تحصيل قيمة المنتجات عند التسليم.</li><li><strong>تتبع الطلب:</strong> عند توفر رقم تتبع من شركة الشحن، يمكن للعميل طلبه عبر support@shopaglow.com مع ذكر رقم الطلب.</li></ul><p>في حال وجود تأخير خارج المدة المتوقعة، يرجى التواصل معنا عبر support@shopaglow.com وسنساعدك في متابعة الطلب مع شركة الشحن.</p>',
    meta: {
      title: 'سياسة الشحن والتوصيل المجاني | ShopaGlow',
      description: 'توصيل مجاني لجميع طلبات ShopaGlow داخل السعودية خلال 3 إلى 9 أيام عمل مع إمكانية الدفع عند الاستلام.',
    },
  },
  {
    id: 'fce5fd68-a1b8-473c-b856-10b507db5c6f',
    name: 'الأسئلة المتكررة',
    slug: 'faq',
    content: '<h3>الأسئلة المتكررة</h3><h4><strong>كم تستغرق معالجة الطلب وتوصيله؟</strong></h4><p>تصل الطلبات عادة خلال 3 إلى 9 أيام عمل من تاريخ التأكيد، وتشمل هذه المدة تجهيز الطلب وتسليمه لشركة الشحن. قد تحدث تأخيرات خارجة عن إرادتنا، ويمكنك التواصل معنا عبر support@shopaglow.com مع ذكر رقم الطلب للمتابعة.</p><h4><strong>هل الشحن مجاني؟</strong></h4><p>نعم. التوصيل مجاني لجميع المنتجات والطلبات داخل المملكة العربية السعودية.</p><h4><strong>هل يتم التوصيل خارج المملكة العربية السعودية؟</strong></h4><p>لا. يستقبل متجر ShopaGlow الطلبات ويوصلها حاليًا داخل المملكة العربية السعودية فقط.</p><h4><strong>ما طرق الدفع المتاحة؟</strong></h4><p>الدفع عند الاستلام متاح للطلبات المؤهلة داخل المملكة. يظهر إجمالي قيمة المنتجات بوضوح قبل تأكيد الطلب.</p><h4><strong>ماذا أفعل إذا وصل المنتج تالفًا أو مختلفًا عن طلبي؟</strong></h4><p>تواصل معنا خلال 15 يومًا تقويميًا من الاستلام عبر support@shopaglow.com، وأرفق رقم الطلب وصورًا واضحة للمشكلة. سنراجع الطلب وفقًا لسياسة الاسترجاع والاستبدال ونوضح لك طريقة الإرجاع أو الاستبدال.</p><h4><strong>كيف أتتبع طلبي؟</strong></h4><p>عند توفر رقم تتبع من شركة الشحن، يمكنك طلبه عبر support@shopaglow.com مع ذكر رقم الطلب.</p><h4><strong>كيف أتواصل مع خدمة العملاء؟</strong></h4><p>راسلنا على support@shopaglow.com. ساعات الرد من الاثنين إلى السبت، من 9:00 صباحًا إلى 6:00 مساءً بتوقيت السعودية.</p>',
    meta: {
      title: 'الأسئلة المتكررة | ShopaGlow السعودية',
      description: 'إجابات واضحة حول التوصيل المجاني خلال 3 إلى 9 أيام والدفع عند الاستلام والتتبع والاسترجاع خلال 15 يومًا.',
    },
  },
  {
    id: '17b753c0-65ac-4d62-9808-d19dd5f5f48e',
    name: 'سياسة الدفع عند الاستلام',
    slug: 'payment-policy',
    content: '<h1>سياسة الدفع عند الاستلام</h1><p>تتيح ShopaGlow خيار الدفع عند الاستلام للطلبات المؤهلة داخل المملكة العربية السعودية.</p><ul><li>يظهر السعر الإجمالي للمنتجات بوضوح قبل تأكيد الطلب، والتوصيل مجاني داخل المملكة العربية السعودية.</li><li>لا نطلب من العميل مشاركة بيانات بطاقة بنكية لإتمام طلب الدفع عند الاستلام.</li><li>يدفع العميل قيمة المنتجات لمندوب شركة الشحن عند التسليم.</li><li>قد يتواصل فريق التأكيد مع العميل للتأكد من صحة العنوان ورقم الجوال قبل تجهيز الطلب.</li><li>في حال تعذر التواصل مع العميل أو كان العنوان غير مكتمل، قد يتم تعليق أو إلغاء الطلب.</li></ul><p>لأي استفسار حول الدفع أو الفاتورة، تواصل معنا عبر support@shopaglow.com مع ذكر رقم الطلب.</p>',
    meta: {
      title: 'سياسة الدفع عند الاستلام | ShopaGlow',
      description: 'تفاصيل الدفع عند الاستلام والتوصيل المجاني في ShopaGlow وكيفية تأكيد الطلبات داخل السعودية.',
    },
  },
];

async function main() {
  const env = await getConfig();
  const authorization = `Bearer ${env.YOUCAN_API_TOKEN}`;
  const results = [];
  for (const update of updates) {
    const response = await fetch(`https://api.youcan.shop/pages/${update.id}`, {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ ...update, id: undefined, visibility: true }),
    });
    results.push({ slug: update.slug, status: response.status, ok: response.ok, body: await response.json() });
    if (!response.ok) throw new Error(`Failed to update ${update.slug}: ${response.status}`);
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
