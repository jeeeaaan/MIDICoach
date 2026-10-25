import { isBlackKey } from "./noteNames";

export interface KeyRect {
  midi: number;
  x: number;
  w: number;
  black: boolean;
}

const LOWEST = 21; // A0
const HIGHEST = 108; // C8
const MIN_SPAN = 35;

/** Rango del teclado que cubre las notas dadas, con margen, mínimo ~3 octavas y bordes en tecla blanca. */
export function computeRange(midis: readonly number[]): { lo: number; hi: number } {
  let lo = 48;
  let hi = 84;
  if (midis.length > 0) {
    lo = Infinity;
    hi = -Infinity;
    for (const m of midis) {
      if (m < lo) lo = m;
      if (m > hi) hi = m;
    }
    lo -= 1;
    hi += 1;
  }
  if (hi - lo < MIN_SPAN) {
    const extra = MIN_SPAN - (hi - lo);
    lo -= Math.floor(extra / 2);
    hi += Math.ceil(extra / 2);
  }
  lo = Math.min(Math.max(lo, LOWEST), HIGHEST);
  hi = Math.min(Math.max(hi, LOWEST), HIGHEST);
  while (isBlackKey(lo) && lo > LOWEST) lo--;
  while (isBlackKey(hi) && hi < HIGHEST) hi++;
  return { lo, hi };
}

/** Posiciona las teclas en un ancho dado. Las teclas negras van centradas entre dos blancas. */
export function layoutKeys(
  lo: number,
  hi: number,
  width: number,
): { keys: KeyRect[]; whiteWidth: number } {
  let whites = 0;
  for (let m = lo; m <= hi; m++) if (!isBlackKey(m)) whites++;
  const ww = width / Math.max(1, whites);
  const bw = ww * 0.6;

  const keys: KeyRect[] = [];
  let idx = 0;
  for (let m = lo; m <= hi; m++) {
    if (isBlackKey(m)) {
      keys.push({ midi: m, x: idx * ww - bw / 2, w: bw, black: true });
    } else {
      keys.push({ midi: m, x: idx * ww, w: ww, black: false });
      idx++;
    }
  }
  return { keys, whiteWidth: ww };
}
