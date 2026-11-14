import { describe, expect, it } from "vitest";
import { mapShopifyOrder, parseFinish, stripPrices, DEFAULT_INTAKE } from "../src/worker/lib/shopify";
import { newPageShopifyOrder, sampleShopifyOrder, sheetzShopifyOrder, shipOnlyShopifyOrder } from "./fixtures";

describe("parseFinish and stripPrices", () => {
  it("prefers the longest finish name", () => {
    expect(parseFinish("Full wrap kit / Chrome Gloss")).toBe("CG");
    expect(parseFinish("Gloss")).toBe("GL");
    expect(parseFinish("chrome-prismatic")).toBe("CP");
    expect(parseFinish("GRAVEL GUARD BLACKOUT - Kubota")).toBe("GG");
    expect(parseFinish("Black")).toBeNull();
  });

  it("removes the options app's bracketed prices", () => {
    expect(stripPrices("Gravel Guard [$0.31]")).toBe("Gravel Guard");
    expect(stripPrices("Height: 6in | Width: 8in [$48.00]")).toBe("Height: 6in | Width: 8in");
  });
});

describe("a wrap kit order with option lines", () => {
  const m = mapShopifyOrder(sampleShopifyOrder());

  it("makes one design job per wrap kit, with machine, kit and finish", () => {
    expect(m.machines.map((x) => [x.kind, x.machine, x.kit, x.finish, x.needsProof])).toEqual([
      ["kit", "Bobcat T770/S770", "CUSTOM ONE-OFF / Full (Pictured)", "MT", true],
      ["kit", "JCB 4TS-8T", "DIGITAL_CAMO", "GG", true],
    ]);
  });

  it("keeps the customer's choices but drops internal fields, boilerplate and prices", () => {
    expect(m.machines[0].selections).toEqual([
      { name: "Year", value: "2023" },
      { name: "Option", value: "Wheeled" },
      { name: "Color Option", value: "Choose my own" },
      { name: "Base", value: "Hot Pink" },
      { name: "Accent 1", value: "Black" },
      { name: "Custom Text", value: "HANSON EXCAVATING" },
    ]);
    expect(m.uploads).toEqual([{ name: "Logo Upload-1", url: "https://uploads.example.com/logo-front.ai" }]);
  });

  it("lists application kits and other products as ship-only items", () => {
    expect(m.shipItems.map((i) => [i.title, i.attachedToLineId])).toEqual([
      ["ADHESOFF™", null],
      ["Application Kit", "9001"],
    ]);
  });

  it("flags custom one-offs from the variant", () => {
    expect(m.isCustom).toBe(true);
    expect(m.customReason).toMatch(/custom one-off/i);
  });

  it("never carries a price", () => {
    const text = JSON.stringify(m);
    for (const amount of ["3890", "3850", "1999", "1499", "125.00", "69.95", "24.95", "40.00", "0.31", "$"]) expect(text).not.toContain(amount);
    expect(m.paymentStatus).toBe("paid");
  });

  it("reads customer and shipping details", () => {
    expect(m.orderNumber).toBe("514860001");
    expect(m.customerName).toBe("Rick Hanson");
    expect(m.company).toBe("R. Hanson Excavating");
    expect(m.shipMethod).toBe("Standard");
    expect(m.shipTo).toContain("Stillwater, MN 55082");
  });
});

describe("limited editions and Sheetz", () => {
  const m = mapShopifyOrder(sheetzShopifyOrder());

  it("uses the variant as the machine on limited-edition kits", () => {
    expect(m.machines[0]).toMatchObject({ kind: "kit", machine: "Kubota SVL110-3", kit: "GRAVEL GUARD BLACKOUT - Kubota Limited Edition", finish: "GG" });
  });

  it("turns Sheetz into their own design job with proofs, with the finish from its finish line", () => {
    expect(m.machines[1]).toMatchObject({ kind: "sheetz", machine: "Sheetz 4x4", finish: "GG", needsProof: true });
    expect(m.shipItems).toEqual([]);
  });
});

describe("ship-only orders and flags", () => {
  it("has no design jobs when the order is only an application kit", () => {
    const m = mapShopifyOrder(shipOnlyShopifyOrder());
    expect(m.machines).toEqual([]);
    expect(m.shipItems.map((i) => i.title)).toEqual(["Application Kit"]);
  });

  it("sends decals to design with proofs, keeping size and quantity but not prices", () => {
    const decals = {
      ...shipOnlyShopifyOrder(),
      line_items: [
        {
          id: 1,
          title: "Contractor Grade Decals",
          variant_title: "opc-Default Title",
          quantity: 10,
          properties: [
            { name: "_SKU", value: "opc-1" },
            { name: "Finish", value: "Gravel Guard [$0.31]" },
            { name: "Gravel Guard Sizing", value: "Height: 6in | Width: 8in [$48.00]" },
          ],
        },
      ],
    };
    const m = mapShopifyOrder(decals);
    expect(m.machines[0]).toMatchObject({ kind: "design", machine: "Contractor Grade Decals", kit: null, finish: "GG", needsProof: true });
    expect(m.machines[0].selections).toEqual([
      { name: "Gravel Guard Sizing", value: "Height: 6in | Width: 8in" },
      { name: "Quantity", value: "10" },
    ]);
    expect(mapShopifyOrder(decals, { ...DEFAULT_INTAKE, otherDesignPatterns: [] }).machines).toHaveLength(0);
  });

  it("adds a matching Yeti as a print item with no proof, in its machine's finish", () => {
    const order = sampleShopifyOrder();
    order.line_items.push({ id: 9010, title: "Matching Wrapped Yeti", variant_title: "Silo Jug 1/2 Gal", price: "149.00", quantity: 1, properties: [] });
    const yeti = mapShopifyOrder(order).machines.find((x) => x.kind === "matching")!;
    expect(yeti).toMatchObject({ machine: "Matching Wrapped Yeti", kit: "Silo Jug 1/2 Gal", needsProof: false, finish: "MT" });
  });

  it("flags rush and dealer orders", () => {
    expect(mapShopifyOrder(sampleShopifyOrder({ tags: "Rush" })).isRush).toBe(true);
    const withRushLine = sampleShopifyOrder();
    withRushLine.line_items.push({ id: 9, title: "Rush Order Upgrade", variant_title: null, price: "99", quantity: 1, properties: [] });
    const rush = mapShopifyOrder(withRushLine);
    expect(rush.isRush).toBe(true);
    expect(rush.shipItems.map((i) => i.title)).not.toContain("Rush Order Upgrade");
    expect(mapShopifyOrder(sampleShopifyOrder({ customer: { first_name: "D", tags: "dealer-b2b" } })).isDealer).toBe(true);
  });
});

describe("orders from the new product page (CAT 255/250, product-page-v2)", () => {
  const m = mapShopifyOrder(newPageShopifyOrder());

  it("names the machine from the model the customer picked, with the finish from the page", () => {
    expect(m.machines).toHaveLength(1);
    expect(m.machines[0]).toMatchObject({ kind: "kit", machine: "CAT 250", kit: "CYNICAL / Full (pictured)", finish: "CM", needsProof: true });
  });

  it("keeps machine options on the kit and doesn't ship finish or option price lines", () => {
    const names = m.machines[0].selections.map((s) => s.name);
    expect(names).toEqual(["Year", "Hydraulic guard/cover", "Color Options", "Custom Text", "Font", "Text Location", "Message", "Base", "Accent 1"]);
    expect(m.shipItems.map((i) => [i.title, i.attachedToLineId])).toEqual([["Application Kit", "9100"]]);
  });

  it("lists the customer's logos from DG's own storage as uploads", () => {
    expect(m.uploads.map((u) => u.name)).toEqual(["Logo 1", "Logo 2"]);
    expect(m.uploads[0].url).toMatch(/^https:\/\/dirtygraphix\.com\/apps\/designer\/asset\/uploads\//);
  });

  it("never carries a price", () => {
    const text = JSON.stringify(m);
    for (const amount of ["1299", "49.00", "$"]) expect(text).not.toContain(amount);
  });
});
