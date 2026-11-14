// Customer emails. Every email is queued in the outbox first, so nothing is lost and TY can see what went out.
// Resend sends them, in one branded layout built here. (dirtygraphix.com's DNS is at Wix, and Cloudflare's
// email service only works for domains on Cloudflare DNS.) Nothing is sent until the RESEND_API_KEY secret
// is set and TY turns on sending in Proof settings.

import type { Env } from "../env";
import tokensCss from "../../../design/tokens.css";

export const EMAIL_KINDS = ["proof_ready", "revision_ready", "reminder", "approved", "changes_received", "reply", "message", "viewer_copy"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_LABELS: Record<EmailKind, { name: string; when: string }> = {
  proof_ready: { name: "Proof ready", when: "When the designer sends the first proof" },
  revision_ready: { name: "Revision ready", when: "When the designer sends a revised proof" },
  reminder: { name: "Reminder", when: "When a proof waits on the customer (automatic or sent by hand)" },
  approved: { name: "Design approved", when: "After the customer approves a design" },
  changes_received: { name: "Changes received", when: "After the customer asks for changes" },
  reply: { name: "Reply from designer", when: "When the designer answers the customer on the order" },
  message: { name: "Message customer", when: "When the designer writes before any proof has gone out" },
  viewer_copy: { name: "Copy for extra people", when: "To the extra people on an order, each time a proof or revision goes out (view only)" },
};

export interface EmailTemplate {
  on: boolean;
  subject: string;
  heading: string;
  body: string;
  button: string;
}


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
  customer_name?: string;
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
  e: { orderId: number; to: string | null; kind: EmailKind; vars: EmailVars; url: string; sentBy?: number | null; buttonLabel?: string },
): Promise<boolean> {
  const t = readTemplate(settings, e.kind);
  if (!t?.on || !e.to) return false;
  const payload: EmailPayload = {
    kind: e.kind,
    subject: fill(t.subject, e.vars),
    heading: fill(t.heading, e.vars),
    body: fill(t.body, e.vars),
    button_label: e.buttonLabel ?? fill(t.button, e.vars),
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

// ---------- the branded layout ----------

// Email programs can't read CSS variables, so the colors and fonts are read out of design/tokens.css.
function token(name: string): string {
  const m = tokensCss.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`Missing design token --${name}`);
  return m[1].trim().replace(/"/g, "'");
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface EmailPayload {
  kind: string;
  subject: string;
  heading: string;
  body: string;
  button_label: string;
  button_url: string;
  order_number: string;
  first_name?: string;
  designer?: string;
  copy_for?: string;
}

/** The email customers get: brand bar, order number, heading, message, button. Matches the preview in Proof settings. */
export function renderEmail(p: EmailPayload): { html: string; text: string } {
  const t = {
    bg: token("bg"),
    surface: token("surface"),
    border: token("border"),
    brand: token("brand"),
    onColor: token("on-color"),
    text: token("text"),
    text2: token("text-2"),
    muted: token("muted"),
    headerBg: token("header-bg"),
    headerText: token("header-text"),
    display: token("font-display"),
    body: token("font-body"),
  };
  const order = p.order_number.replace(/^#/, "");
  const paragraphs = p.body
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 16px;font-family:${t.body};font-size:16px;line-height:1.55;color:${t.text2}">${escHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(p.subject)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700&amp;family=Inter:wght@400;600&amp;display=swap"></head>
<body style="margin:0;padding:0;background:${t.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${t.surface};border:1px solid ${t.border};border-radius:12px;overflow:hidden">
<tr><td style="background:${t.headerBg};border-bottom:4px solid ${t.brand};padding:18px 24px">
<span style="font-family:${t.display};font-weight:700;font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:${t.headerText}">Dirty Graphix</span>
<span style="float:right;font-family:${t.body};font-size:13px;line-height:24px;color:${t.headerText};opacity:.7">Order #${escHtml(order)}</span>
</td></tr>
<tr><td style="padding:28px 24px 8px">
<h1 style="margin:0 0 16px;font-family:${t.display};font-weight:700;font-size:30px;line-height:1.05;text-transform:uppercase;color:${t.text}">${escHtml(p.heading)}</h1>
${paragraphs}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:10px;background:${t.brand}">
<a href="${escHtml(p.button_url)}" style="display:inline-block;padding:14px 26px;font-family:${t.display};font-weight:700;font-size:20px;letter-spacing:.05em;text-transform:uppercase;color:${t.onColor};text-decoration:none">${escHtml(p.button_label)}</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid ${t.border};font-family:${t.body};font-size:13px;line-height:1.5;color:${t.muted}">
Replies to this email aren't monitored. Use the button above to reach your designer. Everything you send there goes straight to your order.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = `${p.heading}\n\n${p.body}\n\n${p.button_label}: ${p.button_url}\n\nOrder #${order}\nReplies to this email aren't monitored. Use the link above to reach your designer.`;
  return { html, text };
}

// ---------- sending ----------

export function senderFrom(settings: Record<string, string>) {
  const email = settings.email_from_address?.trim();
  if (!email) return null;
  return { name: settings.email_from_name?.trim() || "Dirty Graphix", email };
}

export interface OutgoingEmail {
  from: { name: string; email: string };
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** The same key is never sent twice, even if a retry happens after a timeout. */
  idempotencyKey?: string;
}
export type Mailer = (m: OutgoingEmail) => Promise<void>;

/** Sends one email through Resend's API. */
export function resendMailer(apiKey: string | undefined): Mailer | null {
  if (!apiKey) return null;
  return async (m) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(m.idempotencyKey ? { "idempotency-key": m.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: `${m.from.name.replace(/[<>"]/g, "")} <${m.from.email}>`,
        to: [m.to],
        subject: m.subject,
        html: m.html,
        text: m.text,
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { message?: string; error?: { message?: string } };
        detail = body.message ?? body.error?.message ?? "";
      } catch {}
      throw new Error(`Resend ${res.status}${detail ? `: ${detail}` : ""}`);
    }
  };
}

/**
 * Sends waiting emails. Does nothing while sending is turned off or Resend isn't connected.
 * A failed email is retried on later runs, up to 5 tries.
 */
export async function deliverOutbox(
  env: Pick<Env, "DB" | "RESEND_API_KEY">,
  limit = 25,
  mailer: Mailer | null = resendMailer(env.RESEND_API_KEY),
): Promise<{ sent: number; failed: number; on: boolean }> {
  const settings = Object.fromEntries(
    (await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'email_%'").all<{ key: string; value: string }>()).results.map((r) => [r.key, r.value]),
  );
  const from = senderFrom(settings);
  if (settings.email_sending !== "1" || !from || !mailer) return { sent: 0, failed: 0, on: false };
  const { results } = await env.DB
    .prepare("SELECT id, to_email, payload_json FROM outbox WHERE status = 'pending' AND attempts < 5 ORDER BY id LIMIT ?")
    .bind(limit)
    .all<{ id: number; to_email: string; payload_json: string }>();
  let sent = 0;
  let failed = 0;
  for (const row of results) {
    const payload = JSON.parse(row.payload_json) as EmailPayload;
    const { html, text } = renderEmail(payload);
    try {
      await mailer({
        from,
        to: row.to_email,
        subject: payload.subject,
        html,
        text,
        replyTo: settings.email_reply_to?.trim() || undefined,
        idempotencyKey: `dgw-outbox-${row.id}`,
      });
      sent++;
      await env.DB.prepare("UPDATE outbox SET status = 'sent', sent_at = ?, attempts = attempts + 1, error = NULL WHERE id = ?").bind(new Date().toISOString(), row.id).run();
    } catch (err) {
      failed++;
      await env.DB
        .prepare("UPDATE outbox SET attempts = attempts + 1, error = ?, status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE status END WHERE id = ?")
        .bind(String(err instanceof Error ? err.message : err).slice(0, 300), row.id)
        .run();
    }
  }
  return { sent, failed, on: true };
}
