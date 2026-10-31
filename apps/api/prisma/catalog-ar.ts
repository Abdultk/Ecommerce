import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Arabic text for the catalog, stored under `translations.ar` next to the English base
 * columns. Written for the storefront's Arabic mode; a native Omani reviewer should read it
 * before launch (the copy is plain Modern Standard Arabic with common Gulf kitchen terms).
 */
type ArProduct = { name: string; description: string; material: string; care: string };

export const AR_PRODUCTS: Readonly<Record<string, ArProduct>> = {
  "ash-cutting-board": {
    name: "لوح تقطيع من خشب الدردار",
    description: "<p>لوح خشبي فاتح اللون بمقبض قصير، للتقطيع ولتقديم الخبز.</p>",
    material: "خشب الدردار",
    care: "يُغسل يدوياً ويُجفَّف بوضعه عمودياً. يُدهن بالزيت بين حين وآخر.",
  },
  "box-grater": {
    name: "مبشرة رباعية الأوجه",
    description: "<p>أربعة أوجه للتبشير في مبشرة واحدة قائمة، من الشرائح الخشنة إلى قشر الحمضيات الناعم.</p>",
    material: "فولاذ مقاوم للصدأ بمقبض بلاستيكي",
    care: "تُغسل يدوياً للحفاظ على حدة الحواف.",
  },
  "brass-mortar-pestle": {
    name: "هاون نحاس أصفر مع مدقّة",
    description: "<p>هاون من النحاس الأصفر بمقبضين جانبيين، بشكل تقليدي لدقّ التوابل.</p>",
    material: "نحاس أصفر",
    care: "يُغسل يدوياً ويُجفَّف. سيغمق لون النحاس مع الوقت.",
  },
  "bread-knife": {
    name: "سكين خبز مسنّنة",
    description: "<p>نصل طويل مسنّن يقطع القشرة دون أن يسحق لبّ الخبز.</p>",
    material: "نصل من الفولاذ المقاوم للصدأ",
    care: "يُغسل يدوياً ويُجفَّف مباشرة.",
  },
  "cast-iron-skillet-10in": {
    name: "مقلاة حديد زهر 10 بوصات",
    description: "<p>مُتبَّلة مسبقاً وجاهزة للتحمير والخبز والقلي.</p>",
    material: "حديد زهر",
    care: "تُغسل يدوياً وتُجفَّف فوراً ثم تُدهن بالزيت قليلاً.",
  },
  "ceramic-pour-over-dripper": {
    name: "قمع قهوة مقطّرة من السيراميك",
    description: "<p>قمع من السيراميك يوضع على الكوب لتحضير القهوة المقطّرة بفلتر ورقي.</p>",
    material: "سيراميك",
    care: "يُشطف بعد الاستخدام. آمن في غسالة الأطباق.",
  },
  "chefs-knife-8in": {
    name: "سكين الشيف 8 بوصات",
    description: "<p>نصل متوازن لجميع الاستخدامات، مشحوذ يدوياً بزاوية 15° لكل جانب.</p>",
    material: "فولاذ مقاوم للصدأ عالي الكربون",
    care: "يُغسل يدوياً ويُجفَّف. لا يوضع أبداً في غسالة الأطباق.",
  },
  "copper-saucepan": {
    name: "قدر نحاسي صغير",
    description: "<p>قدر نحاسي يستجيب بسرعة للّهب، للصلصات والكاسترد والتركيزات التي تريد فيها ضبط الحرارة ومتابعتها.</p>",
    material: "نحاس ببطانة من الفولاذ المقاوم للصدأ",
    care: "يُغسل يدوياً. يمكن تلميع النحاس من وقت لآخر إن أحببت لمعانه.",
  },
  "digital-kitchen-scale": {
    name: "ميزان مطبخ رقمي",
    description: "<p>يزن بدقة 1 غرام حتى 5 كجم، مع خاصية التصفير وتبديل الوحدات.</p>",
    material: "فولاذ مقاوم للصدأ وبلاستيك ABS",
    care: "يُمسح بقطعة قماش. لا يُغمر في الماء.",
  },
  "enameled-dutch-oven-5-5qt": {
    name: "قدر دتش أوفن مطلي بالمينا 5.5 كوارت",
    description: "<p>حديد زهر ثقيل مطلي بالمينا للطبخ البطيء واليخنات والخبز.</p>",
    material: "حديد زهر مطلي بالمينا",
    care: "يُفضَّل الغسل اليدوي. تجنَّب أسلاك الجلي المعدنية.",
  },
  "end-grain-cutting-board": {
    name: "لوح تقطيع من خشب القيقب بالألياف القائمة",
    description: "<p>لطيف على حواف السكاكين وثقيل بما يكفي ليبقى ثابتاً في مكانه.</p>",
    material: "خشب القيقب",
    care: "يُغسل يدوياً ويُدهن شهرياً بزيت معدني صالح للاستخدام الغذائي.",
  },
  "glass-electric-kettle": {
    name: "غلاية كهربائية زجاجية",
    description: "<p>غلاية كهربائية بجسم زجاجي، فترى الماء وهو يصل إلى درجة الغليان.</p>",
    material: "جسم زجاجي، ومقبض وقاعدة من البلاستيك",
    care: "تُزال الترسبات الكلسية بانتظام. لا تُغمر القاعدة في الماء.",
  },
  "glass-storage-set-10pc": {
    name: "طقم حفظ طعام زجاجي 10 قطع",
    description: "<p>علب من زجاج البوروسيليكات بأغطية محكمة الإغلاق، من الفرن إلى المائدة إلى الثلاجة.</p>",
    material: "زجاج بوروسيليكات",
    care: "آمن في غسالة الأطباق والميكروويف والمجمّد.",
  },
  "knife-block-set": {
    name: "طقم سكاكين مع حامل خشبي",
    description: "<p>حامل خشبي يُبقي مجموعة السكاكين في متناول اليد وحوافها بعيدة عن الدرج.</p>",
    material: "حامل خشبي وسكاكين من الفولاذ المقاوم للصدأ",
    care: "تُغسل السكاكين يدوياً؛ ويُمسح الحامل بقطعة قماش مبللة.",
  },
  "magnetic-knife-rack": {
    name: "حامل سكاكين مغناطيسي خشبي",
    description: "<p>حامل جداري بشرائط مغناطيسية يثبّت السكاكين بنصلها ظاهراً أمام العين.</p>",
    material: "خشب بشرائط مغناطيسية",
    care: "يُمسح بقطعة قماش جافة.",
  },
  "maple-rolling-pin": {
    name: "نشابة خشبية",
    description: "<p>نشابة خشبية ملساء بمقبضين مخروطين للعجين والفطائر والخبز المسطح.</p>",
    material: "خشب صلب",
    care: "تُمسح بقطعة قماش جافة؛ ولا تُنقع أبداً.",
  },
  "marble-mortar-pestle": {
    name: "هاون رخام مع مدقّة",
    description: "<p>هاون حجري ثقيل يبقى ثابتاً في مكانه أثناء الدقّ.</p>",
    material: "رخام",
    care: "يُغسل بالماء فقط دون صابون، فالحجر قد يمتصه.",
  },
  "paring-knife": {
    name: "سكين تقشير",
    description: "<p>سكين قصير للتقشير والتنظيف والأعمال الدقيقة التي يكبر عليها سكين الشيف.</p>",
    material: "نصل من الفولاذ المقاوم للصدأ",
    care: "يُغسل يدوياً ويُجفَّف مباشرة.",
  },
  "pasta-pot-with-strainer": {
    name: "قدر معكرونة مع مصفاة",
    description: "<p>قدر طويل من الفولاذ المقاوم للصدأ مع مصفاة مثقّبة: ارفع المصفاة فتُصفّى المعكرونة دون حاجة إلى مصفاة منفصلة.</p>",
    material: "فولاذ مقاوم للصدأ",
    care: "آمن في غسالة الأطباق.",
  },
  "porcelain-mortar-pestle": {
    name: "هاون بورسلين مع مدقّة",
    description: "<p>هاون من البورسلين الأبيض الأملس لطحن التوابل والمعاجين.</p>",
    material: "بورسلين",
    care: "يُشطف ويُجفَّف. آمن في غسالة الأطباق.",
  },
  "silicone-spatula-set-3pc": {
    name: "طقم ملاعق سيليكون 3 قطع",
    description: "<p>رؤوس مقاومة للحرارة على قلب من الفولاذ المقاوم للصدأ، بأحجام تناسب الأوعية والمرطبانات والأواني.</p>",
    material: "سيليكون بقلب من الفولاذ المقاوم للصدأ",
    care: "آمنة في غسالة الأطباق.",
  },
  "stainless-colander": {
    name: "مصفاة من الفولاذ المقاوم للصدأ",
    description: "<p>مصفاة فولاذية بمقبضين للشطف والتصفية.</p>",
    material: "فولاذ مقاوم للصدأ",
    care: "آمنة في غسالة الأطباق.",
  },
  "tri-ply-saucepan-2qt": {
    name: "قدر ثلاثي الطبقات من الفولاذ المقاوم للصدأ 2 كوارت",
    description: "<p>توزيع متساوٍ للحرارة من القاعدة إلى الحافة، مع غطاء محكم.</p>",
    material: "فولاذ مقاوم للصدأ (ثلاثي الطبقات)",
    care: "آمن في غسالة الأطباق؛ والغسل اليدوي يحافظ على لمعانه.",
  },
  "wooden-spoon": {
    name: "ملعقة طبخ خشبية",
    description: "<p>ملعقة خشبية طويلة لطيفة على الأواني غير اللاصقة والمطلية بالمينا ولا توصّل الحرارة.</p>",
    material: "خشب",
    care: "تُغسل يدوياً وتُجفَّف.",
  },
};

export const AR_CATEGORIES: Readonly<Record<string, string>> = {
  "bread-knives": "سكاكين الخبز",
  "chefs-knives": "سكاكين الشيف",
  cookware: "أواني الطبخ",
  "cutting-boards": "ألواح التقطيع",
  "dutch-ovens": "قدور دتش أوفن",
  "food-storage": "حفظ الطعام",
  "kettles-brewing": "الغلايات والتحضير",
  "kitchen-scales": "موازين المطبخ",
  "knife-storage": "حاملات السكاكين",
  "knives-cutlery": "السكاكين وأدوات المائدة",
  mortars: "الهاون والمدقّات",
  "paring-knives": "سكاكين التقشير",
  "rolling-pins": "النشابات",
  saucepans: "القدور الصغيرة",
  skillets: "المقالي",
  "small-appliances": "الأجهزة الصغيرة",
  spatulas: "الملاعق المسطحة",
  spoons: "ملاعق الطبخ",
  stockpots: "قدور الحساء والمعكرونة",
  storage: "التخزين",
  "strainers-graters": "المصافي والمبشرات",
  "utensils-tools": "الأدوات والأواني",
};

export const AR_VARIANTS: Readonly<Record<string, string>> = {
  "BR-CK8": "8 بوصات",
  "BR-SP3": "3 قطع",
  "CL-GS10": "10 قطع",
  "CL-SP2": "2 كوارت",
  "HP-CB-ASH-L": "كبير",
  "HP-CB-ASH-M": "وسط",
  "IV-KS5": "5 كجم",
  "IV-SK10": "10 بوصات",
  "IV-SK12": "12 بوصة",
  "NF-CB-L": "كبير",
  "NF-CB-M": "وسط",
  "NF-DO55-COB": "أزرق كوبالت",
  "NF-DO55-SAG": "أخضر مريمي",
};
/** Variants named "Standard" in English. */
export const AR_STANDARD_VARIANT = "قياسي";

/** Merges the Arabic text into each row's `translations` JSON. Safe to run repeatedly. */
export async function applyArabicCatalog(
  db: Db,
): Promise<{ products: number; categories: number; variants: number }> {
  let products = 0;
  for (const [slug, ar] of Object.entries(AR_PRODUCTS)) {
    const row = await db.product.findUnique({ where: { slug }, select: { translations: true } });
    if (!row) continue;
    const translations = {
      ...(row.translations as object),
      ar: { name: ar.name, description: ar.description, material: ar.material, careInstructions: ar.care },
    };
    await db.product.update({ where: { slug }, data: { translations } });
    products += 1;
  }

  let categories = 0;
  for (const [slug, name] of Object.entries(AR_CATEGORIES)) {
    const row = await db.category.findUnique({ where: { slug }, select: { translations: true } });
    if (!row) continue;
    await db.category.update({
      where: { slug },
      data: { translations: { ...(row.translations as object), ar: { name } } },
    });
    categories += 1;
  }

  const variantRows = await db.productVariant.findMany({
    select: { id: true, sku: true, name: true, translations: true },
  });
  let variants = 0;
  for (const v of variantRows) {
    const name = AR_VARIANTS[v.sku] ?? (v.name === "Standard" ? AR_STANDARD_VARIANT : null);
    if (!name) continue;
    await db.productVariant.update({
      where: { id: v.id },
      data: { translations: { ...(v.translations as object), ar: { name } } },
    });
    variants += 1;
  }
  return { products, categories, variants };
}
