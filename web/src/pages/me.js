// 我的主页 + 他人主页：模板 + 资料/头像绑定
import { api, logout } from "../api.js";
import { artCard } from "./home.js";
import { esc } from "./shared.js";
import { togglePetFlip } from "./pet.js";

// 标题行标签组：统计徽章在左，管理员徽章在右；放不下时整组一起换行
// function statChips(stats, isAdmin) {
//   return `<span class="me-title-tags" aria-label="作者统计">`
//     + `<span class="px-badge me-chip"><b>${stats.artworks || 0}</b> 作品</span>`
//     + `<span class="px-badge me-chip me-chip--sky"><b>${stats.views || 0}</b> 获浏览</span>`
//     + `<span class="px-badge me-chip me-chip--accent"><b>${stats.likes || 0}</b> 获点赞</span>`
//     + `<span class="px-badge me-chip me-chip--mint"><b>${stats.comments || 0}</b> 获评论</span>`
//     + (isAdmin ? `<span class="px-badge admin-badge">管理员</span>` : "") + `</span>`;
// }

function statChips(isAdmin) {
  return `<span class="me-title-tags" aria-label="作者统计">` + (isAdmin ? `<span class="px-badge me-chip">管理员</span>` : "") + `</span>`;
}

const petKey = (pet) => pet?.artwork_id ?? null;

function petImageUrl(pet) {
  return pet?.png_url || "";
}

function petRunHtml(pet) {
  if (!pet) return `<div class="pet-run" id="pet-run" hidden></div>`;
  return `<div class="pet-run" id="pet-run" data-artwork-id="${petKey(pet) ?? ""}" data-base-flip="${pet.flip ? 1 : 0}" data-canvas-width="${pet.width || ""}" data-canvas-height="${pet.height || ""}">`
    + `<div class="pet-facing" data-flip="${pet.flip ? 1 : 0}"><img class="pet-sprite" src="${petImageUrl(pet)}" alt="${esc(pet.title)}" title="${esc(pet.title)}"></div></div>`;
}

export function pageMe(user, stats, works, myWorks, pet = null) {
  const avatar = user.avatar_url
    ? `<img class="avatar" src="${user.avatar_url}" alt="头像" />`
    : `<div class="avatar avatar--empty">画</div>`;
  const candidates = (myWorks || []).filter((w) => w.kind === "artwork" && ["normal", "featured"].includes(w.status));
  const avatarGrid = (attr) => candidates.map((w) => {
    const isActive = attr === "avatar"
      ? user.avatar_url === w.png_url
      : petKey(pet) === w.id;
    return `<img class="avatar-pick-item${isActive ? " active" : ""}" ${attr === "avatar" ? `data-avatar="${w.id}"` : `data-pet="${w.id}"`} title="${esc(w.title)}" src="${w.png_url || ""}" alt="${esc(w.title)}" loading="lazy" tabindex="0" role="button">`;
  }).join("");
  return `
    <main class="wrap">
      <h1 class="px-title me-title"><span>我的主页</span>${statChips(user.is_admin)}</h1>
      <div class="px-card me">
        <div class="me-side">
          ${avatar}
          <button class="px-btn px-btn--sm" id="avatar-toggle" ${candidates.length ? "" : "disabled"}>换个头像</button>
          ${user.avatar_url ? `<button class="px-btn px-btn--sm" id="avatar-clear">恢复默认</button>` : ""}
          <button class="px-btn px-btn--sm" id="me-logout">退出登录</button>
          <button class="px-btn px-btn--sm" id="pet-toggle" ${candidates.length ? "" : "disabled"}>放只宠物</button>
        </div>
        <div class="stack me-fields">
          <form id="me-form" class="stack">
            <label class="fld"><span>昵称</span><input class="px-input" name="nickname" maxlength="20" value="${user.nickname}" /></label>
            <label class="fld"><span>简介</span><textarea class="px-input" name="bio" maxlength="200" rows="2" placeholder="一句话介绍自己">${user.bio || ""}</textarea></label>
            <button class="px-btn px-btn--lemon" type="submit">保存资料</button>
          </form>
          <div class="hint me-home-meta"><span>作品 ${stats.artworks || 0} · 获赞 ${stats.likes || 0}</span><a href="#/user/${user.id}" id="me-link" title="点击复制主页链接">#/user/${user.id}</a></div>
          <p class="err" id="me-err"></p>
          ${petRunHtml(pet)}
        </div>
      </div>
      <div class="px-card stack" id="avatar-pick" hidden>
        <b>从已发布作品中选择头像</b>
        <p class="hint">对… 你只能使用已发布的作品作为头像。</p>
        ${candidates.length ? `<div class="avatar-pick">${avatarGrid("avatar")}</div>` : `<p class="hint">还没有已发布的作品，先发布一张吧。</p>`}
      </div>
      <div class="px-card stack" id="pet-pick" hidden>
        <b>从已发布作品中选择宠物</b>
        <p class="hint">嘎吱嘎吱走呀走… 默认朝向向右。</p>
        ${candidates.length ? `<div class="avatar-pick">${avatarGrid("pet")}</div>` : `<p class="hint">还没有已发布的作品，先发布一张吧。</p>`}
        <div class="row">
          <button class="px-btn px-btn--sm" id="pet-flip" type="button" ${pet ? "" : "disabled"}>咋倒着走？</button>
          <button class="px-btn px-btn--sm" id="pet-clear" type="button" ${pet ? "" : "disabled"}>回来吧！</button>
        </div>
      </div>
      <h2 class="px-title px-title--sub">我的作品墙</h2>
      ${works?.length ? `<div class="art-grid me-wall">${works.map(artCard).join("")}</div>` : `
      <div class="px-card empty-wall">
        还没有作品，去画第一张像素画吧
        <a href="#/" class="px-btn px-btn--cherry">开始作画</a>
      </div>`}
    </main>`;
}

export function pageUser(u, stats, works, pet = null) {
  const avatar = u.avatar_url
    ? `<img class="avatar" src="${u.avatar_url}" alt="头像" />`
    : `<div class="avatar avatar--empty">画</div>`;
  const list = works || [];
  // 注册天数
  let days = null;
  const t0 = Date.parse(String(u.created_at || "").replace(" ", "T"));
  if (!Number.isNaN(t0)) days = Math.max(1, Math.ceil((Date.now() - t0) / 86400000));
  // 代表作：获赞最高的（至少 2 件作品且有人点赞才摆出来，免得和墙重复）
  const master = list.length >= 2 ? list.reduce((a, b) => (b.likes_count > a.likes_count ? b : a)) : null;
  const showMaster = master && master.likes_count > 0 ? master : null;
  const rest = showMaster ? list.filter((w) => w.id !== showMaster.id) : list;
  // 标签小结：聚合 TA 作品的标签
  const tagCount = new Map();
  for (const w of list) {
    try {
      for (const t of JSON.parse(w.tags || "[]")) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    } catch {
      /* 坏标签跳过 */
    }
  }
  const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return `
    <main class="wrap">
      <h1 class="px-title me-title"><span>用户 ${esc(u.nickname)} 的主页</span>${statChips(u.is_admin)}</h1>
      <div class="px-card me">
        <div class="me-side">
          ${avatar}
        </div>
        <div class="stack me-fields">
          <p><b>${esc(u.nickname)}</b></p>
          <p class="hint">${esc(u.bio) || "这个人很神秘，没留下简介。"}</p>
          ${topTags.length ? `<div class="row">${topTags.map(([t, n]) => `<span class="px-badge">${esc(t)} ×${n}</span>`).join("")}</div>` : ""}
          <p class="hint join-line">加入于 ${esc(u.created_at)}${days ? ` · 已来 ${days} 天` : ""}</p>
          <div class="hint me-home-meta"><span>作品 ${stats.artworks || 0} · 获赞 ${stats.likes || 0}</span><a href="#/user/${u.id}" id="me-link" title="点击复制主页链接">#/user/${u.id}</a></div>
          ${petRunHtml(pet)}
        </div>
      </div>
      ${showMaster ? `
      <h2 class="px-title px-title--sub">代表作</h2>
      <div class="px-card master-card">
        <a href="#/art/${showMaster.id}"><img src="${showMaster.png_url}" alt="${esc(showMaster.title)}" loading="lazy"></a>
        <div class="stack">
          <span><span class="px-badge" style="background:var(--gold)">热度最高的作品</span></span>
          <b><a href="#/art/${showMaster.id}" style="color:inherit;text-decoration:none">${esc(showMaster.title)}</a></b>
          <span class="hint">浏览 ${showMaster.views} · 点赞 ${showMaster.likes_count} · 评论 ${showMaster.comments_count}</span>
        </div>
      </div>` : ""}
      <h2 class="px-title px-title--sub">作品墙</h2>
      ${rest?.length ? `<div class="art-grid me-wall">${rest.map(artCard).join("")}</div>` : `
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
  if (avatarPick) {
    const failAvatar = (msg) => {
      const err = document.querySelector("#me-err");
      if (err) err.textContent = msg;
    };
    const pickAvatar = async (img) => {
      if (!img || img.dataset.busy) return;
      img.dataset.busy = "1";
      const r = await api("POST", "/api/me/avatar", JSON.stringify({ artwork_id: Number(img.dataset.avatar) }));
      if (r.status === 200) rerender();
      else {
        failAvatar("换头像失败，重试一下");
        delete img.dataset.busy;
      }
    };
    avatarPick.onclick = (e) => {
      const t = e.target.closest("[data-avatar]");
      if (t) pickAvatar(t);
    };
    avatarPick.onkeydown = (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target.closest("[data-avatar]");
      if (!t) return;
      e.preventDefault();
      pickAvatar(t);
    };
  }

  const avatarClear = document.querySelector("#avatar-clear");
  if (avatarClear)
    avatarClear.onclick = async () => {
      const r = await api("DELETE", "/api/me/avatar");
      if (r.status === 200) rerender();
    };

  const meLogout = document.querySelector("#me-logout");
  if (meLogout)
    meLogout.onclick = async () => {
      await logout();
      location.hash = "#/";
      rerender();
    };

  const petToggle = document.querySelector("#pet-toggle");
  if (petToggle)
    petToggle.onclick = () => {
      const pick = document.querySelector("#pet-pick");
      if (pick) pick.hidden = !pick.hidden;
    };
  const savePet = async (id, flip) => {
    const r = await api("PUT", "/api/me/pet", JSON.stringify({ artwork_id: id, flip }));
    const err = document.querySelector("#me-err");
    if (r.status === 200) rerender();
    else if (err) err.textContent = "小宠物没放出来，重试一下";
  };
  const currentFlip = () => document.querySelector("#pet-run")?.dataset.baseFlip === "1";
  const petPick = document.querySelector("#pet-pick");
  if (petPick)
    petPick.onclick = (e) => {
      const t = e.target.closest("[data-pet]");
      if (t) savePet(Number(t.dataset.pet), currentFlip());
    };
  const petFlip = document.querySelector("#pet-flip");
  if (petFlip)
    petFlip.onclick = () => {
      const current = document.querySelector(".avatar-pick-item.active[data-pet]");
      if (!current) return;
      const nextFlip = togglePetFlip(document.querySelector("#pet-run"));
      savePet(Number(current.dataset.pet), nextFlip);
    };
  const petClear = document.querySelector("#pet-clear");
  if (petClear) petClear.onclick = () => savePet(0, false);

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
