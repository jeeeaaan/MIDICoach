import { groupNotes } from "./chords";
import { PausableClock } from "./clock";
import type {
  EngineEvent,
  EngineOptions,
  EngineSnapshot,
  EngineState,
  NoteEvent,
  NoteGroup,
} from "./types";

type Listener = (event: EngineEvent) => void;

/**
 * Motor de práctica "esperar la nota".
 *
 * Uso típico en la interfaz:
 *   - llamar `update()` en cada frame (requestAnimationFrame);
 *   - llamar `noteOn(midi, event.timeStamp)` desde la Web MIDI API;
 *   - leer `getSnapshot().time` para dibujar notas y sincronizar audio.
 *
 * El reloj queda limitado por un "techo" en el tiempo de la nota pendiente, de
 * modo que el congelamiento es exacto y no depende de la frecuencia de `update()`.
 */
export class PracticeEngine {
  readonly groups: NoteGroup[];
  readonly totalNotes: number;

  private readonly clock: PausableClock;
  private readonly now: () => number;
  private readonly chordWindowMs: number;
  private readonly earlyWindowMs: number;
  private readonly leadInSec: number;
  private readonly listeners = new Set<Listener>();

  private state: EngineState = "idle";
  private stateBeforePause: "running" | "waiting" = "running";
  private index = 0;
  private completedNotes = 0;
  private errors = 0;
  /** midi -> marca de tiempo (ms) de la pulsación acertada del grupo actual. */
  private matched = new Map<number, number>();
  private chordStart: number | null = null;

  constructor(notes: readonly NoteEvent[], options: EngineOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.chordWindowMs = options.chordWindowMs ?? 150;
    this.earlyWindowMs = options.earlyWindowMs ?? 200;
    this.leadInSec = options.leadInSec ?? 2;
    this.groups = groupNotes(notes, (options.groupToleranceMs ?? 30) / 1000);
    this.totalNotes = this.groups.reduce((sum, g) => sum + g.notes.length, 0);
    this.clock = new PausableClock(this.now);
    this.arm();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- Controles de sesión (RF-07) ----

  start(): void {
    if (this.state !== "idle") return;
    if (this.groups.length === 0) {
      this.setState("finished");
      this.emit({ type: "finished" });
      return;
    }
    this.clock.start();
    this.setState("running");
    this.update();
  }

  pause(): void {
    if (this.state !== "running" && this.state !== "waiting") return;
    this.stateBeforePause = this.state;
    this.clock.pause();
    this.clearChord();
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.clock.start();
    this.setState(this.stateBeforePause);
    this.update();
  }

  /** Vuelve a la primera nota y descarta el progreso y los errores. */
  reset(): void {
    this.clock.reset();
    this.index = 0;
    this.completedNotes = 0;
    this.errors = 0;
    this.clearChord();
    this.arm();
    this.setState("idle");
  }

  // ---- Bucle y entrada ----

  /** Llamar en cada frame. Detecta la llegada a la nota pendiente y expira ventanas de acorde. */
  update(): void {
    if (this.state === "running" && this.clock.atCeiling()) {
      this.setState("waiting");
      const group = this.groups[this.index];
      if (group) this.emit({ type: "waiting", group });
    }
    if (this.state === "running" || this.state === "waiting") {
      this.expireChordWindow(this.now());
    }
  }

  /** Registra una tecla presionada. `timestamp` en ms, mismo origen que `now` (performance.now). */
  noteOn(midi: number, timestamp: number = this.now()): void {
    if (this.state !== "running" && this.state !== "waiting") return;
    this.update();

    const group = this.groups[this.index];
    if (!group) return;

    // Pulsaciones demasiado adelantadas se ignoran (no cuentan como error).
    const msToGroup = (group.time - this.clock.getTime()) * 1000;
    if (msToGroup > this.earlyWindowMs) return;

    this.expireChordWindow(timestamp);

    if (group.midis.includes(midi)) {
      if (!this.matched.has(midi)) {
        this.matched.set(midi, timestamp);
        if (this.chordStart === null) this.chordStart = timestamp;
        this.emit({ type: "noteMatched", midi, group });
      }
      if (this.matched.size === group.midis.length) this.completeGroup(group);
    } else {
      this.errors++;
      this.emit({ type: "wrongNote", midi, group });
    }
  }

  // ---- Consulta ----

  getSnapshot(): EngineSnapshot {
    const group = this.groups[this.index] ?? null;
    const matchedMidis = [...this.matched.keys()].sort((a, b) => a - b);
    return {
      state: this.state,
      time: this.clock.getTime(),
      groupIndex: this.index,
      totalGroups: this.groups.length,
      completedNotes: this.completedNotes,
      totalNotes: this.totalNotes,
      progress: this.totalNotes === 0 ? 1 : this.completedNotes / this.totalNotes,
      errors: this.errors,
      currentGroup: group,
      pendingMidis: group ? group.midis.filter((m) => !this.matched.has(m)) : [],
      matchedMidis,
    };
  }

  /** Próximos grupos, para dibujar las notas que se acercan. */
  getUpcoming(count: number): NoteGroup[] {
    return this.groups.slice(this.index, this.index + count);
  }

  // ---- Internos ----

  private arm(): void {
    const first = this.groups[0];
    this.clock.setCeiling(first ? first.time : Infinity);
    // Evita esperar un silencio largo antes de la primera nota.
    this.clock.seek(first ? Math.max(0, first.time - this.leadInSec) : 0);
  }

  private completeGroup(group: NoteGroup): void {
    this.completedNotes += group.notes.length;
    this.clearChord();
    this.index++;
    this.emit({ type: "groupCompleted", group });

    const next = this.groups[this.index];
    if (!next) {
      this.clock.pause();
      this.setState("finished");
      this.emit({ type: "finished" });
      return;
    }
    // Re-ancla en el punto exacto de la nota y libera hasta la siguiente.
    this.clock.setCeiling(next.time);
    if (this.state === "waiting") this.setState("running");
  }

  private expireChordWindow(at: number): void {
    if (this.chordStart === null || at - this.chordStart <= this.chordWindowMs) return;
    const group = this.groups[this.index];
    const missing = group ? group.midis.filter((m) => !this.matched.has(m)) : [];
    this.clearChord();
    if (group) this.emit({ type: "chordWindowExpired", group, missing });
  }

  private clearChord(): void {
    this.matched.clear();
    this.chordStart = null;
  }

  private setState(next: EngineState): void {
    if (next === this.state) return;
    const previous = this.state;
    this.state = next;
    this.emit({ type: "stateChange", state: next, previous });
  }

  private emit(event: EngineEvent): void {
    for (const l of this.listeners) l(event);
  }
}
