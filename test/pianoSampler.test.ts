import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PianoSampler, pickSample, SAMPLE_SPECS } from "../src/audio/pianoSampler";
import type { PianoState } from "../src/audio/pianoSampler";
import { isSampledPiano } from "../src/audio/synth";

const SAMPLES_DIR = join(import.meta.dirname, "..", "public", "samples", "salamander");

describe("mapa de muestras", () => {
  it("son 30 muestras cada tercera menor, de A0 (21) a C8 (108)", () => {
    assert.equal(SAMPLE_SPECS.length, 30);
    assert.equal(SAMPLE_SPECS[0]!.midi, 21);
    assert.equal(SAMPLE_SPECS.at(-1)!.midi, 108);
    for (let i = 1; i < SAMPLE_SPECS.length - 1; i++) {
      assert.equal(SAMPLE_SPECS[i]!.midi - SAMPLE_SPECS[i - 1]!.midi <= 3, true);
    }
    assert.deepEqual(
      SAMPLE_SPECS.filter((s) => ["C4", "Ds4", "Fs4", "A4"].includes(s.name)).map((s) => s.midi),
      [60, 63, 66, 69],
    );
  });

  it("cada muestra del mapa existe como archivo en public/ y no est\u00e1 vac\u00eda", () => {
    for (const s of SAMPLE_SPECS) {
      const file = join(SAMPLES_DIR, `${s.name}.mp3`);
      assert.ok(existsSync(file), `falta ${s.name}.mp3`);
      assert.ok(statSync(file).size > 5_000, `${s.name}.mp3 sospechosamente peque\u00f1o`);
    }
  });

  it("la licencia y el texto de atribuci\u00f3n viajan con las muestras", () => {
    const names = readdirSync(SAMPLES_DIR);
    assert.ok(names.includes("LICENSE-CC-BY-3.0.txt"));
    assert.ok(names.includes("README-original.txt"));
    assert.ok(names.includes("ATTRIBUTION.txt"));
  });
});

describe("pickSample", () => {
  const all = new Map(SAMPLE_SPECS.map((s) => [s.midi, s.name]));

  it("una nota con muestra propia suena sin cambiar de velocidad", () => {
    assert.deepEqual(pickSample(60, all), { sample: "C4", rate: 1 });
    assert.equal(pickSample(21, all)!.rate, 1);
    assert.equal(pickSample(108, all)!.rate, 1);
  });

  it("todas las teclas del piano usan la muestra m\u00e1s cercana con \u00b11,5 semitonos como m\u00e1ximo", () => {
    for (let m = 21; m <= 108; m++) {
      const p = pickSample(m, all)!;
      const shift = 12 * Math.log2(p.rate);
      assert.ok(Math.abs(shift) <= 1.5 + 1e-9, `nota ${m}: ${shift}`);
    }
  });

  it("sube o baja de tono en el sentido correcto", () => {
    assert.ok(pickSample(61, all)!.rate > 1); // Do#4 desde Do4
    assert.ok(pickSample(62, all)!.rate < 1); // Re4 desde Re#4
  });

  it("sin muestras disponibles devuelve null; con pocas usa la m\u00e1s cercana", () => {
    assert.equal(pickSample(60, new Map()), null);
    assert.equal(pickSample(60, new Map([[69, "A4"]]))!.sample, "A4");
  });
});

describe("programas con muestras", () => {
  it("solo los pianos (0\u20133) usan muestras", () => {
    for (const p of [0, 1, 2, 3]) assert.equal(isSampledPiano(p), true);
    for (const p of [4, 5, 8, 24, 40, 73, 127]) assert.equal(isSampledPiano(p), false);
  });
});

// ---- carga ----

const decoded = { duration: 2 } as unknown as AudioBuffer;
const fakeCtx = { decodeAudioData: async () => decoded } as unknown as BaseAudioContext;
const okResponse = { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Response;

function sampler(fetchFn: (url: string) => Promise<Response>) {
  const states: Array<[PianoState, string]> = [];
  const s = new PianoSampler(fakeCtx, { baseUrl: "/x/", fetchFn, onState: (st, m) => states.push([st, m]) });
  return { s, states };
}

describe("PianoSampler: carga", () => {
  it("descarga las 30 muestras de la carpeta indicada y queda listo", async () => {
    const urls: string[] = [];
    const { s, states } = sampler(async (u) => (urls.push(u), okResponse));
    assert.equal(s.pick(60), null, "antes de cargar no hay muestras");
    await s.load();
    assert.equal(s.state, "ready");
    assert.equal(s.loaded, 30);
    assert.equal(urls.length, 30);
    assert.ok(urls.every((u) => u.startsWith("/x/") && u.endsWith(".mp3")));
    assert.deepEqual(states.map(([st]) => st), ["loading", "ready"]);
    assert.ok(s.pick(60));
  });

  it("llamadas simult\u00e1neas o posteriores no vuelven a descargar", async () => {
    let n = 0;
    const { s } = sampler(async () => (n++, okResponse));
    await Promise.all([s.load(), s.load()]);
    await s.load();
    assert.equal(n, 30);
  });

  it("si fallan todas, informa del error y no ofrece muestras (se usa el sintetizador)", async () => {
    const { s, states } = sampler(async () => ({ ok: false, status: 404 }) as Response);
    await s.load();
    assert.equal(s.state, "error");
    assert.equal(s.pick(60), null);
    assert.match(states.at(-1)![1], /sonido b\u00e1sico/);
  });

  it("tras un error se puede reintentar y carga solo lo que falta", async () => {
    let fail = true;
    let n = 0;
    const { s } = sampler(async () => {
      n++;
      if (fail) throw new TypeError("sin red");
      return okResponse;
    });
    await s.load();
    assert.equal(s.state, "error");
    fail = false;
    await s.load();
    assert.equal(s.state, "ready");
    assert.equal(n, 60);
  });

  it("con fallos parciales queda listo con las muestras que llegaron", async () => {
    const { s, states } = sampler(async (u) => (u.endsWith("A7.mp3") ? ({ ok: false, status: 500 } as Response) : okResponse));
    await s.load();
    assert.equal(s.state, "ready");
    assert.equal(s.loaded, 29);
    assert.match(states.at(-1)![1], /faltan 1/);
    assert.ok(s.pick(105), "la nota aguda usa la muestra m\u00e1s cercana disponible");
  });

  it("un error de decodificaci\u00f3n no deja la carga colgada", async () => {
    const bad = new PianoSampler(
      { decodeAudioData: async () => { throw new Error("mp3 corrupto"); } } as unknown as BaseAudioContext,
      { baseUrl: "/x/", fetchFn: async () => okResponse },
    );
    await bad.load();
    assert.equal(bad.state, "error");
  });
});
