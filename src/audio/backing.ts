import type { EngineState } from "../motor";

/** Nota lista para sonar: ya trae el instrumento (programa General MIDI) y si es percusión. */
export interface PlayableNote {
  midi: number;
  /** Inicio en segundos del tiempo musical de la canción. */
  time: number;
  duration: number;
  /** 0 a 1. */
  velocity: number;
  /** Programa General MIDI, 0 a 127. */
  program: number;
  percussion: boolean;
}

export interface BackingSink {
  /** Hacer sonar la nota dentro de `delaySec` segundos (0 = ahora). */
  play(note: PlayableNote, delaySec: number): void;
  /** Silenciar de golpe todo lo que suena o está programado. */
  stopAll(): void;
}

/** Cuánto se programa por adelantado. Debe ser mayor que el intervalo entre frames. */
export const LOOKAHEAD_SEC = 0.12;
const EPS = 1e-6;
/** Una nota que ya pasó más de esto (p. ej. tras un tirón del navegador) se omite en vez de sonar tarde. */
const LATE_SEC = 0.05;

/**
 * Programa el acompañamiento (las pistas que el usuario NO practica) siguiendo el
 * reloj musical del motor, no el del sistema:
 *
 *  - Con el motor "esperando" el reloj está congelado en el techo (la nota pendiente),
 *    así que nunca se programa nada posterior a esa nota: la canción se detiene
 *    junto con el reloj. Las notas ya programadas terminan de sonar de forma natural.
 *  - Al pausar se silencia todo y se rebobina el cursor a lo que aún no había sonado,
 *    para que al reanudar no se pierda ni se repita ninguna nota.
 *  - Al reiniciar (estado "idle") se silencia y se vuelve al inicio.
 *
 * No depende de Web Audio: recibe un `sink`, por lo que se prueba con tiempo simulado.
 */
export class BackingScheduler {
  private readonly notes: PlayableNote[];
  private readonly sink: BackingSink;
  private cursor = 0;
  private lastTime = -Infinity;
  private sounding = false;

  constructor(notes: readonly PlayableNote[], sink: BackingSink) {
    this.notes = [...notes].sort((a, b) => a.time - b.time);
    this.sink = sink;
  }

  /**
   * Llamar en cada frame.
   * @param time tiempo musical actual (segundos)
   * @param ceiling tiempo de la nota pendiente, o null si no hay (canción terminada)
   */
  tick(state: EngineState, time: number, ceiling: number | null): void {
    if (state === "running" || state === "waiting") {
      if (time < this.lastTime - EPS) this.cursor = this.firstAtOrAfter(time - EPS);
      const horizon = Math.min(time + LOOKAHEAD_SEC, ceiling ?? Infinity);
      while (this.cursor < this.notes.length) {
        const note = this.notes[this.cursor]!;
        if (note.time > horizon + EPS) break;
        this.cursor++;
        const delay = note.time - time;
        if (delay < -LATE_SEC) continue;
        this.sink.play(note, Math.max(0, delay));
        this.sounding = true;
      }
    } else if (state === "paused") {
      // Lo que estaba programado hacia delante no llegó a sonar: se vuelve a programar al reanudar.
      this.cursor = Math.min(this.cursor, this.firstAfter(time + EPS));
      this.silence();
    } else if (state === "idle") {
      this.cursor = this.firstAtOrAfter(time - EPS);
      this.silence();
    }
    // "finished": las últimas notas terminan de sonar solas.
    this.lastTime = time;
  }

  seek(time: number): void {
    this.cursor = this.firstAtOrAfter(time - EPS);
    this.lastTime = time;
    this.silence();
  }

  private silence(): void {
    if (!this.sounding) return;
    this.sounding = false;
    this.sink.stopAll();
  }

  private firstAtOrAfter(t: number): number {
    return this.search((n) => n.time >= t);
  }

  private firstAfter(t: number): number {
    return this.search((n) => n.time > t);
  }

  private search(pred: (n: PlayableNote) => boolean): number {
    let lo = 0;
    let hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pred(this.notes[mid]!)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
}
