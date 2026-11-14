// Order workflow for design: intake, assignment, proofs, approvals, checklist, lengths, hand-off.
// Follows docs/workflow-spec.md ("Order flow", "Design team", "Edge cases").

import type { Env } from "../env";
import {
  addBusinessMinutes,
  businessDaysDeadline,
  businessMinutesBetween,
  zonedTime,
  type ClockOptions,
} from "./businessTime";
import type { Person } from "./auth";
import type { FinishCode, IntakeSettings, JobKind, MappedOrder } from "./shopify";

export class WorkflowError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404 | 409 = 400,
    public data?: unknown,
  ) {
    super(message);
  }
}

export type Stage =
  | "unassigned"
  | "needs_first_proof"
  | "proof_sent"
  | "revision_requested"
  | "approved"
  | "handed_off"
  | "ship_only"
  | "cancelled";

export interface OrderRow {
  id: number;
  source: "shopify" | "manual";
  shopify_order_id: string | null;
  order_number: string;
  source_system: string | null;
  ordered_at: string;
  received_at: string;
  customer_name: string | null;
  company: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  ship_to: string | null;
  ship_method: string | null;
  order_note: string | null;
  uploads_json: string;
  payment_status: string;
  is_rush: number;
  is_dealer: number;
  is_custom: number;
  custom_reason: string | null;
  stage: Stage;
  stage_since: string;
  assigned_to: number | null;
  assigned_at: string | null;
  in_approve_pro: number;
  checklist_signed_by: number | null;
  checklist_signed_at: string | null;
  production_note: string | null;
  print_file_extra_minutes: number;
  print_file_paused_at: string | null;
  print_file_paused_by: number | null;
  print_file_pause_reason: string | null;
  proof_token: string | null;
  customer_unread: number;
}

export interface MachineRow {
  id: number;
  order_id: number;
  shopify_line_id: string | null;
  position: number;
  kind: JobKind;
  needs_proof: number;
  machine: string;
  kit: string | null;
  finish: FinishCode | null;
  selections_json: string;
  quarter_length_in: number | null;
  length_reason: string | null;
  approved_at: string | null;
  approval_method: string | null;
  handed_off_at: string | null;
  handed_off_by: number | null;
}

const now = () => new Date().toISOString();

// ---------- settings and clock ----------

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

export async function clockFor(env: Env): Promise<ClockOptions> {
  const { results } = await env.DB.prepare("SELECT day FROM closures").all<{ day: string }>();
  return { timeZone: env.SHOP_TIMEZONE || "America/Chicago", closures: new Set(results.map((r) => r.day)) };
}

const listSetting = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export async function intakeSettings(db: D1Database): Promise<IntakeSettings> {
  const s = await getSettings(db);
  return {
    rushTags: listSetting(s.rush_tags),
    dealerTags: listSetting(s.dealer_tags),
    customTags: listSetting(s.custom_tags),
    kitPatterns: listSetting(s.design_kit_patterns),
    sheetzPatterns: listSetting(s.design_sheetz_patterns),
    otherDesignPatterns: listSetting(s.design_other_patterns),
    matchingPatterns: listSetting(s.design_matching_patterns),
    optionPatterns: listSetting(s.design_option_patterns ?? "model options"),
  };
}

/** Business days a designer has to finish the print file after approval. */
export function printFileDays(order: Pick<OrderRow, "is_rush" | "is_custom">): number {
  if (order.is_rush) return 1;
  if (order.is_custom) return 5;
  return 3;
}

/** A machine's print file deadline, including any time the designer paused it. */
export function machineDue(order: OrderRow, machine: MachineRow, clock: ClockOptions, at = new Date()): string | null {
  if (!machine.approved_at || machine.handed_off_at) return null;
  let due = businessDaysDeadline(new Date(machine.approved_at), printFileDays(order), clock);
  let extra = order.print_file_extra_minutes;
  if (order.print_file_paused_at) extra += businessMinutesBetween(new Date(order.print_file_paused_at), at, clock);
  if (extra > 0) due = addBusinessMinutes(due, extra, clock);
  return due.toISOString();
}

// ---------- reads ----------

export async function getOrder(db: D1Database, id: number): Promise<OrderRow> {
  const o = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first<OrderRow>();
  if (!o) throw new WorkflowError("Order not found", 404);
  return o;
}

export async function getMachines(db: D1Database, orderId: number): Promise<MachineRow[]> {
  const { results } = await db.prepare("SELECT * FROM machines WHERE order_id = ? ORDER BY position, id").bind(orderId).all<MachineRow>();
  return results;
}

export function addEvent(
  db: D1Database,
  e: { orderId: number; machineId?: number | null; kind: string; personId?: number | null; note?: string | null; data?: unknown; at?: string },
) {
  return db
    .prepare("INSERT INTO events (order_id, machine_id, kind, at, person_id, note, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(e.orderId, e.machineId ?? null, e.kind, e.at ?? now(), e.personId ?? null, e.note ?? null, e.data === undefined ? null : JSON.stringify(e.data));
}

export function setStage(db: D1Database, orderId: number, stage: Stage, at = now()) {
  return db.prepare("UPDATE orders SET stage = ?, stage_since = ? WHERE id = ?").bind(stage, at, orderId);
}

/** Only the assigned designer, the team lead or TY can work an order. */
export function assertCanWork(order: OrderRow, person: Person) {
  if (person.role === "admin" || person.role === "lead") return;
  if (order.assigned_to !== person.id) throw new WorkflowError("This order isn't assigned to you", 403);
}

// ---------- intake ----------

export async function ingestShopifyOrder(db: D1Database, m: MappedOrder): Promise<{ id: number; created: boolean }> {
  const existing = await db.prepare("SELECT id FROM orders WHERE shopify_order_id = ?").bind(m.shopifyOrderId).first<{ id: number }>();
  if (existing) return { id: existing.id, created: false };
  const row = await db
    .prepare(
      `INSERT INTO orders (source, shopify_order_id, order_number, ordered_at, customer_name, company, customer_email,
         customer_phone, ship_to, ship_method, order_note, uploads_json, payment_status, is_rush, is_dealer, is_custom, custom_reason)
       VALUES ('shopify', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      m.shopifyOrderId, m.orderNumber, m.orderedAt, m.customerName, m.company, m.customerEmail, m.customerPhone,
      m.shipTo, m.shipMethod, m.orderNote, JSON.stringify(m.uploads), m.paymentStatus,
      m.isRush ? 1 : 0, m.isDealer ? 1 : 0, m.isCustom ? 1 : 0, m.customReason,
    )
    .first<{ id: number }>();
  const id = row!.id;
  const shipOnly = m.machines.length === 0;
  const stmts = m.machines.map((mc, i) =>
    db
      .prepare("INSERT INTO machines (order_id, shopify_line_id, position, kind, needs_proof, machine, kit, finish, selections_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, mc.shopifyLineId, i, mc.kind, mc.needsProof ? 1 : 0, mc.machine, mc.kit, mc.finish, JSON.stringify(mc.selections)),
  );
  stmts.push(
    ...m.shipItems.map((it) =>
      db
        .prepare(
          `INSERT INTO order_items (order_id, shopify_line_id, title, variant, quantity, attached_to)
           VALUES (?, ?, ?, ?, ?, (SELECT id FROM machines WHERE order_id = ? AND shopify_line_id = ?))`,
        )
        .bind(id, it.shopifyLineId, it.title, it.variant, it.quantity, id, it.attachedToLineId),
    ),
  );
  stmts.push(addEvent(db, { orderId: id, kind: "received", note: "From Shopify", at: m.orderedAt }));
  // Nothing to design (application kits, apparel): it goes straight to production to ship.
  if (shipOnly) stmts.push(setStage(db, id, "ship_only", m.orderedAt), addEvent(db, { orderId: id, kind: "ship_only", note: "Nothing to design. Sent to production to ship." }));
  await db.batch(stmts);
  return { id, created: true };
}

/** Keeps payment status in step with Shopify, and pulls cancelled orders out of the queues. */
export async function updateFromShopify(
  db: D1Database,
  shopifyId: string,
  payload: { financial_status?: string; cancelled_at?: string | null; email?: string | null; phone?: string | null },
) {
  const o = await db.prepare("SELECT * FROM orders WHERE shopify_order_id = ?").bind(shopifyId).first<OrderRow>();
  if (!o) return null;
  const stmts: D1PreparedStatement[] = [];
  if (payload.financial_status && payload.financial_status !== o.payment_status) {
    stmts.push(db.prepare("UPDATE orders SET payment_status = ? WHERE id = ?").bind(payload.financial_status, o.id));
  }
  if (payload.cancelled_at && o.stage !== "cancelled") {
    stmts.push(setStage(db, o.id, "cancelled"), addEvent(db, { orderId: o.id, kind: "cancelled", note: "Cancelled in Shopify" }));
  }
  // A customer email corrected in Shopify is used for proof emails from then on.
  const email = payload.email?.trim();
  if (email && email.toLowerCase() !== (o.customer_email ?? "").toLowerCase()) {
    stmts.push(
      db.prepare("UPDATE orders SET customer_email = ? WHERE id = ?").bind(email, o.id),
      addEvent(db, { orderId: o.id, kind: "contact_changed", note: "Changed in Shopify", data: { field: "email", from: o.customer_email, to: email } }),
    );
  }
  if (stmts.length) await db.batch(stmts);
  return o.id;
}

export interface ManualJobInput {
  sourceSystem: string;
  orderNumber: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  company?: string;
  shipTo?: string;
  isRush?: boolean;
  note?: string;
  machines: { machine: string; kit?: string; finish: FinishCode }[];
}

export async function createManualJob(db: D1Database, by: Person, input: ManualJobInput): Promise<number> {
  if (!input.sourceSystem?.trim() || !input.orderNumber?.trim() || !input.customerName?.trim()) {
    throw new WorkflowError("Source system, order number and customer are required");
  }
  if (!input.machines?.length || input.machines.some((m) => !m.machine?.trim() || !m.finish)) {
    throw new WorkflowError("Add at least one machine, each with a finish");
  }
  const row = await db
    .prepare(
      `INSERT INTO orders (source, order_number, source_system, ordered_at, customer_name, company, customer_email, customer_phone,
         ship_to, order_note, is_rush, payment_status)
       VALUES ('manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown') RETURNING id`,
    )
    .bind(
      input.orderNumber.trim(), input.sourceSystem.trim(), now(), input.customerName.trim(), input.company ?? null,
      input.customerEmail ?? null, input.customerPhone ?? null, input.shipTo ?? null, input.note ?? null, input.isRush ? 1 : 0,
    )
    .first<{ id: number }>();
  const id = row!.id;
  await db.batch([
    ...input.machines.map((m, i) =>
      db
        .prepare("INSERT INTO machines (order_id, position, machine, kit, finish) VALUES (?, ?, ?, ?, ?)")
        .bind(id, i, m.machine.trim(), m.kit?.trim() || null, m.finish),
    ),
    addEvent(db, { orderId: id, kind: "received", personId: by.id, note: `Manual job from ${input.sourceSystem.trim()}` }),
  ]);
  return id;
}

// ---------- assignment ----------

export async function assignOrder(db: D1Database, orderId: number, assigneeId: number, by: Person) {
  const order = await getOrder(db, orderId);
  if (order.stage === "cancelled" || order.stage === "handed_off" || order.stage === "ship_only") throw new WorkflowError("This order has nothing waiting on design", 409);
  const assignee = await db
    .prepare("SELECT id, name FROM people WHERE id = ? AND active = 1 AND takes_orders = 1")
    .bind(assigneeId)
    .first<{ id: number; name: string }>();
  if (!assignee) throw new WorkflowError("That person doesn't take orders", 400);
  const at = now();
  const stmts = [
    db.prepare("UPDATE orders SET assigned_to = ?, assigned_at = ? WHERE id = ?").bind(assignee.id, at, orderId),
    addEvent(db, {
      orderId,
      kind: order.assigned_to ? "reassigned" : "assigned",
      personId: by.id,
      note: `Assigned to ${assignee.name}`,
      data: { to: assignee.id, from: order.assigned_to },
    }),
  ];
  if (order.stage === "unassigned") {
    // Items without proofs (matching Yetis) follow their machine's approval. Only an order with nothing
    // to proof starts out approved.
    const machines = await getMachines(db, orderId);
    const nothingToProof = machines.length > 0 && machines.every((m) => !m.needs_proof);
    if (nothingToProof) {
      stmts.push(...machines.filter((m) => !m.approved_at).map((m) => db.prepare("UPDATE machines SET approved_at = ?, approval_method = 'matches_machine' WHERE id = ?").bind(at, m.id)));
    }
    stmts.push(setStage(db, orderId, nothingToProof ? "approved" : "needs_first_proof", at));
  }
  await db.batch(stmts);
}

// ---------- design steps ----------

export async function recordProofSent(db: D1Database, orderId: number, by: Person, opts: { via: "approve_pro" | "proof_page"; note?: string }) {
  const order = await getOrder(db, orderId);
  assertCanWork(order, by);
  if (!["needs_first_proof", "revision_requested", "proof_sent"].includes(order.stage)) {
    throw new WorkflowError("A proof can't be sent at this stage", 409);
  }
  const first = order.stage === "needs_first_proof";
  await db.batch([
    setStage(db, orderId, "proof_sent"),
    db.prepare("UPDATE orders SET in_approve_pro = CASE WHEN ? THEN 1 ELSE in_approve_pro END WHERE id = ?").bind(opts.via === "approve_pro" ? 1 : 0, orderId),
    addEvent(db, {
      orderId,
      kind: "proof_sent",
      personId: by.id,
      note: opts.note ?? null,
      data: { via: opts.via, first },
    }),
  ]);
}

export const APPROVAL_METHODS = ["approve_pro", "phone", "in_person", "text", "email", "other"] as const;
export type ApprovalMethod = (typeof APPROVAL_METHODS)[number];

/**
 * Records an approval the customer gave outside the proof page (phone, in person, text, email, or an
 * order finishing in Approve Pro). A note is always required. Proof page approvals go through proofs.ts.
 */
export async function recordApproval(
  db: D1Database,
  orderId: number,
  by: Person,
  input: { machineIds?: number[]; method: ApprovalMethod; note: string },
) {
  const order = await getOrder(db, orderId);
  assertCanWork(order, by);
  if (!APPROVAL_METHODS.includes(input.method)) throw new WorkflowError("Pick how the customer approved");
  if (!input.note?.trim()) throw new WorkflowError("Add a note on what the customer said");
  if (["unassigned", "handed_off", "cancelled"].includes(order.stage)) throw new WorkflowError("This order can't be approved now", 409);
  const machines = await getMachines(db, orderId);
  const proofed = machines.filter((m) => m.needs_proof);
  const targets = input.machineIds?.length ? proofed.filter((m) => input.machineIds!.includes(m.id)) : proofed;
  if (!targets.length) throw new WorkflowError("No machines to approve");
  const stmts = approvalStatements(db, orderId, machines, targets, { method: input.method, personId: by.id, note: input.note.trim() });
  if (input.method === "approve_pro") stmts.push(db.prepare("UPDATE orders SET in_approve_pro = 1 WHERE id = ?").bind(orderId));
  await db.batch(stmts);
}

/**
 * The writes for an approval, used by manual approvals and the customer proof page.
 * Once every proofed design is approved, matching items (Yetis) are approved with them and the order moves to approved.
 */
export function approvalStatements(
  db: D1Database,
  orderId: number,
  machines: MachineRow[],
  targets: MachineRow[],
  e: { method: string; personId: number | null; note: string | null; data?: Record<string, unknown> },
): D1PreparedStatement[] {
  const at = now();
  const proofed = machines.filter((m) => m.needs_proof);
  const stmts: D1PreparedStatement[] = targets
    .filter((m) => !m.approved_at)
    .map((m) => db.prepare("UPDATE machines SET approved_at = ?, approval_method = ? WHERE id = ?").bind(at, e.method, m.id));
  const approvedIds = new Set([...proofed.filter((m) => m.approved_at).map((m) => m.id), ...targets.map((m) => m.id)]);
  const allApproved = proofed.every((m) => approvedIds.has(m.id));
  if (allApproved) {
    for (const m of machines.filter((x) => !x.needs_proof && !x.approved_at)) {
      stmts.push(db.prepare("UPDATE machines SET approved_at = ?, approval_method = 'matches_machine' WHERE id = ?").bind(at, m.id));
    }
    stmts.push(setStage(db, orderId, "approved", at));
  }
  stmts.push(
    addEvent(db, {
      orderId,
      kind: "approved",
      personId: e.personId,
      note: e.note,
      data: { method: e.method, machineIds: targets.map((m) => m.id), all: allApproved, ...e.data },
      at,
    }),
  );
  return stmts;
}

/** A customer's change request, recorded by hand. Counts as a revision request. */
export async function recordRevisionRequest(db: D1Database, orderId: number, by: Person, input: { method: ApprovalMethod; note: string }) {
  const order = await getOrder(db, orderId);
  assertCanWork(order, by);
  if (!APPROVAL_METHODS.includes(input.method)) throw new WorkflowError("Pick how the customer asked for changes");
  if (!input.note?.trim()) throw new WorkflowError("Add a note on what the customer wants changed");
  if (!["proof_sent", "approved", "revision_requested"].includes(order.stage)) throw new WorkflowError("No proof is out for this order", 409);
  const at = now();
  await db.batch([
    setStage(db, orderId, "revision_requested", at),
    addEvent(db, { orderId, kind: "revision_requested", personId: by.id, note: input.note.trim(), data: { method: input.method }, at }),
  ]);
}

export async function signChecklist(db: D1Database, orderId: number, by: Person, itemIds: number[]) {
  const order = await getOrder(db, orderId);
  assertCanWork(order, by);
  const { results } = await db.prepare("SELECT id FROM checklist_items WHERE active = 1").all<{ id: number }>();
  const missing = results.filter((r) => !itemIds.includes(r.id));
  if (missing.length) throw new WorkflowError("Check every item to sign off", 400, { missing: missing.map((m) => m.id) });
  const at = now();
  await db.batch([
    db.prepare("UPDATE orders SET checklist_signed_by = ?, checklist_signed_at = ? WHERE id = ?").bind(by.id, at, orderId),
    addEvent(db, { orderId, kind: "checklist_signed", personId: by.id, at }),
  ]);
}

export interface LengthCheck {
  ok: boolean;
  averageIn: number | null;
  fullLengthIn: number;
  pctOff: number | null;
  direction: "over" | "under" | null;
}

/** Compares a full-size length with past hand-offs of the same machine and kit. */
export async function checkLength(db: D1Database, machine: MachineRow, quarterLength: number): Promise<LengthCheck> {
  const s = await getSettings(db);
  const over = Number(s.length_check_over_pct ?? 15);
  const under = Number(s.length_check_under_pct ?? 15);
  const minSamples = Number(s.length_check_min_samples ?? 3);
  const full = quarterLength * 4;
  const avg = await db
    .prepare(
      `SELECT AVG(quarter_length_in * 4) AS avg, COUNT(*) AS n FROM machines
       WHERE machine = ? AND IFNULL(kit,'') = IFNULL(?,'') AND handed_off_at IS NOT NULL AND id != ?`,
    )
    .bind(machine.machine, machine.kit, machine.id)
    .first<{ avg: number | null; n: number }>();
  if (!avg?.avg || avg.n < minSamples) return { ok: true, averageIn: null, fullLengthIn: full, pctOff: null, direction: null };
  const pct = ((full - avg.avg) / avg.avg) * 100;
  const direction = pct > over ? "over" : pct < -under ? "under" : null;
  return { ok: direction === null, averageIn: Math.round(avg.avg), fullLengthIn: full, pctOff: Math.round(pct), direction };
}

export async function setLength(db: D1Database, machineId: number, by: Person, input: { quarterLength: number; reason?: string }) {
  const machine = await db.prepare("SELECT * FROM machines WHERE id = ?").bind(machineId).first<MachineRow>();
  if (!machine) throw new WorkflowError("Machine not found", 404);
  const order = await getOrder(db, machine.order_id);
  assertCanWork(order, by);
  if (machine.handed_off_at) throw new WorkflowError("This machine is already with production", 409);
  const q = Number(input.quarterLength);
  if (!Number.isFinite(q) || q <= 0 || q > 2000) throw new WorkflowError("Enter the length at ¼ scale in inches");
  const check = await checkLength(db, machine, q);
  const reason = input.reason?.trim() || null;
  if (!check.ok && !reason) {
    throw new WorkflowError("Are you sure you want to push this through at this length?", 409, { lengthCheck: check });
  }
  await db.batch([
    db.prepare("UPDATE machines SET quarter_length_in = ?, length_reason = ? WHERE id = ?").bind(q, check.ok ? null : reason, machineId),
    addEvent(db, {
      orderId: order.id,
      machineId,
      kind: "length_logged",
      personId: by.id,
      note: check.ok ? null : reason,
      data: { quarterLength: q, fullLength: q * 4, check },
    }),
  ]);
  return check;
}

export async function handOff(db: D1Database, orderId: number, by: Person, input: { machineIds?: number[]; productionNote?: string }) {
  const order = await getOrder(db, orderId);
  assertCanWork(order, by);
  if (!order.checklist_signed_at) throw new WorkflowError("Sign off the design checklist first", 409);
  const machines = await getMachines(db, orderId);
  const open = machines.filter((m) => !m.handed_off_at);
  const targets = input.machineIds?.length ? open.filter((m) => input.machineIds!.includes(m.id)) : open;
  if (!targets.length) throw new WorkflowError("Nothing left to hand off", 409);
  const problems = targets.filter((m) => !m.approved_at || !m.quarter_length_in || !m.finish);
  if (problems.length) {
    throw new WorkflowError("Every machine needs customer approval, a finish and a length before hand-off", 409, {
      machines: problems.map((m) => ({ id: m.id, approved: !!m.approved_at, length: !!m.quarter_length_in, finish: !!m.finish })),
    });
  }
  const at = now();
  const stmts: D1PreparedStatement[] = targets.map((m) =>
    db.prepare("UPDATE machines SET handed_off_at = ?, handed_off_by = ? WHERE id = ?").bind(at, by.id, m.id),
  );
  const note = input.productionNote?.trim();
  if (note) stmts.push(db.prepare("UPDATE orders SET production_note = ? WHERE id = ?").bind(note, orderId));
  const allDone = open.length === targets.length;
  if (allDone) stmts.push(setStage(db, orderId, "handed_off", at));
  stmts.push(
    addEvent(db, {
      orderId,
      kind: "handed_off",
      personId: by.id,
      note: note ?? null,
      data: { machineIds: targets.map((m) => m.id), lengths: targets.map((m) => ({ id: m.id, full: (m.quarter_length_in ?? 0) * 4 })) },
      at,
    }),
  );
  await db.batch(stmts);
  return { allDone };
}

export async function markRush(db: D1Database, orderId: number, by: Person, input: { note: string; customerPaying: boolean }) {
  const order = await getOrder(db, orderId);
  assertCanWork(order, by);
  if (!input.note?.trim()) throw new WorkflowError("Add a note on why this is rush");
  await db.batch([
    db.prepare("UPDATE orders SET is_rush = 1 WHERE id = ?").bind(orderId),
    addEvent(db, { orderId, kind: "marked_rush", personId: by.id, note: input.note.trim(), data: { customerPaying: input.customerPaying } }),
  ]);
}

export async function markCustom(db: D1Database, orderId: number, by: Person, input: { note: string }) {
  const order = await getOrder(db, orderId);
  if (!(by.role === "admin" || by.role === "lead" || by.role === "billing" || order.assigned_to === by.id)) {
    throw new WorkflowError("Only the team lead, Nikki or the order's designer can mark a custom one-off", 403);
  }
  if (!input.note?.trim()) throw new WorkflowError("Add a note on why this is a custom one-off");
  await db.batch([
    db.prepare("UPDATE orders SET is_custom = 1, custom_reason = ? WHERE id = ?").bind(`Marked by hand: ${input.note.trim()}`, orderId),
    addEvent(db, { orderId, kind: "marked_custom", personId: by.id, note: input.note.trim() }),
  ]);
}

export async function pausePrintFile(db: D1Database, orderId: number, by: Person, reason: string) {
  const order = await getOrder(db, orderId);
  assertCanWork(order, by);
  if (!reason?.trim()) throw new WorkflowError("Explain why the print file deadline needs a pause");
  if (order.print_file_paused_at) throw new WorkflowError("The print file deadline is already paused", 409);
  const at = now();
  await db.batch([
    db.prepare("UPDATE orders SET print_file_paused_at = ?, print_file_paused_by = ?, print_file_pause_reason = ? WHERE id = ?").bind(at, by.id, reason.trim(), orderId),
    addEvent(db, { orderId, kind: "print_file_paused", personId: by.id, note: reason.trim(), at }),
  ]);
}

export async function resumePrintFile(db: D1Database, orderId: number, by: Person, clock: ClockOptions) {
  const order = await getOrder(db, orderId);
  assertCanWork(order, by);
  if (!order.print_file_paused_at) throw new WorkflowError("The print file deadline isn't paused", 409);
  const minutes = businessMinutesBetween(new Date(order.print_file_paused_at), new Date(), clock);
  await db.batch([
    db
      .prepare("UPDATE orders SET print_file_extra_minutes = print_file_extra_minutes + ?, print_file_paused_at = NULL, print_file_paused_by = NULL, print_file_pause_reason = NULL WHERE id = ?")
      .bind(minutes, orderId),
    addEvent(db, { orderId, kind: "print_file_resumed", personId: by.id, data: { pausedMinutes: minutes } }),
  ]);
}

// ---------- views ----------

export interface MachineView {
  id: number;
  kind: JobKind;
  needsProof: boolean;
  machine: string;
  kit: string | null;
  finish: FinishCode | null;
  selections: { name: string; value: string }[];
  quarterLengthIn: number | null;
  fullLengthIn: number | null;
  lengthReason: string | null;
  approvedAt: string | null;
  approvalMethod: string | null;
  handedOffAt: string | null;
  printFileDue: string | null;
}

export interface OrderSummary {
  id: number;
  orderNumber: string;
  source: string;
  stage: Stage;
  stageSince: string;
  orderedAt: string;
  isRush: boolean;
  isDealer: boolean;
  isCustom: boolean;
  assignedTo: number | null;
  machines: { id: number; machine: string; finish: FinishCode | null; kind: JobKind }[];
  printFileDue: string | null;
  printFilePaused: boolean;
  customerUnread: boolean;
}

function summarize(o: OrderRow, machines: MachineRow[], clock: ClockOptions): OrderSummary {
  const dues = machines.map((m) => machineDue(o, m, clock)).filter((d): d is string => !!d).sort();
  return {
    id: o.id,
    orderNumber: o.order_number,
    source: o.source,
    stage: o.stage,
    stageSince: o.stage_since,
    orderedAt: o.ordered_at,
    isRush: !!o.is_rush,
    isDealer: !!o.is_dealer,
    isCustom: !!o.is_custom,
    assignedTo: o.assigned_to,
    machines: machines.map((m) => ({ id: m.id, machine: m.machine, finish: m.finish, kind: m.kind })),
    printFileDue: dues[0] ?? null,
    printFilePaused: !!o.print_file_paused_at,
    customerUnread: !!o.customer_unread,
  };
}

async function machinesByOrder(db: D1Database, orderIds: number[]): Promise<Map<number, MachineRow[]>> {
  const map = new Map<number, MachineRow[]>();
  if (!orderIds.length) return map;
  const { results } = await db
    .prepare(`SELECT * FROM machines WHERE order_id IN (${orderIds.map(() => "?").join(",")}) ORDER BY position, id`)
    .bind(...orderIds)
    .all<MachineRow>();
  for (const m of results) map.set(m.order_id, [...(map.get(m.order_id) ?? []), m]);
  return map;
}

export interface QueueGroup {
  key: "reprint" | "needs_first_proof" | "revision_requested" | "waiting_customer" | "approved";
  title: string;
  orders: OrderSummary[];
}

/** A designer's queue, grouped and sorted exactly as the spec describes. */
export async function designerQueue(env: Env, personId: number): Promise<QueueGroup[]> {
  const clock = await clockFor(env);
  const { results } = await env.DB
    .prepare("SELECT * FROM orders WHERE assigned_to = ? AND stage IN ('needs_first_proof','proof_sent','revision_requested','approved')")
    .bind(personId)
    .all<OrderRow>();
  const machines = await machinesByOrder(env.DB, results.map((o) => o.id));
  const all = results.map((o) => summarize(o, machines.get(o.id) ?? [], clock));
  const by = (stage: Stage) => all.filter((o) => o.stage === stage);
  const rushFirst = (a: OrderSummary, b: OrderSummary) => Number(b.isRush) - Number(a.isRush);
  return [
    { key: "reprint", title: "Reprint requests", orders: [] }, // arrives with the reprint flow (Phase 5)
    {
      key: "needs_first_proof",
      title: "Needs first proof",
      orders: by("needs_first_proof").sort((a, b) => rushFirst(a, b) || a.orderedAt.localeCompare(b.orderedAt)),
    },
    {
      key: "revision_requested",
      title: "Revision requested",
      orders: by("revision_requested").sort((a, b) => rushFirst(a, b) || a.stageSince.localeCompare(b.stageSince)),
    },
    {
      key: "waiting_customer",
      title: "Waiting on customer",
      orders: by("proof_sent").sort((a, b) => a.stageSince.localeCompare(b.stageSince)),
    },
    {
      key: "approved",
      title: "Approved · print file",
      orders: by("approved").sort((a, b) => (a.printFileDue ?? "9").localeCompare(b.printFileDue ?? "9")),
    },
  ];
}

export async function orderDetail(env: Env, orderId: number) {
  const clock = await clockFor(env);
  const o = await getOrder(env.DB, orderId);
  const machines = await getMachines(env.DB, orderId);
  const { results: events } = await env.DB
    .prepare(
      `SELECT e.id, e.kind, e.at, e.note, e.data_json, e.machine_id, p.name AS person
       FROM events e LEFT JOIN people p ON p.id = e.person_id WHERE e.order_id = ? ORDER BY e.at, e.id`,
    )
    .bind(orderId)
    .all<{ id: number; kind: string; at: string; note: string | null; data_json: string | null; machine_id: number | null; person: string | null }>();
  const { results: shipItems } = await env.DB
    .prepare("SELECT title, variant, quantity, attached_to AS attachedTo FROM order_items WHERE order_id = ? ORDER BY id")
    .bind(orderId)
    .all<{ title: string; variant: string | null; quantity: number; attachedTo: number | null }>();
  const { results: checklist } = await env.DB
    .prepare("SELECT id, label FROM checklist_items WHERE active = 1 ORDER BY sort, id")
    .all<{ id: number; label: string }>();
  const people = await env.DB
    .prepare("SELECT id, name FROM people WHERE id IN (?, ?, ?)")
    .bind(o.assigned_to ?? 0, o.checklist_signed_by ?? 0, o.print_file_paused_by ?? 0)
    .all<{ id: number; name: string }>();
  const name = (id: number | null) => people.results.find((p) => p.id === id)?.name ?? null;

  // Turnaround for each step, in business time.
  const timeline = events.map((e, i) => {
    let businessMinutes: number | null = null;
    if (e.kind === "proof_sent") {
      const prev = [...events.slice(0, i)].reverse().find((x) => x.kind === "revision_requested" || x.kind === "received");
      if (prev) businessMinutes = businessMinutesBetween(new Date(prev.at), new Date(e.at), clock);
    }
    return { ...e, data: e.data_json ? JSON.parse(e.data_json) : null, data_json: undefined, businessMinutes };
  });

  const machineViews: MachineView[] = machines.map((m) => ({
    id: m.id,
    kind: m.kind,
    needsProof: !!m.needs_proof,
    machine: m.machine,
    kit: m.kit,
    finish: m.finish,
    selections: JSON.parse(m.selections_json),
    quarterLengthIn: m.quarter_length_in,
    fullLengthIn: m.quarter_length_in === null ? null : m.quarter_length_in * 4,
    lengthReason: m.length_reason,
    approvedAt: m.approved_at,
    approvalMethod: m.approval_method,
    handedOffAt: m.handed_off_at,
    printFileDue: machineDue(o, m, clock),
  }));

  return {
    ...summarize(o, machines, clock),
    sourceSystem: o.source_system,
    receivedAt: o.received_at,
    customer: {
      name: o.customer_name,
      company: o.company,
      email: o.customer_email,
      phone: o.customer_phone,
      shipTo: o.ship_to,
      shipMethod: o.ship_method,
    },
    orderNote: o.order_note,
    uploads: JSON.parse(o.uploads_json) as { name: string; url: string }[],
    paymentStatus: o.payment_status,
    customReason: o.custom_reason,
    assignedName: name(o.assigned_to),
    inApprovePro: !!o.in_approve_pro,
    printFileDays: printFileDays(o),
    printFilePause: o.print_file_paused_at ? { since: o.print_file_paused_at, by: name(o.print_file_paused_by), reason: o.print_file_pause_reason } : null,
    checklist: {
      items: checklist,
      signedBy: name(o.checklist_signed_by),
      signedAt: o.checklist_signed_at,
    },
    productionNote: o.production_note,
    machines: machineViews,
    shipItems,
    timeline,
  };
}

// ---------- assignment board and stats ----------

function weekStart(clock: ClockOptions, at = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const back = (dow + 6) % 7; // days since Monday
  const d = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - back));
  return zonedTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, clock.timeZone);
}

function monthStart(clock: ClockOptions, at = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone, year: "numeric", month: "numeric" })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  return zonedTime(Number(parts.year), Number(parts.month), 1, 0, clock.timeZone);
}

/** Average business minutes to first proof and revision turnaround since `from`. */
async function turnaround(env: Env, clock: ClockOptions, personId: number | null, from: Date) {
  const { results } = await env.DB
    .prepare(
      `SELECT e.order_id, e.kind, e.at, o.ordered_at, o.in_approve_pro FROM events e JOIN orders o ON o.id = e.order_id
       WHERE e.kind IN ('proof_sent','revision_requested') AND (? IS NULL OR o.assigned_to = ?)
       ORDER BY e.order_id, e.at`,
    )
    .bind(personId, personId)
    .all<{ order_id: number; kind: string; at: string; ordered_at: string; in_approve_pro: number }>();
  const first: number[] = [];
  const rev: number[] = [];
  let lastOrder = -1;
  let sentBefore = false;
  let revisionAt: string | null = null;
  for (const e of results) {
    if (e.order_id !== lastOrder) {
      lastOrder = e.order_id;
      sentBefore = false;
      revisionAt = null;
    }
    if (e.in_approve_pro) continue; // stats skip Approve Pro orders (spec)
    if (e.kind === "revision_requested") revisionAt = e.at;
    if (e.kind === "proof_sent") {
      if (!sentBefore && new Date(e.at) >= from) first.push(businessMinutesBetween(new Date(e.ordered_at), new Date(e.at), clock));
      else if (revisionAt && new Date(e.at) >= from) rev.push(businessMinutesBetween(new Date(revisionAt), new Date(e.at), clock));
      sentBefore = true;
      revisionAt = null;
    }
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return { firstProofMinutes: avg(first), revisionMinutes: avg(rev), firstProofCount: first.length, revisionCount: rev.length };
}

export async function designerStats(env: Env, personId: number) {
  const clock = await clockFor(env);
  const month = monthStart(clock).toISOString();
  const counts = await env.DB
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM orders WHERE assigned_to = ?1 AND assigned_at >= ?2) AS assigned,
         (SELECT COUNT(DISTINCT e.order_id) FROM events e JOIN orders o ON o.id = e.order_id
            WHERE o.assigned_to = ?1 AND e.kind = 'handed_off' AND e.at >= ?2) AS handed_off,
         (SELECT COUNT(*) FROM orders WHERE assigned_to = ?1 AND stage = 'handed_off') AS lifetime_handed_off`,
    )
    .bind(personId, month)
    .first<{ assigned: number; handed_off: number; lifetime_handed_off: number }>();
  const week = await turnaround(env, clock, personId, weekStart(clock));
  return {
    ordersThisMonth: counts?.assigned ?? 0,
    handedOffThisMonth: counts?.handed_off ?? 0,
    // Scores arrive in Phase 4 and only show after 15 orders.
    scoreUnlocksAt: 15,
    ordersTowardScore: counts?.lifetime_handed_off ?? 0,
    ...week,
  };
}

export async function isOutToday(env: Env, personId: number, clock: ClockOptions): Promise<boolean> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: clock.timeZone }).format(new Date());
  const row = await env.DB
    .prepare("SELECT 1 FROM time_off WHERE person_id = ? AND starts_on <= ? AND ends_on >= ? LIMIT 1")
    .bind(personId, today, today)
    .first();
  return !!row;
}

export async function assignmentBoard(env: Env) {
  const clock = await clockFor(env);
  const { results: unassigned } = await env.DB
    .prepare("SELECT * FROM orders WHERE stage = 'unassigned' ORDER BY is_rush DESC, ordered_at")
    .all<OrderRow>();
  const machines = await machinesByOrder(env.DB, unassigned.map((o) => o.id));
  const { results: designers } = await env.DB
    .prepare("SELECT id, name, role FROM people WHERE active = 1 AND takes_orders = 1 ORDER BY name")
    .all<{ id: number; name: string; role: string }>();
  const { results: loads } = await env.DB
    .prepare(
      `SELECT assigned_to AS id,
         SUM(CASE WHEN stage IN ('needs_first_proof','revision_requested') THEN 1 ELSE 0 END) AS work,
         SUM(CASE WHEN stage = 'proof_sent' THEN 1 ELSE 0 END) AS waiting,
         SUM(CASE WHEN stage = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN is_rush = 1 AND stage IN ('needs_first_proof','revision_requested','approved') THEN 1 ELSE 0 END) AS rush
       FROM orders WHERE assigned_to IS NOT NULL AND stage IN ('needs_first_proof','proof_sent','revision_requested','approved')
       GROUP BY assigned_to`,
    )
    .all<{ id: number; work: number; waiting: number; approved: number; rush: number }>();
  const week = weekStart(clock);

  const workload = await Promise.all(
    designers.map(async (d) => {
      const l = loads.find((x) => x.id === d.id) ?? { work: 0, waiting: 0, approved: 0, rush: 0 };
      const t = await turnaround(env, clock, d.id, week);
      return {
        id: d.id,
        name: d.name,
        role: d.role,
        out: await isOutToday(env, d.id, clock),
        open: l.work + l.waiting + l.approved,
        needsWork: l.work,
        waiting: l.waiting,
        approved: l.approved,
        rush: l.rush,
        firstProofMinutes: t.firstProofMinutes,
      };
    }),
  );

  // Suggest the lightest load among people who are in; faster first proofs break ties.
  const available = workload.filter((w) => !w.out);
  const ranked = [...available].sort(
    (a, b) => a.open - b.open || (a.firstProofMinutes ?? 1e9) - (b.firstProofMinutes ?? 1e9) || a.name.localeCompare(b.name),
  );
  const projected = new Map(ranked.map((w) => [w.id, w.open]));
  const suggestions = unassigned.map((o) => {
    const pick = [...ranked].sort((a, b) => projected.get(a.id)! - projected.get(b.id)! || ranked.indexOf(a) - ranked.indexOf(b))[0];
    if (pick) projected.set(pick.id, projected.get(pick.id)! + 1);
    const ms = machines.get(o.id) ?? [];
    return {
      order: summarize(o, ms, clock),
      suggestedId: pick?.id ?? null,
      why: !pick ? "Nobody is available" : o.is_rush ? "Lightest load, fastest first proof" : "Lightest load",
    };
  });

  return { unassigned: suggestions, workload };
}
