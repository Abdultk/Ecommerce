/**
 * The Al Baleed photo shoot ("albaleed images" at the repo root): one entry per product code.
 * Names describe only what is visible in the photos (colour, shape, finish tone); materials,
 * sizes and prices are NOT known from photos, so they are left for the shop owner. Every
 * product is imported as a DRAFT with an inactive placeholder variant until a real price and
 * stock are supplied (see prices.csv and import-albaleed.ts).
 */

export type CategorySeed = { slug: string; name: string; ar: string };

export const CATEGORIES: CategorySeed[] = [
  { slug: "cake-stands", name: "Cake Stands & Serving Platters", ar: "حوامل الكيك وأطباق التقديم" },
  { slug: "tiered-stands", name: "Tiered Stands", ar: "حوامل متعددة الطبقات" },
  { slug: "dallahs-carafes", name: "Dallahs & Carafes", ar: "الدلال والأباريق" },
  { slug: "vases-glassware", name: "Vases & Glassware", ar: "المزهريات والزجاجيات" },
  { slug: "tableware-trays", name: "Tableware & Trays", ar: "أدوات المائدة والصواني" },
];

export type ProductSeed = {
  /** The shoot code; also the SKU suffix (PAI-<code>) and the filename prefix. */
  code: string;
  category: CategorySeed["slug"];
  name: string;
  ar: string;
  /** Overrides the filename match when one code holds photos of two products. */
  files?: string[];
};

const C = {
  cake: "cake-stands",
  tier: "tiered-stands",
  dallah: "dallahs-carafes",
  vase: "vases-glassware",
  table: "tableware-trays",
} as const;

export const PRODUCTS: ProductSeed[] = [
  { code: "A", category: C.cake, name: "Black Serving Platter on Crystal Cube Base", ar: "صحن تقديم أسود على قاعدة كريستال مكعبة" },
  { code: "A1", category: C.dallah, name: "Gold-Tone Dallah with Clear Handle", ar: "دلة ذهبية اللون بمقبض شفاف" },
  { code: "B", category: C.cake, name: "Black Serving Bowl on Crystal Base", ar: "وعاء تقديم أسود على قاعدة كريستال" },
  { code: "B1", category: C.cake, name: "Glass Dome Cake Stand with Gold-Tone Leaf Handle", ar: "حامل كيك بغطاء قبة زجاجي ومقبض ورقة ذهبي اللون" },
  { code: "B2", category: C.cake, name: "Clear Glass Cake Stand", ar: "حامل كيك زجاجي شفاف" },
  { code: "B3", category: C.cake, name: "Glass Cake Stand with Gold Rim and Dome", ar: "حامل كيك زجاجي بحافة ذهبية وغطاء قبة" },
  { code: "B4", category: C.cake, name: "Gold-Tone Cake Stand with Glass Dome and Leaf Handle", ar: "حامل كيك ذهبي اللون بغطاء زجاجي ومقبض ورقة" },
  { code: "B5", category: C.cake, name: "Cut-Glass Cake Stand on Dark Base", ar: "حامل كيك زجاجي منقوش على قاعدة داكنة" },
  { code: "B6", category: C.tier, name: "Two-Tier Glass Stand with Gold-Tone Pole", ar: "حامل زجاجي بطبقتين بعمود ذهبي اللون" },
  { code: "B7", category: C.cake, name: "Cut-Glass Cake Stand on Black Cone Base", ar: "حامل كيك زجاجي منقوش على قاعدة سوداء مخروطية" },
  { code: "B8", category: C.cake, name: "Gold-Tone Tray Cake Stand with Glass Dome", ar: "حامل كيك بصينية ذهبية اللون وغطاء قبة زجاجي" },
  { code: "C", category: C.tier, name: "Two-Tier Black Stand with Crystal Pole", ar: "حامل أسود بطبقتين بعمود كريستال" },
  { code: "C1", category: C.table, name: "Navy and Silver Patterned Plate Set", ar: "طقم أطباق كحلي بنقوش فضية" },
  { code: "C2", category: C.table, name: "Cream and Gold Scalloped Plate Set", ar: "طقم أطباق كريمي بحواف ذهبية متموجة" },
  { code: "C4", category: C.table, name: "Pair of Black Patterned Cups", ar: "كوبان أسودان بنقوش" },
  { code: "D", category: C.cake, name: "Black Cake Stand with Clear Dome", ar: "حامل كيك أسود بغطاء قبة شفاف" },
  { code: "D1", category: C.vase, name: "Amber Ribbed Glass Vase", ar: "مزهرية زجاجية كهرمانية مضلعة" },
  { code: "E", category: C.dallah, name: "Gold-Tone Cylinder Carafe with Clear Handle", ar: "إبريق أسطواني ذهبي اللون بمقبض شفاف" },
  { code: "E1", category: C.tier, name: "Three-Tier Silver-Tone Stand", ar: "حامل فضي اللون بثلاث طبقات" },
  { code: "E2", category: C.table, name: "Silver-Tone Lidded Bowl with Crystal Knob", ar: "وعاء فضي اللون بغطاء ومقبض كريستال", files: ["E2 (1).png", "E2 (3).png", "E2 (4).png"] },
  { code: "E2S", category: C.tier, name: "Two-Tier Silver-Tone Stand with Scalloped Plates", ar: "حامل فضي اللون بطبقتين بأطباق متموجة", files: ["E2 (2).png", "E2 (5).png"] },
  { code: "E3", category: C.table, name: "Silver-Tone Serving Set with Tray, Pot and Cups", ar: "طقم تقديم فضي اللون بصينية وإبريق وفناجين" },
  { code: "E4", category: C.table, name: "Silver-Tone Serving Tray with Handles", ar: "صينية تقديم فضية اللون بمقبضين" },
  { code: "E5", category: C.dallah, name: "Silver-Tone Dallah", ar: "دلة فضية اللون" },
  { code: "E6", category: C.cake, name: "Silver-Tone Cake Stand on Crystal Base", ar: "حامل كيك فضي اللون على قاعدة كريستال" },
  { code: "E7", category: C.table, name: "Gold-Tone Textured Bowl", ar: "وعاء ذهبي اللون بملمس منقوش" },
  { code: "F", category: C.dallah, name: "Gold-Tone Cylinder Carafe with Clear Handle, Style F", ar: "إبريق أسطواني ذهبي اللون بمقبض شفاف، تصميم F" },
  { code: "G", category: C.dallah, name: "Gold-Tone Carafe with White Handle", ar: "إبريق ذهبي اللون بمقبض أبيض" },
  { code: "G1", category: C.vase, name: "Pair of Double-Wall Glass Cups", ar: "كوبان زجاجيان بجدار مزدوج" },
  { code: "G2", category: C.vase, name: "Pair of Cut-Glass Holders on Gold-Tone Bases", ar: "حاملان زجاجيان منقوشان على قاعدتين ذهبيتي اللون" },
  { code: "G3", category: C.vase, name: "Green Textured Glass Vase", ar: "مزهرية زجاجية خضراء بملمس منقوش" },
  { code: "G4", category: C.vase, name: "Plum Glass Vase", ar: "مزهرية زجاجية بلون البرقوق" },
  { code: "G5", category: C.vase, name: "Plum Teardrop Glass Vase", ar: "مزهرية زجاجية بشكل قطرة بلون البرقوق" },
  { code: "G6", category: C.vase, name: "Grey Glass Bottle Vase", ar: "مزهرية زجاجية رمادية بشكل زجاجة" },
  { code: "G7", category: C.vase, name: "Plum Ribbed Glass Jar Vase", ar: "مزهرية زجاجية مضلعة بلون البرقوق" },
  { code: "H", category: C.dallah, name: "Cone Carafe, Silver-Tone with Gold-Tone Base", ar: "إبريق مخروطي فضي اللون بقاعدة ذهبية اللون" },
  { code: "H1", category: C.dallah, name: "White Carafe with Gold-Tone Handle", ar: "إبريق أبيض بمقبض ذهبي اللون" },
  { code: "H2", category: C.dallah, name: "Beige Carafe with Gold-Tone Handle", ar: "إبريق بيج بمقبض ذهبي اللون" },
  { code: "H3", category: C.dallah, name: "Navy Carafe with Gold-Tone Handle", ar: "إبريق كحلي بمقبض ذهبي اللون" },
  { code: "H4", category: C.dallah, name: "Blue-Grey Carafe with Round Handle", ar: "إبريق رمادي مائل للأزرق بمقبض دائري" },
  { code: "H5", category: C.dallah, name: "Light Grey Carafe with Round Handle", ar: "إبريق رمادي فاتح بمقبض دائري" },
  { code: "H6", category: C.dallah, name: "White Carafe with Round Handle", ar: "إبريق أبيض بمقبض دائري" },
  { code: "H7", category: C.dallah, name: "White Ribbed Carafe", ar: "إبريق أبيض مضلع" },
  { code: "H8", category: C.dallah, name: "Cream and Beige Ribbed Carafe", ar: "إبريق مضلع كريمي وبيج" },
  { code: "H9", category: C.dallah, name: "Black Ribbed Carafe", ar: "إبريق أسود مضلع" },
  { code: "H10", category: C.dallah, name: "Olive Ribbed Carafe", ar: "إبريق زيتي مضلع" },
  { code: "H11", category: C.dallah, name: "Grey Ribbed Carafe", ar: "إبريق رمادي مضلع" },
  { code: "H12", category: C.dallah, name: "Blush Ribbed Carafe", ar: "إبريق مضلع بلون وردي فاتح" },
  { code: "I", category: C.dallah, name: "Cone Carafe, Silver-Tone with Gold-Tone Base, Style I", ar: "إبريق مخروطي فضي اللون بقاعدة ذهبية اللون، تصميم I" },
  { code: "J", category: C.dallah, name: "Silver-Tone Carafe with Gold-Tone Spout and Handle", ar: "إبريق فضي اللون بفوهة ومقبض ذهبيي اللون" },
  { code: "J1", category: C.tier, name: "Two-Tier Black Stand with Crystal Pole and Finial", ar: "حامل أسود بطبقتين بعمود كريستال وقمة مزخرفة" },
  { code: "J2", category: C.tier, name: "Two-Tier Black Stand with Crescent Finial", ar: "حامل أسود بطبقتين بقمة هلال" },
  { code: "J3", category: C.cake, name: "Black Cake Stand on Crystal Base", ar: "حامل كيك أسود على قاعدة كريستال" },
  { code: "K", category: C.dallah, name: "Silver-Tone Carafe with Gold-Tone Neck and Handle", ar: "إبريق فضي اللون بعنق ومقبض ذهبيي اللون" },
  { code: "L", category: C.cake, name: "Silver-Tone Cake Stand with Glass Dome", ar: "حامل كيك فضي اللون بغطاء قبة زجاجي" },
  { code: "M", category: C.tier, name: "Two-Tier Cut-Glass Stand with Gold-Tone Pole", ar: "حامل زجاجي منقوش بطبقتين بعمود ذهبي اللون" },
  { code: "N", category: C.cake, name: "Glass Flower Cake Stand on Gold-Tone Base", ar: "حامل كيك زجاجي بشكل زهرة على قاعدة ذهبية اللون" },
  { code: "O", category: C.cake, name: "Clear Glass Footed Bowl", ar: "وعاء زجاجي شفاف بقاعدة" },
  { code: "P", category: C.cake, name: "Cut-Glass Cake Stand on Gold-Tone Cone Base", ar: "حامل كيك زجاجي منقوش على قاعدة مخروطية ذهبية اللون" },
  { code: "Q", category: C.table, name: "Black Square Tray with Gold-Tone Flower", ar: "صينية سوداء مربعة بزهرة ذهبية اللون" },
  { code: "R", category: C.vase, name: "Amber Textured Glass Vase", ar: "مزهرية زجاجية كهرمانية بملمس منقوش" },
  { code: "S", category: C.dallah, name: "Gold-Tone Dallah with Clear Handle, Style S", ar: "دلة ذهبية اللون بمقبض شفاف، تصميم S" },
];

/** Not products: the Paisley art logo files in the same folder. */
export const NOT_PRODUCTS = ["Paisley 1-01.png", "Paisley Silver-01.png"];
