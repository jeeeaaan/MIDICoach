import { groupNotes } from "./chords";
import { PausableClock } from "./clock";
import type { EngineSnapshot, EngineState, NoteEvent, NoteGroup } from "./types";

export interface ListenEngineOptions {
  groupToleranceMs?: number;
  now?: () => number;
}

export class ListenEngine {
  readonly groups: NoteGroup[];
  readonly totalNotes: number;

  private readonly clock: PausableClock;
  private readonly duration: number;
  private readonly completedByGroup: number[];
  private state: EngineState = "idle";
  private index = 0;

  constructor(notes: readonly NoteEvent[], durationSec: number, options: ListenEngineOptions = {}) {
    this.groups = groupNotes(notes, (options.groupToleranceMs ?? 30) / 1000);
    this.totalNotes = notes.length;
    this.duration = Math.max(0, durationSec);
    this.clock = new PausableClock(options.now ?? (() => performance.now()));
    this.clock.setCeiling(this.duration);

    let completed = 0;
    this.completedByGroup = this.groups.map((group) => {
      completed += group.notes.length;
      return completed;
    });
  }

  start(): void {
    if (this.state !== "idle") return;
    this.clock.start();
    this.state = "running";
    this.update();
  }

  pause(): void {
    if (this.state !== "running") return;
    this.clock.pause();
    this.state = "paused";
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.clock.start();
    this.state = "running";
    this.update();
  }

  reset(): void {
    this.clock.reset();
    this.clock.setCeiling(this.duration);
    this.index = 0;
    this.state = "idle";
  }

  seek(time: number): void {
    const target = Math.min(this.duration, Math.max(0, time));
    this.clock.seek(target);
    this.syncGroups();

    if (target >= this.duration) {
      this.clock.pause();
      this.state = "finished";
    } else if (this.state === "finished") {
      this.state = "paused";
    }
  }

  update(): void {
    if (this.state !== "running") return;
    if (this.clock.atCeiling()) {
      this.clock.pause();
      this.state = "finished";
    }
    this.syncGroups();
  }

  getSnapshot(): EngineSnapshot {
    this.syncGroups();
    const group = this.groups[this.index] ?? null;
    const time = this.clock.getTime();
    const completedNotes = this.completedByGroup[this.index - 1] ?? 0;
    return {
      state: this.state,
      time,
      groupIndex: this.index,
      totalGroups: this.groups.length,
      completedNotes,
      totalNotes: this.totalNotes,
      progress: this.duration === 0 ? 1 : time / this.duration,
      errors: 0,
      currentGroup: group,
      pendingMidis: [],
      matchedMidis: [],
    };
  }

  private syncGroups(): void {
    const time = this.clock.getTime();
    let lo = 0;
    let hi = this.groups.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.groups[mid]!.time <= time) lo = mid + 1;
      else hi = mid;
    }
    this.index = lo;
  }
}
