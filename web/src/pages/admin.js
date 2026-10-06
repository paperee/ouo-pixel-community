// 审核后台
import { api } from "../api.js";
import { esc } from "./shared.js";

export async function mountAdmin() {
  const root = document.querySelector("#admin-root");
  const stats = await api("GET", "/api/admin/stats");
  const s = stats.status === 200 ? stats.data.stats : null;
  const statHtml = s
    ? `<div class="px-card"><b>近7天</b><p class="hint">注册 ${s.registrations_7d} · 访问 ${s.visits_7d} 人次 · 存档 ${s.savers_7d} 人 · 发布 ${s.publishers_7d} 人 · 次日留存 ${s.retention_1d ?? "样本不足"}</p></div>`
    : "";
  const r = await api("GET", "/api/admin/pending");
  if (r.status === 403) {
    root.innerHTML = `<div class="px-card">你不是管理员（ADMIN_EMAILS 白名单）。</div>`;
    return;
  }
  if (!r.data.items.length) {
    root.innerHTML = statHtml + `<div class="px-card">待审为空，天下太平。</div>`;
    return;
  }
  root.innerHTML =
    statHtml +
    r.data.items
    .map(
      (a) => `
    <div class="px-card draft-row" data-id="${a.id}">
      <img class="draft-thumb" src="${a.thumb_url}" alt="">
      <div><b>${esc(a.title)}</b><p class="hint">${esc(a.author_name)} · ${esc(a.created_at)}</p><p>${esc(a.description)}</p></div>
      <div class="row">
        <button class="px-btn px-btn--sm" data-st="normal">通过</button>
        <button class="px-btn px-btn--sm" data-st="featured">精选</button>
        <button class="px-btn px-btn--sm" data-st="removed">下架</button>
      </div>
    </div>`
    )
    .join("");
  root.onclick = async (e) => {
    const b = e.target.closest("[data-st]");
    if (!b) return;
    const id = b.closest("[data-id]").dataset.id;
    const rr = await api("PATCH", `/api/admin/${id}`, JSON.stringify({ status: b.dataset.st }));
    if (rr.status === 200) mountAdmin();
  };
}
