import { isUsableRange } from "./motor/octaves";
import type { KeyRange } from "./motor/octaves";
import { noteName } from "./noteNames";

export interface KeyboardPreset {
  keys: number;
  range: KeyRange;
}

/** Tamaños comunes. Los rangos son los habituales de cada tamaño (el 37 y el 76 varían según marca). */
export const KEYBOARD_PRESETS: readonly KeyboardPreset[] = [
  { keys: 88, range: { lo: 21, hi: 108 } }, // La0–Do8
  { keys: 76, range: { lo: 28, hi: 103 } }, // Mi1–Sol7
  { keys: 61, range: { lo: 36, hi: 96 } }, // Do2–Do7
  { keys: 49, range: { lo: 36, hi: 84 } }, // Do2–Do6
  { keys: 37, range: { lo: 41, hi: 77 } }, // Fa2–Fa5
  { keys: 25, range: { lo: 48, hi: 72 } }, // Do3–Do5
];

export const DEFAULT_RANGE: KeyRange = KEYBOARD_PRESETS[0]!.range;

export function presetForKeys(keys: number): KeyboardPreset | undefined {
  return KEYBOARD_PRESETS.find((p) => p.keys === keys);
}

export function presetForRange(range: KeyRange): KeyboardPreset | undefined {
  return KEYBOARD_PRESETS.find((p) => p.range.lo === range.lo && p.range.hi === range.hi);
}

/** "61 teclas (Do2–Do7)" */
export function describeRange(range: KeyRange): string {
  return `${range.hi - range.lo + 1} teclas (${noteName(range.lo)}–${noteName(range.hi)})`;
}

// ---- Persistencia por dispositivo (opcional: puede fallar en ventanas privadas) ----

const storageKey = (device: string | null): string => `piano:rango:${device ?? "general"}`;

export function loadRange(device: string | null): KeyRange | null {
  try {
    const raw = localStorage.getItem(storageKey(device));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<KeyRange>;
    const range = { lo: Number(parsed.lo), hi: Number(parsed.hi) };
    return isUsableRange(range) ? range : null;
  } catch {
    return null;
  }
}

export function saveRange(device: string | null, range: KeyRange): void {
  try {
    localStorage.setItem(storageKey(device), JSON.stringify(range));
  } catch {
    /* sin almacenamiento: el rango solo vale para esta sesión */
  }
}
