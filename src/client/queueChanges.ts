import type { QueueResponse } from "./api";
import type { SoundKind } from "./sounds";

export type QueueSnapshot = Map<number, { group: string; rush: boolean }>;

/** What changed for this designer since the last refresh, as the sound to play (most urgent first). */
export function changes(before: QueueSnapshot, q: QueueResponse): { sound: SoundKind | null; rushIds: number[] } {
  let sound: SoundKind | null = null;
  const rank: SoundKind[] = ["rush", "revision", "approved", "assigned"];
  const pick = (k: SoundKind) => {
    if (!sound || rank.indexOf(k) < rank.indexOf(sound)) sound = k;
  };
  const rushIds: number[] = [];
  for (const g of q.groups) {
    for (const o of g.orders) {
      const prev = before.get(o.id);
      if (o.isRush && (!prev || !prev.rush)) {
        rushIds.push(o.id);
        pick("rush");
      } else if (!prev && g.key === "needs_first_proof") pick("assigned");
      else if (g.key === "revision_requested" && prev?.group !== "revision_requested") pick("revision");
      else if (g.key === "approved" && prev && prev.group !== "approved") pick("approved");
    }
  }
  return { sound, rushIds };
}

export const snapshot = (q: QueueResponse) => new Map(q.groups.flatMap((g) => g.orders.map((o) => [o.id, { group: g.key, rush: o.isRush }] as const)));
