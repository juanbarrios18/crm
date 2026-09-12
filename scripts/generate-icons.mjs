// 006 — Genera los iconos PNG de la PWA (sin dependencias de imagen).
// Fondo con el acento de la marca + una "V" blanca. Uso:
//   node scripts/generate-icons.mjs
//   ACCENT=#5f5470 node scripts/generate-icons.mjs   (para otro acento)
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const accent = (process.env.ACCENT || "#3f5972").replace("#", "");
const R = parseInt(accent.slice(0, 2), 16);
const G = parseInt(accent.slice(2, 4), 16);
const B = parseInt(accent.slice(4, 6), 16);

// --- CRC32 (tabla) ---
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function png(size, pixelFn) {
  const raw = Buffer.alloc(size * (1 + size * 3));
  let off = 0;
  for (let y = 0; y < size; y++) {
    raw[off++] = 0; // filtro none
    for (let x = 0; x < size; x++) {
      const [pr, pg, pb] = pixelFn(x, y, size);
      raw[off++] = pr;
      raw[off++] = pg;
      raw[off++] = pb;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// "V" blanca: dos trazos que convergen al centro-inferior.
function inV(x, y, size, thickness) {
  const cx = size / 2;
  const top = size * 0.22;
  const bottom = size * 0.8;
  if (y < top || y > bottom) return false;
  const t = (y - top) / (bottom - top);
  const halfSpan = cx - size * 0.18;
  const leftX = cx - halfSpan * t;
  const rightX = cx + halfSpan * t;
  return Math.abs(x - leftX) <= thickness || Math.abs(x - rightX) <= thickness;
}

function vIcon(size, thickness) {
  return png(size, (x, y) =>
    inV(x, y, size, thickness) ? [255, 255, 255] : [R, G, B]
  );
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "icon-192.png"), vIcon(192, 12));
writeFileSync(join(outDir, "icon-512.png"), vIcon(512, 32));
writeFileSync(join(outDir, "maskable-512.png"), vIcon(512, 32));
writeFileSync(join(outDir, "apple-touch-icon.png"), vIcon(180, 11));
console.log("Iconos generados en public/icons/");
