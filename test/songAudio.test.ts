import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SongAudio } from "../src/audio/songAudio";
import type { PlayableNote } from "../src/audio/backing";

// ---- AudioContext simulado: cuenta nodos y llamadas, no produce sonido ----

const stats = { contexts: 0, oscillators: 0, sources: 0, stops: 0, suspends: 0, resumes: 0, gains: 0 };

function param() {
  return {
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
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
    for (const k of Object.keys(stats) as Array<keyof typeof stats>) stats[k] = 0;
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
