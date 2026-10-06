import "./style.css";
import "./editor/editor.css";
import "./pages/guide.css";
import { api, getMe, logout, track } from "./api.js";
import { mountEditor } from "./editor/editor.js";
import { composite, deserialize } from "./editor/doc.js";
import { coverOf } from "./editor/paint.js";
import { initCustomScroll } from "./scroll.js";
import { initPixelSelects } from "./pixel-select.js";
import { initPixelTips } from "./tooltip.js";
import { uiAlert } from "./dialog.js";
import { loadGallery, mountHomeEdge, pageHome, wireGalleryInfinite, wireGalleryTabs, wireHomeEgg } from "./pages/home.js";
import { pageAuth, wireAuthForm } from "./pages/auth.js";
import { pageMe, pageUser, wireMePage } from "./pages/me.js";
import { loadDrafts, loadPublished, wireDrafts } from "./pages/drafts.js";
import { wireDraftPreview } from "./pages/preview.js";
import { mountArt } from "./pages/art.js";
import { mountAdmin } from "./pages/admin.js";
import { mountNotices, startBellPoll, updateBell } from "./pages/notices.js";
import { pageGuide, wireGuide } from "./pages/guide.js";

const app = document.querySelector("#app");

function nav(user) {
  return `
    <nav class="topnav">
      <a href="#/" class="logo px-title">OuO像素画社区</a>
      <span class="topnav-right">
        <a href="#/guide" class="px-btn">指南</a>
        <a href="#/draw" class="px-btn px-btn--mint">画画</a>
        ${
          user
            ? `<a href="#/me" class="px-btn">${user.nickname}</a>
               <a href="#/drafts" class="px-btn">草稿箱</a>
               <a href="#/notices" class="px-btn" id="nav-bell">通知</a>
               <button class="px-btn" id="nav-logout">退出</button>`
            : `<a href="#/login" class="px-btn">登录</a>
               <a href="#/register" class="px-btn px-btn--cherry">注册</a>`
        }
      </span>
    </nav>`;
}

async function render() {
  // 切页时清理悬浮预览，避免从首页按 Z 进作品页后滞留
  for (const id of ["draft-preview", "draft-hint", "gal-preview"]) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
  // 首页右下角回顶/回底按钮只在社区主页存在，切页即删
  document.querySelector("#home-edge")?.remove();
  if (window.__pxPrev) {
    window.__pxPrev.el = null;
    window.__pxPrev.z = false;
  }
  // 每日访问埋点（T70 次日留存的分母）
  try {
    const today = new Date().toDateString();
    if (localStorage.getItem("px_visit") !== today) {
      localStorage.setItem("px_visit", today);
      track("visit");
    }
  } catch {
    /* ignore */
  }
  const { status, data } = await getMe().catch(() => ({ status: 0 }));
  const user = status === 200 ? data.user : null;
  const hash = location.hash || "#/";

  if (hash.startsWith("#/login") && user) {
    location.hash = "#/";
    return;
  }
  if (hash.startsWith("#/register") && user) {
    location.hash = "#/";
    return;
  }
  if (hash.startsWith("#/me") && !user) {
    location.hash = "#/login";
    return;
  }

  if (hash.startsWith("#/login")) app.innerHTML = nav(user) + pageAuth("login");
  else if (hash.startsWith("#/register"))
    app.innerHTML = nav(user) + pageAuth("register");
  else if (hash.startsWith("#/me")) {
    const [wr, mr] = await Promise.all([
      api("GET", `/api/users/${data.user.id}/works`),
      api("GET", "/api/me/works"),
    ]);
    app.innerHTML =
      nav(user) +
      pageMe(
        user,
        data.stats,
        wr.status === 200 ? wr.data.items : [],
        mr.status === 200 ? mr.data.items : []
      );
  } else if (hash.startsWith("#/draw")) {
    // 绘画软件式三栏全幅（去掉网页左右内边距）
    app.innerHTML = nav(user) + `<div class="draw-page"><div id="draw-root"></div></div>`;
    wireNav();
    (async () => {
      let cloud = null;
      let initial = null;
      let autoShowNew = false;
      const openId = sessionStorage.getItem("pixel.open");
      sessionStorage.removeItem("pixel.open");
      if (openId && user) {
        const r = await api("GET", `/api/drafts/${openId}`);
        if (r.status === 200) {
          try {
            initial = deserialize(r.data.draft.layers_json);
            cloud = { id: r.data.draft.id, title: r.data.draft.title };
          } catch {
            /* 坏数据就按空白画布处理 */
          }
        }
        if (cloud) {
          try { localStorage.setItem("pixel.lastOpen", String(cloud.id)); } catch { /* ignore */ }
        }
      } else if (user) {
        // 先回到上次打开的草稿（草稿箱“继续画”后刷新不再跳回最近更新那张）
        let openedOk = false;
        let lastOpen = null;
        try { lastOpen = localStorage.getItem("pixel.lastOpen"); } catch { /* ignore */ }
        if (lastOpen) {
          try {
            const r0 = await api("GET", `/api/drafts/${lastOpen}`);
            if (r0.status === 200) {
              initial = deserialize(r0.data.draft.layers_json);
              cloud = { id: r0.data.draft.id, title: r0.data.draft.title };
              openedOk = true;
            } else {
              try { localStorage.removeItem("pixel.lastOpen"); } catch { /* ignore */ }
            }
          } catch {
            /* 读失败就按最近更新兜底 */
          }
        }
        if (!openedOk) {
        // 自动载入上一次的作品（最近更新的草稿）
        try {
          const lr = await api("GET", "/api/drafts");
          if (lr.status === 200 && lr.data.drafts?.length) {
            const last = lr.data.drafts[0];
            const r2 = await api("GET", `/api/drafts/${last.id}`);
            if (r2.status === 200) {
              try {
                initial = deserialize(r2.data.draft.layers_json);
                cloud = { id: r2.data.draft.id, title: r2.data.draft.title };
              } catch {
                /* 坏数据就按空白处理，下方会弹新建 */
              }
            }
          } else {
            autoShowNew = true;
          }
        } catch {
          /* 网络失败就按空白处理 */
        }
        } // (!openedOk)：已有上次打开的草稿就不再按最近更新覆盖
        if (cloud) {
          try { localStorage.setItem("pixel.lastOpen", String(cloud.id)); } catch { /* ignore */ }
        }
        if (!cloud && !initial) autoShowNew = true;
      }
      const ed = mountEditor(document.querySelector("#draw-root"), { cloud, user, initial, autoShowNew });
      window.__px = ed; // e2e 钩子
    })();
    return;
  } else if (hash.startsWith("#/drafts")) {
    if (!user) {
      location.hash = "#/login";
      return;
    }
    app.innerHTML = nav(user) + `<main class="wrap"><div class="row" style="align-items:center"><button class="px-btn px-btn--sm" id="drafts-back">← 返回</button><h1 class="px-title" style="margin:0">草稿箱</h1></div><h2 class="px-title px-title--sub">已发布作品</h2><div id="pub-list" class="stack"><p class="hint">读取中…</p></div><div class="row" style="justify-content:space-between;align-items:center;margin:22px 0 12px"><h2 class="px-title px-title--sub" style="margin:0">我的草稿</h2><button class="px-btn px-btn--sm" id="draft-import">源导入</button></div><div id="draft-list" class="stack"><p class="hint">读取中…</p></div></main>`;
    wireNav();
    wireDrafts();
    wireDraftPreview();
    document.querySelector("#drafts-back").onclick = () => {
      if (window.history.length > 1) window.history.back();
      else location.hash = "#/draw";
    };
    document.querySelector("#draft-import").onclick = () => {
      const ip = document.createElement("input");
      ip.type = "file";
      ip.accept = "application/json,.json";
      ip.onchange = async () => {
        const f = ip.files?.[0];
        if (!f) return;
        try {
          const txt = await f.text();
          const j = JSON.parse(txt);
          const docStr = typeof j === "string" ? j : JSON.stringify(j);
          deserialize(docStr);
          const doc = deserialize(docStr);
          const c = coverOf(composite(doc), doc.w, doc.h);
          const title = (f.name.replace(/\.json$/i, "") || "导入草稿").slice(0, 40);
          const rr = await api("POST", "/api/drafts", JSON.stringify({ title, doc: docStr, cover: JSON.stringify({ w: c.w, h: c.h, data: c.data }) }));
          if (rr.status === 201) loadDrafts();
          else uiAlert("导入失败，文件可能不是像素画源文件");
        } catch {
          uiAlert("导入失败，文件可能不是像素画源文件");
        }
      };
      ip.click();
    };
    loadDrafts();
    loadPublished();
    return;
  } else if (hash.startsWith("#/art/")) {
    const id = hash.split("/")[2];
    app.innerHTML = nav(user) + `<main class="wrap"><div id="art-root"><p class="hint">读取中…</p></div></main>`;
    wireNav();
    mountArt(id, user);
    return;
  } else if (hash.startsWith("#/user/")) {
    const uid = Number(hash.split("/")[2]);
    if (!uid) {
      app.innerHTML = nav(user) + `<main class="wrap"><div class="px-card">用户不存在。</div></main>`;
      wireNav();
      return;
    }
    if (user && uid === user.id) {
      location.hash = "#/me";
      return;
    }
    app.innerHTML = nav(user) + `<main class="wrap"><div id="user-root"><p class="hint">读取中…</p></div></main>`;
    wireNav();
    (async () => {
      const root = document.querySelector("#user-root");
      const [ur, wr] = await Promise.all([
        api("GET", `/api/users/${uid}`),
        api("GET", `/api/users/${uid}/works`),
      ]);
      if (ur.status !== 200 || !ur.data) {
        root.innerHTML = `<div class="px-card">用户不存在或已注销。</div>`;
        return;
      }
      // 去掉外层 <main> 避免双层边距，与 /me 保持一致
      const html = pageUser(ur.data.user, ur.data.stats, wr.status === 200 ? wr.data.items : []);
      root.innerHTML = html.replace(/^\s*<main[^>]*>/, "").replace(/<\/main>\s*$/, "");
    })();
    return;
  } else if (hash.startsWith("#/admin")) {
    if (!user) {
      location.hash = "#/login";
      return;
    }
    app.innerHTML = nav(user) + `<main class="wrap"><h1 class="px-title">审核后台</h1><div id="admin-root" class="stack"><p class="hint">读取中…</p></div></main>`;
    wireNav();
    mountAdmin();
    return;
  } else if (hash.startsWith("#/notices")) {
    if (!user) {
      location.hash = "#/login";
      return;
    }
    app.innerHTML = nav(user) + `<main class="wrap"><h1 class="px-title">消息通知</h1><div id="notices-root" class="stack"><p class="hint">读取中…</p></div></main>`;
    wireNav();
    mountNotices();
    return;
  } else if (hash.startsWith("#/guide")) {
    const gid = hash.split("/")[2] || "info";
    app.innerHTML = nav(user) + pageGuide(gid);
    wireNav();
    wireGuide();
    return;
  } else if (hash === "#/" || hash === "" || hash === "#") {
    app.innerHTML = nav(user) + pageHome(user);
  } else {
    // 未知路由：怀旧风 404（T74）
    app.innerHTML = nav(user) + `
      <main class="wrap narrow">
        <div class="px-card stack" style="text-align:center;padding:48px 20px">
          <h1 class="px-title" style="font-size:64px;margin:0">404</h1>
          <p>这页走丢了，像没保存就关掉的草稿。</p>
          <div class="row" style="justify-content:center">
            <a href="#/" class="px-btn px-btn--cherry">回首页看看画</a>
            <a href="#/draw" class="px-btn">去画一张</a>
          </div>
        </div>
      </main>`;
  }

  wireNav();
  wireGalleryTabs();
  wireGalleryInfinite();
  loadGallery(false);
  wireDraftPreview();
  if (hash === "#/" || hash === "" || hash === "#") mountHomeEdge();
  if (document.querySelector("[data-home-egg]")) wireHomeEgg();

  function wireNav() {
  const logoutBtn = document.querySelector("#nav-logout");
  if (logoutBtn)
    logoutBtn.onclick = async () => {
      await logout();
      location.hash = "#/";
      render();
    };
  updateBell();
  startBellPoll();
}

  wireAuthForm(hash);

  wireMePage(render);

}

window.addEventListener("hashchange", render);
initCustomScroll();
initPixelSelects();
initPixelTips();
render();
