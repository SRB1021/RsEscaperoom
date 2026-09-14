"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { EscapeRoomGame } from "../lib/gameEngine";
import { Network } from "../lib/network";
import { THEMES } from "../lib/themes";

function formatTime(totalSeconds) {
  const s = Math.floor(totalSeconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function EscapeRoom() {
  const mountRef = useRef(null);
  const engineRef = useRef(null);
  const networkRef = useRef(null);
  const pendingSnapshotRef = useRef(null);
  const toastTimer = useRef(null);

  const [menuMode, setMenuMode] = useState("root"); // root | theme | themeHost | join
  const [theme, setTheme] = useState(null);
  const [started, setStarted] = useState(false);
  const [locked, setLocked] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const [toast, setToast] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [note, setNote] = useState({ open: false, lines: [] });
  const [keypad, setKeypad] = useState({ open: false, digits: "", shake: false });
  const [win, setWin] = useState(null);
  const [stage, setStage] = useState({ index: 0, total: 1, label: "" });
  const [lobbyCode, setLobbyCode] = useState(null);
  const [joinCodeValue, setJoinCodeValue] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState(null);

  useEffect(() => {
    if (!theme || !mountRef.current) return;

    const engine = new EscapeRoomGame(
      mountRef.current,
      theme,
      {
        onLockChange: setLocked,
        onPrompt: setPrompt,
        onToast: (text) => {
          setToast(text);
          clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), 2800);
        },
        onNote: (open, lines) => setNote({ open, lines: lines || [] }),
        onKeypad: (open) => setKeypad((k) => ({ ...k, open, shake: false })),
        onKeypadDigits: (digits) => setKeypad((k) => ({ ...k, digits })),
        onKeypadShake: () => {
          setKeypad((k) => ({ ...k, shake: true }));
          setTimeout(() => setKeypad((k) => ({ ...k, shake: false })), 400);
        },
        onInventory: setInventory,
        onWin: (seconds) => setWin(seconds),
        onStage: (index, total, label) => setStage({ index, total, label }),
      },
      networkRef.current
    );
    engineRef.current = engine;
    engine.start();

    if (pendingSnapshotRef.current) {
      engine.applyJoinSnapshot(pendingSnapshotRef.current);
      pendingSnapshotRef.current = null;
    }

    return () => {
      clearTimeout(toastTimer.current);
      engine.dispose();
      engineRef.current = null;
    };
  }, [theme]);

  const handleEnter = useCallback(() => {
    setStarted(true);
    engineRef.current?.lock();
  }, []);

  const resetToRoot = useCallback(() => {
    networkRef.current?.disconnect();
    networkRef.current = null;
    pendingSnapshotRef.current = null;
    setWin(null);
    setInventory([]);
    setStarted(false);
    setTheme(null);
    setStage({ index: 0, total: 1, label: "" });
    setLobbyCode(null);
    setJoinCodeValue("");
    setConnectError(null);
    setMenuMode("root");
  }, []);

  const handlePickTheme = useCallback(async (t, asHost) => {
    if (!asHost) {
      setTheme(t);
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      const net = new Network();
      await net.connect();
      const res = await net.hostRoom(t.id);
      networkRef.current = net;
      setLobbyCode(res.code);
      setTheme(t);
    } catch (err) {
      setConnectError(err.message || "Could not host a room.");
    } finally {
      setConnecting(false);
    }
  }, []);

  const handleJoinSubmit = useCallback(async () => {
    if (joinCodeValue.trim().length < 4) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const net = new Network();
      await net.connect();
      const res = await net.joinRoom(joinCodeValue.trim());
      const t = THEMES.find((th) => th.id === res.theme);
      if (!t) throw new Error("That room's theme isn't recognized.");
      networkRef.current = net;
      pendingSnapshotRef.current = res;
      setLobbyCode(res.code);
      setTheme(t);
    } catch (err) {
      setConnectError(err.message || "Could not join that room.");
    } finally {
      setConnecting(false);
    }
  }, [joinCodeValue]);

  const showResumeOverlay = started && !locked && !note.open && !keypad.open && !win;

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#000", fontFamily: "system-ui, sans-serif" }}>
      {theme && <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />}

      {theme && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)",
          }}
        />
      )}

      {locked && !win && (
        <>
          <div style={crosshairStyle} />
          {(stage.total > 1 || lobbyCode) && (
            <div style={stageBadgeStyle}>
              {stage.total > 1 ? `${stage.label} · Room ${stage.index + 1} of ${stage.total}` : theme?.name}
              {lobbyCode ? ` · Code: ${lobbyCode}` : ""}
            </div>
          )}
          {prompt && <div style={promptStyle}>{prompt}</div>}
          {inventory.length > 0 && (
            <div style={inventoryStyle}>
              {inventory.map((item, i) => (
                <div key={item + i} style={inventoryItemStyle}>
                  🔑 {item}
                </div>
              ))}
            </div>
          )}
          <button style={hintButtonStyle} onClick={() => engineRef.current?.showHint()}>
            💡 Hint <span style={{ opacity: 0.6 }}>(H)</span>
          </button>
          <div style={controlsHintStyle}>WASD / Arrows move · mouse look · E interact · H hint · Esc release</div>
        </>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}

      {!theme && menuMode === "root" && (
        <Overlay wide>
          <h1 style={titleStyle}>VANTAGE POINT</h1>
          <p style={subtitleStyle}>
            An online escape room. Nowhere you actually are — but for the next
            few minutes, it'll feel like you're standing right in it.
          </p>
          <div style={rootChoiceStyle}>
            <button style={buttonStyle} onClick={() => setMenuMode("theme")}>
              Play Solo
            </button>
            <button style={buttonStyle} onClick={() => setMenuMode("themeHost")}>
              Host a Room
            </button>
            <button style={buttonStyle} onClick={() => setMenuMode("join")}>
              Join a Room
            </button>
          </div>
          <ul style={legendStyle}>
            <li><b>WASD</b> or <b>Arrow keys</b> — move</li>
            <li><b>Mouse</b> — look around</li>
            <li><b>E</b> — interact with what you're looking at</li>
            <li><b>H</b> — stuck? get a hint</li>
            <li><b>Esc</b> — release the cursor</li>
          </ul>
        </Overlay>
      )}

      {!theme && (menuMode === "theme" || menuMode === "themeHost") && (
        <Overlay wide>
          <h1 style={titleStyle}>{menuMode === "themeHost" ? "HOST A ROOM" : "PICK A ROOM"}</h1>
          <p style={subtitleStyle}>
            {menuMode === "themeHost"
              ? "Choose a theme — you'll get a code to share once the room is created."
              : "Each is a sequence of 3 rooms, not just one."}
          </p>
          {connectError && <p style={errorTextStyle}>{connectError}</p>}
          <div style={themeGridStyle}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                style={themeCardStyle}
                disabled={connecting}
                onClick={() => handlePickTheme(t, menuMode === "themeHost")}
              >
                <div style={themeCardTitleStyle}>{t.name}</div>
                <div style={themeCardTaglineStyle}>{t.tagline}</div>
              </button>
            ))}
          </div>
          <button style={linkButtonStyle} onClick={() => setMenuMode("root")} disabled={connecting}>
            {connecting ? "Connecting…" : "← Back"}
          </button>
        </Overlay>
      )}

      {!theme && menuMode === "join" && (
        <Overlay>
          <h1 style={titleStyle}>JOIN A ROOM</h1>
          <p style={subtitleStyle}>Enter the code your host shared with you.</p>
          {connectError && <p style={errorTextStyle}>{connectError}</p>}
          <input
            style={codeInputStyle}
            value={joinCodeValue}
            maxLength={5}
            placeholder="ABCDE"
            onChange={(e) => setJoinCodeValue(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleJoinSubmit()}
          />
          <button style={buttonStyle} onClick={handleJoinSubmit} disabled={connecting}>
            {connecting ? "Joining…" : "Join"}
          </button>
          <button style={linkButtonStyle} onClick={() => setMenuMode("root")} disabled={connecting}>
            ← Back
          </button>
        </Overlay>
      )}

      {theme && !started && (
        <Overlay>
          <h1 style={titleStyle}>{theme.name.toUpperCase()}</h1>
          <p style={subtitleStyle}>{theme.tagline}</p>
          <p style={{ ...subtitleStyle, marginTop: -16, fontSize: 13, color: "#8a8478" }}>
            {theme.stageLabels.length} rooms to get through, each with its own lock.
          </p>
          {lobbyCode && (
            <p style={{ ...subtitleStyle, marginTop: -12, fontSize: 14, color: "#f0d78c" }}>
              Room code: <b>{lobbyCode}</b> — share it so others can join.
            </p>
          )}
          <button style={buttonStyle} onClick={handleEnter}>
            Click to step inside
          </button>
          <button style={linkButtonStyle} onClick={resetToRoot}>
            ← Choose a different room
          </button>
        </Overlay>
      )}

      {showResumeOverlay && (
        <Overlay onClick={handleEnter} dim>
          <p style={{ ...subtitleStyle, marginBottom: 0 }}>Click to resume</p>
        </Overlay>
      )}

      {note.open && (
        <Overlay>
          <div style={paperStyle}>
            {note.lines.map((line, i) => (
              <p key={i} style={{ margin: "0 0 10px", fontStyle: line.startsWith('"') ? "italic" : "normal" }}>
                {line}
              </p>
            ))}
            <button
              style={{ ...buttonStyle, marginTop: 20 }}
              onClick={() => engineRef.current?.closeNote()}
            >
              Close
            </button>
          </div>
        </Overlay>
      )}

      {keypad.open && (
        <Overlay>
          <div style={keypadPanelStyle}>
            <div style={{ ...keypadDisplayStyle, animation: keypad.shake ? "shake 0.4s" : "none" }}>
              {keypad.digits.padEnd(4, "_").split("").join(" ")}
            </div>
            <div style={keypadGridStyle}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} style={keyBtnStyle} onClick={() => engineRef.current?.keypadPress(d)}>
                  {d}
                </button>
              ))}
              <button style={keyBtnStyle} onClick={() => engineRef.current?.keypadClear()}>C</button>
              <button style={keyBtnStyle} onClick={() => engineRef.current?.keypadPress("0")}>0</button>
              <button style={{ ...keyBtnStyle, background: "#3a6b4a" }} onClick={() => engineRef.current?.keypadSubmit()}>
                ✓
              </button>
            </div>
            <button
              style={{ ...buttonStyle, marginTop: 18 }}
              onClick={() => engineRef.current?.closeKeypad()}
            >
              Close
            </button>
          </div>
        </Overlay>
      )}

      {win && (
        <Overlay>
          <h1 style={titleStyle}>YOU ESCAPED</h1>
          <p style={subtitleStyle}>Total time: {formatTime(win)}</p>
          <button style={buttonStyle} onClick={resetToRoot}>
            Choose another room
          </button>
        </Overlay>
      )}

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}

function Overlay({ children, onClick, dim, wide }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: dim ? "rgba(0,0,0,0.35)" : "rgba(5,4,8,0.92)",
        color: "#eee8de",
        textAlign: "center",
        cursor: onClick ? "pointer" : "default",
        padding: 24,
        overflowY: "auto",
      }}
    >
      <div style={{ maxWidth: wide ? 760 : 480, width: "100%" }}>{children}</div>
    </div>
  );
}

const crosshairStyle = {
  position: "absolute",
  top: "50%",
  left: "50%",
  width: 6,
  height: 6,
  marginTop: -3,
  marginLeft: -3,
  borderRadius: "50%",
  background: "rgba(255,255,255,0.85)",
  boxShadow: "0 0 4px rgba(0,0,0,0.6)",
  pointerEvents: "none",
};

const stageBadgeStyle = {
  position: "absolute",
  top: 18,
  left: "50%",
  transform: "translateX(-50%)",
  color: "#eee8de",
  background: "rgba(0,0,0,0.5)",
  padding: "6px 16px",
  borderRadius: 20,
  fontSize: 13,
  letterSpacing: 0.5,
  pointerEvents: "none",
  whiteSpace: "nowrap",
};

const promptStyle = {
  position: "absolute",
  top: "56%",
  left: "50%",
  transform: "translateX(-50%)",
  color: "#fff",
  background: "rgba(0,0,0,0.5)",
  padding: "6px 14px",
  borderRadius: 6,
  fontSize: 15,
  letterSpacing: 0.3,
  pointerEvents: "none",
};

const inventoryStyle = {
  position: "absolute",
  bottom: 20,
  left: 20,
  display: "flex",
  gap: 10,
};

const inventoryItemStyle = {
  background: "rgba(0,0,0,0.55)",
  color: "#f0d78c",
  padding: "8px 14px",
  borderRadius: 8,
  fontSize: 14,
  border: "1px solid rgba(240,215,140,0.4)",
};

const hintButtonStyle = {
  position: "absolute",
  bottom: 46,
  right: 20,
  background: "rgba(0,0,0,0.55)",
  color: "#f0d78c",
  border: "1px solid rgba(240,215,140,0.4)",
  padding: "8px 14px",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
};

const controlsHintStyle = {
  position: "absolute",
  bottom: 18,
  right: 20,
  color: "rgba(255,255,255,0.55)",
  fontSize: 12,
  letterSpacing: 0.3,
};

const toastStyle = {
  position: "absolute",
  bottom: 80,
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(0,0,0,0.7)",
  color: "#fff",
  padding: "10px 20px",
  borderRadius: 8,
  fontSize: 15,
};

const titleStyle = {
  fontSize: 38,
  letterSpacing: 4,
  margin: "0 0 12px",
  fontWeight: 700,
};

const subtitleStyle = {
  maxWidth: 480,
  lineHeight: 1.5,
  color: "#bcb4a8",
  marginBottom: 24,
  marginLeft: "auto",
  marginRight: "auto",
};

const buttonStyle = {
  background: "#caa15a",
  color: "#231a0f",
  border: "none",
  padding: "12px 28px",
  borderRadius: 8,
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
};

const linkButtonStyle = {
  display: "block",
  margin: "18px auto 0",
  background: "none",
  border: "none",
  color: "#8a8478",
  fontSize: 14,
  cursor: "pointer",
  textDecoration: "underline",
};

const legendStyle = {
  listStyle: "none",
  padding: 0,
  marginTop: 28,
  color: "#8a8478",
  fontSize: 14,
  lineHeight: 2,
};

const rootChoiceStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  alignItems: "center",
};

const errorTextStyle = {
  color: "#e08a8a",
  fontSize: 14,
  marginTop: -14,
  marginBottom: 18,
};

const codeInputStyle = {
  display: "block",
  margin: "0 auto 18px",
  width: 180,
  padding: "12px 16px",
  fontSize: 22,
  letterSpacing: 6,
  textAlign: "center",
  textTransform: "uppercase",
  borderRadius: 8,
  border: "1px solid rgba(202,161,90,0.4)",
  background: "rgba(255,255,255,0.06)",
  color: "#eee8de",
};

const themeGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
  margin: "0 0 8px",
};

const themeCardStyle = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(202,161,90,0.35)",
  borderRadius: 10,
  padding: "18px 16px",
  color: "#eee8de",
  textAlign: "left",
  cursor: "pointer",
};

const themeCardTitleStyle = {
  fontSize: 17,
  fontWeight: 700,
  color: "#caa15a",
  marginBottom: 6,
};

const themeCardTaglineStyle = {
  fontSize: 13,
  color: "#a8a094",
  lineHeight: 1.4,
};

const paperStyle = {
  background: "#e9dfc0",
  color: "#2b2117",
  padding: "32px 40px",
  borderRadius: 4,
  maxWidth: 420,
  margin: "0 auto",
  fontFamily: "Georgia, serif",
  fontSize: 18,
  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
};

const keypadPanelStyle = {
  background: "#22262a",
  padding: "28px 32px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.1)",
  margin: "0 auto",
  display: "inline-block",
};

const keypadDisplayStyle = {
  background: "#0d0f11",
  color: "#8adf8a",
  fontFamily: "monospace",
  fontSize: 28,
  letterSpacing: 6,
  padding: "10px 20px",
  borderRadius: 6,
  marginBottom: 18,
  textAlign: "center",
};

const keypadGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 56px)",
  gap: 10,
};

const keyBtnStyle = {
  background: "#3a3f45",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 18,
  padding: "14px 0",
  cursor: "pointer",
};
