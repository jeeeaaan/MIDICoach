import type { NoteEvent } from "./types";

/** Rango físico del teclado, en números MIDI, ambos extremos incluidos. */
export interface KeyRange {
  lo: number;
  hi: number;
}

export interface AdaptationReport {
  totalNotes: number;
  /** Notas cuyo número MIDI cambió porque su parte se transpuso. */
  adaptedNotes: number;
  /** Notas que no caben en el teclado y se omiten de la práctica. */
  omittedNotes: number;
  totalParts: number;
  /** Partes (pistas) transpuestas completas por octavas. */
  transposedParts: number;
  /** Partes a las que se les omitieron notas por no tener una adaptación viable. */
  partsWithOmissions: number;
  /** Mayor desplazamiento aplicado, en octavas (valor absoluto). */
  maxOctaves: number;
}

export interface AdaptationResult {
  /** Notas que se pueden tocar (en el mismo orden relativo que la entrada); las movidas llevan `originalMidi`. */
  notes: NoteEvent[];
  /** Notas originales imposibles de tocar en este teclado: no se esperan ni bloquean la práctica. */
  omitted: NoteEvent[];
  report: AdaptationReport;
}

/**
 * Con 12 teclas consecutivas (11 semitonos de diferencia) existe una posición
 * para cualquier nota: es el mínimo para poder transponer por octavas.
 */
export const MIN_RANGE_SPAN = 11;

/** Una parte sin transposición viable solo se desplaza si así se tocan al menos tantas notas más. */
const SHIFT_MIN_PLAYABLE_FRACTION = 0.5;

export function isUsableRange(range: KeyRange): boolean {
  return (
    Number.isInteger(range.lo) &&
    Number.isInteger(range.hi) &&
    range.lo >= 0 &&
    range.hi <= 127 &&
    range.hi - range.lo >= MIN_RANGE_SPAN
  );
}

/**
 * Adapta las notas de una canción al rango físico de un teclado. Se trabaja por
 * "parte" (una pista = una mano o instrumento), nunca nota por nota, para no
 * deformar la melodía ni la relación entre las manos:
 *
 *  1. Si todas las notas de la parte caben, no se toca nada.
 *  2. Si existe un desplazamiento de N octavas con el que TODA la parte cabe, se
 *     transpone la parte entera (el menor |N|). Intervalos, acordes y ritmo se conservan.
 *  3. Si no existe, se omiten las notas fuera de rango y las demás no se modifican.
 *     Solo si en su posición original se tocaría menos de la mitad de la parte y otro
 *     desplazamiento permite tocar más, se usa ese desplazamiento (y se omite el resto).
 *
 * Las notas omitidas no están en `notes`, así que el motor no las espera: el tiempo
 * y la duración de la canción no cambian. Se devuelven en `omitted` para señalarlas
 * y para que suenen como acompañamiento.
 */
export function adaptNotesToRange(notes: readonly NoteEvent[], range: KeyRange): AdaptationResult {
  if (!isUsableRange(range)) {
    throw new RangeError(
      `Rango de teclado no válido (${range.lo}–${range.hi}): debe abarcar al menos ${MIN_RANGE_SPAN + 1} teclas.`,
    );
  }
  const { lo, hi } = range;

  const parts = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    const key = n.track ?? -1;
    const list = parts.get(key);
    if (list) list.push(n);
    else parts.set(key, [n]);
  }

  const kept = new Map<NoteEvent, NoteEvent>();
  const omittedSet = new Set<NoteEvent>();
  let transposedParts = 0;
  let partsWithOmissions = 0;
  let maxOctaves = 0;
  let adaptedNotes = 0;

  for (const part of parts.values()) {
    const fits = (k: number): number => {
      let count = 0;
      for (const n of part) {
        const m = n.midi + 12 * k;
        if (m >= lo && m <= hi) count++;
      }
      return count;
    };

    let min = Infinity;
    let max = -Infinity;
    for (const n of part) {
      if (n.midi < min) min = n.midi;
      if (n.midi > max) max = n.midi;
    }

    // Desplazamientos que dejan la parte completa dentro; el más cercano a 0.
    const kLow = Math.ceil((lo - min) / 12);
    const kHigh = Math.floor((hi - max) / 12);
    let k = 0;
    if (kLow <= kHigh) {
      k = Math.min(Math.max(0, kLow), kHigh);
    } else {
      // Sin transposición viable: se omite lo imposible. Se mueve la parte solo si
      // quedaría casi toda fuera del teclado y otro desplazamiento rescata más notas.
      const atZero = fits(0);
      if (atZero < part.length * SHIFT_MIN_PLAYABLE_FRACTION) {
        let best = atZero;
        for (let c = 1; c <= 10; c++) {
          for (const cand of [c, -c]) {
            const f = fits(cand);
            if (f > best) {
              best = f;
              k = cand;
            }
          }
        }
      }
    }

    let omittedHere = 0;
    for (const n of part) {
      const m = n.midi + 12 * k;
      if (m < lo || m > hi) {
        omittedSet.add(n);
        omittedHere++;
      } else if (k !== 0) {
        kept.set(n, { ...n, midi: m, originalMidi: n.originalMidi ?? n.midi });
        adaptedNotes++;
      }
    }
    if (k !== 0) {
      transposedParts++;
      maxOctaves = Math.max(maxOctaves, Math.abs(k));
    }
    if (omittedHere > 0) partsWithOmissions++;
  }

  const out: NoteEvent[] = [];
  const omitted: NoteEvent[] = [];
  for (const n of notes) {
    if (omittedSet.has(n)) omitted.push(n);
    else out.push(kept.get(n) ?? n);
  }

  return {
    notes: out,
    omitted,
    report: {
      totalNotes: notes.length,
      adaptedNotes,
      omittedNotes: omitted.length,
      totalParts: parts.size,
      transposedParts,
      partsWithOmissions,
      maxOctaves,
    },
  };
}
