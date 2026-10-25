/**
 * Reloj musical pausable, en segundos.
 *
 * - `pause()/start()` congelan y reanudan sin perder la posición.
 * - `setCeiling(t)` impide que el tiempo pase de `t`: el reloj sigue "corriendo"
 *   por dentro pero `getTime()` queda clavado. Al cambiar el techo se re-ancla
 *   primero en la posición recortada, así al liberar continúa exactamente desde
 *   donde se detuvo, aunque el frame de animación llegue tarde.
 *
 * Este reloj debe ser la única fuente de tiempo para las notas visuales y para
 * cualquier audio (no se usan animaciones CSS como referencia).
 */
export class PausableClock {
  private base = 0;
  private startedAt: number | null = null;
  private ceiling = Infinity;
  private readonly now: () => number

  constructor(now: () => number = () => performance.now()) {
    this.now = now
  }

  get running(): boolean {
    return this.startedAt !== null;
  }

  getTime(): number {
    const raw =
      this.startedAt === null ? this.base : this.base + (this.now() - this.startedAt) / 1000;
    return Math.min(raw, this.ceiling);
  }

  atCeiling(): boolean {
    return this.getTime() >= this.ceiling - 1e-9;
  }

  start(): void {
    if (this.startedAt === null) this.startedAt = this.now();
  }

  pause(): void {
    if (this.startedAt === null) return;
    this.base = this.getTime();
    this.startedAt = null;
  }

  setCeiling(ceiling: number): void {
    this.rebase();
    this.ceiling = ceiling;
  }

  seek(time: number): void {
    this.base = time;
    if (this.startedAt !== null) this.startedAt = this.now();
  }

  reset(): void {
    this.base = 0;
    this.startedAt = null;
    this.ceiling = Infinity;
  }

  private rebase(): void {
    this.base = this.getTime();
    if (this.startedAt !== null) this.startedAt = this.now();
  }
}
