// 自定义像素风滚动条：隐藏各浏览器默认滚动条，用 div 重画，保证跨端一致。
// 用法：initCustomScroll() 接管整页；容器加 data-cscroll="y|x|both" 即被接管。
const records = []; // { el, axis, track, thumb }
const findRec = (el, axis) => records.find((t) => t.el === el && t.axis === axis);

function mkTrack(axis, fixed) {
  const track = document.createElement("div");
  track.className = "cb-track" + (axis === "x" ? " horizontal" : "") + (fixed ? " fixed" : " float");
  track._w = fixed ? 10 : 8;
  const thumb = document.createElement("div");
  thumb.className = "cb-thumb";
  thumb.title = "拖动滚动";
  track.appendChild(thumb);
  track.addEventListener("pointerdown", (e) => {
    if (e.target === thumb) return;
    const t = findRec(track._target, track._axis);
    if (!t) return;
    const r = thumb.getBoundingClientRect();
    const off = axis === "x" ? e.clientX - r.left : e.clientY - r.top;
    if (off < 0) t.el[axis === "x" ? "scrollLeft" : "scrollTop"] -= t.el[axis === "x" ? "clientWidth" : "clientHeight"];
    else t.el[axis === "x" ? "scrollLeft" : "scrollTop"] += t.el[axis === "x" ? "clientWidth" : "clientHeight"];
  });
  thumb.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = findRec(track._target, track._axis);
    if (!t) return;
    thumb.setPointerCapture(e.pointerId);
    const startP = axis === "x" ? e.clientX : e.clientY;
    const startS = axis === "x" ? t.el.scrollLeft : t.el.scrollTop;
    const trackLen = axis === "x" ? track.clientWidth : track.clientHeight;
    const thumbLen = axis === "x" ? thumb.offsetWidth : thumb.offsetHeight;
    const maxScroll = (axis === "x" ? t.el.scrollWidth - t.el.clientWidth : t.el.scrollHeight - t.el.clientHeight) || 1;
    const move = (ev) => {
      const d = (axis === "x" ? ev.clientX : ev.clientY) - startP;
      t.el[axis === "x" ? "scrollLeft" : "scrollTop"] = startS + (d / Math.max(1, trackLen - thumbLen)) * maxScroll;
    };
    const up = () => {
      thumb.removeEventListener("pointermove", move);
      thumb.removeEventListener("pointerup", up);
    };
    thumb.addEventListener("pointermove", move);
    thumb.addEventListener("pointerup", up);
  });
  return { track, thumb };
}

function refresh(t) {
  const { el, axis, track, thumb } = t;
  // 绘画页是 app 式整页布局（桌面端）：整页轨道会和右栏轨道叠成一条粗的，直接隐藏整页轨道
  if (t.isPage && document.querySelector(".draw-app") && window.matchMedia("(min-width: 861px)").matches) {
    track.style.display = "none";
    return;
  }
  // 抽屉打开期间：贴边导致浮动轨道错位/与原生细条叠成双条，直接隐藏（原生细条见 editor.css）
  if (el.classList?.contains("open") && el.closest?.(".draw-app")) {
    track.style.display = "none";
    return;
  }
  // 抽屉过渡期（开关位移 0.18s 内矩形还在屏内）：一律隐藏，否则补帧会把它闪出来
  if (Date.now() < (el._drawerUntil || 0)) {
    track.style.display = "none";
    return;
  }
  const horiz = axis === "x";
  const client = horiz ? el.clientWidth : el.clientHeight;
  const total = horiz ? el.scrollWidth : el.scrollHeight;
  const pos = horiz ? el.scrollLeft : el.scrollTop;
  const trackLen = horiz ? track.clientWidth : track.clientHeight;
  if (total <= client + 1) {
    track.style.display = "none";
    return;
  }
  track.style.display = "";
  // 非 fixed 轨道贴在容器外侧（右侧/下方缝隙），不压内容
  if (!track.classList.contains("fixed")) {
    const r = el.getBoundingClientRect();
    if (horiz) {
      track.style.left = `${r.left}px`;
      track.style.top = `${r.bottom + 2}px`;
      track.style.width = `${r.width}px`;
    } else {
      track.style.left = `${r.right + 2}px`;
      track.style.top = `${r.top}px`;
      track.style.height = `${r.height}px`;
    }
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) {
      track.style.display = "none";
      return;
    }
  }
  const len = Math.max(24, (client / total) * trackLen);
  const maxOff = trackLen - len;
  const maxScroll = total - client;
  const off = maxScroll > 0 ? (pos / maxScroll) * maxOff : 0;
  if (horiz) {
    thumb.style.width = `${len}px`;
    thumb.style.transform = `translateX(${off}px)`;
  } else {
    thumb.style.height = `${len}px`;
    thumb.style.transform = `translateY(${off}px)`;
  }
}

function enhance(el, axis) {
  if (el._cbDone?.has(axis)) return;
  el._cbDone = el._cbDone || new Set();
  el._cbDone.add(axis);
  el.classList.add("cb-hide");
  const fixed = el === document.scrollingElement || el === document.documentElement || el === document.body;
  const target = fixed ? document.scrollingElement : el;
  const { track, thumb } = mkTrack(axis, fixed);
  track._target = target;
  track._axis = axis;
  document.body.appendChild(track);
  const t = { el: target, axis, track, thumb, isPage: fixed };
  records.push(t);
  const ro = new ResizeObserver(refreshAll);
  ro.observe(target === document.scrollingElement ? document.body : target);
  refreshAll();
}

// 全局唯一的滚动刷新入口（rAF 节流）：
// scroll 事件不冒泡、整页滚动的 target 是 document，所以只在 document 捕获阶段监听一次，
// 顺带把整页滚动导致错位的面板轨道一并校准。
let rafPending = false;
function refreshAll() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    records.forEach(refresh);
  });
}

// 抽屉关闭瞬间调用：位移过渡期间等补帧会有闪留，直接按元素隐藏其轨道
export function hideTracksFor(el) {
  records.forEach((t) => {
    if (t.el === el) t.track.style.display = "none";
  });
}

export function scanCustomScroll(root = document) {
  if (!document.documentElement._cbPage) {
    document.documentElement._cbPage = true;
    document.documentElement.classList.add("cb-hide");
    enhance(document.scrollingElement, "y");
  }
  root.querySelectorAll("[data-cscroll]").forEach((el) => {
    const axes = el.dataset.cscroll === "both" ? ["y", "x"] : [el.dataset.cscroll || "y"];
    axes.forEach((a) => enhance(el, a));
  });
  // 布局稳定后再校准一次（字体/图片加载后高度会变）
  setTimeout(() => records.forEach(refresh), 600);
}

export function initCustomScroll() {
  scanCustomScroll();
  document.addEventListener("scroll", refreshAll, { passive: true, capture: true });
  window.addEventListener("resize", refreshAll);
  new MutationObserver(() => scanCustomScroll()).observe(document.body, { childList: true, subtree: true });
}
