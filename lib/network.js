// Thin wrapper around a WebSocket connection to the game's own /ws
// endpoint (see server.js). Owns nothing about game state — it just
// carries JSON messages back and forth and hands incoming ones to
// whoever set onMessage.
export class Network {
  constructor() {
    this.ws = null;
    this.onMessage = null;
    this.playerId = null;
    this.color = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      this.ws = ws;
      const onOpen = () => {
        ws.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        ws.removeEventListener("open", onOpen);
        reject(new Error("Could not connect to the multiplayer server."));
      };
      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onError, { once: true });
      ws.addEventListener("message", (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === "hosted" || msg.t === "joined") {
          this.playerId = msg.playerId;
          this.color = msg.color;
        }
        this.onMessage?.(msg);
      });
      ws.addEventListener("close", () => {
        this.onClose?.();
      });
    });
  }

  // Both resolve with the server's response payload and detach the
  // temporary listener before handing off to whatever sets onMessage
  // next (the game engine, once it's constructed with this connection).
  hostRoom(theme) {
    return new Promise((resolve, reject) => {
      this.onMessage = (msg) => {
        if (msg.t === "hosted") {
          this.onMessage = null;
          resolve(msg);
        } else if (msg.t === "error") {
          this.onMessage = null;
          reject(new Error(msg.message));
        }
      };
      this.send({ t: "host", theme });
    });
  }

  joinRoom(code) {
    return new Promise((resolve, reject) => {
      this.onMessage = (msg) => {
        if (msg.t === "joined") {
          this.onMessage = null;
          resolve(msg);
        } else if (msg.t === "error") {
          this.onMessage = null;
          reject(new Error(msg.message));
        }
      };
      this.send({ t: "join", code: code.toUpperCase() });
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
}
