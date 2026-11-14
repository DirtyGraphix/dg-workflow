// The customer proof page that replaces Approve Pro: sending proofs, customer approvals and change requests,
// the conversation on the order, and reminders. See docs/workflow-spec.md ("Replacing Approve Pro", "Order flow").
// Nothing here ever reads or returns a price.

import type { Env } from "../env";
import { newToken, type Person } from "./auth";
import { isWorkday, CLOSE_MINUTE, OPEN_MINUTE, type ClockOptions } from "./businessTime";
import { firstName, machineList, queueEmail, type EmailKind } from "./email";
import {
  addEvent,
  approvalStatements,
  assertCanWork,
  clockFor,
  getMachines,
  getOrder,
  getSettings,
  setStage,
  WorkflowError,
  type MachineRow,
  type OrderRow,
  type Stage,
} from "./orders";
import { FINISHES, type FinishCode } from "./shopify";

const now = () => new Date().toISOString();

export const PROOF_FILE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];
export const MAX_PROOF_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_CUSTOMER_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_CUSTOMER_FILES = 5;

export interface ProofRow {
  id: number;
  order_id: number;
  number: number;
  message: string | null;
  sent_by: number | null;
  sent_at: string;
  status: "open" | "approved" | "changes_requested" | "replaced" | "withdrawn";
  decided_at: string | null;
  viewed_at: string | null;
  last_viewed_at: string | null;
  approved_name: string | null;
}

export interface FileRow {
  id: number;
  order_id: number;
  proof_id: number | null;
  message_id: number | null;
  r2_key: string;
  filename: string;
  content_type: string;
  size: number;
  sort: number;
  uploaded_by: "staff" | "customer";
  created_at: string;
}

interface MessageRow {
  id: number;
  order_id: number;
  proof_id: number | null;
  author: "customer" | "staff";
  person_id: number | null;
  kind: "changes" | "message" | "reply";
  body: string;
  created_at: string;
}

// ---------- links ----------

/** The customer's link. Uses dirtygraphix.com/apps/proof once the app proxy is set up (Proof settings). */
export function proofLink(settings: Record<string, string>, origin: string, token: string): string {
  const base = settings.proof_link_base?.trim().replace(/\/+$/, "") || `${origin.replace(/\/+$/, "")}/proof`;
  return `${base}/${token}`;
}

export async function ensureProofToken(db: D1Database, order: OrderRow): Promise<string> {
  if (order.proof_token) return order.proof_token;
  const token = newToken();
  await db.prepare("UPDATE orders SET proof_token = ? WHERE id = ? AND proof_token IS NULL").bind(token, order.id).run();
  const row = await db.prepare("SELECT proof_token FROM orders WHERE id = ?").bind(order.id).first<{ proof_token: string }>();
  return row!.proof_token;
}

/** The customer's own link. Only this link can approve, ask for changes or send messages. */
export async function orderByToken(db: D1Database, token: string): Promise<OrderRow> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) throw new WorkflowError("This link isn't valid", 404);
  const o = await db.prepare("SELECT * FROM orders WHERE proof_token = ?").bind(token).first<OrderRow>();
  if (!o) throw new WorkflowError("This link isn't valid", 404);
  return o;
}

/** The customer's link, or an extra person's view-only link. */
export async function orderForViewing(db: D1Database, token: string): Promise<{ order: OrderRow; viewOnly: boolean }> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) throw new WorkflowError("This link isn't valid", 404);
  const o = await db.prepare("SELECT * FROM orders WHERE proof_token = ?").bind(token).first<OrderRow>();
  if (o) return { order: o, viewOnly: false };
  const v = await db
    .prepare("SELECT o.* FROM order_contacts c JOIN orders o ON o.id = c.order_id WHERE c.token = ? AND c.removed_at IS NULL")
    .bind(token)
    .first<OrderRow>();
  if (!v) throw new WorkflowError("This link isn't valid", 404);
  return { order: v, viewOnly: true };
}

// ---------- extra people (view only) ----------

export interface OrderContactRow {
  id: number;
  order_id: number;
  email: string;
  token: string;
  added_by: number | null;
  added_at: string;
  removed_at: string | null;
}

export async function contactsFor(db: D1Database, orderId: number) {
  const { results } = await db
    .prepare("SELECT c.id, c.email, c.added_at AS addedAt, p.name AS addedBy FROM order_contacts c LEFT JOIN people p ON p.id = c.added_by WHERE c.order_id = ? AND c.removed_at IS NULL ORDER BY c.id")
    .bind(orderId)
    .all<{ id: number; email: string; addedAt: string; addedBy: string | null }>();
  return results;
}

/** Sends the view-only copy to every extra person on the order. */
async function emailViewers(env: Env, order: OrderRow, machineNames: string[], opts: { origin: string; sentBy?: number | null; only?: number }) {
  const { results } = await env.DB
    .prepare("SELECT * FROM order_contacts WHERE order_id = ? AND removed_at IS NULL")
    .bind(order.id)
    .all<OrderContactRow>();
  const settings = await getSettings(env.DB);
  const designer = ((await personName(env.DB, order.assigned_to)) ?? "Our design team").split(" ")[0];
  let sent = 0;
  for (const c of results.filter((x) => !opts.only || x.id === opts.only)) {
    const ok = await queueEmail(env.DB, settings, {
      orderId: order.id,
      to: c.email,
      kind: "viewer_copy",
      url: proofLink(settings, opts.origin, c.token),
      sentBy: opts.sentBy,
      vars: {
        first_name: "there",
        customer_name: order.customer_name?.trim() || "The customer",
        order_number: order.order_number,
        designer,
        machines: machineList(machineNames),
      },
    });
    if (ok) sent++;
  }
  return sent;
}

/** Adds someone who gets a view-only copy of each proof. Optionally sends them the waiting proof now. */
export async function addViewer(env: Env, orderId: number, by: Person, input: { email: string; sendNow?: boolean; origin: string }) {
  const order = await getOrder(env.DB, orderId);
  const email = (input.email ?? "").trim();
  if (!EMAIL_PATTERN.test(email)) throw new WorkflowError("That email address doesn't look right");
  if (email.toLowerCase() === (order.customer_email ?? "").toLowerCase()) throw new WorkflowError("That's already the main customer's email");
  const existing = await contactsFor(env.DB, orderId);
  if (existing.some((c) => c.email.toLowerCase() === email.toLowerCase())) throw new WorkflowError("That person is already on this order");
  if (existing.length >= 5) throw new WorkflowError("An order can have up to 5 extra people");
  const row = await env.DB
    .prepare("INSERT INTO order_contacts (order_id, email, token, added_by) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(orderId, email, newToken(), by.id)
    .first<{ id: number }>();
  await addEvent(env.DB, { orderId, kind: "viewer_added", personId: by.id, data: { email } }).run();
  if (!input.sendNow) return { sent: false };
  const machines = await openProofMachines(env.DB, orderId);
  if (!machines.length) return { sent: false };
  return { sent: (await emailViewers(env, order, machines, { origin: input.origin, sentBy: by.id, only: row!.id })) > 0 };
}

/** Removes an extra person. Their link stops working. */
export async function removeViewer(env: Env, orderId: number, contactId: number, by: Person) {
  const c = await env.DB.prepare("SELECT * FROM order_contacts WHERE id = ? AND order_id = ? AND removed_at IS NULL").bind(contactId, orderId).first<OrderContactRow>();
  if (!c) throw new WorkflowError("That person isn't on this order", 404);
  await env.DB.batch([
    env.DB.prepare("UPDATE order_contacts SET removed_at = ? WHERE id = ?").bind(now(), contactId),
    addEvent(env.DB, { orderId, kind: "viewer_removed", personId: by.id, data: { email: c.email } }),
  ]);
}

// ---------- reads ----------

async function proofsFor(db: D1Database, orderId: number) {
  const { results: proofs } = await db.prepare("SELECT * FROM proofs WHERE order_id = ? ORDER BY sent_at, id").bind(orderId).all<ProofRow>();
  const { results: links } = await db
    .prepare("SELECT pm.proof_id, pm.machine_id FROM proof_machines pm JOIN proofs p ON p.id = pm.proof_id WHERE p.order_id = ?")
    .bind(orderId)
    .all<{ proof_id: number; machine_id: number }>();
  const { results: files } = await db.prepare("SELECT * FROM files WHERE order_id = ? ORDER BY sort, id").bind(orderId).all<FileRow>();
  return proofs.map((p) => ({
    ...p,
    machineIds: links.filter((l) => l.proof_id === p.id).map((l) => l.machine_id),
    files: files.filter((f) => f.proof_id === p.id),
  }));
}
type ProofWithParts = Awaited<ReturnType<typeof proofsFor>>[number];

async function messagesFor(db: D1Database, orderId: number) {
  const { results } = await db
    .prepare("SELECT m.*, p.name AS person FROM messages m LEFT JOIN people p ON p.id = m.person_id WHERE m.order_id = ? ORDER BY m.created_at, m.id")
    .bind(orderId)
    .all<MessageRow & { person: string | null }>();
  const { results: files } = await db.prepare("SELECT * FROM files WHERE order_id = ? AND message_id IS NOT NULL ORDER BY sort, id").bind(orderId).all<FileRow>();
  return results.map((m) => ({ ...m, files: files.filter((f) => f.message_id === m.id) }));
}

async function personName(db: D1Database, id: number | null): Promise<string | null> {
  if (!id) return null;
  return (await db.prepare("SELECT name FROM people WHERE id = ?").bind(id).first<{ name: string }>())?.name ?? null;
}

/** Proofs and the conversation, for the designer's order panel. */
export async function proofsForStaff(db: D1Database, orderId: number) {
  const [proofs, messages] = await Promise.all([proofsFor(db, orderId), messagesFor(db, orderId)]);
  const { results: people } = await db.prepare("SELECT id, name FROM people").all<{ id: number; name: string }>();
  const nameOf = (id: number | null) => people.find((p) => p.id === id)?.name ?? null;
  const fileView = (f: FileRow) => ({ id: f.id, filename: f.filename, contentType: f.content_type, size: f.size, url: `/api/files/${f.id}` });
  return {
    proofs: proofs.map((p) => ({
      id: p.id,
      number: p.number,
      status: p.status,
      message: p.message,
      sentAt: p.sent_at,
      sentBy: nameOf(p.sent_by),
      decidedAt: p.decided_at,
      viewedAt: p.viewed_at,
      lastViewedAt: p.last_viewed_at,
      machineIds: p.machineIds,
      files: p.files.map(fileView),
    })),
    messages: messages.map((m) => ({
      id: m.id,
      proofId: m.proof_id,
      author: m.author,
      person: m.person,
      kind: m.kind,
      body: m.body,
      createdAt: m.created_at,
      files: m.files.map(fileView),
    })),
  };
}

// ---------- stage ----------

/**
 * After a proof action, works out where the order sits:
 * a change request still waiting on a revision → revision requested; a proof out → waiting on customer;
 * a proofed machine with nothing sent yet → needs a proof.
 */
async function settleStage(db: D1Database, orderId: number) {
  const order = await getOrder(db, orderId);
  if (!["needs_first_proof", "proof_sent", "revision_requested", "approved"].includes(order.stage)) return;
  const machines = (await getMachines(db, orderId)).filter((m) => m.needs_proof);
  const pending = machines.filter((m) => !m.approved_at);
  if (!pending.length) return; // approvals set "approved" themselves
  const proofs = (await proofsFor(db, orderId)).filter((p) => p.status !== "withdrawn" && p.status !== "replaced");
  const latest = (m: MachineRow) => [...proofs].reverse().find((p) => p.machineIds.includes(m.id));
  const states = pending.map((m) => latest(m)?.status ?? null);
  let stage: Stage;
  if (states.includes("changes_requested")) stage = "revision_requested";
  else if (states.includes("open")) stage = "proof_sent";
  else if (order.stage === "revision_requested") stage = "revision_requested"; // asked for changes by phone, no proof out
  else stage = "needs_first_proof";
  if (stage !== order.stage) await setStage(db, orderId, stage).run();
}

// ---------- files ----------

const safeName = (name: string) => (name || "file").replace(/[^\w.\- ]+/g, "_").slice(-120);

async function storeFiles(
  env: Env,
  orderId: number,
  files: File[],
  where: { proofId?: number; messageId?: number; by: "staff" | "customer" },
): Promise<D1PreparedStatement[]> {
  const stmts: D1PreparedStatement[] = [];
  for (const [i, f] of files.entries()) {
    const key = `orders/${orderId}/${where.proofId ? `proofs/${where.proofId}` : `messages/${where.messageId}`}/${i}-${crypto.randomUUID()}-${safeName(f.name)}`;
    await env.PROOFS.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type || "application/octet-stream" } });
    stmts.push(
      env.DB
        .prepare("INSERT INTO files (order_id, proof_id, message_id, r2_key, filename, content_type, size, sort, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(orderId, where.proofId ?? null, where.messageId ?? null, key, safeName(f.name), f.type || "application/octet-stream", f.size, i, where.by),
    );
  }
  return stmts;
}

function checkCustomerFiles(files: File[], settings: Record<string, string>) {
  if (!files.length) return;
  if (settings.proof_customer_uploads !== "1") throw new WorkflowError("File uploads are turned off");
  if (files.length > MAX_CUSTOMER_FILES) throw new WorkflowError(`Attach up to ${MAX_CUSTOMER_FILES} files`);
  if (files.some((f) => f.size > MAX_CUSTOMER_FILE_BYTES)) throw new WorkflowError("Each file can be up to 20 MB");
}

function checkComment(text: string, settings: Record<string, string>, required: boolean): string {
  const t = (text ?? "").trim();
  if (required && !t) throw new WorkflowError("Tell us what to change");
  const max = Number(settings.proof_max_comment) || 500;
  if (t.length > max) throw new WorkflowError(`Keep it under ${max} characters`);
  return t;
}

// ---------- emails ----------

async function emailCustomer(
  env: Env,
  order: OrderRow,
  kind: EmailKind,
  machineNames: string[],
  opts: { origin: string; message?: string; sentBy?: number | null; settings?: Record<string, string> },
) {
  const settings = opts.settings ?? (await getSettings(env.DB));
  const token = await ensureProofToken(env.DB, order);
  const designer = (await personName(env.DB, order.assigned_to)) ?? "Our design team";
  return queueEmail(env.DB, settings, {
    orderId: order.id,
    to: order.customer_email,
    kind,
    url: proofLink(settings, opts.origin, token),
    sentBy: opts.sentBy,
    vars: {
      first_name: firstName(order.customer_name),
      order_number: order.order_number,
      designer: designer.split(" ")[0],
      machines: machineList(machineNames),
      message: opts.message,
    },
  });
}

// ---------- designer actions ----------

/**
 * Sends a proof sheet. Choose all machines for one sheet, or one machine per proof to split them so the
 * customer can approve one machine at a time. A newer proof replaces any open proof for the same machines.
 */
export async function sendProof(
  env: Env,
  orderId: number,
  by: Person,
  input: { machineIds: number[]; message?: string; files: File[]; origin: string },
) {
  const db = env.DB;
  const order = await getOrder(db, orderId);
  assertCanWork(order, by);
  if (!["needs_first_proof", "proof_sent", "revision_requested", "approved"].includes(order.stage)) throw new WorkflowError("A proof can't be sent at this stage", 409);
  if (order.in_approve_pro) throw new WorkflowError("This order is finishing in Approve Pro", 409);
  const machines = await getMachines(db, orderId);
  const targets = machines.filter((m) => input.machineIds.includes(m.id));
  if (!targets.length) throw new WorkflowError("Pick which machines this proof covers");
  if (targets.some((m) => !m.needs_proof)) throw new WorkflowError("Matching items use the machine design and don't get a proof");
  if (targets.some((m) => m.approved_at)) throw new WorkflowError("One of those machines is already approved", 409);
  if (!input.files.length) throw new WorkflowError("Add the proof image");
  if (input.files.some((f) => !PROOF_FILE_TYPES.includes(f.type))) throw new WorkflowError("Proofs can be PNG, JPG, WebP, GIF or PDF");
  if (input.files.some((f) => f.size > MAX_PROOF_FILE_BYTES)) throw new WorkflowError("Each proof file can be up to 25 MB");

  const ids = targets.map((m) => m.id);
  const marks = ids.map(() => "?").join(",");
  const prior = await db
    .prepare(
      `SELECT COALESCE(MAX(c), 0) AS n FROM (SELECT COUNT(*) AS c FROM proof_machines pm JOIN proofs p ON p.id = pm.proof_id
       WHERE pm.machine_id IN (${marks}) AND p.status NOT IN ('withdrawn') GROUP BY pm.machine_id)`,
    )
    .bind(...ids)
    .first<{ n: number }>();
  const number = (prior?.n ?? 0) + 1;
  const at = now();
  const proof = await db
    .prepare("INSERT INTO proofs (order_id, number, message, sent_by, sent_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(orderId, number, input.message?.trim() || null, by.id, at)
    .first<{ id: number }>();
  const proofId = proof!.id;
  const stmts = await storeFiles(env, orderId, input.files, { proofId, by: "staff" });
  stmts.push(
    ...ids.map((id) => db.prepare("INSERT INTO proof_machines (proof_id, machine_id) VALUES (?, ?)").bind(proofId, id)),
    db
      .prepare(`UPDATE proofs SET status = 'replaced' WHERE order_id = ? AND id != ? AND status = 'open' AND id IN (SELECT proof_id FROM proof_machines WHERE machine_id IN (${marks}))`)
      .bind(orderId, proofId, ...ids),
    db.prepare("UPDATE orders SET customer_unread = 0 WHERE id = ?").bind(orderId),
    addEvent(db, {
      orderId,
      kind: "proof_sent",
      personId: by.id,
      note: input.message?.trim() || null,
      data: { via: "proof_page", first: order.stage === "needs_first_proof", proofId, number, machineIds: ids },
      at,
    }),
  );
  await db.batch(stmts);
  await settleStage(db, orderId);
  await emailCustomer(env, order, number === 1 ? "proof_ready" : "revision_ready", targets.map((m) => m.machine), { origin: input.origin, sentBy: by.id });
  await emailViewers(env, order, targets.map((m) => m.machine), { origin: input.origin, sentBy: by.id });
  return proofId;
}

/** Takes back a proof sent by mistake. The customer no longer sees it. */
export async function withdrawProof(env: Env, orderId: number, proofId: number, by: Person) {
  const order = await getOrder(env.DB, orderId);
  assertCanWork(order, by);
  const p = await env.DB.prepare("SELECT * FROM proofs WHERE id = ? AND order_id = ?").bind(proofId, orderId).first<ProofRow>();
  if (!p) throw new WorkflowError("Proof not found", 404);
  if (p.status !== "open") throw new WorkflowError("Only a proof still waiting on the customer can be taken back", 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE proofs SET status = 'withdrawn' WHERE id = ?").bind(proofId),
    addEvent(env.DB, { orderId, kind: "proof_withdrawn", personId: by.id, data: { proofId, number: p.number } }),
  ]);
  await settleStage(env.DB, orderId);
}

/** The designer writes to the customer: a reply on the order, or a message before any proof has gone out. */
export async function staffMessage(env: Env, orderId: number, by: Person, body: string, origin: string) {
  const order = await getOrder(env.DB, orderId);
  assertCanWork(order, by);
  const text = (body ?? "").trim();
  if (!text) throw new WorkflowError("Write a message first");
  if (text.length > 5000) throw new WorkflowError("That message is too long");
  const anyProof = await env.DB.prepare("SELECT 1 FROM proofs WHERE order_id = ? AND status != 'withdrawn' LIMIT 1").bind(orderId).first();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (order_id, author, person_id, kind, body) VALUES (?, 'staff', ?, 'reply', ?)").bind(orderId, by.id, text),
    env.DB.prepare("UPDATE orders SET customer_unread = 0 WHERE id = ?").bind(orderId),
    addEvent(env.DB, { orderId, kind: "message_sent", personId: by.id, note: text }),
  ]);
  const machines = (await getMachines(env.DB, orderId)).filter((m) => m.needs_proof).map((m) => m.machine);
  const emailed = await emailCustomer(env, order, anyProof ? "reply" : "message", machines, { origin, message: text, sentBy: by.id });
  return { emailed };
}

async function openProofMachines(db: D1Database, orderId: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT m.machine, m.position FROM proofs p JOIN proof_machines pm ON pm.proof_id = p.id JOIN machines m ON m.id = pm.machine_id
       WHERE p.order_id = ? AND p.status = 'open' ORDER BY m.position`,
    )
    .bind(orderId)
    .all<{ machine: string }>();
  return results.map((r) => r.machine);
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Corrects the customer's email or phone on the order (a typo, or a different person handling the order).
 * Logged with who changed it and the old and new value. Optionally emails any waiting proof to the new address.
 */
export async function updateContact(
  env: Env,
  orderId: number,
  by: Person,
  input: { email?: string; phone?: string; resendProof?: boolean; origin: string },
): Promise<{ resent: boolean }> {
  const order = await getOrder(env.DB, orderId);
  const stmts: D1PreparedStatement[] = [];
  const changes: { field: string; from: string | null; to: string | null }[] = [];
  if (input.email !== undefined) {
    const email = input.email.trim();
    if (!EMAIL_PATTERN.test(email)) throw new WorkflowError("That email address doesn't look right");
    if (email !== order.customer_email) changes.push({ field: "email", from: order.customer_email, to: email });
  }
  if (input.phone !== undefined) {
    const phone = input.phone.trim() || null;
    if (phone !== order.customer_phone) changes.push({ field: "phone", from: order.customer_phone, to: phone });
  }
  for (const c of changes) {
    stmts.push(
      env.DB.prepare(`UPDATE orders SET ${c.field === "email" ? "customer_email" : "customer_phone"} = ? WHERE id = ?`).bind(c.to, orderId),
      addEvent(env.DB, { orderId, kind: "contact_changed", personId: by.id, data: c }),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  const emailChanged = changes.some((c) => c.field === "email");
  if (!emailChanged || !input.resendProof) return { resent: false };
  // Send the waiting proof to the corrected address, as a proof-ready or revision-ready email.
  const machines = await openProofMachines(env.DB, orderId);
  if (!machines.length) return { resent: false };
  const latest = await env.DB.prepare("SELECT MAX(number) AS n FROM proofs WHERE order_id = ? AND status = 'open'").bind(orderId).first<{ n: number }>();
  const updated = await getOrder(env.DB, orderId);
  const resent = await emailCustomer(env, updated, (latest?.n ?? 1) > 1 ? "revision_ready" : "proof_ready", machines, { origin: input.origin, sentBy: by.id });
  if (resent) await addEvent(env.DB, { orderId, kind: "proof_resent", personId: by.id, data: { to: updated.customer_email } }).run();
  return { resent };
}

/** A reminder sent by hand from the order. Logged with who sent it. */
export async function sendReminder(env: Env, orderId: number, by: Person, origin: string) {
  const order = await getOrder(env.DB, orderId);
  assertCanWork(order, by);
  const machines = await openProofMachines(env.DB, orderId);
  if (!machines.length) throw new WorkflowError("No proof is waiting on the customer", 409);
  if (!order.customer_email) throw new WorkflowError("This order has no customer email", 409);
  const settings = await getSettings(env.DB);
  const sent = await emailCustomer(env, order, "reminder", machines, { origin, sentBy: by.id, settings });
  if (!sent) throw new WorkflowError("Reminder emails are turned off in Proof settings", 409);
  await addEvent(env.DB, { orderId, kind: "reminder_sent", personId: by.id, data: { automatic: false } }).run();
}

export async function markRead(db: D1Database, orderId: number) {
  await db.prepare("UPDATE orders SET customer_unread = 0 WHERE id = ? AND customer_unread = 1").bind(orderId).run();
}

// ---------- customer page ----------

export interface CustomerProof {
  id: number;
  label: string;
  status: ProofRow["status"];
  message: string | null;
  designer: string | null;
  sentAt: string;
  decidedAt: string | null;
  canUndo: boolean;
  machines: { machine: string; kit: string | null; finish: string | null }[];
  files: { id: number; filename: string; contentType: string; size: number }[];
  changes: { body: string; at: string } | null;
}

export interface CustomerView {
  token: string;
  orderNumber: string;
  firstName: string;
  designer: string;
  stage: Stage;
  closed: boolean;
  /** An extra person's link: they can look but not approve, ask for changes or message. */
  viewOnly: boolean;
  customerFirstName: string;
  proofs: CustomerProof[];
  history: CustomerProof[];
  messages: { author: "customer" | "staff"; name: string; body: string; at: string; files: { id: number; filename: string }[] }[];
  settings: Record<string, string>;
}

const proofLabel = (n: number) => (n <= 1 ? "First proof" : `Revision ${n - 1}`);

/** Everything the customer sees. Machine names, finishes and the designer's notes; never prices or internal notes. */
export async function customerView(env: Env, token: string, opts: { trackView: boolean }): Promise<CustomerView> {
  const db = env.DB;
  const { order, viewOnly } = await orderForViewing(db, token);
  const settings = await getSettings(db);
  const machines = await getMachines(db, order.id);
  const proofs = await proofsFor(db, order.id);
  const messages = await messagesFor(db, order.id);
  const { results: people } = await db.prepare("SELECT id, name FROM people").all<{ id: number; name: string }>();
  const first = (id: number | null) => people.find((p) => p.id === id)?.name.split(" ")[0] ?? null;
  const designer = first(order.assigned_to) ?? "Our design team";
  const windowMs = (Number(settings.proof_change_window_minutes) || 0) * 60_000;
  const closed = order.stage === "handed_off" || order.stage === "cancelled";

  const toView = (p: ProofWithParts): CustomerProof => {
    const ms = machines.filter((m) => p.machineIds.includes(m.id));
    const change = [...messages].reverse().find((m) => m.proof_id === p.id && m.kind === "changes");
    return {
      id: p.id,
      label: proofLabel(p.number),
      status: p.status,
      message: p.message,
      designer: first(p.sent_by),
      sentAt: p.sent_at,
      decidedAt: p.decided_at,
      canUndo:
        p.status === "approved" &&
        !closed &&
        !!p.decided_at &&
        windowMs > 0 &&
        Date.now() - new Date(p.decided_at).getTime() < windowMs &&
        ms.every((m) => !m.handed_off_at && m.approval_method === "proof_page"),
      machines: ms.map((m) => ({ machine: m.machine, kit: m.kit, finish: m.finish ? FINISHES[m.finish as FinishCode] ?? m.finish : null })),
      files: p.files.map((f) => ({ id: f.id, filename: f.filename, contentType: f.content_type, size: f.size })),
      changes: change ? { body: change.body, at: change.created_at } : null,
    };
  };

  // What's current: the latest live proof for each machine. Older versions are history.
  const live = proofs.filter((p) => p.status !== "withdrawn" && p.status !== "replaced");
  const current = new Set<number>();
  for (const m of machines) {
    const latest = [...live].reverse().find((p) => p.machineIds.includes(m.id));
    if (latest) current.add(latest.id);
  }
  const shown = proofs.filter((p) => current.has(p.id));
  const order_ = (p: ProofWithParts) => (p.status === "open" ? 0 : p.status === "changes_requested" ? 1 : 2);
  shown.sort((a, b) => order_(a) - order_(b) || a.id - b.id);
  const history =
    settings.proof_show_history === "1"
      ? proofs.filter((p) => !current.has(p.id) && p.status !== "withdrawn").reverse().map(toView)
      : [];

  // Only the main customer opening a proof counts as "viewed".
  if (opts.trackView && !viewOnly) {
    const open = shown.filter((p) => p.status === "open").map((p) => p.id);
    if (open.length) {
      const at = now();
      await db
        .prepare(`UPDATE proofs SET viewed_at = COALESCE(viewed_at, ?), last_viewed_at = ? WHERE id IN (${open.map(() => "?").join(",")})`)
        .bind(at, at, ...open)
        .run();
    }
  }

  return {
    token,
    orderNumber: order.order_number,
    firstName: firstName(order.customer_name),
    designer,
    stage: order.stage,
    closed,
    viewOnly,
    customerFirstName: firstName(order.customer_name),
    proofs: shown.map((p) => ({ ...toView(p), canUndo: !viewOnly && toView(p).canUndo })),
    history,
    // The conversation stays between the customer and their designer.
    messages: viewOnly ? [] : messages.map((m) => ({
      author: m.author,
      name: m.author === "customer" ? "You" : first(m.person_id) ?? "Dirty Graphix",
      body: m.body,
      at: m.created_at,
      files: m.files.map((f) => ({ id: f.id, filename: f.filename })),
    })),
    settings,
  };
}

async function customerProof(db: D1Database, token: string, proofId: number) {
  const order = await orderByToken(db, token);
  const proof = (await proofsFor(db, order.id)).find((p) => p.id === proofId);
  if (!proof) throw new WorkflowError("That proof isn't on this order", 404);
  return { order, proof };
}

export async function customerApprove(env: Env, token: string, proofId: number, input: { comment?: string; acknowledged?: boolean; origin: string }) {
  const db = env.DB;
  const { order, proof } = await customerProof(db, token, proofId);
  if (order.stage === "cancelled" || order.stage === "handed_off") throw new WorkflowError("This order can't be changed online anymore. Give us a call.", 409);
  if (proof.status === "approved") return; // double click
  if (proof.status !== "open") throw new WorkflowError("There's a newer version of this design. Refresh the page.", 409);
  const settings = await getSettings(db);
  if (settings.proof_require_ack === "1" && !input.acknowledged) throw new WorkflowError("Check each item before you approve");
  const comment = settings.proof_comment_on_approve === "1" ? checkComment(input.comment ?? "", settings, false) : "";
  const machines = await getMachines(db, order.id);
  const targets = machines.filter((m) => proof.machineIds.includes(m.id) && !m.approved_at);
  const at = now();
  const stmts = approvalStatements(db, order.id, machines, targets, {
    method: "proof_page",
    personId: null,
    note: comment ? `Customer: ${comment}` : null,
    data: { proofId },
  });
  stmts.push(db.prepare("UPDATE proofs SET status = 'approved', decided_at = ? WHERE id = ? AND status = 'open'").bind(at, proofId));
  if (comment) {
    stmts.push(
      db.prepare("INSERT INTO messages (order_id, proof_id, author, kind, body) VALUES (?, ?, 'customer', 'message', ?)").bind(order.id, proofId, comment),
      db.prepare("UPDATE orders SET customer_unread = 1 WHERE id = ?").bind(order.id),
    );
  }
  await db.batch(stmts);
  await settleStage(db, order.id);
  await emailCustomer(env, order, "approved", targets.map((m) => m.machine), { origin: input.origin, settings });
}

/** "Approve your design accidentally? Change it." Allowed for a short window (Proof settings), before hand-off. */
export async function customerUndo(env: Env, token: string, proofId: number) {
  const db = env.DB;
  const { order, proof } = await customerProof(db, token, proofId);
  const settings = await getSettings(db);
  const windowMs = (Number(settings.proof_change_window_minutes) || 0) * 60_000;
  const machines = await getMachines(db, order.id);
  const targets = machines.filter((m) => proof.machineIds.includes(m.id));
  if (
    proof.status !== "approved" ||
    !proof.decided_at ||
    Date.now() - new Date(proof.decided_at).getTime() >= windowMs ||
    order.stage === "handed_off" ||
    order.stage === "cancelled" ||
    targets.some((m) => m.handed_off_at || m.approval_method !== "proof_page")
  ) {
    throw new WorkflowError("This approval can't be changed online anymore. Message your designer below.", 409);
  }
  const stmts: D1PreparedStatement[] = [
    ...targets.map((m) => db.prepare("UPDATE machines SET approved_at = NULL, approval_method = NULL WHERE id = ?").bind(m.id)),
    // Matching items follow their machine, so they wait again too.
    ...machines.filter((m) => !m.needs_proof && m.approval_method === "matches_machine" && !m.handed_off_at).map((m) => db.prepare("UPDATE machines SET approved_at = NULL, approval_method = NULL WHERE id = ?").bind(m.id)),
    db.prepare("UPDATE proofs SET status = 'open', decided_at = NULL WHERE id = ?").bind(proofId),
    addEvent(db, { orderId: order.id, kind: "approval_undone", note: "Customer took back the approval on the proof page", data: { proofId, machineIds: targets.map((m) => m.id) } }),
  ];
  if (order.stage === "approved") stmts.push(setStage(db, order.id, "proof_sent"));
  await db.batch(stmts);
  await settleStage(db, order.id);
}

export async function customerRequestChanges(env: Env, token: string, proofId: number, input: { comment: string; files: File[]; origin: string }) {
  const db = env.DB;
  const { order, proof } = await customerProof(db, token, proofId);
  if (order.stage === "cancelled" || order.stage === "handed_off") throw new WorkflowError("This order can't be changed online anymore. Give us a call.", 409);
  if (proof.status !== "open") throw new WorkflowError("There's a newer version of this design. Refresh the page.", 409);
  const settings = await getSettings(db);
  const comment = checkComment(input.comment, settings, true);
  checkCustomerFiles(input.files, settings);
  const at = now();
  const msg = await db
    .prepare("INSERT INTO messages (order_id, proof_id, author, kind, body, created_at) VALUES (?, ?, 'customer', 'changes', ?, ?) RETURNING id")
    .bind(order.id, proofId, comment, at)
    .first<{ id: number }>();
  const stmts = await storeFiles(env, order.id, input.files, { messageId: msg!.id, by: "customer" });
  stmts.push(
    db.prepare("UPDATE proofs SET status = 'changes_requested', decided_at = ? WHERE id = ?").bind(at, proofId),
    db.prepare("UPDATE orders SET customer_unread = 1 WHERE id = ?").bind(order.id),
    setStage(db, order.id, "revision_requested", at),
    addEvent(db, { orderId: order.id, kind: "revision_requested", note: comment, data: { method: "proof_page", proofId, files: input.files.length }, at }),
  );
  await db.batch(stmts);
  const names = (await getMachines(db, order.id)).filter((m) => proof.machineIds.includes(m.id)).map((m) => m.machine);
  await emailCustomer(env, order, "changes_received", names, { origin: input.origin, settings });
}

/** A message from the customer when no proof is waiting (questions, logo files, answers). */
export async function customerMessage(env: Env, token: string, input: { body: string; files: File[] }) {
  const db = env.DB;
  const order = await orderByToken(db, token);
  if (order.stage === "cancelled") throw new WorkflowError("This order was cancelled. Give us a call.", 409);
  const settings = await getSettings(db);
  const body = checkComment(input.body, settings, false);
  if (!body && !input.files.length) throw new WorkflowError("Write a message or attach a file");
  checkCustomerFiles(input.files, settings);
  const msg = await db
    .prepare("INSERT INTO messages (order_id, author, kind, body) VALUES (?, 'customer', 'message', ?) RETURNING id")
    .bind(order.id, body || "(sent files)")
    .first<{ id: number }>();
  const stmts = await storeFiles(env, order.id, input.files, { messageId: msg!.id, by: "customer" });
  stmts.push(
    db.prepare("UPDATE orders SET customer_unread = 1 WHERE id = ?").bind(order.id),
    addEvent(db, { orderId: order.id, kind: "customer_message", note: body || null, data: { files: input.files.length } }),
  );
  await db.batch(stmts);
}

// ---------- files out ----------

export async function fileForCustomer(env: Env, token: string, fileId: number) {
  const { order, viewOnly } = await orderForViewing(env.DB, token);
  const f = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND order_id = ?").bind(fileId, order.id).first<FileRow>();
  if (!f) throw new WorkflowError("File not found", 404);
  // Customers only see files on proofs they can see, and their own messages' files. Extra people see proof files only.
  if (viewOnly && !f.proof_id) throw new WorkflowError("File not found", 404);
  if (f.proof_id) {
    const p = await env.DB.prepare("SELECT status FROM proofs WHERE id = ?").bind(f.proof_id).first<{ status: string }>();
    if (!p || p.status === "withdrawn") throw new WorkflowError("File not found", 404);
  }
  return f;
}

export async function fileResponse(env: Env, f: FileRow, download: boolean): Promise<Response> {
  const obj = await env.PROOFS.get(f.r2_key);
  if (!obj) return new Response("File not found", { status: 404 });
  // Only images and PDFs open in the browser. Everything else downloads, so an uploaded file can't run as a page.
  const inline = !download && (f.content_type.startsWith("image/") ? f.content_type !== "image/svg+xml" : f.content_type === "application/pdf");
  return new Response(obj.body, {
    headers: {
      "content-type": inline ? f.content_type : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${f.filename.replace(/"/g, "")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
    },
  });
}

// ---------- automatic reminders (hourly cron) ----------

function isOpenNow(clock: ClockOptions, at: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  const y = Number(parts.year), mo = Number(parts.month), d = Number(parts.day);
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return isWorkday(y, mo, d, new Set(clock.closures ?? [])) && minute >= OPEN_MINUTE && minute < CLOSE_MINUTE;
}

/**
 * While a proof waits, reminders go out every N calendar days (Proof settings), up to the maximum, and
 * never past the cut-off. They only send during business hours so they land when someone can answer.
 */
export async function runReminders(env: Env, at = new Date()): Promise<number> {
  const clock = await clockFor(env);
  if (!isOpenNow(clock, at)) return 0;
  const settings = await getSettings(env.DB);
  const afterDays = Number(settings.reminder_after_days) || 0;
  let template: { on?: boolean } | null = null;
  try {
    template = JSON.parse(settings.email_reminder ?? "null");
  } catch {}
  if (!afterDays || !template?.on) return 0;
  const max = settings.reminder_recurring === "1" ? Number(settings.reminder_max) || 1 : 1;
  const stopDays = Number(settings.reminder_stop_days) || 28;
  const origin = env.APP_ORIGIN ?? "";
  const { results } = await env.DB
    .prepare(
      `SELECT o.*, (SELECT MAX(sent_at) FROM proofs p WHERE p.order_id = o.id AND p.status = 'open') AS waiting_since
       FROM orders o WHERE o.stage = 'proof_sent' AND o.in_approve_pro = 0 AND o.customer_email IS NOT NULL`,
    )
    .all<OrderRow & { waiting_since: string | null }>();
  let sent = 0;
  const day = 86_400_000;
  for (const o of results) {
    if (!o.waiting_since) continue;
    const since = new Date(o.waiting_since).getTime();
    if (at.getTime() - since > stopDays * day) continue;
    const prior = await env.DB
      .prepare("SELECT COUNT(*) AS n, MAX(created_at) AS last FROM outbox WHERE order_id = ? AND kind = 'reminder' AND created_at >= ?")
      .bind(o.id, o.waiting_since)
      .first<{ n: number; last: string | null }>();
    if ((prior?.n ?? 0) >= max) continue;
    const last = prior?.last ? new Date(prior.last).getTime() : since;
    if (at.getTime() - last < afterDays * day) continue;
    const machines = await openProofMachines(env.DB, o.id);
    if (!machines.length) continue;
    if (await emailCustomer(env, o, "reminder", machines, { origin, settings })) {
      await addEvent(env.DB, { orderId: o.id, kind: "reminder_sent", data: { automatic: true } }).run();
      sent++;
    }
  }
  return sent;
}
