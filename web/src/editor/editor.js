// 画布编辑器：挂载即用。P2 范围：单图层作画（模型已支持多层，UI 在 P3 加图层面板）。
import {
  addLayer,
  b64ToU8,
  composite,
  countOpaque,
  createDoc,
  deleteLayer,
  deserialize,
  getPixel,
  insertLayerAbove,
  MAX_LAYERS,
  mergeDown,
  mergeVisible,
  moveLayer,
  moveLayerTo,
  overPixel,
  restore,
  serialize,
  setPixel,
  snapshot,
} from "./doc.js";
import {
  coverOf,
  ellipsePoints,
  floodFill,
  flipH,
  flipV,
  hexToRgba,
  hsvToRgb,
  linePoints,
  pixelPerfectErase,
  rectPoints,
  rgbToHex,
  rgbToHsv,
  rotate90CW,
  stampPixels,
} from "./paint.js";
import "./editor.css";
import { api, track } from "../api.js";
import { hideTracksFor } from "../scroll.js";
import { uiAlert, uiChoice, uiConfirm, uiPrompt } from "../dialog.js";

// 预设色盘（来源 lospec.com，OuO像素画社区色盘库；各 6~8 色）
const PALETTE_PACKS = [
  { name: "经典8", en: "Endesga 8", by: "Endesga", colors: ["#fdfdf8", "#d32734", "#da7d22", "#e6da29", "#28c641", "#2d93dd", "#7b53ad", "#1b1c33"] },
  { name: "暮色8", en: "SLSO8", by: "SLSO", colors: ["#0d2b45", "#203c56", "#544e68", "#8d697a", "#d08159", "#ffaa5e", "#ffd4a3", "#ffecd6"] },
  { name: "蓝月8", en: "Blue Moon", by: "Nyx", colors: ["#000422", "#0b006f", "#2100d2", "#4200ff", "#5a20ff", "#8248ff", "#9e64ff", "#c38fff"] },
  { name: "夜行8", en: "NYX8", by: "Nyx", colors: ["#08141e", "#0f2a3f", "#20394f", "#f6d6bd", "#c3a38a", "#997577", "#816271", "#4e495f"] },
  { name: "软糖6", en: "Softies 6", by: "Pipstifelle", colors: ["#fdfdfd", "#ffe7ac", "#ffc0d1", "#60ddf0", "#f99b9b", "#5891f5"] },
  { name: "油彩6", en: "Oil 6", by: "Oil", colors: ["#fbf5ef", "#f2d3ab", "#c69fa5", "#8b6d9c", "#494d7e", "#272744"] },
];
const PACK_KEY = "pixel.pack";
const PERSONAL_KEY = "pixel.palette";
const PREFS_KEY = "pixel.prefs"; // 工具/笔刷/视图偏好（10 秒一存 + 关页面存）
const NEWSIZE_KEY = "pixel.newsize"; // 新建弹窗上次尺寸
const ERASER = [0, 0, 0, 0];

function loadPrefs() {
  try {
    const o = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    const out = {};
    if (["pencil", "eraser", "bucket", "eyedropper", "select", "line", "rect", "ellipse"].includes(o.tool)) out.tool = o.tool;
    if (o.size >= 1 && o.size <= 16) out.size = o.size | 0;
    if (typeof o.circle === "boolean") out.circle = o.circle;
    if (o.bop >= 10 && o.bop <= 100) out.bop = o.bop | 0;
    if (["hollow", "filled"].includes(o.fillMode)) out.fillMode = o.fillMode;
    if (o.tol >= 0 && o.tol <= 128) out.tol = o.tol | 0;
    if (typeof o.pp === "boolean") out.pp = o.pp;
    if (typeof o.mirrorH === "boolean") out.mirrorH = o.mirrorH;
    if (typeof o.mirrorV === "boolean") out.mirrorV = o.mirrorV;
    if (typeof o.showGrid === "boolean") out.showGrid = o.showGrid;
    if (typeof o.showMore === "boolean") out.showMore = o.showMore;
    if (typeof o.fg === "string" && /^#[0-9a-f]{6}$/i.test(o.fg)) out.fg = o.fg.toLowerCase();
    if (typeof o.bg === "string" && /^#[0-9a-f]{6}$/i.test(o.bg)) out.bg = o.bg.toLowerCase();
    return out;
  } catch {
    return {};
  }
}

export function mountEditor(root, { guestKey = "pixel.guest", cloud = null, user = null, initial = null, autoShowNew = false } = {}) {
  const S = {
    doc: createDoc(32, 32),
    cloudId: cloud?.id || null,
    cloudTitle: cloud?.title || "",
    user,
    dirty: false,
    tool: "pencil",
    size: 1,
    circle: false,
    bop: 100, // 笔刷不透明度 %
    fg: "#2b2b2b",
    bg: "#ffffff",
    fillMode: "hollow",
    tol: 32,
    zoom: 10,
    showGrid: true,
    mirrorH: false,
    mirrorV: false,
    pp: true,
    showMore: false, // 其他工具折叠
    ...loadPrefs(),
    undo: [],
    redo: [],
    drawing: false,
    panning: null,
    spaceDown: false,
    layerDrag: false, // 图层拖动排序中：此时不显示小图悬停提示/大图
    stroked: false,
    last: null,
    ppHist: [],
    shapeStart: null,
    sel: null, // 轮廓式选区 {x0,y0,x1,y1, li, floating:null|{w,h,data,ox,oy,fx,fy,origin}}：圈选只记虚线框不动像素，拖动才提起
    personal: loadPersonal(),
  };
  // 上次成功落盘的画布原文：内容没变时手动保存也不触发备份位门禁
  let lastSavedDoc = initial ? serialize(initial) : null;

  root.innerHTML = `
    <div class="draw-app">
      <div class="drawer-backdrop" data-drawer-bg hidden></div>
      <div class="draw-rail" data-bar="tools" data-cscroll="y"></div>
      <div class="draw-center">
        <div class="ed-stage" data-cscroll="both"><div class="ed-canvasbox">
          <canvas data-cv="view"></canvas><canvas data-cv="over"></canvas>
        </div></div>
        <div class="draw-status" data-statusbar></div>
      </div>
      <div class="ed-side" data-cscroll="y">
          <div class="px-card stack">
            <label class="tool-lab">缩放 <input type="range" data-zoomslider min="1" max="32" step="1" value="10"></label>
            <b>实际像素</b>
            <div class="mini-wrap"><canvas class="ed-mini" data-cv="mini" width="32" height="32"></canvas><div class="mini-grip" data-minigrip title="拖拉缩放预览"></div></div>
          </div>
          <div class="px-card stack">
            <div class="row" style="justify-content:space-between;align-items:center">
              <b>调色板</b>
              <span class="swatch" data-cur-swatch title="当前颜色"></span>
            </div>
            <div class="wheel-wrap">
              <canvas data-wheel width="180" height="180" title="点击取色"></canvas>
              <div class="wheel-marker" data-marker hidden></div>
            </div>
            <div class="row hex-row">
              <label class="tool-lab">明度 <input type="range" data-val min="5" max="100" value="100" title="调整当前颜色明度"></label>
              <input class="underline-input" data-hex maxlength="7" value="#2b2b2b" spellcheck="false" title="输入 hex 颜色，回车应用">
            </div>
            <label class="tool-lab">预设色盘
              <select data-packsel class="pack-sel" title="预设色盘"></select>
            </label>
            <div class="swatches" data-packgrid></div>
            <div class="swatches" data-self></div>
            <div class="ed-palette-row">
              <button class="tool-btn" data-pal-add title="把当前色存入个人色盘">＋存当前色</button>
            </div>
          </div>
          <div class="px-card stack">
            <b>图层（≤8）</b>
            <div class="layers" data-layers></div>
            <div class="row icon-row" data-layerbtns></div>
            <label class="tool-lab">不透明 <input type="range" data-l-op min="10" max="100" value="100"></label>
            <label class="tool-lab">混合
              <select data-l-blend title="图层混合模式">
                <option value="normal">正常</option>
                <option value="multiply">正片叠底</option>
                <option value="overlay">叠加</option>
              </select>
            </label>
          </div>
          <div class="px-card stack" data-ed-versions hidden>
            <b>历史版本</b>
            <p class="hint" data-ed-vers-hint>读取中…</p>
            <div class="row" data-ed-vers-row hidden style="align-items:center;flex-wrap:nowrap">
              <select data-ed-vers-sel data-ps-pop style="flex:1;min-width:0"></select>
              <button class="px-btn px-btn--sm" data-ed-vers-go style="flex-shrink:0">恢复此版</button>
            </div>
          </div>
        </div>
      <div class="modal-backdrop" data-modal hidden>
        <div class="px-card modal">
          <h2 class="px-title">新建作品</h2>
          <b>尺寸（≤128）</b>
          <div class="row" data-mpresets>
            <button class="tool-btn" data-msize="16">16×16</button>
            <button class="tool-btn" data-msize="32">32×32</button>
            <button class="tool-btn" data-msize="64">64×64</button>
            <button class="tool-btn" data-msize="128">128×128</button>
          </div>
          <div class="row">
            <label class="tool-lab">宽 <input class="px-input num-input" type="number" data-mwidth value="32" min="1" max="128"></label>
            <label class="tool-lab">高 <input class="px-input num-input" type="number" data-mheight value="32" min="1" max="128"></label>
          </div>
          <b>背景</b>
          <div class="row" data-mbgpresets>
            <button class="tool-btn mswatch active" data-mbg="transparent" title="透明底">透明</button>
            <button class="tool-btn mswatch" data-mbg="#ffffff" style="background:#ffffff" title="白底">白</button>
            <button class="tool-btn mswatch" data-mbg="#1b1c33" style="background:#1b1c33;color:#fff" title="午夜">夜</button>
            <button class="tool-btn mswatch" data-mbg="#f5efdd" style="background:#f5efdd" title="牛皮纸">纸</button>
            <button class="tool-btn mswatch" data-mbg="#fdeff1" style="background:#fdeff1" title="淡粉">粉</button>
            <input class="px-input hex-input" data-mhex maxlength="7" value="#ffc93c" spellcheck="false" title="输入 hex 或点开展开色轮自选">
          </div>
          <div class="row mcolor-row" data-mwrow hidden>
            <div class="mini-wheel-wrap"><canvas data-mwheel width="120" height="120"></canvas></div>
            <label class="tool-lab">点轮自选底色</label>
          </div>
          <p class="hint" data-mwarn hidden>当前画布有内容，创建后会被替换。</p>
          <div class="row">
            <button class="px-btn px-btn--cherry" data-mok>创建</button>
            <button class="px-btn" data-mcancel>取消</button>
          </div>
        </div>
      </div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const view = $('[data-cv="view"]');
  const over = $('[data-cv="over"]');
  const mini = $('[data-cv="mini"]');
  const vctx = view.getContext("2d");
  const octx = over.getContext("2d");
  const off = document.createElement("canvas");

  // ---- 像素风图标库（16 格，描边 2px；F=填充，S=描边） ----
  const IC = {
    pencil: '<path fill="currentColor" d="M10.8 2.3l2.9 2.9L6 13H3.1V10L10.8 2.3zM2 14.2h12v1.3H2z"/>',
    eraser: '<path fill="currentColor" d="M9.6 3.1l3.3 3.3-4.9 4.9H5.4l-2.3-2.3 6.5-5.9zM2 14.2h7v1.3H2z"/>',
    bucket: '<path fill="currentColor" d="M8 1.8l5.2 5.2L8 12.2 2.8 7 8 1.8zM12.6 11.2c.9 1 1.4 1.7 1.4 2.2a1.5 1.5 0 11-3 0c0-.5.5-1.2 1.6-2.2z"/>',
    eyedropper: '<path fill="none" stroke="currentColor" stroke-width="2" d="M9.5 2.5l4 4-5.2 5.2-4-4z"/><path fill="currentColor" d="M3.6 11.6L2 14.5l2.9-1.6z"/>',
    select: '<rect x="2.5" y="2.5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/>',
    line: '<path stroke="currentColor" stroke-width="2.4" d="M3 13L13 3"/>',
    rect: '<rect x="3" y="4" width="10" height="8" fill="none" stroke="currentColor" stroke-width="2"/>',
    ellipse: '<ellipse cx="8" cy="8" rx="5.5" ry="4" fill="none" stroke="currentColor" stroke-width="2"/>',
    hollow: '<rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"/>',
    filled: '<rect x="3" y="3" width="10" height="10" fill="currentColor"/>',
    sqHead: '<rect x="4" y="4" width="8" height="8" fill="currentColor"/>',
    rdHead: '<circle cx="8" cy="8" r="4.5" fill="currentColor"/>',
    undo: '<path fill="none" stroke="currentColor" stroke-width="2" d="M6.5 3.5L3 7l3.5 3.5M3 7h6.5a3.5 3.5 0 010 7H7"/>',
    redo: '<path fill="none" stroke="currentColor" stroke-width="2" d="M9.5 3.5L13 7l-3.5 3.5M13 7H6.5a3.5 3.5 0 000 7H9"/>',
    clearBox: '<rect x="2.5" y="2.5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"/><path stroke="currentColor" stroke-width="2" d="M5.5 5.5l5 5M10.5 5.5l-5 5"/>',
    mh: '<path fill="currentColor" d="M7 2v12L2 8l5-6zM9 2v12l5-6-5-6z"/>',
    mv: '<path fill="currentColor" d="M2 7h12L8 2 2 7zM2 9h12l-6 5-6-5z"/>',
    grid: '<path fill="currentColor" d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z"/>',
    fh: '<path fill="none" stroke="currentColor" stroke-width="2" d="M2 5.5h8M7.5 3L10 5.5 7.5 8M14 10.5H6M8.5 8L6 10.5 8.5 13"/>',
    fv: '<path fill="none" stroke="currentColor" stroke-width="2" d="M5.5 2v8M3 7.5L5.5 10 8 7.5M10.5 14V6M8 8.5l2.5 2.5L13 8.5"/>',
    rot: '<path fill="none" stroke="currentColor" stroke-width="2" d="M13.8 8A5.8 5.8 0 112.6 5.4M13.8 2v3.2h-3.2"/>',
    plus: '<path stroke="currentColor" stroke-width="2.4" d="M8 3v10M3 8h10"/>',
    minus: '<path stroke="currentColor" stroke-width="2.4" d="M3 8h10"/>',
    check: '<path fill="none" stroke="currentColor" stroke-width="2.4" d="M2.5 8.5l3.5 3.5 7-8"/>',
    x: '<path stroke="currentColor" stroke-width="2.4" d="M4 4l8 8M12 4l-8 8"/>',
    up: '<path fill="none" stroke="currentColor" stroke-width="2" d="M8 13.5v-11M3.5 7L8 2.5 12.5 7"/>',
    down: '<path fill="none" stroke="currentColor" stroke-width="2" d="M8 2.5v11M3.5 9L8 13.5 12.5 9"/>',
    mergeDown: '<path fill="none" stroke="currentColor" stroke-width="2" d="M8 2v7M4.8 6.5L8 9.7l3.2-3.2M2.5 12h11v2h-11z"/>',
    mergeVis: '<rect x="2" y="5.5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" d="M6 5.5V4a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-1.5"/>',
    trash: '<path fill="none" stroke="currentColor" stroke-width="2" d="M2.5 4h11M6 4V2.5h4V4M4.5 4l.7 10h5.6l.7-10M6.8 7v4M9.2 7v4"/>',
    eye: '<path fill="none" stroke="currentColor" stroke-width="2" d="M1.5 8S4 3.8 8 3.8 12 8 14.5 8 12 12.2 8 12.2 4 8 1.5 8z"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
    eyeOff: '<path fill="none" stroke="currentColor" stroke-width="2" d="M3 3l10 10M6.6 4.2A7.6 7.6 0 018 4c4 0 6.5 4 6.5 4a13 13 0 01-2.4 2.5M9.9 9.9a2 2 0 01-2.8-2.8M4 6.5C3 7.3 1.5 8 1.5 8S4 12.2 8 12.2c.9 0 1.7-.2 2.5-.6"/>',
    copy: '<rect x="5.5" y="5.5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" d="M10.5 5.5v-2a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2"/>',
    cut: '<circle cx="4.5" cy="4.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="4.5" cy="11.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6.3 6.1L14 13M6.3 9.9L14 3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    fit: '<path fill="none" stroke="currentColor" stroke-width="2" d="M2 5.5V2h3.5M14 2h-3.5v3.5M14 10.5V14h-3.5M2 14h3.5v-3.5"/>',
  };
  const ic = (n) => `<svg class="px-ic" viewBox="0 0 16 16" aria-hidden="true">${IC[n] || ""}</svg>`;
  const iconBtn = (attrs, name, label) =>
    `<button class="tool-btn icon-btn" ${attrs} title="${label}">${ic(name)}</button>`;

  // ---- 工具条：Win11 画图式分组 ribbon ----
  const TOOLS = [
    ["pencil", "铅笔(B)"], ["eraser", "橡皮(E)"], ["bucket", "油漆桶(G)"],
    ["eyedropper", "取色(I)"],
  ];
  const SHAPES = [
    ["line", "直线(L)"], ["rect", "矩形(R)"], ["ellipse", "椭圆(O)"],
  ];
  const toolBtns = (list) =>
    list.map(([k, label, icon]) => iconBtn(`data-tool="${k}"`, icon || k, label)).join("");
  $("[data-layerbtns]").innerHTML =
    iconBtn("data-l-add", "plus", "在当前层上方新建图层") +
    iconBtn("data-l-up", "up", "上移") +
    iconBtn("data-l-down", "down", "下移") +
    iconBtn("data-l-merge", "mergeDown", "与下方图层合并") +
    iconBtn("data-l-mergevis", "mergeVis", "合并所有可见层") +
    iconBtn("data-l-del", "trash", "删除当前层");
  const group = (cap, inner, cls = "") =>
    `<div class="ribbon-group ${cls}"><div class="ribbon-row">${inner}</div><span class="ribbon-cap">${cap}</span></div>`;
  const bar = $("[data-bar]");
  const statusbar = $("[data-statusbar]");
  const statusGroup = (cap, inner, cls = "") =>
    `<div class="ribbon-group status-group ${cls}"><div class="ribbon-row">${inner}</div><span class="ribbon-cap">${cap}</span></div>`;
  bar.innerHTML =
    group("工具", toolBtns(TOOLS), "pair") +
    group("选区",
      iconBtn(`data-tool="select"`, "select", "选区(V)") +
      iconBtn("data-sel-copy", "copy", "复制选区到新图层") +
      iconBtn("data-sel-cut", "cut", "剪切选区到新图层") +
      iconBtn("data-sel-del", "trash", "删除选区内的像素"), "pair") +
    group("形状",
      toolBtns(SHAPES) +
      `<button class="tool-btn wide" data-fill title="空心/实心切换">空心</button>`) +
    group("笔刷",
      `<label class="tool-lab">笔粗细 <input type="range" data-size min="1" max="16" value="1" title="笔刷大小([])"><b data-sizev>1</b></label>
       <button class="tool-btn wide" data-circle title="方形/圆形笔头(C)">方头</button>
       <label class="tool-lab">笔浓度 <input type="range" data-bop min="10" max="100" value="100" title="笔刷不透明度"></label>
       <label class="tool-lab">油漆桶容差 <input type="range" data-tol min="0" max="128" value="32" title="越大越容易把近似色一起填上"></label>
       <button class="tool-btn wide active" data-pp title="自动去掉手抖画出的双像素">抖动修正</button>`) +
    group("编辑",
      `<div class="tool-duo">` +
      iconBtn("data-undo", "undo", "撤销(Ctrl+Z)") +
      iconBtn("data-redo", "redo", "重做(Ctrl+Y)") +
      `</div>
       <div class="tool-sep-h"></div>
       <button class="tool-btn wide" data-clear title="清空整个画布，只保留当前层（可撤销）">清空画布</button>
       <div class="tool-sep-h"></div>
       <button class="tool-btn wide active" data-grid title="显示/隐藏像素网格">网格</button>
       <div class="tool-sep-h"></div>
       <button class="tool-btn wide" data-more title="展开更多工具">其他工具 ▸</button>
       <div class="more-tools" data-moretools hidden>
         <button class="tool-btn wide" data-mh title="画笔落点左右对称">水平镜像</button>
         <button class="tool-btn wide" data-mv title="画笔落点上下对称">垂直镜像</button>
         <button class="tool-btn wide" data-fliph title="整个画布左右翻转">水平翻转</button>
         <button class="tool-btn wide" data-flipv title="整个画布上下翻转">垂直翻转</button>
         <button class="tool-btn wide" data-rot title="整个画布顺时针旋转90°">旋转90°</button>
       </div>`);
  statusbar.innerHTML =
    statusGroup("文件",
      `<button class="tool-btn" data-new-canvas title="新建画布">新建</button>
       <button class="tool-btn" data-save title="保存草稿(Ctrl+S)">保存</button>
       <div class="tool-sep"></div>
       <button class="tool-btn" data-export title="导出 PNG 图片">导出</button>
       <select data-scale title="导出倍率"><option value="1">1x</option><option value="2">2x</option><option value="4" selected>4x</option><option value="8">8x</option></select>
       <button class="tool-btn" data-dump title="源文件导出">源导出</button>
       <label class="tool-btn" title="载入源文件（.json）">源载入<input type="file" data-load accept="application/json,.json" hidden></label>
       <div class="tool-sep"></div>
       <a href="#/drafts" class="tool-btn" title="打开草稿箱">草稿箱</a>
       <span class="hint" data-cloud-status></span>`) +
    `<div class="tool-sep"></div>` +
    statusGroup("查看",
      iconBtn("data-zoom=\"-\"", "minus", "缩小(-)") +
      iconBtn("data-zoom=\"+\"", "plus", "放大(+)") +
      iconBtn("data-fit", "fit", "适应窗口") +
      `<b data-zoomlab></b><span class="tool-lab">画布<b data-cur-size></b></span>`) +
    statusGroup("面板",
      `<button class="tool-btn drawer-btn-rail" data-drawer-btn="rail" title="打开/关闭左侧工具栏">工具</button>` +
      `<button class="tool-btn drawer-btn-side" data-drawer-btn="side" title="打开/关闭调色板与图层面板">面板</button>`, "drawer-btns");

  // ---- 窄屏抽屉：≤1080 右栏变抽屉，≤700 左轨也变抽屉（显隐由 CSS 媒体查询管，这里只管开关） ----
  const mqSide = window.matchMedia("(max-width: 1080px)");
  const mqRail = window.matchMedia("(max-width: 700px)");
  const railEl = bar;
  const sideEl = root.querySelector(".draw-app .ed-side");
  const drawerBg = root.querySelector("[data-drawer-bg]");
  railEl?.insertAdjacentHTML("afterbegin", `<button class="tool-btn drawer-close" data-drawer-btn="rail" title="收起左侧工具栏">✕ 收起</button>`);
  sideEl?.insertAdjacentHTML("afterbegin", `<button class="tool-btn drawer-close" data-drawer-btn="side" title="收起右侧面板">✕ 收起</button>`);
  const drawerOf = (w) => (w === "rail" ? railEl : sideEl);
  const syncDrawerBg = () => {
    const anyOpen =
      (sideEl?.classList.contains("open") && mqSide.matches) ||
      (railEl?.classList.contains("open") && mqRail.matches);
    if (drawerBg) drawerBg.hidden = !anyOpen;
  };
  const pokeScroll = () => {
    // 抽屉位移不触发 ResizeObserver，过渡结束（0.18s）后补一次校准让自定义滚动条跟上
    setTimeout(() => window.dispatchEvent(new Event("resize")), 260);
  };
  const setDrawer = (which, open) => {
    const el = drawerOf(which);
    if (!el) return;
    el.classList.toggle("open", !!open);
    clearTimeout(el._drawerT);
    el.classList.toggle("settled", false);
    // 停稳（过渡 0.18s 后）才挂 .settled 显示原生滚动条；关闭瞬间即摘，滑动过程无条可滞后
    if (open) {
      el._drawerT = setTimeout(() => {
        if (el.classList.contains("open")) el.classList.add("settled");
      }, 200);
    }
    el._drawerUntil = Date.now() + 300; // 过渡期内 refresh 一律藏轨，防补帧闪现
    syncDrawerBg();
    hideTracksFor(el); // 即时藏轨（打开走 open 规则，关闭走离屏规则，都由补帧接管）
    pokeScroll(); // 开关都要补：位移不触发 RO，关闭不补就会留下 stale 轨道
  };
  const toggleDrawer = (which) => setDrawer(which, !drawerOf(which)?.classList.contains("open"));
  const shutDrawer = (el) => {
    if (!el) return;
    el.classList.remove("open");
    el.classList.remove("settled"); // 关闭瞬间摘滚动条，滑动过程无条可滞后
    clearTimeout(el._drawerT);
    hideTracksFor(el);
  };
  const closeDrawers = () => {
    shutDrawer(railEl);
    shutDrawer(sideEl);
    syncDrawerBg();
    pokeScroll();
  };
  drawerBg?.addEventListener("click", closeDrawers);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawerBg && !drawerBg.hidden) closeDrawers();
  });
  window.addEventListener("resize", () => {
    // 回到桌面宽度时正在开的抽屉自动收回，避免遮罩残留
    if (!mqSide.matches) shutDrawer(sideEl);
    if (!mqRail.matches) shutDrawer(railEl);
    syncDrawerBg();
    pokeScroll();
  });
  bar.addEventListener("click", (e) => {
    // 左轨抽屉里点中工具即收回（滑块/开关要反复调，不收）
    if (mqRail.matches && e.target.closest("[data-tool]")) setDrawer("rail", false);
  });

  const syncBar = () => {
    root.querySelectorAll("[data-tool]").forEach((b) =>
      b.classList.toggle("active", b.dataset.tool === S.tool)
    );
    $('[data-sizev]').textContent = S.size;
    // 偏好恢复后滑块位置也要跟上（只在值不一致时写，避免打断正在拖的手）
    if (document.activeElement !== $('[data-size]')) $('[data-size]').value = S.size;
    if (document.activeElement !== $('[data-bop]')) $('[data-bop]').value = S.bop;
    if (document.activeElement !== $('[data-tol]')) $('[data-tol]').value = S.tol;
    $("[data-circle]").textContent = S.circle ? "圆头" : "方头";
    const fillBtn = $("[data-fill]");
    fillBtn.textContent = S.fillMode === "filled" ? "实心" : "空心";
    fillBtn.title = "空心/实心切换(F)";
    $("[data-pp]").classList.toggle("active", S.pp);
    $("[data-mh]").classList.toggle("active", S.mirrorH);
    $("[data-mv]").classList.toggle("active", S.mirrorV);
    $("[data-grid]").classList.toggle("active", S.showGrid);
    $("[data-moretools]").hidden = !S.showMore;
    const moreBtn = $("[data-more]");
    moreBtn.textContent = S.showMore ? "其他工具 ▾" : "其他工具 ▸";
    moreBtn.title = S.showMore ? "收起更多工具" : "展开更多工具";
  };
  // 工具点击全部委托到三栏容器（左轨 + 底状态条都在里面）
  root.querySelector(".draw-app").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-drawer-btn")) toggleDrawer(b.dataset.drawerBtn);
    else if (b.dataset.tool) setTool(b.dataset.tool);
    else if (b.hasAttribute("data-circle")) S.circle = !S.circle;
    else if (b.hasAttribute("data-fill"))
      S.fillMode = S.fillMode === "filled" ? "hollow" : "filled";
    else if (b.hasAttribute("data-pp")) S.pp = !S.pp;
    else if (b.hasAttribute("data-mh")) S.mirrorH = !S.mirrorH;
    else if (b.hasAttribute("data-mv")) S.mirrorV = !S.mirrorV;
    else if (b.hasAttribute("data-grid")) {
      S.showGrid = !S.showGrid;
      render(); // 纯视图开关，立即重绘（之前要等下一次落笔才刷新）
    }
    else if (b.hasAttribute("data-undo")) undo();
    else if (b.hasAttribute("data-redo")) redo();
    else if (b.hasAttribute("data-more")) {
      S.showMore = !S.showMore;
      syncBar();
    }
    else if (b.hasAttribute("data-sel-copy")) copySelToLayer();
    else if (b.hasAttribute("data-sel-cut")) cutSelToLayer();
    else if (b.hasAttribute("data-sel-del")) delSel();
    else if (b.hasAttribute("data-clear")) {
      uiConfirm("清空整个画布及所有图层？可撤销。").then((ok) => {
        if (!ok) return;
        pushHistory();
        const keep = S.doc.layers[S.doc.active] ?? S.doc.layers[0];
        keep.pixels.fill(0);
        S.doc.layers = [keep];
        S.doc.active = 0;
        afterEdit();
        syncBar();
      });
    } else if (b.hasAttribute("data-fliph")) {
      pushHistory(); flipH(S.doc); afterEdit();
    } else if (b.hasAttribute("data-flipv")) {
      pushHistory(); flipV(S.doc); afterEdit();
    } else if (b.hasAttribute("data-rot")) {
      pushHistory(); rotate90CW(S.doc); afterEdit();
    }
    syncBar();
  });
  bar.querySelector("[data-size]").oninput = (e) => {
    S.size = Number(e.target.value);
    syncBar();
  };
  bar.querySelector("[data-bop]").oninput = (e) => {
    S.bop = Number(e.target.value);
  };
  bar.querySelector("[data-tol]").oninput = (e) => {
    S.tol = Number(e.target.value);
  };
  // ---- 调色板（预设色盘包 + 个人收藏） ----
  const SOFTIE_IDX = Math.max(0, PALETTE_PACKS.findIndex((p) => p.name === "软糖6"));
  let packInit = Number(localStorage.getItem(PACK_KEY) ?? SOFTIE_IDX);
  if (!Number.isInteger(packInit) || packInit < 0 || packInit >= PALETTE_PACKS.length) {
    packInit = SOFTIE_IDX;
  }
  S.packIdx = packInit;
  const renderPalette = () => {
    const pack = PALETTE_PACKS[S.packIdx];
    const sel = $("[data-packsel]");
    if (!sel.options.length) {
      sel.innerHTML = PALETTE_PACKS.map(
        (p, i) => `<option value="${i}">${p.name}</option>`
      ).join("");
    }
    sel.value = String(S.packIdx);
    sel._psSync?.();
    $("[data-packgrid]").innerHTML = pack.colors
      .map((c) => `<button class="swatch" data-c="${c}" style="background:${c}" title="${c}"></button>`)
      .join("");
    $("[data-self]").innerHTML = S.personal
      .map((c, i) => `<button class="swatch" data-p="${i}" style="background:${c}" title="${c}（点击取色，双击删除）"></button>`)
      .join("");
    [...$("[data-packgrid]").children, ...$("[data-self]").children].forEach((b) =>
      b.classList.toggle("active", (b.dataset.c || S.personal[b.dataset.p]) === S.fg)
    );
    // 右上小色块：所有取色通道都走 renderPalette，在这里统一同步当前色
    const cur = $("[data-cur-swatch]");
    if (cur) {
      cur.style.background = S.fg;
      cur.title = `当前颜色 ${S.fg}`;
    }
  };
  $("[data-packsel]").onchange = (e) => {
    S.packIdx = Number(e.target.value);
    localStorage.setItem(PACK_KEY, String(S.packIdx));
    renderPalette();
  };
  const pickColor = (c) => {
    S.fg = c;
    const [pr, pg, pb] = hexToRgba(c);
    [S.wh, S.ws] = rgbToHsv(pr, pg, pb); // 色相饱和锚点：明度滑动不再累积量化漂移
    const fgi = $('[data-fg]');
    if (fgi) fgi.value = c; // 颜色模块已移除时只有调色板同步
    renderPalette();
    syncWheelUI();
  };
  $("[data-packgrid]").onclick = (e) => {
    const b = e.target.closest("[data-c]");
    if (b) pickColor(b.dataset.c);
  };
  $("[data-self]").onclick = (e) => {
    const b = e.target.closest("[data-p]");
    if (!b) return;
    const c = S.personal[b.dataset.p];
    if (c !== S.fg) pickColor(c); // 同色不重绘，否则连击删会被打断
  };
  $("[data-self]").addEventListener("dblclick", (e) => {
    const b = e.target.closest("[data-p]");
    if (!b) return;
    S.personal.splice(Number(b.dataset.p), 1);
    localStorage.setItem(PERSONAL_KEY, JSON.stringify(S.personal));
    renderPalette();
  });
  $("[data-pal-add]").onclick = () => {
    if (!S.personal.includes(S.fg)) {
      S.personal.push(S.fg);
      localStorage.setItem(PERSONAL_KEY, JSON.stringify(S.personal));
      renderPalette();
    }
  };

  // ---- 色轮（H+S 盘 + 明度条 + hex 直输） ----
  S.wheelV = 1;
  const WHEEL = 180;
  const wheelCv = $("[data-wheel]");
  const wheelMarker = $("[data-marker]");
  function drawWheel() {
    const R = WHEEL / 2;
    const ctx = wheelCv.getContext("2d");
    const img = ctx.createImageData(WHEEL, WHEEL);
    for (let y = 0; y < WHEEL; y++) {
      for (let x = 0; x < WHEEL; x++) {
        const dx = x - R + 0.5;
        const dy = y - R + 0.5;
        const rr = Math.hypot(dx, dy);
        const i = (y * WHEEL + x) * 4;
        if (rr > R) continue;
        let h = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (h < 0) h += 360;
        const [cr, cg, cb] = hsvToRgb(h / 360, Math.min(1, rr / R), S.wheelV);
        img.data[i] = cr;
        img.data[i + 1] = cg;
        img.data[i + 2] = cb;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function syncWheelUI() {
    // hex 文本 + 标记 + 明度滑块三方互相同步（明度不再是色轮私有状态）
    $('[data-hex]').value = S.fg;
    const [r, g, b] = hexToRgba(S.fg);
    const [h0, s0, v] = rgbToHsv(r, g, b);
    // 标记用锚点色相/饱和（取色瞬间的值），避免反复量化导致圆点抖动
    const h = S.wh ?? h0;
    const s = S.ws ?? s0;
    if (Math.abs(v - S.wheelV) > 0.004) {
      S.wheelV = v;
      $('[data-val]').value = Math.round(v * 100);
      drawWheel(); // 轮面亮度跟随当前色（色轮拖动时 v 不变，不会触发）
    }
    const R = WHEEL / 2;
    const rad = (h * 360 * Math.PI) / 180;
    wheelMarker.hidden = false;
    wheelMarker.style.left = `${((R + s * R * Math.cos(rad)) / WHEEL) * 100}%`;
    wheelMarker.style.top = `${((R + s * R * Math.sin(rad)) / WHEEL) * 100}%`;
  }
  function pickFromWheel(e) {
    const r = wheelCv.getBoundingClientRect();
    const R = r.width / 2;
    const dx = e.clientX - (r.left + R);
    const dy = e.clientY - (r.top + R);
    if (Math.hypot(dx, dy) > R) return;
    let h = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (h < 0) h += 360;
    const [cr, cg, cb] = hsvToRgb(h / 360, Math.min(1, Math.hypot(dx, dy) / R), S.wheelV);
    pickColor(rgbToHex(cr, cg, cb));
  }
  let wheelDown = false;
  wheelCv.addEventListener("pointerdown", (e) => {
    wheelDown = true;
    wheelCv.setPointerCapture(e.pointerId);
    pickFromWheel(e);
  });
  wheelCv.addEventListener("pointermove", (e) => {
    if (wheelDown) pickFromWheel(e);
  });
  wheelCv.addEventListener("pointerup", () => (wheelDown = false));
  $("[data-val]").oninput = (e) => {
    // 明度滑块实时改变当前色（锚点色相饱和不变），hex/轮面跟随
    const nv = Number(e.target.value) / 100;
    let h = S.wh;
    let s = S.ws;
    if (h === undefined || s === undefined) {
      const [r0, g0, b0] = hexToRgba(S.fg);
      [h, s] = rgbToHsv(r0, g0, b0);
      S.wh = h;
      S.ws = s;
    }
    const [nr, ng, nb] = hsvToRgb(h, s, nv);
    S.wheelV = nv;
    S.fg = rgbToHex(nr, ng, nb);
    renderPalette();
    syncWheelUI();
    drawWheel();
  };
  $("[data-hex]").onchange = (e) => {
    let v = e.target.value.trim();
    if (!v.startsWith("#")) v = `#${v}`;
    if (/^#[0-9a-f]{6}$/i.test(v)) pickColor(v.toLowerCase());
    else e.target.value = S.fg;
  };

  // ---- 图层面板 ----
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  // 图层小图：层像素 + 浮动选区（提起后层上是洞，按主画布的样子把浮动画回去）
  function paintThumb(cv, i) {
    const ctx = cv.getContext("2d");
    ctx.putImageData(
      new ImageData(S.doc.layers[i].pixels, S.doc.w, S.doc.h), 0, 0
    );
    if (S.sel?.floating && (S.sel.li ?? S.doc.active) === i) {
      const floating = S.sel.floating;
      const { fx, fy } = floating;
      const img = ctx.getImageData(0, 0, S.doc.w, S.doc.h);
      const d = img.data;
      for (let y = 0; y < floating.h; y++)
        for (let x = 0; x < floating.w; x++) {
          const si = (y * floating.w + x) * 4;
          if (!floating.data[si + 3]) continue;
          const gx = fx + x, gy = fy + y;
          if (gx < 0 || gy < 0 || gx >= S.doc.w || gy >= S.doc.h) continue;
          const di = (gy * S.doc.w + gx) * 4;
          d[di] = floating.data[si];
          d[di + 1] = floating.data[si + 1];
          d[di + 2] = floating.data[si + 2];
          d[di + 3] = floating.data[si + 3];
        }
      ctx.putImageData(img, 0, 0);
    }
  }
  function renderLayers() {
    const box = $("[data-layers]");
    const rows = [];
    for (let i = S.doc.layers.length - 1; i >= 0; i--) {
      const l = S.doc.layers[i];
      rows.push(`
        <div class="layer${i === S.doc.active ? " on" : ""}" data-li="${i}" draggable="true">
          <canvas width="${S.doc.w}" height="${S.doc.h}"></canvas>
          <button class="tool-btn icon-btn" data-eye title="显示/隐藏">${ic(l.visible ? "eye" : "eyeOff")}</button>
          <span class="layer-name" title="拖动排序，单击选中，双击重命名">${esc(l.name)}</span>
        </div>`);
    }
    box.innerHTML = rows.join("");
    box.querySelectorAll(".layer").forEach((row) => {
      paintThumb(row.querySelector("canvas"), Number(row.dataset.li));
    });
    const cur = S.doc.layers[S.doc.active];
    $("[data-l-op]").value = Math.round(cur.opacity * 100);
    $("[data-l-blend]").value = cur.blend || "normal";
    $("[data-l-blend]")._psSync?.();
  }
  $("[data-layers]").addEventListener("click", (e) => {
    const row = e.target.closest("[data-li]");
    if (!row) return;
    const i = Number(row.dataset.li);
    if (e.target.closest("[data-eye]")) {
      pushHistory();
      S.doc.layers[i].visible = !S.doc.layers[i].visible;
      afterEdit();
      return;
    }
    if (S.doc.active === i) return; // 已选中不再重绘，否则连击重命名会被打断
    if (S.sel?.floating) {
      // 有浮动像素：先落回原层，再切（否则像素会被贴到新层去）
      S.doc.active = selLi();
      commitSel();
    }
    if (S.sel) S.sel.li = i; // 纯框选跟随活动层：在哪层圈的，换到哪层都生效
    S.doc.active = i;
    renderLayers();
  });
  $("[data-layers]").addEventListener("dblclick", async (e) => {
    const row = e.target.closest("[data-li]");
    if (!row) return;
    const i = Number(row.dataset.li);
    const name = await uiPrompt("图层名", S.doc.layers[i].name);
    if (name?.trim()) {
      S.doc.layers[i].name = name.trim().slice(0, 12);
      renderLayers();
    }
  });
  // 图层拖动排序（HTML5 DnD）：行按视觉上下排（顶层在上），落点按中线分上下
  let dragLi = null;
  const layersBox = $("[data-layers]");
  const clearDropMark = () =>
    layersBox.querySelectorAll(".drop-before,.drop-after").forEach((r) => r.classList.remove("drop-before", "drop-after"));
  layersBox.addEventListener("dragstart", (e) => {
    const row = e.target.closest?.("[data-li]");
    if (!row) return;
    dragLi = Number(row.dataset.li);
    S.layerDrag = true;
    // 拖起来就藏提示框，拖的过程中悬停也不再弹出来
    const pv0 = document.querySelector("#draft-preview");
    const hint0 = document.querySelector("#draft-hint");
    if (pv0) pv0.hidden = true;
    if (hint0) hint0.hidden = true;
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(dragLi)); } catch { /* Firefox 没这行不给拖 */ }
  });
  layersBox.addEventListener("dragover", (e) => {
    if (dragLi == null) return;
    const row = e.target.closest?.("[data-li]");
    if (!row) return;
    e.preventDefault(); // 允许落下
    e.dataTransfer.dropEffect = "move";
    clearDropMark();
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
  });
  layersBox.addEventListener("dragleave", (e) => {
    const row = e.target.closest?.("[data-li]");
    if (row && !row.contains(e.relatedTarget)) row.classList.remove("drop-before", "drop-after");
  });
  layersBox.addEventListener("drop", (e) => {
    const row = e.target.closest?.("[data-li]");
    if (row && dragLi != null) {
      e.preventDefault();
      const toLi = Number(row.dataset.li);
      if (toLi !== dragLi) {
        const r = row.getBoundingClientRect();
        const above = e.clientY < r.top + r.height / 2; // 视觉上方 = 更靠近顶层
        const b = toLi > dragLi ? toLi - 1 : toLi; // 拿掉拖动层后，目标在剩余数组里的下标
        const to = above ? b + 1 : b;
        if (to !== dragLi) {
          if (S.sel) commitSel(); // 有浮动落回，纯框选直接取消（选区记的是层下标）
          pushHistory();
          if (moveLayerTo(S.doc, dragLi, to)) afterEdit();
          else { S.undo.pop(); } // 没动成，吃掉刚记的空历史
        }
      }
    }
    dragLi = null;
    S.layerDrag = false;
    clearDropMark();
  });
  layersBox.addEventListener("dragend", () => { dragLi = null; S.layerDrag = false; clearDropMark(); });
  // ---- 图层小图按 Z 预览大图（悬停出提示，按住 Z 出该层放大图，只读不改选中） ----
  (function wireLayerPreview() {
    const box = $("[data-layers]");
    const ensure = () => {
      if (!document.querySelector("#draft-preview")) {
        const pv = document.createElement("div");
        pv.id = "draft-preview";
        pv.className = "px-card";
        pv.hidden = true;
        pv.innerHTML = "<b></b><canvas></canvas>";
        document.body.appendChild(pv);
      }
      if (!document.querySelector("#draft-hint")) {
        const hint = document.createElement("div");
        hint.id = "draft-hint";
        hint.className = "px-tip";
        hint.hidden = true;
        document.body.appendChild(hint);
      }
    };
    ensure();
    const getPV = () => document.querySelector("#draft-preview");
    const getHint = () => document.querySelector("#draft-hint");
    let hoverLi = -1,
      lastX = 0,
      lastY = 0,
      zDown = false;
    const hide = () => {
      const p = getPV(),
        h = getHint();
      if (p) p.hidden = true;
      if (h) h.hidden = true;
    };
    const showHint = (x, y) => {
      const hint = getHint(),
        pv = getPV();
      if (!hint || !pv) return;
      pv.hidden = true;
      hint.hidden = false;
      hint.textContent = "按住 Z 显示大图";
      const w = hint.offsetWidth || 160,
        h = hint.offsetHeight || 32;
      let lx = x + 16,
        ly = y + 18;
      if (lx + w > window.innerWidth - 8) lx = x - w - 12;
      if (ly + h > window.innerHeight - 8) ly = y - h - 12;
      hint.style.left = `${Math.max(4, lx)}px`;
      hint.style.top = `${Math.max(4, ly)}px`;
    };
    const place = (x, y) => {
      const pv = getPV(),
        hint = getHint();
      if (!pv || !hint) return;
      pv.hidden = false;
      hint.hidden = true;
      const w = pv.offsetWidth || 200,
        h = pv.offsetHeight || 200;
      let lx = x + 16,
        ly = y + 18;
      if (lx + w > window.innerWidth - 8) lx = x - w - 12;
      if (ly + h > window.innerHeight - 8) ly = y - h - 12;
      pv.style.left = `${Math.max(4, lx)}px`;
      pv.style.top = `${Math.max(4, ly)}px`;
    };
    const renderBig = () => {
      const pv = getPV();
      if (!pv || hoverLi < 0) return false;
      const l = S.doc.layers[hoverLi];
      if (!l) return false;
      try {
        const s = Math.max(1, Math.min(6, Math.floor(200 / Math.max(S.doc.w, S.doc.h))));
        const cap = pv.querySelector("b"),
          c = pv.querySelector("canvas");
        if (cap) cap.textContent = l.name || `图层 ${hoverLi + 1}`;
        c.width = S.doc.w * s;
        c.height = S.doc.h * s;
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        const tmp = document.createElement("canvas");
        tmp.width = S.doc.w;
        tmp.height = S.doc.h;
        tmp.getContext("2d").putImageData(new ImageData(l.pixels, S.doc.w, S.doc.h), 0, 0);
        ctx.drawImage(tmp, 0, 0, c.width, c.height);
        return true;
      } catch {
        return false;
      }
    };
    const update = () => {
      if (hoverLi < 0) return;
      if (zDown) {
        if (renderBig()) place(lastX, lastY);
      } else showHint(lastX, lastY);
    };
    // 提示与大图只跟小图画布本身，眼睛/名字等区域不触发
    const thumbOf = (t) => (t?.tagName === "CANVAS" ? t.closest?.("[data-li]") : null);
    box.addEventListener("mouseover", (e) => {
      if (S.layerDrag) return;
      const r = thumbOf(e.target);
      if (!r) return;
      hoverLi = Number(r.dataset.li);
      lastX = e.clientX;
      lastY = e.clientY;
      update();
    });
    box.addEventListener("mousemove", (e) => {
      if (S.layerDrag) return;
      const r = thumbOf(e.target);
      if (r) {
        hoverLi = Number(r.dataset.li);
        lastX = e.clientX;
        lastY = e.clientY;
        update();
      } else if (hoverLi >= 0) {
        hoverLi = -1;
        hide();
      }
    });
    box.addEventListener("mouseout", (e) => {
      if (thumbOf(e.target)) {
        hoverLi = -1;
        hide();
      }
    });
    const typing = () => {
      const t = document.activeElement;
      return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    document.addEventListener("keydown", (e) => {
      if ((e.key === "z" || e.key === "Z") && !e.repeat && !e.ctrlKey && !e.metaKey && !typing() && !S.layerDrag) {
        zDown = true;
        if (hoverLi >= 0) {
          e.preventDefault();
          update();
        }
      }
    });
    document.addEventListener("keyup", (e) => {
      if (e.key === "z" || e.key === "Z") {
        zDown = false;
        hide();
        if (hoverLi >= 0) update();
      }
    });
    window.addEventListener("blur", () => {
      zDown = false;
      hide();
    });
  })();
  const layerBtns = {
    "data-l-add": () => {
      if (insertLayerAbove(S.doc, S.doc.active) < 0) uiAlert("最多 8 层，先合并吧");
    },
    "data-l-up": () => moveLayer(S.doc, S.doc.active, 1),
    "data-l-down": () => moveLayer(S.doc, S.doc.active, -1),
    "data-l-merge": () => {
      if (!mergeDown(S.doc, S.doc.active)) uiAlert("最底层没有可合并的目标");
    },
    "data-l-mergevis": () => {
      if (!mergeVisible(S.doc)) uiAlert("可见层不足 2 层，没什么可合并的");
    },
  };
  root.querySelector(".ed-side").addEventListener("click", async (e) => {
    if (e.target.closest("[data-l-del]")) {
      if (S.doc.layers.length > 1 && (await uiConfirm(`删除「${S.doc.layers[S.doc.active].name}」？可撤销。`))) {
        if (S.sel?.floating) S.sel = null; // 浮动跟随删掉的层一起走，不单独落回
        pushHistory();
        deleteLayer(S.doc, S.doc.active);
        if (S.sel && !S.sel.floating) S.sel.li = S.doc.active; // 纯框选跟随活动层
        afterEdit();
      } else if (S.doc.layers.length <= 1) {
        // 只有一层时，删除当前层 = 清空画布
        if (await uiConfirm("清空画布，继续？", "清空")) {
          pushHistory();
          S.doc.layers[0].pixels.fill(0);
          afterEdit();
        }
      }
      return;
    }
    for (const [attr, fn] of Object.entries(layerBtns)) {
      if (e.target.closest(`[${attr}]`)) {
        if (S.sel?.floating && (attr === "data-l-merge" || attr === "data-l-mergevis")) {
          S.doc.active = selLi();
          commitSel(); // 合并前先落回原层，否则浮动像素会被吞掉
        }
        pushHistory();
        await fn();
        if (S.sel && !S.sel.floating && attr !== "data-l-add") S.sel.li = S.doc.active; // 纯框选跟随活动层（新建层不抢）
        afterEdit();
        return;
      }
    }
  });
  // 不透明度/混合：按下时记一次历史，拖动实时渲染
  let layerPropPushed = false;
  const armHistory = () => {
    if (!layerPropPushed) {
      pushHistory();
      layerPropPushed = true;
    }
  };
  const opSlider = $("[data-l-op]");
  opSlider.addEventListener("pointerdown", armHistory);
  opSlider.addEventListener("input", () => {
    S.doc.layers[S.doc.active].opacity = Number(opSlider.value) / 100;
    render();
  });
  opSlider.addEventListener("change", () => {
    layerPropPushed = false;
    afterEdit();
  });
  const blendSel = $("[data-l-blend]");
  blendSel.addEventListener("pointerdown", armHistory);
  blendSel.addEventListener("change", () => {
    S.doc.layers[S.doc.active].blend = blendSel.value;
    layerPropPushed = false;
    afterEdit();
  });

  // ---- 渲染 ----
  function render() {
    const { doc, zoom } = S;
    view.width = doc.w * zoom;
    view.height = doc.h * zoom;
    over.width = view.width;
    over.height = view.height;
    off.width = doc.w;
    off.height = doc.h;
    const merged = composite(doc);
    // 叠加浮动选区
    if (S.sel?.floating) {
      const f = S.sel.floating;
      for (let y = 0; y < f.h; y++)
        for (let x = 0; x < f.w; x++) {
          const a = f.data[(y * f.w + x) * 4 + 3];
          if (!a) continue;
          const dx = f.fx + x;
          const dy = f.fy + y;
          if (dx < 0 || dy < 0 || dx >= doc.w || dy >= doc.h) continue;
          const di = (dy * doc.w + dx) * 4;
          const si = (y * f.w + x) * 4;
          const fa = a / 255;
          const ba = merged[di + 3] / 255;
          const oa = fa + ba * (1 - fa);
          merged[di] = Math.round((f.data[si] * fa + merged[di] * ba * (1 - fa)) / (oa || 1));
          merged[di + 1] = Math.round((f.data[si + 1] * fa + merged[di + 1] * ba * (1 - fa)) / (oa || 1));
          merged[di + 2] = Math.round((f.data[si + 2] * fa + merged[di + 2] * ba * (1 - fa)) / (oa || 1));
          merged[di + 3] = Math.round(oa * 255);
        }
    }
    off.getContext("2d").putImageData(new ImageData(merged, doc.w, doc.h), 0, 0);
    vctx.imageSmoothingEnabled = false;
    vctx.clearRect(0, 0, view.width, view.height);
    vctx.drawImage(off, 0, 0, view.width, view.height);
    if (S.showGrid && zoom >= 6) {
      vctx.strokeStyle = "rgba(43,43,43,0.18)";
      vctx.lineWidth = 1;
      vctx.beginPath();
      for (let x = 1; x < doc.w; x++) {
        vctx.moveTo(x * zoom + 0.5, 0);
        vctx.lineTo(x * zoom + 0.5, view.height);
      }
      for (let y = 1; y < doc.h; y++) {
        vctx.moveTo(0, y * zoom + 0.5);
        vctx.lineTo(view.width, y * zoom + 0.5);
      }
      vctx.stroke();
    }
    // 选区蚂蚁线：只画虚线框，不动像素；白色衬底 + 粉色虚线双色，任何底色都可见
    if (S.sel) {
      const b = selBox();
      const sx = b.x * zoom, sy = b.y * zoom, sw = b.w * zoom, sh = b.h * zoom;
      octx.lineWidth = 3;
      octx.strokeStyle = "#ffffff";
      octx.setLineDash([]);
      octx.strokeRect(sx, sy, sw, sh);
      octx.lineWidth = 2;
      octx.strokeStyle = "#ff4d6d";
      octx.setLineDash([6, 4]);
      octx.strokeRect(sx, sy, sw, sh);
      octx.setLineDash([]);
    }
    // 1:1 预览（用户拖过角标则用记忆尺寸，不再自动算）
    // 复用主画布已算好的 merged（含浮动选区）：省一次全量 composite，
    // 且 mini 与主画布一致（之前 mini 用 fresh composite，拖选区时 mini 显示黑洞）
    mini.width = doc.w;
    mini.height = doc.h;
    const mctx = mini.getContext("2d");
    mctx.putImageData(new ImageData(merged, doc.w, doc.h), 0, 0);
    applyMiniSize();
    syncZoomUI();
  }

  // 涂抹 / 移层是高频 pointermove 路径（高回报率鼠标一帧多个事件）：
  // 合并到一帧一次 render，避免一帧多次全量 composite；低频调用仍直接 render()
  let renderQueued = false;
  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  // 实际像素预览尺寸：默认自动（长边 160 内），拖过角标后记忆并 clamp 到栏宽
  const MINIW_KEY = "pixel.miniw";
  S.miniW = Number(localStorage.getItem(MINIW_KEY)) || 0;
  function miniMaxW() {
    const card = mini.closest(".px-card");
    return Math.max(48, (card ? card.clientWidth : 212) - 40);
  }
  function applyMiniSize() {
    const maxW = miniMaxW();
    let w = S.miniW;
    if (!w) {
      const scale = Math.min(1, 160 / Math.max(S.doc.w, S.doc.h));
      w = Math.max(32, S.doc.w * scale * 4);
    }
    w = Math.min(maxW, Math.max(48, w));
    mini.style.width = `${w}px`;
    mini.style.height = "auto";
    // 透明棋盘跟着显示比例走：格子 = 1 个显示像素
    const tile = w / S.doc.w;
    mini.style.background = `repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / ${tile}px ${tile}px`;
  }
  let miniDrag = null;
  $("[data-minigrip]").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    miniDrag = { x: e.clientX, w: mini.getBoundingClientRect().width };
    e.target.setPointerCapture(e.pointerId);
  });
  $("[data-minigrip]").addEventListener("pointermove", (e) => {
    if (!miniDrag) return;
    S.miniW = Math.min(miniMaxW(), Math.max(48, miniDrag.w + (e.clientX - miniDrag.x)));
    localStorage.setItem(MINIW_KEY, String(Math.round(S.miniW)));
    applyMiniSize();
  });
  $("[data-minigrip]").addEventListener("pointerup", () => (miniDrag = null));

  // 棋盘格透明底：画在 view 下层（用 CSS，格子 = 1 像素）。
  // repeating-conic 一个 tile 含 2x2 象限，所以 tile 边长 = 2 倍 zoom。
  function paintCheckerBg() {
    const t = S.zoom * 2;
    view.style.background = `repeating-conic-gradient(#d9d2c7 0 25%, #fff 0 50%) 0 0 / ${t}px ${t}px`;
  }

  // ---- 历史 ----
  function pushHistory() {
    S.undo.push(snapshot(S.doc));
    if (S.undo.length > 50) S.undo.shift();
    S.redo.length = 0;
  }
  function undo() {
    const s = S.undo.pop();
    if (!s) return;
    S.redo.push(snapshot(S.doc));
    restore(S.doc, s);
    S.sel = null;
    afterEdit();
  }
  function redo() {
    const s = S.redo.pop();
    if (!s) return;
    S.undo.push(snapshot(S.doc));
    restore(S.doc, s);
    S.sel = null;
    afterEdit();
  }

  let saveTimer = 0;
  function afterEdit() {
    render();
    renderLayers();
    if (S.cloudId && S.user) {
      // 云端模式：落笔防抖 2s 存 + 30s 兜底（见下方 interval）
      S.dirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (S.dirty) saveCloud(true);
      }, 2000);
    } else {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try {
          localStorage.setItem(guestKey, serialize(S.doc));
        } catch {
          /* 配额满就放弃，云端草稿在 P4 */
        }
      }, 800);
    }
  }

  function cloudStatus(text) {
    const el = $("[data-cloud-status]");
    if (text) {
      el.textContent = text;
      return;
    }
    el.textContent = S.cloudId
      ? `云端 · ${S.cloudTitle || "未命名"}`
      : S.user
        ? "本机（已登录，保存即上云）"
        : "本机草稿（登录后上云）";
  }

  // 备份位门禁：手动存档最多 15 个（自动保存有独立 1 位，不用问），满了先问用户腾地方
  // forSave=true：选①新建副本时返回 { fork }（不碰原稿最老存档），调用方切到副本继续；
  //   选②清最老后返回 true；取消返回 false。回滚与手动保存都走 forSave=true
  async function ensureVersionSlot(draftId, forSave = false) {
    let vs = [];
    try {
      const r = await api("GET", `/api/drafts/${draftId}/versions`);
      if (r.status !== 200) return true; // 读不到就不挡路
      vs = (r.data.versions || []).filter((v) => v.kind !== "auto");
    } catch {
      return true;
    }
    if (vs.length < 15) return true;
    const pick = await uiChoice({
      title: "手动存档已满（15 个）",
      msg: "这个作品的手动备份位用完了（自动保存不受影响）。请先腾个地方（不推荐直接取消）。",
      choices: [
        { value: "copy", label: "新建作品副本", primary: true },
        { value: "clean", label: "清理最老存档" },
        { value: "cancel", label: "取消保存" },
      ],
    });
    if (pick === "copy") {
      // 先把当前已落盘的状态另存一份副本
      const dr = await api("POST", `/api/drafts/${draftId}/duplicate`);
      if (dr.status !== 201) {
        uiAlert("建副本失败，稍后重试");
        return false;
      }
      // 保存时直接搬到副本上继续：历史记录清零；回滚则仍在原稿腾位继续
      if (forSave) return { fork: dr.data.draft };
    } else if (pick !== "clean") {
      return false; // 取消（含 Esc / 点遮罩）
    }
    const oldest = vs[vs.length - 1]; // 版本列表按新到老排，末尾即最老
    const del = await api("DELETE", `/api/drafts/${draftId}/versions/${oldest.id}`);
    if (del.status !== 200) {
      uiAlert("清理失败，重试一下");
      return false;
    }
    return true;
  }

  async function saveCloud(silent) {
    if (!S.user) {
      if (!silent && (await uiConfirm("登录后草稿存云端，现在去登录？本机草稿不会丢。", "去登录")))
        location.hash = "#/login";
      return false;
    }
    clearTimeout(saveTimer); // 手动保存后取消排队的防抖保存，避免一次手点发两次 PUT
    cloudStatus("保存中…");
    const merged = composite(S.doc);
    const cov = coverOf(merged, S.doc.w, S.doc.h);
    const payload = {
      doc: serialize(S.doc),
      cover: JSON.stringify({ w: cov.w, h: cov.h, data: cov.data }),
      auto: silent, // 静默保存 = 自动保存，走独立存档位，不占手动位
    };
    try {
      if (!S.cloudId) {
        const r = await api("POST", "/api/drafts",
          JSON.stringify({ title: "未命名", ...payload }));
        if (r.status !== 201) throw new Error();
        S.cloudId = r.data.draft.id;
        S.cloudTitle = r.data.draft.title;
        lastSavedDoc = payload.doc;
        try { localStorage.setItem("pixel.lastOpen", String(S.cloudId)); } catch { /* ignore */ }
      } else {
        // 内容没变后端不会产生快照，直接存不问；真改动且备份满了才问
        if (!silent && lastSavedDoc !== null && payload.doc !== lastSavedDoc) {
          const slot = await ensureVersionSlot(S.cloudId, true);
          if (slot === false) {
            cloudStatus();
            return false;
          }
          if (slot && typeof slot === "object") {
            // 选了“新建作品副本”：直接搬到副本上继续存，历史从零开始
            S.cloudId = slot.fork.id;
            S.cloudTitle = slot.fork.title;
            try { localStorage.setItem("pixel.lastOpen", String(S.cloudId)); } catch { /* ignore */ }
            refreshEdVersions();
          }
        }
        const r = await api("PUT", `/api/drafts/${S.cloudId}`, JSON.stringify(payload));
        if (r.status !== 200) throw new Error();
        lastSavedDoc = payload.doc;
      }
      S.dirty = false;
      cloudStatus();
      track("save"); // T70 保存转化
      return true;
    } catch {
      cloudStatus("保存失败，稍后点保存重试");
      return false;
    }
  }

  // 30s 兜底保存（只在画布页且有脏数据时）
  if (window.__pxTimer) clearInterval(window.__pxTimer);
  window.__pxTimer = setInterval(() => {
    if (location.hash.startsWith("#/draw") && S.dirty && S.cloudId && S.user)
      saveCloud(true);
  }, 30000);

  function exportPNG() {
    const scale = Number($("[data-scale]").value) || 4;
    const c = document.createElement("canvas");
    c.width = S.doc.w * scale;
    c.height = S.doc.h * scale;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const off2 = document.createElement("canvas");
    off2.width = S.doc.w;
    off2.height = S.doc.h;
    off2.getContext("2d").putImageData(new ImageData(composite(S.doc), S.doc.w, S.doc.h), 0, 0);
    ctx.drawImage(off2, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `pixel-${S.doc.w}x${S.doc.h}-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
  }

  function dumpFile() {
    const blob = new Blob([serialize(S.doc)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `draft-${Date.now()}.pixel.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function loadFile(file) {
    let d;
    try {
      d = deserialize(await file.text());
    } catch {
      uiAlert("源文件损坏，打不开");
      return;
    }
    if (!d || d.w < 1 || d.w > 128 || d.h < 1 || d.h > 128 || !d.layers?.length || d.layers.length > 8) {
      uiAlert("源文件不合法（尺寸/图层超限）");
      return;
    }
    if (countOpaque(composite(S.doc)) > 0 && !(await uiConfirm("载入会替换当前画布，继续？"))) return;
    S.doc = d;
    S.doc.active = Math.min(d.active || 0, d.layers.length - 1);
    S.undo.length = 0;
    S.redo.length = 0;
    S.sel = null;
    syncCanvasLabel();
    fitZoom();
    afterEdit();
  }

  $("[data-save]").onclick = () => saveCloud(false);
  $("[data-export]").onclick = exportPNG;
  $("[data-dump]").onclick = dumpFile;
  $("[data-load]").onchange = (e) => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
    e.target.value = "";
  };

  // ---- 落笔 ----
  const evPos = (e) => {
    const r = view.getBoundingClientRect();
    return [
      Math.floor((e.clientX - r.left) / (r.width / S.doc.w)),
      Math.floor((e.clientY - r.top) / (r.height / S.doc.h)),
    ];
  };
  const mirrorOf = (x, y) => {
    const pts = [[x, y]];
    if (S.mirrorH) pts.push([S.doc.w - 1 - x, y]);
    if (S.mirrorV) pts.push([x, S.doc.h - 1 - y]);
    if (S.mirrorH && S.mirrorV) pts.push([S.doc.w - 1 - x, S.doc.h - 1 - y]);
    return pts;
  };
  function dab(x, y, rgba) {
    const li = S.doc.active;
    const op = S.bop / 100;
    for (const [mx, my] of mirrorOf(x, y))
      for (const [px, py] of stampPixels(mx, my, S.size, S.circle)) {
        // PP 只在 1px 实笔、无镜像时启用
        if (S.pp && S.size === 1 && op === 1 && !S.mirrorH && !S.mirrorV && rgba !== ERASER) {
          S.ppHist.push([px, py]);
          const bad = pixelPerfectErase(S.ppHist);
          if (bad) setPixel(S.doc, li, bad[0], bad[1], [0, 0, 0, 0]);
        }
        overPixel(S.doc, li, px, py, rgba, op);
      }
  }
  function strokeTo(x, y, rgba) {
    for (const [px, py] of linePoints(S.last[0], S.last[1], x, y)) dab(px, py, rgba);
    S.last = [x, y];
  }

  function shapePts(tool, x0, y0, x1, y1) {
    if (tool === "line") return linePoints(x0, y0, x1, y1);
    if (tool === "rect") {
      const cx0 = Math.min(x0, x1);
      const cy0 = Math.min(y0, y1);
      return rectPoints(cx0, cy0, Math.max(x0, x1), Math.max(y0, y1), S.fillMode === "filled");
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    return ellipsePoints(cx, cy, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, S.fillMode === "filled");
  }
  function previewShape(pts, color) {
    octx.clearRect(0, 0, over.width, over.height);
    octx.fillStyle = color;
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x >= S.doc.w || y >= S.doc.h) continue;
      octx.fillRect(x * S.zoom, y * S.zoom, S.zoom, S.zoom);
    }
  }

  // 中键按下不触发浏览器自动滚动（否则会劫持拖拽平移）
  view.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault();
  });
  // 画布取色（取色工具 + 右键临时取色共用）：只取不透明像素
  function pickAtPixel(x, y) {
    if (x < 0 || y < 0 || x >= S.doc.w || y >= S.doc.h) return false;
    const c = composite(S.doc);
    const i = (y * S.doc.w + x) * 4;
    if (c[i + 3] <= 0) return false;
    pickColor(`#${[c[i], c[i + 1], c[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
    return true;
  }
  view.addEventListener("contextmenu", (e) => e.preventDefault());
  view.addEventListener("pointerdown", (e) => {
    try {
      view.setPointerCapture(e.pointerId);
    } catch {
      /* 中键等场景捕获可能失败，不影响平移/落笔 */
    }
    // 平移：中键拖拽 / 空格+左键拖拽（此时不落笔）
    if (e.button === 1 || S.spaceDown) {
      e.preventDefault();
      S.panning = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
      stage.style.cursor = "grabbing";
      return;
    }
    // Ctrl+左键拖拽 = 移动当前图层（任意工具下都优先）
    if ((e.ctrlKey || e.metaKey) && e.button === 0) {
      e.preventDefault();
      pushHistory();
      const li = S.doc.active;
      S.moving = {
        li,
        sx: e.clientX,
        sy: e.clientY,
        orig: S.doc.layers[li].pixels.slice(),
      };
      view.setPointerCapture?.(e.pointerId);
      stage.style.cursor = "move";
      return;
    }
    // 右键 = 临时取色（按下取色，按住拖动连取，松开结束，不换工具）
    if (e.button === 2) {
      e.preventDefault();
      S.rPick = true;
      const [rx, ry] = evPos(e);
      pickAtPixel(rx, ry);
      return;
    }
    if (!S.stroked) {
      S.stroked = true;
      track("stroke"); // T70 试画转化
    }
    const [x, y] = evPos(e);
    if (S.tool === "eyedropper") {
      pickAtPixel(x, y);
      setTool("pencil");
      return;
    }
    if (S.tool === "bucket") {
      pushHistory();
      floodFill(S.doc, S.doc.active, x, y, hexToRgba(S.fg), S.tol);
      afterEdit();
      return;
    }
    if (S.tool === "select") {
      if (S.sel) {
        // 点在框内：交给拖动逻辑，不提交；框外落回并开始新圈选
        const b = selBox();
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return;
        commitSel();
      }
      S.shapeStart = [x, y];
      S.drawing = true;
      return;
    }
    if (S.tool === "line" || S.tool === "rect" || S.tool === "ellipse") {
      pushHistory();
      S.shapeStart = [x, y];
      S.drawing = true;
      previewShape(shapePts(S.tool, x, y, x, y), S.fg);
      return;
    }
    // pencil / eraser
    pushHistory();
    S.drawing = true;
    S.last = [x, y];
    S.ppHist = [[x, y]];
    dab(x, y, S.tool === "eraser" ? ERASER : hexToRgba(S.fg));
    render();
  });

  view.addEventListener("pointermove", (e) => {
    if (S.panning) {
      stage.scrollLeft = S.panning.sl - (e.clientX - S.panning.x);
      stage.scrollTop = S.panning.st - (e.clientY - S.panning.y);
      return;
    }
    if (S.moving) {
      // 按显示位移换算成像素格（zoom 恒为整数，直接除）
      const dx = Math.round((e.clientX - S.moving.sx) / (view.clientWidth / S.doc.w));
      const dy = Math.round((e.clientY - S.moving.sy) / (view.clientHeight / S.doc.h));
      const { li, orig } = S.moving;
      const p = S.doc.layers[li].pixels;
      p.fill(0);
      for (let y = 0; y < S.doc.h; y++)
        for (let x = 0; x < S.doc.w; x++) {
          const si = (y * S.doc.w + x) * 4;
          if (!orig[si + 3]) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= S.doc.w || ny >= S.doc.h) continue;
          const di = (ny * S.doc.w + nx) * 4;
          p[di] = orig[si];
          p[di + 1] = orig[si + 1];
          p[di + 2] = orig[si + 2];
          p[di + 3] = orig[si + 3];
        }
      queueRender();
      return;
    }
    if (S.rPick) {
      const [x, y] = evPos(e);
      pickAtPixel(x, y);
      return;
    }
    if (!S.drawing) return;
    const [x, y] = evPos(e);
    if (S.tool === "pencil" || S.tool === "eraser") {
      strokeTo(x, y, S.tool === "eraser" ? ERASER : hexToRgba(S.fg));
      queueRender();
    } else if (S.shapeStart) {
      if (S.tool === "select") {
        // 圈选拖动中：只画双色虚线框，不要粉色填充
        const sx0 = Math.max(0, Math.min(S.shapeStart[0], x));
        const sy0 = Math.max(0, Math.min(S.shapeStart[1], y));
        const sx1 = Math.min(S.doc.w - 1, Math.max(S.shapeStart[0], x));
        const sy1 = Math.min(S.doc.h - 1, Math.max(S.shapeStart[1], y));
        octx.clearRect(0, 0, over.width, over.height);
        octx.lineWidth = 3;
        octx.strokeStyle = "#ffffff";
        octx.setLineDash([]);
        octx.strokeRect(sx0 * S.zoom, sy0 * S.zoom, (sx1 - sx0 + 1) * S.zoom, (sy1 - sy0 + 1) * S.zoom);
        octx.lineWidth = 2;
        octx.strokeStyle = "#ff4d6d";
        octx.setLineDash([6, 4]);
        octx.strokeRect(sx0 * S.zoom, sy0 * S.zoom, (sx1 - sx0 + 1) * S.zoom, (sy1 - sy0 + 1) * S.zoom);
        octx.setLineDash([]);
      } else {
        previewShape(shapePts(S.tool, S.shapeStart[0], S.shapeStart[1], x, y), S.fg);
      }
    }
  });

  view.addEventListener("pointerup", (e) => {
    if (S.moving) {
      S.moving = null;
      stage.style.cursor = "";
      afterEdit();
      return;
    }
    if (S.rPick) {
      S.rPick = false;
      return;
    }
    if (S.panning) {
      S.panning = null;
      stage.style.cursor = S.spaceDown ? "grab" : "";
      return;
    }
    if (!S.drawing) return;
    S.drawing = false;
    const [x, y] = evPos(e);
    if (S.tool === "line" || S.tool === "rect" || S.tool === "ellipse") {
      const [sx, sy] = S.shapeStart;
      for (const [px, py] of shapePts(S.tool, sx, sy, x, y))
        setPixel(S.doc, S.doc.active, px, py, hexToRgba(S.fg));
      octx.clearRect(0, 0, over.width, over.height);
      afterEdit();
    } else if (S.tool === "select") {
      const [sx, sy] = S.shapeStart;
      const lx = Math.max(0, Math.min(sx, x));
      const ly = Math.max(0, Math.min(sy, y));
      const hx = Math.min(S.doc.w - 1, Math.max(sx, x));
      const hy = Math.min(S.doc.h - 1, Math.max(sy, y));
      octx.clearRect(0, 0, over.width, over.height);
      // 单次点击（1px）不算选区，避免误触
      if ((hx - lx + 1) * (hy - ly + 1) <= 1) {
        render();
        return;
      }
      liftSel(lx, ly, hx, hy);
    } else {
      afterEdit();
    }
    S.shapeStart = null;
    syncBar();
  });

  // ---- 选区（轮廓式：圈选只记虚线框，像素原位不动；拖动/剪切/删除时才真正取下） ----
  // 显示用的框：有浮动跟浮动，否则跟圈选框
  function selBox() {
    const s = S.sel;
    if (s.floating) return { x: s.floating.fx, y: s.floating.fy, w: s.floating.w, h: s.floating.h };
    return { x: s.x0, y: s.y0, w: s.x1 - s.x0 + 1, h: s.y1 - s.y0 + 1 };
  }
  // 选区归属层（防下标过期：选区还在时删层，li 可能越界）
  function selLi() {
    const s = S.sel;
    const li = s.li ?? S.doc.active;
    const fixed = li >= 0 && li < S.doc.layers.length ? li : S.doc.active;
    s.li = fixed;
    return fixed;
  }
  function liftSel(lx, ly, hx, hy) {
    S.sel = { x0: lx, y0: ly, x1: hx, y1: hy, li: S.doc.active, floating: null };
    render();
    syncBar();
  }
  // 拖动才真正提起：把框内像素取下进浮动层，一次历史；只调 render，不标脏
  //（小图会把浮动画回去，所以视觉上和主画布一致，不会看起来被扣掉）
  function ensureFloating() {
    const s = S.sel;
    if (!s || s.floating) return;
    const li = selLi();
    const w = s.x1 - s.x0 + 1;
    const h = s.y1 - s.y0 + 1;
    const data = new Uint8ClampedArray(w * h * 4);
    const origin = new Uint8ClampedArray(w * h * 4);
    pushHistory();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = getPixel(S.doc, li, s.x0 + x, s.y0 + y);
        data.set(p, (y * w + x) * 4);
        origin.set(p, (y * w + x) * 4);
        setPixel(S.doc, li, s.x0 + x, s.y0 + y, ERASER);
      }
    s.floating = { w, h, data, ox: s.x0, oy: s.y0, fx: s.x0, fy: s.y0, origin };
    render();
  }
  function pasteFloating() {
    const { floating } = S.sel;
    const { fx, fy } = floating;
    const li = S.doc.active;
    for (let y = 0; y < floating.h; y++)
      for (let x = 0; x < floating.w; x++) {
        const si = (y * floating.w + x) * 4;
        if (!floating.data[si + 3]) continue;
        const dx = fx + x;
        const dy = fy + y;
        if (dx < 0 || dy < 0 || dx >= S.doc.w || dy >= S.doc.h) continue;
        const p = getPixel(S.doc, li, dx, dy);
        const fa = floating.data[si + 3] / 255;
        const ba = p[3] / 255;
        const oa = fa + ba * (1 - fa);
        setPixel(S.doc, li, dx, dy, [
          Math.round((floating.data[si] * fa + p[0] * ba * (1 - fa)) / (oa || 1)),
          Math.round((floating.data[si + 1] * fa + p[1] * ba * (1 - fa)) / (oa || 1)),
          Math.round((floating.data[si + 2] * fa + p[2] * ba * (1 - fa)) / (oa || 1)),
          Math.round(oa * 255),
        ]);
      }
    S.sel.floating.fx = S.sel.floating.ox;
    S.sel.floating.fy = S.sel.floating.oy;
  }
  function commitSel() {
    if (!S.sel) return;
    if (!S.sel.floating) {
      S.sel = null; // 纯框选，没动过像素：直接取消，不记历史
      render();
      syncBar();
      return;
    }
    pushHistory();
    pasteFloating();
    S.sel = null;
    afterEdit();
    syncBar();
  }
  // 复制选区到新图层：没拖动过直接按框复制（原层不动）；拖动过则浮动落新层、原层用提起前的内容补回
  function copySelToLayer() {
    if (!S.sel) {
      uiAlert("先用选区工具（V）圈一块区域");
      return;
    }
    if (S.doc.layers.length >= MAX_LAYERS) {
      uiAlert("最多 8 层，先合并吧");
      return;
    }
    pushHistory();
    const s = S.sel;
    const srcLi = selLi();
    const ni = addLayer(S.doc);
    S.doc.layers[ni].name = "选区复制";
    if (s.floating) {
      const f = s.floating;
      const { ox, oy, origin } = f;
      for (let y = 0; y < f.h; y++)
        for (let x = 0; x < f.w; x++) {
          const si = (y * f.w + x) * 4;
          setPixel(S.doc, srcLi, ox + x, oy + y, [
            origin[si], origin[si + 1], origin[si + 2], origin[si + 3],
          ]);
          if (!f.data[si + 3]) continue;
          const dx = f.fx + x;
          const dy = f.fy + y;
          if (dx < 0 || dy < 0 || dx >= S.doc.w || dy >= S.doc.h) continue;
          setPixel(S.doc, ni, dx, dy, [
            f.data[si], f.data[si + 1], f.data[si + 2], f.data[si + 3],
          ]);
        }
    } else {
      for (let y = s.y0; y <= s.y1; y++)
        for (let x = s.x0; x <= s.x1; x++)
          setPixel(S.doc, ni, x, y, getPixel(S.doc, srcLi, x, y));
    }
    S.sel = null;
    afterEdit();
    syncBar();
  }
  // 剪切选区到新图层：没拖动过按框取下；拖动过浮动落新层、原位的洞保留
  function cutSelToLayer() {
    if (!S.sel) {
      uiAlert("先用选区工具（V）圈一块区域");
      return;
    }
    if (S.doc.layers.length >= MAX_LAYERS) {
      uiAlert("最多 8 层，先合并吧");
      return;
    }
    pushHistory();
    const s = S.sel;
    const srcLi = selLi();
    const ni = addLayer(S.doc);
    S.doc.layers[ni].name = "选区剪切";
    if (s.floating) {
      const f = s.floating;
      for (let y = 0; y < f.h; y++)
        for (let x = 0; x < f.w; x++) {
          const si = (y * f.w + x) * 4;
          if (!f.data[si + 3]) continue;
          const dx = f.fx + x;
          const dy = f.fy + y;
          if (dx < 0 || dy < 0 || dx >= S.doc.w || dy >= S.doc.h) continue;
          setPixel(S.doc, ni, dx, dy, [
            f.data[si], f.data[si + 1], f.data[si + 2], f.data[si + 3],
          ]);
        }
    } else {
      for (let y = s.y0; y <= s.y1; y++)
        for (let x = s.x0; x <= s.x1; x++) {
          setPixel(S.doc, ni, x, y, getPixel(S.doc, srcLi, x, y));
          setPixel(S.doc, srcLi, x, y, ERASER);
        }
    }
    S.sel = null;
    afterEdit();
    syncBar();
  }
  // 删除选区：有浮动时丢弃即可（洞已在提起时产生，undo 一步回到圈选前）；
  // 纯框选则现在才取下像素，要记一次历史
  function delSel() {
    if (!S.sel) {
      uiAlert("先用选区工具（V）圈一块区域");
      return;
    }
    if (!S.sel.floating) {
      pushHistory();
      const s = S.sel;
      const srcLi = selLi();
      for (let y = s.y0; y <= s.y1; y++)
        for (let x = s.x0; x <= s.x1; x++) setPixel(S.doc, srcLi, x, y, ERASER);
    }
    S.sel = null;
    afterEdit();
    syncBar();
  }
  // 拖动浮动选区：框内按下先真正提起，再跟手
  let dragSel = null;
  view.addEventListener("pointerdown", (e) => {
    if (S.tool !== "select" || !S.sel || S.drawing || S.panning || e.button !== 0) return;
    const [x, y] = evPos(e);
    const b = selBox();
    if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) return;
    ensureFloating();
    dragSel = { dx: x - S.sel.floating.fx, dy: y - S.sel.floating.fy };
    view.setPointerCapture(e.pointerId);
  });
  view.addEventListener("pointermove", (e) => {
    if (!dragSel || !S.sel?.floating) return;
    const [x, y] = evPos(e);
    S.sel.floating.fx = x - dragSel.dx;
    S.sel.floating.fy = y - dragSel.dy;
    render();
    // 浮动挪位时小图同步重画，否则停留在提起时的旧位置
    const li = S.sel.li ?? S.doc.active;
    const cv = $(`[data-layers] [data-li="${li}"] canvas`);
    if (cv) paintThumb(cv, li);
  });
  view.addEventListener("pointerup", () => {
    if (dragSel) {
      dragSel = null;
      afterEdit(); // 拖放落笔：刷小图 + 标脏（提起时没标）
      return;
    }
  });
  function setTool(t) {
    if (S.sel && t !== "select") commitSel();
    S.tool = t;
    syncBar();
  }

  // ---- 缩放 / 画布尺寸 ----
  root.querySelectorAll("[data-zoom]").forEach(
    (b) => (b.onclick = () => setZoom(S.zoom + (b.dataset.zoom === "+" ? 2 : -2)))
  );
  const zoomSlider = $("[data-zoomslider]");
  zoomSlider.addEventListener("input", () => setZoom(Number(zoomSlider.value)));
  root.querySelector("[data-fit]").onclick = () => fitZoom();
  const stage = root.querySelector(".ed-stage");
  function setZoom(z) {
    S.zoom = Math.min(32, Math.max(1, z));
    paintCheckerBg();
    render();
  }
  function syncZoomUI() {
    if (document.activeElement !== zoomSlider) zoomSlider.value = S.zoom;
    const lab = $("[data-zoomlab]");
    if (lab) lab.textContent = `${S.zoom * 100}%`;
  }
  function fitZoom() {
    // 以宽度 + 视口高度估算（挂载瞬间画布还没放大，stage 高度不可信）
    const availW = stage.clientWidth - 48;
    const availH = window.innerHeight - 320; // 预留导航 + ribbon + 页边
    const avail = Math.max(64, Math.min(availW, availH));
    setZoom(Math.max(1, Math.floor(avail / Math.max(S.doc.w, S.doc.h)) || 1));
  }
  // Ctrl+滚轮：以光标为锚点缩放
  stage.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = view.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const oz = S.zoom;
      const nz = Math.min(32, Math.max(1, oz + (e.deltaY < 0 ? 2 : -2)));
      if (nz === oz) return;
      setZoom(nz);
      stage.scrollLeft += mx * (nz / oz - 1);
      stage.scrollTop += my * (nz / oz - 1);
    },
    { passive: false }
  );
  function syncCanvasLabel() {
    const el = $("[data-cur-size]");
    if (el) el.textContent = `${S.doc.w}×${S.doc.h}`;
  }
  const newCanvas = (w, h, bg = "transparent", bgColor = "#ffffff") => {
    w = Math.min(128, Math.max(1, w | 0));
    h = Math.min(128, Math.max(1, h | 0));
    S.doc = createDoc(w, h);
    if (bg !== "transparent") {
      // 有底色：底层灌满背景并改名，新建空层置顶防误画在背景上
      const rgba = bg === "white" ? [255, 255, 255, 255] : hexToRgba(bgColor);
      S.doc.layers[0].pixels.fill(0);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) setPixel(S.doc, 0, x, y, rgba);
      S.doc.layers[0].name = "背景";
      addLayer(S.doc);
    }
    S.cloudId = null; // 新画布 = 新作品，不许覆盖旧云端草稿
    try { localStorage.removeItem("pixel.lastOpen"); } catch { /* ignore */ }
    S.cloudTitle = "";
    S.undo.length = 0;
    S.redo.length = 0;
    S.sel = null;
    syncCanvasLabel();
    fitZoom();
    afterEdit();
    syncBar();
  };
  // ---- 新建弹窗的样式状态（背景：预设色块 + 迷你色轮自选） ----
  // 全局确认/提示/输入弹窗见 ../dialog.js（uiAlert/uiConfirm/uiPrompt）
  S.mbg = "transparent";
  S.mbgColor = "#ffc93c";
  function openModal() {
    let nw = null;
    try {
      nw = JSON.parse(localStorage.getItem(NEWSIZE_KEY) || "");
    } catch {
      nw = null;
    }
    $('[data-mwidth]').value = nw?.w >= 1 && nw?.w <= 128 ? nw.w : S.doc.w;
    $('[data-mheight]').value = nw?.h >= 1 && nw?.h <= 128 ? nw.h : S.doc.h;
    S.mbg = "transparent";
    $("[data-mwrow]").hidden = true;
    syncMbgUI();
    $('[data-mwarn]').hidden = countOpaque(composite(S.doc)) === 0;
    $('[data-modal]').hidden = false;
  }
  function syncMbgUI() {
    root.querySelectorAll("[data-mbg]").forEach((b) =>
      b.classList.toggle("active", b.dataset.mbg === S.mbg)
    );
    $("[data-mhex]").value = S.mbgColor;
  }
  // 迷你色轮复用主色轮画法（固定全明度）
  function paintMiniWheel() {
    const cv = $("[data-mwheel]");
    const W = 120;
    const R = W / 2;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(W, W);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - R + 0.5;
        const dy = y - R + 0.5;
        const rr = Math.hypot(dx, dy);
        const i = (y * W + x) * 4;
        if (rr > R) continue;
        let h = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (h < 0) h += 360;
        const [cr, cg, cb] = hsvToRgb(h / 360, Math.min(1, rr / R), 1);
        img.data[i] = cr;
        img.data[i + 1] = cg;
        img.data[i + 2] = cb;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function pickModalBg(e) {
    const cv = $("[data-mwheel]");
    const r = cv.getBoundingClientRect();
    const R = r.width / 2;
    const dx = e.clientX - (r.left + R);
    const dy = e.clientY - (r.top + R);
    if (Math.hypot(dx, dy) > R) return;
    let h = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (h < 0) h += 360;
    const [cr, cg, cb] = hsvToRgb(h / 360, Math.min(1, Math.hypot(dx, dy) / R), 1);
    S.mbgColor = rgbToHex(cr, cg, cb);
    S.mbg = S.mbgColor;
    syncMbgUI();
  }
  let mWheelDown = false;
  const mWheel = $("[data-mwheel]");
  mWheel.addEventListener("pointerdown", (e) => {
    mWheelDown = true;
    mWheel.setPointerCapture(e.pointerId);
    pickModalBg(e);
  });
  mWheel.addEventListener("pointermove", (e) => {
    if (mWheelDown) pickModalBg(e);
  });
  mWheel.addEventListener("pointerup", () => (mWheelDown = false));
  paintMiniWheel();
  function closeModal() {
    $('[data-modal]').hidden = true;
  }
  root.querySelectorAll("[data-new-canvas]").forEach((b) => (b.onclick = openModal));
  $("[data-mpresets]").onclick = (e) => {
    const b = e.target.closest("[data-msize]");
    if (!b) return;
    $('[data-mwidth]').value = b.dataset.msize;
    $('[data-mheight]').value = b.dataset.msize;
  };
  $("[data-mbgpresets]").onclick = (e) => {
    const b = e.target.closest("[data-mbg]");
    if (!b) return;
    S.mbg = b.dataset.mbg;
    if (S.mbg.startsWith("#")) S.mbgColor = S.mbg;
    $("[data-mwrow]").hidden = true; // 选预设就收起色轮
    syncMbgUI();
  };
  // 自选框聚焦/点开展开色轮，平时折叠
  $("[data-mhex]").addEventListener("focus", () => {
    $("[data-mwrow]").hidden = false;
  });
  $("[data-mhex]").onchange = (e) => {
    let v = e.target.value.trim();
    if (!v.startsWith("#")) v = `#${v}`;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      S.mbgColor = v.toLowerCase();
      S.mbg = S.mbgColor;
    }
    syncMbgUI();
  };
  $("[data-mok]").onclick = () => {
    const w = Number($('[data-mwidth]').value);
    const h = Number($('[data-mheight]').value);
    try {
      localStorage.setItem(NEWSIZE_KEY, JSON.stringify({
        w: Math.min(128, Math.max(1, w | 0)),
        h: Math.min(128, Math.max(1, h | 0)),
      }));
    } catch {
      /* 记不住就下次再说 */
    }
    if (S.mbg === "transparent") newCanvas(w, h, "transparent");
    else if (S.mbg === "#ffffff") newCanvas(w, h, "white");
    else newCanvas(w, h, "color", S.mbg); // 预设 hex 或色轮自选
    closeModal();
  };
  $("[data-mcancel]").onclick = closeModal;
  $('[data-modal]').addEventListener("pointerdown", (e) => {
    if (e.target.hasAttribute("data-modal")) closeModal();
  });

  // ---- 快捷键 ----
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t.matches("input, textarea, select")) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "s") {
      e.preventDefault();
      saveCloud(false);
    } else if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
    } else if (k === "b") setTool("pencil");
    else if (k === "e") setTool("eraser");
    else if (k === "l") setTool("line");
    else if (k === "r") setTool("rect");
    else if (k === "o") setTool("ellipse");
    else if (k === "g") setTool("bucket");
    else if (k === "i") setTool("eyedropper");
    else if (k === "v") setTool("select");
    else if (k === "f") {
      S.fillMode = S.fillMode === "filled" ? "hollow" : "filled";
      syncBar();
    } else if (k === "c") {
      S.circle = !S.circle;
      syncBar();
    } else if (k === "[") {
      S.size = Math.max(1, S.size - 1);
      syncBar();
    } else if (k === "]") {
      S.size = Math.min(16, S.size + 1);
      syncBar();
    } else if (k === "+" || k === "=") {
      setZoom(S.zoom + 2);
      syncZoomUI();
    } else if (k === "-" || k === "_") {
      setZoom(S.zoom - 2);
      syncZoomUI();
    } else if (k === "enter" && S.sel) commitSel();
    else if (k === "escape" && S.sel) {
      if (S.sel.floating) undo(); // 动过像素才需要撤销；纯框选直接取消，不碰历史
      else {
        S.sel = null;
        render();
        syncBar();
      }
    } else if ((k === "delete" || k === "backspace") && S.sel) delSel();
    else if (k === " " && !S.spaceDown) {
      // 空格按住 = 抓手平移模式
      S.spaceDown = true;
      e.preventDefault();
      stage.style.cursor = "grab";
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === " ") {
      S.spaceDown = false;
      if (!S.panning) stage.style.cursor = "";
    }
  });

  function loadPersonal() {
    try {
      return JSON.parse(localStorage.getItem(PERSONAL_KEY) || "[]");
    } catch {
      return [];
    }
  }

  // 恢复游客草稿：有内容才问一句（T40 验收）
  try {
    const raw = localStorage.getItem(guestKey);
    if (raw) {
      const d = deserialize(raw);
      if (d.w <= 128 && d.h <= 128 && d.layers.length) {
        const hasInk = d.layers.some((l) => l.pixels.some((v, i) => i % 4 === 3 && v > 0));
        const applyGuest = () => {
          S.doc = d;
          syncCanvasLabel();
          fitZoom();
          render();
          renderLayers();
        };
        if (!hasInk) applyGuest();
        else uiConfirm("发现上次没画完的草稿，继续上次编辑？", "继续画").then((ok) => ok && applyGuest());
      }
    }
  } catch {
    /* 坏数据就用空白画布 */
  }
  // 云端草稿优先（从草稿箱打开）
  if (initial && initial.w >= 1 && initial.w <= 128 && initial.h >= 1 && initial.h <= 128 &&
      initial.layers?.length && initial.layers.length <= 8) {
    S.doc = initial;
    S.doc.active = Math.min(initial.active || 0, initial.layers.length - 1);
    syncCanvasLabel();
  }

  renderPalette();
  fitZoom();
  paintCheckerBg();
  render();
  renderLayers();
  syncCanvasLabel();
  cloudStatus();
  syncBar();
  drawWheel();
  syncWheelUI();
  if (autoShowNew) setTimeout(openModal, 80);

  // ---- 绘画页历史版本（复用草稿箱的版本接口）----
  const edVersBox = $('[data-ed-versions]');
  const edVersHint = $('[data-ed-vers-hint]');
  const edVersRow = $('[data-ed-vers-row]');
  const edVersSel = $('[data-ed-vers-sel]');
  const edVersGo = $('[data-ed-vers-go]');
  let edVersMap = new Map();
  let edVersFirst = true; // 首次加载才允许出现“读取中”，之后静默刷新
  let edVersSig = "";
  async function refreshEdVersions() {
    if (!S.cloudId || !S.user) {
      edVersBox.hidden = true;
      return;
    }
    edVersBox.hidden = false;
    // 数据回来之前不动 DOM：反复“显示读取中→隐藏”就是侧栏跳动的来源
    let slowTimer = 0;
    if (edVersFirst) {
      slowTimer = setTimeout(() => {
        edVersHint.textContent = "读取中…";
        edVersHint.hidden = false;
        edVersRow.hidden = true;
      }, 300);
    }
    try {
      const r = await api('GET', `/api/drafts/${S.cloudId}/versions`);
      clearTimeout(slowTimer);
      if (r.status !== 200) {
        if (edVersFirst) {
          edVersHint.textContent = "读不出来，打开草稿箱试试";
          edVersHint.hidden = false;
          edVersRow.hidden = true;
        }
        return;
      }
      const vs = r.data.versions || [];
      edVersFirst = false;
      edVersMap = new Map(vs.map((v) => [String(v.id), v]));
      window.__pxEdVersMap = edVersMap;
      if (!vs.length) {
        edVersHint.textContent = "改动并保存后会产生历史版本";
        edVersHint.hidden = false;
        edVersRow.hidden = true;
        return;
      }
      edVersHint.hidden = true;
      edVersRow.hidden = false;
      // 名单没变不重写下拉，避免闪一下
      const sig = vs.map((v) => v.id).join(",");
      if (sig !== edVersSig) {
        edVersSig = sig;
        // 自动位顶置标“自动保存”，手动位按自己顺序编号（自动位不占编号）
        const manuals = vs.filter((v) => v.kind !== "auto");
        const auto = vs.find((v) => v.kind === "auto");
        const opt = (v, label) => `<option value="${v.id}" data-full="${label} · ${String(v.created_at || "").slice(0, 16)}">${label}</option>`;
        edVersSel.innerHTML =
          (auto ? opt(auto, "自动保存") : "") +
          manuals.map((v, i) => opt(v, `存档 ${manuals.length - i}`)).join('');
        edVersSel._psSync?.();
      }
    } catch {
      clearTimeout(slowTimer);
      if (edVersFirst) {
        edVersHint.textContent = "读取失败";
        edVersHint.hidden = false;
        edVersRow.hidden = true;
      }
    }
  }
  edVersGo.onclick = async () => {
    const vid = edVersSel.value;
    if (!vid) return;
    // 存档满时选“新建副本”会返回 fork：直接切到副本上，用新稿的存档位重演回滚
    const slot = await ensureVersionSlot(S.cloudId, true);
    if (slot === false) return;
    if (!(await uiConfirm('当前内容在回滚前会先存为一个版本，可再滚回来。', '恢复'))) return;
    if (slot && typeof slot === "object") {
      const v = edVersMap.get(String(vid));
      if (!v?.layers_json) {
        uiAlert('找不到这个版本了');
        return;
      }
      S.cloudId = slot.fork.id;
      S.cloudTitle = slot.fork.title;
      try { localStorage.setItem("pixel.lastOpen", String(S.cloudId)); } catch { /* ignore */ }
      refreshEdVersions();
      // 先把当前画布落到副本（与副本一致时后端自动去重），再写回滚目标：新稿最多产生 2 个版本
      const cov0 = coverOf(composite(S.doc), S.doc.w, S.doc.h);
      await api('PUT', `/api/drafts/${S.cloudId}`, JSON.stringify({
        doc: serialize(S.doc),
        cover: JSON.stringify({ w: cov0.w, h: cov0.h, data: cov0.data }),
      }));
      const put = await api('PUT', `/api/drafts/${S.cloudId}`, JSON.stringify({ doc: v.layers_json }));
      if (put.status !== 200) {
        uiAlert('恢复失败，重试一下');
        return;
      }
    } else {
      const rr = await api('POST', `/api/drafts/${S.cloudId}/rollback/${vid}`);
      if (rr.status !== 200) {
        uiAlert('恢复失败，重试一下');
        return;
      }
    }
    try {
      const full = await api('GET', `/api/drafts/${S.cloudId}`);
      S.doc = deserialize(full.data.draft.layers_json);
      lastSavedDoc = full.data.draft.layers_json;
      S.doc.active = Math.min(full.data.draft.layers_json ? 0 : 0, S.doc.layers.length - 1);
      S.undo.length = 0;
      S.redo.length = 0;
      S.sel = null;
      S.dirty = false;
      // 封面已由后端回滚逻辑处理，前端重算一份存回保证预览一致（纯封面不涨版本）
      try {
        const c = coverOf(composite(S.doc), S.doc.w, S.doc.h);
        await api('PUT', `/api/drafts/${S.cloudId}`, JSON.stringify({ cover: JSON.stringify({ w: c.w, h: c.h, data: c.data }) }));
      } catch { void 0; }
      render();
      renderLayers();
      syncCanvasLabel();
      fitZoom();
      cloudStatus();
      refreshEdVersions();
    } catch {
      location.reload();
    }
  };
  // Z 预览：绘画页不经过草稿箱的 wireDraftPreview，这里自建悬浮层；用原生下拉，不会被侧栏裁剪
  (function wireEdVersPreview() {
    const ensurePV = () => {
      let pv = document.querySelector('#draft-preview');
      if (!pv) {
        pv = document.createElement('div');
        pv.id = 'draft-preview';
        pv.className = 'px-card';
        pv.hidden = true;
        pv.innerHTML = '<b></b><canvas></canvas>';
        document.body.appendChild(pv);
      }
      let hint = document.querySelector('#draft-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'draft-hint';
        hint.className = 'px-tip';
        hint.hidden = true;
        hint.textContent = '按住 Z 显示大图';
        document.body.appendChild(hint);
      }
    };
    ensurePV();
    const getPV = () => document.querySelector('#draft-preview');
    const getHint = () => document.querySelector('#draft-hint');
    // 自绘弹层可能被提到 body（data-ps-pop），用 enhance 时存下的引用找
    const edVersList = () => {
      const wrap = edVersSel.closest('.ps-wrap');
      return (wrap && (wrap._popList || wrap.querySelector('.ps-list'))) || null;
    };
    const placePV = (el, x, y) => {
      const pv = getPV(); const hint = getHint();
      if (!pv || !hint) return;
      // 用主进程的 place 逻辑简化：直接跟手
      pv.hidden = false;
      hint.hidden = true;
      const w = pv.offsetWidth || 200; const h = pv.offsetHeight || 200;
      let lx = x + 16; let ly = y + 18;
      if (lx + w > window.innerWidth - 8) lx = x - w - 12;
      if (ly + h > window.innerHeight - 8) ly = y - h - 12;
      pv.style.left = `${Math.max(4, lx)}px`;
      pv.style.top = `${Math.max(4, ly)}px`;
    };
    const showHint = (x, y) => {
      const hint = getHint(); const pv = getPV();
      if (!hint || !pv) return;
      pv.hidden = true;
      hint.hidden = false;
      hint.textContent = '按住 Z 显示大图，按 D 删除版本';
      const w = hint.offsetWidth || 160; const h = hint.offsetHeight || 32;
      let lx = x + 16; let ly = y + 18;
      if (lx + w > window.innerWidth - 8) lx = x - w - 12;
      if (ly + h > window.innerHeight - 8) ly = y - h - 12;
      hint.style.left = `${Math.max(4, lx)}px`;
      hint.style.top = `${Math.max(4, ly)}px`;
    };
    let lastX = 0, lastY = 0;
    let hoverVid = null;
    let zDown = false;
    const isTyping = () => {
      const t = document.activeElement;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const renderSelBig = (vid) => {
      const pv = getPV(); if (!pv) return false;
      const v = edVersMap.get(String(vid ?? edVersSel.value));
      if (!v?.layers_json) return false;
      try {
        const vd = deserialize(v.layers_json);
        const m = composite(vd);
        const cc = coverOf(m, vd.w, vd.h);
        const cap = pv.querySelector('b'); const c = pv.querySelector('canvas');
        let label = (() => {
          const so = edVersSel.options[edVersSel.selectedIndex];
          return so?.dataset?.full || so?.textContent || '';
        })();
        if (vid != null) {
          const l = edVersList();
          const o = l?.querySelector(`.ps-opt[data-v="${vid}"]`);
          if (o) label = o.textContent;
        }
        if (cap) cap.textContent = label;
        c.width = cc.w; c.height = cc.h;
        c.getContext('2d').putImageData(new ImageData(b64ToU8(cc.data), cc.w, cc.h), 0, 0);
        return true;
      } catch { return false; }
    };
    const hide = () => { const pv2 = getPV(); const hint2 = getHint(); if (pv2) pv2.hidden = true; if (hint2) hint2.hidden = true; };
    const update = () => {
      if (hoverVid == null) return;
      if (zDown) { if (renderSelBig(hoverVid)) placePV(null, lastX, lastY); }
      else showHint(lastX, lastY);
    };
    // 只有弹层里的选项才触发预览：下拉按钮本体、“恢复此版”按钮都不算
    const optInOurList = (t) => {
      const o = t?.closest?.('.ps-opt');
      if (!o) return null;
      const l = edVersList();
      return l && !l.hidden && l.contains(o) ? o : null;
    };
    document.addEventListener('mousemove', (e) => {
      const o = optInOurList(e.target);
      if (o) {
        lastX = e.clientX; lastY = e.clientY;
        hoverVid = o.dataset.v;
        update();
      } else if (hoverVid != null) { hoverVid = null; hide(); }
    });
    edVersSel.addEventListener('change', () => { if (hoverVid != null && zDown) update(); });
    // 绘画页没有草稿箱的全局 Z 状态，这里自己管 zDown（编辑器本身只占用 ctrl+Z，单按 Z 无冲突）
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'z' || e.key === 'Z') && !e.repeat && !e.ctrlKey && !e.metaKey && !isTyping()) {
        zDown = true;
        if (hoverVid != null) { e.preventDefault(); update(); }
      }
    });
    // D 删除悬停（无悬停则删选中）的历史版本
    const versLabel = (vid) => {
      const o = edVersList()?.querySelector(`.ps-opt[data-v="${vid}"]`);
      if (o) return o.textContent.trim();
      const so = edVersSel.querySelector(`option[value="${vid}"]`);
      return (so?.dataset?.full || so?.textContent || '').trim();
    };
    async function delEdVersion(vid) {
      if (!edVersMap.has(String(vid))) return; // 列表已刷新，悬停过期
      const label = versLabel(vid) || '这个存档';
      if (!(await uiConfirm(`删除「${label}」？不可撤销。`, '删除'))) return;
      const r = await api('DELETE', `/api/drafts/${S.cloudId}/versions/${vid}`);
      if (r.status !== 200) {
        uiAlert('删除失败，重试一下');
        return;
      }
      refreshEdVersions();
    }
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'd' || e.key === 'D') && !e.repeat && !e.ctrlKey && !e.metaKey && !isTyping()) {
        const vid = hoverVid ?? edVersSel.value;
        if (!vid || !S.cloudId || S.drawing) return;
        e.preventDefault();
        delEdVersion(vid);
      }
    });
    document.addEventListener('keyup', (e) => { if (e.key === 'z' || e.key === 'Z') { zDown = false; hide(); if (hoverVid != null) update(); } });
    window.addEventListener('blur', () => { zDown = false; hide(); });
  })();
  refreshEdVersions();
  // 保存后刷新版本列表（首次新建POST会填上 S.cloudId）
  const _origSaveCloud2 = saveCloud;
  // eslint-disable-next-line no-func-assign
  saveCloud = async function (...args) {
    const ret = await _origSaveCloud2(...args);
    if (S.cloudId) setTimeout(refreshEdVersions, 350);
    return ret;
  };
  // 保存后刷新版本列表
  const _origAfterEdit = afterEdit;
  // eslint-disable-next-line no-func-assign
  afterEdit = function () { _origAfterEdit(); if (S.cloudId) setTimeout(refreshEdVersions, 400); };

  // 偏好持久化：工具/笔刷/视图/前景色，10 秒一存 + 离页存
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        tool: S.tool,
        size: S.size,
        circle: S.circle,
        bop: S.bop,
        fillMode: S.fillMode,
        tol: S.tol,
        pp: S.pp,
        mirrorH: S.mirrorH,
        mirrorV: S.mirrorV,
        showGrid: S.showGrid,
        showMore: S.showMore,
        fg: S.fg,
        bg: S.bg,
      }));
    } catch {
      /* 配额满就放弃 */
    }
  }
  if (!window.__pxPrefsTimer) window.__pxPrefsTimer = setInterval(savePrefs, 10000);
  window.addEventListener("pagehide", savePrefs);

  return {
    get doc() {
      return S.doc;
    },
    opaque: () => countOpaque(composite(S.doc)),
    setTool,
    setFg: pickColor,
    save: () => saveCloud(false),
    sel: () => (S.sel ? selBox() : null),
    layerCount: () => S.doc.layers.length,
    cloudId: () => S.cloudId,
    panning: () => !!S.panning,
    zoom: () => S.zoom,
    fg: () => S.fg,
  };
}
