# Mi Piano 🎹

A Progressive Web App (PWA) for practicing piano with MIDI files. The song pauses until you play the correct note or chord on your MIDI keyboard, allowing you to learn at your own pace.

## Features

- **MIDI file loading:** Practice with your own `.mid` or `.midi` files.
- **Interactive practice:** The song waits until you play the correct notes or chords before continuing.
- **Physical MIDI keyboard support:** Connect a compatible keyboard to detect the notes you play.
- **Playback controls:** Start, pause, resume, or restart a practice session.
- **Progress tracking:** Monitor your progress throughout the song.
- **Installable application:** Designed as a PWA that can be installed on compatible devices.

## Technologies

- TypeScript
- Vite
- HTML and CSS
- Web MIDI API
- Progressive Web App (PWA)

## Getting Started

Make sure you have [Node.js](https://nodejs.org/) installed.

1. Clone the repository or download the project.
2. Open a terminal in the project directory.
3. Install the dependencies:

   ```bash
   npm install
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open the URL displayed in your terminal in a compatible browser.

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts the development server. |
| `npm run build` | Checks TypeScript and builds the production version. |
| `npm run test` | Runs the automated tests. |
| `npm run typecheck` | Checks TypeScript types. |
| `npm run preview` | Previews the production build locally. |

## How to Use

1. Open Mi Piano in a compatible browser.
2. Connect your MIDI keyboard and grant access when prompted.
3. Load a MIDI file.
4. Select the song or track you want to practice, if track selection is available.
5. Start practicing and play the indicated notes or chords.
6. The song continues when you play the expected notes correctly.

## Requirements and Compatibility

- A browser compatible with the MIDI features used by the application.
- A physical MIDI keyboard for note detection during practice.
- Compatible MIDI files.

Web MIDI support depends on the browser and operating system. A compatible desktop browser is recommended.

## Project Status

This project is under development. Features such as adapting songs to the keyboard's playable range and improving audio playback may still be undergoing testing.

## Goal

The goal of Mi Piano is to provide a simple way to practice piano using MIDI songs, progressing note by note and allowing each player to learn at their own pace.
