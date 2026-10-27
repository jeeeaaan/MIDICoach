import type { EngineState } from "../motor";
import { BackingScheduler } from "./backing";
import type { PlayableNote } from "./backing";
import { GmSynth } from "./synth";

/**
 * Audio de la canción durante la práctica:
 *  - el acompañamiento (pistas que NO practicas y la batería) suena siguiendo el reloj
 *    del motor, así que se detiene cuando la canción espera tu nota;
 *  - las notas que tocas bien suenan con el instrumento de tu pista.
 */
export class SongAudio {
  private ctx: AudioContext | null = null;
  private synth: GmSynth | null = null;
  private scheduler: BackingScheduler | null = null;
  private backing: PlayableNote[] = [];
  private volume = 0.7;
  private on = false;
  /** Instrumentos que se usarán en la práctica (acompañamiento y pistas del usuario). */
  private userPrograms = new Set<number>();

  static supported(): boolean {
    return typeof AudioContext !== "undefined";
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Debe llamarse desde un gesto del usuario (clic): los navegadores bloquean el audio sin él. */
  async enable(): Promise<void> {
    if (!SongAudio.supported()) throw new Error("Web Audio no disponible");
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.synth = new GmSynth(this.ctx, this.volume);
    }
    await this.ctx.resume();
    this.on = true;
    this.rebuild();
    this.preload();
  }

  /** Instrumentos de las pistas que toca el usuario: se precargan para que su primera nota no se retrase. */
  setUserPrograms(programs: Iterable<number>): void {
    this.userPrograms = new Set(programs);
    this.preload();
  }

  disable(): void {
    this.on = false;
    this.synth?.stopAll();
    this.scheduler = null;
  }

  /** Reanuda el contexto si el navegador lo suspendió; llamar desde clics de la interfaz. */
  unlock(): void {
    if (this.on && this.ctx?.state === "suspended") void this.ctx.resume();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.synth?.setVolume(volume);
  }

  /** Acompañamiento de la canción actual (cambia al elegir otra pista o cargar otro archivo). */
  setBacking(notes: PlayableNote[]): void {
    this.backing = notes;
    this.synth?.stopAll();
    this.rebuild();
    this.preload();
  }

  tick(state: EngineState, time: number, ceiling: number | null): void {
    this.scheduler?.tick(state, time, ceiling);
  }

  /** Suena de inmediato una nota que el usuario tocó correctamente. */
  playUser(note: PlayableNote): void {
    if (!this.on || !this.synth || !this.ctx) return;
    this.synth.playNote(this.ctx.currentTime, note);
  }

  /** Calienta el sintetizador con todos los instrumentos de la canción (no repite lo ya calentado). */
  private preload(): void {
    if (!this.on || !this.synth) return;
    const programs = new Set(this.userPrograms);
    let percussion = false;
    for (const n of this.backing) {
      if (n.percussion) percussion = true;
      else programs.add(n.program);
    }
    this.synth.preload(programs, percussion);
  }

  private rebuild(): void {
    const { ctx, synth } = this;
    if (!this.on || !ctx || !synth) {
      this.scheduler = null;
      return;
    }
    this.scheduler = new BackingScheduler(this.backing, {
      play: (note, delay) => synth.playNote(ctx.currentTime + delay, note),
      stopAll: () => synth.stopAll(),
    });
  }
}
