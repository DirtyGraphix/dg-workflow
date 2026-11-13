import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "./env";
import {
  canAssign,
  canSeeAllDesign,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  newToken,
  SESSION_COOKIE,
  SESSION_DAYS,
  sha256,
  verifyPassword,
  type Person,
  type Role,
} from "./lib/auth";
import { mapShopifyOrder, verifyShopifyWebhook, FINISHES } from "./lib/shopify";
import {
  APPROVAL_METHODS,
  assignOrder,
  assignmentBoard,
  clockFor,
  createManualJob,
  designerQueue,
  designerStats,
  handOff,
  ingestShopifyOrder,
  intakeSettings,
  markCustom,
  markRush,
  orderDetail,
  pausePrintFile,
  recordApproval,
  recordProofSent,
  recordRevisionRequest,
  resumePrintFile,
  setLength,
  signChecklist,
  updateFromShopify,
  WorkflowError,
  type OrderRow,
} from "./lib/orders";

type AppEnv = { Bindings: Env; Variables: { person: Person } };
const app = new Hono<AppEnv>();

const ROLES: Role[] = ["admin", "lead", "billing", "designer", "production", "kits", "listings"];

app.onError((err, c) => {
  if (err instanceof WorkflowError) return c.json({ error: err.message, data: err.data ?? null }, err.status);
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});

// ---------- Shopify webhooks ----------
// Shopify sends orders/create, orders/updated, orders/paid and orders/cancelled here.

app.post("/webhooks/shopify", async (c) => {
  const raw = await c.req.arrayBuffer();
  const ok = await verifyShopifyWebhook(raw, c.req.header("x-shopify-hmac-sha256") ?? null, c.env.SHOPIFY_WEBHOOK_SECRET);
  if (!ok) return c.json({ error: "Invalid signature" }, 401);
  const topic = c.req.header("x-shopify-topic") ?? "";
  const payload = JSON.parse(new TextDecoder().decode(raw));
  if (topic === "orders/create") {
    const mapped = mapShopifyOrder(payload, await intakeSettings(c.env.DB));
    const result = await ingestShopifyOrder(c.env.DB, mapped);
    return c.json(result, result.created ? 201 : 200);
  }
  if (topic === "orders/updated" || topic === "orders/paid" || topic === "orders/cancelled") {
    const id = await updateFromShopify(c.env.DB, String(payload.id), payload);
    return c.json({ id });
  }
  return c.json({ ignored: topic });
});

// ---------- logins ----------

const api = new Hono<AppEnv>();

async function startSession(c: Context<AppEnv>, personId: number) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, person_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), personId, expires.toISOString())
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    expires,
  });
}

// One-time setup: creates TY's admin login when there are no people yet.
api.post("/setup", async (c) => {
  const body = await c.req.json<{ token: string; name: string; email: string; password: string }>();
  if (!c.env.SETUP_TOKEN || body.token !== c.env.SETUP_TOKEN) return c.json({ error: "Invalid setup token" }, 403);
  const existing = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM people").first<{ n: number }>();
  if (existing!.n > 0) return c.json({ error: "Setup is already done" }, 409);
  if (!body.name?.trim() || !body.email?.trim() || (body.password ?? "").length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `Name, email and a password of at least ${MIN_PASSWORD_LENGTH} characters are required` }, 400);
  }
  const row = await c.env.DB.prepare("INSERT INTO people (name, email, role, password_hash) VALUES (?, ?, 'admin', ?) RETURNING id")
    .bind(body.name.trim(), body.email.trim(), await hashPassword(body.password))
    .first<{ id: number }>();
  await startSession(c, row!.id);
  return c.json({ ok: true }, 201);
});

api.post("/login", async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  const p = await c.env.DB.prepare("SELECT id, password_hash FROM people WHERE email = ? AND active = 1")
    .bind(String(email ?? "").trim())
    .first<{ id: number; password_hash: string | null }>();
  if (!p || !(await verifyPassword(String(password ?? ""), p.password_hash))) {
    return c.json({ error: "That email and password don't match" }, 401);
  }
  await startSession(c, p.id);
  return c.json({ ok: true });
});

api.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// Everything below needs a login.
api.use("*", async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: "Please sign in" }, 401);
  const person = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.email, p.role, p.takes_orders FROM sessions s JOIN people p ON p.id = s.person_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND p.active = 1`,
  )
    .bind(await sha256(token), new Date().toISOString())
    .first<Person>();
  if (!person) return c.json({ error: "Please sign in" }, 401);
  c.set("person", person);
  await next();
});

const forbid = (c: Context<AppEnv>, msg = "You don't have access to this") => c.json({ error: msg }, 403);
const idParam = (c: Context<AppEnv>) => Number(c.req.param("id"));

api.get("/me", (c) => c.json(c.get("person")));

// ---------- people (TY manages logins) ----------

api.get("/people", async (c) => {
  const me = c.get("person");
  if (!(me.role === "admin" || canAssign(me))) return forbid(c);
  const { results } = await c.env.DB.prepare("SELECT id, name, email, role, takes_orders, active FROM people ORDER BY active DESC, name").all();
  return c.json(results);
});

api.post("/people", async (c) => {
  if (c.get("person").role !== "admin") return forbid(c);
  const b = await c.req.json<{ name: string; email: string; role: Role; takesOrders?: boolean; password: string }>();
  if (!b.name?.trim() || !b.email?.trim() || !ROLES.includes(b.role)) return c.json({ error: "Name, email and role are required" }, 400);
  if ((b.password ?? "").length < MIN_PASSWORD_LENGTH) return c.json({ error: `Passwords need at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
  try {
    const row = await c.env.DB.prepare("INSERT INTO people (name, email, role, takes_orders, password_hash) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .bind(b.name.trim(), b.email.trim(), b.role, b.takesOrders ? 1 : 0, await hashPassword(b.password))
      .first<{ id: number }>();
    return c.json({ id: row!.id }, 201);
  } catch {
    return c.json({ error: "Someone already uses that email" }, 409);
  }
});

api.patch("/people/:id", async (c) => {
  const me = c.get("person");
  const id = idParam(c);
  const b = await c.req.json<{ role?: Role; takesOrders?: boolean; active?: boolean; password?: string }>();
  // People can change their own password; everything else is TY only.
  if (me.role !== "admin" && !(me.id === id && Object.keys(b).every((k) => k === "password"))) return forbid(c);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return c.json({ error: "Unknown role" }, 400);
    sets.push("role = ?"), vals.push(b.role);
  }
  if (b.takesOrders !== undefined) sets.push("takes_orders = ?"), vals.push(b.takesOrders ? 1 : 0);
  if (b.active !== undefined) sets.push("active = ?"), vals.push(b.active ? 1 : 0);
  if (b.password !== undefined) {
    if (b.password.length < MIN_PASSWORD_LENGTH) return c.json({ error: `Passwords need at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
    sets.push("password_hash = ?"), vals.push(await hashPassword(b.password));
  }
  if (!sets.length) return c.json({ ok: true });
  await c.env.DB.prepare(`UPDATE people SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  if (b.active === false) await c.env.DB.prepare("DELETE FROM sessions WHERE person_id = ?").bind(id).run();
  return c.json({ ok: true });
});

// Out sick or on vacation: no new assignments while out.
api.post("/people/:id/time-off", async (c) => {
  const me = c.get("person");
  const id = idParam(c);
  if (!(me.id === id || me.role === "admin" || me.role === "lead")) return forbid(c);
  const b = await c.req.json<{ startsOn: string; endsOn: string; kind: "vacation" | "sick" | "other"; note?: string }>();
  const dateOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? "");
  if (!dateOk(b.startsOn) || !dateOk(b.endsOn) || b.endsOn < b.startsOn) return c.json({ error: "Pick a start and end date" }, 400);
  if (!["vacation", "sick", "other"].includes(b.kind)) return c.json({ error: "Pick vacation, sick or other" }, 400);
  await c.env.DB.prepare("INSERT INTO time_off (person_id, starts_on, ends_on, kind, note, marked_by) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, b.startsOn, b.endsOn, b.kind, b.note ?? null, me.id)
    .run();
  return c.json({ ok: true }, 201);
});

// ---------- assignment (Cierra, Nikki, TY) ----------

api.get("/assign", async (c) => {
  if (!canAssign(c.get("person"))) return forbid(c);
  return c.json(await assignmentBoard(c.env));
});

api.post("/orders/:id/assign", async (c) => {
  const me = c.get("person");
  if (!canAssign(me)) return forbid(c);
  const { personId } = await c.req.json<{ personId: number }>();
  await assignOrder(c.env.DB, idParam(c), Number(personId), me);
  return c.json({ ok: true });
});

// ---------- design queue ----------

api.get("/queue", async (c) => {
  const me = c.get("person");
  const as = c.req.query("person");
  const personId = as && canSeeAllDesign(me) ? Number(as) : me.id;
  const [groups, stats] = await Promise.all([designerQueue(c.env, personId), designerStats(c.env, personId)]);
  return c.json({ personId, groups, stats });
});

async function loadForWork(c: Context<AppEnv>) {
  const o = await c.env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(idParam(c)).first<OrderRow>();
  if (!o) throw new WorkflowError("Order not found", 404);
  const me = c.get("person");
  if (!(canSeeAllDesign(me) || canAssign(me) || o.assigned_to === me.id)) throw new WorkflowError("This order isn't assigned to you", 403);
  return o;
}

api.get("/orders/:id", async (c) => {
  await loadForWork(c);
  return c.json(await orderDetail(c.env, idParam(c)));
});

api.post("/orders/:id/proof-sent", async (c) => {
  const b = await c.req.json<{ via?: "approve_pro" | "proof_page"; note?: string }>().catch(() => ({}) as { via?: "approve_pro" | "proof_page"; note?: string });
  await recordProofSent(c.env.DB, idParam(c), c.get("person"), { via: b.via ?? "approve_pro", note: b.note });
  return c.json(await orderDetail(c.env, idParam(c)));
});

api.post("/orders/:id/approve", async (c) => {
  const b = await c.req.json<{ machineIds?: number[]; method: (typeof APPROVAL_METHODS)[number]; note: string }>();
  await recordApproval(c.env.DB, idParam(c), c.get("person"), b);
  return c.json(await orderDetail(c.env, idParam(c)));
});

api.post("/orders/:id/request-changes", async (c) => {
  const b = await c.req.json<{ method: (typeof APPROVAL_METHODS)[number]; note: string }>();
  await recordRevisionRequest(c.env.DB, idParam(c), c.get("person"), b);
  return c.json(await orderDetail(c.env, idParam(c)));
});

api.post("/orders/:id/checklist", async (c) => {
  const { itemIds } = await c.req.json<{ itemIds: number[] }>();
  await signChecklist(c.env.DB, idParam(c), c.get("person"), itemIds ?? []);
  return c.json(await orderDetail(c.env, idParam(c)));
});

api.put("/machines/:id/length", async (c) => {
  const b = await c.req.json<{ quarterLength: number; reason?: string }>();
  const check = await setLength(c.env.DB, idParam(c), c.get("person"), b);
  return c.json({ ok: true, check });
});

api.post("/orders/:id/hand-off", async (c) => {
  const b = await c.req.json<{ machineIds?: number[]; productionNote?: string }>();
  const result = await handOff(c.env.DB, idParam(c), c.get("person"), b);
  return c.json({ ...result, order: await orderDetail(c.env, idParam(c)) });
});

api.post("/orders/:id/rush", async (c) => {
  const b = await c.req.json<{ note: string; customerPaying: boolean }>();
  await markRush(c.env.DB, idParam(c), c.get("person"), b);
  return c.json(await orderDetail(c.env, idParam(c)));
});

api.post("/orders/:id/custom", async (c) => {
  const b = await c.req.json<{ note: string }>();
  await markCustom(c.env.DB, idParam(c), c.get("person"), b);
  return c.json(await orderDetail(c.env, idParam(c)));
});

api.post("/orders/:id/print-file/pause", async (c) => {
  const { reason } = await c.req.json<{ reason: string }>();
  await pausePrintFile(c.env.DB, idParam(c), c.get("person"), reason);
  return c.json(await orderDetail(c.env, idParam(c)));
});

api.post("/orders/:id/print-file/resume", async (c) => {
  await resumePrintFile(c.env.DB, idParam(c), c.get("person"), await clockFor(c.env));
  return c.json(await orderDetail(c.env, idParam(c)));
});

// Orders that didn't come through Shopify: samples, warranty work, other sales systems.
api.post("/orders/manual", async (c) => {
  const me = c.get("person");
  if (!(canAssign(me) || me.role === "designer")) return forbid(c);
  const id = await createManualJob(c.env.DB, me, await c.req.json());
  return c.json({ id }, 201);
});

api.get("/meta", (c) => c.json({ finishes: FINISHES, approvalMethods: APPROVAL_METHODS, roles: ROLES }));

app.route("/api", api);

// Everything else is the React app.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
