// 页面共享：常量 + esc + 通知图标（无依赖叶节点）
export const ART_TAGS = ["人物", "场景", "物品", "素材", "临摹", "头像","其他"];
export const ART_LICENSES = ["CC-BY-NC", "CC-BY", "CC0", "禁止转载"];

// 社区主页每日小贴士（按日期轮换，轻量无后端）
export const HOME_TIPS = [
  "对小图按住Z可以显示大图，是不是很方便呢？",
  "油漆桶容差越大，越容易把近似色一起填上。",
  "草稿只有真改动才会算新的版本，随手保存不怕。",
  "给你的作品取个好的标题、写个有趣的简介吧。",
  "被选为精选的作品会上首页露脸，多画多发。",
  "头像只能用自己发布的作品，给自己画张头像吧。",
  "源导出可以把画保存为文件，随时备份随时搬家。",
  "图层不够可以向下合并，还有是混合模式很好用。",
];

export const esc = (s) => String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

export const N_ICONS = {
  check: '<path fill="none" stroke="currentColor" stroke-width="2.4" d="M2.5 8.5l3.5 3.5 7-8"/>',
  trash: '<path fill="none" stroke="currentColor" stroke-width="2" d="M2.5 4h11M6 4V2.5h4V4M4.5 4l.7 10h5.6l.7-10M6.8 7v4M9.2 7v4"/>',
};
export const nIcon = (k) => `<svg class="px-ic" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${N_ICONS[k] || ""}</svg>`;
