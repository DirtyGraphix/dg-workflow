import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { api, ApiError, upload, type Me, type OrderDetail, type ProofView, type ReplyTemplate } from "../api";
import { Chip, ErrorNote, finishVar } from "../components/ui";
import { dayTime } from "../format";

// Proofs and the customer conversation on an order. Replaces Approve Pro's "Add design" box,
// its revision cards and its comment thread.

const PROOF_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";
const proofLabel = (n: number) => (n <= 1 ? "First proof" : `Revision ${n - 1}`);
const kb = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const firstName = (s: string | null) => (s ?? "").trim().split(/\s+/)[0] || "there";

function fillTemplate(body: string, order: OrderDetail, me: Me) {
  const vars: Record<string, string> = {
    first_name: firstName(order.customer.name),
    designer: me.name.split(" ")[0],
    order_number: order.orderNumber,
    machines: order.machines.filter((m) => m.needsProof).map((m) => m.machine).join(" and "),
  };
  return body.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

function TemplatePicker({ order, me, onPick }: { order: OrderDetail; me: Me; onPick: (text: string) => void }) {
  const [templates, setTemplates] = useState<ReplyTemplate[]>([]);
  useEffect(() => {
    api<ReplyTemplate[]>("GET", "/reply-templates").then(setTemplates, () => undefined);
  }, []);
  if (!templates.length) return null;
  return (
    <select
      className="select"
      aria-label="Use a reply template"
      value=""
      onChange={(e) => {
        const t = templates.find((x) => x.id === Number(e.target.value));
        if (t) onPick(fillTemplate(t.body, order, me));
      }}
    >
      <option value="">Use a template…</option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

function StatusPill({ p }: { p: ProofView }) {
  switch (p.status) {
    case "open":
      return <span className="pill">{p.viewedAt ? `Waiting · opened ${dayTime(p.lastViewedAt ?? p.viewedAt)}` : "Waiting · not opened yet"}</span>;
    case "approved":
      return <span className="pill pill--success">Approved {p.decidedAt ? dayTime(p.decidedAt) : ""}</span>;
    case "changes_requested":
      return <span className="pill pill--warn">Changes requested {p.decidedAt ? dayTime(p.decidedAt) : ""}</span>;
    case "replaced":
      return <span className="pill">Replaced by a newer version</span>;
    default:
      return <span className="pill pill--danger">Taken back</span>;
  }
}

function SendProof({ order, me, onOrder }: { order: OrderDetail; me: Me; onOrder: (o: OrderDetail) => void }) {
  const pending = order.machines.filter((m) => m.needsProof && !m.approvedAt && !m.handedOffAt);
  const openFor = (id: number) => order.proofs.some((p) => p.status === "open" && p.machineIds.includes(id));
  const defaults = pending.filter((m) => !openFor(m.id)).map((m) => m.id);
  const [machineIds, setMachineIds] = useState<number[]>(defaults.length ? defaults : pending.map((m) => m.id));
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const revision = order.proofs.some((p) => p.status !== "withdrawn" && p.machineIds.some((id) => machineIds.includes(id)));

  const add = (list: FileList | null) => {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list)]);
    setError(null);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer.files);
  };
  const send = async () => {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      machineIds.forEach((id) => fd.append("machineIds", String(id)));
      fd.append("message", message);
      files.forEach((f) => fd.append("files", f));
      onOrder(await upload<OrderDetail>(`/orders/${order.id}/proofs`, fd));
      setFiles([]);
      setMessage("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send the proof");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-box" style={{ "--form-color": "var(--link)", marginTop: 0 } as CSSProperties}>
      <h3 className="form-box__title">{revision ? "Send a revision" : "Send a proof"}</h3>
      <label
        className={`dropzone${dragging ? " dropzone--over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <input ref={input} type="file" multiple accept={PROOF_ACCEPT} className="visually-hidden" onChange={(e) => add(e.target.files)} />
        <span>
          Drag and drop the proof here or <span className="dropzone__browse">browse</span>
        </span>
        <span className="small muted">PNG, JPG or PDF, up to 25 MB each</span>
      </label>
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span className="strong">{f.name}</span> <span className="muted small">{kb(f.size)}</span>
              <button type="button" className="btn btn--link" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {pending.length > 1 && (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 0 }}>
          <legend className="field__label">This proof covers</legend>
          {pending.map((m) => (
            <label key={m.id} className="check">
              <input
                type="checkbox"
                checked={machineIds.includes(m.id)}
                onChange={(e) => setMachineIds(e.target.checked ? [...machineIds, m.id] : machineIds.filter((x) => x !== m.id))}
              />
              {m.machine} <Chip code={m.finish} />
              {openFor(m.id) && <span className="small muted">proof out · this replaces it</span>}
            </label>
          ))}
          <span className="small" style={{ color: "var(--text-2)" }}>
            One sheet for all machines is approved as a whole. To let the customer approve one machine at a time, send each machine as its own proof.
          </span>
        </fieldset>
      )}
      <div className="field">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label htmlFor="proof-note">Note to the customer (optional)</label>
          <TemplatePicker order={order} me={me} onPick={setMessage} />
        </div>
        <textarea id="proof-note" className="textarea" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={revision ? `e.g. Hey ${firstName(order.customer.name)}, here's the adjusted mockup with your changes.` : `e.g. Hey ${firstName(order.customer.name)}, here's your first mockup. Let me know what you think!`} />
      </div>
      <ErrorNote error={error} />
      <div className="row" style={{ gap: 14 }}>
        <button type="button" className="btn btn--primary" disabled={busy || !files.length || !machineIds.length} onClick={send}>
          {busy ? "Sending…" : "Send to customer"}
        </button>
        <span className="small" style={{ color: "var(--text-2)", fontSize: 14 }}>
          {order.customer.email ? `Emails ${firstName(order.customer.name)} at ${order.customer.email} with the proof link.` : "This order has no email. Copy the customer link and send it yourself."}
        </span>
      </div>
    </div>
  );
}

function ProofCard({ p, order, onOrder }: { p: ProofView; order: OrderDetail; onOrder: (o: OrderDetail) => void }) {
  const [error, setError] = useState<string | null>(null);
  const machines = order.machines.filter((m) => p.machineIds.includes(m.id));
  const stamp = p.status === "approved" ? "Approved" : p.status === "changes_requested" ? "Changes" : null;
  const withdraw = async () => {
    setError(null);
    try {
      onOrder(await api<OrderDetail>("POST", `/orders/${order.id}/proofs/${p.id}/withdraw`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't take it back");
    }
  };
  return (
    <article className={`proof-card${p.status === "replaced" || p.status === "withdrawn" ? " proof-card--old" : ""}`} style={{ "--finish-color": finishVar(machines[0]?.finish ?? null) } as CSSProperties}>
      <div className="proof-card__head">
        <span className="proof-card__title">
          {proofLabel(p.number)} <span className="muted">· {machines.map((m) => m.machine).join(" + ")}</span>
        </span>
        <StatusPill p={p} />
      </div>
      <span className="small muted">
        Sent by {p.sentBy ?? "—"} · {dayTime(p.sentAt)}
      </span>
      <div className="proof-card__files">
        {p.files.map((f) => (
          <a key={f.id} className="proof-thumb" href={f.url} target="_blank" rel="noreferrer" title={f.filename}>
            {f.contentType.startsWith("image/") ? <img src={f.url} alt={`${proofLabel(p.number)}: ${f.filename}`} loading="lazy" /> : <span className="proof-thumb__pdf">PDF</span>}
            {stamp && <span className={`proof-thumb__stamp proof-thumb__stamp--${p.status}`}>{stamp}</span>}
            <span className="proof-thumb__name">
              {f.filename} · {kb(f.size)}
            </span>
          </a>
        ))}
      </div>
      {p.message && <p className="proof-card__note">{p.message}</p>}
      <ErrorNote error={error} />
      {p.status === "open" && (
        <button type="button" className="btn btn--link" style={{ alignSelf: "flex-start", minHeight: 36, padding: 0 }} onClick={withdraw}>
          Take this proof back
        </button>
      )}
    </article>
  );
}

function Conversation({ order, me, onOrder }: { order: OrderDetail; me: Me; onOrder: (o: OrderDetail) => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const proofName = (id: number | null) => {
    const p = order.proofs.find((x) => x.id === id);
    return p ? `${proofLabel(p.number)} · ${order.machines.filter((m) => p.machineIds.includes(m.id)).map((m) => m.machine).join(" + ")}` : null;
  };
  const send = async () => {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      const res = await api<{ emailed: boolean; order: OrderDetail }>("POST", `/orders/${order.id}/messages`, { body });
      onOrder(res.order);
      setBody("");
      setNote(res.emailed ? "Sent. The customer gets an email with a link to answer." : "Saved on the order. No email went out (no address, or that email is turned off).");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send");
    } finally {
      setBusy(false);
    }
  };
  const customer = firstName(order.customer.name);
  return (
    <div className="stack">
      {order.messages.length > 0 && (
        <ol className="thread">
          {order.messages.map((m) => (
            <li key={m.id} className={`msg msg--${m.author}`}>
              <div className="msg__who">
                <span>
                  <span className="strong">{m.author === "customer" ? order.customer.name ?? "Customer" : m.person ?? "Dirty Graphix"}</span>
                  {m.kind === "changes" && <span className="tag tag--rev" style={{ marginLeft: 8 }}>CHANGES · {proofName(m.proofId)}</span>}
                </span>
                <span className="small muted">{dayTime(m.createdAt)}</span>
              </div>
              <p className="msg__body">{m.body}</p>
              {m.files.length > 0 && (
                <div className="row small">
                  {m.files.map((f) => (
                    <a key={f.id} href={`${f.url}?download=1`}>
                      {f.filename} ({kb(f.size)})
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="field">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label htmlFor="reply">Message {customer}</label>
          <TemplatePicker order={order} me={me} onPick={setBody} />
        </div>
        <textarea id="reply" className="textarea" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Questions, answers, a heads-up. It's saved on the order and emailed to the customer." />
      </div>
      <ErrorNote error={error} />
      <div className="row" style={{ gap: 14 }}>
        <button type="button" className="btn btn--dark" disabled={busy || !body.trim()} onClick={send}>
          {busy ? "Sending…" : `Send to ${customer}`}
        </button>
        {note && <span className="small" style={{ color: "var(--success)" }}>{note}</span>}
      </div>
    </div>
  );
}

export function ProofSection({ order, me, onOrder }: { order: OrderDetail; me: Me; onOrder: (o: OrderDetail) => void }) {
  const closed = order.stage === "handed_off" || order.stage === "cancelled" || order.stage === "ship_only" || order.stage === "unassigned";
  const pending = order.machines.filter((m) => m.needsProof && !m.approvedAt && !m.handedOffAt);
  const canSend = !closed && !order.inApprovePro && pending.length > 0;
  const proofs = [...order.proofs].reverse();
  const open = order.proofs.filter((p) => p.status === "open").length;

  return (
    <section className="stack" aria-label="Proofs and customer messages" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 className="section-label" style={{ margin: 0 }}>
          Proofs · {order.proofs.length ? `${order.proofs.filter((p) => p.status !== "withdrawn").length} sent${open ? `, ${open} waiting` : ""}` : "none sent yet"}
        </h3>
        {order.customerLink && (
          <a className="btn" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }} href={order.customerLink} target="_blank" rel="noreferrer">
            Open customer page ↗
          </a>
        )}
      </div>
      {order.inApprovePro && (
        <p className="small" style={{ margin: 0, color: "var(--text-2)" }}>
          This order started in Approve Pro, so it finishes its approvals there. Record the approval under Order actions.
        </p>
      )}
      {canSend && <SendProof key={`${order.id}-${order.proofs.length}`} order={order} me={me} onOrder={onOrder} />}
      {proofs.length > 0 && (
        <div className="proof-list">
          {proofs.map((p) => (
            <ProofCard key={p.id} p={p} order={order} onOrder={onOrder} />
          ))}
        </div>
      )}
      {!closed && (
        <>
          <h3 className="section-label" style={{ margin: "6px 0 0" }}>
            Customer messages{order.customerUnread ? " · new" : ""}
          </h3>
          <Conversation order={order} me={me} onOrder={onOrder} />
        </>
      )}
    </section>
  );
}
