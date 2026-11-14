// Small wrapper around the app's API. Errors carry the server's plain-language message.

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: any = null,
  ) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(json?.error ?? "Something went wrong", res.status, json?.data ?? null);
  return json as T;
}

/** Same as api(), for forms with files (proof uploads). */
export async function upload<T = any>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api${path}`, { method: "POST", body: form, credentials: "same-origin" });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(json?.error ?? "Something went wrong", res.status, json?.data ?? null);
  return json as T;
}

export type FinishCode = "GL" | "MT" | "GG" | "CG" | "PR" | "CM" | "CP";
export type Stage = "unassigned" | "needs_first_proof" | "proof_sent" | "revision_requested" | "approved" | "handed_off" | "ship_only" | "cancelled";
export type JobKind = "kit" | "sheetz" | "design" | "matching";
export type Role = "admin" | "lead" | "billing" | "designer" | "production" | "kits" | "listings";

export interface Me {
  id: number;
  name: string;
  email: string;
  role: Role;
  takes_orders: number;
}

export interface OrderSummary {
  id: number;
  orderNumber: string;
  source: string;
  stage: Stage;
  stageSince: string;
  orderedAt: string;
  isRush: boolean;
  isDealer: boolean;
  isCustom: boolean;
  assignedTo: number | null;
  machines: { id: number; machine: string; finish: FinishCode | null; kind: JobKind }[];
  printFileDue: string | null;
  printFilePaused: boolean;
  customerUnread: boolean;
}

export interface QueueGroup {
  key: "reprint" | "needs_first_proof" | "revision_requested" | "waiting_customer" | "approved";
  title: string;
  orders: OrderSummary[];
}

export interface QueueResponse {
  personId: number;
  groups: QueueGroup[];
  stats: {
    ordersThisMonth: number;
    handedOffThisMonth: number;
    scoreUnlocksAt: number;
    ordersTowardScore: number;
    firstProofMinutes: number | null;
    revisionMinutes: number | null;
  };
}

export interface MachineView {
  id: number;
  kind: JobKind;
  needsProof: boolean;
  machine: string;
  kit: string | null;
  finish: FinishCode | null;
  selections: { name: string; value: string }[];
  quarterLengthIn: number | null;
  fullLengthIn: number | null;
  lengthReason: string | null;
  approvedAt: string | null;
  approvalMethod: string | null;
  handedOffAt: string | null;
  printFileDue: string | null;
}

export interface TimelineEvent {
  id: number;
  kind: string;
  at: string;
  note: string | null;
  data: any;
  machine_id: number | null;
  person: string | null;
  businessMinutes: number | null;
}

export interface OrderDetail extends OrderSummary {
  sourceSystem: string | null;
  customer: { name: string | null; company: string | null; email: string | null; phone: string | null; shipTo: string | null; shipMethod: string | null };
  orderNote: string | null;
  uploads: { name: string; url: string }[];
  paymentStatus: string;
  customReason: string | null;
  assignedName: string | null;
  inApprovePro: boolean;
  printFileDays: number;
  printFilePause: { since: string; by: string | null; reason: string | null } | null;
  checklist: { items: { id: number; label: string }[]; signedBy: string | null; signedAt: string | null };
  productionNote: string | null;
  machines: MachineView[];
  shipItems: { title: string; variant: string | null; quantity: number; attachedTo: number | null }[];
  timeline: TimelineEvent[];
  proofs: ProofView[];
  messages: MessageView[];
  customerLink: string | null;
}

export interface FileView {
  id: number;
  filename: string;
  contentType: string;
  size: number;
  url: string;
}

export type ProofStatus = "open" | "approved" | "changes_requested" | "replaced" | "withdrawn";

export interface ProofView {
  id: number;
  number: number;
  status: ProofStatus;
  message: string | null;
  sentAt: string;
  sentBy: string | null;
  decidedAt: string | null;
  viewedAt: string | null;
  lastViewedAt: string | null;
  machineIds: number[];
  files: FileView[];
}

export interface MessageView {
  id: number;
  proofId: number | null;
  author: "customer" | "staff";
  person: string | null;
  kind: "changes" | "message" | "reply";
  body: string;
  createdAt: string;
  files: FileView[];
}

export interface ReplyTemplate {
  id: number;
  name: string;
  body: string;
}

export interface LengthCheck {
  ok: boolean;
  averageIn: number | null;
  fullLengthIn: number;
  pctOff: number | null;
  direction: "over" | "under" | null;
}

export interface Workload {
  id: number;
  name: string;
  role: Role;
  out: boolean;
  open: number;
  needsWork: number;
  waiting: number;
  approved: number;
  rush: number;
  firstProofMinutes: number | null;
}

export interface AssignBoard {
  unassigned: { order: OrderSummary; suggestedId: number | null; why: string }[];
  workload: Workload[];
}

export const FINISH_NAMES: Record<FinishCode, string> = {
  GL: "Gloss",
  MT: "Matte",
  GG: "Gravel Guard",
  CG: "Chrome Gloss",
  PR: "Prismatic",
  CM: "Chrome Matte",
  CP: "Chrome Prismatic",
};
