// Génère les icônes PNG (fond encre, livre ouvert blanc, point orange) sans dépendance.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(S) {
  const raw = Buffer.alloc(S * (S * 3 + 1));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // deux pages inclinées formant un livre ouvert
    const dx = Math.abs(u - 0.5), top = 0.33 + dx * 0.12, bot = 0.68 + dx * 0.12;
    const page = dx > 0.025 && dx < 0.27 && v > top && v < bot;
    const dot = (u - 0.76) ** 2 + (v - 0.24) ** 2 < 0.075 ** 2; // point orange « signal »
    const i = y * (S * 3 + 1) + 1 + x * 3;
    const [r, g, b] = dot ? [0xf0, 0x58, 0x0f] : page ? [255, 255, 255] : [0x16, 0x14, 0x12];
    raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [180, 512]) writeFileSync(`public/icon-${s}.png`, png(s));
