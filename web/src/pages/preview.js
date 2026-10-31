// 大图预览：草稿/发布/图层小图悬停 + 按住 Z 显示大图，版本列表内 D 删除
import { api } from "../api.js";
import { b64ToU8, composite, deserialize } from "../editor/doc.js";
import { coverOf } from "../editor/paint.js";
import { uiAlert, uiConfirm } from "../dialog.js";
import { esc } from "./shared.js";

// 草稿箱大图预览：鼠标移到小图上只显示"按住 Z 显示大图"提示，按住 Z 才出大图
// 触屏无 Z 键：同一批目标长按 500ms 等效按住 Z，松手隐藏（长按后松手不触发点击跳转）
const TOUCH_UI = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
const LONG_PRESS_MS = 500;
const LONG_PRESS_TOL = 12;
const zHintBig = () => (TOUCH_UI ? "长按显示大图" : "按住 Z 显示大图");
export function wireDraftPreview() {
  const boxes = [document.querySelector("#draft-list"), document.querySelector("#pub-list"), document.querySelector("#art-layers"), document.querySelector("#gallery"), document.querySelector(".me-wall")].filter(Boolean);
  if (!boxes.length) return;
  let pv = document.querySelector("#draft-preview");
  if (!pv) {
    pv = document.createElement("div");
    pv.id = "draft-preview";
    pv.className = "px-card";
    pv.hidden = true;
    pv.innerHTML = `<b></b><canvas></canvas>`;
    document.body.appendChild(pv);
  }
  let hint = document.querySelector("#draft-hint");
  if (!hint) {
    hint = document.createElement("div");
    hint.id = "draft-hint";
    hint.className = "px-tip";
    hint.hidden = true;
    hint.textContent = "按住 Z 显示大图";
    document.body.appendChild(hint);
  }
  let gal = document.querySelector("#gal-preview");
  if (!gal) {
    gal = document.createElement("div");
    gal.id = "gal-preview";
    gal.className = "px-card";
    gal.hidden = true;
    document.body.appendChild(gal);
  }
  const galCache = (window.__pxGalCache = window.__pxGalCache || new Map());
  async function showGal(id) {
    let d = galCache.get(String(id));
    if (d === undefined) {
      gal.innerHTML = `<b>读取中…</b>`;
      gal.hidden = false;
      place(gal, st.x, st.y);
      try {
        const r = await api("GET", `/api/artworks/${id}`);
        if (r.status !== 200 || !r.data) {
          if (st.el?.dataset?.gal == id && st.z) gal.innerHTML = `<b>读不出来</b>`;
          return;
        }
        d = r.data.artwork;
        galCache.set(String(id), d);
      } catch {
        if (st.el?.dataset?.gal == id && st.z) gal.innerHTML = `<b>读不出来</b>`;
        return;
      }
    }
    if (st.el?.dataset?.gal != d.id || (!st.z && !st.touch)) return;
    let layers = [];
    try {
      const doc = JSON.parse(d.layers_json || "null");
      layers = doc?.layers || (Array.isArray(doc) ? doc : []);
    } catch {
      layers = [];
    }
    let pal = [];
    try {
      pal = JSON.parse(d.palette_json || "[]");
    } catch {
      pal = [];
    }
    gal.innerHTML = `<b>${esc(d.title)}</b>
      <span class="hint">${d.width}×${d.height} · ${d.layers_count || layers.length || 1}层 · 作者 ${esc(d.author_name || "")}</span>
      <div class="row">${pal.length ? pal.map((cc) => `<span class="swatch" style="background:${cc}" title="${cc}"></span>`).join("") : '<span class="hint">无色板</span>'}</div>
      <div class="layer-strip">${layers.map((l, i) => `<div class="layer-thumb"><canvas class="draft-thumb" data-gal-layer="${i}" width="${d.width}" height="${d.height}"></canvas><span class="hint">${esc(l.name || ("图层" + (i + 1)))}</span></div>`).join("")}</div>`;
    gal.hidden = false;
    place(gal, st.x, st.y);
    layers.forEach((l, i) => {
      const cv = gal.querySelector(`[data-gal-layer="${i}"]`);
      if (!cv) return;
      try { const u8 = b64ToU8(l.data || ""); cv.getContext("2d").putImageData(new ImageData(u8, d.width, d.height), 0, 0); } catch { void 0; }
    });
  }
  const st = (window.__pxPrev = window.__pxPrev || { el: null, x: 0, y: 0, z: false });
  st.el = null;
  st.z = false;
  st.touch = false;
  const cap = pv.querySelector("b");
  const c = pv.querySelector("canvas");
  const place = (el, x, y) => {
    el.hidden = false;
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 200;
    let lx = x + 16;
    let ly = y + 18;
    if (lx + w > window.innerWidth - 8) lx = x - w - 12;
    if (ly + h > window.innerHeight - 8) ly = y - h - 12;
    el.style.left = `${Math.max(4, lx)}px`;
    el.style.top = `${Math.max(4, ly)}px`;
  };
  const renderBig = () => {
    const el = st.el;
    if (!el) return false;
    // 版本列表纯文本选项（pixel-select 的 ps-opt）：按住 Z 预览当前悬停的存档
    if (el.matches?.(".ps-opt")) {
      const v = window.__pxVersMap?.get(String(el.dataset.v));
      if (!v?.layers_json) return false;
      try {
        const vd = deserialize(v.layers_json);
        const m = composite(vd);
        const cc = coverOf(m, vd.w, vd.h);
        c.width = cc.w;
        c.height = cc.h;
        c.getContext("2d").putImageData(new ImageData(b64ToU8(cc.data), cc.w, cc.h), 0, 0);
        cap.textContent = el.textContent || "";
        return true;
      } catch {
        return false;
      }
    }
    if (!el.width) return false;
    const row = el.closest("[data-id],[data-pid]");
    cap.textContent = row?.querySelector("b")?.textContent || "";
    // 无标题时藏起 b，免得空行撑出上边距、四边不对齐
    cap.hidden = !cap.textContent;
    // 悬停大图预览统一 200px 上限（作品页图层最多 6 倍）
    const inArtLayers = !!el.closest?.("#art-layers");
    const s = Math.max(1, Math.min(inArtLayers ? 6 : 10, Math.floor(200 / Math.max(el.width, el.height))));
    c.width = el.width * s;
    c.height = el.height * s;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    try {
      ctx.drawImage(el, 0, 0, c.width, c.height);
    } catch {
      return false;
    }
    return true;
  };
  const refresh = () => {
    const isGal = !!st.el?.matches?.("img[data-gal]");
    if (!st.el) {
      pv.hidden = true;
      hint.hidden = true;
      if (gal) gal.hidden = true;
      return;
    }
    if (isGal) {
      pv.hidden = true;
      if (st.z || st.touch) {
        hint.hidden = true;
        showGal(st.el.dataset.gal);
      } else {
        gal.hidden = true;
        hint.textContent = TOUCH_UI ? "长按查看颜色与图层" : "按住 Z 查看颜色与图层";
        place(hint, st.x, st.y);
      }
      return;
    }
    if (gal) gal.hidden = true;
    const versHover = !!st.el?.matches?.(".ps-opt") && !!st.el?.closest?.("[data-vers]");
    hint.textContent = versHover
      ? TOUCH_UI ? "长按显示大图" : "按住 Z 显示大图 · 按 D 删除版本"
      : zHintBig();
    if ((st.z || st.touch) && renderBig()) {
      hint.hidden = true;
      place(pv, st.x, st.y);
    } else {
      pv.hidden = true;
      place(hint, st.x, st.y);
    }
  };
  for (const box of boxes) {
    // 长按等效按住 Z（触屏）：500ms 不动即预览，松手隐藏；长按后松手不触发点击跳转
    let lpTimer = null;
    let lpFired = false;
    let lpX = 0;
    let lpY = 0;
    const lpCancel = () => {
      if (lpTimer) {
        clearTimeout(lpTimer);
        lpTimer = null;
      }
    };
    box.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      const th = e.target.closest?.(".draft-thumb, .ps-opt, img[data-gal]");
      if (!th) return;
      const t = e.touches[0];
      lpFired = false;
      lpX = t.clientX;
      lpY = t.clientY;
      lpCancel();
      lpTimer = setTimeout(() => {
        lpTimer = null;
        lpFired = true;
        st.el = th;
        st.x = lpX;
        st.y = lpY;
        st.touch = true;
        const tip = document.querySelector(".px-tip");
        if (tip) tip.hidden = true;
        refresh();
      }, LONG_PRESS_MS);
    }, { passive: true });
    box.addEventListener("touchmove", (e) => {
      if (!lpTimer || !e.touches.length) return;
      const t = e.touches[0];
      if (Math.hypot(t.clientX - lpX, t.clientY - lpY) > LONG_PRESS_TOL) lpCancel();
    }, { passive: true });
    const lpEnd = (e) => {
      lpCancel();
      if (lpFired) {
        lpFired = false;
        e.preventDefault();
      }
      if (st.touch) {
        st.touch = false;
        st.el = null;
        refresh();
      }
    };
    box.addEventListener("touchend", lpEnd, { passive: false });
    box.addEventListener("touchcancel", () => {
      lpCancel();
      lpFired = false;
      if (st.touch) {
        st.touch = false;
        st.el = null;
        refresh();
      }
    });
    box.addEventListener("mouseover", (e) => {
      const th = e.target.closest?.(".draft-thumb, .ps-opt, img[data-gal]");
      if (!th) return;
      st.el = th;
      st.x = e.clientX;
      st.y = e.clientY;
      refresh();
    });
    box.addEventListener("mousemove", (e) => {
      const th = e.target.closest?.(".draft-thumb, .ps-opt, img[data-gal]");
      if (th) {
        st.el = th;
        st.x = e.clientX;
        st.y = e.clientY;
        refresh();
      } else if (st.el) {
        st.el = null;
        refresh();
      }
    });
    box.addEventListener("mouseout", (e) => {
      if (e.target.closest?.(".draft-thumb, .ps-opt, img[data-gal]")) {
        st.el = null;
        refresh();
      }
    });
  }
  if (!window.__pxPrevKeys) {
    window.__pxPrevKeys = true;
    const typing = () => {
      const t = document.activeElement;
      return (
        t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      );
    };
    document.addEventListener("keydown", (e) => {
      if ((e.key === "z" || e.key === "Z") && !e.repeat && !typing()) {
        st.z = true;
        const tip = document.querySelector(".px-tip");
        if (tip) tip.hidden = true;
        refresh();
      }
      // D 删除历史版本：只对版本列表里的选项生效（悬停项优先，无悬停用打开列表的选中项）
      if ((e.key === "d" || e.key === "D") && !e.repeat && !e.ctrlKey && !e.metaKey && !typing()) {
        let box = st.el?.matches?.(".ps-opt") ? st.el.closest?.("[data-vers]") : null;
        if (!box) box = document.querySelector('#draft-list [data-vers]:not([hidden])');
        const row = box?.closest?.("[data-id]");
        const id = row?.dataset?.id;
        if (!box || !id) return;
        const hovered = st.el?.matches?.(".ps-opt") && box.contains(st.el) ? st.el : null;
        const sel = row.querySelector?.("[data-vers-sel]");
        const vid = hovered?.dataset?.v || sel?.value;
        if (!vid) return;
        e.preventDefault();
        const label = (hovered?.textContent || sel?.options?.[sel.selectedIndex]?.textContent || "").trim();
        delVersRow(id, vid, row, label);
      }
    });
    // 删除某条历史存档：确认后调接口，刷新该行的版本列表
    async function delVersRow(id, vid, row, label = "") {
      if (!(await uiConfirm(`删除「${label || "这个存档"}」？不可撤销。`, "删除"))) return;
      const r = await api("DELETE", `/api/drafts/${id}/versions/${vid}`);
      if (r.status !== 200) {
        uiAlert("删除失败，重试一下");
        return;
      }
      st.el = null;
      refresh();
      const versBox = row.querySelector("[data-vers]");
      if (versBox) {
        versBox.hidden = true; // 关上再点一次按钮，让它重新拉取渲染
        row.querySelector("[data-vers-btn]")?.click();
      }
    }
    document.addEventListener("keyup", (e) => {
      if (e.key === "z" || e.key === "Z") {
        st.z = false;
        refresh();
      }
    });
    window.addEventListener("blur", () => {
      st.z = false;
      st.touch = false;
      if (pv) pv.hidden = true;
      if (gal) gal.hidden = true;
    });
  }
}
