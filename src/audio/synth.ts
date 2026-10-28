import type { PlayableNote } from "./backing";
import type { PianoSampler } from "./pianoSampler";

interface Partial {
  type: OscillatorType;
  /** Múltiplo de la frecuencia de la nota. */
  mult: number;
  gain: number;
  detune?: number;
}

export interface Timbre {
  partials: Partial[];
  attack: number;
  /** Segundos que tarda en caer del pico al nivel sostenido. */
  decay: number;
  /** Nivel sostenido relativo al pico (0 a 1). */
  sustain: number;
  release: number;
  /** Frecuencia de corte del filtro, como múltiplo de la frecuencia de la nota. */
  cutoff: number;
}

const PIANO: Timbre = {
  partials: [
    { type: "triangle", mult: 1, gain: 0.9 },
    { type: "sine", mult: 2, gain: 0.35 },
    { type: "sine", mult: 3, gain: 0.12 },
  ],
  attack: 0.004, decay: 1.8, sustain: 0.1, release: 0.28, cutoff: 8,
};
const MALLET: Timbre = {
  partials: [
    { type: "sine", mult: 1, gain: 1 },
    { type: "sine", mult: 3.5, gain: 0.35 },
  ],
  attack: 0.002, decay: 0.7, sustain: 0.001, release: 0.25, cutoff: 10,
};
const ORGAN: Timbre = {
  partials: [
    { type: "sine", mult: 1, gain: 0.6 },
    { type: "sine", mult: 2, gain: 0.3 },
    { type: "sine", mult: 3, gain: 0.15 },
    { type: "sine", mult: 4, gain: 0.08 },
  ],
  attack: 0.012, decay: 0.05, sustain: 0.9, release: 0.08, cutoff: 12,
};
const GUITAR: Timbre = {
  partials: [{ type: "sawtooth", mult: 1, gain: 0.5 }],
  attack: 0.003, decay: 0.6, sustain: 0.12, release: 0.2, cutoff: 4.5,
};
const BASS: Timbre = {
  partials: [
    { type: "triangle", mult: 1, gain: 0.8 },
    { type: "sawtooth", mult: 1, gain: 0.25 },
  ],
  attack: 0.006, decay: 0.35, sustain: 0.55, release: 0.12, cutoff: 4,
};
const STRINGS: Timbre = {
  partials: [
    { type: "sawtooth", mult: 1, gain: 0.35, detune: -7 },
    { type: "sawtooth", mult: 1, gain: 0.35, detune: 7 },
  ],
  attack: 0.12, decay: 0.25, sustain: 0.85, release: 0.3, cutoff: 3,
};
const CHOIR: Timbre = {
  partials: [
    { type: "sine", mult: 1, gain: 0.55 },
    { type: "sawtooth", mult: 1, gain: 0.15, detune: 5 },
  ],
  attack: 0.1, decay: 0.2, sustain: 0.85, release: 0.3, cutoff: 3,
};
const BRASS: Timbre = {
  partials: [{ type: "sawtooth", mult: 1, gain: 0.5 }],
  attack: 0.05, decay: 0.15, sustain: 0.8, release: 0.12, cutoff: 3.5,
};
const REED: Timbre = {
  partials: [{ type: "square", mult: 1, gain: 0.3 }],
  attack: 0.03, decay: 0.1, sustain: 0.85, release: 0.1, cutoff: 4,
};
const FLUTE: Timbre = {
  partials: [
    { type: "sine", mult: 1, gain: 0.7 },
    { type: "sine", mult: 2, gain: 0.1 },
  ],
  attack: 0.06, decay: 0.1, sustain: 0.9, release: 0.1, cutoff: 6,
};
const LEAD: Timbre = {
  partials: [
    { type: "square", mult: 1, gain: 0.25 },
    { type: "sawtooth", mult: 1, gain: 0.2, detune: 4 },
  ],
  attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.1, cutoff: 6,
};
const PAD: Timbre = {
  partials: [
    { type: "sawtooth", mult: 1, gain: 0.3, detune: -9 },
    { type: "sawtooth", mult: 1, gain: 0.3, detune: 9 },
    { type: "sine", mult: 1, gain: 0.3 },
  ],
  attack: 0.35, decay: 0.5, sustain: 0.8, release: 0.6, cutoff: 2.5,
};

/** Elige el timbre según la familia del instrumento General MIDI (programa 0–127). */
export function timbreFor(program: number): Timbre {
  const p = Math.min(127, Math.max(0, Math.trunc(program) || 0));
  if (p < 8) return PIANO; // pianos
  if (p < 16) return MALLET; // percusión cromática (celesta, marimba, campanas)
  if (p < 24) return ORGAN; // órganos, acordeón
  if (p < 32) return GUITAR; // guitarras
  if (p < 40) return BASS; // bajos
  if (p < 52) return STRINGS; // cuerdas solistas y conjunto de cuerdas
  if (p < 56) return CHOIR; // coros y voces sintéticas
  if (p < 64) return BRASS; // metales
  if (p < 72) return REED; // cañas
  if (p < 80) return FLUTE; // flautas
  if (p < 88) return LEAD; // sintetizador solista
  if (p < 104) return PAD; // pads y efectos
  if (p < 112) return GUITAR; // instrumentos étnicos de cuerda pulsada
  if (p < 120) return MALLET; // percusión melódica
  return LEAD;
}

export type DrumKind = "kick" | "snare" | "hatClosed" | "hatOpen" | "tom" | "crash" | "ride" | "other";

/** Clasifica una nota del canal de percusión (mapa General MIDI). */
export function drumKind(midi: number): DrumKind {
  if (midi === 35 || midi === 36) return "kick";
  if (midi >= 37 && midi <= 40) return "snare";
  if (midi === 42 || midi === 44) return "hatClosed";
  if (midi === 46) return "hatOpen";
  if ([41, 43, 45, 47, 48, 50].includes(midi)) return "tom";
  if ([49, 52, 55, 57].includes(midi)) return "crash";
  if ([51, 53, 59].includes(midi)) return "ride";
  return "other";
}

interface Voice {
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
}

const MAX_VOICES = 64;

/** Programas General MIDI que se tocan con el piano de muestras: pianos de cola, brillante, eléctrico de cola y honky-tonk. */
export function isSampledPiano(program: number): boolean {
  return program >= 0 && program <= 3;
}

/** Cola de relajación (s) al soltar una nota de piano de muestras: la amortiguación del martillo. */
const SAMPLE_RELEASE_SEC = 0.25;


/** Un identificador por timbre, para no calentar dos veces programas que suenan igual. */
const PROGRAM_KEYS = new Map<Timbre, number>();
for (let p = 127; p >= 0; p--) PROGRAM_KEYS.set(timbreFor(p), p);

/** Curva casi lineal para señales normales que se aplana suavemente en ±0.95. */
const SOFT_CLIP = (() => {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = 1.2;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = (0.95 * Math.tanh(k * x)) / Math.tanh(k);
  }
  return curve;
})();

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

type HoldableParam = AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };

/**
 * Sintetizador General MIDI sobre Web Audio, sin muestras externas (funciona sin
 * conexión). Cada familia de instrumentos tiene su propio timbre; la percusión se
 * sintetiza con ruido y osciladores. Es una aproximación: reconoces el instrumento,
 * pero no suena como un banco de sonidos real.
 *
 * Acepta cualquier BaseAudioContext, así que también funciona con OfflineAudioContext.
 */
export class GmSynth {
  private readonly ctx: BaseAudioContext;
  private readonly master: GainNode;
  private readonly voices = new Set<Voice>();
  private noise: AudioBuffer | null = null;
  /** Destino de las voces nuevas: el master, o un nodo mudo durante el precalentamiento. */
  private out: AudioNode;
  private readonly warmed = new Set<string>();
  private piano: PianoSampler | null = null;

  constructor(ctx: BaseAudioContext, volume = 0.7) {
    this.ctx = ctx;
    // El compresor evita la saturación cuando suenan muchas notas a la vez.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 20;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    // Saturador suave final: garantiza que la señal nunca pase de 0.95, aun con muchas voces.
    const limiter = ctx.createWaveShaper();
    limiter.curve = SOFT_CLIP;
    limiter.oversample = "2x";
    this.master = ctx.createGain();
    this.master.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(ctx.destination);
    this.out = this.master;
    this.setVolume(volume);
  }

  /**
   * Prepara el sintetizador antes de practicar: crea el ruido de la percusión y hace sonar,
   * en silencio, una nota de cada instrumento. Así el navegador compila los nodos y
   * reserva los recursos ahora, y no en la primera nota real (que sonaría con retraso).
   * Es idempotente: cada instrumento se calienta una sola vez.
   */
  preload(programs: Iterable<number>, percussion: boolean): void {
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    mute.connect(this.ctx.destination);
    const previous = this.out;
    this.out = mute;
    try {
      const when = this.ctx.currentTime;
      for (const program of programs) {
        const timbre = timbreFor(program);
        const key = `p${PROGRAM_KEYS.get(timbre) ?? program}`;
        if (this.warmed.has(key)) continue;
        this.warmed.add(key);
        this.playPitched(when, { midi: 60, time: 0, duration: 0.05, velocity: 0.5, program, percussion: false });
      }
      if (percussion && !this.warmed.has("drums")) {
        this.warmed.add("drums");
        for (const midi of [36, 38, 42, 46, 45, 49, 51, 37]) this.playDrum(when, midi, 0.5);
      }
    } finally {
      this.out = previous;
      setTimeout(() => mute.disconnect(), 1500);
    }
  }

  /** Piano de muestras opcional: mientras no esté listo (o si falla) suena el timbre sintetizado. */
  setPiano(sampler: PianoSampler | null): void {
    this.piano = sampler;
  }

  /** Volumen de 0 a 1 (con curva cuadrática para que el control se sienta uniforme). */
  setVolume(volume: number): void {
    const v = clamp(volume, 0, 1);
    this.master.gain.value = 0.9 * v * v;
  }

  /** Hace sonar una nota en el instante `when` (tiempo del AudioContext). */
  playNote(when: number, note: PlayableNote): void {
    const start = Math.max(when, this.ctx.currentTime);
    if (note.percussion) this.playDrum(start, note.midi, note.velocity);
    else this.playPitched(start, note);
  }

  /** Silencia todas las voces con un fundido corto para que no se oigan chasquidos. */
  stopAll(fadeSec = 0.06): void {
    const now = this.ctx.currentTime;
    for (const voice of [...this.voices]) this.fadeOut(voice, now, fadeSec);
  }

  // ---- instrumentos con altura ----

  private playSample(when: number, note: PlayableNote, buffer: AudioBuffer, rate: number): void {
    const vel = clamp(note.velocity, 0.05, 1);
    const peak = 0.5 * (0.2 + 0.8 * vel ** 1.5);
    const end = when + Math.max(note.duration, 0.05);

    const gain = this.ctx.createGain();
    const g = gain.gain;
    g.setValueAtTime(0.0001, when);
    g.linearRampToValueAtTime(peak, when + 0.003); // evita el chasquido del primer frame
    g.setValueAtTime(peak, end); // la muestra ya trae su propio decaimiento natural
    g.setTargetAtTime(0.0001, end, SAMPLE_RELEASE_SEC / 3);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(gain);
    gain.connect(this.out);
    src.start(when);
    this.register({ gain, sources: [src] }, end + SAMPLE_RELEASE_SEC + 0.05);
  }

  private playPitched(when: number, note: PlayableNote): void {
    if (isSampledPiano(note.program)) {
      const picked = this.piano?.pick(note.midi);
      if (picked) {
        this.playSample(when, note, picked.sample, picked.rate);
        return;
      }
    }
    const timbre = timbreFor(note.program);
    const freq = 440 * 2 ** ((note.midi - 69) / 12);
    const vel = clamp(note.velocity, 0.05, 1);
    const peak = 0.22 * (0.25 + 0.75 * vel);

    // La nota debe durar al menos lo que tarda su ataque.
    const end = when + Math.max(note.duration, timbre.attack + 0.02);
    const attackEnd = when + timbre.attack;
    const decayEnd = attackEnd + timbre.decay;
    const sustainLevel = Math.max(0.0002, peak * timbre.sustain);

    const gain = this.ctx.createGain();
    const g = gain.gain;
    g.setValueAtTime(0.0001, when);
    g.exponentialRampToValueAtTime(peak, attackEnd);
    if (end < decayEnd) {
      // La nota se suelta a media caída: se calcula el nivel real en ese instante.
      const level = peak * timbre.sustain ** ((end - attackEnd) / timbre.decay);
      g.exponentialRampToValueAtTime(Math.max(0.0002, level), end);
    } else {
      g.exponentialRampToValueAtTime(sustainLevel, decayEnd);
      g.setValueAtTime(sustainLevel, end);
    }
    g.setTargetAtTime(0.0001, end, timbre.release / 3);
    const stopAt = end + timbre.release + 0.05;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = clamp(freq * timbre.cutoff, 300, 14000);
    filter.Q.value = 0.7;
    filter.connect(gain);
    gain.connect(this.out);

    const sources: AudioScheduledSourceNode[] = [];
    const nyquist = this.ctx.sampleRate / 2;
    for (const p of timbre.partials) {
      const f = freq * p.mult;
      if (f > nyquist * 0.9) continue;
      const osc = this.ctx.createOscillator();
      osc.type = p.type;
      osc.frequency.value = f;
      if (p.detune) osc.detune.value = p.detune;
      const partialGain = this.ctx.createGain();
      partialGain.gain.value = p.gain;
      osc.connect(partialGain);
      partialGain.connect(filter);
      osc.start(when);
      sources.push(osc);
    }
    this.register({ gain, sources }, stopAt, filter);
  }

  // ---- percusión ----

  private playDrum(when: number, midi: number, velocity: number): void {
    const v = 0.25 + 0.75 * clamp(velocity, 0, 1);
    switch (drumKind(midi)) {
      case "kick":
        this.tone(when, 140, 45, 0.1, 0.3, 0.9 * v);
        break;
      case "snare":
        this.noiseHit(when, 0.2, "highpass", 1500, 0.5 * v);
        this.tone(when, 190, 150, 0.08, 0.14, 0.35 * v, "triangle");
        break;
      case "hatClosed":
        this.noiseHit(when, 0.05, "highpass", 7500, 0.25 * v);
        break;
      case "hatOpen":
        this.noiseHit(when, 0.28, "highpass", 7000, 0.22 * v);
        break;
      case "tom": {
        const f = 80 + (midi - 41) * 14;
        this.tone(when, f * 1.4, f, 0.12, 0.35, 0.7 * v);
        break;
      }
      case "crash":
        this.noiseHit(when, 0.9, "highpass", 5000, 0.2 * v);
        break;
      case "ride":
        this.noiseHit(when, 0.45, "highpass", 6000, 0.16 * v);
        break;
      default:
        this.noiseHit(when, 0.08, "bandpass", 2000, 0.3 * v);
    }
  }

  private tone(
    when: number,
    f0: number,
    f1: number,
    sweepSec: number,
    durSec: number,
    peak: number,
    type: OscillatorType = "sine",
  ): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, when);
    osc.frequency.exponentialRampToValueAtTime(f1, when + sweepSec);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + durSec);
    osc.connect(gain);
    gain.connect(this.out);
    osc.start(when);
    this.register({ gain, sources: [osc] }, when + durSec + 0.05);
  }

  private noiseHit(
    when: number,
    durSec: number,
    filterType: BiquadFilterType,
    freq: number,
    peak: number,
  ): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + durSec);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.out);
    src.start(when, Math.random() * 0.05);
    this.register({ gain, sources: [src] }, when + durSec + 0.05, filter);
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noise) {
      const length = Math.floor(this.ctx.sampleRate * 1.2);
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    return this.noise;
  }

  // ---- gestión de voces ----

  private register(voice: Voice, stopAt: number, extra?: AudioNode): void {
    if (voice.sources.length === 0) {
      voice.gain.disconnect();
      extra?.disconnect();
      return;
    }
    while (this.voices.size >= MAX_VOICES) {
      const oldest = this.voices.values().next().value;
      if (!oldest) break;
      this.fadeOut(oldest, this.ctx.currentTime, 0.03);
    }
    this.voices.add(voice);
    for (const s of voice.sources) s.stop(stopAt);
    const last = voice.sources[voice.sources.length - 1]!;
    last.onended = () => {
      for (const s of voice.sources) s.disconnect();
      extra?.disconnect();
      voice.gain.disconnect();
      this.voices.delete(voice);
    };
  }

  private fadeOut(voice: Voice, now: number, fadeSec: number): void {
    const param = voice.gain.gain as HoldableParam;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else param.cancelScheduledValues(now);
    param.setTargetAtTime(0.0001, now, fadeSec / 3);
    for (const s of voice.sources) {
      try {
        s.stop(now + fadeSec + 0.05);
      } catch {
        /* ya estaba detenida */
      }
    }
    this.voices.delete(voice);
    const last = voice.sources[voice.sources.length - 1];
    if (last) {
      last.onended = () => {
        for (const s of voice.sources) s.disconnect();
        voice.gain.disconnect();
      };
    }
  }
}
