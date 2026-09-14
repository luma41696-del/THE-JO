/**
 * Demo catalogue.
 *
 * The storefront renders from this the moment `npm run dev` starts, before a
 * single Firestore document exists. `src/lib/catalog.ts` prefers live data and
 * falls back here, so the design is never blocked on the backend — and the
 * seed script (`npm run seed`) pushes exactly this shape into Firestore.
 *
 * Imagery is generated SVG in `/public/demo`, so the repo has no external
 * image dependency and no licensing question.
 */

import type {
  Banner,
  Category,
  Offer,
  Product,
  ProductColor,
  ProductSize,
  ShippingMethod,
  Testimonial,
} from "@/types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 0, 15);

/* -------------------------------------------------------------------------- */
/*  Shared option sets                                                        */
/* -------------------------------------------------------------------------- */

const COLORS: Record<string, ProductColor> = {
  ink: { id: "ink", name: { en: "Ink", ar: "حبري" }, hex: "#1B1717" },
  bone: { id: "bone", name: { en: "Bone", ar: "عاجي" }, hex: "#EFE9DE" },
  crimson: { id: "crimson", name: { en: "Signature Red", ar: "أحمر التوقيع" }, hex: "#CE1212" },
  sand: { id: "sand", name: { en: "Sand", ar: "رملي" }, hex: "#D9CFC0" },
  clay: { id: "clay", name: { en: "Clay", ar: "طيني" }, hex: "#C8A68A" },
  sage: { id: "sage", name: { en: "Sage", ar: "مريمية" }, hex: "#A8B8AC" },
  slate: { id: "slate", name: { en: "Slate", ar: "إردوازي" }, hex: "#4A4A55" },
};

const ALPHA: ProductSize[] = [
  { id: "xs", label: "XS", system: "alpha", measurements: { chest: 84, waist: 66, hip: 90 } },
  { id: "s", label: "S", system: "alpha", measurements: { chest: 90, waist: 72, hip: 96 } },
  { id: "m", label: "M", system: "alpha", measurements: { chest: 96, waist: 78, hip: 102 } },
  { id: "l", label: "L", system: "alpha", measurements: { chest: 104, waist: 86, hip: 110 } },
  { id: "xl", label: "XL", system: "alpha", measurements: { chest: 112, waist: 94, hip: 118 } },
];

const WAIST: ProductSize[] = [
  { id: "w26", label: "26", system: "waist", measurements: { waist: 66, hip: 92, length: 104 } },
  { id: "w28", label: "28", system: "waist", measurements: { waist: 71, hip: 97, length: 105 } },
  { id: "w30", label: "30", system: "waist", measurements: { waist: 76, hip: 102, length: 106 } },
  { id: "w32", label: "32", system: "waist", measurements: { waist: 81, hip: 107, length: 107 } },
  { id: "w34", label: "34", system: "waist", measurements: { waist: 86, hip: 112, length: 108 } },
];

const SHOE: ProductSize[] = [
  { id: "eu38", label: "38", system: "shoe" },
  { id: "eu39", label: "39", system: "shoe" },
  { id: "eu40", label: "40", system: "shoe" },
  { id: "eu41", label: "41", system: "shoe" },
  { id: "eu42", label: "42", system: "shoe" },
  { id: "eu43", label: "43", system: "shoe" },
];

const ONE: ProductSize[] = [{ id: "os", label: "One size", system: "one-size" }];

/* -------------------------------------------------------------------------- */
/*  Categories                                                                */
/* -------------------------------------------------------------------------- */

export const demoCategories: Category[] = [
  {
    id: "outerwear",
    slug: "outerwear",
    name: { en: "Outerwear", ar: "معاطف" },
    description: {
      en: "Structure that holds its line from the first wear to the fiftieth.",
      ar: "قَصّات محكمة تحافظ على هيئتها من أول ارتداء وحتى الخمسين.",
    },
    parentId: null,
    order: 1,
    productCount: 2,
    featured: true,
    image: { url: "/demo/category-outerwear.svg", alt: "Outerwear", width: 400, height: 520 },
  },
  {
    id: "dresses",
    slug: "dresses",
    name: { en: "Dresses", ar: "فساتين" },
    description: {
      en: "One decision, fully made. Nothing else required.",
      ar: "قرار واحد مكتمل. لا يحتاج إلى شيء آخر.",
    },
    parentId: null,
    order: 2,
    productCount: 2,
    featured: true,
    image: { url: "/demo/category-dresses.svg", alt: "Dresses", width: 400, height: 520 },
  },
  {
    id: "knitwear",
    slug: "knitwear",
    name: { en: "Knitwear", ar: "تريكو" },
    description: {
      en: "The weightless layer the rest of the wardrobe is built around.",
      ar: "الطبقة الخفيفة التي تُبنى حولها بقية الخزانة.",
    },
    parentId: null,
    order: 3,
    productCount: 2,
    featured: true,
    image: { url: "/demo/category-knitwear.svg", alt: "Knitwear", width: 400, height: 520 },
  },
  {
    id: "trousers",
    slug: "trousers",
    name: { en: "Trousers", ar: "بناطيل" },
    description: {
      en: "Drape engineered from the waistband down.",
      ar: "انسدال مدروس من الخصر إلى الأسفل.",
    },
    parentId: null,
    order: 4,
    productCount: 2,
    featured: true,
    image: { url: "/demo/category-trousers.svg", alt: "Trousers", width: 400, height: 520 },
  },
  {
    id: "bags",
    slug: "bags",
    name: { en: "Bags", ar: "حقائب" },
    description: {
      en: "Quiet hardware. Leather chosen to age, not to shine.",
      ar: "تفاصيل هادئة. جلد يزداد جمالاً مع الوقت.",
    },
    parentId: null,
    order: 5,
    productCount: 2,
    featured: true,
    image: { url: "/demo/category-bags.svg", alt: "Bags", width: 400, height: 520 },
  },
  {
    id: "footwear",
    slug: "footwear",
    name: { en: "Footwear", ar: "أحذية" },
    description: {
      en: "Low profiles, hand-finished soles.",
      ar: "تصاميم منخفضة ونعال مُنهاة يدوياً.",
    },
    parentId: null,
    order: 6,
    productCount: 2,
    featured: true,
    image: { url: "/demo/category-footwear.svg", alt: "Footwear", width: 400, height: 520 },
  },
];

/* -------------------------------------------------------------------------- */
/*  Products                                                                  */
/* -------------------------------------------------------------------------- */

type Seed = {
  slug: string;
  titleEn: string;
  titleAr: string;
  subEn: string;
  subAr: string;
  descEn: string;
  descAr: string;
  categoryId: string;
  price: number;
  compareAt?: number;
  colors: string[];
  sizes: ProductSize[];
  badges: Product["badges"];
  fit: NonNullable<Product["fit"]>;
  rating: [number, number];
  collections: string[];
  tags: string[];
  daysAgo: number;
  details: { en: [string, string]; ar: [string, string] }[];
};

const SEEDS: Seed[] = [
  {
    slug: "atelier-wool-coat",
    titleEn: "Atelier Wool Coat",
    titleAr: "معطف أتلييه الصوف",
    subEn: "Double-faced Italian wool",
    subAr: "صوف إيطالي مزدوج الوجه",
    descEn:
      "Cut from a double-faced wool that needs no lining, so the coat keeps its weight without its bulk. The shoulder is built by hand and the hem falls just past the knee — long enough to read as formal, short enough to wear over denim.",
    descAr:
      "مصنوع من صوف مزدوج الوجه لا يحتاج إلى بطانة، فيحتفظ المعطف بثقله دون ضخامة. الكتف مُشكَّل يدوياً، والطول يتجاوز الركبة قليلاً.",
    categoryId: "outerwear",
    price: 349,
    compareAt: 449,
    colors: ["ink", "sand", "crimson"],
    sizes: ALPHA,
    badges: ["bestseller", "limited"],
    fit: { scale: 0, silhouette: "relaxed", stretch: "none", modelHeightCm: 178, modelWearsSizeId: "s" },
    rating: [4.8, 214],
    collections: ["winter-atelier"],
    tags: ["wool", "coat", "outerwear", "investment"],
    daysAgo: 40,
    details: [
      { en: ["Composition", "88% virgin wool, 12% cashmere"], ar: ["التركيب", "٨٨٪ صوف بكر، ١٢٪ كشمير"] },
      { en: ["Care", "Dry clean only"], ar: ["العناية", "تنظيف جاف فقط"] },
      { en: ["Made in", "Biella, Italy"], ar: ["بلد الصنع", "بييلا، إيطاليا"] },
    ],
  },
  {
    slug: "sculpted-shoulder-blazer",
    titleEn: "Sculpted Shoulder Blazer",
    titleAr: "بليزر بكتف منحوت",
    subEn: "Single-breasted, half-canvassed",
    subAr: "صدر مفرد بقَصّة نصف مبطّنة",
    descEn:
      "A half-canvassed chest lets the blazer mould to you over the first few wears instead of fighting you. Sleeve heads are set slightly forward, which is what keeps the line clean when your arms are down.",
    descAr:
      "الصدر نصف المبطّن يجعل البليزر يتشكّل على قوامك بعد أول مرات الارتداء. رؤوس الأكمام مائلة قليلاً للأمام للحفاظ على الخط نظيفاً.",
    categoryId: "outerwear",
    price: 239,
    colors: ["ink", "bone", "slate"],
    sizes: ALPHA,
    badges: ["new"],
    fit: { scale: -1, silhouette: "slim", stretch: "slight", modelHeightCm: 180, modelWearsSizeId: "m" },
    rating: [4.6, 88],
    collections: ["winter-atelier", "workwear"],
    tags: ["blazer", "tailoring", "workwear"],
    daysAgo: 6,
    details: [
      { en: ["Composition", "Wool-silk blend"], ar: ["التركيب", "مزيج صوف وحرير"] },
      { en: ["Lining", "Cupro, half-lined"], ar: ["البطانة", "كوبرو، نصف مبطّن"] },
      { en: ["Care", "Dry clean"], ar: ["العناية", "تنظيف جاف"] },
    ],
  },
  {
    slug: "liquid-silk-slip-dress",
    titleEn: "Liquid Silk Slip Dress",
    titleAr: "فستان حرير سائل",
    subEn: "Bias-cut sand-washed silk",
    subAr: "حرير مغسول مقصوص بشكل مائل",
    descEn:
      "Cut on the bias so the silk moves with you rather than hanging off you. Sand-washing takes the shine down to a matte glow — the difference between evening wear and eveningwear that photographs well.",
    descAr:
      "مقصوص بشكل مائل ليتحرك الحرير معكِ لا أن ينسدل فحسب. الغسل الرملي يخفّف اللمعان إلى وهج مطفي.",
    categoryId: "dresses",
    price: 179,
    compareAt: 225,
    colors: ["ink", "clay", "sage"],
    sizes: ALPHA,
    badges: ["bestseller"],
    fit: { scale: 0, silhouette: "slim", stretch: "slight", modelHeightCm: 176, modelWearsSizeId: "s" },
    rating: [4.9, 341],
    collections: ["evening"],
    tags: ["silk", "dress", "evening", "bias"],
    daysAgo: 28,
    details: [
      { en: ["Composition", "100% mulberry silk, 19mm"], ar: ["التركيب", "١٠٠٪ حرير توتي، ١٩ مم"] },
      { en: ["Care", "Hand wash cold, line dry"], ar: ["العناية", "غسل يدوي بارد"] },
      { en: ["Made in", "Como, Italy"], ar: ["بلد الصنع", "كومو، إيطاليا"] },
    ],
  },
  {
    slug: "column-knit-dress",
    titleEn: "Column Knit Dress",
    titleAr: "فستان تريكو عمودي",
    subEn: "Seamless merino column",
    subAr: "ميرينو بلا خياطات",
    descEn:
      "Knitted in one piece with no side seams, which is why it holds a column silhouette instead of pulling at the hip. Merino regulates temperature, so it works under a coat and on its own.",
    descAr:
      "منسوج بقطعة واحدة بلا خياطات جانبية، فيحافظ على القَصّة العمودية. صوف الميرينو ينظّم الحرارة.",
    categoryId: "dresses",
    price: 139,
    colors: ["bone", "ink", "sand"],
    sizes: ALPHA,
    badges: ["restocked"],
    fit: { scale: 0, silhouette: "regular", stretch: "high", modelHeightCm: 174, modelWearsSizeId: "m" },
    rating: [4.7, 156],
    collections: ["essentials"],
    tags: ["knit", "merino", "dress"],
    daysAgo: 15,
    details: [
      { en: ["Composition", "100% extra-fine merino"], ar: ["التركيب", "١٠٠٪ ميرينو فائق النعومة"] },
      { en: ["Care", "Machine wash wool cycle"], ar: ["العناية", "غسالة، دورة الصوف"] },
    ],
  },
  {
    slug: "featherweight-cashmere-tee",
    titleEn: "Featherweight Cashmere Tee",
    titleAr: "تي شيرت كشمير خفيف",
    subEn: "Grade-A Mongolian cashmere",
    subAr: "كشمير منغولي درجة أولى",
    descEn:
      "Fourteen-gauge cashmere, which is light enough to wear as a t-shirt and dense enough not to pill in the first season. The neckline is bound rather than ribbed so it stays flat.",
    descAr:
      "كشمير بمقياس ١٤، خفيف كالتي شيرت وكثيف بما يكفي لئلا يتكوّر في الموسم الأول. فتحة الرقبة مُحاكة لتبقى مسطحة.",
    categoryId: "knitwear",
    price: 89,
    colors: ["bone", "ink", "crimson", "sage"],
    sizes: ALPHA,
    badges: ["bestseller", "exclusive"],
    fit: { scale: 0, silhouette: "regular", stretch: "moderate", modelHeightCm: 178, modelWearsSizeId: "m" },
    rating: [4.9, 502],
    collections: ["essentials"],
    tags: ["cashmere", "knit", "essential"],
    daysAgo: 60,
    details: [
      { en: ["Composition", "100% cashmere, 14gg"], ar: ["التركيب", "١٠٠٪ كشمير، ١٤ جيج"] },
      { en: ["Care", "Hand wash, dry flat"], ar: ["العناية", "غسل يدوي، تجفيف مسطح"] },
    ],
  },
  {
    slug: "boxy-cotton-tee",
    titleEn: "Boxy Cotton Tee",
    titleAr: "تي شيرت قطن واسع",
    subEn: "Compact-spun Supima",
    subAr: "قطن سوبيما مضغوط الغزل",
    descEn:
      "Compact-spun Supima holds a crisp edge through the wash, so a boxy cut stays boxy instead of collapsing into a rectangle. Shoulder seam sits just past the joint.",
    descAr:
      "قطن سوبيما مضغوط الغزل يحافظ على حوافه بعد الغسل، فتبقى القَصّة الواسعة محافظة على شكلها.",
    categoryId: "knitwear",
    price: 35,
    compareAt: 45,
    colors: ["bone", "ink", "sand", "crimson"],
    sizes: ALPHA,
    badges: ["new"],
    fit: { scale: 1, silhouette: "oversized", stretch: "slight", modelHeightCm: 182, modelWearsSizeId: "s" },
    rating: [4.5, 197],
    collections: ["essentials", "summer-drop"],
    tags: ["cotton", "tee", "essential"],
    daysAgo: 3,
    details: [
      { en: ["Composition", "100% Supima cotton, 240gsm"], ar: ["التركيب", "١٠٠٪ قطن سوبيما، ٢٤٠ غم/م٢"] },
      { en: ["Care", "Machine wash 30°"], ar: ["العناية", "غسالة ٣٠°"] },
    ],
  },
  {
    slug: "wide-leg-trouser",
    titleEn: "Wide Leg Trouser",
    titleAr: "بنطال واسع الساق",
    subEn: "High-rise, pressed crease",
    subAr: "خصر عالٍ بكسرة مكوية",
    descEn:
      "A permanent pressed crease runs the full length, which is what stops a wide leg from reading as sloppy. High rise sits at the natural waist; the hem is cut to break once over a heel.",
    descAr:
      "كسرة دائمة تمتد بطول الساق، وهي ما يمنع الساق الواسعة من أن تبدو غير مرتبة. الخصر العالي يستقر عند الخصر الطبيعي.",
    categoryId: "trousers",
    price: 105,
    colors: ["ink", "sand", "slate"],
    sizes: WAIST,
    badges: ["bestseller"],
    fit: { scale: 0, silhouette: "relaxed", stretch: "slight", modelHeightCm: 176, modelWearsSizeId: "w28" },
    rating: [4.7, 263],
    collections: ["workwear"],
    tags: ["trouser", "tailoring", "wide-leg"],
    daysAgo: 34,
    details: [
      { en: ["Composition", "Wool crepe"], ar: ["التركيب", "كريب صوفي"] },
      { en: ["Rise", "High, 30cm"], ar: ["ارتفاع الخصر", "عالٍ، ٣٠ سم"] },
      { en: ["Care", "Dry clean"], ar: ["العناية", "تنظيف جاف"] },
    ],
  },
  {
    slug: "tapered-crepe-trouser",
    titleEn: "Tapered Crepe Trouser",
    titleAr: "بنطال كريب مستدق",
    subEn: "Elasticated back waist",
    subAr: "خصر خلفي مطاطي",
    descEn:
      "Flat at the front, elasticated at the back — tailored from the outside, forgiving from the inside. The taper starts below the knee so it never pulls across the thigh.",
    descAr:
      "مسطح من الأمام ومطاطي من الخلف: مُفصّل من الخارج ومريح من الداخل. الاستدقاق يبدأ تحت الركبة.",
    categoryId: "trousers",
    price: 79,
    colors: ["ink", "sage", "clay"],
    sizes: WAIST,
    badges: ["last-pieces"],
    fit: { scale: 0, silhouette: "slim", stretch: "moderate", modelHeightCm: 175, modelWearsSizeId: "w30" },
    rating: [4.4, 71],
    collections: ["workwear", "essentials"],
    tags: ["trouser", "crepe", "comfort"],
    daysAgo: 22,
    details: [
      { en: ["Composition", "Triacetate crepe"], ar: ["التركيب", "كريب تراي أسيتات"] },
      { en: ["Care", "Machine wash cold"], ar: ["العناية", "غسالة بماء بارد"] },
    ],
  },
  {
    slug: "structured-leather-tote",
    titleEn: "Structured Leather Tote",
    titleAr: "حقيبة جلدية مهيكلة",
    subEn: "Vegetable-tanned, unlined",
    subAr: "مدبوغة نباتياً وبلا بطانة",
    descEn:
      "Vegetable-tanned and left unlined so the leather darkens with use instead of cracking. Holds a 14-inch laptop flat; the base is a single piece with no seam to split.",
    descAr:
      "مدبوغة نباتياً وبلا بطانة، فيغمق الجلد مع الاستخدام بدل أن يتشقق. تتسع لحاسوب ١٤ بوصة.",
    categoryId: "bags",
    price: 215,
    colors: ["clay", "ink", "sand"],
    sizes: ONE,
    badges: ["exclusive"],
    fit: { scale: 0, silhouette: "regular", stretch: "none" },
    rating: [4.8, 129],
    collections: ["essentials"],
    tags: ["leather", "tote", "bag"],
    daysAgo: 48,
    details: [
      { en: ["Material", "Vegetable-tanned calf"], ar: ["الخامة", "جلد عجل مدبوغ نباتياً"] },
      { en: ["Dimensions", "36 × 28 × 12 cm"], ar: ["الأبعاد", "٣٦ × ٢٨ × ١٢ سم"] },
    ],
  },
  {
    slug: "mini-crescent-bag",
    titleEn: "Mini Crescent Bag",
    titleAr: "حقيبة الهلال الصغيرة",
    subEn: "Curved shoulder silhouette",
    subAr: "قَصّة كتف منحنية",
    descEn:
      "The crescent sits flush against the body rather than swinging, which is the whole point of the curve. Magnetic closure, one interior card slot, nothing else.",
    descAr:
      "الشكل الهلالي يستقر ملاصقاً للجسم بدل أن يتأرجح. إغلاق مغناطيسي وجيب بطاقة واحد، لا أكثر.",
    categoryId: "bags",
    price: 129,
    compareAt: 165,
    colors: ["crimson", "ink", "bone"],
    sizes: ONE,
    badges: ["new", "limited"],
    fit: { scale: 0, silhouette: "regular", stretch: "none" },
    rating: [4.6, 84],
    collections: ["evening", "summer-drop"],
    tags: ["leather", "mini", "bag", "evening"],
    daysAgo: 2,
    details: [
      { en: ["Material", "Nappa leather"], ar: ["الخامة", "جلد نابا"] },
      { en: ["Dimensions", "24 × 13 × 6 cm"], ar: ["الأبعاد", "٢٤ × ١٣ × ٦ سم"] },
    ],
  },
  {
    slug: "low-profile-court-sneaker",
    titleEn: "Low Profile Court Sneaker",
    titleAr: "حذاء كورت منخفض",
    subEn: "Full-grain, Margom sole",
    subAr: "جلد كامل الحبيبات بنعل مارغوم",
    descEn:
      "Full-grain uppers on a Margom sole — the low, slightly gummed profile that stays quiet under a trouser. Sized true; if you are between, take the smaller.",
    descAr:
      "جلد كامل الحبيبات على نعل مارغوم منخفض. المقاس مطابق؛ وإن كنت بين مقاسين فاختر الأصغر.",
    categoryId: "footwear",
    price: 115,
    colors: ["bone", "ink"],
    sizes: SHOE,
    badges: ["bestseller"],
    fit: { scale: 0, silhouette: "regular", stretch: "none" },
    rating: [4.7, 318],
    collections: ["essentials"],
    tags: ["sneaker", "leather", "footwear"],
    daysAgo: 52,
    details: [
      { en: ["Upper", "Full-grain calf leather"], ar: ["الوجه", "جلد عجل كامل الحبيبات"] },
      { en: ["Sole", "Margom rubber"], ar: ["النعل", "مطاط مارغوم"] },
      { en: ["Made in", "Italy"], ar: ["بلد الصنع", "إيطاليا"] },
    ],
  },
  {
    slug: "suede-runner",
    titleEn: "Suede Runner",
    titleAr: "حذاء رياضي من الشمواه",
    subEn: "Water-repellent suede",
    subAr: "شمواه طارد للماء",
    descEn:
      "Suede treated at the fibre rather than sprayed on top, so the repellency survives cleaning. A 6mm drop makes it genuinely walkable, not just styled that way.",
    descAr:
      "شمواه مُعالج من الألياف لا بالرش السطحي، فتبقى مقاومته للماء بعد التنظيف. فارق ٦ مم يجعله مريحاً للمشي فعلاً.",
    categoryId: "footwear",
    price: 99,
    colors: ["sand", "slate", "crimson"],
    sizes: SHOE,
    badges: ["new"],
    fit: { scale: 0, silhouette: "regular", stretch: "none" },
    rating: [4.5, 96],
    collections: ["summer-drop"],
    tags: ["sneaker", "suede", "footwear"],
    daysAgo: 9,
    details: [
      { en: ["Upper", "Hydrophobic suede"], ar: ["الوجه", "شمواه طارد للماء"] },
      { en: ["Drop", "6mm"], ar: ["الفارق", "٦ مم"] },
    ],
  },
];

function buildProduct(seed: Seed): Product {
  const colors = seed.colors.map((c) => COLORS[c]).filter((c): c is ProductColor => Boolean(c));
  const firstSize = seed.sizes[0];

  return {
    id: seed.slug,
    slug: seed.slug,
    title: { en: seed.titleEn, ar: seed.titleAr },
    subtitle: { en: seed.subEn, ar: seed.subAr },
    description: { en: seed.descEn, ar: seed.descAr },
    details: seed.details.map((d) => ({
      label: { en: d.en[0], ar: d.ar[0] },
      value: { en: d.en[1], ar: d.ar[1] },
    })),
    categoryId: seed.categoryId,
    categoryPath: [seed.categoryId],
    collectionIds: seed.collections,
    tags: seed.tags,
    price: seed.price,
    compareAtPrice: seed.compareAt,
    currency: "JOD",
    images: [
      {
        url: `/demo/${seed.slug}-1.svg`,
        alt: `${seed.titleEn} — front view`,
        width: 400,
        height: 520,
      },
      {
        url: `/demo/${seed.slug}-2.svg`,
        alt: `${seed.titleEn} — alternate view`,
        width: 400,
        height: 520,
      },
    ],
    colors,
    sizes: seed.sizes,
    sizeSystem: firstSize ? firstSize.system : "one-size",
    inStock: true,
    totalStock: seed.badges.includes("last-pieces") ? 4 : 48,
    badges: seed.badges,
    rating: { average: seed.rating[0], count: seed.rating[1] },
    fit: seed.fit,
    status: "active",
    publishedAt: NOW - seed.daysAgo * DAY,
    updatedAt: NOW - seed.daysAgo * DAY,
  };
}

export const demoProducts: Product[] = SEEDS.map(buildProduct);

/* -------------------------------------------------------------------------- */
/*  Merchandising                                                             */
/* -------------------------------------------------------------------------- */

export const demoBanners: Banner[] = [
  {
    id: "hero-winter",
    slot: "hero",
    tone: "ink",
    eyebrow: { en: "Winter Atelier 01", ar: "أتلييه الشتاء ٠١" },
    title: { en: "Built to be worn\nfor a decade", ar: "مصنوعة\nلتُرتدى عقداً" },
    body: {
      en: "Twelve pieces. Italian mills. Nothing in the collection exists to fill a gap on a rail.",
      ar: "اثنتا عشرة قطعة من مصانع إيطالية. لا قطعة هنا وُجدت لملء فراغ على الرف.",
    },
    cta: { label: { en: "Shop the collection", ar: "تسوّق المجموعة" }, href: "/shop?collection=winter-atelier" },
    media: { url: "/demo/campaign-atelier.svg", alt: "Winter Atelier campaign", width: 900, height: 640 },
    priority: 100,
    active: true,
  },
  {
    id: "promo-private-sale",
    slot: "promo-rail",
    tone: "brand",
    eyebrow: { en: "Members only", ar: "للأعضاء فقط" },
    title: { en: "Private sale\n−25% sitewide", ar: "تخفيض خاص\n−٢٥٪ على الموقع" },
    body: { en: "Ends Sunday at midnight.", ar: "ينتهي الأحد منتصف الليل." },
    cta: { label: { en: "Unlock offer", ar: "افتح العرض" }, href: "/shop?offer=private25" },
    media: { url: "/demo/campaign-red.svg", alt: "Private sale", width: 900, height: 640 },
    endsAt: NOW + 4 * DAY,
    priority: 90,
    span: 2,
    active: true,
  },
  {
    id: "promo-new-drop",
    slot: "promo-rail",
    tone: "sand",
    eyebrow: { en: "Just landed", ar: "وصل حديثاً" },
    title: { en: "The Crescent, in red", ar: "الهلال، بالأحمر" },
    body: { en: "120 pieces worldwide.", ar: "١٢٠ قطعة حول العالم." },
    cta: { label: { en: "See the drop", ar: "شاهد الإصدار" }, href: "/product/mini-crescent-bag" },
    media: { url: "/demo/campaign-sand.svg", alt: "Mini Crescent Bag launch", width: 900, height: 640 },
    priority: 80,
    span: 1,
    active: true,
  },
  {
    id: "promo-fitting-room",
    slot: "promo-rail",
    tone: "paper",
    eyebrow: { en: "New feature", ar: "ميزة جديدة" },
    title: { en: "Try it on\nbefore it ships", ar: "جرّبها\nقبل أن تُشحن" },
    body: { en: "Build a look, get your size, skip the returns.", ar: "كوّني إطلالتك، واعرفي مقاسك، وتجنّبي الإرجاع." },
    cta: { label: { en: "Enter the fitting room", ar: "ادخل غرفة القياس" }, href: "/fitting-room" },
    media: { url: "/demo/campaign-bone.svg", alt: "AI fitting room", width: 900, height: 640 },
    priority: 70,
    span: 1,
    active: true,
  },
  {
    id: "promo-bestsellers",
    slot: "spotlight",
    tone: "ink",
    eyebrow: { en: "Most wanted", ar: "الأكثر طلباً" },
    title: { en: "The cashmere tee,\nrestocked", ar: "تي شيرت الكشمير\nعاد للمخزون" },
    body: { en: "Sold out four times. Back in every colourway.", ar: "نفد أربع مرات. عاد بكل الألوان." },
    cta: { label: { en: "Shop now", ar: "تسوّق الآن" }, href: "/product/featherweight-cashmere-tee" },
    media: { url: "/demo/campaign-ink.svg", alt: "Cashmere tee restock", width: 900, height: 640 },
    priority: 60,
    active: true,
  },
  {
    id: "announcement-shipping",
    slot: "announcement",
    tone: "ink",
    title: {
      en: "Complimentary express shipping over 75 JOD · 30-day returns",
      ar: "توصيل سريع مجاني للطلبات فوق ٧٥ ديناراً · إرجاع خلال ٣٠ يوماً",
    },
    priority: 10,
    active: true,
  },
];

export const demoOffers: Offer[] = [
  {
    id: "private25",
    code: "PRIVATE25",
    type: "percentage",
    value: 25,
    title: { en: "Private sale — 25% off", ar: "تخفيض خاص — ٢٥٪" },
    description: { en: "Members only. Excludes final sale.", ar: "للأعضاء فقط. لا يشمل التصفية النهائية." },
    minSubtotal: 0,
    appliesToCategoryIds: [],
    appliesToProductIds: [],
    startsAt: NOW - 2 * DAY,
    endsAt: NOW + 4 * DAY,
    usageLimit: 5000,
    usageCount: 1842,
    perUserLimit: 1,
    active: true,
  },
  {
    id: "welcome10",
    code: "WELCOME10",
    type: "percentage",
    value: 10,
    title: { en: "10% off your first order", ar: "١٠٪ على طلبك الأول" },
    minSubtotal: 40,
    appliesToCategoryIds: [],
    appliesToProductIds: [],
    startsAt: NOW - 90 * DAY,
    endsAt: NOW + 365 * DAY,
    usageCount: 9120,
    perUserLimit: 1,
    active: true,
  },
];

export const demoShippingMethods: ShippingMethod[] = [
  {
    id: "standard",
    speed: "standard",
    name: { en: "Standard", ar: "عادي" },
    description: { en: "Tracked, signature on delivery", ar: "متتبَّع مع توقيع عند الاستلام" },
    price: 3.5,
    minDays: 3,
    maxDays: 5,
    freeAbove: 75,
  },
  {
    id: "express",
    speed: "express",
    name: { en: "Express", ar: "سريع" },
    description: { en: "Next business day in major cities", ar: "يوم العمل التالي في المدن الرئيسية" },
    price: 7,
    minDays: 1,
    maxDays: 2,
    freeAbove: 200,
  },
  {
    id: "same-day",
    speed: "same-day",
    name: { en: "Same day", ar: "نفس اليوم" },
    description: { en: "Order before 13:00, Amman & Zarqa", ar: "اطلب قبل ١:٠٠ ظهراً، عمّان والزرقاء" },
    price: 12,
    minDays: 0,
    maxDays: 0,
  },
  {
    id: "pickup",
    speed: "pickup",
    name: { en: "Boutique pickup", ar: "استلام من المتجر" },
    description: { en: "Ready in 2 hours", ar: "جاهز خلال ساعتين" },
    price: 0,
    minDays: 0,
    maxDays: 0,
  },
];

export const demoTestimonials: Testimonial[] = [
  {
    id: "t1",
    name: "Lina H.",
    quote: {
      en: "The fitting room put me in a size I would never have picked. It fits better than anything else I own.",
      ar: "غرفة القياس اقترحت عليّ مقاساً ما كنت لأختاره، وجاء أفضل من كل ما أملك.",
    },
    rating: 5,
    productId: "column-knit-dress",
    verified: true,
  },
  {
    id: "t2",
    name: "Omar K.",
    quote: {
      en: "Ordered Thursday night, wore it Friday. The coat is heavier than it looks online, in the good way.",
      ar: "طلبته ليلة الخميس وارتديته الجمعة. المعطف أثقل مما يبدو في الصور، وهذا في صالحه.",
    },
    rating: 5,
    productId: "atelier-wool-coat",
    verified: true,
  },
  {
    id: "t3",
    name: "Dana S.",
    quote: {
      en: "Third cashmere tee. They have not pilled, which is more than I can say for ones at twice the price.",
      ar: "ثالث تي شيرت كشمير أشتريه. لم يتكوّر أي منها، وهذا أكثر مما أقوله عن قطع بضعف السعر.",
    },
    rating: 5,
    productId: "featherweight-cashmere-tee",
    verified: true,
  },
  {
    id: "t4",
    name: "Yara A.",
    quote: {
      en: "Returns took four minutes and the refund was back before the courier had even scanned it in.",
      ar: "استغرق الإرجاع أربع دقائق، ووصل المبلغ قبل أن يمسح الناقل الطرد أصلاً.",
    },
    rating: 4,
    verified: true,
  },
];
