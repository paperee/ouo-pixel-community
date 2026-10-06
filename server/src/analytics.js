// 埋点（T70）：只记 4 个 MVP 指标 + 每日访问。站内自研，无第三方。
// 次日留存 = 昨天注册且今天有 visit 的用户占比。
import { Router } from "express";
import { db } from "./db.js";
import { requireLogin } from "./auth.js";
import { rateLimit } from "./ratelimit.js";

export function logEvent(userId, name, meta = "") {
  try {
    db.prepare("INSERT INTO events (user_id, name, meta) VALUES (?, ?, ?)").run(
      userId ?? null,
      name,
      String(meta).slice(0, 200)
    );
    // 统计只读 7 天窗口，90 天前的顺手删掉防无限增长（2% 概率，不阻塞热路径）
    if (Math.random() < 0.02) {
      try {
        db.prepare("DELETE FROM events WHERE created_at < datetime('now', '-90 days')").run();
      } catch {
        /* 清理失败不管 */
      }
    }
  } catch {
    /* 埋点永不影响主流程 */
  }
}

const TRACKABLE = new Set(["visit", "stroke", "save", "publish"]);

export const analyticsRouter = Router();

analyticsRouter.post(
  "/track",
  rateLimit({ windowMs: 60e3, max: 120 }),
  (req, res) => {
    const { event } = req.body || {};
    if (!TRACKABLE.has(event)) return res.status(400).json({ error: "bad_event" });
    logEvent(req.session?.userId ?? null, event);
    res.json({ ok: true });
  }
);

analyticsRouter.get("/admin/stats", requireLogin, (req, res) => {
  const me = db.prepare("SELECT email FROM users WHERE id = ?").get(req.session.userId);
  const admins = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase());
  if (!me || !admins.includes(me.email.toLowerCase()))
    return res.status(403).json({ error: "forbidden" });
  const q = (sql, ...a) => db.prepare(sql).get(...a);
  const since = (d) => `datetime('now', '-${d} days')`;
  const stats = {
    registrations_7d: q(`SELECT COUNT(*) c FROM users WHERE created_at > ${since(7)}`).c,
    visits_7d: q(`SELECT COUNT(*) c FROM events WHERE name = 'visit' AND created_at > ${since(7)}`).c,
    savers_7d: q(`SELECT COUNT(DISTINCT user_id) c FROM events WHERE name = 'save' AND user_id IS NOT NULL AND created_at > ${since(7)}`).c,
    publishers_7d: q(`SELECT COUNT(DISTINCT user_id) c FROM events WHERE name = 'publish' AND user_id IS NOT NULL AND created_at > ${since(7)}`).c,
    retention_1d: (() => {
      const reg = q(`SELECT COUNT(*) c FROM users WHERE date(created_at) = date('now', '-1 day')`).c;
      if (!reg) return null;
      const back = q(
        `SELECT COUNT(DISTINCT e.user_id) c FROM events e JOIN users u ON u.id = e.user_id
         WHERE e.name = 'visit' AND date(e.created_at) = date('now')
         AND date(u.created_at) = date('now', '-1 day')`
      ).c;
      return `${back}/${reg}`;
    })(),
  };
  res.json({ stats });
});
