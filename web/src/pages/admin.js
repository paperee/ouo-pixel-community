// 审核后台
import { api } from "../api.js";
import { esc } from "./shared.js";
import { uiConfirm } from "../dialog.js";
import { ADMIN_ARTWORKS_PER_PAGE, getAdminArtworkPage } from "./admin-pagination.js";
import { getPagerKeyboardPage } from "./pagination-keyboard.js";

let currentFeaturedPage = 1;
let currentFeaturedQuery = "";
let latestFeaturedLoad = 0;

export async function mountAdmin() {
  const root = document.querySelector("#admin-root");
  const stats = await api("GET", "/api/admin/stats");
  const s = stats.status === 200 ? stats.data.stats : null;
  const statHtml = s
    ? `<div class="px-card"><p class="hint"><b>近7天</b>：注册 ${s.registrations_7d} · 访问 ${s.visits_7d} 人次 · 存档 ${s.savers_7d} 人 · 发布 ${s.publishers_7d} 人 · 次日留存 ${s.retention_1d ?? "样本不足"}</p></div>`
    : "";
  const r = await api("GET", "/api/admin/pending");
  if (r.status === 403) {
    root.innerHTML = `<div class="px-card">你不是管理员（ADMIN_EMAILS 白名单）。</div>`;
    return;
  }
  const pending = r.status === 200 ? r.data.items : [];
  root.innerHTML = `
    ${statHtml}
    <h2 class="px-title px-title--sub">待审核</h2>
    <section class="stack">
      <div id="admin-pending" class="stack">
        ${pending.length ? pending.map(pendingRow).join("") : `<div class="px-card">待审为空，天下太平。</div>`}
      </div>
    </section>
    <div class="row admin-section-head">
      <h2 class="px-title px-title--sub">精选作品</h2>
      <form id="admin-search" class="row admin-search">
        <input class="px-input" id="admin-q" maxlength="40" placeholder="搜标题或作者" value="${esc(currentFeaturedQuery)}">
        <button class="px-btn px-btn--sm">搜索</button>
      </form>
    </div>
    <section class="stack">
      <div id="admin-artworks" class="stack"><p class="hint">读取中…</p></div>
    </section>`;
  root.onclick = onAdminClick;
  if (root.dataset.pagerKeys !== "1") {
    root.dataset.pagerKeys = "1";
    root.addEventListener("keydown", (e) => {
      if (!window.location.hash.startsWith("#/admin")) return;
      const pager = root.querySelector("#admin-artworks .admin-pager");
      const nextPage = getPagerKeyboardPage(e, currentFeaturedPage, Number(pager?.dataset.pages), {
        enabled: !!pager,
        dialogOpen: !!document.querySelector("[data-dlg]:not([hidden])"),
      });
      if (nextPage === null) return;
      e.preventDefault();
      currentFeaturedPage = nextPage;
      loadFeatured(currentFeaturedQuery);
    });
  }
  root.querySelector("#admin-search").onsubmit = (e) => {
    e.preventDefault();
    currentFeaturedQuery = root.querySelector("#admin-q").value.trim();
    currentFeaturedPage = 1;
    loadFeatured(currentFeaturedQuery);
  };
  loadFeatured(currentFeaturedQuery);
}

function pendingRow(a) {
  return `
    <div class="px-card draft-row" data-id="${a.id}">
      <img class="draft-thumb" src="${a.png_url}" alt="">
      <div><b>${esc(a.title)}</b><p class="hint">${esc(a.author_name)} · ${esc(a.created_at)}</p><p>${esc(a.description)}</p></div>
      <div class="row">
        <button class="px-btn px-btn--sm" data-st="normal">通过</button>
        <button class="px-btn px-btn--sm px-btn--mint" data-st="featured">精选</button>
        <button class="px-btn px-btn--sm px-btn--pale" data-st="removed">下架</button>
      </div>
    </div>`;
}

function artworkRow(a) {
  const featured = a.status === "featured";
  return `
    <div class="px-card draft-row${featured ? " admin-row--featured" : ""}" data-id="${a.id}">
      <img class="draft-thumb" src="${a.png_url}" alt="">
      <div class="draft-meta">
        <b>${esc(a.title)}</b>
        <p class="hint">${esc(a.author_name)} · ${esc(a.created_at)}</p>
      </div>
      <div class="row">
        <a class="px-btn px-btn--sm" href="#/art/${a.id}">查看</a>
        ${featured
          ? `<button class="px-btn px-btn--sm" data-st="normal">取消精选</button>`
          : `<button class="px-btn px-btn--sm px-btn--mint" data-st="featured">设为精选</button>`}
      </div>
    </div>`;
}

async function loadFeatured(q) {
  const box = document.querySelector("#admin-artworks");
  if (!box) return;
  const loadId = ++latestFeaturedLoad;
  const query = String(q || "").trim();
  const r = await api("GET", `/api/admin/artworks${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  if (loadId !== latestFeaturedLoad || !box.isConnected) return;
  if (r.status !== 200) {
    box.innerHTML = `<div class="px-card">作品列表读不出来，刷新试试。</div>`;
    return;
  }
  const { items, page, pages, total } = getAdminArtworkPage(r.data.items, currentFeaturedPage);
  currentFeaturedPage = page;
  box.innerHTML = total
    ? `${items.map(artworkRow).join("")}
      <div class="row admin-pager" data-page="${page}" data-pages="${pages}" aria-label="精选作品翻页（可用左右方向键）">
        <span class="hint" aria-live="polite">共 ${total} 件作品 · 每页 ${ADMIN_ARTWORKS_PER_PAGE} 件 · 第 ${page} / ${pages} 页 · ←/→ 翻页</span>
        <div class="row">
          <button class="px-btn px-btn--sm" data-admin-page="${page - 1}" aria-label="上一页"${page === 1 ? " disabled" : ""}>上一页</button>
          <button class="px-btn px-btn--sm" data-admin-page="${page + 1}" aria-label="下一页"${page === pages ? " disabled" : ""}>下一页</button>
        </div>
      </div>`
    : `<div class="px-card">${query ? "没有匹配的作品。" : "还没有可精选的作品。"}</div>`;
}

async function onAdminClick(e) {
  const pageButton = e.target.closest("[data-admin-page]");
  if (pageButton && !pageButton.disabled) {
    currentFeaturedPage = Number(pageButton.dataset.adminPage);
    await loadFeatured(currentFeaturedQuery);
    return;
  }
  const b = e.target.closest("[data-st]");
  if (!b) return;
  const id = b.closest("[data-id]").dataset.id;
  if (b.dataset.st === "removed" && !(await uiConfirm("下架这件作品？画廊将不再展示。", "下架"))) return;
  if (b.dataset.st === "normal" && b.textContent === "取消精选" && !(await uiConfirm("取消这件作品的精选？", "取消精选"))) return;
  const rr = await api("PATCH", `/api/admin/${id}`, JSON.stringify({ status: b.dataset.st }));
  if (rr.status === 200) mountAdmin();
}
