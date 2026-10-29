// Genera los iconos PNG de la PWA sin dependencias (rasteriza formas simples y codifica PNG con zlib).
// Uso: node scripts/make-icons.mjs   (escribe en public/icons/)
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dirname, "..", "public", "icons");
const SS = 4; // supermuestreo por eje, para bordes suaves

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG = hex("#0f1420");

/** Rectángulo redondeado en coordenadas del contenido (0..1). */
const rrect = (x, y, w, h, r, color) => ({
  color: hex(color),
  inside: (px, py) => {
    const dx = Math.max(Math.abs(px - (x + w / 2)) - (w / 2 - r), 0);
    const dy = Math.max(Math.abs(py - (y + h / 2)) - (h / 2 - r), 0);
    return dx * dx + dy * dy <= r * r;
  },
});

// Un teclado de 5 teclas blancas y 3 negras, con tres notas cayendo (colores de la interfaz).
function content() {
  const shapes = [];
  const x0 = 0.08;
  const kw = 0.168;
  for (let i = 0; i < 5; i++) shapes.push(rrect(x0 + i * kw + 0.006, 0.5, kw - 0.012, 0.42, 0.02, "#f4f6fa"));
  for (const j of [0, 1, 3]) shapes.push(rrect(x0 + kw * (j + 1) - 0.05, 0.5, 0.1, 0.27, 0.015, "#1a1f2b"));
  shapes.push(rrect(x0 + kw * 1 + 0.018, 0.1, kw - 0.036, 0.34, 0.03, "#4aa3ff"));
  shapes.push(rrect(x0 + kw * 3 + 0.018, 0.24, kw - 0.036, 0.2, 0.03, "#ffb020"));
  shapes.push(rrect(x0 + kw * 4 + 0.018, 0.34, kw - 0.036, 0.1, 0.03, "#3ddc84"));
  return shapes;
}

/**
 * @param size lado en píxeles
 * @param maskable true: fondo a sangre y contenido dentro de la zona segura (80 % central)
 */
function render(size, maskable) {
  const shapes = content();
  const scale = maskable ? 0.56 : 0.78;
  const radius = maskable ? 0 : 0.2;
  const bgShape = rrect(0, 0, 1, 1, radius, "#0f1420");
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px + (sx + 0.5) / SS) / size;
          const v = (py + (sy + 0.5) / SS) / size;
          let color = null;
          if (maskable || bgShape.inside(u, v)) color = BG;
          const cx = (u - 0.5) / scale + 0.5;
          const cy = (v - 0.5) / scale + 0.5;
          for (const s of shapes) if (s.inside(cx, cy)) color = s.color;
          if (color) {
            r += color[0]; g += color[1]; b += color[2]; a++;
          }
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round((255 * a) / (SS * SS));
    }
  }
  return rgba;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro "ninguno"
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const targets = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
];
for (const [name, size, maskable] of targets) {
  const data = png(size, render(size, maskable));
  writeFileSync(join(OUT, name), data);
  console.log(name, size + "x" + size, data.length + " bytes");
}
