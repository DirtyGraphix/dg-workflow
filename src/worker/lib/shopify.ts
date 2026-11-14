// Turns a Shopify order webhook into an order, its design jobs and its ship-only items.
//
// How Dirty Graphix orders look (checked against real orders, Nov 2026):
// - Wrap kits are products titled "... Wrap Kits". The variant is the design and coverage
//   ("CUSTOM ONE-OFF / Full (Pictured)") or, on limited-edition kits, the machine model ("SVL110-3").
// - The product options app (Globo) adds the customer's choices as line item properties
//   ("Finish Options", "Year", "Base", "Custom Text", logo uploads) and adds paid options as their own
//   line items linked to the kit by "_gpo_parent_product_group" (e.g. "Finish", "Application Kit").
// - Sheetz arrive as option lines ("Sheetz Size" 4x4) with their finish on a separate line ("4x4 Finishes").
//   They are their own design job and get customer proofs like wrap kits.
// - Contractor Grade Decals are designed and proofed.
// - Matching Wrapped Yetis are printed at the end of the run with the approved machine design.
//   They need a print length but no proof, and the customer never sees them.
// - Application kits, ADHESOFF, apparel and similar products skip design and just ship.
// - The new product page (product-page-v2, live on the CAT 255/250 from Nov 14, 2026) replaces Globo.
//   It links option lines with "_dg_group" / "_dg_parent_group" / "_dg_field", puts the chosen model in a
//   "Model" property, and adds the finish as priced lines ("Wrap Finish", "Print Material") carrying
//   "_dg_finish". Machine options with a price ("Model Options", e.g. Hydraulic Guard) are part of the kit.
//
// Hard rule: no price, total or amount is ever copied out of the Shopify payload. Option values like
// "Gravel Guard [$0.31]" have the bracketed price removed. Only the payment *status* is kept.

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
  /** Line item titles that are wrap kits (design with customer proofs). */
  kitPatterns: string[];
  /** Line item titles that are Sheetz (their own design job, proofed like wrap kits). */
  sheetzPatterns: string[];
  /** Other products that need design with proofs (e.g. decals). */
  otherDesignPatterns: string[];
  /** Printed with the order using the approved machine design, no proof (e.g. matching Yetis). */
  matchingPatterns: string[];
  /** Priced option lines that are part of the kit's design, not something that ships (e.g. "Model Options"). */
  optionPatterns: string[];
}

export const DEFAULT_INTAKE: IntakeSettings = {
  rushTags: ["rush"],
  dealerTags: ["dealer", "dealer-b2b"],
  customTags: ["custom-one-off"],
  kitPatterns: ["wrap kit"],
  sheetzPatterns: ["sheetz"],
  otherDesignPatterns: ["decals"],
  matchingPatterns: ["matching wrapped"],
  optionPatterns: ["model options"],
};

export type JobKind = "kit" | "sheetz" | "design" | "matching";

export interface MappedMachine {
  shopifyLineId: string;
  kind: JobKind;
  needsProof: boolean;
  machine: string;
  kit: string | null;
  finish: FinishCode | null;
  selections: { name: string; value: string }[];
}

export interface MappedShipItem {
  shopifyLineId: string;
  title: string;
  variant: string | null;
  quantity: number;
  /** The design job this was added to, e.g. an application kit added on a wrap kit. */
  attachedToLineId: string | null;
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
  shipItems: MappedShipItem[];
}

type Prop = { name?: string; value?: unknown };
type Shopify = Record<string, any>;

// Property names that carry a field we pull out on its own.
const FINISH_KEYS = ["finish", "finish options", "finish option", "laminate"];
// Properties the designer doesn't need to see.
const HIDDEN_KEYS = ["model/year check"];
const BRANDS = [
  "John Deere", "Bobcat", "CAT", "Caterpillar", "Kubota", "JCB", "Takeuchi", "Case", "New Holland", "Gehl", "Volvo",
  "ASV", "Yanmar", "Komatsu", "Hitachi", "Kioti", "Mustang", "Wacker Neuson", "Develon", "Doosan", "Toro", "Vermeer",
];

const clean = (s: unknown): string | null => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t ? t : null;
};
/** Removes prices the options app puts in values, e.g. "Gravel Guard [$0.31]". */
export const stripPrices = (s: string) => s.replace(/\s*\[\s*[+-]?\$[^\]]*\]/g, "").trim();
const splitTags = (tags: unknown): string[] =>
  String(tags ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
const hasAny = (tags: string[], wanted: string[]) => wanted.some((w) => tags.includes(w.toLowerCase()));
const isUrl = (v: string) => /^https?:\/\//i.test(v);
const matches = (text: string, patterns: string[]) => patterns.some((p) => p && text.toLowerCase().includes(p.toLowerCase()));
const props = (item: Shopify): Prop[] => (Array.isArray(item.properties) ? item.properties : []);
function prop(item: Shopify, key: string): string | null {
  const p = props(item).find((x) => String(x.name ?? "").trim().toLowerCase() === key.toLowerCase());
  return p ? clean(p.value) : null;
}
const variantSegments = (item: Shopify): string[] =>
  String(item.variant_title ?? "")
    .split(" / ") // Shopify joins options with " / "; values like "1/2 Gal" keep their slash
    .map((s) => s.trim())
    .filter((s) => s && !/default title$/i.test(s));
const isRushItem = (item: Shopify) => /\brush\b/i.test(`${item.title ?? ""} ${item.variant_title ?? ""}`);
const isFinishLine = (item: Shopify) => /\bfinish(es)?\b/i.test(String(item.title ?? "")) && !!parseFinish(item.variant_title);
// Globo and the new product page link option lines to their kit in the same way, under different names.
const groupOf = (item: Shopify) => prop(item, "_gpo_product_group") ?? prop(item, "_dg_group");
const parentGroupOf = (item: Shopify) => prop(item, "_gpo_parent_product_group") ?? prop(item, "_dg_parent_group");
const fieldOf = (item: Shopify) => prop(item, "_gpo_field_name") ?? prop(item, "_dg_field");
const MODEL_CODE = /^[A-Z]{1,5}[\s-]?\d{2,4}[A-Z0-9-]*$/i;

/** "2025+ Bobcat T770/S770 Wrap Kits" → "Bobcat T770/S770" */
function cleanKitTitle(title: string): string {
  return title
    .replace(/\bwrap\s*kits?\b/gi, "")
    .replace(/^\s*\d{4}\s*(\+|-\s*\d{4})?\s*/, "")
    .replace(/\s+-\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function kitIdentity(item: Shopify, kind: JobKind): { machine: string; kit: string | null } {
  const title = clean(item.title) ?? "Unknown";
  const segs = variantSegments(item);
  if (kind === "sheetz") return { machine: `Sheetz${segs.length ? ` ${segs.join(" / ")}` : ""}`, kit: "Sheetz" };
  if (kind === "design" || kind === "matching") return { machine: title, kit: segs.length ? segs.join(" / ") : null };
  // New product page: the customer picks the exact model ("CAT 250" on the CAT 255/250 page).
  const picked = prop(item, "Model");
  if (picked) {
    const brand = BRANDS.find((b) => new RegExp(`\\b${b}\\b`, "i").test(title));
    const machine = brand && !new RegExp(`\\b${brand}\\b`, "i").test(picked) ? `${brand} ${picked}` : picked;
    return { machine, kit: segs.length ? segs.join(" / ") : null };
  }
  const model = segs.find((s) => MODEL_CODE.test(s));
  if (model) {
    // Limited-edition kits: the variant is the machine model and the product is the kit.
    const brand = BRANDS.find((b) => new RegExp(`\\b${b}\\b`, "i").test(title));
    const rest = segs.filter((s) => s !== model);
    return { machine: `${brand ?? ""} ${model}`.trim(), kit: [cleanKitTitle(title), ...rest].filter(Boolean).join(" / ") };
  }
  return { machine: cleanKitTitle(title) || title, kit: segs.length ? segs.join(" / ") : null };
}

function selectionsFor(item: Shopify): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const modelIsMachine = !!prop(item, "Model");
  for (const p of props(item)) {
    let name = String(p.name ?? "").trim();
    const raw = clean(p.value);
    if (!name || !raw || name.startsWith("_") || isUrl(raw)) continue;
    const lower = name.toLowerCase();
    if (FINISH_KEYS.includes(lower) || HIDDEN_KEYS.includes(lower)) continue;
    if (lower === "model" && modelIsMachine) continue; // already the machine name
    const value = stripPrices(raw);
    if (!value || /add application kit/i.test(value)) continue; // shown as a ship item instead
    if (/^(radio|buttons|dropdown|checkbox|select)-\d+$/i.test(name)) name = "Option";
    out.push({ name, value });
  }
  return out;
}

function formatAddress(a: Shopify | null | undefined): string | null {
  if (!a) return null;
  const line = [a.address1, a.address2].filter(Boolean).join(", ");
  const city = [a.city, [a.province_code ?? a.province, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.name, a.company, line, city, a.country_code ?? a.country].filter(Boolean).join(" · ") || null;
}

export function mapShopifyOrder(o: Shopify, settings: IntakeSettings = DEFAULT_INTAKE): MappedOrder {
  const items: Shopify[] = Array.isArray(o.line_items) ? o.line_items : [];
  const orderTags = splitTags(o.tags);
  const customerTags = splitTags(o.customer?.tags);
  const allTags = [...orderTags, ...customerTags];

  const machines: MappedMachine[] = [];
  const shipItems: MappedShipItem[] = [];
  const byGroup = new Map<string, MappedMachine>(); // options-app group id → design job
  const finishLines: Shopify[] = [];
  const children: Shopify[] = [];

  // Pass 1: design jobs.
  for (const item of items) {
    const title = String(item.title ?? "");
    if (parentGroupOf(item)) {
      children.push(item);
      continue;
    }
    if (isRushItem(item)) continue;
    const kind: JobKind | null = matches(title, settings.matchingPatterns)
      ? "matching"
      : matches(title, settings.sheetzPatterns)
      ? "sheetz"
      : matches(title, settings.kitPatterns)
        ? "kit"
        : matches(title, settings.otherDesignPatterns)
          ? "design"
          : null;
    if (!kind) {
      if (isFinishLine(item)) finishLines.push(item);
      else shipItems.push({ shopifyLineId: String(item.id), title: clean(title) ?? "Item", variant: clean(variantSegments(item).join(" / ")), quantity: Number(item.quantity ?? 1), attachedToLineId: null });
      continue;
    }
    const finishProp = FINISH_KEYS.map((k) => prop(item, k)).find(Boolean);
    const id = kitIdentity(item, kind);
    const machine: MappedMachine = {
      shopifyLineId: String(item.id),
      kind,
      needsProof: kind !== "matching",
      machine: id.machine,
      kit: id.kit,
      finish: parseFinish(finishProp ? stripPrices(finishProp) : null) ?? (kind === "kit" ? parseFinish(item.variant_title) ?? parseFinish(title) : null),
      selections: [...selectionsFor(item), ...(Number(item.quantity ?? 1) > 1 ? [{ name: "Quantity", value: String(item.quantity) }] : [])],
    };
    const group = groupOf(item);
    if (group) byGroup.set(group, machine);
    machines.push(machine);
  }

  // Pass 2: option lines linked to a design job (Finish, Application Kit, Model Options, ...).
  for (const child of children) {
    const parent = byGroup.get(parentGroupOf(child)!);
    const fieldName = fieldOf(child) ?? "";
    const field = fieldName.toLowerCase();
    // The new page names the finish outright; its "Print Material" line is the same finish, priced separately.
    const namedFinish = prop(child, "_dg_finish");
    const finish = parseFinish(namedFinish) ?? parseFinish(child.variant_title);
    if (namedFinish || (finish && (field.includes("finish") || /finish/i.test(String(child.title ?? ""))))) {
      if (parent && !parent.finish) parent.finish = finish;
      continue;
    }
    if (isRushItem(child)) continue;
    // Priced machine options (e.g. Hydraulic Guard) are part of the kit's design, not a separate item.
    if (matches(String(child.title ?? ""), settings.optionPatterns)) {
      const value = clean(variantSegments(child).join(" / ")) ?? clean(child.title) ?? "Yes";
      const name = fieldName || clean(child.title) || "Option";
      if (parent && !parent.selections.some((s) => s.name.toLowerCase() === name.toLowerCase() || s.value.toLowerCase() === value.toLowerCase())) {
        parent.selections.push({ name, value: stripPrices(value) });
      }
      continue;
    }
    shipItems.push({
      shopifyLineId: String(child.id),
      title: clean(child.title) ?? "Item",
      variant: clean(variantSegments(child).join(" / ")),
      quantity: Number(child.quantity ?? 1),
      attachedToLineId: parent?.shopifyLineId ?? null,
    });
  }

  // Finish lines that aren't linked (e.g. "4x4 Finishes" for Sheetz) go to the first job still missing one, Sheetz first.
  for (const line of finishLines) {
    const target = machines.find((m) => m.kind === "sheetz" && !m.finish) ?? machines.find((m) => !m.finish);
    if (target) target.finish = parseFinish(line.variant_title);
  }

  // Matching items (Yetis) print in the finish of the machine they match.
  const firstKit = machines.find((m) => m.kind === "kit" && m.finish);
  for (const m of machines) if (m.kind === "matching" && !m.finish && firstKit) m.finish = firstKit.finish;

  const uploads: { name: string; url: string }[] = [];
  for (const item of items) {
    for (const p of props(item)) {
      const v = clean(p.value);
      if (v && isUrl(v)) uploads.push({ name: String(p.name ?? "File").replace(/^_+/, ""), url: v });
    }
  }

  const customByTag = hasAny(orderTags, settings.customTags);
  const customByName = items.some((i) => /custom\s*one[\s-]*off/i.test(`${i.title ?? ""} ${i.variant_title ?? ""}`));
  const customer = o.customer ?? {};
  const ship = o.shipping_address ?? null;
  const first = clean(customer.first_name ?? ship?.first_name);
  const last = clean(customer.last_name ?? ship?.last_name);

  return {
    shopifyOrderId: String(o.id),
    orderNumber: clean(o.name) ?? String(o.order_number ?? o.id),
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
    customReason: customByTag ? "Shopify tag" : customByName ? "Ordered as a custom one-off" : null,
    machines,
    shipItems,
  };
}
