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
  getSettings,
  type OrderRow,
} from "./lib/orders";
import { deliverOutbox, EMAIL_KINDS, EMAIL_LABELS } from "./lib/email";
import {
  customerApprove,
  customerMessage,
  customerRequestChanges,
  customerUndo,
  customerView,
  fileForCustomer,
  fileResponse,
  markRead,
  proofLink,
  proofsForStaff,
  runReminders,
  sendProof,
  sendReminder,
  staffMessage,
  withdrawProof,
  ensureProofToken,
  type FileRow,
} from "./lib/proofs";
import { renderNotFound, renderProofPage } from "./lib/proofPage";

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

// ---------- customer proof page ----------
// The link in the customer's email. Also works at dirtygraphix.com/apps/proof/... through a Shopify app proxy,
// which adds a path_prefix query parameter to every request it forwards.

const origin = (c: Context<AppEnv>) => new URL(c.req.url).origin;
function proofBase(c: Context<AppEnv>) {
  const prefix = c.req.query("path_prefix");
  return prefix && /^\/(apps|a|community|tools)\/[\w-]+$/.test(prefix) ? prefix : "/proof";
}

async function staffSession(c: Context<AppEnv>): Promise<Person | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  return c.env.DB.prepare(
    `SELECT p.id, p.name, p.email, p.role, p.takes_orders FROM sessions s JOIN people p ON p.id = s.person_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND p.active = 1`,
  )
    .bind(await sha256(token), new Date().toISOString())
    .first<Person>();
}

const pageHeaders = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };

async function showProofPage(c: Context<AppEnv>, extra: { error?: string; draft?: { proofId?: number; comment?: string; body?: string } } = {}, status = 200) {
  const token = c.req.param("token")!;
  try {
    // Staff opening the customer link don't count as the customer viewing it.
    const view = await customerView(c.env, token, { trackView: !extra.error && !(await staffSession(c)) });
    const html = renderProofPage(view, { base: proofBase(c), origin: origin(c), done: c.req.query("done") ?? null, ...extra });
    return c.body(html, status as 200, pageHeaders);
  } catch (e) {
    if (e instanceof WorkflowError && e.status === 404) return c.body(renderNotFound(origin(c)), 404, pageHeaders);
    throw e;
  }
}

const formFiles = (fd: FormData) => fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

async function customerAction(c: Context<AppEnv>, run: (fd: FormData, token: string) => Promise<string>) {
  const token = c.req.param("token")!;
  const fd = await c.req.formData();
  try {
    const done = await run(fd, token);
    c.executionCtx.waitUntil(deliverOutbox(c.env).catch(() => undefined));
    return c.redirect(`${proofBase(c)}/${token}?done=${done}`, 303);
  } catch (e) {
    if (!(e instanceof WorkflowError) || e.status === 404) throw e;
    return showProofPage(c, { error: e.message, draft: { proofId: Number(fd.get("proof")) || undefined, comment: String(fd.get("comment") ?? ""), body: String(fd.get("body") ?? "") } }, 400);
  }
}

app.get("/proof/:token", (c) => showProofPage(c));

app.post("/proof/:token/approve", (c) =>
  customerAction(c, async (fd, token) => {
    const settings = await getSettings(c.env.DB);
    const items = (settings.proof_ack_items ?? "").split("\n").filter((x) => x.trim()).length;
    await customerApprove(c.env, token, Number(fd.get("proof")), {
      comment: String(fd.get("comment") ?? ""),
      acknowledged: fd.getAll("ack").length >= items,
      origin: origin(c),
    });
    return "approved";
  }),
);

app.post("/proof/:token/undo", (c) =>
  customerAction(c, async (fd, token) => {
    await customerUndo(c.env, token, Number(fd.get("proof")));
    return "undone";
  }),
);

app.post("/proof/:token/changes", (c) =>
  customerAction(c, async (fd, token) => {
    await customerRequestChanges(c.env, token, Number(fd.get("proof")), { comment: String(fd.get("comment") ?? ""), files: formFiles(fd), origin: origin(c) });
    return "changes";
  }),
);

app.post("/proof/:token/message", (c) =>
  customerAction(c, async (fd, token) => {
    await customerMessage(c.env, token, { body: String(fd.get("body") ?? ""), files: formFiles(fd) });
    return "message";
  }),
);

app.get("/proof/:token/file/:id", async (c) => {
  try {
    const f = await fileForCustomer(c.env, c.req.param("token"), Number(c.req.param("id")));
    return fileResponse(c.env, f, c.req.query("download") === "1");
  } catch (e) {
    if (e instanceof WorkflowError) return c.text("File not found", 404);
    throw e;
  }
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

/** The order plus its proofs, conversation and the customer's link. Opening it as the designer marks customer messages read. */
async function fullOrder(c: Context<AppEnv>, id = idParam(c)) {
  const [detail, proofs, settings, row] = await Promise.all([
    orderDetail(c.env, id),
    proofsForStaff(c.env.DB, id),
    getSettings(c.env.DB),
    c.env.DB.prepare("SELECT proof_token, customer_unread FROM orders WHERE id = ?").bind(id).first<{ proof_token: string | null; customer_unread: number }>(),
  ]);
  return {
    ...detail,
    ...proofs,
    customerUnread: !!row?.customer_unread,
    customerLink: row?.proof_token ? proofLink(settings, origin(c), row.proof_token) : null,
  };
}

const deliverLater = (c: Context<AppEnv>) => c.executionCtx.waitUntil(deliverOutbox(c.env).catch(() => undefined));

api.get("/orders/:id", async (c) => {
  const o = await loadForWork(c);
  const full = await fullOrder(c);
  if (o.assigned_to === c.get("person").id && o.customer_unread) await markRead(c.env.DB, o.id);
  return c.json(full);
});

// Sends a proof to the customer: one sheet for the machines picked, with an optional note.
api.post("/orders/:id/proofs", async (c) => {
  await loadForWork(c);
  const fd = await c.req.formData();
  await sendProof(c.env, idParam(c), c.get("person"), {
    machineIds: fd.getAll("machineIds").map(Number).filter(Boolean),
    message: String(fd.get("message") ?? ""),
    files: formFiles(fd),
    origin: origin(c),
  });
  deliverLater(c);
  return c.json(await fullOrder(c), 201);
});

api.post("/orders/:id/proofs/:proofId/withdraw", async (c) => {
  await loadForWork(c);
  await withdrawProof(c.env, idParam(c), Number(c.req.param("proofId")), c.get("person"));
  return c.json(await fullOrder(c));
});

api.post("/orders/:id/messages", async (c) => {
  await loadForWork(c);
  const { body } = await c.req.json<{ body: string }>();
  const result = await staffMessage(c.env, idParam(c), c.get("person"), body, origin(c));
  deliverLater(c);
  return c.json({ ...result, order: await fullOrder(c) });
});

api.post("/orders/:id/reminder", async (c) => {
  await loadForWork(c);
  await sendReminder(c.env, idParam(c), c.get("person"), origin(c));
  deliverLater(c);
  return c.json(await fullOrder(c));
});

// The customer link, made on demand so it can be copied before the first proof goes out.
api.post("/orders/:id/customer-link", async (c) => {
  const o = await loadForWork(c);
  const token = await ensureProofToken(c.env.DB, o);
  return c.json({ link: proofLink(await getSettings(c.env.DB), origin(c), token) });
});

api.get("/files/:id", async (c) => {
  const f = await c.env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(idParam(c)).first<FileRow>();
  if (!f) return c.json({ error: "File not found" }, 404);
  const o = await c.env.DB.prepare("SELECT assigned_to FROM orders WHERE id = ?").bind(f.order_id).first<{ assigned_to: number | null }>();
  const me = c.get("person");
  if (!(canSeeAllDesign(me) || canAssign(me) || o?.assigned_to === me.id)) return forbid(c);
  return fileResponse(c.env, f, c.req.query("download") === "1");
});

api.post("/orders/:id/proof-sent", async (c) => {
  const b = await c.req.json<{ via?: "approve_pro" | "proof_page"; note?: string }>().catch(() => ({}) as { via?: "approve_pro" | "proof_page"; note?: string });
  await recordProofSent(c.env.DB, idParam(c), c.get("person"), { via: b.via ?? "approve_pro", note: b.note });
  return c.json(await fullOrder(c));
});

api.post("/orders/:id/approve", async (c) => {
  const b = await c.req.json<{ machineIds?: number[]; method: (typeof APPROVAL_METHODS)[number]; note: string }>();
  await recordApproval(c.env.DB, idParam(c), c.get("person"), b);
  // A proof whose machines are now all approved is approved too.
  await c.env.DB.prepare(
    `UPDATE proofs SET status = 'approved', decided_at = ? WHERE order_id = ? AND status = 'open'
     AND NOT EXISTS (SELECT 1 FROM proof_machines pm JOIN machines m ON m.id = pm.machine_id WHERE pm.proof_id = proofs.id AND m.approved_at IS NULL)`,
  ).bind(new Date().toISOString(), idParam(c)).run();
  return c.json(await fullOrder(c));
});

api.post("/orders/:id/request-changes", async (c) => {
  const b = await c.req.json<{ method: (typeof APPROVAL_METHODS)[number]; note: string }>();
  await recordRevisionRequest(c.env.DB, idParam(c), c.get("person"), b);
  await c.env.DB.prepare("UPDATE proofs SET status = 'changes_requested', decided_at = ? WHERE order_id = ? AND status = 'open'").bind(new Date().toISOString(), idParam(c)).run();
  return c.json(await fullOrder(c));
});

api.post("/orders/:id/checklist", async (c) => {
  const { itemIds } = await c.req.json<{ itemIds: number[] }>();
  await signChecklist(c.env.DB, idParam(c), c.get("person"), itemIds ?? []);
  return c.json(await fullOrder(c));
});

api.put("/machines/:id/length", async (c) => {
  const b = await c.req.json<{ quarterLength: number; reason?: string }>();
  const check = await setLength(c.env.DB, idParam(c), c.get("person"), b);
  return c.json({ ok: true, check });
});

api.post("/orders/:id/hand-off", async (c) => {
  const b = await c.req.json<{ machineIds?: number[]; productionNote?: string }>();
  const result = await handOff(c.env.DB, idParam(c), c.get("person"), b);
  return c.json({ ...result, order: await fullOrder(c) });
});

api.post("/orders/:id/rush", async (c) => {
  const b = await c.req.json<{ note: string; customerPaying: boolean }>();
  await markRush(c.env.DB, idParam(c), c.get("person"), b);
  return c.json(await fullOrder(c));
});

api.post("/orders/:id/custom", async (c) => {
  const b = await c.req.json<{ note: string }>();
  await markCustom(c.env.DB, idParam(c), c.get("person"), b);
  return c.json(await fullOrder(c));
});

api.post("/orders/:id/print-file/pause", async (c) => {
  const { reason } = await c.req.json<{ reason: string }>();
  await pausePrintFile(c.env.DB, idParam(c), c.get("person"), reason);
  return c.json(await fullOrder(c));
});

api.post("/orders/:id/print-file/resume", async (c) => {
  await resumePrintFile(c.env.DB, idParam(c), c.get("person"), await clockFor(c.env));
  return c.json(await fullOrder(c));
});

// Orders that didn't come through Shopify: samples, warranty work, other sales systems.
api.post("/orders/manual", async (c) => {
  const me = c.get("person");
  if (!(canAssign(me) || me.role === "designer")) return forbid(c);
  const id = await createManualJob(c.env.DB, me, await c.req.json());
  return c.json({ id }, 201);
});

// ---------- proof settings (TY) and reply templates ----------

const SETTING_PREFIXES = ["proof_", "text_", "reminder_", "email_"];
const isProofSetting = (k: string) => SETTING_PREFIXES.some((p) => k.startsWith(p));

api.get("/proof-settings", async (c) => {
  if (c.get("person").role !== "admin") return forbid(c);
  const all = await getSettings(c.env.DB);
  const { results: outbox } = await c.env.DB.prepare(
    `SELECT x.id, x.kind, x.to_email AS toEmail, x.status, x.created_at AS createdAt, x.sent_at AS sentAt, x.error, o.order_number AS orderNumber, p.name AS sentBy, x.payload_json
     FROM outbox x LEFT JOIN orders o ON o.id = x.order_id LEFT JOIN people p ON p.id = x.sent_by ORDER BY x.id DESC LIMIT 30`,
  ).all<Record<string, unknown> & { payload_json: string }>();
  return c.json({
    settings: Object.fromEntries(Object.entries(all).filter(([k]) => isProofSetting(k))),
    emails: EMAIL_KINDS.map((k) => ({ kind: k, ...EMAIL_LABELS[k] })),
    klaviyoConnected: !!c.env.KLAVIYO_PRIVATE_KEY,
    appOrigin: c.env.APP_ORIGIN ?? null,
    outbox: outbox.map(({ payload_json, ...r }) => ({ ...r, subject: JSON.parse(payload_json).subject as string })),
  });
});

api.put("/proof-settings", async (c) => {
  if (c.get("person").role !== "admin") return forbid(c);
  const body = await c.req.json<Record<string, string>>();
  const stmts: D1PreparedStatement[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (!isProofSetting(k) || typeof v !== "string") return c.json({ error: `Unknown setting: ${k}` }, 400);
    if (k.startsWith("email_") && k !== "email_bcc") {
      try {
        const t = JSON.parse(v);
        if (typeof t.on !== "boolean" || ![t.subject, t.heading, t.body, t.button].every((x) => typeof x === "string" && x.trim())) throw new Error();
      } catch {
        return c.json({ error: "Each email needs a subject, heading, message and button label" }, 400);
      }
    }
    if (k === "proof_link_base" && v.trim() && !/^https:\/\/[^\s]+$/.test(v.trim())) return c.json({ error: "The link address has to start with https://" }, 400);
    stmts.push(c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

const canEditTemplates = (p: Person) => p.role === "admin" || p.role === "lead";

api.get("/reply-templates", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name, body FROM reply_templates WHERE active = 1 ORDER BY name").all();
  return c.json(results);
});

api.post("/reply-templates", async (c) => {
  const me = c.get("person");
  if (!canEditTemplates(me)) return forbid(c);
  const b = await c.req.json<{ name: string; body: string }>();
  if (!b.name?.trim() || !b.body?.trim()) return c.json({ error: "Give the template a name and some text" }, 400);
  const row = await c.env.DB.prepare("INSERT INTO reply_templates (name, body, created_by) VALUES (?, ?, ?) RETURNING id").bind(b.name.trim(), b.body.trim(), me.id).first<{ id: number }>();
  return c.json({ id: row!.id }, 201);
});

api.patch("/reply-templates/:id", async (c) => {
  if (!canEditTemplates(c.get("person"))) return forbid(c);
  const b = await c.req.json<{ name?: string; body?: string; active?: boolean }>();
  if ((b.name !== undefined && !b.name.trim()) || (b.body !== undefined && !b.body.trim())) return c.json({ error: "Name and text can't be empty" }, 400);
  await c.env.DB.prepare("UPDATE reply_templates SET name = COALESCE(?, name), body = COALESCE(?, body), active = COALESCE(?, active) WHERE id = ?")
    .bind(b.name?.trim() ?? null, b.body?.trim() ?? null, b.active === undefined ? null : b.active ? 1 : 0, idParam(c))
    .run();
  return c.json({ ok: true });
});

api.get("/meta", (c) => c.json({ finishes: FINISHES, approvalMethods: APPROVAL_METHODS, roles: ROLES }));

app.route("/api", api);

// Everything else is the React app.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  // Hourly: automatic proof reminders (business hours only), then any emails still waiting to send.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        await runReminders(env);
        await deliverOutbox(env, 200);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
