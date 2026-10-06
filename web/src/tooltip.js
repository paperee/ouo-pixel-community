// 像素风自定义悬停提示：原生 title 各浏览器不可定制，改为 div 重画。
// 首次遇到带 title 的元素时把文本搬进 data-tip 并摘掉原生属性（避免双显）。
let tipEl = null;

function ensureTip() {
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  tipEl.className = "px-tip";
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  return tipEl;
}

function claim(el) {
  if (!el.hasAttribute("title")) return el.dataset.tip || "";
  el.dataset.tip = el.getAttribute("title");
  el.removeAttribute("title");
  if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", el.dataset.tip);
  return el.dataset.tip;
}

export function initPixelTips() {
  const tip = ensureTip();
  let anchor = null;
  let dragging = false; // HTML5 拖拽中不弹提示：拖时 mousemove 被压制而 mouseover 还在，会把提示冻在半路
  document.addEventListener("dragstart", () => { dragging = true; hide(); }, true);
  document.addEventListener("dragend", () => { dragging = false; }, true);
  document.addEventListener("drop", () => { dragging = false; }, true);
  const show = (el, x, y) => {
    const text = claim(el);
    if (!text) return;
    anchor = el;
    tip.textContent = text;
    tip.hidden = false;
    move(x, y);
  };
  const move = (x, y) => {
    const r = tip.getBoundingClientRect();
    let lx = x + 14;
    let ly = y + 16;
    if (lx + r.width > window.innerWidth - 8) lx = x - r.width - 10;
    if (ly + r.height > window.innerHeight - 8) ly = y - r.height - 10;
    tip.style.left = `${Math.max(4, lx)}px`;
    tip.style.top = `${Math.max(4, ly)}px`;
  };
  const hide = () => {
    tip.hidden = true;
    anchor = null;
  };
  // 原生 title 有约 1s 延迟，mouseover 里立刻摘掉就不会双显
  // 注意：摘掉后元素只有 data-tip，所以匹配必须同时认两个
  document.addEventListener("mouseover", (e) => {
    if (dragging) return;
    const t = e.target.closest("[title],[data-tip]");
    if (t) show(t, e.clientX, e.clientY);
    else if (anchor && !anchor.contains(e.target)) hide();
  });
  document.addEventListener("mousemove", (e) => {
    if (dragging) return;
    if (!tip.hidden) {
      move(e.clientX, e.clientY);
      return;
    }
    // 兜底：DOM 重绘可能把节点换掉，静止的鼠标收不到 mouseover，用移动恢复
    const t = e.target.closest?.("[title],[data-tip]");
    if (t) show(t, e.clientX, e.clientY);
  });
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("scroll", hide, true);
}
