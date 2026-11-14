// Shopify orders/create payloads shaped like real Dirty Graphix orders (Nov 2026), with made-up
// customers and values. Prices are included on purpose: tests check that none of them leak.

const customer = (first: string, last: string, tags = "") => ({ first_name: first, last_name: last, email: `${first.toLowerCase()}@example.com`, tags });
const address = (name: string, company?: string) => ({
  name,
  company,
  address1: "100 Main St",
  city: "Stillwater",
  province_code: "MN",
  zip: "55082",
  country_code: "US",
  phone: "+16515550100",
});

/** A custom one-off Bobcat and a JCB kit, with finish and application kit option lines and ADHESOFF. */
export function sampleShopifyOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 5550001,
    name: "514860001",
    order_number: 514860001,
    created_at: "2026-11-03T15:12:00Z",
    email: "rick@example.com",
    financial_status: "paid",
    total_price: "3890.00",
    subtotal_price: "3850.00",
    tags: "",
    note: "Company name on both cab doors.",
    customer: customer("Rick", "Hanson"),
    shipping_address: address("Rick Hanson", "R. Hanson Excavating"),
    shipping_lines: [{ title: "Standard", price: "40.00" }],
    line_items: [
      {
        id: 9001,
        title: "2025+ Bobcat T770/S770 Wrap Kits",
        variant_title: "CUSTOM ONE-OFF / Full (Pictured)",
        price: "1999.00",
        quantity: 1,
        properties: [
          { name: "_has_gpo", value: "1378906" },
          { name: "Year", value: "2023" },
          { name: "radio-3", value: "Wheeled" },
          { name: "Color Option", value: "Choose my own" },
          { name: "Base", value: "Hot Pink" },
          { name: "Accent 1", value: "Black" },
          { name: "Finish Options", value: "Matte" },
          { name: "Custom Text", value: "HANSON EXCAVATING" },
          { name: "buttons-1", value: "Yes! Add Application Kit" },
          { name: "model/year check", value: "I confirm I have selected my exact model and year." },
          { name: "_gpo_product_group", value: "111" },
        ],
      },
      {
        id: 9002,
        title: "Finish",
        variant_title: "Matte",
        sku: "finm",
        price: "125.00",
        quantity: 1,
        properties: [
          { name: "_gpo_parent_product_group", value: "111" },
          { name: "_gpo_field_name", value: "Finish Options" },
        ],
      },
      {
        id: 9003,
        title: "Application Kit",
        variant_title: null,
        sku: "appkit",
        price: "69.95",
        quantity: 1,
        properties: [
          { name: "_gpo_parent_product_group", value: "111" },
          { name: "_gpo_field_name", value: "buttons-1" },
        ],
      },
      {
        id: 9004,
        title: "JCB 4TS-8T Wrap Kits",
        variant_title: "DIGITAL_CAMO",
        price: "1499.00",
        quantity: 1,
        properties: [
          { name: "_has_gpo", value: "780423" },
          { name: "Year", value: "2025" },
          { name: "Finish Options", value: "Gravel Guard [$0.31]" },
          { name: "Logo Upload-1", value: "https://uploads.example.com/logo-front.ai" },
          { name: "Message", value: "Logo in white and orange" },
          { name: "_gpo_product_group", value: "222" },
        ],
      },
      { id: 9005, title: "ADHESOFF™", variant_title: null, price: "24.95", quantity: 1, properties: [] },
    ],
    ...overrides,
  };
}

/** A limited-edition Kubota kit where the variant is the machine, plus a Sheetz 4x4 in Gravel Guard. */
export function sheetzShopifyOrder() {
  return {
    id: 5550002,
    name: "514860002",
    created_at: "2026-11-04T15:00:00Z",
    financial_status: "paid",
    total_price: "3559.80",
    tags: "",
    customer: customer("Chad", "Example"),
    shipping_address: address("Chad Example"),
    shipping_lines: [{ title: "Standard" }],
    line_items: [
      { id: 9101, title: "GRAVEL GUARD BLACKOUT - Kubota Limited Edition Wrap Kits", variant_title: "SVL110-3", price: "1499.00", quantity: 1, properties: [] },
      { id: 9102, title: "4x4 Finishes", variant_title: "Gravel Guard", price: "60.00", quantity: 1, properties: [] },
      { id: 9103, title: "Sheetz Size", variant_title: "4x4", price: "199.00", quantity: 1, properties: [] },
    ],
  };
}

/** An application kit on its own: nothing to design. */
export function shipOnlyShopifyOrder() {
  return {
    id: 5550003,
    name: "514860003",
    created_at: "2026-11-05T15:00:00Z",
    financial_status: "paid",
    total_price: "69.95",
    customer: customer("Travis", "Example"),
    shipping_address: address("Travis Example"),
    line_items: [{ id: 9201, title: "Application Kit", variant_title: null, sku: "appkit", price: "69.95", quantity: 1, properties: [] }],
  };
}

export async function signWebhook(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return btoa(String.fromCharCode(...sig));
}

/**
 * An order from the new product page (product-page-v2), shaped like test order 514863586 on the
 * CAT 255/250 page (Nov 14, 2026), with the personal details replaced.
 */
export function newPageShopifyOrder() {
  const group = "1794655511018";
  const child = (id: number, title: string, variant: string | null, extra: { name: string; value: string }[] = []) => ({
    id,
    title,
    variant_title: variant,
    price: "49.00",
    quantity: 1,
    properties: [{ name: "_dg_parent_group", value: group }, ...extra],
  });
  return {
    id: 5550100,
    name: "514869100",
    created_at: "2026-11-14T11:27:57Z",
    email: "pat@example.com",
    financial_status: "paid",
    tags: "",
    customer: { first_name: "Pat", last_name: "Sample", email: "pat@example.com", tags: "" },
    shipping_address: { name: "Pat Sample", address1: "1 Test Rd", city: "Stillwater", province_code: "MN", zip: "55082", country_code: "US" },
    shipping_lines: [{ title: "Standard" }],
    line_items: [
      child(9101, "Model Options", "Hydraulic Guard", [{ name: "_dg_field", value: "Hydraulic guard/cover" }]),
      child(9102, "Application Kit", null, [{ name: "_dg_field", value: "Application Kit" }]),
      child(9103, "Wrap Finish", "Matte — Equipment Chrome Vinyl", [
        { name: "_dg_field", value: "Finish Options" },
        { name: "_dg_finish", value: "Chrome Matte" },
        { name: "Machine", value: "CAT 255/250 Wrap Kits" },
      ]),
      child(9104, "Print Material", "Equipment Chrome Vinyl", [
        { name: "_dg_field", value: "Finish Options" },
        { name: "_dg_finish", value: "Chrome Matte" },
        { name: "Machine", value: "CAT 255/250 Wrap Kits" },
      ]),
      {
        id: 9100,
        title: "CAT 255/250 Wrap Kits",
        variant_title: "CYNICAL / Full (pictured)",
        price: "1299.00",
        quantity: 1,
        properties: [
          { name: "Model", value: "CAT 250" },
          { name: "Year", value: "2024" },
          { name: "Hydraulic guard/cover", value: "Add hydraulic guard/cover" },
          { name: "Color Options", value: "Choose my own" },
          { name: "Custom Text", value: "SAMPLE CO" },
          { name: "Font", value: "Anton" },
          { name: "Text Location", value: "Arm / Boom" },
          { name: "Application Kit", value: "Yes! Add Application Kit" },
          { name: "Message", value: "Let me know if something looks off." },
          { name: "model/year check", value: "I confirm I have selected my exact model and year." },
          { name: "Finish Options", value: "Chrome Matte" },
          { name: "Base", value: "Sunburst Yellow" },
          { name: "Accent 1", value: "Violet Purple" },
          { name: "Logo 1", value: "https://dirtygraphix.com/apps/designer/asset/uploads/00000000-0000-0000-0000-000000000001/logo.png" },
          { name: "Logo 2", value: "https://dirtygraphix.com/apps/designer/asset/uploads/00000000-0000-0000-0000-000000000002/logo.pdf" },
          { name: "_dg_group", value: group },
          { name: "_dg_source", value: "product-page-v2" },
        ],
      },
    ],
  };
}
