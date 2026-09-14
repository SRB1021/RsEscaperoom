# Vantage Point — Online Escape Room

A first-person escape room that runs entirely in the browser. Nowhere you
actually are — but between the mouse-look, footsteps, flickering lights,
and a locked door standing between you and the exit, it's built to feel like
you're really standing in the room.

No native app, no downloads, no external assets: every texture is drawn on
a `<canvas>` at load time and every sound effect is synthesized with the Web
Audio API, so the game starts instantly and works offline once loaded.

Each room is dressed like a physical escape-room build rather than a bare
box: a practical lantern prop is the actual light source (not a floating
glow), plus crates, barrels, wall-mounted tools, and hanging chains
scattered around for clutter and set dressing.

## Rooms

Pick a theme from the menu — each is a sequence of **3 rooms**, not just
one. Every room has its own year-code split across two clues (a plaque
near the desk, a stenciled tag on the crate across the room), its own
hidden lockbox and key, and its own door — clearing one drops you into
the next with a fresh code, so solving the whole theme means doing the
puzzle three times over.

- **Runaway Train** (Cars 7 → 9) — a train nobody's driving, complete
  with a subtle rail-motion camera shake and wheel clack.
- **Abandoned Mine Shaft** (Levels 1 → 3) — a sealed shaft lit mostly by
  the lantern clipped to your own helmet, which follows wherever you look.
- **Self-Destruct Submarine** (Compartments 1 → 3) — flashing red
  emergency lighting and a periodic klaxon while you race to the escape
  hatch.
- **Medieval Castle Escape** (Outer → Middle → Vault Chamber) — a
  torch-lit keep with a portcullis standing between you and the outside.

## Play

- **Mouse** — look around
- **WASD** or **Arrow keys** — move
- **E** — interact with whatever's under the crosshair
- **Esc** — release the cursor (click the screen to grab it again)

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
  plain class so it's framework-agnostic. Takes a theme object and builds
  each room (stage) from it; unlocking a non-final door tears down and
  rebuilds the stage-specific props (desk/crate/painting/safe/door) with
  the next code while keeping the room shell, camera, and lighting.
- `lib/themes.js` — the four theme definitions: textures, colors, prop
  labels, note/plaque text, a `codes` array (one 4-digit code per room),
  `stageLabels`, a `lampPosition` for the practical light prop, a `decor`
  list (crates/barrels/wall tools/chains) for set dressing, and an
  `ambiance` flag (shake, headlamp, alarm, torches) the engine uses for
  per-theme effects.
- `lib/textures.js` — procedural canvas textures (floor, walls, notes,
  plaques, the safe's dial, etc.), parametrized by theme color.
- `lib/audio.js` — procedural sound effects (footsteps, clicks, unlocks,
  a klaxon, rail clacks, an ambient room tone) via the Web Audio API.
- `components/EscapeRoom.js` — the React shell: room-picker menu, mounts
  the engine, renders the HUD (crosshair, prompts, inventory, note/keypad
  modals, win screen).
