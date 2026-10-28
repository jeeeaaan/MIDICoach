import { NoteTracker } from "./noteTracker";
import type { TrackerOptions } from "./noteTracker";
import { detectPitch, rms } from "./pitch";

export type MicState = "off" | "starting" | "listening" | "error";

export interface MicHandlers {
  /** Una pulsación confirmada (número MIDI). */
  onNote(midi: number): void;
  onState(state: MicState, message: string): void;
  /** Nota que suena ahora (solo para mostrar), o null. */
  onDetected(midi: number | null): void;
}

/** Dependencias del navegador, inyectables para pruebas. */
export interface MicEnv {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createContext(): AudioContext;
}

const browserEnv = (): MicEnv => ({
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  createContext: () => new AudioContext({ latencyHint: "interactive" }),
});

/** Cada cuántos ms se analiza el audio (≈ 25 veces por segundo). */
const FRAME_MS = 40;

/** Errores de getUserMedia traducidos a mensajes comprensibles. */
export function describeMicError(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "No se obtuvo permiso para usar el micrófono. Permítelo en el navegador para usar este modo.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No se encontró ningún micrófono. Conecta uno y vuelve a intentarlo.";
    case "NotReadableError":
    case "AbortError":
      return "No se pudo abrir el micrófono: puede que otro programa lo esté usando.";
    default:
      return "No se pudo iniciar el micrófono.";
  }
}

/**
 * Captura el micrófono, estima la nota con YIN y avisa de cada pulsación.
 * El audio nunca se conecta a la salida (no hay eco) y `stop()` libera pistas y contexto.
 */
export class MicInput {
  private readonly handlers: MicHandlers;
  private readonly env: MicEnv | null;
  private readonly tracker: NoteTracker;
  private token = 0;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDetected: number | null = null;
  private starting = false;

  constructor(handlers: MicHandlers, options: Partial<TrackerOptions> = {}, env?: MicEnv) {
    this.handlers = handlers;
    this.env = env ?? null;
    this.tracker = new NoteTracker(options);
  }

  static supported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof AudioContext !== "undefined"
    );
  }

  get active(): boolean {
    return this.stream !== null;
  }

  setToleranceCents(cents: number): void {
    this.tracker.options.toleranceCents = Math.min(50, Math.max(5, cents));
  }

  /** Debe llamarse desde un gesto del usuario. Pide el permiso en este momento, no antes. */
  async start(): Promise<void> {
    if (this.active) return;
    const token = ++this.token;
    this.starting = true;
    const env = this.env ?? browserEnv();
    this.handlers.onState("starting", "Micrófono: pidiendo permiso…");

    let stream: MediaStream;
    try {
      // Sin procesamiento del navegador: cancelar eco o ruido distorsiona las notas del piano.
      stream = await env.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      if (token === this.token) {
        this.starting = false;
        this.handlers.onState("error", describeMicError(err));
      }
      return;
    }
    if (token !== this.token) {
      // Se canceló mientras se esperaba el permiso.
      for (const t of stream.getTracks()) t.stop();
      return;
    }

    try {
      const ctx = env.createContext();
      this.stream = stream;
      this.ctx = ctx;
      await ctx.resume();
      if (token !== this.token) return; // stop() ya liberó todo
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      this.source = ctx.createMediaStreamSource(stream);
      this.source.connect(analyser);
      for (const t of stream.getAudioTracks()) {
        t.onended = () => {
          if (token !== this.token) return;
          this.stop();
          this.handlers.onState("error", "Se perdió la conexión con el micrófono.");
        };
      }

      const buf = new Float32Array(analyser.fftSize);
      this.tracker.reset();
      this.timer = setInterval(() => this.frame(analyser, buf, ctx.sampleRate), FRAME_MS);
      this.starting = false;
      this.handlers.onState("listening", "Micrófono: escuchando");
    } catch {
      this.release();
      if (token === this.token) {
        this.starting = false;
        this.handlers.onState("error", "No se pudo iniciar el audio del micrófono en este navegador.");
      }
    }
  }

  /** Detiene la captura y libera el micrófono. Es seguro llamarlo varias veces. */
  stop(): void {
    const wasActive = this.active || this.starting;
    this.starting = false;
    this.token++;
    this.release();
    if (wasActive) this.handlers.onState("off", "Micrófono desactivado");
  }

  private release(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.source?.disconnect();
    this.source = null;
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    this.setDetected(null);
    this.tracker.reset();
  }

  private frame(analyser: AnalyserNode, buf: Float32Array, sampleRate: number): void {
    analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
    const level = rms(buf);
    // YIN solo se calcula si hay señal suficiente: en silencio no se gasta CPU.
    const pitch = level >= this.tracker.options.minRms ? detectPitch(buf, sampleRate) : null;
    const { emit, detected } = this.tracker.process({ rms: level, pitch }, performance.now());
    this.setDetected(detected);
    if (emit !== null) this.handlers.onNote(emit);
  }

  private setDetected(midi: number | null): void {
    if (midi === this.lastDetected) return;
    this.lastDetected = midi;
    this.handlers.onDetected(midi);
  }
}
