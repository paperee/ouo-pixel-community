// 审核后台：标签页分区（举报/待审/作品/用户/日志），操作后局部刷新不跳顶
import { api } from "../api.js";
import { esc } from "./shared.js";
import { uiAlert, uiConfirm, uiPrompt } from "../dialog.js";
import { ADMIN_LIST_PER_PAGE, getAdminArtworkPage } from "./admin-pagination.js";
import { getPagerKeyboardPage } from "./pagination-keyboard.js";

const ADMIN_TABS = [
  ["review", "审核"],
  ["artworks", "作品管理"],
  ["users", "用户管理"],
  ["logs", "操作日志"],
];

let adminTab = "review";
let currentFeaturedPage = 1;
let currentFeaturedQuery = "";
let currentFeaturedStatus = "all";
let currentPendingPage = 1;
let currentReportsPage = 1;
let currentReportsStatus = "open";
let currentUserQuery = "";
let currentUserStatus = "all";
let currentUsersPage = 1;
let currentLogsPage = 1;
let currentLogStatus = "all";
let currentLogQuery = "";
let latestFeaturedLoad = 0;
let latestPendingLoad = 0;
let latestReportsLoad = 0;

const opFail = (r) =>
  uiAlert(r.status === 403 ? "权限失效，重新登录后再试。" : "操作失败，刷新重试一下。");

export async function mountAdmin() {
  const root = document.querySelector("#admin-root");
  const stats = await api("GET", "/api/admin/stats");
  if (stats.status === 403) {
    root.innerHTML = `<div class="px-card">你不是管理员（ADMIN_EMAILS 白名单）。</div>`;
    return;
  }
  root.innerHTML = `
    <div class="px-card" id="admin-stats"><p class="hint">统计读取中…</p></div>
    <div class="row tabs admin-tabs" role="tablist">
      ${ADMIN_TABS.map(([id, label]) => `<button class="tool-btn" role="tab" data-atab="${id}">${label}<span data-atab-n="${id}"></span></button>`).join("")}
    </div>
    <section class="admin-sec" data-asec="review">
      <h3 class="admin-sub">敏感作品</h3>
      <div id="admin-pending" class="stack"><p class="hint">读取中…</p></div>
      <h3 class="admin-sub">用户举报</h3>
      <div id="admin-reports" class="stack"><p class="hint">读取中…</p></div>
    </section>
    <section class="admin-sec" data-asec="artworks" hidden>
      <div class="row admin-section-head">
        <p class="hint admin-sec-hint">精选上首页推荐位；已下架的作品可在这里恢复上架。</p>
        <form id="admin-search" class="row admin-search">
          <select class="px-input" id="admin-status">
            <option value="all"${currentFeaturedStatus === "all" ? " selected" : ""}>全部</option>
            <option value="featured"${currentFeaturedStatus === "featured" ? " selected" : ""}>精选</option>
            <option value="normal"${currentFeaturedStatus === "normal" ? " selected" : ""}>正常</option>
            <option value="removed"${currentFeaturedStatus === "removed" ? " selected" : ""}>已下架</option>
          </select>
          <input class="px-input" id="admin-q" maxlength="40" placeholder="搜标题或作者" value="${esc(currentFeaturedQuery)}">
          <button class="px-btn px-btn--sm">搜索</button>
        </form>
      </div>
      <div id="admin-artworks" class="stack"><p class="hint">读取中…</p></div>
    </section>
    <section class="admin-sec" data-asec="users" hidden>
      <h3 class="admin-sub">管理员</h3>
      <div id="admin-admins" class="stack"><p class="hint">读取中…</p></div>
      <h3 class="admin-sub">注册用户</h3>
      <div class="row admin-section-head">
        <p class="hint admin-sec-hint">封禁后对方无法登录和任何操作；不能封管理员。</p>
        <form id="admin-user-search" class="row admin-search">
          <select class="px-input" id="admin-user-status">
            <option value="all"${currentUserStatus === "all" ? " selected" : ""}>全部</option>
            <option value="normal"${currentUserStatus === "normal" ? " selected" : ""}>正常</option>
            <option value="banned"${currentUserStatus === "banned" ? " selected" : ""}>已封禁</option>
          </select>
          <input class="px-input" id="admin-uq" maxlength="40" placeholder="搜昵称或邮箱" value="${esc(currentUserQuery)}">
          <button class="px-btn px-btn--sm">搜索</button>
        </form>
      </div>
      <div id="admin-users" class="stack"><p class="hint">读取中…</p></div>
    </section>
    <section class="admin-sec" data-asec="logs" hidden>
      <div class="row admin-section-head">
        <p class="hint admin-sec-hint">最近 40 条管理操作，只读。</p>
        <form id="admin-log-search" class="row admin-search">
          <select class="px-input" id="admin-log-status">
            <option value="all"${currentLogStatus === "all" ? " selected" : ""}>全部</option>
            <option value="artwork"${currentLogStatus === "artwork" ? " selected" : ""}>作品操作</option>
            <option value="user"${currentLogStatus === "user" ? " selected" : ""}>用户管理</option>
            <option value="report"${currentLogStatus === "report" ? " selected" : ""}>举报处理</option>
            <option value="other"${currentLogStatus === "other" ? " selected" : ""}>其他</option>
          </select>
          <input class="px-input" id="admin-lq" maxlength="40" placeholder="搜操作或管理员" value="${esc(currentLogQuery)}">
          <button class="px-btn px-btn--sm">搜索</button>
        </form>
      </div>
      <div id="admin-logs" class="stack"><p class="hint">读取中…</p></div>
    </section>`;
  root.onclick = onAdminClick;
  wireRemovedThumbPreview(root);
  if (root.dataset.pagerKeys !== "1") {
    root.dataset.pagerKeys = "1";
    root.addEventListener("keydown", (e) => {
      if (!window.location.hash.startsWith("#/admin")) return;
      if (adminTab !== "artworks") return;
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
  root.querySelector("#admin-status").onchange = (e) => {
    currentFeaturedStatus = e.target.value;
    currentFeaturedPage = 1;
    loadFeatured(currentFeaturedQuery);
  };
  root.querySelector("#admin-user-status").onchange = (e) => {
    currentUserStatus = e.target.value;
    currentUsersPage = 1;
    loadUsers();
  };
  root.querySelector("#admin-user-search").onsubmit = (e) => {
    e.preventDefault();
    currentUserQuery = root.querySelector("#admin-uq").value.trim();
    currentUsersPage = 1;
    loadUsers();
  };
  root.querySelector("#admin-log-status").onchange = (e) => {
    currentLogStatus = e.target.value;
    currentLogsPage = 1;
    loadLogs();
  };
  root.querySelector("#admin-log-search").onsubmit = (e) => {
    e.preventDefault();
    currentLogQuery = root.querySelector("#admin-lq").value.trim();
    currentLogsPage = 1;
    loadLogs();
  };
  renderStats(stats.status === 200 ? stats.data.stats : null);
  switchTab(adminTab);
}

function renderStats(s) {
  const box = document.querySelector("#admin-stats");
  if (box) {
    box.innerHTML = s
      ? `<p class="hint"><b>待办</b>：待审核作品 ${s.pending_count} 件；未处理举报 ${s.open_reports_count} 条。请前往顶部「审核」处理。</p>
         <p class="hint"><b>近 7 天</b>：新增注册用户 ${s.registrations_7d} 人；访问 ${s.visits_7d} 人次；保存过草稿的用户 ${s.savers_7d} 人；发布过作品的用户 ${s.publishers_7d} 人。</p>
         <p class="hint"><b>用户与留存</b>：累计注册用户 ${s.users_total} 人；昨日新增用户今日回访 ${s.retention_1d ?? "样本不足"}${s.retention_1d ? "（回访人数 / 昨日新增人数）" : "（昨日无新增用户）"}。</p>`
      : `<p class="hint">统计读不出来，刷新试试。</p>`;
  }
  // 标签页角标：审核 = 待审 + 未处理举报
  const el = document.querySelector(`[data-atab-n="review"]`);
  if (el) {
    const n = (s?.pending_count || 0) + (s?.open_reports_count || 0);
    el.textContent = n > 0 ? `（${n}）` : "";
  }
}

async function loadStats() {
  const r = await api("GET", "/api/admin/stats");
  if (r.status === 200) renderStats(r.data.stats);
}

// 切标签：只显示对应分区并加载数据；各分区页码/搜索词独立保留
const TAB_LOADERS = {};
function switchTab(tab) {
  adminTab = ADMIN_TABS.some(([id]) => id === tab) ? tab : "review";
  document.querySelectorAll("[data-atab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.atab === adminTab));
  document.querySelectorAll("[data-asec]").forEach((sec) => {
    sec.hidden = sec.dataset.asec !== adminTab;
  });
  TAB_LOADERS[adminTab]?.();
}

// 操作后局部刷新：只重拉受影响的区块，不重渲整页（不跳顶、不丢标签页状态）
function refreshAfter(kind) {
  loadStats();
  loadLogs();
  if (kind === "artwork") {
    loadPending();
    loadFeatured(currentFeaturedQuery);
  } else if (kind === "report") {
    loadReports();
    loadPending();
    loadFeatured(currentFeaturedQuery);
  } else if (kind === "user") {
    loadUsers();
  }
}

function wireRemovedThumbPreview(root) {
  let timer = null;
  let active = null;
  let startX = 0;
  let startY = 0;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    active?.classList.remove("is-previewing");
    active = null;
  };
  root.addEventListener("pointerdown", (e) => {
    const thumb = e.target.closest("[data-removed-thumb]");
    if (!thumb || !root.contains(thumb) || e.button !== 0) return;
    clear();
    active = thumb.closest(".admin-row--removed, .admin-row--author-removed");
    startX = e.clientX;
    startY = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      if (active?.isConnected) active.classList.add("is-previewing");
    }, 450);
    try { thumb.setPointerCapture(e.pointerId); } catch { /* 旧浏览器忽略 */ }
  });
  root.addEventListener("pointermove", (e) => {
    if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) clear();
  });
  root.addEventListener("pointerup", clear);
  root.addEventListener("pointercancel", clear);
  root.addEventListener("pointerleave", clear);
  root.addEventListener("contextmenu", (e) => {
    if (e.target.closest("[data-removed-thumb]")) e.preventDefault();
  });
}

function pagerHtml(scope, page, pages, total, label) {
  if (pages <= 1)
    return `<div class="row admin-pager" data-page="${page}" data-pages="${pages}"><span class="hint" aria-live="polite">共 ${total} ${label}</span></div>`;
  return `
    <div class="row admin-pager" data-page="${page}" data-pages="${pages}" aria-label="翻页（可用左右方向键）">
      <span class="hint" aria-live="polite">共 ${total} ${label} · 第 ${page} / ${pages} 页 · ←/→ 翻页</span>
      <div class="row">
        <button class="px-btn px-btn--sm" data-pg="${scope}" data-pg-n="${page - 1}" aria-label="上一页"${page === 1 ? " disabled" : ""}>上一页</button>
        <button class="px-btn px-btn--sm" data-pg="${scope}" data-pg-n="${page + 1}" aria-label="下一页"${page === pages ? " disabled" : ""}>下一页</button>
      </div>
    </div>`;
}

function pendingRow(a) {
  return `
    <div class="px-card draft-row" data-id="${a.id}">
      <img class="draft-thumb" src="${a.png_url}" alt="">
      <div class="draft-meta">
        <b>${esc(a.title)}</b>${a.report_count > 0 ? ` <span class="px-badge" style="background:var(--cherry,#d33);color:#fff">被举报 ${a.report_count} 次</span>` : ""}
        <p class="hint">${esc(a.author_name)} · ${esc(a.created_at)}</p>
        ${a.report_count > 0 ? `<p class="hint">举报人：${esc(a.reporters || "")}</p>` : ""}
        ${a.description ? `<p>${esc(a.description)}</p>` : ""}
      </div>
      <div class="row admin-row-ops">
        <a class="px-btn px-btn--sm" href="#/art/${a.id}">查看</a>
        <button class="px-btn px-btn--sm" data-st="normal">通过</button>
        <button class="px-btn px-btn--sm px-btn--mint" data-st="featured">精选</button>
        <button class="px-btn px-btn--sm px-btn--pale" data-st="removed">下架</button>
      </div>
    </div>`;
}

function artworkRow(a) {
  const featured = a.status === "featured";
  const removed = a.status === "removed";
  const authorRemoved = removed && a.removed_source === "author";
  return `
    <div class="px-card draft-row${featured ? " admin-row--featured" : authorRemoved ? " admin-row--author-removed" : removed ? " admin-row--removed" : ""}" data-id="${a.id}">
      ${removed
        ? `<span class="admin-thumb admin-thumb--removed" data-removed-thumb title="长按查看已下架作品缩略图">
             <img class="draft-thumb" src="${a.png_url}" alt="已下架作品缩略图" draggable="false">
             <span class="admin-thumb-mask">长按查看</span>
           </span>`
        : `<img class="draft-thumb" src="${a.png_url}" alt="">`}
      <div class="draft-meta">
        <b>${esc(a.title)}</b>
        <p class="hint">${esc(a.author_name)} · ${esc(a.created_at)}</p>
        ${authorRemoved ? `<p class="hint">作者主动下架，管理员不可操作</p>` : ""}
        ${removed && !authorRemoved && a.removed_reason ? `<p class="hint">下架理由：${esc(a.removed_reason)}</p>` : ""}
      </div>
      <div class="row admin-row-ops">
        <a class="px-btn px-btn--sm" href="#/art/${a.id}">查看</a>
        ${removed
          ? authorRemoved ? "" : `<button class="px-btn px-btn--sm px-btn--mint" data-st="normal">恢复上架</button>`
          : `${featured
              ? `<button class="px-btn px-btn--sm" data-st="normal">取消精选</button>`
              : `<button class="px-btn px-btn--sm px-btn--mint" data-st="featured">设为精选</button>`}
             <button class="px-btn px-btn--sm px-btn--pale" data-st="removed">下架</button>`}
      </div>
    </div>`;
}

function reportRow(x) {
  const isComment = !!x.comment_id;
  const handled = x.status !== "open";
  const thumbSrc = isComment ? "" : x.artwork_thumb;
  const target = isComment
    ? `<p>评论「${esc(String(x.comment_content || "").slice(0, 40))}」${x.comment_deleted ? "（已删除）" : ""}</p>
       <p class="hint">评论者 ${esc(x.comment_author || "?")} · 所属作品 <a href="#/art/${x.comment_artwork_id}">${esc(x.artwork_title || `#${x.comment_artwork_id}`)}</a></p>`
    : `<p><b>${esc(x.artwork_title || "?")}</b> · 作者 ${esc(x.artwork_author || "?")} · 当前状态 ${esc(x.artwork_status || "?")}</p>
       <p class="hint"><a href="#/art/${x.artwork_id}">查看作品</a></p>`;
  return `
    <div class="px-card draft-row" data-aid="${x.artwork_id}" data-cid="${x.comment_id}">
      ${thumbSrc ? `<img class="draft-thumb" src="${thumbSrc}" alt="">` : ""}
      <div class="draft-meta">
        <b>${x.cnt} 次举报</b>${handled ? ` <span class="px-badge">${x.status === "resolved" ? "已处理" : "已驳回"}</span>` : ""}
        <p class="hint">${esc(x.reasons || "")} · 最近 ${esc(x.latest)}</p>
        <p class="hint">举报人：${esc(x.reporters || "?")}</p>
        ${target}
      </div>
      ${handled ? "" : `
      <div class="row admin-row-ops">
        <button class="px-btn px-btn--sm px-btn--pale" data-report-action="remove">下架/删除</button>
        <button class="px-btn px-btn--sm" data-report-action="dismiss">驳回</button>
      </div>`}
    </div>`;
}

function adminRow(u) {
  return `
    <div class="px-card draft-row" data-uid="${u.id}">
      <div class="draft-meta">
        <b><span class="admin-star" title="管理员">★</span>${esc(u.nickname)}</b>
        <p class="hint">${esc(u.email)}</p>
      </div>
      <div class="row admin-row-ops">
        <a class="px-btn px-btn--sm" href="#/user/${u.id}">查看主页</a>
      </div>
    </div>`;
}

function userRow(u) {
  return `
    <div class="px-card draft-row${u.banned ? " admin-row--banned" : ""}" data-uid="${u.id}">
      <div class="draft-meta">
        <b>${u.is_admin ? `<span class="admin-star" title="管理员">★</span>` : ""}${esc(u.nickname)}</b>
        <p class="hint">${esc(u.email)} · 作品 ${u.artworks_count} · 注册于 ${esc(String(u.created_at || "").slice(0, 10))}</p>
      </div>
      <div class="row admin-row-ops">
        <a class="px-btn px-btn--sm" href="#/user/${u.id}">查看主页</a>
        ${u.is_admin ? "" : `<button class="px-btn px-btn--sm${u.banned ? "" : " px-btn--pale"}" data-ban="${u.banned ? 0 : 1}">${u.banned ? "解封" : "封禁"}</button>`}
      </div>
    </div>`;
}

const ACTION_TEXT = {
  artwork_normal: "恢复/通过作品",
  artwork_featured: "设为精选",
  artwork_removed: "下架作品",
  report_remove: "处理举报（下架/删除）",
  report_dismiss: "驳回举报",
  user_ban: "封禁用户",
  user_unban: "解封用户",
  board_update: "更新公告",
  comment_delete: "删除评论",
};

function logRow(l) {
  return `<div class="px-card"><p class="hint">${esc(l.created_at)} · <b>${esc(l.admin_name)}</b> ${esc(ACTION_TEXT[l.action] || l.action)}${l.target_id ? ` #${l.target_id}` : ""}${l.detail ? ` · ${esc(l.detail)}` : ""}</p></div>`;
}

async function loadPending() {
  const box = document.querySelector("#admin-pending");
  if (!box) return;
  const loadId = ++latestPendingLoad;
  const r = await api("GET", `/api/admin/pending?page=${currentPendingPage}&limit=${ADMIN_LIST_PER_PAGE}`);
  if (loadId !== latestPendingLoad || !box.isConnected) return;
  if (r.status !== 200) {
    box.innerHTML = `<div class="px-card">待审列表读不出来，刷新试试。</div>`;
    return;
  }
  const { items, page, pages, total } = getAdminArtworkPage(r.data, currentPendingPage);
  currentPendingPage = page;
  box.innerHTML = total
    ? items.map(pendingRow).join("") + pagerHtml("pending", page, pages, total, "件待审")
    : `<div class="px-card">待审为空，天下太平。</div>`;
}

async function loadReports() {
  const box = document.querySelector("#admin-reports");
  if (!box) return;
  const loadId = ++latestReportsLoad;
  const r = await api("GET", `/api/admin/reports?status=${currentReportsStatus}&page=${currentReportsPage}`);
  if (loadId !== latestReportsLoad || !box.isConnected) return;
  if (r.status !== 200) {
    box.innerHTML = `<div class="px-card">举报列表读不出来，刷新试试。</div>`;
    return;
  }
  const { items, page, pages, total, open } = r.data;
  currentReportsPage = page;
  const tabs = `<div class="row tabs">
    <button class="tool-btn${currentReportsStatus === "open" ? " active" : ""}" data-reports-tab="open">未处理（${open}）</button>
    <button class="tool-btn${currentReportsStatus === "handled" ? " active" : ""}" data-reports-tab="handled">已处理</button>
  </div>`;
  box.innerHTML = tabs + (items.length
    ? items.map(reportRow).join("") + pagerHtml("reports", page, pages, total, "组举报")
    : `<div class="px-card">${currentReportsStatus === "open" ? "没有待处理的举报，天下太平。" : "还没有处理过举报。"}</div>`);
}

async function loadFeatured(q) {
  const box = document.querySelector("#admin-artworks");
  if (!box) return;
  const loadId = ++latestFeaturedLoad;
  const query = String(q || "").trim();
  const qs = `page=${currentFeaturedPage}&limit=${ADMIN_LIST_PER_PAGE}&status=${currentFeaturedStatus}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const r = await api("GET", `/api/admin/artworks?${qs}`);
  if (loadId !== latestFeaturedLoad || !box.isConnected) return;
  if (r.status !== 200) {
    box.innerHTML = `<div class="px-card">作品列表读不出来，刷新试试。</div>`;
    return;
  }
  const { items, page, pages, total } = getAdminArtworkPage(r.data, currentFeaturedPage);
  currentFeaturedPage = page;
  box.innerHTML = total
    ? items.map(artworkRow).join("") + pagerHtml("artworks", page, pages, total, "件作品")
    : `<div class="px-card">${query ? "没有匹配的作品。" : "这个分类下暂时没有作品。"}</div>`;
}

async function loadAdmins() {
  const box = document.querySelector("#admin-admins");
  if (!box) return;
  const r = await api("GET", "/api/admin/admins");
  if (!box.isConnected) return;
  if (r.status !== 200) {
    box.innerHTML = `<div class="px-card">管理员列表读不出来，刷新试试。</div>`;
    return;
  }
  const items = Array.isArray(r.data?.items) ? r.data.items : [];
  box.innerHTML = items.length
    ? items.map(adminRow).join("")
    : `<div class="px-card">暂无管理员。</div>`;
}

async function loadUsers() {
  const box = document.querySelector("#admin-users");
  if (!box) return;
  const qs = `page=${currentUsersPage}&status=${currentUserStatus}${currentUserQuery ? `&q=${encodeURIComponent(currentUserQuery)}` : ""}`;
  const r = await api("GET", `/api/admin/users?${qs}`);
  if (!box.isConnected) return;
  if (r.status !== 200) {
    box.innerHTML = `<div class="px-card">用户列表读不出来，刷新试试。</div>`;
    return;
  }
  const { items, page, pages, total } = getAdminArtworkPage(r.data, currentUsersPage);
  currentUsersPage = page;
  box.innerHTML = total
    ? items.map(userRow).join("") + pagerHtml("users", page, pages, total, "位用户")
    : `<div class="px-card">没有匹配的用户。</div>`;
}

async function loadLogs() {
  const box = document.querySelector("#admin-logs");
  if (!box) return;
  const qs = `page=${currentLogsPage}&status=${currentLogStatus}${currentLogQuery ? `&q=${encodeURIComponent(currentLogQuery)}` : ""}`;
  const r = await api("GET", `/api/admin/logs?${qs}`);
  if (!box.isConnected) return;
  if (r.status !== 200) {
    box.innerHTML = `<div class="px-card">日志读不出来，刷新试试。</div>`;
    return;
  }
  const { items, page, pages, total } = getAdminArtworkPage(r.data, currentLogsPage);
  currentLogsPage = page;
  box.innerHTML = total
    ? items.map(logRow).join("") + pagerHtml("logs", page, pages, total, "条日志")
    : `<div class="px-card">${currentLogQuery || currentLogStatus !== "all" ? "没有匹配的日志。" : "还没有管理操作记录。"}</div>`;
}

Object.assign(TAB_LOADERS, {
  review: () => {
    loadPending();
    loadReports();
  },
  artworks: () => loadFeatured(currentFeaturedQuery),
  users: () => {
    loadAdmins();
    loadUsers();
  },
  logs: loadLogs,
});

async function onAdminClick(e) {
  const at = e.target.closest("[data-atab]");
  if (at) {
    switchTab(at.dataset.atab);
    return;
  }
  const pageButton = e.target.closest("[data-pg]");
  if (pageButton && !pageButton.disabled) {
    const p = Number(pageButton.dataset.pgN);
    if (pageButton.dataset.pg === "artworks") {
      currentFeaturedPage = p;
      await loadFeatured(currentFeaturedQuery);
    } else if (pageButton.dataset.pg === "pending") {
      currentPendingPage = p;
      await loadPending();
    } else if (pageButton.dataset.pg === "reports") {
      currentReportsPage = p;
      await loadReports();
    } else if (pageButton.dataset.pg === "users") {
      currentUsersPage = p;
      await loadUsers();
    } else if (pageButton.dataset.pg === "logs") {
      currentLogsPage = p;
      await loadLogs();
    }
    return;
  }
  const tab = e.target.closest("[data-reports-tab]");
  if (tab) {
    currentReportsStatus = tab.dataset.reportsTab;
    currentReportsPage = 1;
    loadReports();
    return;
  }
  const rb = e.target.closest("[data-report-action]");
  if (rb) {
    const row = rb.closest("[data-aid]");
    const aid = Number(row.dataset.aid) || 0;
    const cid = Number(row.dataset.cid) || 0;
    const action = rb.dataset.reportAction;
    const msg = action === "remove"
      ? "下架/删除被举报的内容？举报人都会收到处理反馈。"
      : "驳回这组举报？举报人会收到“暂未违规”的反馈。";
    if (!(await uiConfirm(msg, action === "remove" ? "处理" : "驳回"))) return;
    const rr = await api("POST", "/api/admin/reports/handle", JSON.stringify({ artwork_id: aid, comment_id: cid, action }));
    if (rr.status === 200) refreshAfter("report");
    else opFail(rr);
    return;
  }
  const banBtn = e.target.closest("[data-ban]");
  if (banBtn) {
    const uid = Number(banBtn.closest("[data-uid]").dataset.uid);
    const ban = banBtn.dataset.ban === "1";
    if (ban && !(await uiConfirm("封禁该用户？对方登录后将无法任何操作。", "封禁"))) return;
    const rr = await api("PATCH", `/api/admin/users/${uid}`, JSON.stringify({ banned: ban ? 1 : 0 }));
    if (rr.status === 200) refreshAfter("user");
    else opFail(rr);
    return;
  }
  const b = e.target.closest("[data-st]");
  if (!b) return;
  const id = b.closest("[data-id]").dataset.id;
  let reason = "";
  if (b.dataset.st === "removed") {
    if (!(await uiConfirm("下架这件作品？画廊将不再展示。", "下架"))) return;
    const input = await uiPrompt("下架理由（会随通知发给作者，可留空；取消则不下架）", "");
    if (input === null) return;
    reason = input.trim().slice(0, 200);
  }
  if (b.dataset.st === "normal" && b.textContent.trim() === "取消精选" && !(await uiConfirm("取消这件作品的精选？", "取消精选"))) return;
  if (b.dataset.st === "normal" && b.textContent.trim() === "恢复上架" && !(await uiConfirm("恢复这件作品上架？将重新在画廊展示。", "恢复上架"))) return;
  const rr = await api("PATCH", `/api/admin/${id}`, JSON.stringify({ status: b.dataset.st, reason }));
  if (rr.status === 200) refreshAfter("artwork");
  else opFail(rr);
}
