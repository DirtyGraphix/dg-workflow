import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { api, ApiError, type AssignBoard, type Me, type Workload } from "../api";
import { Shell } from "../components/Shell";
import { Chip, ErrorNote, OrderTags } from "../components/ui";
import { ago, hm } from "../format";

const optionLabel = (w: Workload) => `${w.name} · ${w.open} open${w.out ? " · out today" : ""}`;

function PersonCard({ w }: { w: Workload }) {
  const total = w.needsWork + w.waiting + w.approved || 1;
  const seg = (n: number, color: string) => <span style={{ flex: `0 0 ${(n / total) * 100}%`, background: color }} />;
  return (
    <article className={`person-card${w.out ? " person-card--out" : ""}`}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 className="person-card__name">
          {w.name}{" "}
          <span className="small muted" style={{ fontFamily: "var(--font-body)", textTransform: "none", fontWeight: 600 }}>
            {w.role === "lead" ? "Team lead" : w.out ? "Out today" : "Designer"}
          </span>
        </h3>
        <span className="person-card__count">{w.open} open</span>
      </div>
      <div className="loadbar" role="img" aria-label={`${w.name}: ${w.needsWork} need work, ${w.waiting} waiting on customer, ${w.approved} approved`}>
        {seg(w.needsWork, "var(--stage-first-proof)")}
        {seg(w.waiting, "var(--stage-waiting)")}
        {seg(w.approved, "var(--stage-print-file)")}
      </div>
      <dl className="dl">
        <dt>Needs proof or revision</dt>
        <dd>{w.needsWork}</dd>
        <dt>Waiting on customer</dt>
        <dd>{w.waiting}</dd>
        <dt>Approved, needs print file</dt>
        <dd>{w.approved}</dd>
        <dt style={w.rush ? { color: "var(--brand-ink)", fontWeight: 600 } : undefined}>Rush in hand</dt>
        <dd>{w.rush}</dd>
      </dl>
      <div className="stack" style={{ gap: 4, paddingTop: 10, borderTop: "1px solid var(--divider)" }}>
        <span className="small muted">Avg first proof this week</span>
        <span className="person-card__count" style={{ fontSize: 26 }}>
          {hm(w.firstProofMinutes)}
        </span>
      </div>
    </article>
  );
}

export function Assign({ me }: { me: Me }) {
  const [board, setBoard] = useState<AssignBoard | null>(null);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const b = await api<AssignBoard>("GET", "/assign");
      setBoard(b);
      setPicks(Object.fromEntries(b.unassigned.filter((u) => u.suggestedId).map((u) => [u.order.id, u.suggestedId!])));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load orders");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const assign = async (orderIds: number[]) => {
    setBusy(true);
    setError(null);
    try {
      for (const id of orderIds) if (picks[id]) await api("POST", `/orders/${id}/assign`, { personId: picks[id] });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't assign");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const unassigned = board?.unassigned ?? [];
  const stripe = (o: (typeof unassigned)[number]["order"]) => (o.isRush ? "var(--stage-rush)" : "var(--stage-first-proof)");

  return (
    <Shell
      me={me}
      title="Assign today's orders"
      actions={
        <button type="button" className="btn btn--cta" style={{ minHeight: 48, fontSize: 19, padding: "0 20px" }} disabled={busy || !unassigned.length} onClick={() => assign(unassigned.map((u) => u.order.id))}>
          Assign all as suggested
        </button>
      }
    >
      <ErrorNote error={error} />
      <div className="board">
        <section aria-label="Unassigned orders" className="board__orders">
          <h2 className="big-title">
            <span aria-hidden="true" className="group-title__dot" style={{ "--group-color": "var(--stage-first-proof)" } as CSSProperties} />
            Unassigned
            <span className="group-title__count" style={{ "--group-color": "var(--stage-first-proof)" } as CSSProperties}>
              {unassigned.length}
            </span>
          </h2>
          {board && !unassigned.length && <p className="empty">Everything is assigned.</p>}
          {unassigned.map(({ order, why }) => (
            <div key={order.id} className="assign-card" style={{ "--group-color": stripe(order) } as CSSProperties}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="strong" style={{ fontSize: 17, fontVariantNumeric: "tabular-nums" }}>
                  {order.orderNumber}
                </span>
                <span className="row">
                  {order.machines.length > 1 && <span className="tag tag--custom">{order.machines.length} MACHINES</span>}
                  <OrderTags order={order} />
                </span>
              </div>
              {order.machines.map((m) => (
                <span key={m.id} className="row" style={{ fontSize: 15 }}>
                  {m.machine} <Chip code={m.finish} />
                </span>
              ))}
              <span className="small muted">
                {order.source === "manual" ? "Manual job" : "Ordered"} {ago(order.orderedAt)}
              </span>
              <div className="assign-card__foot">
                <label htmlFor={`assign-${order.id}`} className="small strong" style={{ color: "var(--text-2)" }}>
                  Assign to
                </label>
                <select
                  id={`assign-${order.id}`}
                  className="select"
                  value={picks[order.id] ?? ""}
                  onChange={(e) => setPicks({ ...picks, [order.id]: Number(e.target.value) })}
                >
                  <option value="" disabled>
                    Pick a designer
                  </option>
                  {board?.workload.map((w) => (
                    <option key={w.id} value={w.id}>
                      {optionLabel(w)}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn--dark" disabled={busy || !picks[order.id]} onClick={() => assign([order.id])}>
                  Assign
                </button>
                <span className="small muted">Suggested: {why.toLowerCase()}</span>
              </div>
            </div>
          ))}
        </section>

        <section aria-label="Designer workload" className="board__team">
          <h2 className="big-title">Designer workload</h2>
          <div className="workload">
            {board?.workload.map((w) => (
              <PersonCard key={w.id} w={w} />
            ))}
          </div>
          <div className="legend">
            <span>
              <i style={{ background: "var(--stage-first-proof)" }} />
              Needs proof or revision
            </span>
            <span>
              <i style={{ background: "var(--stage-waiting)" }} />
              Waiting on customer
            </span>
            <span>
              <i style={{ background: "var(--stage-print-file)" }} />
              Approved, needs print file
            </span>
          </div>
        </section>
      </div>
    </Shell>
  );
}
