import { encode } from "uqr";

/** Quiet zone around the code, in modules. The QR standard asks for 4; scanners cope well with 2 on white paper. */
const BORDER = 2;

/** Dark modules of a QR code for `text`. Error correction "M" survives a coffee stain on a table card. */
export function qrMatrix(text: string): boolean[][] {
  return encode(text, { ecc: "M", border: 0 }).data;
}

/** Crisp, tiny SVG: one path, horizontal runs merged. Scales to any print size. */
export function qrSvg(text: string, opts: { label?: string } = {}): string {
  const m = qrMatrix(text);
  const size = m.length + BORDER * 2;
  let d = "";
  m.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let w = 1;
      while (row[x + w]) w++;
      d += `M${x + BORDER} ${y + BORDER}h${w}v1h-${w}z`;
      x += w - 1;
    }
  });
  const title = opts.label ? `<title>${escapeXml(opts.label)}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img">${title}<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** PNG of the code, `scale` pixels per module (default ~1000 px wide, enough for A4 print). No dependencies. */
export async function qrPng(text: string, scale?: number): Promise<Uint8Array> {
  const m = qrMatrix(text);
  const modules = m.length + BORDER * 2;
  const s = scale ?? Math.max(4, Math.round(1000 / modules));
  const width = modules * s;
  // 8-bit grayscale, each row prefixed with filter byte 0.
  const raw = new Uint8Array((width + 1) * width);
  for (let py = 0; py < width; py++) {
    const row = m[Math.floor(py / s) - BORDER];
    const offset = py * (width + 1);
    for (let px = 0; px < width; px++) {
      const dark = row?.[Math.floor(px / s) - BORDER] ?? false;
      raw[offset + 1 + px] = dark ? 0 : 255;
    }
  }
  const idat = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, width);
  ihdr.set([8, 0, 0, 0, 0], 8); // bit depth 8, grayscale, deflate, no filter, no interlace
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array()),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

let CRC_TABLE: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  CRC_TABLE ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
