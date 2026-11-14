import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router";
import { api, type Me, type OrderSummary, type QueueGroup, type QueueResponse } from "../api";
import { Shell } from "../components/Shell";
import { Chip, GroupTitle, OrderTags, STAGE_COLORS, StatCard } from "../components/ui";
import { OrderPanel } from "./OrderPanel";
import { ago, day, hm, plural } from "../format";

function cardMeta(o: OrderSummary, group: QueueGroup["key"]): { text: string; warn: boolean } {
  const late = o.printFileDue && new Date(o.printFileDue) < new Date();
  switch (group) {
    case "needs_first_proof":
      return { text: `Ordered ${ago(o.orderedAt)}${o.isRush ? " · rush" : ""}`, warn: o.isRush };
    case "revision_requested":
      return { text: `Requested ${ago(o.stageSince)}`, warn: true };
    case "waiting_customer":
      return { text: `Proof sent ${ago(o.stageSince)}`, warn: false };
    case "approved":
      if (o.printFilePaused) return { text: "Print file deadline paused", warn: true };
      return { text: `Approved ${ago(o.stageSince)} · print file due ${o.printFileDue ? day(o.printFileDue) : "—"}${late ? " · late" : ""}`, warn: !!late };
    default:
      return { text: "", warn: false };
  }
}

function QueueCard({ order, group, selected, onSelect }: { order: OrderSummary; group: QueueGroup["key"]; selected: boolean; onSelect: () => void }) {
  const meta = cardMeta(order, group);
  return (
    <button type="button" className="q-card" aria-current={selected ? "true" : undefined} onClick={onSelect}>
      <span className="q-card__top">
        <span className="q-card__order">{order.orderNumber}</span>
        <span className="row">
          {order.customerUnread && <span className="tag tag--rev">CUSTOMER WROTE</span>}
          <OrderTags order={order} />
        </span>
      </span>
      <span className="q-card__machine">{order.machines.map((m) => m.machine).join(" + ") || "No machines on this order"}</span>
      <span className="row">
        {order.machines.map((m) => (
          <Chip key={m.id} code={m.finish} />
        ))}
      </span>
      <span className={`q-card__meta${meta.warn ? " q-card__meta--warn" : ""}`}>{meta.text}</span>
    </button>
  );
}

export function DesignQueue({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const as = params.get("person");
  const selected = Number(params.get("order")) || null;

  const load = useCallback(async () => {
    const q = await api<QueueResponse>("GET", `/queue${as ? `?person=${as}` : ""}`);
    setQueue(q);
    // Open the first order only when nothing is selected yet. After a hand-off the finished
    // order stays open so the designer sees it confirmed.
    const first = q.groups.flatMap((g) => g.orders)[0];
    if (first) {
      setParams(
        (p) => {
          if (!p.get("order")) p.set("order", String(first.id));
          return p;
        },
        { replace: true },
      );
    }
  }, [as, setParams]);

  useEffect(() => {
    load();
  }, [load]);

  const select = (id: number) => setParams((p) => (p.set("order", String(id)), p));
  const s = queue?.stats;

  return (
    <Shell
      me={me}
      title="Design queue"
      actions={
        <Link className="app-header__btn" to="/jobs/new">
          New manual job
        </Link>
      }
    >
      <section aria-label="Your numbers" className="stats">
        <StatCard
          label="Your score"
          color="var(--brand)"
          value="—"
          note={s ? `Shows after ${s.scoreUnlocksAt} orders · ${s.ordersTowardScore} so far · only you see this` : " "}
        />
        <StatCard
          label="Orders this month"
          color="var(--text)"
          value={s?.ordersThisMonth ?? "—"}
          note={s ? `Assigned to you · ${s.handedOffThisMonth} handed off` : " "}
        />
        <StatCard label="Order to first proof" color="var(--stage-first-proof)" value={hm(s?.firstProofMinutes)} note="Avg this week · business hours" />
        <StatCard label="Revision turnaround" color="var(--stage-revision)" value={hm(s?.revisionMinutes)} note="Avg this week · business hours" />
      </section>

      <div className="split">
        <nav aria-label="Your orders" className="split__side">
          {queue?.groups.map((g) => (
            <div key={g.key} className="group" style={{ "--group-color": STAGE_COLORS[g.key] } as CSSProperties}>
              <GroupTitle title={g.title} count={g.orders.length} color={STAGE_COLORS[g.key]} />
              {g.orders.length === 0 ? (
                <p className="empty">Nothing here</p>
              ) : (
                g.orders.map((o) => <QueueCard key={o.id} order={o} group={g.key} selected={o.id === selected} onSelect={() => select(o.id)} />)
              )}
            </div>
          ))}
        </nav>
        <div className="split__main">
          {selected ? (
            <OrderPanel key={selected} orderId={selected} me={me} onChange={load} />
          ) : (
            <section className="panel">
              <p className="muted" style={{ margin: 0 }}>
                {queue && queue.groups.every((g) => !g.orders.length)
                  ? `No open orders. ${plural(s?.handedOffThisMonth ?? 0, "order")} handed off this month.`
                  : "Pick an order on the left."}
              </p>
            </section>
          )}
        </div>
      </div>
    </Shell>
  );
}
