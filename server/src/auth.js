// 账号体系：注册 / 登录 / 登出 / 我的资料 / 头像 / 举报 / 拉黑
// 密码用 Node 内置 scrypt（零原生依赖）；限流用内存 Map（单机够用）。
import crypto from "node:crypto";
import { promisify } from "node:util";
import { Router } from "express";
import { db } from "./db.js";
import { logEvent } from "./analytics.js";
import { rateLimit } from "./ratelimit.js";

const scrypt = promisify(crypto.scrypt);

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = await scrypt(pw, salt, 64);
  return `${salt}:${h.toString("hex")}`;
}

async function verifyPassword(pw, stored) {
  const [salt, hex] = String(stored).split(":");
  if (!salt || !hex) return false;
  const h = await scrypt(pw, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hex, "hex"), h);
}

export function requireLogin(req, res, next) {
  if (!req.session.userId)
    return res.status(401).json({ error: "login_required" });
  next();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 举报理由（汉化自 Pixilart）
export const REPORT_REASONS = [
  "垃圾广告",
  "色情低俗",
  "暴力血腥",
  "仇恨歧视",
  "霸凌骚扰",
  "侵权抄袭",
];

const PUBLIC_USER =
  "id, nickname, email, avatar_url, bio, created_at";

function publishedAvatar(userId, avatarUrl) {
  if (!avatarUrl) return null;
  const artwork = db
    .prepare("SELECT 1 FROM artworks WHERE author_id = ? AND png_url = ? AND status IN ('normal','featured')")
    .get(userId, avatarUrl);
  if (artwork) return avatarUrl;
  db.prepare("UPDATE users SET avatar_url = NULL WHERE id = ? AND avatar_url = ?").run(userId, avatarUrl);
  return null;
}

export const authRouter = Router();

// 管理员邮箱白名单（懒加载，方便自测时注入）；判权统一走这里
export function isAdminEmail(email) {
  const list = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(email || "").toLowerCase());
}

// 趣味接口：最新注册的用户（id 最大那位），供 #/user/latest 跳转；必须在 :id 前面
authRouter.get("/users/latest", (req, res) => {
  const row = db
    .prepare("SELECT id, nickname, avatar_url, bio, created_at FROM users ORDER BY id DESC LIMIT 1")
    .get();
  if (!row) return res.status(404).json({ error: "no_users_yet" });
  row.avatar_url = publishedAvatar(row.id, row.avatar_url);
  res.json({ user: row });
});

// 公开用户信息（用于作者主页）
authRouter.get("/users/:id", async (req, res) => {
  const uid = Number(req.params.id);
  if (!uid) return res.status(400).json({ error: "bad_id" });
  const row = db
    .prepare(`SELECT id, nickname, avatar_url, bio, created_at FROM users WHERE id = ?`)
    .get(uid);
  if (!row) return res.status(404).json({ error: "no_such_user" });
  row.avatar_url = publishedAvatar(row.id, row.avatar_url);
  const artworks = db
    .prepare("SELECT COUNT(*) c FROM artworks WHERE author_id = ? AND status IN ('normal','featured')")
    .get(row.id).c;
  const likes = db
    .prepare("SELECT COALESCE(SUM(likes_count),0) s FROM artworks WHERE author_id = ? AND status IN ('normal','featured')")
    .get(row.id).s;
  const views = db
    .prepare("SELECT COALESCE(SUM(views),0) s FROM artworks WHERE author_id = ? AND status IN ('normal','featured')")
    .get(row.id).s;
  const comments = db
    .prepare("SELECT COALESCE(SUM(comments_count),0) s FROM artworks WHERE author_id = ? AND status IN ('normal','featured')")
    .get(row.id).s;
  const mail = db.prepare("SELECT email FROM users WHERE id = ?").get(row.id).email;
  const pet = await petOf(row.id);
  res.json({ user: { ...row, is_admin: isAdminEmail(mail) }, stats: { artworks, likes, views, comments }, pet });
});

authRouter.post(
  "/register",
  rateLimit({ windowMs: 3600e3, max: 20 }),
  async (req, res) => {
    const { email, password, nickname } = req.body || {};
    if (!EMAIL_RE.test(email || ""))
      return res.status(400).json({ error: "bad_email" });
    if (!password || password.length < 6)
      return res.status(400).json({ error: "weak_password" });
    const name = String(nickname || email.split("@")[0]).slice(0, 20);
    try {
      const row = db
        .prepare(
          `INSERT INTO users (nickname, email, password_hash)
           VALUES (?, ?, ?) RETURNING ${PUBLIC_USER}`
        )
        .get(name, email.toLowerCase(), await hashPassword(password));
      req.session.userId = row.id;
      logEvent(row.id, "register");
      db.prepare(
        "INSERT INTO notifications (user_id, type, ref_id, extra) VALUES (?, 'welcome', NULL, ?)"
      ).run(row.id, "欢迎加入OuO像素画社区，去画第一张像素画吧");
      res.status(201).json({ user: row });
    } catch {
      res.status(409).json({ error: "email_taken" });
    }
  }
);

authRouter.post(
  "/login",
  rateLimit({ windowMs: 3600e3, max: 60 }),
  async (req, res) => {
    const { email, password } = req.body || {};
    const row = db
      .prepare(`SELECT ${PUBLIC_USER}, password_hash FROM users WHERE email = ?`)
      .get(String(email || "").toLowerCase());
    if (!row || !(await verifyPassword(password || "", row.password_hash)))
      return res.status(401).json({ error: "bad_credentials" });
    delete row.password_hash;
    row.avatar_url = publishedAvatar(row.id, row.avatar_url);
    req.session.userId = row.id;
    res.json({ user: row });
  }
);

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

authRouter.get("/me", requireLogin, async (req, res) => {
  const row = db
    .prepare(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`)
    .get(req.session.userId);
  if (!row) return res.status(401).json({ error: "login_required" });
  row.avatar_url = publishedAvatar(row.id, row.avatar_url);
  const artworks = db
    .prepare("SELECT COUNT(*) c FROM artworks WHERE author_id = ? AND status IN ('normal','featured')")
    .get(row.id).c;
  const likes = db
    .prepare("SELECT COALESCE(SUM(likes_count),0) s FROM artworks WHERE author_id = ? AND status IN ('normal','featured')")
    .get(row.id).s;
  const views = db
    .prepare("SELECT COALESCE(SUM(views),0) s FROM artworks WHERE author_id = ? AND status IN ('normal','featured')")
    .get(row.id).s;
  const comments = db
    .prepare("SELECT COALESCE(SUM(comments_count),0) s FROM artworks WHERE author_id = ? AND status IN ('normal','featured')")
    .get(row.id).s;
  res.json({ user: { ...row, is_admin: isAdminEmail(row.email) }, stats: { artworks, likes, views, comments }, pet: await petOf(row.id) });
});

authRouter.patch("/me", requireLogin, (req, res) => {
  const { nickname, bio } = req.body || {};
  const name = String(nickname ?? "").slice(0, 20);
  const intro = String(bio ?? "").slice(0, 200);
  if (!name) return res.status(400).json({ error: "bad_nickname" });
  db.prepare("UPDATE users SET nickname = ?, bio = ? WHERE id = ?").run(
    name,
    intro,
    req.session.userId
  );
  res.json({ ok: true });
});

// 头像只能选用自己已发布且未下架的作品（原图即头像）
authRouter.post("/me/avatar", requireLogin, (req, res) => {
  const artworkId = Number(req.body?.artwork_id);
  if (req.body?.draft_id) return res.status(400).json({ error: "published_artwork_required" });
  if (!artworkId) return res.status(400).json({ error: "bad_artwork" });
  const a = db
    .prepare("SELECT id, png_url FROM artworks WHERE id = ? AND author_id = ? AND status IN ('normal', 'featured')")
    .get(artworkId, req.session.userId);
  if (!a) return res.status(404).json({ error: "no_such_artwork" });
  db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(a.png_url, req.session.userId);
  res.json({ avatar_url: a.png_url });
});

// 头像恢复默认（清空）
authRouter.delete("/me/avatar", requireLogin, (req, res) => {
  db.prepare("UPDATE users SET avatar_url = NULL WHERE id = ?").run(req.session.userId);
  res.json({ ok: true });
});


async function petOf(userId) {
  const row = db.prepare("SELECT pet_artwork_id, pet_flip, pet_kind FROM users WHERE id = ?").get(userId);
  if (!row?.pet_artwork_id) return null;
  if (row.pet_kind === "draft") {
    db.prepare("UPDATE users SET pet_artwork_id = NULL, pet_flip = 0, pet_kind = 'artwork' WHERE id = ?").run(userId);
    return null;
  }
  const art = db
    .prepare("SELECT id, title, png_url, width, height FROM artworks WHERE id = ? AND author_id = ? AND status IN ('normal','featured')")
    .get(row.pet_artwork_id, userId);
  if (!art) return null;
  return { kind: "artwork", artwork_id: art.id, title: art.title, png_url: art.png_url, width: art.width, height: art.height, flip: row.pet_flip ? 1 : 0 };
}

authRouter.put("/me/pet", requireLogin, async (req, res) => {
  if (req.body?.draft_id) return res.status(400).json({ error: "published_artwork_required" });
  const artworkId = Number(req.body?.artwork_id);
  const flip = req.body?.flip ? 1 : 0;
  if (!artworkId) {
    db.prepare("UPDATE users SET pet_artwork_id = NULL, pet_flip = 0, pet_kind = 'artwork' WHERE id = ?").run(req.session.userId);
    return res.json({ pet: null });
  }
  const art = db
    .prepare("SELECT id FROM artworks WHERE id = ? AND author_id = ? AND status IN ('normal','featured')")
    .get(artworkId, req.session.userId);
  if (!art) return res.status(404).json({ error: "no_such_artwork" });
  db.prepare("UPDATE users SET pet_artwork_id = ?, pet_flip = ?, pet_kind = 'artwork' WHERE id = ?").run(art.id, flip, req.session.userId);
  res.json({ pet: await petOf(req.session.userId) });
});

authRouter.post("/reports", requireLogin, (req, res) => {
  const { artwork_id, comment_id, reason } = req.body || {};
  if (!REPORT_REASONS.includes(reason))
    return res.status(400).json({ error: "bad_reason" });
  if (!artwork_id && !comment_id)
    return res.status(400).json({ error: "bad_target" });
  if (artwork_id) {
    const a = db.prepare("SELECT 1 FROM artworks WHERE id = ?").get(artwork_id);
    if (!a) return res.status(404).json({ error: "no_such_artwork" });
  }
  if (comment_id) {
    const c = db.prepare("SELECT 1 FROM comments WHERE id = ?").get(comment_id);
    if (!c) return res.status(404).json({ error: "no_such_comment" });
  }
  db.prepare(
    "INSERT INTO reports (reporter_id, artwork_id, comment_id, reason) VALUES (?, ?, ?, ?)"
  ).run(req.session.userId, artwork_id || null, comment_id || null, reason);
  res.status(201).json({ ok: true });
});

authRouter.post("/blocks", requireLogin, (req, res) => {
  const target = Number(req.body?.user_id);
  if (!target || target === req.session.userId)
    return res.status(400).json({ error: "bad_target" });
  const exists = db.prepare("SELECT 1 FROM users WHERE id = ?").get(target);
  if (!exists) return res.status(404).json({ error: "no_such_user" });
  db.prepare(
    "INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)"
  ).run(req.session.userId, target);
  res.status(201).json({ ok: true });
});

authRouter.delete("/blocks/:id", requireLogin, (req, res) => {
  db.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").run(
    req.session.userId,
    Number(req.params.id)
  );
  res.json({ ok: true });
});
