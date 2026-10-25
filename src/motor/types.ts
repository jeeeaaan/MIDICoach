/**
 * Nota de entrada al motor. Es compatible estructuralmente con las notas de
 * @tonejs/midi (`track.notes[i]`: midi, time en segundos, duration, velocity),
 * así que se pueden pasar directamente sin adaptador.
 */
export interface NoteEvent {
  /** Número MIDI (60 = Do central). */
  midi: number;
  /** Inicio en segundos, ya con los cambios de tempo aplicados. */
  time: number;
  duration: number;
  velocity?: number;
  /** Índice de la pista de origen (opcional, útil para la interfaz). */
  track?: number;
}

/** Conjunto de notas que comienzan "al mismo tiempo" y se tocan como una unidad. */
export interface NoteGroup {
  index: number;
  /** Tiempo musical del grupo (inicio de la primera nota), en segundos. */
  time: number;
  /** Alturas MIDI únicas del grupo, ordenadas. */
  midis: number[];
  notes: NoteEvent[];
}

export type EngineState = "idle" | "running" | "waiting" | "paused" | "finished";

export type EngineEvent =
  | { type: "stateChange"; state: EngineState; previous: EngineState }
  | { type: "waiting"; group: NoteGroup }
  | { type: "groupCompleted"; group: NoteGroup }
  | { type: "wrongNote"; midi: number; group: NoteGroup }
  | { type: "chordWindowExpired"; group: NoteGroup; missing: number[] }
  | { type: "finished" };

export interface EngineSnapshot {
  state: EngineState;
  /** Tiempo musical actual en segundos. Fuente única para visuales y audio. */
  time: number;
  groupIndex: number;
  totalGroups: number;
  completedNotes: number;
  totalNotes: number;
  /** Avance de 0 a 1 por notas completadas. */
  progress: number;
  errors: number;
  currentGroup: NoteGroup | null;
  /** Notas del grupo actual que aún faltan por tocar. */
  pendingMidis: number[];
  /** Notas del grupo actual ya acertadas dentro de la ventana. */
  matchedMidis: number[];
}

export interface EngineOptions {
  /** Tolerancia para agrupar notas del archivo en un mismo acorde (ms). Por defecto 30. */
  groupToleranceMs?: number;
  /** Ventana para pulsar todas las teclas de un acorde, desde la primera acertada (ms). Por defecto 150. */
  chordWindowMs?: number;
  /** Cuánto antes de llegar a una nota se acepta la pulsación (ms). Por defecto 200. */
  earlyWindowMs?: number;
  /** Segundos de silencio previos a la primera nota que se muestran antes de esperar. Por defecto 2. */
  leadInSec?: number;
  /** Fuente de tiempo en ms. Por defecto performance.now(). Inyectable para pruebas. */
  now?: () => number;
}
