import zlib from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value;
  }
  return table;
})();

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}

export function pixelsToPng(pixels, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    Buffer.from(pixels.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, y * stride + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function blendColor(mode, source, base) {
  if (mode === "multiply") return source.map((value, index) => (value * base[index]) / 255);
  if (mode === "overlay") {
    return source.map((value, index) => (
      base[index] < 128
        ? (2 * value * base[index]) / 255
        : 255 - (2 * (255 - value) * (255 - base[index])) / 255
    ));
  }
  return source;
}

export function draftPixels(raw, width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
  const canvasWidth = Number(doc.w) || width;
  const canvasHeight = Number(doc.h) || height;
  if (canvasWidth !== width || canvasHeight !== height) throw new Error("size_mismatch");
  for (const layer of doc.layers || []) {
    if (layer.visible === false) continue;
    const src = Buffer.from(layer.data || "", "base64");
    const opacity = Number(layer.opacity ?? 1);
    const blend = layer.blend || "normal";
    for (let i = 0; i + 3 < pixels.length && i + 3 < src.length; i += 4) {
      const alpha = (src[i + 3] / 255) * opacity;
      if (alpha <= 0) continue;
      const baseAlpha = pixels[i + 3] / 255;
      const source = [src[i], src[i + 1], src[i + 2]];
      const blended = baseAlpha <= 0
        ? source
        : blendColor(blend, source, [pixels[i], pixels[i + 1], pixels[i + 2]]);
      const outAlpha = alpha + baseAlpha * (1 - alpha);
      for (let c = 0; c < 3; c++) {
        pixels[i + c] = Math.round((blended[c] * alpha + pixels[i + c] * baseAlpha * (1 - alpha)) / (outAlpha || 1));
      }
      pixels[i + 3] = Math.round(outAlpha * 255);
    }
  }
  return pixels;
}
