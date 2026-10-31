import dotenv from "dotenv";
import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./db.js"; // 建表（IF NOT EXISTS），启动即就绪
import { authRouter } from "./auth.js";
import { draftsRouter } from "./drafts.js";
import { artworksRouter } from "./artworks.js";
import { socialRouter } from "./social.js";
import { analyticsRouter } from "./analytics.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
// 环境变量：server/.env 优先，其次项目根 .env（dotenv 默认不覆盖已存在变量，所以先读优先项）
// 注意 dir 是 src/ 目录，各回一层才是 server/ 与项目根
dotenv.config({ path: path.join(dir, "..", ".env") });
dotenv.config({ path: path.join(dir, "..", "..", ".env") });
const app = express();
app.disable("x-powered-by");
const PORT = process.env.PORT || 3001;

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.warn("[security] SESSION_SECRET 未设置，会话用了默认密钥，立即配置！");
}

// 基础安全头（T71）
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'"
    );
  }
  next();
});

app.use(express.json({ limit: "5mb" })); // 发布走 base64 内嵌 PNG（上限见 artworks.js 校验）
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 3600 * 1000 }, // 记住我 30 天
  })
);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, version: "0.1.0" });
});

app.use("/api", authRouter);
app.use("/api/drafts", draftsRouter);
app.use("/api", artworksRouter);
app.use("/api", socialRouter);
app.use("/api", analyticsRouter);

// 未知 API：明确 JSON 404（不能漏进 SPA 的 index.html）
app.use("/api", (req, res) => {
  res.status(404).json({ error: "not_found" });
});

// 生产环境托管前端构建产物（开发环境走 Vite，无 dist 则跳过）
const dist = path.join(dir, "../../web/dist");
app.use(express.static(dist));
app.get(/^(?!\/api\/).*/, (req, res, next) => {
  res.sendFile(path.join(dist, "index.html"), (err) => (err ? next() : undefined));
});

// 500：统一 JSON（前端有怀旧风 404 页；API 错误走 error 字段）
app.use((err, req, res, next) => {
  console.error("server_error:", err?.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "server_error" });
});

export { app };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`pixel-server listening on ${PORT}`);
  });
}
