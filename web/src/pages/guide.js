// 社区指南：站点信息 / 站点特色 / 使用说明（三页翻页，内容与 OuO像素画社区·Beta版.md 对齐）
import { api } from "../api.js";
import { esc } from "./shared.js";
export const GUIDE_TABS = [
  { id: "info", label: "站点信息", lead: "OuO像素画社区之入站指南。" },
  { id: "features", label: "站点特色", lead: "本站对比其他同类网站有哪些特色。" },
  { id: "manual", label: "使用说明", lead: "有详细的悬停提示框在真是帮大忙了。" },
];

export function normGuide(id) {
  return GUIDE_TABS.some((t) => t.id === id) ? id : "info";
}

// 键帽 / 组合键 / 高亮
const k = (t) => `<kbd class="px-kbd">${t}</kbd>`;
const combo = (...ts) => `<span class="key-combo">${ts.map(k).join("<span class=\"key-plus\">+</span>")}</span>`;
const mark = (t) => `<mark class="px-mark">${t}</mark>`;

function pageInfo() {
  return `
    <div class="px-card guide-block fact-hero">
      <p class="fact-kicker">网页像素画编辑器 + 作品社区</p>
      <p class="fact-big">有趣的作品，${mark("万里挑一")}</p>
      <p class="hint" style="margin:0">哇塞，你居然看到了这里。文案写什么好呢…</p>
    </div>
    <div class="fact-grid">
      <div class="px-card fact">
        <p class="fact-label">作者</p>
        <p class="fact-text"><span class="au au-ee">纸片君ee</span>、可爱的<span class="au au-muse">muse娘</span>和<span class="au au-ds">deepseek娘</span></p>
      </div>
      <div class="px-card fact fact--mail">
        <p class="fact-label">联系</p>
        <p class="fact-text"><a class="chip" href="mailto:paperee57@gmail.com">paperee57@gmail.com</a> <a class="chip" href="mailto:admin@paperee.guru">admin@paperee.guru</a></p>
      </div>
    </div>
    <div class="px-card guide-block">
      <p class="fact-label">技术栈</p>
      <p class="fact-text">前端原生 Canvas，后端 Node.js + Express，数据库暂定 SQLite，缩略图缓存本地，字体为自托管的 Fusion Pixel。</p>
      <div class="tag-row"><span>Canvas</span><span>Node</span><span>SQLite</span><span>Fusion Pixel</span></div>
    </div>`;
}

function pageFeatures() {
  const items = [
    ["版本管理", "每个作品都可以使用 1 个自动存档和 15 个手动存档。若提示手动存档不够，你可以选择另存作品为副本，使用新的空存档，也可以选择删除掉最旧的存档，再把进度保存到最后面的手动存档。", "hero"],
    ["Z 快捷键", `你可以在很多地方悬停鼠标后，长按键盘上的 Z 键（在手机等无法使用鼠标的设备上则是长按）。用途包括但不限于：对着小图使用，显示清晰的大图；对着作品使用，显示颜色与图层。`, "hero"],
    ["悬停提示框", "鼠标悬停在大多数按钮上时，会出现一个跟手的提示框。尤其在绘画页中十分方便。提示框会告诉你工具的用途和键盘快捷键。"],
    ["站内生态", "还没有关注作者的功能，但你可以给作者的作品点赞或评论，让作者知道有人喜欢 ta 的作品 OuO。共同维护一个和谐有爱的社区~"],
    ["颜色与图层", "你可以在作品页中，看到画作中的主要颜色与图层拆分（不包含原始配色、图层透明度与叠加模式）。仅供学习和参考噢~"],
  ];
  const hero = items.filter((x) => x[2] === "hero");
  const rest = items.filter((x) => x[2] !== "hero");
  return `
    <div class="feat-hero-row">
      ${hero.map(([t, d], i) => `<div class="px-card feat-hero feat-hero--${i}"><p class="feat-no">0${i + 1}</p><b>${t}</b><span>${d}</span></div>`).join("")}
    </div>
    <div class="feat-grid">
      ${rest.map(([t, d], i) => `<div class="px-card feat"><p class="feat-no">${String(i + 3).padStart(2, "0")}</p><b>${t}</b><span>${d}</span></div>`).join("")}
    </div>`;
}

function pageManual() {
  return `
    <div class="px-card guide-block">
      <h2 class="px-title px-title--sub"><span class="sec-num">01</span>画画页</h2>
      <p class="hint">目前只放出了部分绘画工具的说明，持续更新中。</p>
      <h3 class="px-title guide-h3">快捷键</h3>
      <div class="key-groups">
        <section class="key-group">
          <h4><span class="key-where">左侧</span>工具组</h4>
          <ul class="key-list">
            <li>${k("B")} <b>铅笔</b><span class="key-tip">可调整笔头形状和笔头大小</span></li>
            <li>${k("E")} <b>橡皮</b><span class="key-tip">可调整笔头形状和笔头大小</span></li>
            <li>${k("G")} <b>油漆桶</b><span class="key-tip">可调整油漆桶容差（上色条件）</span></li>
            <li>${k("I")} <b>取色</b><span class="key-tip">在画布上右键像素也可以取色</span></li>
          </ul>
        </section>
        <section class="key-group">
          <h4><span class="key-where">左侧</span>选区组</h4>
          <ul class="key-list">
            <li>${k("V")} <b>选区</b><span class="key-tip">善用选区的复制、剪切到新图层的功能</span></li>
            <li>${k("Enter")} <b>落定选区</b><span class="key-tip">无对应按钮，有选区时生效</span></li>
            <li>${k("Delete")} <span class="key-plus">/</span> ${k("Backspace")} <b>删选选区</b><span class="key-tip">删除选区内的像素</span></li>
            <li>${k("Esc")} <b>取消选区</b><span class="key-tip">无对应按钮，有选区时生效</span></li>
          </ul>
        </section>
        <section class="key-group">
          <h4><span class="key-where">左侧</span>形状组</h4>
          <ul class="key-list">
            <li>${k("L")} <b>直线</b> ${k("R")} <b>矩形</b> ${k("O")} <b>椭圆</b><span class="key-tip">绘制对应的形状</span></li>
            <li>${k("F")} <b>空心/实心</b><span class="key-tip">形状中间空的还是实的</span></li>
          </ul>
        </section>
        <section class="key-group">
          <h4><span class="key-where">左侧</span>笔刷组</h4>
          <ul class="key-list">
            <li>${k("C")} <b>方头/圆头</b><span class="key-tip">铅笔和橡皮的笔头形状</span></li>
            <li>${combo("[", "]")} <b>笔刷大小</b><span class="key-tip">铅笔和橡皮的笔刷大小</span></li>
          </ul>
        </section>
        <section class="key-group">
          <h4><span class="key-where">左侧</span>编辑组</h4>
          <ul class="key-list">
            <li>${combo("Ctrl", "Z")} <b>撤销</b><span class="key-tip">返回上一步</span></li>
            <li>${combo("Ctrl", "Y")} <b>重做</b><span class="key-tip">撤销返回上一步（套娃了）</span></li>
          </ul>
        </section>
        <section class="key-group">
          <h4><span class="key-where">底部</span>通用状态栏</h4>
          <ul class="key-list">
            <li>${combo("Ctrl", "S")} <b>保存</b><span class="key-tip">保存草稿到手动存档</span></li>
            <li>${k("+")} <b>放大</b> ${k("-")} <b>缩小</b> <span class="key-tip">从中心点缩放画布</span></li>
            <li>${k("Z")} <b>按住看大图</b><span class="key-tip">社区作品、草稿箱、图层小图通用</span></li>
            <li>${k("空格")} <b>按住平移</b><span class="key-tip">按住进抓手模式＋左键拖画布</span></li>
          </ul>
        </section>
      </div>
    </div>`;
}

export function pageGuide(id) {
  const cur = normGuide(id);
  const i = GUIDE_TABS.findIndex((t) => t.id === cur);
  const prev = GUIDE_TABS[(i + GUIDE_TABS.length - 1) % GUIDE_TABS.length];
  const next = GUIDE_TABS[(i + 1) % GUIDE_TABS.length];
  const body = cur === "features" ? pageFeatures() : cur === "manual" ? pageManual() : pageInfo();
  return `
    <main class="wrap guide">
      <h1 class="px-title guide-title">社区指南</h1>
      <p class="guide-lead">${GUIDE_TABS[i].lead}</p>
      <div id="board-root" class="px-card guide-block guide-board"><p class="hint">公告读取中…</p></div>
      <div class="row tabs guide-tabs" role="tablist">
        ${GUIDE_TABS.map((t) => `<a href="#/guide/${t.id}" role="tab" aria-selected="${t.id === cur}" class="tool-btn${t.id === cur ? " active" : ""}">${t.label}</a>`).join("")}
      </div>
      ${body}
      <div class="guide-pager">
        <a href="#/guide/${prev.id}" class="px-btn px-btn--sm" data-guide-prev>← ${prev.label}</a>
        <span class="hint">${i + 1} / ${GUIDE_TABS.length}</span>
        <a href="#/guide/${next.id}" class="px-btn px-btn--sm" data-guide-next>${next.label} →</a>
      </div>
    </main>`;
}

export function wireGuide() {
  // 翻页即路由切换，无需 JS 状态；仅补一个左右键翻页
  if (window.__pxGuideKey) return;
  window.__pxGuideKey = (e) => {
    if (!location.hash.startsWith("#/guide")) return;
    if (e.target.matches("input, textarea, select")) return;
    const cur = normGuide(location.hash.split("/")[2]);
    const i = GUIDE_TABS.findIndex((t) => t.id === cur);
    if (e.key === "ArrowRight") location.hash = `#/guide/${GUIDE_TABS[(i + 1) % GUIDE_TABS.length].id}`;
    if (e.key === "ArrowLeft") location.hash = `#/guide/${GUIDE_TABS[(i + GUIDE_TABS.length - 1) % GUIDE_TABS.length].id}`;
  };
  window.addEventListener("keydown", window.__pxGuideKey);
}

// 公告板：所有人可见，管理员可编辑保存（每进指南页刷一次）
export async function mountBoard(user) {
  const root = document.querySelector("#board-root");
  if (!root) return;
  const r = await api("GET", "/api/board");
  const content = r.status === 200 ? r.data.board?.content || "" : "";
  const updated = r.status === 200 ? r.data.board?.updated_at : null;
  const render = (editing) => {
    if (!editing) {
      root.classList.remove("guide-board--editing");
      root.innerHTML = `
        <div class="guide-board__header">
          <div class="guide-board__identity">
            <span class="guide-board__icon" aria-hidden="true">!</span>
            <div>
              <p class="guide-board__eyebrow">COMMUNITY NOTICE</p>
              <p class="fact-label">公告板</p>
            </div>
          </div>
          ${updated ? `<span class="guide-board__updated hint">更新于 ${esc(updated.slice(0, 16))}</span>` : `<span class="guide-board__updated hint">社区公告</span>`}
        </div>
        <div class="guide-board__body">
          ${content ? `<p class="guide-board__message">${esc(content)}</p>` : `<p class="guide-board__empty hint">暂无公告。</p>`}
        </div>
        ${user?.is_admin ? `<div class="row guide-board__actions"><button class="px-btn px-btn--sm px-btn--grape" id="board-edit">编辑公告</button></div>` : ""}`;
      root.querySelector("#board-edit")?.addEventListener("click", () => render(true));
    } else {
      root.classList.add("guide-board--editing");
      root.innerHTML = `
        <div class="guide-board__header">
          <div class="guide-board__identity">
            <span class="guide-board__icon" aria-hidden="true">✎</span>
            <div>
              <p class="guide-board__eyebrow">EDIT NOTICE</p>
              <p class="fact-label">编辑公告</p>
            </div>
          </div>
          <span class="guide-board__updated hint">最多 2000 字</span>
        </div>
        <textarea class="px-input guide-board__textarea" id="board-text" rows="6" maxlength="2000" placeholder="写点公告…">${esc(content)}</textarea>
        <div class="row guide-board__actions">
          <button class="px-btn px-btn--sm px-btn--grape" id="board-save">保存公告</button>
          <button class="px-btn px-btn--sm" id="board-cancel">取消</button>
        </div>`;
      root.querySelector("#board-cancel").addEventListener("click", () => render(false));
      root.querySelector("#board-save").addEventListener("click", async () => {
        const text = root.querySelector("#board-text").value;
        const sr = await api("PUT", "/api/board", JSON.stringify({ content: text }));
        if (sr.status === 200) mountBoard(user);
      });
    }
  };
  render(false);
}
