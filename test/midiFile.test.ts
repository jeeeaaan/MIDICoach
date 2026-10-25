import { describe, it } from "node:test";
import assert from "node:assert/strict";
import pkg from "@tonejs/midi";
import { MidiParseError, parseMidi } from "../src/midiFile";
import { computeRange, layoutKeys } from "../src/keyboardLayout";
import { noteName } from "../src/noteNames";

const { Midi } = pkg as unknown as typeof import("@tonejs/midi");

function buildMidi(): Uint8Array {
  const m = new Midi();
  m.header.setTempo(120);
  m.header.name = "Prueba";
  const melody = m.addTrack();
  melody.name = "Melodía";
  melody.addNote({ midi: 60, time: 0, duration: 0.5 });
  melody.addNote({ midi: 64, time: 0.5, duration: 0.25 });
  const bass = m.addTrack();
  bass.name = "";
  bass.addNote({ midi: 48, time: 0, duration: 1 });
  const drums = m.addTrack();
  drums.channel = 9;
  drums.addNote({ midi: 36, time: 0, duration: 0.1 });
  m.addTrack(); // pista vacía
  return m.toArray();
}

describe("parseMidi", () => {
  it("extrae notas, tiempos y duraciones por pista y omite percusión y pistas vacías", () => {
    const song = parseMidi(buildMidi(), "x.mid");
    assert.equal(song.name, "Prueba");
    assert.equal(song.bpm, 120);
    assert.equal(song.tracks.length, 2);
    assert.equal(song.totalNotes, 3);

    const [melody, bass] = song.tracks;
    assert.equal(melody!.name, "Melodía");
    assert.deepEqual(
      melody!.notes.map((n) => [n.midi, n.time, n.duration]),
      [
        [60, 0, 0.5],
        [64, 0.5, 0.25],
      ],
    );
    assert.equal(bass!.name, "Pista 2");
    assert.equal(bass!.notes[0]!.track, bass!.index);
  });

  it("rechaza datos que no son MIDI con un mensaje comprensible", () => {
    assert.throws(() => parseMidi(new Uint8Array([1, 2, 3, 4])), MidiParseError);
  });

  it("rechaza un MIDI sin notas practicables", () => {
    const m = new Midi();
    m.addTrack();
    assert.throws(() => parseMidi(m.toArray()), /no contiene notas/);
  });
});

describe("teclado", () => {
  it("nombra las notas en solfeo", () => {
    assert.equal(noteName(60), "Do4");
    assert.equal(noteName(61), "Do#4");
    assert.equal(noteName(69), "La4");
    assert.equal(noteName(21), "La0");
  });

  it("el rango cubre las notas, empieza y termina en tecla blanca y mide ≥ 3 octavas", () => {
    const r = computeRange([60, 62, 64]);
    assert.ok(r.lo <= 59 && r.hi >= 65);
    assert.ok(r.hi - r.lo >= 35);
    for (const m of [r.lo, r.hi]) assert.ok(![1, 3, 6, 8, 10].includes(m % 12));
    const wide = computeRange([30, 100]);
    assert.ok(wide.lo <= 29 && wide.hi >= 101);
  });

  it("reparte las teclas en el ancho dado y centra las negras entre blancas", () => {
    const { keys, whiteWidth } = layoutKeys(60, 72, 800); // Do4..Do5: 8 blancas
    assert.equal(whiteWidth, 100);
    const whites = keys.filter((k) => !k.black);
    assert.equal(whites.length, 8);
    assert.equal(whites.at(-1)!.x + whites.at(-1)!.w, 800);
    const doSharp = keys.find((k) => k.midi === 61)!;
    assert.ok(doSharp.black);
    assert.equal(doSharp.x + doSharp.w / 2, 100); // frontera Do|Re
  });
});
