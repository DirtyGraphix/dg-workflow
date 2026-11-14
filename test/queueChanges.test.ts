import { describe, expect, it } from "vitest";
import { changes, snapshot } from "../src/client/queueChanges";
import type { QueueResponse } from "../src/client/api";

const order = (id: number, isRush = false) => ({ id, isRush }) as any;
const queue = (groups: Record<string, any[]>): QueueResponse =>
  ({ groups: ["needs_first_proof", "revision_requested", "waiting_customer", "approved"].map((key) => ({ key, title: key, orders: groups[key] ?? [] })) }) as any;

describe("designer sounds: what changed since the last refresh", () => {
  const before = snapshot(queue({ waiting_customer: [order(1), order(2)], needs_first_proof: [order(3)] }));

  it("is quiet when nothing changed", () => {
    expect(changes(before, queue({ waiting_customer: [order(1), order(2)], needs_first_proof: [order(3)] }))).toEqual({ sound: null, rushIds: [] });
  });

  it("chimes for a newly assigned order", () => {
    expect(changes(before, queue({ waiting_customer: [order(1), order(2)], needs_first_proof: [order(3), order(4)] })).sound).toBe("assigned");
  });

  it("plays the two-tone for a revision request and the done tone for an approval", () => {
    expect(changes(before, queue({ revision_requested: [order(1)], waiting_customer: [order(2)], needs_first_proof: [order(3)] })).sound).toBe("revision");
    expect(changes(before, queue({ approved: [order(1)], waiting_customer: [order(2)], needs_first_proof: [order(3)] })).sound).toBe("approved");
  });

  it("puts rush first and remembers which orders need acknowledging", () => {
    const r = changes(before, queue({ approved: [order(1)], waiting_customer: [order(2)], needs_first_proof: [order(3), order(5, true)] }));
    expect(r).toEqual({ sound: "rush", rushIds: [5] });
    expect(changes(before, queue({ waiting_customer: [order(1), order(2, true)], needs_first_proof: [order(3)] })).rushIds).toEqual([2]); // marked rush later
  });
});
