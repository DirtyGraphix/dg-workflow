// A Shopify orders/create payload shaped like a two-machine Dirty Graphix order.
// Prices are included on purpose: tests check that none of them leak into the app.
export function sampleShopifyOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 5550001,
    name: "#4820",
    order_number: 4820,
    created_at: "2026-11-03T15:12:00Z",
    email: "customer@example.com",
    phone: "+16515550100",
    financial_status: "paid",
    total_price: "1890.00",
    subtotal_price: "1850.00",
    tags: "",
    note: "Company name on both cab doors.",
    customer: { first_name: "Rick", last_name: "Hanson", email: "customer@example.com", tags: "" },
    shipping_address: {
      name: "Rick Hanson",
      company: "R. Hanson Excavating",
      address1: "100 Main St",
      city: "Stillwater",
      province_code: "MN",
      zip: "55082",
      country_code: "US",
      phone: "+16515550100",
    },
    shipping_lines: [{ title: "UPS Ground", price: "40.00" }],
    line_items: [
      {
        id: 9001,
        title: "John Deere 325G",
        variant_title: "Full wrap kit / Chrome Gloss",
        price: "1100.00",
        properties: [
          { name: "Design", value: "Stripe Pack 2" },
          { name: "Colors", value: "Black, Safety Orange" },
          { name: "_logo", value: "https://cdn.example.com/uploads/logo-front.png" },
          { name: "_price_breakdown", value: "1100" },
        ],
      },
      {
        id: 9002,
        title: "CAT 259D3",
        variant_title: "Full wrap kit / Gloss",
        price: "750.00",
        properties: [{ name: "Design", value: "Stripe Pack 2" }],
      },
      { id: 9003, title: "Trucker Hat", variant_title: "Black", price: "35.00", properties: [] },
    ],
    ...overrides,
  };
}

export async function signWebhook(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return btoa(String.fromCharCode(...sig));
}
