import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sampleShopifyOrder, sheetzShopifyOrder, shipOnlyShopifyOrder, signWebhook } from "./fixtures";

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
    for (const amount of ["3890", "3850", "1999", "1499", "69.95", "0.31", "$"]) expect(text).not.toContain(amount);
    expect(text).not.toMatch(/price/i);
    expect(d.json.paymentStatus).toBe("paid");
    machineIds = d.json.machines.map((m: Json) => m.id);
    expect(d.json.machines.map((m: Json) => m.finish)).toEqual(["MT", "GG"]);
    expect(d.json.shipItems.map((i: Json) => i.title)).toEqual(["ADHESOFF™", "Application Kit"]);
    expect(d.json.isCustom).toBe(true);
    expect(d.json.printFileDays).toBe(5);
  });

  it("moves through proof, change request and partial approval", async () => {
    await alissa.req("POST", `/api/orders/${orderId}/proof-sent`, { via: "approve_pro" });
    let d = await alissa.req("POST", `/api/orders/${orderId}/request-changes`, { method: "phone", note: "Move the logo up" });
    expect(d.json.stage).toBe("revision_requested");
    await alissa.req("POST", `/api/orders/${orderId}/proof-sent`, { via: "approve_pro" });
    expect((await alissa.req("POST", `/api/orders/${orderId}/approve`, { method: "phone", note: "" })).status).toBe(400);
    d = await alissa.req("POST", `/api/orders/${orderId}/approve`, { machineIds: [machineIds[0]], method: "phone", note: "Approved the Bobcat on the phone" });
    expect(d.json.stage).toBe("proof_sent");
    expect(d.json.machines[0].printFileDue).toBeTruthy();
    expect(d.json.machines[1].printFileDue).toBeNull();
    d = await alissa.req("POST", `/api/orders/${orderId}/approve`, { machineIds: [machineIds[1]], method: "text", note: "Approved the JCB by text" });
    expect(d.json.stage).toBe("approved");
  });

  it("asks 'are you sure' when a length is far from the usual", async () => {
    // Three past hand-offs of the same machine and kit average 600 in full size.
    for (const n of [1, 2, 3]) {
      const o = await env.DB.prepare("INSERT INTO orders (source, order_number, ordered_at, stage) VALUES ('manual', ?, ?, 'handed_off') RETURNING id")
        .bind(`#H${n}`, new Date().toISOString())
        .first<{ id: number }>();
      await env.DB.prepare("INSERT INTO machines (order_id, machine, kit, finish, quarter_length_in, handed_off_at) VALUES (?, 'Bobcat T770/S770', 'CUSTOM ONE-OFF / Full (Pictured)', 'MT', 150, ?)")
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

describe("Sheetz and ship-only orders", () => {
  it("sends an application-kit-only order straight to production", async () => {
    expect((await sendWebhook("orders/create", shipOnlyShopifyOrder())).status).toBe(201);
    const board = await cierra.req("GET", "/api/assign");
    expect(board.json.unassigned.map((u: Json) => u.order.orderNumber)).not.toContain("514860003");
    const row = await env.DB.prepare("SELECT stage FROM orders WHERE order_number = '514860003'").first<{ stage: string }>();
    expect(row!.stage).toBe("ship_only");
  });

  it("gives Sheetz their own job that goes through proofs like the kit", async () => {
    expect((await sendWebhook("orders/create", sheetzShopifyOrder())).status).toBe(201);
    const board = await cierra.req("GET", "/api/assign");
    const id = board.json.unassigned.find((u: Json) => u.order.orderNumber === "514860002").order.id;
    await cierra.req("POST", `/api/orders/${id}/assign`, { personId: alissaId });
    const d = await alissa.req("GET", `/api/orders/${id}`);
    expect(d.json.stage).toBe("needs_first_proof");
    expect(d.json.machines.map((m: Json) => [m.kind, m.machine, m.needsProof, m.approvedAt])).toEqual([
      ["kit", "Kubota SVL110-3", true, null],
      ["sheetz", "Sheetz 4x4", true, null],
    ]);
  });
});

describe("matching Yetis", () => {
  it("approves the Yeti along with the last machine design and needs its own length", async () => {
    const order = sampleShopifyOrder({ id: 5550009, name: "514860009" });
    order.line_items.push({ id: 9910, title: "Matching Wrapped Yeti", variant_title: "Silo Jug 1/2 Gal", price: "149.00", quantity: 1, properties: [] });
    await sendWebhook("orders/create", order);
    const board = await cierra.req("GET", "/api/assign");
    const id = board.json.unassigned.find((u: Json) => u.order.orderNumber === "514860009").order.id;
    await cierra.req("POST", `/api/orders/${id}/assign`, { personId: alissaId });
    let d = await alissa.req("GET", `/api/orders/${id}`);
    const [bobcat, jcb, yeti] = d.json.machines;
    expect(yeti).toMatchObject({ kind: "matching", needsProof: false, approvedAt: null });
    d = await alissa.req("POST", `/api/orders/${id}/approve`, { machineIds: [bobcat.id], method: "phone", note: "Bobcat approved" });
    expect(d.json.machines[2].approvedAt).toBeNull();
    d = await alissa.req("POST", `/api/orders/${id}/approve`, { machineIds: [jcb.id], method: "phone", note: "JCB approved" });
    expect(d.json.stage).toBe("approved");
    expect(d.json.machines[2].approvalMethod).toBe("matches_machine");
    await alissa.req("POST", `/api/orders/${id}/checklist`, { itemIds: d.json.checklist.items.map((i: Json) => i.id) });
    await alissa.req("PUT", `/api/machines/${bobcat.id}/length`, { quarterLength: 150 });
    await alissa.req("PUT", `/api/machines/${jcb.id}/length`, { quarterLength: 120 });
    expect((await alissa.req("POST", `/api/orders/${id}/hand-off`, {})).status).toBe(409);
    await alissa.req("PUT", `/api/machines/${yeti.id}/length`, { quarterLength: 8 });
    expect((await alissa.req("POST", `/api/orders/${id}/hand-off`, {})).json.allDone).toBe(true);
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

// ---------- Phase 2: the customer proof page ----------

const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])], name, { type: "image/png" });

async function sendProofAs(client: Client, orderId: number, machineIds: number[], message: string, files = [png("proof.png")]) {
  const fd = new FormData();
  for (const id of machineIds) fd.append("machineIds", String(id));
  fd.append("message", message);
  for (const f of files) fd.append("files", f);
  const res = await SELF.fetch(`https://dg.test/api/orders/${orderId}/proofs`, { method: "POST", headers: { cookie: client.cookie }, body: fd });
  return { status: res.status, json: (await res.json()) as Json };
}

/** What the customer's browser does: plain GETs and form posts, no login. */
async function customerPost(path: string, fields: Record<string, string | string[]>, files: File[] = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  for (const f of files) fd.append("files", f);
  return SELF.fetch(`https://dg.test${path}`, { method: "POST", body: fd, redirect: "manual" });
}
const customerGet = (path: string) => SELF.fetch(`https://dg.test${path}`, { redirect: "manual" });

describe("customer proof page", () => {
  let orderId = 0;
  let bobcat = 0;
  let jcb = 0;
  let token = "";

  it("sends split proofs, one per machine, with a customer link", async () => {
    await sendWebhook("orders/create", sampleShopifyOrder({ id: 5550020, name: "514860020" }));
    const board = await cierra.req("GET", "/api/assign");
    orderId = board.json.unassigned.find((u: Json) => u.order.orderNumber === "514860020").order.id;
    await cierra.req("POST", `/api/orders/${orderId}/assign`, { personId: alissaId });
    const d = await alissa.req("GET", `/api/orders/${orderId}`);
    [bobcat, jcb] = d.json.machines.map((m: Json) => m.id);
    expect(d.json.customerLink).toBeNull();

    expect((await sendProofAs(alissa, orderId, [bobcat], "x", [])).status).toBe(400); // needs an image
    const bad = await sendProofAs(alissa, orderId, [bobcat], "x", [new File(["<svg/>"], "a.svg", { type: "image/svg+xml" })]);
    expect(bad.status).toBe(400);
    expect((await sendProofAs(andrew, orderId, [bobcat], "x")).status).toBe(403);

    let sent = await sendProofAs(alissa, orderId, [bobcat], "Here's your Bobcat. Let me know!");
    expect(sent.status).toBe(201);
    sent = await sendProofAs(alissa, orderId, [jcb], "");
    expect(sent.json.stage).toBe("proof_sent");
    expect(sent.json.proofs.map((p: Json) => [p.number, p.status, p.machineIds])).toEqual([
      [1, "open", [bobcat]],
      [1, "open", [jcb]],
    ]);
    expect(sent.json.customerLink).toMatch(/^https:\/\/dg\.test\/proof\/[A-Za-z0-9_-]{40,}$/);
    token = sent.json.customerLink.split("/").pop();

    const emails = await env.DB.prepare("SELECT kind, to_email, payload_json, status FROM outbox WHERE order_id = ? ORDER BY id").bind(orderId).all<Json>();
    expect(emails.results.map((e) => [e.kind, e.to_email, e.status])).toEqual([
      ["proof_ready", "rick@example.com", "pending"],
      ["proof_ready", "rick@example.com", "pending"],
    ]);
    const payload = JSON.parse(emails.results[0].payload_json);
    expect(payload).toMatchObject({ subject: "Your Dirty Graphix proof is ready", button_url: sent.json.customerLink, first_name: "Rick", designer: "Alissa" });
    expect(payload.body).toContain("Bobcat T770/S770");
  });

  it("shows the customer both proofs, with no prices, and logs the view", async () => {
    const res = await customerGet(`/proof/${token}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Your proof is ready");
    expect(html).toContain("Bobcat T770/S770");
    expect(html).toContain("JCB 4TS-8T");
    expect(html).toContain("Note from Alissa");
    expect(html).toContain("Here&#39;s your Bobcat. Let me know!");
    for (const amount of ["3890", "1999", "69.95", "$"]) expect(html).not.toContain(amount);
    expect((html.match(/action="\/proof\/[^"]+\/approve"/g) ?? []).length).toBe(2);
    const d = await alissa.req("GET", `/api/orders/${orderId}`);
    expect(d.json.proofs.every((p: Json) => p.viewedAt)).toBe(true);
    // Staff opening the link don't count as the customer.
    await env.DB.prepare("UPDATE proofs SET viewed_at = NULL WHERE order_id = ?").bind(orderId).run();
    await SELF.fetch(`https://dg.test/proof/${token}`, { headers: { cookie: alissa.cookie } });
    expect((await alissa.req("GET", `/api/orders/${orderId}`)).json.proofs.every((p: Json) => !p.viewedAt)).toBe(true);
  });

  it("works through the store's app proxy path", async () => {
    const html = await (await customerGet(`/proof/${token}?path_prefix=/apps/proof&shop=dirtygraphix.myshopify.com`)).text();
    expect(html).toContain(`action="/apps/proof/${token}/approve"`);
    expect(html).toContain(`href="https://dg.test/proof-assets/proof.css"`);
    expect(await (await customerGet(`/proof/${token}?path_prefix=//evil.com`)).text()).toContain(`action="/proof/${token}/approve"`);
  });

  it("rejects bad links and other orders' files", async () => {
    expect((await customerGet("/proof/not-a-real-token-at-all-12345")).status).toBe(404);
    const other = await env.DB.prepare("SELECT id FROM files WHERE order_id != ? LIMIT 1").bind(orderId).first<{ id: number }>();
    if (other) expect((await customerGet(`/proof/${token}/file/${other.id}`)).status).toBe(404);
    const d = await alissa.req("GET", `/api/orders/${orderId}`);
    const file = d.json.proofs[0].files[0];
    const img = await customerGet(`/proof/${token}/file/${file.id}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect((await customerGet(`/proof/${token}/file/${file.id}?download=1`)).headers.get("content-disposition")).toMatch(/^attachment/);
  });

  it("lets the customer ask for changes on one machine with a file attached", async () => {
    const d = await alissa.req("GET", `/api/orders/${orderId}`);
    const jcbProof = d.json.proofs.find((p: Json) => p.machineIds[0] === jcb).id;
    const empty = await customerPost(`/proof/${token}/changes`, { proof: String(jcbProof), comment: " " });
    expect(empty.status).toBe(400);
    expect(await empty.text()).toContain("Tell us what to change");
    const tooLong = await customerPost(`/proof/${token}/changes`, { proof: String(jcbProof), comment: "x".repeat(501) });
    expect(tooLong.status).toBe(400);
    const res = await customerPost(`/proof/${token}/changes`, { proof: String(jcbProof), comment: "Make the camo darker" }, [png("reference.png")]);
    expect(res.status).toBe(303);
    const unread = await env.DB.prepare("SELECT customer_unread FROM orders WHERE id = ?").bind(orderId).first<{ customer_unread: number }>();
    expect(unread!.customer_unread).toBe(1);
    expect(res.headers.get("location")).toBe(`/proof/${token}?done=changes`);
    const after = await alissa.req("GET", `/api/orders/${orderId}`);
    expect(after.json.stage).toBe("revision_requested");
    expect(after.json.messages.map((m: Json) => [m.author, m.kind, m.body, m.files.length])).toEqual([["customer", "changes", "Make the camo darker", 1]]);
    expect(after.json.timeline.at(-1)).toMatchObject({ kind: "revision_requested", note: "Make the camo darker", person: null });
    // Approving it now isn't possible: a decision was already made.
    expect((await customerPost(`/proof/${token}/approve`, { proof: String(jcbProof) })).status).toBe(400);
  });

  it("flags the customer's message in the queue until the designer opens the order", async () => {
    await env.DB.prepare("UPDATE orders SET customer_unread = 1 WHERE id = ?").bind(orderId).run();
    const q = await alissa.req("GET", "/api/queue");
    const card = q.json.groups.find((g: Json) => g.key === "revision_requested").orders.find((o: Json) => o.id === orderId);
    expect(card.customerUnread).toBe(true);
    await alissa.req("GET", `/api/orders/${orderId}`);
    const q2 = await alissa.req("GET", "/api/queue");
    expect(q2.json.groups.flatMap((g: Json) => g.orders).find((o: Json) => o.id === orderId).customerUnread).toBe(false);
  });

  it("approves one machine, and lets the customer take it back within the window", async () => {
    let d = await alissa.req("GET", `/api/orders/${orderId}`);
    const bobcatProof = d.json.proofs.find((p: Json) => p.machineIds[0] === bobcat).id;
    const res = await customerPost(`/proof/${token}/approve`, { proof: String(bobcatProof) });
    expect(res.status).toBe(303);
    d = await alissa.req("GET", `/api/orders/${orderId}`);
    expect(d.json.machines.find((m: Json) => m.id === bobcat)).toMatchObject({ approvalMethod: "proof_page" });
    expect(d.json.stage).toBe("revision_requested"); // the JCB still needs its revision
    const page = await (await customerGet(`/proof/${token}?done=approved`)).text();
    expect(page).toContain("Design approved!");
    expect(page).toContain("Change it");
    expect(page).toContain("?download=1");

    expect((await customerPost(`/proof/${token}/undo`, { proof: String(bobcatProof) })).status).toBe(303);
    d = await alissa.req("GET", `/api/orders/${orderId}`);
    expect(d.json.machines.find((m: Json) => m.id === bobcat).approvedAt).toBeNull();
    expect(d.json.proofs.find((p: Json) => p.id === bobcatProof).status).toBe("open");

    await customerPost(`/proof/${token}/approve`, { proof: String(bobcatProof) });
    // After the window closes, it can't be undone online.
    await env.DB.prepare("UPDATE proofs SET decided_at = ? WHERE id = ?").bind(new Date(Date.now() - 31 * 60_000).toISOString(), bobcatProof).run();
    expect((await customerPost(`/proof/${token}/undo`, { proof: String(bobcatProof) })).status).toBe(400);
  });

  it("numbers the revision, replaces nothing else, and approving it approves the order", async () => {
    const sent = await sendProofAs(alissa, orderId, [jcb], "Darker camo, as asked");
    expect(sent.json.stage).toBe("proof_sent");
    const rev = sent.json.proofs.at(-1);
    expect(rev.number).toBe(2);
    const kinds = (await env.DB.prepare("SELECT kind FROM outbox WHERE order_id = ? ORDER BY id").bind(orderId).all<{ kind: string }>()).results.map((r) => r.kind);
    expect(kinds).toContain("revision_ready");
    const page = await (await customerGet(`/proof/${token}`)).text();
    expect(page).toContain("Revision 1");
    expect(await customerPost(`/proof/${token}/approve`, { proof: String(rev.id) }).then((r) => r.status)).toBe(303);
    const d = await alissa.req("GET", `/api/orders/${orderId}`);
    expect(d.json.stage).toBe("approved");
    expect(d.json.machines.every((m: Json) => m.approvedAt)).toBe(true);
  });

  it("requires the checklist when the setting is on", async () => {
    await ty.req("PUT", "/api/proof-settings", { proof_require_ack: "1" });
    const o = sampleShopifyOrder({ id: 5550021, name: "514860021" });
    await sendWebhook("orders/create", o);
    const id = (await cierra.req("GET", "/api/assign")).json.unassigned.find((u: Json) => u.order.orderNumber === "514860021").order.id;
    await cierra.req("POST", `/api/orders/${id}/assign`, { personId: alissaId });
    const ms = (await alissa.req("GET", `/api/orders/${id}`)).json.machines.map((m: Json) => m.id);
    const sent = await sendProofAs(alissa, id, ms, "Both machines on one sheet");
    const proof = sent.json.proofs[0];
    expect(proof.machineIds).toEqual(ms);
    const t = sent.json.customerLink.split("/").pop();
    expect((await customerPost(`/proof/${t}/approve`, { proof: String(proof.id), ack: ["0", "1"] })).status).toBe(400);
    expect((await customerPost(`/proof/${t}/approve`, { proof: String(proof.id), ack: ["0", "1", "2"] })).status).toBe(303);
    expect((await alissa.req("GET", `/api/orders/${id}`)).json.stage).toBe("approved");
    await ty.req("PUT", "/api/proof-settings", { proof_require_ack: "0" });
  });

  it("lets the designer message the customer, send a reminder and take back a proof", async () => {
    const o = sampleShopifyOrder({ id: 5550022, name: "514860022" });
    await sendWebhook("orders/create", o);
    const id = (await cierra.req("GET", "/api/assign")).json.unassigned.find((u: Json) => u.order.orderNumber === "514860022").order.id;
    await cierra.req("POST", `/api/orders/${id}/assign`, { personId: alissaId });
    // Before any proof: a "Message customer" email, and the customer can answer on the page.
    const msg = await alissa.req("POST", `/api/orders/${id}/messages`, { body: "What year is your Bobcat?" });
    expect(msg.json.emailed).toBe(true);
    const link = (await alissa.req("POST", `/api/orders/${id}/customer-link`)).json.link as string;
    const t = link.split("/").pop()!;
    const page = await (await customerGet(`/proof/${t}`)).text();
    expect(page).toContain("Your design is in the works");
    expect(page).toContain("What year is your Bobcat?");
    expect((await customerPost(`/proof/${t}/message`, { body: "It's a 2023" })).status).toBe(303);
    let d = await alissa.req("GET", `/api/orders/${id}`);
    expect(d.json.messages.map((m: Json) => m.author)).toEqual(["staff", "customer"]);
    expect(d.json.stage).toBe("needs_first_proof");

    expect((await alissa.req("POST", `/api/orders/${id}/reminder`)).status).toBe(409); // nothing waiting yet
    const sent = await sendProofAs(alissa, id, [d.json.machines[0].id], "");
    expect((await alissa.req("POST", `/api/orders/${id}/reminder`)).status).toBe(200);
    d = await alissa.req("GET", `/api/orders/${id}`);
    expect(d.json.timeline.at(-1)).toMatchObject({ kind: "reminder_sent", person: "Alissa" });
    const kinds = (await env.DB.prepare("SELECT kind FROM outbox WHERE order_id = ? ORDER BY id").bind(id).all<{ kind: string }>()).results.map((r) => r.kind);
    expect(kinds).toEqual(["message", "proof_ready", "reminder"]);

    const w = await alissa.req("POST", `/api/orders/${id}/proofs/${sent.json.proofs[0].id}/withdraw`);
    expect(w.json.stage).toBe("needs_first_proof");
    expect(await (await customerGet(`/proof/${t}`)).text()).not.toContain("Approve design");
  });

  it("sends automatic reminders during business hours only, up to the limit", async () => {
    const { runReminders } = await import("../src/worker/lib/proofs");
    const o = sampleShopifyOrder({ id: 5550023, name: "514860023" });
    await sendWebhook("orders/create", o);
    const id = (await cierra.req("GET", "/api/assign")).json.unassigned.find((u: Json) => u.order.orderNumber === "514860023").order.id;
    await cierra.req("POST", `/api/orders/${id}/assign`, { personId: alissaId });
    const ms = (await alissa.req("GET", `/api/orders/${id}`)).json.machines.map((m: Json) => m.id);
    await sendProofAs(alissa, id, ms, "");
    // Pretend the proof went out on Monday Nov 2, 2026 at 9 AM Central.
    await env.DB.prepare("UPDATE proofs SET sent_at = '2026-11-02T15:00:00.000Z' WHERE order_id = ?").bind(id).run();
    const count = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox WHERE order_id = ? AND kind = 'reminder'").bind(id).first<{ n: number }>())!.n;
    await runReminders(env, new Date("2026-11-03T15:00:00Z")); // 1 day later: too soon
    expect(await count()).toBe(0);
    await runReminders(env, new Date("2026-11-04T03:00:00Z")); // Tuesday 9 PM: after hours
    expect(await count()).toBe(0);
    // Reminders are dated by their outbox row, so move each one back as time "passes".
    const tick = async (iso: string) => {
      await runReminders(env, new Date(iso));
      await env.DB.prepare("UPDATE outbox SET created_at = ? WHERE order_id = ? AND kind = 'reminder' AND created_at > ?").bind(iso, id, iso).run();
    };
    await tick("2026-11-04T15:00:00.000Z"); // Wed: 2 days
    expect(await count()).toBe(1);
    await tick("2026-11-05T15:00:00.000Z"); // Thu: only 1 day since the last
    expect(await count()).toBe(1);
    await tick("2026-11-06T15:00:00.000Z"); // Fri
    await tick("2026-11-09T15:00:00.000Z"); // Mon
    await tick("2026-11-11T15:00:00.000Z"); // Wed: 4th
    await tick("2026-11-13T15:00:00.000Z"); // Fri: limit reached
    expect(await count()).toBe(4);
  });

  it("keeps proof settings to TY and validates email wording", async () => {
    expect((await alissa.req("GET", "/api/proof-settings")).status).toBe(403);
    const s = await ty.req("GET", "/api/proof-settings");
    expect(s.json.sendingOn).toBe(false);
    expect(s.json.settings.proof_change_window_minutes).toBe("30");
    expect(s.json.outbox.length).toBeGreaterThan(0);
    expect((await ty.req("PUT", "/api/proof-settings", { email_reminder: JSON.stringify({ on: true, subject: "", heading: "h", body: "b", button: "x" }) })).status).toBe(400);
    expect((await ty.req("PUT", "/api/proof-settings", { rush_tags: "x" })).status).toBe(400);
    expect((await ty.req("PUT", "/api/proof-settings", { proof_link_base: "http://insecure" })).status).toBe(400);
    expect((await ty.req("PUT", "/api/proof-settings", { proof_link_base: "https://dirtygraphix.com/apps/proof" })).status).toBe(200);
    const d = await alissa.req("GET", `/api/orders/${orderId}`);
    expect(d.json.customerLink).toBe(`https://dirtygraphix.com/apps/proof/${token}`);
    await ty.req("PUT", "/api/proof-settings", { proof_link_base: "" });
  });

  it("lets the team lead manage reply templates for designers", async () => {
    expect((await alissa.req("POST", "/api/reply-templates", { name: "x", body: "y" })).status).toBe(403);
    expect((await cierra.req("POST", "/api/reply-templates", { name: "First proof", body: "Hey {first_name}, here's your first mockup!" })).status).toBe(201);
    expect((await alissa.req("GET", "/api/reply-templates")).json.map((t: Json) => t.name)).toEqual(["First proof"]);
  });
});

describe("sending customer emails with Cloudflare", () => {
  it("renders the branded email from the design tokens", async () => {
    const { renderEmail } = await import("../src/worker/lib/email");
    const { html, text } = renderEmail({ kind: "proof_ready", subject: "S", heading: "Your custom design is ready!", body: "Hi Rick!\n\nLook it over.", button_label: "Review design", button_url: "https://dg.test/proof/abc", order_number: "#514860020" });
    expect(html).toContain("#FF8A1F"); // --brand from design/tokens.css
    expect(html).toContain("Order #514860020");
    expect(html).toContain('href="https://dg.test/proof/abc"');
    expect(html).not.toContain("var(--");
    expect(text).toContain("Review design: https://dg.test/proof/abc");
  });

  it("holds emails while sending is off, then sends and marks them", async () => {
    const { deliverOutbox } = await import("../src/worker/lib/email");
    const sent: any[] = [];
    const fake = { DB: env.DB, EMAIL: { send: async (m: any) => (sent.push(m), { messageId: "x" }) } as unknown as SendEmail };
    expect((await deliverOutbox(fake)).on).toBe(false);
    expect(sent).toHaveLength(0);
    expect((await ty.req("PUT", "/api/proof-settings", { email_from_address: "not-an-email" })).status).toBe(400);
    await ty.req("PUT", "/api/proof-settings", { email_sending: "1", email_reply_to: "orders@dirtygraphix.com" });
    const r = await deliverOutbox(fake, 3);
    expect(r).toMatchObject({ on: true, sent: 3, failed: 0 });
    expect(sent[0]).toMatchObject({ from: { name: "Dirty Graphix", email: "orders@dirtygraphix.com" }, replyTo: "orders@dirtygraphix.com" });
    expect(sent[0].html).toContain("<!doctype html>");
    const counts = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM outbox GROUP BY status").all<{ status: string; n: number }>();
    expect(counts.results.find((x) => x.status === "sent")?.n).toBe(3);
    // A failure is kept and retried later, not lost.
    const broken = { DB: env.DB, EMAIL: { send: async () => { throw new Error("domain not verified"); } } as unknown as SendEmail };
    expect((await deliverOutbox(broken, 1)).failed).toBe(1);
    const row = await env.DB.prepare("SELECT status, attempts, error FROM outbox WHERE error IS NOT NULL").first<Json>();
    expect(row).toMatchObject({ status: "pending", attempts: 1, error: "domain not verified" });
    await ty.req("PUT", "/api/proof-settings", { email_sending: "0", email_reply_to: "" });
  });

  it("previews any email with sample details for TY only", async () => {
    const template = { subject: "Hi {first_name}", heading: "Ready", body: "For {machines}", button: "Go" };
    expect((await alissa.req("POST", "/api/proof-settings/preview", { kind: "proof_ready", template })).status).toBe(403);
    const p = await ty.req("POST", "/api/proof-settings/preview", { kind: "proof_ready", template });
    expect(p.json.subject).toBe("Hi Rick");
    expect(p.json.html).toContain("For CAT 250 and JCB 4TS-8T");
  });
});
