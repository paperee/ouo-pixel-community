// 限流中间件：内存 Map，单机够用（多机再换 Redis）
const hits = new Map();

export function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max)
      return res.status(429).json({ error: "too_many_requests" });
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}
