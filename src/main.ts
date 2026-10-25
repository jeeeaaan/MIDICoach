import "./style.css";
import { demoSong } from "./demo";
import { PracticeEngine } from "./motor/engine";
import type { EngineSnapshot, EngineState, NoteEvent } from './motor/types';
import { MidiParseError, parseMidi } from "./midiFile";
import type { ParsedSong } from "./midiFile";
import { MidiInput } from "./midiInput";
import type { StatusKind } from "./midiInput";
import { noteName } from "./noteNames";
import { Stage } from "./stage";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta #${id}`);
  return el as T;
};

const els = {
  file: $<HTMLInputElement>("file"),
  demo: $<HTMLButtonElement>("demo"),
  connect: $<HTMLButtonElement>("connect"),
  devices: $<HTMLSelectElement>("devices"),
  lastKey: $("lastKey"),
  message: $("message"),
  songInfo: $("songInfo"),
  tracks: $("tracks"),
  canvas: $<HTMLCanvasElement>("stage"),
  play: $<HTMLButtonElement>("play"),
  restart: $<HTMLButtonElement>("restart"),
  progress: $("progress"),
  bar: $("bar"),
  pct: $("pct"),
  state: $("state"),
  done: $("done"),
  errors: $("errors"),
  expected: $("expected"),
};

const STATE_LABEL: Record<EngineState, string> = {
  idle: "Listo",
  running: "Reproduciendo",
  waiting: "Esperando tu nota",
  paused: "En pausa",
  finished: "Completada",
};

const stage = new Stage(els.canvas);
const pressed = new Set<number>();
const wrongUntil = new Map<number, number>();

let song: ParsedSong | null = null;
const selectedTracks = new Set<number>();
let engine: PracticeEngine | null = null;
let unsubscribe: (() => void) | null = null;

// ---------- Mensajes ----------

let messageTimer = 0;
function say(text: string, kind: StatusKind = "info"): void {
  els.message.textContent = text;
  els.message.className = `message ${kind}`;
  els.message.hidden = false;
  window.clearTimeout(messageTimer);
  if (kind !== "error") {
    messageTimer = window.setTimeout(() => (els.message.hidden = true), 6000);
  }
}

// ---------- Canción y pistas (RF-01, RF-02) ----------

function formatDuration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function loadSong(next: ParsedSong): void {
  song = next;
  selectedTracks.clear();
  const first = next.tracks[0];
  if (first) selectedTracks.add(first.index);
  renderSongInfo();
  renderTracks();
  rebuildEngine();
}

function renderSongInfo(): void {
  if (!song) return;
  const bpm = song.bpm ? ` · ${song.bpm} BPM` : "";
  const strong = document.createElement("strong");
  strong.textContent = song.name;
  els.songInfo.replaceChildren(
    strong,
    ` · ${formatDuration(song.durationSec)}${bpm} · ${song.totalNotes} notas · ` +
      `${song.tracks.length} ${song.tracks.length === 1 ? "pista" : "pistas"}`,
  );
}

function renderTracks(): void {
  els.tracks.replaceChildren();
  if (!song) return;
  for (const t of song.tracks) {
    const label = document.createElement("label");
    label.className = "chip";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = selectedTracks.has(t.index);
    box.addEventListener("change", () => {
      if (box.checked) selectedTracks.add(t.index);
      else if (selectedTracks.size > 1) selectedTracks.delete(t.index);
      else {
        box.checked = true;
        say("Debe quedar al menos una pista seleccionada.", "info");
        return;
      }
      rebuildEngine();
    });
    const name = document.createElement("span");
    name.textContent = t.name;
    const small = document.createElement("small");
    small.textContent = `${t.noteCount} notas`;
    label.append(box, name, small);
    els.tracks.append(label);
  }
}

function rebuildEngine(): void {
  unsubscribe?.();
  engine = null;
  if (!song) return;

  const notes: NoteEvent[] = song.tracks
    .filter((t) => selectedTracks.has(t.index))
    .flatMap((t) => t.notes);

  const next = new PracticeEngine(notes);
  unsubscribe = next.subscribe((ev) => {
    if (ev.type === "wrongNote") wrongUntil.set(ev.midi, performance.now() + 350);
    else if (ev.type === "finished") {
      const s = next.getSnapshot();
      say(
        s.errors === 0
          ? "¡Canción completada sin errores!"
          : `¡Canción completada! Errores: ${s.errors}.`,
        "ok",
      );
    }
  });
  engine = next;
  stage.setNotes(notes, next.groups);
  els.play.disabled = false;
  els.restart.disabled = false;
}

async function openFile(file: File): Promise<void> {
  if (!/\.midi?$/i.test(file.name)) {
    say("Selecciona un archivo con extensión .mid o .midi.", "error");
    return;
  }
  try {
    const parsed = parseMidi(await file.arrayBuffer(), file.name);
    loadSong(parsed);
    say(`Cargado: ${parsed.name}.`, "ok");
  } catch (err) {
    say(
      err instanceof MidiParseError ? err.message : "No se pudo abrir el archivo seleccionado.",
      "error",
    );
  }
}

els.file.addEventListener("change", () => {
  const file = els.file.files?.[0];
  els.file.value = "";
  if (file) void openFile(file);
});
els.demo.addEventListener("click", () => loadSong(demoSong()));

// ---------- Piano (RF-03) ----------

function noteOn(midi: number): void {
  pressed.add(midi);
  els.lastKey.textContent = `Tecla: ${noteName(midi)} (${midi})`;
  engine?.noteOn(midi, performance.now());
}

function noteOff(midi: number): void {
  pressed.delete(midi);
}

const midiInput = new MidiInput({
  onNoteOn: (midi) => noteOn(midi),
  onNoteOff: (midi) => noteOff(midi),
  onStatus: (text, kind) => {
    say(text, kind);
    els.connect.textContent = kind === "ok" ? "Piano conectado" : "Conectar piano";
  },
  onDevices: (devices, selectedId) => {
    els.devices.replaceChildren();
    if (devices.length === 0) {
      els.devices.append(new Option("Sin dispositivos", ""));
      els.devices.disabled = true;
      els.connect.textContent = "Conectar piano";
      return;
    }
    for (const d of devices) els.devices.append(new Option(d.name, d.id, false, d.id === selectedId));
    els.devices.disabled = false;
  },
});

els.connect.addEventListener("click", () => void midiInput.connect());
els.devices.addEventListener("change", () => midiInput.select(els.devices.value || null));

// Teclado en pantalla: sirve para probar sin piano y en pantallas táctiles.
const activePointers = new Map<number, number>();
els.canvas.addEventListener("pointerdown", (e) => {
  const midi = stage.keyAt(e.clientX, e.clientY);
  if (midi === null) return;
  els.canvas.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, midi);
  noteOn(midi);
});
const releasePointer = (e: PointerEvent) => {
  const midi = activePointers.get(e.pointerId);
  if (midi === undefined) return;
  activePointers.delete(e.pointerId);
  noteOff(midi);
};
els.canvas.addEventListener("pointerup", releasePointer);
els.canvas.addEventListener("pointercancel", releasePointer);

// ---------- Controles (RF-07) ----------

els.play.addEventListener("click", togglePlay);
els.restart.addEventListener("click", () => {
  engine?.reset();
  pressed.clear();
  say("Práctica reiniciada desde la primera nota.", "info");
});

function togglePlay(): void {
  if (!engine) return;
  const state = engine.getSnapshot().state;
  if (state === "idle") engine.start();
  else if (state === "running" || state === "waiting") engine.pause();
  else if (state === "paused") engine.resume();
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target === document.body) {
    e.preventDefault();
    togglePlay();
  }
});

// Al ocultar la pestaña se pausa para no perder el compás.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && engine) {
    const s = engine.getSnapshot().state;
    if (s === "running" || s === "waiting") engine.pause();
  }
});

// ---------- Progreso y errores (RF-08) ----------

const last = { state: "", done: "", errors: "", pct: -1, expected: "", play: "" };

function setText(el: HTMLElement, key: keyof typeof last, value: string): void {
  if (last[key] === value) return;
  (last[key] as string) = value;
  el.textContent = value;
}

function updatePanel(snap: EngineSnapshot | null): void {
  const state = snap?.state ?? "idle";
  setText(els.state, "state", STATE_LABEL[state]);
  setText(els.done, "done", snap ? `${snap.completedNotes} / ${snap.totalNotes}` : "0 / 0");
  setText(els.errors, "errors", String(snap?.errors ?? 0));
  els.errors.classList.toggle("has-errors", (snap?.errors ?? 0) > 0);

  const pct = Math.round((snap?.progress ?? 0) * 100);
  if (pct !== last.pct) {
    last.pct = pct;
    els.bar.style.width = `${pct}%`;
    els.pct.textContent = `${pct} %`;
    els.progress.setAttribute("aria-valuenow", String(pct));
  }

  let expected = "—";
  if (snap && (state === "running" || state === "waiting")) {
    expected = snap.pendingMidis.map(noteName).join(" · ") || "—";
  } else if (state === "paused") expected = "En pausa";
  else if (state === "finished") expected = "¡Listo!";
  setText(els.expected, "expected", expected);

  const playLabel =
    state === "idle" ? "Iniciar" : state === "paused" ? "Reanudar" : state === "finished" ? "Terminó" : "Pausar";
  setText(els.play, "play", playLabel);
  els.play.disabled = !engine || state === "finished";
}

// ---------- Bucle de dibujo ----------

function frame(now: number): void {
  engine?.update();
  const snap = engine?.getSnapshot() ?? null;
  for (const [midi, until] of wrongUntil) if (until <= now) wrongUntil.delete(midi);
  stage.render(snap, pressed, wrongUntil, now);
  updatePanel(snap);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (!MidiInput.supported()) {
  say(
    "Este navegador no admite Web MIDI; podrás usar el teclado en pantalla. Para un piano real usa Chrome o Edge.",
    "info",
  );
}
