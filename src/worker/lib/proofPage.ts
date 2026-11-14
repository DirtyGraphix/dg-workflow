// Renders the customer proof page as plain HTML from the Worker. Plain HTML forms work on any phone and
// also work when the page is served through dirtygraphix.com/apps/proof (Shopify app proxy).
// Layout and wording follow design/screens/09-proof-page.png; every label can be changed in Proof settings.

import type { CustomerProof, CustomerView } from "./proofs";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

const sub = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

export interface PageContext {
  /** Where forms and links point: "/proof" on the app, or "/apps/proof" through the store. */
  base: string;
  /** Absolute address of the page's CSS, fonts and images on the app. */
  origin: string;
  done?: string | null;
  error?: string | null;
  draft?: { proofId?: number; comment?: string; body?: string };
}

const UPLOAD_ACCEPT = "image/*,.pdf,.ai,.eps,.svg,.psd,.zip";

export function renderProofPage(v: CustomerView, ctx: PageContext): string {
  const s = v.settings;
  const vars = { designer: v.designer, first_name: v.firstName, order_number: v.orderNumber };
  const t = (key: string, fallback = "") => sub(s[key] ?? fallback, vars);
  const action = (path: string) => `${esc(ctx.base)}/${esc(v.token)}/${path}`;
  const fileUrl = (id: number, download = false) => `${esc(ctx.origin)}/proof/${esc(v.token)}/file/${id}${download ? "?download=1" : ""}`;
  const maxComment = Number(s.proof_max_comment) || 500;
  const uploads = s.proof_customer_uploads === "1";

  const open = v.proofs.filter((p) => p.status === "open");
  const approved = v.proofs.filter((p) => p.status === "approved");
  const changes = v.proofs.filter((p) => p.status === "changes_requested");
  const allApproved = v.proofs.length > 0 && approved.length === v.proofs.length;

  // Headline for where things stand, like Approve Pro's "Design approved!" and "Design rejected" pages.
  let title: string;
  let lead: string;
  if (v.viewOnly) {
    title = open.length ? "A proof to look over" : allApproved || v.closed ? t("text_approved_title") : "Your design is in the works";
    lead = `You're viewing a copy. ${v.customerFirstName} approves the design or asks ${v.designer} for changes.`;
  } else if (v.stage === "cancelled") {
    title = "This order was cancelled";
    lead = "Questions? Give us a call.";
  } else if (ctx.done === "approved") {
    title = t("text_approved_title");
    lead = open.length ? `${t("text_approved_message")} There's another proof below still waiting for you.` : t("text_approved_message");
  } else if (ctx.done === "changes") {
    const partial = approved.length > 0;
    title = t(partial ? "text_partial_title" : "text_changes_title");
    lead = t(partial ? "text_partial_message" : "text_changes_message");
  } else if (ctx.done === "message") {
    title = "Message sent";
    lead = `${v.designer} will get back to you. You'll get an email when there's an answer.`;
  } else if (open.length) {
    title = t("text_ready_title");
    lead = t("text_ready_message");
  } else if (v.closed) {
    title = t("text_approved_title");
    lead = "Your kit is in the production queue. We'll email you when it's on the printer.";
  } else if (allApproved) {
    title = t("text_approved_title");
    lead = t("text_approved_message");
  } else if (changes.length) {
    title = t("text_changes_title");
    lead = t("text_changes_message");
  } else {
    title = t("text_waiting_title");
    lead = t("text_waiting_message");
  }

  const single = v.proofs.length === 1;
  const badge = single ? `<span class="pp-badge">${esc(v.proofs[0].label)}</span>` : "";

  const ackItems = (s.proof_ack_items ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  const requireAck = s.proof_require_ack === "1";

  const proofHtml = (p: CustomerProof, multi: boolean, interactive: boolean) => {
    const names = p.machines.map((m) => m.machine).join(" + ");
    const stamp =
      p.status === "approved" ? `<span class="pp-stamp pp-stamp--approved">Approved</span>` : p.status === "changes_requested" ? `<span class="pp-stamp pp-stamp--changes">Changes requested</span>` : "";
    const sheets = p.files
      .map((f) =>
        f.contentType.startsWith("image/")
          ? `<figure class="pp-sheet"><a href="${fileUrl(f.id)}" target="_blank" rel="noopener"><img src="${fileUrl(f.id)}" alt="Proof for ${esc(names)}" loading="lazy"></a>${stamp}</figure>`
          : `<figure class="pp-sheet"><a class="pp-pdf" href="${fileUrl(f.id)}" target="_blank" rel="noopener">Open the proof (${esc(f.filename)})</a>${stamp}</figure>`,
      )
      .join("");
    const details = p.machines
      .map(
        (m, i) =>
          `${i ? "<hr>" : ""}<dt>Machine</dt><dd>${esc(m.machine)}</dd>${m.kit ? `<dt>Kit</dt><dd>${esc(m.kit)}</dd>` : ""}${m.finish ? `<dt>Finish</dt><dd>${esc(m.finish)}</dd>` : ""}`,
      )
      .join("");
    const designer = p.designer ?? v.designer;
    const head = multi ? `<div class="pp-proof__head"><span class="pp-badge">${esc(p.label)}</span><h2 class="pp-h2">${esc(names)}</h2></div>` : "";
    let actions = "";
    if (interactive && !v.viewOnly && p.status === "open" && !v.closed) {
      const draft = ctx.draft?.proofId === p.id ? ctx.draft : undefined;
      const checklist = ackItems.length
        ? requireAck
          ? `<fieldset class="pp-check"><legend>Before you approve, check:</legend>${ackItems
              .map((item, i) => `<label><input type="checkbox" name="ack" value="${i}" data-ack required>${esc(item)}</label>`)
              .join("")}</fieldset>`
          : `<div class="pp-check"><span class="pp-check__title">Before you approve, check:</span>${ackItems.map((i) => `<span>${esc(i)}</span>`).join("")}</div>`
        : "";
      const approveComment =
        s.proof_comment_on_approve === "1"
          ? `<label class="pp-label" for="ac-${p.id}">Anything to add? (optional)</label><textarea class="pp-textarea" id="ac-${p.id}" name="comment" rows="2" maxlength="${maxComment}"></textarea><span class="pp-count" id="ac-${p.id}-count"></span>`
          : "";
      actions = `
<form class="pp-form" method="post" action="${action("approve")}" data-approve>
  <input type="hidden" name="proof" value="${p.id}">
  ${checklist}
  ${approveComment}
  <button type="submit" class="pp-btn pp-btn--cta">${esc(t("text_approve_button", "Approve design"))}</button>
</form>
<span class="pp-cta-note">${esc(t("text_approve_note"))}</span>
<div class="pp-divider"></div>
<form class="pp-form" method="post" action="${action("changes")}" enctype="multipart/form-data" data-once>
  <input type="hidden" name="proof" value="${p.id}">
  <h2 class="pp-h2">Need changes?</h2>
  <label class="pp-label" for="ch-${p.id}">Tell ${esc(designer)} what to fix. Be as specific as you can.</label>
  <textarea class="pp-textarea" id="ch-${p.id}" name="comment" rows="4" maxlength="${maxComment}" required placeholder="e.g. Move the logo higher on the cab door">${esc(draft?.comment ?? "")}</textarea>
  <span class="pp-count" id="ch-${p.id}-count"></span>
  ${uploads ? `<label class="pp-file">Add photos or logo files (optional, up to 5) <input type="file" name="files" multiple accept="${UPLOAD_ACCEPT}"></label>` : ""}
  <button type="submit" class="pp-btn">${esc(t("text_changes_button", "Send changes"))}</button>
</form>`;
    } else if (p.status === "approved") {
      const downloads =
        s.proof_download_after_approval === "1" && p.files.length
          ? `<div class="pp-row">${p.files
              .map((f) => `<a class="pp-btn pp-btn--cta pp-btn--inline" href="${fileUrl(f.id, true)}">${p.files.length > 1 ? `Download ${esc(f.filename)}` : "Download"}</a>`)
              .join("")}</div>`
          : "";
      const undo =
        interactive && p.canUndo
          ? `<form class="pp-undo" method="post" action="${action("undo")}"><input type="hidden" name="proof" value="${p.id}">Approved by mistake? <button type="submit" class="pp-linkbtn">Change it</button></form>`
          : "";
      actions = `${p.decidedAt ? `<span class="pp-small pp-center">Approved ${esc(when(p.decidedAt))}</span>` : ""}${downloads}${undo}`;
    } else if (p.status === "changes_requested" && p.changes) {
      actions = `<p class="pp-note"><strong>Your changes · ${esc(when(p.changes.at))}</strong>${esc(p.changes.body)}</p><span class="pp-small">${esc(designer)} is working on a revision. You'll get an email when it's ready.</span>`;
    }
    return `<section class="pp-proof" aria-label="${esc(p.label)}: ${esc(names)}">
${head}
<div class="pp-sheets">${sheets}</div>
<dl class="pp-dl">${details}<hr><dt>Designer</dt><dd>${esc(designer)}</dd></dl>
${p.message ? `<p class="pp-note"><strong>Note from ${esc(designer)}</strong>${esc(p.message)}</p>` : ""}
${actions}
</section>`;
  };

  const proofs = v.proofs.map((p) => proofHtml(p, !single, true)).join("");
  const history = v.history.length
    ? `<details class="pp-history"><summary>Earlier versions (${v.history.length})</summary>${v.history.map((p) => proofHtml(p, true, false)).join("")}</details>`
    : "";

  const thread = v.messages.length
    ? `<section class="pp-form" aria-label="Messages"><h2 class="pp-h2">Messages</h2><ol class="pp-thread">${v.messages
        .map(
          (m) => `<li class="pp-msg ${m.author === "customer" ? "pp-msg--you" : "pp-msg--team"}">
<div class="pp-msg__who"><strong>${esc(m.name)}</strong><span>${esc(when(m.at))}</span></div>
<p class="pp-msg__body">${esc(m.body)}</p>
${m.files.length ? `<div class="pp-files">${m.files.map((f) => `<a href="${fileUrl(f.id, true)}">${esc(f.filename)}</a>`).join("")}</div>` : ""}
</li>`,
        )
        .join("")}</ol></section>`
    : "";

  const messageForm =
    !open.length && !v.closed && !v.viewOnly
      ? `<form class="pp-form" method="post" action="${action("message")}" enctype="multipart/form-data" data-once>
<h2 class="pp-h2">Send ${esc(v.designer)} a message</h2>
<label class="pp-label" for="msg">Questions, logo files, answers: it all goes straight to your designer.</label>
<textarea class="pp-textarea" id="msg" name="body" rows="4" maxlength="${maxComment}">${esc(ctx.draft?.body ?? "")}</textarea>
<span class="pp-count" id="msg-count"></span>
${uploads ? `<label class="pp-file">Attach files (optional, up to 5) <input type="file" name="files" multiple accept="${UPLOAD_ACCEPT}"></label>` : ""}
<button type="submit" class="pp-btn">Send message</button>
</form>`
      : "";

  const store = s.text_store_button?.trim() && s.proof_store_url?.trim() ? `<a class="pp-btn pp-btn--inline" href="${esc(s.proof_store_url)}">${esc(s.text_store_button)}</a>` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)} · Dirty Graphix</title>
<link rel="stylesheet" href="${esc(ctx.origin)}/proof-assets/tokens.css">
<link rel="stylesheet" href="${esc(ctx.origin)}/proof-assets/proof.css">
</head>
<body class="pp">
<header class="pp-head"><div class="pp-head__inner"><span class="pp-brand">Dirty Graphix</span><span class="pp-order">Order #${esc(v.orderNumber.replace(/^#/, ""))}</span></div></header>
<main class="pp-main">
${ctx.error ? `<div class="pp-alert" role="alert">${esc(ctx.error)}</div>` : ""}
<div class="pp-intro">${badge}<h1 class="pp-h1">${esc(title)}</h1><p class="pp-lead">${esc(lead)}</p></div>
${proofs}
${history}
${thread}
${messageForm}
<footer class="pp-foot">
<p>${v.viewOnly ? `Questions about the design? Ask ${esc(v.customerFirstName)}, who's working with ${esc(v.designer)} on it.` : "Questions? Use the box above. It goes straight to your designer. Replies to our emails aren’t monitored."}</p>
${store}
</footer>
</main>
${open.length ? `<dialog class="pp-dialog" id="pp-confirm" aria-labelledby="pp-confirm-title">
<div class="pp-dialog__body">
<h2 class="pp-h2" id="pp-confirm-title">${esc(t("text_approve_button", "Approve design"))}?</h2>
<p>${esc(t("text_approve_confirm"))}</p>
<button type="button" class="pp-btn pp-btn--cta" data-yes>Yes, approve</button>
<button type="button" class="pp-btn" data-no>Go back</button>
</div>
</dialog>` : ""}
<script src="${esc(ctx.origin)}/proof-assets/proof.js" defer></script>
</body>
</html>`;
}

export function renderNotFound(origin: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Link not found · Dirty Graphix</title><link rel="stylesheet" href="${esc(origin)}/proof-assets/tokens.css"><link rel="stylesheet" href="${esc(origin)}/proof-assets/proof.css"></head>
<body class="pp"><header class="pp-head"><div class="pp-head__inner"><span class="pp-brand">Dirty Graphix</span></div></header>
<main class="pp-main"><div class="pp-intro"><h1 class="pp-h1">We can't find that proof</h1><p class="pp-lead">Use the newest link in your email from Dirty Graphix, or give us a call.</p></div></main></body></html>`;
}
