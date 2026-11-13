import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sampleShopifyOrder, signWebhook } from "./fixtures";

type Json = Record<string, any>;

class Client {
  cookie = "";
  async req(method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
    const res = await SELF.fetch(`https://dg.test${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {} };
  }
}

async function sendWebhook(topic: string, payload: unknown) {
  const body = JSON.stringify(payload);
  return SELF.fetch("https://dg.test/webhooks/shopify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-topic": topic,
      "x-shopify-hmac-sha256": await signWebhook(body, env.SHOPIFY_WEBHOOK_SECRET),
    },
    body,
  });
}

const ty = new Client();
const cierra = new Client();
const alissa = new Client();
const andrew = new Client();
let alissaId = 0;
let andrewId = 0;

beforeAll(async () => {
  expect((await ty.req("POST", "/api/setup", { token: "test-setup-token", name: "TY", email: "ty@test", password: "a-long-password" })).status).toBe(201);
  const make = async (name: string, email: string, role: string, takesOrders: boolean) =>
    (await ty.req("POST", "/api/people", { name, email, role, takesOrders, password: "a-long-password" })).json.id as number;
  await make("Cierra", "cierra@test", "lead", true);
  alissaId = await make("Alissa", "alissa@test", "designer", true);
  andrewId = await make("Andrew", "andrew@test", "designer", true);
  await cierra.req("POST", "/api/login", { email: "cierra@test", password: "a-long-password" });
  await alissa.req("POST", "/api/login", { email: "alissa@test", password: "a-long-password" });
  await andrew.req("POST", "/api/login", { email: "andrew@test", password: "a-long-password" });
});

describe("logins", () => {
  it("only allows setup once", async () => {
    const again = await new Client().req("POST", "/api/setup", { token: "test-setup-token", name: "X", email: "x@test", password: "a-long-password" });
    expect(again.status).toBe(409);
  });

  it("rejects bad passwords and unauthenticated calls", async () => {
    expect((await new Client().req("POST", "/api/login", { email: "alissa@test", password: "wrong-password" })).status).toBe(401);
    expect((await new Client().req("GET", "/api/queue")).status).toBe(401);
  });

  it("keeps designers out of assignment", async () => {
    expect((await alissa.req("GET", "/api/assign")).status).toBe(403);
  });
});

describe("Shopify webhook", () => {
  it("rejects unsigned requests", async () => {
    const res = await SELF.fetch("https://dg.test/webhooks/shopify", {
      method: "POST",
      headers: { "x-shopify-topic": "orders/create", "x-shopify-hmac-sha256": "bad" },
      body: JSON.stringify(sampleShopifyOrder()),
    });
    expect(res.status).toBe(401);
  });

  it("creates an order once, even if Shopify sends it twice", async () => {
    expect((await sendWebhook("orders/create", sampleShopifyOrder())).status).toBe(201);
    expect((await sendWebhook("orders/create", sampleShopifyOrder())).status).toBe(200);
    const { n } = (await env.DB.prepare("SELECT COUNT(*) AS n FROM orders").first<{ n: number }>())!;
    expect(n).toBe(1);
  });
});

describe("an order from intake to hand-off", () => {
  let orderId = 0;
  let machineIds: number[] = [];

  it("shows up for assignment with a suggested designer", async () => {
    const board = await cierra.req("GET", "/api/assign");
    expect(board.status).toBe(200);
    expect(board.json.unassigned).toHaveLength(1);
    orderId = board.json.unassigned[0].order.id;
    expect(board.json.unassigned[0].suggestedId).toBeTruthy();
    expect(board.json.workload.map((w: Json) => w.name)).toEqual(["Alissa", "Andrew", "Cierra"]);
  });

  it("skips designers who are out today", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
    await cierra.req("POST", `/api/people/${andrewId}/time-off`, { startsOn: today, endsOn: today, kind: "sick" });
    const board = await cierra.req("GET", "/api/assign");
    expect(board.json.workload.find((w: Json) => w.name === "Andrew").out).toBe(true);
    expect(board.json.unassigned[0].suggestedId).not.toBe(andrewId);
  });

  it("is assigned and lands in the designer's first-proof group", async () => {
    expect((await cierra.req("POST", `/api/orders/${orderId}/assign`, { personId: alissaId })).status).toBe(200);
    const q = await alissa.req("GET", "/api/queue");
    const first = q.json.groups.find((g: Json) => g.key === "needs_first_proof");
    expect(first.orders.map((o: Json) => o.id)).toEqual([orderId]);
    expect(q.json.stats.ordersThisMonth).toBe(1);
    expect((await andrew.req("GET", `/api/orders/${orderId}`)).status).toBe(403);
  });

  it("never sends a price to design", async () => {
    const d = await alissa.req("GET", `/api/orders/${orderId}`);
    expect(d.status).toBe(200);
    const text = JSON.stringify(d.json);
    for (const amount of ["1890", "1850", "1100", "750"]) expect(text).not.toContain(amount);
    expect(text).not.toMatch(/price/i);
    expect(d.json.paymentStatus).toBe("paid");
    machineIds = d.json.machines.map((m: Json) => m.id);
    expect(d.json.machines.map((m: Json) => m.finish)).toEqual(["CG", "GL"]);
  });

  it("moves through proof, change request and partial approval", async () => {
    await alissa.req("POST", `/api/orders/${orderId}/proof-sent`, { via: "approve_pro" });
    let d = await alissa.req("POST", `/api/orders/${orderId}/request-changes`, { method: "phone", note: "Move the logo up" });
    expect(d.json.stage).toBe("revision_requested");
    await alissa.req("POST", `/api/orders/${orderId}/proof-sent`, { via: "approve_pro" });
    expect((await alissa.req("POST", `/api/orders/${orderId}/approve`, { method: "phone", note: "" })).status).toBe(400);
    d = await alissa.req("POST", `/api/orders/${orderId}/approve`, { machineIds: [machineIds[0]], method: "phone", note: "Approved the Deere on the phone" });
    expect(d.json.stage).toBe("proof_sent");
    expect(d.json.machines[0].printFileDue).toBeTruthy();
    expect(d.json.machines[1].printFileDue).toBeNull();
    d = await alissa.req("POST", `/api/orders/${orderId}/approve`, { machineIds: [machineIds[1]], method: "text", note: "Approved the CAT by text" });
    expect(d.json.stage).toBe("approved");
  });

  it("asks 'are you sure' when a length is far from the usual", async () => {
    // Three past hand-offs of the same machine and kit average 600 in full size.
    for (const n of [1, 2, 3]) {
      const o = await env.DB.prepare("INSERT INTO orders (source, order_number, ordered_at, stage) VALUES ('manual', ?, ?, 'handed_off') RETURNING id")
        .bind(`#H${n}`, new Date().toISOString())
        .first<{ id: number }>();
      await env.DB.prepare("INSERT INTO machines (order_id, machine, kit, finish, quarter_length_in, handed_off_at) VALUES (?, 'John Deere 325G', 'Full wrap kit', 'CG', 150, ?)")
        .bind(o!.id, new Date().toISOString())
        .run();
    }
    const tooLong = await alissa.req("PUT", `/api/machines/${machineIds[0]}/length`, { quarterLength: 180 });
    expect(tooLong.status).toBe(409);
    expect(tooLong.json.data.lengthCheck).toMatchObject({ direction: "over", averageIn: 600, pctOff: 20 });
    const confirmed = await alissa.req("PUT", `/api/machines/${machineIds[0]}/length`, { quarterLength: 180, reason: "Added extra pieces" });
    expect(confirmed.status).toBe(200);
    expect((await alissa.req("PUT", `/api/machines/${machineIds[1]}/length`, { quarterLength: 135 })).status).toBe(200);
  });

  it("won't hand off until the checklist is signed", async () => {
    expect((await alissa.req("POST", `/api/orders/${orderId}/hand-off`, {})).status).toBe(409);
    const items = (await alissa.req("GET", `/api/orders/${orderId}`)).json.checklist.items.map((i: Json) => i.id);
    expect((await alissa.req("POST", `/api/orders/${orderId}/checklist`, { itemIds: items.slice(0, 1) })).status).toBe(400);
    const signed = await alissa.req("POST", `/api/orders/${orderId}/checklist`, { itemIds: items });
    expect(signed.json.checklist.signedBy).toBe("Alissa");
  });

  it("hands off and leaves the designer's queue", async () => {
    const res = await alissa.req("POST", `/api/orders/${orderId}/hand-off`, { productionNote: "Print panel 4 twice" });
    expect(res.status).toBe(200);
    expect(res.json.allDone).toBe(true);
    expect(res.json.order.stage).toBe("handed_off");
    expect(res.json.order.machines.map((m: Json) => m.fullLengthIn)).toEqual([720, 540]);
    const q = await alissa.req("GET", "/api/queue");
    expect(q.json.groups.flatMap((g: Json) => g.orders)).toHaveLength(0);
    expect(q.json.stats.handedOffThisMonth).toBe(1);
  });
});

describe("manual jobs and print file pauses", () => {
  it("creates a manual job with its machines", async () => {
    const res = await cierra.req("POST", "/api/orders/manual", {
      sourceSystem: "Phone order",
      orderNumber: "P-118",
      customerName: "Jamie Lee",
      isRush: true,
      machines: [{ machine: "Bobcat T770", kit: "Doors only", finish: "MT" }],
    });
    expect(res.status).toBe(201);
    const d = await cierra.req("GET", `/api/orders/${res.json.id}`);
    expect(d.json.source).toBe("manual");
    expect(d.json.isRush).toBe(true);
    expect(d.json.printFileDays).toBe(1);
  });

  it("requires a reason to pause the print file deadline and logs it", async () => {
    const id = (await cierra.req("POST", "/api/orders/manual", {
      sourceSystem: "Phone order",
      orderNumber: "P-119",
      customerName: "Sam",
      machines: [{ machine: "CAT 289D3", finish: "GL" }],
    })).json.id;
    await cierra.req("POST", `/api/orders/${id}/assign`, { personId: alissaId });
    await alissa.req("POST", `/api/orders/${id}/approve`, { method: "phone", note: "Approved by phone" });
    expect((await alissa.req("POST", `/api/orders/${id}/print-file/pause`, { reason: " " })).status).toBe(400);
    const paused = await alissa.req("POST", `/api/orders/${id}/print-file/pause`, { reason: "Waiting on a vector logo from the dealer" });
    expect(paused.json.printFilePause.by).toBe("Alissa");
    const resumed = await alissa.req("POST", `/api/orders/${id}/print-file/resume`);
    expect(resumed.json.printFilePause).toBeNull();
    expect(resumed.json.timeline.map((e: Json) => e.kind)).toEqual(expect.arrayContaining(["print_file_paused", "print_file_resumed"]));
  });
});
