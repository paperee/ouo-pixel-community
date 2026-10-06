// 消息通知：文案 + 铃铛轮询 + 分组列表
import { api } from "../api.js";
import { uiConfirm } from "../dialog.js";
import { esc, nIcon } from "./shared.js";

export const NOTIF_TEXT = {
  like: "赞了你的作品",
  comment: "评论了你的作品",
  reply: "回复了你的评论",
  mention: "在评论里 @ 了你",
  approved: "你的作品审核通过，已公开展示",
  featured: "你的作品被选为精选",
  removed: "你的作品被下架",
  welcome: "欢迎加入OuO像素画社区",
  system: "系统通知",
};
export const NOTIF_GROUPS = [
  ["all", "全部"],
  ["unread", "未读"],
  ["like", "点赞"],
  ["comment", "评论互动"],
  ["system", "系统通知"],
];
export const NOTIF_GROUP_TYPES = {
  comment: ["comment", "reply", "mention"],
  system: ["approved", "featured", "removed", "welcome", "system"],
};
// 单条通知文案：谁 + 做了什么 + 哪件作品
export function notifLine(n) {
  const who = n.actor_name ? `@${n.actor_name}` : n.type === "welcome" || n.type === "system" ? "站长" : "一位画友";
  const work = n.artwork_title ? `《${n.artwork_title}》` : n.extra ? `《${n.extra}》` : "";
  switch (n.type) {
    case "like":
      return `${who} 赞了你的作品${work}`;
    case "comment":
      return `${who} 评论了你的作品${work}`;
    case "reply":
      return `${who} 回复了你在${work || "评论区"}的留言`;
    case "mention":
      return `${who} 在${work || "评论区"}里 @ 了你`;
    case "approved":
      return `你的作品${work}审核通过，已公开展示`;
    case "featured":
      return `你的作品${work}被选为精选，上首页露脸了`;
    case "removed":
      return `你的作品${work}被下架，看看是否命中了社区规范`;
    case "welcome":
      return n.extra || "欢迎加入OuO像素画社区，去画第一张像素画吧";
    default:
      return n.extra || NOTIF_TEXT[n.type] || n.type;
  }
}

// 站内铃铛：未读数（渲染时刷一次 + 登录态下每 30 秒轮询，开着页面也能收到赞/评论提醒）
export async function updateBell() {
  const b = document.querySelector("#nav-bell");
  if (!b) return;
  try {
    const r = await api("GET", "/api/notifications");
    if (r.status === 200) b.textContent = r.data.unread > 0 ? `通知（${r.data.unread}）` : "通知";
  } catch {
    /* 铃铛失败不影响正事 */
  }
}

export function startBellPoll() {
  try {
    clearInterval(window.__pxBellTimer);
  } catch {
    /* 首次启动无旧计时器 */
  }
  if (!document.querySelector("#nav-bell")) return; // 未登录不轮询
  window.__pxBellTimer = setInterval(() => {
    if (!document.querySelector("#nav-bell")) {
      clearInterval(window.__pxBellTimer);
      return;
    }
    updateBell();
  }, 30000);
}

let notifGroup = "all";

export async function mountNotices() {
  const root = document.querySelector("#notices-root");
  const r = await api("GET", "/api/notifications");
  if (r.status !== 200 || !r.data) {
    root.innerHTML = `<div class="px-card">读不出来，刷新试试。</div>`;
    return;
  }
  const all = r.data.items;
  const unreadN = all.filter((n) => !n.read).length;
  const shown = all.filter((n) => {
    if (notifGroup === "all") return true;
    if (notifGroup === "unread") return !n.read;
    if (notifGroup === "like") return n.type === "like";
    return (NOTIF_GROUP_TYPES[notifGroup] || []).includes(n.type);
  });
  const tabs = NOTIF_GROUPS.map(
    ([k, label]) => `<button class="tool-btn${notifGroup === k ? " active" : ""}" data-ng="${k}">${label}</button>`
  ).join("");
  const list = shown.length
    ? shown
        .map(
          (n) => `
      <div class="px-card notif" data-nid="${n.id}" ${n.read ? "" : 'data-unread'}>
        <div>
          <b>${esc(notifLine(n))}</b>
          <p class="hint">${esc(n.created_at)}${n.read ? "" : " · 未读"}</p>
        </div>
        <div class="row">
          ${n.ref_id ? `<a class="px-btn px-btn--sm" href="#/art/${n.ref_id}">去看看</a>` : ""}
          ${n.read ? "" : `<button class="px-btn px-btn--sm icon-btn" data-nread title="标为已读">${nIcon("check")}</button>`}
          <button class="px-btn px-btn--sm icon-btn" data-ndel title="删除">${nIcon("trash")}</button>
        </div>
      </div>`
        )
        .join("")
    : `<div class="px-card empty-wall">${notifGroup === "all" ? "还没有消息，去发作品等赞吧" : "这个分组暂无消息"}</div>`;
  root.innerHTML =
    `<div class="row notif-bar">
      <div class="row tabs" data-ng-tabs>${tabs}</div>
      <span class="hint">未读 ${unreadN}</span>
    </div>
    <div class="row" style="margin-bottom:12px">
      <button class="px-btn px-btn--sm" id="notices-read">全部标为已读</button>
      <button class="px-btn px-btn--sm" id="notices-clear">一键清空</button>
    </div>` + list;
  root.querySelector("[data-ng-tabs]").onclick = (e) => {
    const b = e.target.closest("[data-ng]");
    if (!b) return;
    notifGroup = b.dataset.ng;
    mountNotices();
  };
  document.querySelector("#notices-read").onclick = async () => {
    await api("PATCH", "/api/notifications/read");
    mountNotices();
    updateBell();
  };
  document.querySelector("#notices-clear").onclick = async () => {
    if (!(await uiConfirm("清空全部通知？不可撤销。", "清空"))) return;
    await api("DELETE", "/api/notifications");
    mountNotices();
    updateBell();
  };
  root.onclick = async (e) => {
    const card = e.target.closest("[data-nid]");
    if (!card) return;
    const nid = card.dataset.nid;
    if (e.target.closest("[data-nread]")) {
      await api("PATCH", `/api/notifications/${nid}/read`);
      mountNotices();
      updateBell();
    } else if (e.target.closest("[data-ndel]")) {
      await api("DELETE", `/api/notifications/${nid}`);
      mountNotices();
      updateBell();
    }
  };
}
