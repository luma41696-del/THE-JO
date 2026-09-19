/**
 * Store settings and policy documents.
 *
 * Two jobs in one module, because they are the same problem: facts about the
 * shop that were previously hard-coded into components, where they drifted.
 *
 * The delivery threshold is the clearest case. "Free express delivery over 75
 * JOD" was written into the product page, the announcement bar and the trust
 * list as three separate strings, while the actual number lived on the
 * shipping method. Change the rate and two of the three become a promise the
 * checkout does not keep. `storeSettings.freeShippingThreshold` is now the one
 * number, and every sentence is composed from it.
 *
 * Policies live here rather than in a CMS for now, but are shaped as data — a
 * list of headed sections, bilingual — so moving them into Firestore later is
 * a loader change and not a rewrite of nine pages.
 */

import type { Localized } from "@/types";

/* -------------------------------------------------------------------------- */
/*  Settings                                                                  */
/* -------------------------------------------------------------------------- */

export interface StoreSettings {
  /** Subtotal at or above which standard delivery is free. */
  freeShippingThreshold: number;
  /** Days a customer has to start a return. */
  returnWindowDays: number;
  /** Business days for standard delivery, inside Amman. */
  standardDeliveryDays: [number, number];
  /**
   * At or below this many units, a variant is flagged in the admin.
   *
   * Per variant, never against `totalStock` — a coat showing 40 in stock can
   * be entirely large and extra-large while every middle size is gone.
   */
  lowStockThreshold: number;
  contact: {
    email: string;
    phone: string;
    whatsapp?: string;
    /** Local hours, plain language. */
    hours: Localized;
    address: Localized;
  };
  social: { label: string; href: string }[];
  /** Registered trading details, for the invoice footer and the terms page. */
  legal: {
    tradingName: string;
    country: Localized;
  };
}

/**
 * The store's real numbers.
 *
 * Deliberately conservative: nothing here claims a capability the shop has not
 * actually got. Card payment is absent because no gateway is connected, and
 * the delivery window is the one the couriers quote rather than the one that
 * sounds best.
 */
export const storeSettings: StoreSettings = {
  freeShippingThreshold: 75,
  returnWindowDays: 14,
  standardDeliveryDays: [3, 5],
  lowStockThreshold: 3,
  contact: {
    email: "hello@netsale.shop",
    phone: "+962 7 9000 0000",
    whatsapp: "+962 7 9000 0000",
    hours: {
      en: "Sunday to Thursday, 10:00–18:00 (Amman time)",
      ar: "الأحد إلى الخميس، ١٠:٠٠–١٨:٠٠ بتوقيت عمّان",
    },
    address: { en: "Amman, Jordan", ar: "عمّان، الأردن" },
  },
  /*
   * Empty on purpose.
   *
   * These were `https://instagram.com/` and `https://tiktok.com/` — the
   * platforms' front doors, not net sale's profiles. A button labelled
   * "Instagram" in the shop's own footer that lands on Instagram's homepage
   * is a dead end wearing the shop's name, and nobody can tell it is broken
   * by looking at it.
   *
   * The footer renders nothing at all while this is empty. Add the real
   * handles in the admin under Settings → Social links.
   */
  social: [],
  legal: {
    tradingName: "net sale",
    country: { en: "Jordan", ar: "الأردن" },
  },
};

/* -------------------------------------------------------------------------- */
/*  Documents                                                                 */
/* -------------------------------------------------------------------------- */

export interface PolicySection {
  heading: Localized;
  body: Localized[];
}

export interface PolicyDoc {
  slug: string;
  group: "help" | "legal" | "about";
  eyebrow: Localized;
  title: Localized;
  intro: Localized;
  sections: PolicySection[];
  /** Shown as "last reviewed" — an undated policy is not a policy. */
  updatedAt: string;
}

const UPDATED = "2026-09-15";

/**
 * The policy documents, composed from whatever settings are live.
 *
 * A function rather than a constant, because these quote the shop's real
 * numbers fourteen times over — the free-delivery threshold, the return
 * window, the delivery window, the contact address. Built once at module load
 * they would keep quoting the values that were in the repo at deploy time,
 * while the cart charged what the merchant set this morning. A returns page
 * that promises a window the shop no longer honours is the expensive kind of
 * wrong.
 */
export function buildPolicyDocs(S: StoreSettings): PolicyDoc[] {
  return [
  /* ---- Help ---- */
  {
    slug: "shipping",
    group: "help",
    eyebrow: { en: "Help", ar: "المساعدة" },
    title: { en: "Delivery", ar: "التوصيل" },
    intro: {
      en: "Where we deliver, what it costs, and how long it takes.",
      ar: "أين نوصل، وكم تبلغ الكلفة، وكم تستغرق.",
    },
    updatedAt: UPDATED,
    sections: [
      {
        heading: { en: "Cost", ar: "الكلفة" },
        body: [
          {
            en: `Standard delivery is charged at checkout and is free on orders of ${S.freeShippingThreshold} JOD or more. Oversized pieces — coats and tailoring — carry a handling surcharge, which is shown on the delivery step before you pay, never added afterwards.`,
            ar: `تُحتسب رسوم التوصيل العادي عند الدفع، وتكون مجانية للطلبات من ${S.freeShippingThreshold} ديناراً فأكثر. القطع الضخمة — المعاطف والتفصيل — عليها رسم مناولة يظهر في خطوة التوصيل قبل الدفع، ولا يُضاف بعده.`,
          },
        ],
      },
      {
        heading: { en: "Timing", ar: "المدة" },
        body: [
          {
            en: `Standard delivery takes ${S.standardDeliveryDays[0]}–${S.standardDeliveryDays[1]} business days. Express and same-day are offered where the courier covers them; same-day is not available for oversized items, and the checkout will say so rather than quietly removing the option.`,
            ar: `يستغرق التوصيل العادي ${S.standardDeliveryDays[0]}–${S.standardDeliveryDays[1]} أيام عمل. التوصيل السريع وتوصيل نفس اليوم متاحان حيث تغطيهما شركة الشحن؛ وتوصيل نفس اليوم غير متاح للقطع الضخمة، وستوضح صفحة الدفع ذلك بدل أن تُخفي الخيار.`,
          },
        ],
      },
      {
        heading: { en: "Tracking", ar: "التتبّع" },
        body: [
          {
            en: "Every order has a reference beginning NS-. Enter it on the order page to see its stage. If a courier has issued a tracking number, it appears there too.",
            ar: "لكل طلب رقم مرجعي يبدأ بـ NS-. أدخله في صفحة الطلب لترى مرحلته. وإن أصدرت شركة الشحن رقم تتبّع، فسيظهر هناك أيضاً.",
          },
        ],
      },
    ],
  },
  {
    slug: "returns",
    group: "help",
    eyebrow: { en: "Help", ar: "المساعدة" },
    title: { en: "Returns & exchanges", ar: "الإرجاع والاستبدال" },
    intro: {
      en: "What can come back, in what condition, and how long you have.",
      ar: "ما الذي يمكن إرجاعه، وبأي حال، وكم من الوقت لديك.",
    },
    updatedAt: UPDATED,
    sections: [
      {
        heading: { en: "The window", ar: "المهلة" },
        body: [
          {
            en: `You have ${S.returnWindowDays} days from delivery to start a return. Contact us with your order reference and we will arrange collection or a drop-off, depending on your area.`,
            ar: `لديك ${S.returnWindowDays} يوماً من تاريخ الاستلام لبدء الإرجاع. تواصل معنا مع رقم الطلب وسنرتّب الاستلام أو التسليم، بحسب منطقتك.`,
          },
        ],
      },
      {
        heading: { en: "Condition", ar: "الحالة" },
        body: [
          {
            en: "Pieces must be unworn, with their tags attached. We cannot accept returns on care products whose seal is broken, for hygiene reasons.",
            ar: "يجب أن تكون القطع غير مُرتداة وبطاقاتها مثبتة. ولا نقبل إرجاع منتجات العناية التي فُتح ختمها، لأسباب صحية.",
          },
        ],
      },
      {
        heading: { en: "Exchanges", ar: "الاستبدال" },
        body: [
          {
            en: "A size exchange is a return followed by a new order. We hold the replacement size for you while the first piece travels back, subject to stock.",
            ar: "استبدال المقاس هو إرجاع يتبعه طلب جديد. نحجز لك المقاس البديل ريثما تعود القطعة الأولى، بحسب توفّر المخزون.",
          },
        ],
      },
      {
        heading: { en: "Refunds", ar: "المبالغ المستردة" },
        body: [
          {
            en: "A refund is issued to the original payment method once the piece is back with us and checked. Cash-on-delivery orders are refunded by bank transfer or CliQ.",
            ar: "يُرَدّ المبلغ إلى وسيلة الدفع الأصلية بعد وصول القطعة إلينا وفحصها. أما طلبات الدفع عند الاستلام فتُرَدّ بحوالة بنكية أو عبر كليك.",
          },
        ],
      },
    ],
  },
  {
    slug: "sizing",
    group: "help",
    eyebrow: { en: "Help", ar: "المساعدة" },
    title: { en: "Size guide", ar: "دليل المقاسات" },
    intro: {
      en: "How to measure yourself, and how our sizes actually run.",
      ar: "كيف تقيس نفسك، وكيف تأتي مقاساتنا فعلياً.",
    },
    updatedAt: UPDATED,
    sections: [
      {
        heading: { en: "How to measure", ar: "كيف تقيس" },
        body: [
          {
            en: "Measure over light clothing, keeping the tape level and snug but not tight. Chest: around the fullest part. Waist: at the narrowest point. Hip: around the fullest part, feet together.",
            ar: "قِس فوق ملابس خفيفة، مع إبقاء الشريط مستوياً وملامساً دون شدّ. الصدر: حول أعرض نقطة. الخصر: عند أضيق نقطة. الورك: حول أعرض نقطة والقدمان متلاصقتان.",
          },
        ],
      },
      {
        heading: { en: "How our sizes run", ar: "كيف تأتي مقاساتنا" },
        body: [
          {
            en: "Each product page states whether that piece runs true to size, small or large, and names the size the model is wearing along with their height. That note is per garment, not per brand — a relaxed coat and a slim blazer do not fit the same way.",
            ar: "تذكر صفحة كل منتج ما إذا كانت القطعة مطابقة للمقاس أو تميل للضيق أو السعة، وتُسمّي المقاس الذي ترتديه العارضة مع طولها. هذه الملاحظة لكل قطعة لا للعلامة كلها — فالمعطف الواسع والبليزر الضيّق لا يُلبسان بالطريقة نفسها.",
          },
        ],
      },
      {
        heading: { en: "Between sizes", ar: "بين مقاسين" },
        body: [
          {
            en: "The fitting room compares your measurements against each garment's own table. When the answer is not confident it says “between sizes” rather than inventing certainty — a hedge costs nothing, a confident wrong answer costs a return.",
            ar: "تقارن غرفة القياس قياساتك بجدول كل قطعة. وحين لا تكون النتيجة مؤكدة تقول «بين مقاسين» بدل اختلاق اليقين — فالتحفّظ لا يكلّف شيئاً، أما الجواب الواثق الخاطئ فيكلّف إرجاعاً.",
          },
        ],
      },
    ],
  },
  {
    slug: "contact",
    group: "help",
    eyebrow: { en: "Help", ar: "المساعدة" },
    title: { en: "Contact us", ar: "تواصل معنا" },
    intro: {
      en: "A person reads every message. Here is how to reach them.",
      ar: "يقرأ كل رسالة إنسان. وهذه طرق الوصول إليه.",
    },
    updatedAt: UPDATED,
    sections: [
      {
        heading: { en: "Email", ar: "البريد الإلكتروني" },
        body: [{ en: S.contact.email, ar: S.contact.email }],
      },
      {
        heading: { en: "Phone & WhatsApp", ar: "الهاتف وواتساب" },
        body: [{ en: S.contact.phone, ar: S.contact.phone }],
      },
      {
        heading: { en: "Hours", ar: "ساعات العمل" },
        body: [S.contact.hours],
      },
      {
        heading: { en: "Where we are", ar: "أين نحن" },
        body: [S.contact.address],
      },
    ],
  },

  /* ---- Legal ---- */
  {
    slug: "privacy",
    group: "legal",
    eyebrow: { en: "Legal", ar: "قانوني" },
    title: { en: "Privacy", ar: "الخصوصية" },
    intro: {
      en: "What we collect, why, and what we will never do with it.",
      ar: "ما الذي نجمعه، ولماذا، وما لن نفعله به أبداً.",
    },
    updatedAt: UPDATED,
    sections: [
      {
        heading: { en: "What we collect", ar: "ما الذي نجمعه" },
        body: [
          {
            en: "To take an order we need a name, an address, a phone number and an email. If you create an account we keep your order history, any addresses you save, and — to keep the shop safe — the internet addresses you sign in from, described below. Nothing else is required to shop.",
            ar: "لتنفيذ الطلب نحتاج الاسم والعنوان ورقم الهاتف والبريد الإلكتروني. وإن أنشأت حساباً نحتفظ بسجل طلباتك والعناوين التي تحفظها، وكذلك — لحماية المتجر — عناوين الإنترنت التي تدخل منها، وهي موضّحة أدناه. ولا يلزم غير ذلك للتسوّق.",
          },
        ],
      },
      {
        heading: { en: "Measurements and the fitting room", ar: "القياسات وغرفة القياس" },
        body: [
          {
            en: "Body measurements you enter are stored against your account and used only to recommend a size. They are never used for advertising, never shared, and you can clear them from your account at any time.",
            ar: "تُحفظ القياسات التي تُدخلها في حسابك وتُستخدم فقط لاقتراح المقاس. ولا تُستخدم للإعلانات ولا تُشارك، ويمكنك مسحها من حسابك في أي وقت.",
          },
        ],
      },
      {
        heading: { en: "Sign-in records", ar: "سجلّ تسجيل الدخول" },
        body: [
          {
            en: "When you sign in we record the internet address you signed in from, together with the date. We keep only the last few addresses, and we use them for one thing: stopping abuse of the shop — fraudulent orders, attacks on other people's accounts, and the like. They are never used for advertising, never shared, and never linked to what you browse. Deleting your account deletes them with it.",
            ar: "عند تسجيل دخولك نسجّل عنوان الإنترنت الذي دخلت منه مع التاريخ. نحتفظ بآخر عدد قليل من العناوين فقط، ونستخدمها لشيء واحد: منع إساءة استخدام المتجر — الطلبات الاحتيالية، ومحاولات اختراق حسابات الآخرين، وما شابه. ولا تُستخدم للإعلانات ولا تُشارك ولا تُربط بما تتصفّحه. وحذف حسابك يحذفها معه.",
          },
        ],
      },
      {
        heading: { en: "Payment", ar: "الدفع" },
        body: [
          {
            en: "Orders are currently paid on delivery. We do not take or store card numbers. If a card gateway is added, the card details will go to the gateway and never touch our servers — and this page will say so before it goes live.",
            ar: "الطلبات حالياً تُدفع عند الاستلام. لا نأخذ أرقام البطاقات ولا نخزّنها. وإن أُضيفت بوابة دفع بالبطاقة فستذهب بيانات البطاقة إلى البوابة ولن تمرّ بخوادمنا — وستُحدَّث هذه الصفحة قبل تفعيلها.",
          },
        ],
      },
      {
        heading: { en: "Your choices", ar: "خياراتك" },
        body: [
          {
            en: `Write to ${S.contact.email} to ask for a copy of your data, to correct it, or to have your account deleted. We will answer within a week.`,
            ar: `راسلنا على ${S.contact.email} لطلب نسخة من بياناتك أو تصحيحها أو حذف حسابك. وسنردّ خلال أسبوع.`,
          },
        ],
      },
    ],
  },
  {
    slug: "terms",
    group: "legal",
    eyebrow: { en: "Legal", ar: "قانوني" },
    title: { en: "Terms of sale", ar: "شروط البيع" },
    intro: {
      en: "The agreement between you and the shop when you place an order.",
      ar: "الاتفاق بينك وبين المتجر عند تقديم الطلب.",
    },
    updatedAt: UPDATED,
    sections: [
      {
        heading: { en: "Prices", ar: "الأسعار" },
        body: [
          {
            en: "All prices are in Jordanian dinar and include applicable sales tax. The total shown on the last step of checkout is the amount due; the server calculates it, and it is the figure your order is created with.",
            ar: "جميع الأسعار بالدينار الأردني وتشمل ضريبة المبيعات المطبّقة. والمبلغ الظاهر في الخطوة الأخيرة من الدفع هو المستحق؛ يحتسبه الخادم، وهو الرقم الذي يُنشأ به طلبك.",
          },
        ],
      },
      {
        heading: { en: "Discount codes", ar: "رموز الخصم" },
        body: [
          {
            en: "A code applies only while it is running and only to the items it names. Codes may carry a limit per customer and a limit overall; once the overall limit is reached the code stops working for everyone, including anyone holding it. Codes do not combine with sale prices unless the code says so.",
            ar: "يسري الرمز فقط أثناء فترته وعلى القطع التي يحدّدها. وقد يحمل حداً لكل عميل وحداً إجمالياً؛ وعند بلوغ الحد الإجمالي يتوقف الرمز للجميع، بمن فيهم من يحملونه. ولا تُجمع الرموز مع أسعار التخفيض إلا إذا نصّ الرمز على ذلك.",
          },
        ],
      },
      {
        heading: { en: "Availability", ar: "التوفّر" },
        body: [
          {
            en: "Stock is held per size and colour. An order is only confirmed once stock is reserved; if a piece sells out between your adding it and paying, the checkout will refuse rather than take money for something we cannot send.",
            ar: "يُحفظ المخزون لكل مقاس ولون. ولا يُؤكَّد الطلب إلا بعد حجز المخزون؛ فإن نفدت القطعة بين إضافتها والدفع، سترفض صفحة الدفع بدل أخذ مبلغ مقابل ما لا نستطيع إرساله.",
          },
        ],
      },
      {
        heading: { en: "Governing law", ar: "القانون الحاكم" },
        body: [
          {
            en: `${S.legal.tradingName} trades from ${S.legal.country.en}, and these terms are governed by Jordanian law.`,
            ar: `يعمل ${S.legal.tradingName} من ${S.legal.country.ar}، وتخضع هذه الشروط للقانون الأردني.`,
          },
        ],
      },
    ],
  },

  /* ---- About ---- */
  {
    slug: "materials",
    group: "about",
    eyebrow: { en: "About", ar: "عن المتجر" },
    title: { en: "Materials", ar: "الخامات" },
    intro: {
      en: "What the pieces are made of, and where the cloth comes from.",
      ar: "ممّ صُنعت القطع، ومن أين يأتي القماش.",
    },
    updatedAt: UPDATED,
    sections: [
      {
        heading: { en: "Naming the cloth", ar: "تسمية القماش" },
        body: [
          {
            en: "Every product page lists its full composition and the mill's city. “Premium” is not a material; 88% virgin wool from Biella is. Where we do not know a provenance, we leave it out rather than imply one.",
            ar: "تذكر صفحة كل منتج تركيبته الكاملة ومدينة المصنع. «فاخر» ليست خامة، أما ٨٨٪ صوف بكر من بييلا فهي كذلك. وحيث لا نعرف المنشأ نتركه فارغاً بدل الإيحاء به.",
          },
        ],
      },
      {
        heading: { en: "Care", ar: "العناية" },
        body: [
          {
            en: "Care instructions are on the product page rather than only on the label, because the decision to buy a dry-clean-only coat is better made before it arrives.",
            ar: "تعليمات العناية مذكورة في صفحة المنتج لا على البطاقة فقط، لأن قرار شراء معطف لا يُنظَّف إلا جافاً يُتخذ قبل وصوله لا بعده.",
          },
        ],
      },
    ],
  },
  {
    slug: "responsibility",
    group: "about",
    eyebrow: { en: "About", ar: "عن المتجر" },
    title: { en: "Responsibility", ar: "المسؤولية" },
    intro: {
      en: "What we are willing to claim, and what we are not.",
      ar: "ما نحن مستعدون لادّعائه، وما لسنا كذلك.",
    },
    updatedAt: UPDATED,
    sections: [
      {
        heading: { en: "Fewer pieces", ar: "قطع أقل" },
        body: [
          {
            en: "The collection is deliberately small. A shorter list is easier to know the origin of, and a piece that lasts five seasons is the only sustainability claim we are confident making.",
            ar: "المجموعة صغيرة عن قصد. القائمة الأقصر أسهل في معرفة منشئها، والقطعة التي تدوم خمسة مواسم هي ادّعاء الاستدامة الوحيد الذي نثق بقوله.",
          },
        ],
      },
      {
        heading: { en: "What we do not claim", ar: "ما لا ندّعيه" },
        body: [
          {
            en: "We do not hold a third-party sustainability certification, and we do not display one. If that changes, the certificate and its issuer will be named here.",
            ar: "لا نملك شهادة استدامة من جهة مستقلة، ولا نعرض واحدة. وإن تغيّر ذلك فستُذكر الشهادة والجهة المانحة هنا.",
          },
        ],
      },
    ],
  },
  ];
}

/**
 * The documents as they read with the repo's own settings.
 *
 * Kept for callers that have no way to await a Firestore read — and as the
 * fallback the loader returns when one fails.
 */
export const policyDocs: PolicyDoc[] = buildPolicyDocs(storeSettings);

export function findPolicy(
  group: PolicyDoc["group"],
  slug: string,
  docs: PolicyDoc[] = policyDocs,
): PolicyDoc | null {
  return docs.find((d) => d.group === group && d.slug === slug) ?? null;
}

export function policiesIn(
  group: PolicyDoc["group"],
  docs: PolicyDoc[] = policyDocs,
): PolicyDoc[] {
  return docs.filter((d) => d.group === group);
}
