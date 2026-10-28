/** Frecuencia (Hz) de una nota MIDI, con La4 = 440 Hz. */
export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Número MIDI con decimales (60.5 = medio semitono sobre el Do central). */
export function freqToMidiFloat(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

/** Nota MIDI entera más cercana a la frecuencia. */
export function freqToMidi(freq: number): number {
  return Math.round(freqToMidiFloat(freq));
}

/** Desviación en cents (100 = un semitono) entre una frecuencia y una nota MIDI. */
export function centsFrom(freq: number, midi: number): number {
  return 1200 * Math.log2(freq / midiToFreq(midi));
}

/** ¿La frecuencia está dentro de ±`toleranceCents` de la nota? */
export function isWithinTolerance(freq: number, midi: number, toleranceCents: number): boolean {
  return Math.abs(centsFrom(freq, midi)) <= toleranceCents;
}

/** Valor eficaz (volumen) de un bloque de muestras, de 0 a 1. */
export function rms(buf: Float32Array): number {
  if (buf.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
  return Math.sqrt(sum / buf.length);
}

export interface PitchEstimate {
  freq: number;
  /** 0 a 1: qué tan periódica es la señal. Con ruido o varias notas baja. */
  clarity: number;
}

export interface PitchOptions {
  /** Frecuencia mínima a detectar (Hz). Por defecto 60 (≈ Si1). */
  minFreq?: number;
  /** Frecuencia máxima a detectar (Hz). Por defecto 2100 (≈ Do7). */
  maxFreq?: number;
  /** Umbral absoluto de YIN. Por defecto 0.15. */
  threshold?: number;
}

/** Máximo de muestras que se integran: acota el coste de CPU. */
const MAX_WINDOW = 2048;
/** Por debajo de esto la estimación no es fiable (bloque demasiado corto). */
const MIN_WINDOW = 1024;

/**
 * Detecta la frecuencia fundamental con el algoritmo YIN (de Cheveigné y Kawahara, 2002):
 * diferencia cuadrática, normalización por media acumulada, umbral absoluto e
 * interpolación parabólica. Resiste mejor que la autocorrelación simple los errores de
 * octava causados por los armónicos fuertes del piano.
 *
 * `buf` debe tener al menos `sampleRate / minFreq + 1024` muestras (con 4096 basta a 44,1 y 48 kHz).
 * Devuelve null si no hay señal o el bloque es demasiado corto.
 */
export function detectPitch(
  buf: Float32Array,
  sampleRate: number,
  options: PitchOptions = {},
): PitchEstimate | null {
  const minFreq = options.minFreq ?? 60;
  const maxFreq = options.maxFreq ?? 2100;
  const threshold = options.threshold ?? 0.15;

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(Math.floor(sampleRate / minFreq), buf.length >> 1);
  const win = Math.min(buf.length - tauMax, MAX_WINDOW);
  if (tauMax <= tauMin + 2 || win < MIN_WINDOW) return null;

  // Diferencia cuadrática normalizada por la media acumulada (CMNDF).
  const cmnd = new Float32Array(tauMax);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau < tauMax; tau++) {
    let d = 0;
    for (let j = 0; j < win; j++) {
      const diff = buf[j]! - buf[j + tau]!;
      d += diff * diff;
    }
    running += d;
    cmnd[tau] = running === 0 ? 1 : (d * tau) / running;
  }

  let tau = -1;
  for (let t = tauMin; t < tauMax; t++) {
    if (cmnd[t]! < threshold) {
      while (t + 1 < tauMax && cmnd[t + 1]! < cmnd[t]!) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) {
    // Ningún mínimo claro: se toma el mejor candidato; el llamador lo descartará por su baja claridad.
    let best = tauMin;
    for (let t = tauMin; t < tauMax; t++) if (cmnd[t]! < cmnd[best]!) best = t;
    tau = best;
  }

  let better = tau;
  if (tau > 1 && tau < tauMax - 1) {
    const a = cmnd[tau - 1]!;
    const b = cmnd[tau]!;
    const c = cmnd[tau + 1]!;
    const denom = a - 2 * b + c;
    if (denom !== 0) better = tau + (a - c) / (2 * denom);
  }
  if (!Number.isFinite(better) || better <= 0) return null;

  return { freq: sampleRate / better, clarity: Math.min(1, Math.max(0, 1 - cmnd[tau]!)) };
}
