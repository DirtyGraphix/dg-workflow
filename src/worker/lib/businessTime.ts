// Business-time clock for every design and production timer.
//
// Rules (docs/workflow-spec.md, "Clock days"):
// - Open Monday to Friday, 8:00 AM to 4:30 PM shop time (America/Chicago).
// - Closed on six holidays. When one lands on a weekend, the observed weekday
//   (Friday before or Monday after) is the day off.
// - Management can add one-off closures.
// - Anything that arrives outside open hours starts counting at the next opening.

export const OPEN_MINUTE = 8 * 60; // 8:00 AM
export const CLOSE_MINUTE = 16 * 60 + 30; // 4:30 PM
export const BUSINESS_DAY_MINUTES = CLOSE_MINUTE - OPEN_MINUTE; // 510

export interface ClockOptions {
  timeZone: string;
  /** Extra closed days as YYYY-MM-DD, e.g. a one-off shop closure. */
  closures?: Iterable<string>;
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  minute: number; // minutes since local midnight
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function localParts(at: Date, timeZone: string): LocalParts & { second: number } {
  const p: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(at)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, minute: p.hour * 60 + p.minute, second: p.second };
}

/** Minutes the zone is ahead of UTC at a given instant (Central is -300 or -360). */
function offsetMinutes(at: Date, timeZone: string): number {
  const p = localParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, 0, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The instant for a wall-clock time in the shop's zone. */
export function zonedTime(year: number, month: number, day: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, 0, minute);
  let t = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  // Re-check once in case the guess straddled a daylight-saving change.
  t = guess - offsetMinutes(new Date(t), timeZone) * 60000;
  return new Date(t);
}

export function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
}

function shiftDay(year: number, month: number, day: number, by: number): [number, number, number] {
  const d = new Date(Date.UTC(year, month - 1, day + by));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = dayOfWeek(year, month, 1);
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = dayOfWeek(year, month, lastDay);
  return lastDay - ((last - weekday + 7) % 7);
}

function observed(year: number, month: number, day: number): string {
  const dow = dayOfWeek(year, month, day);
  if (dow === 6) return ymd(...shiftDay(year, month, day, -1)); // Saturday → Friday
  if (dow === 0) return ymd(...shiftDay(year, month, day, 1)); // Sunday → Monday
  return ymd(year, month, day);
}

export interface Holiday {
  name: string;
  date: string; // the day the shop is closed (observed date)
}

/** The shop's six holidays for a year, on the weekday they're observed. */
export function holidays(year: number): Holiday[] {
  return [
    { name: "New Year's Day", date: observed(year, 1, 1) },
    { name: "Memorial Day", date: ymd(year, 5, lastWeekday(year, 5, 1)) },
    { name: "Independence Day", date: observed(year, 7, 4) },
    { name: "Labor Day", date: ymd(year, 9, nthWeekday(year, 9, 1, 1)) },
    { name: "Thanksgiving Day", date: ymd(year, 11, nthWeekday(year, 11, 4, 4)) },
    { name: "Christmas Day", date: observed(year, 12, 25) },
  ];
}

const holidayCache = new Map<number, Set<string>>();
function holidaySet(year: number): Set<string> {
  let s = holidayCache.get(year);
  if (!s) {
    // New Year's Day observed on Dec 31 belongs to the next year's list.
    s = new Set([...holidays(year), ...holidays(year + 1)].map((h) => h.date));
    holidayCache.set(year, s);
  }
  return s;
}

export function isWorkday(year: number, month: number, day: number, closures: Set<string>): boolean {
  const dow = dayOfWeek(year, month, day);
  if (dow === 0 || dow === 6) return false;
  const key = ymd(year, month, day);
  return !holidaySet(year).has(key) && !closures.has(key);
}

function toSet(closures?: Iterable<string>): Set<string> {
  return closures instanceof Set ? (closures as Set<string>) : new Set(closures ?? []);
}

const MAX_DAYS = 3660; // safety stop: ten years of calendar days

/** The first open business moment at or after `at`. */
export function nextOpen(at: Date, opts: ClockOptions): Date {
  const closures = toSet(opts.closures);
  const p = localParts(at, opts.timeZone);
  let [y, m, d] = [p.year, p.month, p.day];
  if (isWorkday(y, m, d, closures) && p.minute < CLOSE_MINUTE) {
    if (p.minute >= OPEN_MINUTE) return at;
    return zonedTime(y, m, d, OPEN_MINUTE, opts.timeZone);
  }
  for (let i = 0; i < MAX_DAYS; i++) {
    [y, m, d] = shiftDay(y, m, d, 1);
    if (isWorkday(y, m, d, closures)) return zonedTime(y, m, d, OPEN_MINUTE, opts.timeZone);
  }
  throw new Error("No business day found");
}

/** Business minutes between two instants (0 if end is before start). */
export function businessMinutesBetween(start: Date, end: Date, opts: ClockOptions): number {
  if (end <= start) return 0;
  const closures = toSet(opts.closures);
  const s = localParts(start, opts.timeZone);
  const e = localParts(end, opts.timeZone);
  const endKey = ymd(e.year, e.month, e.day);
  let [y, m, d] = [s.year, s.month, s.day];
  let total = 0;
  for (let i = 0; i < MAX_DAYS; i++) {
    const key = ymd(y, m, d);
    if (isWorkday(y, m, d, closures)) {
      const from = key === ymd(s.year, s.month, s.day) ? Math.max(OPEN_MINUTE, s.minute) : OPEN_MINUTE;
      const to = key === endKey ? Math.min(CLOSE_MINUTE, e.minute) : CLOSE_MINUTE;
      if (to > from) total += to - from;
    }
    if (key === endKey) return total;
    [y, m, d] = shiftDay(y, m, d, 1);
  }
  throw new Error("Range too long");
}

/** The instant reached after `minutes` of business time from `start`. */
export function addBusinessMinutes(start: Date, minutes: number, opts: ClockOptions): Date {
  const closures = toSet(opts.closures);
  let at = nextOpen(start, { ...opts, closures });
  let left = minutes;
  for (let i = 0; i < MAX_DAYS; i++) {
    const p = localParts(at, opts.timeZone);
    const room = CLOSE_MINUTE - p.minute;
    if (left <= room) return new Date(at.getTime() + left * 60000);
    left -= room;
    at = nextOpen(zonedTime(p.year, p.month, p.day, CLOSE_MINUTE, opts.timeZone), { ...opts, closures });
  }
  throw new Error("Deadline too far out");
}

/**
 * A day-based deadline, e.g. the 3-day print file deadline: closing time (4:30 PM)
 * on the Nth business day after the day it started. Something approved Thursday
 * with a 3-day deadline is due Tuesday at 4:30 PM. If it started after hours or
 * on a day off, it counts from the next business day.
 */
export function businessDaysDeadline(start: Date, days: number, opts: ClockOptions): Date {
  const closures = toSet(opts.closures);
  const base = localParts(nextOpen(start, { ...opts, closures }), opts.timeZone);
  let [y, m, d] = [base.year, base.month, base.day];
  let counted = 0;
  for (let i = 0; i < MAX_DAYS && counted < days; i++) {
    [y, m, d] = shiftDay(y, m, d, 1);
    if (isWorkday(y, m, d, closures)) counted++;
  }
  return zonedTime(y, m, d, CLOSE_MINUTE, opts.timeZone);
}

/** Business minutes shown as hours, e.g. 90 → "1h 30m". */
export function formatBusinessMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
