"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { EscapeRoomGame } from "../lib/gameEngine";
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
  const toastTimer = useRef(null);

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

  useEffect(() => {
    if (!theme || !mountRef.current) return;

    const engine = new EscapeRoomGame(mountRef.current, theme, {
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
    });
    engineRef.current = engine;
    engine.start();

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

  const handleRestart = useCallback(() => {
    setWin(null);
    setInventory([]);
    setStarted(false);
    setTheme(null);
    setStage({ index: 0, total: 1, label: "" });
  }, []);

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
          {stage.total > 1 && (
            <div style={stageBadgeStyle}>
              {stage.label} · Room {stage.index + 1} of {stage.total}
            </div>
          )}
          {prompt && <div style={promptStyle}>{prompt}</div>}
          {inventory.length > 0 && (
            <div style={inventoryStyle}>
              {inventory.map((item) => (
                <div key={item} style={inventoryItemStyle}>
                  🔑 {item}
                </div>
              ))}
            </div>
          )}
          <div style={controlsHintStyle}>WASD / Arrows move · mouse look · E interact · Esc release</div>
        </>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}

      {!theme && (
        <Overlay wide>
          <h1 style={titleStyle}>VANTAGE POINT</h1>
          <p style={subtitleStyle}>
            An online escape room. Nowhere you actually are — but for the next
            few minutes, it'll feel like you're standing right in it. Pick a
            room to begin.
          </p>
          <div style={themeGridStyle}>
            {THEMES.map((t) => (
              <button key={t.id} style={themeCardStyle} onClick={() => setTheme(t)}>
                <div style={themeCardTitleStyle}>{t.name}</div>
                <div style={themeCardTaglineStyle}>{t.tagline}</div>
              </button>
            ))}
          </div>
          <ul style={legendStyle}>
            <li><b>WASD</b> or <b>Arrow keys</b> — move</li>
            <li><b>Mouse</b> — look around</li>
            <li><b>E</b> — interact with what you're looking at</li>
            <li><b>Esc</b> — release the cursor</li>
          </ul>
        </Overlay>
      )}

      {theme && !started && (
        <Overlay>
          <h1 style={titleStyle}>{theme.name.toUpperCase()}</h1>
          <p style={subtitleStyle}>{theme.tagline}</p>
          <p style={{ ...subtitleStyle, marginTop: -16, fontSize: 13, color: "#8a8478" }}>
            {theme.stageLabels.length} rooms to get through, each with its own lock.
          </p>
          <button style={buttonStyle} onClick={handleEnter}>
            Click to step inside
          </button>
          <button style={linkButtonStyle} onClick={() => setTheme(null)}>
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
          <button style={buttonStyle} onClick={handleRestart}>
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
