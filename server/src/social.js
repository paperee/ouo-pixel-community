// 社交：点赞 / 评论（含楼中楼一级回复）/ 通知（被赞、被评论、被@）/ 拉黑联动
import { Router } from "express";
import { db } from "./db.js";
import { isAdminEmail, requireLogin } from "./auth.js";
import { rateLimit } from "./ratelimit.js";

export const socialRouter = Router();

// ---- 公告板：所有人可见，管理员编辑（内容 2000 字内，纯文本） ----
socialRouter.get("/board", (req, res) => {
  const row = db.prepare("SELECT content, updated_at FROM board WHERE id = 1").get();
  res.json({ board: { content: row?.content || "", updated_at: row?.updated_at || null } });
});
socialRouter.put("/board", requireLogin, (req, res) => {
  const me = db.prepare("SELECT email FROM users WHERE id = ?").get(req.session.userId);
  if (!me || !isAdminEmail(me.email)) return res.status(403).json({ error: "forbidden" });
  const content = String(req.body?.content || "").trim().slice(0, 2000);
  db.prepare(
    `INSERT INTO board (id, content, updated_by, updated_at) VALUES (1, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(content, req.session.userId);
  res.json({ ok: true });
});

function visibleArtwork(id, userId) {
  const row = db.prepare("SELECT * FROM artworks WHERE id = ?").get(id);
  if (!row) return null;
  if ((row.status === "pending" || row.status === "removed") && row.author_id !== userId)
    return null;
  return row;
}

function blockedBy(authorId, userId) {
  return !!db
    .prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?")
    .get(authorId, userId);
}

function notify(userId, type, refId, actorId = null, extra = "") {
  if (!userId) return;
  if (userId === actorId) return; // 自己对自己操作不打扰
  db.prepare(
    "INSERT INTO notifications (user_id, type, ref_id, actor_id, extra) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, type, refId ?? null, actorId, String(extra || "").slice(0, 200));
}

function recountLikes(artId) {
  db.prepare("UPDATE artworks SET likes_count = (SELECT COUNT(*) FROM likes WHERE artwork_id = ?) WHERE id = ?").run(artId, artId);
}

function recountComments(artId) {
  db.prepare("UPDATE artworks SET comments_count = (SELECT COUNT(*) FROM comments WHERE artwork_id = ? AND deleted = 0) WHERE id = ?").run(artId, artId);
}

// ---- 点赞：一人一赞，可取消；高频限流（T60 反刷） ----
socialRouter.post(
  "/artworks/:id/like",
  requireLogin,
  rateLimit({ windowMs: 60e3, max: 30 }),
  (req, res) => {
    const art = visibleArtwork(Number(req.params.id), req.session.userId);
    if (!art) return res.status(404).json({ error: "no_such_artwork" });
    if (blockedBy(art.author_id, req.session.userId))
      return res.status(403).json({ error: "blocked" });
    const r = db
      .prepare("INSERT OR IGNORE INTO likes (user_id, artwork_id) VALUES (?, ?)")
      .run(req.session.userId, art.id);
    if (r.changes) {
      recountLikes(art.id);
      notify(art.author_id, "like", art.id, req.session.userId, art.title);
    }
    const n = db.prepare("SELECT likes_count FROM artworks WHERE id = ?").get(art.id).likes_count;
    res.status(r.changes ? 201 : 200).json({ liked: true, likes_count: n });
  }
);

socialRouter.delete("/artworks/:id/like", requireLogin, (req, res) => {
  const art = visibleArtwork(Number(req.params.id), req.session.userId);
  if (!art) return res.status(404).json({ error: "no_such_artwork" });
  db.prepare("DELETE FROM likes WHERE user_id = ? AND artwork_id = ?").run(req.session.userId, art.id);
  recountLikes(art.id);
  const n = db.prepare("SELECT likes_count FROM artworks WHERE id = ?").get(art.id).likes_count;
  res.json({ liked: false, likes_count: n });
});

// ---- 评论列表 ----
socialRouter.get("/artworks/:id/comments", (req, res) => {
  const art = visibleArtwork(Number(req.params.id), req.session.userId);
  if (!art) return res.status(404).json({ error: "no_such_artwork" });
  const pageSize = 4;
  const rawPage = Number.parseInt(req.query.page, 10);
  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
  const total = db
    .prepare("SELECT COUNT(*) AS count FROM comments WHERE artwork_id = ? AND deleted = 0")
    .get(art.id).count;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pages);
  const items = db
    .prepare(
      `SELECT c.id, c.parent_id, c.content, c.created_at, c.user_id, u.nickname,
              pc.user_id AS parent_user_id, pu.nickname AS parent_nickname
       FROM comments c JOIN users u ON u.id = c.user_id
       LEFT JOIN comments pc ON pc.id = c.parent_id
       LEFT JOIN users pu ON pu.id = pc.user_id
       WHERE c.artwork_id = ? AND c.deleted = 0 ORDER BY c.id ASC LIMIT ? OFFSET ?`
    )
    .all(art.id, pageSize, (currentPage - 1) * pageSize);
  // 管理员标签：按邮箱白名单判定，只下发一个布尔值、不泄露邮箱
  const mails = new Map(
    db
      .prepare(`SELECT id, email FROM users WHERE id IN (SELECT DISTINCT user_id FROM comments WHERE artwork_id = ? AND deleted = 0)`)
      .all(art.id)
      .map((u) => [u.id, u.email])
  );
  for (const c of items) c.is_admin = isAdminEmail(mails.get(c.user_id));
  res.json({
    items,
    page: currentPage,
    page_size: pageSize,
    total,
    pages,
    has_prev: currentPage > 1,
    has_next: currentPage < pages,
  });
});

// ---- 发评论：一级回复 + @通知 ----
socialRouter.post(
  "/artworks/:id/comments",
  requireLogin,
  rateLimit({ windowMs: 60e3, max: 10 }),
  (req, res) => {
    const art = visibleArtwork(Number(req.params.id), req.session.userId);
    if (!art) return res.status(404).json({ error: "no_such_artwork" });
    if (blockedBy(art.author_id, req.session.userId))
      return res.status(403).json({ error: "blocked" });
    const content = String(req.body?.content || "").trim().slice(0, 500);
    if (!content) return res.status(400).json({ error: "bad_content" });
    const parentId = req.body?.parent_id ? Number(req.body.parent_id) : null;
    let parent = null;
    if (parentId) {
      parent = db.prepare("SELECT * FROM comments WHERE id = ? AND deleted = 0").get(parentId);
      if (!parent || parent.artwork_id !== art.id)
        return res.status(400).json({ error: "bad_parent" });
    }
    const row = db
      .prepare("INSERT INTO comments (artwork_id, user_id, parent_id, content) VALUES (?, ?, ?, ?) RETURNING id, created_at")
      .get(art.id, req.session.userId, parentId, content);
    recountComments(art.id);
    // 通知：被评论（作者）/ 被回复（楼主）/ 被@（正文里 @昵称），都带上作品标题方便定位
    notify(art.author_id, "comment", art.id, req.session.userId, art.title);
    if (parent && parent.user_id !== req.session.userId && parent.user_id !== art.author_id)
      notify(parent.user_id, "reply", art.id, req.session.userId, art.title);
    const mentioned = new Set([...content.matchAll(/@([^\s@]{1,20})/g)].map((m) => m[1]));
    // 注意：@ 按当前昵称精确匹配，改名后旧 @ 失效（MVP 约束，已在文档注明）
    for (const nick of mentioned) {
      const users = db.prepare("SELECT id FROM users WHERE nickname = ?").all(nick);
      for (const u of users) notify(u.id, "mention", art.id, req.session.userId, art.title);
    }
    res.status(201).json({ comment: row });
  }
);

// ---- 删评论：自己删自己的，作者可删本作品下任何评论，管理员可删任何评论（软删） ----
socialRouter.delete("/comments/:id", requireLogin, (req, res) => {
  const c = db.prepare("SELECT * FROM comments WHERE id = ? AND deleted = 0").get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: "no_such_comment" });
  const art = db.prepare("SELECT author_id FROM artworks WHERE id = ?").get(c.artwork_id);
  const me = db.prepare("SELECT email FROM users WHERE id = ?").get(req.session.userId);
  if (c.user_id !== req.session.userId && art?.author_id !== req.session.userId && !isAdminEmail(me?.email))
    return res.status(403).json({ error: "forbidden" });
  db.prepare("UPDATE comments SET deleted = 1 WHERE id = ?").run(c.id);
  recountComments(c.artwork_id);
  res.json({ ok: true });
});

// ---- 通知：列表 + 未读数 + 标已读 + 删除 ----
const NOTIF_TYPES = ["like", "comment", "reply", "mention", "approved", "featured", "removed", "welcome", "system"];
socialRouter.get("/notifications", requireLogin, (req, res) => {
  const unreadOnly = req.query.unread === "1";
  const type = NOTIF_TYPES.includes(req.query.type) ? req.query.type : null;
  const where = ["n.user_id = ?"];
  const args = [req.session.userId];
  if (unreadOnly) where.push("n.read = 0");
  if (type) {
    where.push("n.type = ?");
    args.push(type);
  }
  const items = db
    .prepare(
      `SELECT n.id, n.type, n.ref_id, n.read, n.created_at, n.actor_id, n.extra,
        u.nickname AS actor_name, a.title AS artwork_title
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
       LEFT JOIN artworks a ON a.id = n.ref_id
       WHERE ${where.join(" AND ")} ORDER BY n.id DESC LIMIT 50`
    )
    .all(...args);
  const unread = db
    .prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0")
    .get(req.session.userId).c;
  // 已读超 30 天的顺手清掉，通知表不无限长（未读的永远保留）
  try {
    db.prepare(
      "DELETE FROM notifications WHERE user_id = ? AND read = 1 AND created_at < datetime('now', '-30 days')"
    ).run(req.session.userId);
  } catch {
    /* 清理失败不挡列表 */
  }
  res.json({ items, unread });
});

socialRouter.patch("/notifications/read", requireLogin, (req, res) => {
  db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").run(req.session.userId);
  res.json({ ok: true });
});

// 单条标为已读
socialRouter.patch("/notifications/:id/read", requireLogin, (req, res) => {
  const r = db
    .prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?")
    .run(Number(req.params.id), req.session.userId);
  if (!r.changes) return res.status(404).json({ error: "no_such_notification" });
  res.json({ ok: true });
});

// 单条删除
socialRouter.delete("/notifications/:id", requireLogin, (req, res) => {
  const r = db
    .prepare("DELETE FROM notifications WHERE id = ? AND user_id = ?")
    .run(Number(req.params.id), req.session.userId);
  if (!r.changes) return res.status(404).json({ error: "no_such_notification" });
  res.json({ ok: true });
});

// 一键清空
socialRouter.delete("/notifications", requireLogin, (req, res) => {
  db.prepare("DELETE FROM notifications WHERE user_id = ?").run(req.session.userId);
  res.json({ ok: true });
});
