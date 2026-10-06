// 后端 API 封装（同源 Cookie 会话）
export async function api(method, path, body, contentType = "application/json") {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": contentType } : {},
    body,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, data };
}

export const getMe = () => api("GET", "/api/me");
export const register = (email, password, nickname) =>
  api("POST", "/api/register", JSON.stringify({ email, password, nickname }));
export const login = (email, password) =>
  api("POST", "/api/login", JSON.stringify({ email, password }));
export const logout = () => api("POST", "/api/logout");

// 埋点（T70）：失败静默，绝不影响主流程
export function track(event) {
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

// T11：登录后把游客草稿搬上云（P4 落地），成功才清本机（含封面，否则缩略图空白）
export async function migrateGuestDraft() {
  const raw = localStorage.getItem("pixel.guest");
  if (!raw) return false;
  try {
    const { deserialize, composite } = await import("./editor/doc.js");
    const { coverOf } = await import("./editor/paint.js");
    let cover = "";
    try {
      const doc = deserialize(raw);
      const cov = coverOf(composite(doc), doc.w, doc.h);
      cover = JSON.stringify({ w: cov.w, h: cov.h, data: cov.data });
    } catch {
      /* 封面失败不挡迁移 */
    }
    const r = await api("POST", "/api/drafts", JSON.stringify({ title: "游客草稿", doc: raw, cover }));
    if (r.status === 201) {
      localStorage.removeItem("pixel.guest");
      return true;
    }
  } catch {
    /* 网络问题就留着，下次登录再迁 */
  }
  return false;
}
