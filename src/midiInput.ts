export interface MidiDevice {
  id: string;
  name: string;
}

export type StatusKind = "info" | "ok" | "error";

export interface MidiInputHandlers {
  onNoteOn(midi: number, velocity: number): void;
  onNoteOff(midi: number): void;
  onStatus(text: string, kind: StatusKind): void;
  /** Lista actual de dispositivos y el seleccionado (o null). */
  onDevices(devices: MidiDevice[], selectedId: string | null): void;
}

/** Envoltorio de la Web MIDI API para detectar teclas pulsadas y liberadas (RF-03). */
export class MidiInput {
  private access: MIDIAccess | null = null;
  private selected: MIDIInput | null = null;
  private readonly handlers: MidiInputHandlers;

  constructor(handlers: MidiInputHandlers) {
    this.handlers = handlers;
  }

  static supported(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
  }

  /** Debe llamarse desde un gesto del usuario: el navegador pide permiso. */
  async connect(): Promise<void> {
    if (!MidiInput.supported()) {
      this.handlers.onStatus(
        "Este navegador no admite Web MIDI. Usa Chrome o Edge en una computadora.",
        "error",
      );
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.handlers.onStatus(
        "No se obtuvo permiso para usar dispositivos MIDI. Revisa los permisos del sitio.",
        "error",
      );
      return;
    }
    this.access.onstatechange = (e) => this.onStateChange(e);
    this.refresh(true);
  }

  select(id: string | null): void {
    this.detach();
    if (id === null || !this.access) {
      this.refresh(false);
      return;
    }
    const input = this.access.inputs.get(id);
    if (!input) return;
    this.selected = input;
    input.onmidimessage = (e) => this.onMessage(e);
    this.handlers.onStatus(`Piano conectado: ${input.name ?? "dispositivo MIDI"}`, "ok");
    this.refresh(false);
  }

  private detach(): void {
    if (this.selected) this.selected.onmidimessage = null;
    this.selected = null;
  }

  private devices(): MIDIInput[] {
    return this.access ? [...this.access.inputs.values()] : [];
  }

  private refresh(autoSelect: boolean): void {
    const list = this.devices();
    if (autoSelect && !this.selected && list[0]) {
      this.select(list[0].id);
      return;
    }
    if (autoSelect && list.length === 0) {
      this.handlers.onStatus(
        "No se detectó ningún piano MIDI. Conéctalo por USB y vuelve a intentarlo.",
        "error",
      );
    }
    this.handlers.onDevices(
      list.map((d) => ({ id: d.id, name: d.name ?? "Dispositivo MIDI" })),
      this.selected?.id ?? null,
    );
  }

  private onStateChange(e: MIDIConnectionEvent): void {
    const port = e.port;
    if (!port || port.type !== "input") return;

    if (this.selected && port.id === this.selected.id && port.state === "disconnected") {
      const name = port.name ?? "el piano";
      this.detach();
      this.handlers.onStatus(`Se desconectó ${name}. Conéctalo de nuevo para seguir.`, "error");
      this.refresh(false);
      return;
    }
    if (!this.selected && port.state === "connected") {
      this.select(port.id);
      return;
    }
    this.refresh(false);
  }

  private onMessage(e: MIDIMessageEvent): void {
    const data = e.data;
    if (!data || data.length < 2) return;
    const status = (data[0] ?? 0) & 0xf0;
    const note = data[1] ?? 0;
    const velocity = data[2] ?? 0;
    if (status === 0x90 && velocity > 0) this.handlers.onNoteOn(note, velocity);
    else if (status === 0x80 || (status === 0x90 && velocity === 0)) this.handlers.onNoteOff(note);
  }
}
