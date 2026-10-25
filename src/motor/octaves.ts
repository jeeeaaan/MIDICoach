import { groupNotes } from "./chords";
import type { NoteEvent } from "./types";

/** Rango físico del teclado, en números MIDI, ambos extremos incluidos. */
export interface KeyRange {
  lo: number;
  hi: number;
}

export interface AdaptationReport {
  totalNotes: number;
  /** Notas cuyo número MIDI cambió (incluye las que se movieron junto con su acorde). */
  adaptedNotes: number;
  totalGroups: number;
  adaptedGroups: number;
  /** Grupos que no cabían enteros en el teclado y se adaptaron nota por nota. */
  foldedGroups: number;
  /** Mayor desplazamiento aplicado, en octavas (valor absoluto). */
  maxOctaves: number;
}

export interface AdaptationResult {
  /** Mismas notas y mismo orden que la entrada; las movidas llevan `originalMidi`. */
  notes: NoteEvent[];
  report: AdaptationReport;
}

/**
 * Con 12 teclas consecutivas (11 semitonos de diferencia) existe una posición
 * para cualquier nota: es el mínimo para poder adaptar siempre por octavas.
 */
export const MIN_RANGE_SPAN = 11;

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
 * Adapta las notas de una canción al rango físico de un teclado (solo octavas,
 * así cada nota conserva su nombre: Do sigue siendo Do).
 *
 * Reglas, en orden:
 *  1. Un grupo (notas simultáneas, mismo criterio que el motor) que ya cabe en el
 *     rango no se toca.
 *  2. Si no cabe, se mueve ENTERO la cantidad mínima de octavas que lo haga caber.
 *     Los intervalos del acorde y su posición relativa no cambian.
 *  3. Si el grupo es más ancho que el teclado, cada nota fuera de rango se mueve
 *     por octavas a la posición válida más cercana. Se conservan los nombres de las
 *     notas, pero el acorde cambia de inversión.
 *
 * Como cualquier rango válido contiene las 12 notas, ninguna nota queda sin
 * posición y la práctica no puede bloquearse por teclas inexistentes.
 *
 * `toleranceSec` debe coincidir con la tolerancia de agrupación del motor (30 ms).
 */
export function adaptNotesToRange(
  notes: readonly NoteEvent[],
  range: KeyRange,
  toleranceSec = 0.03,
): AdaptationResult {
  if (!isUsableRange(range)) {
    throw new RangeError(
      `Rango de teclado no válido (${range.lo}–${range.hi}): debe abarcar al menos ${MIN_RANGE_SPAN + 1} teclas.`,
    );
  }
  const { lo, hi } = range;
  const groups = groupNotes(notes, toleranceSec);
  const replacement = new Map<NoteEvent, NoteEvent>();

  let adaptedGroups = 0;
  let foldedGroups = 0;
  let maxOctaves = 0;

  for (const group of groups) {
    let min = Infinity;
    let max = -Infinity;
    for (const n of group.notes) {
      if (n.midi < min) min = n.midi;
      if (n.midi > max) max = n.midi;
    }
    if (min >= lo && max <= hi) continue;

    adaptedGroups++;

    // Desplazamientos k (en octavas) que dejan el grupo completo dentro del rango.
    const kLow = Math.ceil((lo - min) / 12);
    const kHigh = Math.floor((hi - max) / 12);

    if (kLow <= kHigh) {
      const k = Math.min(Math.max(0, kLow), kHigh); // el más cercano a 0
      maxOctaves = Math.max(maxOctaves, Math.abs(k));
      for (const n of group.notes) replacement.set(n, shifted(n, k));
    } else {
      foldedGroups++;
      for (const n of group.notes) {
        if (n.midi >= lo && n.midi <= hi) continue;
        const k = n.midi < lo ? Math.ceil((lo - n.midi) / 12) : -Math.ceil((n.midi - hi) / 12);
        maxOctaves = Math.max(maxOctaves, Math.abs(k));
        replacement.set(n, shifted(n, k));
      }
    }
  }

  let adaptedNotes = 0;
  const out = notes.map((n) => {
    const r = replacement.get(n);
    if (r && r.midi !== n.midi) {
      adaptedNotes++;
      return r;
    }
    return n;
  });

  return {
    notes: out,
    report: {
      totalNotes: notes.length,
      adaptedNotes,
      totalGroups: groups.length,
      adaptedGroups,
      foldedGroups,
      maxOctaves,
    },
  };
}

function shifted(note: NoteEvent, octaves: number): NoteEvent {
  if (octaves === 0) return note;
  return { ...note, midi: note.midi + 12 * octaves, originalMidi: note.originalMidi ?? note.midi };
}
