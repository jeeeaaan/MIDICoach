import type { EngineSnapshot, NoteEvent, NoteGroup } from "./motor/types";
import { computeRange, layoutKeys } from "./keyboardLayout";
import type { KeyRect } from "./keyboardLayout";
import { noteName } from "./noteNames";

/** Segundos de canción visibles sobre el teclado. */
const LOOKAHEAD = 4;

const COLORS = {
  bg: "#0f1420",
  grid: "rgba(255,255,255,0.05)",
  done: "rgba(130,150,185,0.28)",
  upcoming: "#4aa3ff",
  pending: "#ffb020",
  matched: "#3ddc84",
  wrong: "#ff5a5f",
  pressed: "#9ad0ff",
  whiteKey: "#f4f6fa",
  blackKey: "#1a1f2b",
  keyBorder: "#8791a5",
  label: "#1a1f2b",
};

/** Dibuja las notas cayendo y el teclado en un solo canvas, a partir del tiempo del motor. */
export class Stage {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;

  private notes: NoteEvent[] = [];
  private groupOf = new Map<NoteEvent, number>();
  private maxDuration = 0;
  private range = computeRange([]);
  private keys: KeyRect[] = [];
  private byMidi = new Map<number, KeyRect>();

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D no disponible");
    this.ctx = ctx;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setNotes(notes: readonly NoteEvent[], groups: readonly NoteGroup[]): void {
    this.notes = [...notes].sort((a, b) => a.time - b.time);
    this.maxDuration = this.notes.reduce((m, n) => Math.max(m, n.duration), 0);
    this.groupOf = new Map();
    for (const g of groups) for (const n of g.notes) this.groupOf.set(n, g.index);
    this.range = computeRange(this.notes.map((n) => n.midi));
    this.relayout();
  }

  /** Devuelve la nota MIDI de la tecla bajo el puntero, o null si no está sobre el teclado. */
  keyAt(clientX: number, clientY: number): number | null {
    const r = this.canvas.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const kbH = this.keyboardHeight();
    const top = this.h - kbH;
    if (y < top || y > this.h || x < 0 || x > this.w) return null;
    const blackBottom = top + kbH * 0.62;
    if (y <= blackBottom) {
      const hit = this.keys.find((k) => k.black && x >= k.x && x <= k.x + k.w);
      if (hit) return hit.midi;
    }
    return this.keys.find((k) => !k.black && x >= k.x && x < k.x + k.w)?.midi ?? null;
  }

  render(
    snap: EngineSnapshot | null,
    pressed: ReadonlySet<number>,
    wrongUntil: ReadonlyMap<number, number>,
    nowMs: number,
  ): void {
    const { ctx, w, h } = this;
    const kbH = this.keyboardHeight();
    const notesH = h - kbH;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, notesH);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (const k of this.keys) {
      if (k.midi % 12 === 0 || k.midi % 12 === 5) {
        ctx.beginPath();
        ctx.moveTo(Math.round(k.x) + 0.5, 0);
        ctx.lineTo(Math.round(k.x) + 0.5, notesH);
        ctx.stroke();
      }
    }

    const current = snap?.groupIndex ?? 0;
    const pending = new Set(snap?.pendingMidis ?? []);
    const matched = new Set(snap?.matchedMidis ?? []);

    if (snap) this.drawNotes(snap.time, notesH, current, matched);
    this.drawKeyboard(notesH, kbH, pending, matched, pressed, wrongUntil, nowMs);

    if (snap?.state === "waiting") {
      ctx.fillStyle = COLORS.pending;
      ctx.fillRect(0, notesH - 2, w, 2);
    }
  }

  // ---- internos ----

  private drawNotes(time: number, notesH: number, current: number, matched: Set<number>): void {
    const { ctx, w } = this;
    const pps = notesH / LOOKAHEAD;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, notesH);
    ctx.clip();

    // Primera nota que aún puede ser visible (las notas están ordenadas por inicio).
    let lo = 0;
    let hi = this.notes.length;
    const minStart = time - this.maxDuration;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.notes[mid]?.time ?? 0) < minStart) lo = mid + 1;
      else hi = mid;
    }

    for (let i = lo; i < this.notes.length; i++) {
      const n = this.notes[i]!;
      if (n.time > time + LOOKAHEAD) break;
      const key = this.byMidi.get(n.midi);
      if (!key) continue;

      const bottom = notesH - (n.time - time) * pps;
      const height = Math.max(6, n.duration * pps);
      const top = bottom - height;
      if (bottom < 0 || top > notesH) continue;

      const gi = this.groupOf.get(n) ?? 0;
      let color = COLORS.upcoming;
      if (gi < current) color = COLORS.done;
      else if (gi === current) color = matched.has(n.midi) ? COLORS.matched : COLORS.pending;

      ctx.fillStyle = color;
      this.roundRect(key.x + 1, top, key.w - 2, height - 1.5, 4);
    }
    ctx.restore();
  }

  private drawKeyboard(
    top: number,
    kbH: number,
    pending: Set<number>,
    matched: Set<number>,
    pressed: ReadonlySet<number>,
    wrongUntil: ReadonlyMap<number, number>,
    nowMs: number,
  ): void {
    const { ctx } = this;
    const fillFor = (midi: number, base: string): string => {
      if ((wrongUntil.get(midi) ?? 0) > nowMs) return COLORS.wrong;
      if (matched.has(midi)) return COLORS.matched;
      if (pending.has(midi)) return COLORS.pending;
      if (pressed.has(midi)) return COLORS.pressed;
      return base;
    };

    const labelSize = (k: KeyRect) => Math.max(8, Math.min(12, k.w * 0.42));
    const label = (k: KeyRect, y: number, color: string) => {
      if (k.w < 14) return;
      ctx.fillStyle = color;
      ctx.font = `600 ${labelSize(k)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(noteName(k.midi), k.x + k.w / 2, y);
    };

    for (const k of this.keys) {
      if (k.black) continue;
      ctx.fillStyle = fillFor(k.midi, COLORS.whiteKey);
      ctx.fillRect(k.x, top, k.w, kbH);
      ctx.strokeStyle = COLORS.keyBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(k.x + 0.5, top + 0.5, k.w - 1, kbH - 1);
      if (pending.has(k.midi) || matched.has(k.midi) || k.midi % 12 === 0) {
        label(k, top + kbH - 8, COLORS.label);
      }
    }
    const blackH = kbH * 0.62;
    for (const k of this.keys) {
      if (!k.black) continue;
      ctx.fillStyle = fillFor(k.midi, COLORS.blackKey);
      ctx.fillRect(k.x, top, k.w, blackH);
      ctx.strokeStyle = "#000";
      ctx.strokeRect(k.x + 0.5, top + 0.5, k.w - 1, blackH - 1);
      if (pending.has(k.midi) || matched.has(k.midi)) label(k, top + blackH - 6, COLORS.label);
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  }

  private keyboardHeight(): number {
    return Math.min(170, Math.max(84, this.h * 0.26));
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.relayout();
  }

  private relayout(): void {
    this.keys = layoutKeys(this.range.lo, this.range.hi, this.w).keys;
    this.byMidi = new Map(this.keys.map((k) => [k.midi, k]));
  }
}
