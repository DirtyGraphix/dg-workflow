// Sounds from the spec ("Views, tickets and notifications" → Sounds). Made with the browser's audio
// synthesizer, so there are no sound files to load. Browsers only allow sound after one click on the page.

export type SoundKind = "assigned" | "revision" | "approved" | "rush";
export type SoundLevel = "on" | "low" | "off";

const KEY = "dgw.sound";
const VOLUME: Record<SoundLevel, number> = { on: 0.5, low: 0.15, off: 0 };

let ctx: AudioContext | null = null;

export function soundLevel(): SoundLevel {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "on" || v === "low" || v === "off") return v;
  } catch {}
  return "on";
}

export function setSoundLevel(level: SoundLevel) {
  try {
    localStorage.setItem(KEY, level);
  } catch {}
}

/** Starts the audio after a click. Returns false when the browser still won't allow sound. */
export async function unlockSound(): Promise<boolean> {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    return ctx.state === "running";
  } catch {
    return false;
  }
}

export const soundReady = () => !!ctx && ctx.state === "running";

/** Sounds play Monday to Friday, 8:00 AM to 4:30 PM Central. */
export function isBusinessHours(at = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return !["Sat", "Sun"].includes(parts.weekday) && minute >= 8 * 60 && minute < 16 * 60 + 30;
}

function tone(c: AudioContext, freq: number, start: number, dur: number, volume: number, type: OscillatorType = "sine") {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** Plays a sound if sound is on, allowed by the browser and it's business hours (or `always` is set, for the test button). */
export function playSound(kind: SoundKind, opts: { always?: boolean } = {}) {
  const volume = VOLUME[soundLevel()];
  if (!volume || !ctx || ctx.state !== "running") return;
  if (!opts.always && !isBusinessHours()) return;
  const t = ctx.currentTime + 0.02;
  switch (kind) {
    case "assigned": // soft chime
      tone(ctx, 880, t, 0.6, volume * 0.7);
      tone(ctx, 1318.5, t + 0.12, 0.7, volume * 0.5);
      break;
    case "revision": // two-tone chime
      tone(ctx, 659.3, t, 0.25, volume * 0.8);
      tone(ctx, 987.8, t + 0.22, 0.45, volume * 0.8);
      break;
    case "approved": // short "done" tone
      tone(ctx, 523.3, t, 0.15, volume * 0.6);
      tone(ctx, 659.3, t + 0.1, 0.15, volume * 0.6);
      tone(ctx, 784, t + 0.2, 0.35, volume * 0.7);
      break;
    case "rush": // distinct alert
      for (let i = 0; i < 3; i++) tone(ctx, 987.8, t + i * 0.2, 0.13, volume * 0.6, "triangle");
      break;
  }
}
