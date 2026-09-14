# Vantage Point — Online Escape Room

A first-person escape room that runs entirely in the browser. Nowhere you
actually are — but between the mouse-look, footsteps, flickering lights,
and a locked door standing between you and the exit, it's built to feel like
you're really standing in the room.

No native app, no downloads, no external assets: every texture is drawn on
a `<canvas>` at load time, so the game starts instantly and works offline
once loaded. Sound effects exist in the code (procedural, via the Web
Audio API) but are currently disabled — the game plays silently.

Each room has both real architecture for its setting (train windows and
an overhead luggage rail, mine support beams and corner posts, submarine
portholes and ceiling pipes, a castle archway and arrow-slit windows) and
physical set dressing: a practical lantern prop as the actual light
source (not a floating glow), plus crates, barrels, wall-mounted tools,
and hanging chains.

## Rooms

Pick a theme from the menu — each is a sequence of **3 rooms**, not just
one, and each room's puzzle has several scattered parts, not just "read
two numbers": find a tool hidden somewhere in the room and use it to
force open a crate that's otherwise sealed; separately, find a fuse
(or battery / power cell / rune stone, depending on the theme) to power
the safe before it'll even respond; move a painting aside to find that
safe; combine the crate's number with a second one on a plaque near the
desk to crack it; take the key inside; use it on the door. Clearing a
door drops you into the next room with everything reset and a fresh
code, so solving the whole theme means doing all of this three times
over. Press **H** any time for a nudge in the right direction (it won't
just hand you the answer).

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
- **H** — get a hint
- **Esc** — release the cursor (click the screen to grab it again)

## Multiplayer

From the front screen, choose **Host a Room** (pick a theme, get a short
code to share) or **Join a Room** (enter someone else's code). Progress is
shared co-op — whoever on the team finds the tool, cracks the safe, or
unlocks a door, everyone sees it and moves on together. Other players
appear in the room as simple colored capsule-and-sphere avatars (basic
shapes, not modeled characters) that move and turn in real time. Rooms
are ephemeral and kept in server memory only — no accounts, no
persistence, and a room disappears once everyone in it disconnects.

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

Multiplayer needs a real, persistent server process to hold WebSocket
connections and in-memory room state — `next start`'s built-in server has
nowhere to hang a WebSocket handler, so `npm start`/`npm run dev` now run
`server.js`, a thin wrapper that serves the normal Next.js app and a `ws`
WebSocket server (path `/ws`) off the same HTTP server/port. Render's Web
Services are persistent Node processes that support WebSocket upgrades
natively, so this needs no extra Render configuration — `server.js`
already binds to `process.env.PORT`.

## How it's built

- `lib/gameEngine.js` — the Three.js scene, first-person controls,
  collision, raycast-based interaction, and puzzle state, wrapped in a
  plain class so it's framework-agnostic. Takes a theme object and builds
  the room's fixed architecture once, then each stage's puzzle props
  (desk/crate/tool/painting/safe/door) into a disposable group that's torn
  down and rebuilt with a fresh code on every non-final door. Also has
  `getHint()`, which reads the current puzzle state to nudge toward the
  next step without giving away the answer.
- `lib/themes.js` — the four theme definitions: textures, colors, prop
  labels, note/plaque/tool text, a `codes` array (one 4-digit code per
  room), `stageLabels`, a `lampPosition` for the practical light prop, a
  `decor` list (crates/barrels/wall tools/chains) for set dressing, and an
  `ambiance` flag (shake, headlamp, alarm, torches) the engine uses for
  per-theme effects.
- `lib/textures.js` — procedural canvas textures (floor, walls, notes,
  plaques, the safe's dial, etc.), parametrized by theme color.
- `lib/audio.js` — procedural sound effect generators (currently unused —
  `audio.init()` is never called, so every method's `if (!this.ctx)
  return;` guard makes it a no-op).
- `components/EscapeRoom.js` — the React shell: the solo/host/join menu
  flow, mounts the engine, renders the HUD (crosshair, prompts, inventory,
  hint button, note/keypad modals, win screen).
- `server.js` — a custom Node server: Next.js's own request handler plus a
  `ws` WebSocket server on the same port (path `/ws`). Holds rooms in
  memory only (`code -> { theme, stageIndex, state, players }`); a
  connecting client either creates a room (`host`) or joins one by code
  (`join`), then exchanges `move` (position/rotation) and `action`
  (shared puzzle state changes) messages, relayed to every other player
  in the same room.
- `lib/network.js` — a thin client-side WebSocket wrapper the engine uses
  to send/receive those same messages.

## Performance notes

Rendering uses `MeshLambertMaterial` throughout rather than
`MeshStandardMaterial` — with several real-time point lights per room,
full PBR shading was the single biggest GPU cost and caused visible frame
drops on anything but a high-end GPU. Antialiasing is off and the device
pixel ratio is capped at 1.5 for the same reason.
