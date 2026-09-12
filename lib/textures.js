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

export function floorTexture() {
  const tex = canvas(512, 512, (ctx, w, h) => {
    ctx.fillStyle = "#5a3d24";
    ctx.fillRect(0, 0, w, h);
    const plank = 32;
    for (let y = 0; y < h; y += plank) {
      for (let x = 0; x < w; x += 128) {
        const shade = 18 + Math.random() * 14;
        ctx.fillStyle = `rgb(${74 + shade | 0}, ${52 + shade * 0.6 | 0}, ${30 + shade * 0.3 | 0})`;
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

export function wallTexture() {
  const tex = canvas(512, 512, (ctx, w, h) => {
    ctx.fillStyle = "#2b2430";
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

export function ceilingTexture() {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#1c1a1f";
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

export function noteTexture(lines) {
  return canvas(512, 512, (ctx, w, h) => {
    ctx.fillStyle = "#e9dfc0";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = "#2b2117";
    ctx.font = "28px Georgia, serif";
    ctx.textAlign = "center";
    lines.forEach((line, i) => {
      ctx.fillText(line, w / 2, 100 + i * 44);
    });
  });
}

export function plaqueTexture(text) {
  return canvas(512, 256, (ctx, w, h) => {
    ctx.fillStyle = "#caa15a";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#5c4522";
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = "#3a2a10";
    ctx.font = "bold 36px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("CERTIFICATE OF ACHIEVEMENT", w / 2, 70);
    ctx.font = "italic 26px Georgia, serif";
    ctx.fillText("Awarded in the year", w / 2, 130);
    ctx.font = "bold 54px Georgia, serif";
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

export function safeFrontTexture() {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#3a3f45";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#1c1f22";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = "#22262a";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#8a8f94";
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

export function metalTexture(hex = "#6b5a3a") {
  return canvas(64, 64, (ctx, w, h) => {
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(0, 0, w, h / 2);
  });
}
