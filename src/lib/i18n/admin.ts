import type { Locale } from "@/types";

/**
 * Admin strings.
 *
 * The shell used to say, in a comment, that "a half-translated admin is worse
 * than one language done properly" — and it was right, as a defence of leaving
 * it alone. It is not a reason to refuse an Arabic-speaking operator the parts
 * that *can* be done properly.
 *
 * So the boundary is drawn deliberately rather than by neglect:
 *
 *   **Translated** — the chrome every screen shows (navigation, account,
 *   sign out), and the screens added since this decision: Settings, Delivery,
 *   and the low-stock queue.
 *
 *   **English** — the eleven operational boards that predate it (orders,
 *   products, invoices, offers, reviews, behaviour and the rest). They are
 *   dense, and a board translated halfway is genuinely worse than one that is
 *   honestly in English.
 *
 * Which screens are which is visible to the operator, not hidden: switching to
 * Arabic says so. Adding a board to the translated set is adding its keys
 * here, not rebuilding anything.
 */

export type AdminDict = Record<string, Record<Locale, string>>;

export const ADMIN_STRINGS = {
  /* ---- chrome ---- */
  "nav.trade": { en: "Trade", ar: "التجارة" },
  "nav.catalogue": { en: "Catalogue", ar: "الكتالوج" },
  "nav.people": { en: "People", ar: "الأشخاص" },
  "nav.shop": { en: "Shop", ar: "المتجر" },

  "nav.dashboard": { en: "Dashboard", ar: "لوحة المتابعة" },
  "nav.orders": { en: "Orders", ar: "الطلبات" },
  "nav.invoices": { en: "Invoices", ar: "الفواتير" },
  "nav.behaviour": { en: "Behaviour", ar: "سلوك التسوق" },
  "nav.products": { en: "Products", ar: "المنتجات" },
  "nav.categories": { en: "Categories", ar: "الأقسام" },
  "nav.warehouse": { en: "Seasonal warehouse", ar: "المستودع الموسمي" },
  "nav.offers": { en: "Offers & campaigns", ar: "العروض والحملات" },
  "nav.gift": { en: "Gift game", ar: "لعبة الهدايا" },
  "nav.reviews": { en: "Reviews", ar: "التقييمات" },
  "nav.customers": { en: "Customers", ar: "العملاء" },
  "nav.support": { en: "Support", ar: "الدعم" },
  "nav.shipping": { en: "Delivery", ar: "التوصيل" },
  "nav.settings": { en: "Settings", ar: "الإعدادات" },

  "shell.operations": { en: "Operations", ar: "التشغيل" },
  "shell.viewStore": { en: "View store", ar: "عرض المتجر" },
  "shell.signOut": { en: "Sign out", ar: "تسجيل الخروج" },
  "shell.staff": { en: "Staff", ar: "موظف" },
  "shell.openMenu": { en: "Open menu", ar: "افتح القائمة" },
  "shell.closeMenu": { en: "Close menu", ar: "أغلق القائمة" },
  "shell.language": { en: "Language", ar: "اللغة" },
  "shell.sampleTitle": { en: "Sample data.", ar: "بيانات تجريبية." },
  "shell.sampleBody": {
    en: "Firestore has no orders yet, so these screens are showing a generated 120-day history.",
    ar: "لا توجد طلبات في Firestore بعد، لذا تعرض هذه الشاشات سجلاً مولّداً لمئة وعشرين يوماً.",
  },
  /*
   * Said out loud when Arabic is chosen. An operator who switches languages
   * and finds half the tool unchanged should have been told, not left to
   * wonder whether something failed to load.
   */
  "shell.partial": {
    en: "Settings, Delivery and the dashboard queue are in Arabic. The trading boards are English.",
    ar: "الإعدادات والتوصيل وقائمة المخزون بالعربية. أما شاشات التشغيل الأخرى فبالإنجليزية.",
  },

  /* ---- settings ---- */
  "settings.title": { en: "Store settings", ar: "إعدادات المتجر" },
  "settings.subtitle": {
    en: "The numbers and details the storefront quotes back to customers.",
    ar: "الأرقام والتفاصيل التي يعرضها المتجر على العملاء.",
  },
  "settings.deliveryPanel": { en: "Delivery and returns", ar: "التوصيل والإرجاع" },
  "settings.deliveryPanelHint": {
    en: "Changing these rewrites the sentences that quote them.",
    ar: "تغيير هذه الأرقام يعيد صياغة كل جملة تذكرها.",
  },
  "settings.freeOver": { en: "Free delivery over", ar: "توصيل مجاني فوق" },
  "settings.returnWindow": { en: "Return window", ar: "مهلة الإرجاع" },
  "settings.lowStock": { en: "Low-stock alert at", ar: "تنبيه انخفاض المخزون عند" },
  "settings.lowStockSuffix": { en: "units per variant", ar: "قطعة لكل متغيّر" },
  "settings.standardDelivery": { en: "Standard delivery", ar: "التوصيل العادي" },
  "settings.days": { en: "days", ar: "يوماً" },
  "settings.businessDays": { en: "business days", ar: "أيام عمل" },
  "settings.to": { en: "to", ar: "إلى" },
  "settings.contact": { en: "Contact", ar: "التواصل" },
  "settings.contactHint": {
    en: "Shown on the contact page and in the footer.",
    ar: "تظهر في صفحة التواصل وأسفل الموقع.",
  },
  "settings.email": { en: "Email", ar: "البريد الإلكتروني" },
  "settings.phone": { en: "Phone", ar: "الهاتف" },
  "settings.whatsapp": { en: "WhatsApp", ar: "واتساب" },
  "settings.whatsappHint": {
    en: "Leave empty to hide the WhatsApp link.",
    ar: "اتركه فارغاً لإخفاء رابط واتساب.",
  },
  "settings.hours": { en: "Opening hours", ar: "ساعات العمل" },
  "settings.address": { en: "Address", ar: "العنوان" },
  "settings.social": { en: "Social links", ar: "روابط التواصل الاجتماعي" },
  "settings.socialHint": { en: "Full https links only.", ar: "روابط https كاملة فقط." },
  "settings.addLink": { en: "Add a link", ar: "أضف رابطاً" },
  "settings.socialInvalid": {
    en: "Every link must start with http:// or https://. These are rendered in the footer of every page.",
    ar: "يجب أن يبدأ كل رابط بـ http:// أو https://. تُعرض هذه الروابط أسفل كل صفحة.",
  },
  "settings.legal": { en: "Trading details", ar: "بيانات النشاط" },
  "settings.legalHint": {
    en: "Used on invoices and the terms page.",
    ar: "تُستخدم في الفواتير وصفحة الشروط.",
  },
  "settings.tradingName": { en: "Trading name", ar: "الاسم التجاري" },
  "settings.country": { en: "Country", ar: "الدولة" },
  "settings.save": { en: "Save settings", ar: "احفظ الإعدادات" },
  "settings.saveHint": {
    en: "Saving refreshes every page that quotes these numbers.",
    ar: "الحفظ يحدّث كل صفحة تذكر هذه الأرقام.",
  },
  "settings.dayOrder": {
    en: "The fastest day cannot be later than the slowest",
    ar: "لا يمكن أن يكون اليوم الأسرع بعد اليوم الأبطأ",
  },

  /* ---- delivery ---- */
  "shipping.title": { en: "Delivery", ar: "التوصيل" },
  "shipping.subtitle": {
    en: "What carriage costs, how long it takes, and where you deliver.",
    ar: "كم يكلّف الشحن، وكم يستغرق، وإلى أين توصل.",
  },
  "shipping.methods": { en: "Methods", ar: "طرق التوصيل" },
  "shipping.methodsHint": {
    en: "The speeds a customer can choose between.",
    ar: "السرعات التي يختار العميل بينها.",
  },
  "shipping.method": { en: "Method", ar: "الطريقة" },
  "shipping.price": { en: "Price", ar: "السعر" },
  "shipping.daysCol": { en: "Days", ar: "الأيام" },
  "shipping.freeAbove": { en: "Free above", ar: "مجاني فوق" },
  "shipping.freeAboveHint": {
    en: "An empty “free above” means this method is never free on its own. The shop-wide threshold is",
    ar: "ترك «مجاني فوق» فارغاً يعني أن هذه الطريقة لا تكون مجانية بذاتها أبداً. والحد العام للمتجر هو",
  },
  "shipping.zones": { en: "Zones", ar: "المناطق" },
  "shipping.zonesHint": {
    en: "Matched against the city or region a customer types. An address matching none pays the method price.",
    ar: "تُطابق المدينة أو المحافظة التي يكتبها العميل. والعنوان غير المطابق لأي منطقة يدفع سعر الطريقة.",
  },
  "shipping.noZones": {
    en: "No zones. Every address is charged the method price.",
    ar: "لا توجد مناطق. كل عنوان يُحتسب بسعر الطريقة.",
  },
  "shipping.zoneNameEn": { en: "Zone name (English)", ar: "اسم المنطقة (إنجليزي)" },
  "shipping.areas": {
    en: "Cities and regions, comma separated",
    ar: "المدن والمحافظات، مفصولة بفواصل",
  },
  "shipping.areasHint": {
    en: "List both spellings — a customer typing عمّان must match the same zone as one typing Amman.",
    ar: "اذكر التهجئتين — من يكتب «عمّان» يجب أن يطابق نفس منطقة من يكتب «Amman».",
  },
  "shipping.surcharge": { en: "Surcharge", ar: "رسم إضافي" },
  "shipping.extraDays": { en: "Extra days", ar: "أيام إضافية" },
  "shipping.excluded": { en: "Do not deliver here", ar: "لا نوصل إلى هنا" },
  "shipping.excludedHint": {
    en: "Checkout will refuse addresses here, at the address step and again on the server.",
    ar: "سترفض صفحة الدفع العناوين هنا، عند خطوة العنوان ومرة أخرى على الخادم.",
  },
  "shipping.removeZone": { en: "Remove zone", ar: "احذف المنطقة" },
  "shipping.addZone": { en: "Add a zone", ar: "أضف منطقة" },
  "shipping.save": { en: "Save delivery rates", ar: "احفظ أسعار التوصيل" },
  "shipping.saveHint": {
    en: "The cart, the checkout and the server all quote from these.",
    ar: "السلة وصفحة الدفع والخادم جميعها تقتبس من هذه الأسعار.",
  },

  /* ---- low stock ---- */
  "stock.title": { en: "Stock needing attention", ar: "مخزون يحتاج انتباهاً" },
  "stock.none": { en: "None", ar: "نفد" },
  "stock.singleItem": { en: "Single item", ar: "قطعة مفردة" },
  "stock.clear": {
    en: "Every active variant is above the threshold.",
    ar: "كل المتغيّرات النشطة فوق الحد.",
  },
  "stock.clearBody": {
    en: "Nothing needs reordering. Change the threshold under Settings → Delivery and returns.",
    ar: "لا شيء يحتاج إعادة طلب. غيّر الحد من الإعدادات ← التوصيل والإرجاع.",
  },

  /* ---- shared ---- */
  "common.saved": { en: "Saved", ar: "حُفظ" },
  "common.saving": { en: "Saving…", ar: "يُحفظ…" },
  "common.notWritten": {
    en: "Validated but not written — Firebase Admin is not configured, so there is nowhere to save to yet.",
    ar: "تم التحقق دون كتابة — لم يُهيّأ Firebase Admin، فلا مكان للحفظ بعد.",
  },
} satisfies AdminDict;

export type AdminKey = keyof typeof ADMIN_STRINGS;

/** Look up one string. Falls back to English, never to the raw key. */
export function adminText(key: AdminKey, locale: Locale): string {
  const entry = ADMIN_STRINGS[key] as Record<Locale, string> | undefined;
  return entry?.[locale] ?? entry?.en ?? "";
}
