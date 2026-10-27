import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptNotesToRange, groupNotes, PracticeEngine } from "../src/motor/index";
import type { KeyRange, NoteEvent } from "../src/motor/index";
import { KEYBOARD_PRESETS, presetForKeys } from "../src/keyboardRange";

const n = (midi: number, time: number, track = 0): NoteEvent => ({ midi, time, duration: 0.5, track });
const K61: KeyRange = { lo: 36, hi: 96 };
const K25: KeyRange = { lo: 48, hi: 72 };

describe("adaptNotesToRange", () => {
  it("no toca nada cuando todas las notas caben", () => {
    const input = [n(60, 0), n(64, 0), n(96, 1), n(36, 2)];
    const { notes, report } = adaptNotesToRange(input, K61);
    assert.deepEqual(notes, input);
    assert.equal(report.adaptedNotes, 0);
    assert.equal(report.omittedNotes, 0);
    assert.equal(report.maxOctaves, 0);
  });

  it("transpone la parte ENTERA (no solo la nota fuera de rango) cuando así cabe", () => {
    // Melodía Do2 Mi2 Sol2 con el teclado Do3–Do5: toda la parte sube una octava.
    const part = [n(36, 0), n(40, 1), n(43, 2)];
    const { notes, omitted, report } = adaptNotesToRange(part, K25);
    assert.deepEqual(notes.map((x) => x.midi), [48, 52, 55]);
    assert.equal(omitted.length, 0);
    assert.equal(report.transposedParts, 1);
  });

  it("conserva los intervalos de una parte al transponerla", () => {
    // Parte grave: Do1 Mi1 Sol1 y Do2 (todas bajo el rango del 61 teclas, Do2–Do7)
    const part = [n(24, 0), n(28, 0), n(31, 0), n(36 - 12, 1)];
    const { notes, report } = adaptNotesToRange(part, K61);
    assert.deepEqual(notes.map((x) => x.midi), [36, 40, 43, 36]);
    assert.equal(report.transposedParts, 1);
    assert.equal(report.maxOctaves, 1);
    assert.equal(report.omittedNotes, 0);
    assert.equal(notes[0]!.originalMidi, 24);
  });

  it("si la parte no cabe en ningún desplazamiento, omite las notas imposibles y no toca las demás", () => {
    // Abarca 4 octavas (Do2 a Do6) en un teclado de 25 teclas (Do3–Do5)
    const part = [n(36, 0), n(60, 1), n(67, 2), n(72, 3), n(84, 4)];
    const { notes, omitted, report } = adaptNotesToRange(part, K25);
    assert.deepEqual(notes.map((x) => x.midi), [60, 67, 72]);
    assert.ok(notes.every((x) => x.originalMidi === undefined));
    assert.deepEqual(omitted.map((x) => x.midi), [36, 84]);
    assert.equal(report.omittedNotes, 2);
    assert.equal(report.partsWithOmissions, 1);
    assert.equal(report.transposedParts, 0);
  });

  it("cada mano (pista) se adapta por separado sin deformar la otra", () => {
    const right = [n(72, 0, 0), n(76, 1, 0), n(79, 2, 0)]; // Do5 Mi5 Sol5
    const left = [n(36, 0, 1), n(43, 1, 1), n(48, 2, 1)]; // Do2 Sol2 Do3
    const { notes } = adaptNotesToRange([...right, ...left], K25); // Do3–Do5
    const r = notes.filter((x) => x.track === 0).map((x) => x.midi);
    const l = notes.filter((x) => x.track === 1).map((x) => x.midi);
    assert.deepEqual(r.map((m) => m - r[0]!), [0, 4, 7]); // intervalos intactos
    assert.deepEqual(l.map((m) => m - l[0]!), [0, 7, 12]);
    for (const m of [...r, ...l]) assert.ok(m >= K25.lo && m <= K25.hi);
  });

  it("acordes y notas sostenidas conservan tiempo y duración", () => {
    const chord = [
      { midi: 84, time: 1, duration: 3, track: 0 },
      { midi: 88, time: 1, duration: 3, track: 0 },
      { midi: 91, time: 1, duration: 3, track: 0 },
    ];
    const { notes } = adaptNotesToRange(chord, K25);
    assert.deepEqual(notes.map((x) => x.midi), [60, 64, 67]);
    for (const x of notes) {
      assert.equal(x.time, 1);
      assert.equal(x.duration, 3);
    }
    assert.equal(groupNotes(notes).length, 1);
  });

  it("no modifica el arreglo de entrada", () => {
    const input = [n(100, 2), n(20, 0), n(60, 1)];
    const snapshot = structuredClone(input);
    adaptNotesToRange(input, K61);
    assert.deepEqual(input, snapshot);
  });

  it("rechaza rangos demasiado cortos para contener las 12 notas", () => {
    assert.throws(() => adaptNotesToRange([n(60, 0)], { lo: 60, hi: 66 }), RangeError);
    assert.throws(() => adaptNotesToRange([n(60, 0)], { lo: 72, hi: 60 }), RangeError);
    assert.doesNotThrow(() => adaptNotesToRange([n(60, 0)], { lo: 60, hi: 71 }));
  });

  it("propiedad: todo lo tocable cae en el rango, conserva nombre y tiempo, y nada se pierde", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (const preset of KEYBOARD_PRESETS) {
      const input: NoteEvent[] = [];
      for (let g = 0; g < 200; g++) {
        const size = 1 + Math.floor(rnd() * 5);
        for (let i = 0; i < size; i++) input.push(n(Math.floor(rnd() * 128), g * 0.5, i % 2));
      }
      const { notes, omitted } = adaptNotesToRange(input, preset.range);
      assert.equal(notes.length + omitted.length, input.length);
      for (const note of notes) {
        assert.ok(note.midi >= preset.range.lo && note.midi <= preset.range.hi);
        const original = note.originalMidi ?? note.midi;
        assert.equal(note.midi % 12, original % 12);
      }
    }
  });
});

describe("presets de teclado", () => {
  it("cada preset tiene exactamente el número de teclas indicado", () => {
    for (const p of KEYBOARD_PRESETS) assert.equal(p.range.hi - p.range.lo + 1, p.keys);
    assert.deepEqual(presetForKeys(61)?.range, K61);
  });
});

describe("adaptación + motor", () => {
  it("se puede completar una canción con notas fuera de rango tocando solo teclas del piano", () => {
    let t = 0;
    const now = () => t;
    const song = [
      n(24, 1), n(48, 1), n(52, 1), // acorde grave
      n(110, 2), // nota muy aguda
      n(60, 3),
      n(21, 4), n(108, 4), // extremos del piano de 88 teclas
    ];
    const { notes } = adaptNotesToRange(song, K61);

    const engine = new PracticeEngine(notes, { now });
    engine.start();

    let steps = 0;
    while (engine.getSnapshot().state !== "finished" && steps < 20) {
      t += 10_000;
      engine.update();
      const snap = engine.getSnapshot();
      for (const midi of snap.pendingMidis) {
        assert.ok(midi >= K61.lo && midi <= K61.hi, `la nota ${midi} no existe en el teclado`);
        engine.noteOn(midi, t);
      }
      steps++;
    }
    const snap = engine.getSnapshot();
    assert.equal(snap.state, "finished");
    assert.equal(snap.errors, 0);
    assert.equal(snap.completedNotes, notes.length);
  });

  it("las notas omitidas no bloquean la práctica ni cambian el ritmo", () => {
    const song = [n(60, 1), n(30, 2), n(64, 3), n(100, 4), n(67, 5)];
    const { notes, omitted } = adaptNotesToRange(song, K25);
    assert.deepEqual(omitted.map((x) => x.time), [2, 4]);
    assert.deepEqual(notes.map((x) => x.time), [1, 3, 5]);
    let t = 0;
    const engine = new PracticeEngine(notes, { now: () => t });
    engine.start();
    for (let i = 0; i < 10 && engine.getSnapshot().state !== "finished"; i++) {
      t += 10_000;
      engine.update();
      for (const midi of engine.getSnapshot().pendingMidis) engine.noteOn(midi, t);
    }
    assert.equal(engine.getSnapshot().state, "finished");
    assert.equal(engine.getSnapshot().completedNotes, 3);
  });
});
