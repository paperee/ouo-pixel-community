// 绘画算法：纯函数，无 DOM，可在 node 里单测
import { getPixel, inBounds, setPixel, u8ToB64 } from "./doc.js";

// Bresenham 直线
export function linePoints(x0, y0, x1, y1) {
  const pts = [];
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return pts;
}

export function rectPoints(x0, y0, x1, y1, filled) {
  const [lx, hx] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [ly, hy] = y0 < y1 ? [y0, y1] : [y1, y0];
  const pts = [];
  for (let y = ly; y <= hy; y++)
    for (let x = lx; x <= hx; x++)
      if (filled || x === lx || x === hx || y === ly || y === hy)
        pts.push([x, y]);
  return pts;
}

// 椭圆：参数采样取轮廓，实心再按行填充
export function ellipsePoints(cx, cy, rx, ry, filled) {
  const set = new Set();
  const steps = Math.max(16, Math.ceil(2 * Math.PI * Math.max(rx, ry) * 2));
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    set.add(`${Math.round(cx + rx * Math.cos(t))},${Math.round(cy + ry * Math.sin(t))}`);
  }
  const pts = [...set].map((s) => s.split(",").map(Number));
  if (!filled) return pts;
  const rows = new Map();
  for (const [x, y] of pts) {
    if (!rows.has(y)) rows.set(y, [x, x]);
    else {
      const r = rows.get(y);
      r[0] = Math.min(r[0], x);
      r[1] = Math.max(r[1], x);
    }
  }
  const out = [];
  for (const [y, [a, b]] of rows)
    for (let x = a; x <= b; x++) out.push([x, y]);
  return out;
}

// 笔刷落点：方形或圆形
export function stampPixels(x, y, size, circle) {
  const pts = [];
  const half = Math.floor(size / 2);
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++) {
      if (circle) {
        const ox = dx - (size - 1) / 2;
        const oy = dy - (size - 1) / 2;
        if (Math.hypot(ox, oy) > size / 2) continue;
      }
      pts.push([x + dx - half, y + dy - half]);
    }
  return pts;
}

// 漫水填充（含容差）：返回填充像素数
export function floodFill(doc, li, sx, sy, rgba, tol) {
  if (!inBounds(doc, sx, sy)) return 0;
  const target = getPixel(doc, li, sx, sy);
  // 起点透明（擦过/从未画过）：透明自成连通区，只认 alpha。
  // 透明像素 RGB 残留旧色，按 RGB 判定会串到未擦过的同色区（或因近似色直接返回 0）
  const seedTransparent = target[3] === 0;
  // 容差只比 RGB：alpha 参与会导致半透明像素永远填不上
  const match = seedTransparent
    ? (c) => c[3] === 0
    : (c) =>
        Math.abs(c[0] - target[0]) <= tol &&
        Math.abs(c[1] - target[1]) <= tol &&
        Math.abs(c[2] - target[2]) <= tol;
  // 填充色与起点一致（RGB 在容差内且 alpha 相同）等于白填：必须直接返回；
  // 注意 alpha 也要比，否则半透明色块用同色覆盖会被误判为空操作。
  // 终止不依赖这里：填过的像素靠 seen 去重，不会重复进栈
  if (rgba[3] === target[3] && match(rgba)) return 0;
  let n = 0;
  // 防重入：每个像素最多进栈处理一次，填过的不再重复压栈，杜绝死循环
  const seen = new Uint8Array(doc.w * doc.h);
  const stack = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (!inBounds(doc, x, y)) continue;
    const k = y * doc.w + x;
    if (seen[k]) continue;
    seen[k] = 1;
    if (!match(getPixel(doc, li, x, y))) continue;
    setPixel(doc, li, x, y, rgba);
    n++;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return n;
}

// Pixel Perfect：连续三点成直角拐（a-b-c，a 与 c 对角相邻）时擦掉拐角 b
export function pixelPerfectErase(hist) {
  if (hist.length < 3) return null;
  const [a, b, c] = hist.slice(-3);
  const man = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
  const diag =
    Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1;
  if (man(a, b) === 1 && man(b, c) === 1 && diag) return b;
  return null;
}

// 画布变换（作用于整个文档全部图层，P2 约定）
export function flipH(doc) {
  for (const l of doc.layers) {
    const src = new Uint8ClampedArray(l.pixels);
    for (let y = 0; y < doc.h; y++)
      for (let x = 0; x < doc.w; x++) {
        const s = (y * doc.w + x) * 4;
        const d = (y * doc.w + (doc.w - 1 - x)) * 4;
        for (let k = 0; k < 4; k++) l.pixels[d + k] = src[s + k];
      }
  }
}

export function flipV(doc) {
  for (const l of doc.layers) {
    const src = new Uint8ClampedArray(l.pixels);
    for (let y = 0; y < doc.h; y++)
      for (let x = 0; x < doc.w; x++) {
        const s = (y * doc.w + x) * 4;
        const d = ((doc.h - 1 - y) * doc.w + x) * 4;
        for (let k = 0; k < 4; k++) l.pixels[d + k] = src[s + k];
      }
  }
}

export function rotate90CW(doc) {
  const W = doc.w;
  const H = doc.h;
  for (const l of doc.layers) {
    const src = new Uint8ClampedArray(l.pixels);
    const dst = new Uint8ClampedArray(l.pixels.length);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const s = (y * W + x) * 4;
        const d = (x * H + (H - 1 - y)) * 4;
        for (let k = 0; k < 4; k++) dst[d + k] = src[s + k];
      }
    l.pixels = dst;
  }
  doc.w = H;
  doc.h = W;
}

export function hexToRgba(hex) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

// 封面像素数据：默认保留原始画布尺寸，传 max 时才缩放
export function coverOf(pixels, w, h, max = Math.max(w, h)) {
  const s = Math.min(1, max / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * s));
  const ch = Math.max(1, Math.round(h * s));
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const si = (Math.min(h - 1, Math.floor(y / s)) * w + Math.min(w - 1, Math.floor(x / s))) * 4;
      const di = (y * cw + x) * 4;
      out[di] = pixels[si];
      out[di + 1] = pixels[si + 1];
      out[di + 2] = pixels[si + 2];
      out[di + 3] = pixels[si + 3];
    }
  return { w: cw, h: ch, data: u8ToB64(out) };
}

// HSV<->RGB（色轮用，h/s/v 均为 0-1）
export function hsvToRgb(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const m = [
    [v, t, p], [q, v, p], [p, v, t],
    [p, q, v], [t, p, v], [v, p, q],
  ][i % 6];
  return [Math.round(m[0] * 255), Math.round(m[1] * 255), Math.round(m[2] * 255)];
}

export function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}

export function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}
