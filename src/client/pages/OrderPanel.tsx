import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { api, ApiError, type LengthCheck, type Me, type MachineView, type OrderDetail, type TimelineEvent } from "../api";
import { Chip, ErrorNote, finishVar, OrderTags } from "../components/ui";
import { day, dayTime, feet, full, hm, inches, PAYMENT_LABELS, plural, time } from "../format";

const METHOD_LABELS: Record<string, string> = {
  approve_pro: "In Approve Pro",
  phone: "Phone call",
  in_person: "In person",
  text: "Text message",
  email: "Email",
  other: "Other",
};

type FormKind = "approve" | "reject" | "rush" | "custom" | "pause" | null;

// ---------- timeline ----------

function timelineLabel(e: TimelineEvent, order: OrderDetail, proofIndex: number): string {
  const machineName = (id: number) => order.machines.find((m) => m.id === id)?.machine ?? "machine";
  switch (e.kind) {
    case "received":
      return order.source === "manual" ? "Manual job created" : "Ordered";
    case "assigned":
    case "reassigned":
      return e.note ?? "Assigned";
    case "proof_sent":
      return proofIndex === 0 ? "First proof sent" : `Revision ${proofIndex} sent`;
    case "revision_requested":
      return "Revision requested";
    case "approved": {
      const ids: number[] = e.data?.machineIds ?? [];
      const which = e.data?.all && ids.length === order.machines.length ? "" : ` · ${ids.map(machineName).join(", ")}`;
      return `Customer approved${which}`;
    }
    case "checklist_signed":
      return `Checklist signed off by ${e.person ?? "designer"}`;
    case "length_logged":
      return `Length logged · ${e.machine_id ? machineName(e.machine_id) : ""} ${inches(e.data?.fullLength ?? 0)}`;
    case "handed_off":
      return `Handed off · ${plural((e.data?.machineIds ?? []).length, "machine")}`;
    case "marked_rush":
      return "Marked rush";
    case "marked_custom":
      return "Marked custom one-off";
    case "print_file_paused":
      return "Print file deadline paused";
    case "print_file_resumed":
      return `Print file deadline resumed · ${hm(e.data?.pausedMinutes ?? 0)} added`;
    case "cancelled":
      return "Cancelled";
    default:
      return e.kind;
  }
}

const DOTS: Record<string, string> = {
  proof_sent: "var(--stage-first-proof)",
  revision_requested: "var(--stage-revision)",
  approved: "var(--stage-print-file)",
  handed_off: "var(--text)",
  marked_rush: "var(--stage-rush)",
  print_file_paused: "var(--stage-reprint)",
  cancelled: "var(--stage-reprint)",
};

function Timeline({ order }: { order: OrderDetail }) {
  let proofs = 0;
  return (
    <ol className="timeline">
      {order.timeline.map((e) => {
        const idx = e.kind === "proof_sent" ? proofs++ : 0;
        const method = e.data?.method && e.kind !== "proof_sent" ? ` · ${METHOD_LABELS[e.data.method] ?? e.data.method}` : "";
        return (
          <li key={e.id}>
            <span aria-hidden="true" className="timeline__dot" style={{ "--dot": DOTS[e.kind] ?? "var(--stage-waiting)" } as CSSProperties} />
            <span>
              <span className="strong">{timelineLabel(e, order, idx)}</span>
              <span className="muted"> · {dayTime(e.at)}{method}</span>
              {e.note && e.kind !== "assigned" && e.kind !== "reassigned" && e.kind !== "received" && (
                <span className="timeline__note">
                  “{e.note}”{e.person ? ` · ${e.person}` : ""}
                </span>
              )}
            </span>
            <span className="timeline__dur">{e.businessMinutes !== null ? hm(e.businessMinutes) : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- stage pill ----------

function StagePill({ order }: { order: OrderDetail }) {
  const approvedCount = order.machines.filter((m) => m.approvedAt).length;
  const lastApproval = [...order.timeline].reverse().find((e) => e.kind === "approved");
  switch (order.stage) {
    case "approved":
      return <span className="pill pill--success">Customer approved{lastApproval ? ` · ${time(lastApproval.at)}` : ""}</span>;
    case "proof_sent":
      return (
        <span className="pill">
          Waiting on customer{approvedCount ? ` · ${approvedCount} of ${order.machines.length} approved` : ""}
        </span>
      );
    case "revision_requested":
      return <span className="pill pill--warn">Revision requested</span>;
    case "needs_first_proof":
      return <span className="pill pill--info">Needs first proof</span>;
    case "handed_off":
      return <span className="pill pill--success">With production</span>;
    case "cancelled":
      return <span className="pill pill--danger">Cancelled in Shopify</span>;
    default:
      return <span className="pill">Not assigned yet</span>;
  }
}

// ---------- forms ----------

function ManualDecision({ order, kind, onDone, onCancel }: { order: OrderDetail; kind: "approve" | "reject"; onDone: (o: OrderDetail) => void; onCancel: () => void }) {
  const pending = order.machines.filter((m) => !m.approvedAt);
  const [method, setMethod] = useState("phone");
  const [note, setNote] = useState("");
  const [machineIds, setMachineIds] = useState<number[]>(pending.map((m) => m.id));
  const [error, setError] = useState<string | null>(null);
  const approve = kind === "approve";
  const save = async () => {
    setError(null);
    try {
      const path = approve ? "approve" : "request-changes";
      onDone(await api<OrderDetail>("POST", `/orders/${order.id}/${path}`, approve ? { method, note, machineIds } : { method, note }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save");
    }
  };
  return (
    <div className="form-box" style={{ "--form-color": approve ? "var(--success)" : "var(--danger)" } as CSSProperties}>
      <h3 className="form-box__title">{approve ? "Approve manually" : "Reject manually"}</h3>
      <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
        <div className="field">
          <label htmlFor="manual-how">How did the customer tell you?</label>
          <select id="manual-how" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(METHOD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      {approve && pending.length > 1 && (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 0 }}>
          <legend className="field__label">Which machines did they approve?</legend>
          {pending.map((m) => (
            <label key={m.id} className="check">
              <input
                type="checkbox"
                checked={machineIds.includes(m.id)}
                onChange={(e) => setMachineIds(e.target.checked ? [...machineIds, m.id] : machineIds.filter((x) => x !== m.id))}
              />
              {m.machine} <Chip code={m.finish} />
            </label>
          ))}
        </fieldset>
      )}
      <div className="field">
        <label htmlFor="manual-note">Note (required): what the customer said and why</label>
        <textarea
          id="manual-note"
          className="textarea"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={approve ? "e.g. Customer called, approved both machines as shown" : "e.g. Wants the logo higher on the cab door"}
        />
      </div>
      <ErrorNote error={error} />
      <div className="row" style={{ gap: 10 }}>
        <button type="button" className={`btn ${approve ? "btn--save" : "btn--dark"}`} disabled={!note.trim() || (approve && !machineIds.length)} onClick={save}>
          {approve ? "Save approval" : "Save change request"}
        </button>
        <button type="button" className="btn btn--link" onClick={onCancel}>
          Cancel
        </button>
        <span className="small" style={{ color: "var(--text-2)" }}>
          {approve ? "Starts the print file clock. " : "Counts as a revision request. "}Saved to the timeline with your name and the time.
        </span>
      </div>
    </div>
  );
}

function NoteForm({
  title,
  label,
  placeholder,
  color,
  submitLabel,
  extra,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  placeholder: string;
  color: string;
  submitLabel: string;
  extra?: (v: { flag: boolean; setFlag: (b: boolean) => void }) => React.ReactNode;
  onSubmit: (note: string, flag: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [flag, setFlag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="form-box" style={{ "--form-color": color } as CSSProperties}>
      <h3 className="form-box__title">{title}</h3>
      {extra?.({ flag, setFlag })}
      <div className="field">
        <label htmlFor="note-form">{label}</label>
        <textarea id="note-form" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} />
      </div>
      <ErrorNote error={error} />
      <div className="row" style={{ gap: 10 }}>
        <button
          type="button"
          className="btn btn--dark"
          disabled={!note.trim()}
          onClick={async () => {
            setError(null);
            try {
              await onSubmit(note, flag);
            } catch (e) {
              setError(e instanceof ApiError ? e.message : "Couldn't save");
            }
          }}
        >
          {submitLabel}
        </button>
        <button type="button" className="btn btn--link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- hand-off ----------

function LengthRow({ machine, onSaved }: { machine: MachineView; onSaved: () => void }) {
  const [value, setValue] = useState(machine.quarterLengthIn?.toString() ?? "");
  const [check, setCheck] = useState<LengthCheck | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const q = parseFloat(value);
  const fullIn = Number.isFinite(q) && q > 0 ? q * 4 : null;
  const locked = !machine.approvedAt || !!machine.handedOffAt;

  const save = async (withReason?: string) => {
    if (!fullIn || q === machine.quarterLengthIn) return;
    setError(null);
    try {
      await api("PUT", `/machines/${machine.id}/length`, { quarterLength: q, reason: withReason });
      setCheck(null);
      setReason("");
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data?.lengthCheck) setCheck(e.data.lengthCheck);
      else setError(e instanceof ApiError ? e.message : "Couldn't save the length");
    }
  };

  return (
    <div className="len-row" style={{ "--finish-color": finishVar(machine.finish) } as CSSProperties}>
      <div className="len-row__name">
        <span className="strong" style={{ fontSize: 16 }}>
          {machine.machine}
        </span>
        <span>
          <Chip code={machine.finish} />
        </span>
        {machine.handedOffAt && <span className="small muted">Handed off {full(machine.handedOffAt)}</span>}
        {!machine.approvedAt && <span className="small muted">Waiting on customer approval</span>}
      </div>
      <div className="field">
        <label htmlFor={`len-${machine.id}`}>Length at ¼ scale (in)</label>
        <input
          id={`len-${machine.id}`}
          className="input input--number"
          inputMode="decimal"
          value={value}
          disabled={locked}
          onChange={(e) => {
            setValue(e.target.value);
            setCheck(null);
          }}
          onBlur={() => save()}
        />
      </div>
      <div className="len-row__full">
        <span className="small muted">Full size for production (×4)</span>
        <strong>{fullIn ? `${inches(fullIn)} · ${feet(fullIn)}` : "—"}</strong>
      </div>
      {machine.lengthReason && !check && <span className="small muted" style={{ flexBasis: "100%" }}>Length confirmed: “{machine.lengthReason}”</span>}
      {check && (
        <div className="len-check" role="alert">
          <span className="strong">Are you sure you want to push this through at this length?</span>
          <span className="small">
            {inches(check.fullLengthIn)} is {Math.abs(check.pctOff ?? 0)}% {check.direction} the usual {inches(check.averageIn ?? 0)} for this machine and kit.
            {check.direction === "under" ? " Short lengths usually mean a missing piece." : ""}
          </span>
          <div className="field">
            <label htmlFor={`reason-${machine.id}`}>Reason</label>
            <input id={`reason-${machine.id}`} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Added extra pieces" />
          </div>
          <div className="row">
            <button type="button" className="btn btn--dark" disabled={!reason.trim()} onClick={() => save(reason)}>
              Yes, use this length
            </button>
            <button
              type="button"
              className="btn btn--link"
              onClick={() => {
                setCheck(null);
                setValue(machine.quarterLengthIn?.toString() ?? "");
              }}
            >
              Fix the length
            </button>
          </div>
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

function HandOff({ order, me, reload, onChange }: { order: OrderDetail; me: Me; reload: () => Promise<void>; onChange: () => void }) {
  const [checked, setChecked] = useState<number[]>(order.checklist.signedAt ? order.checklist.items.map((i) => i.id) : []);
  const [note, setNote] = useState(order.productionNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const open = order.machines.filter((m) => !m.handedOffAt);
  const ready = open.filter((m) => m.approvedAt && m.quarterLengthIn && m.finish);
  const signed = !!order.checklist.signedAt;
  const allChecked = order.checklist.items.every((i) => checked.includes(i.id));
  const due = order.printFileDue;

  const sign = async () => {
    setError(null);
    try {
      await api("POST", `/orders/${order.id}/checklist`, { itemIds: checked });
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't sign off");
    }
  };
  const handOff = async () => {
    setError(null);
    try {
      await api("POST", `/orders/${order.id}/hand-off`, { machineIds: ready.map((m) => m.id), productionNote: note });
      await reload();
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't hand off");
    }
  };

  // Name the button for the machines that can go: every open machine once all are approved, otherwise the approved ones.
  const approvedOpen = open.filter((m) => m.approvedAt);
  const goingCount = approvedOpen.length;
  const label =
    goingCount === open.length && open.length > 1
      ? open.length === 2
        ? "Hand off both machines"
        : `Hand off all ${open.length} machines`
      : goingCount === 1
        ? `Hand off ${approvedOpen[0].machine}`
        : `Hand off ${goingCount} machines`;

  return (
    <section className="handoff" aria-label="Hand off to production">
      <div className="stack" style={{ gap: 4 }}>
        <h3 className="handoff__title">Hand off to production</h3>
        <span className="small" style={{ color: "var(--text-2)", fontSize: 14 }}>
          {due ? `Print files due ${day(due)} (${plural(order.printFileDays, "business day")} from approval). ` : ""}
          Build a file for each machine, sign off the checklist and log each machine's length at ¼ scale.
        </span>
      </div>
      <fieldset>
        <legend>Design checklist</legend>
        {order.checklist.items.map((item) => (
          <label key={item.id} className="check">
            <input
              type="checkbox"
              checked={checked.includes(item.id)}
              disabled={signed}
              onChange={(e) => setChecked(e.target.checked ? [...checked, item.id] : checked.filter((x) => x !== item.id))}
            />
            {item.label}
          </label>
        ))}
        {signed ? (
          <span className="signed">
            Signed off by {order.checklist.signedBy} · {full(order.checklist.signedAt!)}
          </span>
        ) : (
          <div className="row">
            <button type="button" className="btn btn--dark" disabled={!allChecked} onClick={sign}>
              Sign off as {me.name}
            </button>
            <span className="small muted">Check every item to sign off. Your name and the time are saved with the order.</span>
          </div>
        )}
      </fieldset>
      <div className="field">
        <label htmlFor="prod-note">Notes for production (optional)</label>
        <textarea id="prod-note" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Customer added a second door logo, print panel 4 twice" />
        <span className="small" style={{ color: "var(--text-2)" }}>
          Prints on the job ticket and shows on the production screen.
        </span>
      </div>
      {order.machines.map((m) => (
        <LengthRow key={m.id} machine={m} onSaved={reload} />
      ))}
      <ErrorNote error={error} />
      <div className="row" style={{ gap: 14 }}>
        <button type="button" className="btn btn--primary" disabled={!signed || !approvedOpen.length || ready.length < approvedOpen.length} onClick={handOff}>
          {label}
        </button>
        <span className="small" style={{ color: "var(--text-2)", fontSize: 14 }}>
          {open.length > 1 && ready.length < open.length
            ? "Machines go to production as they're ready. Production keeps the order's machines close together so they ship in one box."
            : open.length > 1
              ? "Both machines go to production together, so they print close together and ship in one box."
              : "Starts the production clock and puts the job on the production screen."}
        </span>
      </div>
    </section>
  );
}

// ---------- panel ----------

export function OrderPanel({ orderId, me, onChange }: { orderId: number; me: Me; onChange: () => void }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [form, setForm] = useState<FormKind>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setOrder(await api<OrderDetail>("GET", `/orders/${orderId}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load this order");
    }
  }, [orderId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (error && !order) return <section className="panel"><p className="error">{error}</p></section>;
  if (!order) return <section className="panel" aria-busy="true" />;

  const done = (o: OrderDetail) => {
    setOrder(o);
    setForm(null);
    setActionsOpen(false);
    onChange();
  };
  const post = async (path: string, body?: unknown) => done(await api<OrderDetail>("POST", `/orders/${order.id}/${path}`, body));
  const pick = (f: FormKind) => {
    setForm(f);
    setActionsOpen(false);
  };

  const canProof = ["needs_first_proof", "revision_requested", "proof_sent"].includes(order.stage);
  const canDecide = ["proof_sent", "revision_requested", "needs_first_proof", "approved"].includes(order.stage) && order.machines.some((m) => !m.approvedAt);
  const anyApproved = order.machines.some((m) => m.approvedAt);
  const closed = order.stage === "handed_off" || order.stage === "cancelled";
  const due = order.printFileDue;
  const late = due && new Date(due) < new Date();
  const who = order.customer.company ?? order.customer.name ?? "Customer";

  return (
    <section aria-label={`Order ${order.orderNumber}`} className="panel">
      <div className="order-head">
        <div className="order-head__main">
          <span className="muted" style={{ fontSize: 14 }}>
            {who} · {order.source === "manual" ? `manual job from ${order.sourceSystem}` : `ordered ${day(order.orderedAt)}`}
          </span>
          <h2 className="order-title">
            {order.orderNumber} · {plural(order.machines.length, "machine")}
          </h2>
          <div className="row" style={{ marginTop: 4 }}>
            <StagePill order={order} />
            {order.machines.map((m) => (
              <Chip key={m.id} code={m.finish} />
            ))}
            <OrderTags order={order} />
            {order.machines.length > 1 && <span className="small muted">ships together</span>}
          </div>
          {!closed && (
            <div className="row" style={{ marginTop: 10 }}>
              <button type="button" className="btn btn--dark" aria-expanded={actionsOpen} aria-controls="order-actions" onClick={() => setActionsOpen(!actionsOpen)}>
                {actionsOpen ? "Hide actions ▴" : "Order actions ▾"}
              </button>
            </div>
          )}
          {actionsOpen && (
            <div id="order-actions" className="actions">
              <div role="group" aria-label="Proofs" className="actions__group">
                <span className="actions__label" style={{ color: "var(--link)" }}>
                  Proofs
                </span>
                <button type="button" className="btn" disabled={!canProof} onClick={() => post("proof-sent", { via: "approve_pro" })}>
                  {order.stage === "needs_first_proof" ? "First proof sent in Approve Pro" : "Revision sent in Approve Pro"}
                </button>
              </div>
              <div role="group" aria-label="Customer told you directly" className="actions__group">
                <span className="actions__label" style={{ color: "var(--success)" }}>
                  Customer told you directly
                </span>
                <button type="button" className="btn btn--good" disabled={!canDecide} onClick={() => pick("approve")}>
                  Approve manually
                </button>
                <button type="button" className="btn btn--bad" disabled={!["proof_sent", "approved", "revision_requested"].includes(order.stage)} onClick={() => pick("reject")}>
                  Reject manually
                </button>
              </div>
              <div role="group" aria-label="Flag this order" className="actions__group">
                <span className="actions__label" style={{ color: "var(--brand-ink)" }}>
                  Flag this order
                </span>
                {!order.isRush && (
                  <button type="button" className="btn btn--flag" onClick={() => pick("rush")}>
                    Mark as rush
                  </button>
                )}
                {!order.isCustom && (
                  <button type="button" className="btn" onClick={() => pick("custom")}>
                    Mark custom one-off
                  </button>
                )}
                {anyApproved &&
                  (order.printFilePause ? (
                    <button type="button" className="btn" onClick={() => post("print-file/resume")}>
                      Resume print file deadline
                    </button>
                  ) : (
                    <button type="button" className="btn" onClick={() => pick("pause")}>
                      Pause print file deadline
                    </button>
                  ))}
              </div>
            </div>
          )}
          {(form === "approve" || form === "reject") && <ManualDecision order={order} kind={form} onDone={done} onCancel={() => setForm(null)} />}
          {form === "rush" && (
            <NoteForm
              title="Mark as rush"
              label="Note (required): why it's rush"
              placeholder="e.g. Customer called, needs it for a show next week"
              color="var(--brand)"
              submitLabel="Mark as rush"
              extra={({ flag, setFlag }) => (
                <label className="check">
                  <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} />
                  The customer is paying the rush fee
                </label>
              )}
              onSubmit={(note, paying) => post("rush", { note, customerPaying: paying })}
              onCancel={() => setForm(null)}
            />
          )}
          {form === "custom" && (
            <NoteForm
              title="Mark custom one-off"
              label="Note (required)"
              placeholder="e.g. One-off machine we don't have a kit for"
              color="var(--text)"
              submitLabel="Mark custom one-off"
              onSubmit={(note) => post("custom", { note })}
              onCancel={() => setForm(null)}
            />
          )}
          {form === "pause" && (
            <NoteForm
              title="Pause print file deadline"
              label="Explanation (required)"
              placeholder="e.g. Waiting on a vector logo from the dealer"
              color="var(--stage-reprint)"
              submitLabel="Pause the deadline"
              onSubmit={(reason) => post("print-file/pause", { reason })}
              onCancel={() => setForm(null)}
            />
          )}
        </div>
        {due && (
          <div className={`due-card${order.printFilePause ? " due-card--paused" : late ? " due-card--late" : ""}`}>
            <span className="small muted" style={{ fontSize: 12 }}>
              {order.printFilePause ? "Print file deadline paused" : late ? "Print file overdue" : "Print file due"}
            </span>
            <span className="due-card__value">{day(due)}</span>
            <span className="small muted" style={{ fontSize: 12 }}>
              {order.printFilePause
                ? `By ${order.printFilePause.by}: ${order.printFilePause.reason}`
                : `${plural(order.printFileDays, "business day")} from approval · ${order.machines.length}-machine order`}
            </span>
          </div>
        )}
      </div>

      <div className="detail-grid">
        <div className="stack">
          <h3 className="section-label">Order details</h3>
          <dl className="dl">
            <dt>Customer</dt>
            <dd>{[order.customer.name, order.customer.company].filter(Boolean).join(" · ") || "—"}</dd>
            <dt>Order notes</dt>
            <dd className="strong">{order.orderNote ? `“${order.orderNote}”` : "None"}</dd>
            <dt>Uploads</dt>
            <dd>
              {order.uploads.length
                ? order.uploads.map((u, i) => (
                    <span key={u.url}>
                      {i > 0 && ", "}
                      <a href={u.url} target="_blank" rel="noreferrer">
                        {u.name}
                      </a>
                    </span>
                  ))
                : "None"}
            </dd>
            <dt>Payment</dt>
            <dd>
              {PAYMENT_LABELS[order.paymentStatus] ?? order.paymentStatus} · {order.isRush ? "Rush" : "Standard (not rush)"}
            </dd>
            {order.isCustom && (
              <>
                <dt>Custom</dt>
                <dd>{order.customReason}</dd>
              </>
            )}
          </dl>
          <button type="button" className="btn btn--link" style={{ alignSelf: "flex-start", minHeight: 40 }} aria-expanded={contactOpen} onClick={() => setContactOpen(!contactOpen)}>
            {contactOpen ? "Hide contact and shipping" : "Show contact and shipping"}
          </button>
          {contactOpen && (
            <dl className="dl">
              <dt>Email</dt>
              <dd>{order.customer.email ?? "—"}</dd>
              <dt>Phone</dt>
              <dd>{order.customer.phone ?? "—"}</dd>
              <dt>Ship to</dt>
              <dd>{order.customer.shipTo ?? "—"}</dd>
              <dt>Shipping</dt>
              <dd>{order.customer.shipMethod ?? "—"}</dd>
            </dl>
          )}
        </div>
        <div className="stack">
          <h3 className="section-label">Timeline</h3>
          <Timeline order={order} />
        </div>
      </div>

      <div className="stack">
        <h3 className="section-label">Machines on this order · from the customizer</h3>
        <div className="machines">
          {order.machines.map((m) => (
            <div key={m.id} className="machine-card" style={{ "--finish-color": finishVar(m.finish) } as CSSProperties}>
              <span className="machine-card__top">
                <span className="machine-card__name">{m.machine}</span>
                <Chip code={m.finish} />
              </span>
              <dl className="dl">
                <dt>Kit</dt>
                <dd>{m.kit ?? "—"}</dd>
                {m.selections.map((s) => (
                  <FragmentRow key={s.name} name={s.name} value={s.value} />
                ))}
                <dt>Status</dt>
                <dd>{m.handedOffAt ? "With production" : m.approvedAt ? `Approved ${dayTime(m.approvedAt)}` : "Not approved yet"}</dd>
              </dl>
            </div>
          ))}
        </div>
      </div>

      {anyApproved && order.stage !== "cancelled" && <HandOff order={order} me={me} reload={reload} onChange={onChange} />}
    </section>
  );
}

function FragmentRow({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </>
  );
}
