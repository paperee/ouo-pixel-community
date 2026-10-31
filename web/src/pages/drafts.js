// 草稿箱：列表/版本/发布/回滚/行内操作
import { api, track } from "../api.js";
import { composite, deserialize, u8ToB64 } from "../editor/doc.js";
import { uiAlert, uiChoice, uiConfirm, uiPrompt } from "../dialog.js";
import { ART_TAGS, PERM_OPTIONS, esc, flagsOf } from "./shared.js";
import { canvasToB64, extractPalette } from "./image.js";
import { DRAFTS_PER_PAGE, getDraftPage } from "./draft-pagination.js";
import { getPagerKeyboardPage } from "./pagination-keyboard.js";

let currentDraftPage = 1;
let latestDraftLoad = 0;

function draftPreviewUrl(draft) {
  try {
    const doc = deserialize(draft?.layers_json || "");
    if (doc.w !== draft.canvas_w || doc.h !== draft.canvas_h) return "";
    return canonicalPng(composite(doc), doc.w, doc.h);
  } catch {
    return "";
  }
}

function canonicalPng(pixels, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}
document.addEventListener("keydown", (e) => {
  if (!window.location.hash.startsWith("#/drafts")) return;
  const pager = document.querySelector("#draft-list .draft-pager");
  const nextPage = getPagerKeyboardPage(e, currentDraftPage, Number(pager?.dataset.pages), {
    enabled: !!pager,
    dialogOpen: !!document.querySelector("[data-dlg]:not([hidden])"),
  });
  if (nextPage === null) return;
  e.preventDefault();
  currentDraftPage = nextPage;
  loadDrafts();
});

export async function loadDrafts() {
  const box = document.querySelector("#draft-list");
  if (!box) return;
  const loadId = ++latestDraftLoad;
  const r = await api("GET", "/api/drafts");
  if (loadId !== latestDraftLoad || !box.isConnected) return;
  if (r.status !== 200 || !r.data) {
    box.innerHTML = `<div class="px-card">读不出来，刷新试试。</div>`;
    return;
  }
  const drafts = r.data.drafts || [];
  if (!drafts.length) {
    currentDraftPage = 1;
    box.innerHTML = `<div class="px-card empty-wall">空空如也，去画第一张吧<a href="#/draw" class="px-btn px-btn--cherry">开始作画</a></div>`;
    return;
  }
  const { items, page, pages, total } = getDraftPage(drafts, currentDraftPage);
  currentDraftPage = page;
  box.innerHTML = items
    .map(
      (d) => {
        // 发布按钮状态即提示：已发布→可点跳去作品；有改动→红色"重新发布"；未发布→默认
        const pubbed = !!d.published_artwork_id;
        const sameVer = pubbed && d.published_version === d.version;
        const pubBtn = sameVer
          ? `<a href="#/art/${d.published_artwork_id}" class="px-btn px-btn--sm px-btn--mint" style="text-decoration:none">已发布</a>`
          : pubbed
            ? `<button class="px-btn px-btn--sm px-btn--cherry" data-pub title="草稿有改动，可以再发布一次">重新发布</button>`
            : `<button class="px-btn px-btn--sm" data-pub>发布</button>`;
        return `
    <div class="px-card draft-row" data-id="${d.id}" data-pub-id="${d.published_artwork_id || ''}">
      <img class="draft-thumb" src="${draftPreviewUrl(d)}" alt="${esc(d.title)}">
      <div class="draft-meta draft-meta--right">
        <b>${esc(d.title)}</b>
        <p class="hint">${d.canvas_w}×${d.canvas_h} · v${d.version} · ${esc(d.updated_at)}</p>
        <div class="ver-list stack" data-vers hidden></div>
      </div>
      <div class="row" style="flex-basis:100%">
        <button class="px-btn px-btn--sm" data-open>继续画</button>
        ${pubBtn}
        <button class="px-btn px-btn--sm" data-vers-btn>版本列表</button>
        <div class="ops-wrap">
          <button class="px-btn px-btn--sm" data-ops>操作 ▾</button>
          <div class="ops-menu" hidden>
            <button class="ops-item" data-dup>创建副本</button>
            <button class="ops-item" data-dump>源导出</button>
            <button class="ops-item" data-rename>重命名</button>
            <button class="ops-item ops-item--danger" data-del>删除</button>
          </div>
        </div>
      </div>
      <div class="stack" data-pub-form hidden style="flex-basis:100%">
        <label class="fld"><span>标题</span><input class="px-input" data-p-title maxlength="40" value="${esc(d.title)}"></label>
        <label class="fld"><span>简介（500字内）</span><textarea class="px-input" data-p-desc maxlength="500" rows="2"></textarea></label>
        <p class="draft-sub">分类（可多选）</p>
        <div class="row">${ART_TAGS.map((t) => `<label class="tool-lab"><input type="checkbox" data-p-tag value="${t}"> ${t}</label>`).join("")}</div>
        <div class="row"><span class="hint"><b>版权（勾选即允许）</b></span>${PERM_OPTIONS.map((p) => `<label class="tool-lab" title="${p.hint}"><input type="checkbox" data-p-perm="${p.key}"> ${p.label}</label>`).join("")}</div>
        <div class="row">
          <button class="px-btn px-btn--sm px-btn--cherry" data-pub-go>发布</button>
          <button class="px-btn px-btn--sm" data-pub-cancel>取消</button>
          <span class="hint" data-pub-msg></span>
        </div>
      </div>
    </div>`;
      }
    )
    .join("");
  box.insertAdjacentHTML(
    "beforeend",
    `<div class="row draft-pager" data-page="${page}" data-pages="${pages}" style="justify-content:space-between;align-items:center" aria-label="草稿翻页（可用左右方向键）">
      <span class="hint" aria-live="polite">共 ${total} 份草稿 · 每页 ${DRAFTS_PER_PAGE} 个 · 第 ${page} / ${pages} 页 · ←/→ 翻页</span>
      <div class="row" style="justify-content:flex-end">
        <button class="px-btn px-btn--sm" data-draft-page="${page - 1}" aria-label="上一页"${page === 1 ? " disabled" : ""}>上一页</button>
        <button class="px-btn px-btn--sm" data-draft-page="${page + 1}" aria-label="下一页"${page === pages ? " disabled" : ""}>下一页</button>
      </div>
    </div>`
  );
}
export const PUB_STATUS = { pending: "待审核", normal: "展示中", featured: "精选" };

export async function loadPublished() {
  const box = document.querySelector("#pub-list");
  if (!box) return;
  const r = await api("GET", "/api/me/works");
  if (r.status !== 200 || !r.data) {
    box.innerHTML = `<div class="px-card">读不出来，刷新试试。</div>`;
    return;
  }
  const published = r.data.items.filter((work) => work.status !== "removed");
    const items = published.map((work) => ({ ...work, kind: "artwork" }));
  if (!items.length) {
    box.innerHTML = `<div class="px-card empty-wall">还没有发布过作品，挑一份草稿发一张吧</div>`;
    return;
  }
  box.innerHTML = items
    .map((w) => {
      let tagList = [];
      try {
        tagList = JSON.parse(w.tags || "[]");
      } catch {
        tagList = [];
      }
      const { dl, rm } = flagsOf(w);
      return `
    <div class="px-card draft-row" data-pid="${w.id}">
      <img class="draft-thumb" src="${w.png_url}" alt="${esc(w.title)}">
      <div class="draft-meta">
        <b>${esc(w.title)}</b>
        <p class="hint">${PUB_STATUS[w.status] || w.status} · 浏览 ${w.views} · 点赞 ${w.likes_count} · 评论 ${w.comments_count}</p>
      </div>
      <div class="row">
        <a class="px-btn px-btn--sm" href="#/art/${w.id}">去看看</a>
        <button class="px-btn px-btn--sm" data-edit-pub>修改信息</button>
        <button class="px-btn px-btn--sm" data-unpub>取消发布</button>
      </div>
      <div class="stack" data-edit-form hidden style="flex-basis:100%">
        <label class="fld"><span>标题</span><input class="px-input" data-f-title maxlength="40" value="${esc(w.title)}"></label>
        <label class="fld"><span>简介（500字内）</span><textarea class="px-input" data-f-desc maxlength="500" rows="2">${esc(w.description || "")}</textarea></label>
        <p class="draft-sub">分类（可多选）</p>
        <div class="row">${ART_TAGS.map((t) => `<label class="tool-lab"><input type="checkbox" data-f-tag value="${t}"${tagList.includes(t) ? " checked" : ""}> ${t}</label>`).join("")}</div>
        <div class="row"><span class="hint"><b>版权（勾选即允许）</b></span><label class="tool-lab"><input type="checkbox" data-f-perm="allow_download"${dl ? " checked" : ""}> 可以下载</label><label class="tool-lab"><input type="checkbox" data-f-perm="allow_remix"${rm ? " checked" : ""}> 可以续画</label></div>
        <div class="row">
          <button class="px-btn px-btn--sm px-btn--cherry" data-save-edit>保存</button>
          <button class="px-btn px-btn--sm" data-cancel-edit>取消</button>
          <span class="hint" data-edit-msg></span>
        </div>
      </div>
    </div>`;
    })
    .join("");
  box.onclick = async (e) => {
    const card = e.target.closest("[data-pid]");
    if (!card) return;
    const pid = card.dataset.pid;
    const form = card.querySelector("[data-edit-form]");
    if (e.target.closest("[data-edit-pub]")) {
      form.hidden = !form.hidden;
      return;
    }
    if (e.target.closest("[data-cancel-edit]")) {
      form.hidden = true;
      return;
    }
    if (e.target.closest("[data-save-edit]")) {
      const msg = card.querySelector("[data-edit-msg]");
      const title = card.querySelector("[data-f-title]").value.trim();
      if (!title) {
        msg.textContent = "起个标题吧";
        return;
      }
      const perm = (k) => card.querySelector(`[data-f-perm="${k}"]`)?.checked ? 1 : 0;
      const rr = await api(
        "PATCH",
        `/api/artworks/${pid}`,
        JSON.stringify({
          title,
          description: card.querySelector("[data-f-desc]").value,
          tags: [...card.querySelectorAll("[data-f-tag]:checked")].map((x) => x.value),
          allow_download: perm("allow_download"),
          allow_remix: perm("allow_remix"),
        })
      );
      if (rr.status === 200) loadPublished();
      else msg.textContent = "保存失败，重试一下";
      return;
    }
    const b = e.target.closest("[data-unpub]");
    if (!b) return;
    if (!(await uiConfirm("取消发布这件作品？画廊将不再展示。", "取消发布"))) return;
    const ur = await api("POST", `/api/artworks/${pid}/unpublish`);
    if (ur.status === 200) {
      loadPublished();
      loadDrafts(); // 映射已删，草稿行的发布按钮要同步回“发布”，不能留旧状态
    }
  };
}

// 草稿行内发布（替代原 #/publish 独立表单页）：渲染当前画布并发布
export async function publishRow(row, draftId) {
  const msg = row.querySelector("[data-pub-msg]");
  const title = row.querySelector("[data-p-title]").value.trim();
  if (!title) {
    msg.textContent = "起个标题吧";
    return;
  }
  msg.textContent = "渲染并发布中…";
  try {
    const full = await api("GET", `/api/drafts/${draftId}`);
    if (full.status !== 200 || !full.data) {
      msg.textContent = "草稿不存在";
      return;
    }
    let doc;
    try {
      doc = deserialize(full.data.draft.layers_json);
    } catch {
      msg.textContent = "草稿数据损坏";
      return;
    }
    const merged = composite(doc);
    const cv = document.createElement("canvas");
    cv.width = doc.w;
    cv.height = doc.h;
    cv.getContext("2d").putImageData(new ImageData(merged, doc.w, doc.h), 0, 0);
    const s = 1;
    const th = document.createElement("canvas");
    th.width = Math.max(1, Math.round(doc.w * s));
    th.height = Math.max(1, Math.round(doc.h * s));
    const tctx = th.getContext("2d");
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(cv, 0, 0, th.width, th.height);
    const [png, thumb] = [await canvasToB64(cv), await canvasToB64(th)];
    const perm = (k) => {
      const c = row.querySelector(`[data-p-perm="${k}"]`);
      return c ? (c.checked ? 1 : 0) : 1; // 发布表单已无版权勾选，缺省双开（与服务端一致）
    };
    const pr = await api(
      "POST",
      "/api/artworks",
      JSON.stringify({
        draft_id: Number(draftId),
        title,
        description: row.querySelector("[data-p-desc]").value,
        tags: [...row.querySelectorAll("[data-p-tag]:checked")].map((x) => x.value),
        allow_download: perm("allow_download"),
        allow_remix: perm("allow_remix"),
        palette: extractPalette(merged),
        png,
        thumb,
      })
    );
    if (pr.status === 201) {
      track("publish"); // T70 发布转化
      msg.innerHTML = `发布成功，<a href="#/art/${pr.data.artwork.id}">去看看</a>`;
      loadPublished();
      setTimeout(loadDrafts, 2500); // 留两秒看成功链接，再刷新按钮状态
      if (pr.data.artwork.status === "pending") setTimeout(() => uiAlert("含敏感词，已进待审，暂时只有你自己可见。"), 300);
    } else if (pr.status === 409) {
      msg.textContent = "这版已经发布过了，改动草稿后可再发一次";
      loadDrafts();
    } else {
      msg.textContent = "发布失败，重试一下";
    }
  } catch {
    msg.textContent = "渲染失败，换个浏览器试试";
  }
}

// 备份位门禁（草稿箱）：同个草稿最多 16 个历史备份，满了先问用户腾地方
export async function ensureDraftSlot(draftId) {
  let vs = [];
  try {
    const r = await api("GET", `/api/drafts/${draftId}/versions`);
    if (r.status !== 200) return true;
    vs = (r.data.versions || []).filter((v) => v.kind !== "auto");
  } catch {
    return true;
  }
  if (vs.length < 15) return true;
  const pick = await uiChoice({
    title: "手动存档已满（15 个）",
    msg: "这个作品的手动备份位用完了（自动保存不受影响）。请先腾个地方（不推荐直接取消）。",
    choices: [
      { value: "copy", label: "新建作品副本", primary: true },
      { value: "clean", label: "清理最老存档" },
      { value: "cancel", label: "取消保存" },
    ],
  });
  if (pick === "copy") {
    const dr = await api("POST", `/api/drafts/${draftId}/duplicate`);
    if (dr.status !== 201) {
      uiAlert("建副本失败，稍后重试");
      return false;
    }
  } else if (pick !== "clean") {
    return false;
  }
  const oldest = vs[vs.length - 1];
  const del = await api("DELETE", `/api/drafts/${draftId}/versions/${oldest.id}`);
  if (del.status !== 200) {
    uiAlert("清理失败，重试一下");
    return false;
  }
  return true;
}

export function wireDrafts() {
  const box = document.querySelector("#draft-list");
  box.onclick = async (e) => {
    const pageButton = e.target.closest("[data-draft-page]");
    if (pageButton && !pageButton.disabled) {
      currentDraftPage = Number(pageButton.dataset.draftPage);
      await loadDrafts();
      return;
    }
    const row = e.target.closest("[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest("[data-open]")) {
      sessionStorage.setItem("pixel.open", id);
      location.hash = "#/draw";
    } else if (e.target.closest("[data-pub-cancel]")) {
      row.querySelector("[data-pub-form]").hidden = true;
    } else if (e.target.closest("[data-pub-go]")) {
      await publishRow(row, id);
    } else if (e.target.closest("[data-pub]")) {
      const form = row.querySelector("[data-pub-form]");
      form.hidden = !form.hidden;
      // 重新发布：默认填上次发布的信息，标题缀“ 新版”（每行只回填一次，不覆盖用户手改）
      if (!form.hidden && row.dataset.pubId && !form.dataset.prefilled) {
        form.dataset.prefilled = "1";
        api("GET", `/api/artworks/${row.dataset.pubId}`).then((rr) => {
          if (rr.status !== 200 || !rr.data?.artwork || !form.isConnected) return;
          const a = rr.data.artwork;
          const t = row.querySelector("[data-p-title]");
          if (t) t.value = `${a.title || ""} 新版`.slice(0, 40);
          const desc = row.querySelector("[data-p-desc]");
          if (desc && !desc.value) desc.value = a.description || "";
          let tags = [];
          try { tags = JSON.parse(a.tags || "[]"); } catch { tags = []; }
          row.querySelectorAll("[data-p-tag]").forEach((c) => { c.checked = tags.includes(c.value); });
        });
      }
    } else if (e.target.closest("[data-dup]")) {
      row.querySelector(".ops-menu").hidden = true;
      if (!(await uiConfirm("创建这份草稿的副本？", "创建副本"))) return;
      const r = await api("POST", `/api/drafts/${id}/duplicate`);
      if (r.status === 201) loadDrafts();
    } else if (e.target.closest("[data-rename]")) {
      row.querySelector(".ops-menu").hidden = true;
      const name = await uiPrompt("新标题", row.querySelector("b").textContent);
      if (name?.trim()) {
        const r = await api("PUT", `/api/drafts/${id}`, JSON.stringify({ title: name.trim() }));
        if (r.status === 200) loadDrafts();
      }
    } else if (e.target.closest("[data-del]")) {
      row.querySelector(".ops-menu").hidden = true;
      if (await uiConfirm("删除这份草稿？不可撤销。", "删除")) {
        const r = await api("DELETE", `/api/drafts/${id}`);
        if (r.status === 200) loadDrafts();
      }
    } else if (e.target.closest("[data-vers-btn]")) {
      const box2 = row.querySelector("[data-vers]");
      if (!box2.hidden) {
        box2.hidden = true;
        return;
      }
      const r = await api("GET", `/api/drafts/${id}/versions`);
      if (r.status === 200) {
        box2.hidden = false;
        const vs = r.data.versions;
        if (!vs.length) {
          box2.innerHTML = `<p class="hint">暂无历史版本（改动并保存后会产生）</p>`;
        } else {
          const manuals = vs.filter((v) => v.kind !== "auto");
          const auto = vs.find((v) => v.kind === "auto");
          const opt = (v, label) => `<option value="${v.id}">${label} · ${esc(String(v.created_at || "").slice(0, 16))}</option>`;
          box2.innerHTML = `<div class="row"><select data-vers-sel>` +
            (auto ? opt(auto, "自动保存") : "") +
            manuals.map((v, i) => opt(v, `存档 ${manuals.length - i}`)).join("") +
            `</select><button class="px-btn px-btn--sm" data-rb-go>回滚到选中版本</button></div>`;
          window.__pxVersMap = new Map(vs.map((v) => [String(v.id), v]));
        }
      }
    } else if (e.target.closest("[data-dump]")) {
      row.querySelector(".ops-menu").hidden = true;
      try {
        const rr = await api("GET", `/api/drafts/${id}`);
        if (rr.status !== 200) return;
        const dump = rr.data.draft.layers_json;
        const blob = new Blob([typeof dump === "string" ? dump : JSON.stringify(dump)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const ael = document.createElement("a");
        ael.href = url;
        ael.download = `${row.querySelector("b")?.textContent?.trim() || "pixel"}.json`;
        ael.click();
        setTimeout(() => URL.revokeObjectURL(url), 800);
      } catch { void 0; }
    } else if (e.target.closest("[data-ops]")) {
      const menu = row.querySelector(".ops-menu");
      if (!menu) return;
      const willShow = menu.hidden;
      // close other menus
      document.querySelectorAll(".ops-menu").forEach((m) => { if (m !== menu) m.hidden = true; });
      menu.hidden = !willShow;
      // close on next outside click
      if (willShow) {
        const onDoc = (ev) => {
          if (!row.contains(ev.target)) { menu.hidden = true; document.removeEventListener("click", onDoc); }
        };
        setTimeout(() => document.addEventListener("click", onDoc), 0);
      }
    } else if (e.target.closest("[data-rb-go]")) {
      const sel = row.querySelector("[data-vers-sel]");
      if (!sel?.value) return;
      if (!(await ensureDraftSlot(id))) return;
      if (!(await uiConfirm("当前内容在回滚前会先存为一个版本，可再滚回来。", "回滚"))) return;
      const rr = await api("POST", `/api/drafts/${id}/rollback/${sel.value}`);
      if (rr.status !== 200) return;
      // 回滚只换了 layers，后端封面还是旧的：前端按回滚后全文重算封面并存回（纯封面更新不涨版本）
      try {
        const full = await api("GET", `/api/drafts/${id}`);
        const doc = deserialize(full.data?.draft?.layers_json || "");
        const pixels = composite(doc);
                await api("PUT", `/api/drafts/${id}`, JSON.stringify({ cover: JSON.stringify({ w: doc.w, h: doc.h, data: u8ToB64(pixels) }) }));
      } catch {
        /* 封面刷新失败不挡列表刷新 */
      }
      loadDrafts();
    }
  };
}
