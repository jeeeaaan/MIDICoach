import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptNotesToRange, groupNotes, PracticeEngine } from "../src/motor/index";
import type { KeyRange, NoteEvent } from "../src/motor/index";
import { KEYBOARD_PRESETS, presetForKeys } from "../src/keyboardRange";

const n = (midi: number, time: number): NoteEvent => ({ midi, time, duration: 0.5 });
const K61: KeyRange = { lo: 36, hi: 96 };
const K25: KeyRange = { lo: 48, hi: 72 };

describe("adaptNotesToRange", () => {
  it("no toca nada cuando todas las notas caben", () => {
    const input = [n(60, 0), n(64, 0), n(96, 1), n(36, 2)];
    const { notes, report } = adaptNotesToRange(input, K61);
    assert.deepEqual(notes, input);
    assert.equal(report.adaptedNotes, 0);
    assert.equal(report.adaptedGroups, 0);
    assert.equal(report.maxOctaves, 0);
  });

  it("sube por octavas una nota grave hasta la primera posición válida", () => {
    const { notes, report } = adaptNotesToRange([n(21, 0), n(60, 1)], K61); // La0 → La1 → La2
    assert.equal(notes[0]!.midi, 45); // La2
    assert.equal(notes[0]!.originalMidi, 21);
    assert.equal(notes[1]!.midi, 60);
    assert.equal(notes[1]!.originalMidi, undefined);
    assert.equal(report.adaptedNotes, 1);
    assert.equal(report.maxOctaves, 2);
  });

  it("baja una nota aguda lo mínimo necesario", () => {
    const { notes } = adaptNotesToRange([n(108, 0)], K61); // Do8 → Do7 (96)
    assert.equal(notes[0]!.midi, 96);
    const { notes: b } = adaptNotesToRange([n(97, 0)], K61); // Do#7 → Do#6
    assert.equal(b[0]!.midi, 85);
  });

  it("mueve el acorde ENTERO para conservar sus intervalos", () => {
    // Do mayor con la fundamental fuera del rango: Do1 Mi3 Sol3
    const chord = [n(24, 5), n(52, 5), n(55, 5)];
    const { notes, report } = adaptNotesToRange(chord, K61);
    const mids = notes.map((x) => x.midi);
    assert.deepEqual(mids, [36, 64, 67]); // +1 octava a todo el acorde
    assert.deepEqual(
      [mids[1]! - mids[0]!, mids[2]! - mids[0]!],
      [28, 31], // mismos intervalos que el original
    );
    assert.equal(report.adaptedGroups, 1);
    assert.equal(report.foldedGroups, 0);
    // siguen sonando como un solo grupo
    assert.equal(groupNotes(notes).length, 1);
  });

  it("si el acorde no cabe entero, pliega nota por nota y conserva los nombres", () => {
    // Abarca 4 octavas (Do2 a Do6) en un teclado de 25 teclas (Do3–Do5)
    const chord = [n(36, 0), n(60, 0), n(67, 0), n(84, 0)];
    const { notes, report } = adaptNotesToRange(chord, K25);
    for (const note of notes) {
      assert.ok(note.midi >= K25.lo && note.midi <= K25.hi);
    }
    assert.deepEqual(
      notes.map((x) => x.midi % 12),
      chord.map((x) => x.midi % 12),
    );
    assert.equal(notes[1]!.midi, 60); // la nota que ya estaba en rango no se movió
    assert.equal(notes[2]!.midi, 67);
    assert.equal(report.foldedGroups, 1);
  });

  it("no modifica los grupos que ya estaban dentro del rango", () => {
    const input = [n(40, 0), n(44, 0), n(20, 1), n(60, 2), n(64, 2)];
    const { notes } = adaptNotesToRange(input, K61);
    assert.deepEqual(notes[0], input[0]);
    assert.deepEqual(notes[1], input[1]);
    assert.deepEqual(notes[3], input[3]);
    assert.deepEqual(notes[4], input[4]);
    assert.notEqual(notes[2]!.midi, 20);
  });

  it("conserva el orden y no modifica el arreglo de entrada", () => {
    const input = [n(100, 2), n(20, 0), n(60, 1)];
    const snapshot = structuredClone(input);
    const { notes } = adaptNotesToRange(input, K61);
    assert.deepEqual(input, snapshot);
    assert.deepEqual(
      notes.map((x) => x.time),
      [2, 0, 1],
    );
  });

  it("rechaza rangos demasiado cortos para contener las 12 notas", () => {
    assert.throws(() => adaptNotesToRange([n(60, 0)], { lo: 60, hi: 66 }), RangeError);
    assert.throws(() => adaptNotesToRange([n(60, 0)], { lo: 72, hi: 60 }), RangeError);
    assert.doesNotThrow(() => adaptNotesToRange([n(60, 0)], { lo: 60, hi: 71 }));
  });

  it("propiedad: con cualquier teclado de los presets todo queda dentro, con el mismo nombre de nota", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (const preset of KEYBOARD_PRESETS) {
      const input: NoteEvent[] = [];
      for (let g = 0; g < 200; g++) {
        const size = 1 + Math.floor(rnd() * 5);
        for (let i = 0; i < size; i++) input.push(n(Math.floor(rnd() * 128), g * 0.5));
      }
      const { notes } = adaptNotesToRange(input, preset.range);
      notes.forEach((note, i) => {
        const original = input[i]!;
        assert.ok(note.midi >= preset.range.lo && note.midi <= preset.range.hi);
        assert.equal(note.midi % 12, original.midi % 12);
        assert.equal(note.time, original.time);
        const inRange = original.midi >= preset.range.lo && original.midi <= preset.range.hi;
        if (!inRange) assert.equal(note.originalMidi, original.midi);
      });
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
    assert.equal(snap.completedNotes, song.length);
  });
});
