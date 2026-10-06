// 发布作品与画廊。关键约束（T51）：发布只接受本站草稿 id + 前端由画布渲染的 PNG 字节，
// 不存在任何用户文件上传通道。服务端只校验 PNG 魔数/IHDR 尺寸，不做图像解码。
import { Router } from "express";
import { db } from "./db.js";
import { requireLogin } from "./auth.js";

export const artworksRouter = Router();

export const ART_TAGS = ["人物", "场景", "物品", "游戏素材", "临摹", "动画", "其他"];
export const ART_LICENSES = ["CC-BY-NC", "CC-BY", "CC0", "禁止转载"];
// 机审关键词：命中则进待审
const SENSITIVE = ["法轮功", "8964", "天安门事件", "台独", "港独", "藏独", "疆独",
  "色情", "赌博", "毒品", "枪支", "办证", "贷款", "兼职刷单", "习近平", "毛泽东"];

const DETAIL_COLS = `a.id, a.author_id, a.title, a.description, a.tags, a.width, a.height,
  a.frames, a.layers_count, a.palette_json, a.png_url, a.thumb_url, a.license,
  a.likes_count, a.comments_count, a.views, a.status, a.created_at, a.layers_json,
  u.nickname AS author_name, u.avatar_url AS author_avatar`;

function parsePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a)
    return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function hitSensitive(...texts) {
  return texts.some((t) => SENSITIVE.some((k) => String(t || "").includes(k)));
}

// ---- 发布（需登录） ----
artworksRouter.post("/artworks", requireLogin, (req, res) => {
  const { draft_id, title, description, tags, license, png, thumb } = req.body || {};
  const draft = db
    .prepare("SELECT * FROM drafts WHERE id = ? AND user_id = ?")
    .get(Number(draft_id), req.session.userId);
  if (!draft) return res.status(404).json({ error: "no_such_draft" });

  // 同一版草稿只允许发布一次：改动草稿（version 变化）后可再发
  const dup = db
    .prepare(
      `SELECT id FROM artworks
       WHERE draft_id = ? AND draft_version = ? AND author_id = ? AND status != 'removed'`
    )
    .get(draft.id, draft.version, req.session.userId);
  if (dup) return res.status(409).json({ error: "already_published", artwork_id: dup.id });

  const name = String(title || "").trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: "bad_title" });
  const desc = String(description || "").slice(0, 500);
  const tagList = Array.isArray(tags) ? tags.filter((t) => ART_TAGS.includes(t)).slice(0, 5) : [];
  const lic = ART_LICENSES.includes(license) ? license : "CC-BY-NC";

  // PNG 字节：必须是前端由该草稿画布渲染的（魔数 + IHDR 尺寸 + 与草稿一致）
  let pngBuf = null;
  let thumbBuf = null;
  try {
    pngBuf = Buffer.from(String(png || ""), "base64");
    thumbBuf = Buffer.from(String(thumb || ""), "base64");
  } catch {
    return res.status(400).json({ error: "bad_image" });
  }
  if (pngBuf.length > 2 * 1024 * 1024 || thumbBuf.length > 512 * 1024)
    return res.status(400).json({ error: "image_too_large" });
  const meta = parsePng(pngBuf);
  const tmeta = parsePng(thumbBuf);
  if (!meta || !tmeta) return res.status(400).json({ error: "bad_image" });
  if (meta.w !== draft.canvas_w || meta.h !== draft.canvas_h)
    return res.status(400).json({ error: "size_mismatch" });
  if (meta.w > 128 || meta.h > 128 || tmeta.w > 200 || tmeta.h > 200)
    return res.status(400).json({ error: "image_too_large" });

  // 图片以内嵌 data URL 进库，不再落盘（/uploads 接口已移除）；
  // 三重校验（魔数/IHDR/尺寸/上限）保持不变，立项红线不受影响
  const pngUrl = `data:image/png;base64,${String(png || "")}`;
  const thumbUrl = `data:image/png;base64,${String(thumb || "")}`;
  const status = hitSensitive(name, desc) ? "pending" : "normal";
  let layersCount = 1;
  try {
    layersCount = JSON.parse(draft.layers_json).layers.length || 1;
  } catch {
    /* 草稿坏数据就按 1 层 */
  }

  // 调色板：从 PNG 取前 12 色太重，前端随表单提交（palette: ["#rrggbb"]），服务端只做格式校验
  const palette = Array.isArray(req.body.palette)
    ? req.body.palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 12)
    : [];

  const row = db
    .prepare(
      `INSERT INTO artworks (author_id, title, description, tags, width, height, frames,
        layers_count, palette_json, png_url, thumb_url, license, status, draft_id, draft_version, layers_json)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, status`
    )
    .get(
      req.session.userId, name, desc, JSON.stringify(tagList),
      meta.w, meta.h, layersCount, JSON.stringify(palette), pngUrl, thumbUrl, lic, status,
      draft.id, draft.version, draft.layers_json
    );
  res.status(201).json({ artwork: row });
});

// ---- 画廊 ----
artworksRouter.get("/gallery", (req, res) => {
  const tab = ["new", "hot", "featured"].includes(req.query.tab) ? req.query.tab : "new";
  const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12));
  const page = Math.max(1, Number(req.query.page) || 1);
  const off = (page - 1) * limit;
  let order = "a.id DESC";
  let where = "a.status = 'normal'";
  if (tab === "featured") where = "a.status = 'featured'";
  if (tab === "hot")
    order = `(a.likes_count * 3 + a.comments_count * 2) / ((strftime('%s','now') - strftime('%s', a.created_at)) / 3600 + 2) DESC, a.id DESC`;
  const items = db
    .prepare(
      `SELECT a.id, a.title, a.thumb_url, a.width, a.height, a.likes_count, a.comments_count,
        a.views, a.created_at, a.author_id, u.nickname AS author_name
       FROM artworks a JOIN users u ON u.id = a.author_id
       WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`
    )
    .all(limit + 1, off);
  // 防屠榜：热门榜单同一作者最多占 3 席
  let out = items;
  if (tab === "hot") {
    const seen = new Map();
    out = items.filter((x) => {
      const n = (seen.get(x.author_id) || 0) + 1;
      seen.set(x.author_id, n);
      return n <= 3;
    });
  }
  res.json({ items: out.slice(0, limit), has_more: items.length > limit });
});

// ---- 详情（浏览计数按会话去重） ----
artworksRouter.get("/artworks/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare(`SELECT ${DETAIL_COLS} FROM artworks a JOIN users u ON u.id = a.author_id WHERE a.id = ?`)
    .get(id);
  if (!row) return res.status(404).json({ error: "no_such_artwork" });
  const isAuthor = req.session.userId === row.author_id;
  if ((row.status === "pending" || row.status === "removed") && !isAuthor)
    return res.status(404).json({ error: "no_such_artwork" });
  if (row.status === "normal" || row.status === "featured") {
    req.session.viewed = req.session.viewed || [];
    if (!req.session.viewed.includes(id)) {
      req.session.viewed.push(id);
      db.prepare("UPDATE artworks SET views = views + 1 WHERE id = ?").run(id);
      row.views += 1;
    }
  }
  let liked = false;
  if (req.session.userId) {
    liked = !!db
      .prepare("SELECT 1 FROM likes WHERE user_id = ? AND artwork_id = ?")
      .get(req.session.userId, row.id);
  }
  res.json({ artwork: row, mine: isAuthor, liked });
});

// ---- 取消发布（作者下架自己的作品，画廊即不再展示）----
artworksRouter.post("/artworks/:id/unpublish", requireLogin, (req, res) => {
  const a = db.prepare("SELECT author_id, status FROM artworks WHERE id = ?").get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: "no_such_artwork" });
  if (a.author_id !== req.session.userId) return res.status(403).json({ error: "forbidden" });
  if (a.status === "removed") return res.status(409).json({ error: "already_removed" });
  db.prepare("UPDATE artworks SET status = 'removed' WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- 修改信息（作者可改自己作品的标题/简介/标签/版权，与草稿不联动）----
artworksRouter.patch("/artworks/:id", requireLogin, (req, res) => {
  const a = db.prepare("SELECT author_id FROM artworks WHERE id = ?").get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: "no_such_artwork" });
  if (a.author_id !== req.session.userId) return res.status(403).json({ error: "forbidden" });
  const { title, description, tags, license } = req.body || {};
  const patch = {};
  if (title !== undefined) {
    const name = String(title).trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: "bad_title" });
    patch.title = name;
  }
  if (description !== undefined) patch.description = String(description).slice(0, 500);
  if (tags !== undefined) {
    if (!Array.isArray(tags)) return res.status(400).json({ error: "bad_tags" });
    patch.tags = JSON.stringify(tags.filter((t) => ART_TAGS.includes(t)).slice(0, 5));
  }
  if (license !== undefined) {
    if (!ART_LICENSES.includes(license)) return res.status(400).json({ error: "bad_license" });
    patch.license = license;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: "bad_request" });
  const sets = Object.keys(patch)
    .map((k) => `${k} = ?`)
    .join(", ");
  db.prepare(`UPDATE artworks SET ${sets} WHERE id = ?`).run(...Object.values(patch), Number(req.params.id));
  res.json({ ok: true, ...patch });
});

// ---- 某人的公开作品 ----
artworksRouter.get("/users/:uid/works", (req, res) => {
  const items = db
    .prepare(
      `SELECT id, title, thumb_url, likes_count, comments_count, views, created_at
       FROM artworks WHERE author_id = ? AND status IN ('normal', 'featured') ORDER BY id DESC LIMIT 24`
    )
    .all(Number(req.params.uid));
  res.json({ items });
});

// ---- 自己全部作品（含待审/下架） ----
artworksRouter.get("/me/works", requireLogin, (req, res) => {
  const items = db
    .prepare(
      `SELECT id, title, description, tags, license, thumb_url, png_url, status, likes_count, comments_count, views, created_at
       FROM artworks WHERE author_id = ? ORDER BY id DESC`
    )
    .all(req.session.userId);
  res.json({ items });
});

// ---- 审核（T55）：邮箱白名单管理员（懒加载，方便自测时注入）
function isAdmin(email) {
  const list = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(email || "").toLowerCase());
}
function requireAdmin(req, res, next) {
  const me = db.prepare("SELECT email FROM users WHERE id = ?").get(req.session.userId);
  if (!me || !isAdmin(me.email))
    return res.status(403).json({ error: "forbidden" });
  next();
}

artworksRouter.get("/admin/pending", requireLogin, requireAdmin, (req, res) => {
  const items = db
    .prepare(
      `SELECT a.id, a.title, a.description, a.thumb_url, a.created_at, u.nickname AS author_name
       FROM artworks a JOIN users u ON u.id = a.author_id
       WHERE a.status = 'pending' ORDER BY a.id DESC`
    )
    .all();
  res.json({ items });
});

artworksRouter.patch("/admin/:id", requireLogin, requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!["normal", "featured", "removed"].includes(status))
    return res.status(400).json({ error: "bad_status" });
  const before = db.prepare("SELECT author_id, status, title FROM artworks WHERE id = ?").get(Number(req.params.id));
  if (!before) return res.status(404).json({ error: "no_such_artwork" });
  db.prepare("UPDATE artworks SET status = ? WHERE id = ?").run(status, Number(req.params.id));
  // 审核结果通知作者：通过 / 精选 / 下架（状态真变了才打扰）
  if (before.status !== status) {
    const type = status === "featured" ? "featured" : status === "removed" ? "removed" : "approved";
    // 只有从待审转正才发 approved，正常作品之间互转不刷屏
    if (type !== "approved" || before.status === "pending") {
      db.prepare(
        "INSERT INTO notifications (user_id, type, ref_id, extra) VALUES (?, ?, ?, ?)"
      ).run(before.author_id, type, Number(req.params.id), before.title);
    }
  }
  res.json({ ok: true });
});
