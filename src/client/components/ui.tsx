import type { CSSProperties, ReactNode } from "react";
import { FINISH_NAMES, type FinishCode, type OrderSummary } from "../api";

export const STAGE_COLORS = {
  reprint: "var(--stage-reprint)",
  needs_first_proof: "var(--stage-first-proof)",
  revision_requested: "var(--stage-revision)",
  waiting_customer: "var(--stage-waiting)",
  approved: "var(--stage-print-file)",
  rush: "var(--stage-rush)",
} as const;

export const finishVar = (code: FinishCode | null) => (code ? `var(--finish-${code})` : "var(--border)");

export function Chip({ code }: { code: FinishCode | null }) {
  if (!code) return <span className="pill pill--warn">No finish on order</span>;
  return <span className={`chip chip--${code}`}>{`${code} · ${FINISH_NAMES[code]}`}</span>;
}

export function StatCard({ label, value, note, color }: { label: string; value: ReactNode; note: ReactNode; color: string }) {
  return (
    <div className="stat" style={{ "--stat-color": color } as CSSProperties}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      <span className="stat__note">{note}</span>
    </div>
  );
}

export function GroupTitle({ title, count, color, as: Tag = "h2" }: { title: string; count: number; color: string; as?: "h2" | "h3" }) {
  return (
    <Tag className="group-title" style={{ "--group-color": color } as CSSProperties}>
      <span aria-hidden="true" className="group-title__dot" />
      {title}
      <span className="group-title__count">{count}</span>
    </Tag>
  );
}

/** RUSH, CUSTOM and DEALER tags for an order. */
export function OrderTags({ order }: { order: Pick<OrderSummary, "isRush" | "isCustom" | "isDealer"> }) {
  return (
    <span className="row">
      {order.isRush && <span className="tag tag--rush">RUSH</span>}
      {order.isCustom && <span className="tag tag--custom">CUSTOM</span>}
      {order.isDealer && <span className="tag tag--dealer">DEALER</span>}
    </span>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {error}
    </p>
  );
}
