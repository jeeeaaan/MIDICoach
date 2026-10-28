import { centsFrom, freqToMidi } from "./pitch";
import type { PitchEstimate } from "./pitch";

export interface TrackerOptions {
  /** Volumen mínimo (rms, 0 a 1) para considerar que suena algo. */
  minRms: number;
  /** Claridad mínima de YIN (0 a 1) para fiarse de la frecuencia. */
  minClarity: number;
  /** Desafinación máxima respecto a la nota más cercana, en cents (máx. útil: 50). */
  toleranceCents: number;
  /** Fotogramas consecutivos con la misma nota para darla por estable. */
  stableFrames: number;
  /** Subida de volumen entre fotogramas que indica una nueva pulsación. */
  onsetRatio: number;
  /** Tiempo tras una pulsación durante el que se acepta una nota estable (ms). */
  armWindowMs: number;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  minRms: 0.01,
  minClarity: 0.85,
  toleranceCents: 35,
  stableFrames: 3,
  onsetRatio: 1.6,
  armWindowMs: 450,
};

export interface TrackerFrame {
  rms: number;
  /** Estimación de tono, o null si no se calculó (silencio) o no hubo resultado. */
  pitch: PitchEstimate | null;
}

export interface TrackerResult {
  /** Nota MIDI confirmada en este fotograma (una sola vez por pulsación), o null. */
  emit: number | null;
  /** Nota que suena ahora según el último fotograma fiable, solo para mostrar. */
  detected: number | null;
}

/**
 * Convierte una secuencia de fotogramas de audio en pulsaciones discretas de nota.
 * No depende del navegador, así que se prueba con fotogramas simulados.
 *
 *  - Silencio, baja claridad o desafinación excesiva: el fotograma se descarta.
 *  - Una nota se confirma tras `stableFrames` fotogramas seguidos con el mismo número MIDI.
 *  - Solo se confirma una nota por pulsación: la pulsación se detecta por un ataque
 *    (venir del silencio o una subida brusca de volumen), por lo que una nota sostenida,
 *    que solo decae, no se cuenta varias veces; y repetir la misma tecla sí se cuenta.
 */
export class NoteTracker {
  readonly options: TrackerOptions;
  private lastRms = 0;
  private armedUntil = -Infinity;
  private candidate: number | null = null;
  private count = 0;

  constructor(options: Partial<TrackerOptions> = {}) {
    this.options = { ...DEFAULT_TRACKER_OPTIONS, ...options };
  }

  reset(): void {
    this.lastRms = 0;
    this.armedUntil = -Infinity;
    this.candidate = null;
    this.count = 0;
  }

  process(frame: TrackerFrame, nowMs: number): TrackerResult {
    const o = this.options;
    const loud = frame.rms >= o.minRms;
    const onset = loud && (this.lastRms < o.minRms || frame.rms > this.lastRms * o.onsetRatio);
    this.lastRms = frame.rms;

    if (!loud) {
      this.candidate = null;
      this.count = 0;
      return { emit: null, detected: null };
    }
    if (onset) {
      this.armedUntil = nowMs + o.armWindowMs;
      this.candidate = null;
      this.count = 0;
    }

    const p = frame.pitch;
    if (!p || !(p.freq > 0) || p.clarity < o.minClarity) {
      this.candidate = null;
      this.count = 0;
      return { emit: null, detected: null };
    }
    const midi = freqToMidi(p.freq);
    if (Math.abs(centsFrom(p.freq, midi)) > o.toleranceCents) {
      this.candidate = null;
      this.count = 0;
      return { emit: null, detected: null };
    }

    if (this.candidate === midi) this.count++;
    else {
      this.candidate = midi;
      this.count = 1;
    }
    if (nowMs <= this.armedUntil && this.count >= o.stableFrames) {
      this.armedUntil = -Infinity;
      return { emit: midi, detected: midi };
    }
    return { emit: null, detected: midi };
  }
}
