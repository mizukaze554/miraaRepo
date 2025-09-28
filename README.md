# FuYus — Local Progressive Subtitles

## Overview
FuYus is a minimalist client-only app that extracts audio from a user-supplied video and transcribes it progressively in the browser using WASM models. UI is black & white with a jade accent.

## Setup
1. Place the project files on a static host (Netlify, GitHub Pages).
2. Put your whisper wasm wrapper files in `libs/`:
   - `libs/whisper.wasm` (required by your whisper wrapper)
   - optionally `libs/whisper.js` (init + transcribe wrappers)
3. Ensure `whisper.js` (if present) exposes:
   - `whisperInit(libsPath)` -> initialize model
   - `whisperTranscribePCM(ArrayBuffer pcm16le)` -> returns string transcription
   If your wasm build uses different API, update `whisper_worker.js` accordingly.

## How it works
- The UI accepts a video file.
- `ffmpeg.wasm` runs in the main thread and extracts 10-second WAV chunks (PCM16, 16k mono).
- Each chunk's `ArrayBuffer` is transferred to a WebWorker which calls the WASM model to transcribe.
- Transcription results are posted back and rendered progressively as subtitles.

## Deploy to Netlify
- Push repo to GitHub.
- In Netlify, create "New site from Git", select the repo.
- Build settings: none (static). Publish directory: root `/`.
- Upload the `libs/` folder as part of the repo (WASM files included).
