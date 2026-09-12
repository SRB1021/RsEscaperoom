# Vantage Point — Online Escape Room

A first-person escape room that runs entirely in the browser. Nowhere you
actually are — but between the mouse-look, footsteps, flickering desk lamp,
and a locked door standing between you and the exit, it's built to feel like
you're really standing in the room.

No native app, no downloads, no external assets: every texture is drawn on
a `<canvas>` at load time and every sound effect is synthesized with the Web
Audio API, so the game starts instantly and works offline once loaded.

## Play

- **Mouse** — look around
- **WASD** — move
- **E** — interact with whatever's under the crosshair
- **Esc** — release the cursor (click the screen to grab it again)

You wake up in a locked study. Read the note, find the clue, crack the
safe, and get out.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Click into the scene once to lock the mouse
pointer (required by browsers before mouse-look can work).

## Deploy to Render

This repo includes a `render.yaml` Blueprint, so Render can build and host
it with no extra configuration:

1. Push this repo to GitHub (already done if you're reading this from the
   remote).
2. In the Render dashboard, choose **New → Blueprint** and point it at this
   repository. Render will read `render.yaml` and create a Web Service
   automatically.
3. Alternatively, create the service manually: **New → Web Service**,
   select this repo, and set:
   - **Build Command:** `npm ci && npm run build`
   - **Start Command:** `npm start`
   - **Runtime:** Node

`next start` automatically binds to the `PORT` environment variable Render
provides, so no extra config is needed.

## How it's built

- `lib/gameEngine.js` — the Three.js scene, first-person controls,
  collision, raycast-based interaction, and puzzle state, wrapped in a
  plain class so it's framework-agnostic.
- `lib/textures.js` — procedural canvas textures (floor, walls, books,
  notes, the safe's dial, etc.).
- `lib/audio.js` — procedural sound effects (footsteps, clicks, unlocks,
  an ambient room tone) via the Web Audio API.
- `components/EscapeRoom.js` — the React shell: mounts the engine, renders
  the HUD (crosshair, prompts, inventory, note/keypad modals, win screen).
