// 云端草稿箱：仅自己可见。发布接口（P5）只接受本站草稿 id，从源头杜绝图片上传。
import { Router } from "express";
import { db } from "./db.js";
import { requireLogin } from "./auth.js";

export const draftsRouter = Router();
draftsRouter.use(requireLogin);

const LIST_COLS = "id, title, canvas_w, canvas_h, layers_json, cover, updated_at, version";
const MAX_DOC_BYTES = 6 * 1024 * 1024;
const MAX_COVER_BYTES = 2 * 1024 * 1024;

// 校验客户端传来的 serialize() 字符串
function parseDoc(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX_DOC_BYTES)
    return null;
  let o;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || o.w < 1 || o.w > 128 || o.h < 1 || o.h > 128) return null;
  if (!Array.isArray(o.layers) || o.layers.length < 1 || o.layers.length > 8)
    return null;
  return o;
}

function cleanCover(c) {
  if (typeof c !== "string" || Buffer.byteLength(c) > MAX_COVER_BYTES) return "";
  return c;
}

function own(id, userId) {
  return db
    .prepare(`SELECT id, title, canvas_w, canvas_h, layers_json, cover, updated_at, version
              FROM drafts WHERE id = ? AND user_id = ?`)
    .get(id, userId);
}

// 草稿→作品软连接：该草稿最近一次有效发布（下架的不算）
function pubOf(userId, draftIds) {
  const ids = [...new Set(draftIds)];
  if (!ids.length) return new Map();
  const rows = db
    .prepare(
      `SELECT draft_id, id, draft_version FROM artworks
       WHERE author_id = ? AND status != 'removed' AND draft_id IN (${ids.map(() => "?").join(",")})
       ORDER BY id DESC`
    )
    .all(userId, ...ids);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.draft_id))
      map.set(r.draft_id, { published_artwork_id: r.id, published_version: r.draft_version });
  }
  return map;
}

function withPub(userId, drafts) {
  const map = pubOf(userId, drafts.map((d) => d.id));
  return drafts.map((d) => ({
    ...d,
    published_artwork_id: map.get(d.id)?.published_artwork_id || null,
    published_version: map.get(d.id)?.published_version ?? null,
  }));
}

function snapshotVersion(draftId, layersJson, kind = "manual") {
  if (kind === "auto") {
    // 自动保存独立 1 位：每次覆盖，不占手动位
    db.prepare("DELETE FROM draft_versions WHERE draft_id = ? AND kind = 'auto'").run(draftId);
    db.prepare("INSERT INTO draft_versions (draft_id, layers_json, kind) VALUES (?, ?, 'auto')").run(
      draftId,
      layersJson
    );
    return;
  }
  db.prepare("INSERT INTO draft_versions (draft_id, layers_json, kind) VALUES (?, ?, 'manual')").run(
    draftId,
    layersJson
  );
  // 手动位最多保留 15 个（再多前端会先问用户腾地方，这里是最后兜底；自动位不受影响）
  db.prepare(
    `DELETE FROM draft_versions WHERE draft_id = ? AND kind = 'manual'
     AND id NOT IN (SELECT id FROM draft_versions WHERE draft_id = ? AND kind = 'manual' ORDER BY id DESC LIMIT 15)`
  ).run(draftId, draftId);
}

draftsRouter.get("/", (req, res) => {
  const rows = db
    .prepare(`SELECT ${LIST_COLS} FROM drafts WHERE user_id = ? ORDER BY updated_at DESC`)
    .all(req.session.userId);
  res.json({ drafts: withPub(req.session.userId, rows) });
});

draftsRouter.post("/", (req, res) => {
  const { title, doc, cover } = req.body || {};
  const o = parseDoc(doc);
  if (!o) return res.status(400).json({ error: "bad_doc" });
  const row = db
    .prepare(
      `INSERT INTO drafts (user_id, title, canvas_w, canvas_h, layers_json, cover)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING ${LIST_COLS}`
    )
    .get(
      req.session.userId,
      String(title || "未命名").slice(0, 40),
      o.w,
      o.h,
      doc,
      cleanCover(cover)
    );
  res.status(201).json({ draft: row });
});

draftsRouter.get("/:id", (req, res) => {
  const row = own(Number(req.params.id), req.session.userId);
  if (!row) return res.status(404).json({ error: "no_such_draft" });
  res.json({ draft: withPub(req.session.userId, [row])[0] });
});

draftsRouter.put("/:id", (req, res) => {
  const row = own(Number(req.params.id), req.session.userId);
  if (!row) return res.status(404).json({ error: "no_such_draft" });
  const { title, doc, cover, auto } = req.body || {};
  let layersJson = row.layers_json;
  let { canvas_w, canvas_h } = row;
  let coverVal = row.cover || "";
  let titleVal = row.title;
  let changed = false;
  let bump = false; // 只有标题/画布真变了才涨版本号；纯封面刷新不涨
  if (title !== undefined) {
    const t = String(title).slice(0, 40);
    if (t !== titleVal) {
      titleVal = t;
      changed = true;
      bump = true;
    }
  }
  if (cover !== undefined) {
    const c = cleanCover(cover);
    if (c !== coverVal) {
      coverVal = c;
      changed = true;
    }
  }
  if (doc !== undefined) {
    const o = parseDoc(doc);
    if (!o) return res.status(400).json({ error: "bad_doc" });
    // 内容没变不存档：重复保存直接返回现状，不产生版本、不涨版本号。
    // 存档存的是保存后的内容（这次 PUT 的 doc），保证最新存档与刚保存的画布一致；
    // 回滚时“先存当前再恢复”的那一次仍存的是被替换掉的现状（见 rollback）。
    if (doc !== row.layers_json) {
      snapshotVersion(row.id, doc, auto ? "auto" : "manual");
      layersJson = doc;
      canvas_w = o.w;
      canvas_h = o.h;
      changed = true;
      bump = true;
    }
  }
  if (!changed) {
    const cur = db
      .prepare(`SELECT ${LIST_COLS} FROM drafts WHERE id = ?`)
      .get(row.id);
    return res.json({ draft: cur });
  }
  const next = db
    .prepare(
      `UPDATE drafts SET title = ?, canvas_w = ?, canvas_h = ?, layers_json = ?, cover = ?,
        updated_at = datetime('now')${bump ? ", version = version + 1" : ""}
       WHERE id = ? RETURNING ${LIST_COLS}`
    )
    .get(titleVal, canvas_w, canvas_h, layersJson, coverVal, row.id);
  res.json({ draft: next });
});

draftsRouter.delete("/:id", (req, res) => {
  const r = db
    .prepare("DELETE FROM drafts WHERE id = ? AND user_id = ?")
    .run(Number(req.params.id), req.session.userId);
  if (!r.changes) return res.status(404).json({ error: "no_such_draft" });
  db.prepare("DELETE FROM draft_versions WHERE draft_id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

// 另存为副本
draftsRouter.post("/:id/duplicate", (req, res) => {
  const row = own(Number(req.params.id), req.session.userId);
  if (!row) return res.status(404).json({ error: "no_such_draft" });
  const copy = db
    .prepare(
      `INSERT INTO drafts (user_id, title, canvas_w, canvas_h, layers_json, cover)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING ${LIST_COLS}`
    )
    .get(
      req.session.userId,
      `${row.title} 副本`.slice(0, 40),
      row.canvas_w,
      row.canvas_h,
      row.layers_json,
      row.cover || ""
    );
  res.status(201).json({ draft: copy });
});

// 版本历史 / 回滚
draftsRouter.get("/:id/versions", (req, res) => {
  const row = own(Number(req.params.id), req.session.userId);
  if (!row) return res.status(404).json({ error: "no_such_draft" });
  const versions = db
    .prepare("SELECT id, kind, created_at, layers_json FROM draft_versions WHERE draft_id = ? ORDER BY id DESC")
    .all(row.id);
  res.json({ versions });
});

// 手动清理单个历史存档（备份位满时腾地方用，只能删自己的）
draftsRouter.delete("/:id/versions/:vid", (req, res) => {
  const row = own(Number(req.params.id), req.session.userId);
  if (!row) return res.status(404).json({ error: "no_such_draft" });
  const r = db
    .prepare("DELETE FROM draft_versions WHERE id = ? AND draft_id = ?")
    .run(Number(req.params.vid), row.id);
  if (!r.changes) return res.status(404).json({ error: "no_such_version" });
  const left = db
    .prepare("SELECT COUNT(*) AS n FROM draft_versions WHERE draft_id = ?")
    .get(row.id).n;
  res.json({ ok: true, left });
});

draftsRouter.post("/:id/rollback/:vid", (req, res) => {
  const row = own(Number(req.params.id), req.session.userId);
  if (!row) return res.status(404).json({ error: "no_such_draft" });
  const v = db
    .prepare("SELECT layers_json FROM draft_versions WHERE id = ? AND draft_id = ?")
    .get(Number(req.params.vid), row.id);
  if (!v) return res.status(404).json({ error: "no_such_version" });
  // 回滚目标与现状一致时直接返回，不重复存档
  if (v.layers_json === row.layers_json) {
    const cur = db
      .prepare(`SELECT ${LIST_COLS} FROM drafts WHERE id = ?`)
      .get(row.id);
    return res.json({ draft: cur });
  }
  snapshotVersion(row.id, row.layers_json);
  const next = db
    .prepare(
      `UPDATE drafts SET layers_json = ?, updated_at = datetime('now'), version = version + 1
       WHERE id = ? RETURNING ${LIST_COLS}`
    )
    .get(v.layers_json, row.id);
  res.json({ draft: next });
});
