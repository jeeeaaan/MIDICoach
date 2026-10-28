/**
 * Piano de muestras (Salamander Grand Piano V3, Alexander Holm, CC BY 3.0:
 * https://creativecommons.org/licenses/by/3.0/). Se usan 30 muestras (una capa de
 * velocidad, una cada tercera menor: A, C, D#, F# por octava, más A0 y C8) en la versión
 * mp3 publicada por Tone.js; las demás notas se obtienen cambiando la velocidad de
 * reproducción hasta ±1,5 semitonos. Créditos y licencia: public/samples/salamander/ y
 * la sección de créditos de la ayuda.
 */

export interface SampleSpec {
  /** Nombre de archivo sin extensión: "A0", "C4", "Ds3", "Fs5"... */
  name: string;
  midi: number;
}

export const SAMPLE_SPECS: readonly SampleSpec[] = (() => {
  const out: SampleSpec[] = [{ name: "A0", midi: 21 }];
  const pitches: Array<[string, number]> = [["C", 0], ["Ds", 3], ["Fs", 6], ["A", 9]];
  for (let oct = 1; oct <= 7; oct++) {
    for (const [name, offset] of pitches) out.push({ name: `${name}${oct}`, midi: 12 * (oct + 1) + offset });
  }
  out.push({ name: "C8", midi: 108 });
  return out.sort((a, b) => a.midi - b.midi);
})();

export interface PickedSample<T> {
  sample: T;
  /** Velocidad de reproducción: 1 = tal cual; 2^(1/12) = un semitono más agudo. */
  rate: number;
}

/** Elige la muestra disponible más cercana a `midi` (a igual distancia, la grave: sube de tono). */
export function pickSample<T>(midi: number, available: ReadonlyMap<number, T>): PickedSample<T> | null {
  let best: number | null = null;
  for (const m of available.keys()) {
    if (best === null || Math.abs(m - midi) < Math.abs(best - midi) || (Math.abs(m - midi) === Math.abs(best - midi) && m < best)) {
      best = m;
    }
  }
  if (best === null) return null;
  return { sample: available.get(best)!, rate: 2 ** ((midi - best) / 12) };
}

export type PianoState = "idle" | "loading" | "ready" | "error";

export interface SamplerOptions {
  /** Carpeta (con barra final) donde están los mp3. */
  baseUrl: string;
  /** Inyectable para pruebas; por defecto `fetch`. */
  fetchFn?: (url: string) => Promise<Response>;
  onState?: (state: PianoState, message: string) => void;
}

/**
 * Descarga y decodifica las muestras con el mismo AudioContext de la síntesis.
 * `decodeAudioData` trabaja fuera del hilo principal, así que no bloquea la interfaz.
 * Mientras no esté `ready`, `pick` devuelve null y quien llama usa el sintetizador.
 */
export class PianoSampler {
  private readonly ctx: BaseAudioContext;
  private readonly opts: SamplerOptions;
  private readonly buffers = new Map<number, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private current: PianoState = "idle";

  constructor(ctx: BaseAudioContext, opts: SamplerOptions) {
    this.ctx = ctx;
    this.opts = opts;
  }

  get state(): PianoState {
    return this.current;
  }

  get loaded(): number {
    return this.buffers.size;
  }

  /** Idempotente: llamadas simultáneas comparten la misma carga; tras un error se puede reintentar. */
  load(): Promise<void> {
    if (this.current === "ready") return Promise.resolve();
    if (this.loading) return this.loading;
    this.set("loading", "Cargando sonido de piano…");
    this.loading = this.run().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  pick(midi: number): PickedSample<AudioBuffer> | null {
    return this.current === "ready" ? pickSample(midi, this.buffers) : null;
  }

  private async run(): Promise<void> {
    const fetchFn = this.opts.fetchFn ?? ((u: string) => fetch(u));
    const results = await Promise.allSettled(
      SAMPLE_SPECS.filter((s) => !this.buffers.has(s.midi)).map(async (spec) => {
        const res = await fetchFn(`${this.opts.baseUrl}${spec.name}.mp3`);
        if (!res.ok) throw new Error(`HTTP ${res.status} en ${spec.name}`);
        const data = await res.arrayBuffer();
        this.buffers.set(spec.midi, await this.ctx.decodeAudioData(data));
      }),
    );
    if (this.buffers.size === 0) {
      const first = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      const why = first?.reason instanceof Error ? ` (${first.reason.message})` : "";
      this.set("error", `No se pudo cargar el sonido de piano${why}. Se usa el sonido básico.`);
      return;
    }
    const missing = SAMPLE_SPECS.length - this.buffers.size;
    this.set(
      "ready",
      missing === 0 ? "Sonido de piano listo" : `Sonido de piano listo (faltan ${missing} muestras)`,
    );
  }

  private set(state: PianoState, message: string): void {
    this.current = state;
    this.opts.onState?.(state, message);
  }
}
