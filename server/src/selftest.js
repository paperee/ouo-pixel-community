// P1 回归自测：临时库 + 临时端口，全流程断言，退出码说明一切
// 跑法：npm run selftest
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-test-"));
process.env.DB_PATH = path.join(tmp, "t.db");

const { app } = await import("./index.js");

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${name} ${extra}`);
  if (!cond) failures++;
}

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  const req = async (method, p, body, type = "application/json") => {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body ? { "Content-Type": type } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 非 JSON（如图片字节） */
    }
    return { status: res.status, json, text };
  };

  // 注册 / 重复注册 / 弱密码 / 坏邮箱
  let r = await req("POST", "/api/register", JSON.stringify({ email: "a@b.cn", password: "secret12", nickname: "阿像" }));
  check("register", r.status === 201 && r.json.user.nickname === "阿像");
  const meId = r.json.user?.id;
  r = await req("POST", "/api/register", JSON.stringify({ email: "a@b.cn", password: "secret12" }));
  check("register-duplicate", r.status === 409);
  r = await req("POST", "/api/register", JSON.stringify({ email: "bad", password: "secret12" }));
  check("register-bad-email", r.status === 400);
  r = await req("POST", "/api/register", JSON.stringify({ email: "c@d.cn", password: "123" }));
  check("register-weak-password", r.status === 400);

  // 登录 / 错误密码 / 未登录访问
  cookie = "";
  r = await req("POST", "/api/login", JSON.stringify({ email: "a@b.cn", password: "wrong" }));
  check("login-wrong", r.status === 401);
  r = await req("GET", "/api/me");
  check("me-requires-login", r.status === 401);
  r = await req("POST", "/api/login", JSON.stringify({ email: "a@b.cn", password: "secret12" }));
  check("login", r.status === 200 && r.json.user.email === "a@b.cn");
  r = await req("GET", "/api/me");
  check("me", r.status === 200 && r.json.stats.artworks === 0);

  // 改资料
  r = await req("PATCH", "/api/me", JSON.stringify({ nickname: "新名字", bio: "爱画画" }));
  check("patch-me", r.status === 200);

  // 头像：只能选用自己发布过的作品（无 id / 非法 id 拒绝）
  r = await req("POST", "/api/me/avatar", JSON.stringify({}));
  check("avatar-bad-artwork", r.status === 400);
  r = await req("POST", "/api/me/avatar", JSON.stringify({ artwork_id: 9999 }));
  check("avatar-no-such-artwork", r.status === 404);

  // 举报理由非法 / 目标不存在
  r = await req("POST", "/api/reports", JSON.stringify({ artwork_id: 1, reason: "乱写" }));
  check("report-bad-reason", r.status === 400);
  r = await req("POST", "/api/reports", JSON.stringify({ artwork_id: 999, reason: "垃圾广告" }));
  check("report-no-such-artwork", r.status === 404);

  // ---- 草稿箱 ----
  const tinyDoc = (w, mark) => {
    const px = Buffer.alloc(w * w * 4);
    if (mark) px[0] = 255, px[3] = 255;
    return JSON.stringify({ v: 1, w, h: w, active: 0,
      layers: [{ name: "图层 1", visible: true, opacity: 1, blend: "normal", data: px.toString("base64") }] });
  };
  cookie = "";
  r = await req("GET", "/api/drafts");
  check("drafts-require-login", r.status === 401);
  r = await req("POST", "/api/login", JSON.stringify({ email: "a@b.cn", password: "secret12" }));
  r = await req("POST", "/api/drafts", JSON.stringify({ title: "第一张", doc: tinyDoc(4, true), cover: JSON.stringify({ w: 4, h: 4, data: "e30=" }) }));
  check("draft-create", r.status === 201 && r.json.draft.version === 1 && (r.json.draft.cover || "").includes('"w":4'));
  const did = r.json.draft?.id;
  r = await req("POST", "/api/drafts", JSON.stringify({ title: "坏的", doc: JSON.stringify({ v: 1, w: 999, h: 4, active: 0, layers: [] }) }));
  check("draft-bad-doc", r.status === 400);
  r = await req("GET", "/api/drafts");
  check("draft-list", r.status === 200 && r.json.drafts.length === 1 && r.json.drafts[0].layers_json === tinyDoc(4, true) && r.json.drafts[0].canvas_w === 4 && r.json.drafts[0].canvas_h === 4);
  r = await req("GET", `/api/drafts/${did}`);
  check("draft-get", r.status === 200 && typeof r.json.draft.layers_json === "string");
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ title: "改名", doc: tinyDoc(4, false) }));
  check("draft-put", r.status === 200 && r.json.draft.version === 2 && r.json.draft.title === "改名");
  // 同内容重复保存：不产生新版本存档，版本号也不涨
  const curDoc = (await req("GET", `/api/drafts/${did}`)).json.draft.layers_json;
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ title: "改名", doc: curDoc }));
  check("draft-put-same", r.status === 200 && r.json.draft.version === 2);
  r = await req("GET", `/api/drafts/${did}/versions`);
  check("draft-no-dup-snapshot", r.status === 200 && r.json.versions.length === 1);
  // 纯封面更新：持久化但不涨版本、不产生版本存档
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ cover: "cover-v2" }));
  check("draft-cover-only", r.status === 200 && r.json.draft.version === 2 && r.json.draft.cover === "cover-v2");
  r = await req("GET", `/api/drafts/${did}/versions`);
  check("draft-cover-no-snapshot", r.status === 200 && r.json.versions.length === 1);
  r = await req("GET", `/api/drafts/${did}/versions`);
  check("draft-versions", r.status === 200 && r.json.versions.length === 1);
  // 存档存的是保存后的内容：最新存档与现状一致
  check("draft-version-is-current", r.json.versions[0].layers_json === tinyDoc(4, false));
  // 再存一版不同的：最新存档恒等于现状
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ doc: tinyDoc(4, true) }));
  check("draft-put-again", r.status === 200 && r.json.draft.version === 3);
  r = await req("GET", `/api/drafts/${did}/versions`);
  check("draft-versions-2", r.status === 200 && r.json.versions.length === 2 &&
    r.json.versions[0].layers_json === tinyDoc(4, true));
  // 回滚到与现状一致的最新版：空操作，不涨版本不增存档
  r = await req("POST", `/api/drafts/${did}/rollback/${r.json.versions[0].id}`);
  check("draft-rollback-noop", r.status === 200 && r.json.draft.version === 3);
  r = await req("GET", `/api/drafts/${did}/versions`);
  check("draft-rollback-noop-no-snapshot", r.status === 200 && r.json.versions.length === 2);
  // 回滚到老版本：先存当前再恢复
  const vid = r.json.versions[1]?.id;
  r = await req("POST", `/api/drafts/${did}/rollback/${vid}`);
  check("draft-rollback", r.status === 200 && r.json.draft.version === 4);
  r = await req("GET", `/api/drafts/${did}`);
  check("draft-rollback-content", r.status === 200 && r.json.draft.layers_json === tinyDoc(4, false));
  r = await req("POST", `/api/drafts/${did}/duplicate`);
  check("draft-duplicate", r.status === 201);
  const copyId = r.json.draft?.id;
  // 删单个历史存档：只能删自己的，删完计数-1；手动上限 15（连存 18 次只留 15）
  r = await req("DELETE", `/api/drafts/${did}/versions/999999`);
  check("draft-version-del-404", r.status === 404);
  for (let i = 0; i < 18; i++) {
    await req("PUT", `/api/drafts/${did}`, JSON.stringify({ doc: tinyDoc(4, i % 2 === 0) }));
  }
  r = await req("GET", `/api/drafts/${did}/versions`);
  check("draft-versions-cap15", r.status === 200 && r.json.versions.length === 15 &&
    r.json.versions.every((v) => v.kind === "manual"));
  const delVid = r.json.versions[14]?.id;
  r = await req("DELETE", `/api/drafts/${did}/versions/${delVid}`);
  check("draft-version-del", r.status === 200 && r.json.left === 14);
  r = await req("GET", `/api/drafts/${did}/versions`);
  check("draft-version-del-count", r.status === 200 && r.json.versions.length === 14);
  // 自动保存独立 1 位：多次 auto 只留 1 个且内容更新，不占手动位
  // （存档存的是保存后的内容，所以自动位内容 = 这次 PUT 的 doc）
  const autoA = tinyDoc(4, true);
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ auto: true, doc: autoA }));
  check("draft-auto-put", r.status === 200);
  r = await req("GET", `/api/drafts/${did}/versions`);
  check("draft-auto-one", r.status === 200 && r.json.versions.length === 15 &&
    r.json.versions.filter((v) => v.kind === "auto").length === 1 &&
    r.json.versions.find((v) => v.kind === "auto").layers_json === autoA);
  const autoB = tinyDoc(4, false);
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ auto: true, doc: autoB }));
  check("draft-auto-put2", r.status === 200);
  r = await req("GET", `/api/drafts/${did}/versions`);
  check("draft-auto-replace", r.status === 200 && r.json.versions.length === 15 &&
    r.json.versions.filter((v) => v.kind === "auto").length === 1 &&
    r.json.versions.find((v) => v.kind === "auto").layers_json === autoB);
  // 手动保存不受自动位影响：手动位回到 15，总数 16
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ doc: tinyDoc(4, true) }));
  check("draft-manual-after-auto", r.status === 200);
  r = await req("GET", `/api/drafts/${did}/versions`);
  check("draft-manual-cap15", r.status === 200 && r.json.versions.length === 16 &&
    r.json.versions.filter((v) => v.kind === "manual").length === 15 &&
    r.json.versions.filter((v) => v.kind === "auto").length === 1);

  // 注册 B，切回 A 拉黑 / 取消
  const cookieA = cookie;
  cookie = "";
  r = await req("POST", "/api/register", JSON.stringify({ email: "b@c.cn", password: "secret12", nickname: "小黑" }));
  const bid = r.json.user?.id;
  check("register-b", r.status === 201 && bid);
  r = await req("GET", `/api/drafts/${did}`);
  check("draft-isolation", r.status === 404);
  cookie = cookieA;
  r = await req("DELETE", `/api/drafts/${copyId}`);
  check("draft-delete", r.status === 200);

  // ---- 发布与画廊 ----
  const zlib = await import("node:zlib");
  const CRC_T = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_T[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([l, t, data, c]);
  };
  const miniPng = (w, h, fill = 255) => {
    const raw = Buffer.alloc(h * (1 + w * 4), fill);
    for (let y = 0; y < h; y++) raw[y * (1 + w * 4)] = 0;
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]).toString("base64");
  };
  const png4 = miniPng(4, 4);
  const png4b = miniPng(4, 4, 0); // 不同字节的 4x4，用于区分头像来源
  const png8 = miniPng(8, 8);
  const pub = (body) => req("POST", "/api/artworks", JSON.stringify(body));
  cookie = "";
  r = await pub({ draft_id: did, title: "x", png: png4, thumb: png4 });
  check("publish-require-login", r.status === 401);
  r = await req("POST", "/api/login", JSON.stringify({ email: "a@b.cn", password: "secret12" }));
  r = await pub({ draft_id: 9999, title: "x", png: png4, thumb: png4 });
  check("publish-no-draft", r.status === 404);
  r = await pub({ draft_id: did, title: "x", png: "aGVsbG8=", thumb: png4 });
  check("publish-bad-image", r.status === 400);
  r = await pub({ draft_id: did, title: "x", png: png8, thumb: png8 });
  check("publish-size-mismatch", r.status === 400);
  r = await pub({ draft_id: did, title: "第一张发布", description: "红点", tags: ["人物", "乱填"], license: "CC-BY", png: png4, thumb: png4, palette: ["#ff0000", "nope"] });
  check("publish", r.status === 201 && r.json.artwork.status === "normal");
  const aid = r.json.artwork?.id;
  // 同一版直接重发 → 409
  r = await pub({ draft_id: did, title: "再发一次", png: png4, thumb: png4 });
  check("publish-dup-version", r.status === 409 && r.json.artwork_id === aid);
  const du = await req("GET", `/api/artworks/${aid}`).then((x) => x);
  check("detail-urls", du.status === 200 && du.json.artwork.png_url.startsWith("data:image/png;base64,") && du.json.artwork.layers_count === 1);
  const rawB64 = String(du.json.artwork.png_url.split(",", 2)[1] || "");
  check("png-bytes-in-db", Buffer.from(rawB64, "base64").subarray(0, 8).toString("hex") === "89504e470d0a1a0a");
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ title: "再改一次" }));
  check("draft-bump-before-sensitive", r.status === 200);
  r = await pub({ draft_id: did, title: "色情测试", tags: ["生物"], png: png4, thumb: png4 });
  check("publish-sensitive-pending", r.status === 201 && r.json.artwork.status === "pending");
  const pid = r.json.artwork?.id;
  r = await req("POST", "/api/me/avatar", JSON.stringify({ artwork_id: pid }));
  check("avatar-pending-rejected", r.status === 404);
  r = await req("PUT", "/api/me/pet", JSON.stringify({ artwork_id: pid }));
  check("pet-pending-rejected", r.status === 404);
  const pdetail = await req("GET", `/api/artworks/${pid}`);
  check("publish-tag-bio", pdetail.status === 200 && String(pdetail.json.artwork.tags || "").includes("生物"));
  r = await req("GET", "/api/gallery?tab=new");
  check("gallery-hides-pending", r.status === 200 && r.json.items.every((x) => x.id !== pid));
  r = await req("GET", "/api/gallery?tab=hot");
  check("gallery-hot", r.status === 200 && r.json.items.some((x) => x.id === aid) && r.json.items.find((x) => x.id === aid)?.png_url?.startsWith("data:image/png;base64,"));
  const v1 = await req("GET", `/api/artworks/${aid}`);
  const v2 = await req("GET", `/api/artworks/${aid}`);
  check("views-dedupe", v1.json.artwork.views === v2.json.artwork.views);
  r = await req("GET", "/api/users/9999/works");
  check("user-works", r.status === 200 && Array.isArray(r.json.items));
  r = await req("GET", `/api/users/${meId}/works`);
  check("user-works-tags", r.status === 200 && r.json.items.every((x) => typeof x.tags === "string"));
  r = await req("GET", `/api/users/${meId}`);
  check("user-stats", r.status === 200 && r.json.stats.artworks === 1 && r.json.stats.likes === 0 && r.json.stats.views === 1 && r.json.stats.comments === 0);
  r = await req("GET", "/api/users/latest");
  check("users-latest", r.status === 200 && r.json.user?.id === bid && r.json.user?.nickname === "小黑");
  r = await req("GET", "/api/me/works");
  check("me-works", r.status === 200 && r.json.items.length === 2 && r.json.drafts.some((draft) => draft.id === did && draft.png_url.startsWith("data:image/png;base64,") && Buffer.from(draft.png_url.split(",", 2)[1], "base64").readUInt32BE(16) === 4));
  r = await req("GET", "/api/admin/artworks");
  check("admin-artworks-forbidden", r.status === 403);
  process.env.ADMIN_EMAILS = "a@b.cn";
  r = await req("GET", "/api/admin/pending");
  check("admin-pending", r.status === 200 && r.json.items.some((x) => x.id === pid));
  r = await req("PATCH", `/api/admin/${pid}`, JSON.stringify({ status: "featured" }));
  check("admin-feature", r.status === 200);
  r = await req("GET", "/api/gallery?tab=featured");
  check("gallery-featured", r.status === 200 && r.json.items.some((x) => x.id === pid));
  r = await req("GET", "/api/gallery?tab=new&limit=24");
  check("gallery-featured-in-new", r.status === 200 && r.json.items.some((x) => x.id === pid));
  r = await req("GET", "/api/gallery?tab=hot&limit=24");
  check("gallery-featured-in-hot", r.status === 200 && r.json.items.some((x) => x.id === pid));
  r = await req("GET", "/api/admin/artworks");
  check("admin-artworks-featured", r.status === 200 && r.json.items.find((x) => x.id === pid)?.status === "featured");
  r = await req("GET", `/api/admin/artworks?q=${encodeURIComponent("色情")}`);
  check("admin-artworks-search", r.status === 200 && r.json.items.some((x) => x.id === pid) && r.json.items.every((x) => x.status !== "removed"));
  // 管理员下架头像来源作品 → 头像恢复默认“画”
  r = await req("POST", "/api/me/avatar", JSON.stringify({ artwork_id: pid }));
  check("avatar-set-pid", r.status === 200);
  r = await req("PATCH", `/api/admin/${pid}`, JSON.stringify({ status: "removed" }));
  check("admin-remove", r.status === 200);
  r = await req("GET", "/api/me");
  check("avatar-reverted-admin", r.status === 200 && !r.json.user.avatar_url);
  r = await req("GET", "/api/me");
  check("me-is-admin", r.status === 200 && r.json.user.is_admin === true);
  r = await req("GET", `/api/users/${bid}`);
  check("user-not-admin", r.status === 200 && r.json.user.is_admin === false);

  // ---- 取消发布 ----
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ title: "改名 bump" }));
  check("draft-bump-before-unpublish", r.status === 200);
  r = await pub({ draft_id: did, title: "待下架", png: png4, thumb: png4 });
  check("publish-for-unpublish", r.status === 201);
  const unpubId = r.json.artwork?.id;
  r = await req("POST", "/api/artworks/99999/unpublish");
  check("unpublish-missing", r.status === 404);
  r = await req("POST", `/api/artworks/${unpubId}/unpublish`);
  check("unpublish", r.status === 200);
  r = await req("POST", `/api/artworks/${unpubId}/unpublish`);
  check("unpublish-again", r.status === 409);
  r = await req("GET", "/api/gallery?tab=new");
  check("gallery-hides-unpublished", r.status === 200 && r.json.items.every((x) => x.id !== unpubId));
  const cookieA1 = cookie;
  cookie = "";
  r = await req("POST", "/api/login", JSON.stringify({ email: "b@c.cn", password: "secret12" }));
  r = await req("POST", `/api/artworks/${aid}/unpublish`);
  check("unpublish-other-forbidden", r.status === 403);
  cookie = cookieA1;

  // ---- 公告板：公开读，管理员写 ----
  cookie = "";
  r = await req("GET", "/api/board");
  check("board-public", r.status === 200 && r.json.board?.content === "");
  r = await req("POST", "/api/login", JSON.stringify({ email: "b@c.cn", password: "secret12" }));
  r = await req("PUT", "/api/board", JSON.stringify({ content: "乱写" }));
  check("board-stranger-forbidden", r.status === 403);
  cookie = cookieA1;
  r = await req("PUT", "/api/board", JSON.stringify({ content: "第一期命题进行中" }));
  check("board-admin-write", r.status === 200);
  cookie = "";
  r = await req("GET", "/api/board");
  check("board-public-read", r.status === 200 && r.json.board?.content === "第一期命题进行中");
  cookie = cookieA1;
  r = await req("PUT", "/api/board", JSON.stringify({ content: "" }));
  check("board-admin-clear", r.status === 200);
  // 作者取消发布头像来源作品 → 头像恢复默认“画”；下架别的不影响
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ title: "头像联动版" }));
  r = await pub({ draft_id: did, title: "头像稿", png: png4, thumb: png4 });
  const avid = r.json.artwork?.id;
  r = await req("POST", "/api/me/avatar", JSON.stringify({ artwork_id: avid }));
  check("avatar-set-tmp", r.status === 200);
  r = await req("POST", `/api/artworks/${avid}/unpublish`);
  check("unpublish-avatar-src", r.status === 200 && r.json.avatar_cleared === true);
  r = await req("GET", "/api/me");
  check("avatar-reverted", r.status === 200 && !r.json.user.avatar_url);
  r = await req("POST", "/api/me/avatar", JSON.stringify({ artwork_id: aid }));
  check("avatar-reset-aid", r.status === 200);
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ title: "头像联动版2" }));
  r = await pub({ draft_id: did, title: "路人稿", png: png4b, thumb: png4b });
  r = await req("POST", `/api/artworks/${r.json.artwork?.id}/unpublish`);
  check("unpublish-other-art", r.status === 200 && r.json.avatar_cleared !== true);
  r = await req("GET", "/api/me");
  check("avatar-kept", r.status === 200 && !!r.json.user.avatar_url);
  r = await req("DELETE", "/api/me/avatar");
  check("avatar-clear-tmp", r.status === 200);

  // ---- 同一版重复发布：改动后可再发 ----
  // 草稿改动（version+1）后可再发
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ title: "改动后" }));
  check("draft-touch-for-republish", r.status === 200);
  r = await pub({ draft_id: did, title: "改后重发", png: png4, thumb: png4 });
  check("publish-after-edit", r.status === 201);
  const aid2b = r.json.artwork?.id;
  const gNew = (await req("GET", "/api/gallery?tab=new&limit=24")).json.items.map((x) => x.id);
  const gFeat = (await req("GET", "/api/gallery?tab=featured&limit=24")).json.items.map((x) => x.id);
  const all = [...gNew, ...gFeat].sort((x, y) => y - x);
  const ai = all.indexOf(aid2b);
  const nb = await req("GET", `/api/artworks/${aid2b}/neighbors`);
  check("neighbors", nb.status === 200 &&
    (nb.json.prev?.id ?? null) === (all[ai - 1] ?? null) &&
    (nb.json.next?.id ?? null) === (all[ai + 1] ?? null));
  r = await req("GET", "/api/artworks/99999/neighbors");
  check("neighbors-missing", r.status === 404);
  // 草稿列表带出软连接
  r = await req("GET", "/api/drafts");
  const dd = (r.json.drafts || []).find((x) => x.id === did);
  check("draft-pub-link", r.status === 200 && dd?.published_artwork_id === aid2b);

  // ---- 作品改名（作者可改，他人不行，空标题不行）----
  r = await req("PATCH", `/api/artworks/${aid}`, JSON.stringify({ title: "新标题" }));
  check("rename-own", r.status === 200 && r.json.title === "新标题");
  r = await req("GET", `/api/artworks/${aid}`);
  check("rename-shown", r.status === 200 && r.json.artwork.title === "新标题");
  r = await req("PATCH", `/api/artworks/${aid}`, JSON.stringify({ title: "   " }));
  check("rename-bad", r.status === 400);
  // ---- 作品改信息（简介/标签/版权）----
  r = await req(
    "PATCH",
    `/api/artworks/${aid}`,
    JSON.stringify({ description: "新简介", tags: ["场景", "乱填"], license: "CC0" })
  );
  check("edit-info", r.status === 200);
  r = await req("GET", `/api/artworks/${aid}`);
  check(
    "edit-info-shown",
    r.status === 200 &&
      r.json.artwork.description === "新简介" &&
      r.json.artwork.license === "CC0" &&
      JSON.parse(r.json.artwork.tags).join() === "场景"
  );
  r = await req("PATCH", `/api/artworks/${aid}`, JSON.stringify({ license: "乱写" }));
  check("edit-bad-license", r.status === 400);
  r = await req("PATCH", `/api/artworks/${aid}`, JSON.stringify({ tags: "人物" }));
  check("edit-bad-tags", r.status === 400);
  r = await req("PATCH", `/api/artworks/${aid}`, JSON.stringify({}));
  check("edit-empty", r.status === 400);
  // ---- 版权直选：双勾选发布/修改/二创门禁 ----
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ title: "版权直选版" }));
  check("draft-bump-before-perm", r.status === 200);
  r = await pub({ draft_id: did, title: "双关发布", allow_download: 0, allow_remix: 0, png: png4, thumb: png4 });
  check("publish-perm-off", r.status === 201);
  const permId = r.json.artwork?.id;
  r = await req("GET", `/api/artworks/${permId}`);
  check("perm-off-shown", r.status === 200 && r.json.artwork.allow_download === 0 &&
    r.json.artwork.allow_remix === 0 && r.json.artwork.license === "不可转载");
  r = await req("PATCH", `/api/artworks/${permId}`, JSON.stringify({ allow_download: 1, allow_remix: 1 }));
  check("perm-patch-on", r.status === 200 && r.json.allow_download === 1 && r.json.allow_remix === 1);
  r = await req("GET", `/api/artworks/${permId}`);
  check("perm-on-shown", r.status === 200 && r.json.artwork.allow_download === 1 && r.json.artwork.license === "CC-BY-NC");
  // 关掉二创后他人 remix 应 403，打开后 201 并落草稿
  r = await req("PATCH", `/api/artworks/${permId}`, JSON.stringify({ allow_remix: 0 }));
  check("perm-remix-off", r.status === 200);
  cookie = "";
  r = await req("POST", "/api/login", JSON.stringify({ email: "b@c.cn", password: "secret12" }));
  r = await req("POST", `/api/artworks/${permId}/remix`);
  check("remix-forbidden", r.status === 403);
  cookie = cookieA1;
  r = await req("PATCH", `/api/artworks/${permId}`, JSON.stringify({ allow_remix: 1 }));
  check("perm-remix-on", r.status === 200);
  cookie = "";
  r = await req("POST", "/api/login", JSON.stringify({ email: "b@c.cn", password: "secret12" }));
  r = await req("POST", `/api/artworks/${permId}/remix`);
  check("remix-ok", r.status === 201 && r.json.draft?.id && String(r.json.draft.title).startsWith("续作·"));
  const remixDid = r.json.draft?.id;
  r = await req("GET", `/api/drafts/${remixDid}`);
  check("remix-draft", r.status === 200 && typeof r.json.draft.layers_json === "string");
  cookie = cookieA1;
  r = await req("GET", "/api/notifications");
  check("notif-remix", (r.json.items || []).some((x) => x.type === "remix"));
  // 默认发布 = 双开（CC-BY-NC）；单传 license=CC-BY-NC 也是双开
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ title: "默认映射版" }));
  check("draft-bump-before-default", r.status === 200);
  r = await pub({ draft_id: did, title: "默认发布", png: png4, thumb: png4 });
  check("publish-default", r.status === 201);
  r = await req("GET", `/api/artworks/${r.json.artwork?.id}`);
  check("publish-default-perms", r.status === 200 && r.json.artwork.allow_download === 1 &&
    r.json.artwork.allow_remix === 1 && r.json.artwork.license === "CC-BY-NC");
  r = await req("PUT", `/api/drafts/${did}`, JSON.stringify({ title: "映射版" }));
  r = await pub({ draft_id: did, title: "CCBYNC发布", license: "CC-BY-NC", png: png4, thumb: png4 });
  check("publish-ccbync", r.status === 201);
  r = await req("GET", `/api/artworks/${r.json.artwork?.id}`);
  check("publish-ccbync-perms", r.status === 200 && r.json.artwork.allow_download === 1 &&
    r.json.artwork.allow_remix === 1);
  r = await req("PATCH", "/api/artworks/99999", JSON.stringify({ title: "x" }));
  check("rename-missing", r.status === 404);
  cookie = "";
  r = await req("POST", "/api/login", JSON.stringify({ email: "b@c.cn", password: "secret12" }));
  r = await req("PATCH", `/api/artworks/${aid}`, JSON.stringify({ title: "黑改" }));
  check("rename-other-forbidden", r.status === 403);
  cookie = cookieA1;

  // ---- 点赞评论通知 ----
  r = await req("POST", `/api/artworks/${aid}/like`);
  check("like-own", r.status === 201 && r.json.likes_count === 1);
  r = await req("POST", `/api/artworks/${aid}/like`);
  check("like-idempotent", r.status === 200 && r.json.likes_count === 1);
  const cookieA2 = cookie;
  cookie = "";
  r = await req("POST", "/api/login", JSON.stringify({ email: "b@c.cn", password: "secret12" }));
  r = await req("POST", `/api/artworks/${aid}/like`);
  check("like-other", r.status === 201 && r.json.likes_count === 2);
  r = await req("POST", `/api/artworks/${aid}/comments`, JSON.stringify({ content: "@新名字 好看！" }));
  check("comment-mention", r.status === 201);
  const cid = r.json.comment?.id;
  r = await req("GET", `/api/artworks/${aid}/comments?page=1`);
  check("comment-list", r.status === 200 && r.json.items.length === 1 && r.json.items.some((x) => x.id === cid && x.user_id === bid));
  check("comment-no-admin", r.json.items.find((x) => x.id === cid)?.is_admin === false);
  for (let i = 0; i < 3; i++) {
    r = await req("POST", `/api/artworks/${aid}/comments`, JSON.stringify({ content: `分页测试 ${i + 1}` }));
    check(`comment-page-seed-${i + 1}`, r.status === 201);
  }
  r = await req("GET", `/api/artworks/${aid}/comments?page=1`);
  check("comment-page-1", r.status === 200 && r.json.page === 1 && r.json.page_size === 4 &&
    r.json.total === 4 && r.json.pages === 1 && r.json.items.length === 4 && r.json.has_next === false);
  r = await req("POST", `/api/artworks/${aid}/comments`, JSON.stringify({ content: "分页测试 4" }));
  check("comment-page-seed-4", r.status === 201);
  r = await req("GET", `/api/artworks/${aid}/comments?page=2`);
  check("comment-page-2", r.status === 200 && r.json.page === 2 && r.json.items.length === 1 &&
    r.json.has_prev === true && r.json.has_next === false);
  cookie = cookieA2;
  r = await req("GET", "/api/notifications");
  const types = (r.json.items || []).map((x) => x.type);
  check("notif-like-comment", r.status === 200 && types.includes("like") && types.includes("comment") && types.includes("mention"));
  r = await req("POST", `/api/artworks/${aid}/comments`, JSON.stringify({ content: "谢谢！", parent_id: cid }));
  check("comment-reply", r.status === 201);
  r = await req("GET", `/api/artworks/${aid}/comments?page=2`);
  check("comment-admin", r.json.items.some((x) => x.content === "谢谢！" && x.is_admin === true));
  cookie = "";
  r = await req("POST", "/api/login", JSON.stringify({ email: "b@c.cn", password: "secret12" }));
  r = await req("GET", "/api/notifications");
  check("notif-reply", (r.json.items || []).some((x) => x.type === "reply"));
  r = await req("DELETE", `/api/comments/${cid}`);
  check("comment-delete-own", r.status === 200);
  r = await req("GET", `/api/artworks/${aid}/comments`);
  check("comment-gone", r.json.items.every((x) => x.id !== cid));
  r = await req("POST", `/api/artworks/${aid}/comments`, JSON.stringify({ content: "第二条" }));
  const cid2 = r.json.comment?.id;
  cookie = cookieA2;
  r = await req("DELETE", `/api/comments/${cid2}`);
  check("comment-delete-as-author", r.status === 200);
  r = await req("POST", `/api/artworks/${aid}/comments`, JSON.stringify({ content: "作者留言" }));
  const acid = r.json.comment?.id;
  cookie = "";
  r = await req("POST", "/api/login", JSON.stringify({ email: "b@c.cn", password: "secret12" }));
  r = await req("DELETE", `/api/comments/${acid}`);
  check("comment-delete-stranger", r.status === 403);
  cookie = cookieA1;
  r = await req("DELETE", `/api/comments/${acid}`);
  check("comment-delete-as-admin", r.status === 200);
  r = await req("GET", `/api/artworks/${aid}/comments`);
  check("comment-gone-admin", r.json.items.every((x) => x.id !== acid));
  cookie = cookieA2;
  r = await req("POST", "/api/blocks", JSON.stringify({ user_id: bid }));
  check("block-b", r.status === 201);
  cookie = "";
  r = await req("POST", "/api/login", JSON.stringify({ email: "b@c.cn", password: "secret12" }));
  r = await req("POST", `/api/artworks/${aid}/like`);
  check("like-blocked", r.status === 403);
  r = await req("POST", `/api/artworks/${aid}/comments`, JSON.stringify({ content: "hi" }));
  check("comment-blocked", r.status === 403);
  cookie = cookieA2;
  r = await req("POST", `/api/artworks/${aid}/comments`, JSON.stringify({ content: "作者再留一条" }));
  const acid2 = r.json.comment?.id;
  r = await req("DELETE", `/api/comments/${acid2}`);
  check("comment-delete-own-2", r.status === 200);
  r = await req("DELETE", `/api/artworks/${aid}/like`);
  check("unlike", r.status === 200 && r.json.likes_count === 1);
  r = await req("PATCH", "/api/notifications/read");
  const unr = await req("GET", "/api/notifications");
  check("notif-read", r.status === 200 && unr.json.unread === 0);
  // 存储瘦身：死表已删、旧埋点与旧已读通知自动清理
  const { db: tdb } = await import("./db.js");
  const deadTables = tdb.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name IN ('follows','favorites')").get().c;
  check("drop-dead-tables", deadTables === 0);
  // 热门排序：浏览 / 点赞 / 评论；非法 sort 回落到综合
  const pubWorks = tdb.prepare("SELECT id FROM artworks WHERE status = 'normal' ORDER BY id").all();
  check("gallery-hot-sort-seed", pubWorks.length >= 3);
  const [wViews, wLikes, wComments] = pubWorks;
  tdb.prepare("UPDATE artworks SET views = 90, likes_count = 1, comments_count = 1 WHERE id = ?").run(wViews.id);
  tdb.prepare("UPDATE artworks SET views = 10, likes_count = 80, comments_count = 2 WHERE id = ?").run(wLikes.id);
  tdb.prepare("UPDATE artworks SET views = 20, likes_count = 3, comments_count = 70 WHERE id = ?").run(wComments.id);
  const hotViews = (await req("GET", "/api/gallery?tab=hot&sort=views&limit=24")).json.items;
  const hotLikes = (await req("GET", "/api/gallery?tab=hot&sort=likes&limit=24")).json.items;
  const hotCmts = (await req("GET", "/api/gallery?tab=hot&sort=comments&limit=24")).json.items;
  check("gallery-hot-sort-views", hotViews[0]?.id === wViews.id);
  check("gallery-hot-sort-likes", hotLikes[0]?.id === wLikes.id);
  check("gallery-hot-sort-comments", hotCmts[0]?.id === wComments.id);
  r = await req("GET", "/api/gallery?tab=hot&sort=nope");
  check("gallery-hot-sort-fallback", r.status === 200 && Array.isArray(r.json.items));
  tdb.prepare("INSERT INTO events (user_id, name, created_at) VALUES (NULL, 'visit', datetime('now', '-100 days'))").run();
  const { logEvent } = await import("./analytics.js");
  const oldRandom = Math.random;
  Math.random = () => 0; // 本次必触发清理分支
  logEvent(null, "visit");
  Math.random = oldRandom;
  check("events-prune", tdb.prepare("SELECT COUNT(*) c FROM events WHERE created_at < datetime('now', '-90 days')").get().c === 0);
  tdb.prepare("INSERT INTO notifications (user_id, type, read, created_at) VALUES (?, 'system', 1, datetime('now', '-40 days'))").run(meId);
  await req("GET", "/api/notifications");
  check("notif-prune", tdb.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 1 AND created_at < datetime('now', '-30 days')").get(meId).c === 0);
  // 审核通知：精选 pid 后作者应收到 featured 通知（带作品标题）
  check("notif-featured", (unr.json.items || []).some((x) => x.type === "featured" && x.artwork_title));
  // 注册欢迎通知
  check("notif-welcome", (unr.json.items || []).some((x) => x.type === "welcome"));
  // 通知筛选：按类型 / 只看未读
  r = await req("GET", "/api/notifications?type=like");
  check("notif-filter-type", r.status === 200 && (r.json.items || []).every((x) => x.type === "like"));
  r = await req("GET", "/api/notifications?unread=1");
  check("notif-filter-unread", r.status === 200 && (r.json.items || []).length === 0);
  // 单条标已读 / 单条删除 / 删不存在的
  const someId = (unr.json.items || [])[0]?.id;
  r = await req("PATCH", `/api/notifications/${someId}/read`);
  check("notif-read-one", r.status === 200);
  r = await req("PATCH", "/api/notifications/999999/read");
  check("notif-read-one-missing", r.status === 404);
  r = await req("DELETE", `/api/notifications/${someId}`);
  check("notif-delete-one", r.status === 200);
  r = await req("DELETE", `/api/notifications/${someId}`);
  check("notif-delete-one-gone", r.status === 404);
  // 头像：选用自己作品 → me 生效；清掉 → 恢复默认
  r = await req("POST", "/api/me/avatar", JSON.stringify({ artwork_id: aid }));
  check("avatar-from-work", r.status === 200 && r.json.avatar_url?.startsWith("data:image/png;base64,"), (r.json?.avatar_url || "").slice(0, 40));
  r = await req("GET", "/api/me");
  check("avatar-in-me", r.status === 200 && !!r.json.user.avatar_url);
  r = await req("DELETE", "/api/me/avatar");
  check("avatar-clear", r.status === 200);
  r = await req("POST", "/api/me/avatar", JSON.stringify({ draft_id: did, image: png4 }));
  check("avatar-reject-draft", r.status === 400 && r.json.error === "published_artwork_required");
  r = await req("GET", "/api/me");
  check("avatar-draft-not-applied", r.status === 200 && !r.json.user.avatar_url);
  r = await req("DELETE", "/api/me/avatar");
  check("avatar-clear-after-draft-attempt", r.status === 200);
  r = await req("PUT", "/api/me/pet", JSON.stringify({ artwork_id: 9999 }));
  check("pet-missing", r.status === 404);
  r = await req("PUT", "/api/me/pet", JSON.stringify({ artwork_id: aid, flip: true }));
  check("pet-set", r.status === 200 && r.json.pet.artwork_id === aid && r.json.pet.flip === 1 && r.json.pet.png_url.startsWith("data:image/png"));
  r = await req("GET", `/api/users/${meId}`);
  check("pet-public", r.status === 200 && r.json.pet.artwork_id === aid && r.json.pet.flip === 1);
  r = await req("PUT", "/api/me/pet", JSON.stringify({ artwork_id: 0 }));
  check("pet-clear", r.status === 200 && r.json.pet === null);
  // 宠物只接受已发布作品，拒绝草稿参数
  r = await req("PUT", "/api/me/pet", JSON.stringify({ draft_id: 9999 }));
  check("pet-reject-missing-draft", r.status === 400 && r.json.error === "published_artwork_required");
  r = await req("PUT", "/api/me/pet", JSON.stringify({ draft_id: did }));
  check("pet-reject-draft", r.status === 400 && r.json.error === "published_artwork_required");
  r = await req("GET", `/api/users/${meId}`);
  check("pet-draft-not-applied", r.status === 200 && r.json.pet === null);
  r = await req("PUT", "/api/me/pet", JSON.stringify({ artwork_id: 0 }));
  check("pet-clear-after-draft-attempt", r.status === 200 && r.json.pet === null);
  const { db: testDb } = await import("./db.js");
  testDb.prepare("UPDATE users SET avatar_url = ?, pet_artwork_id = ?, pet_kind = 'draft' WHERE id = ?")
    .run("data:image/png;base64,legacy", did, meId);
  r = await req("GET", "/api/me");
  check("legacy-draft-avatar-cleared", r.status === 200 && !r.json.user.avatar_url && r.json.pet === null);
  check("legacy-draft-pet-cleared", testDb.prepare("SELECT pet_artwork_id FROM users WHERE id = ?").get(meId).pet_artwork_id === null);
  // 一键清空
  r = await req("DELETE", "/api/notifications");
  const empty = await req("GET", "/api/notifications");
  check("notif-clear", r.status === 200 && empty.json.items.length === 0 && empty.json.unread === 0);
  // 别的人不能拿我的作品当头像
  cookie = "";
  r = await req("POST", "/api/login", JSON.stringify({ email: "b@c.cn", password: "secret12" }));
  r = await req("POST", "/api/me/avatar", JSON.stringify({ artwork_id: aid }));
  check("avatar-other-forbidden", r.status === 404);
  cookie = cookieA2;
  r = await req("POST", "/api/blocks", JSON.stringify({ user_id: meId }));
  check("block-self", r.status === 400);
  r = await req("POST", "/api/blocks", JSON.stringify({ user_id: 999 }));
  check("block-missing", r.status === 404);
  r = await req("POST", "/api/blocks", JSON.stringify({ user_id: bid }));
  check("block", r.status === 201);
  r = await req("DELETE", `/api/blocks/${bid}`);
  check("unblock", r.status === 200);

  // 登出后 me 失效
  r = await req("POST", "/api/logout");
  check("logout", r.status === 200);
  r = await req("GET", "/api/me");
  check("me-after-logout", r.status === 401);

  server.close();
  const { db } = await import("./db.js");
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures === 0 ? "SELFTEST_OK" : `SELFTEST_FAIL:${failures}`);
  process.exit(failures === 0 ? 0 : 1);
});
