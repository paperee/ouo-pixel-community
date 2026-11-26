// 发布作品与画廊。关键约束（T51）：发布只接受本站草稿 id + 前端由画布渲染的 PNG 字节，
// 不存在任何用户文件上传通道。服务端只校验 PNG 魔数/IHDR 尺寸，不做图像解码。
import { Router } from "express";
import { db } from "./db.js";
import { draftPixels, pixelsToPng } from "./draft-image.js";
import { isAdminEmail, isAdminUser, logAdmin, requireAdmin, requireLogin } from "./auth.js";
import { rateLimit } from "./ratelimit.js";

export const artworksRouter = Router();

export const ART_TAGS = ["人物", "场景", "物品", "游戏素材", "临摹", "动画", "生物", "其他"];
// license 为遗留标签（兼容老数据/老客户端），权限以 allow_download / allow_remix 为准
export const ART_LICENSES = ["CC-BY-NC", "CC-BY", "CC0", "不可转载"];

const toFlag = (v, fb = 1) => {
  if (v === undefined || v === null) return fb;
  if (v === false || v === 0 || v === "0" || v === "false") return 0;
  return 1;
};
// 正典映射：CC-BY-NC ⟺ 勾选“可以下载”+勾选“可以二创”（双开）；
// 不可转载 ⟺ 双关。老 CC-BY / CC0 都是开放授权，同样视为双开。
const LICENSE_FLAGS = {
  "CC-BY-NC": [1, 1],
  "CC-BY": [1, 1],
  "CC0": [1, 1],
  "不可转载": [0, 0],
};
// 发布默认值：双开（即 CC-BY-NC）
const DEFAULT_PERMS = { allow_download: 1, allow_remix: 1 };
const licenseToFlags = (lic) => LICENSE_FLAGS[lic] || [1, 1];
const flagsToLicense = (dl, rm) => (!dl && !rm ? "不可转载" : "CC-BY-NC");
// 机审关键词：命中则进待审
const SENSITIVE = ["法轮功", "8964", "天安门事件", "台独", "港独", "藏独", "疆独",
  "色情", "赌博", "毒品", "枪支", "办证", "贷款", "兼职刷单", "习近平", "毛泽东"];

const DETAIL_COLS = `a.id, a.author_id, a.title, a.description, a.tags, a.width, a.height,
  a.frames, a.layers_count, a.palette_json, a.png_url, a.license,
  a.allow_download, a.allow_remix, a.fork_from_id,
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
  // 新表单直接传 allow_download / allow_remix；老客户端只传 license 时按对照表兼容；
  // 两者都不传时默认双开（即 CC-BY-NC）
  const hasFlags = req.body?.allow_download !== undefined || req.body?.allow_remix !== undefined;
  let lic, dl, rm;
  if (hasFlags) {
    dl = toFlag(req.body.allow_download, DEFAULT_PERMS.allow_download);
    rm = toFlag(req.body.allow_remix, DEFAULT_PERMS.allow_remix);
    lic = flagsToLicense(dl, rm);
  } else if (license !== undefined) {
    lic = ART_LICENSES.includes(license) ? license : "CC-BY-NC";
    [dl, rm] = licenseToFlags(lic);
  } else {
    dl = DEFAULT_PERMS.allow_download;
    rm = DEFAULT_PERMS.allow_remix;
    lic = flagsToLicense(dl, rm);
  }

  // PNG 字节：必须是前端由该草稿画布渲染的（魔数 + IHDR 尺寸 + 与草稿一致）
  let pngBuf = null;
  let thumbBuf = null;
  try {
    pngBuf = Buffer.from(String(png || ""), "base64");
    thumbBuf = Buffer.from(String(thumb || ""), "base64");
  } catch {
    return res.status(400).json({ error: "bad_image" });
  }
  if (pngBuf.length > 2 * 1024 * 1024 || thumbBuf.length > 2 * 1024 * 1024)
    return res.status(400).json({ error: "image_too_large" });
  const meta = parsePng(pngBuf);
  const tmeta = parsePng(thumbBuf);
  if (!meta || !tmeta) return res.status(400).json({ error: "bad_image" });
  if (meta.w !== draft.canvas_w || meta.h !== draft.canvas_h)
    return res.status(400).json({ error: "size_mismatch" });
  if (meta.w > 128 || meta.h > 128 || tmeta.w > 128 || tmeta.h > 128)
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
        layers_count, palette_json, png_url, thumb_url, license, allow_download, allow_remix, status, draft_id, draft_version, layers_json, fork_from_id)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, status`
    )
    .get(
      req.session.userId, name, desc, JSON.stringify(tagList),
      meta.w, meta.h, layersCount, JSON.stringify(palette), pngUrl, thumbUrl, lic, dl, rm, status,
      draft.id, draft.version, draft.layers_json, draft.fork_from_id || null
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
  let where = "a.status IN ('normal', 'featured')";
  if (tab === "featured") where = "a.status = 'featured'";
  if (tab === "hot") {
    const HOT_ORDER = {
      hot: `(a.likes_count * 3 + a.comments_count * 2) / ((strftime('%s','now') - strftime('%s', a.created_at)) / 3600 + 2) DESC, a.id DESC`,
      views: "a.views DESC, a.id DESC",
      likes: "a.likes_count DESC, a.id DESC",
      comments: "a.comments_count DESC, a.id DESC",
    };
    order = HOT_ORDER[req.query.sort] || HOT_ORDER.hot;
  }
  const items = db
    .prepare(
      `SELECT a.id, a.title, a.png_url, a.width, a.height, a.likes_count, a.comments_count,
        a.views, a.created_at, a.author_id, u.nickname AS author_name,
        EXISTS(SELECT 1 FROM likes l WHERE l.user_id = ? AND l.artwork_id = a.id) AS liked
       FROM artworks a JOIN users u ON u.id = a.author_id
       WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`
    )
    .all(req.session.userId || 0, limit + 1, off);
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
  // 待审/下架的作品只有作者和管理员能看（管理员审核需要看大图和图层）
  if ((row.status === "pending" || row.status === "removed") && !isAuthor && !isAdminUser(req.session.userId))
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

// 头像联动：头像存的是作品原图拷贝，下架的作品若正被作者用作头像则清掉，
// 前端 avatar_url 为空即显示默认“画”（与 me.js 一致，按字节比对）
function clearAvatarIfFrom(authorId, pngUrl) {
  if (!pngUrl) return false;
  const u = db.prepare("SELECT avatar_url FROM users WHERE id = ?").get(authorId);
  if (u?.avatar_url && u.avatar_url === pngUrl) {
    db.prepare("UPDATE users SET avatar_url = NULL WHERE id = ?").run(authorId);
    return true;
  }
  return false;
}

// ---- 相邻作品：按发布时间（id 倒序，即画廊“最新”tab 的顺序）取上一张/下一张 ----
// 上一张 = 列表里更靠前的新作（id 更大），下一张 = 更早的旧作（id 更小）
artworksRouter.get("/artworks/:id/neighbors", (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM artworks WHERE id = ?").get(id))
    return res.status(404).json({ error: "no_such_artwork" });
  const vis = "status IN ('normal','featured')";
  const prev = db
    .prepare(`SELECT id, title FROM artworks WHERE ${vis} AND id > ? ORDER BY id ASC LIMIT 1`)
    .get(id);
  const next = db
    .prepare(`SELECT id, title FROM artworks WHERE ${vis} AND id < ? ORDER BY id DESC LIMIT 1`)
    .get(id);
  res.json({ prev: prev || null, next: next || null });
});

// ---- 取消发布（作者下架自己的作品，画廊即不再展示）----
artworksRouter.post("/artworks/:id/unpublish", requireLogin, (req, res) => {
  const a = db.prepare("SELECT author_id, status, png_url FROM artworks WHERE id = ?").get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: "no_such_artwork" });
  if (a.author_id !== req.session.userId) return res.status(403).json({ error: "forbidden" });
  if (a.status === "removed") return res.status(409).json({ error: "already_removed" });
  db.prepare("UPDATE artworks SET status = 'removed', removed_source = 'author', removed_reason = NULL WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true, avatar_cleared: clearAvatarIfFrom(a.author_id, a.png_url) });
});

// ---- 修改信息（作者可改自己作品的标题/简介/标签/版权，与草稿不联动）----
artworksRouter.patch("/artworks/:id", requireLogin, (req, res) => {
  const a = db.prepare("SELECT author_id FROM artworks WHERE id = ?").get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: "no_such_artwork" });
  if (a.author_id !== req.session.userId) return res.status(403).json({ error: "forbidden" });
  const { title, description, tags, license, allow_download, allow_remix } = req.body || {};
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
  const hasFlags = allow_download !== undefined || allow_remix !== undefined;
  if (hasFlags) {
    // 新表单：双勾选框为权限真相，license 标签顺手派生保持可读
    const cur = db.prepare("SELECT allow_download, allow_remix FROM artworks WHERE id = ?").get(Number(req.params.id));
    const dl = allow_download !== undefined ? toFlag(allow_download, 1) : (cur?.allow_download ?? 1);
    const rm = allow_remix !== undefined ? toFlag(allow_remix, 1) : (cur?.allow_remix ?? 1);
    patch.allow_download = dl;
    patch.allow_remix = rm;
    patch.license = license !== undefined
      ? (ART_LICENSES.includes(license) ? license : null)
      : flagsToLicense(dl, rm);
    if (patch.license === null) return res.status(400).json({ error: "bad_license" });
  } else if (license !== undefined) {
    // 老客户端：只传 license 时按映射同步权限
    if (!ART_LICENSES.includes(license)) return res.status(400).json({ error: "bad_license" });
    patch.license = license;
    const [dl, rm] = licenseToFlags(license);
    patch.allow_download = dl;
    patch.allow_remix = rm;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: "bad_request" });
  const aid = Number(req.params.id);
  // 防绕审：标题/简介变更后重跑机审，命中即打回待审（发布审一次，编辑不能成为后门）
  let reReview = false;
  if (patch.title !== undefined || patch.description !== undefined) {
    const cur = db.prepare("SELECT title, description, status FROM artworks WHERE id = ?").get(aid);
    if (cur && cur.status !== "pending" && hitSensitive(patch.title ?? cur.title, patch.description ?? cur.description)) {
      patch.status = "pending";
      reReview = true;
    }
  }
  const sets = Object.keys(patch)
    .map((k) => `${k} = ?`)
    .join(", ");
  db.prepare(`UPDATE artworks SET ${sets} WHERE id = ?`).run(...Object.values(patch), aid);
  if (reReview) {
    const title = patch.title ?? db.prepare("SELECT title FROM artworks WHERE id = ?").get(aid).title;
    db.prepare(
      "INSERT INTO notifications (user_id, type, ref_id, extra) VALUES (?, 'system', ?, ?)"
    ).run(req.session.userId, aid, `你的作品《${String(title).slice(0, 40)}》修改后命中审核关键词，已转入待审，通过后会重新公开`);
  }
  res.json({ ok: true, ...patch });
});

// ---- 二次创作：以该作品为模板新建一份草稿（需作者勾选“可以二创”，作者本人随时可玩）----
artworksRouter.post("/artworks/:id/remix", requireLogin, rateLimit({ windowMs: 60e3, max: 10 }), (req, res) => {
  const id = Number(req.params.id);
  const src = db.prepare("SELECT * FROM artworks WHERE id = ?").get(id);
  if (!src) return res.status(404).json({ error: "no_such_artwork" });
  const isAuthor = src.author_id === req.session.userId;
  if ((src.status === "pending" || src.status === "removed") && !isAuthor)
    return res.status(404).json({ error: "no_such_artwork" });
  const canRemix = (src.allow_remix ?? (src.license === "不可转载" ? 0 : 1)) ? true : false;
  if (!canRemix && !isAuthor) return res.status(403).json({ error: "remix_forbidden" });
  if (db.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?").get(src.author_id, req.session.userId))
    return res.status(403).json({ error: "blocked" });
  // 模板即发布时存下的图层源（立项红线：二创也只认站内数据，不存在外部上传通道）
  let doc;
  try {
    doc = JSON.parse(src.layers_json);
  } catch {
    return res.status(400).json({ error: "bad_source" });
  }
  if (!doc || doc.w < 1 || doc.w > 128 || doc.h < 1 || doc.h > 128 ||
      !Array.isArray(doc.layers) || doc.layers.length < 1 || doc.layers.length > 8)
    return res.status(400).json({ error: "bad_source" });
  const draft = db
    .prepare(
      `INSERT INTO drafts (user_id, title, canvas_w, canvas_h, layers_json, cover, fork_from_id)
       VALUES (?, ?, ?, ?, ?, '', ?) RETURNING id, title, canvas_w, canvas_h, updated_at, version`
    )
    .get(req.session.userId, `续作·${src.title}`.slice(0, 40), doc.w, doc.h, src.layers_json, src.id);
  if (!isAuthor) {
    db.prepare(
      "INSERT INTO notifications (user_id, type, ref_id, actor_id, extra) VALUES (?, 'remix', ?, ?, ?)"
    ).run(src.author_id, src.id, req.session.userId, String(src.title || "").slice(0, 200));
  }
  res.status(201).json({ draft });
});

// ---- 某人的公开作品：服务端分页 + 当前访客点赞状态 ----
artworksRouter.get("/users/:uid/works", (req, res) => {
  const uid = Number(req.params.uid);
  const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12));
  const total = db
    .prepare("SELECT COUNT(*) c FROM artworks WHERE author_id = ? AND status IN ('normal', 'featured')")
    .get(uid).c;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(1, Number(req.query.page) || 1), pages);
  const cols = `a.id, a.title, a.png_url, a.width, a.height, a.tags, a.status, a.likes_count,
    a.comments_count, a.views, a.created_at,
    EXISTS(SELECT 1 FROM likes l WHERE l.user_id = ? AND l.artwork_id = a.id) AS liked`;
  const rows = db
    .prepare(
      `SELECT ${cols}
       FROM artworks a
       WHERE a.author_id = ? AND a.status IN ('normal', 'featured')
       ORDER BY a.id DESC LIMIT ? OFFSET ?`
    )
    .all(req.session.userId || 0, uid, limit + 1, (page - 1) * limit);
  let featured = [];
  let top_tags = [];
  if (page === 1) {
    featured = db
      .prepare(
        `SELECT ${cols}
         FROM artworks a
         WHERE a.author_id = ? AND a.status = 'featured'
         ORDER BY a.likes_count DESC, a.id DESC`
      )
      .all(req.session.userId || 0, uid);
    top_tags = db
      .prepare(
        `SELECT j.value AS tag, COUNT(*) AS n
         FROM artworks a, json_each(CASE WHEN json_valid(a.tags) THEN a.tags ELSE '[]' END) j
         WHERE a.author_id = ? AND a.status IN ('normal', 'featured')
         GROUP BY j.value ORDER BY n DESC, j.value ASC LIMIT 5`
      )
      .all(uid);
  }
  res.json({
    items: rows.slice(0, limit),
    page,
    pages,
    total,
    has_more: rows.length > limit,
    master: featured[0] || null,
    featured,
    top_tags,
  });
});

// ---- 自己全部作品（含待审/下架） ----
artworksRouter.get("/me/works", requireLogin, (req, res) => {
  const items = db
    .prepare(
      `SELECT id, title, description, tags, license, allow_download, allow_remix, fork_from_id, png_url, width, height, status, likes_count, comments_count, views, created_at
       FROM artworks WHERE author_id = ? ORDER BY id DESC`
    )
    .all(req.session.userId);
  const drafts = db.prepare("SELECT id, title, layers_json, canvas_w, canvas_h, version, updated_at FROM drafts WHERE user_id = ? ORDER BY id DESC").all(req.session.userId);
  const draftItems = drafts.map((draft) => {
    try {
      const pixels = draftPixels(draft.layers_json, draft.canvas_w, draft.canvas_h);
      return { id: draft.id, title: draft.title, kind: "draft", png_url: `data:image/png;base64,${pixelsToPng(pixels, draft.canvas_w, draft.canvas_h).toString("base64")}` };
    } catch { return null; }
  }).filter(Boolean);
  res.json({ items, drafts: draftItems });
});

// ---- 审核（T55）：管理员门禁统一走 auth.js 的 requireAdmin ----

// 后台作品列表：缩略图（thumb_url 别名为 png_url，前端行内 img 无需区分）+ 服务端分页
// status 筛选：featured / normal / removed 各自独立，all=全部（默认，按发布时间倒序）
artworksRouter.get("/admin/artworks", requireLogin, requireAdmin, (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 40);
  const like = `%${q}%`;
  const st = ["featured", "normal", "removed", "all"].includes(req.query.status) ? req.query.status : "all";
  const statusWhere =
    st === "all" ? "a.status IN ('normal', 'featured', 'removed')" : `a.status = '${st}'`;
  const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 12));
  const where = `${statusWhere} AND (? = '' OR a.title LIKE ? OR u.nickname LIKE ?)`;
  const total = db
    .prepare(`SELECT COUNT(*) c FROM artworks a JOIN users u ON u.id = a.author_id WHERE ${where}`)
    .get(q, like, like).c;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(1, Number(req.query.page) || 1), pages);
  const items = db
    .prepare(
      `SELECT a.id, a.title, a.thumb_url AS png_url, a.status, a.removed_source, a.removed_reason, a.created_at, u.nickname AS author_name
       FROM artworks a JOIN users u ON u.id = a.author_id
       WHERE ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(q, like, like, limit, (page - 1) * limit);
  res.json({ items, q, status: st, page, pages, total });
});

artworksRouter.get("/admin/pending", requireLogin, requireAdmin, (req, res) => {
  const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 12));
  const total = db.prepare("SELECT COUNT(*) c FROM artworks WHERE status = 'pending'").get().c;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(1, Number(req.query.page) || 1), pages);
  // 顺带带出该作品的未处理举报：次数 + 举报人（昵称#ID），审核时一眼看到民怨
  const items = db
    .prepare(
      `SELECT a.id, a.title, a.description, a.thumb_url AS png_url, a.created_at, u.nickname AS author_name,
        (SELECT COUNT(*) FROM reports r WHERE r.artwork_id = a.id AND r.status = 'open') AS report_count,
        (SELECT GROUP_CONCAT(ru.nickname || '#' || r.reporter_id, '、')
           FROM reports r JOIN users ru ON ru.id = r.reporter_id
           WHERE r.artwork_id = a.id AND r.status = 'open') AS reporters
       FROM artworks a JOIN users u ON u.id = a.author_id
       WHERE a.status = 'pending' ORDER BY a.id DESC LIMIT ? OFFSET ?`
    )
    .all(limit, (page - 1) * limit);
  res.json({ items, page, pages, total });
});

// 审核操作：通过 / 精选 / 下架（可附理由，随通知告知作者）
artworksRouter.patch("/admin/:id", requireLogin, requireAdmin, (req, res) => {
  const { status } = req.body || {};
  const reason = String(req.body?.reason || "").trim().slice(0, 200);
  if (!["normal", "featured", "removed"].includes(status))
    return res.status(400).json({ error: "bad_status" });
  const id = Number(req.params.id);
  const before = db.prepare("SELECT author_id, status, removed_source, title, png_url FROM artworks WHERE id = ?").get(id);
  if (!before) return res.status(404).json({ error: "no_such_artwork" });
  if (before.status === "removed" && before.removed_source === "author")
    return res.status(403).json({ error: "author_removed" });
  db.prepare("UPDATE artworks SET status = ?, removed_source = ?, removed_reason = ? WHERE id = ?")
    .run(status, status === "removed" ? "admin" : null, status === "removed" ? (reason || null) : null, id);
  // 管理员下架同样联动头像：头像来源被端掉就恢复默认“画”
  if (status === "removed") clearAvatarIfFrom(before.author_id, before.png_url);
  // 审核结果通知作者：通过 / 精选 / 下架（状态真变了才打扰）
  if (before.status !== status) {
    const type = status === "featured" ? "featured" : status === "removed" ? "removed" : "approved";
    // 只有从待审转正才发 approved，正常作品之间互转不刷屏
    if (type !== "approved" || before.status === "pending") {
      db.prepare(
        "INSERT INTO notifications (user_id, type, ref_id, extra) VALUES (?, ?, ?, ?)"
      ).run(before.author_id, type, id, before.title);
      // 下架理由单独一条系统通知，作者不再莫名其妙
      if (status === "removed" && reason) {
        db.prepare(
          "INSERT INTO notifications (user_id, type, ref_id, extra) VALUES (?, 'system', ?, ?)"
        ).run(before.author_id, id, `你的作品《${String(before.title).slice(0, 40)}》被下架，原因：${reason}`);
      }
    }
  }
  logAdmin(req.session.userId, `artwork_${status}`, "artwork", id,
    `${before.title}${reason ? `｜理由：${reason}` : ""}`);
  res.json({ ok: true });
});

// ---- 举报处理：同目标的多条举报聚合为一行，处理一次全部结单 ----
artworksRouter.get("/admin/reports", requireLogin, requireAdmin, (req, res) => {
  const st = ["open", "handled", "all"].includes(req.query.status) ? req.query.status : "open";
  const where =
    st === "all" ? "1=1" : st === "open" ? "r.status = 'open'" : "r.status != 'open'";
  const limit = 8;
  const total = db
    .prepare(
      `SELECT COUNT(*) c FROM (SELECT 1 FROM reports r WHERE ${where}
       GROUP BY COALESCE(r.artwork_id, 0), COALESCE(r.comment_id, 0))`
    )
    .get().c;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(1, Number(req.query.page) || 1), pages);
  const items = db
    .prepare(
      `SELECT COALESCE(r.artwork_id, 0) AS artwork_id, COALESCE(r.comment_id, 0) AS comment_id,
        COUNT(*) AS cnt, MAX(r.created_at) AS latest,
        GROUP_CONCAT(DISTINCT r.reason) AS reasons, MAX(r.status) AS status,
        GROUP_CONCAT(DISTINCT ru.nickname || '#' || r.reporter_id) AS reporters,
        a.title AS artwork_title, a.thumb_url AS artwork_thumb, a.status AS artwork_status,
        au.nickname AS artwork_author,
        c.content AS comment_content, c.deleted AS comment_deleted, c.artwork_id AS comment_artwork_id,
        cu.nickname AS comment_author
       FROM reports r
       JOIN users ru ON ru.id = r.reporter_id
       LEFT JOIN artworks a ON a.id = r.artwork_id
       LEFT JOIN users au ON au.id = a.author_id
       LEFT JOIN comments c ON c.id = r.comment_id
       LEFT JOIN users cu ON cu.id = c.user_id
       WHERE ${where}
       GROUP BY COALESCE(r.artwork_id, 0), COALESCE(r.comment_id, 0)
       ORDER BY latest DESC LIMIT ? OFFSET ?`
    )
    .all(limit, (page - 1) * limit);
  const open = db
    .prepare(
      `SELECT COUNT(*) c FROM (SELECT 1 FROM reports WHERE status = 'open'
       GROUP BY COALESCE(artwork_id, 0), COALESCE(comment_id, 0))`
    )
    .get().c;
  res.json({ items, page, pages, total, open });
});

// 处理举报：remove=下架作品/删除评论并结单，dismiss=驳回；举报人都会收到反馈
artworksRouter.post("/admin/reports/handle", requireLogin, requireAdmin, (req, res) => {
  const action = req.body?.action;
  if (!["dismiss", "remove"].includes(action))
    return res.status(400).json({ error: "bad_action" });
  const aid = Number(req.body?.artwork_id) || 0;
  const cid = Number(req.body?.comment_id) || 0;
  if (!aid && !cid) return res.status(400).json({ error: "bad_target" });
  const open = db
    .prepare(
      `SELECT id, reporter_id FROM reports WHERE status = 'open'
       AND COALESCE(artwork_id, 0) = ? AND COALESCE(comment_id, 0) = ?`
    )
    .all(aid, cid);
  if (!open.length) return res.status(404).json({ error: "no_open_report" });
  let detail = "";
  if (action === "remove") {
    if (aid) {
      const art = db.prepare("SELECT author_id, title, png_url, status FROM artworks WHERE id = ?").get(aid);
      if (art && art.status !== "removed") {
        db.prepare("UPDATE artworks SET status = 'removed', removed_source = 'admin', removed_reason = NULL WHERE id = ?").run(aid);
        clearAvatarIfFrom(art.author_id, art.png_url);
        db.prepare(
          "INSERT INTO notifications (user_id, type, ref_id, extra) VALUES (?, 'removed', ?, ?)"
        ).run(art.author_id, aid, art.title);
        detail = `作品《${art.title}》`;
      }
    }
    if (cid) {
      const c = db.prepare("SELECT artwork_id, user_id, content FROM comments WHERE id = ? AND deleted = 0").get(cid);
      if (c) {
        db.prepare("UPDATE comments SET deleted = 1 WHERE id = ?").run(cid);
        db.prepare(
          "UPDATE artworks SET comments_count = (SELECT COUNT(*) FROM comments WHERE artwork_id = ? AND deleted = 0) WHERE id = ?"
        ).run(c.artwork_id, c.artwork_id);
        db.prepare(
          "INSERT INTO notifications (user_id, type, ref_id, extra) VALUES (?, 'system', ?, ?)"
        ).run(c.user_id, c.artwork_id, "你的一条评论因被举报违反社区规范，已被删除");
        detail = detail || `评论「${String(c.content).slice(0, 20)}」`;
      }
    }
  }
  db.prepare(
    `UPDATE reports SET status = ? WHERE status = 'open'
     AND COALESCE(artwork_id, 0) = ? AND COALESCE(comment_id, 0) = ?`
  ).run(action === "remove" ? "resolved" : "dismissed", aid, cid);
  // 举报不再是黑洞：处理结果反馈给每一位举报人
  const note = action === "remove"
    ? "你举报的内容已处理（下架/删除），感谢守护社区"
    : "你举报的内容经审核暂未违规，感谢反馈";
  for (const rep of open) {
    db.prepare(
      "INSERT INTO notifications (user_id, type, ref_id, extra) VALUES (?, 'system', ?, ?)"
    ).run(rep.reporter_id, aid || null, note);
  }
  logAdmin(req.session.userId, `report_${action}`, aid ? "artwork" : "comment", aid || cid, detail);
  res.json({ ok: true });
});

// ---- 用户管理：搜索 + 封禁/解封（不能封自己，也不能封管理员）；每页 8 条 ----
artworksRouter.get("/admin/users", requireLogin, requireAdmin, (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 40);
  const like = `%${q}%`;
  const limit = 8;
  const st = ["all", "normal", "banned"].includes(req.query.status) ? req.query.status : "all";
  const statusWhere = st === "all" ? "1=1" : st === "banned" ? "u.banned = 1" : "u.banned = 0";
  const where = `${statusWhere} AND (? = '' OR u.nickname LIKE ? OR u.email LIKE ?)`;
  const total = db.prepare(`SELECT COUNT(*) c FROM users u WHERE ${where}`).get(q, like, like).c;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(1, Number(req.query.page) || 1), pages);
  const items = db
    .prepare(
      `SELECT u.id, u.nickname, u.email, u.banned, u.created_at,
        (SELECT COUNT(*) FROM artworks a WHERE a.author_id = u.id) AS artworks_count
       FROM users u
       WHERE ${where}
       ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`
    )
    .all(q, like, like, limit, (page - 1) * limit);
  for (const u of items) u.is_admin = isAdminEmail(u.email);
  res.json({ items, q, status: st, page, pages, total });
});

artworksRouter.get("/admin/admins", requireLogin, requireAdmin, (req, res) => {
  const items = db
    .prepare("SELECT id, nickname, email, created_at FROM users ORDER BY id ASC")
    .all()
    .filter((u) => isAdminEmail(u.email));
  res.json({ items });
});

artworksRouter.patch("/admin/users/:id", requireLogin, requireAdmin, (req, res) => {
  const uid = Number(req.params.id);
  const banned = req.body?.banned ? 1 : 0;
  if (uid === req.session.userId) return res.status(400).json({ error: "cannot_ban_self" });
  const u = db.prepare("SELECT id, nickname, email FROM users WHERE id = ?").get(uid);
  if (!u) return res.status(404).json({ error: "no_such_user" });
  if (isAdminEmail(u.email)) return res.status(400).json({ error: "cannot_ban_admin" });
  db.prepare("UPDATE users SET banned = ? WHERE id = ?").run(banned, uid);
  logAdmin(req.session.userId, banned ? "user_ban" : "user_unban", "user", uid, u.nickname);
  res.json({ ok: true, banned });
});

// ---- 审计日志：只保留最近 40 条可查，每页 8 条 ----
artworksRouter.get("/admin/logs", requireLogin, requireAdmin, (req, res) => {
  const limit = 8;
  const q = String(req.query.q || "").trim().slice(0, 40);
  const like = `%${q}%`;
  const st = ["all", "artwork", "user", "report", "other"].includes(req.query.status) ? req.query.status : "all";
  const categoryWhere =
    st === "all" ? "1=1"
      : st === "artwork" ? "l.action LIKE 'artwork_%'"
        : st === "user" ? "l.action LIKE 'user_%'"
          : st === "report" ? "l.action LIKE 'report_%'"
            : "l.action NOT LIKE 'artwork_%' AND l.action NOT LIKE 'user_%' AND l.action NOT LIKE 'report_%'";
  const searchWhere = "(? = '' OR l.action LIKE ? OR l.detail LIKE ? OR u.nickname LIKE ? OR CAST(l.target_id AS TEXT) LIKE ?)";
  const recentCte = "WITH recent AS (SELECT * FROM admin_logs ORDER BY id DESC LIMIT 40)";
  const fromWhere = `FROM recent l JOIN users u ON u.id = l.admin_id
    WHERE ${categoryWhere} AND ${searchWhere}`;
  const total = db.prepare(`${recentCte} SELECT COUNT(*) c ${fromWhere}`).get(q, like, like, like, like).c;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(1, Number(req.query.page) || 1), pages);
  const items = db
    .prepare(
      `${recentCte}
       SELECT l.id, l.action, l.target_type, l.target_id, l.detail, l.created_at,
        u.nickname AS admin_name
       ${fromWhere}
       ORDER BY l.id DESC LIMIT ? OFFSET ?`
    )
    .all(q, like, like, like, like, limit, (page - 1) * limit);
  res.json({ items, q, status: st, page, pages, total });
});
