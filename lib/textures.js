import * as THREE from "three";

// Everything here is drawn on an in-memory <canvas> and turned into a
// THREE.CanvasTexture — no image files to ship or fetch.

function canvas(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function floorTexture(base = "#5a3d24") {
  const tex = canvas(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const plank = 32;
    for (let y = 0; y < h; y += plank) {
      for (let x = 0; x < w; x += 128) {
        const shade = 18 + Math.random() * 14;
        ctx.fillStyle = `rgba(255,255,255,${(shade / 255).toFixed(3)})`;
        ctx.fillRect(x + ((y / plank) % 2 ? 64 : 0), y, 126, plank - 2);
      }
    }
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    for (let y = 0; y <= h; y += plank) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

export function metalFloorTexture(base = "#3a3d40") {
  const tex = canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let y = 0; y < h; y += 16) {
      for (let x = (y / 16) % 2 ? 0 : 8; x < w; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 5, y + 5);
        ctx.lineTo(x, y + 10);
        ctx.lineTo(x - 5, y + 5);
        ctx.fill();
      }
    }
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w, h);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

export function rockFloorTexture(base = "#3a332c") {
  const tex = canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 6 + Math.random() * 18;
      const lighter = Math.random() > 0.5;
      ctx.fillStyle = `rgba(${lighter ? 255 : 0},${lighter ? 240 : 0},${lighter ? 210 : 0},${0.05 + Math.random() * 0.08})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.6, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  return tex;
}

export function stoneFloorTexture(base = "#514c46") {
  const tex = canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const tile = 64;
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 3;
    for (let y = 0; y < h; y += tile) {
      for (let x = 0; x < w; x += tile) {
        const off = (y / tile) % 2 ? tile / 2 : 0;
        ctx.strokeRect(x + off - tile, y, tile, tile);
        const shade = (Math.random() - 0.5) * 20;
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, shade / 255)})`;
        ctx.fillRect(x + off - tile, y, tile, tile);
      }
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

export function wallTexture(base = "#2b2430") {
  const tex = canvas(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    for (let i = 0; i < 400; i++) {
      ctx.beginPath();
      const x = Math.random() * w;
      const y = Math.random() * h;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() * 6 - 3), y + (Math.random() * 6 - 3));
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, h - 40, w, 40);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, w, 18);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

export function panelWallTexture(base = "#3a3f45", accent = "#22262a") {
  const tex = canvas(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const panel = 128;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    for (let y = 0; y <= h; y += panel) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let x = 0; x <= w; x += panel) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (let y = panel / 2; y < h; y += panel) {
      for (let x = panel / 2; x < w; x += panel) {
        [-1, 1].forEach((sx) =>
          [-1, 1].forEach((sy) => {
            ctx.beginPath();
            ctx.arc(x + sx * (panel / 2 - 10), y + sy * (panel / 2 - 10), 3, 0, Math.PI * 2);
            ctx.fill();
          })
        );
      }
    }
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    for (let i = 0; i < 150; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      ctx.fillRect(x, y, 20 + Math.random() * 30, 1);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

export function rockWallTexture(base = "#4a4038") {
  const tex = canvas(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 12 + Math.random() * 40;
      const lighter = Math.random() > 0.5;
      ctx.fillStyle = lighter
        ? `rgba(255,245,220,${0.04 + Math.random() * 0.08})`
        : `rgba(0,0,0,${0.05 + Math.random() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.5 + Math.random() * 0.4), Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // wooden support beams
    ctx.fillStyle = "#3d2b1f";
    for (let x = 40; x < w; x += 170) {
      ctx.fillRect(x, 0, 22, h);
    }
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    for (let x = 40; x < w; x += 170) {
      ctx.fillRect(x, 0, 3, h);
      ctx.fillRect(x + 19, 0, 3, h);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

export function stoneWallTexture(base = "#5a554c") {
  const tex = canvas(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const bw = 90;
    const bh = 46;
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 4;
    let row = 0;
    for (let y = 0; y < h; y += bh) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < w; x += bw) {
        ctx.strokeRect(x + off, y, bw, bh);
        const shade = (Math.random() - 0.5) * 30;
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, shade / 255)})`;
        ctx.fillRect(x + off, y, bw, bh);
      }
      row++;
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

export function ceilingTexture(base = "#1c1a1f") {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
  });
}

export function woodTexture(base = "#3d2b1f") {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.1})`;
      ctx.beginPath();
      const y = Math.random() * h;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + 8, w * 0.7, y - 8, w, y);
      ctx.stroke();
    }
  });
}

export function noteTexture(lines, opts = {}) {
  const { bg = "#e9dfc0", textColor = "#2b2117", font = "Georgia, serif" } = opts;
  return canvas(512, 512, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = textColor;
    ctx.font = `26px ${font}`;
    ctx.textAlign = "center";
    lines.forEach((line, i) => {
      ctx.fillText(line, w / 2, 100 + i * 44);
    });
  });
}

export function plaqueTexture(text, opts = {}) {
  const {
    bg = "#caa15a",
    border = "#5c4522",
    textColor = "#3a2a10",
    title = "CERTIFICATE OF ACHIEVEMENT",
    subtitle = "Awarded in the year",
    font = "Georgia, serif",
  } = opts;
  return canvas(512, 256, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = border;
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = textColor;
    ctx.font = `bold 32px ${font}`;
    ctx.textAlign = "center";
    ctx.fillText(title, w / 2, 70);
    ctx.font = `italic 24px ${font}`;
    ctx.fillText(subtitle, w / 2, 130);
    ctx.font = `bold 54px ${font}`;
    ctx.fillText(text, w / 2, 200);
  });
}

export function bookshelfTexture() {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#241a12";
    ctx.fillRect(0, 0, w, h);
    const rows = 4;
    const rowH = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = 0;
      while (x < w) {
        const bw = 8 + Math.random() * 14;
        const hue = 10 + Math.random() * 40;
        ctx.fillStyle = `hsl(${hue}, 45%, ${20 + Math.random() * 20}%)`;
        ctx.fillRect(x, r * rowH + 4, bw, rowH - 8);
        x += bw + 1;
      }
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(0, (r + 1) * rowH - 4, w, 4);
    }
  });
}

export function tagTexture(text, opts = {}) {
  const { bg = "#cfcfcf", textColor = "#1a1a1a", border = "#333" } = opts;
  return canvas(256, 128, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = border;
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = textColor;
    ctx.font = "bold 48px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + 4);
  });
}

export function crateTexture(base = "#33261a", band = "#6b5a3a") {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = band;
    ctx.fillRect(0, 30, w, 16);
    ctx.fillRect(0, h - 46, w, 16);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 30, w, 3);
    ctx.fillRect(0, h - 46, w, 3);
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 2;
    for (let x = 20; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  });
}

export function rackTexture(base = "#241a12") {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const rows = 3;
    const rowH = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = 0;
      while (x < w) {
        const bw = 18 + Math.random() * 26;
        const hue = 20 + Math.random() * 30;
        ctx.fillStyle = `hsl(${hue}, 30%, ${18 + Math.random() * 18}%)`;
        ctx.fillRect(x, r * rowH + 6, bw, rowH - 12);
        x += bw + 3;
      }
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, (r + 1) * rowH - 4, w, 4);
    }
  });
}

export function safeFrontTexture(base = "#3a3f45", dial = "#8a8f94") {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#1c1f22";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = "#22262a";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = dial;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 56, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + Math.cos(a) * 50, h / 2 + Math.sin(a) * 50);
      ctx.stroke();
    }
  });
}

export function paintingCoverTexture(kind) {
  return canvas(256, 320, (ctx, w, h) => {
    if (kind === "map") {
      ctx.fillStyle = "#cbb98a";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(60,40,20,0.6)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(Math.random() * w, 0);
        ctx.bezierCurveTo(Math.random() * w, h * 0.4, Math.random() * w, h * 0.7, Math.random() * w, h);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(60,40,20,0.7)";
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * w, Math.random() * h, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === "plank") {
      ctx.fillStyle = "#3d2f20";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 30; i++) {
        ctx.strokeStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.15})`;
        ctx.beginPath();
        const y = Math.random() * h;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * 0.3, y + 10, w * 0.7, y - 10, w, y);
        ctx.stroke();
      }
    } else if (kind === "chart") {
      ctx.fillStyle = "#12262a";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(80,220,180,0.5)";
      for (let r = 20; r < 180; r += 30) {
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(80,220,180,0.8)";
      for (let i = 0; i < 10; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * w, Math.random() * h, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // tapestry
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#7a2a2a");
      grad.addColorStop(1, "#3a1414");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(200,170,90,0.6)";
      ctx.beginPath();
      ctx.moveTo(w / 2, 40);
      ctx.lineTo(w / 2 + 40, h / 2);
      ctx.lineTo(w / 2, h - 60);
      ctx.lineTo(w / 2 - 40, h / 2);
      ctx.closePath();
      ctx.fill();
    }
  });
}

export function trainWindowTexture() {
  return canvas(256, 128, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#0a1a2e");
    grad.addColorStop(0.5, "#2e5278");
    grad.addColorStop(1, "#0a1a2e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    for (let i = 0; i < 22; i++) {
      const y = Math.random() * h;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + (Math.random() * 10 - 5));
      ctx.stroke();
    }
  });
}

export function metalTexture(hex = "#6b5a3a") {
  return canvas(64, 64, (ctx, w, h) => {
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(0, 0, w, h / 2);
  });
}
