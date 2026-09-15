/**
 * net sale — domain model.
 *
 * These types are the contract between Firestore, the server components that
 * read it, and the client components that render it. Firestore documents are
 * mapped through the converters in `src/lib/firebase/converters.ts`, which is
 * where `Timestamp` becomes `number` — so nothing below ever carries a
 * Firebase SDK type into a React component.
 */

/** ISO-4217 code. The store is multi-currency at the presentation layer only. */
export type CurrencyCode = "JOD" | "SAR" | "AED" | "USD" | "EUR";

export type Locale = "en" | "ar";

/** Any user-facing string that must exist in both languages. */
export type Localized = Record<Locale, string>;

/* -------------------------------------------------------------------------- */
/*  Catalogue                                                                 */
/* -------------------------------------------------------------------------- */

export type SizeSystem = "alpha" | "numeric" | "waist" | "shoe" | "one-size";

export interface ProductImage {
  url: string;
  /** Alt text is required — it is not optional for an accessible storefront. */
  alt: string;
  width: number;
  height: number;
  /** Tiny base64 preview produced at upload time; powers `placeholder="blur"`. */
  blurDataURL?: string;
  /** Which colourway this shot belongs to, if the product is colour-split. */
  colorId?: string;
}

export interface ProductColor {
  id: string;
  name: Localized;
  /** Swatch fill. Two values renders a split swatch for multi-tone fabrics. */
  hex: string;
  hexSecondary?: string;
}

export interface ProductSize {
  id: string;
  label: string;
  system: SizeSystem;
  /** Body measurements in cm, surfaced by the size guide and the fitting room. */
  measurements?: {
    chest?: number;
    waist?: number;
    hip?: number;
    length?: number;
    sleeve?: number;
  };
}

/**
 * A single sellable permutation. Stock lives here, never on the product — a
 * product is "in stock" only if at least one variant is.
 */
/**
 * An artwork option — an embroidery, a print, a placement.
 *
 * A third axis, deliberately separate from colour. The shop sells tees where
 * the same bone cotton carries four different embroideries; storing those as
 * colours would put four identical swatches in the colour row, and the picker
 * whose job is "which shade" would be answering "which drawing". Worse, the
 * packing slip would say "Bone" four times and the person at the bench would
 * have to guess.
 *
 * Optional throughout. A product with no designs behaves exactly as before,
 * which is what keeps every existing product, cart line and order valid.
 */
export interface ProductDesign {
  id: string;
  name: Localized;
  /** The chip shown in the picker. Small — it is rendered at ~56px. */
  thumbnail: ProductImage;
  /**
   * Gallery images for this design. When empty the product's own images are
   * shown, so a design can be added without re-shooting the whole product.
   */
  images?: ProductImage[];
  /** Adds to the product price. Negative is allowed for a plain option. */
  priceDelta?: number;
  /** Hidden from the picker without deleting it, so orders keep their history. */
  available?: boolean;
  /** Ordering in the picker; ties fall back to array order. */
  position?: number;
}

export interface ProductVariant {
  /** Stable SKU, also used as the Firestore document id in `variants`. */
  sku: string;
  colorId: string;
  sizeId: string;
  /**
   * The artwork this permutation carries, when the product has designs.
   *
   * Empty or absent means "the product's only version" — which is every
   * variant written before designs existed, so those keep resolving.
   */
  designId?: string;
  stock: number;
  /** Overrides the parent price when this permutation is priced differently. */
  priceOverride?: number;
  /**
   * GTIN-8/12/13/14 for *this* permutation.
   *
   * It belongs on the variant, not the product: a GTIN identifies one trade
   * item, and a medium navy coat and a large navy coat are two trade items.
   * Google Merchant Center and every marketplace reject a feed that reuses one
   * GTIN across sizes, so a product-level GTIN would be actively wrong for a
   * variable product. `Product.gtin` exists only for simple products, which
   * genuinely are a single trade item.
   */
  gtin?: string;
  barcode?: string;
}

export type ProductBadge =
  | "new"
  | "bestseller"
  | "limited"
  | "last-pieces"
  | "exclusive"
  | "restocked";

/**
 * Seasonal grouping for the warehouse.
 *
 * `all-season` is not "no season" — it is a positive statement that the piece
 * stays out year-round, which is what a bulk "hide winter" action has to
 * respect. A product may belong to several.
 */
export type Season = "winter" | "spring" | "summer" | "autumn" | "all-season";

/**
 * Why a product is or is not on the storefront.
 *
 * Deliberately separate from `status`, because they answer different
 * questions and conflating them loses information the merchant needs:
 *
 *  - `status` is the product's lifecycle — draft, active, archived.
 *  - `visibility` is whether an *active* product is currently on display.
 *
 * A coat pulled for the summer is `status: "active"`, `visibility: "hidden"`.
 * It keeps its stock, its reviews and its place in old orders; it simply is
 * not shown. Marking it `archived` instead would say it is gone for good, and
 * zeroing its stock would lose a real count that has to come back in October.
 */
export type ProductVisibility = "visible" | "hidden";

/** A pending, scheduled change of visibility. */
export interface VisibilitySchedule {
  /** Show the product at this instant, if set. */
  showAt?: number;
  /** Hide the product at this instant, if set. */
  hideAt?: number;
}

/**
 * How a product is *bought*, which decides how it is rendered and priced.
 *
 *  - `simple`   — one trade item. No choices to make: no swatches, no size
 *                grid, no variants. Stock, SKU and GTIN live on the product.
 *  - `variable` — a family of trade items. The customer picks a colour and a
 *                size, and that selection resolves to one `ProductVariant`
 *                carrying its own SKU, GTIN, stock and optional price.
 *
 * The distinction is not cosmetic: a simple product must never render a
 * disabled size grid, and a variable product must never be added to the cart
 * without a resolved variant.
 */
export type ProductType = "simple" | "variable";

export interface Product {
  id: string;
  /** URL key. Lowercase, hyphenated, immutable once published. */
  slug: string;

  /** Drives option rendering, stock resolution and cart validation. */
  type: ProductType;
  title: Localized;
  subtitle?: Localized;
  description: Localized;
  /** Short bullet list for the details accordion — care, fabric, origin. */
  details?: { label: Localized; value: Localized }[];

  categoryId: string;
  /**
   * Denormalised ancestry, root first, ending in `categoryId` itself:
   * `["outerwear", "outerwear-coats"]`. A listing filtered on a parent can
   * then match every descendant with one array-contains, instead of reading
   * the category tree first and querying for each child.
   *
   * Written by `categoryPathFor()` — never typed by hand.
   */
  categoryPath: string[];
  collectionIds: string[];
  tags: string[];

  /**
   * Merchandising links, by product id.
   *
   * `upsell` is "instead of this" — a better version of what the customer is
   * already looking at, shown on the product page. `crossSell` is "along with
   * this" — something that completes it, shown in the bag once they have
   * committed. Mixing the two up is the classic mistake: a cross-sell on the
   * product page competes with the thing you are trying to sell.
   */
  upsellIds: string[];
  crossSellIds: string[];

  /** Minor units are avoided: prices are decimal in the store currency. */
  price: number;
  compareAtPrice?: number;
  currency: CurrencyCode;

  images: ProductImage[];

  /**
   * Empty on a simple product. Populated on a variable one, where every
   * colour × size permutation that is actually sold appears in `variants`.
   */
  colors: ProductColor[];
  sizes: ProductSize[];
  sizeSystem: SizeSystem;
  /**
   * Artwork options, when this product is sold with several.
   *
   * Independent of colour on purpose — see `ProductDesign`. Absent or empty
   * on everything that has one version, which is most of the catalogue.
   */
  designs?: ProductDesign[];
  /** Variable products only. One row per sellable permutation. */
  variants?: ProductVariant[];

  /**
   * Simple products only — the product *is* the trade item, so it carries the
   * identifiers directly. On a variable product the SKU is the parent code
   * (useful for reporting) and `gtin` is left unset; the variant carries it.
   */
  sku: string;
  gtin?: string;

  /**
   * Which shipping class this product belongs to. A class is how a rate table
   * says "this one is bulky" or "this one cannot fly" without hard-coding a
   * price per product. See `ShippingClass`.
   */
  shippingClassId?: string;

  /**
   * Seasons this product belongs to. Empty is treated as `all-season` — a
   * product nobody has classified should not vanish from a seasonal filter.
   */
  seasons?: Season[];

  /**
   * Whether an active product is currently on the storefront. Defaults to
   * visible, so every product written before the warehouse existed keeps
   * showing.
   */
  visibility?: ProductVisibility;

  /**
   * A scheduled show or hide. Evaluated at read time rather than by a cron:
   * a job that fails leaves the catalogue wrong until someone notices, while
   * a read-time comparison is simply correct on the next request.
   *
   * A manual change clears the schedule — see `visibilityOverride`.
   */
  visibilitySchedule?: VisibilitySchedule;

  /**
   * Set when a person overrides the schedule by hand. While true the schedule
   * is ignored, so "show this now" is not undone an hour later by a rule
   * somebody set last season and forgot.
   */
  visibilityOverride?: boolean;

  /**
   * Hard cap on units of this product in a single order.
   *
   * `1` is the "sold individually" case — limited drops, one-per-customer
   * offers. Undefined means the only limit is stock. Enforced in the cart for
   * feedback and re-enforced server-side at checkout, because the client
   * number is never trusted.
   */
  maxPerOrder?: number;

  /** Aggregated from variants by a Cloud Function — never written by clients. */
  inStock: boolean;
  totalStock: number;

  badges: ProductBadge[];
  rating?: { average: number; count: number };

  /** Drives the AI fitting room: how this garment sits on a body. */
  fit?: {
    /** -2 runs very small … +2 runs very large. */
    scale: -2 | -1 | 0 | 1 | 2;
    silhouette: "slim" | "regular" | "relaxed" | "oversized";
    stretch: "none" | "slight" | "moderate" | "high";
    modelHeightCm?: number;
    modelWearsSizeId?: string;
  };

  status: "draft" | "active" | "archived";
  publishedAt: number;
  updatedAt: number;
}

/**
 * A node in the category tree.
 *
 * The tree is deliberately only two levels deep in the UI (a top-level
 * department and its subcategories). Nothing in the model forbids deeper
 * nesting — `path` and `categoryPath` handle any depth — but a shopper
 * navigating a third level is a shopper who is lost.
 */
export interface Category {
  id: string;
  slug: string;
  name: Localized;
  description?: Localized;
  /** `null` for a top-level department. */
  parentId: string | null;
  /**
   * Ancestry, root first, ending in this category's own id. Denormalised for
   * the same reason as `Product.categoryPath`: breadcrumbs and descendant
   * queries without walking the tree.
   */
  path: string[];
  /** 0 for a department, 1 for a subcategory. Derived from `path`. */
  depth: number;
  image?: ProductImage;
  /** Manual merchandising order, ascending. */
  order: number;
  /** Products in this category *and* every descendant. */
  productCount: number;
  featured: boolean;
  /** Show in the primary nav's category menu. Subcategories usually do not. */
  showInNav?: boolean;
  /**
   * Hidden categories keep their products and their URLs but leave the nav
   * and the category grid — the way a department is retired without breaking
   * every link that ever pointed at it.
   */
  hidden?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

/** A category with its children attached — what the nav and tiles render. */
export interface CategoryNode extends Category {
  children: CategoryNode[];
}

export interface Collection {
  id: string;
  slug: string;
  name: Localized;
  tagline?: Localized;
  hero?: ProductImage;
  productIds: string[];
  season?: string;
  active: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Merchandising — banners, campaigns, offers                                */
/* -------------------------------------------------------------------------- */

export type BannerSlot =
  | "hero"
  | "promo-rail"
  | "spotlight"
  | "category-strip"
  | "announcement";

export type BannerTone = "ink" | "brand" | "sand" | "paper";

/**
 * Where the copy sits over the artwork.
 *
 * A banner is a photograph with words on it, and the two are chosen by
 * different people at different times. Without a position control the words
 * land wherever the layout puts them — which is how a headline ends up across
 * a model's face and the merchant's only recourse is to re-crop the image.
 */
export type BannerTextPosition =
  | "start-top"
  | "start-middle"
  | "start-bottom"
  | "center-middle"
  | "end-top"
  | "end-middle"
  | "end-bottom";

/** Ink over a light photograph, or paper over a dark one. */
export type BannerTextTone = "light" | "dark";

export type BannerStatus = "draft" | "active" | "paused" | "archived";

/**
 * One card in the merchandising system. The homepage ad rail, the hero, and
 * the announcement bar are all the same document shape with a different slot,
 * so marketing can move a campaign between placements without a rebuild.
 */
export interface Banner {
  id: string;
  slot: BannerSlot;
  tone: BannerTone;
  eyebrow?: Localized;
  title: Localized;
  body?: Localized;
  cta?: { label: Localized; href: string };

  /**
   * Desktop artwork. A wide crop; on a phone it is letterboxed to nothing
   * useful, which is why `mediaMobile` exists rather than one image being
   * asked to work at both shapes.
   */
  media?: ProductImage;
  /** Portrait crop for narrow screens. Falls back to `media` when unset. */
  mediaMobile?: ProductImage;

  textPosition?: BannerTextPosition;
  textTone?: BannerTextTone;
  /**
   * 0–1. A scrim between the artwork and the copy. Photographs are not
   * designed around text, so legibility needs a dimming layer the merchant can
   * tune per image — too little and the headline disappears into a bright sky.
   */
  scrim?: number;

  /** Renders as a countdown when set; the card self-hides once passed. */
  startsAt?: number;
  endsAt?: number;
  /** Higher sorts first within a slot. */
  priority: number;
  /** Relative width in the promo rail grid: 1 = standard, 2 = wide. */
  span?: 1 | 2;

  status?: BannerStatus;
  /** Legacy mirror of `status === "active"`, kept in sync on write. */
  active: boolean;

  createdAt?: number;
  updatedAt?: number;
}

/**
 * How a slot presents more than one live banner.
 *
 * `single` shows the highest-priority one and is the honest default: a
 * carousel that nobody scrolls shows the second slide to almost no one, so
 * putting a campaign in slide two is usually a decision to hide it.
 */
export type SlotDisplay = "single" | "carousel";

export interface SlotSettings {
  /** The `BannerSlot` this configures. */
  id: BannerSlot;
  display: SlotDisplay;
  /** Seconds per slide. Ignored when `display` is `single`. */
  interval: number;
  /** Turns the whole placement off without touching its banners. */
  enabled: boolean;
}

export type OfferType = "percentage" | "fixed" | "free-shipping" | "bundle";

/**
 * Where a coupon sits in its life.
 *
 * `paused` and `archived` are deliberately different. Pausing is reversible
 * and expected — a campaign stops for a week. Archiving is the end of the
 * coupon's life, and it must never delete anything: orders that already used
 * the code keep their record of it, so an accountant can still explain why an
 * order from March was 20% cheaper. A coupon is therefore never hard-deleted.
 */
export type OfferStatus = "draft" | "active" | "paused" | "archived";

export interface Offer {
  id: string;
  code: string;
  type: OfferType;
  /** Percent (0-100) for `percentage`, currency amount for `fixed`. */
  value: number;
  /**
   * Ceiling on a percentage discount, in store currency. "20% off, up to 15
   * JOD" — without it a percentage coupon on a large basket writes a cheque
   * nobody approved.
   */
  maxDiscount?: number;
  title: Localized;
  description?: Localized;
  minSubtotal?: number;

  /** Empty arrays mean "applies to everything". */
  appliesToCategoryIds: string[];
  appliesToProductIds: string[];
  /**
   * Carve-outs, applied *after* the includes. Exclusion wins on a tie: a
   * product both included and excluded is excluded, because the exclusion is
   * the more specific statement and the safer reading of the merchant's
   * intent.
   */
  excludesCategoryIds: string[];
  excludesProductIds: string[];

  startsAt: number;
  endsAt: number;

  usageLimit?: number;
  /** Incremented only inside the transaction that creates an order. */
  usageCount: number;
  perUserLimit?: number;

  /** Restricts the code to one account. Personal gift and apology codes. */
  assignedUid?: string;
  /** Valid only on an account's first completed order. */
  firstOrderOnly: boolean;
  /**
   * Whether this may combine with automatic campaign discounts. Off by
   * default: stacking is how a 20% code and a 30% sale become 50% off, and
   * that is discovered in the revenue report rather than at checkout.
   */
  stackable: boolean;

  status: OfferStatus;
  /**
   * Legacy mirror of `status === "active"`. Kept in sync on write so any
   * reader that predates `status` keeps working; new code reads `status`.
   */
  active: boolean;

  createdAt?: number;
  updatedAt?: number;
}

/**
 * One account's use of one coupon.
 *
 * Stored as its own document (`offerRedemptions/{offerId}__{uid}`) rather than
 * counted by scanning orders. A scan is a race: two checkouts submitted at the
 * same moment both count zero prior uses and both succeed. A document can be
 * read and written in the same transaction as the order, which is what makes
 * "one per customer" actually mean one.
 */
export interface OfferRedemption {
  id: string;
  offerId: string;
  uid: string;
  count: number;
  orderIds: string[];
  firstUsedAt: number;
  lastUsedAt: number;
}

/* -------------------------------------------------------------------------- */
/*  Customer                                                                  */
/* -------------------------------------------------------------------------- */

export interface Address {
  id: string;
  label?: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode?: string;
  countryCode: string;
  isDefault: boolean;
}

/** Body profile the fitting room uses to recommend a size. Opt-in, private. */
export interface FitProfile {
  heightCm?: number;
  weightKg?: number;
  chestCm?: number;
  waistCm?: number;
  hipCm?: number;
  /** Preferred ease: how much room the customer likes beyond their measures. */
  preferredFit?: "slim" | "regular" | "relaxed";
  usualSizes?: Record<SizeSystem, string>;
  updatedAt?: number;
}

export interface UserProfile {
  /** Mirrors the Firebase Auth uid. */
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  phone?: string;
  locale: Locale;
  currency: CurrencyCode;
  addresses: Address[];
  fitProfile?: FitProfile;
  wishlist: string[];
  marketingOptIn: boolean;
  /** Set by a Cloud Function via custom claims — never writable by the client. */
  role: "customer" | "staff" | "admin";
  createdAt: number;
  updatedAt: number;
}

/* -------------------------------------------------------------------------- */
/*  Cart & checkout                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A cart line. Price is snapshotted at add-time for display continuity, but
 * the server re-prices every line at checkout — the client number is never
 * trusted for money.
 */
export interface CartItem {
  /**
   * `${productId}:${colorId}:${sizeId}`, with `:${designId}` appended only
   * when a design was chosen.
   *
   * Appended rather than always present, so every line already sitting in a
   * customer's persisted cart keeps the exact key it was written with. A key
   * format that changed shape would orphan those lines — the stepper and the
   * remove button both address a line by key, and they would quietly stop
   * working on the contents of a bag somebody filled last week.
   */
  key: string;
  productId: string;
  /** The resolved trade item: the variant's SKU, or the product's if simple. */
  sku: string;
  gtin?: string;
  slug: string;
  title: Localized;
  image: ProductImage;
  /**
   * A simple product has no options. Rather than invent a fake colour, both
   * ids are the empty string and the UI omits the option line entirely.
   */
  colorId: string;
  colorName: Localized;
  sizeId: string;
  sizeLabel: string;
  /**
   * The chosen artwork, carried all the way to the packing slip.
   *
   * The whole point of the axis: whoever pulls the order has to know *which*
   * embroidery, and "Bone / M" on four different tees does not tell them.
   */
  designId?: string;
  designName?: Localized;
  unitPrice: number;
  compareAtPrice?: number;
  currency: CurrencyCode;
  quantity: number;
  /**
   * The lower of remaining stock and the product's per-order cap — already
   * resolved, so the quantity stepper never has to know which one bit.
   */
  maxQuantity: number;
  /**
   * Why `maxQuantity` is what it is. The stepper shows "Limit 1 per order"
   * rather than "Only 1 left" when the cap is a policy and not scarcity —
   * telling a customer something is nearly sold out when it is not is a lie
   * the cart should not tell.
   */
  maxReason?: "stock" | "per-order";
  /** Drives shipping surcharges at checkout. */
  shippingClassId?: string;
  addedAt: number;
}

export type ShippingSpeed = "standard" | "express" | "same-day" | "pickup";

/**
 * A shipping class groups products that cost the same to move.
 *
 * Without classes, a rate is either one flat price — which loses money on a
 * coat and overcharges for a tee — or a per-product price, which nobody
 * maintains. A class is the middle: tag the product once, price the class.
 *
 * Surcharges stack on top of the chosen method's own price:
 *   - `surcharge` applies **once per order** if any line carries the class.
 *     Use it for handling that does not repeat: one oversized box.
 *   - `perItemSurcharge` applies **per unit**. Use it for weight.
 * When several classes are in one basket, every class contributes; the order
 * surcharge is counted once per class, not once per line.
 */
export interface ShippingClass {
  id: string;
  name: Localized;
  description?: Localized;
  /** Charged once per order when at least one line carries this class. */
  surcharge: number;
  /** Charged for every unit of every line carrying this class. */
  perItemSurcharge: number;
  /**
   * Speeds this class cannot use at all. A rolled coat does not go on a
   * same-day bike; the method disappears rather than failing at the door.
   */
  excludedSpeeds: ShippingSpeed[];
  /**
   * When true, a basket containing this class never qualifies for the free
   * shipping threshold — the point of the class is that it is expensive.
   */
  ignoresFreeThreshold: boolean;
  order: number;
}

export interface ShippingMethod {
  id: string;
  speed: ShippingSpeed;
  name: Localized;
  description?: Localized;
  price: number;
  /** Business days. `pickup` uses 0. */
  minDays: number;
  maxDays: number;
  /** Free once the subtotal clears this threshold. */
  freeAbove?: number;
  /**
   * Per-class price overrides, by class id. A class listed here replaces
   * `price` for the whole order rather than adding to it — for the cases
   * where a carrier quotes a flat bulky rate instead of a surcharge.
   */
  classPriceOverrides?: Record<string, number>;
}

/** What a quote actually resolved to, so the UI can explain the number. */
export interface ShippingQuote {
  method: ShippingMethod;
  /** The method's own price after any class override. */
  base: number;
  /** Sum of class surcharges applied. */
  surcharge: number;
  /** Final price. `0` when the free threshold applied. */
  total: number;
  freeApplied: boolean;
  /** Class ids that contributed a surcharge, for the breakdown tooltip. */
  classIds: string[];
  /** Set when the method is unavailable for this basket. */
  unavailableReason?: "class-excluded";
}

export interface CartTotals {
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  currency: CurrencyCode;
}

/* -------------------------------------------------------------------------- */
/*  Orders                                                                    */
/* -------------------------------------------------------------------------- */

export type OrderStatus =
  | "pending"
  | "paid"
  | "processing"
  | "packed"
  | "shipped"
  | "out-for-delivery"
  | "delivered"
  | "cancelled"
  | "refunded";

export type PaymentMethod = "card" | "apple-pay" | "google-pay" | "cod" | "cliq";

export interface OrderEvent {
  status: OrderStatus;
  at: number;
  note?: Localized;
  /** Free-text location for the tracking timeline. */
  location?: string;
}

export interface Order {
  id: string;
  /** Human-readable, e.g. `NS-7K4M2X`. Shown to the customer, not the doc id. */
  reference: string;
  uid: string;
  email: string;

  items: CartItem[];
  totals: CartTotals;

  shippingAddress: Address;
  billingAddress?: Address;
  shippingMethod: ShippingMethod;

  appliedOfferCode?: string;
  paymentMethod: PaymentMethod;
  /** Gateway reference. Never contains card data. */
  paymentIntentId?: string;

  status: OrderStatus;
  timeline: OrderEvent[];
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDeliveryAt?: number;

  createdAt: number;
  updatedAt: number;
}

/* -------------------------------------------------------------------------- */
/*  AI fitting room                                                           */
/* -------------------------------------------------------------------------- */

export interface OutfitSlotItem {
  productId: string;
  slug: string;
  title: Localized;
  image: ProductImage;
  colorId: string;
  sizeId: string;
  price: number;
}

export type OutfitSlot = "outerwear" | "top" | "bottom" | "shoes" | "accessory";

/** A saved look — the unit the fitting room composes, shares and adds to cart. */
export interface Outfit {
  id: string;
  uid: string;
  name?: string;
  items: Partial<Record<OutfitSlot, OutfitSlotItem>>;
  /** Storage path of the generated try-on render, if one was produced. */
  renderPath?: string;
  createdAt: number;
}

/**
 * `outcome` exists so the UI never has to infer "we don't know" from a number.
 *
 * A recommendation that always names a size is a recommendation that lies at
 * the edges: someone whose chest is 10cm past the largest size was previously
 * told "XL" with a low confidence score the layout rendered as a pale chip.
 * The four states are distinct answers, and each gets its own wording:
 *
 *   recommended  a size that genuinely matches
 *   between      two sizes are equally close — the customer chooses
 *   no-size      nothing in this product's range fits; say so plainly
 *   unmeasured   nothing to score against, either no size table or no body
 */
export type FitOutcome = "recommended" | "between" | "no-size" | "unmeasured";

export interface FitRecommendation {
  productId: string;
  /** Empty string when `outcome` is `no-size` — there is nothing to add. */
  recommendedSizeId: string;
  /** 0-1. Below 0.6 the UI shows a "between sizes" state instead of a size. */
  confidence: number;
  outcome: FitOutcome;
  /**
   * How far the best size sits from ideal — lower is closer.
   *
   * Deliberately **not** called centimetres. It is a weighted penalty across
   * the measurements that matter for the department, with the tight side
   * multiplied because a garment that will not close is worse than a roomy
   * one. Quoting it to a customer as "12cm out" would be inventing a tape
   * measurement nobody took. Use it for ranking and tests, not for copy.
   */
  deviation?: number;
  rationale: Localized;
  alternativeSizeId?: string;
}

/* -------------------------------------------------------------------------- */
/*  Misc                                                                      */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*  Reviews                                                                   */
/* -------------------------------------------------------------------------- */

export type ReviewStatus = "published" | "pending" | "hidden";

/**
 * A customer review.
 *
 * Deliberately a different type from `Testimonial`, which is marketing copy
 * the shop wrote about itself. Mixing the two would let a hand-written quote
 * count toward a product's average rating, which is the difference between a
 * rating and an advertisement.
 *
 * Reviews are **never edited by staff**. Moderation can hide one and record
 * why, and can reply to it in the shop's own voice — but the customer's words
 * and their star count are theirs. An admin who can rewrite a two-star review
 * into a five-star one has turned the whole system into decoration.
 */
export interface Review {
  id: string;
  productId: string;
  uid: string;
  /** Display name at the time of writing; a later rename must not rewrite history. */
  authorName: string;
  rating: 1 | 2 | 3 | 4 | 5;
  title?: string;
  body: string;
  images: ProductImage[];

  /**
   * Set when the reviewer has a delivered order containing this product.
   * Resolved server-side at submission and stored, not recomputed on read —
   * an order archived later must not silently strip the badge.
   */
  verifiedPurchase: boolean;
  /** The order that proved it. Never shown to other customers. */
  verifiedOrderId?: string;

  status: ReviewStatus;
  /**
   * Why a review was hidden. Shown to the author, never to other shoppers —
   * they do not need to know a removed review existed, and the author does.
   */
  moderationNote?: string;
  moderatedBy?: string;
  moderatedAt?: number;

  /** The shop's public answer, in the shop's voice, clearly attributed. */
  reply?: {
    body: string;
    authorName: string;
    at: number;
  };

  /** Other customers marking it useful. Sorting only; never affects the average. */
  helpfulCount: number;

  createdAt: number;
  updatedAt: number;
}

/** What a product page needs to render its rating block. */
export interface ReviewSummary {
  productId: string;
  average: number;
  count: number;
  /** Index 0 is one star, index 4 is five. */
  distribution: [number, number, number, number, number];
  verifiedCount: number;
}

/* -------------------------------------------------------------------------- */
/*  Gift campaign                                                             */
/* -------------------------------------------------------------------------- */

export type GiftGameKind = "wheel" | "scratch";

/**
 * One prize slot in a campaign.
 *
 * `weight` is a relative share, not a percentage: percentages have to sum to
 * 100 and a merchant editing one of five prizes will not keep them summing.
 * Weights are normalised at draw time, so any set of numbers is valid.
 */
export interface GiftPrize {
  id: string;
  label: Localized;
  /**
   * What the winner gets. `none` is a real, necessary outcome — a campaign
   * where every spin wins is a discount, not a game, and hiding the losing
   * slice would make the wheel a lie.
   */
  reward: "percentage" | "fixed" | "free-shipping" | "none";
  value: number;
  /** Cap on a percentage reward, in store currency. */
  maxDiscount?: number;
  /** Days the issued coupon stays valid. */
  validForDays: number;
  minSubtotal?: number;

  weight: number;
  /** Total that may ever be issued. Undefined is unlimited. */
  quantity?: number;
  /** Issued so far. Incremented inside the draw transaction. */
  issued: number;
}

export interface GiftCampaign {
  id: string;
  name: Localized;
  kind: GiftGameKind;
  prizes: GiftPrize[];

  startsAt: number;
  endsAt: number;
  /** Hours a customer must wait between attempts. */
  cooldownHours: number;
  /** Lifetime attempts per account. Undefined is unlimited (subject to cooldown). */
  maxAttempts?: number;

  /** Terms shown before playing and on the issued gift. */
  terms?: Localized;
  status: "draft" | "active" | "paused" | "archived";
  createdAt?: number;
  updatedAt?: number;
}

/**
 * One play, and its outcome.
 *
 * Written **before** the winning animation runs. The browser is told what it
 * won; it is never asked. A client that could choose its own prize, or replay
 * a draw by refreshing, is not a game — and the record has to exist first so
 * that a network failure mid-animation cannot produce a win nobody issued.
 */
export interface GiftPlay {
  id: string;
  campaignId: string;
  uid: string;
  prizeId: string;
  /** The coupon issued, when the prize was not `none`. */
  offerId?: string;
  code?: string;
  expiresAt?: number;
  playedAt: number;
}

/* -------------------------------------------------------------------------- */
/*  Analytics                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What a visitor has agreed to.
 *
 * Two separate consents, because they are two different asks. Behavioural
 * analytics is about how the shop is used; fitting-room processing sends a
 * photograph of a person's body to a machine. Bundling them would mean a
 * shopper who wants size help has also agreed to be tracked, which is not
 * consent in any sense that matters.
 */
export interface ConsentState {
  /** Strictly necessary is not listed: it needs no consent and cannot be declined. */
  analytics: boolean;
  /** Separate, and only asked for at the point the fitting room needs it. */
  fittingRoom: boolean;
  /** When the choice was made, so a policy change can re-ask. */
  decidedAt: number;
  /** The version of the policy that was agreed to. */
  version: number;
}

export type AnalyticsEventName =
  | "page_view"
  | "product_view"
  | "category_view"
  | "search"
  | "search_no_results"
  | "filter_apply"
  | "wishlist_add"
  | "wishlist_remove"
  | "cart_add"
  | "cart_remove"
  | "checkout_start"
  | "purchase"
  | "coupon_apply"
  | "coupon_reject"
  | "gift_play"
  | "fitting_room_open"
  | "recommendation_click";

/**
 * One recorded event.
 *
 * `anonymousId` is a random per-browser value, not a hash of anything about
 * the person: a hashed email is still an identifier, and pretending otherwise
 * is how "anonymous" analytics end up re-identifiable.
 *
 * `props` is deliberately narrow. Nothing here may carry an address, a
 * measurement, a payment detail or an image — the event writer strips unknown
 * keys rather than trusting callers, because the one time a caller passes the
 * whole cart object is the time an address ends up in the analytics store.
 */
export interface AnalyticsEvent {
  id: string;
  name: AnalyticsEventName;
  anonymousId: string;
  /** Present only for signed-in sessions, and only with analytics consent. */
  uid?: string;
  sessionId: string;
  at: number;
  path: string;
  device: "mobile" | "tablet" | "desktop";
  /** `utm_source` or the referring host. Never a full referrer URL. */
  source?: string;
  props?: Record<string, string | number | boolean>;
}

/** One step of the conversion funnel, for the admin report. */
export interface FunnelStep {
  name: string;
  label: Localized;
  count: number;
  /** Fraction of the step before it. 1 for the first. */
  conversion: number;
}

export interface Testimonial {
  id: string;
  name: string;
  handle?: string;
  avatar?: ProductImage;
  quote: Localized;
  rating: 1 | 2 | 3 | 4 | 5;
  productId?: string;
  verified: boolean;
}

export interface SortOption {
  id: "featured" | "newest" | "price-asc" | "price-desc" | "rating";
  label: Localized;
}

export interface ProductFilters {
  /**
   * Matches against `Product.categoryPath`, so passing a parent id returns
   * everything in its subcategories too.
   */
  categoryIds?: string[];
  productTypes?: ProductType[];
  shippingClassIds?: string[];
  colorIds?: string[];
  sizeIds?: string[];
  minPrice?: number;
  maxPrice?: number;
  badges?: ProductBadge[];
  inStockOnly?: boolean;
  sort?: SortOption["id"];
}

/* -------------------------------------------------------------------------- */
/*  Support                                                                   */
/* -------------------------------------------------------------------------- */

export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketTopic =
  | "delivery"
  | "returns"
  | "sizing"
  | "payment"
  | "product"
  | "other";

export interface TicketMessage {
  id: string;
  /** `customer` or a staff uid. */
  authorId: string;
  authorName: string;
  fromStaff: boolean;
  body: string;
  at: number;
}

export interface SupportTicket {
  id: string;
  reference: string;
  uid: string | null;
  customerName: string;
  email: string;
  subject: string;
  topic: TicketTopic;
  status: TicketStatus;
  priority: TicketPriority;
  /** Linked order, when the ticket is about one. */
  orderReference?: string;
  messages: TicketMessage[];
  assignedTo?: string;
  createdAt: number;
  updatedAt: number;
  /** Minutes from creation to the first staff reply — the metric that matters. */
  firstResponseMinutes?: number;
}

/* -------------------------------------------------------------------------- */
/*  Invoicing                                                                 */
/* -------------------------------------------------------------------------- */

export type InvoiceStatus = "draft" | "issued" | "paid" | "credited";

/**
 * An invoice is a *record of what was billed*, not a view of the order.
 *
 * It snapshots the seller details, tax rate and line prices at issue time, so a
 * later price change or a VAT rate change can never alter a document that has
 * already been sent to a customer or filed with an accountant.
 */
export interface Invoice {
  id: string;
  /** Sequential and gapless — required by most tax authorities. */
  number: string;
  orderId: string;
  orderReference: string;
  status: InvoiceStatus;

  issuedAt: number;
  dueAt?: number;
  paidAt?: number;

  billTo: {
    name: string;
    email: string;
    phone?: string;
    line1: string;
    line2?: string;
    city: string;
    countryCode: string;
    taxNumber?: string;
  };

  lines: {
    description: Localized;
    sku: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[];

  subtotal: number;
  discount: number;
  shipping: number;
  taxRate: number;
  tax: number;
  total: number;
  currency: CurrencyCode;

  paymentMethod: PaymentMethod;
  notes?: Localized;
}

/* -------------------------------------------------------------------------- */
/*  Analytics                                                                 */
/* -------------------------------------------------------------------------- */

export interface TimeseriesPoint {
  /** Epoch ms at the start of the bucket. */
  t: number;
  revenue: number;
  orders: number;
  units: number;
}

export interface AdminKpi {
  revenue: number;
  orders: number;
  units: number;
  averageOrderValue: number;
  /** Fractional change against the preceding window of equal length. */
  revenueChange: number;
  ordersChange: number;
  aovChange: number;
  currency: CurrencyCode;
}

export interface ProductPerformance {
  productId: string;
  slug: string;
  title: Localized;
  image?: ProductImage;
  units: number;
  revenue: number;
  orders: number;
}

export interface CategoryPerformance {
  categoryId: string;
  units: number;
  revenue: number;
}
