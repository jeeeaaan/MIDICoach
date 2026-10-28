import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NoteTracker } from "../src/audio/noteTracker";
import type { TrackerFrame } from "../src/audio/noteTracker";
import { MicInput } from "../src/audio/micInput";
import type { MicEnv, MicState } from "../src/audio/micInput";
import { midiToFreq } from "../src/audio/pitch";
import { PracticeEngine } from "../src/motor/index";
import type { NoteEvent } from "../src/motor/index";

const FRAME = 40;

const note = (midi: number, rms = 0.2, clarity = 0.95, cents = 0): TrackerFrame => ({
  rms,
  pitch: { freq: midiToFreq(midi) * 2 ** (cents / 1200), clarity },
});
const silence: TrackerFrame = { rms: 0.001, pitch: null };

/** Alimenta el tracker con fotogramas cada 40 ms y devuelve las notas emitidas. */
function run(frames: TrackerFrame[], tracker = new NoteTracker()): number[] {
  const out: number[] = [];
  frames.forEach((f, i) => {
    const r = tracker.process(f, i * FRAME);
    if (r.emit !== null) out.push(r.emit);
  });
  return out;
}
const repeat = (f: TrackerFrame, n: number): TrackerFrame[] => Array.from({ length: n }, () => f);

describe("NoteTracker", () => {
  it("confirma una nota estable una sola vez", () => {
    assert.deepEqual(run([...repeat(silence, 3), ...repeat(note(60), 10)]), [60]);
  });

  it("ignora el silencio y los volúmenes bajo el umbral", () => {
    assert.deepEqual(run(repeat(silence, 20)), []);
    assert.deepEqual(run(repeat(note(60, 0.005), 20)), []);
  });

  it("ignora detecciones de baja confianza", () => {
    assert.deepEqual(run(repeat(note(60, 0.2, 0.5), 20)), []);
  });

  it("ignora notas desafinadas más allá de la tolerancia y acepta las que están dentro", () => {
    assert.deepEqual(run(repeat(note(60, 0.2, 0.95, 45), 10)), []);
    assert.deepEqual(run(repeat(note(60, 0.2, 0.95, 20), 10)), [60]);
    const strict = new NoteTracker({ toleranceCents: 10 });
    assert.deepEqual(run(repeat(note(60, 0.2, 0.95, 20), 10), strict), []);
  });

  it("ignora estimaciones inestables que cambian de nota en cada fotograma", () => {
    const frames = Array.from({ length: 20 }, (_, i) => note(60 + (i % 3)));
    assert.deepEqual(run([...repeat(silence, 2), ...frames]), []);
  });

  it("una nota sostenida que solo decae no se cuenta varias veces", () => {
    const frames = Array.from({ length: 60 }, (_, i) => note(60, 0.3 * 0.97 ** i));
    assert.deepEqual(run([silence, ...frames]), [60]);
  });

  it("los armónicos o errores de octava durante el sostenido no generan notas nuevas", () => {
    const frames = [
      ...repeat(note(60, 0.3), 5),
      ...repeat(note(72, 0.25), 5),
      ...repeat(note(67, 0.2), 5),
    ];
    assert.deepEqual(run([silence, ...frames]), [60]);
  });

  it("volver a pulsar la misma tecla (nuevo ataque) sí cuenta", () => {
    const first = Array.from({ length: 20 }, (_, i) => note(60, 0.3 * 0.9 ** i));
    const second = repeat(note(60, 0.3), 6);
    assert.deepEqual(run([silence, ...first, ...second]), [60, 60]);
  });

  it("una nota nueva tras silencio cuenta aunque cambie la altura", () => {
    assert.deepEqual(
      run([...repeat(note(60), 6), ...repeat(silence, 3), ...repeat(note(64), 6)]),
      [60, 64],
    );
  });

  it("no emite si la nota no llega a estabilizarse dentro de la ventana del ataque", () => {
    const tracker = new NoteTracker({ armWindowMs: 100 });
    const frames = [note(60, 0.3, 0.3), note(60, 0.3, 0.3), note(60, 0.3, 0.3), ...repeat(note(60, 0.3), 5)];
    assert.deepEqual(run(frames, tracker), []);
  });
});

describe("micrófono + motor de práctica", () => {
  const n = (midi: number, time: number): NoteEvent => ({ midi, time, duration: 0.5 });

  function setup(notes: NoteEvent[]) {
    let t = 0;
    const engine = new PracticeEngine(notes, { now: () => t });
    engine.start();
    t += 10_000;
    engine.update();
    const feed = (frames: TrackerFrame[]) => {
      const tracker = new NoteTracker();
      frames.forEach((f, i) => {
        const r = tracker.process(f, i * FRAME);
        if (r.emit !== null) engine.noteOn(r.emit, t);
      });
    };
    return { engine, feed };
  }

  it("una nota correcta avanza la canción", () => {
    const { engine, feed } = setup([n(60, 1), n(62, 2)]);
    feed([silence, ...repeat(note(60), 6)]);
    assert.equal(engine.getSnapshot().completedNotes, 1);
    assert.equal(engine.getSnapshot().errors, 0);
  });

  it("una nota incorrecta no avanza y cuenta como error", () => {
    const { engine, feed } = setup([n(60, 1), n(62, 2)]);
    feed([silence, ...repeat(note(64), 6)]);
    const snap = engine.getSnapshot();
    assert.equal(snap.completedNotes, 0);
    assert.equal(snap.errors, 1);
    assert.deepEqual(snap.pendingMidis, [60]);
  });

  it("el silencio y el ruido no avanzan ni cuentan errores", () => {
    const { engine, feed } = setup([n(60, 1)]);
    feed([...repeat(silence, 20), ...repeat(note(60, 0.2, 0.3), 20)]);
    const snap = engine.getSnapshot();
    assert.equal(snap.completedNotes, 0);
    assert.equal(snap.errors, 0);
  });

  it("una nota sostenida no avanza a la siguiente nota", () => {
    const { engine, feed } = setup([n(60, 1), n(60, 2), n(62, 3)]);
    feed([silence, ...Array.from({ length: 50 }, (_, i) => note(60, 0.3 * 0.97 ** i))]);
    const snap = engine.getSnapshot();
    assert.equal(snap.completedNotes, 1);
    assert.equal(snap.errors, 0);
  });
});

// ---- Liberación de recursos con un entorno simulado ----

function fakeEnv() {
  const log = { trackStops: 0, ctxClosed: false, sourceDisconnected: false, ctxCreated: 0 };
  const track = { stop: () => log.trackStops++, onended: null as null | (() => void) };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const ctx = {
    sampleRate: 48000,
    state: "running",
    resume: async () => undefined,
    close: async () => {
      log.ctxClosed = true;
      ctx.state = "closed";
    },
    createAnalyser: () => ({
      fftSize: 2048,
      smoothingTimeConstant: 0,
      connect: () => undefined,
      getFloatTimeDomainData: () => undefined,
    }),
    createMediaStreamSource: () => ({
      connect: () => undefined,
      disconnect: () => (log.sourceDisconnected = true),
    }),
  };
  const env = (getUserMedia: MicEnv["getUserMedia"]): MicEnv => ({
    getUserMedia,
    createContext: () => {
      log.ctxCreated++;
      return ctx as unknown as AudioContext;
    },
  });
  return { log, track, stream, env };
}

describe("MicInput: recursos y errores", () => {
  const handlers = () => {
    const states: MicState[] = [];
    const messages: string[] = [];
    return {
      states,
      messages,
      h: {
        onNote: () => undefined,
        onDetected: () => undefined,
        onState: (s: MicState, m: string) => {
          states.push(s);
          messages.push(m);
        },
      },
    };
  };

  it("stop() libera pistas, nodos y contexto de audio", async () => {
    const f = fakeEnv();
    const { h, states } = handlers();
    const mic = new MicInput(h, {}, f.env(async () => f.stream));
    await mic.start();
    assert.equal(mic.active, true);
    mic.stop();
    assert.equal(mic.active, false);
    assert.equal(f.log.trackStops, 1);
    assert.equal(f.log.sourceDisconnected, true);
    assert.equal(f.log.ctxClosed, true);
    assert.deepEqual(states, ["starting", "listening", "off"]);
    mic.stop(); // idempotente
    assert.equal(f.log.trackStops, 1);
  });

  it("permiso denegado: informa con un mensaje claro y no deja recursos abiertos", async () => {
    const f = fakeEnv();
    const { h, states, messages } = handlers();
    const mic = new MicInput(
      h,
      {},
      f.env(async () => {
        throw new DOMException("denied", "NotAllowedError");
      }),
    );
    await mic.start();
    assert.deepEqual(states, ["starting", "error"]);
    assert.match(messages[1]!, /permiso/);
    assert.equal(mic.active, false);
    assert.equal(f.log.ctxCreated, 0);
  });

  it("sin dispositivo: mensaje específico", async () => {
    const f = fakeEnv();
    const { h, messages } = handlers();
    const mic = new MicInput(
      h,
      {},
      f.env(async () => {
        throw new DOMException("none", "NotFoundError");
      }),
    );
    await mic.start();
    assert.match(messages.at(-1)!, /micrófono/i);
    assert.match(messages.at(-1)!, /No se encontró/);
  });

  it("si se cancela mientras espera el permiso, libera el micrófono al concederse", async () => {
    const f = fakeEnv();
    const { h, states } = handlers();
    let grant!: (s: MediaStream) => void;
    const mic = new MicInput(h, {}, f.env(() => new Promise<MediaStream>((r) => (grant = r))));
    const started = mic.start();
    mic.stop();
    grant(f.stream);
    await started;
    assert.equal(f.log.trackStops, 1);
    assert.equal(f.log.ctxCreated, 0);
    assert.equal(mic.active, false);
    assert.equal(states.at(-1), "off");
  });

  it("si el micrófono se desconecta, se libera y se avisa", async () => {
    const f = fakeEnv();
    const { h, states } = handlers();
    const mic = new MicInput(h, {}, f.env(async () => f.stream));
    await mic.start();
    f.track.onended?.();
    assert.equal(mic.active, false);
    assert.equal(f.log.ctxClosed, true);
    assert.equal(states.at(-1), "error");
  });
});
