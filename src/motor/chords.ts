import type { NoteEvent, NoteGroup } from "./types";

const EPS = 1e-9;

/**
 * Agrupa notas cuyo inicio cae dentro de `toleranceSec` respecto a la PRIMERA
 * nota del grupo (ancla fija). Anclar al inicio evita el encadenamiento: una
 * escala rápida con notas separadas 20 ms no se fusiona en un solo "acorde"
 * gigante.
 */
export function groupNotes(notes: readonly NoteEvent[], toleranceSec = 0.03): NoteGroup[] {
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi);
  const groups: NoteGroup[] = [];
  let current: NoteGroup | null = null;

  for (const note of sorted) {
    if (current && note.time - current.time <= toleranceSec + EPS) {
      current.notes.push(note);
    } else {
      current = { index: groups.length, time: note.time, midis: [], notes: [note] };
      groups.push(current);
    }
  }

  for (const g of groups) {
    g.midis = [...new Set(g.notes.map((n) => n.midi))].sort((a, b) => a - b);
  }
  return groups;
}

/** Une las notas de varias pistas (RF-02) conservando sus tiempos originales. */
export function selectTracks(
  tracks: ReadonlyArray<{ notes: readonly NoteEvent[] }>,
  indices: readonly number[],
): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const i of indices) {
    const track = tracks[i];
    if (!track) continue;
    for (const n of track.notes) out.push({ ...n, track: i });
  }
  return out;
}
