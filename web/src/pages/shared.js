// 页面共享：常量 + esc + 通知图标（无依赖叶节点）
export const ART_TAGS = ["人物", "场景", "物品", "生物", "临摹", "头像","其他"];
// license 是遗留标签（仅兼容老数据展示），权限真相是 allow_download / allow_remix
export const ART_LICENSES = ["CC-BY-NC", "CC-BY", "CC0", "不可转载"];

// 发布/编辑表单的双勾选：比 CC-* 下拉直观，默认双开
export const PERM_OPTIONS = [
  { key: "allow_download", label: "可以下载", hint: "允许他人选倍率存 PNG" },
  { key: "allow_remix", label: "可以续画", hint: "允许他人以此为模板开始画" },
];

// 老数据可能没有权限列：按 license 兜底（不可转载=双关，其他=双开）
export const flagsOf = (a = {}) => ({
  dl: a.allow_download ?? a.allowDownload ?? (a.license === "不可转载" ? 0 : 1),
  rm: a.allow_remix ?? a.allowRemix ?? (a.license === "不可转载" ? 0 : 1),
});
export const permBadges = (a = {}) => {
  const { dl, rm } = flagsOf(a);
  return [
    dl ? "可下载" : "不可下载",
    rm ? "可续画" : "不可续画",
  ];
};

// 社区主页每日小贴士（按日期轮换，轻量无后端）
export const HOME_TIPS = [
  "在很多时候，对着小图按住 Z 可以显示大图。",
  "油漆桶的容差越大，越容易把近似色一起填上。",
  "草稿有自动存档，但随手保存是一个好习惯哦。",
  "主页的头像和小宠物可以选用自己已发布的作品。",
  "管理员会随机把好作品推上精选，欢迎毛遂自荐。",
  "你可以在允许继续绘画的作品/模板上继续绘画。",
  "图层小科普之，正片叠底→变暗，滤色→加对比度。",
  "2.0版来啦，在指南中新增了公告板，在…还有…？",
];

export const esc = (s) => String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

export const N_ICONS = {
  check: '<path fill="none" stroke="currentColor" stroke-width="2.4" d="M2.5 8.5l3.5 3.5 7-8"/>',
  trash: '<path fill="none" stroke="currentColor" stroke-width="2" d="M2.5 4h11M6 4V2.5h4V4M4.5 4l.7 10h5.6l.7-10M6.8 7v4M9.2 7v4"/>',
  thumb: '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" d="M5.5 7.5V14H3.4c-.5 0-.9-.4-.9-.9V8.3c0-.5.4-.9.9-.9h2.1zm0 0l.8-4c.2-1 .9-1.6 1.8-1.6 1 0 1.7.8 1.6 1.8l-.4 2.3h2.9c.9 0 1.5.8 1.3 1.7l-.9 4.1c-.2.8-.9 1.4-1.7 1.4H5.5"/>',
};
export const nIcon = (k) => `<svg class="px-ic" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${N_ICONS[k] || ""}</svg>`;
