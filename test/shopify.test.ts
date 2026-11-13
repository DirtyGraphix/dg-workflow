import { describe, expect, it } from "vitest";
import { mapShopifyOrder, parseFinish } from "../src/worker/lib/shopify";
import { sampleShopifyOrder } from "./fixtures";

const settings = { rushTags: ["rush"], dealerTags: ["dealer", "dealer-b2b"], customTags: ["custom-one-off"] };

describe("parseFinish", () => {
  it("prefers the longest finish name", () => {
    expect(parseFinish("Full wrap kit / Chrome Gloss")).toBe("CG");
    expect(parseFinish("Gloss")).toBe("GL");
    expect(parseFinish("chrome-prismatic")).toBe("CP");
    expect(parseFinish("Gravel Guard")).toBe("GG");
    expect(parseFinish("Black")).toBeNull();
  });
});

describe("mapShopifyOrder", () => {
  const mapped = mapShopifyOrder(sampleShopifyOrder(), settings);

  it("turns each wrap line item into a machine and skips everything else", () => {
    expect(mapped.machines.map((m) => [m.machine, m.kit, m.finish])).toEqual([
      ["John Deere 325G", "Full wrap kit", "CG"],
      ["CAT 259D3", "Full wrap kit", "GL"],
    ]);
  });

  it("keeps customizer selections and pulls file links out as uploads", () => {
    expect(mapped.machines[0].selections).toEqual([
      { name: "Design", value: "Stripe Pack 2" },
      { name: "Colors", value: "Black, Safety Orange" },
    ]);
    expect(mapped.uploads).toEqual([{ name: "logo", url: "https://cdn.example.com/uploads/logo-front.png" }]);
  });

  it("never carries a price", () => {
    const text = JSON.stringify(mapped);
    for (const amount of ["1890", "1850", "1100", "750", "40.00", "35.00"]) expect(text).not.toContain(amount);
    expect(mapped.paymentStatus).toBe("paid");
  });

  it("reads customer and shipping details", () => {
    expect(mapped.orderNumber).toBe("#4820");
    expect(mapped.customerName).toBe("Rick Hanson");
    expect(mapped.company).toBe("R. Hanson Excavating");
    expect(mapped.shipMethod).toBe("UPS Ground");
    expect(mapped.shipTo).toContain("Stillwater, MN 55082");
  });

  it("flags rush, dealer and custom one-off orders", () => {
    const rush = mapShopifyOrder(sampleShopifyOrder({ tags: "Rush" }), settings);
    expect(rush.isRush).toBe(true);
    const rushItem = mapShopifyOrder(
      sampleShopifyOrder({ line_items: [...sampleShopifyOrder().line_items, { id: 9, title: "Rush Order Upgrade", properties: [] }] }),
      settings,
    );
    expect(rushItem.isRush).toBe(true);
    const dealer = mapShopifyOrder(sampleShopifyOrder({ customer: { first_name: "D", tags: "dealer-b2b" } }), settings);
    expect(dealer.isDealer).toBe(true);
    const custom = mapShopifyOrder(
      sampleShopifyOrder({ line_items: [{ id: 1, title: "Custom One-Off Machine Wrap", variant_title: "Matte", properties: [] }] }),
      settings,
    );
    expect(custom.isCustom).toBe(true);
    expect(custom.customReason).toMatch(/product name/i);
    expect(mapped.isRush || mapped.isDealer || mapped.isCustom).toBe(false);
  });
});
