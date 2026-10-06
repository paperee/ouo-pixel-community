// 像素文档模型：纯逻辑，无 DOM，可在 node 里单测
// 图层字段：name / visible / opacity(0-1) / blend(normal|multiply|overlay)
export const MAX_LAYERS = 8;

export function createLayer(w, h, name) {
  return {
    name,
    visible: true,
    opacity: 1,
    blend: "normal",
    pixels: new Uint8ClampedArray(w * h * 4),
  };
}

export function createDoc(w, h) {
  return { w, h, active: 0, layers: [createLayer(w, h, "图层 1")] };
}

export function inBounds(doc, x, y) {
  return x >= 0 && y >= 0 && x < doc.w && y < doc.h;
}

export function getPixel(doc, li, x, y) {
  if (!inBounds(doc, x, y)) return [0, 0, 0, 0];
  const i = (y * doc.w + x) * 4;
  const p = doc.layers[li].pixels;
  return [p[i], p[i + 1], p[i + 2], p[i + 3]];
}

export function setPixel(doc, li, x, y, rgba) {
  if (!inBounds(doc, x, y)) return false;
  const i = (y * doc.w + x) * 4;
  const p = doc.layers[li].pixels;
  p[i] = rgba[0];
  p[i + 1] = rgba[1];
  p[i + 2] = rgba[2];
  p[i + 3] = rgba[3];
  return true;
}

// 带不透明度的 source-over（笔刷/橡皮统一走这里；橡皮即透明色叠加）
export function overPixel(doc, li, x, y, src, opacity = 1) {
  if (!inBounds(doc, x, y)) return false;
  const i = (y * doc.w + x) * 4;
  const p = doc.layers[li].pixels;
  const ba = p[i + 3] / 255;
  if (src[3] <= 0) {
    // 橡皮：透明色叠加贡献为 0，改为按力度直接削减目标 alpha；
    // 擦到全透明时 RGB 一并归零，避免残留旧色干扰油漆桶/导出
    const na = Math.round(ba * (1 - opacity) * 255);
    p[i + 3] = na;
    if (na === 0) {
      p[i] = p[i + 1] = p[i + 2] = 0;
    }
    return true;
  }
  const fa = (src[3] / 255) * opacity;
  const oa = fa + ba * (1 - fa);
  if (oa <= 0) {
    p[i] = p[i + 1] = p[i + 2] = p[i + 3] = 0;
    return true;
  }
  p[i] = Math.round((src[0] * fa + p[i] * ba * (1 - fa)) / oa);
  p[i + 1] = Math.round((src[1] * fa + p[i + 1] * ba * (1 - fa)) / oa);
  p[i + 2] = Math.round((src[2] * fa + p[i + 2] * ba * (1 - fa)) / oa);
  p[i + 3] = Math.round(oa * 255);
  return true;
}

// ---- 图层操作 ----
export function addLayer(doc, name) {
  if (doc.layers.length >= MAX_LAYERS) return -1;
  doc.layers.push(createLayer(doc.w, doc.h, name || `图层 ${doc.layers.length + 1}`));
  doc.active = doc.layers.length - 1;
  return doc.active;
}

// 在 i 层上方插入新层（i+1），并选中它；新建图层默认落在这里
export function insertLayerAbove(doc, i, name) {
  if (doc.layers.length >= MAX_LAYERS) return -1;
  const at = Math.max(0, Math.min(i + 1, doc.layers.length));
  doc.layers.splice(at, 0, createLayer(doc.w, doc.h, name || `图层 ${doc.layers.length + 1}`));
  doc.active = at;
  return doc.active;
}

// 把 from 层搬到 to 下标（拖动排序用），选中跟随被搬的层
export function moveLayerTo(doc, from, to) {
  to = Math.max(0, Math.min(to, doc.layers.length - 1));
  if (from === to || from < 0 || from >= doc.layers.length) return false;
  const cur = doc.layers[doc.active];
  const [l] = doc.layers.splice(from, 1);
  doc.layers.splice(to, 0, l);
  doc.active = doc.layers.indexOf(cur);
  return true;
}

export function deleteLayer(doc, i) {
  if (doc.layers.length <= 1) return false;
  doc.layers.splice(i, 1);
  doc.active = Math.min(doc.active, doc.layers.length - 1);
  return true;
}

export function moveLayer(doc, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= doc.layers.length) return false;
  [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]];
  doc.active = j;
  return true;
}

// 向下合并：把 i 层按自身混合+不透明度算进 i-1 层后删掉 i
export function mergeDown(doc, i) {
  if (i <= 0 || i >= doc.layers.length) return false;
  const below = doc.layers[i - 1];
  const src = doc.layers[i];
  for (let k = 0; k < below.pixels.length; k += 4) {
    const fa = (src.pixels[k + 3] / 255) * src.opacity;
    if (fa <= 0) continue;
    const b = blendColor(src.blend || "normal",
      [src.pixels[k], src.pixels[k + 1], src.pixels[k + 2]],
      [below.pixels[k], below.pixels[k + 1], below.pixels[k + 2]]);
    const ba = below.pixels[k + 3] / 255;
    const oa = fa + ba * (1 - fa);
    below.pixels[k] = Math.round((b[0] * fa + below.pixels[k] * ba * (1 - fa)) / oa);
    below.pixels[k + 1] = Math.round((b[1] * fa + below.pixels[k + 1] * ba * (1 - fa)) / oa);
    below.pixels[k + 2] = Math.round((b[2] * fa + below.pixels[k + 2] * ba * (1 - fa)) / oa);
    below.pixels[k + 3] = Math.round(oa * 255);
  }
  doc.layers.splice(i, 1);
  doc.active = i - 1;
  return true;
}

// 合并可见：把所有可见层算成一张，写进最底层可见层，其余可见层删掉
export function mergeVisible(doc) {
  const vis = doc.layers.filter((l) => l.visible);
  if (vis.length <= 1) return false;
  const tmp = {
    w: doc.w,
    h: doc.h,
    active: 0,
    layers: vis.map((l) => ({ ...l, pixels: new Uint8ClampedArray(l.pixels) })),
  };
  const base = vis[0];
  base.pixels = composite(tmp);
  base.opacity = 1;
  base.blend = "normal";
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    if (doc.layers[i] !== base && doc.layers[i].visible) doc.layers.splice(i, 1);
  }
  doc.active = doc.layers.indexOf(base);
  return true;
}

export function snapshot(doc) {
  return {
    w: doc.w,
    h: doc.h,
    active: doc.active,
    layers: doc.layers.map((l) => ({
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      blend: l.blend || "normal",
      pixels: new Uint8ClampedArray(l.pixels),
    })),
  };
}

export function restore(doc, snap) {
  doc.w = snap.w;
  doc.h = snap.h;
  doc.active = snap.active;
  doc.layers = snap.layers.map((l) => ({
    name: l.name,
    visible: l.visible,
    opacity: l.opacity,
    blend: l.blend || "normal",
    pixels: new Uint8ClampedArray(l.pixels),
  }));
}

export function u8ToB64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 8192) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  }
  return btoa(s);
}

export function b64ToU8(b64) {
  const s = atob(b64);
  const u = new Uint8ClampedArray(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

export function serialize(doc) {
  return JSON.stringify({
    v: 1,
    w: doc.w,
    h: doc.h,
    active: doc.active,
    layers: doc.layers.map((l) => ({
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      blend: l.blend || "normal",
      data: u8ToB64(l.pixels),
    })),
  });
}

export function deserialize(json) {
  const o = JSON.parse(json);
  const doc = { w: o.w, h: o.h, active: o.active, layers: [] };
  for (const l of o.layers) {
    doc.layers.push({
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      blend: l.blend || "normal", // 兼容 P2 存的老草稿
      pixels: b64ToU8(l.data),
    });
  }
  return doc;
}

function blendColor(mode, s, d) {
  if (mode === "multiply")
    return [(s[0] * d[0]) / 255, (s[1] * d[1]) / 255, (s[2] * d[2]) / 255];
  if (mode === "overlay")
    return [0, 1, 2].map((k) =>
      d[k] < 128
        ? (2 * s[k] * d[k]) / 255
        : 255 - (2 * (255 - s[k]) * (255 - d[k])) / 255
    );
  return s;
}

// 合成：可见图层按各自混合模式 + 不透明度叠加
export function composite(doc) {
  const out = new Uint8ClampedArray(doc.w * doc.h * 4);
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const p = layer.pixels;
    for (let i = 0; i < out.length; i += 4) {
      const fa = (p[i + 3] / 255) * layer.opacity;
      if (fa <= 0) continue;
      const ba = out[i + 3] / 255;
      // 背后全透明时混合无意义（正片叠底/叠加会对 0 背底算出纯黑），直接用源色
      const b = ba <= 0
        ? [p[i], p[i + 1], p[i + 2]]
        : blendColor(layer.blend || "normal",
          [p[i], p[i + 1], p[i + 2]],
          [out[i], out[i + 1], out[i + 2]]);
      const oa = fa + ba * (1 - fa);
      out[i] = Math.round((b[0] * fa + out[i] * ba * (1 - fa)) / (oa || 1));
      out[i + 1] = Math.round((b[1] * fa + out[i + 1] * ba * (1 - fa)) / (oa || 1));
      out[i + 2] = Math.round((b[2] * fa + out[i + 2] * ba * (1 - fa)) / (oa || 1));
      out[i + 3] = Math.round(oa * 255);
    }
  }
  return out;
}

export function countOpaque(pixels) {
  let n = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) n++;
  return n;
}
