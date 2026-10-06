// 像素风自定义下拉：把原生 select 藏起来做值仓，用 div 重画按钮 + 选项列表，
// 各浏览器表现一致。原生的 change 事件照常触发，旧逻辑不用改。
export function enhancePixelSelects(root = document) {
  root.querySelectorAll("select:not([data-ps]):not([data-no-ps])").forEach((sel) => {
    sel.dataset.ps = "1";
    const wrap = document.createElement("span");
    wrap.className = "ps-wrap";
    sel.after(wrap);
    wrap.appendChild(sel);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ps-btn";
    btn.title = sel.title || "";
    const list = document.createElement("div");
    list.className = "ps-list";
    list.hidden = true;
    wrap.appendChild(btn);
    wrap.appendChild(list);
    // data-ps-pop：弹层提到 body 用 fixed 定位，不会被 overflow 祖先裁剪（右栏下拉用）
    const pop = sel.hasAttribute("data-ps-pop");
    if (pop) {
      document.body.appendChild(list);
      wrap._popList = list; // 弹层已搬家，调用方用这个引用找选项（不能再按 wrap 内查找）
    }
    const placePop = () => {
      const r = btn.getBoundingClientRect();
      list.style.position = "fixed";
      list.style.minWidth = Math.max(r.width, 120) + "px";
      list.style.maxWidth = "calc(100vw - 16px)";
      const lh = Math.min(240, list.scrollHeight);
      const lw = Math.min(list.scrollWidth || r.width, window.innerWidth - 16);
      // 右侧留出像素滚动条槽位（约 20px），避免弹层右边缘被压住：整体左移 12px 再按视口钳制
      let left = r.left - 12;
      if (left + lw > window.innerWidth - 20) left = window.innerWidth - lw - 20;
      list.style.left = Math.max(8, left) + "px";
      if (r.bottom + lh + 8 > window.innerHeight && r.top - lh - 8 > 0) {
        list.style.top = Math.max(8, r.top - lh - 4) + "px";
      } else {
        list.style.top = Math.min(Math.max(8, r.bottom + 4), Math.max(8, window.innerHeight - lh - 8)) + "px";
      }
    };
    if (pop) {
      const re = () => { if (!list.hidden) placePop(); };
      window.addEventListener("scroll", re, true);
      window.addEventListener("resize", re);
    }
    const sync = () => {
      const cur = sel.options[sel.selectedIndex];
      btn.innerHTML = `<span>${cur ? cur.textContent : ""}</span>`;
      list.querySelectorAll(".ps-opt").forEach((o) =>
        o.toggleAttribute("data-on", o.dataset.v === sel.value)
      );
    };
    sel._psSync = sync;
    const build = () => {
      list.innerHTML = [...sel.options]
        .map((o) => `<div class="ps-opt" data-v="${o.value}">${o.dataset.full || o.textContent}</div>`)
        .join("");
      sync();
    };
    build();
    // 选项是 JS 后填的（如色盘包），变了就重建
    new MutationObserver(build).observe(sel, { childList: true });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeAll(sel);
      if (list.hidden) {
        list.hidden = false;
        list.classList.remove("up");
        if (pop) placePop();
        else {
          // 下面放不下、上面有空间 → 往上弹
          const lh = Math.min(240, list.scrollHeight);
          const r = btn.getBoundingClientRect();
          if (r.bottom + lh + 8 > window.innerHeight && r.top - lh - 8 > 0) {
            list.classList.add("up");
          }
        }
        sync();
      } else {
        list.hidden = true;
      }
    });
    list.addEventListener("click", (e) => {
      const o = e.target.closest(".ps-opt");
      if (!o) return;
      sel.value = o.dataset.v;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
      list.hidden = true;
    });
    document.addEventListener("pointerdown", (e) => {
      // 弹层提到 body 后选项不在 wrap 内，点选项不能提前收起（否则 click 选不中）
      if (!wrap.contains(e.target) && !list.contains(e.target)) list.hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") list.hidden = true;
    });
  });
}

function closeAll(except) {
  document.querySelectorAll(".ps-list").forEach((l) => {
    if (l.previousElementSibling !== except) l.hidden = true;
  });
}

export function initPixelSelects() {
  enhancePixelSelects();
  new MutationObserver(() => enhancePixelSelects()).observe(document.body, {
    childList: true,
    subtree: true,
  });
}
