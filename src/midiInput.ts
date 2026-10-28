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

export type MidiMessage = { type: "on" | "off"; note: number; velocity: number };

/**
 * Interpreta un mensaje MIDI crudo. Note On con velocidad 0 equivale a Note Off.
 * Ignora todo lo que no sea nota (control, pitch bend, reloj, etc.) y mensajes incompletos.
 */
export function parseMidiMessage(data: ArrayLike<number> | null | undefined): MidiMessage | null {
  if (!data || data.length < 2) return null;
  const status = (data[0] ?? 0) & 0xf0;
  const note = data[1] ?? 0;
  const velocity = data[2] ?? 0;
  if (status === 0x90 && velocity > 0) return { type: "on", note, velocity };
  if (status === 0x80 || (status === 0x90 && velocity === 0)) return { type: "off", note, velocity };
  return null;
}

/** Envoltorio de la Web MIDI API para detectar teclas pulsadas y liberadas (RF-03). */
export class MidiInput {
  private access: MIDIAccess | null = null;
  private selected: MIDIInput | null = null;
  private readonly handlers: MidiInputHandlers;
  private readonly requestAccess: () => Promise<MIDIAccess>;
  private readonly injected: boolean;

  /** `requestAccess` es inyectable para pruebas; por defecto usa la API del navegador. */
  constructor(handlers: MidiInputHandlers, requestAccess?: () => Promise<MIDIAccess>) {
    this.handlers = handlers;
    this.injected = requestAccess !== undefined;
    this.requestAccess = requestAccess ?? (() => navigator.requestMIDIAccess({ sysex: false }));
  }

  static supported(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
  }

  /** Debe llamarse desde un gesto del usuario: el navegador pide permiso. */
  async connect(): Promise<void> {
    if (!this.injected && !MidiInput.supported()) {
      this.handlers.onStatus(
        "Este navegador no admite Web MIDI. Usa Chrome o Edge en una computadora.",
        "error",
      );
      return;
    }
    if (this.access) {
      // Ya hay permiso: solo se vuelve a leer la lista de dispositivos.
      this.refresh(true);
      return;
    }
    try {
      this.access = await this.requestAccess();
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
    if (!input) {
      this.handlers.onStatus("Ese dispositivo ya no está disponible.", "error");
      this.refresh(false);
      return;
    }
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
      // Si queda otro piano, se usa: así la lista no muestra uno que en realidad no está conectado.
      const other = this.devices().find((d) => d.id !== port.id && d.state !== "disconnected");
      if (other) {
        this.select(other.id);
        return;
      }
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
    const msg = parseMidiMessage(e.data);
    if (!msg) return;
    if (msg.type === "on") this.handlers.onNoteOn(msg.note, msg.velocity);
    else this.handlers.onNoteOff(msg.note);
  }
}
