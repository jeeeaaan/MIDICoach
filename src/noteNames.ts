const NAMES = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
const BLACK = new Set([1, 3, 6, 8, 10]);

/** Nombre en solfeo con octava científica: 60 → "Do4". */
export function noteName(midi: number): string {
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function isBlackKey(midi: number): boolean {
  return BLACK.has(midi % 12);
}
