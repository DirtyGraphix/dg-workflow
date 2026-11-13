// Dates and times always show in shop time (Central).
const TZ = "America/Chicago";

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const wkTimeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" });
const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

/** "Tue, Nov 10" */
export const day = (iso: string) => dayFmt.format(new Date(iso));
/** "7:44 AM" */
export const time = (iso: string) => timeFmt.format(new Date(iso));
/** "Tue 2:05 PM" */
export const dayTime = (iso: string) => wkTimeFmt.format(new Date(iso)).replace(",", "");
/** "Tue, Nov 10, 8:21 AM" */
export const full = (iso: string) => `${day(iso)}, ${time(iso)}`;
export const todayYmd = () => ymdFmt.format(new Date());

/** "2h ago", "3 days ago" (wall-clock time) */
export function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** Business minutes as "5h 10m". */
export function hm(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export const inches = (n: number) => `${Math.round(n).toLocaleString("en-US")} in`;
export const feet = (n: number) => `${Math.round(n / 12)} ft`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const PAYMENT_LABELS: Record<string, string> = {
  paid: "Paid in full",
  partially_paid: "Partly paid",
  pending: "Payment pending",
  authorized: "Payment authorized",
  refunded: "Refunded",
  partially_refunded: "Partly refunded",
  voided: "Voided",
  unknown: "Not from Shopify",
};
