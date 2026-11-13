// Passwords and sessions. Passwords are hashed with PBKDF2-SHA256; session tokens are
// random, sent as an HttpOnly cookie, and stored only as a SHA-256 hash.

const ITERATIONS = 100_000; // the most Workers allows for PBKDF2
export const SESSION_COOKIE = "dgw_session";
export const SESSION_DAYS = 30;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const actual = await pbkdf2(password, unb64(salt), Number(iter));
  const expected = unb64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export function newToken(): string {
  return b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return b64(new Uint8Array(digest));
}

export const MIN_PASSWORD_LENGTH = 10;

export type Role = "admin" | "lead" | "billing" | "designer" | "production" | "kits" | "listings";

export interface Person {
  id: number;
  name: string;
  email: string;
  role: Role;
  takes_orders: number;
}

/** Who can hand out orders: TY, the team lead and Nikki. */
export const canAssign = (p: Person) => p.role === "admin" || p.role === "lead" || p.role === "billing";
/** Who can open any designer's orders. */
export const canSeeAllDesign = (p: Person) => p.role === "admin" || p.role === "lead";
