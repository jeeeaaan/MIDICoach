import "./style.css";
import type { PlayableNote } from "./audio/backing";
import { MicInput } from "./audio/micInput";
import type { MicState } from "./audio/micInput";
import { SongAudio } from "./audio/songAudio";
import { demoSong } from "./demo";
import { adaptNotesToRange, isUsableRange, PracticeEngine } from "./motor";
import type { AdaptationReport, EngineSnapshot, EngineState, KeyRange, NoteEvent } from "./motor";
import {
  DEFAULT_RANGE,
  describeRange,
  KEYBOARD_PRESETS,
  loadRange,
  presetForKeys,
  presetForRange,
  saveRange,
} from "./keyboardRange";
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
  keys: $<HTMLSelectElement>("keys"),
  calibrate: $<HTMLButtonElement>("calibrate"),
  inputMode: $<HTMLSelectElement>("inputMode"),
  micBar: $("micBar"),
  micStatus: $("micStatus"),
  micNote: $("micNote"),
  micStop: $<HTMLButtonElement>("micStop"),
  micTolerance: $<HTMLSelectElement>("micTolerance"),
  settingsBtn: $<HTMLButtonElement>("settingsBtn"),
  settings: $("settings"),
  help: $("help"),
  practiceViews: [$("songView"), $("stageView"), $("panelView")],
  adapt: $("adapt"),
  audio: $<HTMLInputElement>("audio"),
  audioLabel: $("audioLabel"),
  volume: $<HTMLInputElement>("volume"),
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
const audio = new SongAudio({
  // Piano de muestras (Salamander Grand Piano, CC BY 3.0), servido desde public/ y por tanto local.
  pianoBaseUrl: `${import.meta.env.BASE_URL}samples/salamander/`,
  onPianoState: (state, message) => say(message, state === "ready" ? "ok" : "info"),
});
/** Hay un teclado MIDI físico conectado (el audio solo existe en ese modo). */
let physicalConnected = false;
const programByTrack = new Map<number, number>();
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
  programByTrack.clear();
  for (const t of next.tracks) programByTrack.set(t.index, t.program);
  selectedTracks.clear();
  const first = next.tracks[0];
  if (first) selectedTracks.add(first.index);
  renderSongInfo();
  renderTracks();
  rebuildEngine();
}

// ---------- Audio de la canción (solo con teclado físico) ----------

function playable(n: NoteEvent, program: number, percussion: boolean, maxDuration = Infinity): PlayableNote {
  return {
    midi: n.midi,
    time: n.time,
    duration: Math.min(n.duration, maxDuration),
    velocity: n.velocity ?? 0.8,
    program,
    percussion,
  };
}

/** Acompañamiento: las pistas que no practicas y la batería. */
function buildBacking(omitted: readonly NoteEvent[]): PlayableNote[] {
  if (!song) return [];
  const out: PlayableNote[] = [];
  // Las notas de tu pista que no caben en el teclado no se esperan, pero siguen sonando con la canción.
  for (const n of omitted) out.push(playable(n, programByTrack.get(n.track ?? -1) ?? 0, false));
  for (const t of song.tracks) {
    if (selectedTracks.has(t.index)) continue;
    for (const n of t.notes) out.push(playable(n, t.program, false));
  }
  for (const t of song.percussion) for (const n of t.notes) out.push(playable(n, 0, true));
  return out;
}

function updateAudioControls(): void {
  // Con el micrófono el audio de la canción queda apagado: las bocinas se oirían en el micrófono.
  const available = physicalConnected && SongAudio.supported() && inputMode === "midi";
  if (!available && audio.enabled) audio.disable();
  els.audio.disabled = !available;
  if (!available) els.audio.checked = false;
  els.volume.disabled = !els.audio.checked;
  els.audioLabel.title = !SongAudio.supported()
    ? "Este navegador no admite audio web"
    : inputMode === "mic"
      ? "No disponible con el micrófono (evita el eco)"
      : physicalConnected
      ? "Escucha la canción por las bocinas o audífonos de la computadora"
      : "Conecta un teclado MIDI para activar el audio";
}

els.audio.addEventListener("change", async () => {
  if (els.audio.checked) {
    try {
      await audio.enable();
    } catch {
      els.audio.checked = false;
      say("No se pudo activar el audio. Revisa que el navegador permita reproducir sonido.", "error");
    }
  } else {
    audio.disable();
  }
  updateAudioControls();
});
els.volume.addEventListener("input", () => audio.setVolume(Number(els.volume.value) / 100));

// ---------- Rango del teclado y adaptación de octavas ----------

let keyRange: KeyRange = DEFAULT_RANGE;
let deviceName: string | null = null;

function renderKeysSelect(): void {
  els.keys.replaceChildren();
  for (const p of KEYBOARD_PRESETS) {
    const label = p.keys === 88 ? "88 teclas (sin adaptar)" : `${p.keys} teclas`;
    els.keys.append(new Option(label, String(p.keys)));
  }
  const preset = presetForRange(keyRange);
  if (preset) els.keys.value = String(preset.keys);
  else {
    els.keys.append(new Option(`Calibrado: ${describeRange(keyRange)}`, "custom"));
    els.keys.value = "custom";
  }
}

function setRange(range: KeyRange, persist: boolean): void {
  keyRange = range;
  if (persist) saveRange(deviceName, range);
  renderKeysSelect();
  rebuildEngine();
}

function showAdaptation(report: AdaptationReport): void {
  if (report.adaptedNotes === 0 && report.omittedNotes === 0) {
    els.adapt.hidden = true;
    return;
  }
  const parts: string[] = [];
  if (report.adaptedNotes > 0) {
    const oct = report.maxOctaves === 1 ? "una octava" : `hasta ${report.maxOctaves} octavas`;
    parts.push(
      `${report.transposedParts === 1 ? "una parte" : `${report.transposedParts} partes`} ` +
        `se transpuso completa (${oct}, ${report.adaptedNotes} notas) para caber en el rango`,
    );
  }
  if (report.omittedNotes > 0) {
    parts.push(
      `${report.omittedNotes} de ${report.totalNotes} notas no caben y se omiten ` +
        `(se ven en rojo, siguen sonando y no detienen la práctica)`,
    );
  }
  const text = `Canción adaptada a tu teclado de ${describeRange(keyRange)}: ${parts.join("; ")}.`;
  els.adapt.textContent = text;
  els.adapt.hidden = false;
}

els.keys.addEventListener("change", () => {
  const preset = presetForKeys(Number(els.keys.value));
  if (preset) setRange(preset.range, true);
});

// Calibración: la Web MIDI API no informa cuántas teclas tiene el piano.
let calibration: { step: "low" | "high"; low: number } | null = null;

function endCalibration(): void {
  calibration = null;
  els.calibrate.textContent = "Calibrar";
}

els.calibrate.addEventListener("click", () => {
  if (calibration) {
    endCalibration();
    say("Calibración cancelada.", "info");
    return;
  }
  if (engine) {
    const s = engine.getSnapshot().state;
    if (s === "running" || s === "waiting") engine.pause();
  }
  calibration = { step: "low", low: 0 };
  els.calibrate.textContent = "Cancelar calibración";
  say("Calibración: pulsa en tu piano la tecla MÁS GRAVE (la de más a la izquierda).", "info");
});

function calibrationKey(midi: number): void {
  if (!calibration) return;
  if (calibration.step === "low") {
    calibration = { step: "high", low: midi };
    say(`Tecla grave: ${noteName(midi)}. Ahora pulsa la tecla MÁS AGUDA (la de más a la derecha).`, "info");
    return;
  }
  const range = { lo: calibration.low, hi: midi };
  if (!isUsableRange(range)) {
    say(
      midi <= calibration.low
        ? "La tecla aguda debe estar a la derecha de la grave. Pulsa de nuevo la más aguda."
        : "El rango es demasiado corto (mínimo 12 teclas). Pulsa de nuevo la tecla más aguda.",
      "error",
    );
    return;
  }
  endCalibration();
  setRange(range, true);
  say(`Teclado calibrado: ${describeRange(range)}.`, "ok");
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

  const original: NoteEvent[] = song.tracks
    .filter((t) => selectedTracks.has(t.index))
    .flatMap((t) => t.notes);

  // Cada parte se transpone entera por octavas si cabe; si no, se omiten sus notas imposibles.
  const { notes, omitted, report } = adaptNotesToRange(original, keyRange);
  showAdaptation(report);

  const next = new PracticeEngine(notes);
  audio.setUserPrograms([...selectedTracks].map((i) => programByTrack.get(i) ?? 0));
  audio.setBacking(buildBacking(omitted));
  unsubscribe = next.subscribe((ev) => {
    if (ev.type === "noteMatched") {
      // La tecla acertada suena con el instrumento de su pista (máx. 3 s).
      for (const n of ev.group.notes) {
        if (n.midi === ev.midi) audio.playUser(playable(n, programByTrack.get(n.track ?? -1) ?? 0, false, 3));
      }
    } else if (ev.type === "wrongNote") wrongUntil.set(ev.midi, performance.now() + 350);
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
  stage.setNotes(notes, next.groups, omitted);
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

/** Teclas del piano MIDI o del teclado en pantalla. En modo micrófono no avanzan la práctica. */
function noteOn(midi: number): void {
  pressed.add(midi);
  els.lastKey.textContent = `Tecla: ${noteName(midi)} (${midi})`;
  if (calibration) {
    calibrationKey(midi);
    return;
  }
  if (inputMode === "midi") engine?.noteOn(midi, performance.now());
}

// ---------- Micrófono (experimental) ----------

type InputMode = "midi" | "mic";
let inputMode: InputMode = "midi";

const MIC_STATE_CLASS: Record<MicState, string> = {
  off: "",
  starting: "",
  listening: "listening",
  error: "error",
};

const mic = new MicInput({
  onNote: (midi) => {
    // Mismo motor y misma validación que el piano MIDI; solo cambia la fuente de la nota.
    if (inputMode !== "mic" || calibration || !engine) return;
    pressed.add(midi);
    window.setTimeout(() => pressed.delete(midi), 250);
    engine.noteOn(midi, performance.now());
  },
  onDetected: (midi) => {
    els.micNote.textContent = `Se oye: ${midi === null ? "—" : noteName(midi)}`;
  },
  onState: (state, message) => {
    els.micStatus.textContent = message;
    els.micStatus.className = `pill mic-status ${MIC_STATE_CLASS[state]}`;
    if (state === "error" && inputMode === "mic") {
      setInputMode("midi");
      say(message, "error");
    }
  },
});

function setInputMode(mode: InputMode): void {
  if (mode === inputMode) return;
  inputMode = mode;
  els.inputMode.value = mode;
  els.micBar.hidden = mode !== "mic";
  pressed.clear();
  updateAudioControls();
  if (mode === "mic") {
    if (calibration) endCalibration();
    if (engine) {
      const s = engine.getSnapshot().state;
      if (s === "running" || s === "waiting") engine.pause();
    }
    void mic.start();
  } else {
    mic.stop();
    els.micNote.textContent = "Se oye: —";
  }
}

if (!MicInput.supported()) {
  const option = els.inputMode.querySelector<HTMLOptionElement>('option[value="mic"]');
  if (option) {
    option.disabled = true;
    option.title = "Este navegador no permite usar el micrófono";
  }
}
els.inputMode.addEventListener("change", () => setInputMode(els.inputMode.value === "mic" ? "mic" : "midi"));
els.micStop.addEventListener("click", () => setInputMode("midi"));
els.micTolerance.addEventListener("change", () => mic.setToleranceCents(Number(els.micTolerance.value)));
// Libera el micrófono al cerrar o recargar la página.
window.addEventListener("pagehide", () => mic.stop());

function noteOff(midi: number): void {
  pressed.delete(midi);
}

let lastSelectedDevice: string | null = null;
const midiInput = new MidiInput({
  onNoteOn: (midi) => noteOn(midi),
  onNoteOff: (midi) => noteOff(midi),
  onStatus: (text, kind) => {
    say(text, kind);
    els.connect.textContent = kind === "ok" ? "Piano conectado" : "Conectar piano";
  },
  onDevices: (devices, selectedId) => {
    // Al cambiar o perder el piano no llegarán sus Note Off: se sueltan las teclas marcadas.
    if (selectedId !== lastSelectedDevice) {
      lastSelectedDevice = selectedId;
      pressed.clear();
    }
    els.devices.replaceChildren();
    if (devices.length === 0) {
      els.devices.append(new Option("Sin dispositivos", ""));
      els.devices.disabled = true;
      els.connect.textContent = "Conectar piano";
      physicalConnected = false;
      updateAudioControls();
      return;
    }
    if (selectedId === null) els.devices.append(new Option("Elige un dispositivo", "", true, true));
    for (const d of devices) els.devices.append(new Option(d.name, d.id, false, d.id === selectedId));
    els.devices.disabled = false;
    physicalConnected = selectedId !== null;
    updateAudioControls();

    // Al cambiar de piano se recupera el rango que se guardó para ese dispositivo.
    const name = devices.find((d) => d.id === selectedId)?.name ?? null;
    if (name !== deviceName) {
      deviceName = name;
      const saved = name ? loadRange(name) : null;
      if (saved) setRange(saved, false);
    }
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

els.play.addEventListener("click", () => {
  audio.unlock();
  togglePlay();
});
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
  if (e.code === "Space" && e.target === document.body && !helpOpen) {
    e.preventDefault();
    togglePlay();
  }
});

// ---------- Ajustes y ayuda ----------

function setSettingsOpen(open: boolean): void {
  els.settings.hidden = !open;
  els.settingsBtn.setAttribute("aria-expanded", String(open));
}
els.settingsBtn.addEventListener("click", () => setSettingsOpen(Boolean(els.settings.hidden)));
document.addEventListener("pointerdown", (e) => {
  const target = e.target as Node;
  if (!els.settings.hidden && !els.settings.contains(target) && !els.settingsBtn.contains(target)) {
    setSettingsOpen(false);
  }
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.settings.hidden) {
    setSettingsOpen(false);
    els.settingsBtn.focus();
  }
});

/** La ayuda es otra vista de la misma página (#ayuda...): la práctica sigue en memoria, en pausa. */
let helpOpen = false;
function syncView(): void {
  const wantHelp = location.hash.startsWith("#ayuda");
  if (wantHelp && !helpOpen) {
    helpOpen = true;
    setSettingsOpen(false);
    if (calibration) {
      endCalibration();
      say("Calibración cancelada.", "info");
    }
    if (engine) {
      const s = engine.getSnapshot().state;
      if (s === "running" || s === "waiting") engine.pause();
    }
    pressed.clear();
  } else if (!wantHelp && helpOpen) {
    helpOpen = false;
  }
  els.help.hidden = !wantHelp;
  for (const v of els.practiceViews) v.hidden = wantHelp;
  if (wantHelp) {
    const section = location.hash === "#ayuda" ? null : document.getElementById(location.hash.slice(1));
    if (section) section.scrollIntoView();
    else els.help.scrollTop = 0;
  }
}
window.addEventListener("hashchange", syncView);
syncView();

// Al ocultar la pestaña se pausa para no perder el compás.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && engine) {
    const s = engine.getSnapshot().state;
    if (s === "running" || s === "waiting") engine.pause();
    audio.tick("paused", engine.getSnapshot().time, null);
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

renderKeysSelect();
updateAudioControls();

// ---------- Bucle de dibujo ----------

function frame(now: number): void {
  engine?.update();
  const snap = engine?.getSnapshot() ?? null;
  if (snap) audio.tick(snap.state, snap.time, snap.currentGroup?.time ?? null);
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
