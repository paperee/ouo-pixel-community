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
  const hello = user ? `<p class="hint">欢迎回来，${esc(user.nickname)}，今天画点什么呢？</p>` : `<p class="hint">对新手友好的像素画编辑器 + 作品社区。由热爱像素画的社区驱动。</p>`;
  const tip = HOME_TIPS[new Date().getDate() % HOME_TIPS.length];
  return `
    <main class="wrap wide">
      <div class="hero-mini">
        <div>
          <div class="auth-pixels" aria-hidden="true" data-home-egg><i style="background:var(--accent)"></i><i style="background:var(--sky)"></i><i style="background:#2eb5a8"></i><i style="background:#f5a623"></i></div>
          <h1 class="px-title hero">${user ? "在社区里，找找灵感" : "打开就能画，画完就能发"}</h1>
          ${hello}
          <p class="hint" data-daily-tip>小贴士：${tip}</p>
        </div>
        ${cta}
      </div>
      <div class="row tabs" data-tabs>
        <button class="tool-btn active" data-tab="new">最新</button>
        <button class="tool-btn" data-tab="hot">热门</button>
        <button class="tool-btn" data-tab="featured">精选</button>
      </div>
      <div class="art-grid" id="gallery"><p class="hint">读取中…</p></div>
      <p class="hint" id="gallery-end" hidden>到底啦，去发一张吧</p>
    </main>`;
}

export function artCard(a) {
  return `
    <div class="art-card px-card" data-art="${a.id}">
      <a href="#/art/${a.id}" style="display:contents">
        <img src="${a.thumb_url}" alt="${esc(a.title)}" loading="lazy" data-gal="${a.id}">
      </a>
      <b><a href="#/art/${a.id}" style="color:inherit;text-decoration:none">${esc(a.title)}</a></b>
      <span class="hint" style="display:block">浏览 ${a.views} · 点赞 ${a.likes_count} · 评论 ${a.comments_count}</span>
    </div>`;
}

let galleryTab = "new";
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
  const r = await api("GET", `/api/gallery?tab=${galleryTab}&page=${galleryPage}&limit=12`);
  galleryLoading = false;
  if (r.status !== 200 || !r.data) {
    box.innerHTML = `<div class="px-card">画廊开小差了，刷新试试。</div>`;
    return;
  }
  if (!more && !r.data.items.length) {
    box.innerHTML = `<div class="px-card empty-wall">还没有作品，去发第一张吧<a href="#/draw" class="px-btn px-btn--cherry">开始作画</a></div>`;
  } else {
    if (!more) box.innerHTML = "";
    box.innerHTML += r.data.items.map(artCard).join("");
  }
  galleryPage++;
  galleryHasMore = !!r.data.has_more;
  const end = document.querySelector("#gallery-end");
  if (end) end.hidden = galleryHasMore;
}

// 滚到底自动加载下一页（一页 12 张约两行），代替“更多”按钮
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
  tabs.onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    galleryTab = b.dataset.tab;
    tabs.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
    loadGallery(false);
  };
}
