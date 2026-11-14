// Customer emails. Every email is queued in the outbox first, so nothing is lost and TY can see what went out.
// Klaviyo does the sending: each email becomes a "DG Workflow Email" event, and one Klaviyo flow with one
// branded template turns it into the email. Nothing is sent until KLAVIYO_PRIVATE_KEY is set.

import type { Env } from "../env";

export const EMAIL_KINDS = ["proof_ready", "revision_ready", "reminder", "approved", "changes_received", "reply", "message"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_LABELS: Record<EmailKind, { name: string; when: string }> = {
  proof_ready: { name: "Proof ready", when: "When the designer sends the first proof" },
  revision_ready: { name: "Revision ready", when: "When the designer sends a revised proof" },
  reminder: { name: "Reminder", when: "When a proof waits on the customer (automatic or sent by hand)" },
  approved: { name: "Design approved", when: "After the customer approves a design" },
  changes_received: { name: "Changes received", when: "After the customer asks for changes" },
  reply: { name: "Reply from designer", when: "When the designer answers the customer on the order" },
  message: { name: "Message customer", when: "When the designer writes before any proof has gone out" },
};

export interface EmailTemplate {
  on: boolean;
  subject: string;
  heading: string;
  body: string;
  button: string;
}

export const KLAVIYO_METRIC = "DG Workflow Email";

export function readTemplate(settings: Record<string, string>, kind: EmailKind): EmailTemplate | null {
  try {
    return JSON.parse(settings[`email_${kind}`] ?? "null");
  } catch {
    return null;
  }
}

export interface EmailVars {
  first_name: string;
  order_number: string;
  designer: string;
  machines: string;
  message?: string;
}

/** Fills {placeholders}. Unknown placeholders are left as typed so a typo is easy to spot. */
export function fill(text: string, vars: Partial<EmailVars>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String((vars as Record<string, string>)[k] ?? "") : m));
}

export function firstName(full: string | null): string {
  const first = (full ?? "").trim().split(/\s+/)[0];
  return first ? first[0].toUpperCase() + first.slice(1) : "there";
}

/** Lists machine names the way a person would say them: "A", "A and B", "A, B and C". */
export function machineList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "your order";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Queues one email. Returns false when there's no address or that email is turned off.
 * A BCC copy (if set in Proof settings) is queued alongside it.
 */
export async function queueEmail(
  db: D1Database,
  settings: Record<string, string>,
  e: { orderId: number; to: string | null; kind: EmailKind; vars: EmailVars; url: string; sentBy?: number | null },
): Promise<boolean> {
  const t = readTemplate(settings, e.kind);
  if (!t?.on || !e.to) return false;
  const payload = {
    kind: e.kind,
    subject: fill(t.subject, e.vars),
    heading: fill(t.heading, e.vars),
    body: fill(t.body, e.vars),
    button_label: fill(t.button, e.vars),
    button_url: e.url,
    order_number: e.vars.order_number,
    first_name: e.vars.first_name,
    designer: e.vars.designer,
  };
  const stmts = [
    db.prepare("INSERT INTO outbox (order_id, kind, to_email, payload_json, sent_by) VALUES (?, ?, ?, ?, ?)").bind(e.orderId, e.kind, e.to, JSON.stringify(payload), e.sentBy ?? null),
  ];
  const bcc = settings.email_bcc?.trim();
  if (bcc && bcc.toLowerCase() !== e.to.toLowerCase()) {
    stmts.push(
      db
        .prepare("INSERT INTO outbox (order_id, kind, to_email, payload_json, sent_by) VALUES (?, ?, ?, ?, ?)")
        .bind(e.orderId, `${e.kind}_bcc`, bcc, JSON.stringify({ ...payload, subject: `[Copy] ${payload.subject}`, copy_for: e.to }), e.sentBy ?? null),
    );
  }
  await db.batch(stmts);
  return true;
}

/** Sends pending emails to Klaviyo. Does nothing until the Klaviyo key is set. */
export async function deliverOutbox(env: Env, limit = 25): Promise<{ sent: number; failed: number; connected: boolean }> {
  const key = env.KLAVIYO_PRIVATE_KEY;
  if (!key) return { sent: 0, failed: 0, connected: false };
  const { results } = await env.DB
    .prepare("SELECT id, to_email, payload_json, created_at FROM outbox WHERE status = 'pending' AND attempts < 5 ORDER BY id LIMIT ?")
    .bind(limit)
    .all<{ id: number; to_email: string; payload_json: string; created_at: string }>();
  let sent = 0;
  let failed = 0;
  for (const row of results) {
    const body = {
      data: {
        type: "event",
        attributes: {
          properties: JSON.parse(row.payload_json),
          metric: { data: { type: "metric", attributes: { name: KLAVIYO_METRIC } } },
          profile: { data: { type: "profile", attributes: { email: row.to_email } } },
          unique_id: `dgw-outbox-${row.id}`,
          time: row.created_at,
        },
      },
    };
    let error: string | null = null;
    try {
      const res = await fetch("https://a.klaviyo.com/api/events", {
        method: "POST",
        headers: {
          Authorization: `Klaviyo-API-Key ${key}`,
          revision: "2024-10-15",
          "content-type": "application/vnd.api+json",
          accept: "application/vnd.api+json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) error = `Klaviyo ${res.status}: ${(await res.text()).slice(0, 300)}`;
    } catch (err) {
      error = String(err).slice(0, 300);
    }
    if (error) {
      failed++;
      await env.DB.prepare("UPDATE outbox SET attempts = attempts + 1, error = ?, status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE status END WHERE id = ?").bind(error, row.id).run();
    } else {
      sent++;
      await env.DB.prepare("UPDATE outbox SET status = 'sent', sent_at = ?, attempts = attempts + 1, error = NULL WHERE id = ?").bind(new Date().toISOString(), row.id).run();
    }
  }
  return { sent, failed, connected: true };
}
