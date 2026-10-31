import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BackingScheduler, LOOKAHEAD_SEC } from "../src/audio/backing";
import type { BackingSink, PlayableNote } from "../src/audio/backing";
import { drumKind, timbreFor } from "../src/audio/synth";
import { PracticeEngine } from "../src/motor/index";
import type { EngineEvent } from "../src/motor/index";

const note = (time: number, midi = 48): PlayableNote => ({
  midi,
  time,
  duration: 0.5,
  velocity: 0.8,
  program: 0,
  percussion: false,
});

function recorder() {
  const played: Array<{ time: number; delay: number }> = [];
  let stops = 0;
  const sink: BackingSink = {
    play: (n, delay) => played.push({ time: n.time, delay }),
    stopAll: () => stops++,
  };
  return { sink, played, stops: () => stops };
}

describe("BackingScheduler", () => {
  it("programa cada nota una sola vez, con el retraso correcto, dentro de la ventana de anticipación", () => {
    const r = recorder();
    const s = new BackingScheduler([note(1), note(1.05), note(2)], r.sink);
    s.tick("idle", 0.9, 1);
    s.tick("running", 0.95, 5);
    assert.deepEqual(
      r.played.map((p) => p.time),
      [1, 1.05],
    );
    assert.ok(Math.abs(r.played[0]!.delay - 0.05) < 1e-9);
    assert.ok(Math.abs(r.played[1]!.delay - 0.1) < 1e-9);
    s.tick("running", 0.96, 5); // mismo rango: no repite
    assert.equal(r.played.length, 2);
    s.tick("running", 2 - LOOKAHEAD_SEC / 2, 5);
    assert.equal(r.played.length, 3);
  });

  it("no programa nada posterior a la nota pendiente: se detiene junto con el reloj", () => {
    const r = recorder();
    const s = new BackingScheduler([note(1), note(1.5), note(3)], r.sink);
    s.tick("idle", 0, 1);
    s.tick("running", 0.95, 1); // la nota pendiente está en t = 1
    assert.deepEqual(
      r.played.map((p) => p.time),
      [1],
    );
    for (let i = 0; i < 100; i++) s.tick("waiting", 1, 1); // el usuario tarda
    assert.equal(r.played.length, 1);

    s.tick("running", 1.0, 2); // el usuario acertó: el techo sube a la siguiente nota
    s.tick("running", 1.45, 2);
    assert.deepEqual(
      r.played.map((p) => p.time),
      [1, 1.5],
    );
  });

  it("al pausar silencia y, al reanudar, no pierde ni repite notas", () => {
    const r = recorder();
    const s = new BackingScheduler([note(1), note(1.05), note(1.1)], r.sink);
    s.tick("idle", 0, 5);
    s.tick("running", 0.97, 5); // programa 1 y 1.05 (adelantadas); 1.1 queda fuera
    assert.equal(r.played.length, 2);
    s.tick("paused", 0.98, null); // las dos no llegaron a sonar
    assert.equal(r.stops(), 1);
    s.tick("paused", 0.98, null);
    assert.equal(r.stops(), 1); // no vuelve a silenciar sin necesidad
    s.tick("running", 0.98, 5);
    assert.deepEqual(
      r.played.slice(2).map((p) => p.time),
      [1, 1.05, 1.1],
    );
  });

  it("al pausar justo después de que una nota sonó no la repite", () => {
    const r = recorder();
    const s = new BackingScheduler([note(1), note(2)], r.sink);
    s.tick("idle", 0.5, 5);
    s.tick("running", 0.95, 5);
    s.tick("running", 1.02, 5); // la nota de t=1 ya sonó
    s.tick("paused", 1.02, null);
    s.tick("running", 1.02, 5);
    assert.equal(r.played.filter((p) => p.time === 1).length, 1);
  });

  it("al reiniciar silencia y vuelve a empezar desde el principio", () => {
    const r = recorder();
    const s = new BackingScheduler([note(1), note(2)], r.sink);
    s.tick("idle", 0.5, 1);
    s.tick("running", 0.95, 1);
    s.tick("running", 1, 1);
    assert.equal(r.played.length, 1);
    s.tick("idle", 0.5, 1); // reinicio
    assert.equal(r.stops(), 1);
    s.tick("running", 0.95, 1);
    assert.equal(r.played.length, 2);
    assert.equal(r.played[1]!.time, 1);
  });

  it("al buscar silencia, recoloca el cursor y no duplica la nota del destino", () => {
    const r = recorder();
    const s = new BackingScheduler([note(1), note(2)], r.sink);
    s.tick("running", 0.95, null);
    assert.deepEqual(r.played.map((p) => p.time), [1]);

    s.seek(1);
    assert.equal(r.stops(), 1);
    s.tick("paused", 1, null);
    s.tick("running", 1, null);
    s.tick("running", 1.01, null);
    assert.deepEqual(r.played.map((p) => p.time), [1, 1]);
    assert.equal(r.played[1]!.delay, 0);

    s.seek(2);
    s.tick("running", 2, null);
    s.tick("running", 2.01, null);
    assert.deepEqual(r.played.map((p) => p.time), [1, 1, 2]);
    assert.equal(r.played[2]!.delay, 0);
  });

  it("omite las notas que llegan demasiado tarde en vez de hacerlas sonar desfasadas", () => {
    const r = recorder();
    const s = new BackingScheduler([note(1), note(1.4)], r.sink);
    s.tick("idle", 0, 5);
    s.tick("running", 1.43, 5); // salto de 1.43 s por un tirón del navegador
    assert.deepEqual(
      r.played.map((p) => p.time),
      [1.4],
    );
  });

  it("al terminar la canción no corta las últimas notas", () => {
    const r = recorder();
    const s = new BackingScheduler([note(1)], r.sink);
    s.tick("idle", 0, 1);
    s.tick("running", 1, 1);
    s.tick("finished", 1, null);
    assert.equal(r.stops(), 0);
  });

  it("con el motor real: durante la espera no suena nada nuevo y al acertar continúa", () => {
    let t = 0;
    const melody = [
      { midi: 60, time: 1, duration: 0.5 },
      { midi: 62, time: 2, duration: 0.5 },
    ];
    const engine = new PracticeEngine(melody, { now: () => t, leadInSec: 1 });
    const r = recorder();
    const backing = [note(0.2), note(0.9), note(1.5), note(2.5)];
    const s = new BackingScheduler(backing, r.sink);
    const events: EngineEvent[] = [];
    engine.subscribe((e) => events.push(e));
    const frame = () => {
      engine.update();
      const snap = engine.getSnapshot();
      s.tick(snap.state, snap.time, snap.currentGroup?.time ?? null);
    };

    frame();
    engine.start();
    for (let i = 0; i < 200; i++) {
      t += 16;
      frame();
    }
    // Llegó a t=1 y espera: solo sonó lo anterior a la nota pendiente (nada de 1.5 ni 2.5).
    assert.equal(engine.getSnapshot().state, "waiting");
    assert.deepEqual(
      r.played.map((p) => p.time),
      [0.2, 0.9],
    );
    t += 30_000; // el usuario tarda mucho
    frame();
    assert.equal(r.played.length, 2);

    engine.noteOn(60, t);
    for (let i = 0; i < 100; i++) {
      t += 16;
      frame();
    }
    assert.deepEqual(
      r.played.map((p) => p.time),
      [0.2, 0.9, 1.5],
    );
    assert.ok(events.some((e) => e.type === "noteMatched"));
  });
});

describe("timbres y percusión", () => {
  it("cada familia General MIDI tiene un timbre válido", () => {
    for (let p = -3; p <= 130; p++) {
      const timbre = timbreFor(p);
      assert.ok(timbre.partials.length > 0);
      assert.ok(timbre.attack > 0 && timbre.release > 0);
    }
    assert.notEqual(timbreFor(0), timbreFor(40)); // piano ≠ cuerdas
    assert.notEqual(timbreFor(33), timbreFor(73)); // bajo ≠ flauta
  });

  it("clasifica la percusión del mapa General MIDI", () => {
    assert.equal(drumKind(36), "kick");
    assert.equal(drumKind(38), "snare");
    assert.equal(drumKind(42), "hatClosed");
    assert.equal(drumKind(46), "hatOpen");
    assert.equal(drumKind(45), "tom");
    assert.equal(drumKind(49), "crash");
    assert.equal(drumKind(51), "ride");
    assert.equal(drumKind(56), "other");
  });
});
