import { describe, expect, it } from "vitest";
import {
  addBusinessMinutes,
  businessDaysDeadline,
  businessMinutesBetween,
  holidays,
  nextOpen,
  zonedTime,
} from "../src/worker/lib/businessTime";

const tz = "America/Chicago";
const opts = { timeZone: tz };
const at = (y: number, mo: number, d: number, h: number, mi = 0) => zonedTime(y, mo, d, h * 60 + mi, tz);

describe("holidays", () => {
  it("lists the six holidays on their observed weekdays", () => {
    expect(holidays(2026).map((h) => h.date)).toEqual([
      "2026-01-01", "2026-05-25", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    ]);
    expect(holidays(2027).map((h) => h.date)).toEqual([
      "2027-01-01", "2027-05-31", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
    ]);
  });
});

describe("business minutes", () => {
  it("counts 4:00 PM to 9:00 AM the next day as 1.5 hours (spec example)", () => {
    expect(businessMinutesBetween(at(2026, 11, 10, 16), at(2026, 11, 11, 9), opts)).toBe(90);
  });

  it("skips the weekend", () => {
    expect(businessMinutesBetween(at(2026, 11, 13, 16), at(2026, 11, 16, 9), opts)).toBe(90);
  });

  it("starts after-hours arrivals at 8:00 AM the next business day", () => {
    expect(businessMinutesBetween(at(2026, 11, 10, 19), at(2026, 11, 11, 8, 45), opts)).toBe(45);
    expect(nextOpen(at(2026, 11, 13, 17), opts).toISOString()).toBe(at(2026, 11, 16, 8).toISOString());
  });

  it("skips holidays and one-off closures", () => {
    // Thanksgiving 2026 is Thu Nov 26.
    expect(businessMinutesBetween(at(2026, 11, 25, 16), at(2026, 11, 27, 9), opts)).toBe(90);
    const closed = { timeZone: tz, closures: ["2026-11-27"] };
    expect(businessMinutesBetween(at(2026, 11, 25, 16), at(2026, 11, 30, 9), closed)).toBe(90);
  });

  it("is zero when the end is before the start", () => {
    expect(businessMinutesBetween(at(2026, 11, 11, 9), at(2026, 11, 10, 9), opts)).toBe(0);
  });
});

describe("deadlines", () => {
  it("puts a 3-business-day print file deadline for a Thursday approval on Tuesday at 4:30 (mockup example)", () => {
    const due = businessDaysDeadline(at(2026, 11, 5, 7, 44), 3, opts);
    expect(due.toISOString()).toBe(at(2026, 11, 10, 16, 30).toISOString());
  });

  it("jumps holidays when counting days", () => {
    // Rush approved the Wednesday before Thanksgiving: due Friday at 4:30.
    const due = businessDaysDeadline(at(2026, 11, 25, 10), 1, opts);
    expect(due.toISOString()).toBe(at(2026, 11, 27, 16, 30).toISOString());
  });

  it("counts a Saturday approval from Monday", () => {
    const due = businessDaysDeadline(at(2026, 11, 14, 11), 1, opts);
    expect(due.toISOString()).toBe(at(2026, 11, 17, 16, 30).toISOString());
  });

  it("rolls minutes past closing into the next open day", () => {
    const due = addBusinessMinutes(at(2026, 11, 10, 16), 60, opts);
    expect(due.toISOString()).toBe(at(2026, 11, 11, 8, 30).toISOString());
  });

  it("handles the daylight-saving change", () => {
    // Clocks fall back Sun Nov 1, 2026. Fri 4 PM + 1h lands Mon 8:30 AM.
    const due = addBusinessMinutes(at(2026, 10, 30, 16), 60, opts);
    expect(due.toISOString()).toBe(at(2026, 11, 2, 8, 30).toISOString());
  });
});
