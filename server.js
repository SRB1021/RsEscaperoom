// A custom server is required for multiplayer: Next.js's own `next start`
// has nowhere to hang a WebSocket upgrade handler, so this wraps the
// normal Next.js request handling with a `ws` server on the same HTTP
// server/port. Rooms are kept in memory only — no database, no
// persistence across restarts, which is fine for ephemeral game lobbies.
const { createServer } = require("http");
const crypto = require("crypto");
const next = require("next");
const { WebSocketServer } = require("ws");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
const AVATAR_COLORS = ["#e05252", "#52a3e0", "#52e07a", "#e0c752", "#b552e0", "#e0824f", "#4fe0d0", "#e05fa8"];

/** @type {Map<string, { theme: string, stageIndex: number, state: object, players: Map<string, {ws: import('ws').WebSocket, color: string, x: number, z: number, yaw: number}> }>} */
const rooms = new Map();

function freshState() {
  return { hasTool: false, crateOpened: false, paintingMoved: false, safeOpen: false, hasKey: false };
}

function genCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(room, obj, exceptId) {
  const data = JSON.stringify(obj);
  for (const [id, p] of room.players) {
    if (id === exceptId) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  }
}

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res));
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    const playerId = crypto.randomUUID();
    let roomCode = null;

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.t === "host") {
        const code = genCode();
        const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
        const room = { theme: msg.theme, stageIndex: 0, state: freshState(), players: new Map() };
        room.players.set(playerId, { ws, color, x: 0, z: 3.6, yaw: 0 });
        rooms.set(code, room);
        roomCode = code;
        send(ws, { t: "hosted", code, playerId, color });
        return;
      }

      if (msg.t === "join") {
        const room = rooms.get(msg.code);
        if (!room) {
          send(ws, { t: "error", message: "Room not found. Check the code and try again." });
          return;
        }
        const color = AVATAR_COLORS[room.players.size % AVATAR_COLORS.length];
        roomCode = msg.code;
        const players = Array.from(room.players.entries()).map(([id, p]) => ({
          id,
          color: p.color,
          x: p.x,
          z: p.z,
          yaw: p.yaw,
        }));
        room.players.set(playerId, { ws, color, x: 0, z: 3.6, yaw: 0 });
        send(ws, {
          t: "joined",
          code: roomCode,
          theme: room.theme,
          stageIndex: room.stageIndex,
          state: room.state,
          players,
          playerId,
          color,
        });
        broadcast(room, { t: "playerJoined", id: playerId, color }, playerId);
        return;
      }

      const room = rooms.get(roomCode);
      if (!room || !room.players.has(playerId)) return;

      if (msg.t === "move") {
        const p = room.players.get(playerId);
        p.x = msg.x;
        p.z = msg.z;
        p.yaw = msg.yaw;
        broadcast(room, { t: "move", id: playerId, x: msg.x, z: msg.z, yaw: msg.yaw }, playerId);
        return;
      }

      if (msg.t === "action") {
        const kind = msg.kind;
        if (kind === "stageAdvance") {
          room.stageIndex += 1;
          room.state = freshState();
        } else if (kind === "win") {
          room.state.won = true;
        } else if (Object.prototype.hasOwnProperty.call(room.state, kind)) {
          room.state[kind] = true;
        }
        broadcast(room, { t: "action", kind, payload: msg.payload || null }, playerId);
      }
    });

    ws.on("close", () => {
      const room = rooms.get(roomCode);
      if (!room) return;
      room.players.delete(playerId);
      broadcast(room, { t: "playerLeft", id: playerId });
      if (room.players.size === 0) rooms.delete(roomCode);
    });
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`> Ready on port ${port} (${dev ? "development" : "production"})`);
  });
});
