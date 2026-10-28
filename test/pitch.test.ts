import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  centsFrom,
  detectPitch,
  freqToMidi,
  isWithinTolerance,
  midiToFreq,
  rms,
} from "../src/audio/pitch";

const SR = 48000;
const N = 4096;

/** Tono tipo piano: fundamental más armónicos. */
function tone(freq: number, harmonics = [1, 0.5, 0.3, 0.15], amp = 0.3, sr = SR): Float32Array {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let v = 0;
    harmonics.forEach((h, k) => (v += h * Math.sin((2 * Math.PI * freq * (k + 1) * i) / sr)));
    out[i] = (amp * v) / harmonics.reduce((a, b) => a + b, 0);
  }
  return out;
}

describe("conversión frecuencia ↔ nota", () => {
  it("La4 = 440 Hz = MIDI 69 y Do central = 60", () => {
    assert.equal(freqToMidi(440), 69);
    assert.equal(freqToMidi(261.6256), 60);
    assert.ok(Math.abs(midiToFreq(60) - 261.6256) < 0.001);
  });

  it("extremos del piano", () => {
    assert.equal(freqToMidi(27.5), 21);
    assert.equal(freqToMidi(4186.01), 108);
  });

  it("ida y vuelta para todas las notas del piano", () => {
    for (let m = 21; m <= 108; m++) assert.equal(freqToMidi(midiToFreq(m)), m);
  });
});

describe("tolerancia en cents", () => {
  it("un semitono son 100 cents y una octava 1200", () => {
    assert.ok(Math.abs(centsFrom(midiToFreq(61), 60) - 100) < 1e-6);
    assert.ok(Math.abs(centsFrom(440, 57) - 1200) < 1e-6);
  });

  it("acepta desafinaciones dentro de la tolerancia y rechaza las mayores", () => {
    const f = (cents: number) => 440 * 2 ** (cents / 1200);
    assert.ok(isWithinTolerance(f(20), 69, 35));
    assert.ok(isWithinTolerance(f(-20), 69, 35));
    assert.ok(!isWithinTolerance(f(45), 69, 35));
    assert.ok(isWithinTolerance(f(45), 69, 50));
  });
});

describe("detectPitch (YIN)", () => {
  it("detecta notas de todo el rango soportado con error menor a 5 cents", () => {
    for (const midi of [36, 40, 48, 60, 69, 72, 84, 96]) {
      const f = midiToFreq(midi);
      const est = detectPitch(tone(f), SR);
      assert.ok(est, `sin resultado para ${midi}`);
      assert.equal(freqToMidi(est.freq), midi);
      assert.ok(Math.abs(centsFrom(est.freq, midi)) < 5, `nota ${midi}: ${centsFrom(est.freq, midi)}`);
      assert.ok(est.clarity > 0.9);
    }
  });

  it("funciona a 44,1 kHz", () => {
    const est = detectPitch(tone(midiToFreq(57), [1, 0.5], 0.3, 44100), 44100);
    assert.equal(freqToMidi(est!.freq), 57);
  });

  it("no confunde con la octava cuando el segundo armónico es más fuerte", () => {
    const est = detectPitch(tone(midiToFreq(60), [0.6, 1, 0.4]), SR);
    assert.equal(freqToMidi(est!.freq), 60);
  });

  it("refleja una nota desafinada (+30 cents)", () => {
    const est = detectPitch(tone(440 * 2 ** (30 / 1200)), SR)!;
    assert.ok(Math.abs(centsFrom(est.freq, 69) - 30) < 5);
  });

  it("devuelve null con silencio absoluto o con un bloque demasiado corto", () => {
    assert.equal(detectPitch(new Float32Array(N), SR)?.clarity ?? 0, 0);
    assert.equal(detectPitch(new Float32Array(100), SR), null);
  });

  it("el ruido blanco tiene baja claridad", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const noise = new Float32Array(N).map(() => (rnd() * 2 - 1) * 0.3);
    const est = detectPitch(noise, SR);
    assert.ok(!est || est.clarity < 0.85, `claridad ${est?.clarity}`);
  });

  it("rms mide el volumen", () => {
    assert.equal(rms(new Float32Array(10)), 0);
    assert.ok(Math.abs(rms(tone(440, [1], 0.5)) - 0.5 / Math.SQRT2) < 0.01);
  });
});
