// Turns a Shopify order webhook into an order and its machines.
//
// Hard rule: no price, total or amount is ever copied out of the Shopify payload.
// Only the payment *status* (paid, pending...) is kept.

export const FINISHES = {
  GL: "Gloss",
  MT: "Matte",
  GG: "Gravel Guard",
  CG: "Chrome Gloss",
  PR: "Prismatic",
  CM: "Chrome Matte",
  CP: "Chrome Prismatic",
} as const;
export type FinishCode = keyof typeof FINISHES;

// Longest names first so "Chrome Gloss" never matches as plain "Gloss".
const FINISH_MATCHERS: [FinishCode, RegExp][] = (Object.entries(FINISHES) as [FinishCode, string][])
  .sort((a, b) => b[1].length - a[1].length)
  .map(([code, name]) => [code, new RegExp(`\\b${name.replace(/ /g, "[\\s-]*")}\\b`, "i")]);

export function parseFinish(text: string | null | undefined): FinishCode | null {
  if (!text) return null;
  for (const [code, re] of FINISH_MATCHERS) if (re.test(text)) return code;
  return null;
}

/** Checks that a webhook really came from Shopify (HMAC-SHA256 of the raw body). */
export async function verifyShopifyWebhook(rawBody: ArrayBuffer, hmacHeader: string | null, secret: string): Promise<boolean> {
  if (!hmacHeader || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  const expected = btoa(String.fromCharCode(...sig));
  return timingSafeEqual(expected, hmacHeader.trim());
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface IntakeSettings {
  rushTags: string[];
  dealerTags: string[];
  customTags: string[];
}

export interface MappedMachine {
  shopifyLineId: string;
  machine: string;
  kit: string | null;
  finish: FinishCode | null;
  selections: { name: string; value: string }[];
}

export interface MappedOrder {
  shopifyOrderId: string;
  orderNumber: string;
  orderedAt: string;
  customerName: string | null;
  company: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  shipTo: string | null;
  shipMethod: string | null;
  orderNote: string | null;
  uploads: { name: string; url: string }[];
  paymentStatus: string;
  isRush: boolean;
  isDealer: boolean;
  isCustom: boolean;
  customReason: string | null;
  machines: MappedMachine[];
}

// Line item property names the customizer may use for these fields.
const MACHINE_KEYS = ["machine", "equipment", "machine model"];
const KIT_KEYS = ["kit", "kit type", "coverage"];
const FINISH_KEYS = ["finish", "laminate"];

type Prop = { name?: string; value?: unknown };
type Shopify = Record<string, any>;

const clean = (s: unknown): string | null => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t ? t : null;
};
const splitTags = (tags: unknown): string[] =>
  String(tags ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
const hasAny = (tags: string[], wanted: string[]) => wanted.some((w) => tags.includes(w.toLowerCase()));
const isUrl = (v: string) => /^https?:\/\//i.test(v);

function propValue(props: Prop[], keys: string[]): string | null {
  for (const p of props) {
    const n = String(p.name ?? "").trim().toLowerCase();
    if (keys.includes(n)) return clean(p.value);
  }
  return null;
}

function optionValue(item: Shopify, keys: string[]): string | null {
  // Variant options arrive as "variant_options" on some payloads and inside "variant_title" on all.
  const opts: unknown = item.variant_options;
  if (Array.isArray(opts)) {
    for (const o of opts as Shopify[]) {
      if (keys.includes(String(o.name ?? "").toLowerCase())) return clean(o.value);
    }
  }
  return null;
}

/** True when a line item is a rush add-on rather than a machine. */
function isRushItem(item: Shopify): boolean {
  return /\brush\b/i.test(String(item.title ?? "")) || /\brush\b/i.test(String(item.name ?? ""));
}

function mapMachine(item: Shopify): MappedMachine | null {
  const props: Prop[] = Array.isArray(item.properties) ? item.properties : [];
  const variantTitle = clean(item.variant_title);
  const finish =
    parseFinish(propValue(props, FINISH_KEYS)) ??
    parseFinish(optionValue(item, FINISH_KEYS)) ??
    parseFinish(variantTitle) ??
    parseFinish(item.title);
  const machineFromProps = propValue(props, MACHINE_KEYS);
  // Only line items that carry a finish or a machine are machines. Hats, decals and add-ons are skipped.
  if (!finish && !machineFromProps) return null;

  let kit = propValue(props, KIT_KEYS) ?? optionValue(item, KIT_KEYS);
  if (!kit && variantTitle) {
    const rest = variantTitle
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s && !parseFinish(s));
    kit = rest.length ? rest.join(" / ") : null;
  }

  const ignored = new Set([...MACHINE_KEYS, ...KIT_KEYS, ...FINISH_KEYS]);
  const selections = props
    .filter((p) => {
      const n = String(p.name ?? "").trim();
      return n && !n.startsWith("_") && !ignored.has(n.toLowerCase()) && clean(p.value) && !isUrl(String(p.value));
    })
    .map((p) => ({ name: String(p.name).trim(), value: String(p.value).trim() }));

  return {
    shopifyLineId: String(item.id),
    machine: machineFromProps ?? clean(item.title) ?? "Unknown machine",
    kit,
    finish,
    selections,
  };
}

function formatAddress(a: Shopify | null | undefined): string | null {
  if (!a) return null;
  const line = [a.address1, a.address2].filter(Boolean).join(", ");
  const city = [a.city, [a.province_code ?? a.province, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.name, a.company, line, city, a.country_code ?? a.country].filter(Boolean).join(" · ") || null;
}

export function mapShopifyOrder(o: Shopify, settings: IntakeSettings): MappedOrder {
  const items: Shopify[] = Array.isArray(o.line_items) ? o.line_items : [];
  const orderTags = splitTags(o.tags);
  const customerTags = splitTags(o.customer?.tags);
  const allTags = [...orderTags, ...customerTags];

  const machines = items.map(mapMachine).filter((m): m is MappedMachine => m !== null);

  const uploads: { name: string; url: string }[] = [];
  for (const item of items) {
    for (const p of (Array.isArray(item.properties) ? item.properties : []) as Prop[]) {
      const v = clean(p.value);
      if (v && isUrl(v)) uploads.push({ name: String(p.name ?? "File").replace(/^_+/, ""), url: v });
    }
  }

  const customByTag = hasAny(orderTags, settings.customTags);
  const customByName = items.some((i) => /custom\s*one[\s-]*off/i.test(String(i.title ?? "")));
  const customer = o.customer ?? {};
  const ship = o.shipping_address ?? null;
  const first = clean(customer.first_name ?? ship?.first_name);
  const last = clean(customer.last_name ?? ship?.last_name);

  return {
    shopifyOrderId: String(o.id),
    orderNumber: clean(o.name) ?? `#${o.order_number ?? o.id}`,
    orderedAt: new Date(o.created_at ?? Date.now()).toISOString(),
    customerName: [first, last].filter(Boolean).join(" ") || clean(ship?.name),
    company: clean(ship?.company ?? o.billing_address?.company),
    customerEmail: clean(o.email ?? customer.email),
    customerPhone: clean(o.phone ?? customer.phone ?? ship?.phone),
    shipTo: formatAddress(ship),
    shipMethod: clean(Array.isArray(o.shipping_lines) && o.shipping_lines[0]?.title),
    orderNote: clean(o.note),
    uploads,
    paymentStatus: clean(o.financial_status) ?? "unknown",
    isRush: hasAny(allTags, settings.rushTags) || items.some(isRushItem),
    isDealer: hasAny(allTags, settings.dealerTags),
    isCustom: customByTag || customByName,
    customReason: customByTag ? "Shopify tag" : customByName ? "Product name says custom one-off" : null,
    machines,
  };
}
