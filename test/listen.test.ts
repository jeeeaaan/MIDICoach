import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BackingScheduler } from "../src/audio/backing";
import type { BackingSink, PlayableNote } from "../src/audio/backing";
import { ListenEngine } from "../src/motor/listen";
import type { NoteEvent } from "../src/motor/types";

const n = (midi: number, time: number, track = 0): NoteEvent => ({ midi, time, duration: 0.5, track });

function fakeTime() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("ListenEngine", () => {
  it("avanza por notas y acordes sin entradas ni estado de espera", () => {
    const ft = fakeTime();
    const e = new ListenEngine([n(60, 1), n(64, 1), n(62, 2)], 3, { now: ft.now });
    e.start();
    ft.advance(1100);
    e.update();

    let s = e.getSnapshot();
    assert.equal(s.state, "running");
    assert.equal(s.time, 1.1);
    assert.equal(s.groupIndex, 1);
    assert.equal(s.completedNotes, 2);
    assert.deepEqual(s.pendingMidis, []);

    ft.advance(1000);
    e.update();
    s = e.getSnapshot();
    assert.equal(s.state, "running");
    assert.equal(s.time, 2.1);
    assert.equal(s.groupIndex, 2);
    assert.equal(s.completedNotes, 3);
  });

  it("agrupa todas las pistas y hace avanzar sus grupos según el reloj", () => {
    const ft = fakeTime();
    const e = new ListenEngine([n(60, 0.5, 0), n(48, 0.5, 1), n(67, 1.5, 2)], 2, { now: ft.now });
    assert.equal(e.groups.length, 2);
    assert.deepEqual(e.groups[0]!.midis, [48, 60]);

    e.start();
    ft.advance(500);
    e.update();
    assert.equal(e.getSnapshot().completedNotes, 2);
    ft.advance(1000);
    e.update();
    assert.equal(e.getSnapshot().completedNotes, 3);
    assert.equal(e.getSnapshot().groupIndex, 2);
  });

  it("pausa y reanuda conservando la posición", () => {
    const ft = fakeTime();
    const e = new ListenEngine([n(60, 1)], 3, { now: ft.now });
    e.start();
    ft.advance(750);
    e.pause();
    ft.advance(5000);
    assert.equal(e.getSnapshot().time, 0.75);
    assert.equal(e.getSnapshot().state, "paused");

    e.resume();
    ft.advance(250);
    e.update();
    assert.equal(e.getSnapshot().time, 1);
    assert.equal(e.getSnapshot().state, "running");
  });

  it("reiniciar vuelve al inicio y descarta el progreso", () => {
    const ft = fakeTime();
    const e = new ListenEngine([n(60, 0.5), n(62, 1)], 2, { now: ft.now });
    e.start();
    ft.advance(1200);
    e.update();
    ft.advance(800);
    e.update();
    assert.equal(e.getSnapshot().state, "finished");
    e.reset();

    const s = e.getSnapshot();
    assert.equal(s.state, "idle");
    assert.equal(s.time, 0);
    assert.equal(s.groupIndex, 0);
    assert.equal(s.completedNotes, 0);
    assert.equal(s.progress, 0);
  });

  it("busca en ambos sentidos, limita los extremos y permite reanudar tras finalizar", () => {
    const ft = fakeTime();
    const e = new ListenEngine([n(60, 1), n(62, 2)], 4, { now: ft.now });
    e.seek(1.5);
    let s = e.getSnapshot();
    assert.equal(s.time, 1.5);
    assert.equal(s.groupIndex, 1);
    assert.equal(s.completedNotes, 1);
    assert.equal(s.progress, 0.375);

    e.start();
    ft.advance(250);
    e.update();
    assert.equal(e.getSnapshot().time, 1.75);
    e.seek(0.5);
    assert.equal(e.getSnapshot().state, "running");
    assert.equal(e.getSnapshot().time, 0.5);
    assert.equal(e.getSnapshot().groupIndex, 0);

    e.seek(99);
    assert.equal(e.getSnapshot().state, "finished");
    assert.equal(e.getSnapshot().time, 4);
    e.seek(2);
    assert.equal(e.getSnapshot().state, "paused");
    e.resume();
    ft.advance(100);
    e.update();
    assert.equal(e.getSnapshot().time, 2.1);

    e.seek(-5);
    assert.equal(e.getSnapshot().time, 0);
  });

  it("termina al alcanzar la duración aunque la última nota empiece antes", () => {
    const ft = fakeTime();
    const e = new ListenEngine([n(60, 1)], 3, { now: ft.now });
    e.start();
    ft.advance(1500);
    e.update();
    assert.equal(e.getSnapshot().state, "running");

    ft.advance(1500);
    e.update();
    const s = e.getSnapshot();
    assert.equal(s.state, "finished");
    assert.equal(s.time, 3);
    assert.equal(s.completedNotes, 1);
    assert.equal(s.progress, 1);

    ft.advance(5000);
    e.update();
    assert.equal(e.getSnapshot().time, 3);
  });

  it("audio y visualización comparten el tiempo del snapshot sin duplicar notas", () => {
    const ft = fakeTime();
    const e = new ListenEngine([n(60, 0.5), n(62, 1)], 2, { now: ft.now });
    const played: Array<{ time: number; at: number }> = [];
    let stops = 0;
    const sink: BackingSink = {
      play: (note, delay) => played.push({ time: note.time, at: e.getSnapshot().time + delay }),
      stopAll: () => stops++,
    };
    const scheduler = new BackingScheduler(
      e.groups.flatMap((group): PlayableNote[] =>
        group.notes.map((note) => ({
          midi: note.midi,
          time: note.time,
          duration: note.duration,
          velocity: 0.8,
          program: 0,
          percussion: false,
        })),
      ),
      sink,
    );
    const frame = () => {
      e.update();
      const s = e.getSnapshot();
      scheduler.tick(s.state, s.time, null);
    };

    e.start();
    ft.advance(450);
    frame();
    ft.advance(150);
    frame();
    frame();
    e.pause();
    frame();
    e.resume();
    frame();
    ft.advance(400);
    frame();

    assert.deepEqual(played, [{ time: 0.5, at: 0.5 }, { time: 1, at: 1 }]);
    assert.equal(stops, 1);
    assert.equal(e.getSnapshot().time, 1);
  });
});
