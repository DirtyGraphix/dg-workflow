import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router";
import { api, type Me, type OrderSummary, type QueueGroup, type QueueResponse } from "../api";
import { Shell } from "../components/Shell";
import { Chip, GroupTitle, OrderTags, STAGE_COLORS, StatCard } from "../components/ui";
import { OrderPanel } from "./OrderPanel";
import { ago, day, hm, plural } from "../format";
import { useLiveRefresh } from "../live";
import { isBusinessHours, playSound, setSoundLevel, soundLevel, soundReady, unlockSound, type SoundLevel } from "../sounds";
import { changes, snapshot } from "../queueChanges";

const LEVEL_LABEL: Record<SoundLevel, string> = { on: "Sound: On", low: "Sound: Low", off: "Sound: Off" };
const NEXT_LEVEL: Record<SoundLevel, SoundLevel> = { on: "low", low: "off", off: "on" };


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
  const [tick, setTick] = useState(0);
  const [level, setLevel] = useState<SoundLevel>(soundLevel());
  const [ready, setReady] = useState(soundReady());
  const [rushAlert, setRushAlert] = useState<number[]>([]);
  const last = useRef<Map<number, { group: string; rush: boolean }> | null>(null);

  /** `fromRefresh`: a timed refresh, where changes came from someone else (sounds play only for those). */
  const load = useCallback(async (fromRefresh = false) => {
    const q = await api<QueueResponse>("GET", `/queue${as ? `?person=${as}` : ""}`);
    setQueue(q);
    // Sounds only for your own queue, not when the team lead looks at someone else's.
    if (fromRefresh && !as && last.current) {
      const { sound, rushIds } = changes(last.current, q);
      if (sound) playSound(sound);
      if (rushIds.length) setRushAlert((ids) => [...new Set([...ids, ...rushIds])]);
    }
    last.current = snapshot(q);
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
    last.current = null;
    load();
  }, [load]);

  useLiveRefresh(() => {
    load(true);
    setTick((t) => t + 1);
  });

  // Rush repeats until someone acknowledges it (business hours only).
  useEffect(() => {
    if (!rushAlert.length) return;
    const timer = setInterval(() => isBusinessHours() && playSound("rush"), 10_000);
    return () => clearInterval(timer);
  }, [rushAlert.length]);

  // Browsers allow sound only after a click on the page.
  useEffect(() => {
    const unlock = () => unlockSound().then(setReady);
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const changeLevel = async () => {
    const ok = await unlockSound();
    setReady(ok);
    const next = ready ? NEXT_LEVEL[level] : level;
    setLevel(next);
    setSoundLevel(next);
    if (next !== "off") playSound("assigned", { always: true });
  };

  const select = (id: number) => setParams((p) => (p.set("order", String(id)), p));
  const s = queue?.stats;

  return (
    <Shell
      me={me}
      title="Design queue"
      actions={
        <>
          {!as && (
            <button type="button" className="app-header__btn" onClick={changeLevel} title="Sounds play for your own orders during business hours">
              {ready ? LEVEL_LABEL[level] : "Turn on sound"}
            </button>
          )}
          <Link className="app-header__btn" to="/jobs/new">
            New manual job
          </Link>
        </>
      }
    >
      {rushAlert.length > 0 && (
        <div className="rush-alert" role="alert">
          <span className="tag tag--rush">RUSH</span>
          <span className="strong">
            {rushAlert.length === 1 ? "A rush order" : `${rushAlert.length} rush orders`} just landed in your queue:{" "}
            {rushAlert
              .map((id) => queue?.groups.flatMap((g) => g.orders).find((o) => o.id === id)?.orderNumber)
              .filter(Boolean)
              .join(", ")}
          </span>
          <button
            type="button"
            className="btn btn--dark"
            onClick={() => {
              select(rushAlert[0]);
              setRushAlert([]);
            }}
          >
            Acknowledge
          </button>
        </div>
      )}
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
            <OrderPanel key={selected} orderId={selected} me={me} onChange={() => load()} refreshTick={tick} />
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
