import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupNotes, PausableClock, PracticeEngine } from "../src/index";
import type { EngineEvent, NoteEvent } from "../src/index";

const n = (midi: number, time: number, duration = 0.5): NoteEvent => ({ midi, time, duration });

function fakeTime() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("groupNotes", () => {
  it("agrupa notas dentro de la tolerancia en un acorde", () => {
    const g = groupNotes([n(64, 1.01), n(60, 1.0), n(67, 1.02), n(72, 2.0)], 0.03);
    assert.equal(g.length, 2);
    assert.deepEqual(g[0]!.midis, [60, 64, 67]);
    assert.equal(g[0]!.time, 1.0);
    assert.deepEqual(g[1]!.midis, [72]);
  });

  it("no encadena: una escala rápida no se fusiona en un solo grupo", () => {
    // Con encadenamiento (cada nota a ≤30 ms de la anterior) saldría 1 solo grupo.
    // Con ancla fija: [0, 0.02], [0.04, 0.06], [0.08, 0.10].
    const g = groupNotes(
      [n(60, 0), n(62, 0.02), n(64, 0.04), n(65, 0.06), n(67, 0.08), n(69, 0.1)],
      0.03,
    );
    assert.equal(g.length, 3);
    assert.deepEqual(g.map((x) => x.midis), [[60, 62], [64, 65], [67, 69]]);
  });
});

describe("PausableClock", () => {
  it("se congela al pausar y reanuda sin perder posición", () => {
    const ft = fakeTime();
    const c = new PausableClock(ft.now);
    c.start();
    ft.advance(1000);
    c.pause();
    ft.advance(5000);
    assert.equal(c.getTime(), 1);
    c.start();
    ft.advance(500);
    assert.equal(c.getTime(), 1.5);
  });

  it("queda clavado en el techo y continúa desde él al liberarlo", () => {
    const ft = fakeTime();
    const c = new PausableClock(ft.now);
    c.setCeiling(2);
    c.start();
    ft.advance(10_000);
    assert.equal(c.getTime(), 2);
    assert.ok(c.atCeiling());
    c.setCeiling(5);
    ft.advance(500);
    assert.equal(c.getTime(), 2.5);
  });
});

describe("PracticeEngine", () => {
  it("espera en la nota pendiente y reanuda desde la posición exacta", () => {
    const ft = fakeTime();
    const e = new PracticeEngine([n(60, 1), n(62, 2)], { now: ft.now });
    e.start();
    ft.advance(10_000);
    e.update();
    let s = e.getSnapshot();
    assert.equal(s.state, "waiting");
    assert.equal(s.time, 1);
    assert.deepEqual(s.pendingMidis, [60]);

    e.noteOn(60, ft.now());
    s = e.getSnapshot();
    assert.equal(s.state, "running");
    assert.equal(s.groupIndex, 1);
    assert.equal(s.time, 1); // sin salto aunque pasaron 10 s esperando

    ft.advance(400);
    assert.equal(e.getSnapshot().time, 1.4);
  });

  it("no avanza con una nota incorrecta y cuenta el error", () => {
    const ft = fakeTime();
    const e = new PracticeEngine([n(60, 1)], { now: ft.now });
    const events: EngineEvent[] = [];
    e.subscribe((ev) => events.push(ev));
    e.start();
    ft.advance(1500);
    e.update();
    e.noteOn(61, ft.now());
    const s = e.getSnapshot();
    assert.equal(s.errors, 1);
    assert.equal(s.state, "waiting");
    assert.equal(s.completedNotes, 0);
    assert.ok(events.some((ev) => ev.type === "wrongNote"));
  });

  it("valida un acorde cuando todas las notas llegan dentro de la ventana", () => {
    const ft = fakeTime();
    const e = new PracticeEngine([n(60, 1), n(64, 1), n(67, 1)], {
      now: ft.now,
      chordWindowMs: 150,
    });
    e.start();
    ft.advance(1200);
    e.update();

    e.noteOn(60, ft.now());
    assert.deepEqual(e.getSnapshot().pendingMidis, [64, 67]);
    assert.equal(e.getSnapshot().state, "waiting");
    ft.advance(60);
    e.noteOn(64, ft.now());
    ft.advance(60);
    e.noteOn(67, ft.now());

    const s = e.getSnapshot();
    assert.equal(s.state, "finished");
    assert.equal(s.completedNotes, 3);
    assert.equal(s.progress, 1);
  });

  it("si la ventana expira, las notas del acorde vuelven a quedar pendientes", () => {
    const ft = fakeTime();
    const e = new PracticeEngine([n(60, 1), n(64, 1)], { now: ft.now, chordWindowMs: 150 });
    const events: EngineEvent[] = [];
    e.subscribe((ev) => events.push(ev));
    e.start();
    ft.advance(1200);
    e.update();

    e.noteOn(60, ft.now());
    ft.advance(400);
    e.noteOn(64, ft.now()); // fuera de ventana: el acorde se reinicia, 64 cuenta como primera nota nueva

    let s = e.getSnapshot();
    assert.equal(s.state, "waiting");
    assert.deepEqual(s.pendingMidis, [60]);
    assert.ok(events.some((ev) => ev.type === "chordWindowExpired"));

    ft.advance(50);
    e.noteOn(60, ft.now());
    s = e.getSnapshot();
    assert.equal(s.state, "finished");
  });

  it("acepta una pulsación ligeramente adelantada, pero ignora las muy tempranas", () => {
    const ft = fakeTime();
    const e = new PracticeEngine([n(60, 1)], { now: ft.now, earlyWindowMs: 200 });
    e.start();
    ft.advance(100); // faltan 900 ms
    e.noteOn(60, ft.now());
    assert.equal(e.getSnapshot().completedNotes, 0);
    assert.equal(e.getSnapshot().errors, 0);

    ft.advance(750); // faltan 150 ms
    e.noteOn(60, ft.now());
    assert.equal(e.getSnapshot().completedNotes, 1);
  });

  it("pausa congela el tiempo y reanudar conserva el estado de espera", () => {
    const ft = fakeTime();
    const e = new PracticeEngine([n(60, 1), n(62, 2)], { now: ft.now });
    e.start();
    ft.advance(500);
    e.pause();
    ft.advance(30_000);
    assert.equal(e.getSnapshot().time, 0.5);
    e.noteOn(60, ft.now()); // ignorado en pausa
    assert.equal(e.getSnapshot().completedNotes, 0);

    e.resume();
    ft.advance(1000);
    e.update();
    assert.equal(e.getSnapshot().state, "waiting");
    assert.equal(e.getSnapshot().time, 1);

    e.pause();
    e.resume();
    assert.equal(e.getSnapshot().state, "waiting");
  });

  it("reiniciar devuelve a la primera nota sin conservar progreso ni errores", () => {
    const ft = fakeTime();
    const e = new PracticeEngine([n(60, 1), n(62, 2)], { now: ft.now });
    e.start();
    ft.advance(1500);
    e.update();
    e.noteOn(61, ft.now());
    e.noteOn(60, ft.now());
    assert.equal(e.getSnapshot().completedNotes, 1);

    e.reset();
    const s = e.getSnapshot();
    assert.equal(s.state, "idle");
    assert.equal(s.groupIndex, 0);
    assert.equal(s.completedNotes, 0);
    assert.equal(s.errors, 0);
    assert.equal(s.time, 0);

    e.start();
    ft.advance(5000);
    e.update();
    assert.equal(e.getSnapshot().time, 1);
    assert.equal(e.getSnapshot().state, "waiting");
  });

  it("el progreso crece con cada grupo y termina en 100 %", () => {
    const ft = fakeTime();
    const e = new PracticeEngine([n(60, 0.5), n(62, 1), n(64, 1), n(65, 1.5)], { now: ft.now });
    e.start();
    const progress: number[] = [];
    for (const midis of [[60], [62, 64], [65]]) {
      ft.advance(2000);
      e.update();
      for (const m of midis) e.noteOn(m, ft.now());
      progress.push(e.getSnapshot().progress);
    }
    assert.deepEqual(progress, [0.25, 0.75, 1]);
    assert.equal(e.getSnapshot().state, "finished");
  });
});
