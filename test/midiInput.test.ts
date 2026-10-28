import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MidiInput, parseMidiMessage } from "../src/midiInput";
import type { MidiDevice, StatusKind } from "../src/midiInput";
import { PracticeEngine } from "../src/motor/index";
import type { NoteEvent } from "../src/motor/index";

describe("parseMidiMessage", () => {
  it("Note On con velocidad > 0 es una pulsación y conserva número y velocidad", () => {
    assert.deepEqual(parseMidiMessage([0x90, 60, 100]), { type: "on", note: 60, velocity: 100 });
    assert.deepEqual(parseMidiMessage([0x95, 21, 1]), { type: "on", note: 21, velocity: 1 }); // otro canal
    assert.deepEqual(parseMidiMessage([0x90, 108, 127]), { type: "on", note: 108, velocity: 127 });
  });

  it("Note On con velocidad 0 equivale a Note Off", () => {
    assert.equal(parseMidiMessage([0x90, 60, 0])?.type, "off");
  });

  it("Note Off se reconoce con cualquier velocidad de liberación", () => {
    assert.equal(parseMidiMessage([0x80, 60, 64])?.type, "off");
    assert.equal(parseMidiMessage([0x8f, 60])?.type, "off");
  });

  it("ignora mensajes que no son notas o están incompletos", () => {
    assert.equal(parseMidiMessage([0xb0, 64, 127]), null); // pedal
    assert.equal(parseMidiMessage([0xe0, 0, 64]), null); // pitch bend
    assert.equal(parseMidiMessage([0xf8]), null); // reloj
    assert.equal(parseMidiMessage([0x90]), null);
    assert.equal(parseMidiMessage(null), null);
  });
});

// ---- Web MIDI simulada ----

interface FakeInput {
  id: string;
  name: string;
  type: "input";
  state: "connected" | "disconnected";
  onmidimessage: ((e: { data: number[] }) => void) | null;
}

function fakeMidi() {
  const inputs = new Map<string, FakeInput>();
  const access = { inputs, onstatechange: null as null | ((e: { port: FakeInput }) => void) };
  const add = (id: string, name = id): FakeInput => {
    const p: FakeInput = { id, name, type: "input", state: "connected", onmidimessage: null };
    inputs.set(id, p);
    return p;
  };
  const plug = (p: FakeInput) => {
    p.state = "connected";
    inputs.set(p.id, p);
    access.onstatechange?.({ port: p });
  };
  const unplug = (p: FakeInput) => {
    p.state = "disconnected";
    inputs.delete(p.id);
    access.onstatechange?.({ port: p });
  };
  return { access, add, plug, unplug };
}

function harness(request: () => Promise<unknown>) {
  const log = {
    on: [] as number[],
    off: [] as number[],
    status: [] as Array<[string, StatusKind]>,
    lists: [] as Array<{ devices: MidiDevice[]; selected: string | null }>,
  };
  const input = new MidiInput(
    {
      onNoteOn: (m) => log.on.push(m),
      onNoteOff: (m) => log.off.push(m),
      onStatus: (t, k) => log.status.push([t, k]),
      onDevices: (devices, selected) => log.lists.push({ devices, selected }),
    },
    request as () => Promise<MIDIAccess>,
  );
  return { input, log };
}

describe("MidiInput: dispositivos", () => {
  it("conecta, selecciona el primer piano y entrega notas", async () => {
    const m = fakeMidi();
    const piano = m.add("a", "Piano A");
    const { input, log } = harness(async () => m.access);
    await input.connect();
    assert.equal(log.lists.at(-1)!.selected, "a");
    piano.onmidimessage!({ data: [0x90, 60, 90] });
    piano.onmidimessage!({ data: [0x80, 60, 0] });
    assert.deepEqual(log.on, [60]);
    assert.deepEqual(log.off, [60]);
  });

  it("permiso denegado: avisa con un mensaje claro y no deja dispositivo", async () => {
    const { input, log } = harness(async () => {
      throw new DOMException("no", "SecurityError");
    });
    await input.connect();
    assert.equal(log.status.at(-1)![1], "error");
    assert.match(log.status.at(-1)![0], /permiso/);
    assert.equal(log.lists.length, 0);
  });

  it("sin dispositivos: lo indica", async () => {
    const m = fakeMidi();
    const { input, log } = harness(async () => m.access);
    await input.connect();
    assert.match(log.status.at(-1)![0], /No se detectó/);
    assert.deepEqual(log.lists.at(-1), { devices: [], selected: null });
  });

  it("al desconectarse el piano, deja de recibir sus notas y avisa", async () => {
    const m = fakeMidi();
    const piano = m.add("a", "Piano A");
    const { input, log } = harness(async () => m.access);
    await input.connect();
    m.unplug(piano);
    assert.equal(piano.onmidimessage, null);
    assert.equal(log.lists.at(-1)!.selected, null);
    assert.match(log.status.at(-1)![0], /desconect/);
    (piano as FakeInput).onmidimessage?.({ data: [0x90, 60, 90] });
    assert.deepEqual(log.on, []);
  });

  it("al reconectar el piano vuelve a seleccionarse solo", async () => {
    const m = fakeMidi();
    const piano = m.add("a", "Piano A");
    const { input, log } = harness(async () => m.access);
    await input.connect();
    m.unplug(piano);
    m.plug(piano);
    assert.equal(log.lists.at(-1)!.selected, "a");
    piano.onmidimessage!({ data: [0x90, 64, 80] });
    assert.deepEqual(log.on, [64]);
  });

  it("si se desconecta uno y queda otro, pasa al que queda (la lista no queda desincronizada)", async () => {
    const m = fakeMidi();
    const a = m.add("a");
    const b = m.add("b");
    const { input, log } = harness(async () => m.access);
    await input.connect();
    assert.equal(log.lists.at(-1)!.selected, "a");
    m.unplug(a);
    assert.equal(log.lists.at(-1)!.selected, "b");
    b.onmidimessage!({ data: [0x90, 60, 90] });
    assert.deepEqual(log.on, [60]);
  });

  it("cambiar de dispositivo suelta el anterior: sus notas ya no llegan", async () => {
    const m = fakeMidi();
    const a = m.add("a");
    const b = m.add("b");
    const { input, log } = harness(async () => m.access);
    await input.connect();
    input.select("b");
    assert.equal(a.onmidimessage, null);
    (a as FakeInput).onmidimessage?.({ data: [0x90, 60, 90] });
    b.onmidimessage!({ data: [0x90, 62, 90] });
    assert.deepEqual(log.on, [62]);
  });

  it("pulsar Conectar de nuevo no pide permiso otra vez ni duplica la escucha", async () => {
    const m = fakeMidi();
    const piano = m.add("a");
    let requests = 0;
    const { input, log } = harness(async () => {
      requests++;
      return m.access;
    });
    await input.connect();
    await input.connect();
    assert.equal(requests, 1);
    piano.onmidimessage!({ data: [0x90, 60, 90] });
    assert.deepEqual(log.on, [60]);
  });

  it("seleccionar un dispositivo que desapareció informa y refresca la lista", async () => {
    const m = fakeMidi();
    m.add("a");
    const { input, log } = harness(async () => m.access);
    await input.connect();
    input.select("fantasma");
    assert.match(log.status.at(-1)![0], /ya no está disponible/);
  });
});

describe("MIDI + motor: repetidas y sostenidas", () => {
  const n = (midi: number, time: number): NoteEvent => ({ midi, time, duration: 0.5 });

  function setup(notes: NoteEvent[]) {
    let t = 0;
    const e = new PracticeEngine(notes, { now: () => t });
    e.start();
    t += 10_000;
    e.update();
    return { e, advance: (ms: number) => ((t += ms), e.update()), now: () => t };
  }

  it("la velocidad no influye: una pulsación suave o fuerte valida igual", () => {
    for (const _v of [1, 64, 127]) {
      const { e, now } = setup([n(60, 1)]);
      e.noteOn(60, now());
      assert.equal(e.getSnapshot().state, "finished");
    }
  });

  it("un rebote (la misma tecla dos veces seguidas) no salta a la siguiente nota igual", () => {
    const { e, now } = setup([n(60, 1), n(60, 2), n(62, 3)]);
    e.noteOn(60, now());
    e.noteOn(60, now() + 5); // rebote del teclado, la siguiente nota está a 1 s
    const s = e.getSnapshot();
    assert.equal(s.completedNotes, 1);
    assert.equal(s.errors, 0);
  });

  it("repetir la misma nota cuando le toca sí avanza", () => {
    const { e, advance, now } = setup([n(60, 1), n(60, 2)]);
    e.noteOn(60, now());
    advance(1500);
    e.noteOn(60, now());
    assert.equal(e.getSnapshot().state, "finished");
  });

  it("mantener pulsada una tecla (sin nuevas pulsaciones) no avanza ni suma errores", () => {
    const { e, advance } = setup([n(60, 1), n(62, 2)]);
    advance(5000);
    const s = e.getSnapshot();
    assert.equal(s.completedNotes, 0);
    assert.equal(s.errors, 0);
  });

  it("una nota incorrecta cuenta error, no avanza, y la correcta después continúa", () => {
    const { e, now } = setup([n(60, 1), n(62, 2)]);
    e.noteOn(61, now());
    assert.equal(e.getSnapshot().errors, 1);
    assert.equal(e.getSnapshot().completedNotes, 0);
    e.noteOn(60, now());
    assert.equal(e.getSnapshot().completedNotes, 1);
  });

  it("un acorde se valida con notas llegando por MIDI en cualquier orden", () => {
    const { e, now } = setup([n(60, 1), n(64, 1), n(67, 1)]);
    e.noteOn(67, now());
    e.noteOn(60, now() + 20);
    e.noteOn(64, now() + 40);
    assert.equal(e.getSnapshot().state, "finished");
  });
});
