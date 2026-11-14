// Fills a LOCAL dev database with the team and a few sample orders.
// Run `npm run dev` in one terminal, then `npm run seed:dev` in another.
// Never point this at the live app.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const SECRET = process.env.SHOPIFY_WEBHOOK_SECRET ?? "local-dev-secret";
const SETUP = process.env.SETUP_TOKEN ?? "local-setup-token";
const PASSWORD = "dirtygraphix-dev";

if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("dev-seed only runs against a local server");

class Client {
  cookie = "";
  async req(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.error ?? text}`);
    return json;
  }
}

async function webhook(order) {
  const body = JSON.stringify(order);
  const res = await fetch(BASE + "/webhooks/shopify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-topic": "orders/create",
      "x-shopify-hmac-sha256": createHmac("sha256", SECRET).update(body).digest("base64"),
    },
    body,
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
  return res.json();
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
let lineId = 100;
// Shaped like real orders: "... Wrap Kits" products, choices as properties, option lines linked by group id.
const kit = (title, variant, finish, props = []) => {
  const group = String(++lineId);
  return [
    { id: lineId, title, variant_title: variant, quantity: 1, properties: [{ name: "Finish Options", value: finish }, ...props, { name: "_gpo_product_group", value: group }] },
  ];
};
const appKit = (parent) => ({ id: ++lineId, title: "Application Kit", sku: "appkit", quantity: 1, properties: parent ? [{ name: "_gpo_parent_product_group", value: parent }] : [] });
const sheetz = (size, finish) => [
  { id: ++lineId, title: "Sheetz Size", variant_title: size, quantity: 1, properties: [] },
  { id: ++lineId, title: `${size} Finishes`, variant_title: finish, quantity: 1, properties: [] },
];
const order = (n, hours, items, extra = {}) => ({
  id: 7000000 + n,
  name: `#${n}`,
  order_number: n,
  created_at: hoursAgo(hours),
  email: `customer${n}@example.com`,
  financial_status: "paid",
  tags: "",
  customer: { first_name: "Sample", last_name: `Customer ${n}`, tags: "" },
  shipping_address: { name: `Sample Customer ${n}`, company: extra.company, address1: "100 Main St", city: "Stillwater", province_code: "MN", zip: "55082", country_code: "US" },
  shipping_lines: [{ title: "UPS Ground" }],
  line_items: items,
  ...extra,
});

const ty = new Client();
await ty.req("POST", "/api/setup", { token: SETUP, name: "TY", email: "ty@dev.local", password: PASSWORD });
const team = [
  ["Cierra", "lead", true],
  ["Nikki", "billing", false],
  ["Andrew", "designer", true],
  ["Alissa", "designer", true],
  ["Bekah", "designer", true],
];
const ids = {};
const clients = {};
for (const [name, role, takesOrders] of team) {
  const email = `${name.toLowerCase()}@dev.local`;
  ids[name] = (await ty.req("POST", "/api/people", { name, email, role, takesOrders, password: PASSWORD })).id;
  clients[name] = new Client();
  await clients[name].req("POST", "/api/login", { email, password: PASSWORD });
}

const choices = [{ name: "Year", value: "2024" }, { name: "Base", value: "Black" }, { name: "Accent 1", value: "Safety Orange" }];
const orders = [
  order(4820, 50, [...kit("2024+ John Deere 325G Wrap Kits", "STRIPE PACK 2 / Full (Pictured)", "Chrome Gloss", [...choices, { name: "Logo Upload-1", value: "https://example.com/logo.ai" }]), ...kit("CAT 259D3 Wrap Kits", "STRIPE PACK 2 / Full (Pictured)", "Gloss", choices), appKit(String(lineId - 1))], { note: "Company name on both cab doors.", company: "R. Hanson Excavating" }),
  order(4826, 2, kit("CAT 299D3 Wrap Kits", "DIGITAL_CAMO", "Gravel Guard [$0.31]", choices), { tags: "rush" }),
  order(4825, 5, kit("Bobcat T66 Wrap Kits", "STRIPE PACK 1", "Gloss", choices)),
  order(4818, 30, kit("Kubota SVL97-2 Wrap Kits", "CUSTOM ONE-OFF / Full (Pictured)", "Matte", choices)),
  order(4814, 60, kit("CAT 308 CR Wrap Kits", "STRIPE PACK 2", "Prismatic", choices)),
  order(4828, 1, kit("Bobcat T76 Wrap Kits", "STRIPE PACK 1", "Matte", choices), { tags: "rush" }),
  order(4830, 1, [...kit("GRAVEL GUARD BLACKOUT - Kubota Limited Edition Wrap Kits", "SVL110-3", "Gravel Guard"), ...sheetz("4x4", "Gravel Guard")]),
  order(4827, 2, kit("CAT 289D3 Wrap Kits", "STRIPE PACK 2", "Gloss", choices)),
  order(4831, 1, [appKit(null)]),
];
const orderIds = {};
for (const o of orders) orderIds[o.order_number] = (await webhook(o)).id;

const cierra = clients.Cierra;
const alissa = clients.Alissa;
for (const n of [4820, 4826, 4825, 4818, 4814]) await cierra.req("POST", `/api/orders/${orderIds[n]}/assign`, { personId: ids.Alissa });

// Proofs go out through the new proof page. The images are made-up samples in scripts/sample-proofs.
const sampleProof = (name) => new File([readFileSync(new URL(`./sample-proofs/${name}`, import.meta.url))], name, { type: "image/png" });
async function sendProof(client, orderId, machineIds, file, message = "") {
  const fd = new FormData();
  machineIds.forEach((id) => fd.append("machineIds", String(id)));
  fd.append("message", message);
  fd.append("files", file);
  const res = await fetch(`${BASE}/api/orders/${orderId}/proofs`, { method: "POST", headers: { cookie: client.cookie }, body: fd });
  if (!res.ok) throw new Error(`send proof → ${res.status} ${await res.text()}`);
  return res.json();
}
// What the customer's browser does on the proof page.
async function customer(link, action, fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${link}/${action}`, { method: "POST", body: fd, redirect: "manual" });
  if (res.status !== 303) throw new Error(`customer ${action} → ${res.status}`);
}

// 4820: split proofs. The customer approved the CAT and asked for changes on the Deere, which is on Revision 1.
let d = await alissa.req("GET", `/api/orders/${orderIds[4820]}`);
const [deere, cat] = d.machines.map((m) => m.id);
await sendProof(alissa, orderIds[4820], [deere], sampleProof("jd-325g.png"), "Hey! Here's the first mockup for your 325G. Let me know what you think.");
d = await sendProof(alissa, orderIds[4820], [cat], sampleProof("cat-259d3.png"));
const link4820 = d.customerLink.replace(/^https?:\/\/[^/]+/, BASE);
await customer(link4820, "changes", { proof: String(d.proofs[0].id), comment: "Can you make the company name bigger on both cab doors?" });
await customer(link4820, "approve", { proof: String(d.proofs[1].id) });
await sendProof(alissa, orderIds[4820], [deere], sampleProof("jd-325g.png"), "Made the company name bigger on both doors.");

// 4814: first proof out, waiting on the customer.
d = await alissa.req("GET", `/api/orders/${orderIds[4814]}`);
await sendProof(alissa, orderIds[4814], d.machines.map((m) => m.id), sampleProof("cat-308.png"));

// 4818: the customer asked for changes on the proof page.
d = await alissa.req("GET", `/api/orders/${orderIds[4818]}`);
d = await sendProof(alissa, orderIds[4818], d.machines.map((m) => m.id), sampleProof("cat-259d3.png"));
await customer(d.customerLink.replace(/^https?:\/\/[^/]+/, BASE), "changes", { proof: String(d.proofs[0].id), comment: "Move the logo higher on the cab door" });

// 4825: a question before the first proof, and the customer's answer.
await alissa.req("POST", `/api/orders/${orderIds[4825]}/messages`, { body: "Quick question: what year is your T66? The door shape changed in 2022." });
const link4825 = (await alissa.req("POST", `/api/orders/${orderIds[4825]}/customer-link`)).link.replace(/^https?:\/\/[^/]+/, BASE);
await customer(link4825, "message", { body: "It's a 2023." });

await cierra.req("POST", "/api/reply-templates", { name: "First proof", body: "Hey {first_name}, here's your first mockup! Let me know what you think or if anything needs to change.\n\nThanks,\n{designer}" });
await cierra.req("POST", "/api/reply-templates", { name: "Revision", body: "Hey {first_name}, here's the adjusted mockup with your changes. Let me know if it's good to go!\n\nThanks,\n{designer}" });

console.log(`Customer proof page for order 4820: ${link4820}`);
console.log(`Seeded. Sign in at ${BASE} with any of these emails and the password "${PASSWORD}":`);
for (const name of ["TY", ...team.map((t) => t[0])]) console.log(`  ${name.toLowerCase()}@dev.local`);
