// 社区主页 + 画廊（最新/热门/精选 + 无限滚动）
import { api } from "../api.js";
import { HOME_TIPS, esc } from "./shared.js";

export function pageHome(user) {
  const cta = user
    ? `<div class="row">
          <a href="#/draw" class="px-btn px-btn--cherry">打开画布作画</a>
          <a href="#/drafts" class="px-btn">我的草稿箱</a>
          <a href="#/me" class="px-btn">我的主页</a>
        </div>`
    : `<div class="row">
          <a href="#/draw" class="px-btn px-btn--cherry">打开画布试画</a>
          <a href="#/register" class="px-btn">注册后保存发布</a>
        </div>`;
  const hello = user ? `<p class="hint">欢迎回家，${esc(user.nickname)}，今天想做什么呢？</p>` : `<p class="hint">简洁的像素画编辑器 + 作品社区。由热爱像素画的社区驱动。</p>`;
  const tip = HOME_TIPS[new Date().getDate() % HOME_TIPS.length];
  return `
    <main class="wrap wide">
      <div class="hero-mini">
        <div>
          <div class="auth-pixels" aria-hidden="true" data-home-egg><i style="background:var(--accent)"></i><i style="background:var(--sky)"></i><i style="background:#2eb5a8"></i><i style="background:#f5a623"></i></div>
          <h1 class="px-title hero">${user ? "在社区里，找找新灵感" : "有趣的作品，万里挑一"}</h1>
          ${hello}
          <p class="hint" data-daily-tip>小贴士：${tip}</p>
        </div>
        ${cta}
      </div>
      <div class="row tabs" data-tabs>
        <button class="tool-btn active" data-tab="new">最新</button>
        <button class="tool-btn" data-tab="hot">热门</button>
        <button class="tool-btn" data-tab="featured">精选</button>
        <div class="gallery-sort-control" data-hot-sorts hidden>
          <select id="gallery-sort" aria-label="热门作品排序">
            <option value="hot">综合</option>
            <option value="views">浏览数量</option>
            <option value="likes">点赞数量</option>
            <option value="comments">评论数量</option>
          </select>
        </div>
      </div>
      <div class="art-grid" id="gallery"><p class="hint">读取中…</p></div>
      <p class="hint" id="gallery-end" hidden>到底啦，去发一张吧</p>
    </main>`;
}

export function artCard(a) {
  return `
    <div class="art-card px-card" data-art="${a.id}">
      <a href="#/art/${a.id}" style="display:contents">
        <img src="${a.png_url}" alt="${esc(a.title)}" loading="lazy" data-gal="${a.id}"${Number(a.width) > 0 && Number(a.height) > 0 ? ` width="${Number(a.width)}" height="${Number(a.height)}"` : ""}>
      </a>
      <b><a href="#/art/${a.id}" class="ellipsis-1" style="color:inherit;text-decoration:none" title="${esc(a.title)}">${esc(a.title)}</a></b>
      <span class="hint" style="display:block">浏览 ${a.views} · 点赞 ${a.likes_count} · 评论 ${a.comments_count}</span>
    </div>`;
}

// 从左往右瀑布流：按原始顺序塞进当前最短列，避免 CSS columns 的先竖后横
function artGridColCount(box) {
  const styles = getComputedStyle(box);
  const gap = Number.parseFloat(styles.getPropertyValue("--art-gap")) || 16;
  const min = Number.parseFloat(styles.getPropertyValue("--art-col-min")) || 200;
  const width = box.clientWidth || 0;
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

function nextArtMasonryIndex(box) {
  const n = Number(box.dataset.masonryNext || 0);
  box.dataset.masonryNext = String(n + 1);
  return n;
}

function collectArtCards(box) {
  return [...box.querySelectorAll(".art-card")].sort(
    (a, b) => Number(a.dataset.masonryI || 0) - Number(b.dataset.masonryI || 0)
  );
}

function getArtGridCols(box) {
  return [...box.querySelectorAll(":scope > .art-grid-col")];
}

function rebuildArtGridCols(box, count) {
  const cols = Array.from({ length: count }, () => {
    const col = document.createElement("div");
    col.className = "art-grid-col";
    return col;
  });
  box.replaceChildren(...cols);
  return cols;
}

function placeArtCards(cols, cards) {
  const heights = cols.map(() => 0);
  for (const card of cards) {
    let i = 0;
    for (let k = 1; k < heights.length; k++) if (heights[k] < heights[i]) i = k;
    cols[i].appendChild(card);
    heights[i] += card.offsetHeight || 1;
  }
}

function appendCardsToShortestCols(cols, cards) {
  const heights = cols.map((col) => col.offsetHeight);
  for (const card of cards) {
    let i = 0;
    for (let k = 1; k < heights.length; k++) if (heights[k] < heights[i]) i = k;
    cols[i].appendChild(card);
    heights[i] = cols[i].offsetHeight;
  }
}

function restoreScroll(x, y) {
  // 重建列时高度会短暂塌掉，浏览器会把滚动钳回顶部；量高后再还原
  window.scrollTo(x, y);
  requestAnimationFrame(() => {
    if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
  });
}

function scheduleArtGridLayout(box) {
  clearTimeout(box._masonryTimer);
  box._masonryTimer = setTimeout(() => layoutArtGrid(box), 50);
}

function watchArtCardImages(box, cards) {
  for (const card of cards) {
    const img = card.querySelector("img");
    if (!img || img.dataset.masonryBound) continue;
    img.dataset.masonryBound = "1";
    if (img.complete) continue;
    // 图片到位后只在列数变化时才全量重排；同列数下不再重建，避免滚到底加载时被弹回顶部
    const onDone = () => {
      if (Number(box.dataset.masonryCols || 0) !== artGridColCount(box)) scheduleArtGridLayout(box);
    };
    img.addEventListener("load", onDone, { once: true });
    img.addEventListener("error", onDone, { once: true });
  }
}

export function layoutArtGrid(box) {
  if (!box || !box.classList.contains("art-grid")) return;
  if (box.querySelector(":scope > .empty-wall, :scope > .hint, :scope > .px-card:not(.art-card)")) return;
  const cards = collectArtCards(box);
  if (!cards.length) return;
  for (const card of cards) {
    if (card.dataset.masonryI == null) card.dataset.masonryI = String(nextArtMasonryIndex(box));
  }
  const ordered = collectArtCards(box);
  const count = artGridColCount(box);
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const cols = rebuildArtGridCols(box, count);
  placeArtCards(cols, ordered);
  watchArtCardImages(box, ordered);
  box.dataset.masonryCols = String(count);
  restoreScroll(scrollX, scrollY);
}

export function appendArtCards(box, html) {
  if (!box) return [];
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const cards = [...tmp.children].filter((el) => el.classList?.contains("art-card"));
  if (!cards.length) {
    box.insertAdjacentHTML("beforeend", html);
    return [];
  }
  for (const card of cards) card.dataset.masonryI = String(nextArtMasonryIndex(box));

  const count = artGridColCount(box);
  let cols = getArtGridCols(box);
  // 加载更多：只往现有最短列追加，绝不 rebuild，避免页面跳高后滚回顶部
  if (cols.length === count) {
    appendCardsToShortestCols(cols, cards);
    watchArtCardImages(box, cards);
    return cards;
  }

  // 首屏或列数变了：需要建列。若已有旧卡，走保留滚动位置的全量排布
  if (collectArtCards(box).length) {
    box.append(...cards);
    layoutArtGrid(box);
    return cards;
  }

  cols = rebuildArtGridCols(box, count);
  appendCardsToShortestCols(cols, cards);
  watchArtCardImages(box, cards);
  box.dataset.masonryCols = String(count);
  return cards;
}

export function wireArtGrids() {
  if (window.__pxArtMasonry) return;
  window.__pxArtMasonry = true;
  let timer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      document.querySelectorAll(".art-grid").forEach((box) => layoutArtGrid(box));
    }, 120);
  });
}

let galleryTab = "new";
let gallerySort = "hot";
let galleryPage = 1;
let galleryHasMore = true;
let galleryLoading = false;

// 主页像素块小彩蛋：连点 5 下，四块变幸运四色，贴士换新年文案
const EGG_LUCKY = ["#44FF00", "#11FFDD", "#FFCCCC", "#EEEEEE"];
export function wireHomeEgg() {
  const el = document.querySelector("[data-home-egg]");
  if (!el || el._egg) return;
  el._egg = true;
  el.style.cursor = "pointer";
  let n = 0;
  el.onclick = () => {
    if (++n === 5) {
      el.querySelectorAll("i").forEach((b, k) => (b.style.background = EGG_LUCKY[k % EGG_LUCKY.length]));
      const tip = document.querySelector("[data-daily-tip]");
      if (tip) tip.textContent = "你找到了藏起来的像素块！今年份专属小幸运已送达。";
      n = 0;
    }
  };
}

// 社区主页右下角：回顶部 / 回到底部（只要首页挂载，切页时 render 顶部会删掉）
export function mountHomeEdge() {
  if (document.querySelector("#home-edge")) return;
  const d = document.createElement("div");
  d.id = "home-edge";
  d.innerHTML = `<button class="px-btn px-btn--sm" data-edge="top" title="回到顶部">↑ 顶部</button><button class="px-btn px-btn--sm" data-edge="bottom" title="回到底部">↓ 底部</button>`;
  document.body.appendChild(d);
  d.onclick = (e) => {
    const b = e.target.closest("[data-edge]");
    if (!b) return;
    if (b.dataset.edge === "top") window.scrollTo({ top: 0, behavior: "smooth" });
    else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  };
}

export async function loadGallery(more = false) {
  const box = document.querySelector("#gallery");
  if (!box || galleryLoading) return;
  if (!more) {
    galleryPage = 1;
    galleryHasMore = true;
    box.innerHTML = `<p class="hint">读取中…</p>`;
  }
  if (more && !galleryHasMore) return;
  galleryLoading = true;
  const sortQ = galleryTab === "hot" ? `&sort=${gallerySort}` : "";
  const r = await api("GET", `/api/gallery?tab=${galleryTab}&page=${galleryPage}&limit=12${sortQ}`);
  galleryLoading = false;
  if (r.status !== 200 || !r.data) {
    box.innerHTML = `<div class="px-card">画廊开小差了，刷新试试。</div>`;
    return;
  }
  if (!more && !r.data.items.length) {
    box.innerHTML = `<div class="px-card empty-wall">还没有作品，去发第一张吧<a href="#/draw" class="px-btn px-btn--cherry">开始作画</a></div>`;
  } else {
    if (!more) {
      box.innerHTML = "";
      delete box.dataset.masonryNext;
      delete box.dataset.masonryCols;
    }
    appendArtCards(box, r.data.items.map(artCard).join(""));
  }
  galleryPage++;
  galleryHasMore = !!r.data.has_more;
  const end = document.querySelector("#gallery-end");
  if (end) end.hidden = galleryHasMore;
}

// 滚到底自动加载下一页（一页 24 张，宽屏瀑布流大约多铺几行），代替“更多”按钮
export function wireGalleryInfinite() {
  if (window.__pxGalScroll) return;
  window.__pxGalScroll = true;
  window.addEventListener("scroll", () => {
    if (!document.querySelector("#gallery")) return;
    if (galleryLoading || !galleryHasMore) return;
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 600) {
      loadGallery(true);
    }
  }, { passive: true });
}

export function wireGalleryTabs() {
  const tabs = document.querySelector("[data-tabs]");
  if (!tabs) return;
  const sorts = document.querySelector("[data-hot-sorts]");
  const sortSelect = document.querySelector("#gallery-sort");
  if (sortSelect) sortSelect.value = gallerySort;
  const syncSorts = () => {
    if (sorts) sorts.hidden = galleryTab !== "hot";
  };
  syncSorts();
  tabs.onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    galleryTab = b.dataset.tab;
    tabs.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
    syncSorts();
    loadGallery(false);
  };
  if (!sortSelect) return;
  sortSelect.addEventListener("change", () => {
    if (galleryTab !== "hot") return;
    gallerySort = sortSelect.value;
    loadGallery(false);
  });
}
