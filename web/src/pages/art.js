// 作品详情页：下载/点赞/评论/图层拆分
import { api } from "../api.js";
import { b64ToU8 } from "../editor/doc.js";
import { uiAlert, uiConfirm } from "../dialog.js";
import { esc, flagsOf, nIcon, permBadges } from "./shared.js";
import { wireDraftPreview } from "./preview.js";

export async function mountArt(id, user) {
  const r = await api("GET", `/api/artworks/${id}`);
  const root = document.querySelector("#art-root");
  if (r.status !== 200 || !r.data) {
    root.innerHTML = `<div class="px-card">这件作品不存在或已下架。</div>`;
    return;
  }
  const a = r.data.artwork;
  const tags = JSON.parse(a.tags || "[]");
  const palette = JSON.parse(a.palette_json || "[]");
  const { dl: canDl, rm: canRemix } = flagsOf(a);
  const mine = !!r.data.mine;
  const showDl = canDl || mine;
  const showRemix = canRemix || mine;
        // <div class="row">
        //   ${a.status === "pending" && mine ? `<span class="px-badge" style="background:var(--sky);color:#fff">待审核</span>` : ""}
        //   ${a.status === "featured" ? `<span class="px-badge" style="background:var(--sky);color:#fff">精选</span>` : ""}
        // </div>
  root.innerHTML = `
    <div class="row" style="margin-bottom:12px;justify-content:space-between;align-items:center"><button class="px-btn px-btn--sm" id="art-back">← 返回</button><span class="row" style="gap:8px"><button class="px-btn px-btn--sm" id="art-prev" disabled>← 上一张</button><button class="px-btn px-btn--sm" id="art-next" disabled>下一张 →</button></span></div>
    <div class="art-detail px-card">
      <div class="art-left">
        <img class="art-big" id="art-img" src="${a.png_url}" alt="${esc(a.title)}">
        <div id="art-layers" class="layer-strip"></div>
      </div>
      <div class="stack">
        <h1 class="px-title ellipsis-1" style="margin:0" title="${esc(a.title)}">${esc(a.title)}</h1>
        <div class="row">
          ${permBadges(a).map((b) => `<span class="px-badge">${esc(b)}</span>`).join("")}
          <span class="px-badge">${a.width}×${a.height}</span>
          <span class="px-badge">${a.layers_count || 1} 层</span>
        </div>
        ${a.fork_from_id ? `<p class="hint" style="margin:0">该作品从 <a href="#/art/${a.fork_from_id}">#${a.fork_from_id} 原作</a> 开始继续创作</p>` : ""}
        <p>${esc(a.description) || '<span class="hint">作者很懒，没写简介。</span>'}</p>
        <div class="row">${tags.map((t) => `<span class="px-badge">${esc(t)}</span>`).join("")}</div>
        <p class="hint art-author-line"><a href="#/user/${a.author_id}" class="author-link author-link--soft" title="查看作者主页">作者 ${esc(a.author_name)} →</a> · 浏览 ${a.views} · 点赞 <span id="m-likes">${a.likes_count}</span> · 评论 <span id="m-comments">${a.comments_count}</span></p>
        <p class="hint">发布于 ${esc(String(a.created_at || "").slice(0, 16))}</p>
        ${palette.length ? `<div class="art-palette" aria-label="主要配色">${palette.map((c) => `<span class="swatch" style="background:${c}" title="${c}"></span>`).join("")}</div>` : ""}
        <div class="row">
          ${showDl ? `
          <select id="dl-scale" class="px-btn" style="height:40px;padding:0 14px"><option value="1">1x</option><option value="2" selected>2x</option><option value="4">4x</option><option value="8">8x</option></select>
          <button class="px-btn px-btn--mint" id="dl-btn" style="padding:0 14px">下载PNG${!canDl && mine ? "（仅自己）" : ""}</button>
          ` : `<span class="hint">作者未开放下载（仅作者可见原图）</span>`}
          ${user ? `<button class="px-btn ${r.data.liked ? "px-btn--cherry" : ""}" id="like-btn" title="点赞">${nIcon("thumb")}<span id="like-n">${a.likes_count}</span></button>` : ""}
        </div>
        <div class="row">
          ${showRemix && user ? `<button class="px-btn px-btn--sky" id="remix-btn">二次创作（${!canRemix && mine ? "仅自己" : "继续画"}）</button>` : ""}
          ${showRemix && !user ? `<a class="px-btn px-btn--sky" href="#/login" style="text-decoration:none">二次创作（登录后从模板开始画）</a>` : ""}
          ${!showRemix ? `<span class="hint">作者未开放续画</span>` : ""}
          ${user?.is_admin ? `<button class="px-btn px-btn--cherry" id="admin-unpub">取消发布</button>` : ""}
        </div>
        <h2 class="px-title px-title--sub">评论（<span id="c-n">${a.comments_count}</span>）</h2>
        <div class="stack" id="comments"><p class="hint">读取中…</p></div>
        <div class="row comment-pager" id="comment-pager" hidden aria-label="评论翻页"></div>
        ${user ? `
        <form id="c-form" class="stack">
          <textarea class="px-input" id="c-text" rows="2" maxlength="500" placeholder="说点好听的…"></textarea>
          <div class="row">
            <button class="px-btn px-btn--sky" type="submit">发表</button>
            <span class="hint" id="c-reply-hint" hidden></span>
          </div>
        </form>` : `<p class="hint"><a href="#/login">登录</a> 后可以点赞和评论。</p>`}
      </div>
    </div>`;
  document.querySelector("#art-back").onclick = () => {
    if (window.history.length > 1) window.history.back();
    else location.hash = "#/";
  };
  // 上一张/下一张：按发布时间（画廊最新序）快速切换，←/→ 键同效（输入框里不触发）
  window.__pxArtNav = { prev: null, next: null };
  (async () => {
    try {
      const nr = await api("GET", `/api/artworks/${a.id}/neighbors`);
      if (nr.status !== 200 || !nr.data) return;
      const { prev, next } = nr.data;
      window.__pxArtNav = { prev: prev?.id || null, next: next?.id || null };
      const pb = document.querySelector("#art-prev");
      const nb = document.querySelector("#art-next");
      if (prev && pb && pb.isConnected) {
        pb.disabled = false;
        pb.title = `上一张：${prev.title}`;
        pb.onclick = () => { location.hash = `#/art/${prev.id}`; };
      }
      if (next && nb && nb.isConnected) {
        nb.disabled = false;
        nb.title = `下一张：${next.title}`;
        nb.onclick = () => { location.hash = `#/art/${next.id}`; };
      }
    } catch {
      /* 没有相邻就留空禁用 */
    }
  })();
  if (!window.__pxArtNavKeys) {
    window.__pxArtNavKeys = true;
    document.addEventListener("keydown", (e) => {
      const t = document.activeElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey) return;
      const n = window.__pxArtNav;
      if (!n || !document.querySelector("#art-root")) return;
      if (e.key === "ArrowLeft" && n.prev) location.hash = `#/art/${n.prev}`;
      else if (e.key === "ArrowRight" && n.next) location.hash = `#/art/${n.next}`;
    });
  }
  // 下载倍率（1x/2x/4x/8x，像素无损放大）
  const dlBtn = document.querySelector("#dl-btn");
  const dlSel = document.querySelector("#dl-scale");
  if (dlBtn && dlSel) {
    dlBtn.onclick = async () => {
      const scale = Math.max(1, Math.min(8, Number(dlSel.value) || 1));
      const img = document.querySelector("#art-img");
      if (!img) return;
      const src = a.png_url;
      const title = (a.title || "pixel").replace(/[\\/:*?"<>|]/g, "_");
      try {
        const im = new Image();
        im.crossOrigin = "anonymous";
        await new Promise((res, rej) => {
          im.onload = res;
          im.onerror = rej;
          im.src = src;
        });
        const c = document.createElement("canvas");
        c.width = im.naturalWidth * scale;
        c.height = im.naturalHeight * scale;
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(im, 0, 0, c.width, c.height);
        const blob = await new Promise((res) => c.toBlob(res, "image/png"));
        if (!blob) throw new Error();
        const url = URL.createObjectURL(blob);
        const at = document.createElement("a");
        at.href = url;
        at.download = `${title}_${scale}x.png`;
        at.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch {
        window.open(src, "_blank");
      }
    };
  }
  // 二次创作：以该作品为模板新建草稿并跳去接着画
  const remixBtn = document.querySelector("#remix-btn");
  if (remixBtn) {
    const remixLabel = remixBtn.textContent;
    remixBtn.onclick = async () => {
      remixBtn.disabled = true;
      remixBtn.textContent = "正在准备画布…";
      try {
        const rr = await api("POST", `/api/artworks/${a.id}/remix`);
        if (rr.status === 201 && rr.data?.draft?.id) {
          sessionStorage.setItem("pixel.open", String(rr.data.draft.id));
          location.hash = "#/draw";
        } else if (rr.status === 403) {
          uiAlert("作者未开放续画，看看别的作品吧。");
          remixBtn.disabled = false;
          remixBtn.textContent = remixLabel;
        } else if (rr.status === 401) {
          location.hash = "#/login";
        } else {
          uiAlert("准备画布失败，重试一下。");
          remixBtn.disabled = false;
          remixBtn.textContent = remixLabel;
        }
      } catch {
        uiAlert("网络开小差了，重试一下。");
        remixBtn.disabled = false;
        remixBtn.textContent = remixLabel;
      }
    };
  }
  // 管理员取消发布：确认后下架并回画廊
  const adminUnpub = document.querySelector("#admin-unpub");
  if (adminUnpub) {
    adminUnpub.onclick = async () => {
      if (!(await uiConfirm("取消发布这件作品？画廊将不再展示。", "取消发布"))) return;
      const ur = await api("PATCH", `/api/admin/${a.id}`, JSON.stringify({ status: "removed" }));
      if (ur.status === 200) location.hash = "#/";
      else if (ur.status === 403) uiAlert("你不是管理员。");
      else uiAlert("下架失败，重试一下。");
    };
  }
  // 拆分图层小图（无额外文件存储，复用 artworks.layers_json）
  try {
    const raw = a.layers_json;
    const doc2 = raw ? JSON.parse(raw) : null;
    const layers = doc2?.layers || (Array.isArray(doc2) ? doc2 : []);
    const strip = document.querySelector("#art-layers");
    if (strip && Array.isArray(layers) && layers.length >= 1) {
      strip.innerHTML = layers
        .map(
          (l, i) =>
            `<div class="layer-thumb"><canvas class="draft-thumb" data-layer-cv="${i}" width="${a.width}" height="${a.height}"></canvas><span class="hint">${esc(l.name || `图层 ${i + 1}`)}</span></div>`
        )
        .join("");
      layers.forEach((l, i) => {
        const cv = strip.querySelector(`[data-layer-cv="${i}"]`);
        if (!cv) return;
        try {
          const d = b64ToU8(l.data || "");
          cv.width = a.width;
          cv.height = a.height;
          cv.getContext("2d").putImageData(new ImageData(d, a.width, a.height), 0, 0);
        } catch {
          /* 单层坏数据就留空 */
        }
      });
    }
  } catch {
    /* 无图层数据就跳过 */
  }
  wireDraftPreview();

  // 点赞切换
  let liked = !!r.data.liked;
  const likeBtn = document.querySelector("#like-btn");
  if (likeBtn)
    likeBtn.onclick = async () => {
      const rr = await api(liked ? "DELETE" : "POST", `/api/artworks/${a.id}/like`);
      if (rr.status === 200 || rr.status === 201) {
        liked = rr.data.liked;
        document.querySelector("#like-n").textContent = rr.data.likes_count;
        document.querySelector("#m-likes").textContent = rr.data.likes_count;
        likeBtn.classList.toggle("px-btn--cherry", liked);
        // 点赞成功弹一下 + 摇一下（连点可重复触发）
        likeBtn.classList.remove("liked-pop");
        if (liked) {
          void likeBtn.offsetWidth;
          likeBtn.classList.add("liked-pop");
        }
      }
    };

  // 评论：列表 / 发表 / 回复 / 删除（XSS 靠 esc 转义，存原文）
  let replyTo = null;
  let replyNick = "";
  const commentPageSize = 4;
  let commentPage = 1;
  let commentPages = 1;
  let commentLoadToken = 0;
  const byId = new Map();
  async function loadComments(page = commentPage) {
    const box = document.querySelector("#comments");
    const loadToken = ++commentLoadToken;
    const cr = await api("GET", `/api/artworks/${a.id}/comments?page=${page}`);
    if (loadToken !== commentLoadToken) return;
    if (cr.status !== 200 || !cr.data) {
      box.innerHTML = `<p class="hint">读不出来，刷新试试。</p>`;
      return;
    }
    commentPage = cr.data.page || 1;
    commentPages = cr.data.pages || 1;
    const items = cr.data.items;
    byId.clear();
    items.forEach((c) => byId.set(c.id, c));
    document.querySelector("#c-n").textContent = cr.data.total ?? items.length;
    document.querySelector("#m-comments").textContent = cr.data.total ?? items.length;
    const pager = document.querySelector("#comment-pager");
    pager.hidden = commentPages <= 1;
    pager.innerHTML = commentPages > 1 ? `
      <button class="px-btn px-btn--sm" type="button" data-comment-page="${commentPage - 1}" ${commentPage <= 1 ? "disabled" : ""}>← 上一页</button>
      <span class="hint">第 ${commentPage} / ${commentPages} 页 · 共 ${cr.data.total} 条</span>
      <button class="px-btn px-btn--sm" type="button" data-comment-page="${commentPage + 1}" ${commentPage >= commentPages ? "disabled" : ""}>下一页 →</button>` : "";
    if (!items.length) {
      box.innerHTML = `<div class="px-card">沙发还空着，快来坐坐。</div>`;
      return;
    }
    box.innerHTML = items
      .map((c) => {
        const p = c.parent_id ? {
          user_id: c.parent_user_id,
          nickname: c.parent_nickname,
        } : null;
        const canDel = user && (c.user_id === user.id || r.data.mine || user.is_admin);
        return `
        <div class="px-card comment" data-cid="${c.id}">
         <div class="row" style="justify-content:space-between;align-items:center">
           <span><b>${c.is_admin ? `<span class="admin-star" title="管理员">★</span>` : ""}<a href="#/user/${c.user_id}" class="author-link author-link--soft" data-uid="${c.user_id}" title="点击进入主页，按住 Z 查看头像">${esc(c.nickname)}</a></b> <span class="hint">${esc(c.created_at)}</span></span>
           </div>
           <p>${p ? `<span class="hint">回复 <a href="#/user/${p.user_id}" class="author-link author-link--soft" data-uid="${p.user_id}" title="点击进入主页，按住 Z 查看头像">${esc(p.nickname)}</a>：</span>` : ""}${esc(c.content)}</p>
          <div class="row">
            ${user ? `<button class="px-btn px-btn--sm" data-reply>回复</button>` : ""}
            ${canDel ? `<button class="px-btn px-btn--sm" data-cdel>删除</button>` : ""}
          </div>
        </div>`;
      })
      .join("");
  }
  await loadComments();
  // 评论区昵称按住 Z 看头像（悬浮框复用 px-card + avatar 类；头像按需拉取，不塞进评论列表）
  const nickSt = (window.__pxNick = window.__pxNick || { el: null, x: 0, y: 0, z: false, cache: new Map() });
  nickSt.el = null;
  nickSt.z = false;
  const nickBox = () => {
    let b = document.querySelector("#nick-preview");
    if (!b) {
      b = document.createElement("div");
      b.id = "nick-preview";
      b.className = "px-card";
      b.hidden = true;
      document.body.appendChild(b);
    }
    return b;
  };
  const placeNick = () => {
    const b = nickBox();
    const w = b.offsetWidth || 160;
    const h = b.offsetHeight || 160;
    let lx = nickSt.x + 16;
    let ly = nickSt.y + 18;
    if (lx + w > window.innerWidth - 8) lx = nickSt.x - w - 12;
    if (ly + h > window.innerHeight - 8) ly = nickSt.y - h - 12;
    b.style.left = `${Math.max(4, lx)}px`;
    b.style.top = `${Math.max(4, ly)}px`;
    b.hidden = false;
  };
  const refreshNick = async () => {
    const b = nickBox();
    const el = nickSt.el?.isConnected ? nickSt.el : null;
    if (!el || !nickSt.z) {
      b.hidden = true;
      return;
    }
    const uid = el.dataset.uid;
    b.innerHTML = `<p class="hint">读取中…</p>`;
    placeNick();
    try {
      if (!nickSt.cache.has(uid)) {
        const r = await api("GET", `/api/users/${uid}`);
        nickSt.cache.set(uid, r.status === 200 ? r.data.user : null);
      }
    } catch {
      nickSt.cache.set(uid, null);
    }
    if (nickSt.el?.dataset?.uid !== uid || !nickSt.z) return;
    const u = nickSt.cache.get(uid);
    b.innerHTML = u?.avatar_url
      ? `<img class="avatar" src="${u.avatar_url}" alt="头像">`
      : `<div class="avatar avatar--empty">画</div>`;
    placeNick();
  };
  const cBox = document.querySelector("#comments");
  const commentPager = document.querySelector("#comment-pager");
  commentPager.onclick = (e) => {
    const button = e.target.closest("[data-comment-page]");
    if (!button || button.disabled) return;
    const page = Number(button.dataset.commentPage);
    if (Number.isInteger(page) && page >= 1 && page <= commentPages) loadComments(page);
  };
  let commentPageRequest = Promise.resolve();
  if (!window.__pxCommentPagerKeys) {
    window.__pxCommentPagerKeys = true;
    document.addEventListener("keydown", async (e) => {
      if (!(e.ctrlKey || e.metaKey) || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const comments = document.querySelector("#comments");
      if (!comments || !document.querySelector("#art-root") || commentPages <= 1) return;
      e.preventDefault();
      await commentPageRequest;
      if (document.querySelector("#comments") !== comments || !document.querySelector("#art-root")) return;
      const targetPage = commentPage + (e.key === "ArrowLeft" ? -1 : 1);
      if (targetPage < 1 || targetPage > commentPages) return;
      commentPageRequest = loadComments(targetPage);
      await commentPageRequest;
    });
  }
  cBox.addEventListener("mouseover", (e) => {
    const a = e.target.closest?.("a[data-uid]");
    if (!a || !cBox.contains(a)) return;
    nickSt.el = a;
    nickSt.x = e.clientX;
    nickSt.y = e.clientY;
    refreshNick();
  });
  cBox.addEventListener("mousemove", (e) => {
    const a = e.target.closest?.("a[data-uid]");
    if (a && cBox.contains(a)) {
      nickSt.el = a;
      nickSt.x = e.clientX;
      nickSt.y = e.clientY;
      if (nickSt.z) refreshNick();
    } else if (nickSt.el) {
      nickSt.el = null;
      refreshNick();
    }
  });
  cBox.addEventListener("mouseout", (e) => {
    if (e.target.closest?.("a[data-uid]")) {
      nickSt.el = null;
      refreshNick();
    }
  });
  // 长按等效按住 Z（触屏）：松手隐藏，长按后松手不进主页
  let nlTimer = null;
  let nlFired = false;
  let nlX = 0;
  let nlY = 0;
  cBox.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const a = e.target.closest?.("a[data-uid]");
    if (!a || !cBox.contains(a)) return;
    const t = e.touches[0];
    nlFired = false;
    nlX = t.clientX;
    nlY = t.clientY;
    if (nlTimer) clearTimeout(nlTimer);
    nlTimer = setTimeout(() => {
      nlTimer = null;
      nlFired = true;
      nickSt.el = a;
      nickSt.x = nlX;
      nickSt.y = nlY;
      nickSt.z = true;
      const tip = document.querySelector(".px-tip");
      if (tip) tip.hidden = true;
      refreshNick();
    }, 500);
  }, { passive: true });
  cBox.addEventListener("touchmove", (e) => {
    if (!nlTimer || !e.touches.length) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - nlX, t.clientY - nlY) > 12) {
      clearTimeout(nlTimer);
      nlTimer = null;
    }
  }, { passive: true });
  cBox.addEventListener("touchend", (e) => {
    if (nlTimer) {
      clearTimeout(nlTimer);
      nlTimer = null;
    }
    if (nlFired) {
      nlFired = false;
      e.preventDefault();
    }
    if (nickSt.z) {
      nickSt.z = false;
      refreshNick();
    }
  }, { passive: false });
  cBox.addEventListener("touchcancel", () => {
    if (nlTimer) {
      clearTimeout(nlTimer);
      nlTimer = null;
    }
    nlFired = false;
    if (nickSt.z) {
      nickSt.z = false;
      refreshNick();
    }
  });
  window.__pxNickRefresh = refreshNick;
  if (!window.__pxNickKeys) {
    window.__pxNickKeys = true;
    const typing = () => {
      const t = document.activeElement;
      return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    document.addEventListener("keydown", (e) => {
      // Z 按下时若正悬停在昵称上（无鼠标移动就没有 mouseover），主动刷一次
      if ((e.key === "z" || e.key === "Z") && !e.repeat && !typing() && window.__pxNick) {
        window.__pxNick.z = true;
        const tip = document.querySelector(".px-tip");
        if (tip) tip.hidden = true;
        window.__pxNickRefresh?.();
      }
    });
    document.addEventListener("keyup", (e) => {
      if ((e.key === "z" || e.key === "Z") && window.__pxNick) {
        window.__pxNick.z = false;
        const b = document.querySelector("#nick-preview");
        if (b) b.hidden = true;
      }
    });
  }
  cBox.addEventListener("click", (e) => {
    const card = e.target.closest("[data-cid]");
    if (!card) return;
    const cid = Number(card.dataset.cid);
    if (e.target.closest("[data-reply]")) {
      replyTo = cid;
      replyNick = byId.get(cid)?.nickname || "";
      const hint = document.querySelector("#c-reply-hint");
      hint.hidden = false;
      hint.innerHTML = `回复 @${esc(replyNick)} <a href="javascript:void 0" id="c-reply-x">取消</a>`;
      document.querySelector("#c-text").focus();
      document.querySelector("#c-reply-x").onclick = () => {
        replyTo = null;
        hint.hidden = true;
      };
    }
  });
  cBox.addEventListener("click", async (e) => {
    const deleteButton = e.target.closest("[data-cdel]");
    if (!deleteButton) return;
    const card = deleteButton.closest("[data-cid]");
    if (!card) return;
    const cid = Number(card.dataset.cid);
    if (!(await uiConfirm("删除这条评论？", "删除"))) return;
    const dr = await api("DELETE", `/api/comments/${cid}`);
    if (dr.status === 200) {
      if (replyTo === cid) {
        replyTo = null;
        document.querySelector("#c-reply-hint").hidden = true;
      }
      const pageCount = Math.max(1, Math.ceil((Number(document.querySelector("#c-n").textContent) - 1) / commentPageSize));
      if (commentPage > pageCount) commentPage = pageCount;
      loadComments(commentPage);
    }
  });
  const cForm = document.querySelector("#c-form");
  if (cForm)
    cForm.onsubmit = async (e) => {
      e.preventDefault();
      const text = document.querySelector("#c-text");
      const body = { content: text.value };
      if (replyTo) {
        body.parent_id = replyTo;
        if (!body.content.trim().startsWith(`@${replyNick}`)) body.content = `@${replyNick} ${body.content}`;
      }
      if (!body.content.trim()) return;
      const cr = await api("POST", `/api/artworks/${a.id}/comments`, JSON.stringify(body));
      if (cr.status === 201) {
        replyTo = null;
        document.querySelector("#c-reply-hint").hidden = true;
        text.value = "";
        const totalAfterPost = Number(document.querySelector("#c-n").textContent) + 1;
        loadComments(Math.ceil(totalAfterPost / commentPageSize));
      }
    };
}
