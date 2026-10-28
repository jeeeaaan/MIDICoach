import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SongAudio } from "../src/audio/songAudio";
import type { PlayableNote } from "../src/audio/backing";

// ---- AudioContext simulado: cuenta nodos y llamadas, no produce sonido ----

const stats = { contexts: 0, oscillators: 0, sources: 0, stops: 0, suspends: 0, resumes: 0, gains: 0, samples: 0, rates: [] as number[] };

function param() {
  return {
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {},
    setTargetAtTime() {},
    cancelScheduledValues() {},
    cancelAndHoldAtTime() {},
  };
}

function node(kind: string): unknown {
  const own: Record<string, unknown> = {
    connect() {},
    disconnect() {},
    start() {
      if (kind === "osc" || kind === "buf") stats.sources++;
      if (kind === "buf" && (own.buffer as { isSample?: boolean } | undefined)?.isSample) {
        stats.samples++;
        stats.rates.push((own.playbackRate as { value: number }).value);
      }
    },
    stop() {
      stats.stops++;
    },
  };
  return new Proxy(own, { get: (t, p: string) => (p in t ? t[p] : (t[p] = param())) });
}

let resumeGate: Promise<void> | null = null;

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  state: "running" | "suspended" | "closed" = "suspended";
  destination = node("dest");
  constructor() {
    stats.contexts++;
    return new Proxy(this, {
      get: (t, p: string) => {
        if (p in t) return (t as never)[p];
        if (p === "createOscillator")
          return () => {
            stats.oscillators++;
            return node("osc");
          };
        if (p === "createGain")
          return () => {
            stats.gains++;
            return node("gain");
          };
        if (p === "createBufferSource") return () => node("buf");
        if (p === "createBuffer") return (_c: number, l: number) => ({ getChannelData: () => new Float32Array(l) });
        if (typeof p === "string" && p.startsWith("create")) return () => node("other");
        return undefined;
      },
      set: (t, p: string, v: unknown) => {
        (t as unknown as Record<string, unknown>)[p] = v;
        return true;
      },
    });
  }
  async resume() {
    stats.resumes++;
    if (resumeGate) await resumeGate;
    this.state = "running";
  }
  async decodeAudioData() {
    return { isSample: true, duration: 2 };
  }
  async suspend() {
    stats.suspends++;
    this.state = "suspended";
  }
  async close() {
    this.state = "closed";
  }
}

const piano = (time: number): PlayableNote => ({
  midi: 60, time, duration: 0.5, velocity: 0.8, program: 0, percussion: false,
});
const drum: PlayableNote = { ...piano(0), midi: 36, percussion: true };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("SongAudio: ciclo de vida", () => {
  const g = globalThis as unknown as { AudioContext?: unknown };
  let original: unknown;
  beforeEach(() => {
    original = g.AudioContext;
    g.AudioContext = FakeAudioContext;
    for (const k of Object.keys(stats) as Array<keyof typeof stats>) {
      if (k === "rates") stats.rates = [];
      else stats[k] = 0;
    }
    resumeGate = null;
  });
  afterEach(() => {
    g.AudioContext = original;
  });

  it("enable() prepara el audio: contexto activo y un instrumento calentado por programa", async () => {
    const a = new SongAudio();
    a.setUserPrograms([0]);
    a.setBacking([piano(1)]);
    assert.equal(stats.oscillators, 0, "sin audio activado no se crea nada");
    await a.enable();
    assert.equal(stats.contexts, 1);
    assert.ok(stats.oscillators > 0, "el precalentamiento hizo sonar el instrumento");
    assert.equal(a.enabled, true);
  });

  it("la precarga es única: repetir la misma canción/pistas no vuelve a calentar", async () => {
    const a = new SongAudio();
    a.setUserPrograms([0]);
    a.setBacking([piano(1)]);
    await a.enable();
    const after = stats.oscillators;
    a.setUserPrograms([0]);
    a.setBacking([piano(1), piano(2)]);
    a.setBacking([piano(3)]);
    assert.equal(stats.oscillators, after);
  });

  it("un instrumento nuevo (otra familia) o la batería se calienta una sola vez", async () => {
    const a = new SongAudio();
    await a.enable();
    const base = stats.oscillators;
    a.setBacking([{ ...piano(1), program: 40 }]); // cuerdas
    const withStrings = stats.oscillators;
    assert.ok(withStrings > base);
    a.setBacking([{ ...piano(1), program: 41 }]); // mismo timbre
    assert.equal(stats.oscillators, withStrings);
    a.setBacking([drum]);
    const withDrums = stats.oscillators;
    assert.ok(withDrums > withStrings);
    a.setBacking([drum]);
    assert.equal(stats.oscillators, withDrums);
  });

  it("desactivar y volver a activar reutiliza el mismo contexto y no recalienta", async () => {
    const a = new SongAudio();
    a.setBacking([piano(1)]);
    await a.enable();
    const osc = stats.oscillators;
    a.disable();
    await a.enable();
    assert.equal(stats.contexts, 1);
    assert.equal(stats.oscillators, osc);
  });

  it("desactivar silencia, ignora notas del usuario y suspende el contexto tras el fundido", async () => {
    const a = new SongAudio();
    await a.enable();
    a.playUser(piano(0));
    const played = stats.oscillators;
    a.disable();
    assert.ok(stats.stops > 0, "las voces se detienen");
    a.playUser(piano(0));
    assert.equal(stats.oscillators, played, "con el audio apagado playUser no crea voces");
    await sleep(350);
    assert.equal(stats.suspends, 1);
  });

  it("si se reactiva antes del fundido, el contexto no se suspende", async () => {
    const a = new SongAudio();
    await a.enable();
    a.disable();
    await a.enable();
    await sleep(350);
    assert.equal(stats.suspends, 0);
    assert.equal(a.enabled, true);
  });

  it("desactivar mientras enable() espera el permiso del navegador no lo deja activo", async () => {
    let release!: () => void;
    resumeGate = new Promise<void>((r) => (release = r));
    const a = new SongAudio();
    const pending = a.enable();
    a.disable();
    release();
    await pending;
    assert.equal(a.enabled, false);
  });

  it("tick no programa nada con el audio apagado y sí cuando está encendido", async () => {
    const a = new SongAudio();
    a.setBacking([piano(1)]);
    a.tick("running", 0.95, 5);
    assert.equal(stats.oscillators, 0);
    await a.enable();
    const warm = stats.oscillators;
    a.tick("running", 0.95, 5);
    assert.ok(stats.oscillators > warm, "la nota de acompañamiento se programó");
  });
});

// ---- piano de muestras integrado ----

describe("SongAudio: piano de muestras", () => {
  const g = globalThis as unknown as { AudioContext?: unknown };
  let original: unknown;
  beforeEach(() => {
    original = g.AudioContext;
    g.AudioContext = FakeAudioContext;
    for (const k of Object.keys(stats) as Array<keyof typeof stats>) {
      if (k === "rates") stats.rates = [];
      else stats[k] = 0;
    }
    resumeGate = null;
  });
  afterEach(() => {
    g.AudioContext = original;
  });

  const okResponse = { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Response;
  const flush = () => sleep(10);

  function make(fetchFn: (u: string) => Promise<Response> = async () => okResponse) {
    const states: string[] = [];
    let fetches = 0;
    const a = new SongAudio({
      pianoBaseUrl: "/samples/",
      fetchFn: async (u) => (fetches++, fetchFn(u)),
      onPianoState: (s) => states.push(s),
    });
    return { a, states, fetches: () => fetches };
  }

  it("sin pianoBaseUrl no se descarga nada y el piano usa el sintetizador", async () => {
    const a = new SongAudio();
    await a.enable();
    a.playUser(piano(0));
    assert.equal(a.pianoState, "idle");
    assert.equal(stats.samples, 0);
  });

  it("el audio se activa sin esperar a las muestras; el piano suena sintetizado hasta que están listas", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { a, states } = make(async () => (await gate, okResponse));
    await a.enable(); // no se queda esperando la descarga
    assert.equal(a.enabled, true);
    assert.equal(a.pianoState, "loading");
    const osc = stats.oscillators;
    a.playUser(piano(0));
    assert.ok(stats.oscillators > osc, "mientras carga usa el sintetizador");
    assert.equal(stats.samples, 0);
    release();
    await flush();
    assert.equal(a.pianoState, "ready");
    assert.deepEqual(states, ["loading", "ready"]);
  });

  it("con las muestras listas, el piano usa muestras (con el cambio de tono correcto) y no osciladores", async () => {
    const { a } = make();
    await a.enable();
    await flush();
    const osc = stats.oscillators;
    a.playUser({ ...piano(0), midi: 60 }); // C4: muestra propia
    a.playUser({ ...piano(0), midi: 61 }); // C#4: un semitono más agudo que C4
    assert.equal(stats.oscillators, osc);
    assert.ok(stats.samples >= 2);
    const last2 = stats.rates.slice(-2);
    assert.equal(last2[0], 1);
    assert.ok(Math.abs(last2[1]! - 2 ** (1 / 12)) < 1e-9);
  });

  it("los demás instrumentos siguen sintetizados aunque el piano esté cargado", async () => {
    const { a } = make();
    await a.enable();
    await flush();
    const samples = stats.samples;
    const osc = stats.oscillators;
    a.playUser({ ...piano(0), program: 40 });
    assert.equal(stats.samples, samples);
    assert.ok(stats.oscillators > osc);
  });

  it("si la descarga falla, el audio sigue funcionando con el sintetizador y se avisa", async () => {
    const { a, states } = make(async () => ({ ok: false, status: 404 }) as Response);
    await a.enable();
    await flush();
    assert.equal(a.pianoState, "error");
    assert.equal(states.at(-1), "error");
    const osc = stats.oscillators;
    a.playUser(piano(0));
    assert.ok(stats.oscillators > osc);
    assert.equal(a.enabled, true);
  });

  it("desactivar y reactivar no vuelve a descargar; tras un error, reactivar reintenta", async () => {
    const ok = make();
    await ok.a.enable();
    await flush();
    const n = ok.fetches();
    ok.a.disable();
    await ok.a.enable();
    await flush();
    assert.equal(ok.fetches(), n);

    let fail = true;
    const retry = make(async () => (fail ? ({ ok: false, status: 500 } as Response) : okResponse));
    await retry.a.enable();
    await flush();
    assert.equal(retry.a.pianoState, "error");
    fail = false;
    retry.a.disable();
    await retry.a.enable();
    await flush();
    assert.equal(retry.a.pianoState, "ready");
  });

  it("desactivar detiene las voces de muestras y no deja sonar nada más", async () => {
    const { a } = make();
    await a.enable();
    await flush();
    a.playUser(piano(0));
    a.setBacking([{ ...piano(1), midi: 48 }]);
    a.tick("running", 0.95, 5); // programa la nota de acompañamiento (muestra)
    const stops = stats.stops;
    a.disable();
    assert.ok(stats.stops > stops, "stopAll detiene las voces de muestra");
    const samples = stats.samples;
    a.playUser(piano(0));
    assert.equal(stats.samples, samples, "con el audio apagado no suena nada");
  });

  it("pausar silencia las notas de muestra y al reanudar no se pierden ni repiten", async () => {
    const { a } = make();
    await a.enable();
    await flush();
    a.setBacking([{ ...piano(1), midi: 48 }, { ...piano(2), midi: 50 }]);
    a.tick("running", 0.95, 5);
    const first = stats.samples;
    const stops = stats.stops;
    a.tick("paused", 0.97, null);
    assert.ok(stats.stops > stops, "la pausa detiene lo programado");
    a.tick("running", 0.97, 5);
    assert.equal(stats.samples, first + 1, "la nota que no llegó a sonar se reprograma una sola vez");
  });
});
