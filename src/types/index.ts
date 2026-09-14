/**
 * THE JO — domain model.
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
export interface ProductVariant {
  /** Stable SKU, also used as the Firestore document id in `variants`. */
  sku: string;
  colorId: string;
  sizeId: string;
  stock: number;
  /** Overrides the parent price when this permutation is priced differently. */
  priceOverride?: number;
  barcode?: string;
}

export type ProductBadge =
  | "new"
  | "bestseller"
  | "limited"
  | "last-pieces"
  | "exclusive"
  | "restocked";

export interface Product {
  id: string;
  /** URL key. Lowercase, hyphenated, immutable once published. */
  slug: string;
  title: Localized;
  subtitle?: Localized;
  description: Localized;
  /** Short bullet list for the details accordion — care, fabric, origin. */
  details?: { label: Localized; value: Localized }[];

  categoryId: string;
  /** Denormalised ancestry, so a listing can filter without extra reads. */
  categoryPath: string[];
  collectionIds: string[];
  tags: string[];

  /** Minor units are avoided: prices are decimal in the store currency. */
  price: number;
  compareAtPrice?: number;
  currency: CurrencyCode;

  images: ProductImage[];
  colors: ProductColor[];
  sizes: ProductSize[];
  sizeSystem: SizeSystem;

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

export interface Category {
  id: string;
  slug: string;
  name: Localized;
  description?: Localized;
  parentId: string | null;
  image?: ProductImage;
  /** Manual merchandising order, ascending. */
  order: number;
  productCount: number;
  featured: boolean;
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

export type BannerTone = "ink" | "violet" | "sand" | "paper";

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
  media?: ProductImage;
  /** Renders as a countdown when set; the card self-hides once passed. */
  startsAt?: number;
  endsAt?: number;
  /** Higher sorts first within a slot. */
  priority: number;
  /** Relative width in the promo rail grid: 1 = standard, 2 = wide. */
  span?: 1 | 2;
  active: boolean;
}

export type OfferType = "percentage" | "fixed" | "free-shipping" | "bundle";

export interface Offer {
  id: string;
  code: string;
  type: OfferType;
  /** Percent (0-100) for `percentage`, currency amount for `fixed`. */
  value: number;
  title: Localized;
  description?: Localized;
  minSubtotal?: number;
  /** Empty arrays mean "applies to everything". */
  appliesToCategoryIds: string[];
  appliesToProductIds: string[];
  startsAt: number;
  endsAt: number;
  usageLimit?: number;
  usageCount: number;
  perUserLimit?: number;
  active: boolean;
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
  /** `${productId}:${colorId}:${sizeId}` — stable, so quantity merges. */
  key: string;
  productId: string;
  sku: string;
  slug: string;
  title: Localized;
  image: ProductImage;
  colorId: string;
  colorName: Localized;
  sizeId: string;
  sizeLabel: string;
  unitPrice: number;
  compareAtPrice?: number;
  currency: CurrencyCode;
  quantity: number;
  maxQuantity: number;
  addedAt: number;
}

export type ShippingSpeed = "standard" | "express" | "same-day" | "pickup";

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
  /** Human-readable, e.g. `JO-7K4M2X`. Shown to the customer, not the doc id. */
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

export interface FitRecommendation {
  productId: string;
  recommendedSizeId: string;
  /** 0-1. Below 0.6 the UI shows a "between sizes" state instead of a size. */
  confidence: number;
  rationale: Localized;
  alternativeSizeId?: string;
}

/* -------------------------------------------------------------------------- */
/*  Misc                                                                      */
/* -------------------------------------------------------------------------- */

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
  categoryIds?: string[];
  colorIds?: string[];
  sizeIds?: string[];
  minPrice?: number;
  maxPrice?: number;
  badges?: ProductBadge[];
  inStockOnly?: boolean;
  sort?: SortOption["id"];
}
