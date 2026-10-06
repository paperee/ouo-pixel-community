// 我的主页 + 他人主页：模板 + 资料/头像绑定
import { api } from "../api.js";
import { artCard } from "./home.js";
import { esc } from "./shared.js";

export function pageMe(user, stats, works, myWorks) {
  const avatar = user.avatar_url
    ? `<img class="avatar" src="${user.avatar_url}" alt="头像" />`
    : `<div class="avatar avatar--empty">画</div>`;
  const candidates = (myWorks || []).filter((w) => w.status !== "removed");
  return `
    <main class="wrap">
      <h1 class="px-title">我的主页</h1>
      <div class="px-card me">
        <div class="me-side">
          ${avatar}
          <button class="px-btn px-btn--sm" id="avatar-toggle" ${candidates.length ? "" : "disabled"}>换头像</button>
          ${user.avatar_url ? `<button class="px-btn px-btn--sm" id="avatar-clear">恢复默认</button>` : ""}
          <p class="hint">只能用自己<br>发布过的作品</p>
        </div>
        <div class="stack me-fields">
          <form id="me-form" class="stack">
            <label class="fld"><span>昵称</span><input class="px-input" name="nickname" maxlength="20" value="${user.nickname}" /></label>
            <label class="fld"><span>简介</span><textarea class="px-input" name="bio" maxlength="200" rows="2" placeholder="一句话介绍自己">${user.bio || ""}</textarea></label>
            <button class="px-btn px-btn--lemon" type="submit">保存资料</button>
          </form>
          <p class="hint stats" style="display:flex;justify-content:space-between;align-items:center;gap:12px"><span>作品 ${stats.artworks} · 获赞 ${stats.likes}</span><a href="#/user/${user.id}" id="me-link" title="点击复制主页链接" style="text-decoration:underline;text-underline-offset:3px"> #/user/${user.id}</a></p>
          <p class="err" id="me-err"></p>
        </div>
      </div>
      <div class="px-card stack" id="avatar-pick" hidden>
        <b>从我的作品选头像（点一张即换上）</b>
        ${candidates.length ? `<div class="avatar-pick">${candidates.map((w) => `
          <button class="avatar-pick-item${user.avatar_url === w.png_url ? " active" : ""}" data-avatar="${w.id}" title="${esc(w.title)}">
            <img src="${w.thumb_url}" alt="${esc(w.title)}" loading="lazy">
            <span>${esc(w.title)}</span>
          </button>`).join("")}</div>` : `<p class="hint">还没有可用的发布作品，先去发布一张吧。</p>`}
      </div>
      <h2 class="px-title px-title--sub">我的作品墙</h2>
      ${works?.length ? `<div class="art-grid">${works.map(artCard).join("")}</div>` : `
      <div class="px-card empty-wall">
        还没有作品，去画第一张像素画吧
        <a href="#/" class="px-btn px-btn--cherry">开始作画</a>
      </div>`}
    </main>`;
}

export function pageUser(u, stats, works) {
  const avatar = u.avatar_url
    ? `<img class="avatar" src="${u.avatar_url}" alt="头像" />`
    : `<div class="avatar avatar--empty">画</div>`;
  return `
    <main class="wrap">
      <h1 class="px-title">${esc(u.nickname)} 的主页</h1>
      <div class="px-card me">
        <div class="me-side">
          ${avatar}
        </div>
        <div class="stack me-fields">
          <p><b>${esc(u.nickname)}</b></p>
          <p class="hint">${esc(u.bio) || "这个人很神秘，没留下简介。"}</p>
          <p class="hint stats">作品 ${stats.artworks} · 获赞 ${stats.likes}</p>
          <p class="hint">加入于 ${esc(u.created_at)}</p>
        </div>
      </div>
      <h2 class="px-title px-title--sub">作品墙</h2>
      ${works?.length ? `<div class="art-grid">${works.map(artCard).join("")}</div>` : `
      <div class="px-card empty-wall">还没有作品</div>`}
    </main>`;
}

// me 页表单/头像/链接绑定（原 render() 尾部内联逻辑；改完重渲染回调由路由传入）
export function wireMePage(rerender) {
  const meForm = document.querySelector("#me-form");
  if (meForm)
    meForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(meForm);
      const r = await api("PATCH", "/api/me", JSON.stringify({ nickname: fd.get("nickname"), bio: fd.get("bio") }));
      document.querySelector("#me-err").textContent = r.status === 200 ? "已保存" : "昵称不能为空";
      if (r.status === 200) rerender();
    };

  const avatarToggle = document.querySelector("#avatar-toggle");
  if (avatarToggle)
    avatarToggle.onclick = () => {
      const pick = document.querySelector("#avatar-pick");
      if (pick) pick.hidden = !pick.hidden;
    };

  const avatarPick = document.querySelector("#avatar-pick");
  if (avatarPick)
    avatarPick.onclick = async (e) => {
      const b = e.target.closest("[data-avatar]");
      if (!b) return;
      b.disabled = true;
      const r = await api("POST", "/api/me/avatar", JSON.stringify({ artwork_id: Number(b.dataset.avatar) }));
      if (r.status === 200) rerender();
      else {
        document.querySelector("#me-err").textContent = "换头像失败，重试一下";
        b.disabled = false;
      }
    };

  const avatarClear = document.querySelector("#avatar-clear");
  if (avatarClear)
    avatarClear.onclick = async () => {
      const r = await api("DELETE", "/api/me/avatar");
      if (r.status === 200) rerender();
    };

  const meLink = document.querySelector("#me-link");
  if (meLink)
    meLink.onclick = async (e) => {
      e.preventDefault();
      const href = meLink.getAttribute("href") || "";
      const full = `${location.origin}/${href}`;
      try {
        await navigator.clipboard.writeText(full);
        const old = meLink.textContent;
        meLink.textContent = "已复制";
        setTimeout(() => (meLink.textContent = old), 1200);
      } catch {
        const err = document.querySelector("#me-err");
        if (err) err.textContent = full;
      }
    };
}
