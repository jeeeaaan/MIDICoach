import type { NoteEvent } from "./motor";
import type { ParsedSong, ParsedTrack } from "./midiFile";

/** "Himno a la alegría" (Beethoven, dominio público) con acordes en la mano izquierda. */
export function demoSong(): ParsedSong {
  const beat = 0.6;
  const mk = (track: number, midi: number, beats: number, dur: number): NoteEvent => ({
    midi,
    time: beats * beat,
    duration: dur * beat * 0.92,
    velocity: 0.8,
    track,
  });

  // [midi, inicio en tiempos, duración en tiempos]
  const melody: Array<[number, number, number]> = [
    [64, 0, 1], [64, 1, 1], [65, 2, 1], [67, 3, 1],
    [67, 4, 1], [65, 5, 1], [64, 6, 1], [62, 7, 1],
    [60, 8, 1], [60, 9, 1], [62, 10, 1], [64, 11, 1],
    [64, 12, 1.5], [62, 13.5, 0.5], [62, 14, 2],
  ];
  const chordC = [48, 52, 55];
  const chordG = [43, 50, 55];
  const chords: Array<[number[], number]> = [
    [chordC, 0], [chordG, 4], [chordC, 8], [chordG, 12],
  ];

  const right: ParsedTrack = {
    index: 0,
    name: "Mano derecha (melodía)",
    instrument: "acoustic grand piano",
    program: 0,
    percussion: false,
    noteCount: melody.length,
    notes: melody.map(([m, b, d]) => mk(0, m, b, d)),
  };
  const leftNotes = chords.flatMap(([ms, b]) => ms.map((m) => mk(1, m, b, 4)));
  const left: ParsedTrack = {
    index: 1,
    name: "Mano izquierda (acordes)",
    instrument: "string ensemble 1",
    program: 48,
    percussion: false,
    noteCount: leftNotes.length,
    notes: leftNotes,
  };

  // Batería sencilla: bombo en los tiempos pares, caja en los impares y hi-hat cada medio tiempo.
  const drumNotes: NoteEvent[] = [];
  for (let b = 0; b < 16; b++) {
    drumNotes.push(mk(2, b % 2 === 0 ? 36 : 38, b, 0.2));
    drumNotes.push(mk(2, 42, b, 0.1), mk(2, 42, b + 0.5, 0.1));
  }
  const drums: ParsedTrack = {
    index: 2,
    name: "Batería",
    instrument: "standard kit",
    program: 0,
    percussion: true,
    noteCount: drumNotes.length,
    notes: drumNotes,
  };

  return {
    name: "Himno a la alegría (prueba)",
    durationSec: 16 * beat,
    bpm: 100,
    totalNotes: right.noteCount + left.noteCount,
    tracks: [right, left],
    percussion: [drums],
  };
}
