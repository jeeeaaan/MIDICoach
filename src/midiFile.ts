import * as toneMidi from "@tonejs/midi";
import type { Midi as MidiType } from "@tonejs/midi";
import type { NoteEvent } from "./motor";

// @tonejs/midi es CommonJS: según el entorno (Vite o Node ESM) `Midi` llega como
// export nombrado o dentro de `default`.
type MidiModule = { Midi: typeof MidiType };
const Midi: typeof MidiType = (
  (toneMidi as unknown as Partial<MidiModule>).Midi ??
  (toneMidi as unknown as { default: MidiModule }).default.Midi
);

export interface ParsedTrack {
  /** Índice de la pista en el archivo original. */
  index: number;
  name: string;
  instrument: string;
  /** Programa General MIDI (0–127) para elegir el timbre al reproducir. */
  program: number;
  percussion: boolean;
  noteCount: number;
  notes: NoteEvent[];
}

export interface ParsedSong {
  name: string;
  durationSec: number;
  bpm: number | null;
  totalNotes: number;
  /** Pistas melódicas con notas: las que se pueden practicar. */
  tracks: ParsedTrack[];
  /** Pistas de percusión: no se practican, solo suenan como acompañamiento. */
  percussion: ParsedTrack[];
}

export class MidiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MidiParseError";
  }
}

/** Lee un archivo MIDI (RF-01) y extrae notas, tiempos (s) y duraciones (s) por pista. */
export function parseMidi(data: ArrayBuffer | Uint8Array, fileName = ""): ParsedSong {
  let midi: MidiType;
  try {
    midi = new Midi(data);
  } catch {
    throw new MidiParseError(
      "No se pudo leer el archivo: no parece un MIDI válido o está dañado.",
    );
  }

  const tracks: ParsedTrack[] = [];
  const percussion: ParsedTrack[] = [];
  midi.tracks.forEach((t, index) => {
    if (t.notes.length === 0) return;
    const isDrums = t.instrument.percussion;
    const parsed: ParsedTrack = {
      index,
      name: t.name.trim() || `Pista ${index + 1}`,
      instrument: t.instrument.name,
      program: t.instrument.number,
      percussion: isDrums,
      noteCount: t.notes.length,
      notes: t.notes.map((n) => ({
        midi: n.midi,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
        track: index,
      })),
    };
    (isDrums ? percussion : tracks).push(parsed);
  });

  if (tracks.length === 0) {
    throw new MidiParseError("El archivo no contiene notas de piano o melodía para practicar.");
  }

  const bpm = midi.header.tempos[0]?.bpm;
  return {
    name: midi.header.name.trim() || fileName.replace(/\.midi?$/i, "") || "Canción",
    durationSec: midi.duration,
    bpm: bpm ? Math.round(bpm) : null,
    totalNotes: tracks.reduce((sum, t) => sum + t.noteCount, 0),
    tracks,
    percussion,
  };
}
