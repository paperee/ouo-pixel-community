// 作品详情页：下载/点赞/评论/图层拆分
import { api } from "../api.js";
import { b64ToU8 } from "../editor/doc.js";
import { uiConfirm } from "../dialog.js";
import { esc } from "./shared.js";
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
  root.innerHTML = `
    <div class="row" style="margin-bottom:12px"><button class="px-btn px-btn--sm" id="art-back">← 返回</button></div>
    <div class="art-detail px-card">
      <div class="art-left">
        <img class="art-big" id="art-img" src="${a.png_url}" alt="${esc(a.title)}">
        <div id="art-layers" class="layer-strip" style="margin-top:12px"></div>
      </div>
      <div class="stack">
        <h1 class="px-title" style="margin:0">${esc(a.title)}</h1>
        <div class="row">
          <span class="px-badge">${esc(a.license)}</span>
          <span class="px-badge">${a.width}×${a.height}</span>
          <span class="px-badge">${a.layers_count || 1} 层</span>
        </div>
        <div class="row">
          ${a.status === "pending" && r.data.mine ? `<span class="px-badge" style="background:var(--sky);color:#fff">待审核</span>` : ""}
          ${a.status === "featured" ? `<span class="px-badge" style="background:var(--sky);color:#fff">精选</span>` : ""}
        </div>
        <p>${esc(a.description) || '<span class="hint">作者很懒，没写简介。</span>'}</p>
        <div class="row">${tags.map((t) => `<span class="px-badge">${esc(t)}</span>`).join("")}</div>
        <p class="hint" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><a href="#/user/${a.author_id}" class="author-link author-link--soft" title="查看作者主页">作者 ${esc(a.author_name)} →</a> <span>· 浏览 ${a.views} · 点赞 <span id="m-likes">${a.likes_count}</span> · 评论 <span id="m-comments">${a.comments_count}</span></span></p>
        ${palette.length ? `<div class="row">${palette.map((c) => `<span class="swatch" style="background:${c}" title="${c}"></span>`).join("")}</div>` : ""}
        <div class="row">
          <select id="dl-scale" class="px-btn" style="height:40px;padding:0 14px"><option value="1">1x</option><option value="2" selected>2x</option><option value="4">4x</option><option value="8">8x</option></select>
          <button class="px-btn px-btn--mint" id="dl-btn" style="padding:0 14px">下载PNG</button>
          ${user ? `<button class="px-btn ${r.data.liked ? "px-btn--cherry" : ""}" id="like-btn">点赞（<span id="like-n">${a.likes_count}</span>）</button>` : ""}
        </div>
        <h2 class="px-title px-title--sub">评论（<span id="c-n">${a.comments_count}</span>）</h2>
        <div class="stack" id="comments"><p class="hint">读取中…</p></div>
        ${user ? `
        <form id="c-form" class="stack">
          <textarea class="px-input" id="c-text" rows="2" maxlength="500" placeholder="说点好听的…"></textarea>
          <div class="row">
            <button class="px-btn px-btn--sky" type="submit">发表</button>
            <span class="hint" id="c-reply-hint" hidden></span>
          </div>
        </form>` : `<p class="hint"><a href="#/login">登录</a>后点赞评论。</p>`}
      </div>
    </div>`;
  document.querySelector("#art-back").onclick = () => {
    if (window.history.length > 1) window.history.back();
    else location.hash = "#/";
  };
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
      }
    };

  // 评论：列表 / 发表 / 回复 / 删除（XSS 靠 esc 转义，存原文）
  let replyTo = null;
  let replyNick = "";
  const byId = new Map();
  async function loadComments() {
    const box = document.querySelector("#comments");
    const cr = await api("GET", `/api/artworks/${a.id}/comments`);
    if (cr.status !== 200 || !cr.data) {
      box.innerHTML = `<p class="hint">读不出来，刷新试试。</p>`;
      return;
    }
    const items = cr.data.items;
    byId.clear();
    items.forEach((c) => byId.set(c.id, c));
    document.querySelector("#c-n").textContent = items.length;
    document.querySelector("#m-comments").textContent = items.length;
    if (!items.length) {
      box.innerHTML = `<div class="px-card">沙发还空着，快来坐坐。</div>`;
      return;
    }
    box.innerHTML = items
      .map((c) => {
        const p = c.parent_id ? byId.get(c.parent_id) : null;
        const canDel = user && (c.user_id === user.id || r.data.mine);
        return `
        <div class="px-card comment" data-cid="${c.id}">
          <b>${esc(c.nickname)}</b> <span class="hint">${esc(c.created_at)}</span>
          <p>${p ? `<span class="hint">回复 ${esc(p.nickname)}：</span>` : ""}${esc(c.content)}</p>
          <div class="row">
            ${user ? `<button class="px-btn px-btn--sm" data-reply>回复</button>` : ""}
            ${canDel ? `<button class="px-btn px-btn--sm" data-cdel>删除</button>` : ""}
          </div>
        </div>`;
      })
      .join("");
  }
  await loadComments();
  document.querySelector("#comments").onclick = async (e) => {
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
    } else if (e.target.closest("[data-cdel]")) {
      if (!(await uiConfirm("删除这条评论？", "删除"))) return;
      const dr = await api("DELETE", `/api/comments/${cid}`);
      if (dr.status === 200) {
        if (replyTo === cid) {
          replyTo = null;
          document.querySelector("#c-reply-hint").hidden = true;
        }
        loadComments();
      }
    }
  };
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
        text.value = "";
        replyTo = null;
        document.querySelector("#c-reply-hint").hidden = true;
        loadComments();
      }
    };
}
